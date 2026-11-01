# Self-audit

Before asking friends to attack Saathi, we attacked it ourselves. This page records what we ran, what we found, and what we fixed. It is updated with each round.

## Round 1, 1 November 2026 (after release 1.1.0)

### What we ran

| Tool | What it does | Where |
|---|---|---|
| `scripts/attack.js` | 47 black-box attacks against a fresh install in public mode: headers, Host header, every API route without a session, CSRF, roles, a second household trying to reach the first, sessions, path traversal, body limits, prototype pollution, reflected script, forged doorbell events, pairing-code guessing, lockout and rate limits | Every push (`Attack` workflow), and by hand with `--target` |
| Semgrep 1.183.0 | Static analysis with the open rule packs for JavaScript, secrets, Rust, GitHub Actions and Dockerfiles, pinned to one rules commit | Every push; findings go to GitHub code scanning |
| OWASP ZAP baseline | Spiders the running app and checks every response passively | Every push and weekly |
| CodeQL, ESLint, Clippy, Kani, TLA+, fast-check, cargo-fuzz | Already in CI before this round | Every push |
| Playwright end-to-end tests | Real browser flows, including the attacks below that only show in a browser | Every push |

### What we found

| # | Severity | Finding | Found by | Status |
|---|---|---|---|---|
| 1 | Medium | AES-GCM decryption accepted authentication tags shorter than 16 bytes. Node accepts 4 to 16 byte tags unless the length is pinned, so a truncated sealed record would be checked with a shorter tag, making forgery far cheaper | Semgrep `gcm-no-tag-length` | **Fixed**: every decryption pins `authTagLength: 16`. A test shows a 4, 8, 12 or 15 byte prefix of a real tag is now refused (it was accepted before) |
| 2 | Low | Open redirect on the sign-in page: a signed-in person who opened `/login.html?next=https://evil.example` was sent to that site. Useful to make a phishing link look like it starts at Saathi | Semgrep `js-open-redirect`, confirmed in a browser | **Fixed**: the page only follows same-site paths, using the same rule as the server. An end-to-end test tries three spellings (`https://`, `//`, `/\`); all three escaped before the fix and none do now |
| 3 | Low | The Tailscale address check used a regular expression with a nested repeat, which a hostile input could make slow | Semgrep `detect-redos` | **Fixed**: replaced with a label-by-label check. The input comes from the local Tailscale program, so this was not reachable remotely |
| 4 | Info | Saathi meant for this computer only accepted any `Host` header, so a hand-made tunnel or DNS rebinding could reach it without the public-mode protections | Review while building "Reach Saathi from anywhere" | **Fixed** in 1.1.0: such an install answers only to `localhost`, `127.0.0.1` and `[::1]` |
| 5 | Info | Our own attack check reported `/healthz` answering a foreign Host header | `scripts/attack.js` | **Accepted**: on purpose for health probes; it only ever returns `{"ok":true}`. The check now targets pages, the API and MCP, which all refuse |

### Reviewed and accepted

| Finding | Why it stays |
|---|---|
| Semgrep `insecure-innerhtml` (11 places in `public/`) | Every one writes the output of the `svg()` Trusted Types policy, which only accepts plain SVG with no scripts, handlers or links, and the browser refuses any other HTML. This is the single documented HTML sink. These two rules are excluded in CI with this reason |
| Semgrep `unsafe-usage` in `broker/` and `core/src/wasm.rs` | The `unsafe` blocks are the system calls that harden the broker (`prctl`, `mlock`, `setrlimit`, Windows mitigation policies, DPAPI) and the WebAssembly memory interface. They are small, reviewed, and covered by the broker tests on Linux and Windows |
| Semgrep `prototype-pollution-loop` in the escalation interpreter | The paths come from the repository's own state machine definition, never from a request |
| Semgrep `js-open-redirect` in `join.js` and the post-sign-in redirects | The destination comes from the server, which only returns same-site paths |
| Semgrep `hardcoded-hmac-key` in `scripts/attack.js` | It is the wrong secret the attack suite signs a forged doorbell event with |

### What still needs human eyes

These are where automated tools are weakest. They are the first items in [PENTEST.md](PENTEST.md).

- The end-to-end encryption join against a malicious server
- Cross-household access through less common paths (SSE, MCP sessions, media links)
- Logic flaws in two-step sign-in, recovery codes and passkeys
- The Windows launcher and installer on a machine shared with other users
