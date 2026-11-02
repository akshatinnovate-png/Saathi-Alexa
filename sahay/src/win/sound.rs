use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

fn endpoint() -> Result<IAudioEndpointVolume, String> {
    unsafe {
        let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| format!("sound devices: {e}"))?;
        let speaker = devices.GetDefaultAudioEndpoint(eRender, eConsole).map_err(|e| format!("no speaker: {e}"))?;
        speaker.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None).map_err(|e| format!("volume control: {e}"))
    }
}

pub fn level() -> Result<(u32, bool), String> {
    let v = endpoint()?;
    unsafe {
        let level = v.GetMasterVolumeLevelScalar().map_err(|e| e.to_string())?;
        let muted = v.GetMute().map_err(|e| e.to_string())?.as_bool();
        Ok(((level * 100.0).round() as u32, muted))
    }
}

pub fn set(percent: u32) -> Result<(), String> {
    let v = endpoint()?;
    unsafe {
        v.SetMute(false, std::ptr::null()).map_err(|e| e.to_string())?;
        v.SetMasterVolumeLevelScalar(percent.min(100) as f32 / 100.0, std::ptr::null()).map_err(|e| e.to_string())
    }
}

pub fn mute(on: bool) -> Result<(), String> {
    let v = endpoint()?;
    unsafe { v.SetMute(on, std::ptr::null()).map_err(|e| e.to_string()) }
}

pub fn make_audible(floor: u32, target: u32) -> Result<Option<String>, String> {
    let (level, muted) = level()?;
    if !muted && level >= floor {
        return Ok(None);
    }
    set(if level >= floor { level } else { target })?;
    Ok(Some(match (muted, level < floor) {
        (true, true) => format!("Sound was off, so I unmuted it and set the volume to {target}%."),
        (true, false) => "Sound was muted, so I unmuted it.".to_string(),
        _ => format!("The volume was only {level}%, so I turned it up to {target}%."),
    }))
}
