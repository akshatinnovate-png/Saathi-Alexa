#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    Quota,
    BadModel,
    BadKey,
    Network,
}

pub fn classify(status: u16, body: &str) -> Failure {
    let r = body.to_ascii_lowercase();
    match status {
        429 => Failure::Quota,
        401 | 403 => Failure::BadKey,
        404 => Failure::BadModel,
        400 if r.contains("api key") || r.contains("api_key") => Failure::BadKey,
        400 if r.contains("model") && (r.contains("not found") || r.contains("does not exist") || r.contains("decommissioned")) => Failure::BadModel,
        _ if r.contains("rate limit") || r.contains("rate_limit") || r.contains("quota") => Failure::Quota,
        _ => Failure::Network,
    }
}

use std::time::Duration;

#[derive(Debug, Clone)]
pub struct Rotation {
    keys: usize,
    models: usize,
    key: usize,
    model: usize,
    attempt: u32,
    dead_keys: Vec<bool>,
    dead_models: Vec<bool>,
    seed: u64,
}

impl Rotation {
    pub fn new(keys: usize, models: usize, seed: u64) -> Self {
        Self { keys: keys.max(1), models: models.max(1), key: 0, model: 0, attempt: 0, dead_keys: vec![false; keys.max(1)], dead_models: vec![false; models.max(1)], seed: seed | 1 }
    }

    pub fn current(&self) -> (usize, usize) {
        (self.key, self.model)
    }

    pub fn connected(&mut self) {
        self.attempt = 0;
    }

    fn next_alive(dead: &[bool], from: usize) -> Option<usize> {
        (1..=dead.len()).map(|i| (from + i) % dead.len()).find(|&i| !dead[i])
    }

    fn jitter(&mut self) -> u64 {
        self.seed ^= self.seed << 13;
        self.seed ^= self.seed >> 7;
        self.seed ^= self.seed << 17;
        self.seed % 1000
    }

    pub fn failed(&mut self, failure: Failure, retry_after: Option<Duration>) -> Option<Duration> {
        self.attempt = self.attempt.saturating_add(1);
        match failure {
            Failure::BadKey => {
                self.dead_keys[self.key] = true;
                self.key = Self::next_alive(&self.dead_keys, self.key)?;
                return Some(Duration::from_millis(200));
            }
            Failure::BadModel => {
                self.dead_models[self.model] = true;
                self.model = Self::next_alive(&self.dead_models, self.model)?;
                return Some(Duration::from_millis(200));
            }
            Failure::Quota => {
                let rotate_key = self.keys > 1 && (self.attempt as usize) % (self.models + 1) != 0;
                if rotate_key {
                    if let Some(k) = Self::next_alive(&self.dead_keys, self.key) {
                        self.key = k;
                    }
                } else if let Some(m) = Self::next_alive(&self.dead_models, self.model) {
                    self.model = m;
                }
                let tried_all = self.attempt as usize >= self.keys * self.models;
                if !tried_all {
                    return Some(Duration::from_millis(400));
                }
            }
            Failure::Network => {}
        }
        let base = 1000u64.saturating_mul(1 << (self.attempt.min(6) - 1).min(6));
        let wait = Duration::from_millis(base.min(60_000) + self.jitter());
        Some(retry_after.map_or(wait, |r| (r + Duration::from_millis(300)).min(Duration::from_secs(600))))
    }
}

fn go_duration(text: &str) -> Option<f64> {
    let mut total = 0.0;
    let mut num = String::new();
    let mut any = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c.is_ascii_digit() || c == '.' {
            num.push(c);
            continue;
        }
        let Ok(value) = num.parse::<f64>() else { break };
        num.clear();
        let unit = match c {
            'h' => 3600.0,
            'm' if chars.peek() == Some(&'s') => {
                chars.next();
                0.001
            }
            'm' => 60.0,
            's' => 1.0,
            _ => {
                if !any {
                    total = value;
                    any = true;
                }
                break;
            }
        };
        total += value * unit;
        any = true;
    }
    if !any {
        if let Ok(v) = num.parse::<f64>() {
            total = v;
            any = true;
        }
    }
    any.then_some(total)
}

pub fn retry_after_from(reason: &str) -> Option<Duration> {
    let r = reason.to_ascii_lowercase();
    let at = ["try again in", "retry after", "retry in"].iter().find_map(|k| r.find(k).map(|i| i + k.len()))?;
    let tail = r[at..].trim_start();
    let secs = go_duration(tail)?;
    if secs.is_finite() && secs > 0.0 && secs < 86_400.0 { Some(Duration::from_millis((secs * 1000.0).round() as u64)) } else { None }
}

pub fn estimate_tokens(body_chars: usize, answer_budget: usize) -> usize {
    body_chars / 4 + answer_budget
}

#[derive(Debug, Clone)]
pub struct Pacer {
    per_minute: usize,
    sent: Vec<(std::time::Instant, usize)>,
}

impl Pacer {
    pub fn new(per_minute: usize) -> Self {
        Self { per_minute: per_minute.max(1000), sent: Vec::new() }
    }

    pub fn wait_for(&mut self, now: std::time::Instant, tokens: usize) -> Duration {
        let window = Duration::from_secs(60);
        self.sent.retain(|(t, _)| now.duration_since(*t) < window);
        let mut used: usize = self.sent.iter().map(|(_, n)| n).sum();
        if used + tokens <= self.per_minute {
            return Duration::ZERO;
        }
        for (t, n) in &self.sent {
            used -= n;
            if used + tokens <= self.per_minute {
                return (window - now.duration_since(*t)) + Duration::from_millis(250);
            }
        }
        self.sent.last().map(|(t, _)| window - now.duration_since(*t)).unwrap_or(Duration::ZERO) + Duration::from_millis(250)
    }

    pub fn record(&mut self, now: std::time::Instant, tokens: usize) {
        self.sent.push((now, tokens));
    }

    pub fn correct_last(&mut self, actual: usize) {
        if let Some(last) = self.sent.last_mut() {
            last.1 = actual;
        }
    }

    pub fn slow_down(&mut self) {
        self.per_minute = (self.per_minute * 3 / 4).max(1000);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bad_key_moves_to_the_next_and_none_left_gives_up() {
        let mut r = Rotation::new(2, 1, 7);
        assert!(r.failed(Failure::BadKey, None).is_some());
        assert_eq!(r.current().0, 1);
        assert!(r.failed(Failure::BadKey, None).is_none());
    }

    #[test]
    fn a_missing_model_falls_back_to_the_next_model() {
        let mut r = Rotation::new(1, 3, 7);
        r.failed(Failure::BadModel, None);
        assert_eq!(r.current().1, 1);
        r.failed(Failure::BadModel, None);
        assert_eq!(r.current().1, 2);
        assert!(r.failed(Failure::BadModel, None).is_none());
    }

    #[test]
    fn quota_rotates_keys_and_models_quickly_then_backs_off_but_never_stops() {
        let mut r = Rotation::new(2, 2, 7);
        let mut seen = std::collections::HashSet::new();
        seen.insert(r.current());
        let mut quick = 0;
        for _ in 0..3 {
            let d = r.failed(Failure::Quota, None).unwrap();
            if d < Duration::from_secs(1) {
                quick += 1;
            }
            seen.insert(r.current());
        }
        assert!(quick >= 2, "the first retries switch key or model straight away");
        assert!(seen.len() >= 3, "it tries other keys and models: {seen:?}");
        for _ in 0..50 {
            let d = r.failed(Failure::Quota, None).unwrap();
            assert!(d <= Duration::from_secs(61));
        }
        r.connected();
        assert!(r.failed(Failure::Network, None).unwrap() < Duration::from_secs(3));
    }

    #[test]
    fn network_errors_back_off_exponentially_with_a_cap_and_honour_retry_after() {
        let mut r = Rotation::new(1, 1, 3);
        let waits: Vec<Duration> = (0..9).map(|_| r.failed(Failure::Network, None).unwrap()).collect();
        assert!(waits[0] < Duration::from_secs(3));
        assert!(waits[4] > waits[0]);
        assert!(waits.iter().all(|w| *w <= Duration::from_secs(61)));
        assert_eq!(r.failed(Failure::Network, Some(Duration::from_secs(7))).unwrap(), Duration::from_millis(7300));
        assert_eq!(retry_after_from("Quota exceeded. Please retry in 12.5s."), Some(Duration::from_millis(12500)));
        assert_eq!(retry_after_from("nothing here"), None);
        assert_eq!(retry_after_from("Rate limit reached for model openai/gpt-oss-120b. Please try again in 7.66s."), Some(Duration::from_millis(7660)));
        assert_eq!(classify(429, ""), Failure::Quota);
        assert_eq!(classify(401, "Invalid API Key"), Failure::BadKey);
        assert_eq!(classify(400, "The model `x` does not exist"), Failure::BadModel);
        assert_eq!(classify(503, "upstream"), Failure::Network);
    }

    #[test]
    fn groq_wait_times_are_read_in_every_form() {
        assert_eq!(retry_after_from("Please try again in 7.66s. Need more tokens?"), Some(Duration::from_millis(7660)));
        assert_eq!(retry_after_from("Please try again in 1m2.5s."), Some(Duration::from_millis(62_500)));
        assert_eq!(retry_after_from("Please try again in 250ms."), Some(Duration::from_millis(250)));
        assert_eq!(retry_after_from("Please try again in 2h3m."), Some(Duration::from_secs(7380)));
        assert_eq!(retry_after_from("retry after 12"), Some(Duration::from_secs(12)));
        assert_eq!(retry_after_from("no hint here"), None);
    }

    #[test]
    fn the_pacer_waits_before_the_minute_limit_instead_of_hitting_it() {
        let start = std::time::Instant::now();
        let mut p = Pacer::new(8000);
        assert_eq!(p.wait_for(start, 3000), Duration::ZERO);
        p.record(start, 3000);
        assert_eq!(p.wait_for(start + Duration::from_secs(5), 3000), Duration::ZERO);
        p.record(start + Duration::from_secs(5), 3000);
        let w = p.wait_for(start + Duration::from_secs(10), 3000);
        assert!(w > Duration::from_secs(49) && w < Duration::from_secs(51), "{w:?}");
        assert_eq!(p.wait_for(start + Duration::from_secs(61), 3000), Duration::ZERO);
        p.slow_down();
        assert_eq!(p.per_minute, 6000);
        assert_eq!(estimate_tokens(9000, 500), 2750);
        p.record(start, 100);
        p.correct_last(2500);
        assert_eq!(p.sent.last().unwrap().1, 2500);
    }
}
