use crate::actions::Rect;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, GetMonitorInfoW, MonitorFromWindow, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    CAPTUREBLT, DIB_RGB_COLORS, MONITORINFO, MONITOR_DEFAULTTOPRIMARY, ROP_CODE, SRCCOPY,
};

pub fn monitor_of(hwnd: HWND) -> Rect {
    unsafe {
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

pub fn grab(rect: Rect) -> Option<Vec<u8>> {
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
