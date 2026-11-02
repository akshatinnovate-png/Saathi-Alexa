use serde_json::Value;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

pub const DEFAULT_MODEL: &str = "qwen3:4b";
const PORT: u16 = 11434;

fn http(method: &str, path: &str, body: &str, timeout: Duration) -> Result<(u16, String), String> {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], PORT));
    let mut tcp = TcpStream::connect_timeout(&addr, Duration::from_millis(800)).map_err(|_| "the local brain (Ollama) is not running".to_string())?;
    let _ = tcp.set_read_timeout(Some(timeout));
    let req = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
    tcp.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut raw = Vec::new();
    match tcp.read_to_end(&mut raw) {
        Ok(_) => {}
        Err(e) if !raw.is_empty() && e.kind() != std::io::ErrorKind::TimedOut && e.kind() != std::io::ErrorKind::WouldBlock => {}
        Err(e) => return Err(format!("the local brain did not answer: {e}")),
    }
    let reply = crate::saathi::parse_http(&String::from_utf8_lossy(&raw))?;
    Ok((reply.status, reply.body))
}

pub fn models() -> Option<Vec<String>> {
    let (status, body) = http("GET", "/api/tags", "", Duration::from_secs(4)).ok()?;
    if status != 200 {
        return None;
    }
    let v: Value = serde_json::from_str(&body).ok()?;
    Some(v.get("models")?.as_array()?.iter().filter_map(|m| m.get("name").and_then(Value::as_str).map(String::from)).collect())
}

pub fn choose(names: &[String], preferred: &str) -> Option<String> {
    let find = |p: &str| names.iter().find(|n| n.as_str() == p || n.starts_with(&format!("{p}:")) || n.starts_with(p)).cloned();
    find("sahay").or_else(|| find(preferred)).or_else(|| find("qwen3")).or_else(|| find("qwen2.5")).or_else(|| find("llama3"))
}

pub fn available(preferred: &str) -> Option<String> {
    choose(&models()?, preferred)
}

pub fn chat(body: &str) -> Result<(u16, String), String> {
    http("POST", "/v1/chat/completions", body, Duration::from_secs(240))
}

pub fn setup(say: &dyn Fn(&str), model: &str) -> Result<String, String> {
    let ps = |script: &str, secs: u64| super::system::run_powershell(script, Duration::from_secs(secs), &|| false);
    if models().is_none() {
        let (_, found) = ps("if (Get-Command ollama -ErrorAction SilentlyContinue) { 'yes' } elseif (Test-Path \"$env:LOCALAPPDATA\\Programs\\Ollama\\ollama.exe\") { 'yes' } else { 'no' }", 20);
        if found.trim() != "yes" {
            say("Installing Ollama, the free engine that runs the local brain…");
            let (ok, out) = ps("winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements --disable-interactivity 2>&1 | Select-Object -Last 3", 1200);
            if !ok && !out.to_lowercase().contains("installed") {
                return Err(format!("Ollama could not be installed: {}", out.lines().last().unwrap_or("")));
            }
        }
        say("Turning on graphics acceleration and starting the local brain…");
        let _ = ps("[Environment]::SetEnvironmentVariable('OLLAMA_VULKAN','1','User'); $env:OLLAMA_VULKAN='1'; Get-Process ollama* -ErrorAction SilentlyContinue | Stop-Process -Force; $exe = (Get-Command ollama -ErrorAction SilentlyContinue).Source; if (-not $exe) { $exe = \"$env:LOCALAPPDATA\\Programs\\Ollama\\ollama.exe\" }; Start-Process -WindowStyle Hidden -FilePath $exe -ArgumentList 'serve'", 60);
        for _ in 0..30 {
            if models().is_some() {
                break;
            }
            std::thread::sleep(Duration::from_secs(1));
        }
        if models().is_none() {
            return Err("Ollama is installed but not answering yet; restart the PC and try again.".into());
        }
    }
    if available(model).is_none() {
        say(&format!("Downloading the local brain ({model}, about 2.5 GB). This takes a few minutes…"));
        let (_, out) = ps(&format!("$exe = (Get-Command ollama -ErrorAction SilentlyContinue).Source; if (-not $exe) {{ $exe = \"$env:LOCALAPPDATA\\Programs\\Ollama\\ollama.exe\" }}; & $exe pull {model} 2>&1 | Select-Object -Last 2"), 3600);
        if available(model).is_none() {
            return Err(format!("the download did not finish: {}", out.lines().last().unwrap_or("")));
        }
    }
    let name = available(model).unwrap_or_else(|| model.to_string());
    Ok(format!("The local brain ({name}) is ready. I'll use it whenever Groq is busy."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_trained_sahay_model_is_preferred() {
        let names = vec!["llama3.2:3b".to_string(), "qwen3:4b".to_string(), "sahay:latest".to_string()];
        assert_eq!(choose(&names, DEFAULT_MODEL).as_deref(), Some("sahay:latest"));
        assert_eq!(choose(&names[..2], DEFAULT_MODEL).as_deref(), Some("qwen3:4b"));
        assert_eq!(choose(&names[..1], DEFAULT_MODEL).as_deref(), Some("llama3.2:3b"));
        assert_eq!(choose(&[], DEFAULT_MODEL), None);
    }
}
