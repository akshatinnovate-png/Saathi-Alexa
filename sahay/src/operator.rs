use serde_json::{json, Value};
use std::collections::VecDeque;

pub const DEFAULT_MODELS: &[&str] = &["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
pub const HOST: &str = "generativelanguage.googleapis.com";
pub const MAX_STEPS: usize = 250;

pub fn system(user_name: &str, extra: &str) -> String {
    format!(
        "You operate a Windows computer for {user_name} to finish the goal you are given. Every turn you get a screenshot of the screen, \
the window in front, and a numbered list of the controls in that window with their positions. Choose exactly one tool call per turn. \
Prefer click_element with a number from the list; use click with x and y from 0 to 1000 across the screenshot only when the thing is not in the list. \
To search or fill a box: click it, then type_text (press_enter true to submit). Use press_keys for shortcuts (ctrl+l focuses the browser address bar; \
on YouTube, k pauses or plays, shift+. speeds up, shift+, slows down; escape closes pop-ups). Use open for apps and websites \
(for example open https://www.youtube.com/results?search_query=bella+ciao to search YouTube directly). \
After each action look at the new screenshot: if nothing changed, try another way (another element, keyboard, scroll, wait). Never repeat the same failing action more than twice. \
Skip ads when a Skip button appears. Close cookie and sign-in pop-ups unless signing in is needed. \
Follow the user's updates exactly; they override the goal. If an update says not to do something (for example do not place the order), never do it. \
When a choice belongs to {user_name} (which product, size, address, payment), use ask_user and wait; offer the options you can see. \
Use say only for important moments (found it, need you, done), at most once every few steps, in one short sentence. \
Call done when the goal is complete, or when it truly cannot be done, with a one-sentence summary. {extra}"
    )
}

fn decl(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    json!({ "name": name, "description": description, "parameters": { "type": "OBJECT", "properties": properties, "required": required } })
}

pub fn declarations() -> Value {
    let num = |d: &str| json!({ "type": "NUMBER", "description": d });
    let int = |d: &str| json!({ "type": "INTEGER", "description": d });
    let s = |d: &str| json!({ "type": "STRING", "description": d });
    let b = |d: &str| json!({ "type": "BOOLEAN", "description": d });
    json!([
        decl("click_element", "Click a control by its number from the list.", json!({ "id": int("Control number"), "button": s("left, right or middle"), "double": b("Double-click") }), &["id"]),
        decl("click", "Click a point on the screenshot, x and y from 0 to 1000.", json!({ "x": num("0 left to 1000 right"), "y": num("0 top to 1000 bottom"), "button": s("left, right or middle"), "double": b("Double-click") }), &["x", "y"]),
        decl("type_text", "Type text where the keyboard focus is.", json!({ "text": s("Text to type"), "press_enter": b("Press Enter after typing") }), &["text"]),
        decl("press_keys", "Press a key or shortcut such as enter, escape, ctrl+l, alt+tab, shift+., page_down.", json!({ "keys": s("Keys joined with +"), "times": int("Repeat count") }), &["keys"]),
        decl("scroll", "Scroll the page.", json!({ "direction": s("up, down, left or right"), "amount": int("Notches, default 5"), "x": num("optional 0 to 1000"), "y": num("optional 0 to 1000") }), &["direction"]),
        decl("drag", "Drag between two points (0 to 1000).", json!({ "x1": num("start x"), "y1": num("start y"), "x2": num("end x"), "y2": num("end y") }), &["x1", "y1", "x2", "y2"]),
        decl("open", "Open an app by name, a website address, a file or a folder.", json!({ "target": s("App name, URL, or path") }), &["target"]),
        decl("run_command", "Run a PowerShell command and see its output.", json!({ "command": s("PowerShell command"), "timeout_seconds": int("Default 60") }), &["command"]),
        decl("focus_window", "Bring a window to the front by part of its title.", json!({ "title": s("Part of the title") }), &["title"]),
        decl("wait", "Wait for something to load.", json!({ "seconds": num("Default 2") }), &[]),
        decl("read_file", "Read a text file.", json!({ "path": s("Full path") }), &["path"]),
        decl("write_file", "Write a text file.", json!({ "path": s("Full path"), "text": s("Contents") }), &["path", "text"]),
        decl("clipboard", "Read the clipboard, or set it when text is given.", json!({ "text": s("Optional text") }), &[]),
        decl("saathi", "Ask Saathi, the family care app on this PC (tablets, visits, family messages, where things are at home, help).", json!({ "tool": s("Saathi tool name"), "arguments_json": s("Arguments as a JSON object") }), &["tool"]),
        decl("ask_user", "Ask the user a question and wait for the answer.", json!({ "question": s("Short question, with the options you can see") }), &["question"]),
        decl("say", "Tell the user something short without waiting.", json!({ "message": s("One short sentence") }), &["message"]),
        decl("done", "The goal is finished, or cannot be done.", json!({ "summary": s("One sentence for the user") }), &["summary"]),
    ])
}

pub fn request(model: &str, system: &str, text: &str, jpeg_b64: Option<&str>) -> Value {
    let mut parts = vec![json!({ "text": text })];
    if let Some(img) = jpeg_b64 {
        parts.push(json!({ "inlineData": { "mimeType": "image/jpeg", "data": img } }));
    }
    let mut generation = json!({ "temperature": 0.2, "maxOutputTokens": 2048 });
    if model.starts_with("gemini-2.5") {
        generation["thinkingConfig"] = json!({ "thinkingBudget": 512 });
    }
    json!({
        "systemInstruction": { "parts": [{ "text": system }] },
        "contents": [{ "role": "user", "parts": parts }],
        "tools": [{ "functionDeclarations": declarations() }],
        "toolConfig": { "functionCallingConfig": { "mode": "ANY" } },
        "generationConfig": generation,
    })
}

pub fn parse(body: &str) -> Result<Vec<(String, Value)>, String> {
    let v: Value = serde_json::from_str(body).map_err(|_| format!("Unreadable answer: {}", body.chars().take(200).collect::<String>()))?;
    if let Some(e) = v.get("error") {
        return Err(e.get("message").and_then(Value::as_str).unwrap_or("error").to_string());
    }
    let parts = v.pointer("/candidates/0/content/parts").and_then(Value::as_array).cloned().unwrap_or_default();
    let calls: Vec<(String, Value)> = parts
        .iter()
        .filter_map(|p| p.get("functionCall"))
        .filter_map(|c| Some((c.get("name")?.as_str()?.to_string(), c.get("args").cloned().unwrap_or_else(|| json!({})))))
        .collect();
    if calls.is_empty() {
        let reason = v.pointer("/candidates/0/finishReason").and_then(Value::as_str).unwrap_or("no action");
        return Err(format!("The model gave no action ({reason})"));
    }
    Ok(calls)
}

pub struct Memory {
    pub goal: String,
    pub updates: Vec<String>,
    pub log: VecDeque<String>,
    pub steps: usize,
    pub last_result: String,
}

impl Memory {
    pub fn new(goal: &str) -> Self {
        Self { goal: goal.trim().to_string(), updates: Vec::new(), log: VecDeque::new(), steps: 0, last_result: "Nothing done yet.".into() }
    }

    pub fn record(&mut self, name: &str, args: &Value, result: &str) {
        self.steps += 1;
        let args: String = args.to_string().chars().take(160).collect();
        let result: String = result.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(220).collect();
        self.log.push_back(format!("{}. {name} {args} -> {result}", self.steps));
        while self.log.len() > 30 {
            self.log.pop_front();
        }
        self.last_result = result;
    }

    pub fn repeating(&self) -> bool {
        let tail: Vec<&String> = self.log.iter().rev().take(3).collect();
        tail.len() == 3 && tail.iter().all(|l| l.split_once(' ').map(|x| x.1) == tail[0].split_once(' ').map(|x| x.1))
    }

    pub fn prompt(&self, window: &str, elements: &str) -> String {
        let mut t = format!("GOAL: {}\n", self.goal);
        if !self.updates.is_empty() {
            t.push_str("UPDATES FROM THE USER (newest last, these override the goal):\n");
            for u in &self.updates {
                t.push_str(&format!("- {u}\n"));
            }
        }
        if !self.log.is_empty() {
            t.push_str("STEPS SO FAR:\n");
            for l in &self.log {
                t.push_str(l);
                t.push('\n');
            }
        }
        if self.repeating() {
            t.push_str("WARNING: the last three steps were the same. Do something different now.\n");
        }
        t.push_str(&format!("LAST RESULT: {}\nWINDOW IN FRONT: {window}\nCONTROLS:\n{}\nThe screenshot is attached. Choose the next single action.", self.last_result, if elements.trim().is_empty() { "(none could be read; use click with coordinates from the screenshot)" } else { elements }));
        t
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_force_an_action_and_carry_the_screenshot() {
        let r = request("gemini-2.5-flash", "sys", "do it", Some("QUJD"));
        assert_eq!(r.pointer("/toolConfig/functionCallingConfig/mode").unwrap(), "ANY");
        assert_eq!(r.pointer("/contents/0/parts/1/inlineData/mimeType").unwrap(), "image/jpeg");
        assert!(r.pointer("/generationConfig/thinkingConfig").is_some());
        assert!(request("gemini-2.0-flash", "s", "t", None).pointer("/generationConfig/thinkingConfig").is_none());
        let names: Vec<&str> = r.pointer("/tools/0/functionDeclarations").unwrap().as_array().unwrap().iter().map(|d| d["name"].as_str().unwrap()).collect();
        for n in ["click_element", "click", "type_text", "press_keys", "open", "ask_user", "done", "saathi"] {
            assert!(names.contains(&n), "{n}");
        }
    }

    #[test]
    fn answers_become_actions_or_clear_errors() {
        let ok = r#"{"candidates":[{"content":{"parts":[{"text":"thinking"},{"functionCall":{"name":"click_element","args":{"id":4}}}]}}]}"#;
        assert_eq!(parse(ok).unwrap(), vec![("click_element".to_string(), json!({"id":4}))]);
        assert_eq!(parse(r#"{"error":{"code":429,"message":"Resource has been exhausted"}}"#).unwrap_err(), "Resource has been exhausted");
        assert!(parse(r#"{"candidates":[{"finishReason":"SAFETY","content":{"parts":[]}}]}"#).unwrap_err().contains("SAFETY"));
        assert!(parse("<html>").is_err());
    }

    #[test]
    fn memory_keeps_updates_and_notices_loops() {
        let mut m = Memory::new(" play bella ciao on youtube ");
        m.updates.push("make it 1.5x speed".into());
        for _ in 0..3 {
            m.record("click", &json!({"x":10,"y":10}), "Clicked");
        }
        assert!(m.repeating());
        let p = m.prompt("YouTube - Google Chrome", "#1 Edit \"Search\" @300,40");
        assert!(p.starts_with("GOAL: play bella ciao on youtube\n"));
        assert!(p.contains("- make it 1.5x speed"));
        assert!(p.contains("WARNING"));
        assert!(p.contains("#1 Edit"));
        m.record("press_keys", &json!({"keys":"k"}), "Pressed k");
        assert!(!m.repeating());
        for _ in 0..40 {
            m.record("wait", &json!({}), "ok");
        }
        assert_eq!(m.log.len(), 30);
        assert!(m.prompt("w", "").contains("use click with coordinates"));
    }
}
