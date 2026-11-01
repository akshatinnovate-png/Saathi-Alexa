use crate::protocol::Failure;
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
        Some(retry_after.map_or(wait, |r| r.max(Duration::from_millis(500)).min(Duration::from_secs(300))))
    }
}

pub fn retry_after_from(reason: &str) -> Option<Duration> {
    let r = reason.to_ascii_lowercase();
    let at = r.find("retry")?;
    let tail = &r[at..];
    let digits: String = tail.chars().skip_while(|c| !c.is_ascii_digit()).take_while(|c| c.is_ascii_digit() || *c == '.').collect();
    let secs: f64 = digits.parse().ok()?;
    if secs.is_finite() && secs > 0.0 && secs < 3600.0 { Some(Duration::from_millis((secs * 1000.0) as u64)) } else { None }
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
        assert_eq!(r.failed(Failure::Network, Some(Duration::from_secs(7))).unwrap(), Duration::from_secs(7));
        assert_eq!(retry_after_from("Quota exceeded. Please retry in 12.5s."), Some(Duration::from_millis(12500)));
        assert_eq!(retry_after_from("nothing here"), None);
    }
}
