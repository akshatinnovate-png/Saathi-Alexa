use super::cursor::Cursor;
use super::engine::Engine;
use super::{https, system, Shared, Status};
use crate::agent::{self, Reply};
use crate::intent::{self, Intent};
use crate::plan;
use crate::retry::{classify, estimate_tokens, retry_after_from, Failure, Pacer, Rotation};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::sync::mpsc::Receiver;
use std::sync::Arc;
use std::time::{Duration, Instant};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

const TOKENS_PER_MINUTE: usize = 7000;
const ANSWER_BUDGET: usize = 700;
const MAX_CALLS: usize = 10;
const MAX_REPLANS: usize = 4;

enum Outcome {
    Reply(Reply),
    Note(String),
    Fail(String),
}

struct Groq {
    rotation: Rotation,
    keys: usize,
    pacers: Vec<Pacer>,
}

impl Groq {
    fn new(keys: usize) -> Self {
        Self { rotation: Rotation::new(keys.max(1), 1, 5), keys, pacers: (0..keys.max(1)).map(|_| Pacer::new(TOKENS_PER_MINUTE)).collect() }
    }
}

fn pause(shared: &Shared, d: Duration, msg: &str, told: &mut bool) -> bool {
    if d >= Duration::from_secs(4) && !std::mem::replace(told, true) {
        shared.say("Sahay", msg);
    }
    shared.set_status(Status::Waiting, msg);
    let end = Instant::now() + d;
    while Instant::now() < end {
        if shared.stop.load(Ordering::Relaxed) || shared.quit.load(Ordering::Relaxed) {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    shared.set_status(Status::Thinking, "Thinking…");
    true
}

fn ask_groq(shared: &Shared, groq: &mut Groq, messages: &mut Vec<Value>, told: &mut bool) -> Outcome {
    loop {
        if shared.stop.load(Ordering::Relaxed) || shared.quit.load(Ordering::Relaxed) {
            return Outcome::Fail("Stopped.".into());
        }
        let cfg = shared.config();
        if cfg.keys.is_empty() {
            shared.ask_for_key();
            return Outcome::Fail("Add a Groq key first: right-click the sphere, then Groq keys.".into());
        }
        if groq.keys != cfg.keys.len() {
            *groq = Groq::new(cfg.keys.len());
        }
        let index = groq.rotation.current().0.min(cfg.keys.len() - 1);
        let key = cfg.keys[index].clone();
        let body = agent::request(messages, &cfg.model).to_string();
        let tokens = estimate_tokens(body.len(), ANSWER_BUDGET);
        let wait = groq.pacers[index].wait_for(Instant::now(), tokens);
        if !wait.is_zero() {
            system::log(&format!("pacing {} ms before a {tokens}-token request", wait.as_millis()));
            if !pause(shared, wait, &format!("Keeping inside Groq's free per-minute limit: continuing in {}s…", wait.as_secs().max(1)), told) {
                return Outcome::Fail("Stopped.".into());
            }
        }
        groq.pacers[index].record(Instant::now(), tokens);
        system::log(&format!("groq request: {} messages, {} bytes, ~{tokens} tokens", messages.len(), body.len()));
        let started = Instant::now();
        let auth = format!("Bearer {key}");
        let (status, text) = match https::post_json(agent::HOST, agent::PATH, &[("Authorization", &auth)], &body, Duration::from_secs(120)) {
            Ok(r) => r,
            Err(e) => (0, e),
        };
        if status == 200 {
            groq.rotation.connected();
            system::log(&format!("groq answered in {} ms", started.elapsed().as_millis()));
            return match agent::parse(&text) {
                Ok(r) => {
                    if let Some(actual) = r.tokens {
                        groq.pacers[index].correct_last(actual);
                    }
                    Outcome::Reply(r)
                }
                Err(e) => Outcome::Note(format!("(Your last answer could not be read: {e}. Answer again.)")),
            };
        }
        let short: String = text.chars().take(400).collect();
        system::log(&format!("groq {status}: {short}"));
        let lower = short.to_ascii_lowercase();
        if status == 413 || lower.contains("request too large") || lower.contains("reduce your message") || lower.contains("context_length") || lower.contains("context length") {
            if agent::shrink(messages) {
                continue;
            }
            return Outcome::Fail(format!("The request is too big for Groq: {}", groq_message(&text)));
        }
        if status == 400 && (lower.contains("tool") || lower.contains("function")) {
            return Outcome::Note(format!("(Your last tool call was rejected: {short}. Use do_steps with a list of step strings.)"));
        }
        if (400..500).contains(&status) && !matches!(status, 401 | 403 | 404 | 408 | 409 | 429) && classify(status, &text) == Failure::Network {
            return Outcome::Fail(format!("Groq refused the request ({status}): {}", groq_message(&text)));
        }
        let failure = if status == 0 { Failure::Network } else { classify(status, &text) };
        if failure == Failure::Quota {
            groq.pacers[index].slow_down();
        }
        if failure == Failure::BadModel && cfg.model != agent::MODEL {
            system::log(&format!("model {} refused, going back to {}", cfg.model, agent::MODEL));
            shared.update_config(|c| c.model = agent::MODEL.to_string());
            continue;
        }
        match groq.rotation.failed(failure, retry_after_from(&text)) {
            Some(d) => {
                let msg = match failure {
                    Failure::Quota if lower.contains("per day") || lower.contains("(tpd)") || lower.contains("(rpd)") => format!("Groq's free daily allowance is used up; it refills in {}. Waiting…", human(d)),
                    Failure::Quota => format!("Groq asked me to slow down; continuing in {}s…", d.as_secs().max(1)),
                    Failure::BadKey => "That Groq key was refused; trying the next one…".to_string(),
                    _ if status == 0 => format!("Can't reach Groq ({}); trying again in {}s…", short.chars().take(120).collect::<String>(), d.as_secs().max(1)),
                    _ => format!("Groq had a problem ({status}); trying again in {}s…", d.as_secs().max(1)),
                };
                if !pause(shared, d, &msg, told) {
                    return Outcome::Fail("Stopped.".into());
                }
            }
            None => {
                *groq = Groq::new(cfg.keys.len());
                if failure == Failure::BadKey {
                    shared.ask_for_key();
                    return Outcome::Fail("Groq refused every key. Add a working key from console.groq.com/keys.".into());
                }
                return Outcome::Fail(if status == 0 { format!("Can't reach Groq: {short}. Check the internet connection, or whether a firewall or antivirus is blocking Sahay.") } else { format!("Groq is not answering ({status}): {}", groq_message(&text)) });
            }
        }
    }
}

fn human(d: Duration) -> String {
    let s = d.as_secs();
    if s >= 3600 { format!("{}h {}m", s / 3600, (s % 3600) / 60) } else if s >= 60 { format!("{}m {}s", s / 60, s % 60) } else { format!("{s}s") }
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

fn local_time() -> String {
    let (_, out) = system::run_powershell("Get-Date -Format \"dddd, d MMMM yyyy, h:mm tt\"", Duration::from_secs(10), &|| false);
    out.lines().next().unwrap_or("").trim().to_string()
}

fn with_browser(url: &str, browser: Option<&str>) -> String {
    match browser {
        Some(b) => format!("{b} {url}"),
        None => url.to_string(),
    }
}

fn fetch(host: &str, path: &str) -> Result<String, String> {
    match https::get(host, path, &[("Accept-Language", "en-US,en;q=0.9")], Duration::from_secs(20))? {
        (200, body) => Ok(body),
        (status, _) => Err(format!("{host} answered {status}")),
    }
}

fn powershell(script: &str) -> Result<String, String> {
    let (ok, out) = system::run_powershell(script, Duration::from_secs(20), &|| false);
    if ok { Ok(out.trim().to_string()) } else { Err(out) }
}

fn wiki(topic: &str) -> Result<String, String> {
    let found = fetch("en.wikipedia.org", &format!("/w/rest.php/v1/search/title?q={}&limit=1", intent::encode(topic)))?;
    let v: Value = serde_json::from_str(&found).map_err(|e| e.to_string())?;
    let key = v.pointer("/pages/0/key").and_then(Value::as_str).ok_or("nothing on Wikipedia")?;
    let summary = fetch("en.wikipedia.org", &format!("/api/rest_v1/page/summary/{}", intent::encode(key).replace('+', "_")))?;
    let v: Value = serde_json::from_str(&summary).map_err(|e| e.to_string())?;
    let extract = v.get("extract").and_then(Value::as_str).ok_or("no summary")?;
    let mut out = String::new();
    for sentence in extract.split_inclusive(". ").take(3) {
        out.push_str(sentence);
    }
    Ok(out.trim().to_string())
}

fn instant(shared: &Arc<Shared>, engine: &mut Engine, rx: &Receiver<String>, intent: &Intent) -> Result<String, String> {
    match intent {
        Intent::Answer(a) => Ok(a.clone()),
        Intent::Weather(place) => {
            shared.say("→", &format!("check the weather{}", if place.is_empty() { String::new() } else { format!(" in {place}") }));
            let path = format!("/{}?format=%25l:+%25C,+%25t,+feels+like+%25f,+humidity+%25h,+wind+%25w", intent::encode(place));
            let text = fetch("wttr.in", &path)?;
            let line = text.lines().next().unwrap_or("").trim().to_string();
            if line.is_empty() || line.to_lowercase().contains("unknown location") { Err("no weather".into()) } else { Ok(line) }
        }
        Intent::Wiki(topic) => {
            shared.say("→", &format!("look up \"{topic}\" on Wikipedia"));
            wiki(topic)
        }
        Intent::Timer { secs, note } => {
            let s = shared.clone();
            let (secs, note) = (*secs, note.clone());
            let later = note.clone();
            std::thread::spawn(move || {
                let end = Instant::now() + Duration::from_secs(secs);
                while Instant::now() < end {
                    if s.quit.load(Ordering::Relaxed) {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(500));
                }
                unsafe {
                    let _ = windows::Win32::System::Diagnostics::Debug::MessageBeep(windows::Win32::UI::WindowsAndMessaging::MB_ICONEXCLAMATION);
                }
                s.reply(&if later.is_empty() { "Time's up!".to_string() } else { format!("Reminder: {later}") });
            });
            let mins = secs / 60;
            let when = if secs < 60 { format!("{secs} seconds") } else if secs % 60 == 0 { format!("{mins} minute{}", if mins == 1 { "" } else { "s" }) } else { format!("{mins} min {} s", secs % 60) };
            Ok(if note.is_empty() { format!("Timer set for {when}.") } else { format!("I'll remind you in {when} to {note}.") })
        }
        Intent::Theme(dark) => {
            let v = if *dark { 0 } else { 1 };
            shared.say("→", if *dark { "switch Windows to dark mode" } else { "switch Windows to light mode" });
            powershell(&format!("$p='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'; Set-ItemProperty $p AppsUseLightTheme {v}; Set-ItemProperty $p SystemUsesLightTheme {v}"))?;
            Ok(if *dark { "Dark mode is on.".into() } else { "Light mode is on.".into() })
        }
        Intent::Lock => {
            shared.say("→", "lock the PC");
            std::process::Command::new("rundll32.exe").args(["user32.dll,LockWorkStation"]).spawn().map_err(|e| e.to_string())?;
            Ok("Locked.".into())
        }
        Intent::Battery => {
            let out = powershell("$b = Get-CimInstance Win32_Battery | Select-Object -First 1; if ($b) { \"$($b.EstimatedChargeRemaining) $($b.BatteryStatus)\" } else { 'none' }")?;
            if out.trim() == "none" || out.trim().is_empty() {
                return Ok("This PC runs on mains power; it has no battery.".into());
            }
            let mut parts = out.split_whitespace();
            let pct = parts.next().unwrap_or("?");
            let charging = matches!(parts.next(), Some("2" | "6" | "7" | "8" | "9"));
            Ok(format!("Battery is at {pct}%{}.", if charging { " and charging" } else { "" }))
        }
        Intent::Volume(n) => {
            shared.say("→", &format!("set the volume to {n}%"));
            engine.press_times("volumedown", 50)?;
            if *n >= 2 {
                engine.press_times("volumeup", n / 2)?;
            }
            Ok(format!("Volume set to about {n}%."))
        }
        Intent::Folder(name) => {
            let shell = match *name {
                "Documents" => "shell:Personal",
                "Pictures" => "shell:My Pictures",
                "Music" => "shell:My Music",
                "Videos" => "shell:My Video",
                "Desktop" => "shell:Desktop",
                _ => "shell:Downloads",
            };
            shared.say("→", &format!("open {name}"));
            if system::shell_open(shell, "open") { Ok(format!("Opened {name}.")) } else { Err(format!("could not open {name}")) }
        }
        Intent::Type(text) => {
            shared.say("→", &format!("type \"{}\"", text.chars().take(50).collect::<String>()));
            let stop = || shared.stop.load(Ordering::Relaxed);
            engine.type_here(text, &stop)?;
            Ok("Typed it.".into())
        }
        Intent::Email { to, subject, body } => {
            let url = format!("https://mail.google.com/mail/?view=cm&fs=1&to={}&su={}&body={}", intent::encode(to), intent::encode(subject), intent::encode(body));
            shared.say("→", &format!("open a Gmail draft to {to}"));
            let (ok, msg) = system::open(&url);
            if ok { Ok(format!("Your email to {to} is ready in Gmail. Check it and press Send.")) } else { Err(msg) }
        }
        Intent::WhatsApp { to, text } => {
            let steps: Vec<String> = vec![
                "open https://web.whatsapp.com".into(),
                "wait for \"Search\"".into(),
                "click \"Search\"".into(),
                format!("type {to}"),
                "wait 1.5".into(),
                format!("click \"{to}\""),
                "wait for \"Type a message\"".into(),
                "click \"Type a message\"".into(),
                format!("type {text}"),
                "key enter".into(),
            ];
            match carry_out(shared, engine, rx, &steps) {
                Ran::Done(_) => Ok(format!("Sent \"{text}\" to {to} on WhatsApp.")),
                Ran::Stopped => Ok("Stopped.".into()),
                Ran::Interrupted { .. } => Err("interrupted".into()),
                Ran::Failed { reason, .. } => Err(reason),
            }
        }
        Intent::Time => {
            let now = local_time();
            if now.is_empty() { Err("no clock".into()) } else { Ok(format!("It's {now}.")) }
        }
        Intent::Keys { keys, say } => {
            shared.say("→", &format!("key {keys}"));
            engine.press(keys)?;
            Ok(say.to_string())
        }
        Intent::App(name) => {
            shared.say("→", &format!("open {name}"));
            let (ok, msg) = system::open(name);
            if ok { Ok(format!("{msg}.")) } else { Err(msg) }
        }
        Intent::Open { url, browser, label } => {
            let target = with_browser(url, *browser);
            shared.say("→", &format!("open {target}"));
            let (ok, msg) = system::open(&target);
            if ok { Ok(format!("Opened {label}.")) } else { Err(msg) }
        }
        Intent::Play { query, browser } => {
            shared.say("→", &format!("find \"{query}\" on YouTube"));
            let path = format!("/results?search_query={}", intent::encode(query));
            let id = https::get("www.youtube.com", &path, &[("Accept-Language", "en-US,en;q=0.9")], Duration::from_secs(20)).ok().filter(|(s, _)| *s == 200).and_then(|(_, page)| intent::first_video_id(&page));
            let (url, say) = match id {
                Some(id) => (format!("https://www.youtube.com/watch?v={id}"), format!("Playing \"{query}\" on YouTube.")),
                None => (format!("https://www.youtube.com{path}"), format!("Here are YouTube's results for \"{query}\".")),
            };
            let target = with_browser(&url, *browser);
            shared.say("→", &format!("open {target}"));
            let (ok, msg) = system::open(&target);
            if ok { Ok(say) } else { Err(msg) }
        }
        Intent::Close(name) => {
            let found = system::windows().into_iter().find(|(h, t)| !system::own(windows::Win32::Foundation::HWND(*h as *mut _)) && t.to_lowercase().contains(name.as_str())).ok_or_else(|| format!("no window called {name}"))?;
            let title = found.1.clone();
            shared.say("→", &format!("switch to {title}"));
            system::focus(&title)?;
            std::thread::sleep(Duration::from_millis(250));
            let browser = ["edge", "chrome", "firefox", "brave", "opera"].iter().any(|b| title.to_lowercase().contains(b));
            let keys = if browser { "ctrl+w" } else { "alt+f4" };
            shared.say("→", &format!("key {keys}"));
            engine.press(keys)?;
            Ok(if browser { format!("Closed the {name} tab.") } else { format!("Closed {name}.") })
        }
    }
}

fn step_list(args: &Value) -> Vec<String> {
    match args.get("steps") {
        Some(Value::Array(a)) => a.iter().filter_map(|v| v.as_str().map(String::from).or_else(|| (!v.is_null()).then(|| v.to_string()))).flat_map(|s| s.lines().map(String::from).collect::<Vec<_>>()).filter(|s| !s.trim().is_empty()).collect(),
        Some(Value::String(s)) => s.lines().map(String::from).filter(|s| !s.trim().is_empty()).collect(),
        _ => Vec::new(),
    }
}

enum Ran {
    Done(Vec<String>),
    Failed { done: Vec<String>, failed: String, reason: String },
    Interrupted { done: Vec<String>, message: String },
    Stopped,
}

fn carry_out(shared: &Shared, engine: &mut Engine, rx: &Receiver<String>, steps: &[String]) -> Ran {
    let snapshot = engine.snapshot();
    let mut changed = false;
    let mut done = Vec::new();
    let mut reports = Vec::new();
    for line in steps {
        if shared.stop.load(Ordering::Relaxed) {
            return Ran::Stopped;
        }
        if let Ok(message) = rx.try_recv() {
            return Ran::Interrupted { done, message };
        }
        let step = match plan::parse(line) {
            Ok(s) => s,
            Err(e) => return Ran::Failed { done, failed: line.clone(), reason: e },
        };
        shared.say("→", line.trim());
        shared.set_status(Status::Acting, line.trim());
        let stop = || shared.stop.load(Ordering::Relaxed) || shared.quit.load(Ordering::Relaxed);
        match engine.step(&step, &snapshot, changed, &stop) {
            Ok(result) => {
                system::log(&format!("step {line}: {}", first_line(&result)));
                shared.say("   ", &first_line(&result));
                if step.reports() {
                    reports.push(format!("{line}:\n{}", result.chars().take(6000).collect::<String>()));
                }
                done.push(line.clone());
            }
            Err(e) => {
                system::log(&format!("step {line} failed: {e}"));
                if shared.stop.load(Ordering::Relaxed) {
                    return Ran::Stopped;
                }
                shared.say("   ", &format!("Couldn't: {e}"));
                return Ran::Failed { done, failed: line.clone(), reason: e };
            }
        }
        if plan::changes_screen(&step) {
            changed = true;
        }
    }
    Ran::Done(reports)
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
    let mut groq = Groq::new(cfg.keys.len());
    while let Ok(first) = rx.recv() {
        if shared.quit.load(Ordering::Relaxed) {
            return;
        }
        shared.stop.store(false, Ordering::Relaxed);
        shared.busy.store(true, Ordering::Relaxed);
        let cfg = shared.config();
        messages[0] = json!({ "role": "system", "content": agent::system_prompt(&cfg.name, &cfg.extra) });
        agent::new_task(&mut messages);
        if let Some(intent) = intent::route(&first) {
            shared.set_status(Status::Acting, "On it…");
            match instant(&shared, &mut engine, &rx, &intent) {
                Ok(said) => {
                    system::log(&format!("instant {intent:?}: {said}"));
                    shared.reply(&said);
                    messages.push(json!({ "role": "user", "content": first }));
                    messages.push(json!({ "role": "assistant", "content": said }));
                    engine.cursor.hide();
                    shared.busy.store(false, Ordering::Relaxed);
                    shared.set_status(Status::Idle, "");
                    continue;
                }
                Err(e) => {
                    system::log(&format!("instant {intent:?} failed: {e}; asking Groq"));
                    if matches!(intent, Intent::WhatsApp { .. }) {
                        shared.say("Sahay", "WhatsApp needs a closer look; working it out…");
                    }
                }
            }
        }
        if intent::is_question(&first) {
            messages.push(json!({ "role": "user", "content": format!("{first}\n(No screen attached. Answer directly; if it needs the PC, call do_steps.)") }));
        } else {
            shared.set_status(Status::Acting, "Reading the screen…");
            let seen = engine.look_brief();
            messages.push(json!({ "role": "user", "content": format!("{first}\n{seen}") }));
        }
        shared.set_status(Status::Thinking, "Thinking…");
        let mut told = false;
        let mut calls = 0;
        let mut replans = 0;
        let mut empty = 0;
        loop {
            if shared.stop.load(Ordering::Relaxed) {
                shared.say("Sahay", "Stopped.");
                break;
            }
            if calls >= MAX_CALLS {
                shared.say("Sahay", "This is taking too many tries, so I've paused. Tell me how you'd like to carry on.");
                break;
            }
            calls += 1;
            agent::compact(&mut messages);
            let reply = match ask_groq(&shared, &mut groq, &mut messages, &mut told) {
                Outcome::Reply(r) => r,
                Outcome::Note(n) => {
                    messages.push(json!({ "role": "user", "content": n }));
                    continue;
                }
                Outcome::Fail(e) => {
                    shared.say("Sahay", &e);
                    break;
                }
            };
            if reply.text.is_empty() && reply.calls.is_empty() {
                empty += 1;
                if empty <= 2 {
                    messages.push(json!({ "role": "user", "content": "(Your last answer was empty. Think briefly, then call do_steps or reply.)" }));
                    continue;
                }
                shared.say("Sahay", "I couldn't work out what to do. Tell me again, maybe in other words.");
                break;
            }
            messages.push(reply.message.clone());
            let Some(call) = reply.calls.first() else {
                shared.reply(&reply.text);
                break;
            };
            for extra in reply.calls.iter().skip(1) {
                messages.push(agent::tool_result(extra, "Not done: send one do_steps call with all the steps."));
            }
            let steps = step_list(&call.args);
            if call.name != "do_steps" || steps.is_empty() {
                messages.push(agent::tool_result(call, "Use do_steps with a non-empty list of step strings."));
                continue;
            }
            if !reply.text.is_empty() {
                shared.say("Sahay", &reply.text);
            }
            let say = call.args.get("say").and_then(Value::as_str).unwrap_or("").trim().to_string();
            match carry_out(&shared, &mut engine, &rx, &steps) {
                Ran::Done(reports) if reports.is_empty() => {
                    messages.push(agent::tool_result(call, "All steps done."));
                    let final_words = if say.is_empty() { "Done.".to_string() } else { say };
                    shared.reply(&final_words);
                    messages.push(json!({ "role": "assistant", "content": final_words }));
                    break;
                }
                Ran::Done(reports) => {
                    messages.push(agent::tool_result(call, &format!("All steps done. Results:\n{}\nNow tell the user what you found.", reports.join("\n\n"))));
                }
                Ran::Failed { done, failed, reason } => {
                    replans += 1;
                    if replans > MAX_REPLANS {
                        shared.say("Sahay", &format!("I couldn't finish: {reason}"));
                        messages.push(agent::tool_result(call, &format!("Stopped after repeated failures. Last: {failed}: {reason}")));
                        break;
                    }
                    shared.set_status(Status::Thinking, "Finding another way…");
                    let seen = engine.look();
                    messages.push(agent::tool_result(call, &format!("Done: {}\nFailed: {failed} ({reason}). The rest was not done.\nThe screen now:\n{seen}Send a new plan from here.", if done.is_empty() { "nothing".to_string() } else { done.join(" | ") })));
                }
                Ran::Interrupted { done, message } => {
                    let seen = engine.look();
                    messages.push(agent::tool_result(call, &format!("Paused after: {}. The user wrote: {message}\nThe screen now:\n{seen}", if done.is_empty() { "nothing".to_string() } else { done.join(" | ") })));
                }
                Ran::Stopped => {
                    messages.push(agent::tool_result(call, "The user pressed stop. Do nothing more until they ask."));
                    shared.say("Sahay", "Stopped.");
                    break;
                }
            }
        }
        engine.cursor.hide();
        shared.busy.store(false, Ordering::Relaxed);
        shared.set_status(if shared.stop.load(Ordering::Relaxed) { Status::Stopped } else { Status::Idle }, "");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wikipedia_answers_who_is_questions() {
        let text = wiki("APJ Abdul Kalam").expect("Wikipedia answers");
        assert!(text.contains("Kalam"), "{text}");
    }
}
