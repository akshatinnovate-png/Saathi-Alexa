pub mod brain;
pub mod cursor;
pub mod engine;
pub mod https;
pub mod input;
pub mod ocr;
pub mod orb;
pub mod panel;
pub mod screen;
pub mod system;
pub mod uia;
pub mod ui;

use crate::config::{split_keys, Config};
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
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
    Idle,
    Thinking,
    Acting,
    Waiting,
    Stopped,
    Error,
}

pub struct Shared {
    pub quit: AtomicBool,
    pub stop: AtomicBool,
    pub busy: AtomicBool,
    pub asking_key: AtomicBool,
    pub orb: AtomicIsize,
    pub panel: AtomicIsize,
    pub cursor: AtomicIsize,
    pub asks: Sender<String>,
    state: Mutex<(Status, String)>,
    config: Mutex<Config>,
}

fn post(handle: &AtomicIsize, msg: u32, lparam: isize) -> bool {
    let h = handle.load(Ordering::Relaxed);
    if h == 0 {
        return false;
    }
    unsafe { PostMessageW(HWND(h as *mut _), msg, WPARAM(0), LPARAM(lparam)).is_ok() }
}

impl Shared {
    pub fn status(&self) -> Status {
        self.state.lock().map(|s| s.0).unwrap_or(Status::Error)
    }

    pub fn caption_text(&self) -> String {
        self.state.lock().map(|s| s.1.clone()).unwrap_or_default()
    }

    pub fn set_status(&self, status: Status, caption: &str) {
        if let Ok(mut s) = self.state.lock() {
            s.0 = status;
            s.1 = caption.chars().take(200).collect();
        }
        post(&self.orb, orb::WM_STATUS, 0);
    }

    pub fn say(&self, who: &str, text: &str) {
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        let body = text.replace("\r\n", "\n").replace('\n', "\r\n");
        let line = if who.trim().is_empty() || who == "→" { format!("\r\n{who} {body}") } else { format!("\r\n\r\n{who}: {body}") };
        system::log(&format!("{who} {text}"));
        let ptr = Box::into_raw(Box::new(line));
        if !post(&self.panel, panel::WM_APPEND, ptr as isize) {
            unsafe {
                drop(Box::from_raw(ptr));
            }
        }
    }

    pub fn ask_for_key(&self) {
        if self.orb.load(Ordering::Relaxed) != 0 && !self.asking_key.swap(true, Ordering::Relaxed) && !post(&self.orb, orb::WM_NEED_KEY, 0) {
            self.asking_key.store(false, Ordering::Relaxed);
        }
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
}

fn first_key() -> Option<Vec<String>> {
    let _ = system::shell_open("https://console.groq.com/keys", "open");
    let mut prompt = "Sahay thinks with Groq (free). Groq's key page is opening: sign in, click Create API Key, copy it, and paste it here. Several keys can be separated by commas.";
    loop {
        let text = ui::ask("Welcome to Sahay", prompt, "", false)?;
        let keys = split_keys(&text);
        if !keys.is_empty() {
            return Some(keys);
        }
        prompt = "That doesn't look like a Groq key. A Groq key starts with gsk_ and is about 56 letters and numbers long. Copy it again from console.groq.com/keys and paste it here.";
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
    let first_run = config.keys.is_empty();
    if first_run {
        match first_key() {
            Some(keys) => config.keys = keys,
            None => return,
        }
        let _ = std::fs::write(&path, config.to_json(system::seal));
    }
    system::log("Sahay started");
    let (tx, rx) = channel::<String>();
    let shared = Arc::new(Shared {
        quit: AtomicBool::new(false),
        stop: AtomicBool::new(false),
        busy: AtomicBool::new(false),
        asking_key: AtomicBool::new(false),
        orb: AtomicIsize::new(0),
        panel: AtomicIsize::new(0),
        cursor: AtomicIsize::new(0),
        asks: tx,
        state: Mutex::new((Status::Idle, "Click me to talk".into())),
        config: Mutex::new(config),
    });
    {
        let s = shared.clone();
        std::thread::spawn(move || brain::run(s, rx));
    }
    orb::run(shared.clone(), true);
    shared.quit.store(true, Ordering::Relaxed);
    shared.stop.store(true, Ordering::Relaxed);
    system::log("Sahay closed");
    std::thread::sleep(Duration::from_millis(300));
    std::process::exit(0);
}
