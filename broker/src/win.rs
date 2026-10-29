use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HLOCAL, LocalFree};
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, NCryptCreatePersistedKey, NCryptDecrypt, NCryptEncrypt, NCryptFinalizeKey, NCryptFreeObject, NCryptOpenKey, NCryptOpenStorageProvider,
    NCryptSetProperty, BCRYPT_OAEP_PADDING_INFO, BCRYPT_RSA_ALGORITHM, BCRYPT_SHA256_ALGORITHM, CERT_KEY_SPEC, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB, MS_PLATFORM_CRYPTO_PROVIDER,
    NCRYPT_FLAGS, NCRYPT_KEY_HANDLE, NCRYPT_LENGTH_PROPERTY, NCRYPT_PAD_OAEP_FLAG, NCRYPT_PROV_HANDLE, NCRYPT_SILENT_FLAG,
};
use zeroize::Zeroizing;

const KEY_NAME: PCWSTR = w!("Saathi master key wrap");
const ENTROPY: &[u8] = b"saathi/dpapi/v1";

struct Handle(usize);

impl Drop for Handle {
    fn drop(&mut self) {
        if self.0 != 0 {
            unsafe {
                let _ = NCryptFreeObject(windows::Win32::Security::Cryptography::NCRYPT_HANDLE(self.0));
            }
        }
    }
}

fn provider() -> Result<Handle, String> {
    let mut prov = NCRYPT_PROV_HANDLE::default();
    unsafe { NCryptOpenStorageProvider(&mut prov, MS_PLATFORM_CRYPTO_PROVIDER, 0) }.map_err(|e| format!("this PC has no usable TPM: {e}"))?;
    Ok(Handle(prov.0))
}

fn key(create: bool) -> Result<(Handle, Handle), String> {
    let prov = provider()?;
    let mut key = NCRYPT_KEY_HANDLE::default();
    let opened = unsafe { NCryptOpenKey(NCRYPT_PROV_HANDLE(prov.0), &mut key, KEY_NAME, CERT_KEY_SPEC(0), NCRYPT_SILENT_FLAG) };
    if opened.is_err() {
        if !create {
            return Err("the TPM key for Saathi is missing".into());
        }
        unsafe { NCryptCreatePersistedKey(NCRYPT_PROV_HANDLE(prov.0), &mut key, BCRYPT_RSA_ALGORITHM, KEY_NAME, CERT_KEY_SPEC(0), NCRYPT_FLAGS(0)) }
            .map_err(|e| format!("the TPM could not make a key: {e}"))?;
        let bits: u32 = 2048;
        unsafe { NCryptSetProperty(windows::Win32::Security::Cryptography::NCRYPT_HANDLE(key.0), NCRYPT_LENGTH_PROPERTY, &bits.to_le_bytes(), NCRYPT_FLAGS(0)) }
            .map_err(|e| e.to_string())?;
        unsafe { NCryptFinalizeKey(key, NCRYPT_SILENT_FLAG) }.map_err(|e| format!("the TPM could not finish the key: {e}"))?;
    }
    Ok((prov, Handle(key.0)))
}

fn padding() -> BCRYPT_OAEP_PADDING_INFO {
    BCRYPT_OAEP_PADDING_INFO { pszAlgId: BCRYPT_SHA256_ALGORITHM, pbLabel: std::ptr::null_mut(), cbLabel: 0 }
}

pub fn tpm_seal(secret: &[u8; 32]) -> Result<Vec<u8>, String> {
    let (_prov, key) = key(true)?;
    let pad = padding();
    let mut len = 0u32;
    unsafe { NCryptEncrypt(NCRYPT_KEY_HANDLE(key.0), Some(secret), Some(&pad as *const _ as *const _), None, &mut len, NCRYPT_PAD_OAEP_FLAG) }.map_err(|e| e.to_string())?;
    let mut out = vec![0u8; len as usize];
    unsafe { NCryptEncrypt(NCRYPT_KEY_HANDLE(key.0), Some(secret), Some(&pad as *const _ as *const _), Some(&mut out), &mut len, NCRYPT_PAD_OAEP_FLAG) }
        .map_err(|e| format!("the TPM could not seal the key: {e}"))?;
    out.truncate(len as usize);
    Ok(out)
}

pub fn tpm_unseal(blob: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    let (_prov, key) = key(false)?;
    let pad = padding();
    let mut len = 0u32;
    let mut out = Zeroizing::new(vec![0u8; 512]);
    unsafe { NCryptDecrypt(NCRYPT_KEY_HANDLE(key.0), Some(blob), Some(&pad as *const _ as *const _), Some(out.as_mut_slice()), &mut len, NCRYPT_PAD_OAEP_FLAG) }
        .map_err(|e| format!("the TPM refused to release the key: {e}"))?;
    if len != 32 {
        return Err("the TPM returned a key of the wrong size".into());
    }
    let mut key = Zeroizing::new([0u8; 32]);
    key.copy_from_slice(&out[..32]);
    Ok(key)
}

pub fn tpm_available() -> bool {
    provider().is_ok()
}

fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 }
}

pub fn dpapi_seal(secret: &[u8; 32]) -> Result<Vec<u8>, String> {
    let input = blob(secret);
    let entropy = blob(ENTROPY);
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe { CryptProtectData(&input, w!("Saathi"), Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output) }.map_err(|e| format!("Windows could not protect the key: {e}"))?;
    let out = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe {
        let _ = LocalFree(HLOCAL(output.pbData as *mut _));
    }
    Ok(out)
}

pub fn dpapi_unseal(data: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    let input = blob(data);
    let entropy = blob(ENTROPY);
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe { CryptUnprotectData(&input, None, Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output) }
        .map_err(|e| format!("Windows could not unlock the key (was it made by another Windows user?): {e}"))?;
    let plain = Zeroizing::new(unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec());
    unsafe {
        std::ptr::write_bytes(output.pbData, 0, output.cbData as usize);
        let _ = LocalFree(HLOCAL(output.pbData as *mut _));
    }
    if plain.len() != 32 {
        return Err("the protected key has the wrong size".into());
    }
    let mut key = Zeroizing::new([0u8; 32]);
    key.copy_from_slice(&plain);
    Ok(key)
}
