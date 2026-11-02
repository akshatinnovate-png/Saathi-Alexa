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

#[derive(Debug)]
pub struct Fleet {
    pub models: Vec<(String, usize)>,
    keys: usize,
    pacers: std::collections::HashMap<(usize, usize), Pacer>,
    cooling: std::collections::HashMap<(usize, usize), std::time::Instant>,
    dead_models: Vec<bool>,
    dead_keys: Vec<bool>,
}

pub enum Pick {
    Go(usize, usize),
    Wait(Duration),
    Exhausted,
}

impl Fleet {
    pub fn new(keys: usize, models: Vec<(String, usize)>) -> Self {
        let n = models.len();
        Self { models, keys: keys.max(1), pacers: Default::default(), cooling: Default::default(), dead_models: vec![false; n], dead_keys: vec![false; keys.max(1)] }
    }

    fn pacer(&mut self, k: usize, m: usize) -> &mut Pacer {
        let tpm = self.models[m].1;
        self.pacers.entry((k, m)).or_insert_with(|| Pacer::new(tpm))
    }

    pub fn pick(&mut self, now: std::time::Instant, tokens: usize) -> Pick {
        let mut soonest: Option<Duration> = None;
        for m in 0..self.models.len() {
            if self.dead_models[m] {
                continue;
            }
            for k in 0..self.keys {
                if self.dead_keys[k] {
                    continue;
                }
                let cool = self.cooling.get(&(k, m)).map(|t| t.saturating_duration_since(now)).unwrap_or(Duration::ZERO);
                let wait = cool.max(self.pacer(k, m).wait_for(now, tokens));
                if wait.is_zero() {
                    return Pick::Go(k, m);
                }
                soonest = Some(soonest.map_or(wait, |s| s.min(wait)));
            }
        }
        soonest.map_or(Pick::Exhausted, Pick::Wait)
    }

    pub fn sent(&mut self, k: usize, m: usize, now: std::time::Instant, tokens: usize) {
        self.pacer(k, m).record(now, tokens);
    }

    pub fn used(&mut self, k: usize, m: usize, actual: usize) {
        self.pacer(k, m).correct_last(actual);
    }

    pub fn limited(&mut self, k: usize, m: usize, now: std::time::Instant, retry: Option<Duration>) {
        self.pacer(k, m).slow_down();
        self.cooling.insert((k, m), now + retry.unwrap_or(Duration::from_secs(20)).max(Duration::from_secs(2)));
    }

    pub fn rest(&mut self, k: usize, m: usize, now: std::time::Instant, d: Duration) {
        self.cooling.insert((k, m), now + d);
    }

    pub fn drop_model(&mut self, m: usize) {
        self.dead_models[m] = true;
    }

    pub fn drop_key(&mut self, k: usize) {
        self.dead_keys[k] = true;
    }

    pub fn keys_left(&self) -> bool {
        self.dead_keys.iter().any(|d| !d)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn the_fleet_moves_to_the_next_model_instead_of_pausing() {
        let now = std::time::Instant::now();
        let mut f = Fleet::new(1, vec![("big".into(), 8000), ("small".into(), 8000), ("other".into(), 30000)]);
        let go = |p: Pick| match p {
            Pick::Go(k, m) => (k, m),
            _ => panic!("expected a model"),
        };
        assert_eq!(go(f.pick(now, 3000)), (0, 0));
        f.sent(0, 0, now, 3000);
        f.sent(0, 0, now, 3000);
        assert_eq!(go(f.pick(now, 3000)), (0, 1), "the first model is full this minute");
        f.limited(0, 1, now, Some(Duration::from_secs(30)));
        assert_eq!(go(f.pick(now, 3000)), (0, 2));
        f.drop_model(2);
        match f.pick(now, 3000) {
            Pick::Wait(d) => assert!(d <= Duration::from_secs(61)),
            _ => panic!("everything is busy, so it waits"),
        }
        assert_eq!(go(f.pick(now + Duration::from_secs(61), 3000)), (0, 0));
        f.drop_key(0);
        assert!(!f.keys_left());
        assert!(matches!(f.pick(now, 10), Pick::Exhausted));
    }
}
