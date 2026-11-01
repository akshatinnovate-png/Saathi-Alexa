use crate::actions::Rect;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, GetMonitorInfoW, MonitorFromWindow, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    CAPTUREBLT, DIB_RGB_COLORS, MONITORINFO, MONITOR_DEFAULTTOPRIMARY, ROP_CODE, SRCCOPY,
};
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

pub struct Frame {
    pub rect: Rect,
    pub jpeg: Vec<u8>,
    pub fingerprint: u64,
}

pub fn active_monitor() -> Rect {
    unsafe {
        let hwnd = GetForegroundWindow();
        let mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY);
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if GetMonitorInfoW(mon, &mut info).as_bool() {
            let r = info.rcMonitor;
            Rect { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
        } else {
            Rect { left: 0, top: 0, right: 1920, bottom: 1080 }
        }
    }
}

fn grab(rect: Rect) -> Option<Vec<u8>> {
    let (w, h) = (rect.width(), rect.height());
    unsafe {
        let screen = GetDC(HWND::default());
        if screen.is_invalid() {
            return None;
        }
        let mem = CreateCompatibleDC(screen);
        let bmp = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(mem, bmp);
        let ok = BitBlt(mem, 0, 0, w, h, screen, rect.left, rect.top, ROP_CODE(SRCCOPY.0 | CAPTUREBLT.0)).is_ok();
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pixels = vec![0u8; (w * h * 4) as usize];
        let lines = if ok { GetDIBits(mem, bmp, 0, h as u32, Some(pixels.as_mut_ptr() as *mut _), &mut info, DIB_RGB_COLORS) } else { 0 };
        SelectObject(mem, old);
        let _ = DeleteObject(bmp);
        let _ = DeleteDC(mem);
        ReleaseDC(HWND::default(), screen);
        if lines == 0 {
            None
        } else {
            Some(pixels)
        }
    }
}

pub fn capture(max_width: u32, quality: u8) -> Option<Frame> {
    let rect = active_monitor();
    let (sw, sh) = (rect.width() as u32, rect.height() as u32);
    let bgra = grab(rect)?;
    let scale = (f64::from(max_width) / f64::from(sw)).min(1.0);
    let (tw, th) = (((f64::from(sw) * scale).round() as u32).max(1), ((f64::from(sh) * scale).round() as u32).max(1));
    let mut rgb = vec![0u8; (tw * th * 3) as usize];
    let mut fp: u64 = 0xcbf29ce484222325;
    for ty in 0..th {
        let sy0 = (u64::from(ty) * u64::from(sh) / u64::from(th)) as u32;
        let sy1 = ((u64::from(ty + 1) * u64::from(sh) / u64::from(th)) as u32).max(sy0 + 1).min(sh);
        for tx in 0..tw {
            let sx0 = (u64::from(tx) * u64::from(sw) / u64::from(tw)) as u32;
            let sx1 = ((u64::from(tx + 1) * u64::from(sw) / u64::from(tw)) as u32).max(sx0 + 1).min(sw);
            let (mut r, mut g, mut b, mut n) = (0u32, 0u32, 0u32, 0u32);
            let step_y = ((sy1 - sy0) / 2).max(1);
            let step_x = ((sx1 - sx0) / 2).max(1);
            let mut sy = sy0;
            while sy < sy1 {
                let mut sx = sx0;
                while sx < sx1 {
                    let i = ((sy * sw + sx) * 4) as usize;
                    b += u32::from(bgra[i]);
                    g += u32::from(bgra[i + 1]);
                    r += u32::from(bgra[i + 2]);
                    n += 1;
                    sx += step_x;
                }
                sy += step_y;
            }
            let o = ((ty * tw + tx) * 3) as usize;
            rgb[o] = (r / n) as u8;
            rgb[o + 1] = (g / n) as u8;
            rgb[o + 2] = (b / n) as u8;
            if (tx % 7 == 0) && (ty % 7 == 0) {
                fp ^= u64::from(rgb[o] >> 3) | (u64::from(rgb[o + 1] >> 3) << 5) | (u64::from(rgb[o + 2] >> 3) << 10);
                fp = fp.wrapping_mul(0x100000001b3);
            }
        }
    }
    let mut jpeg = Vec::with_capacity((tw * th / 4) as usize);
    let encoder = jpeg_encoder::Encoder::new(&mut jpeg, quality.clamp(20, 95));
    encoder.encode(&rgb, tw as u16, th as u16, jpeg_encoder::ColorType::Rgb).ok()?;
    Some(Frame { rect, jpeg, fingerprint: fp })
}
