use super::cursor::Cursor;
use super::{input, ocr, screen, system, uia};
use crate::actions::{parse_combo, to_screen, Rect};
use crate::mover::{self, Target};
use crate::plan::{Aim, Step};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

const INTERACTIVE: &[&str] = &["Button", "Edit", "Link", "ListItem", "MenuItem", "CheckBox", "RadioButton", "ComboBox", "TabItem", "TreeItem", "SplitButton", "DataItem", "Slider", "Spinner", "HeaderItem"];
const CAPTION: &[&str] = &["close", "minimize", "minimise", "maximize", "maximise", "restore", "restore down"];
const MAX_CONTROLS: usize = 45;
const MAX_TEXT: usize = 40;

pub struct Snapshot {
    pub targets: Vec<Target>,
    pub screen: Rect,
}

pub struct Engine {
    uia: Option<uia::Reader>,
    ocr: Option<ocr::Reader>,
    saathi: crate::saathi::Saathi,
    pub cursor: Cursor,
    targets: Vec<Target>,
    screen: Rect,
    own: Vec<isize>,
}

fn window_rect(hwnd: HWND) -> Option<Rect> {
    let mut r = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut r).ok()? };
    (r.right - r.left > 40 && r.bottom - r.top > 40).then_some(Rect { left: r.left, top: r.top, right: r.right, bottom: r.bottom })
}

fn sleep_unless(stop: &dyn Fn() -> bool, d: Duration) -> bool {
    let end = Instant::now() + d;
    while Instant::now() < end {
        if stop() {
            return false;
        }
        std::thread::sleep(Duration::from_millis(50).min(end.saturating_duration_since(Instant::now())));
    }
    true
}

impl Engine {
    pub fn new(cursor: Cursor, own: Vec<isize>) -> Self {
        let uia = uia::Reader::new().map_err(|e| system::log(&e)).ok();
        let ocr = ocr::Reader::new().map_err(|e| system::log(&e)).ok();
        let port = std::fs::read_to_string(system::home().join("saathi.env")).map(|t| crate::saathi::port_from_env_file(&t)).unwrap_or(8787);
        Self { uia, ocr, saathi: crate::saathi::Saathi::new(port), cursor, targets: Vec::new(), screen: screen::monitor_of(system::target_window()), own }
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot { targets: self.targets.clone(), screen: self.screen }
    }

    pub fn look(&mut self) -> String {
        let started = Instant::now();
        let target = system::target_window();
        self.screen = screen::monitor_of(target);
        let rect = self.screen;
        let frame = window_rect(target);
        let mut window = system::window_title(target);
        let mut controls: Vec<Target> = Vec::new();
        if let Some(r) = self.uia.as_ref() {
            match r.snapshot_within(target, rect, 120, Duration::from_millis(900)) {
                Err(e) => system::log(&format!("uia: {e}")),
                Ok((title, els)) => {
                    if !title.trim().is_empty() {
                        window = title;
                    }
                    for e in els.into_iter().filter(|e| !e.name.trim().is_empty() || e.kind == "Edit") {
                        let caption_button = e.kind == "Button" && CAPTION.contains(&e.name.trim().to_ascii_lowercase().as_str()) && frame.is_some_and(|f| e.rect.top < f.top + 60);
                        if caption_button {
                            continue;
                        }
                        let label = if e.name.trim().is_empty() { "(text box)".to_string() } else { e.name.split_whitespace().collect::<Vec<_>>().join(" ") };
                        controls.push(Target { id: String::new(), interactive: INTERACTIVE.contains(&e.kind.as_str()), kind: e.kind, label, rect: e.rect });
                    }
                }
            }
        }
        controls.sort_by_key(|t| !t.interactive);
        controls.truncate(MAX_CONTROLS);
        controls.sort_by_key(|t| (t.rect.top / 12, t.rect.left));
        let mut targets: Vec<Target> = controls.into_iter().enumerate().map(|(i, mut t)| {
            t.id = format!("E{}", i + 1);
            t
        }).collect();
        if let (Some(o), Some(pixels)) = (self.ocr.as_ref(), screen::grab(rect)) {
            match o.read(&pixels, rect.width() as u32, rect.height() as u32, (rect.left, rect.top)) {
                Ok(lines) => {
                    let mut n = 0;
                    for line in lines {
                        if n >= MAX_TEXT {
                            break;
                        }
                        if line.text.chars().filter(|c| c.is_alphanumeric()).count() < 2 {
                            continue;
                        }
                        let (cx, cy) = line.rect.center();
                        let in_box = targets.iter().any(|t| (t.kind == "Edit" || t.kind == "ComboBox") && cx >= t.rect.left && cx < t.rect.right && cy >= t.rect.top && cy < t.rect.bottom);
                        let duplicate = in_box || targets.iter().any(|t| t.id.starts_with('E') && mover::overlaps(t.rect, line.rect) && mover::matches(&line.text, std::slice::from_ref(t)).len() == 1);
                        if duplicate {
                            continue;
                        }
                        n += 1;
                        targets.push(Target { id: format!("T{n}"), label: line.text, kind: "Text".into(), rect: line.rect, interactive: false });
                    }
                }
                Err(e) => system::log(&format!("ocr: {e}")),
            }
        }
        system::log(&format!("look: {} targets in {} ms", targets.len(), started.elapsed().as_millis()));
        let s = mover::summary(&window, &targets, rect);
        self.targets = targets;
        s
    }

    pub fn look_brief(&mut self) -> String {
        self.look();
        let window = system::window_title(system::target_window());
        mover::brief(&window, &self.targets, self.screen, 25, 15)
    }

    pub fn press(&mut self, keys: &str) -> Result<(), String> {
        self.press_times(keys, 1)
    }

    pub fn press_times(&mut self, keys: &str, times: u32) -> Result<(), String> {
        system::bring_forward();
        input::combo(&parse_combo(keys)?, times)
    }

    pub fn type_here(&mut self, text: &str, stop: &dyn Fn() -> bool) -> Result<(), String> {
        system::bring_forward();
        if text.chars().count() > 80 {
            system::clipboard_set(text)?;
            input::combo(&parse_combo("ctrl+v")?, 1)
        } else {
            input::type_text(text, stop)
        }
    }

    fn find_words(&mut self, words: &str, patience: Duration, stop: &dyn Fn() -> bool) -> Result<(i32, i32, String), String> {
        let end = Instant::now() + patience;
        let mut scrolls = 0;
        loop {
            self.look();
            if let Some(t) = mover::resolve(words, &self.targets) {
                let (x, y) = t.rect.center();
                return Ok((x, y, format!("\"{}\"", t.label.chars().take(60).collect::<String>())));
            }
            if Instant::now() >= end {
                if scrolls >= 3 {
                    return Err(format!("\"{words}\" is not on the screen, even after scrolling"));
                }
                scrolls += 1;
                if let Some((x, y)) = window_rect(system::target_window()).map(|r| r.center()) {
                    self.cursor.glide_to(x, y, stop);
                    let _ = self.through(&[(x, y)], || input::scroll("down", 6, Some((x, y))));
                    system::log(&format!("\"{words}\" not visible; scrolled down ({scrolls})"));
                }
                if !sleep_unless(stop, Duration::from_millis(700)) {
                    return Err("Stopped".into());
                }
                continue;
            }
            if !sleep_unless(stop, Duration::from_millis(600)) {
                return Err("Stopped".into());
            }
        }
    }

    fn point(&mut self, aim: &Aim, plan: &Snapshot, changed: bool, stop: &dyn Fn() -> bool) -> Result<(i32, i32, String), String> {
        match aim {
            Aim::Point(x, y) => {
                let (px, py) = to_screen(plan.screen, *x, *y);
                Ok((px, py, format!("{x},{y}")))
            }
            Aim::Id(id) => {
                let t = plan.targets.iter().find(|t| t.id.eq_ignore_ascii_case(id)).ok_or_else(|| format!("{id} is not on the screen I sent"))?;
                if changed {
                    let label = t.label.clone();
                    self.find_words(&label, Duration::from_secs(8), stop).map(|(x, y, w)| (x, y, format!("{id} {w}")))
                } else {
                    let (x, y) = t.rect.center();
                    Ok((x, y, format!("{id} \"{}\"", t.label.chars().take(60).collect::<String>())))
                }
            }
            Aim::Words(w) => self.find_words(w, Duration::from_secs(10), stop),
        }
    }

    fn through<T>(&self, points: &[(i32, i32)], act: impl FnOnce() -> T) -> T {
        let mut changed = Vec::new();
        for &(x, y) in points {
            changed.extend(system::let_clicks_through(&self.own, x, y, true));
        }
        let out = act();
        if !changed.is_empty() {
            std::thread::sleep(Duration::from_millis(150));
            system::let_clicks_through(&changed, 0, 0, false);
        }
        out
    }

    pub fn step(&mut self, step: &Step, plan: &Snapshot, changed: bool, stop: &dyn Fn() -> bool) -> Result<String, String> {
        let (result, settle) = match step {
            Step::Open(t) => {
                let (ok, msg) = system::open(t);
                if !ok {
                    return Err(msg);
                }
                (msg, 1800)
            }
            Step::Click { aim, button, double } => {
                let (x, y, what) = self.point(aim, plan, changed, stop)?;
                if !self.cursor.glide_to(x, y, stop) {
                    return Err("Stopped".into());
                }
                self.through(&[(x, y)], || input::click(x, y, button, *double))?;
                self.cursor.ripple(x, y);
                (format!("Clicked {what}"), 600)
            }
            Step::Hover(aim) => {
                let (x, y, what) = self.point(aim, plan, changed, stop)?;
                self.cursor.glide_to(x, y, stop);
                (format!("Over {what}"), 400)
            }
            Step::Type(t) => {
                system::bring_forward();
                if t.chars().count() > 80 {
                    system::clipboard_set(t)?;
                    input::combo(&parse_combo("ctrl+v")?, 1)?;
                } else {
                    input::type_text(t, stop)?;
                }
                (format!("Typed \"{}\"", t.chars().take(40).collect::<String>()), 300)
            }
            Step::Key { keys, times } => {
                system::bring_forward();
                input::combo(&parse_combo(keys)?, *times)?;
                (format!("Pressed {keys}"), 500)
            }
            Step::Scroll { up, sideways, amount, at } => {
                let pos = match at {
                    Some(a) => Some(self.point(a, plan, changed, stop).map(|(x, y, _)| (x, y))?),
                    None => window_rect(system::target_window()).map(|r| r.center()),
                };
                if let Some((x, y)) = pos {
                    self.cursor.glide_to(x, y, stop);
                }
                let dir = match (*up, *sideways) {
                    (true, false) => "up",
                    (false, false) => "down",
                    (true, true) => "left",
                    (false, true) => "right",
                };
                let points: Vec<(i32, i32)> = pos.into_iter().collect();
                self.through(&points, || input::scroll(dir, *amount, pos))?;
                (format!("Scrolled {dir}"), 500)
            }
            Step::Drag(a, b) => {
                let (x1, y1, w1) = self.point(a, plan, changed, stop)?;
                let (x2, y2, w2) = self.point(b, plan, changed, stop)?;
                self.cursor.glide_to(x1, y1, stop);
                self.through(&[(x1, y1), (x2, y2)], || input::drag(x1, y1, x2, y2))?;
                self.cursor.glide_to(x2, y2, stop);
                (format!("Dragged {w1} to {w2}"), 500)
            }
            Step::Wait(secs) => {
                if !sleep_unless(stop, Duration::from_secs_f64(*secs)) {
                    return Err("Stopped".into());
                }
                (format!("Waited {secs}s"), 0)
            }
            Step::WaitFor(words) => {
                let (_, _, what) = self.find_words(words, Duration::from_secs(20), stop)?;
                (format!("{what} is on screen"), 0)
            }
            Step::Focus(title) => (format!("Now in front: {}", system::focus(title)?), 500),
            Step::Run(cmd) => {
                let (ok, out) = system::run_powershell(cmd, Duration::from_secs(120), stop);
                (format!("{}\n{}", if ok { "The command finished." } else { "The command failed or timed out." }, out), 0)
            }
            Step::Clipboard => (format!("Clipboard: {}", system::clipboard_get()?.chars().take(4000).collect::<String>()), 0),
            Step::Saathi { tool, args } => {
                let args = serde_json::from_str::<Value>(args).unwrap_or_else(|_| json!({}));
                (self.saathi.call(tool, args).to_string(), 0)
            }
        };
        if settle > 0 && !sleep_unless(stop, Duration::from_millis(settle)) {
            return Err("Stopped".into());
        }
        Ok(result)
    }
}
