# Documentation entry map

Read this map first. Retrieve one requirement and its immediate links; do not load
all indexes or the complete specification into every working context.

| Task | Entry point |
| --- | --- |
| Product intent and scope | [PO index](po/INDEX.md) |
| Implement a capability | [FEAT index](feat/INDEX.md) |
| Verify or fix behavior | [SC index](sc/INDEX.md) |
| Review an architectural choice | [ADR index](adr/INDEX.md) |
| Assess security | [SEC index](sec/INDEX.md) |
| Locate code and tests | [Code map](code-map.md) |
| Add or update documentation | [Documentation protocol](engineering/documentation-protocol.md) |
| Understand system boundaries | [Architecture](architecture/system-overview.md) |
| Plan delivery | [Backlog](planning/backlog.md) and [iterations](planning/iterations.md) |
| Run locally | [Operations](operations/local-development.md) |
| Check completed work | [Evidence](testing/bootstrap-evidence.md) |
| Apply source methodology | [Project adaptation](ai/methodology-adoption.md) |

Retrieve an ID without printing document bodies:

```bash
python3 harness/context.py FEAT-0003
python3 harness/context.py SC-0008
```

The result lists immediate relationships and recorded implementation/test paths.
Follow relevant links only. Empty code/test arrays explicitly mean implementation
has not been recorded. This is an exact document graph, not a semantic search or
an implemented symbol/call graph. Use targeted `rg` searches once a module is known.
