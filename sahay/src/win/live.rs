use super::{Out, Shared, Status};
use crate::protocol::{self, classify, Event, Failure};
use crate::retry::{retry_after_from, Rotation};
use base64::Engine;
use std::net::TcpStream;
use std::sync::atomic::Ordering;
use std::sync::mpsc::{Receiver, TryRecvError};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket};

enum Exit {
    Quit,
    Paused,
    GoAway,
    Lost(String),
}

fn sleep_unless(shared: &Shared, d: Duration) {
    let end = Instant::now() + d;
    while Instant::now() < end {
        if shared.quit.load(Ordering::Relaxed) || shared.reconnect.swap(false, Ordering::Relaxed) {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn set_timeout(ws: &mut WebSocket<MaybeTlsStream<TcpStream>>, d: Duration) {
    match ws.get_mut() {
        MaybeTlsStream::Plain(s) => {
            let _ = s.set_read_timeout(Some(d));
        }
        MaybeTlsStream::NativeTls(s) => {
            let _ = s.get_mut().set_read_timeout(Some(d));
        }
        _ => {}
    }
}

fn connect(key: &str) -> Result<WebSocket<MaybeTlsStream<TcpStream>>, String> {
    let url = format!("{}?key={}", protocol::LIVE_URL, key);
    match tungstenite::connect(url.as_str()) {
        Ok((ws, _)) => Ok(ws),
        Err(tungstenite::Error::Http(resp)) => {
            let body = resp.body().as_ref().map(|b| String::from_utf8_lossy(b).into_owned()).unwrap_or_default();
            Err(format!("HTTP {} {}", resp.status().as_u16(), body))
        }
        Err(e) => Err(e.to_string()),
    }
}

pub fn run(shared: Arc<Shared>, out_rx: Receiver<Out>) {
    let mut handle: Option<String> = None;
    let mut needs_context = false;
    let mut resumed_from_pause = false;
    let mut dims = (0usize, 0usize);
    let mut rotation = Rotation::new(1, 1, 1);
    let mut held: Vec<serde_json::Value> = Vec::new();
    loop {
        if shared.quit.load(Ordering::Relaxed) {
            return;
        }
        if shared.paused.load(Ordering::Relaxed) {
            shared.set_status(Status::Paused, "Paused. Click the sphere to carry on.");
            resumed_from_pause = true;
            while shared.paused.load(Ordering::Relaxed) && !shared.quit.load(Ordering::Relaxed) {
                drain_while_down(&out_rx, &mut held);
                std::thread::sleep(Duration::from_millis(100));
            }
            continue;
        }
        let cfg = shared.config();
        if cfg.keys.is_empty() {
            shared.set_status(Status::Error, "Add a free Gemini key: right-click the sphere.");
            sleep_unless(&shared, Duration::from_secs(1));
            continue;
        }
        if dims != (cfg.keys.len(), cfg.models.len()) {
            dims = (cfg.keys.len(), cfg.models.len());
            let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(7);
            rotation = Rotation::new(dims.0, dims.1, seed);
        }
        let (k, m) = rotation.current();
        let key = cfg.keys[k.min(cfg.keys.len() - 1)].clone();
        let model = cfg.models[m.min(cfg.models.len() - 1)].clone();
        shared.set_status(Status::Connecting, "Connecting…");
        let mut ws = match connect(&key) {
            Ok(ws) => ws,
            Err(reason) => {
                let failure = classify(&reason);
                super::system::log(&format!("connect failed ({failure:?}) with model {model}: {}", reason.chars().take(300).collect::<String>()));
                backoff(&shared, &mut rotation, failure, &reason);
                continue;
            }
        };
        let system = protocol::instructions(&cfg.name, &cfg.extra);
        let setup = protocol::setup(&model, &system, &cfg.voice, handle.as_deref());
        if ws.send(Message::Text(setup.to_string())).is_err() {
            backoff(&shared, &mut rotation, Failure::Network, "");
            continue;
        }
        set_timeout(&mut ws, Duration::from_millis(15));
        let exit = session(&shared, &mut ws, &out_rx, &mut handle, &mut held, &mut rotation, &mut needs_context, &mut resumed_from_pause);
        shared.connected.store(false, Ordering::Relaxed);
        let _ = ws.close(None);
        match exit {
            Exit::Quit => return,
            Exit::Paused => continue,
            Exit::GoAway => {
                super::system::log("server asked to reconnect; resuming the same conversation");
                continue;
            }
            Exit::Lost(reason) => {
                let lower = reason.to_ascii_lowercase();
                if handle.is_some() && (lower.contains("session") || lower.contains("handle") || lower.contains("resum")) {
                    handle = None;
                    needs_context = true;
                }
                let failure = if reason.is_empty() { Failure::Network } else { classify(&reason) };
                super::system::log(&format!("session ended ({failure:?}): {}", reason.chars().take(300).collect::<String>()));
                if handle.is_none() {
                    needs_context = true;
                }
                backoff(&shared, &mut rotation, failure, &reason);
            }
        }
    }
}

fn drain_while_down(out_rx: &Receiver<Out>, held: &mut Vec<serde_json::Value>) {
    loop {
        match out_rx.try_recv() {
            Ok(Out::Important(v)) => {
                if held.len() < 64 {
                    held.push(v);
                }
            }
            Ok(_) => {}
            Err(_) => return,
        }
    }
}

fn backoff(shared: &Shared, rotation: &mut Rotation, failure: Failure, reason: &str) {
    match rotation.failed(failure, retry_after_from(reason)) {
        Some(d) => {
            let msg = match failure {
                Failure::Quota => format!("Gemini's free limit is busy. Switching and trying again in {}s…", d.as_secs().max(1)),
                Failure::BadKey => "That Gemini key was refused, trying the next one…".to_string(),
                Failure::BadModel => "That voice model is not available, trying another…".to_string(),
                Failure::Network => format!("Connection lost. Reconnecting in {}s…", d.as_secs().max(1)),
            };
            shared.set_status(Status::Waiting, &msg);
            sleep_unless(shared, d);
        }
        None => {
            shared.set_status(Status::Error, "Every Gemini key or model was refused. Right-click the sphere to add a key.");
            if failure == Failure::BadKey {
                shared.ask_for_key();
            }
            *rotation = Rotation::new(1, 1, 1);
            sleep_unless(shared, Duration::from_secs(20));
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn session(
    shared: &Arc<Shared>,
    ws: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    out_rx: &Receiver<Out>,
    handle: &mut Option<String>,
    held: &mut Vec<serde_json::Value>,
    rotation: &mut Rotation,
    needs_context: &mut bool,
    resumed_from_pause: &mut bool,
) -> Exit {
    let mut ready = false;
    let started = Instant::now();
    loop {
        if shared.quit.load(Ordering::Relaxed) {
            return Exit::Quit;
        }
        if shared.paused.load(Ordering::Relaxed) {
            return Exit::Paused;
        }
        if !ready && started.elapsed() > Duration::from_secs(20) {
            return Exit::Lost("setup timed out".into());
        }
        match ws.read() {
            Ok(Message::Text(t)) => {
                for ev in protocol::parse(&t) {
                    if let Some(exit) = handle_event(shared, ev, handle, &mut ready) {
                        return exit;
                    }
                }
            }
            Ok(Message::Binary(b)) => {
                let t = String::from_utf8_lossy(&b).into_owned();
                for ev in protocol::parse(&t) {
                    if let Some(exit) = handle_event(shared, ev, handle, &mut ready) {
                        return exit;
                    }
                }
            }
            Ok(Message::Close(frame)) => return Exit::Lost(frame.map(|f| f.reason.to_string()).unwrap_or_default()),
            Ok(_) => {}
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
            Err(e) => return Exit::Lost(e.to_string()),
        }
        if ready {
            if !held.is_empty() {
                for v in held.drain(..) {
                    if ws.send(Message::Text(v.to_string())).is_err() {
                        return Exit::Lost("send failed".into());
                    }
                }
            }
            if std::mem::take(needs_context) {
                let recent = shared.transcript();
                if !recent.is_empty() {
                    let text = format!("The connection dropped and you are back. This is what was said and done just before. Carry on with the unfinished task from where it stopped, without starting over:\n{recent}");
                    let _ = ws.send(Message::Text(protocol::user_text(&text).to_string()));
                }
            }
            if std::mem::take(resumed_from_pause) {
                let _ = ws.send(Message::Text(protocol::user_text("I clicked the sphere to turn you back on. Say you are back in a few words, then carry on with anything unfinished unless I say otherwise.").to_string()));
            }
            rotation.connected();
            for _ in 0..64 {
                match out_rx.try_recv() {
                    Ok(Out::Audio(b64)) => {
                        if ws.send(Message::Text(protocol::audio_chunk(&b64).to_string())).is_err() {
                            return Exit::Lost("send failed".into());
                        }
                    }
                    Ok(Out::Frame(b64)) => {
                        if ws.send(Message::Text(protocol::video_frame(&b64).to_string())).is_err() {
                            return Exit::Lost("send failed".into());
                        }
                    }
                    Ok(Out::Important(v)) => {
                        if ws.send(Message::Text(v.to_string())).is_err() {
                            held.push(v);
                            return Exit::Lost("send failed".into());
                        }
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => return Exit::Quit,
                }
            }
        }
    }
}

fn handle_event(shared: &Arc<Shared>, ev: Event, handle: &mut Option<String>, ready: &mut bool) -> Option<Exit> {
    match ev {
        Event::Ready => {
            *ready = true;
            shared.connected.store(true, Ordering::Relaxed);
            shared.force_frame.store(true, Ordering::Relaxed);
            let greeting = shared.greeting.lock().ok().and_then(|mut g| g.take());
            shared.set_status(Status::Listening, greeting.as_deref().unwrap_or("Listening"));
        }
        Event::Audio(b64) => {
            if let Ok(pcm) = base64::engine::general_purpose::STANDARD.decode(b64) {
                let _ = shared.play.send(super::audio::Play::Pcm(pcm));
            }
            if shared.status() != Status::Working {
                shared.set_status(Status::Speaking, "");
            }
        }
        Event::Interrupted => {
            let _ = shared.play.send(super::audio::Play::Clear);
            shared.set_status(Status::Listening, "");
        }
        Event::TurnComplete => {
            let heard = std::mem::take(&mut *shared.heard.lock().unwrap_or_else(|p| p.into_inner()));
            if shared.awaiting.load(Ordering::Relaxed) && !heard.trim().is_empty() {
                let _ = shared.operator.send(super::operator::Cmd::Update(heard.trim().to_string()));
            }
            if shared.status() != Status::Working {
                shared.set_status(Status::Listening, "");
            }
        }
        Event::Heard(t) => {
            super::system::log(&format!("heard: {t}"));
            shared.heard.lock().unwrap_or_else(|p| p.into_inner()).push_str(&t);
            shared.remember("You", &t);
        }
        Event::Said(t) => {
            shared.remember("Sahay", &t);
            shared.caption(&t);
        }
        Event::Calls(calls) => {
            for c in calls {
                super::system::log(&format!("voice model called {} {}", c.name, c.args));
                shared.remember("Sahay does", &format!("{} {}", c.name, c.args));
                let _ = shared.calls.send(c);
            }
        }
        Event::Cancelled(ids) => {
            let mut set = shared.cancelled.lock().unwrap_or_else(|p| p.into_inner());
            set.extend(ids);
            shared.cancel_gen.fetch_add(1, Ordering::Relaxed);
        }
        Event::Resume(h) => *handle = Some(h),
        Event::GoAway => return Some(Exit::GoAway),
    }
    None
}
