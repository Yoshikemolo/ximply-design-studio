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
