# Documentation and context protocol

[Context entry](../INDEX.md) | [Methodology profile](../ai/methodology-adoption.md)

## Stable identifiers

Use `/doc/{adr,sc,feat,po,sec}/PREFIX-NNNN.md`. Prefixes are uppercase and directories
lowercase. Allocate the next unused four-digit ID after fetching current dev and
checking open branches/PRs for reservations. Never renumber existing documents or
reuse retired IDs. Titles describe intent; statuses distinguish proposals from
verified behavior. PO means Product Outcome in this project.

## Retrieval

1. Read AGENTS.md and the entry map, then select an ID by its category index.
2. Run `python3 harness/context.py FEAT-0003` (or another exact ID).
3. Read the selected document and relevant immediate neighbors only.
4. Use the code map and scoped symbol search. Read exact code/test units as needed.
5. Expand to dependencies only when a concrete question requires them.

## Update transaction

Create a document from the matching template. Update the feature registry when
adding features, scenarios, ADR dependencies or real implementation/test paths.
Update product outcomes and security controls when intent or policy changes.
The registry is authoritative for feature relationships; generated Navigation
sections and category indexes must not be edited manually. Existing narrative
links remain authored and must stay consistent with the registry.

```bash
python3 harness/context.py --write
python3 harness/context.py --check
python3 harness/check_docs.py
python3 -m unittest discover -s tests -v
```

Commit docs, relevant source, tests and evidence together. Save meaningful progress
checkpoints to GitHub with the required identity and Conventional Commits. Stay on
the current feat/fix branch; no merge or promotion without the required quality gate.
When a document is superseded, retain its ID and point to its successor.

## Evidence and limits

Do not populate code/test links with nonexistent files or claim module READMEs are
implementations. Implementation and tests fields contain repository-relative file
paths; evidence records identify revision, command, result and artifact. Status
Verified still requires the full quality policy. Index checks prove navigation
consistency, not specification truth, coverage or architecture acceptance.
