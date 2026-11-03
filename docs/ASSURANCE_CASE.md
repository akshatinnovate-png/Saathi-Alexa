# Security assurance case

Why we believe Saathi meets its security requirements. Each claim points to the evidence.

## Requirements

1. Only the elder and the people they trust can read the elder's health, messages and home details.
2. Nobody can act as a family member without that person's credentials and, when turned on, their second factor or passkey.
3. Saathi only talks to the outside services it needs.
4. What families download is exactly what this repository built.

## Threat model and trust boundaries

[THREAT_MODEL.md](THREAT_MODEL.md) lists who might attack and how (15 threats), and the control for each. The trust boundaries are:

- **Browser ↔ server.** Everything crosses HTTPS; sessions are server-side, HttpOnly, SameSite cookies; every state-changing request is checked for origin and CSRF.
- **Server ↔ stored data.** Class B data is sealed with a key held by the key broker (TPM or OS-protected on Windows); the server alone cannot read a stolen data file.
- **Family ↔ family (Class A).** Private messages are end-to-end encrypted in the browser (X25519 + ML-KEM-768, AES-256-GCM); the server never sees the keys.
- **Server ↔ the internet.** The egress allowlist (`src/security/egress.js`) refuses every host not on the list and any name that resolves to a private address.
- **Repository ↔ release.** Releases are built, tested and signed in GitHub Actions with pinned actions and Sigstore provenance.

## Secure design principles applied

| Principle | Where |
|---|---|
| Least privilege | Roles in `core/src/policy.rs`; workflow tokens default to `contents: read` |
| Fail-safe defaults | Unknown roles and hosts are denied; the server refuses to start with unsafe settings (`src/security/startup.js`) |
| Complete mediation | Every route goes through `src/http/guard.js`; every permission decision through the Rust policy |
| Economy of mechanism | One policy engine, written in Rust and proved with Kani |
| Separation of privilege | The key broker is a separate process; Class A keys never reach the server |
| Open design | All code, proofs and the threat model are public |
| Input validation | Allowlists for every input; property-based fuzzing of the parsers |

## Common weaknesses and how they are countered

XSS (strict CSP with nonces, no inline script), CSRF (origin and token checks), SSRF (egress guard), injection (no string-built queries, no `eval`), credential stuffing (scrypt with pepper, lockout, breached-password check), replay (nonces and a replay cache), insecure randomness (only `crypto.randomBytes` / `getRandomValues` / `getrandom`). Details: [THREAT_MODEL.md](THREAT_MODEL.md).

## Evidence

- Kani proofs and TLA+ models of the policy and session rules ([FORMAL.md](FORMAL.md)), run on every push.
- Unit, protocol, security, end-to-end and fuzz tests; coverage at least 90% of lines and 80% of branches, enforced in CI.
- CodeQL, Semgrep, ESLint and Clippy with warnings as errors.
- An automated attack suite against a running server ([PENTEST.md](PENTEST.md)) and a written self-audit ([SELF_AUDIT.md](SELF_AUDIT.md)).
- OpenSSF Scorecard on every push to `main`.
