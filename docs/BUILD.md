# Building Saathi, and checking a release

## What you need

- Node.js 22 and npm
- Rust 1.97 (`rustup`; `rust-toolchain.toml` pins the exact version and the `wasm32-unknown-unknown` target)
- Optional: Docker, Inno Setup 6 (Windows installer), JDK 17 and Gradle 8.11 (Android)

## Build

```bash
npm ci                 # exact dependencies from package-lock.json
npm run build:core     # Rust security core -> src/security/saathi-core.wasm
cargo build --locked --release -p saathi-broker -p saathi-launcher
npm test
```

The web app is plain JavaScript and needs no build step. `docker build .` builds the same thing in a container.

## Reproducible builds

Two people building the same commit get bit-for-bit identical results.

- **WebAssembly core.** `scripts/build-core.js` builds with `--locked`, the pinned toolchain, `CARGO_INCREMENTAL=0`, `SOURCE_DATE_EPOCH=0` and `--remap-path-prefix` so no paths, times or machine details end up in the file. `npm run check:core` builds it twice from clean and fails if the hashes differ; the Proofs workflow runs this on every push.
- **Source archive.** Release archives are made with `git archive` from the tagged commit, so anyone can recreate them:

  ```bash
  git archive --format=tar.gz --prefix=saathi-1.3.0/ -o saathi-1.3.0.tar.gz v1.3.0
  sha256sum saathi-1.3.0.tar.gz    # compare with SHA256SUMS on the release
  ```

- **Dependencies.** `package-lock.json` and `Cargo.lock` pin every dependency by version and hash; CI installs with `npm ci` and `cargo --locked`, and checks that every npm package carries a valid registry signature.

## Checking a release

Every release file is built and signed in GitHub Actions, never on a personal computer. To check one:

```bash
gh attestation verify saathi-1.3.0.tar.gz --repo akshatinnovate-png/Saathi-Alexa
sha256sum -c SHA256SUMS
```

The `.intoto.jsonl` / `.sigstore.json` files next to each download are the same Sigstore provenance bundles, for tools such as `slsa-verifier` or `cosign`.
