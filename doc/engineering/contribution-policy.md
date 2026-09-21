---
id: "DOC-ENGINEERING-0002"
title: "Contribution policy — permanent repository instruction"
status: "proposed"
domain: "engineering"
owners: ["Yoshikemolo"]
applies_to: ["ximply-design-studio"]
related: []
source: ["Project owner requirements and design foundation; methodology application recorded in AUDIT-0001"]
---

# Contribution policy — permanent repository instruction

Owner: Yoshikemolo. Applies to every subsequent commit and PR in this repository.

- All repository prose, code comments, commit messages and PR title/body are English.
  UI localization catalogs are the intentional exception required by product i18n;
  the default interface is English. No emojis in authored prose or metadata.
- Commits and PRs belong to GitHub account Yoshikemolo. Local Git uses name Yoshikemolo
  and an account-verified email. CI validates associated GitHub author/committer
  logins, not a free-text claim in the message. Unmapped identities fail closed.
- No co-author, sign-off, generator, assistant or similar attribution trailers.
  Commit and PR text must not mention ChatGPT, OpenAI, AI models or providers.
  The product's AI/MCP architecture remains documented where technically necessary;
  it does not require attribution in version-control metadata.
- Do not enable automatic merge messages or bot commits that violate these rules.
  Review the final squash/merge title and body as well as source commits.
- This explicit owner instruction overrides attribution/declaration suggestions in
  the supplied methodology. PRs describe requirements, changes, evidence and risks.

## General harness

`harness/check_contribution.py` checks normalized metadata collected from GitHub
using trusted credentials/read-only API or local hooks. It rejects incorrect login,
blocked terms/trailers, emoji and common non-English boilerplate. English detection
is not a linguistic proof; a human checks natural English during review. The checker
must not be represented as capable of proving arbitrary prose is English.

`harness/collect_contribution.py` obtains PR and all commit metadata from the official
GitHub REST API, validates pagination and writes a normalized report. CI runs it with
read-only token permissions. Reports are tied to the expected head SHA; manually
edited report files are not authoritative. Before push, commit-msg hook gives early
feedback. The general CI check must become required on protected branches.

Initial repository creation preceded this policy and produced one GitHub-generated
initial commit. The policy applies to new contribution commits after that baseline;
no history is silently rewritten. Agent handoffs must carry this file's path rather
than relying on conversation memory. No cross-session memory service is assumed.

Web merges and squashes made with the GitHub merge button are committed by GitHub
(`web-flow`) and signed by GitHub. The check accepts that committer only when GitHub
reports the signature as verified, the author is still the owner, and the message
passes the same Conventional Commit and wording rules as any other commit. The
repository is configured so merge and squash commits use the pull request title and
body as their message; the title is validated by the same check. Any other committer,
an unverified signature or GitHub's default `Merge pull request ...` message fails.

Seven earlier web merges into dev used that default message before the repository
setting existed: 310daca1c44d942b10a882552dbe8f5166a0ec78,
c948cdfeeeba73fd9c32380a7c22ec111989094b, 18f571807639daa73d64ce8b7238069dcbc79f28,
174c5471381e06b2db92fb9eb78801eee520e444, e05fbf4ae2756d61c3934122d1ec9244bfbd2ba8,
afec8b1530a3193e3807c9e5c5cfc766e00dac35 and 03bf3ba042587a8aa332392b3d2c6c7acaf06e97.
They are listed with a reason under `legacyCommitExemptions` in
`harness/contribution-policy.json` instead of rewriting shared history. Exemptions match
exact full SHAs only; a malformed entry fails closed. Adding an entry is an owner
decision recorded in review, never a way to pass a new commit.

## Authorization scope

The owner's permission and persistent preferences apply only to ximply-design-studio.
No write authorization is extended to other projects. ximply-ai-devflow is a read-only
reference. Changelog discipline is recorded in AGENTS.md and the product footer and
changelog contract; it is a repository rule, not an asserted account-wide memory.

## Before publishing any contribution

Validate proposed text before creating a commit or PR, including connector-created
commits which do not invoke a local Git hook. Store the exact proposed texts in
local files; do not include these temporary files in the commit.

```bash
python harness/check_contribution.py --message-file /path/to/commit-message.txt --pr-title-file /path/to/pr-title.txt --pr-body-file /path/to/pr-body.md
```

This offline check validates wording only. Verify the authenticated GitHub account
is Yoshikemolo before publication and verify author/committer mapping on the returned
commit before advancing a branch. For existing PRs, collect trusted metadata and run
`check_contribution.py` against the full current head, including every introduced
merge commit. Combining a report with proposed text checks enforces both; valid
proposed text never masks invalid existing metadata.

Local commits should enable `git config core.hooksPath .githooks` and use the owner's
verified Git identity. Hooks do not run for web or API commits and are not the server
quality gate. GitHub's merge button always records the web-flow committer, even when
the person clicking it is the owner. That identity passes only under the verified
web-flow rule above, with the pull request title as a Conventional Commit message.
Integration must preserve validated commits under the existing GitFlow/review rules;
never force-push or bypass required protections.

PR 8 illustrates this distinction: the source conflict is fixed, but merge commits
7c2af886570ded96107934cd2822f4665e3448e4 and
aa92505cd29dedcb6d13e414db875679543e390e still fail metadata policy. Adding a later
valid commit cannot change their immutable metadata. Repairing shared history or
approving any exact historical exception requires a separate explicit owner decision;
no such exception is introduced by this preflight improvement.

Before enabling or publishing a workflow requiring an external service, verify its
host, permissions, credentials and evidence-production process exist. For the strict
quality workflow this means a reachable Sonar service, SONAR_HOST_URL and
SONAR_ANALYSIS_MANIFEST_JSON variables, and a privately configured SONAR_TOKEN secret.
The manifest must come from successful scans of the candidate revision; it is not
an invented configuration default. Also measure coverage locally: configuration
alone does not resolve coverage below policy. If a dependency is unavailable, report
that blocker before publication and do not claim the candidate is ready for merge.
After publication, inspect all current-head workflow conclusions, not just test jobs.
