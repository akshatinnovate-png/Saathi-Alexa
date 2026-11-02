pub mod audio;
pub mod https;
pub mod input;
pub mod live;
pub mod operator;
pub mod orb;
pub mod screen;
pub mod system;
pub mod tools;
pub mod uia;
pub mod ui;

use crate::actions::{Element, Rect};
use crate::config::Config;
use crate::protocol::Call;
use base64::Engine;
use std::collections::{HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use windows::core::w;
use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS, HWND, LPARAM, WPARAM};
use windows::Win32::System::Threading::CreateMutexW;
use windows::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows::Win32::UI::WindowsAndMessaging::PostMessageW;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Connecting,
    Listening,
    Speaking,
    Working,
    Waiting,
    Paused,
    Error,
}

pub enum Out {
    Audio(String),
    Frame(String),
    Important(serde_json::Value),
}

pub struct Shared {
    pub paused: AtomicBool,
    pub quit: AtomicBool,
    pub connected: AtomicBool,
    pub reconnect: AtomicBool,
    pub force_frame: AtomicBool,
    pub cancel_gen: AtomicU64,
    pub orb: AtomicIsize,
    pub cancelled: Mutex<HashSet<String>>,
    pub elements: Mutex<Vec<Element>>,
    pub levels: Arc<audio::Levels>,
    pub out: Sender<Out>,
    pub play: Sender<audio::Play>,
    pub calls: Sender<Call>,
    pub operator: Sender<operator::Cmd>,
    pub awaiting: AtomicBool,
    pub asking_key: AtomicBool,
    pub greeting: Mutex<Option<String>>,
    pub heard: Mutex<String>,
    state: Mutex<(Status, String)>,
    frame: Mutex<Rect>,
    config: Mutex<Config>,
    log: Mutex<VecDeque<(String, String)>>,
}

impl Shared {
    pub fn status(&self) -> Status {
        self.state.lock().map(|s| s.0).unwrap_or(Status::Error)
    }

    pub fn caption_text(&self) -> String {
        self.state.lock().map(|s| s.1.clone()).unwrap_or_default()
    }

    fn poke(&self) {
        let h = self.orb.load(Ordering::Relaxed);
        if h != 0 {
            unsafe {
                let _ = PostMessageW(HWND(h as *mut _), orb::WM_STATUS, WPARAM(0), LPARAM(0));
            }
        }
    }

    pub fn ask_for_key(&self) {
        let h = self.orb.load(Ordering::Relaxed);
        if h != 0 && !self.asking_key.swap(true, Ordering::Relaxed) {
            unsafe {
                let _ = PostMessageW(HWND(h as *mut _), orb::WM_NEED_KEY, WPARAM(0), LPARAM(0));
            }
        }
    }

    pub fn set_status(&self, status: Status, caption: &str) {
        if let Ok(mut s) = self.state.lock() {
            let changed = s.0 != status || (!caption.is_empty() && s.1 != caption);
            s.0 = status;
            if !caption.is_empty() {
                s.1 = caption.to_string();
            }
            if !changed {
                return;
            }
        }
        self.poke();
    }

    pub fn caption(&self, text: &str) {
        if let Ok(mut s) = self.state.lock() {
            let mut line = if matches!(s.0, Status::Speaking | Status::Working) && !s.1.is_empty() && !s.1.ends_with('.') && !s.1.ends_with('…') { format!("{}{}", s.1, text) } else { text.trim_start().to_string() };
            if line.chars().count() > 220 {
                line = line.chars().rev().take(200).collect::<Vec<_>>().into_iter().rev().collect();
            }
            s.1 = line;
        }
        self.poke();
    }

    pub fn config(&self) -> Config {
        self.config.lock().map(|c| c.clone()).unwrap_or_default()
    }

    pub fn update_config(&self, f: impl FnOnce(&mut Config)) {
        let snapshot = {
            let Ok(mut c) = self.config.lock() else { return };
            f(&mut c);
            c.clone()
        };
        let _ = std::fs::write(system::home().join("sahay.json"), snapshot.to_json(system::seal));
    }

    pub fn set_frame_rect(&self, rect: Rect) {
        if let Ok(mut r) = self.frame.lock() {
            *r = rect;
        }
    }

    pub fn frame_rect(&self) -> Rect {
        self.frame.lock().map(|r| *r).unwrap_or(Rect { left: 0, top: 0, right: 1920, bottom: 1080 })
    }

    pub fn remember(&self, who: &str, text: &str) {
        if text.trim().is_empty() {
            return;
        }
        if let Ok(mut log) = self.log.lock() {
            match log.back_mut() {
                Some((w, t)) if w == who && who != "Sahay does" => t.push_str(text),
                _ => log.push_back((who.to_string(), text.to_string())),
            }
            while log.len() > 60 {
                log.pop_front();
            }
        }
    }

    pub fn transcript(&self) -> String {
        self.log
            .lock()
            .map(|log| log.iter().map(|(w, t)| format!("{w}: {}", t.trim().chars().take(400).collect::<String>())).collect::<Vec<_>>().join("\n"))
            .unwrap_or_default()
    }
}

fn first_key() -> Option<Vec<String>> {
    let _ = system::shell_open("https://aistudio.google.com/apikey", "open");
    let text = ui::ask(
        "Welcome to Sahay",
        "Sahay needs a free Gemini API key. Google's page is opening: sign in, click Create API key, copy it, and paste it here. You can add more keys later.",
        "",
        false,
    )?;
    let keys: Vec<String> = text.split([',', ' ', '\n', ';']).map(str::trim).filter(|k| k.len() > 10).map(String::from).collect();
    if keys.is_empty() {
        None
    } else {
        Some(keys)
    }
}

pub fn run() {
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let _guard = CreateMutexW(None, true, w!("Local\\SahayOrb"));
        if GetLastError() == ERROR_ALREADY_EXISTS {
            return;
        }
    }
    let path = system::home().join("sahay.json");
    let mut config = std::fs::read_to_string(&path).map(|t| Config::from_json(&t, system::unseal)).unwrap_or_default();
    let had_key = !config.keys.is_empty();
    if config.keys.is_empty() {
        match first_key() {
            Some(keys) => config.keys = keys,
            None => return,
        }
        let _ = std::fs::write(&path, config.to_json(system::seal));
    }
    system::log("Sahay started");

    let (out_tx, out_rx) = channel::<Out>();
    let (play_tx, play_rx) = channel::<audio::Play>();
    let (call_tx, call_rx) = channel::<Call>();
    let (op_tx, op_rx) = channel::<operator::Cmd>();
    let levels = Arc::new(audio::Levels { playing: AtomicBool::new(false), play_level: std::sync::atomic::AtomicU32::new(0) });
    let shared = Arc::new(Shared {
        paused: AtomicBool::new(false),
        quit: AtomicBool::new(false),
        connected: AtomicBool::new(false),
        reconnect: AtomicBool::new(false),
        force_frame: AtomicBool::new(true),
        cancel_gen: AtomicU64::new(0),
        orb: AtomicIsize::new(0),
        cancelled: Mutex::new(HashSet::new()),
        elements: Mutex::new(Vec::new()),
        levels: levels.clone(),
        out: out_tx,
        play: play_tx,
        calls: call_tx,
        operator: op_tx,
        awaiting: AtomicBool::new(false),
        asking_key: AtomicBool::new(false),
        heard: Mutex::new(String::new()),
        state: Mutex::new((Status::Connecting, "Starting…".into())),
        greeting: Mutex::new(had_key.then(|| "Ready. Using your saved Gemini key (right-click the sphere to change it).".to_string())),
        frame: Mutex::new(screen::active_monitor()),
        config: Mutex::new(config),
        log: Mutex::new(VecDeque::new()),
    });
    let running = Arc::new(AtomicBool::new(true));

    {
        let s = shared.clone();
        let r = running.clone();
        std::thread::spawn(move || {
            if let Err(e) = audio::speaker(play_rx, s.levels.clone(), r) {
                system::log(&e);
                s.set_status(Status::Error, &e);
            }
        });
    }
    {
        let s = shared.clone();
        let r = running.clone();
        std::thread::spawn(move || {
            let s2 = s.clone();
            let result = audio::microphone(
                move |samples| {
                    if s2.paused.load(Ordering::Relaxed) || !s2.connected.load(Ordering::Relaxed) {
                        return;
                    }
                    let loud = crate::actions::wav_rms(&samples);
                    if s2.levels.playing.load(Ordering::Relaxed) && loud < 2600.0 {
                        return;
                    }
                    let bytes: Vec<u8> = samples.iter().flat_map(|v| v.to_le_bytes()).collect();
                    let _ = s2.out.send(Out::Audio(base64::engine::general_purpose::STANDARD.encode(bytes)));
                },
                r,
            );
            if let Err(e) = result {
                system::log(&e);
                s.set_status(Status::Error, &e);
                let _ = system::shell_open("ms-settings:privacy-microphone", "open");
            }
        });
    }
    {
        let s = shared.clone();
        let r = running.clone();
        std::thread::spawn(move || {
            let mut last = 0u64;
            let mut last_sent = std::time::Instant::now() - Duration::from_secs(10);
            while r.load(Ordering::Relaxed) {
                let interval = Duration::from_millis(s.config().frame_ms);
                std::thread::sleep(Duration::from_millis(120));
                if s.paused.load(Ordering::Relaxed) || !s.connected.load(Ordering::Relaxed) {
                    continue;
                }
                let forced = s.force_frame.swap(false, Ordering::Relaxed);
                if !forced && last_sent.elapsed() < interval {
                    continue;
                }
                if let Some(frame) = screen::capture(1280, if forced { 70 } else { 55 }) {
                    if forced || frame.fingerprint != last {
                        last = frame.fingerprint;
                        last_sent = std::time::Instant::now();
                        if let Ok(mut rect) = s.frame.lock() {
                            *rect = frame.rect;
                        }
                        let _ = s.out.send(Out::Frame(base64::engine::general_purpose::STANDARD.encode(&frame.jpeg)));
                    }
                }
            }
        });
    }
    {
        let s = shared.clone();
        std::thread::spawn(move || tools::run(s, call_rx));
    }
    {
        let s = shared.clone();
        std::thread::spawn(move || operator::run(s, op_rx));
    }
    {
        let s = shared.clone();
        std::thread::spawn(move || live::run(s, out_rx));
    }

    orb::run(shared.clone());
    shared.quit.store(true, Ordering::Relaxed);
    running.store(false, Ordering::Relaxed);
    system::log("Sahay closed");
    std::thread::sleep(Duration::from_millis(300));
    std::process::exit(0);
}
