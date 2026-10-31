# Contributing to Saathi

Thank you for helping. Saathi looks after elders and their families, so we care a lot about safety, privacy and plain language. Small, careful contributions are very welcome.

## Reporting a bug

Open an issue at https://github.com/akshatinnovate-png/Saathi-Alexa/issues with:

- what you did, what you expected, and what happened instead
- your system (Windows, Mac, Linux, Docker, Render) and Node.js version
- any message Saathi printed

**Security problems are different.** Please do not open a public issue. Follow [SECURITY.md](SECURITY.md) instead.

We aim to reply to every bug report within 7 days.

## Suggesting a feature

Open an issue that starts with "Idea:". Describe who it helps (the elder, the family, a carer) and what they would do differently.

## Making a change

1. Fork the repository and create a branch.
2. Install: `npm ci`. Optional for the Rust parts: Rust 1.97 (`rustup`), then `cargo test`.
3. Make your change, keeping it focused on one thing.
4. Run the checks below. All of them must pass.
5. Open a pull request that explains what changed and why, and how you tested it.

### Checks

```bash
npm run lint          # ESLint with security rules (no eval, strict equality)
npm test              # unit, protocol, security and fuzz tests
npm run a11y          # accessibility audit in a real browser
npm run e2e           # end-to-end: private messages between two browsers
cargo test            # Rust security core and key broker
cargo clippy --all-targets -- -D warnings
npm run check:core    # the WebAssembly core matches its Rust source
```

CI runs all of them, plus Kani proofs, TLA+ model checking, CodeQL, fuzzing, dependency audits and a Docker build.

## Test policy

**Every change in behaviour comes with a test.** New features need tests that show they work; bug fixes need a test that fails before the fix and passes after it. Security-relevant code (anything in `src/security`, `src/accounts`, `src/vault`, `src/http/guard.js`, `core/`, `broker/` or `public/vault-*.js`) also needs a test for how it fails safely: wrong keys, tampered data, missing permissions.

Changes to who-may-do-what go in `core/src/policy.rs`, never in JavaScript, and need a Kani proof or an updated one.

## Style

- Plain JavaScript (ES modules), no build step for the app. Match the code around you.
- No comments in code. Names should say what things do.
- Words people see are short, warm and plain. Write for an 80-year-old and a busy grandchild.
- Every page must pass the accessibility audit, and new pages need an entry in `scripts/a11y.js`.

## Licence

By contributing you agree that your work is released under the [MIT licence](LICENSE).
