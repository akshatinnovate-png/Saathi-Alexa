#![forbid(unsafe_code)]

pub const MINUTE: u64 = 60_000;
pub const DAY: u64 = 24 * 60 * MINUTE;
pub const FRESH_FOR: u64 = 15 * MINUTE;
pub const TOUCH_EVERY: u64 = 5 * MINUTE;
pub const CLOCK_SKEW: u64 = 2 * MINUTE;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub enum Kind {
    User,
    Device,
}

impl Kind {
    pub const fn idle(self) -> u64 {
        match self {
            Kind::User => 7 * DAY,
            Kind::Device => 90 * DAY,
        }
    }

    pub const fn absolute(self) -> u64 {
        match self {
            Kind::User => 30 * DAY,
            Kind::Device => 400 * DAY,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub struct Session {
    pub kind: Kind,
    pub created: u64,
    pub last_seen: u64,
    pub reauth: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Valid,
    Expired,
    Idle,
    Inconsistent,
}

impl State {
    pub fn code(self) -> &'static str {
        match self {
            State::Valid => "valid",
            State::Expired => "expired",
            State::Idle => "idle",
            State::Inconsistent => "inconsistent",
        }
    }
}

pub fn state(s: Session, now: u64) -> State {
    if s.last_seen < s.created || s.created > now.saturating_add(CLOCK_SKEW) || s.last_seen > now.saturating_add(CLOCK_SKEW) {
        return State::Inconsistent;
    }
    if let Some(r) = s.reauth {
        if r < s.created || r > now.saturating_add(CLOCK_SKEW) {
            return State::Inconsistent;
        }
    }
    if now > s.created.saturating_add(s.kind.absolute()) {
        return State::Expired;
    }
    if now > s.last_seen.saturating_add(s.kind.idle()) {
        return State::Idle;
    }
    State::Valid
}

pub fn fresh(s: Session, now: u64) -> bool {
    if state(s, now) != State::Valid {
        return false;
    }
    let at = match s.reauth {
        Some(r) if r > s.created => r,
        _ => s.created,
    };
    at <= now.saturating_add(CLOCK_SKEW) && now.saturating_sub(at) <= FRESH_FOR
}

pub fn touch(s: Session, now: u64) -> Option<Session> {
    if state(s, now) != State::Valid {
        return None;
    }
    if now.saturating_sub(s.last_seen) > TOUCH_EVERY {
        Some(Session { last_seen: now.max(s.last_seen), ..s })
    } else {
        Some(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T0: u64 = 1_800_000_000_000;

    fn user(created: u64) -> Session {
        Session { kind: Kind::User, created, last_seen: created, reauth: None }
    }

    #[test]
    fn lifetimes() {
        let s = user(T0);
        assert_eq!(state(s, T0), State::Valid);
        assert_eq!(state(s, T0 + 7 * DAY + 1), State::Idle);
        let mut active = s;
        for day in 1..=29 {
            active = touch(active, T0 + day * DAY).unwrap();
        }
        assert_eq!(state(active, T0 + 30 * DAY), State::Valid);
        assert_eq!(state(active, T0 + 30 * DAY + 1), State::Expired);
        assert_eq!(touch(active, T0 + 31 * DAY), None);
    }

    #[test]
    fn freshness() {
        let s = user(T0);
        assert!(fresh(s, T0 + 14 * MINUTE));
        assert!(!fresh(s, T0 + 16 * MINUTE));
        let r = Session { reauth: Some(T0 + DAY), last_seen: T0 + DAY, ..s };
        assert!(fresh(r, T0 + DAY + MINUTE));
        let forged = Session { reauth: Some(T0 + 10 * DAY), ..s };
        assert!(!fresh(forged, T0 + DAY));
    }

    #[test]
    fn tampered_records_are_refused() {
        let s = Session { last_seen: T0 - 1, ..user(T0) };
        assert_eq!(state(s, T0), State::Inconsistent);
        assert_eq!(state(user(T0 + DAY), T0), State::Inconsistent);
    }
}

#[cfg(kani)]
mod proofs {
    use super::*;

    #[kani::proof]
    fn valid_sessions_respect_both_limits() {
        let s: Session = kani::any();
        let now: u64 = kani::any();
        if state(s, now) == State::Valid {
            assert!(now <= s.created.saturating_add(s.kind.absolute()));
            assert!(now <= s.last_seen.saturating_add(s.kind.idle()));
            assert!(s.last_seen >= s.created);
        }
    }

    #[kani::proof]
    fn touching_never_extends_the_absolute_limit() {
        let s: Session = kani::any();
        let now: u64 = kani::any();
        let later: u64 = kani::any();
        if let Some(t) = touch(s, now) {
            assert!(t.created == s.created && t.kind == s.kind);
            if state(t, later) == State::Valid {
                assert!(later <= s.created.saturating_add(s.kind.absolute()));
            }
        }
    }

    #[kani::proof]
    fn dead_sessions_stay_dead() {
        let s: Session = kani::any();
        let now: u64 = kani::any();
        kani::assume(state(s, now) == State::Expired);
        assert!(touch(s, now).is_none());
        assert!(!fresh(s, now));
    }

    #[kani::proof]
    fn freshness_is_bounded() {
        let s: Session = kani::any();
        let now: u64 = kani::any();
        if fresh(s, now) {
            let at = match s.reauth { Some(r) if r > s.created => r, _ => s.created };
            assert!(now.saturating_sub(at) <= FRESH_FOR);
            assert!(state(s, now) == State::Valid);
        }
    }
}
