use serde_json::{json, Value};

pub const LIVE_URL: &str = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

pub const DEFAULT_MODELS: &[&str] = &[
    "gemini-2.5-flash-native-audio-preview-09-2025",
    "gemini-live-2.5-flash-preview",
    "gemini-2.0-flash-live-001",
];

pub fn instructions(user_name: &str, extra: &str) -> String {
    format!(
        "You are Sahay, a quick, warm voice partner for {user_name} on their Windows computer. You have a helper that sees the screen and uses the computer. \
Always answer {user_name} out loud at once, in one short sentence, in the language they speak. \
When they want anything done on the computer, say a few words such as 'On it' and call do_task with one complete goal in English that keeps every detail they gave: the app or site, the item, colour, size, quantity, and anything they said not to do. \
While a task is running, if they add, change or correct something, answer a question, or choose an option, call tell_helper with exactly what they said. \
If they say stop, cancel or leave it, call stop_task. \
Messages that start with [Helper] come from your helper, not from {user_name}: say what they mean in a few words. If it is a question, ask {user_name}, then pass the answer with tell_helper. Never call do_task because of a [Helper] message. \
For their family, tablets, doctor visits, messages, or where things are at home, use the saathi tool. \
You can see the screen in the video; use it to answer questions about what is on the screen. {extra}"
    )
}

fn decl(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    json!({ "name": name, "description": description, "parameters": { "type": "OBJECT", "properties": properties, "required": required } })
}

pub fn tool_declarations() -> Value {
    let s = |d: &str| json!({ "type": "STRING", "description": d });
    json!([{ "functionDeclarations": [
        decl("do_task", "Start doing something on the computer. The helper works in the background and reports with [Helper] messages.", json!({ "goal": s("The complete goal in English, with every detail and every 'do not' the user gave") }), &["goal"]),
        decl("tell_helper", "Pass the user's new instruction, correction, choice or answer to the running task.", json!({ "message": s("What the user said, word for word") }), &["message"]),
        decl("stop_task", "Stop the running task now.", json!({}), &[]),
        decl("saathi", "Ask Saathi, the family care app on this PC: tablets, doctor visits, family messages, sending a message, where things are kept, check-ins, calling for help, reporting a scam call.", json!({ "tool": s("One of: what_day_is_it, who_is, get_medication_schedule, confirm_medication_taken, get_upcoming_appointments, get_family_messages, send_message_to_family, daily_check_in, ask_family_for_help, report_suspicious_call, where_is, save_memory_story, list_memory_stories, family_summary, weekly_family_letter"), "arguments_json": s("Arguments as a JSON object, for example {}") }), &["tool"]),
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
        for n in ["do_task", "tell_helper", "stop_task", "saathi"] {
            assert!(names.contains(&n.to_string()), "{n}");
        }
        assert!(setup("m1", "x", "Kore", None).pointer("/setup/sessionResumption/handle").is_none());
    }

    #[test]
    fn server_messages_become_events() {
        let ev = parse(r#"{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AAA="}}]},"outputTranscription":{"text":"Opening Ajio"}}}"#);
        assert_eq!(ev, vec![Event::Audio("AAA=".into()), Event::Said("Opening Ajio".into())]);
        assert_eq!(parse(r#"{"serverContent":{"interrupted":true}}"#), vec![Event::Interrupted]);
        let calls = parse(r#"{"toolCall":{"functionCalls":[{"id":"c1","name":"do_task","args":{"goal":"play bella ciao"}}]}}"#);
        assert_eq!(calls, vec![Event::Calls(vec![Call { id: "c1".into(), name: "do_task".into(), args: json!({"goal":"play bella ciao"}) }])]);
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
        assert!(instructions("Akshat", "").contains("do_task"));
    }
}
