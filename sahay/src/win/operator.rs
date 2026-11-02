use super::{https, screen, system, tools, uia::Reader, Out, Shared, Status};
use crate::actions::describe_elements;
use crate::operator::{self, Memory, DEFAULT_MODELS, HOST, MAX_STEPS};
use crate::protocol::{self, classify, Call, Failure};
use crate::retry::{retry_after_from, Rotation};
use base64::Engine;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::sync::mpsc::{Receiver, RecvTimeoutError, TryRecvError};
use std::sync::Arc;
use std::time::{Duration, Instant};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

pub enum Cmd {
    Start(String),
    Update(String),
    Stop,
}

enum Flow {
    Continue,
    Stopped,
    Quit,
}

fn speak(shared: &Shared, text: &str) {
    system::log(&format!("helper says: {text}"));
    shared.caption(text);
    let _ = shared.out.send(Out::Important(protocol::user_text(&format!("[Helper] {text}"))));
}

fn drain(rx: &Receiver<Cmd>, task: &mut Option<Memory>, shared: &Shared) -> Flow {
    loop {
        match rx.try_recv() {
            Ok(Cmd::Start(goal)) => {
                system::log(&format!("task replaced: {goal}"));
                *task = Some(Memory::new(&goal));
            }
            Ok(Cmd::Update(text)) => {
                if let Some(t) = task.as_mut() {
                    system::log(&format!("update: {text}"));
                    t.updates.push(text);
                }
            }
            Ok(Cmd::Stop) => {
                if task.take().is_some() {
                    system::log("task stopped by the user");
                    shared.set_status(Status::Listening, "Stopped.");
                }
                return Flow::Stopped;
            }
            Err(TryRecvError::Empty) => return Flow::Continue,
            Err(TryRecvError::Disconnected) => return Flow::Quit,
        }
    }
}

fn think(shared: &Shared, rx: &Receiver<Cmd>, task: &mut Option<Memory>, rotation: &mut Rotation, prompt: &str, jpeg: Option<&str>) -> Option<Vec<(String, Value)>> {
    let mut failures = 0u32;
    loop {
        if shared.quit.load(Ordering::Relaxed) {
            return None;
        }
        if let Flow::Stopped | Flow::Quit = drain(rx, task, shared) {
            return None;
        }
        let cfg = shared.config();
        if cfg.keys.is_empty() {
            speak(shared, "I need a Gemini key first. Right-click the sphere and choose Gemini keys.");
            return None;
        }
        let (k, m) = rotation.current();
        let key = cfg.keys[k.min(cfg.keys.len() - 1)].clone();
        let model = DEFAULT_MODELS[m.min(DEFAULT_MODELS.len() - 1)];
        let body = operator::request(model, &operator::system(&cfg.name, &cfg.extra), prompt, jpeg).to_string();
        let started = Instant::now();
        let result = https::post_json(HOST, &format!("/v1beta/models/{model}:generateContent"), &[("x-goog-api-key", &key)], &body, Duration::from_secs(90));
        let failure = match result {
            Ok((200, text)) => match operator::parse(&text) {
                Ok(calls) => {
                    rotation.connected();
                    system::log(&format!("thought with {model} in {} ms", started.elapsed().as_millis()));
                    return Some(calls);
                }
                Err(e) => {
                    failures += 1;
                    system::log(&format!("no usable action from {model}: {e}"));
                    if failures >= 3 {
                        return Some(vec![("wait".into(), json!({ "seconds": 1 }))]);
                    }
                    std::thread::sleep(Duration::from_millis(500));
                    continue;
                }
            },
            Ok((status, text)) => {
                let reason = format!("HTTP {status} {}", text.chars().take(400).collect::<String>());
                system::log(&format!("{model} refused: {reason}"));
                let f = match status {
                    429 => Failure::Quota,
                    401 | 403 => Failure::BadKey,
                    404 => Failure::BadModel,
                    400 if reason.contains("API key") => Failure::BadKey,
                    400 if reason.to_ascii_lowercase().contains("model") || reason.contains("thinking") => Failure::BadModel,
                    _ => classify(&reason),
                };
                (f, reason)
            }
            Err(e) => {
                system::log(&format!("network: {e}"));
                (Failure::Network, e)
            }
        };
        let (f, reason) = failure;
        match rotation.failed(f, retry_after_from(&reason)) {
            Some(d) => {
                shared.set_status(Status::Waiting, &format!("Gemini is busy, trying again in {}s…", d.as_secs().max(1)));
                let end = Instant::now() + d;
                while Instant::now() < end {
                    if shared.quit.load(Ordering::Relaxed) {
                        return None;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                shared.set_status(Status::Working, "Working…");
            }
            None => {
                speak(shared, "Every Gemini key was refused. Please add a working key from the sphere's menu.");
                if f == Failure::BadKey {
                    shared.ask_for_key();
                }
                *rotation = Rotation::new(cfg.keys.len(), DEFAULT_MODELS.len(), 11);
                return None;
            }
        }
    }
}

fn wait_for_answer(shared: &Shared, rx: &Receiver<Cmd>, task: &mut Option<Memory>) -> Option<String> {
    shared.awaiting.store(true, Ordering::Relaxed);
    let end = Instant::now() + Duration::from_secs(600);
    let answer = loop {
        if shared.quit.load(Ordering::Relaxed) || Instant::now() > end {
            break None;
        }
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(Cmd::Update(text)) => break Some(text),
            Ok(Cmd::Start(goal)) => {
                *task = Some(Memory::new(&goal));
                break None;
            }
            Ok(Cmd::Stop) => {
                *task = None;
                break None;
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break None,
        }
    };
    shared.awaiting.store(false, Ordering::Relaxed);
    answer
}

pub fn run(shared: Arc<Shared>, rx: Receiver<Cmd>) {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED).ok();
    }
    let reader = Reader::new().map_err(|e| system::log(&e)).ok();
    let port = std::fs::read_to_string(system::home().join("saathi.env")).map(|t| crate::saathi::port_from_env_file(&t)).unwrap_or(8787);
    let mut saathi = crate::saathi::Saathi::new(port);
    let mut task: Option<Memory> = None;
    let mut rotation = Rotation::new(1, DEFAULT_MODELS.len(), 3);
    let mut keys = 0usize;
    loop {
        if shared.quit.load(Ordering::Relaxed) {
            return;
        }
        if task.is_none() {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(Cmd::Start(goal)) => {
                    system::log(&format!("task started: {goal}"));
                    task = Some(Memory::new(&goal));
                }
                Ok(_) | Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        match drain(&rx, &mut task, &shared) {
            Flow::Quit => return,
            Flow::Stopped => continue,
            Flow::Continue => {}
        }
        if shared.paused.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(200));
            continue;
        }
        let n = shared.config().keys.len().max(1);
        if n != keys {
            keys = n;
            rotation = Rotation::new(n, DEFAULT_MODELS.len(), 3);
        }
        let Some(mem) = task.as_ref() else { continue };
        if mem.steps >= MAX_STEPS {
            speak(&shared, "I have taken a lot of steps on this and stopped. Tell me if you want me to keep going.");
            task = None;
            continue;
        }
        shared.set_status(Status::Working, "Working…");
        let frame = screen::capture(1280, 72);
        let rect = frame.as_ref().map(|f| f.rect).unwrap_or_else(screen::active_monitor);
        shared.set_frame_rect(rect);
        let (window, elements) = match reader.as_ref().map(|r| r.snapshot_within(rect, 120, Duration::from_millis(1200))) {
            Some(Ok((title, els))) => {
                let text = describe_elements(&title, &els, rect);
                *shared.elements.lock().unwrap_or_else(|p| p.into_inner()) = els;
                (title, text)
            }
            Some(Err(e)) => (system::foreground_title(), format!("(controls could not be read: {e})")),
            None => (system::foreground_title(), String::new()),
        };
        let jpeg = frame.map(|f| base64::engine::general_purpose::STANDARD.encode(f.jpeg));
        let prompt = mem.prompt(&window, &elements);
        let Some(calls) = think(&shared, &rx, &mut task, &mut rotation, &prompt, jpeg.as_deref()) else { continue };
        let Some(mem) = task.as_mut() else { continue };
        let (name, args) = calls.into_iter().next().unwrap_or_else(|| ("wait".into(), json!({})));
        system::log(&format!("step {}: {name} {}", mem.steps + 1, args.to_string().chars().take(300).collect::<String>()));
        match name.as_str() {
            "done" => {
                let summary = args.get("summary").and_then(Value::as_str).unwrap_or("Done.").to_string();
                speak(&shared, &format!("Finished: {summary}"));
                task = None;
                shared.set_status(Status::Listening, "");
            }
            "say" => {
                let message = args.get("message").and_then(Value::as_str).unwrap_or("").to_string();
                if !message.is_empty() {
                    speak(&shared, &message);
                }
                mem.record("say", &args, "Said it");
            }
            "ask_user" => {
                let question = args.get("question").and_then(Value::as_str).unwrap_or("What should I do?").to_string();
                speak(&shared, &format!("Question for the user: {question}"));
                shared.set_status(Status::Listening, &question);
                let answer = wait_for_answer(&shared, &rx, &mut task);
                if let (Some(mem), Some(a)) = (task.as_mut(), answer) {
                    mem.updates.push(format!("Answer to \"{question}\": {a}"));
                    mem.record("ask_user", &args, &format!("The user answered: {a}"));
                } else if let Some(mem) = task.as_mut() {
                    mem.record("ask_user", &args, "No answer came. Choose sensibly or ask again later.");
                }
            }
            "saathi" => {
                let tool = args.get("tool").and_then(Value::as_str).unwrap_or("");
                let arguments = args.get("arguments_json").and_then(Value::as_str).and_then(|s| serde_json::from_str::<Value>(s).ok()).unwrap_or_else(|| json!({}));
                let out = saathi.call(tool, arguments);
                mem.record("saathi", &args, &out.to_string());
            }
            _ => {
                let mut args = args;
                if name == "type_text" && args.get("press_enter").and_then(Value::as_bool) == Some(true) {
                    let t = format!("{}\n", args.get("text").and_then(Value::as_str).unwrap_or(""));
                    args["text"] = json!(t);
                }
                let generation = shared.cancel_gen.load(Ordering::Relaxed);
                let cancelled = || shared.cancel_gen.load(Ordering::Relaxed) != generation || shared.quit.load(Ordering::Relaxed);
                let call = Call { id: "operator".into(), name: name.clone(), args: args.clone() };
                shared.set_status(Status::Working, &tools::label(&call));
                let result = tools::execute(&shared, reader.as_ref(), &call, &cancelled);
                let text = if result.get("ok").and_then(Value::as_bool) == Some(false) {
                    format!("FAILED: {}", result.get("error").map(|e| e.to_string()).unwrap_or_default())
                } else {
                    result.get("result").or_else(|| result.get("output")).map(|r| r.as_str().map(String::from).unwrap_or_else(|| r.to_string())).unwrap_or_else(|| "ok".into())
                };
                system::log(&format!("  -> {}", text.chars().take(300).collect::<String>()));
                mem.record(&name, &args, &text);
                let settle = match name.as_str() {
                    "open" => 1500,
                    "wait" | "run_command" | "read_file" | "write_file" | "clipboard" => 0,
                    _ => 600,
                };
                std::thread::sleep(Duration::from_millis(settle));
            }
        }
    }
}
