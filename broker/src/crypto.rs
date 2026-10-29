use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use zeroize::{Zeroize, Zeroizing};

pub const SALT: &[u8] = b"saathi/keyring/v1";

pub const PURPOSES: &[&str] = &["store", "sessions", "vault", "pepper", "audit", "media", "media-links", "ring-webhook", "class-b"];

pub type Sealed = ([u8; 12], Vec<u8>, Vec<u8>);

pub struct Master(Box<Zeroizing<[u8; 32]>>, bool);

impl Master {
    pub fn new(mut bytes: [u8; 32]) -> Self {
        let boxed = Box::new(Zeroizing::new(bytes));
        bytes.zeroize();
        let locked = crate::harden::lock_memory(boxed.as_ptr(), 32);
        Master(boxed, locked)
    }

    pub fn locked(&self) -> bool {
        self.1
    }

    pub fn bytes(&self) -> &[u8; 32] {
        &self.0
    }

    pub fn fingerprint(&self) -> String {
        use sha2::Digest;
        let d = Sha256::digest(self.0.as_ref().as_slice());
        d.iter().take(8).map(|b| format!("{b:02x}")).collect()
    }

    fn derive(&self, purpose: &str) -> Result<Zeroizing<[u8; 32]>, String> {
        if !PURPOSES.contains(&purpose) {
            return Err(format!("unknown key purpose {purpose}"));
        }
        let hk = Hkdf::<Sha256>::new(Some(SALT), self.0.as_slice());
        let mut out = Zeroizing::new([0u8; 32]);
        hk.expand(format!("saathi/{purpose}").as_bytes(), out.as_mut_slice()).map_err(|_| "hkdf failed".to_string())?;
        Ok(out)
    }

    pub fn hmac(&self, purpose: &str, text_key: bool, data: &[u8]) -> Result<Vec<u8>, String> {
        let key = self.derive(purpose)?;
        let mut text = if text_key { Some(Zeroizing::new(b64url(key.as_slice()).into_bytes())) } else { None };
        let material: &[u8] = match &text {
            Some(t) => t.as_slice(),
            None => key.as_slice(),
        };
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(material).map_err(|_| "bad hmac key".to_string())?;
        mac.update(data);
        let out = mac.finalize().into_bytes().to_vec();
        if let Some(t) = text.as_mut() {
            t.zeroize();
        }
        Ok(out)
    }

    pub fn seal(&self, purpose: &str, plaintext: &[u8], aad: &[u8]) -> Result<Sealed, String> {
        let key = self.derive(purpose)?;
        let cipher = Aes256Gcm::new_from_slice(key.as_slice()).map_err(|_| "bad key".to_string())?;
        let mut iv = [0u8; 12];
        getrandom::getrandom(&mut iv).map_err(|e| format!("no randomness: {e}"))?;
        let mut sealed = cipher.encrypt(Nonce::from_slice(&iv), Payload { msg: plaintext, aad }).map_err(|_| "encryption failed".to_string())?;
        let tag = sealed.split_off(sealed.len() - 16);
        Ok((iv, tag, sealed))
    }

    pub fn open(&self, purpose: &str, iv: &[u8], tag: &[u8], body: &[u8], aad: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
        if iv.len() != 12 || tag.len() != 16 {
            return Err("damaged ciphertext".into());
        }
        let key = self.derive(purpose)?;
        let cipher = Aes256Gcm::new_from_slice(key.as_slice()).map_err(|_| "bad key".to_string())?;
        let mut joined = Vec::with_capacity(body.len() + 16);
        joined.extend_from_slice(body);
        joined.extend_from_slice(tag);
        cipher
            .decrypt(Nonce::from_slice(iv), Payload { msg: &joined, aad })
            .map(Zeroizing::new)
            .map_err(|_| "the data was changed or the key is wrong".to_string())
    }
}

pub fn b64url(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

const ALPHABET: &[u8; 32] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

pub fn recovery_code(master: &Master) -> String {
    use sha2::Digest;
    let check = Sha256::digest(master.bytes());
    let mut data = master.bytes().to_vec();
    data.extend_from_slice(&check[..3]);
    let mut out = String::new();
    let mut acc: u32 = 0;
    let mut bits = 0;
    for byte in data.iter() {
        acc = (acc << 8) | u32::from(*byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(ALPHABET[((acc >> bits) & 31) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(ALPHABET[((acc << (5 - bits)) & 31) as usize] as char);
    }
    data.zeroize();
    let groups: Vec<String> = out.as_bytes().chunks(5).map(|c| String::from_utf8_lossy(c).into_owned()).collect();
    out.zeroize();
    groups.join("-")
}

pub fn parse_recovery_code(text: &str) -> Result<Master, String> {
    use sha2::Digest;
    let clean: String = text.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_uppercase()).collect();
    let mut acc: u32 = 0;
    let mut bits = 0;
    let mut bytes = Zeroizing::new(Vec::new());
    for ch in clean.bytes() {
        let v = ALPHABET.iter().position(|a| *a == ch).ok_or("that recovery key has a letter that is not used in recovery keys")?;
        acc = (acc << 5) | v as u32;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            bytes.push(((acc >> bits) & 0xff) as u8);
        }
    }
    if bytes.len() < 35 {
        return Err("that recovery key is too short".into());
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes[..32]);
    let check = Sha256::digest(key);
    if check[..3] != bytes[32..35] {
        key.zeroize();
        return Err("that recovery key has a typo".into());
    }
    Ok(Master::new(key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derivation_matches_node() {
        let m = Master::new([7u8; 32]);
        let tag = m.hmac("audit", false, b"hello").unwrap();
        assert_eq!(b64url(&tag), "bjw6F1cq83hL1tSyQawoTcDkTL0kCYlxTgMCqq-mBuk");
        assert!(m.hmac("nope", false, b"x").is_err());
    }

    #[test]
    fn seal_round_trip_and_tamper() {
        let m = Master::new([9u8; 32]);
        let (iv, tag, body) = m.seal("vault", b"refresh-token", b"saathi/vault").unwrap();
        assert_eq!(m.open("vault", &iv, &tag, &body, b"saathi/vault").unwrap().as_slice(), b"refresh-token");
        assert!(m.open("vault", &iv, &tag, &body, b"other").is_err());
        assert!(m.open("store", &iv, &tag, &body, b"saathi/vault").is_err());
        let mut bad = body.clone();
        bad[0] ^= 1;
        assert!(m.open("vault", &iv, &tag, &bad, b"saathi/vault").is_err());
    }

    #[test]
    fn recovery_codes_round_trip_and_catch_typos() {
        let m = Master::new([42u8; 32]);
        let code = recovery_code(&m);
        assert_eq!(parse_recovery_code(&code).unwrap().bytes(), m.bytes());
        assert_eq!(parse_recovery_code(&code.to_lowercase().replace('-', " ")).unwrap().bytes(), m.bytes());
        let mut typo = code.into_bytes();
        typo[3] = if typo[3] == b'A' { b'B' } else { b'A' };
        assert!(parse_recovery_code(&String::from_utf8(typo).unwrap()).is_err());
    }
}
