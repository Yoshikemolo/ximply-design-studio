# ximply-design-studio

A layered vector and image editor by Ximplicity.

**0.2.0-alpha.2 — first single-user local preview.** Draw shapes and freehand paths,
edit text, transform layers, import and retouch images, undo/redo, save editable
projects and export PNG/SVG. The architecture for the broader professional platform
remains documented; this alpha implements a bounded first slice.

## Quick Start

Requirements: Git, Docker Desktop/Engine with Compose v2, and Python 3.11+.

```bash
git clone --branch feat/first-editor https://github.com/Yoshikemolo/ximply-design-studio.git
cd ximply-design-studio
./scripts/local.sh start
```

On Windows, run `./scripts/local.ps1 start`. Open **http://localhost:8080**.
The launcher creates a private local environment file and publishes only on loopback.
Drawing and local project-file save/open do not require server authentication.

[quick-install.md](quick-install.md) contains setup, server-storage authentication,
keyboard shortcuts, cleanup and development commands.
[trhouble-shooting.md](trhouble-shooting.md) covers common failures.

## Included in the alpha

- Rectangles, ellipses, freehand vector paths and editable text.
- Layer selection, movement, corner resizing, rotation, ordering, visibility, locks,
  opacity and blend modes.
- PNG/JPEG/WebP import, raster brush/eraser and non-destructive image adjustments.
- Undo/redo, native .ximply save/open, PNG export and supported-vector SVG export.
- Dark/light themes, EN/ES interface labels, collapsible/reorderable panels.
- Three.js layer-plane inspection with camera orbit, zoom and pan.
- About screen with a version selector and bundled Markdown release notes.
- Bearer-protected FastAPI artifact storage for one local user.

The preview does not implement production Keycloak integration, PostgreSQL/TypeORM
transactions, multiuser collaboration, desktop windows, third-party plugin loading,
CSG modeling, advanced selection masks, animation or PSD/Illustrator native fidelity.
The local file repository is an artifact adapter, not a replacement for the planned
transactional persistence service. Do not expose this preview as a production service.

## Engineering and documentation

- [Documentation entry map](doc/INDEX.md) and [agent rules](AGENTS.md)
- [Functional specification](doc/product/functional-specification.md)
- [Proposed architecture](doc/architecture/system-overview.md) and [ADRs](doc/adr/INDEX.md)
- [First editor scope and evidence](doc/implementation/PLAN-0002-0001.md)
- [Methodology audit](doc/testing/methodology-audit.md)
- [Contribution rules](CONTRIBUTING.md) and [GitFlow](doc/engineering/gitflow.md)
- [Changelog](CHANGELOG.md) and [release-note contract](doc/product/footer-and-changelog.md)

The source of truth for current version is `release/version.json`. Release notes are
Markdown under `doc/changelog`; bundled data is generated. Credentials, dependencies,
build outputs and local project files are not committed.

## Local validation

```bash
npm ci --ignore-scripts
npm run build
npm test
python3 harness/context.py --check
python3 harness/knowledge.py
python3 harness/changelog.py --check
python3 harness/check_docs.py
python3 -m unittest discover -s tests -v
```

API tests require `services/api/requirements-dev.txt`, then
`python -m pytest services/api/tests -q`.

The Angular production build and automated tests pass. GitHub Actions also builds
and starts the Docker preview, then verifies frontend delivery, authentication,
artifact round-trip and the About deep link. See the [recorded container run](https://github.com/Yoshikemolo/ximply-design-studio/actions/runs/35444283893).
Visual browser acceptance remains unverified because the remote browser cannot reach
the development host. The strict SonarQube gate, protection verification and independent
human review are still required before merging. The preview remains available from
its feature branch for local evaluation; these tests are not full product certification.

Public visibility is requested. A distribution license is not yet selected; see
[LICENSE-DECISION.md](LICENSE-DECISION.md). Owner and reviewer: Yoshikemolo.
