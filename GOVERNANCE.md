# Governance

Saathi is a small open source project. This page says who decides what, how decisions are made, and how the project keeps going if someone steps away.

## Roles and responsibilities

| Role | Who | Responsibilities |
|---|---|---|
| Maintainer | [@akshatinnovate-png](https://github.com/akshatinnovate-png) (Akshat Sarkar) | Sets direction, reviews and merges pull requests, cuts releases, answers security reports, owns repository settings and secrets |
| Reviewer | Listed in [MAINTAINERS.md](MAINTAINERS.md) | Reviews pull requests in their area; their approval counts towards the two-person rule below |
| Contributor | Anyone who opens an issue or pull request | Follows [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) |

A contributor becomes a reviewer after several accepted pull requests and an invitation from a maintainer. A reviewer becomes a maintainer the same way. Both are recorded in [MAINTAINERS.md](MAINTAINERS.md) in a pull request.

## How decisions are made

- Day-to-day changes are decided in the pull request that makes them.
- Every change to `main` goes through a pull request. Once the project has two or more maintainers or reviewers, at least one person other than the author must approve it before it is merged (the two-person rule). Branch protection on `main` enforces this.
- Larger changes (new data that Saathi stores, new outside services, changes to who may see what, anything in `core/src/policy.rs`) start as an issue labelled `proposal` and stay open for at least 7 days for comments.
- If people disagree, the maintainers decide, preferring the option that is safest for elders and their data.

## Releases

Releases follow [semantic versioning](https://semver.org). The maintainer runs the Release workflow, which tests, builds, signs (Sigstore build provenance) and publishes every artifact from GitHub Actions. Nobody uploads release files by hand.

## Access continuity

Saathi must keep going if any one person disappears.

- Code, issues, releases, the container image and CI all live on GitHub; nothing needs a personal machine.
- Every release can be rebuilt from source by anyone (see [docs/BUILD.md](docs/BUILD.md)).
- Repository admin rights are held by every maintainer. The maintainer keeps a sealed recovery note (GitHub recovery codes and the list of repository secrets) with a trusted second person, who can hand the project to a new maintainer.
- Secrets used by workflows (signing keys, tokens) can all be regenerated; none is needed to read, build or verify a past release.

## Changes to this document

Changes to this governance follow the "larger changes" process above.
