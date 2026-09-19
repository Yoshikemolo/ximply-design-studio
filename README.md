# ximply-design-studio

Professional, extensible vector, raster, 3D and animation design studio.

**Status: architecture and engineering bootstrap, v0.1.0-design.1. The editor is not implemented.**
This repository contains the functional and technical design, proposed ADRs,
traceable features and scenarios, contracts, local infrastructure definitions,
and executable documentation/quality-policy harnesses. It does not claim an
operational Angular editor, authenticated API, renderer or collaboration server.

Product owner and architectural reviewer: Yoshikemolo.

## Start here

- [Product overview](doc/product/overview.md)
- [Documentation index](doc/INDEX.md)
- [Commercial model](doc/product/commercial-model.md)
- [Ximplicity UX direction](doc/product/ux-direction.md)
- [Functional specification](doc/product/functional-specification.md)
- [System architecture](doc/architecture/system-overview.md)
- [Architecture decisions](doc/adr/README.md)
- [Features and scenarios](doc/planning/backlog.md)
- [Local setup](doc/operations/local-development.md)
- [Agent workflow](AGENTS.md)
- [Verification evidence](doc/testing/bootstrap-evidence.md)
- [Research and version evidence](doc/research/sources.md)

## Architecture

Angular/TypeScript SPA and Electron windows share the same editor domain and
plugin SDK. FastAPI owns application orchestration and compute APIs. A private
Node/TypeORM persistence service owns PostgreSQL transactions. A small ASP.NET
Core SignalR gateway provides presence and event delivery. Redis supplies fast
ephemeral messages and recoverable job streams; PostgreSQL remains authoritative.
Immutable binaries use an object-store port. GPU rendering lives in the client;
optional GPU compute workers run separately from API processes.

TypeORM is not a Python ORM. SignalR is not a FastAPI server feature. These
requirements deliberately introduce two auxiliary runtimes; see ADR-0002 and
ADR-0003. SQLAlchemy plus plain WebSockets is a documented alternative, not an
unannounced substitution.

## What can run now

From this directory, Python 3.11 or later:

```bash
python3 harness/check_docs.py
python3 -m unittest discover -s tests -v
```

Infrastructure can be provisioned separately after selecting exact image
digests; see the local-development guide. Starting infrastructure does not start
the future editor. No production service or Quality Gate has been deployed by
this bootstrap.

## Planned repository boundaries

| Location | Responsibility |
| --- | --- |
| `apps/web` | Angular shell, windows, panels and view models |
| `apps/desktop` | Electron host and narrow native bridge |
| `packages/*` | Domain, commands, renderer, plugin SDK, design tokens |
| `services/api` | Python FastAPI orchestration and policy |
| `services/persistence` | TypeScript/TypeORM transactional persistence |
| `services/realtime` | .NET SignalR authorized delivery |
| `services/worker` | Python CPU/GPU processing |
| `contracts` | Versioned document, plugin, API and event contracts |
| `doc/adr` | Proposed decisions requiring human acceptance |
| `doc/feat`, `doc/sc`, `doc/sec`, `doc/po` | Features, scenarios, security controls and product outcomes |
| `harness`, `tests` | Executable governance checks and their tests |

## Quick Start

The public repository is [Yoshikemolo/ximply-design-studio](https://github.com/Yoshikemolo/ximply-design-studio).
The design is on `feat/initial-design`, based on `dev`, for review. Product services
are planned; the current executable entry point validates the engineering package.

```bash
git clone --branch feat/initial-design https://github.com/Yoshikemolo/ximply-design-studio.git
cd ximply-design-studio
python3 harness/check_docs.py
python3 -m unittest discover -s tests -v
```

See [quick-install.md](quick-install.md) for Bash/PowerShell infrastructure commands,
[trhouble-shooting.md](trhouble-shooting.md) for diagnosis, and
[GitFlow](doc/engineering/gitflow.md) for dev/feat/fix/qa/demo/release/main promotion.
The requested troubleshooting filename is preserved; `trouble-shooting.md` links to it.

## Quality and licensing

All implemented modules must pass functional scenarios and the strict profile in
`harness/quality-policy.json`. Zero bugs, vulnerabilities, code smells and security
hotspots; coverage strictly greater than 80%; duplication strictly below 3%.
Missing or stale analysis is a failure, not success. Documentation-only checks
cannot demonstrate product quality.

Public visibility is requested. An open-source licence has **not** been chosen;
see LICENSE-DECISION.md. The supplied organizational methodology is referenced
and adapted; the original file is not republished in this public-ready package.
