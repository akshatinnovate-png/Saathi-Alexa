# Changelog

## [Unreleased]

### Security
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
