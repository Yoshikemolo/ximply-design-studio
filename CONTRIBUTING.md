# Contributing

Owner: Yoshikemolo. Read AGENTS.md, docs/engineering/gitflow.md and
[contribution policy](docs/engineering/contribution-policy.md) before changes.

All new work starts at current dev on feat/* or fix/*. Use Conventional Commits in
English, no emojis, attribution trailers or provider/model mentions in commit/PR
text. Commit and PR identities must map to Yoshikemolo. Do not use bot commits.

Link FEAT/SC/ADR/SEC, define independent acceptance evidence, implement small slices,
update tests/contracts/migrations/docs and run all applicable checks. Code merges
to dev only after fresh functional/security/quality results and required human review;
then the same candidate progresses to qa, demo and release. Production main promotion
requires release approval. Missing Sonar evidence is a failure, never a reason to
skip the gate. Use the project GitFlow document for branch and promotion details.

Run the current design checks:

```bash
python3 harness/check_docs.py
python3 -m unittest discover -s tests -v
```

Install the local message hook after reviewing it:

```bash
git config core.hooksPath .githooks
```

The project licence is still an owner decision. No product module is implemented;
start with SPIKE-0001 and the infrastructure/quality slice in ITER-0001.
