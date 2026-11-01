use crate::crypto::Master;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use zeroize::{Zeroize, Zeroizing};

pub const PLAIN: &str = "saathi.key";
pub const TPM: &str = "saathi.key.tpm";
pub const DPAPI: &str = "saathi.key.dpapi";

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Source {
    Environment,
    Tpm,
    WindowsProtected,
    File,
}

pub fn tpm_available() -> bool {
    #[cfg(all(target_os = "linux", feature = "tpm"))]
    {
        crate::tpm_linux::available()
    }
    #[cfg(windows)]
    {
        crate::win::tpm_available()
    }
    #[cfg(not(any(all(target_os = "linux", feature = "tpm"), windows)))]
    {
        false
    }
}

fn tpm_seal(key: &[u8; 32]) -> Result<Vec<u8>, String> {
    #[cfg(all(target_os = "linux", feature = "tpm"))]
    {
        crate::tpm_linux::seal(key)
    }
    #[cfg(windows)]
    {
        crate::win::tpm_seal(key)
    }
    #[cfg(not(any(all(target_os = "linux", feature = "tpm"), windows)))]
    {
        let _ = key;
        Err("this build has no TPM support".into())
    }
}

fn tpm_unseal(blob: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    #[cfg(all(target_os = "linux", feature = "tpm"))]
    {
        crate::tpm_linux::unseal(blob)
    }
    #[cfg(windows)]
    {
        crate::win::tpm_unseal(blob)
    }
    #[cfg(not(any(all(target_os = "linux", feature = "tpm"), windows)))]
    {
        let _ = blob;
        Err("this build has no TPM support".into())
    }
}

fn dpapi_unseal(blob: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    #[cfg(windows)]
    {
        crate::win::dpapi_unseal(blob)
    }
    #[cfg(not(windows))]
    {
        let _ = blob;
        Err("Windows-protected keys can only be opened on Windows".into())
    }
}

fn dpapi_seal(key: &[u8; 32]) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    {
        crate::win::dpapi_seal(key)
    }
    #[cfg(not(windows))]
    {
        let _ = key;
        Err("Windows key protection is only available on Windows".into())
    }
}

fn decode_plain(text: &str) -> Result<Master, String> {
    use base64::Engine;
    let mut raw = Zeroizing::new(base64::engine::general_purpose::STANDARD.decode(text.trim()).map_err(|_| "the key is not valid base64".to_string())?);
    if raw.len() != 32 {
        return Err("the key must be 32 bytes".into());
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&raw);
    raw.zeroize();
    Ok(Master::new(key))
}

fn from_bytes(bytes: Zeroizing<[u8; 32]>) -> Master {
    Master::new(*bytes)
}

pub fn finish(dir: &Path) -> Result<(), String> {
    if !(dir.join(TPM).exists() || dir.join(DPAPI).exists()) {
        return Err("the key is not protected yet; nothing was removed".into());
    }
    let (_, source) = load(dir)?;
    if source == Source::File || source == Source::Environment {
        return Err("the protected key could not be opened; nothing was removed".into());
    }
    shred(&dir.join(PLAIN));
    Ok(())
}

pub fn load(dir: &Path) -> Result<(Master, Source), String> {
    if let Ok(mut env) = std::env::var("SAATHI_MASTER_KEY") {
        let out = decode_plain(&env).map(|m| (m, Source::Environment));
        env.zeroize();
        return out;
    }
    let tpm = dir.join(TPM);
    if tpm.exists() {
        let blob = fs::read(&tpm).map_err(|e| e.to_string())?;
        return tpm_unseal(&blob).map(|k| (from_bytes(k), Source::Tpm));
    }
    let dpapi = dir.join(DPAPI);
    if dpapi.exists() {
        let blob = fs::read(&dpapi).map_err(|e| e.to_string())?;
        return dpapi_unseal(&blob).map(|k| (from_bytes(k), Source::WindowsProtected));
    }
    let plain = dir.join(PLAIN);
    if plain.exists() {
        let text = Zeroizing::new(fs::read_to_string(&plain).map_err(|e| e.to_string())?);
        return decode_plain(&text).map(|m| (m, Source::File));
    }
    let mut key = [0u8; 32];
    getrandom::getrandom(&mut key).map_err(|e| e.to_string())?;
    let master = Master::new(key);
    write_private(&plain, format!("{}\n", b64(master.bytes())).as_bytes(), true)?;
    Ok((master, Source::File))
}

fn b64(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

pub fn write_private(path: &Path, data: &[u8], create_new: bool) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp: PathBuf = path.with_extension("tmp");
    let mut opts = fs::OpenOptions::new();
    opts.write(true);
    if create_new {
        opts.create_new(true);
    } else {
        opts.create(true).truncate(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let target = if create_new { path } else { tmp.as_path() };
    let mut f = opts.open(target).map_err(|e| format!("cannot write {}: {e}", target.display()))?;
    f.write_all(data).map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    drop(f);
    if !create_new {
        fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn shred(path: &Path) {
    if let Ok(meta) = fs::metadata(path) {
        if let Ok(mut f) = fs::OpenOptions::new().write(true).open(path) {
            let _ = f.write_all(&vec![0u8; meta.len() as usize]);
            let _ = f.sync_all();
        }
        let _ = fs::remove_file(path);
    }
}

#[derive(serde::Serialize)]
pub struct Protected {
    pub protection: Source,
    pub recovery: String,
    pub fingerprint: String,
}

pub fn protect(dir: &Path, allow_dpapi: bool, keep_plain: bool) -> Result<Protected, String> {
    let plain = dir.join(PLAIN);
    if !plain.exists() {
        return Err(match status(dir) {
            Source::File => "there is no key file to protect yet; start Saathi once first".into(),
            other => format!("the key is already protected ({other:?})"),
        });
    }
    let text = Zeroizing::new(fs::read_to_string(&plain).map_err(|e| e.to_string())?);
    let master = decode_plain(&text)?;
    let (blob, name, protection) = match tpm_seal(master.bytes()) {
        Ok(b) => (b, TPM, Source::Tpm),
        Err(tpm_error) if allow_dpapi => match dpapi_seal(master.bytes()) {
            Ok(b) => (b, DPAPI, Source::WindowsProtected),
            Err(e) => return Err(format!("no TPM ({tpm_error}) and no Windows key protection ({e})")),
        },
        Err(e) => return Err(e),
    };
    let check = match protection {
        Source::Tpm => tpm_unseal(&blob)?,
        _ => dpapi_unseal(&blob)?,
    };
    if check.as_slice() != master.bytes() {
        return Err("the protected key did not read back correctly; nothing was changed".into());
    }
    write_private(&dir.join(name), &blob, false)?;
    if !keep_plain {
        shred(&dir.join(PLAIN));
    }
    Ok(Protected { protection, recovery: crate::crypto::recovery_code(&master), fingerprint: master.fingerprint() })
}

pub fn restore(dir: &Path, code: &str) -> Result<Source, String> {
    let master = crate::crypto::parse_recovery_code(code)?;
    for name in [TPM, DPAPI, PLAIN] {
        if dir.join(name).exists() {
            return Err(format!("{} already exists; move it away first so nothing is overwritten", dir.join(name).display()));
        }
    }
    if let Ok(blob) = tpm_seal(master.bytes()) {
        write_private(&dir.join(TPM), &blob, true)?;
        return Ok(Source::Tpm);
    }
    if let Ok(blob) = dpapi_seal(master.bytes()) {
        write_private(&dir.join(DPAPI), &blob, true)?;
        return Ok(Source::WindowsProtected);
    }
    write_private(&dir.join(PLAIN), format!("{}\n", b64(master.bytes())).as_bytes(), true)?;
    Ok(Source::File)
}

pub fn status(dir: &Path) -> Source {
    if std::env::var_os("SAATHI_MASTER_KEY").is_some() {
        Source::Environment
    } else if dir.join(TPM).exists() {
        Source::Tpm
    } else if dir.join(DPAPI).exists() {
        Source::WindowsProtected
    } else {
        Source::File
    }
}
