---
id: "DOC-ENGINEERING-0001"
title: "Documentation navigation migration"
status: "proposed"
domain: "engineering"
owners: ["Yoshikemolo"]
applies_to: ["ximply-design-studio"]
related: []
source: ["Project owner requirements and design foundation; methodology application recorded in AUDIT-0001"]
---

# Documentation navigation migration

Requirement: consolidate documentation under `/doc` and enable selective linked
retrieval for maintainers and agents. This corrects the open design foundation.

## Scope and acceptance

Move root ADR and `/docs` content to `/doc`, preserving all existing requirement
IDs. Use lowercase category directories. Add PO records, category indexes, a code
map and bounded ID lookup with bidirectional requirement links. Rewrite local
references and reject stale generated navigation in CI.

## Risks and migration

External links to the old branch paths can break. Historical commit permalinks
remain valid; new links must use `/doc`. There are no duplicated canonical trees
or filesystem symlinks. Contracts and product semantics are unchanged. Rollback
is a normal reviewed revert of the migration commit, not a history rewrite.

## Verification

Documentation link validation, current generated indexes, reverse relationships,
scenario-to-feature retrieval, invalid IDs, nonexistent implementation paths and
unknown decisions are checked locally. These checks do not substitute for Sonar
analysis or implemented product acceptance. The product remains unimplemented.
