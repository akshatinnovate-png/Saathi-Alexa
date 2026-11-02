use serde_json::{json, Value};

pub const HOST: &str = "api.groq.com";
pub const PATH: &str = "/openai/v1/chat/completions";
pub const MODEL: &str = "openai/gpt-oss-120b";
pub const MAX_STEPS: usize = 80;

pub fn system_prompt(name: &str, extra: &str) -> String {
    let user_name = if name.trim().is_empty() || name.trim().eq_ignore_ascii_case("you") { "the user" } else { name.trim() };
    format!(
        "You are Sahay, {user_name}'s helper on their Windows computer. You talk with {user_name} and you direct the Mover, \
a fast local engine that reads the screen and moves its own cursor to click and type. You cannot see the screen yourself: \
the Mover tells you what is on it. Every screen description lists controls (E numbers) and text read from the screen (T numbers), \
each with its position as @x,y from 0 to 1000.\n\
How to work:\n\
- For anything to do on the computer, give the Mover one instruction at a time with the tools, read what happened, then decide the next step. Keep going until the job is done.\n\
- Give exactly one tool call per answer. After each one the screen is read again and the numbers change, so always use numbers from the newest screen description.\n\
- Click things by their E or T number, or by the exact words shown on them. Use @x,y only when nothing else fits.\n\
- To search or fill a box: click it, then type (enter true to submit). Shortcuts go through key (ctrl+l focuses a browser's address bar, k pauses YouTube, shift+. makes it faster).\n\
- Open apps and websites with open, for example open https://www.youtube.com/results?search_query=bella+ciao.\n\
- If a click changed nothing, look again and try another way: another element, the keyboard, scroll, or wait for loading.\n\
- Do exactly what {user_name} asks. If they say not to do something, never do it. When a choice is theirs (which item, size, address, payment), stop and ask them in your reply.\n\
- Reply to {user_name} in short, plain sentences in the language they write in. Say what you did and what you found.\n\
- For their family, tablets, doctor visits, messages or where things are at home, use the saathi tool. {extra}"
    )
}

fn tool(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    json!({ "type": "function", "function": { "name": name, "description": description, "parameters": { "type": "object", "properties": properties, "required": required } } })
}

pub fn tools() -> Value {
    let s = |d: &str| json!({ "type": "string", "description": d });
    let n = |d: &str| json!({ "type": "number", "description": d });
    let b = |d: &str| json!({ "type": "boolean", "description": d });
    json!([
        tool("look", "Read the screen again and list its controls and text.", json!({}), &[]),
        tool("click", "Move the cursor to something and click it.", json!({ "target": s("An E or T number, the words on it, or @x,y"), "button": s("left (default), right or middle"), "double": b("Double-click") }), &["target"]),
        tool("hover", "Move the cursor over something without clicking.", json!({ "target": s("An E or T number, words, or @x,y") }), &["target"]),
        tool("type", "Type text where the cursor last clicked.", json!({ "text": s("Text to type"), "enter": b("Press Enter afterwards") }), &["text"]),
        tool("key", "Press a key or shortcut, such as enter, escape, tab, ctrl+l, alt+tab, shift+., page_down.", json!({ "keys": s("Keys joined with +"), "times": n("How many times, default 1") }), &["keys"]),
        tool("scroll", "Scroll the page or a part of it.", json!({ "direction": s("up, down, left or right"), "amount": n("Notches, default 5"), "target": s("Optional: where to scroll, as an E or T number or words") }), &["direction"]),
        tool("drag", "Drag from one thing to another.", json!({ "from": s("Start: E or T number, words, or @x,y"), "to": s("End: E or T number, words, or @x,y") }), &["from", "to"]),
        tool("open", "Open an app by name, a website address, a file or a folder.", json!({ "target": s("For example chrome, notepad, https://www.ajio.com") }), &["target"]),
        tool("focus", "Bring a window to the front by part of its title.", json!({ "title": s("Part of the window title") }), &["title"]),
        tool("clipboard", "Read the text on the clipboard (after you copy something with ctrl+c).", json!({}), &[]),
        tool("find", "Find where some words appear on screen without clicking.", json!({ "text": s("Words to find") }), &["text"]),
        tool("wait", "Wait for something to load, then look again.", json!({ "seconds": n("Default 2") }), &[]),
        tool("run", "Run a PowerShell command and get its output.", json!({ "command": s("PowerShell command"), "timeout_seconds": n("Default 60") }), &["command"]),
        tool("saathi", "Ask Saathi, the family care app on this PC.", json!({ "tool": s("what_day_is_it, get_medication_schedule, confirm_medication_taken, get_upcoming_appointments, get_family_messages, send_message_to_family, daily_check_in, ask_family_for_help, report_suspicious_call, where_is, list_memory_stories, family_summary"), "arguments_json": s("Arguments as a JSON object, for example {}") }), &["tool"]),
    ])
}

pub fn request(messages: &[Value], model: &str) -> Value {
    json!({
        "model": model,
        "messages": messages,
        "tools": tools(),
        "tool_choice": "auto",
        "parallel_tool_calls": false,
        "temperature": 0.3,
        "max_completion_tokens": 3000,
        "reasoning_effort": "medium",
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct Call {
    pub id: String,
    pub name: String,
    pub args: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Reply {
    pub text: String,
    pub calls: Vec<Call>,
    pub message: Value,
    pub cut_off: bool,
}

pub fn parse(body: &str) -> Result<Reply, String> {
    let v: Value = serde_json::from_str(body).map_err(|_| format!("Groq sent something unreadable: {}", body.chars().take(160).collect::<String>()))?;
    if let Some(e) = v.get("error") {
        return Err(e.get("message").and_then(Value::as_str).unwrap_or("Groq error").to_string());
    }
    let msg = v.pointer("/choices/0/message").cloned().ok_or("Groq sent no message")?;
    let text = msg.get("content").and_then(Value::as_str).unwrap_or("").trim().to_string();
    let mut seen_ids = std::collections::HashSet::new();
    let calls = msg
        .get("tool_calls")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|c| {
                    let f = c.get("function")?;
                    let args = f.get("arguments").and_then(Value::as_str).and_then(|s| serde_json::from_str(s).ok()).unwrap_or_else(|| json!({}));
                    let id = c.get("id")?.as_str()?.to_string();
                    seen_ids.insert(id.clone()).then_some(())?;
                    Some(Call { id, name: f.get("name")?.as_str()?.trim().to_string(), args })
                })
                .collect()
        })
        .unwrap_or_default();
    let mut message = json!({ "role": "assistant", "content": text });
    if text.is_empty() && msg.get("tool_calls").is_some() {
        message["content"] = Value::Null;
    }
    if let Some(tc) = msg.get("tool_calls") {
        message["tool_calls"] = tc.clone();
    }
    let cut_off = v.pointer("/choices/0/finish_reason").and_then(Value::as_str) == Some("length");
    Ok(Reply { text, calls, message, cut_off })
}

pub fn tool_result(call: &Call, content: &str) -> Value {
    json!({ "role": "tool", "tool_call_id": call.id, "content": content })
}

pub fn describe(call: &Call) -> String {
    let a = &call.args;
    let g = |k: &str| a.get(k).map(|v| v.as_str().map(String::from).unwrap_or_else(|| v.to_string())).unwrap_or_default();
    match call.name.as_str() {
        "click" => format!("click {}{}", g("target"), if a.get("double").and_then(Value::as_bool) == Some(true) { " (double)" } else { "" }),
        "hover" => format!("hover over {}", g("target")),
        "type" => format!("type \"{}\"{}", g("text").chars().take(60).collect::<String>(), if a.get("enter").and_then(Value::as_bool) == Some(true) { " + Enter" } else { "" }),
        "key" => format!("press {}", g("keys")),
        "scroll" => format!("scroll {}", g("direction")),
        "drag" => format!("drag {} to {}", g("from"), g("to")),
        "open" => format!("open {}", g("target")),
        "focus" => format!("switch to {}", g("title")),
        "clipboard" => "read the clipboard".into(),
        "find" => format!("find \"{}\"", g("text")),
        "wait" => "wait".into(),
        "look" => "look at the screen".into(),
        "run" => format!("run {}", g("command").chars().take(60).collect::<String>()),
        "saathi" => format!("ask Saathi: {}", g("tool")),
        other => other.to_string(),
    }
}

pub fn compact(messages: &mut Vec<Value>) {
    let last_tool = messages.iter().rposition(|m| m.get("role").and_then(Value::as_str) == Some("tool"));
    for (i, m) in messages.iter_mut().enumerate() {
        if Some(i) == last_tool || m.get("role").and_then(Value::as_str) != Some("tool") {
            continue;
        }
        if let Some(c) = m.get("content").and_then(Value::as_str) {
            if let Some((head, _)) = c.split_once("\nWindow in front:") {
                let short = format!("{head}\n(older screen description removed)");
                m["content"] = json!(short);
            }
        }
    }
    while messages.len() > 120 {
        let cut = messages.iter().skip(2).position(|m| m.get("role").and_then(Value::as_str) == Some("user")).map(|p| p + 2);
        match cut {
            Some(c) if c > 1 => {
                let next_user = messages.iter().skip(c + 1).position(|m| m.get("role").and_then(Value::as_str) == Some("user")).map(|p| p + c + 1).unwrap_or(messages.len());
                messages.drain(1..next_user.min(messages.len() - 1).max(2));
            }
            _ => {
                messages.remove(1);
            }
        }
    }
}

pub fn shrink(messages: &mut Vec<Value>) -> bool {
    let role = |m: &Value| m.get("role").and_then(Value::as_str).unwrap_or("").to_string();
    if let Some(next) = messages.iter().skip(2).position(|m| role(m) == "user").map(|p| p + 2) {
        messages.drain(1..next);
        return true;
    }
    let longest = messages.iter().enumerate().skip(1).filter_map(|(i, m)| m.get("content").and_then(Value::as_str).map(|c| (i, c.chars().count()))).max_by_key(|(_, n)| *n);
    match longest {
        Some((i, n)) if n > 600 => {
            let keep: String = messages[i]["content"].as_str().unwrap_or("").chars().take(n / 2).collect();
            messages[i]["content"] = json!(format!("{keep}\n(cut short to fit)"));
            true
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_request_targets_gpt_oss_120b_with_the_mover_tools() {
        let r = request(&[json!({"role":"user","content":"hi"})], MODEL);
        assert_eq!(r["model"], "openai/gpt-oss-120b");
        let names: Vec<&str> = r["tools"].as_array().unwrap().iter().map(|t| t["function"]["name"].as_str().unwrap()).collect();
        for n in ["look", "click", "type", "key", "scroll", "open", "find", "wait", "saathi"] {
            assert!(names.contains(&n), "{n}");
        }
        assert!(system_prompt("Akshat", "").contains("Mover"));
    }

    #[test]
    fn replies_and_tool_calls_are_read() {
        let body = r#"{"choices":[{"message":{"role":"assistant","content":"Opening YouTube.","tool_calls":[{"id":"c1","type":"function","function":{"name":"open","arguments":"{\"target\":\"https://www.youtube.com\"}"}}]}}]}"#;
        let r = parse(body).unwrap();
        assert_eq!(r.text, "Opening YouTube.");
        assert_eq!(r.calls, vec![Call { id: "c1".into(), name: "open".into(), args: json!({"target":"https://www.youtube.com"}) }]);
        assert_eq!(r.message["tool_calls"][0]["id"], "c1");
        assert_eq!(describe(&r.calls[0]), "open https://www.youtube.com");
        assert_eq!(parse(r#"{"error":{"message":"Rate limit reached. Please try again in 2s."}}"#).unwrap_err(), "Rate limit reached. Please try again in 2s.");
        let plain = parse(r#"{"choices":[{"message":{"role":"assistant","content":"Done!"}}]}"#).unwrap();
        assert!(plain.calls.is_empty());
        assert!(parse("<html>").is_err());
    }

    #[test]
    fn old_screen_descriptions_are_trimmed_but_the_latest_is_kept() {
        let mut m = vec![json!({"role":"system","content":"s"}), json!({"role":"user","content":"go"})];
        for i in 0..3 {
            m.push(json!({"role":"assistant","content":"","tool_calls":[]}));
            m.push(json!({"role":"tool","tool_call_id":format!("c{i}"),"content":format!("Clicked {i}\nWindow in front: X\nE1 Button \"A\" @1,1")}));
        }
        compact(&mut m);
        let tools: Vec<&str> = m.iter().filter(|x| x["role"] == "tool").map(|x| x["content"].as_str().unwrap()).collect();
        assert!(tools[0].contains("older screen description removed"));
        assert!(tools[2].contains("Window in front: X"));
        let mut long: Vec<Value> = vec![json!({"role":"system","content":"s"})];
        for i in 0..200 {
            long.push(json!({"role": if i % 2 == 0 { "user" } else { "assistant" }, "content": format!("m{i}")}));
        }
        compact(&mut long);
        assert!(long.len() <= 120);
        assert_eq!(long[0]["role"], "system");
    }

    #[test]
    fn shrink_drops_the_oldest_turn_then_cuts_long_text() {
        let mut m = vec![
            json!({"role":"system","content":"s"}),
            json!({"role":"user","content":"first"}),
            json!({"role":"assistant","content":"ok"}),
            json!({"role":"user","content":"x".repeat(2000)}),
        ];
        assert!(shrink(&mut m));
        assert_eq!(m.len(), 2);
        assert_eq!(m[1]["role"], "user");
        assert!(shrink(&mut m));
        assert!(m[1]["content"].as_str().unwrap().chars().count() < 1100);
        let mut tiny = vec![json!({"role":"system","content":"s"}), json!({"role":"user","content":"hi"})];
        assert!(!shrink(&mut tiny));
    }
}
