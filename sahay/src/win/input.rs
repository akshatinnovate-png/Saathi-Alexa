use std::thread::sleep;
use std::time::Duration;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, MOUSEEVENTF_ABSOLUTE,
    MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
    MOUSEEVENTF_VIRTUALDESK, MOUSEEVENTF_WHEEL, MOUSEINPUT, MOUSE_EVENT_FLAGS, VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN};

fn send(inputs: &[INPUT]) -> Result<(), String> {
    let sent = unsafe { SendInput(inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        Ok(())
    } else {
        Err("Windows blocked the input. The window in front may be running as administrator: choose Restart as administrator from the sphere's menu.".into())
    }
}

fn mouse(dx: i32, dy: i32, data: i32, flags: MOUSE_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 { mi: MOUSEINPUT { dx, dy, mouseData: data as u32, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    }
}

fn key(vk: u16, scan: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(vk), wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    }
}

fn absolute(x: i32, y: i32) -> (i32, i32) {
    unsafe {
        let vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let vw = GetSystemMetrics(SM_CXVIRTUALSCREEN).max(2);
        let vh = GetSystemMetrics(SM_CYVIRTUALSCREEN).max(2);
        let nx = ((i64::from(x - vx) * 65535) / i64::from(vw - 1)) as i32;
        let ny = ((i64::from(y - vy) * 65535) / i64::from(vh - 1)) as i32;
        (nx, ny)
    }
}

pub fn move_to(x: i32, y: i32) -> Result<(), String> {
    let (nx, ny) = absolute(x, y);
    send(&[mouse(nx, ny, 0, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK)])
}

fn buttons(button: &str) -> (MOUSE_EVENT_FLAGS, MOUSE_EVENT_FLAGS) {
    match button.to_ascii_lowercase().as_str() {
        "right" => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
        "middle" => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
        _ => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
    }
}

pub fn click(x: i32, y: i32, button: &str, double: bool) -> Result<(), String> {
    move_to(x, y)?;
    sleep(Duration::from_millis(40));
    let (down, up) = buttons(button);
    let times = if double { 2 } else { 1 };
    for i in 0..times {
        send(&[mouse(0, 0, 0, down), mouse(0, 0, 0, up)])?;
        if i + 1 < times {
            sleep(Duration::from_millis(60));
        }
    }
    Ok(())
}

pub fn drag(x1: i32, y1: i32, x2: i32, y2: i32) -> Result<(), String> {
    move_to(x1, y1)?;
    sleep(Duration::from_millis(60));
    send(&[mouse(0, 0, 0, MOUSEEVENTF_LEFTDOWN)])?;
    for step in 1..=20 {
        let x = x1 + (x2 - x1) * step / 20;
        let y = y1 + (y2 - y1) * step / 20;
        move_to(x, y)?;
        sleep(Duration::from_millis(15));
    }
    send(&[mouse(0, 0, 0, MOUSEEVENTF_LEFTUP)])
}

pub fn scroll(direction: &str, amount: i32, at: Option<(i32, i32)>) -> Result<(), String> {
    if let Some((x, y)) = at {
        move_to(x, y)?;
        sleep(Duration::from_millis(30));
    }
    let notches = amount.clamp(1, 50);
    let (flag, sign) = match direction.to_ascii_lowercase().as_str() {
        "down" => (MOUSEEVENTF_WHEEL, -1),
        "left" => (MOUSEEVENTF_HWHEEL, -1),
        "right" => (MOUSEEVENTF_HWHEEL, 1),
        _ => (MOUSEEVENTF_WHEEL, 1),
    };
    for _ in 0..notches {
        send(&[mouse(0, 0, 120 * sign, flag)])?;
        sleep(Duration::from_millis(12));
    }
    Ok(())
}

fn extended(vk: u16) -> bool {
    matches!(vk, 0x21..=0x28 | 0x2D | 0x2E | 0x5B | 0x5C | 0x5D | 0xAD..=0xB3)
}

pub fn combo(vks: &[u16], times: u32) -> Result<(), String> {
    for _ in 0..times.clamp(1, 100) {
        let mut seq = Vec::new();
        for &vk in vks {
            let f = if extended(vk) { KEYEVENTF_EXTENDEDKEY } else { KEYBD_EVENT_FLAGS(0) };
            seq.push(key(vk, 0, f));
        }
        for &vk in vks.iter().rev() {
            let f = if extended(vk) { KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP } else { KEYEVENTF_KEYUP };
            seq.push(key(vk, 0, f));
        }
        send(&seq)?;
        sleep(Duration::from_millis(35));
    }
    Ok(())
}

pub fn type_text(text: &str, cancelled: &dyn Fn() -> bool) -> Result<(), String> {
    for line_part in text.split_inclusive('\n') {
        let (body, enter) = match line_part.strip_suffix('\n') {
            Some(b) => (b.trim_end_matches('\r'), true),
            None => (line_part, false),
        };
        let units: Vec<u16> = body.encode_utf16().collect();
        for chunk in units.chunks(32) {
            if cancelled() {
                return Err("Stopped".into());
            }
            let mut seq = Vec::with_capacity(chunk.len() * 2);
            for &u in chunk {
                seq.push(key(0, u, KEYEVENTF_UNICODE));
                seq.push(key(0, u, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
            }
            send(&seq)?;
            sleep(Duration::from_millis(8));
        }
        if enter {
            combo(&[0x0D], 1)?;
        }
    }
    Ok(())
}
