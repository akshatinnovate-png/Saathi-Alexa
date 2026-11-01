use serde_json::{json, Value};

pub const LIVE_URL: &str = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

pub const DEFAULT_MODELS: &[&str] = &[
    "gemini-2.5-flash-native-audio-preview-09-2025",
    "gemini-live-2.5-flash-preview",
    "gemini-2.0-flash-live-001",
];

pub fn instructions(user_name: &str, extra: &str) -> String {
    format!(
        "You are Sahay, a live voice partner who operates this Windows computer for {user_name}. \
You can see the screen as a stream of images and you can act on the computer with your tools. \
Do whatever {user_name} asks, completely and without asking permission for each step. \
Work step by step: act, then look at the new screen, then act again, until the job is done. \
Speak briefly while you work, in the language {user_name} uses, so they know what you are doing. \
{user_name} may talk while you are working. Listen: a new instruction changes the plan immediately, \
acknowledge it in a few words and carry on with the changed plan. If they say stop, wait, or do not press something, obey at once. \
When a choice is theirs (which item, which size, which address), ask, wait for the answer, then continue. \
Prefer click_element with an element number from the latest element list; use click with 0 to 1000 screen coordinates when no element fits. \
To type into a box, click it first, then type_text. Use press_keys for shortcuts such as ctrl+l, enter, escape, alt+tab. \
Use open for apps, websites and files, and run_command for anything PowerShell can do. \
If an action fails, look again and try another way; never give up after one failure. \
When a website or app needs something only {user_name} can give (a password, an OTP), ask them for it. \
For anything about the family, medicines, doctor visits, messages or where things are at home, use the saathi tool first; it is faster and more accurate than clicking through the Saathi web page. {extra}"
    )
}

fn decl(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    json!({ "name": name, "description": description, "parameters": { "type": "OBJECT", "properties": properties, "required": required } })
}

pub fn tool_declarations() -> Value {
    let num = |d: &str| json!({ "type": "NUMBER", "description": d });
    let int = |d: &str| json!({ "type": "INTEGER", "description": d });
    let s = |d: &str| json!({ "type": "STRING", "description": d });
    let b = |d: &str| json!({ "type": "BOOLEAN", "description": d });
    json!([{ "functionDeclarations": [
        decl("screen_elements", "List the buttons, links, boxes and text of the window in front, each with a number for click_element.", json!({}), &[]),
        decl("click_element", "Click an element by its number from the latest element list.", json!({ "id": int("Element number"), "button": s("left, right or middle"), "double": b("Double-click") }), &["id"]),
        decl("click", "Click at a point on the screen. x and y run from 0 to 1000 across the current screen image.", json!({ "x": num("0 to 1000 from the left"), "y": num("0 to 1000 from the top"), "button": s("left, right or middle"), "double": b("Double-click") }), &["x", "y"]),
        decl("move_mouse", "Move the mouse to a point (0 to 1000 coordinates) to hover.", json!({ "x": num("0 to 1000"), "y": num("0 to 1000") }), &["x", "y"]),
        decl("drag", "Drag from one point to another (0 to 1000 coordinates).", json!({ "x1": num("start x"), "y1": num("start y"), "x2": num("end x"), "y2": num("end y") }), &["x1", "y1", "x2", "y2"]),
        decl("scroll", "Scroll the screen, optionally over a point.", json!({ "direction": s("up, down, left or right"), "amount": int("Notches, default 5"), "x": num("optional 0 to 1000"), "y": num("optional 0 to 1000") }), &["direction"]),
        decl("type_text", "Type text at the keyboard focus. Use \\n for Enter.", json!({ "text": s("Text to type") }), &["text"]),
        decl("press_keys", "Press a key or a shortcut, for example enter, ctrl+l, alt+f4, win+r, ctrl+shift+t, f5, page_down.", json!({ "keys": s("Keys joined with +"), "times": int("How many times, default 1") }), &["keys"]),
        decl("open", "Open an app by name, a website address, a file or a folder.", json!({ "target": s("For example: chrome, notepad, https://www.ajio.com, C:\\\\Users") }), &["target"]),
        decl("run_command", "Run a PowerShell command and get its output. Can do anything PowerShell can.", json!({ "command": s("PowerShell command"), "timeout_seconds": int("Default 60, up to 3600") }), &["command"]),
        decl("read_file", "Read a text file.", json!({ "path": s("Full path") }), &["path"]),
        decl("write_file", "Write a text file, replacing it.", json!({ "path": s("Full path"), "text": s("Contents") }), &["path", "text"]),
        decl("list_windows", "List open windows with their titles.", json!({}), &[]),
        decl("focus_window", "Bring a window to the front by part of its title.", json!({ "title": s("Part of the window title") }), &["title"]),
        decl("clipboard", "Read the clipboard, or write text to it when text is given.", json!({ "text": s("Optional text to put on the clipboard") }), &[]),
        decl("wait", "Wait for a page or app to load, then look again.", json!({ "seconds": num("Default 2") }), &[]),
        decl("look", "Take a fresh, sharp screenshot now.", json!({}), &[]),
        decl("saathi", "Ask Saathi, the family care app running on this PC: tablets and whether they were taken, doctor visits, family messages, sending a message to the family, where things are kept at home, check-ins, calling the family for help, reporting a scam call, memories, the family summary.", json!({ "tool": s("One of: what_day_is_it, who_is, get_medication_schedule, confirm_medication_taken, get_upcoming_appointments, get_family_messages, send_message_to_family, daily_check_in, ask_family_for_help, report_suspicious_call, where_is, save_memory_story, list_memory_stories, family_summary, weekly_family_letter"), "arguments_json": s("The tool's arguments as a JSON object, for example {\"message\":\"I am fine\",\"to\":\"Riya\"} or {}") }), &["tool"]),
    ] }])
}

pub fn setup(model: &str, system: &str, voice: &str, resume_handle: Option<&str>) -> Value {
    let mut resumption = json!({});
    if let Some(h) = resume_handle {
        resumption = json!({ "handle": h });
    }
    json!({ "setup": {
        "model": format!("models/{model}"),
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": { "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": voice } } }
        },
        "systemInstruction": { "parts": [{ "text": system }] },
        "tools": tool_declarations(),
        "realtimeInputConfig": { "automaticActivityDetection": { "silenceDurationMs": 700 } },
        "sessionResumption": resumption,
        "contextWindowCompression": { "slidingWindow": {} },
        "inputAudioTranscription": {},
        "outputAudioTranscription": {}
    } })
}

pub fn audio_chunk(b64: &str) -> Value {
    json!({ "realtimeInput": { "audio": { "data": b64, "mimeType": "audio/pcm;rate=16000" } } })
}

pub fn video_frame(b64_jpeg: &str) -> Value {
    json!({ "realtimeInput": { "video": { "data": b64_jpeg, "mimeType": "image/jpeg" } } })
}

pub fn user_text(text: &str) -> Value {
    json!({ "clientContent": { "turns": [{ "role": "user", "parts": [{ "text": text }] }], "turnComplete": true } })
}

pub fn tool_response(id: &str, name: &str, response: Value) -> Value {
    json!({ "toolResponse": { "functionResponses": [{ "id": id, "name": name, "response": response }] } })
}

#[derive(Debug, Clone, PartialEq)]
pub struct Call {
    pub id: String,
    pub name: String,
    pub args: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Ready,
    Audio(String),
    Interrupted,
    TurnComplete,
    Heard(String),
    Said(String),
    Calls(Vec<Call>),
    Cancelled(Vec<String>),
    Resume(String),
    GoAway,
}

pub fn parse(text: &str) -> Vec<Event> {
    let Ok(v) = serde_json::from_str::<Value>(text) else { return vec![] };
    let mut out = Vec::new();
    if v.get("setupComplete").is_some() {
        out.push(Event::Ready);
    }
    if let Some(sc) = v.get("serverContent") {
        if let Some(parts) = sc.pointer("/modelTurn/parts").and_then(Value::as_array) {
            for p in parts {
                if let Some(d) = p.pointer("/inlineData/data").and_then(Value::as_str) {
                    out.push(Event::Audio(d.to_string()));
                }
            }
        }
        if let Some(t) = sc.pointer("/inputTranscription/text").and_then(Value::as_str) {
            out.push(Event::Heard(t.to_string()));
        }
        if let Some(t) = sc.pointer("/outputTranscription/text").and_then(Value::as_str) {
            out.push(Event::Said(t.to_string()));
        }
        if sc.get("interrupted").and_then(Value::as_bool) == Some(true) {
            out.push(Event::Interrupted);
        }
        if sc.get("turnComplete").and_then(Value::as_bool) == Some(true) {
            out.push(Event::TurnComplete);
        }
    }
    if let Some(calls) = v.pointer("/toolCall/functionCalls").and_then(Value::as_array) {
        let calls: Vec<Call> = calls
            .iter()
            .map(|c| Call {
                id: c.get("id").and_then(Value::as_str).unwrap_or_default().to_string(),
                name: c.get("name").and_then(Value::as_str).unwrap_or_default().to_string(),
                args: c.get("args").cloned().unwrap_or_else(|| json!({})),
            })
            .filter(|c| !c.name.is_empty())
            .collect();
        if !calls.is_empty() {
            out.push(Event::Calls(calls));
        }
    }
    if let Some(ids) = v.pointer("/toolCallCancellation/ids").and_then(Value::as_array) {
        out.push(Event::Cancelled(ids.iter().filter_map(|i| i.as_str().map(String::from)).collect()));
    }
    if let Some(update) = v.get("sessionResumptionUpdate") {
        if update.get("resumable").and_then(Value::as_bool) != Some(false) {
            if let Some(h) = update.get("newHandle").and_then(Value::as_str) {
                if !h.is_empty() {
                    out.push(Event::Resume(h.to_string()));
                }
            }
        }
    }
    if v.get("goAway").is_some() {
        out.push(Event::GoAway);
    }
    out
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    Quota,
    BadModel,
    BadKey,
    Network,
}

pub fn classify(reason: &str) -> Failure {
    let r = reason.to_ascii_lowercase();
    if r.contains("quota") || r.contains("resource_exhausted") || r.contains("rate") || r.contains("429") || r.contains("exceeded") {
        Failure::Quota
    } else if r.contains("api key") || r.contains("api_key") || r.contains("permission") || r.contains("unauthenticated") || r.contains("401") || r.contains("403") {
        Failure::BadKey
    } else if r.contains("model") && (r.contains("not found") || r.contains("not supported") || r.contains("is not") || r.contains("404")) {
        Failure::BadModel
    } else {
        Failure::Network
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_asks_for_voice_resumption_compression_and_every_tool() {
        let s = setup("m1", "be kind", "Kore", Some("h-1"));
        assert_eq!(s.pointer("/setup/model").unwrap(), "models/m1");
        assert_eq!(s.pointer("/setup/sessionResumption/handle").unwrap(), "h-1");
        assert!(s.pointer("/setup/contextWindowCompression/slidingWindow").is_some());
        assert_eq!(s.pointer("/setup/generationConfig/responseModalities/0").unwrap(), "AUDIO");
        let names: Vec<String> = s.pointer("/setup/tools/0/functionDeclarations").unwrap().as_array().unwrap().iter().map(|d| d["name"].as_str().unwrap().to_string()).collect();
        for n in ["click_element", "click", "type_text", "press_keys", "open", "run_command", "scroll", "look", "screen_elements", "saathi"] {
            assert!(names.contains(&n.to_string()), "{n}");
        }
        assert!(setup("m1", "x", "Kore", None).pointer("/setup/sessionResumption/handle").is_none());
    }

    #[test]
    fn server_messages_become_events() {
        let ev = parse(r#"{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AAA="}}]},"outputTranscription":{"text":"Opening Ajio"}}}"#);
        assert_eq!(ev, vec![Event::Audio("AAA=".into()), Event::Said("Opening Ajio".into())]);
        assert_eq!(parse(r#"{"serverContent":{"interrupted":true}}"#), vec![Event::Interrupted]);
        let calls = parse(r#"{"toolCall":{"functionCalls":[{"id":"c1","name":"click","args":{"x":500,"y":20}}]}}"#);
        assert_eq!(calls, vec![Event::Calls(vec![Call { id: "c1".into(), name: "click".into(), args: json!({"x":500,"y":20}) }])]);
        assert_eq!(parse(r#"{"toolCallCancellation":{"ids":["c1","c2"]}}"#), vec![Event::Cancelled(vec!["c1".into(), "c2".into()])]);
        assert_eq!(parse(r#"{"sessionResumptionUpdate":{"newHandle":"abc","resumable":true}}"#), vec![Event::Resume("abc".into())]);
        assert_eq!(parse(r#"{"sessionResumptionUpdate":{"newHandle":"abc","resumable":false}}"#), vec![]);
        assert_eq!(parse(r#"{"goAway":{"timeLeft":"10s"}}"#), vec![Event::GoAway]);
        assert_eq!(parse(r#"{"setupComplete":{}}"#), vec![Event::Ready]);
        assert_eq!(parse("not json"), vec![]);
    }

    #[test]
    fn failures_are_classified_so_the_right_thing_is_retried() {
        assert_eq!(classify("You exceeded your current quota (RESOURCE_EXHAUSTED)"), Failure::Quota);
        assert_eq!(classify("API key not valid. Please pass a valid API key."), Failure::BadKey);
        assert_eq!(classify("models/foo is not found for API version v1beta"), Failure::BadModel);
        assert_eq!(classify("connection reset by peer"), Failure::Network);
    }

    #[test]
    fn outgoing_messages_have_the_live_api_shape() {
        assert_eq!(audio_chunk("QQ==").pointer("/realtimeInput/audio/mimeType").unwrap(), "audio/pcm;rate=16000");
        assert_eq!(video_frame("QQ==").pointer("/realtimeInput/video/mimeType").unwrap(), "image/jpeg");
        assert_eq!(user_text("hi").pointer("/clientContent/turnComplete").unwrap(), true);
        assert_eq!(tool_response("c1", "click", json!({"ok":true})).pointer("/toolResponse/functionResponses/0/id").unwrap(), "c1");
        assert!(instructions("Akshat", "").contains("Akshat"));
    }
}
