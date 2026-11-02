use super::Shared;
use std::sync::atomic::Ordering;
use std::sync::{Arc, OnceLock};
use windows::core::{w, HSTRING, PCWSTR};
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{CreateFontW, CreateSolidBrush, SetBkColor, SetTextColor, CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, DEFAULT_PITCH, FF_SWISS, FW_NORMAL, HBRUSH, HDC, HFONT, OUT_DEFAULT_PRECIS, CLEARTYPE_QUALITY};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::SetFocus;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, GetClientRect, GetSystemMetrics, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible, LoadCursorW, MoveWindow, RegisterClassW, SendMessageW, SetForegroundWindow,
    SetWindowTextW, ShowWindow, BS_DEFPUSHBUTTON, BS_PUSHBUTTON, ES_AUTOHSCROLL, ES_AUTOVSCROLL, ES_MULTILINE, ES_READONLY, HMENU, IDC_ARROW, SM_CXSCREEN, SM_CYSCREEN, SW_HIDE, SW_SHOW, WINDOW_EX_STYLE,
    WINDOW_STYLE, SetLayeredWindowAttributes, LWA_ALPHA, WS_EX_LAYERED, WM_APP, WM_CLOSE, WM_COMMAND, WM_CTLCOLOREDIT, WM_DROPFILES, WM_CTLCOLORSTATIC, WM_SETFONT, WM_SIZE, WNDCLASSW, WS_CAPTION, WS_CHILD, WS_EX_TOPMOST, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_OVERLAPPED,
    WS_SYSMENU, WS_TABSTOP, WS_THICKFRAME, WS_VISIBLE, WS_VSCROLL,
};

pub const WM_APPEND: u32 = WM_APP + 3;
const EM_SETSEL: u32 = 0x00B1;
const EM_REPLACESEL: u32 = 0x00C2;
const EM_SCROLLCARET: u32 = 0x00B7;
const ID_SEND: usize = 1;
const ID_STOP: usize = 2;
const ID_TALK: usize = 4;
const ID_LOG: isize = 10;
const ID_INPUT: isize = 11;

static SHARED: OnceLock<Arc<Shared>> = OnceLock::new();
static BG: OnceLock<isize> = OnceLock::new();
static CONTROLS: OnceLock<(isize, isize, isize, isize)> = OnceLock::new();
static TALK: OnceLock<isize> = OnceLock::new();

fn controls() -> Option<(HWND, HWND, HWND, HWND)> {
    CONTROLS.get().map(|&(l, i, s, p)| (HWND(l as *mut _), HWND(i as *mut _), HWND(s as *mut _), HWND(p as *mut _)))
}

fn talk() {
    let Some((_, input, ..)) = controls() else { return };
    unsafe {
        let _ = SetFocus(input);
    }
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(150));
        let _ = super::input::combo(&[0x5B, 0x48], 1);
    });
}

fn layout(hwnd: HWND) {
    let Some((log, input, send, stop)) = controls() else { return };
    let mut r = RECT::default();
    unsafe {
        let _ = GetClientRect(hwnd, &mut r);
        let (w, h) = (r.right, r.bottom);
        let _ = MoveWindow(log, 10, 10, w - 20, h - 70, true);
        let _ = MoveWindow(input, 58, h - 50, w - 248, 38, true);
        if let Some(&t) = TALK.get() {
            let _ = MoveWindow(HWND(t as *mut _), 10, h - 50, 40, 38, true);
        }
        let _ = MoveWindow(send, w - 182, h - 50, 82, 38, true);
        let _ = MoveWindow(stop, w - 92, h - 50, 82, 38, true);
    }
}

fn append(text: &str) {
    let Some((log, ..)) = controls() else { return };
    unsafe {
        let len = GetWindowTextLengthW(log).max(0) as usize;
        if len > 60_000 {
            let _ = SetWindowTextW(log, &HSTRING::from(""));
        }
        let len = GetWindowTextLengthW(log).max(0) as usize;
        SendMessageW(log, EM_SETSEL, WPARAM(len), LPARAM(len as isize));
        let line = HSTRING::from(text);
        SendMessageW(log, EM_REPLACESEL, WPARAM(0), LPARAM(line.as_ptr() as isize));
        SendMessageW(log, EM_SCROLLCARET, WPARAM(0), LPARAM(0));
    }
}

fn send_input() {
    let Some((_, input, ..)) = controls() else { return };
    let Some(shared) = SHARED.get() else { return };
    unsafe {
        let len = GetWindowTextLengthW(input).max(0) as usize;
        let mut buf = vec![0u16; len + 1];
        let n = GetWindowTextW(input, &mut buf).max(0) as usize;
        let text = String::from_utf16_lossy(&buf[..n]).trim().to_string();
        if text.is_empty() {
            return;
        }
        let _ = SetWindowTextW(input, &HSTRING::from(""));
        shared.say("You", &text);
        let _ = shared.asks.send(text);
    }
}

unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_APPEND => {
                if lparam.0 != 0 {
                    let text = Box::from_raw(lparam.0 as *mut String);
                    append(&text);
                }
                LRESULT(0)
            }
            WM_COMMAND => {
                match wparam.0 & 0xffff {
                    ID_SEND => send_input(),
                    ID_TALK => talk(),
                    ID_STOP => {
                        if let Some(s) = SHARED.get() {
                            s.stop.store(true, Ordering::Relaxed);
                        }
                    }
                    _ => {}
                }
                LRESULT(0)
            }
            WM_CTLCOLOREDIT | WM_CTLCOLORSTATIC => {
                let dc = HDC(wparam.0 as *mut _);
                SetTextColor(dc, COLORREF(0x00F2_EEEE));
                SetBkColor(dc, COLORREF(0x0029_1F1B));
                LRESULT(*BG.get().unwrap_or(&0))
            }
            WM_DROPFILES => {
                let drop = windows::Win32::UI::Shell::HDROP(wparam.0 as *mut _);
                let count = windows::Win32::UI::Shell::DragQueryFileW(drop, 0xFFFF_FFFF, None);
                for i in 0..count.min(5) {
                    let mut buf = vec![0u16; 1024];
                    let n = windows::Win32::UI::Shell::DragQueryFileW(drop, i, Some(&mut buf)) as usize;
                    let path = String::from_utf16_lossy(&buf[..n]);
                    if let Some(s) = SHARED.get() {
                        s.say("You", &format!("learn from {path}"));
                        let _ = s.asks.send(format!("learn from {path}"));
                    }
                }
                windows::Win32::UI::Shell::DragFinish(drop);
                LRESULT(0)
            }
            WM_SIZE => {
                layout(hwnd);
                LRESULT(0)
            }
            WM_CLOSE => {
                let _ = ShowWindow(hwnd, SW_HIDE);
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn child(class: PCWSTR, text: &str, style: u32, ex: WINDOW_EX_STYLE, parent: HWND, id: isize, font: HFONT) -> HWND {
    unsafe {
        let hinst = GetModuleHandleW(None).unwrap_or_default();
        let h = CreateWindowExW(ex, class, &HSTRING::from(text), WINDOW_STYLE(style) | WS_CHILD | WS_VISIBLE, 0, 0, 10, 10, parent, HMENU(id as *mut _), hinst, None).unwrap_or_default();
        SendMessageW(h, WM_SETFONT, WPARAM(font.0 as usize), LPARAM(1));
        h
    }
}

pub fn create(shared: Arc<Shared>) -> HWND {
    let _ = SHARED.set(shared);
    unsafe {
        let hinst = GetModuleHandleW(None).unwrap_or_default();
        let bg = CreateSolidBrush(COLORREF(0x0029_1F1B));
        let _ = BG.set(bg.0 as isize);
        let class = WNDCLASSW { lpfnWndProc: Some(proc), hInstance: hinst.into(), lpszClassName: w!("SahayPanel"), hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(), hbrBackground: HBRUSH(bg.0), ..Default::default() };
        RegisterClassW(&class);
        let (sw, sh) = (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN));
        let (w, h) = (460, 620);
        let hwnd = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_LAYERED,
            w!("SahayPanel"),
            &HSTRING::from("Sahay"),
            WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX,
            (sw - w - 170).max(0),
            (sh - h - 110).max(0),
            w,
            h,
            None,
            None,
            hinst,
            None,
        )
        .unwrap_or_default();
        let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 248, LWA_ALPHA);
        super::system::hide_from_capture(hwnd);
        let font = CreateFontW(-17, 0, 0, 0, FW_NORMAL.0 as i32, 0, 0, 0, DEFAULT_CHARSET.0 as u32, OUT_DEFAULT_PRECIS.0 as u32, CLIP_DEFAULT_PRECIS.0 as u32, CLEARTYPE_QUALITY.0 as u32, (DEFAULT_PITCH.0 | FF_SWISS.0) as u32, w!("Segoe UI"));
        let log = child(w!("EDIT"), "", (ES_MULTILINE | ES_READONLY | ES_AUTOVSCROLL) as u32 | WS_VSCROLL.0, WINDOW_EX_STYLE(0), hwnd, ID_LOG, font);
        let input = child(w!("EDIT"), "", ES_AUTOHSCROLL as u32 | WS_TABSTOP.0, WINDOW_EX_STYLE(0), hwnd, ID_INPUT, font);
        let send = child(w!("BUTTON"), "Send", BS_DEFPUSHBUTTON as u32 | WS_TABSTOP.0, WINDOW_EX_STYLE(0), hwnd, ID_SEND as isize, font);
        let stop = child(w!("BUTTON"), "Stop", BS_PUSHBUTTON as u32 | WS_TABSTOP.0, WINDOW_EX_STYLE(0), hwnd, ID_STOP as isize, font);
        let mic = child(w!("BUTTON"), "🎤", BS_PUSHBUTTON as u32 | WS_TABSTOP.0, WINDOW_EX_STYLE(0), hwnd, ID_TALK as isize, font);
        let _ = TALK.set(mic.0 as isize);
        windows::Win32::UI::Shell::DragAcceptFiles(hwnd, true);
        let _ = CONTROLS.set((log.0 as isize, input.0 as isize, send.0 as isize, stop.0 as isize));
        layout(hwnd);
        append("Sahay: Hi! Tell me what to do on this computer, and I'll do it. Every reply and every step shows here. Press 🎤 to talk instead of typing, and Stop (or the sphere) to stop me. Ctrl+Alt+S opens me from anywhere; Ctrl+Alt+M opens me listening. Drop a dataset file here to teach me.");
        hwnd
    }
}

pub fn summon(hwnd: HWND, voice: bool) {
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOW);
        let _ = SetForegroundWindow(hwnd);
        if let Some((_, input, ..)) = controls() {
            let _ = SetFocus(input);
        }
    }
    if voice {
        talk();
    }
}

pub fn toggle(hwnd: HWND) {
    unsafe {
        if IsWindowVisible(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_HIDE);
        } else {
            let _ = ShowWindow(hwnd, SW_SHOW);
            let _ = SetForegroundWindow(hwnd);
            if let Some((_, input, ..)) = controls() {
                let _ = SetFocus(input);
            }
        }
    }
}
