---
id: "DOC-ROOT-0002"
title: "Code and contract map"
status: "proposed"
domain: "."
owners: ["Yoshikemolo"]
applies_to: ["ximply-design-studio"]
related: ["DOC-ROOT-0001"]
source: ["Project owner requirements and design foundation; methodology application recorded in AUDIT-0001"]
---

# Code and contract map

[Context entry](INDEX.md). Product modules below are planned boundaries, not working
implementations. Actual source and test paths belong in each feature's
[traceability record](planning/traceability.json) as they are implemented.

| Concern | Planned module or existing artifact |
| --- | --- |
| Shell, docking, localization | [Web](../apps/web/README.md) |
| Desktop and native windows | [Desktop](../apps/desktop/README.md) |
| Commands and document model | [Domain](../packages/domain/README.md) |
| Raster/vector/spatial rendering | [Renderer](../packages/renderer/README.md) |
| Tool and panel extensions | [Plugin SDK](../packages/plugin-sdk/README.md) |
| Theme tokens | [Design system](../packages/design-system/README.md) |
| API and permissions | [API](../services/api/README.md) |
| Transactions and repositories | [Persistence](../services/persistence/README.md) |
| Presence and shared events | [Realtime](../services/realtime/README.md) |
| CPU/GPU processing | [Worker](../services/worker/README.md) |
| Wire and file schemas | [Contracts](../contracts/README.md) |
| Documentation validation | [Checker](../harness/check_docs.py), [tests](../tests/test_docs.py) |
| Context retrieval and indexes | [Context tool](../harness/context.py) |

After finding the boundary, search for the exact ID or symbol with `rg -n` scoped
to that directory. Record stable file paths and symbol names, not fragile line
numbers. Add requirement IDs to relevant source docstrings and test descriptions
when implementing; verify reverse discovery with `rg -n 'FEAT-0003|SC-0008'`.
