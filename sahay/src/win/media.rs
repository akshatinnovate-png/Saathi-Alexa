use std::time::{Duration, Instant};
use windows::Media::Control::{GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager, GlobalSystemMediaTransportControlsSessionPlaybackStatus as Playback};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Playing,
    Paused,
    Nothing,
}

fn session() -> Option<Session> {
    let manager = Manager::RequestAsync().ok()?.get().ok()?;
    if let Ok(s) = manager.GetCurrentSession() {
        return Some(s);
    }
    manager.GetSessions().ok()?.into_iter().next()
}

pub fn state() -> State {
    match session().and_then(|s| s.GetPlaybackInfo().ok()).and_then(|i| i.PlaybackStatus().ok()) {
        Some(Playback::Playing) => State::Playing,
        Some(Playback::Paused | Playback::Stopped | Playback::Opened | Playback::Changing) => State::Paused,
        _ => State::Nothing,
    }
}

pub fn title() -> String {
    session().and_then(|s| s.TryGetMediaPropertiesAsync().ok()?.get().ok()).and_then(|p| p.Title().ok()).map(|t| t.to_string()).unwrap_or_default()
}

fn settle(want: State) -> bool {
    let end = Instant::now() + Duration::from_millis(2500);
    while Instant::now() < end {
        if state() == want {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    state() == want
}

pub fn play() -> Result<String, String> {
    let s = session().ok_or("nothing is open that can play")?;
    if state() == State::Playing {
        return Ok("It's already playing.".into());
    }
    let _ = s.TryPlayAsync().map_err(|e| e.to_string())?.get();
    if settle(State::Playing) {
        let t = title();
        Ok(if t.is_empty() { "Playing.".into() } else { format!("Playing {t}.") })
    } else {
        Err("it did not start".into())
    }
}

pub fn pause() -> Result<String, String> {
    let s = session().ok_or("nothing is playing")?;
    if state() != State::Playing {
        return Ok("It's already paused.".into());
    }
    let _ = s.TryPauseAsync().map_err(|e| e.to_string())?.get();
    if settle(State::Paused) { Ok("Paused.".into()) } else { Err("it did not pause".into()) }
}

pub fn next() -> Result<String, String> {
    let s = session().ok_or("nothing is playing")?;
    let _ = s.TrySkipNextAsync().map_err(|e| e.to_string())?.get();
    Ok("Skipped to the next one.".into())
}

pub fn previous() -> Result<String, String> {
    let s = session().ok_or("nothing is playing")?;
    let _ = s.TrySkipPreviousAsync().map_err(|e| e.to_string())?.get();
    Ok("Went back to the previous one.".into())
}
