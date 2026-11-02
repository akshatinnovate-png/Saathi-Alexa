use super::cursor::Cursor;
use super::engine::Engine;
use super::{https, system, Shared, Status};
use crate::agent::{self, Reply};
use crate::retry::{classify, retry_after_from, Failure, Rotation};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::sync::mpsc::{Receiver, TryRecvError};
use std::sync::Arc;
use std::time::{Duration, Instant};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

enum Outcome {
    Reply(Reply),
    Note(String),
    Fail(String),
}

fn ask_groq(shared: &Shared, rotation: &mut Rotation, keys: &mut usize, messages: &mut Vec<Value>) -> Outcome {
    let mut announced = false;
    loop {
        if shared.stop.load(Ordering::Relaxed) || shared.quit.load(Ordering::Relaxed) {
            return Outcome::Fail("Stopped.".into());
        }
        let cfg = shared.config();
        if cfg.keys.is_empty() {
            shared.ask_for_key();
            return Outcome::Fail("Add a Groq key first: right-click the sphere, then Groq keys.".into());
        }
        if *keys != cfg.keys.len() {
            *keys = cfg.keys.len();
            *rotation = Rotation::new(*keys, 1, 5);
        }
        let key = cfg.keys[rotation.current().0.min(cfg.keys.len() - 1)].clone();
        let body = agent::request(messages, &cfg.model).to_string();
        system::log(&format!("groq request: {} messages, {} bytes", messages.len(), body.len()));
        let started = Instant::now();
        let auth = format!("Bearer {key}");
        let (status, text) = match https::post_json(agent::HOST, agent::PATH, &[("Authorization", &auth)], &body, Duration::from_secs(120)) {
            Ok(r) => r,
            Err(e) => (0, e),
        };
        if status == 200 {
            rotation.connected();
            system::log(&format!("groq answered in {} ms", started.elapsed().as_millis()));
            return match agent::parse(&text) {
                Ok(r) => Outcome::Reply(r),
                Err(e) => Outcome::Note(format!("Your last answer could not be read ({e}). Answer again.")),
            };
        }
        let short: String = text.chars().take(400).collect();
        system::log(&format!("groq {status}: {short}"));
        let lower = short.to_ascii_lowercase();
        if status == 413 || lower.contains("request too large") || lower.contains("reduce your message") || lower.contains("context_length") || lower.contains("context length") {
            if agent::shrink(messages) {
                shared.set_status(Status::Thinking, "Trimming what I send to fit Groq's limit…");
                continue;
            }
            return Outcome::Fail(format!("The request is too big for Groq: {}", groq_message(&text)));
        }
        if status == 400 && (lower.contains("tool") || lower.contains("function")) {
            return Outcome::Note(format!("Your last tool call was rejected: {short}. Call the tool again with valid JSON arguments."));
        }
        if (400..500).contains(&status) && !matches!(status, 401 | 403 | 404 | 408 | 409 | 429) && classify(status, &text) == Failure::Network {
            return Outcome::Fail(format!("Groq refused the request ({status}): {}", groq_message(&text)));
        }
        let failure = if status == 0 { Failure::Network } else { classify(status, &text) };
        if failure == Failure::BadModel && cfg.model != agent::MODEL {
            system::log(&format!("model {} refused, going back to {}", cfg.model, agent::MODEL));
            shared.update_config(|c| c.model = agent::MODEL.to_string());
            continue;
        }
        match rotation.failed(failure, retry_after_from(&text)) {
            Some(d) => {
                let msg = match failure {
                    Failure::Quota => format!("Groq's free limit is busy; trying again in {}s…", d.as_secs().max(1)),
                    Failure::BadKey => "That Groq key was refused; trying the next one…".to_string(),
                    _ if status == 0 => format!("Can't reach Groq ({}); trying again in {}s…", short.chars().take(120).collect::<String>(), d.as_secs().max(1)),
                    _ => format!("Groq had a problem ({status}); trying again in {}s…", d.as_secs().max(1)),
                };
                if rotation_attempts_announce(&mut announced) {
                    shared.say("Sahay", &msg);
                }
                shared.set_status(Status::Waiting, &msg);
                let end = Instant::now() + d;
                while Instant::now() < end {
                    if shared.stop.load(Ordering::Relaxed) || shared.quit.load(Ordering::Relaxed) {
                        return Outcome::Fail("Stopped.".into());
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                shared.set_status(Status::Thinking, "Thinking…");
            }
            None => {
                *rotation = Rotation::new(cfg.keys.len(), 1, 5);
                if failure == Failure::BadKey {
                    shared.ask_for_key();
                    return Outcome::Fail("Groq refused every key. Add a working key from console.groq.com/keys.".into());
                }
                return Outcome::Fail(if status == 0 { format!("Can't reach Groq: {short}. Check the internet connection, or whether a firewall or antivirus is blocking Sahay.") } else { format!("Groq is not answering ({status}): {}", groq_message(&text)) });
            }
        }
    }
}

fn rotation_attempts_announce(announced: &mut bool) -> bool {
    !std::mem::replace(announced, true)
}

fn groq_message(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.pointer("/error/message").and_then(Value::as_str).map(String::from))
        .unwrap_or_else(|| body.chars().take(300).collect())
}

fn first_line(s: &str) -> String {
    let line = s.lines().next().unwrap_or("").trim();
    line.chars().take(160).collect()
}

pub fn run(shared: Arc<Shared>, rx: Receiver<String>) {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED).ok();
    }
    while shared.cursor.load(Ordering::Relaxed) == 0 {
        if shared.quit.load(Ordering::Relaxed) {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let cfg = shared.config();
    let own = vec![shared.orb.load(Ordering::Relaxed), shared.panel.load(Ordering::Relaxed)];
    let mut engine = Engine::new(Cursor::new(shared.cursor.load(Ordering::Relaxed), cfg.color), own);
    let mut messages: Vec<Value> = vec![json!({ "role": "system", "content": agent::system_prompt(&cfg.name, &cfg.extra) })];
    let mut rotation = Rotation::new(cfg.keys.len().max(1), 1, 5);
    let mut keys = cfg.keys.len();
    while let Ok(first) = rx.recv() {
        if shared.quit.load(Ordering::Relaxed) {
            return;
        }
        shared.stop.store(false, Ordering::Relaxed);
        shared.busy.store(true, Ordering::Relaxed);
        let cfg = shared.config();
        messages[0] = json!({ "role": "system", "content": agent::system_prompt(&cfg.name, &cfg.extra) });
        shared.set_status(Status::Acting, "Reading the screen…");
        let seen = engine.look();
        messages.push(json!({ "role": "user", "content": format!("{first}\n\nWhat the Mover sees now:\n{seen}") }));
        shared.set_status(Status::Thinking, "Thinking…");
        let mut steps = 0;
        let mut empty = 0;
        loop {
            match rx.try_recv() {
                Ok(more) => {
                    messages.push(json!({ "role": "user", "content": format!("(New message while you work) {more}") }));
                }
                Err(TryRecvError::Disconnected) => return,
                Err(TryRecvError::Empty) => {}
            }
            if shared.stop.load(Ordering::Relaxed) {
                shared.say("Sahay", "Stopped.");
                messages.push(json!({ "role": "user", "content": "(The user pressed stop. Do nothing more until they ask again.)" }));
                break;
            }
            if steps >= agent::MAX_STEPS {
                shared.say("Sahay", "I've taken a lot of steps on this, so I'm pausing. Tell me to carry on if you want.");
                break;
            }
            agent::compact(&mut messages);
            let reply = match ask_groq(&shared, &mut rotation, &mut keys, &mut messages) {
                Outcome::Reply(r) => r,
                Outcome::Note(n) => {
                    messages.push(json!({ "role": "user", "content": n }));
                    steps += 1;
                    continue;
                }
                Outcome::Fail(e) => {
                    shared.say("Sahay", &e);
                    break;
                }
            };
            if reply.text.is_empty() && reply.calls.is_empty() {
                empty += 1;
                steps += 1;
                if empty <= 2 {
                    system::log(&format!("empty answer from groq (cut off: {})", reply.cut_off));
                    messages.push(json!({ "role": "user", "content": "(Your last answer was empty. Keep your thinking short, then either call one tool or reply to me.)" }));
                    continue;
                }
                shared.say("Sahay", "I couldn't work out what to do next. Tell me again, maybe in other words.");
                break;
            }
            empty = 0;
            if !reply.text.is_empty() {
                shared.say("Sahay", &reply.text);
            }
            messages.push(reply.message.clone());
            if reply.calls.is_empty() {
                break;
            }
            for (n, call) in reply.calls.iter().enumerate() {
                steps += 1;
                if n > 0 {
                    messages.push(agent::tool_result(call, "Not done: only one step runs at a time and the screen has changed. Call it again if it is still needed, using the newest numbers."));
                    continue;
                }
                if shared.stop.load(Ordering::Relaxed) {
                    messages.push(agent::tool_result(call, "Not done: the user pressed stop."));
                    continue;
                }
                let what = agent::describe(call);
                shared.say("→", &what);
                shared.set_status(Status::Acting, &what);
                let stop = || shared.stop.load(Ordering::Relaxed) || shared.quit.load(Ordering::Relaxed);
                let result = engine.run(call, &stop);
                system::log(&format!("mover {what}: {}", first_line(&result)));
                shared.say("   ", &first_line(&result));
                messages.push(agent::tool_result(call, &result));
            }
            shared.set_status(Status::Thinking, "Thinking…");
        }
        engine.cursor.hide();
        shared.busy.store(false, Ordering::Relaxed);
        shared.set_status(if shared.stop.load(Ordering::Relaxed) { Status::Stopped } else { Status::Idle }, "");
    }
}
