use std::sync::mpsc::{channel, Sender};
use windows::core::HSTRING;
use windows::Win32::Media::Speech::{ISpVoice, SpVoice, SPF_ASYNC, SPF_IS_NOT_XML, SPF_PURGEBEFORESPEAK};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

fn speakable(text: &str) -> String {
    let mut out: String = text.chars().filter(|c| c.is_alphanumeric() || c.is_whitespace() || ".,;:!?'\"()-%₹$@/".contains(*c)).collect();
    out = out.replace("http", " link ").split_whitespace().collect::<Vec<_>>().join(" ");
    out.chars().take(600).collect()
}

pub fn start() -> Option<Sender<String>> {
    let (tx, rx) = channel::<String>();
    std::thread::Builder::new()
        .name("voice".into())
        .spawn(move || unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let voice: ISpVoice = match CoCreateInstance(&SpVoice, None, CLSCTX_ALL) {
                Ok(v) => v,
                Err(e) => {
                    super::system::log(&format!("voice: {e}"));
                    return;
                }
            };
            while let Ok(text) = rx.recv() {
                let words = speakable(&text);
                if words.is_empty() {
                    continue;
                }
                let flags = (SPF_ASYNC.0 | SPF_PURGEBEFORESPEAK.0 | SPF_IS_NOT_XML.0) as u32;
                if let Err(e) = voice.Speak(&HSTRING::from(words), flags, None) {
                    super::system::log(&format!("voice: {e}"));
                }
            }
        })
        .ok()?;
    Some(tx)
}
