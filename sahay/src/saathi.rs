use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

pub const TOOLS: &[&str] = &[
    "what_day_is_it",
    "who_is",
    "get_medication_schedule",
    "confirm_medication_taken",
    "get_upcoming_appointments",
    "get_family_messages",
    "send_message_to_family",
    "daily_check_in",
    "ask_family_for_help",
    "report_suspicious_call",
    "where_is",
    "save_memory_story",
    "list_memory_stories",
    "family_summary",
    "weekly_family_letter",
];

pub struct Saathi {
    port: u16,
    session: Option<String>,
    next_id: u64,
}

struct Reply {
    status: u16,
    session: Option<String>,
    body: String,
}

fn post(port: u16, session: Option<&str>, body: &Value) -> Result<Reply, String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(2)).map_err(|_| "Saathi is not running on this PC. Open Saathi first.".to_string())?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(60)));
    let payload = body.to_string();
    let mut req = format!(
        "POST /mcp HTTP/1.1\r\nHost: localhost:{port}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nMCP-Protocol-Version: 2025-06-18\r\nContent-Length: {}\r\nConnection: close\r\n",
        payload.len()
    );
    if let Some(s) = session {
        req.push_str(&format!("Mcp-Session-Id: {s}\r\n"));
    }
    req.push_str("\r\n");
    req.push_str(&payload);
    stream.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut raw = Vec::new();
    let _ = stream.read_to_end(&mut raw);
    parse_http(&String::from_utf8_lossy(&raw))
}

fn parse_http(raw: &str) -> Result<Reply, String> {
    let (head, body) = raw.split_once("\r\n\r\n").ok_or("Saathi gave an empty answer")?;
    let mut lines = head.lines();
    let status: u16 = lines.next().and_then(|l| l.split_whitespace().nth(1)).and_then(|s| s.parse().ok()).ok_or("Saathi gave a broken answer")?;
    let mut session = None;
    let mut chunked = false;
    for l in lines {
        if let Some((k, v)) = l.split_once(':') {
            let k = k.trim().to_ascii_lowercase();
            if k == "mcp-session-id" {
                session = Some(v.trim().to_string());
            }
            if k == "transfer-encoding" && v.to_ascii_lowercase().contains("chunked") {
                chunked = true;
            }
        }
    }
    let body = if chunked { dechunk(body) } else { body.to_string() };
    Ok(Reply { status, session, body })
}

fn dechunk(body: &str) -> String {
    let mut out = String::new();
    let mut rest = body;
    while let Some((size_line, after)) = rest.split_once("\r\n") {
        let Ok(size) = usize::from_str_radix(size_line.trim().split(';').next().unwrap_or("0"), 16) else { break };
        if size == 0 || after.len() < size {
            if size > 0 {
                out.push_str(after);
            }
            break;
        }
        out.push_str(&after[..size]);
        rest = after[size..].trim_start_matches("\r\n");
    }
    out
}

pub fn message_for(body: &str, id: u64) -> Option<Value> {
    let candidates: Vec<String> = if body.trim_start().starts_with('{') {
        vec![body.trim().to_string()]
    } else {
        body.lines().filter_map(|l| l.strip_prefix("data:")).map(|d| d.trim().to_string()).collect()
    };
    candidates.iter().filter_map(|c| serde_json::from_str::<Value>(c).ok()).find(|v| v.get("id").and_then(Value::as_u64) == Some(id))
}

pub fn summarize(result: &Value) -> Value {
    if let Some(err) = result.get("error") {
        return json!({ "ok": false, "error": err.get("message").cloned().unwrap_or_else(|| err.clone()) });
    }
    let r = result.get("result").cloned().unwrap_or(Value::Null);
    let is_error = r.get("isError").and_then(Value::as_bool).unwrap_or(false);
    let text: String = r.get("content").and_then(Value::as_array).map(|a| a.iter().filter_map(|c| c.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n")).unwrap_or_default();
    let mut out = json!({ "ok": !is_error });
    if let Some(s) = r.get("structuredContent") {
        out["result"] = s.clone();
    } else {
        out["result"] = json!(text.chars().take(8000).collect::<String>());
    }
    out
}

impl Saathi {
    pub fn new(port: u16) -> Self {
        Self { port, session: None, next_id: 1 }
    }

    fn id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }

    fn open(&mut self) -> Result<(), String> {
        let id = self.id();
        let init = json!({ "jsonrpc": "2.0", "id": id, "method": "initialize", "params": { "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "sahay", "version": env!("CARGO_PKG_VERSION") } } });
        let r = post(self.port, None, &init)?;
        if r.status == 401 || r.status == 403 {
            return Err("Saathi is reachable from the internet, so it needs an Alexa+ key; Sahay can only use a Saathi that runs on this PC for this PC.".into());
        }
        if r.status >= 400 {
            return Err(format!("Saathi refused the connection ({})", r.status));
        }
        message_for(&r.body, id).ok_or("Saathi did not answer the hello")?;
        self.session = r.session;
        let _ = post(self.port, self.session.as_deref(), &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));
        Ok(())
    }

    pub fn call(&mut self, tool: &str, arguments: Value) -> Value {
        if !TOOLS.contains(&tool) {
            return json!({ "ok": false, "error": format!("Saathi has no tool called {tool}. Use one of: {}", TOOLS.join(", ")) });
        }
        let arguments = if arguments.is_object() { arguments } else { json!({}) };
        for attempt in 0..2 {
            if self.session.is_none() {
                if let Err(e) = self.open() {
                    return json!({ "ok": false, "error": e });
                }
            }
            let id = self.id();
            let req = json!({ "jsonrpc": "2.0", "id": id, "method": "tools/call", "params": { "name": tool, "arguments": arguments } });
            match post(self.port, self.session.as_deref(), &req) {
                Ok(r) if (r.status == 404 || r.status == 400) && attempt == 0 => {
                    self.session = None;
                }
                Ok(r) if r.status >= 400 => return json!({ "ok": false, "error": format!("Saathi said {}: {}", r.status, r.body.chars().take(300).collect::<String>()) }),
                Ok(r) => return message_for(&r.body, id).map(|m| summarize(&m)).unwrap_or_else(|| json!({ "ok": false, "error": "Saathi's answer could not be read" })),
                Err(e) => return json!({ "ok": false, "error": e }),
            }
        }
        json!({ "ok": false, "error": "Saathi's session could not be restored" })
    }
}

pub fn port_from_env_file(text: &str) -> u16 {
    text.lines()
        .rev()
        .filter_map(|l| l.trim().strip_prefix("PORT="))
        .find_map(|v| v.trim().trim_matches('"').parse().ok())
        .unwrap_or(8787)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn answers_are_read_from_json_sse_and_chunked_bodies() {
        let sse = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"hi\"}]}}\n\n";
        assert_eq!(message_for(sse, 7).unwrap()["result"]["content"][0]["text"], "hi");
        assert!(message_for(sse, 8).is_none());
        assert_eq!(message_for("{\"id\":3,\"result\":{}}", 3).unwrap()["id"], 3);
        let raw = "HTTP/1.1 200 OK\r\nmcp-session-id: abc\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n";
        let r = parse_http(raw).unwrap();
        assert_eq!((r.status, r.session.as_deref(), r.body.as_str()), (200, Some("abc"), "hello world"));
        assert_eq!(port_from_env_file("A=1\nPORT=9000\n"), 9000);
        assert_eq!(port_from_env_file("nothing"), 8787);
    }

    #[test]
    fn tool_results_are_summarised_for_the_model() {
        let s = summarize(&json!({ "result": { "content": [{ "type": "text", "text": "two tablets" }], "structuredContent": { "say": "Two tablets left" } } }));
        assert_eq!(s, json!({ "ok": true, "result": { "say": "Two tablets left" } }));
        let e = summarize(&json!({ "error": { "code": -1, "message": "nope" } }));
        assert_eq!(e, json!({ "ok": false, "error": "nope" }));
        let flagged = summarize(&json!({ "result": { "isError": true, "content": [{ "type": "text", "text": "denied" }] } }));
        assert_eq!(flagged["ok"], false);
    }

    #[test]
    fn it_talks_to_a_running_saathi_and_refuses_unknown_tools() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            for _ in 0..3 {
                let (mut s, _) = listener.accept().unwrap();
                let mut buf = vec![0u8; 8192];
                let n = s.read(&mut buf).unwrap();
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let id = req.split("\"id\":").nth(1).and_then(|r| r.split(|c: char| !c.is_ascii_digit()).next()).unwrap_or("0").to_string();
                let body = if req.contains("\"initialize\"") {
                    format!("{{\"jsonrpc\":\"2.0\",\"id\":{id},\"result\":{{\"protocolVersion\":\"2025-06-18\"}}}}")
                } else if req.contains("tools/call") {
                    assert!(req.contains("Mcp-Session-Id: s-1"));
                    format!("event: message\ndata: {{\"jsonrpc\":\"2.0\",\"id\":{id},\"result\":{{\"content\":[{{\"type\":\"text\",\"text\":\"Aaji took 1 of 2 tablets\"}}]}}}}\n\n")
                } else {
                    String::new()
                };
                let resp = format!("HTTP/1.1 200 OK\r\nmcp-session-id: s-1\r\nContent-Length: {}\r\n\r\n{body}", body.len());
                s.write_all(resp.as_bytes()).unwrap();
            }
        });
        let mut saathi = Saathi::new(port);
        let out = saathi.call("get_medication_schedule", json!({}));
        assert_eq!(out, json!({ "ok": true, "result": "Aaji took 1 of 2 tablets" }));
        server.join().unwrap();
        assert_eq!(saathi.call("rm_rf", json!({}))["ok"], false);
        assert_eq!(Saathi::new(1).call("what_day_is_it", json!({}))["ok"], false);
    }
}

#[cfg(test)]
mod live_saathi {
    use super::*;

    #[test]
    #[ignore]
    fn against_a_real_saathi() {
        let port: u16 = std::env::var("SAATHI_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8787);
        let mut s = Saathi::new(port);
        let meds = s.call("get_medication_schedule", json!({ "language": "en" }));
        assert_eq!(meds["ok"], true, "{meds}");
        assert!(meds["result"]["say"].as_str().unwrap_or("").len() > 5, "{meds}");
        let found = s.call("where_is", json!({ "item": "glasses" }));
        assert_eq!(found["ok"], true, "{found}");
        println!("{meds}\n{found}");
    }
}
