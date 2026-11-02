use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::Duration;
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Networking::WinHttp::{
    WinHttpCloseHandle, WinHttpConnect, WinHttpOpen, WinHttpOpenRequest, WinHttpQueryHeaders, WinHttpReadData, WinHttpReceiveResponse, WinHttpSendRequest, WinHttpSetTimeouts, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
    WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_FLAG_SECURE, WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_QUERY_STATUS_CODE,
};

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

fn checked(h: *mut core::ffi::c_void, what: &str) -> Result<Handle, String> {
    if h.is_null() {
        Err(format!("{what}: {}", windows::core::Error::from_win32().message()))
    } else {
        Ok(Handle(h))
    }
}

fn winhttp(host: &str, path: &str, headers: &[(&str, &str)], body: &str, timeout: Duration) -> Result<(u16, String), String> {
    unsafe {
        let agent = HSTRING::from("Sahay/2");
        let mut session = WinHttpOpen(&agent, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, PCWSTR::null(), PCWSTR::null(), 0);
        if session.is_null() {
            session = WinHttpOpen(&agent, WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, PCWSTR::null(), PCWSTR::null(), 0);
        }
        let session = checked(session, "WinHTTP could not start")?;
        let ms = timeout.as_millis().min(i32::MAX as u128) as i32;
        let _ = WinHttpSetTimeouts(session.0, 15_000, 15_000, 30_000, ms);
        let connect = checked(WinHttpConnect(session.0, &HSTRING::from(host), 443, 0), &format!("cannot reach {host}"))?;
        let request = checked(WinHttpOpenRequest(connect.0, &HSTRING::from("POST"), &HSTRING::from(path), PCWSTR::null(), PCWSTR::null(), std::ptr::null(), WINHTTP_FLAG_SECURE), "cannot open the request")?;
        let mut head = String::from("Content-Type: application/json\r\n");
        for (k, v) in headers {
            head.push_str(&format!("{k}: {v}\r\n"));
        }
        let wide: Vec<u16> = head.encode_utf16().collect();
        let bytes = body.as_bytes();
        WinHttpSendRequest(request.0, Some(&wide), Some(bytes.as_ptr().cast()), bytes.len() as u32, bytes.len() as u32, 0).map_err(|e| format!("cannot reach {host}: {}", e.message()))?;
        WinHttpReceiveResponse(request.0, std::ptr::null_mut()).map_err(|e| format!("no answer from {host}: {}", e.message()))?;
        let mut status: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        WinHttpQueryHeaders(request.0, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, PCWSTR::null(), Some((&mut status as *mut u32).cast()), &mut size, std::ptr::null_mut()).map_err(|e| e.message())?;
        let mut raw = Vec::new();
        let mut chunk = vec![0u8; 64 * 1024];
        loop {
            let mut read = 0u32;
            WinHttpReadData(request.0, chunk.as_mut_ptr().cast(), chunk.len() as u32, &mut read).map_err(|e| format!("the answer from {host} was cut off: {}", e.message()))?;
            if read == 0 {
                break;
            }
            raw.extend_from_slice(&chunk[..read as usize]);
        }
        Ok((status as u16, String::from_utf8_lossy(&raw).into_owned()))
    }
}

fn direct(host: &str, path: &str, headers: &[(&str, &str)], body: &str, timeout: Duration) -> Result<(u16, String), String> {
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
    let mut req = format!("POST {path} HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nUser-Agent: Sahay/2\r\n", body.len());
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

pub fn post_json(host: &str, path: &str, headers: &[(&str, &str)], body: &str, timeout: Duration) -> Result<(u16, String), String> {
    match winhttp(host, path, headers, body, timeout) {
        Ok(r) => Ok(r),
        Err(first) => {
            super::system::log(&format!("winhttp: {first}"));
            direct(host, path, headers, body, timeout).map_err(|second| format!("{first}; {second}"))
        }
    }
}
