use std::convert::TryFrom;
use std::str::FromStr;
use tss_esapi::abstraction::pcr::PcrData;
use tss_esapi::attributes::{ObjectAttributesBuilder, SessionAttributesBuilder};
use tss_esapi::constants::SessionType;
use tss_esapi::interface_types::algorithm::{HashingAlgorithm, PublicAlgorithm};
use tss_esapi::interface_types::key_bits::RsaKeyBits;
use tss_esapi::interface_types::resource_handles::Hierarchy;
use tss_esapi::interface_types::session_handles::PolicySession;
use tss_esapi::structures::{
    Digest, KeyedHashScheme, MaxBuffer, PcrSelectionList, PcrSelectionListBuilder, PcrSlot, Private, Public, PublicBuilder, PublicKeyedHashParameters, RsaExponent, SensitiveData,
    SymmetricDefinition, SymmetricDefinitionObject,
};
use tss_esapi::tcti_ldr::TctiNameConf;
use tss_esapi::traits::{Marshall, UnMarshall};
use tss_esapi::{utils, Context};
use zeroize::Zeroizing;

const MAGIC: &[u8; 8] = b"SATPM2v1";

fn context() -> Result<Context, String> {
    let tcti = match std::env::var("SAATHI_TCTI") {
        Ok(conf) => TctiNameConf::from_str(&conf).map_err(|e| format!("bad SAATHI_TCTI: {e}"))?,
        Err(_) => {
            if !std::path::Path::new("/dev/tpmrm0").exists() {
                return Err("no TPM found (/dev/tpmrm0 is missing)".into());
            }
            TctiNameConf::from_str("device:/dev/tpmrm0").map_err(|e| e.to_string())?
        }
    };
    Context::new(tcti).map_err(|e| format!("cannot open the TPM: {e}"))
}

fn pcrs() -> Result<PcrSelectionList, String> {
    PcrSelectionListBuilder::new().with_selection(HashingAlgorithm::Sha256, &[PcrSlot::Slot7]).build().map_err(|e| e.to_string())
}

fn primary(ctx: &mut Context) -> Result<tss_esapi::handles::KeyHandle, String> {
    let template = utils::create_restricted_decryption_rsa_public(SymmetricDefinitionObject::AES_256_CFB, RsaKeyBits::Rsa2048, RsaExponent::default()).map_err(|e| e.to_string())?;
    ctx.execute_with_nullauth_session(|c| c.create_primary(Hierarchy::Owner, template, None, None, None, None))
        .map(|r| r.key_handle)
        .map_err(|e: tss_esapi::Error| format!("cannot create the TPM storage key: {e}"))
}

fn policy_session(ctx: &mut Context, kind: SessionType) -> Result<PolicySession, String> {
    let session = ctx
        .start_auth_session(None, None, None, kind, SymmetricDefinition::AES_256_CFB, HashingAlgorithm::Sha256)
        .map_err(|e| e.to_string())?
        .ok_or("the TPM did not start a session")?;
    let (attrs, mask) = SessionAttributesBuilder::new().with_decrypt(true).with_encrypt(true).build();
    ctx.tr_sess_set_attributes(session, attrs, mask).map_err(|e| e.to_string())?;
    PolicySession::try_from(session).map_err(|e| e.to_string())
}

fn current_pcr_digest(ctx: &mut Context) -> Result<Digest, String> {
    let selection = pcrs()?;
    let (_, read, digests) = ctx.execute_without_session(|c| c.pcr_read(selection)).map_err(|e| e.to_string())?;
    let data = PcrData::create(&read, &digests).map_err(|e| e.to_string())?;
    let value = data.pcr_bank(HashingAlgorithm::Sha256).and_then(|b| b.get_digest(PcrSlot::Slot7)).ok_or("PCR 7 is not available")?.value().to_vec();
    let (hashed, _) = ctx
        .execute_without_session(|c| c.hash(MaxBuffer::try_from(value).map_err(|e| e.to_string())?, HashingAlgorithm::Sha256, Hierarchy::Owner).map_err(|e| e.to_string()))?;
    Ok(hashed)
}

pub fn seal(secret: &[u8; 32]) -> Result<Vec<u8>, String> {
    let mut ctx = context()?;
    let parent = primary(&mut ctx)?;
    let pcr_digest = current_pcr_digest(&mut ctx)?;
    let trial = policy_session(&mut ctx, SessionType::Trial)?;
    ctx.execute_without_session(|c| c.policy_pcr(trial, pcr_digest, pcrs()?).map_err(|e| e.to_string()))?;
    let policy = ctx.execute_without_session(|c| c.policy_get_digest(trial)).map_err(|e| e.to_string())?;
    ctx.flush_context(tss_esapi::handles::SessionHandle::from(trial).into()).ok();
    let attributes = ObjectAttributesBuilder::new()
        .with_fixed_tpm(true)
        .with_fixed_parent(true)
        .with_no_da(true)
        .with_admin_with_policy(true)
        .with_user_with_auth(false)
        .build()
        .map_err(|e| e.to_string())?;
    let template = PublicBuilder::new()
        .with_public_algorithm(PublicAlgorithm::KeyedHash)
        .with_name_hashing_algorithm(HashingAlgorithm::Sha256)
        .with_object_attributes(attributes)
        .with_auth_policy(policy)
        .with_keyed_hash_parameters(PublicKeyedHashParameters::new(KeyedHashScheme::Null))
        .with_keyed_hash_unique_identifier(Default::default())
        .build()
        .map_err(|e| e.to_string())?;
    let sensitive = SensitiveData::try_from(secret.to_vec()).map_err(|e| e.to_string())?;
    let created = ctx
        .execute_with_nullauth_session(|c| c.create(parent, template, None, Some(sensitive), None, None))
        .map_err(|e: tss_esapi::Error| format!("the TPM refused to seal the key: {e}"))?;
    ctx.flush_context(parent.into()).ok();
    let public = created.out_public.marshall().map_err(|e| e.to_string())?;
    let private = created.out_private.value().to_vec();
    let mut blob = MAGIC.to_vec();
    blob.extend_from_slice(&(public.len() as u32).to_le_bytes());
    blob.extend_from_slice(&public);
    blob.extend_from_slice(&(private.len() as u32).to_le_bytes());
    blob.extend_from_slice(&private);
    Ok(blob)
}

pub fn unseal(blob: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    if blob.len() < 16 || &blob[..8] != MAGIC {
        return Err("the sealed key file is not a Saathi TPM key".into());
    }
    let read = |at: usize| -> Result<(Vec<u8>, usize), String> {
        let len = u32::from_le_bytes(blob.get(at..at + 4).ok_or("the sealed key file is damaged")?.try_into().unwrap()) as usize;
        Ok((blob.get(at + 4..at + 4 + len).ok_or("the sealed key file is damaged")?.to_vec(), at + 4 + len))
    };
    let (public, next) = read(8)?;
    let (private, _) = read(next)?;
    let public = Public::unmarshall(&public).map_err(|e| e.to_string())?;
    let private = Private::try_from(private).map_err(|e| e.to_string())?;
    let mut ctx = context()?;
    let parent = primary(&mut ctx)?;
    let loaded = ctx.execute_with_nullauth_session(|c| c.load(parent, private, public)).map_err(|e: tss_esapi::Error| format!("the TPM could not load the key: {e}"))?;
    let session = policy_session(&mut ctx, SessionType::Policy)?;
    ctx.execute_without_session(|c| c.policy_pcr(session, Digest::default(), pcrs()?).map_err(|e| e.to_string()))?;
    let result = ctx.execute_with_session(Some(session.into()), |c| c.unseal(loaded.into()));
    ctx.flush_context(tss_esapi::handles::SessionHandle::from(session).into()).ok();
    ctx.flush_context(loaded.into()).ok();
    ctx.flush_context(parent.into()).ok();
    let data = result.map_err(|e| format!("the TPM refused to release the key (has the start-up security of this computer changed?): {e}"))?;
    let bytes = Zeroizing::new(data.value().to_vec());
    if bytes.len() != 32 {
        return Err("the TPM returned a key of the wrong size".into());
    }
    let mut out = Zeroizing::new([0u8; 32]);
    out.copy_from_slice(&bytes);
    Ok(out)
}

pub fn available() -> bool {
    context().is_ok()
}
