use serde_json::{json, Value};

pub const HOST: &str = "api.groq.com";
pub const PATH: &str = "/openai/v1/chat/completions";
pub const MODEL: &str = "openai/gpt-oss-120b";
pub const MODELS_PATH: &str = "/openai/v1/models";

pub const FLEET: &[(&str, usize)] = &[
    ("openai/gpt-oss-120b", 7600),
    ("openai/gpt-oss-20b", 7600),
    ("meta-llama/llama-4-scout-17b-16e-instruct", 28000),
    ("llama-3.3-70b-versatile", 11000),
    ("moonshotai/kimi-k2-instruct-0905", 9500),
    ("moonshotai/kimi-k2-instruct", 9500),
    ("qwen/qwen3-32b", 5800),
    ("meta-llama/llama-4-maverick-17b-128e-instruct", 5800),
];

pub fn fleet(primary: &str, available: Option<&[String]>) -> Vec<(String, usize)> {
    let mut out: Vec<(String, usize)> = Vec::new();
    let mut push = |id: &str, tpm: usize| {
        if !out.iter().any(|(m, _)| m == id) && available.is_none_or(|a| a.iter().any(|x| x == id)) {
            out.push((id.to_string(), tpm));
        }
    };
    let primary_tpm = FLEET.iter().find(|(m, _)| *m == primary).map(|(_, t)| *t).unwrap_or(7600);
    push(primary, primary_tpm);
    for (m, t) in FLEET {
        push(m, *t);
    }
    if out.is_empty() {
        out.push((MODEL.to_string(), 7600));
    }
    out
}

pub fn model_ids(body: &str) -> Option<Vec<String>> {
    let v: Value = serde_json::from_str(body).ok()?;
    let ids: Vec<String> = v.get("data")?.as_array()?.iter().filter_map(|m| m.get("id").and_then(Value::as_str).map(String::from)).collect();
    (!ids.is_empty()).then_some(ids)
}

pub const SCREEN: &str = "[Screen]";

pub fn with_memory(prompt: String, memory: &[String]) -> String {
    if memory.is_empty() {
        return prompt;
    }
    format!("{prompt}\nThings you know about the user (use them):\n- {}", memory.join("\n- "))
}

pub fn system_prompt(name: &str, extra: &str) -> String {
    let user_name = if name.trim().is_empty() || name.trim().eq_ignore_ascii_case("you") { "the user" } else { name.trim() };
    format!(
        "You are Sahay, {user_name}'s Windows PC helper. You plan; the Mover on the PC acts. A [Screen] lists controls (E#) and text (T#) with x,y 0-1000.\n\
Answer with ONE do_steps call (all steps + say), or reply in text if no PC action is needed. Steps:\n\
open <app|url|browser url> | click/double/right/hover <\"words\"|E#|x,y> | type <text> | key <keys> | scroll down|up <n> | drag <a> to <b>\n\
wait <s> | wait for \"words\" | expect \"words\" | focus <title> | run <PowerShell> | clipboard | remember <fact> | saathi <tool> <json>\n\
media play|pause|next|previous | volume <0-100> | sound on | skip ads | research <web search> | fetch <url> | read\n\
Rules:\n\
- Name targets by their words; use E#/T# only for the current screen. Icons: describe them, e.g. click \"cart icon\".\n\
- Open sites straight at the page needed (search URLs, ms-settings:). Browser: open msedge <url>.\n\
- End with expect \"words that only appear if it worked\".\n\
- Play/pause/resume: always media play / media pause, never keys. Videos/music: add sound on and skip ads.\n\
- Common sense: close cookie banners and blocking pop-ups, skip 'sign in' nags, pick official results, not ads.\n\
- Research and shopping: research and fetch to compare, then reply with the best 3 (name, price, why) and wait for {user_name}'s pick; then add it to the cart. Lists (e.g. lab equipment): write the list, then search and add each as asked.\n\
- Install apps: run winget install --id <Id> -e --accept-source-agreements --accept-package-agreements.\n\
- Act on sensible defaults; ask only before paying, deleting files, or messaging someone not named. Close tabs with ctrl+w, windows with alt+f4.\n\
- If a step fails you get the new screen: diagnose and send a fix.\n\
- Reply in one short sentence in {user_name}'s language. Saathi tools: what_day_is_it, get_medication_schedule, confirm_medication_taken, get_upcoming_appointments, get_family_messages, send_message_to_family, daily_check_in, ask_family_for_help, report_suspicious_call, where_is, list_memory_stories, family_summary. {extra}"
    )
}

pub fn tools() -> Value {
    json!([{ "type": "function", "function": {
        "name": "do_steps",
        "description": "Run a plan on the PC.",
        "parameters": { "type": "object", "properties": {
            "steps": { "type": "array", "items": { "type": "string" }, "description": "Steps in order" },
            "say": { "type": "string", "description": "What to tell the user when done" }
        }, "required": ["steps"] }
    } }])
}

pub fn request(messages: &[Value], model: &str) -> Value {
    let mut r = json!({
        "model": model,
        "messages": messages,
        "tools": tools(),
        "tool_choice": "auto",
        "temperature": 0.2,
        "max_completion_tokens": 1800,
    });
    if model.starts_with("openai/gpt-oss") {
        r["reasoning_effort"] = json!("low");
        r["parallel_tool_calls"] = json!(false);
    } else if model.starts_with("qwen/") {
        r["reasoning_effort"] = json!("none");
    } else {
        r["parallel_tool_calls"] = json!(false);
    }
    r
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
    pub tokens: Option<usize>,
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
    let tokens = v.pointer("/usage/total_tokens").and_then(Value::as_u64).map(|n| n as usize);
    Ok(Reply { text, calls, message, cut_off, tokens })
}

pub fn tool_result(call: &Call, content: &str) -> Value {
    json!({ "role": "tool", "tool_call_id": call.id, "content": content })
}

fn strip_screen(m: &mut Value) {
    if let Some(c) = m.get("content").and_then(Value::as_str) {
        if let Some((head, _)) = c.split_once(SCREEN) {
            m["content"] = json!(format!("{}(old screen removed)", head.trim_end().to_string() + "\n"));
        }
    }
}

pub fn compact(messages: &mut Vec<Value>) {
    let latest = messages.iter().rposition(|m| m.get("content").and_then(Value::as_str).is_some_and(|c| c.contains(SCREEN)));
    for (i, m) in messages.iter_mut().enumerate().skip(1) {
        if Some(i) != latest {
            strip_screen(m);
        }
    }
    while messages.len() > 60 {
        messages.remove(1);
        while messages.len() > 1 && messages[1].get("role").and_then(Value::as_str) == Some("tool") {
            messages.remove(1);
        }
    }
}

pub fn new_task(messages: &mut Vec<Value>) {
    let mut kept: Vec<Value> = Vec::new();
    for m in messages.drain(1..) {
        let role = m.get("role").and_then(Value::as_str).unwrap_or("");
        let text = m.get("content").and_then(Value::as_str).unwrap_or("").trim().to_string();
        match role {
            "user" => {
                let task = text.split(SCREEN).next().unwrap_or("").split("(old screen removed)").next().unwrap_or("").trim().to_string();
                if !task.is_empty() && !task.starts_with('(') {
                    kept.push(json!({ "role": "user", "content": task }));
                }
            }
            "assistant" if !text.is_empty() => kept.push(json!({ "role": "assistant", "content": text })),
            _ => {}
        }
    }
    let start = kept.len().saturating_sub(6);
    messages.extend(kept.into_iter().skip(start));
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
        assert_eq!(r["tools"][0]["function"]["name"], "do_steps");
        assert_eq!(r["reasoning_effort"], "low");
        assert!(request(&[], "llama-3.3-70b-versatile").get("reasoning_effort").is_none());
        let f = fleet("openai/gpt-oss-120b", Some(&["llama-3.3-70b-versatile".to_string(), "openai/gpt-oss-120b".to_string(), "whisper-large-v3".to_string()]));
        assert_eq!(f.iter().map(|(m, _)| m.as_str()).collect::<Vec<_>>(), vec!["openai/gpt-oss-120b", "llama-3.3-70b-versatile"]);
        assert!(fleet("openai/gpt-oss-120b", None).len() >= 6);
        assert_eq!(model_ids(r#"{"data":[{"id":"a"},{"id":"b"}]}"#), Some(vec!["a".to_string(), "b".to_string()]));
        assert!(system_prompt("Akshat", "").contains("Mover"));
        assert!(!system_prompt("you", "").contains("you's"));
    }

    #[test]
    fn replies_and_tool_calls_are_read() {
        let body = r#"{"choices":[{"message":{"role":"assistant","content":"Opening YouTube.","tool_calls":[{"id":"c1","type":"function","function":{"name":"open","arguments":"{\"target\":\"https://www.youtube.com\"}"}}]}}]}"#;
        let r = parse(body).unwrap();
        assert_eq!(r.text, "Opening YouTube.");
        assert_eq!(r.calls, vec![Call { id: "c1".into(), name: "open".into(), args: json!({"target":"https://www.youtube.com"}) }]);
        assert_eq!(r.message["tool_calls"][0]["id"], "c1");
        assert_eq!(parse(r#"{"error":{"message":"Rate limit reached. Please try again in 2s."}}"#).unwrap_err(), "Rate limit reached. Please try again in 2s.");
        let plain = parse(r#"{"choices":[{"message":{"role":"assistant","content":"Done!"}}]}"#).unwrap();
        assert!(plain.calls.is_empty());
        assert!(parse("<html>").is_err());
    }

    #[test]
    fn only_the_newest_screen_is_sent_and_old_tasks_are_folded() {
        let mut m = vec![json!({"role":"system","content":"s"}), json!({"role":"user","content":format!("go\n{SCREEN} Window: A\nE1 Button \"A\" 1,1")})];
        for i in 0..3 {
            m.push(json!({"role":"assistant","content":null,"tool_calls":[{"id":format!("c{i}")}]}));
            m.push(json!({"role":"tool","tool_call_id":format!("c{i}"),"content":format!("Clicked {i}\n{SCREEN} Window: X\nE1 Button \"A\" 1,1")}));
        }
        compact(&mut m);
        let screens = m.iter().filter(|x| x["content"].as_str().is_some_and(|c| c.contains(SCREEN))).count();
        assert_eq!(screens, 1);
        assert!(m.last().unwrap()["content"].as_str().unwrap().contains("Window: X"));
        assert!(m[1]["content"].as_str().unwrap().starts_with("go\n(old screen removed)"));
        m.push(json!({"role":"assistant","content":"Done."}));
        new_task(&mut m);
        assert_eq!(m.len(), 3);
        assert_eq!(m[1]["content"], "go");
        assert_eq!(m[2]["content"], "Done.");
        let mut long: Vec<Value> = vec![json!({"role":"system","content":"s"})];
        for i in 0..200 {
            long.push(json!({"role": if i % 2 == 0 { "user" } else { "assistant" }, "content": format!("m{i}")}));
        }
        compact(&mut long);
        assert!(long.len() <= 60);
        assert_eq!(long[0]["role"], "system");
    }

    #[test]
    fn the_fixed_part_of_every_request_stays_small() {
        let fixed = tools().to_string().len() + system_prompt("Akshat", "").len();
        assert!(with_memory("p".into(), &["likes Edge".into()]).ends_with("- likes Edge"));
        assert!(fixed < 3600, "tools and rules take {fixed} characters");
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
