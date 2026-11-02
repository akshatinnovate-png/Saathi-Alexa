use serde_json::{json, Value};

const RETIRED_DEFAULTS: &[&str] = &["gemini-2.5-flash-native-audio-preview-09-2025", "gemini-live-2.5-flash-preview", "gemini-2.0-flash-live-001"];

#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    pub keys: Vec<String>,
    pub models: Vec<String>,
    pub voice: String,
    pub name: String,
    pub color: [u8; 3],
    pub position: Option<(i32, i32)>,
    pub frame_ms: u64,
    pub extra: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            keys: Vec::new(),
            models: crate::protocol::DEFAULT_MODELS.iter().map(|m| m.to_string()).collect(),
            voice: "Kore".into(),
            name: "you".into(),
            color: [99, 102, 241],
            position: None,
            frame_ms: 1500,
            extra: String::new(),
        }
    }
}

fn strings(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array).map(|a| a.iter().filter_map(|s| s.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()).unwrap_or_default()
}

impl Config {
    pub fn from_json(text: &str, unseal: impl Fn(&str) -> Option<String>) -> Self {
        let mut c = Config::default();
        let Ok(v) = serde_json::from_str::<Value>(text) else { return c };
        c.keys = strings(v.get("sealedKeys")).iter().filter_map(|k| unseal(k)).filter(|k| !k.is_empty()).collect();
        let models = strings(v.get("models"));
        let known = |m: &String| crate::protocol::DEFAULT_MODELS.contains(&m.as_str()) || RETIRED_DEFAULTS.contains(&m.as_str());
        if !models.is_empty() && !models.iter().all(known) {
            c.models = models;
        }
        if let Some(s) = v.get("voice").and_then(Value::as_str).filter(|s| !s.is_empty()) {
            c.voice = s.chars().take(40).collect();
        }
        if let Some(s) = v.get("name").and_then(Value::as_str).filter(|s| !s.trim().is_empty()) {
            c.name = s.trim().chars().take(60).collect();
        }
        if let Some(a) = v.get("color").and_then(Value::as_array) {
            let p: Vec<u8> = a.iter().filter_map(|x| x.as_u64()).map(|x| x.min(255) as u8).collect();
            if p.len() == 3 {
                c.color = [p[0], p[1], p[2]];
            }
        }
        if let (Some(x), Some(y)) = (v.pointer("/position/0").and_then(Value::as_i64), v.pointer("/position/1").and_then(Value::as_i64)) {
            c.position = Some((x as i32, y as i32));
        }
        if let Some(ms) = v.get("frameMs").and_then(Value::as_u64) {
            c.frame_ms = ms.clamp(250, 10_000);
        }
        if let Some(s) = v.get("instructions").and_then(Value::as_str) {
            c.extra = s.chars().take(4000).collect();
        }
        c
    }

    pub fn to_json(&self, seal: impl Fn(&str) -> Option<String>) -> String {
        let sealed: Vec<String> = self.keys.iter().filter_map(|k| seal(k)).collect();
        serde_json::to_string_pretty(&json!({
            "sealedKeys": sealed,
            "models": self.models,
            "voice": self.voice,
            "name": self.name,
            "color": self.color,
            "position": self.position.map(|(x, y)| vec![x, y]),
            "frameMs": self.frame_ms,
            "instructions": self.extra,
        }))
        .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_round_trip_and_keys_are_only_stored_sealed() {
        let c = Config { keys: vec!["AIza-one".into(), "AIza-two".into()], name: "Akshat".into(), color: [10, 20, 30], position: Some((100, 200)), ..Config::default() };
        let text = c.to_json(|k| Some(format!("sealed:{}", k.chars().rev().collect::<String>())));
        assert!(!text.contains("AIza-one"), "a raw key never reaches the file");
        let back = Config::from_json(&text, |s| s.strip_prefix("sealed:").map(|r| r.chars().rev().collect()));
        assert_eq!(back, c);
    }

    #[test]
    fn an_untouched_old_model_list_upgrades_but_a_custom_one_is_kept() {
        let old = Config::from_json(r#"{"models":["gemini-2.5-flash-native-audio-preview-09-2025","gemini-live-2.5-flash-preview"]}"#, |_| None);
        assert_eq!(old.models, Config::default().models);
        assert_eq!(old.models[0], "gemini-3.8-live");
        let custom = Config::from_json(r#"{"models":["my-own-live-model"]}"#, |_| None);
        assert_eq!(custom.models, vec!["my-own-live-model".to_string()]);
    }

    #[test]
    fn broken_or_partial_files_fall_back_to_defaults() {
        assert_eq!(Config::from_json("{", |_| None), Config::default());
        let c = Config::from_json(r#"{"frameMs": 5, "color": [1,2], "models": []}"#, |_| None);
        assert_eq!(c.frame_ms, 250);
        assert_eq!(c.color, Config::default().color);
        assert_eq!(c.models, Config::default().models);
    }
}
