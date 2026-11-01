# OpenSSF Best Practices: answer sheet

Answers for the "passing" level of the OpenSSF Best Practices badge (https://www.bestpractices.dev), with the evidence for each. Sign in there with GitHub, choose **Get your badge now**, enter `https://github.com/akshatinnovate-png/Saathi-Alexa`, and copy these in. Many are detected automatically.

`R` = `https://github.com/akshatinnovate-png/Saathi-Alexa`

## Basics

| Criterion | Answer | Evidence |
|---|---|---|
| description_good | Met | README explains what Saathi does and who it is for: R#readme |
| interact | Met | How to get and use it, report bugs and contribute: README, R/blob/main/CONTRIBUTING.md |
| contribution | Met | R/blob/main/CONTRIBUTING.md (pull requests) |
| contribution_requirements | Met | CONTRIBUTING.md lists the required checks, test policy and style |
| floss_license | Met | MIT |
| floss_license_osi | Met | MIT is OSI approved |
| license_location | Met | R/blob/main/LICENSE |
| documentation_basics | Met | README (install, run, deploy), docs/ARCHITECTURE.md |
| documentation_interface | Met | README "MCP surface" lists every tool and resource; SECURITY.md lists the security interface |
| sites_https | Met | GitHub, GitHub Releases and ghcr.io are https only |
| discussion | Met | GitHub issues: R/issues |
| english | Met | All documentation is in English |
| maintained | Met | Active commits; Dependabot updates reviewed weekly |

## Change control

| Criterion | Answer | Evidence |
|---|---|---|
| repo_public | Met | R |
| repo_track | Met | Git history |
| repo_interim | Met | Every commit is pushed, not only releases |
| repo_distributed | Met | Git |
| version_unique | Met | Semantic versions, e.g. 1.0.0 |
| version_semver | Met | CHANGELOG.md follows semantic versioning |
| version_tags | Met | Tag v1.0.0: R/releases |
| release_notes | Met | R/blob/main/CHANGELOG.md and each GitHub release |
| release_notes_vulns | Met | CHANGELOG.md has a Security section; no CVEs have been assigned to Saathi so far |

## Reporting

| Criterion | Answer | Evidence |
|---|---|---|
| report_process | Met | CONTRIBUTING.md "Reporting a bug" |
| report_tracker | Met | GitHub issues |
| report_responses | Met | We reply to bug reports within 7 days (CONTRIBUTING.md) |
| enhancement_responses | Met | Ideas are answered in issues |
| report_archive | Met | GitHub issues are public and searchable |
| vulnerability_report_process | Met | R/blob/main/SECURITY.md |
| vulnerability_report_private | Met | GitHub private vulnerability reporting, or email (SECURITY.md) |
| vulnerability_report_response | Met | Reply within 72 hours (SECURITY.md) |

## Quality

| Criterion | Answer | Evidence |
|---|---|---|
| build | Met | `npm ci` (no build step for the app); `cargo build` for the Rust parts; Dockerfile |
| build_common_tools | Met | npm, cargo, Docker |
| build_floss_tools | Met | All free and open source |
| test | Met | `npm test`, `cargo test`, `npm run a11y`, `npm run e2e` |
| test_invocation | Met | Standard `npm test` and `cargo test` (CONTRIBUTING.md) |
| test_most | Met | Unit, protocol, security, fuzz, end-to-end and accessibility tests across the server, the Rust core and the key broker |
| test_continuous_integration | Met | GitHub Actions on every push: R/actions |
| test_policy | Met | CONTRIBUTING.md "Test policy" |
| tests_are_added | Met | Recent changes add tests (e.g. test/vault.test.js, test/fuzz.test.js, test/assistant.test.js) |
| tests_documented_added | Met | CONTRIBUTING.md "Test policy" |
| warnings | Met | ESLint (`npm run lint`) for JavaScript, `cargo clippy -D warnings` for Rust, both in CI |
| warnings_fixed | Met | CI fails on any warning |
| warnings_strict | Met | Clippy with warnings as errors; ESLint recommended rules plus strict equality and no-eval rules |

## Security

| Criterion | Answer | Evidence |
|---|---|---|
| know_secure_design | Met | docs/THREAT_MODEL.md, SECURITY.md |
| know_common_errors | Met | THREAT_MODEL.md covers XSS, CSRF, SSRF, injection, replay and credential stuffing, each with its control |
| crypto_published | Met | AES-256-GCM, HKDF-SHA256, HMAC-SHA256, scrypt, X25519, ML-KEM-768, WebAuthn |
| crypto_call | Met | Uses OpenSSL (Node), WebCrypto, RustCrypto, aws/tss and the audited noble libraries; no home-made primitives |
| crypto_floss | Met | All crypto libraries are open source |
| crypto_keylength | Met | 256-bit symmetric keys, X25519 + ML-KEM-768 hybrid, scrypt N=2^15 |
| crypto_working | Met | No broken algorithms for security. SHA-1 is only used for the Have I Been Pwned k-anonymity lookup, which their API requires and which protects nothing by itself |
| crypto_weaknesses | Met | No MD5, RC4, DES or ECB anywhere |
| crypto_pfs | N/A | Saathi does not implement network protocols; TLS is provided by the hosting platform. End-to-end messages use a fresh ephemeral X25519 key for every key package |
| crypto_password_storage | Met | scrypt with per-user salt and a server pepper (src/accounts/passwords.js) |
| crypto_random | Met | `crypto.randomBytes` / `crypto.getRandomValues` / `getrandom` only |
| delivery_mitm | Met | Releases and the Docker image are served over https with signed build provenance |
| delivery_unsigned | Met | Not applicable to hash retrieval; release artifacts carry SLSA provenance and SHA256SUMS |
| vulnerabilities_fixed_60_days | Met | No unpatched vulnerabilities; `npm audit` blocks CI on high severity |
| vulnerabilities_critical_fixed | Met | Same |
| no_leaked_credentials | Met | CI scans for committed secrets on every push |

## Analysis

| Criterion | Answer | Evidence |
|---|---|---|
| static_analysis | Met | CodeQL (security-extended), ESLint, Clippy, Kani proofs |
| static_analysis_common_vulnerabilities | Met | CodeQL security-extended queries |
| static_analysis_fixed | Met | CodeQL findings are fixed before merge |
| static_analysis_often | Met | Every push and weekly |
| dynamic_analysis | Met | Property-based fuzzing (fast-check) and libFuzzer on every push, end-to-end browser tests |
| dynamic_analysis_unsafe | Met | The Rust core is fuzzed with AddressSanitizer through cargo-fuzz |
| dynamic_analysis_enable_assertions | Met | Fuzz targets and tests run with assertions on |
| dynamic_analysis_fixed | Met | Fuzzing found three bugs, all fixed (SECURITY.md, Fuzzing row) |

Once the project has its number, the badge is `https://www.bestpractices.dev/projects/<number>/badge`, linked to `https://www.bestpractices.dev/projects/<number>`.
