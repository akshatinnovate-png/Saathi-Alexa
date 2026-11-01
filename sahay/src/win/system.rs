use base64::Engine;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use windows::core::{w, HSTRING, PCWSTR};
use windows::Win32::Foundation::{HANDLE, HGLOBAL, HLOCAL, HWND, LPARAM, LocalFree, BOOL};
use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};
use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard, SetClipboardData};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::System::Ole::CF_UNICODETEXT;
use windows::Win32::UI::Input::KeyboardAndMouse::{keybd_event, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOWNORMAL,
};

const ENTROPY: &[u8] = b"saathi/sahay/v1";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn home() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let dir = base.join("Saathi");
    let _ = std::fs::create_dir_all(dir.join("logs"));
    dir
}

pub fn log(line: &str) {
    let path = home().join("logs").join("sahay.log");
    if std::fs::metadata(&path).map(|m| m.len() > 4 * 1024 * 1024).unwrap_or(false) {
        let _ = std::fs::rename(&path, path.with_extension("log.1"));
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(f, "{secs} {line}");
    }
}

fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 }
}

pub fn seal(secret: &str) -> Option<String> {
    let input = blob(secret.as_bytes());
    let entropy = blob(ENTROPY);
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe { CryptProtectData(&input, w!("Sahay"), Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output) }.ok()?;
    let out = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe {
        let _ = LocalFree(HLOCAL(output.pbData as *mut _));
    }
    Some(base64::engine::general_purpose::STANDARD.encode(out))
}

pub fn unseal(sealed: &str) -> Option<String> {
    let data = base64::engine::general_purpose::STANDARD.decode(sealed).ok()?;
    let input = blob(&data);
    let entropy = blob(ENTROPY);
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe { CryptUnprotectData(&input, None, Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output) }.ok()?;
    let plain = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe {
        std::ptr::write_bytes(output.pbData, 0, output.cbData as usize);
        let _ = LocalFree(HLOCAL(output.pbData as *mut _));
    }
    String::from_utf8(plain).ok()
}

pub fn shell_open(target: &str, verb: &str) -> bool {
    let file = HSTRING::from(target);
    let op = HSTRING::from(verb);
    let r = unsafe { ShellExecuteW(HWND::default(), &op, &file, PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
    r.0 as isize > 32
}

pub fn run_powershell(command: &str, timeout: Duration, cancelled: &dyn Fn() -> bool) -> (bool, String) {
    let child = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-OutputFormat", "Text", "-Command", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
    let mut child = match child {
        Ok(c) => c,
        Err(e) => return (false, format!("PowerShell could not start: {e}")),
    };
    if let Some(mut stdin) = child.stdin.take() {
        let script = format!("[Console]::OutputEncoding = [Text.Encoding]::UTF8\n$ProgressPreference = 'SilentlyContinue'\n{command}\n");
        let _ = stdin.write_all(script.as_bytes());
    }
    let mut out_pipe = child.stdout.take();
    let mut err_pipe = child.stderr.take();
    let out_reader = std::thread::spawn(move || {
        let mut s = Vec::new();
        if let Some(p) = out_pipe.as_mut() {
            let _ = p.read_to_end(&mut s);
        }
        s
    });
    let err_reader = std::thread::spawn(move || {
        let mut s = Vec::new();
        if let Some(p) = err_pipe.as_mut() {
            let _ = p.read_to_end(&mut s);
        }
        s
    });
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) => {
                if start.elapsed() > timeout || cancelled() {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => break None,
        }
    };
    let out = String::from_utf8_lossy(&out_reader.join().unwrap_or_default()).into_owned();
    let err = String::from_utf8_lossy(&err_reader.join().unwrap_or_default()).into_owned();
    let mut text = out.trim_end().to_string();
    if !err.trim().is_empty() {
        text.push_str("\n[errors]\n");
        text.push_str(err.trim_end());
    }
    let ok = status.map(|s| s.success()).unwrap_or(false);
    if status_is_timeout(start, timeout, ok, &text) {
        text.push_str("\n[stopped: it ran past its time limit]");
    }
    let mut cut: String = text.chars().take(12_000).collect();
    if text.chars().count() > 12_000 {
        cut.push_str("\n[output shortened]");
    }
    (ok, cut)
}

fn status_is_timeout(start: Instant, timeout: Duration, ok: bool, _text: &str) -> bool {
    !ok && start.elapsed() >= timeout
}

fn looks_like_url(t: &str) -> bool {
    let l = t.to_ascii_lowercase();
    if l.contains("://") || l.starts_with("www.") || l.starts_with("mailto:") {
        return true;
    }
    !l.contains(' ') && !l.contains('\\') && l.contains('.') && l.rsplit('.').next().map(|tld| (2..=6).contains(&tld.len()) && tld.chars().all(|c| c.is_ascii_alphabetic())).unwrap_or(false)
        && !std::path::Path::new(t).exists()
}

pub fn open(target: &str) -> (bool, String) {
    let t = target.trim().trim_matches('"');
    if t.is_empty() {
        return (false, "Nothing to open".into());
    }
    if looks_like_url(t) {
        let url = if t.contains("://") || t.starts_with("mailto:") { t.to_string() } else { format!("https://{t}") };
        return if shell_open(&url, "open") { (true, format!("Opened {url}")) } else { (false, format!("Windows could not open {url}")) };
    }
    if std::path::Path::new(t).exists() && shell_open(t, "open") {
        return (true, format!("Opened {t}"));
    }
    let safe = t.replace('\'', "''");
    let script = format!(
        "$q = '{safe}'\n$app = Get-StartApps | Where-Object {{ $_.Name -eq $q }} | Select-Object -First 1\nif (-not $app) {{ $app = Get-StartApps | Where-Object {{ $_.Name -like \"*$q*\" }} | Sort-Object {{ $_.Name.Length }} | Select-Object -First 1 }}\nif ($app) {{ Start-Process \"shell:AppsFolder\\$($app.AppID)\"; \"Opened $($app.Name)\" }} else {{ try {{ Start-Process $q -ErrorAction Stop; \"Opened $q\" }} catch {{ \"NOTFOUND\" }} }}"
    );
    let (_, out) = run_powershell(&script, Duration::from_secs(20), &|| false);
    if out.contains("NOTFOUND") || out.trim().is_empty() {
        if shell_open(t, "open") {
            return (true, format!("Opened {t}"));
        }
        return (false, format!("No app or file called \"{t}\" was found. Try the website, or run_command."));
    }
    (true, out.lines().next().unwrap_or("Opened").to_string())
}

pub fn clipboard_get() -> Result<String, String> {
    unsafe {
        OpenClipboard(HWND::default()).map_err(|e| e.to_string())?;
        let result = (|| {
            let h = GetClipboardData(CF_UNICODETEXT.0 as u32).map_err(|_| "The clipboard has no text".to_string())?;
            let g = HGLOBAL(h.0);
            let p = GlobalLock(g) as *const u16;
            if p.is_null() {
                return Err("The clipboard could not be read".into());
            }
            let mut len = 0;
            while *p.add(len) != 0 {
                len += 1;
            }
            let text = String::from_utf16_lossy(std::slice::from_raw_parts(p, len));
            let _ = GlobalUnlock(g);
            Ok(text)
        })();
        let _ = CloseClipboard();
        result
    }
}

pub fn clipboard_set(text: &str) -> Result<(), String> {
    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        OpenClipboard(HWND::default()).map_err(|e| e.to_string())?;
        let result = (|| {
            EmptyClipboard().map_err(|e| e.to_string())?;
            let g = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2).map_err(|e| e.to_string())?;
            let p = GlobalLock(g) as *mut u16;
            if p.is_null() {
                return Err("No memory for the clipboard".to_string());
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr(), p, wide.len());
            let _ = GlobalUnlock(g);
            SetClipboardData(CF_UNICODETEXT.0 as u32, HANDLE(g.0)).map_err(|e| e.to_string())?;
            Ok(())
        })();
        let _ = CloseClipboard();
        result
    }
}

pub fn window_title(hwnd: HWND) -> String {
    unsafe {
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return String::new();
        }
        let mut buf = vec![0u16; len as usize + 1];
        let n = GetWindowTextW(hwnd, &mut buf);
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }
}

unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
    unsafe {
        let list = &mut *(lparam.0 as *mut Vec<(isize, String)>);
        if IsWindowVisible(hwnd).as_bool() {
            let title = window_title(hwnd);
            if !title.trim().is_empty() && title != "Sahay" && title != "Sahay caption" {
                list.push((hwnd.0 as isize, title));
            }
        }
        BOOL(1)
    }
}

pub fn windows() -> Vec<(isize, String)> {
    let mut list: Vec<(isize, String)> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&mut list as *mut _ as isize));
    }
    list
}

pub fn focus(title_part: &str) -> Result<String, String> {
    let needle = title_part.to_lowercase();
    let found = windows().into_iter().find(|(_, t)| t.to_lowercase().contains(&needle)).ok_or_else(|| format!("No open window has \"{title_part}\" in its title"))?;
    let hwnd = HWND(found.0 as *mut _);
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        keybd_event(0x12, 0, KEYBD_EVENT_FLAGS(0), 0);
        keybd_event(0x12, 0, KEYEVENTF_KEYUP, 0);
        let _ = SetForegroundWindow(hwnd);
    }
    Ok(found.1)
}

pub fn foreground_title() -> String {
    window_title(unsafe { GetForegroundWindow() })
}

pub fn restart_as_admin() -> bool {
    std::env::current_exe().map(|exe| shell_open(&exe.to_string_lossy(), "runas")).unwrap_or(false)
}
