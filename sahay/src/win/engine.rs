use super::cursor::Cursor;
use super::{input, ocr, screen, system, uia};
use crate::actions::{parse_combo, Rect};
use crate::agent::Call;
use crate::mover::{self, Resolved, Target};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

const INTERACTIVE: &[&str] = &["Button", "Edit", "Link", "ListItem", "MenuItem", "CheckBox", "RadioButton", "ComboBox", "TabItem", "TreeItem", "SplitButton", "DataItem", "Slider", "Spinner", "HeaderItem"];

pub struct Engine {
    uia: Option<uia::Reader>,
    ocr: Option<ocr::Reader>,
    saathi: crate::saathi::Saathi,
    pub cursor: Cursor,
    targets: Vec<Target>,
    screen: Rect,
    own: Vec<isize>,
}

fn is_id(q: &str) -> bool {
    let q = q.trim().trim_start_matches('#');
    let mut c = q.chars();
    matches!(c.next(), Some('E' | 'e' | 'T' | 't')) && !q[1..].is_empty() && q[1..].chars().all(|d| d.is_ascii_digit())
}

fn window_center(hwnd: HWND) -> Option<(i32, i32)> {
    let mut r = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut r).ok()? };
    (r.right - r.left > 40 && r.bottom - r.top > 40).then(|| ((r.left + r.right) / 2, (r.top + r.bottom) / 2))
}

fn text(args: &Value, key: &str) -> String {
    args.get(key).map(|v| v.as_str().map(String::from).unwrap_or_else(|| v.to_string())).unwrap_or_default()
}

fn num(args: &Value, key: &str, default: f64) -> f64 {
    args.get(key).and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))).unwrap_or(default)
}

impl Engine {
    pub fn new(cursor: Cursor, own: Vec<isize>) -> Self {
        let uia = uia::Reader::new().map_err(|e| system::log(&e)).ok();
        let ocr = ocr::Reader::new().map_err(|e| system::log(&e)).ok();
        let port = std::fs::read_to_string(system::home().join("saathi.env")).map(|t| crate::saathi::port_from_env_file(&t)).unwrap_or(8787);
        Self { uia, ocr, saathi: crate::saathi::Saathi::new(port), cursor, targets: Vec::new(), screen: screen::monitor_of(system::target_window()), own }
    }

    pub fn look(&mut self) -> String {
        let started = Instant::now();
        let target = system::target_window();
        self.screen = screen::monitor_of(target);
        let rect = self.screen;
        let mut targets: Vec<Target> = Vec::new();
        let mut window = system::window_title(target);
        if let Some(r) = self.uia.as_ref() {
            match r.snapshot_within(target, rect, 80, Duration::from_millis(900)) {
                Err(e) => system::log(&format!("uia: {e}")),
                Ok((title, els)) => {
                window = title;
                for e in els.into_iter().filter(|e| !e.name.trim().is_empty() || e.kind == "Edit") {
                    let label = if e.name.trim().is_empty() { "(text box)".to_string() } else { e.name.split_whitespace().collect::<Vec<_>>().join(" ") };
                    targets.push(Target { id: format!("E{}", targets.len() + 1), interactive: INTERACTIVE.contains(&e.kind.as_str()), kind: e.kind, label, rect: e.rect });
                }
                }
            }
        }
        if let (Some(o), Some(pixels)) = (self.ocr.as_ref(), screen::grab(rect)) {
            match o.read(&pixels, rect.width() as u32, rect.height() as u32, (rect.left, rect.top)) {
                Ok(lines) => {
                    let mut n = 0;
                    for line in lines {
                        if n >= 60 {
                            break;
                        }
                        let duplicate = targets.iter().any(|t| t.id.starts_with('E') && mover::overlaps(t.rect, line.rect) && mover::matches(&line.text, std::slice::from_ref(t)).len() == 1);
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

    fn locate(&mut self, query: &str) -> Result<(i32, i32, String), String> {
        let q = query.trim();
        if q.is_empty() {
            return Err("No target given".into());
        }
        if self.targets.is_empty() {
            self.look();
        }
        let found = |targets: &[Target], screen: Rect| match mover::resolve(q, targets, screen) {
            Some(Resolved::Target(t)) => {
                let (x, y) = t.rect.center();
                Some((x, y, format!("{} {} \"{}\"", t.id, t.kind, t.label.chars().take(60).collect::<String>())))
            }
            Some(Resolved::Point(x, y)) => Some((x, y, format!("point {q}"))),
            None => None,
        };
        if let Some(hit) = found(&self.targets, self.screen) {
            return Ok(hit);
        }
        if is_id(q) {
            return Err(format!("{q} is not in the latest screen description. Use a number from the newest list."));
        }
        let fresh = self.look();
        if let Some(hit) = found(&self.targets, self.screen) {
            return Ok(hit);
        }
        Err(format!("\"{q}\" is not on the screen. Use an E or T number from this new list, other words that are shown, or scroll.\n{fresh}"))
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

    pub fn run(&mut self, call: &Call, stop: &dyn Fn() -> bool) -> String {
        let a = &call.args;
        let outcome: Result<(String, u64), String> = (|| match call.name.as_str() {
            "look" => Ok((String::new(), 0)),
            "click" => {
                let (x, y, what) = self.locate(&text(a, "target"))?;
                if !self.cursor.glide_to(x, y, stop) {
                    return Err("Stopped".into());
                }
                let button = text(a, "button");
                let double = a.get("double").and_then(Value::as_bool).unwrap_or(false);
                self.through(&[(x, y)], || input::click(x, y, if button.is_empty() { "left" } else { &button }, double))?;
                self.cursor.ripple(x, y);
                Ok((format!("Clicked {what}"), 700))
            }
            "hover" => {
                let (x, y, what) = self.locate(&text(a, "target"))?;
                self.cursor.glide_to(x, y, stop);
                Ok((format!("The cursor is over {what}"), 500))
            }
            "type" => {
                system::bring_forward();
                let mut t = text(a, "text");
                if a.get("enter").and_then(Value::as_bool) == Some(true) {
                    t.push('\n');
                }
                if t.chars().count() > 80 {
                    let body = t.trim_end_matches('\n');
                    system::clipboard_set(body)?;
                    input::combo(&parse_combo("ctrl+v")?, 1)?;
                    if t.ends_with('\n') {
                        std::thread::sleep(Duration::from_millis(150));
                        input::combo(&parse_combo("enter")?, 1)?;
                    }
                } else {
                    input::type_text(&t, stop)?;
                }
                Ok((format!("Typed {} characters", t.trim_end().chars().count()), 600))
            }
            "key" => {
                system::bring_forward();
                let keys = text(a, "keys");
                let vks = parse_combo(&keys)?;
                input::combo(&vks, num(a, "times", 1.0).clamp(1.0, 50.0) as u32)?;
                Ok((format!("Pressed {keys}"), 500))
            }
            "scroll" => {
                let target = text(a, "target");
                let at = if target.trim().is_empty() { window_center(system::target_window()) } else { Some(self.locate(&target).map(|(x, y, _)| (x, y))?) };
                if let Some((x, y)) = at {
                    self.cursor.glide_to(x, y, stop);
                }
                let points: Vec<(i32, i32)> = at.into_iter().collect();
                self.through(&points, || input::scroll(&text(a, "direction"), num(a, "amount", 5.0) as i32, at))?;
                Ok((format!("Scrolled {}", text(a, "direction")), 600))
            }
            "drag" => {
                let (x1, y1, w1) = self.locate(&text(a, "from"))?;
                let (x2, y2, w2) = self.locate(&text(a, "to"))?;
                self.cursor.glide_to(x1, y1, stop);
                self.through(&[(x1, y1), (x2, y2)], || input::drag(x1, y1, x2, y2))?;
                self.cursor.glide_to(x2, y2, stop);
                Ok((format!("Dragged {w1} to {w2}"), 600))
            }
            "open" => {
                let (ok, msg) = system::open(&text(a, "target"));
                if ok { Ok((msg, 2200)) } else { Err(msg) }
            }
            "focus" => Ok((format!("Now in front: {}", system::focus(&text(a, "title"))?), 600)),
            "clipboard" => Ok((format!("Clipboard: {}", system::clipboard_get()?.chars().take(4000).collect::<String>()), 0)),
            "find" => {
                if self.targets.is_empty() {
                    self.look();
                }
                let found = mover::matches(&text(a, "text"), &self.targets);
                if found.is_empty() {
                    Err(format!("\"{}\" is not on the screen", text(a, "text")))
                } else {
                    Ok((found.iter().map(|t| format!("{} \"{}\"", t.id, t.label)).collect::<Vec<_>>().join("\n"), 0))
                }
            }
            "wait" => {
                let end = Instant::now() + Duration::from_secs_f64(num(a, "seconds", 2.0).clamp(0.2, 30.0));
                while Instant::now() < end && !stop() {
                    std::thread::sleep(Duration::from_millis(100));
                }
                Ok(("Waited".into(), 0))
            }
            "run" => {
                let (ok, out) = system::run_powershell(&text(a, "command"), Duration::from_secs_f64(num(a, "timeout_seconds", 60.0).clamp(1.0, 1800.0)), stop);
                Ok((format!("{}\n{}", if ok { "The command finished." } else { "The command failed or timed out." }, out), 0))
            }
            "saathi" => {
                let args = a.get("arguments_json").and_then(Value::as_str).and_then(|s| serde_json::from_str::<Value>(s).ok()).unwrap_or_else(|| json!({}));
                Ok((self.saathi.call(&text(a, "tool"), args).to_string(), 0))
            }
            other => Err(format!("There is no tool called {other}")),
        })();
        match outcome {
            Ok((result, settle)) => {
                let fresh = matches!(call.name.as_str(), "look" | "click" | "hover" | "type" | "key" | "scroll" | "drag" | "open" | "focus" | "wait");
                if !fresh {
                    return result;
                }
                if settle > 0 {
                    std::thread::sleep(Duration::from_millis(settle));
                }
                let seen = self.look();
                if result.is_empty() { seen } else { format!("{result}\n{seen}") }
            }
            Err(e) => format!("FAILED: {e}"),
        }
    }
}
