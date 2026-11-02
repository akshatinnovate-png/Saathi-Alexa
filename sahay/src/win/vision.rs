use super::{https, ocr, screen, system};
use crate::actions::Rect;
use base64::Engine as _;
use serde_json::{json, Value};
use std::time::Duration;
use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapEncoder, BitmapPixelFormat};
use windows::Storage::Streams::{DataReader, InMemoryRandomAccessStream};

pub const MODEL: &str = "meta-llama/llama-4-scout-17b-16e-instruct";
const WIDTH: u32 = 1280;

fn jpeg(bgra: &[u8], w: u32, h: u32) -> Result<Vec<u8>, String> {
    let stream = InMemoryRandomAccessStream::new().map_err(|e| e.to_string())?;
    let encoder = BitmapEncoder::CreateAsync(BitmapEncoder::JpegEncoderId().map_err(|e| e.to_string())?, &stream).map_err(|e| e.to_string())?.get().map_err(|e| e.to_string())?;
    encoder.SetPixelData(BitmapPixelFormat::Bgra8, BitmapAlphaMode::Ignore, w, h, 96.0, 96.0, bgra).map_err(|e| e.to_string())?;
    encoder.FlushAsync().map_err(|e| e.to_string())?.get().map_err(|e| e.to_string())?;
    let size = stream.Size().map_err(|e| e.to_string())? as u32;
    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    reader.LoadAsync(size).map_err(|e| e.to_string())?.get().map_err(|e| e.to_string())?;
    let mut out = vec![0u8; size as usize];
    reader.ReadBytes(&mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

pub fn picture(rect: Rect) -> Result<(String, u32, u32, f64), String> {
    let pixels = screen::grab(rect).ok_or("the screen could not be captured")?;
    let (w, h) = (rect.width() as u32, rect.height() as u32);
    let scale = (f64::from(WIDTH) / f64::from(w)).min(1.0);
    let (small, sw, sh) = if scale < 1.0 { ocr::shrink(&pixels, w, h, scale) } else { (pixels, w, h) };
    let bytes = jpeg(&small, sw, sh)?;
    Ok((base64::engine::general_purpose::STANDARD.encode(bytes), sw, sh, scale))
}

pub fn locate(keys: &[String], rect: Rect, what: &str) -> Result<(i32, i32), String> {
    let key = keys.first().ok_or("no Groq key")?;
    let (b64, w, h, scale) = picture(rect)?;
    let prompt = format!(
        "This is a {w}x{h} screenshot of a Windows PC. Find: {what}. Reply with only the pixel coordinates of its centre as x,y (x from the left, y from the top). If it is not visible, reply NONE."
    );
    let body = json!({
        "model": MODEL,
        "messages": [{ "role": "user", "content": [
            { "type": "text", "text": prompt },
            { "type": "image_url", "image_url": { "url": format!("data:image/jpeg;base64,{b64}") } }
        ] }],
        "temperature": 0.0,
        "max_completion_tokens": 40,
    })
    .to_string();
    let auth = format!("Bearer {key}");
    let (status, text) = https::post_json(crate::agent::HOST, crate::agent::PATH, &[("Authorization", &auth)], &body, Duration::from_secs(60))?;
    if status != 200 {
        return Err(format!("the picture reader answered {status}: {}", text.chars().take(160).collect::<String>()));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let answer = v.pointer("/choices/0/message/content").and_then(Value::as_str).unwrap_or("");
    system::log(&format!("vision \"{what}\": {answer}"));
    let (x, y) = crate::mover::parse_xy(answer).ok_or_else(|| format!("\"{what}\" is not visible in the picture"))?;
    if x < 0.0 || y < 0.0 || x > f64::from(w) || y > f64::from(h) {
        return Err(format!("the picture reader pointed outside the screen ({x},{y})"));
    }
    Ok((rect.left + (x / scale).round() as i32, rect.top + (y / scale).round() as i32))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screenshots_are_encoded_as_jpeg_for_the_picture_reader() {
        unsafe {
            let _ = windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_MULTITHREADED);
        }
        let (w, h) = (64u32, 32u32);
        let pixels: Vec<u8> = (0..w * h).flat_map(|i| [(i % 255) as u8, 80, 160, 255]).collect();
        let bytes = jpeg(&pixels, w, h).expect("Windows encodes JPEG");
        assert!(bytes.len() > 100);
        assert_eq!(&bytes[..2], &[0xFF, 0xD8]);
    }
}
