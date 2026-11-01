use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

pub fn post_json(host: &str, path: &str, headers: &[(&str, &str)], body: &str, timeout: Duration) -> Result<(u16, String), String> {
    let addr = (host, 443).to_socket_addrs().map_err(|e| format!("cannot find {host}: {e}"))?.next().ok_or_else(|| format!("cannot find {host}"))?;
    let tcp = TcpStream::connect_timeout(&addr, Duration::from_secs(15)).map_err(|e| format!("cannot reach {host}: {e}"))?;
    let _ = tcp.set_read_timeout(Some(timeout));
    let _ = tcp.set_write_timeout(Some(Duration::from_secs(30)));
    let connector = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
    let mut tls = connector.connect(host, tcp).map_err(|e| format!("secure connection to {host} failed: {e}"))?;
    let mut req = format!("POST {path} HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nUser-Agent: Sahay\r\n", body.len());
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
