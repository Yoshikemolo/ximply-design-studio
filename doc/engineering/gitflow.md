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

This is the owner's GitFlow variant. The 2026-09-19 cleanup decision retains dev,
release and main plus active feature/fix branches; it supersedes permanent qa/demo
branches. QA and demo remain validation/deployment environments.

| Branch | Purpose | Allowed source |
| --- | --- | --- |
| dev | Integration baseline | Reviewed feat/* or fix/* after required quality checks |
| feat/* | New work | Created from current dev |
| fix/* | Corrections | Created from current dev |
| release | Release candidate | Same validated dev candidate, independent of demo-only configuration |
| main | Stable production baseline | Explicitly approved release candidate |

Create branches as `feat/FEAT-0003-docking` or `fix/SC-0008-focus-recovery`.
No new work starts from main or release. Environment differences belong
in versioned deployment configuration, not divergent product implementations.

## Work and promotion

1. Fetch dev; create a feat/* or fix/* branch at its current head. Record base SHA.
2. Implement the slice, tests, contracts and docs. Use Conventional Commits in English.
3. PR to dev. Required functional/security/contracts/metadata checks and fresh Sonar
   metrics must pass on the candidate commit. Validate the prospective merge result
   as well, using a merge queue or updated branch when base changes.
4. After required owner/reviewer approval, merge to dev. The owner has requested this
   workflow; a failed or missing check never authorizes merge.
5. Validate the same immutable candidate in the qa environment, then demonstrate it
   in demo and prepare release through tracked checks. Do not rebuild different source
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

Protect dev, release and main with applicable status checks, current-head
analysis, resolved conversations, human review and no force push/bypass. The branch
names now exist, but protection and deployment environments must be verified/configured
separately; existence is not enforcement. Use read-only workflow permissions by default.
Never hand repository-wide write credentials to code from an untrusted public fork.

Bootstrap design is on feat/initial-design, based on dev. The earlier bootstrap/design
branch was created before this instruction and contains only the initial baseline;
it carries no new work. Design checks do not substitute for the product Sonar gate.

## Integration preflight

This checklist is persistent project guidance for each contributor and review.
Concurrent edits can still cause conflicts; verification must be repeated whenever
base or head changes. A previously green PR does not validate another revision.

1. Fetch origin. Read the PR's actual base/head and full SHAs; do not infer them from
   its title. Feature/fix PRs target dev. Promotion to main follows release approval.
2. Use a clean isolated worktree to inspect `git merge-tree --write-tree BASE HEAD`
   with a current Git version. A nonzero result blocks integration. Resolve source
   Markdown intentionally, preserving both changes, then regenerate derived files.
   Never use blanket ours/theirs resolution or manually patch generated indexes.
3. Read `harness/contribution-policy.json`. Validate the English Conventional Commit
   PR title and every introduced commit, including merge commits. Both GitHub author
   and committer logins must match the owner. Existing exact exemptions are not
   permission to add more. Default web merges can create noncompliant history.
4. Run the applicable checks below and inspect GitHub results at the final head.
   Refresh the base once more before integration; serialize promotions when another
   PR is advancing the same branch. Clear stale evidence after any change.
5. Preserve missing/failed quality evidence and outstanding independent review as
   blockers. Conflict-free does not mean approved. Shared branches are not reset or
   directly updated to bypass the integration boundary.

| Check | Reproducible command or evidence |
| --- | --- |
| Generated navigation | `python harness/context.py --check` |
| IDs, links and reachability | `python harness/knowledge.py` |
| Release artifacts and change impact | `python harness/changelog.py --check --base BASE_SHA --head HEAD_SHA` |
| Contracts and documentation | `python harness/check_docs.py` |
| Engineering tests | `python -m unittest discover -s tests -v` |
| Contribution metadata | Collect through `harness/collect_contribution.py`, then `python harness/check_contribution.py reports/contribution.json --head HEAD_SHA` |
| Production UI and stylesheet | `npm ci --ignore-scripts --no-audit --no-fund`, `npm run build`, `python scripts/check_styles.py` |
| Editor and API tests | `npm test`, `python -m pytest services/api/tests -q` |
| Packaged application | Compose configuration, disposable build/start and `python scripts/smoke_local.py` as defined in editor-checks.yml |
| Strict product quality | Fresh trusted Sonar collection and `python harness/check_quality.py reports/quality.json --revision HEAD_SHA`; all module thresholds and review remain mandatory |

Regenerate with `python harness/context.py --write` and
`python harness/changelog.py --write` before checking. Run commands in the repository
root; BASE_SHA and HEAD_SHA are full revisions, not literal placeholders. Product
quality requires zero bugs, vulnerabilities, code smells and hotspots, line/branch
coverage strictly above 80 percent and duplication strictly below 3 percent under
the existing whole-code/new-code and module policy.

As inspected for PR 8, published workflows contain design, contribution and editor
jobs. Deployment is deliberately blocked until configured. They do not execute a
Sonar analysis; a green result from these workflows is not the strict product gate.
Branch protection requirements and Sonar service configuration must be verified
separately. PR descriptions must state these limits instead of checked template
claims with no linked evidence.

## Cleanup checkpoint — 2026-09-19

GitHub inventory verified five branches: dev, release, main, feat/drawing-preview
and fix/contribution-preflight. PRs 8, 10 and 11 are closed without merging; no PRs
remain open. Nine retired branches were removed. Their implementations are retained
in surviving history; the quality-evidence branch's lone non-ancestor commit
832c0b8b0984fa0a0cd684a859624eecdf8198f8 was patch-equivalent to work already on dev.
No shared history, check result, protection or gate was rewritten or suppressed.

Main remains the existing editor baseline; release remains the earlier design
baseline. No unverified preview was promoted to make their heads appear aligned.
Drawing and preflight improvements remain on the two active branches. Historical
contribution-policy violations, missing Sonar configuration/evidence and coverage
gaps remain explicit blockers to future integration. A tidy branch inventory does
not make those failures pass.

Later the same day the owner asked to consolidate both active branches into dev.
Their unmerged work was replayed as squashed commits with conforming metadata, the
remaining historical web merges were pinned by exact SHA, and the branches were
retired. The Sonar gate stays paused by owner decision and is not evidence of quality.
