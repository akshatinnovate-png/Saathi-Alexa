use std::cell::RefCell;
use windows::core::{w, HSTRING, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{GetStockObject, DEFAULT_GUI_FONT};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::SetFocus;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW, GetSystemMetrics, GetWindowTextLengthW, GetWindowTextW, IsDialogMessageW, LoadCursorW, RegisterClassW,
    SendMessageW, SetForegroundWindow, TranslateMessage, BS_DEFPUSHBUTTON, BS_PUSHBUTTON, ES_AUTOHSCROLL, ES_PASSWORD, HMENU, IDC_ARROW, MSG, SM_CXSCREEN, SM_CYSCREEN, WINDOW_EX_STYLE,
    WINDOW_STYLE, WM_CLOSE, WM_COMMAND, WM_DESTROY, WM_SETFONT, WNDCLASSW, WS_CAPTION, WS_CHILD, WS_EX_CLIENTEDGE, WS_EX_TOPMOST, WS_OVERLAPPED, WS_SYSMENU, WS_TABSTOP, WS_VISIBLE,
};

thread_local! {
    static STATE: RefCell<(Option<String>, bool, isize)> = const { RefCell::new((None, false, 0)) };
}

unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_COMMAND => {
                let id = (wparam.0 & 0xffff) as u16;
                if id == 1 {
                    let edit = STATE.with(|s| s.borrow().2);
                    let e = HWND(edit as *mut _);
                    let len = GetWindowTextLengthW(e).max(0) as usize;
                    let mut buf = vec![0u16; len + 1];
                    let n = GetWindowTextW(e, &mut buf).max(0) as usize;
                    let text = String::from_utf16_lossy(&buf[..n]);
                    STATE.with(|s| s.borrow_mut().0 = Some(text));
                    let _ = DestroyWindow(hwnd);
                } else if id == 2 {
                    let _ = DestroyWindow(hwnd);
                }
                LRESULT(0)
            }
            WM_CLOSE => {
                let _ = DestroyWindow(hwnd);
                LRESULT(0)
            }
            WM_DESTROY => {
                STATE.with(|s| s.borrow_mut().1 = true);
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn child(class: PCWSTR, text: &str, style: u32, ex: WINDOW_EX_STYLE, x: i32, y: i32, w: i32, h: i32, parent: HWND, id: isize) -> HWND {
    unsafe {
        let hinst = GetModuleHandleW(None).unwrap_or_default();
        let t = HSTRING::from(text);
        let hwnd = CreateWindowExW(ex, class, &t, WINDOW_STYLE(style) | WS_CHILD | WS_VISIBLE, x, y, w, h, parent, HMENU(id as *mut _), hinst, None).unwrap_or_default();
        SendMessageW(hwnd, WM_SETFONT, WPARAM(GetStockObject(DEFAULT_GUI_FONT).0 as usize), LPARAM(1));
        hwnd
    }
}

pub fn ask(title: &str, prompt: &str, initial: &str, secret: bool) -> Option<String> {
    unsafe {
        let hinst = GetModuleHandleW(None).ok()?;
        let class = WNDCLASSW { lpfnWndProc: Some(proc), hInstance: hinst.into(), lpszClassName: w!("SahayAsk"), hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(), hbrBackground: windows::Win32::Graphics::Gdi::HBRUSH(16 as *mut _), ..Default::default() };
        RegisterClassW(&class);
        let (w, h) = (520, 200);
        let x = (GetSystemMetrics(SM_CXSCREEN) - w) / 2;
        let y = (GetSystemMetrics(SM_CYSCREEN) - h) / 3;
        let t = HSTRING::from(title);
        let hwnd = CreateWindowExW(WS_EX_TOPMOST, w!("SahayAsk"), &t, WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_VISIBLE, x, y, w, h, None, None, hinst, None).ok()?;
        child(w!("STATIC"), prompt, 0, WINDOW_EX_STYLE(0), 16, 14, w - 48, 48, hwnd, 10);
        let edit_style = (ES_AUTOHSCROLL as u32) | if secret { ES_PASSWORD as u32 } else { 0 } | WS_TABSTOP.0;
        let edit = child(w!("EDIT"), initial, edit_style, WS_EX_CLIENTEDGE, 16, 66, w - 48, 26, hwnd, 11);
        child(w!("BUTTON"), "OK", (BS_DEFPUSHBUTTON as u32) | WS_TABSTOP.0, WINDOW_EX_STYLE(0), w - 220, 108, 90, 30, hwnd, 1);
        child(w!("BUTTON"), "Cancel", (BS_PUSHBUTTON as u32) | WS_TABSTOP.0, WINDOW_EX_STYLE(0), w - 122, 108, 90, 30, hwnd, 2);
        STATE.with(|s| *s.borrow_mut() = (None, false, edit.0 as isize));
        let _ = SetForegroundWindow(hwnd);
        let _ = SetFocus(edit);
        let mut msg = MSG::default();
        while !STATE.with(|s| s.borrow().1) {
            if !GetMessageW(&mut msg, None, 0, 0).as_bool() {
                break;
            }
            if IsDialogMessageW(hwnd, &msg).as_bool() {
                continue;
            }
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        STATE.with(|s| s.borrow_mut().0.take()).map(|t| t.trim().to_string()).filter(|t| !t.is_empty())
    }
}
