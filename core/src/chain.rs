#![forbid(unsafe_code)]

use alloc::string::String;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use subtle::ConstantTimeEq;

pub const GENESIS: &str = "saathi-audit-genesis";

pub type Row = (u64, String, String);
pub type Head = (u64, String);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Broken {
    Gap(u64),
    Changed(u64),
    Truncated(u64),
}

impl Broken {
    pub fn at(self) -> u64 {
        match self {
            Broken::Gap(n) | Broken::Changed(n) | Broken::Truncated(n) => n,
        }
    }

    pub fn reason(self) -> &'static str {
        match self {
            Broken::Gap(_) => "an entry is missing or out of order",
            Broken::Changed(_) => "an entry was changed",
            Broken::Truncated(_) => "recent entries were removed",
        }
    }
}

pub fn verify_with<T, B, F, E>(genesis: T, rows: &[(u64, B, T)], head: Option<(u64, T)>, mac: F, same: E) -> Result<u64, Broken>
where
    T: Clone,
    F: Fn(&T, &B) -> T,
    E: Fn(&T, &T) -> bool,
{
    let mut prev = genesis;
    let mut count: u64 = 0;
    for (seq, body, tag) in rows {
        let expected_seq = count + 1;
        if *seq != expected_seq {
            return Err(Broken::Gap(*seq));
        }
        if !same(&mac(&prev, body), tag) {
            return Err(Broken::Changed(*seq));
        }
        prev = tag.clone();
        count = expected_seq;
    }
    match head {
        None if count == 0 => Ok(0),
        Some((n, tag)) if n == count && same(&tag, &prev) => Ok(count),
        _ => Err(Broken::Truncated(count + 1)),
    }
}

pub fn link(key: &[u8], prev: &str, canonical: &str) -> String {
    let mut m = <Hmac<Sha256> as Mac>::new_from_slice(key).expect("hmac accepts any key length");
    m.update(prev.as_bytes());
    m.update(b"\n");
    m.update(canonical.as_bytes());
    URL_SAFE_NO_PAD.encode(m.finalize().into_bytes())
}

pub fn verify(key: &[u8], rows: &[Row], head: Option<Head>) -> Result<u64, Broken> {
    verify_with(
        String::from(GENESIS),
        rows,
        head,
        |prev: &String, body: &String| link(key, prev, body),
        |a: &String, b: &String| a.len() == b.len() && bool::from(a.as_bytes().ct_eq(b.as_bytes())),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec::Vec;

    fn chain(key: &[u8], bodies: &[&str]) -> (Vec<Row>, Option<Head>) {
        let mut prev = String::from(GENESIS);
        let mut rows = Vec::new();
        for (i, b) in bodies.iter().enumerate() {
            let mac = link(key, &prev, b);
            rows.push((i as u64 + 1, String::from(*b), mac.clone()));
            prev = mac;
        }
        let head = rows.last().map(|r| (r.0, r.2.clone()));
        (rows, head)
    }

    #[test]
    fn matches_the_javascript_format() {
        assert_eq!(link(b"k", GENESIS, "{}"), "It87tNROInZc9Oplio7LteHN91HVKlIBFvA-P7oWLPo");
    }

    #[test]
    fn detects_every_kind_of_tampering() {
        let key = b"audit-key";
        let (rows, head) = chain(key, &["a", "b", "c", "d"]);
        assert_eq!(verify(key, &rows, head.clone()), Ok(4));
        let mut edited = rows.clone();
        edited[1].1 = String::from("B");
        assert_eq!(verify(key, &edited, head.clone()), Err(Broken::Changed(2)));
        let mut deleted = rows.clone();
        deleted.remove(2);
        assert_eq!(verify(key, &deleted, head.clone()), Err(Broken::Gap(4)));
        let truncated = rows[..3].to_vec();
        assert_eq!(verify(key, &truncated, head.clone()), Err(Broken::Truncated(4)));
        assert_eq!(verify(b"other", &rows, head), Err(Broken::Changed(1)));
        assert_eq!(verify(key, &[], None), Ok(0));
    }
}

#[cfg(kani)]
mod proofs {
    use super::*;

    const N: usize = 3;

    fn model_mac(prev: &u64, body: &u8) -> u64 {
        prev.wrapping_mul(257).wrapping_add(*body as u64 + 1)
    }

    fn honest(bodies: [u8; N]) -> ([(u64, u8, u64); N], (u64, u64)) {
        let mut prev = 0u64;
        let mut rows = [(0u64, 0u8, 0u64); N];
        let mut i = 0;
        while i < N {
            let tag = model_mac(&prev, &bodies[i]);
            rows[i] = (i as u64 + 1, bodies[i], tag);
            prev = tag;
            i += 1;
        }
        (rows, (N as u64, prev))
    }

    #[kani::proof]
    #[kani::unwind(5)]
    fn honest_chains_verify() {
        let bodies: [u8; N] = kani::any();
        let (rows, head) = honest(bodies);
        assert!(verify_with(0u64, &rows, Some(head), model_mac, |a, b| a == b) == Ok(N as u64));
    }

    #[kani::proof]
    #[kani::unwind(5)]
    fn an_edited_entry_is_detected() {
        let bodies: [u8; N] = kani::any();
        let (mut rows, head) = honest(bodies);
        let i: usize = kani::any();
        kani::assume(i < N);
        let replacement: u8 = kani::any();
        kani::assume(replacement != rows[i].1);
        rows[i].1 = replacement;
        assert!(verify_with(0u64, &rows, Some(head), model_mac, |a, b| a == b).is_err());
    }

    #[kani::proof]
    #[kani::unwind(5)]
    fn a_deleted_or_truncated_entry_is_detected() {
        let bodies: [u8; N] = kani::any();
        let (rows, head) = honest(bodies);
        let i: usize = kani::any();
        kani::assume(i < N);
        let mut kept = [(0u64, 0u8, 0u64); N];
        let mut len = 0;
        let mut j = 0;
        while j < N {
            if j != i {
                kept[len] = rows[j];
                len += 1;
            }
            j += 1;
        }
        assert!(verify_with(0u64, &kept[..len], Some(head), model_mac, |a, b| a == b).is_err());
    }

    #[kani::proof]
    #[kani::unwind(5)]
    fn verification_implies_contiguous_sequence() {
        let rows: [(u64, u8, u64); N] = kani::any();
        let head: Option<(u64, u64)> = kani::any();
        if let Ok(n) = verify_with(0u64, &rows, head, model_mac, |a, b| a == b) {
            assert!(n == N as u64);
            let mut k = 0;
            while k < N {
                assert!(rows[k].0 == k as u64 + 1);
                k += 1;
            }
        }
    }
}
