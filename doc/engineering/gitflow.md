---
id: "DOC-ENGINEERING-0004"
title: "GitFlow profile"
status: "proposed"
domain: "engineering"
owners: ["Yoshikemolo"]
applies_to: ["ximply-design-studio"]
related: []
source: ["Project owner requirements and design foundation; methodology application recorded in AUDIT-0001"]
---

# GitFlow profile

This is the owner's GitFlow variant, using the exact branch families requested.

| Branch | Purpose | Allowed source |
| --- | --- | --- |
| dev | Integration baseline | Reviewed feat/* or fix/* after required quality checks |
| feat/* | New work | Created from current dev |
| fix/* | Corrections | Created from current dev |
| qa | Validation candidate | Exact selected dev candidate |
| demo | Demonstration deployment | Validated dev candidate promoted after qa |
| release | Release candidate | Same validated dev candidate, independent of demo-only configuration |
| main | Stable production baseline | Explicitly approved release candidate |

Create branches as `feat/FEAT-0003-docking` or `fix/SC-0008-focus-recovery`.
No new work starts from main, release, qa or demo. Environment differences belong
in versioned deployment configuration, not divergent product implementations.

## Work and promotion

1. Fetch dev; create a feat/* or fix/* branch at its current head. Record base SHA.
2. Implement the slice, tests, contracts and docs. Use Conventional Commits in English.
3. PR to dev. Required functional/security/contracts/metadata checks and fresh Sonar
   metrics must pass on the candidate commit. Validate the prospective merge result
   as well, using a merge queue or updated branch when base changes.
4. After required owner/reviewer approval, merge to dev. The owner has requested this
   workflow; a failed or missing check never authorizes merge.
5. Promote the same immutable candidate to qa and validate there; then propagate to
   demo and release with tracked promotion PRs/checks. Do not rebuild different source
   for each environment. Deploy images by digest using an environment manifest.
6. Promote release to main and deploy production only after explicit release approval
   and a configured destination. No production target is known yet.

Direct protected-branch pushes, force pushes, bypasses and bot-authored commits are
forbidden. Automation can open/prepare promotion work under the owner's authorized
account but must not invent a successful gate or required human review. If histories
have diverged, prepare a conflict-resolution PR based on dev and validate the resulting
merge; do not reset other branches destructively. Fixes always originate from dev
and propagate through this process. Use merge strategies whose final message also
satisfies Conventional Commits and contribution policy. GitHub's default `Merge pull
request...` message is not automatically compliant; set a reviewed conventional title.

## Required configuration before implementation merges

Protect dev, qa, demo, release and main with applicable status checks, current-head
analysis, resolved conversations, human review and no force push/bypass. The branch
names now exist, but protection and deployment environments must be verified/configured
separately; existence is not enforcement. Use read-only workflow permissions by default.
Never hand repository-wide write credentials to code from an untrusted public fork.

Bootstrap design is on feat/initial-design, based on dev. The earlier bootstrap/design
branch was created before this instruction and contains only the initial baseline;
it carries no new work. Design checks do not substitute for the product Sonar gate.
