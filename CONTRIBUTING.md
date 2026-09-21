# Contributing

Owner: Yoshikemolo. Read [AGENTS.md](AGENTS.md), [GitFlow](doc/engineering/gitflow.md)
and the [contribution policy](doc/engineering/contribution-policy.md) before any change.

## Who may contribute

This project is published under the [Ximply Design Studio Limited Use Licence](LICENSE),
a proprietary licence, not an open source one. Reading the code, running it and studying
it are allowed; modifying it, building anything derived from it, distributing it and any
commercial use need the written permission of the author. The repository being public
is not that permission.

For that reason contributions from outside are not accepted by default. Issues that
report a problem or suggest an improvement are welcome. A pull request, a patch or any
other change is considered only after the author has agreed in writing to receive it and
on the terms the author sets for it; without that agreement it is closed unread. See
[LICENSE-DECISION.md](LICENSE-DECISION.md) for what the licence decision does and does
not settle.

## How changes are made

- Every work block starts at the current `dev` on a `feat/*`, `fix/*` or `docs/*`
  branch, and reaches `dev` through a pull request. Validated work is promoted from
  `dev` to `release`, and from `release` to `main` only with the owner's explicit release
  approval. `qa` and `demo` are environments, not branches.
- Commits and pull requests use Conventional Commits in English, with no emojis, no
  attribution trailers and no mention of a provider or a model. Author and committer
  must map to Yoshikemolo; bot commits are not accepted. Check a message, a title and a
  body with `harness/check_contribution.py` before using them.
- Link the FEAT, SC, ADR and SEC records a change touches, state its acceptance oracle
  first, implement it in small slices, and keep tests, contracts, documentation and the
  traceability registry in the same change. Agents may draft decisions; only the owner
  accepts them.
- Every change that users notice is recorded in
  [doc/changelog/Unreleased.md](doc/changelog/Unreleased.md), or in the notes of a new
  version, as [the changelog rules](doc/product/footer-and-changelog.md) describe.
  Breaking changes are stated with their migration. Generated release data is rebuilt,
  never edited by hand.

## Checks

Run the checks that apply before opening a pull request:

```bash
npx vitest run
npx -y node@24.15.0 node_modules/@angular/cli/bin/ng.js build --configuration production
python harness/check_docs.py
python harness/knowledge.py
python harness/context.py
python harness/changelog.py --check
python -m unittest discover -s tests -v
```

The API has its own suite under `services/api/tests`. On Windows, set `PYTHONUTF8=1`
for the harness scripts.

Install the local message hook after reviewing it:

```bash
git config core.hooksPath .githooks
```

The strict Sonar check on pull requests is paused at the owner's request, as AGENTS.md
records. A skipped or missing Sonar result is not quality evidence and never counts as a
pass; merging still needs the other checks and the owner's review.

## Previews

`scripts/deploy-production.ps1` publishes a committed checkout to the owner's preview
address, https://xds.ximplicity.es, as
[the preview host document](doc/operations/preview-host.md) describes. Publishing a
preview is not a release and grants nothing the licence does not.
