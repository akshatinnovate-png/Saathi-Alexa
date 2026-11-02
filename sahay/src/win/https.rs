use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::Duration;
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Networking::WinHttp::{
    WinHttpCloseHandle, WinHttpConnect, WinHttpOpen, WinHttpOpenRequest, WinHttpQueryHeaders, WinHttpReadData, WinHttpReceiveResponse, WinHttpSendRequest, WinHttpSetTimeouts, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
    WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_FLAG_SECURE, WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_QUERY_STATUS_CODE,
};

const AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Sahay/2";

struct Handle(*mut core::ffi::c_void);

impl Drop for Handle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                let _ = WinHttpCloseHandle(self.0);
            }
        }
    }
}

fn reason(e: &windows::core::Error) -> String {
    let code = (e.code().0 as u32) & 0xFFFF;
    let text = match code {
        12002 => "it took too long to answer",
        12007 => "the name api.groq.com could not be found (no internet, or DNS is blocked)",
        12029 | 12030 => "the connection could not be made (no internet, or a firewall or antivirus is blocking Sahay)",
        12038 | 12044 | 12045 | 12057 | 12169 | 12175 | 12157 => "the secure connection failed (the PC's date and time may be wrong, or security software is intercepting HTTPS)",
        12152 => "the server sent a broken answer",
        12180 | 12178 | 12166 | 12167 => "the proxy settings could not be used",
        _ => "",
    };
    let msg = e.message();
    if text.is_empty() { format!("{} (error {code})", if msg.trim().is_empty() { "network error" } else { msg.trim() }) } else { format!("{text} (error {code})") }
}

fn checked(h: *mut core::ffi::c_void, what: &str) -> Result<Handle, String> {
    if h.is_null() {
        Err(format!("{what}: {}", reason(&windows::core::Error::from_win32())))
    } else {
        Ok(Handle(h))
    }
}

fn winhttp(verb: &str, host: &str, path: &str, headers: &[(&str, &str)], body: &str, timeout: Duration) -> Result<(u16, String), String> {
    unsafe {
        let agent = HSTRING::from(AGENT);
        let mut session = WinHttpOpen(&agent, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, PCWSTR::null(), PCWSTR::null(), 0);
        if session.is_null() {
            session = WinHttpOpen(&agent, WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, PCWSTR::null(), PCWSTR::null(), 0);
        }
        let session = checked(session, "WinHTTP could not start")?;
        let ms = timeout.as_millis().min(i32::MAX as u128) as i32;
        let _ = WinHttpSetTimeouts(session.0, 15_000, 15_000, 30_000, ms);
        let connect = checked(WinHttpConnect(session.0, &HSTRING::from(host), 443, 0), &format!("cannot reach {host}"))?;
        let request = checked(WinHttpOpenRequest(connect.0, &HSTRING::from(verb), &HSTRING::from(path), PCWSTR::null(), PCWSTR::null(), std::ptr::null(), WINHTTP_FLAG_SECURE), "cannot open the request")?;
        let mut head = if verb == "POST" { String::from("Content-Type: application/json\r\n") } else { String::new() };
        for (k, v) in headers {
            head.push_str(&format!("{k}: {v}\r\n"));
        }
        let wide: Vec<u16> = head.encode_utf16().collect();
        let bytes = body.as_bytes();
        let optional = if bytes.is_empty() { None } else { Some(bytes.as_ptr().cast()) };
        WinHttpSendRequest(request.0, if wide.is_empty() { None } else { Some(&wide) }, optional, bytes.len() as u32, bytes.len() as u32, 0).map_err(|e| format!("cannot reach {host}: {}", reason(&e)))?;
        WinHttpReceiveResponse(request.0, std::ptr::null_mut()).map_err(|e| format!("no answer from {host}: {}", reason(&e)))?;
        let mut status: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        WinHttpQueryHeaders(request.0, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, PCWSTR::null(), Some((&mut status as *mut u32).cast()), &mut size, std::ptr::null_mut()).map_err(|e| reason(&e))?;
        let mut raw = Vec::new();
        let mut chunk = vec![0u8; 64 * 1024];
        loop {
            let mut read = 0u32;
            WinHttpReadData(request.0, chunk.as_mut_ptr().cast(), chunk.len() as u32, &mut read).map_err(|e| format!("the answer from {host} was cut off: {}", reason(&e)))?;
            if read == 0 {
                break;
            }
            raw.extend_from_slice(&chunk[..read as usize]);
        }
        Ok((status as u16, String::from_utf8_lossy(&raw).into_owned()))
    }
}

fn direct(verb: &str, host: &str, path: &str, headers: &[(&str, &str)], body: &str, timeout: Duration) -> Result<(u16, String), String> {
    let mut addrs: Vec<SocketAddr> = (host, 443).to_socket_addrs().map_err(|e| format!("cannot find {host}: {e}"))?.collect();
    addrs.sort_by_key(|a| a.is_ipv6());
    let mut last = format!("cannot find {host}");
    let mut tcp = None;
    for addr in addrs {
        match TcpStream::connect_timeout(&addr, Duration::from_secs(10)) {
            Ok(s) => {
                tcp = Some(s);
                break;
            }
            Err(e) => last = format!("cannot reach {host} ({addr}): {e}"),
        }
    }
    let tcp = tcp.ok_or(last)?;
    let _ = tcp.set_read_timeout(Some(timeout));
    let _ = tcp.set_write_timeout(Some(Duration::from_secs(30)));
    let connector = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
    let mut tls = connector.connect(host, tcp).map_err(|e| format!("secure connection to {host} failed: {e}"))?;
    let mut req = format!("{verb} {path} HTTP/1.1\r\nHost: {host}\r\n{}Content-Length: {}\r\nConnection: close\r\nUser-Agent: {AGENT}\r\n", if verb == "POST" { "Content-Type: application/json\r\n" } else { "" }, body.len());
    for (k, v) in headers {
        req.push_str(&format!("{k}: {v}\r\n"));
    }
    req.push_str("\r\n");
    tls.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    tls.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    let mut raw = Vec::new();
    match tls.read_to_end(&mut raw) {
        Ok(_) => {}
        Err(e) if !raw.is_empty() && e.kind() != std::io::ErrorKind::TimedOut && e.kind() != std::io::ErrorKind::WouldBlock => {}
        Err(e) => return Err(format!("no answer from {host}: {e}")),
    }
    let reply = crate::saathi::parse_http(&String::from_utf8_lossy(&raw))?;
    Ok((reply.status, reply.body))
}

fn send(verb: &str, host: &str, path: &str, headers: &[(&str, &str)], body: &str, timeout: Duration) -> Result<(u16, String), String> {
    match winhttp(verb, host, path, headers, body, timeout) {
        Ok(r) => Ok(r),
        Err(first) => {
            super::system::log(&format!("winhttp: {first}"));
            direct(verb, host, path, headers, body, timeout).map_err(|second| format!("{first}; {second}"))
        }
    }
}

pub fn post_json(host: &str, path: &str, headers: &[(&str, &str)], body: &str, timeout: Duration) -> Result<(u16, String), String> {
    send("POST", host, path, headers, body, timeout)
}

pub fn get(host: &str, path: &str, headers: &[(&str, &str)], timeout: Duration) -> Result<(u16, String), String> {
    send("GET", host, path, headers, "", timeout)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check(result: Result<(u16, String), String>) {
        let (status, body) = result.expect("Groq is reachable");
        assert_eq!(status, 401, "a made-up key is refused with 401: {body}");
        assert!(body.to_ascii_lowercase().contains("api key") || body.contains("invalid_api_key"), "{body}");
    }

    #[test]
    fn groq_answers_through_winhttp() {
        let body = crate::agent::request(&[serde_json::json!({ "role": "user", "content": "hi" })], crate::agent::MODEL).to_string();
        check(winhttp("POST", crate::agent::HOST, crate::agent::PATH, &[("Authorization", "Bearer gsk_not_a_real_key_000000000000000000000000")], &body, Duration::from_secs(60)));
    }

    #[test]
    fn groq_answers_through_the_direct_fallback() {
        check(direct("POST", crate::agent::HOST, crate::agent::PATH, &[("Authorization", "Bearer gsk_not_a_real_key_000000000000000000000000")], "{}", Duration::from_secs(60)));
    }

    #[test]
    fn a_youtube_search_page_gives_a_playable_video() {
        let (status, page) = get("www.youtube.com", "/results?search_query=bella+ciao", &[("Accept-Language", "en-US,en;q=0.9")], Duration::from_secs(60)).expect("YouTube is reachable");
        assert_eq!(status, 200);
        assert!(crate::intent::first_video_id(&page).is_some(), "a video id is on the page");
    }
}
