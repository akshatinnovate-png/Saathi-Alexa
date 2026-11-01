# Threat model

Saathi looks after an elder living with memory loss, disability or a language gap. The people most likely to attack it are not nation states. They are scammers who target the elderly, an abusive relative, a thief with a stolen laptop, someone on the same Wi-Fi, a bot spraying leaked passwords and, sometimes, a careless install. This document lists what we protect, from whom, and exactly which control stops each attack. Every control named here has a test in [`test/security.test.js`](../test/security.test.js) unless marked otherwise.

## What we protect

| Asset | Why it matters |
|---|---|
| Health data: medicines, doses, doctor visits, mood | Private, and enough to impersonate a doctor or pharmacy to a confused elder |
| The elder's voice and stories, family voice notes, photos | Raw material for voice-clone scams ("Aaji, it's me, I need money") |
| The house map | Where the elder keeps valuables and spare keys |
| The family circle: names, emails, the neighbour | A ready-made target list for social engineering |
| The power to speak through the elder's device | An attacker could send instructions in a trusted voice |
| The escalation path | Silencing a help call could cost a life |
| Account access: sessions, passwords, passkeys, Gmail tokens | The keys to all of the above |

## Who might attack, and how

### 1. A bot with leaked passwords (credential stuffing)

| Attack | Control |
|---|---|
| Try millions of email and password pairs | Per-IP token bucket on `/auth/*` (30 burst, 20 per minute), per-account lockout after 5 failures, 30 s doubling to 1 hour, applied even to the right password |
| Learn which emails have accounts | Unknown emails burn the same scrypt work as real ones and get the same message |
| Use a password leaked elsewhere | New and changed passwords are checked against Have I Been Pwned (k-anonymity: 5 hex characters leave the server, padded responses), a common-password list, and must not contain the person's name or email |
| Crack a stolen database offline | scrypt N=2¹⁵ r=8 with a 16-byte salt **and** a pepper derived from the master key, which is not in the data file |

### 2. A phisher who gets the password

| Attack | Control |
|---|---|
| Sign in with the phished password | Two-step sign-in (TOTP) and passkeys. Passkeys are bound to Saathi's own address, so a look-alike site cannot use them |
| Replay a phished TOTP code | Each 30-second step is accepted once (`lastStep`) |
| Phish a recovery code | Each works once and is stored only as a hash |
| Sit on the session after the victim notices | The sessions list shows every sign-in with its browser; one tap signs out everywhere else; changing the password ends all other sessions |
| Turn off two-step with a stolen session | Security changes need a sign-in from the last 15 minutes or the password again, and two-step changes also need a current code |

### 3. A malicious website the family visits

| Attack | Control |
|---|---|
| Cross-site request forgery | `SameSite=Lax` cookies, and every write to `/api/*` and `/auth/*` is refused if `Sec-Fetch-Site` is cross-site or the `Origin` is foreign or `null` |
| Clickjacking | `frame-ancestors 'none'` and `X-Frame-Options: DENY` |
| Cross-origin leaks (Spectre-style, window references) | `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin` |
| Referrer leaks of invite or doorbell links | `Referrer-Policy: no-referrer` |

### 4. Script injection (XSS)

| Attack | Control |
|---|---|
| Stored XSS through a message, story, name or medicine | The front end builds the page with DOM nodes and `textContent`. The only HTML sink is an icon renderer |
| A future bug that uses `innerHTML` | Trusted Types are enforced: the browser refuses any HTML that did not pass the `saathi` policy, which accepts only plain SVG and rejects scripts, event handlers, links and `javascript:` |
| Injected inline scripts or styles | CSP `script-src 'self'` plus SHA-256 hashes computed at start-up for the two import maps; `script-src-attr 'none'`; `style-src-attr 'none'`; `object-src 'none'`; `base-uri 'none'` |
| Prototype pollution through JSON | The JSON parser drops `__proto__`, `constructor` and `prototype` keys |

### 5. Someone on the same network

| Attack | Control |
|---|---|
| Read traffic | HSTS with preload and `upgrade-insecure-requests` whenever Saathi runs on https; start-up warns when the public address is plain http |
| Steal a cookie | `HttpOnly`, `Secure`, and the `__Host-` prefix so a sibling subdomain cannot set or overwrite it |
| Make Saathi fetch internal addresses (server-side request forgery), such as the cloud metadata service | Outbound connections are limited to the services Saathi uses; IP literals, private ranges and host names that resolve to private addresses are refused |
| Reach the MCP server directly | When Saathi listens beyond `localhost` or has a public address, MCP refuses callers without a household key or OAuth token |
| Reach an install that has login turned off | Saathi refuses to start with `SAATHI_REQUIRE_LOGIN=false` unless it listens on this computer alone |

### 6. A stranger who learns a pairing code

| Attack | Control |
|---|---|
| Type the code on their own device and become "Aaji's Saathi" | A code only creates a request. The device shows three random pictures from 32 (32,768 combinations); a family member must see the same three and approve. The request expires in 10 minutes |
| Guess codes | Codes are single use, expire in 10 minutes, and `/auth/device` is rate limited per IP |
| Claim an approval twice | Approval is bound to a secret cookie on the requesting device and can be claimed once |
| Use an old device after removal | Removing a device revokes its sessions at once |

### 7. A thief with the computer or a backup

| Attack | Control |
|---|---|
| Read `saathi.json` | AES-256-GCM, key from `saathi.key` through HKDF. A wrong or missing key is refused and the file is left untouched |
| Read voice notes and photos | Each file is encrypted with AES-256-GCM, the file name bound as associated data |
| Swap one household's file for another's | Media names are prefixed by household and authenticated; a moved file fails to decrypt |
| Read Gmail and Ring tokens | Sealed separately with their own derived key |
| Steal the key along with the data | After `npm run protect-key` there is no key file: the key is sealed in the TPM chip and only released to that computer, booted the same way (PCR 7 on Linux). A copied disk or backup cannot be opened elsewhere without the paper recovery key |
| Read the key out of the running server | The web server never holds it. The key broker is a separate process with core dumps and debugger attachment blocked, the key locked in memory and a system-call allow-list. Root on the running machine can still read it; only an enclave would stop that |

### 8. Links that escape

| Attack | Control |
|---|---|
| A shared voice-note URL is forwarded | Media links carry an HMAC signature and expire within an hour; the signature covers the exact path |
| Guessing another household's media | Paths are random and household-scoped, and unsigned requests get 403 |
| Path traversal (`../`) | Media names are normalised, restricted to safe characters and must resolve inside the media folder |

### 9. A forged or replayed doorbell event

| Attack | Control |
|---|---|
| Fake a ring to make the elder open the door | HMAC-SHA256 over timestamp and body, constant-time compare |
| Replay a real ring later | 5-minute timestamp window plus a replay cache of every signature seen in that window |
| Use the default secret | On a real install the secret is derived from the master key unless one is set |

### 10. An insider in the family

| Attack | Control |
|---|---|
| A neighbour reads health details | Neighbours only get emergencies; family-only routes check the role |
| A removed relative keeps access | Removal revokes every session of that person at once |
| Someone quietly changes settings, adds a device or removes a person, then covers it up | Every sensitive action is written to a per-household, HMAC-chained history. Editing, deleting or truncating an entry breaks the chain, and the owner sees "the history was changed" in Security |

### 11. A compromised dependency or pipeline

| Attack | Control |
|---|---|
| A package with a malicious install script | `ignore-scripts=true` in `.npmrc`, and production needs no install scripts |
| A known-vulnerable package | `npm audit --omit=dev --audit-level=high` blocks CI and releases. Ring support, whose dependency chain had a high-severity advisory, is opt-in (`npm run add-ring`) |
| A tampered or typosquatted tarball | `npm audit signatures` verifies registry signatures; CI fails if the lockfile resolves anything outside `registry.npmjs.org` |
| A committed secret | CI fails on AWS keys, private keys, Anthropic, GitHub and Slack tokens |
| A poisoned workflow | Least-privilege `permissions:` on every workflow, `persist-credentials: false`, CodeQL for JavaScript and for Actions, OpenSSF Scorecard, Dependabot for npm, Actions and Docker |
| A tampered release | Each release has CycloneDX and SPDX SBOMs, `SHA256SUMS`, and signed SLSA build provenance for the archive and the Docker image (`gh attestation verify`) |

### 12. A careless operator

| Mistake | Control |
|---|---|
| Expose an install with login off | Refuses to start |
| A short `SAATHI_SESSION_SECRET` or a malformed `SAATHI_MASTER_KEY` | Refuses to start |
| Lose the key | The key is created once, and the start-up message and README say to back it up with the data |
| Run the demo on a network | Warns that the demo password is public |
| Leak a stack trace | Errors return a generic message with an ID; details only go to the server log |

### 13. A compromised or malicious server

| Attack | Control |
|---|---|
| Read voice notes, photos and private messages | They are encrypted on family devices with the family key, which the server never holds |
| Give the family key to a device the server controls | Devices join with commit-then-reveal and three matching pictures (15 bits, one guess per visible attempt). Rotation only wraps the key for devices that carry a certificate made with the family key |
| Keep a removed relative able to read new messages | Removal rotates the family key; the removed person's devices get nothing new (checked by the KeyRotation model) |
| Swap one private item for another | Each item is bound to its kind, its id and the household as associated data |

What the server still sees: who sent a message, when, its size, and everything Alexa+ needs to answer (medicines, visits, stories, the house map). Those are protected by the key broker in step 4, not by end-to-end encryption.

## Not yet covered

We would rather say so than pretend.

- **A fully compromised server** can still read what is not end-to-end encrypted: medicines, visits, stories and the house map, because Alexa+ and the server-side assistant need them. Voice notes, photos and private messages stay unreadable.
- **A compromised Google account.** If someone controls a family member's Google account, "Sign in with Google" lets them in. Two-step in Saathi still applies on top.
- **Voice-clone scams over the phone.** Saathi cannot stop a scammer who calls the elder directly. It does keep family voice notes encrypted and behind short-lived links, so they are harder to harvest.
- **Denial of service at scale.** Rate limits stop abuse from one place, not a botnet. Put Saathi behind a CDN or AWS WAF for that (the AWS deployment uses API Gateway throttling).
- **Rate limits and the replay cache are kept in memory.** They reset when Saathi restarts and are per instance. The timestamp window still bounds replays.
