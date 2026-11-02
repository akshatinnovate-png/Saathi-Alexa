use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    pub keys: Vec<String>,
    pub model: String,
    pub name: String,
    pub color: [u8; 3],
    pub position: Option<(i32, i32)>,
    pub extra: String,
    pub speak: bool,
    pub memory: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self { keys: Vec::new(), model: crate::agent::MODEL.into(), name: "you".into(), color: [99, 102, 241], position: None, extra: String::new(), speak: true, memory: Vec::new() }
    }
}

pub fn remember(memory: &mut Vec<String>, fact: &str) {
    let fact = fact.trim();
    if fact.is_empty() {
        return;
    }
    let lower = fact.to_lowercase();
    memory.retain(|m| m.to_lowercase() != lower);
    memory.push(fact.chars().take(300).collect());
    while memory.len() > 60 {
        memory.remove(0);
    }
}

pub fn split_keys(text: &str) -> Vec<String> {
    let mut keys: Vec<String> = text.split([',', ' ', '\n', '\r', ';', '\t']).map(|k| k.trim().trim_matches(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '-'))).filter(|k| k.len() >= 20 && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')).map(String::from).collect();
    keys.dedup();
    keys
}

impl Config {
    pub fn from_json(text: &str, unseal: impl Fn(&str) -> Option<String>) -> Self {
        let mut c = Config::default();
        let Ok(v) = serde_json::from_str::<Value>(text) else { return c };
        c.keys = v.get("sealedGroqKeys").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).filter_map(&unseal).filter(|k| !k.is_empty()).collect()).unwrap_or_default();
        if let Some(m) = v.get("groqModel").and_then(Value::as_str).filter(|m| !m.trim().is_empty()) {
            c.model = m.trim().chars().take(80).collect();
        }
        if let Some(s) = v.get("name").and_then(Value::as_str).filter(|s| !s.trim().is_empty()) {
            c.name = s.trim().chars().take(60).collect();
        }
        if let Some(a) = v.get("color").and_then(Value::as_array) {
            let p: Vec<u8> = a.iter().filter_map(Value::as_u64).map(|x| x.min(255) as u8).collect();
            if p.len() == 3 {
                c.color = [p[0], p[1], p[2]];
            }
        }
        if let (Some(x), Some(y)) = (v.pointer("/position/0").and_then(Value::as_i64), v.pointer("/position/1").and_then(Value::as_i64)) {
            c.position = Some((x as i32, y as i32));
        }
        if let Some(a) = v.get("memory").and_then(Value::as_array) {
            c.memory = a.iter().filter_map(Value::as_str).map(|m| m.chars().take(300).collect()).take(60).collect();
        }
        if let Some(b) = v.get("speak").and_then(Value::as_bool) {
            c.speak = b;
        }
        if let Some(s) = v.get("instructions").and_then(Value::as_str) {
            c.extra = s.chars().take(4000).collect();
        }
        c
    }

    pub fn to_json(&self, seal: impl Fn(&str) -> Option<String>) -> String {
        let sealed: Vec<String> = self.keys.iter().filter_map(|k| seal(k)).collect();
        serde_json::to_string_pretty(&json!({
            "sealedGroqKeys": sealed,
            "groqModel": self.model,
            "name": self.name,
            "color": self.color,
            "position": self.position.map(|(x, y)| vec![x, y]),
            "instructions": self.extra,
            "speak": self.speak,
            "memory": self.memory,
        }))
        .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_round_trip_and_keys_are_only_stored_sealed() {
        let c = Config { keys: vec!["gsk_aaaaaaaaaaaaaaaaaaaaaaaa".into(), "gsk_bbbbbbbbbbbbbbbbbbbbbbbb".into()], name: "Akshat".into(), color: [10, 20, 30], position: Some((100, 200)), ..Config::default() };
        let text = c.to_json(|k| Some(format!("sealed:{}", k.chars().rev().collect::<String>())));
        assert!(!text.contains("gsk_aaaa"), "a raw key never reaches the file");
        let back = Config::from_json(&text, |s| s.strip_prefix("sealed:").map(|r| r.chars().rev().collect()));
        assert_eq!(back, c);
        assert_eq!(back.model, "openai/gpt-oss-120b");
        let mut mem = vec!["I use Edge".to_string()];
        remember(&mut mem, "my son is Ravi");
        remember(&mut mem, "i use edge");
        assert_eq!(mem, vec!["my son is Ravi".to_string(), "i use edge".to_string()]);
    }

    #[test]
    fn old_gemini_settings_ask_for_a_groq_key_and_broken_files_fall_back() {
        let old = Config::from_json(r#"{"sealedKeys":["x"],"models":["gemini-3.8-live"],"name":"Akshat"}"#, |_| Some("AIza-old".into()));
        assert!(old.keys.is_empty());
        assert_eq!(old.name, "Akshat");
        assert_eq!(Config::from_json("{", |_| None), Config::default());
        assert_eq!(split_keys("gsk_aaaaaaaaaaaaaaaaaaaaaaaa, gsk_bbbbbbbbbbbbbbbbbbbbbbbb\nshort"), vec!["gsk_aaaaaaaaaaaaaaaaaaaaaaaa", "gsk_bbbbbbbbbbbbbbbbbbbbbbbb"]);
    }

    #[test]
    fn pasted_keys_are_cleaned_up() {
        let k = "gsk_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd";
        assert_eq!(split_keys(&format!("\"{k}\"")), vec![k.to_string()]);
        assert_eq!(split_keys(&format!("Bearer {k}\r\n")), vec![k.to_string()]);
        assert_eq!(split_keys(&format!("{k}, {k}")), vec![k.to_string()]);
        assert!(split_keys("hello").is_empty());
    }
}
