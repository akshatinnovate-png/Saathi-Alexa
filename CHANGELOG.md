# Changelog

## [Unreleased]

## [1.2.0] - 2026-11-01

Saathi now has an Android app, and is attacked automatically on every change.

### Get started
- **Android:** on Aaji's tablet or a family phone, download **Saathi-1.2.0.apk** below, open it and type your Saathi address. Guide: [docs/ANDROID.md](docs/ANDROID.md).
- **Windows:** download **Saathi-Setup-1.2.0.exe** below and double-click it. Guide: [docs/INSTALL_WINDOWS.md](docs/INSTALL_WINDOWS.md).
- **Docker:** `docker run -p 8787:8787 -v saathi-data:/data ghcr.io/akshatinnovate-png/saathi-alexa:1.2.0`

### New
- Android app for Aaji's tablet and family phones: opens only your own Saathi, https only, no screenshots, no backups, no third-party code. Built, tested and attested in CI ([docs/ANDROID.md](docs/ANDROID.md)).

### Security
- `npm run attack`: 47 automated attacks against a running install, run on every push alongside Semgrep and an OWASP ZAP scan.
- Fixed: AES-GCM now refuses authentication tags shorter than 16 bytes.
- Fixed: the sign-in page no longer follows a `next` link to another site.
- docs/SELF_AUDIT.md records what we found and fixed; docs/PENTEST.md is the brief for outside testers.

## [1.1.0] - 2026-11-01

Saathi now installs on Windows like any other program, keeps the family's keys in the computer's security chip, and encrypts private messages end to end.

### Get started
- **Windows:** download **Saathi-Setup-1.1.0.exe** below and double-click it. No administrator rights and nothing else to install. Step-by-step guide: [docs/INSTALL_WINDOWS.md](docs/INSTALL_WINDOWS.md).
- **Docker:** `docker run -p 8787:8787 -v saathi-data:/data ghcr.io/akshatinnovate-png/saathi-alexa:1.1.0`

### New
- Windows installer: desktop icon, start with Windows, Start-menu tools for the key and for reaching Saathi from anywhere, and an uninstaller that keeps the family's data.
- Reach Saathi from anywhere with a fixed https address (Tailscale Funnel, free), or a temporary Cloudflare address for a test.
- Private messages, voice notes and photos are encrypted on family devices; the server only ever holds ciphertext. Devices join by matching three pictures, recovery is one printed code or any two of three family sheets, and a passkey can lock private messages after every restart.
- The family chooses what Alexa may say out loud: medicine names and purposes, doctor names and addresses, story words.
- Neighbours see only calls for help.

### Security
- A Rust security core, compiled to WebAssembly, decides who may do what; key properties are proved with Kani and the protocols are model-checked with TLA+.
- A separate key broker holds the master key, sealed in the TPM (or by Windows) with a printed recovery key; the web server never holds it.
- Health records are encrypted field by field with the broker's key, bound to their household, list and id.
- Every Alexa read of health details goes into the tamper-evident history.
- Outbound connections are limited to the services Saathi uses.
- A Saathi meant for this computer only answers only to localhost, which stops hand-made tunnels and DNS rebinding.
- Fonts are served by Saathi itself; nothing loads from Google.
- Supply chain: every GitHub Action pinned to a commit, fuzzing with fast-check and libFuzzer, ESLint and Clippy with warnings as errors, and signed build provenance for the Windows installer.

### Earlier hardening, also in this release
- The data file, voice notes and photos are encrypted at rest with AES-256-GCM, keys derived with HKDF from one master key (`data/saathi.key` or `SAATHI_MASTER_KEY`). Existing plain files are encrypted on first start.
- Passwords: scrypt with a secret pepper, silent upgrade of older hashes, breached-password check (k-anonymity), common-password and name checks, equal timing, progressive lockout.
- Two-step sign-in with authenticator apps and single-use recovery codes. Passkeys with cloned-key detection.
- Server-side sessions: list every sign-in, sign out one or all others; changing a password ends every other session. Sensitive changes need a recent sign-in.
- New devices need family approval of three matching pictures, not just a pairing code.
- Strict Content Security Policy with hashed scripts, Trusted Types, HSTS, cross-origin isolation, Fetch-Metadata CSRF protection, rate limits and safe JSON parsing.
- Tamper-evident security history (HMAC chain) for the household owner.
- Signed, expiring media links; replay-proof doorbell webhooks; MCP refuses anonymous callers when reachable from the network; unsafe configurations refuse to start; Google sign-in uses a nonce.
- Supply chain: `npm audit`, registry signatures, lockfile-origin and secret scans in CI, CodeQL, OpenSSF Scorecard, Dependabot, SBOMs and signed build provenance on releases. Ring support is now opt-in (`npm run add-ring`) because its dependency chain had a high-severity advisory.
- SECURITY.md and a full threat model. 17 new security tests.

## [1.0.0] - 2026-10-28

The first release of Saathi: a companion for elders living with memory loss, disability or a language gap, and the family circle around them.

### Get started
- **Windows:** download the ZIP below, unzip it, double-click **Start Saathi**.
- **Mac or Linux:** download the ZIP, unzip it, run `./start.sh`.
- **In the cloud:** use the *Deploy to Render* button in the README.
- **Docker:** `docker run -p 8787:8787 -v saathi-data:/data ghcr.io/akshatinnovate-png/saathi-alexa`

### For the elder
- A voice companion on a tablet, an old phone or an Echo Show, paired with a six-digit code. No passwords.
- Speaks in their language (Marathi, Hindi, English and five more), slowly and kindly, and never quizzes their memory.
- Tablet reminders when they are due, doctor-visit reminders, messages read aloud and family voice notes played as they arrive.
- "Where are my glasses?" answered from a house map the family builds by walking around with an Android phone.
- A memory book: their stories, translated for every grandchild and narrated.
- Calls for help (falls, pain, breathlessness, being lost) start an escalation: family, then the neighbour, then emergency guidance with their country's number.
- "Keep this between us" keeps ordinary sadness private. Danger always overrides privacy.

### For the family
- Sign in with Google. One tap connects Gmail, and invites, alerts and the Sunday letter are sent automatically.
- A dashboard in each person's own language: tablets, mood, alerts, visits, messages, the memory book and the house map.
- Manage medicines (up to six times a day, chosen weekdays, supply tracking), doctor visits and the daily routine.
- Invite people by email or WhatsApp. A frosted Saathi assistant answers questions about how they are doing.
- Connect a Ring doorbell, or any smart doorbell through a private link.

### For developers
- An MCP server (spec 2025-11-25, Streamable HTTP) with 17 tools, all four hints on every tool, OAuth 2.1 and a full AWS deployment (CDK, Lambda, Step Functions, DynamoDB, EventBridge, SNS, SES, Translate, Polly, Comprehend, Bedrock).
- 75 server tests, 12 infrastructure tests, multilingual safety evals and an accessibility audit across 23 page states, all in CI.
- `npm run demo` for a fictional demo family; a normal start is empty and real.
