use super::{cursor, panel, system, ui, Shared, Status};
use std::cell::RefCell;
use std::sync::atomic::Ordering;
use std::sync::{Arc, OnceLock};
use std::time::Instant;
use windows::core::{w, HSTRING};
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM};
use windows::Win32::Graphics::Gdi::{
    BeginPaint, CreateCompatibleDC, CreateDIBSection, CreateSolidBrush, DeleteDC, DeleteObject, DrawTextW, EndPaint, FillRect, GetDC, InvalidateRect, ReleaseDC, SelectObject, SetBkMode, SetTextColor,
    AC_SRC_ALPHA, AC_SRC_OVER, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, BLENDFUNCTION, DIB_RGB_COLORS, DT_CENTER, DT_END_ELLIPSIS, DT_NOPREFIX, DT_WORDBREAK, PAINTSTRUCT, TRANSPARENT,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{ReleaseCapture, SetCapture, TrackMouseEvent, TME_LEAVE, TRACKMOUSEEVENT};
use windows::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu, DispatchMessageW, GetCursorPos, GetMessageW, GetSystemMetrics, GetWindowRect, IsDialogMessageW, KillTimer, LoadCursorW,
    PostQuitMessage, RegisterClassW, SetForegroundWindow, SetLayeredWindowAttributes, SetTimer, SetWindowPos, ShowWindow, TrackPopupMenu, TranslateMessage, UpdateLayeredWindow, HWND_TOPMOST, IDC_HAND,
    LWA_ALPHA, MF_SEPARATOR, MF_STRING, MSG, SM_CXSCREEN, SM_CYSCREEN, SWP_NOACTIVATE, SWP_NOSIZE, SW_HIDE, SW_SHOWNOACTIVATE, TPM_RETURNCMD, TPM_RIGHTBUTTON, ULW_ALPHA, WM_APP, WM_DESTROY,
    WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_PAINT, WM_RBUTTONUP, WM_TIMER, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
};

pub const WM_STATUS: u32 = WM_APP + 1;
pub const WM_NEED_KEY: u32 = WM_APP + 2;
const WM_MOUSELEAVE: u32 = 0x02A3;
const SIZE_PX: i32 = 132;
const CX: f32 = 66.0;
const CY: f32 = 70.0;
const RADIUS: f32 = 38.0;
const CLOSE_X: f32 = 116.0;
const CLOSE_Y: f32 = 16.0;
const CLOSE_R: f32 = 11.0;
const CAPTION_W: i32 = 380;
const CAPTION_H: i32 = 56;

static SHARED: OnceLock<Arc<Shared>> = OnceLock::new();

struct Ui {
    caption: isize,
    panel: isize,
    hovered: bool,
    drag: Option<(POINT, RECT, bool)>,
    start: Instant,
    caption_until: Option<Instant>,
}

thread_local! {
    static UI: RefCell<Ui> = RefCell::new(Ui { caption: 0, panel: 0, hovered: false, drag: None, start: Instant::now(), caption_until: None });
}

fn shared() -> &'static Arc<Shared> {
    SHARED.get().expect("shared state")
}

fn palette(status: Status, base: [u8; 3]) -> ([f32; 3], [f32; 3]) {
    let c = |r: u8, g: u8, b: u8| [f32::from(r), f32::from(g), f32::from(b)];
    match status {
        Status::Idle => (c(base[0], base[1], base[2]), c(56, 189, 248)),
        Status::Thinking => (c(139, 92, 246), c(236, 72, 153)),
        Status::Acting => (c(245, 158, 11), c(239, 68, 68)),
        Status::Waiting => (c(249, 115, 22), c(250, 204, 21)),
        Status::Stopped => (c(100, 104, 116), c(148, 152, 166)),
        Status::Error => (c(220, 38, 38), c(251, 113, 133)),
    }
}

fn mix(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

fn render(hwnd: HWND, hovered: bool, t: f32) {
    let s = shared();
    let status = s.status();
    let (base, accent) = palette(status, s.config().color);
    let (speed, energy) = match status {
        Status::Idle => (0.6, 0.35),
        Status::Thinking => (2.4, 0.95),
        Status::Acting => (3.2, 1.0),
        Status::Waiting => (0.9, 0.6),
        Status::Stopped => (0.0, 0.1),
        Status::Error => (1.4, 0.7),
    };
    let breath = 0.5 + 0.5 * (t * if status == Status::Idle { 1.2 } else { 3.0 }).sin();
    let glow_size = 10.0 + 10.0 * energy * (0.6 + 0.4 * breath);
    let (lx, ly, lz) = (-0.45f32, -0.6f32, 0.66f32);
    let n = (SIZE_PX * SIZE_PX) as usize;
    let mut px = vec![0u32; n];
    for y in 0..SIZE_PX {
        for x in 0..SIZE_PX {
            let fx = x as f32 + 0.5;
            let fy = y as f32 + 0.5;
            let dx = (fx - CX) / RADIUS;
            let dy = (fy - CY) / RADIUS;
            let d = (dx * dx + dy * dy).sqrt();
            let (mut col, mut a) = ([0f32; 3], 0f32);
            if d > 1.0 {
                let g = ((d - 1.0) * RADIUS / glow_size).min(4.0);
                a = (0.55 * (-g * g * 2.2).exp()) * (0.5 + 0.5 * energy);
                col = mix(base, accent, 0.35 + 0.25 * breath);
            }
            if d <= 1.0 + 1.0 / RADIUS {
                let edge = ((1.0 + 1.0 / RADIUS - d) * RADIUS).clamp(0.0, 1.0);
                let nz = (1.0 - (dx * dx + dy * dy).min(1.0)).sqrt();
                let diffuse = (dx * lx + dy * ly + nz * lz).max(0.0);
                let theta = dy.atan2(dx);
                let swirl = (3.0 * theta + 5.0 * d - t * speed).sin() * (4.0 * d + t * speed * 0.7 + (2.0 * theta).cos()).sin();
                let band = (0.5 + 0.5 * swirl) * energy;
                let core = (1.0 - d).powf(1.6);
                let mut c = mix(base, accent, band * 0.75);
                c = mix([c[0] * 0.35, c[1] * 0.35, c[2] * 0.35], c, 0.35 + 0.65 * diffuse);
                c = mix(c, [255.0, 255.0, 255.0], core * 0.18 * energy);
                let rim = (1.0 - nz).powf(3.0);
                c = mix(c, mix(accent, [255.0, 255.0, 255.0], 0.4), rim * 0.55);
                let (hx, hy) = (dx + 0.38, dy + 0.46);
                let spec = (1.0 - (hx * hx + hy * hy).sqrt() / 0.32).max(0.0).powf(2.2);
                c = mix(c, [255.0, 255.0, 255.0], spec * 0.85);
                if status == Status::Stopped {
                    let bar = (fy - CY).abs() < 12.0 && ((fx - (CX - 7.5)).abs() < 3.6 || (fx - (CX + 7.5)).abs() < 3.6);
                    if bar {
                        c = [245.0, 245.0, 245.0];
                    }
                }
                col = mix(col, c, edge);
                a = a + (1.0 - a) * edge;
            }
            if hovered {
                let dc = ((fx - CLOSE_X).powi(2) + (fy - CLOSE_Y).powi(2)).sqrt();
                if dc <= CLOSE_R + 0.8 {
                    let edge = (CLOSE_R + 0.8 - dc).clamp(0.0, 1.0);
                    let (ux, uy) = (fx - CLOSE_X, fy - CLOSE_Y);
                    let on_x = ((ux - uy).abs() < 1.8 || (ux + uy).abs() < 1.8) && ux.abs() < 5.0 && uy.abs() < 5.0;
                    let v = if on_x { 255.0 } else { 34.0 };
                    col = mix(col, [v, v, v], edge);
                    a = a + (1.0 - a) * edge;
                }
            }
            let a = a.clamp(0.0, 1.0);
            let ai = (a * 255.0) as u32;
            let pm = |v: f32| ((v.clamp(0.0, 255.0) * a) as u32).min(ai);
            px[(y * SIZE_PX + x) as usize] = (ai << 24) | (pm(col[0]) << 16) | (pm(col[1]) << 8) | pm(col[2]);
        }
    }
    unsafe {
        let screen = GetDC(None);
        let mem = CreateCompatibleDC(screen);
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: SIZE_PX, biHeight: -SIZE_PX, biPlanes: 1, biBitCount: 32, biCompression: BI_RGB.0, ..Default::default() },
            ..Default::default()
        };
        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        if let Ok(bmp) = CreateDIBSection(screen, &info, DIB_RGB_COLORS, &mut bits, None, 0) {
            std::ptr::copy_nonoverlapping(px.as_ptr(), bits as *mut u32, n);
            let old = SelectObject(mem, bmp);
            let mut wr = RECT::default();
            let _ = GetWindowRect(hwnd, &mut wr);
            let pos = POINT { x: wr.left, y: wr.top };
            let size = SIZE { cx: SIZE_PX, cy: SIZE_PX };
            let src = POINT { x: 0, y: 0 };
            let blend = BLENDFUNCTION { BlendOp: AC_SRC_OVER as u8, BlendFlags: 0, SourceConstantAlpha: 255, AlphaFormat: AC_SRC_ALPHA as u8 };
            let _ = UpdateLayeredWindow(hwnd, screen, Some(&pos), Some(&size), mem, Some(&src), COLORREF(0), Some(&blend), ULW_ALPHA);
            SelectObject(mem, old);
            let _ = DeleteObject(bmp);
        }
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
    }
}

fn place_caption(orb: HWND, caption: HWND) {
    unsafe {
        let mut r = RECT::default();
        let _ = GetWindowRect(orb, &mut r);
        let sw = GetSystemMetrics(SM_CXSCREEN);
        let sh = GetSystemMetrics(SM_CYSCREEN);
        let x = (r.left + SIZE_PX / 2 - CAPTION_W / 2).clamp(0, (sw - CAPTION_W).max(0));
        let mut y = r.bottom - 8;
        if y + CAPTION_H > sh {
            y = r.top - CAPTION_H;
        }
        let _ = SetWindowPos(caption, HWND_TOPMOST, x, y, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE);
    }
}

unsafe extern "system" fn caption_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe {
        if msg == WM_PAINT {
            let mut ps = PAINTSTRUCT::default();
            let dc = BeginPaint(hwnd, &mut ps);
            let brush = CreateSolidBrush(COLORREF(0x0024_1A14));
            let mut r = RECT { left: 0, top: 0, right: CAPTION_W, bottom: CAPTION_H };
            FillRect(dc, &r, brush);
            let _ = DeleteObject(brush);
            SetBkMode(dc, TRANSPARENT);
            SetTextColor(dc, COLORREF(0x00F5_F5F5));
            r.left += 10;
            r.right -= 10;
            r.top += 7;
            r.bottom -= 5;
            let mut wide: Vec<u16> = shared().caption_text().encode_utf16().collect();
            DrawTextW(dc, &mut wide, &mut r, DT_CENTER | DT_WORDBREAK | DT_END_ELLIPSIS | DT_NOPREFIX);
            let _ = EndPaint(hwnd, &ps);
            return LRESULT(0);
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }
}

pub fn ask_keys(rejected: bool) {
    let s = shared();
    if rejected || s.config().keys.is_empty() {
        let _ = system::shell_open("https://console.groq.com/keys", "open");
    }
    let prompt = if rejected {
        "Groq refused your key. Groq's key page is opening: create a key, copy it, and paste it here. Several keys can be separated by commas."
    } else {
        "Paste one or more free Groq API keys (they start with gsk_), separated by commas. More keys mean fewer pauses when one hits its limit."
    };
    let current = s.config().keys.join(", ");
    if let Some(t) = ui::ask("Groq keys", prompt, &current, false) {
        let keys = crate::config::split_keys(&t);
        if !keys.is_empty() {
            s.update_config(|c| c.keys = keys);
            s.set_status(Status::Idle, "Groq key saved.");
        }
    }
    s.asking_key.store(false, Ordering::Relaxed);
}

fn quit() {
    let s = shared();
    s.quit.store(true, Ordering::Relaxed);
    s.stop.store(true, Ordering::Relaxed);
    unsafe { PostQuitMessage(0) };
}

fn panel_hwnd() -> HWND {
    HWND(UI.with(|u| u.borrow().panel) as *mut _)
}

fn menu(hwnd: HWND) {
    let s = shared();
    unsafe {
        let Ok(m) = CreatePopupMenu() else { return };
        let _ = AppendMenuW(m, MF_STRING, 1, w!("Open the chat"));
        let _ = AppendMenuW(m, MF_STRING, 2, w!("Stop what Sahay is doing"));
        let _ = AppendMenuW(m, MF_SEPARATOR, 0, None);
        let _ = AppendMenuW(m, MF_STRING, 3, w!("Groq keys…"));
        let _ = AppendMenuW(m, MF_STRING, 4, w!("Get a free Groq key"));
        let _ = AppendMenuW(m, MF_STRING, 5, w!("Your name…"));
        let _ = AppendMenuW(m, MF_STRING, 6, w!("Extra instructions…"));
        let _ = AppendMenuW(m, MF_STRING, 7, w!("Restart as administrator"));
        let _ = AppendMenuW(m, MF_STRING, 8, w!("Open the log"));
        let _ = AppendMenuW(m, MF_SEPARATOR, 0, None);
        let _ = AppendMenuW(m, MF_STRING, 9, w!("Close Sahay"));
        let mut p = POINT::default();
        let _ = GetCursorPos(&mut p);
        let _ = SetForegroundWindow(hwnd);
        let cmd = TrackPopupMenu(m, TPM_RETURNCMD | TPM_RIGHTBUTTON, p.x, p.y, 0, hwnd, None).0;
        let _ = DestroyMenu(m);
        match cmd {
            1 => panel::toggle(panel_hwnd()),
            2 => s.stop.store(true, Ordering::Relaxed),
            3 => ask_keys(false),
            4 => {
                let _ = system::shell_open("https://console.groq.com/keys", "open");
            }
            5 => {
                if let Some(t) = ui::ask("Your name", "What should Sahay call you?", &s.config().name, false) {
                    s.update_config(|c| c.name = t);
                }
            }
            6 => {
                if let Some(t) = ui::ask("Extra instructions", "Anything Sahay should always know or do (for example: my browser is Chrome, reply in Hindi).", &s.config().extra, false) {
                    s.update_config(|c| c.extra = t);
                }
            }
            7 => {
                if system::restart_as_admin() {
                    quit();
                }
            }
            8 => {
                let _ = system::shell_open(&system::home().join("logs").join("sahay.log").to_string_lossy(), "open");
            }
            9 => quit(),
            _ => {}
        }
    }
}

fn in_close(hwnd: HWND, p: POINT) -> bool {
    let mut r = RECT::default();
    unsafe {
        let _ = GetWindowRect(hwnd, &mut r);
    }
    let (x, y) = ((p.x - r.left) as f32, (p.y - r.top) as f32);
    ((x - CLOSE_X).powi(2) + (y - CLOSE_Y).powi(2)).sqrt() <= CLOSE_R + 2.0
}

unsafe extern "system" fn orb_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_TIMER | WM_STATUS => {
                let (hovered, t, caption, until) = UI.with(|u| {
                    let u = u.borrow();
                    (u.hovered, u.start.elapsed().as_secs_f32(), u.caption, u.caption_until)
                });
                render(hwnd, hovered, t);
                let cap = HWND(caption as *mut _);
                if msg == WM_STATUS {
                    if !shared().caption_text().is_empty() {
                        UI.with(|u| u.borrow_mut().caption_until = Some(Instant::now() + std::time::Duration::from_secs(6)));
                        place_caption(hwnd, cap);
                        let _ = ShowWindow(cap, SW_SHOWNOACTIVATE);
                        let _ = InvalidateRect(cap, None, true);
                    }
                } else if until.is_some_and(|u| Instant::now() > u) {
                    UI.with(|u| u.borrow_mut().caption_until = None);
                    let _ = ShowWindow(cap, SW_HIDE);
                }
                if shared().quit.load(Ordering::Relaxed) {
                    PostQuitMessage(0);
                }
                LRESULT(0)
            }
            WM_NEED_KEY => {
                ask_keys(true);
                LRESULT(0)
            }
            WM_LBUTTONDOWN => {
                let mut p = POINT::default();
                let _ = GetCursorPos(&mut p);
                let mut r = RECT::default();
                let _ = GetWindowRect(hwnd, &mut r);
                UI.with(|u| u.borrow_mut().drag = Some((p, r, false)));
                SetCapture(hwnd);
                LRESULT(0)
            }
            WM_MOUSEMOVE => {
                let mut p = POINT::default();
                let _ = GetCursorPos(&mut p);
                let (moved_to, caption) = UI.with(|u| {
                    let mut u = u.borrow_mut();
                    if !u.hovered {
                        u.hovered = true;
                        let mut tme = TRACKMOUSEEVENT { cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32, dwFlags: TME_LEAVE, hwndTrack: hwnd, dwHoverTime: 0 };
                        let _ = TrackMouseEvent(&mut tme);
                    }
                    let caption = u.caption;
                    if let Some((start, r, moved)) = u.drag.as_mut() {
                        let (dx, dy) = (p.x - start.x, p.y - start.y);
                        if *moved || dx.abs() > 4 || dy.abs() > 4 {
                            *moved = true;
                            return (Some((r.left + dx, r.top + dy)), caption);
                        }
                    }
                    (None, caption)
                });
                if let Some((x, y)) = moved_to {
                    let _ = SetWindowPos(hwnd, HWND_TOPMOST, x, y, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE);
                    place_caption(hwnd, HWND(caption as *mut _));
                }
                LRESULT(0)
            }
            WM_MOUSELEAVE => {
                UI.with(|u| u.borrow_mut().hovered = false);
                LRESULT(0)
            }
            WM_LBUTTONUP => {
                let _ = ReleaseCapture();
                let mut p = POINT::default();
                let _ = GetCursorPos(&mut p);
                if let Some((_, _, moved)) = UI.with(|u| u.borrow_mut().drag.take()) {
                    if moved {
                        let mut r = RECT::default();
                        let _ = GetWindowRect(hwnd, &mut r);
                        shared().update_config(|c| c.position = Some((r.left, r.top)));
                    } else if in_close(hwnd, p) {
                        quit();
                    } else if shared().busy.load(Ordering::Relaxed) {
                        shared().stop.store(true, Ordering::Relaxed);
                        shared().set_status(Status::Stopped, "Stopping…");
                    } else {
                        panel::toggle(panel_hwnd());
                    }
                }
                LRESULT(0)
            }
            WM_RBUTTONUP => {
                menu(hwnd);
                LRESULT(0)
            }
            WM_DESTROY => {
                let _ = KillTimer(hwnd, 1);
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }
}

unsafe extern "system" fn pointer_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

pub fn run(state: Arc<Shared>, show_panel: bool) {
    let _ = SHARED.set(state.clone());
    let s = shared();
    unsafe {
        let Ok(hinst) = GetModuleHandleW(None) else { return };
        RegisterClassW(&WNDCLASSW { lpfnWndProc: Some(orb_proc), hInstance: hinst.into(), lpszClassName: w!("SahayOrb"), hCursor: LoadCursorW(None, IDC_HAND).unwrap_or_default(), ..Default::default() });
        RegisterClassW(&WNDCLASSW { lpfnWndProc: Some(caption_proc), hInstance: hinst.into(), lpszClassName: w!("SahayCaption"), ..Default::default() });
        RegisterClassW(&WNDCLASSW { lpfnWndProc: Some(pointer_proc), hInstance: hinst.into(), lpszClassName: w!("SahayCursor"), ..Default::default() });
        let sw = GetSystemMetrics(SM_CXSCREEN);
        let sh = GetSystemMetrics(SM_CYSCREEN);
        let (x, y) = s.config().position.filter(|&(x, y)| x > -SIZE_PX && y > -SIZE_PX && x < sw && y < sh).unwrap_or((sw - SIZE_PX - 28, sh - SIZE_PX - 90));
        let Ok(orb) = CreateWindowExW(WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, w!("SahayOrb"), &HSTRING::from("Sahay"), WS_POPUP, x, y, SIZE_PX, SIZE_PX, None, None, hinst, None) else {
            return;
        };
        let caption = CreateWindowExW(WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT, w!("SahayCaption"), &HSTRING::from("Sahay caption"), WS_POPUP, 0, 0, CAPTION_W, CAPTION_H, None, None, hinst, None).unwrap_or_default();
        let _ = SetLayeredWindowAttributes(caption, COLORREF(0), 225, LWA_ALPHA);
        let pointer = CreateWindowExW(WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT, w!("SahayCursor"), &HSTRING::from("Sahay cursor"), WS_POPUP, 0, 0, cursor::SIZE_PX, cursor::SIZE_PX, None, None, hinst, None).unwrap_or_default();
        let chat = panel::create(state.clone());
        UI.with(|u| {
            let mut u = u.borrow_mut();
            u.caption = caption.0 as isize;
            u.panel = chat.0 as isize;
        });
        s.orb.store(orb.0 as isize, Ordering::Relaxed);
        s.panel.store(chat.0 as isize, Ordering::Relaxed);
        s.cursor.store(pointer.0 as isize, Ordering::Relaxed);
        render(orb, false, 0.0);
        let _ = ShowWindow(orb, SW_SHOWNOACTIVATE);
        if show_panel {
            panel::toggle(chat);
        }
        SetTimer(orb, 1, 33, None);
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            if IsDialogMessageW(chat, &msg).as_bool() {
                continue;
            }
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}
