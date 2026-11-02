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
        let engine = match OcrEngine::TryCreateFromUserProfileLanguages() {
            Ok(e) => e,
            Err(first) => {
                let english = windows::Globalization::Language::CreateLanguage(&windows::core::HSTRING::from("en-US")).map_err(|e| e.to_string())?;
                OcrEngine::TryCreateFromLanguage(&english).map_err(|e| format!("Windows text recognition is not available ({first}; {e}). Add a language with Optical character recognition in Settings, Time and language."))?
            }
        };
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

#[cfg(test)]
mod tests {
    use super::*;
    use windows::core::w;
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{CreateCompatibleDC, CreateDIBSection, CreateFontW, DeleteDC, DeleteObject, DrawTextW, FillRect, GetStockObject, SelectObject, SetBkMode, SetTextColor, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, DT_LEFT, DT_SINGLELINE, TRANSPARENT, WHITE_BRUSH};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    fn picture(text: &str, w: i32, h: i32) -> Vec<u8> {
        unsafe {
            let dc = CreateCompatibleDC(None);
            let info = BITMAPINFO { bmiHeader: BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: w, biHeight: -h, biPlanes: 1, biBitCount: 32, biCompression: BI_RGB.0, ..Default::default() }, ..Default::default() };
            let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
            let bmp = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &mut bits, None, 0).expect("bitmap");
            let old = SelectObject(dc, bmp);
            let mut r = RECT { left: 0, top: 0, right: w, bottom: h };
            FillRect(dc, &r, windows::Win32::Graphics::Gdi::HBRUSH(GetStockObject(WHITE_BRUSH).0));
            let font = CreateFontW(-48, 0, 0, 0, 400, 0, 0, 0, 0, 0, 0, 0, 0, w!("Segoe UI"));
            let old_font = SelectObject(dc, font);
            SetBkMode(dc, TRANSPARENT);
            SetTextColor(dc, windows::Win32::Foundation::COLORREF(0));
            r.left = 40;
            r.top = 60;
            let mut wide: Vec<u16> = text.encode_utf16().collect();
            DrawTextW(dc, &mut wide, &mut r, DT_LEFT | DT_SINGLELINE);
            let pixels = std::slice::from_raw_parts(bits as *const u8, (w * h * 4) as usize).to_vec();
            SelectObject(dc, old_font);
            SelectObject(dc, old);
            let _ = DeleteObject(font);
            let _ = DeleteObject(bmp);
            let _ = DeleteDC(dc);
            pixels
        }
    }

    #[test]
    fn windows_ocr_reads_text_and_places_it() {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let reader = match Reader::new() {
            Ok(r) => r,
            Err(e) => {
                eprintln!("skipped: {e}");
                return;
            }
        };
        let (w, h) = (900, 200);
        let lines = reader.read(&picture("Play Bella Ciao now", w, h), w as u32, h as u32, (100, 50)).expect("ocr runs");
        let all: String = lines.iter().map(|l| l.text.clone()).collect::<Vec<_>>().join(" ");
        assert!(all.to_lowercase().contains("bella"), "read: {all}");
        let line = lines.iter().find(|l| l.text.to_lowercase().contains("bella")).unwrap();
        assert!(line.rect.left >= 100 && line.rect.top >= 50 && line.rect.left < 300, "placed with the origin: {:?}", line.rect);
    }
}
