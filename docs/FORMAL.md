# What is proved, and what is not

Tests show that the cases someone thought of work. The pieces below are checked against **every** possible input or every reachable state within stated bounds. All of it runs on every push in the **Proofs** workflow.

## 1. The Rust security core (`core/`)

One small Rust crate makes every security decision Saathi has:

- who may do what (`policy.rs`)
- how long a sign-in lives and when it counts as recent (`session.rs`)
- the tamper-evident history chain (`chain.rs`)

It is compiled to WebAssembly (embedded in `src/security/saathi-core-wasm.js`) and the Node server calls it for every API request, every MCP tool call, every session check and every history entry. There is no second copy of these rules in JavaScript.

The core uses no `unsafe` code outside the six-line WebAssembly boundary (`core/src/wasm.rs`), and the build is reproducible: CI rebuilds it from source and fails if the committed file differs by a single byte.

### Proved with Kani (bounded model checking over all inputs)

| Proof | Meaning |
|---|---|
| `no_cross_household_access` | No principal, for any action, is ever allowed into a household other than its own |
| `anonymous_is_always_refused` | Someone who is not signed in is refused every action |
| `owner_actions_need_the_owner` | Removing people, changing the elder's details, doorbells, the security history and key rotation are only ever allowed for the household owner |
| `devices_only_reach_household_actions` | Aaji's tablet can never reach family or owner actions, even if its session is stolen |
| `neighbours_only_see_household_actions` | A neighbour can never read medicines, pair devices or see the family's private letter |
| `family_actions_need_an_account` | Family actions always need a signed-in person, never a device or an open local session |
| `roles_are_monotone` | Whatever a neighbour may do, a member may do, and whatever a member may do, the owner may do |
| `exposed_mcp_needs_a_matching_scope` | Once Saathi is reachable from the network, no MCP tool runs without a key carrying the right scope |
| `valid_sessions_respect_both_limits` | A valid session is never past its idle or absolute lifetime |
| `touching_never_extends_the_absolute_limit` | Activity keeps a session alive, but never past 30 days (400 for a device) |
| `dead_sessions_stay_dead` | An expired session can never be revived or count as recent |
| `freshness_is_bounded` | "Signed in recently" really means within 15 minutes |
| `honest_chains_verify` | A history written honestly always verifies |
| `an_edited_entry_is_detected` | Changing any entry is always detected |
| `a_deleted_or_truncated_entry_is_detected` | Deleting any entry, including the newest, is always detected |
| `verification_implies_contiguous_sequence` | A history that verifies has no gaps and no reordering |

The chain proofs model the HMAC as a function that is injective in the entry. That is the standard assumption for a cryptographic MAC; Kani cannot prove SHA-256 itself.

## 2. The protocols (`formal/`, TLA+ checked with TLC)

| Model | What TLC checks in every reachable state |
|---|---|
| `Pairing.tla` | An intruder who learns a pairing code still never gets a device session; every session comes from a family approval; a code works once; a refused or expired request is never claimed; two pending requests never show the same pictures |
| `Sessions.tla` | A removed person has no live sessions; two-step sign-in is never skipped once it is on; a revoked session never comes back |
| `Escalation.tla` | Danger always alerts the family, even if Aaji asked to keep something private; private sadness never nudges the family; the neighbour is only involved for danger; **help always arrives** (liveness: every danger ends acknowledged or at emergency guidance); emergency is never silently downgraded |
| `KeyRotation.tla` | A removed person never holds a key for any epoch after their removal and cannot read anything written after it; every member can read the current epoch |

The pairing model found a real gap: if two device requests were pending at once with the same three pictures, the family could approve the wrong one. The server now never gives two pending requests in one household the same pictures, and the model checks it.

## 3. What is not proved

- **The JavaScript around the core.** Routing, storage and the AI features are tested (more than 100 tests, accessibility audits, automated attack scans), not proved. The guard test makes sure every API route is in the core's table, and anything that is not is refused.
- **The models are abstractions.** TLC checks small instances (three people, a few sessions, a handful of codes). Most protocol bugs show up at that size, but it is not a proof for unbounded systems.
- **The cryptography** (AES-GCM, HMAC-SHA256, scrypt) comes from OpenSSL through Node and from audited RustCrypto crates. We rely on them; we do not re-prove them.
