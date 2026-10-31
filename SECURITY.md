# Security policy

Saathi holds some of the most private things a family has: an elder's medicines, health worries, voice, home layout and the people they trust. We treat every report seriously.

## Reporting a vulnerability

Please **do not open a public issue**.

- Use GitHub's private reporting: **Security → Report a vulnerability** on this repository, or
- email **akshat.innovate@gmail.com** with the subject `Saathi security`.

Include what you found, how to reproduce it and what an attacker could do with it. You will get a reply within **72 hours** and a fix or a plan within **14 days** for anything rated high or critical. Credit is given in the changelog unless you prefer otherwise.

Good-faith research is welcome. Please only test against your own install (`npm run demo` gives you a full fictional family), do not access other people's data, and give us a reasonable chance to fix things before disclosure.

## Supported versions

| Version | Supported |
|---|---|
| 1.x (latest release) | Yes |
| older | No, please upgrade |

## What is in scope

- The web app, family app and the elder's device screen
- Sign-in: passwords, Google, two-step codes, recovery codes, passkeys, device pairing
- The MCP server at `/mcp` and its OAuth / token handling
- Doorbell webhooks, signed media links, the encrypted data file
- The AWS deployment in `infra/`
- GitHub Actions workflows and the release pipeline

## How Saathi protects a family

A summary. The full reasoning, attacker by attacker, is in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

| Layer | What it does |
|---|---|
| **Data at rest** | The local data file is sealed with AES-256-GCM. Voice notes and photos are encrypted one by one, bound to their own name so they cannot be swapped. Keys come from one 256-bit master key through HKDF, a separate key for every purpose |
| **Key broker** | The master key never enters the web server. A small separate Rust program, `saathi-broker`, holds it and does every encryption and signature over a private pipe. On Linux it blocks core dumps and debuggers, locks the key in memory and runs under a system-call allow-list; on Windows it turns on process mitigation policies. If the broker dies, Saathi stops rather than carry on without it |
| **Hardware key** | `npm run protect-key` seals the master key into the computer's TPM chip, bound to its secure-boot state (PCR 7) on Linux, or wraps it with a TPM key or your Windows account on Windows. A copied disk is useless on another machine. You get a printed recovery key with a checksum, and the old key file is destroyed only after you type part of it back |
| **Outbound connections** | Saathi can only connect to the services it uses (Google, Anthropic, AWS, the breached-password check, Ring and your mail server). Everything else, including cloud metadata addresses, is refused, and host names that resolve to private addresses are refused too |
| **Passwords** | scrypt (N=2¹⁵, r=8) plus a secret pepper kept outside the data file. Checked against 900M+ breached passwords using k-anonymity (only 5 hex characters of a SHA-1 ever leave the server, with padding). Old hashes upgrade silently on the next sign-in. Unknown emails take the same time as wrong passwords |
| **Lockout** | After 5 wrong passwords: 30 s, doubling up to 1 hour, even for the right password |
| **Two-step** | TOTP (RFC 6238) with replay protection, 10 single-use recovery codes stored only as hashes |
| **Passkeys** | WebAuthn, discoverable credentials, user verification required, cloned-key detection through signature counters |
| **Sessions** | Stored on the server, only a hash of the random ID is kept, `__Host-` cookie, HttpOnly, SameSite, idle and absolute timeouts, a list of every sign-in with "sign out everywhere else". Changing a password ends every other session |
| **Fresh sign-in** | Turning on two-step, adding passkeys or making new recovery codes needs a sign-in from the last 15 minutes, or the password again |
| **Devices** | A six-digit code is not enough. The device shows three pictures; a family member must see the same three in their app and approve |
| **Browser** | A strict Content Security Policy with hashed inline scripts and no `unsafe-inline`, Trusted Types (only a vetted SVG icon policy can write HTML), HSTS, COOP/CORP, a locked-down Permissions Policy, `no-referrer`, `nosniff`, no framing |
| **Requests** | Cross-site writes refused using Fetch Metadata and Origin checks, per-route token-bucket rate limits, JSON parsing that drops `__proto__`, a 1 MB body limit, errors that never leak stack traces |
| **Media** | Played only through links signed with HMAC that expire within an hour, scoped to the household |
| **History** | Every sensitive action goes into a per-household log where each entry is sealed with an HMAC of the one before it. Editing, deleting or truncating any entry is detected and shown to the owner |
| **MCP** | When Saathi can be reached from the network, every MCP caller needs a per-household key or an OAuth token; MCP sessions cannot cross households |
| **Webhooks** | HMAC-signed, a 5-minute timestamp window and a replay cache, so a captured doorbell event cannot be sent again |
| **Start-up checks** | Saathi refuses to start in unsafe configurations (for example, no login while reachable from the network) and warns about plain `http` public addresses |
| **Fuzzing** | Property-based fuzzing (fast-check) of the JSON parser, route guard, cookies, sessions, webhooks, two-step codes, media paths, the icon filter and the WebAssembly core on every push, plus libFuzzer on the Rust core. It found and fixed an `<svg/onload>` filter bypass, a password equal to the email address being accepted, and an unnormalised media link |
| **Supply chain** | Every GitHub Action pinned to a commit SHA, the Docker base image pinned by digest, write permissions only on the release job, lockfile-only installs with install scripts disabled, `npm audit` and registry signature checks on every push, CodeQL, OpenSSF Scorecard, Dependabot, a CycloneDX and SPDX SBOM and signed build provenance on every release |

## Verifying a release

Every release ships a source archive, two SBOMs and `SHA256SUMS`, and every artifact and the Docker image carry a signed SLSA build-provenance attestation:

```bash
gh attestation verify saathi-1.0.0.tar.gz --repo akshatinnovate-png/Saathi-Alexa
gh attestation verify oci://ghcr.io/akshatinnovate-png/saathi-alexa:latest --repo akshatinnovate-png/Saathi-Alexa
```

## Running Saathi safely

- **Run `npm run protect-key` and keep the recovery key on paper.** Until you do, back up `saathi.key` together with `saathi.json`; without the key the data cannot be read, by anyone, including you. `npm run key-status` shows where the key is, and `npm run restore-key` brings it back on a new computer.
- On a server, set `SAATHI_PUBLIC_URL` to an `https://` address.
- Turn on two-step sign-in or add a passkey for the household owner.
- Keep Saathi updated. Dependabot pull requests are reviewed weekly.
