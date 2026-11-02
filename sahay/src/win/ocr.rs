use crate::actions::Rect;
use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;

pub struct Reader {
    engine: OcrEngine,
    max: u32,
}

pub struct Line {
    pub text: String,
    pub rect: Rect,
}

fn shrink(bgra: &[u8], w: u32, h: u32, scale: f64) -> (Vec<u8>, u32, u32) {
    let nw = ((f64::from(w) * scale) as u32).max(1);
    let nh = ((f64::from(h) * scale) as u32).max(1);
    let mut out = vec![0u8; (nw * nh * 4) as usize];
    for y in 0..nh {
        let sy = ((u64::from(y) * u64::from(h)) / u64::from(nh)) as u32;
        for x in 0..nw {
            let sx = ((u64::from(x) * u64::from(w)) / u64::from(nw)) as u32;
            let s = ((sy * w + sx) * 4) as usize;
            let d = ((y * nw + x) * 4) as usize;
            out[d..d + 4].copy_from_slice(&bgra[s..s + 4]);
        }
    }
    (out, nw, nh)
}

impl Reader {
    pub fn new() -> Result<Self, String> {
        let engine = OcrEngine::TryCreateFromUserProfileLanguages().map_err(|e| format!("Windows text recognition is not available: {e}"))?;
        let max = OcrEngine::MaxImageDimension().unwrap_or(2600).max(800);
        Ok(Self { engine, max })
    }

    pub fn read(&self, bgra: &[u8], w: u32, h: u32, origin: (i32, i32)) -> Result<Vec<Line>, String> {
        let scale = (f64::from(self.max) / f64::from(w.max(h))).min(1.0);
        let (pixels, pw, ph) = if scale < 1.0 { shrink(bgra, w, h, scale) } else { (bgra.to_vec(), w, h) };
        let mut opaque = pixels;
        for px in opaque.chunks_exact_mut(4) {
            px[3] = 255;
        }
        let writer = DataWriter::new().map_err(|e| e.to_string())?;
        writer.WriteBytes(&opaque).map_err(|e| e.to_string())?;
        let buffer = writer.DetachBuffer().map_err(|e| e.to_string())?;
        let bitmap = SoftwareBitmap::CreateCopyWithAlphaFromBuffer(&buffer, BitmapPixelFormat::Bgra8, pw as i32, ph as i32, BitmapAlphaMode::Premultiplied).map_err(|e| e.to_string())?;
        let result = self.engine.RecognizeAsync(&bitmap).map_err(|e| e.to_string())?.get().map_err(|e| format!("Text recognition failed: {e}"))?;
        let back = 1.0 / scale;
        let mut lines = Vec::new();
        for line in result.Lines().map_err(|e| e.to_string())? {
            let text = line.Text().map(|t| t.to_string()).unwrap_or_default();
            if text.trim().is_empty() {
                continue;
            }
            let (mut l, mut t, mut r, mut b) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
            if let Ok(words) = line.Words() {
                for word in words {
                    if let Ok(rect) = word.BoundingRect() {
                        l = l.min(rect.X);
                        t = t.min(rect.Y);
                        r = r.max(rect.X + rect.Width);
                        b = b.max(rect.Y + rect.Height);
                    }
                }
            }
            if l > r || t > b {
                continue;
            }
            let px = |v: f32| (f64::from(v) * back).round() as i32;
            lines.push(Line { text, rect: Rect { left: origin.0 + px(l), top: origin.1 + px(t), right: origin.0 + px(r), bottom: origin.1 + px(b) } });
        }
        Ok(lines)
    }
}
