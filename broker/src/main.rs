#![deny(unsafe_code)]

mod crypto;
mod harden;
mod keystore;
#[cfg(all(target_os = "linux", feature = "tpm"))]
mod tpm_linux;
#[cfg(windows)]
#[allow(unsafe_code)]
mod win;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::PathBuf;

const MAX_FRAME: usize = 96 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
enum Op {
    Ping,
    Hmac { purpose: String, data: String, #[serde(default, rename = "textKey")] text_key: bool },
    Seal { purpose: String, data: String, aad: String },
    Open { purpose: String, iv: String, tag: String, body: String, aad: String },
}

#[derive(Deserialize)]
struct Request {
    id: u64,
    #[serde(flatten)]
    op: Op,
}

fn decode(s: &str) -> Result<Vec<u8>, String> {
    STANDARD.decode(s).map_err(|_| "bad base64".to_string())
}

fn handle(master: &crypto::Master, op: Op) -> Result<Value, String> {
    Ok(match op {
        Op::Ping => json!({ "pong": true }),
        Op::Hmac { purpose, data, text_key } => json!({ "mac": STANDARD.encode(master.hmac(&purpose, text_key, &decode(&data)?)?) }),
        Op::Seal { purpose, data, aad } => {
            let plain = zeroize::Zeroizing::new(decode(&data)?);
            let (iv, tag, body) = master.seal(&purpose, &plain, aad.as_bytes())?;
            json!({ "iv": STANDARD.encode(iv), "tag": STANDARD.encode(tag), "body": STANDARD.encode(body) })
        }
        Op::Open { purpose, iv, tag, body, aad } => {
            let plain = master.open(&purpose, &decode(&iv)?, &decode(&tag)?, &decode(&body)?, aad.as_bytes())?;
            json!({ "data": STANDARD.encode(plain.as_slice()) })
        }
    })
}

fn write_frame(out: &mut impl Write, value: &Value) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(value).unwrap_or_default();
    out.write_all(&(bytes.len() as u32).to_le_bytes())?;
    out.write_all(&bytes)?;
    out.flush()
}

fn serve(dir: PathBuf) -> i32 {
    let mut report = harden::Report::default();
    harden::early(&mut report);
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    let (master, source) = match keystore::load(&dir) {
        Ok(m) => m,
        Err(e) => {
            let _ = write_frame(&mut out, &json!({ "ready": false, "error": e }));
            return 2;
        }
    };
    report.memory_locked = master.locked();
    let lockdown = harden::lockdown(&mut report);
    let hello = json!({
        "ready": true,
        "version": env!("CARGO_PKG_VERSION"),
        "keySource": source,
        "fingerprint": master.fingerprint(),
        "hardening": report,
        "lockdownError": lockdown.err(),
        "tpmAvailable": keystore::status(&dir) == keystore::Source::Tpm,
    });
    if write_frame(&mut out, &hello).is_err() {
        return 3;
    }
    let stdin = std::io::stdin();
    let mut input = stdin.lock();
    loop {
        let mut len = [0u8; 4];
        if input.read_exact(&mut len).is_err() {
            return 0;
        }
        let len = u32::from_le_bytes(len) as usize;
        if len > MAX_FRAME {
            let _ = write_frame(&mut out, &json!({ "id": 0, "error": "frame too large" }));
            return 4;
        }
        let mut buf = zeroize::Zeroizing::new(vec![0u8; len]);
        if input.read_exact(&mut buf).is_err() {
            return 0;
        }
        let reply = match serde_json::from_slice::<Request>(&buf) {
            Ok(req) => match handle(&master, req.op) {
                Ok(mut v) => {
                    v["id"] = json!(req.id);
                    v
                }
                Err(e) => json!({ "id": req.id, "error": e }),
            },
            Err(e) => json!({ "id": 0, "error": format!("bad request: {e}") }),
        };
        if write_frame(&mut out, &reply).is_err() {
            return 0;
        }
    }
}

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let dir = PathBuf::from(arg(&args, "--dir").unwrap_or_else(|| "data".into()));
    let code = match args.get(1).map(String::as_str) {
        Some("serve") => serve(dir),
        Some("protect") => match keystore::protect(&dir, !args.iter().any(|a| a == "--tpm-only")) {
            Ok(p) => {
                println!("{}", json!(p));
                0
            }
            Err(e) => {
                println!("{}", json!({ "error": e }));
                1
            }
        },
        Some("restore") => match arg(&args, "--code").ok_or_else(|| "--code is required".to_string()).and_then(|c| keystore::restore(&dir, &c)) {
            Ok(source) => {
                println!("{}", json!({ "restored": true, "protection": source }));
                0
            }
            Err(e) => {
                println!("{}", json!({ "error": e }));
                1
            }
        },
        Some("status") => {
            println!("{}", json!({ "protection": keystore::status(&dir), "tpmAvailable": keystore::tpm_available(), "version": env!("CARGO_PKG_VERSION") }));
            0
        }
        Some("version") => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            0
        }
        _ => {
            eprintln!("usage: saathi-broker serve|protect|restore|status|version --dir <data folder> [--code <recovery key>]");
            64
        }
    };
    std::process::exit(code);
}
