use super::cursor::Cursor;
use super::engine::Engine;
use super::{https, media, research, sound, system, Shared, Status};
use crate::agent::{self, Reply};
use crate::intent::{self, Intent};
use crate::plan;
use crate::retry::{classify, estimate_tokens, retry_after_from, Failure, Fleet, Pick};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::sync::mpsc::Receiver;
use std::sync::Arc;
use std::time::{Duration, Instant};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

const ANSWER_BUDGET: usize = 700;
const MAX_CALLS: usize = 14;
const MAX_REPLANS: usize = 5;
const MAX_CHECKS: usize = 4;

enum Outcome {
    Reply(Reply),
    Note(String),
    Fail(String),
}

struct Groq {
    fleet: Fleet,
    keys: Vec<String>,
    primary: String,
}

impl Groq {
    fn new() -> Self {
        Self { fleet: Fleet::new(1, Vec::new()), keys: Vec::new(), primary: String::new() }
    }

    fn refresh(&mut self, keys: &[String], primary: &str) {
        if self.keys == keys && self.primary == primary && !self.fleet.models.is_empty() {
            return;
        }
        let available = keys.first().and_then(|k| {
            let auth = format!("Bearer {k}");
            https::get(agent::HOST, agent::MODELS_PATH, &[("Authorization", &auth)], Duration::from_secs(15)).ok().filter(|(s, _)| *s == 200).and_then(|(_, b)| agent::model_ids(&b))
        });
        let models = agent::fleet(primary, available.as_deref());
        system::log(&format!("groq models: {}", models.iter().map(|(m, _)| m.as_str()).collect::<Vec<_>>().join(", ")));
        self.fleet = Fleet::new(keys.len(), models);
        self.keys = keys.to_vec();
        self.primary = primary.to_string();
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
    let mut network_tries = 0u32;
    loop {
        if shared.stop.load(Ordering::Relaxed) || shared.quit.load(Ordering::Relaxed) {
            return Outcome::Fail("Stopped.".into());
        }
        let cfg = shared.config();
        if cfg.keys.is_empty() {
            shared.ask_for_key();
            return Outcome::Fail("Add a Groq key first: right-click the sphere, then Groq keys.".into());
        }
        groq.refresh(&cfg.keys, &cfg.model);
        let tokens = estimate_tokens(agent::request(messages, agent::MODEL).to_string().len(), ANSWER_BUDGET);
        let (k, m) = match groq.fleet.pick(Instant::now(), tokens) {
            Pick::Go(k, m) => (k, m),
            Pick::Wait(d) => {
                system::log(&format!("every model is busy; waiting {} ms", d.as_millis()));
                let msg = if d > Duration::from_secs(120) { format!("Groq's free allowance is used up for now; it refills in {}. A key from another Groq account would keep me going.", human(d)) } else { format!("All of Groq's free models are busy this minute; continuing in {}s…", d.as_secs().max(1)) };
                if !pause(shared, d, &msg, told) {
                    return Outcome::Fail("Stopped.".into());
                }
                continue;
            }
            Pick::Exhausted => {
                shared.ask_for_key();
                *groq = Groq::new();
                return Outcome::Fail("Groq refused every key. Add a working key from console.groq.com/keys.".into());
            }
        };
        let model = groq.fleet.models[m].0.clone();
        let body = agent::request(messages, &model).to_string();
        groq.fleet.sent(k, m, Instant::now(), tokens);
        system::log(&format!("groq request to {model} (key {}): {} messages, ~{tokens} tokens", k + 1, messages.len()));
        let started = Instant::now();
        let auth = format!("Bearer {}", groq.keys[k]);
        let (status, text) = match https::post_json(agent::HOST, agent::PATH, &[("Authorization", &auth)], &body, Duration::from_secs(120)) {
            Ok(r) => r,
            Err(e) => (0, e),
        };
        if status == 200 {
            system::log(&format!("{model} answered in {} ms", started.elapsed().as_millis()));
            return match agent::parse(&text) {
                Ok(r) => {
                    if let Some(actual) = r.tokens {
                        groq.fleet.used(k, m, actual);
                    }
                    Outcome::Reply(r)
                }
                Err(e) => Outcome::Note(format!("(Your last answer could not be read: {e}. Answer again.)")),
            };
        }
        let short: String = text.chars().take(400).collect();
        system::log(&format!("{model} {status}: {short}"));
        let lower = short.to_ascii_lowercase();
        if status == 413 || lower.contains("request too large") || lower.contains("reduce your message") || lower.contains("context_length") || lower.contains("context length") {
            if lower.contains("tokens per minute") || lower.contains("(tpm)") {
                groq.fleet.limited(k, m, Instant::now(), retry_after_from(&text).or(Some(Duration::from_secs(60))));
                continue;
            }
            if agent::shrink(messages) {
                continue;
            }
            return Outcome::Fail(format!("The request is too big for Groq: {}", groq_message(&text)));
        }
        let failure = if status == 0 { Failure::Network } else { classify(status, &text) };
        match failure {
            Failure::Quota => {
                groq.fleet.limited(k, m, Instant::now(), retry_after_from(&text));
                continue;
            }
            Failure::BadModel => {
                groq.fleet.drop_model(m);
                continue;
            }
            Failure::BadKey => {
                groq.fleet.drop_key(k);
                if !groq.fleet.keys_left() {
                    shared.ask_for_key();
                    *groq = Groq::new();
                    return Outcome::Fail("Groq refused the key. Add a working key from console.groq.com/keys.".into());
                }
                continue;
            }
            Failure::Network => {}
        }
        if status == 400 && (lower.contains("tool") || lower.contains("function")) {
            if model != agent::MODEL {
                system::log(&format!("{model} can't follow plans; not using it again"));
                groq.fleet.drop_model(m);
                continue;
            }
            return Outcome::Note(format!("(Your last tool call was rejected: {short}. Use do_steps with a list of step strings.)"));
        }
        if (400..500).contains(&status) && !matches!(status, 408 | 409) {
            groq.fleet.rest(k, m, Instant::now(), Duration::from_secs(300));
            system::log(&format!("{model} refused this request; trying another model"));
            continue;
        }
        network_tries += 1;
        if status != 0 {
            groq.fleet.rest(k, m, Instant::now(), Duration::from_secs(10));
            if network_tries < 6 {
                continue;
            }
        }
        if network_tries >= 8 {
            return Outcome::Fail(if status == 0 { format!("Can't reach Groq: {short}. Check the internet connection, or whether a firewall or antivirus is blocking Sahay.") } else { format!("Groq is not answering ({status}): {}", groq_message(&text)) });
        }
        let d = Duration::from_secs(u64::from(network_tries.min(5)) * 2);
        if !pause(shared, d, &format!("Can't reach Groq ({}); trying again…", short.chars().take(100).collect::<String>()), told) {
            return Outcome::Fail("Stopped.".into());
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
        Intent::Remember(fact) => {
            shared.update_config(|c| crate::config::remember(&mut c.memory, fact));
            Ok("Got it, I'll remember that.".into())
        }
        Intent::Recall => {
            let memory = shared.config().memory;
            Ok(if memory.is_empty() { "I haven't been asked to remember anything yet.".into() } else { format!("I remember: {}.", memory.join("; ")) })
        }
        Intent::Forget => {
            shared.update_config(|c| c.memory.clear());
            Ok("Done, I've forgotten everything you told me to remember.".into())
        }
        Intent::ReadScreen(_) | Intent::Selection(_) => Err("needs Groq".into()),
        Intent::Routine { hour, minute, task, daily } => {
            let (day, h, m) = system::now();
            let passed = (h, m) > (*hour, *minute);
            let r = crate::config::Routine { hour: *hour, minute: *minute, task: task.clone(), daily: *daily, last: if passed { day } else { 0 } };
            let said = r.describe();
            shared.update_config(|c| {
                c.routines.push(r);
                while c.routines.len() > 40 {
                    c.routines.remove(0);
                }
            });
            Ok(format!("Done: {said}{}.", if passed && !*daily { " (tomorrow, since that time has passed today)" } else { "" }))
        }
        Intent::Routines => {
            let list = shared.config().routines;
            Ok(if list.is_empty() { "You have no routines yet. Try: every day at 9 am play bhajans.".into() } else { list.iter().enumerate().map(|(i, r)| format!("{}. {}", i + 1, r.describe())).collect::<Vec<_>>().join("\n") })
        }
        Intent::ClearRoutines => {
            shared.update_config(|c| c.routines.clear());
            Ok("All routines are cleared.".into())
        }
        Intent::News => {
            shared.say("→", "read today's headlines");
            let rss = fetch("news.google.com", "/rss?hl=en-IN&gl=IN&ceid=IN:en")?;
            let titles: Vec<String> = rss
                .split("<title>")
                .skip(2)
                .filter_map(|p| p.split("</title>").next())
                .map(|t| t.replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", "\"").replace("<![CDATA[", "").replace("]]>", ""))
                .map(|t| t.rsplit_once(" - ").map(|(h, _)| h.to_string()).unwrap_or(t))
                .take(5)
                .collect();
            if titles.is_empty() { Err("no headlines".into()) } else { Ok(format!("Top news: {}.", titles.join(". "))) }
        }
        Intent::Convert { amount, from, to } => {
            shared.say("→", &format!("convert {amount} {from} to {to}"));
            let body = fetch("open.er-api.com", &format!("/v6/latest/{from}"))?;
            let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
            let rate = v.pointer(&format!("/rates/{to}")).and_then(Value::as_f64).ok_or("no rate")?;
            let result = amount * rate;
            Ok(format!("{amount} {from} is about {:.2} {to}.", result))
        }
        Intent::FindFile(name) => {
            shared.say("→", &format!("search your folders for \"{name}\""));
            let words: Vec<String> = name.split_whitespace().filter(|w| !["pdf", "photo", "picture", "excel", "spreadsheet", "word", "presentation", "ppt"].contains(w)).map(|w| w.replace('\'', "")).collect();
            let ext = if name.contains("pdf") { "*.pdf" } else if name.contains("photo") || name.contains("picture") { "*.jpg" } else if name.contains("excel") || name.contains("spreadsheet") { "*.xls*" } else if name.contains("word") { "*.doc*" } else if name.contains("ppt") || name.contains("presentation") { "*.ppt*" } else { "*" };
            let filter = words.iter().map(|w| format!("$_.Name -like '*{w}*'")).collect::<Vec<_>>().join(" -and ");
            let filter = if filter.is_empty() { "$true".to_string() } else { filter };
            let script = format!("$roots = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('MyDocuments'), (Join-Path $env:USERPROFILE 'Downloads'), [Environment]::GetFolderPath('MyPictures'), (Join-Path $env:USERPROFILE 'OneDrive')) | Where-Object {{ $_ -and (Test-Path $_) }}; $f = Get-ChildItem -Path $roots -Recurse -File -Filter '{ext}' -ErrorAction SilentlyContinue -Depth 6 | Where-Object {{ {filter} }} | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if ($f) {{ Start-Process $f.FullName; $f.FullName }} else {{ 'NONE' }}");
            let (ok, out) = system::run_powershell(&script, Duration::from_secs(45), &|| shared.stop.load(Ordering::Relaxed));
            let path = out.lines().last().unwrap_or("").trim().to_string();
            if !ok || path.is_empty() || path == "NONE" { Err(format!("no file matching {name}")) } else { Ok(format!("Opened {}.", path.rsplit('\\').next().unwrap_or(&path))) }
        }
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
            if sound::set(*n).is_err() {
                engine.press_times("volumedown", 50)?;
                if *n >= 2 {
                    engine.press_times("volumeup", n / 2)?;
                }
            }
            Ok(format!("Volume is at {n}%."))
        }
        Intent::Teach(lesson) => {
            shared.update_config(|c| crate::config::add_lesson(&mut c.lessons, lesson));
            Ok("Got it. I'll do it that way from now on.".into())
        }
        Intent::CloseAll => {
            let list = system::user_windows();
            if list.is_empty() {
                return Ok("Nothing is open.".into());
            }
            let mut closed = 0;
            for (_, title) in &list {
                if shared.stop.load(Ordering::Relaxed) {
                    break;
                }
                if system::focus(title).is_ok() {
                    std::thread::sleep(Duration::from_millis(250));
                    if !system::protected(&system::window_title(system::target_window())) {
                        shared.say("→", &format!("close {}", title.chars().take(50).collect::<String>()));
                        engine.press("alt+f4")?;
                        closed += 1;
                        std::thread::sleep(Duration::from_millis(400));
                    }
                }
            }
            Ok(format!("Closed {closed} window{}.", if closed == 1 { "" } else { "s" }))
        }
        Intent::FullScreen(on) => {
            let title = system::window_title(system::target_window());
            let youtube = title.to_lowercase().contains("youtube");
            let keys = match (youtube, *on) {
                (true, true) => "f",
                (true, false) => "escape",
                (false, true) => "f11",
                (false, false) => "escape",
            };
            if youtube && *on {
                let stop = || shared.stop.load(Ordering::Relaxed);
                engine.focus_page(&stop);
            }
            shared.say("→", &format!("key {keys}"));
            engine.press(keys)?;
            Ok(if *on { "Full screen.".into() } else { "Back to normal size.".into() })
        }
        Intent::Images(topic) => {
            let topic = match topic {
                Some(t) => t.clone(),
                None => {
                    let title = system::window_title(system::target_window());
                    let main = title.split([' ']).collect::<Vec<_>>().join(" ");
                    let main = main.split(" - ").next().unwrap_or("").split(" | ").next().unwrap_or("").trim().to_string();
                    if main.is_empty() || ["new tab", "google", "youtube", "home", "start"].contains(&main.to_lowercase().as_str()) {
                        return Err("no topic".into());
                    }
                    main.trim_end_matches(" Google Search").trim().to_string()
                }
            };
            let url = format!("https://www.google.com/search?tbm=isch&q={}", intent::encode(&topic));
            shared.say("→", &format!("open Google Images for \"{topic}\""));
            let (ok, msg) = system::open(&url);
            if ok { Ok(format!("Here are pictures of {topic}.")) } else { Err(msg) }
        }
        Intent::CloseTabs(topic) => {
            shared.say("→", &format!("close the tabs about {topic}"));
            let stop = || shared.stop.load(Ordering::Relaxed);
            let n = engine.close_tabs(topic, &stop)?;
            Ok(format!("Closed {n} tab{} about {topic}.", if n == 1 { "" } else { "s" }))
        }
        Intent::Media(what) => {
            shared.say("→", &format!("media {what}"));
            match *what {
                "play" => media::play(),
                "pause" => media::pause(),
                "next" => media::next(),
                _ => media::previous(),
            }
        }
        Intent::Install(app) => {
            shared.say("→", &format!("install {app} with winget"));
            shared.set_status(Status::Acting, &format!("Installing {app}…"));
            let name = app.replace(['"', '\'', '`', ';', '&', '|'], "");
            let (ok, out) = system::run_powershell(&format!("winget install \"{name}\" --accept-source-agreements --accept-package-agreements --disable-interactivity 2>&1 | Select-Object -Last 4"), Duration::from_secs(900), &|| shared.stop.load(Ordering::Relaxed));
            let tail = out.lines().rfind(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string();
            let lower = out.to_lowercase();
            if ok && (lower.contains("successfully installed") || lower.contains("already installed") || lower.contains("found an existing package")) {
                Ok(format!("{app} is installed."))
            } else {
                Err(format!("winget: {tail}"))
            }
        }
        Intent::Mute(on) => {
            sound::mute(*on)?;
            Ok(if *on { "Muted.".into() } else { "Sound is on.".into() })
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
            if ok {
                return Ok(format!("{msg}."));
            }
            shared.say("→", &format!("look up \"{name}\" on the web"));
            let found = research::search(name).ok().and_then(|r| r.lines().nth(1).and_then(|l| l.split(" | ").nth(1)).map(|u| u.trim().to_string())).filter(|u| u.starts_with("http"));
            match found {
                Some(url) => {
                    shared.say("→", &format!("open {url}"));
                    let (ok, msg) = system::open(&url);
                    if ok { Ok(format!("Opened {url}.")) } else { Err(msg) }
                }
                None => Err(msg),
            }
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
            if !ok {
                return Err(msg);
            }
            let mut extra = Vec::new();
            match sound::make_audible(30, 100) {
                Ok(Some(note)) => {
                    shared.say("→", "turn the sound up");
                    extra.push(note);
                }
                Ok(None) => {}
                Err(e) => system::log(&format!("sound: {e}")),
            }
            if url.contains("/watch?") {
                std::thread::sleep(Duration::from_millis(2500));
                shared.say("→", "watch for ads and make sure it plays");
                shared.set_status(Status::Acting, "Skipping ads…");
                let stop = || shared.stop.load(Ordering::Relaxed) || shared.quit.load(Ordering::Relaxed);
                let notes = engine.watch_video(Duration::from_secs(45), &stop);
                if !notes.is_empty() {
                    extra.push(format!("I {}.", notes.join(" and ")));
                }
            }
            Ok(if extra.is_empty() { say } else { format!("{say} {}", extra.join(" ")) })
        }
        Intent::Close(name) if engine.close_tabs(name, &|| shared.stop.load(Ordering::Relaxed)).is_ok() => Ok(format!("Closed the {name} tab.")),
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
        if let plan::Step::Remember(fact) = &step {
            shared.update_config(|c| crate::config::remember(&mut c.memory, fact));
            shared.say("→", &format!("remember {fact}"));
            done.push(line.clone());
            continue;
        }
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
    let mut groq = Groq::new();
    while let Ok(first) = rx.recv() {
        if shared.quit.load(Ordering::Relaxed) {
            return;
        }
        shared.stop.store(false, Ordering::Relaxed);
        shared.busy.store(true, Ordering::Relaxed);
        let cfg = shared.config();
        messages[0] = json!({ "role": "system", "content": agent::with_memory(agent::system_prompt(&cfg.name, &cfg.extra), &cfg.memory) });
        engine.keys = cfg.keys.clone();
        agent::new_task(&mut messages);
        let chain = intent::route_all(&first);
        let routed = chain.as_ref().and_then(|c| (c.len() == 1).then(|| c[0].clone()));
        let mut prepared: Option<String> = None;
        if let Some(parts) = chain.as_ref().filter(|c| c.len() > 1) {
            shared.set_status(Status::Acting, "On it…");
            let mut said = Vec::new();
            let mut failed = None;
            for (i, part) in parts.iter().enumerate() {
                if shared.stop.load(Ordering::Relaxed) {
                    break;
                }
                match instant(&shared, &mut engine, &rx, part) {
                    Ok(s) => said.push(s),
                    Err(e) => {
                        failed = Some((i, e));
                        break;
                    }
                }
                if matches!(part, Intent::App(_) | Intent::Open { .. } | Intent::Play { .. } | Intent::Folder(_) | Intent::FindFile(_)) {
                    std::thread::sleep(Duration::from_millis(1800));
                }
            }
            match failed {
                None => {
                    let all = said.join(" ");
                    shared.reply(&all);
                    messages.push(json!({ "role": "user", "content": first }));
                    messages.push(json!({ "role": "assistant", "content": all }));
                    engine.cursor.hide();
                    shared.busy.store(false, Ordering::Relaxed);
                    shared.set_status(Status::Idle, "");
                    continue;
                }
                Some((i, e)) => {
                    system::log(&format!("chain step {i} failed: {e}; asking Groq"));
                    prepared = Some(format!("{first}\n(Already done: {}. The next part could not be done directly: {e}. Finish the rest.)\n{}", if said.is_empty() { "nothing".to_string() } else { said.join(" ") }, engine.look_brief()));
                }
            }
        }
        match &routed {
            Some(Intent::ReadScreen(_)) => {
                shared.set_status(Status::Acting, "Reading the screen…");
                let seen = engine.look_full();
                prepared = Some(format!("{first}\n(Here is everything readable on the screen. Answer from it in plain sentences without a tool.)\n{seen}"));
            }
            Some(Intent::Selection(_)) => {
                shared.set_status(Status::Acting, "Reading what you selected…");
                let _ = engine.press("ctrl+c");
                std::thread::sleep(Duration::from_millis(350));
                let picked = system::clipboard_get().unwrap_or_default();
                prepared = Some(if picked.trim().is_empty() {
                    let seen = engine.look_full();
                    format!("{first}\n(Nothing was selected, so here is the screen text. Answer from it without a tool.)\n{seen}")
                } else {
                    format!("{first}\n(The selected text, to work on without a tool:)\n{}", picked.chars().take(6000).collect::<String>())
                });
            }
            _ => {}
        }
        if let Some(intent) = routed.filter(|_| prepared.is_none()) {
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
        let task = plan::task_key(&first);
        if prepared.is_none() && chain.is_none() {
            let learned = shared.config().skills.iter().find(|(t, _)| *t == task).map(|(_, s)| s.clone());
            if let Some(steps) = learned {
                shared.say("Sahay", "I've done this before; doing it the same way…");
                match carry_out(&shared, &mut engine, &rx, &steps) {
                    Ran::Done(_) => {
                        let said = "Done.".to_string();
                        shared.reply(&said);
                        messages.push(json!({ "role": "user", "content": first }));
                        messages.push(json!({ "role": "assistant", "content": said }));
                        engine.cursor.hide();
                        shared.busy.store(false, Ordering::Relaxed);
                        shared.set_status(Status::Idle, "");
                        continue;
                    }
                    Ran::Stopped => {
                        engine.cursor.hide();
                        shared.busy.store(false, Ordering::Relaxed);
                        shared.set_status(Status::Stopped, "");
                        continue;
                    }
                    other => {
                        let why = match other {
                            Ran::Failed { reason, .. } => reason,
                            _ => "interrupted".into(),
                        };
                        system::log(&format!("learned skill for \"{task}\" failed ({why}); forgetting it and asking Groq"));
                        shared.update_config(|c| c.skills.retain(|(t, _)| *t != task));
                    }
                }
            }
        }
        if let Some(content) = prepared {
            messages.push(json!({ "role": "user", "content": content }));
        } else if intent::is_question(&first) {
            messages.push(json!({ "role": "user", "content": format!("{first}\n(No screen attached. Answer directly; if it needs the PC, call do_steps.)") }));
        } else {
            shared.set_status(Status::Acting, "Reading the screen…");
            let seen = engine.look_brief();
            let notes = crate::guides::notes(&first, &cfg.lessons);
            messages.push(json!({ "role": "user", "content": format!("{first}{notes}\n{seen}") }));
        }
        shared.set_status(Status::Thinking, "Thinking…");
        let mut told = false;
        let mut calls = 0;
        let mut replans = 0;
        let mut empty = 0;
        let mut checks = 0;
        let mut executed: Vec<String> = Vec::new();
        let mut reported = false;
        let learn = |shared: &Shared, executed: &[String], replans: usize, reported: bool| {
            if replans == 0 && !reported && !executed.is_empty() && !plan::uses_numbers(executed) && !task.is_empty() {
                system::log(&format!("learned how to \"{task}\" ({} steps)", executed.len()));
                shared.update_config(|c| crate::config::learn(&mut c.skills, &task, executed));
            }
        };
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
                if checks > 0 {
                    learn(&shared, &executed, replans, reported);
                }
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
            if let Some(lesson) = call.args.get("lesson").and_then(Value::as_str).filter(|l| !l.trim().is_empty()) {
                system::log(&format!("lesson learned: {lesson}"));
                shared.update_config(|c| crate::config::add_lesson(&mut c.lessons, lesson));
            }
            let proven = steps.last().is_some_and(|l| matches!(plan::parse(l), Ok(plan::Step::Expect(_))));
            let outcome = carry_out(&shared, &mut engine, &rx, &steps);
            match &outcome {
                Ran::Done(reports) => {
                    executed.extend(steps.iter().cloned());
                    reported |= !reports.is_empty();
                }
                Ran::Failed { done, .. } | Ran::Interrupted { done, .. } => executed.extend(done.iter().cloned()),
                Ran::Stopped => {}
            }
            match outcome {
                Ran::Done(reports) if reports.is_empty() && proven => {
                    messages.push(agent::tool_result(call, "All steps done and confirmed."));
                    let final_words = if say.is_empty() { "Done.".to_string() } else { say };
                    learn(&shared, &executed, replans, reported);
                    shared.reply(&final_words);
                    messages.push(json!({ "role": "assistant", "content": final_words }));
                    break;
                }
                Ran::Done(reports) if reports.is_empty() && checks < MAX_CHECKS => {
                    checks += 1;
                    shared.set_status(Status::Thinking, "Checking it worked…");
                    std::thread::sleep(Duration::from_millis(600));
                    let seen = engine.look_brief();
                    messages.push(agent::tool_result(call, &format!("All steps ran. The screen now:\n{seen}Check it against the task. If the task is finished, reply to the user in one or two short sentences without a tool. If not, send only the remaining steps with do_steps.")));
                }
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
                    let seen = engine.look_brief();
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
