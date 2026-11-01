use super::{system, ui, Out, Shared, Status};
use std::cell::RefCell;
use std::sync::atomic::Ordering;
use std::sync::{Arc, OnceLock};
use std::time::Instant;
use windows::core::{w, HSTRING};
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM};
use windows::Win32::Graphics::Gdi::{
    BeginPaint, CreateCompatibleDC, CreateDIBSection, CreateSolidBrush, DeleteDC, DeleteObject, DrawTextW, EndPaint, FillRect, GetDC, ReleaseDC, SelectObject, SetBkMode, SetTextColor, AC_SRC_ALPHA,
    AC_SRC_OVER, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, BLENDFUNCTION, DIB_RGB_COLORS, DT_CENTER, DT_END_ELLIPSIS, DT_NOPREFIX, DT_WORDBREAK, PAINTSTRUCT, TRANSPARENT,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{ReleaseCapture, SetCapture, TrackMouseEvent, TME_LEAVE, TRACKMOUSEEVENT};
use windows::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu, DispatchMessageW, GetCursorPos, GetMessageW, GetSystemMetrics, GetWindowRect, KillTimer, LoadCursorW,
    PostQuitMessage, RegisterClassW, SetForegroundWindow, SetLayeredWindowAttributes, SetTimer, SetWindowPos, ShowWindow, TrackPopupMenu, TranslateMessage, UpdateLayeredWindow, HWND_TOPMOST,
    IDC_HAND, LWA_ALPHA, MF_SEPARATOR, MF_STRING, MSG, SM_CXSCREEN, SM_CYSCREEN, SWP_NOACTIVATE, SWP_NOSIZE, SW_HIDE, SW_SHOWNOACTIVATE, TPM_RETURNCMD, TPM_RIGHTBUTTON, ULW_ALPHA, WM_APP,
    WM_DESTROY, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_PAINT, WM_RBUTTONUP, WM_TIMER, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
    WS_EX_TRANSPARENT, WS_POPUP,
};

pub const WM_STATUS: u32 = WM_APP + 1;
const WM_MOUSELEAVE: u32 = 0x02A3;
const SIZE_PX: i32 = 112;
const CX: f32 = 56.0;
const CY: f32 = 60.0;
const RADIUS: f32 = 34.0;
const CLOSE_X: f32 = 98.0;
const CLOSE_Y: f32 = 14.0;
const CLOSE_R: f32 = 11.0;
const CAPTION_W: i32 = 360;
const CAPTION_H: i32 = 64;

static SHARED: OnceLock<Arc<Shared>> = OnceLock::new();

struct Ui {
    orb: isize,
    caption: isize,
    hovered: bool,
    drag: Option<(POINT, RECT, bool)>,
    start: Instant,
    caption_until: Option<Instant>,
}

thread_local! {
    static UI: RefCell<Ui> = RefCell::new(Ui { orb: 0, caption: 0, hovered: false, drag: None, start: Instant::now(), caption_until: None });
}

fn shared() -> &'static Arc<Shared> {
    SHARED.get().expect("shared state")
}

fn palette(status: Status, base: [u8; 3]) -> [f32; 3] {
    let c = |r: u8, g: u8, b: u8| [f32::from(r), f32::from(g), f32::from(b)];
    match status {
        Status::Listening => c(base[0], base[1], base[2]),
        Status::Speaking => c(168, 85, 247),
        Status::Working => c(245, 158, 11),
        Status::Waiting => c(249, 115, 22),
        Status::Connecting => c(56, 189, 248),
        Status::Paused => c(120, 120, 128),
        Status::Error => c(220, 38, 38),
    }
}

fn render(hwnd: HWND, hovered: bool, t: f32) {
    let s = shared();
    let status = s.status();
    let base = palette(status, s.config().color);
    let level = (s.levels.play_level.load(Ordering::Relaxed) as f32 / 6000.0).min(1.0);
    let pulse = match status {
        Status::Speaking => 0.35 + 0.65 * level,
        Status::Working => 0.5 + 0.5 * (t * 6.0).sin().abs(),
        Status::Listening => 0.25 + 0.15 * (t * 2.0).sin(),
        Status::Connecting | Status::Waiting => 0.3 + 0.3 * (t * 3.0).sin().abs(),
        Status::Paused => 0.05,
        Status::Error => 0.4 + 0.4 * (t * 4.0).sin().abs(),
    };
    let n = (SIZE_PX * SIZE_PX) as usize;
    let mut px = vec![0u32; n];
    for y in 0..SIZE_PX {
        for x in 0..SIZE_PX {
            let fx = x as f32 + 0.5;
            let fy = y as f32 + 0.5;
            let d = ((fx - CX).powi(2) + (fy - CY).powi(2)).sqrt();
            let (mut r, mut g, mut b, mut a) = (0f32, 0f32, 0f32, 0f32);
            let glow_r = RADIUS + 4.0 + 14.0 * pulse;
            if d > RADIUS && d < glow_r {
                let k = 1.0 - (d - RADIUS) / (glow_r - RADIUS);
                a = 0.55 * k * k;
                r = base[0];
                g = base[1];
                b = base[2];
            }
            if d <= RADIUS + 0.8 {
                let edge = (RADIUS + 0.8 - d).clamp(0.0, 1.0);
                let lx = (fx - (CX - 12.0)) / RADIUS;
                let ly = (fy - (CY - 14.0)) / RADIUS;
                let spec = (1.0 - (lx * lx + ly * ly).sqrt()).max(0.0).powf(2.2);
                let shade = 0.55 + 0.45 * (1.0 - d / RADIUS).sqrt();
                r = (base[0] * shade + 255.0 * spec * 0.75).min(255.0);
                g = (base[1] * shade + 255.0 * spec * 0.75).min(255.0);
                b = (base[2] * shade + 255.0 * spec * 0.75).min(255.0);
                a = a.max(edge);
                if status == Status::Paused {
                    let bar = (fy - CY).abs() < 11.0 && ((fx - (CX - 7.0)).abs() < 3.5 || (fx - (CX + 7.0)).abs() < 3.5);
                    if bar {
                        r = 245.0;
                        g = 245.0;
                        b = 245.0;
                    }
                }
            }
            if hovered {
                let dc = ((fx - CLOSE_X).powi(2) + (fy - CLOSE_Y).powi(2)).sqrt();
                if dc <= CLOSE_R + 0.8 {
                    let edge = (CLOSE_R + 0.8 - dc).clamp(0.0, 1.0);
                    let ux = fx - CLOSE_X;
                    let uy = fy - CLOSE_Y;
                    let on_x = ((ux - uy).abs() < 2.0 || (ux + uy).abs() < 2.0) && ux.abs() < 5.5 && uy.abs() < 5.5;
                    let v = if on_x { 255.0 } else { 40.0 };
                    r = v;
                    g = v;
                    b = v;
                    a = edge.max(0.92 * edge);
                }
            }
            let ai = (a.clamp(0.0, 1.0) * 255.0) as u32;
            let pm = |c: f32| ((c.clamp(0.0, 255.0) * a.clamp(0.0, 1.0)) as u32).min(ai);
            px[(y * SIZE_PX + x) as usize] = (ai << 24) | (pm(r) << 16) | (pm(g) << 8) | pm(b);
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
        let mut x = r.left + SIZE_PX / 2 - CAPTION_W / 2;
        x = x.clamp(0, (sw - CAPTION_W).max(0));
        let mut y = r.bottom + 2;
        if y + CAPTION_H > sh {
            y = r.top - CAPTION_H - 2;
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
            r.top += 8;
            r.bottom -= 6;
            let text = shared().caption_text();
            let mut wide: Vec<u16> = text.encode_utf16().collect();
            DrawTextW(dc, &mut wide, &mut r, DT_CENTER | DT_WORDBREAK | DT_END_ELLIPSIS | DT_NOPREFIX);
            let _ = EndPaint(hwnd, &ps);
            return LRESULT(0);
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }
}

fn toggle_pause() {
    let s = shared();
    let now = !s.paused.load(Ordering::Relaxed);
    s.paused.store(now, Ordering::Relaxed);
    if now {
        let _ = s.play.send(super::audio::Play::Clear);
        s.cancel_gen.fetch_add(1, Ordering::Relaxed);
        s.set_status(Status::Paused, "Paused. Click the sphere to carry on.");
    } else {
        s.set_status(Status::Connecting, "Back on…");
    }
}

fn menu(hwnd: HWND) {
    let s = shared();
    unsafe {
        let Ok(m) = CreatePopupMenu() else { return };
        let _ = AppendMenuW(m, MF_STRING, 1, w!("Type a request…"));
        let _ = AppendMenuW(m, MF_STRING, 2, if s.paused.load(Ordering::Relaxed) { w!("Start listening") } else { w!("Stop listening") });
        let _ = AppendMenuW(m, MF_SEPARATOR, 0, None);
        let _ = AppendMenuW(m, MF_STRING, 3, w!("Gemini keys…"));
        let _ = AppendMenuW(m, MF_STRING, 4, w!("Get a free Gemini key"));
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
            1 => {
                if let Some(t) = ui::ask("Sahay", "What should Sahay do?", "", false) {
                    if s.paused.load(Ordering::Relaxed) {
                        toggle_pause();
                    }
                    s.remember("You", &t);
                    let _ = s.out.send(Out::Important(crate::protocol::user_text(&t)));
                }
            }
            2 => toggle_pause(),
            3 => {
                let current = s.config().keys.join(", ");
                if let Some(t) = ui::ask("Gemini keys", "Paste one or more free Gemini API keys, separated by commas. More keys mean fewer pauses when one hits its limit.", &current, false) {
                    s.update_config(|c| c.keys = t.split([',', ' ', '\n', ';']).map(str::trim).filter(|k| k.len() > 10).map(String::from).collect());
                    s.reconnect.store(true, Ordering::Relaxed);
                }
            }
            4 => {
                let _ = system::shell_open("https://aistudio.google.com/apikey", "open");
            }
            5 => {
                if let Some(t) = ui::ask("Your name", "What should Sahay call you?", &s.config().name, false) {
                    s.update_config(|c| c.name = t);
                    s.reconnect.store(true, Ordering::Relaxed);
                }
            }
            6 => {
                if let Some(t) = ui::ask("Extra instructions", "Anything Sahay should always know or do (for example: my browser is Chrome, speak Hindi).", &s.config().extra, false) {
                    s.update_config(|c| c.extra = t);
                    s.reconnect.store(true, Ordering::Relaxed);
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

fn quit() {
    let s = shared();
    s.quit.store(true, Ordering::Relaxed);
    let _ = s.play.send(super::audio::Play::Clear);
    unsafe { PostQuitMessage(0) };
}

fn in_close(hwnd: HWND, p: POINT) -> bool {
    let mut r = RECT::default();
    unsafe {
        let _ = GetWindowRect(hwnd, &mut r);
    }
    let x = (p.x - r.left) as f32;
    let y = (p.y - r.top) as f32;
    ((x - CLOSE_X).powi(2) + (y - CLOSE_Y).powi(2)).sqrt() <= CLOSE_R + 2.0
}

unsafe extern "system" fn orb_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_TIMER | WM_STATUS => {
                let (hovered, t, caption, show_until) = UI.with(|u| {
                    let u = u.borrow();
                    (u.hovered, u.start.elapsed().as_secs_f32(), u.caption, u.caption_until)
                });
                render(hwnd, hovered, t);
                let cap = HWND(caption as *mut _);
                if msg == WM_STATUS {
                    let text = shared().caption_text();
                    if !text.is_empty() {
                        UI.with(|u| u.borrow_mut().caption_until = Some(Instant::now() + std::time::Duration::from_secs(7)));
                        place_caption(hwnd, cap);
                        let _ = ShowWindow(cap, SW_SHOWNOACTIVATE);
                        let _ = windows::Win32::Graphics::Gdi::InvalidateRect(cap, None, true);
                    }
                } else if show_until.is_some_and(|until| Instant::now() > until) {
                    UI.with(|u| u.borrow_mut().caption_until = None);
                    let _ = ShowWindow(cap, SW_HIDE);
                }
                if shared().quit.load(Ordering::Relaxed) {
                    PostQuitMessage(0);
                }
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
                let drag = UI.with(|u| u.borrow_mut().drag.take());
                if let Some((_, _, moved)) = drag {
                    if moved {
                        let mut r = RECT::default();
                        let _ = GetWindowRect(hwnd, &mut r);
                        shared().update_config(|c| c.position = Some((r.left, r.top)));
                    } else if in_close(hwnd, p) {
                        quit();
                    } else {
                        toggle_pause();
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

pub fn run(state: Arc<Shared>) {
    let _ = SHARED.set(state);
    let s = shared();
    unsafe {
        let Ok(hinst) = GetModuleHandleW(None) else { return };
        let orb_class = WNDCLASSW { lpfnWndProc: Some(orb_proc), hInstance: hinst.into(), lpszClassName: w!("SahayOrb"), hCursor: LoadCursorW(None, IDC_HAND).unwrap_or_default(), ..Default::default() };
        RegisterClassW(&orb_class);
        let cap_class = WNDCLASSW { lpfnWndProc: Some(caption_proc), hInstance: hinst.into(), lpszClassName: w!("SahayCaption"), ..Default::default() };
        RegisterClassW(&cap_class);
        let sw = GetSystemMetrics(SM_CXSCREEN);
        let sh = GetSystemMetrics(SM_CYSCREEN);
        let (x, y) = s.config().position.filter(|&(x, y)| x > -SIZE_PX && y > -SIZE_PX && x < sw && y < sh).unwrap_or((sw - SIZE_PX - 32, sh - SIZE_PX - 96));
        let Ok(orb) = CreateWindowExW(WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, w!("SahayOrb"), &HSTRING::from("Sahay"), WS_POPUP, x, y, SIZE_PX, SIZE_PX, None, None, hinst, None) else {
            return;
        };
        let caption = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT,
            w!("SahayCaption"),
            &HSTRING::from("Sahay caption"),
            WS_POPUP,
            0,
            0,
            CAPTION_W,
            CAPTION_H,
            None,
            None,
            hinst,
            None,
        )
        .unwrap_or_default();
        let _ = SetLayeredWindowAttributes(caption, COLORREF(0), 225, LWA_ALPHA);
        UI.with(|u| {
            let mut u = u.borrow_mut();
            u.orb = orb.0 as isize;
            u.caption = caption.0 as isize;
        });
        s.orb.store(orb.0 as isize, Ordering::Relaxed);
        render(orb, false, 0.0);
        let _ = ShowWindow(orb, SW_SHOWNOACTIVATE);
        SetTimer(orb, 1, 40, None);
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        let _ = UI.with(|u| u.borrow().orb);
    }
}
