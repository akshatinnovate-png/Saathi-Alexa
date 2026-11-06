# Changelog


## [Unreleased]

- **The assistant acts, not just answers.** In the family app it proposes changes (medicines, doctor visits, refills, escorts, alerts, messages to the elder) as confirmation cards; nothing changes until the family member taps Confirm, and every action is checked against the same Rust permission rules and written to the audit log.
- **Tech help goes to Sahay.** A how-to question about WhatsApp, video calls, printing or settings, in English, Hindi, Hinglish or Marathi, is handed to Sahay on the elder's computer with a single reply ("I've asked Sahay to do it for you"), with live progress in the chat. Only a direct connection from that computer can hand out or update Sahay's tasks.
- **Groq support**: set `GROQ_API_KEY` to run the assistants on Groq's free tier (`openai/gpt-oss-120b` by default).
- **The landing page answers in place**, grounded in Saathi's own documents with links, and lets visitors talk to the demo family.

- **Try Saathi in any MCP client in one line**: `npx -y saathi-alexa` runs the MCP server over stdio with a fictional demo family, in memory, with every outside connection refused. Listed for the official MCP Registry in `server.json`; published to npm with provenance by the new **Publish to npm** workflow.
- **[PRIVACY.md](PRIVACY.md)**: what Saathi stores, where it goes and what it never does.
- **Project governance for the OpenSSF Best Practices silver and gold levels**: [GOVERNANCE.md](GOVERNANCE.md), [MAINTAINERS.md](MAINTAINERS.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [ROADMAP.md](ROADMAP.md), [docs/BUILD.md](docs/BUILD.md), [docs/ASSURANCE_CASE.md](docs/ASSURANCE_CASE.md), DCO sign-off and code review rules in CONTRIBUTING.md, and per-file licensing in [REUSE.toml](REUSE.toml).
- **Coverage gate**: CI now fails if tests cover less than 90% of lines or 80% of branches of `src/` (`npm run coverage`). New unit tests for the escalation interpreter, onboarding, doorbell, egress guard, Google sign-in, mail, AWS language services, passwords, sessions and two-step sign-in.
- **Sahay has moved to its own repository**, [akshatinnovate-png/Sahay](https://github.com/akshatinnovate-png/Sahay): its source, datasets, Android app and releases live there now. Saathi's Windows installer still includes Sahay, downloading the latest `Sahay.exe` from that repository when it is built.

## [1.3.0] - 2026-11-01

Saathi now comes with **Sahay**, a voice helper that sees and uses the Windows PC, and protects Aaji from phone scams.

### Get started
- **Windows:** download **Saathi-Setup-1.3.0.exe** below. Sahay is in the Start menu (tick "Put a Sahay icon on the desktop" in the installer if you want one). Guide: [docs/INSTALL_WINDOWS.md](docs/INSTALL_WINDOWS.md).
- **Android:** **Saathi-1.3.0.apk** below. **Docker:** `ghcr.io/akshatinnovate-png/saathi-alexa:1.3.0`

### New
- **Sahay**, included with Saathi on Windows: talk to it and it opens apps and websites, clicks, types, fills forms, runs commands and reads the screen back to you. Talk over it mid-task and it changes plan; it asks when a choice is yours. Click the sphere to stop or start.
- **Sahay knows Saathi**: ask it about Aaji's tablets, doctor visits, family messages or where something is kept at home, or have it message the family or call for help, and it asks Saathi directly instead of clicking through the web page.
- **Sahay keeps going**: it resumes the same conversation after a dropped connection, rotates between your free Gemini keys and models when one hits its limit, and retries by itself.
- **Scam shield**: when Aaji mentions a call asking for an OTP, PIN, KYC update, money, an app install, or threatening "digital arrest", Saathi calmly tells her what not to do and alerts the family once, in English, Hindi, Marathi and Hinglish, even from a private check-in. Alexa+ gets a matching tool.
- **Medical ID card**: one printable page for a paramedic or hospital with allergies, conditions, blood group, medicines, doctor, who to call and the language spoken.

### Security
- Medical details and alert words are sealed at rest and never reach Alexa or the neighbour.

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
