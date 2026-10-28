#![forbid(unsafe_code)]

use crate::{chain, policy, session};
use alloc::string::String;
use alloc::vec::Vec;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(tag = "op")]
enum Request {
    #[serde(rename = "version")]
    Version,
    #[serde(rename = "actions")]
    Actions,
    #[serde(rename = "decide")]
    Decide { principal: PrincipalIn, action: String, household: String },
    #[serde(rename = "tool")]
    Tool { caller: CallerIn, tool: String, exposed: bool },
    #[serde(rename = "session")]
    Session { kind: String, created: u64, #[serde(rename = "lastSeen")] last_seen: u64, #[serde(rename = "reauthAt")] reauth_at: Option<u64>, now: u64 },
    #[serde(rename = "chain.link")]
    Link { key: String, prev: String, canonical: String },
    #[serde(rename = "chain.verify")]
    Verify { key: String, rows: Vec<RowIn>, head: Option<HeadIn> },
}

#[derive(Deserialize)]
struct PrincipalIn {
    kind: String,
    household: Option<String>,
    role: Option<String>,
}

#[derive(Deserialize)]
struct CallerIn {
    local: Option<bool>,
    scopes: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct RowIn {
    seq: u64,
    canonical: String,
    mac: String,
}

#[derive(Deserialize)]
struct HeadIn {
    seq: u64,
    mac: String,
}

fn role(name: Option<&str>) -> Result<Option<policy::Role>, String> {
    Ok(match name {
        None => None,
        Some("owner") => Some(policy::Role::Owner),
        Some("member") => Some(policy::Role::Member),
        Some("neighbour") => Some(policy::Role::Neighbour),
        Some(other) => return Err(alloc::format!("unknown role {other}")),
    })
}

fn principal(p: &PrincipalIn, target: &str) -> Result<policy::Principal, String> {
    let id = |h: &Option<String>| h.as_deref().map(|h| if h == target { 1u32 } else { 2u32 });
    Ok(match p.kind.as_str() {
        "anonymous" => policy::Principal::Anonymous,
        "open" => policy::Principal::Open { household: id(&p.household).ok_or("open caller without household")? },
        "device" => policy::Principal::Device { household: id(&p.household).ok_or("device without household")? },
        "user" => policy::Principal::User { household: id(&p.household), role: role(p.role.as_deref())? },
        other => return Err(alloc::format!("unknown principal {other}")),
    })
}

fn key(b64: &str) -> Result<Vec<u8>, String> {
    let k = STANDARD.decode(b64).map_err(|_| String::from("key is not base64"))?;
    if k.len() < 32 {
        return Err(String::from("key is shorter than 32 bytes"));
    }
    Ok(k)
}

fn handle(req: Request) -> Result<Value, String> {
    Ok(match req {
        Request::Version => json!({ "version": crate::VERSION }),
        Request::Actions => json!({
            "actions": policy::Action::ALL.iter().map(|a| json!({ "name": a.name(), "level": alloc::format!("{:?}", a.level()) })).collect::<Vec<_>>(),
            "tools": policy::Tool::ALL.iter().map(|t| t.name()).collect::<Vec<_>>(),
        }),
        Request::Decide { principal: p, action, household } => {
            let a = policy::Action::parse(&action).ok_or_else(|| alloc::format!("unknown action {action}"))?;
            match policy::decide(principal(&p, &household)?, a, 1) {
                Ok(()) => json!({ "ok": true }),
                Err(d) => json!({ "ok": false, "status": d.status(), "code": d.code() }),
            }
        }
        Request::Tool { caller, tool, exposed } => {
            let t = policy::Tool::parse(&tool).ok_or_else(|| alloc::format!("unknown tool {tool}"))?;
            let c = if caller.local == Some(true) {
                policy::Caller::Local
            } else {
                let s = caller.scopes.unwrap_or_default();
                policy::Caller::Token(policy::Scopes {
                    elder: s.iter().any(|x| x == "saathi/elder"),
                    family: s.iter().any(|x| x == "saathi/family"),
                })
            };
            json!({ "ok": policy::may_call(c, t, exposed) })
        }
        Request::Session { kind, created, last_seen, reauth_at, now } => {
            let kind = match kind.as_str() {
                "user" => session::Kind::User,
                "device" => session::Kind::Device,
                other => return Err(alloc::format!("unknown session kind {other}")),
            };
            let s = session::Session { kind, created, last_seen, reauth: reauth_at };
            let st = session::state(s, now);
            let touched = session::touch(s, now).map(|t| t.last_seen != s.last_seen).unwrap_or(false);
            json!({ "state": st.code(), "valid": st == session::State::Valid, "fresh": session::fresh(s, now), "touch": touched })
        }
        Request::Link { key: k, prev, canonical } => json!({ "mac": chain::link(&key(&k)?, &prev, &canonical) }),
        Request::Verify { key: k, rows, head } => {
            let rows: Vec<(u64, String, String)> = rows.into_iter().map(|r| (r.seq, r.canonical, r.mac)).collect();
            match chain::verify(&key(&k)?, &rows, head.map(|h| (h.seq, h.mac))) {
                Ok(n) => json!({ "ok": true, "entries": n }),
                Err(b) => json!({ "ok": false, "brokenAt": b.at(), "reason": b.reason() }),
            }
        }
    })
}

pub fn call(input: &str) -> String {
    let out = serde_json::from_str::<Request>(input)
        .map_err(|e| alloc::format!("bad request: {e}"))
        .and_then(handle)
        .unwrap_or_else(|e| json!({ "error": e }));
    out.to_string()
}

#[cfg(test)]
mod tests {
    use super::call;

    #[test]
    fn json_round_trip() {
        assert!(call(r#"{"op":"decide","principal":{"kind":"user","household":"h1","role":"neighbour"},"action":"care.read","household":"h1"}"#).contains(r#""code":"neighbour-cannot""#));
        assert!(call(r#"{"op":"decide","principal":{"kind":"user","household":"h2","role":"owner"},"action":"status","household":"h1"}"#).contains("other-household"));
        assert!(call(r#"{"op":"decide","principal":{"kind":"device","household":"h1"},"action":"status","household":"h1"}"#).contains(r#""ok":true"#));
        assert!(call(r#"{"op":"tool","caller":{"local":true},"tool":"where_is","exposed":true}"#).contains(r#""ok":false"#));
        assert!(call(r#"{"op":"nope"}"#).contains("error"));
        assert!(call("not json").contains("error"));
        assert!(call(r#"{"op":"chain.link","key":"c2hvcnQ=","prev":"a","canonical":"b"}"#).contains("shorter"));
    }
}
