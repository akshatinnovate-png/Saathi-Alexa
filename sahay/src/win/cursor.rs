use crate::mover::glide;
use std::time::Duration;
use windows::Win32::Foundation::{COLORREF, HWND, POINT, SIZE};
use windows::Win32::Graphics::Gdi::{CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject, AC_SRC_ALPHA, AC_SRC_OVER, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, BLENDFUNCTION, DIB_RGB_COLORS};
use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, SetCursorPos, ShowWindowAsync, UpdateLayeredWindow, SW_HIDE, SW_SHOWNOACTIVATE, ULW_ALPHA};

pub const SIZE_PX: i32 = 64;
const TIP: (f32, f32) = (14.0, 12.0);
const SHAPE: [(f32, f32); 7] = [(0.0, 0.0), (0.0, 26.0), (6.5, 20.0), (11.0, 30.0), (16.0, 28.0), (11.5, 18.5), (19.0, 18.5)];

fn inside(px: f32, py: f32, poly: &[(f32, f32)]) -> bool {
    let mut c = false;
    let mut j = poly.len() - 1;
    for i in 0..poly.len() {
        let (xi, yi) = poly[i];
        let (xj, yj) = poly[j];
        if (yi > py) != (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi {
            c = !c;
        }
        j = i;
    }
    c
}

fn edge_distance(px: f32, py: f32, poly: &[(f32, f32)]) -> f32 {
    let mut best = f32::MAX;
    for i in 0..poly.len() {
        let (ax, ay) = poly[i];
        let (bx, by) = poly[(i + 1) % poly.len()];
        let (dx, dy) = (bx - ax, by - ay);
        let len = dx * dx + dy * dy;
        let t = if len > 0.0 { (((px - ax) * dx + (py - ay) * dy) / len).clamp(0.0, 1.0) } else { 0.0 };
        let (cx, cy) = (ax + t * dx, ay + t * dy);
        best = best.min(((px - cx).powi(2) + (py - cy).powi(2)).sqrt());
    }
    best
}

fn render(color: [u8; 3], ripple: f32) -> Vec<u32> {
    let poly: Vec<(f32, f32)> = SHAPE.iter().map(|(x, y)| (x + TIP.0, y + TIP.1)).collect();
    let shadow: Vec<(f32, f32)> = poly.iter().map(|(x, y)| (x + 2.0, y + 2.5)).collect();
    let mut px = vec![0u32; (SIZE_PX * SIZE_PX) as usize];
    for y in 0..SIZE_PX {
        for x in 0..SIZE_PX {
            let (mut r, mut g, mut b, mut a) = (0f32, 0f32, 0f32, 0f32);
            for (sx, sy) in [(0.25f32, 0.25f32), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)] {
                let fx = x as f32 + sx;
                let fy = y as f32 + sy;
                if inside(fx, fy, &poly) {
                    let edge = edge_distance(fx, fy, &poly);
                    let (cr, cg, cb) = if edge < 1.8 { (255.0, 255.0, 255.0) } else {
                        let shade = 1.0 - ((fy - TIP.1) / 34.0).clamp(0.0, 1.0) * 0.35;
                        (f32::from(color[0]) * shade, f32::from(color[1]) * shade, f32::from(color[2]) * shade)
                    };
                    r += cr * 0.25;
                    g += cg * 0.25;
                    b += cb * 0.25;
                    a += 0.25;
                } else if inside(fx, fy, &shadow) {
                    a += 0.25 * 0.35;
                }
                if ripple > 0.0 {
                    let d = ((fx - TIP.0).powi(2) + (fy - TIP.1).powi(2)).sqrt();
                    let radius = 4.0 + ripple * 22.0;
                    let ring = (1.0 - ((d - radius).abs() / 2.2)).clamp(0.0, 1.0) * (1.0 - ripple);
                    if ring > 0.0 {
                        r += f32::from(color[0]) * 0.25 * ring;
                        g += f32::from(color[1]) * 0.25 * ring;
                        b += f32::from(color[2]) * 0.25 * ring;
                        a += 0.25 * ring;
                    }
                }
            }
            let a = a.clamp(0.0, 1.0);
            let ai = (a * 255.0) as u32;
            let c = |v: f32| (v.clamp(0.0, 255.0) as u32).min(ai);
            px[(y * SIZE_PX + x) as usize] = (ai << 24) | (c(r) << 16) | (c(g) << 8) | c(b);
        }
    }
    px
}

fn show(hwnd: HWND, pixels: &[u32], tip_x: i32, tip_y: i32) {
    unsafe {
        let screen = GetDC(None);
        let mem = CreateCompatibleDC(screen);
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: SIZE_PX, biHeight: -SIZE_PX, biPlanes: 1, biBitCount: 32, biCompression: BI_RGB.0, ..Default::default() },
            ..Default::default()
        };
        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        if let Ok(bmp) = CreateDIBSection(screen, &info, DIB_RGB_COLORS, &mut bits, None, 0) {
            std::ptr::copy_nonoverlapping(pixels.as_ptr(), bits as *mut u32, pixels.len());
            let old = SelectObject(mem, bmp);
            let pos = POINT { x: tip_x - TIP.0 as i32, y: tip_y - TIP.1 as i32 };
            let size = SIZE { cx: SIZE_PX, cy: SIZE_PX };
            let src = POINT { x: 0, y: 0 };
            let blend = BLENDFUNCTION { BlendOp: AC_SRC_OVER as u8, BlendFlags: 0, SourceConstantAlpha: 255, AlphaFormat: AC_SRC_ALPHA as u8 };
            let _ = UpdateLayeredWindow(hwnd, screen, Some(&pos), Some(&size), mem, Some(&src), COLORREF(0), Some(&blend), ULW_ALPHA);
            SelectObject(mem, old);
            let _ = DeleteObject(bmp);
        }
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        let _ = ShowWindowAsync(hwnd, SW_SHOWNOACTIVATE);
    }
}

pub struct Cursor {
    hwnd: HWND,
    arrow: Vec<u32>,
    color: [u8; 3],
}

unsafe impl Send for Cursor {}

impl Cursor {
    pub fn new(hwnd: isize, color: [u8; 3]) -> Self {
        Self { hwnd: HWND(hwnd as *mut _), arrow: render(color, 0.0), color }
    }

    pub fn position() -> (i32, i32) {
        let mut p = POINT::default();
        unsafe {
            let _ = GetCursorPos(&mut p);
        }
        (p.x, p.y)
    }

    pub fn glide_to(&self, x: i32, y: i32, stop: &dyn Fn() -> bool) -> bool {
        let from = Self::position();
        for (px, py) in glide(from, (x, y)) {
            if stop() {
                return false;
            }
            show(self.hwnd, &self.arrow, px, py);
            unsafe {
                let _ = SetCursorPos(px, py);
            }
            std::thread::sleep(Duration::from_millis(9));
        }
        show(self.hwnd, &self.arrow, x, y);
        unsafe {
            let _ = SetCursorPos(x, y);
        }
        true
    }

    pub fn ripple(&self, x: i32, y: i32) {
        for i in 1..=7 {
            show(self.hwnd, &render(self.color, i as f32 / 8.0), x, y);
            std::thread::sleep(Duration::from_millis(16));
        }
        show(self.hwnd, &self.arrow, x, y);
    }

    pub fn hide(&self) {
        unsafe {
            let _ = ShowWindowAsync(self.hwnd, SW_HIDE);
        }
    }
}
