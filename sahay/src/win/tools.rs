use super::{input, system, uia::Reader, Out, Shared, Status};
use crate::actions::{describe_elements, parse_combo, to_screen};
use crate::protocol::{self, Call};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::sync::mpsc::Receiver;
use std::sync::Arc;
use std::time::Duration;


fn num(args: &Value, key: &str) -> Option<f64> {
    args.get(key).and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok())))
}

fn text<'a>(args: &'a Value, key: &str) -> &'a str {
    args.get(key).and_then(Value::as_str).unwrap_or("")
}

pub fn run(shared: Arc<Shared>, calls: Receiver<Call>) {
    let port = std::fs::read_to_string(system::home().join("saathi.env")).map(|t| crate::saathi::port_from_env_file(&t)).unwrap_or(8787);
    let mut saathi = crate::saathi::Saathi::new(port);
    while let Ok(call) = calls.recv() {
        if shared.quit.load(Ordering::Relaxed) {
            return;
        }
        let text_arg = |k: &str| call.args.get(k).and_then(Value::as_str).unwrap_or("").trim().to_string();
        let response = match call.name.as_str() {
            "do_task" => {
                let goal = text_arg("goal");
                if goal.is_empty() {
                    fail("Say what the task is")
                } else {
                    if shared.paused.load(Ordering::Relaxed) {
                        shared.paused.store(false, Ordering::Relaxed);
                    }
                    let _ = shared.operator.send(super::operator::Cmd::Start(goal));
                    shared.set_status(Status::Working, "On it…");
                    ok("Started. The helper is working now and will send [Helper] messages. Tell the user you are on it.")
                }
            }
            "tell_helper" => {
                let message = text_arg("message");
                let _ = shared.operator.send(super::operator::Cmd::Update(message));
                ok("Passed to the helper. Acknowledge the change in a few words.")
            }
            "stop_task" => {
                let _ = shared.operator.send(super::operator::Cmd::Stop);
                shared.cancel_gen.fetch_add(1, Ordering::Relaxed);
                ok("Stopped.")
            }
            "saathi" => {
                shared.set_status(Status::Working, "Asking Saathi…");
                let r = ask_saathi(&mut saathi, &call.args);
                shared.set_status(Status::Listening, "");
                r
            }
            other => fail(format!("There is no tool called {other}. Use do_task for anything on the computer.")),
        };
        system::log(&format!("voice tool {} {} -> {}", call.name, call.args.to_string().chars().take(200).collect::<String>(), response.to_string().chars().take(200).collect::<String>()));
        let _ = shared.out.send(Out::Important(protocol::tool_response(&call.id, &call.name, response)));
    }
}

pub fn label(call: &Call) -> String {
    match call.name.as_str() {
        "open" => format!("Opening {}", text(&call.args, "target")),
        "type_text" => "Typing…".into(),
        "run_command" => "Running a command…".into(),
        "saathi" => "Asking Saathi…".into(),
        "click" | "click_element" => "Clicking…".into(),
        "scroll" => "Scrolling…".into(),
        "wait" => "Waiting for it to load…".into(),
        other => format!("{}…", other.replace('_', " ")),
    }
}

fn ok(result: impl Into<Value>) -> Value {
    json!({ "ok": true, "result": result.into() })
}

fn fail(error: impl Into<String>) -> Value {
    json!({ "ok": false, "error": error.into() })
}

fn point(shared: &Shared, args: &Value, x: &str, y: &str) -> Option<(i32, i32)> {
    Some(to_screen(shared.frame_rect(), num(args, x)?, num(args, y)?))
}

pub fn execute(shared: &Shared, reader: Option<&Reader>, call: &Call, cancelled: &dyn Fn() -> bool) -> Value {
    let a = &call.args;
    let result: Result<Value, String> = (|| match call.name.as_str() {
        "screen_elements" => {
            let rd = reader.ok_or("UI Automation is not available on this PC")?;
            let rect = shared.frame_rect();
            let (title, els) = rd.snapshot(rect, 150)?;
            let text = describe_elements(&title, &els, rect);
            *shared.elements.lock().unwrap_or_else(|p| p.into_inner()) = els;
            Ok(ok(text))
        }
        "click_element" => {
            let id = num(a, "id").ok_or("Which element number?")? as usize;
            let el = shared.elements.lock().unwrap_or_else(|p| p.into_inner()).iter().find(|e| e.id == id).cloned().ok_or("That element number is not in the latest list. Call screen_elements again.")?;
            let (x, y) = el.rect.center();
            input::click(x, y, text(a, "button"), a.get("double").and_then(Value::as_bool).unwrap_or(false))?;
            Ok(ok(format!("Clicked {} \"{}\"", el.kind, el.name)))
        }
        "click" => {
            let (x, y) = point(shared, a, "x", "y").ok_or("x and y are needed")?;
            input::click(x, y, text(a, "button"), a.get("double").and_then(Value::as_bool).unwrap_or(false))?;
            Ok(ok("Clicked"))
        }
        "move_mouse" => {
            let (x, y) = point(shared, a, "x", "y").ok_or("x and y are needed")?;
            input::move_to(x, y)?;
            Ok(ok("Moved"))
        }
        "drag" => {
            let (x1, y1) = point(shared, a, "x1", "y1").ok_or("x1 and y1 are needed")?;
            let (x2, y2) = point(shared, a, "x2", "y2").ok_or("x2 and y2 are needed")?;
            input::drag(x1, y1, x2, y2)?;
            Ok(ok("Dragged"))
        }
        "scroll" => {
            let at = point(shared, a, "x", "y");
            input::scroll(text(a, "direction"), num(a, "amount").unwrap_or(5.0) as i32, at)?;
            Ok(ok("Scrolled"))
        }
        "type_text" => {
            input::type_text(text(a, "text"), cancelled)?;
            Ok(ok("Typed"))
        }
        "press_keys" => {
            let vks = parse_combo(text(a, "keys"))?;
            input::combo(&vks, num(a, "times").unwrap_or(1.0) as u32)?;
            Ok(ok(format!("Pressed {}", text(a, "keys"))))
        }
        "open" => {
            let (done, msg) = system::open(text(a, "target"));
            std::thread::sleep(Duration::from_millis(1200));
            if done { Ok(ok(msg)) } else { Err(msg) }
        }
        "run_command" => {
            let secs = num(a, "timeout_seconds").unwrap_or(60.0).clamp(1.0, 3600.0);
            let (done, out) = system::run_powershell(text(a, "command"), Duration::from_secs_f64(secs), cancelled);
            Ok(json!({ "ok": done, "output": out }))
        }
        "read_file" => {
            let data = std::fs::read(text(a, "path")).map_err(|e| e.to_string())?;
            let s = String::from_utf8_lossy(&data);
            let cut: String = s.chars().take(30_000).collect();
            Ok(ok(if s.chars().count() > 30_000 { format!("{cut}\n[file shortened]") } else { cut }))
        }
        "write_file" => {
            let path = std::path::Path::new(text(a, "path"));
            if let Some(dir) = path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            std::fs::write(path, text(a, "text")).map_err(|e| e.to_string())?;
            Ok(ok(format!("Saved {}", path.display())))
        }
        "list_windows" => Ok(ok(system::windows().into_iter().map(|(_, t)| t).collect::<Vec<_>>().join("\n"))),
        "focus_window" => Ok(ok(format!("Now in front: {}", system::focus(text(a, "title"))?))),
        "clipboard" => match a.get("text").and_then(Value::as_str) {
            Some(t) => {
                system::clipboard_set(t)?;
                Ok(ok("Copied to the clipboard"))
            }
            None => Ok(ok(system::clipboard_get()?)),
        },
        "wait" => {
            let secs = num(a, "seconds").unwrap_or(2.0).clamp(0.2, 60.0);
            let end = std::time::Instant::now() + Duration::from_secs_f64(secs);
            while std::time::Instant::now() < end && !cancelled() {
                std::thread::sleep(Duration::from_millis(100));
            }
            shared.force_frame.store(true, Ordering::Relaxed);
            Ok(ok(format!("Waited. Window in front: {}", system::foreground_title())))
        }
        "look" => {
            shared.force_frame.store(true, Ordering::Relaxed);
            std::thread::sleep(Duration::from_millis(700));
            Ok(ok(format!("A fresh screenshot was sent. Window in front: {}", system::foreground_title())))
        }
        other => Err(format!("There is no tool called {other}")),
    })();
    result.unwrap_or_else(fail)
}

fn ask_saathi(saathi: &mut crate::saathi::Saathi, args: &Value) -> Value {
    let tool = text(args, "tool");
    let arguments = match args.get("arguments_json") {
        Some(Value::String(s)) if !s.trim().is_empty() => serde_json::from_str::<Value>(s).unwrap_or_else(|_| json!({})),
        Some(v @ Value::Object(_)) => v.clone(),
        _ => args.get("arguments").cloned().unwrap_or_else(|| json!({})),
    };
    saathi.call(tool, arguments)
}
