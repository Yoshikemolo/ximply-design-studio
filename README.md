# ximply-design-studio

A layered vector and image editor by Ximplicity.

**0.3.5-alpha.1 — single-user drawing workbench preview.** Draw editable cubic paths
and construction shapes, refine paths, trace images, reuse symbols, edit text inline,
transform layers, retouch images and save editable projects or PNG/SVG exports. The architecture for the broader professional platform
remains documented; this alpha implements a bounded first slice.

## Quick Start

Requirements: Git, Docker Desktop/Engine with Compose v2, and Python 3.11+.

```bash
git clone --branch feat/drawing-preview https://github.com/Yoshikemolo/ximply-design-studio.git
cd ximply-design-studio
./scripts/local.sh start
```

On Windows, run `./scripts/local.ps1 start`. Open **http://localhost:8090**.
The launcher creates a private local environment file and publishes only on loopback.
Drawing and local project-file save/open do not require server authentication.

[quick-install.md](quick-install.md) contains setup, server-storage authentication,
keyboard shortcuts, cleanup and development commands.
[trhouble-shooting.md](trhouble-shooting.md) covers common failures.

## Included in the alpha

- Cubic Pen, direct anchor editing, construction primitives and path refinement.
- Multiple selection, nested groups, alignment/distribution and vector boolean operations.
- Bounded scanline image tracing and local linked symbols with painting tools.
- Freehand vector paths and inline editable text.
- Layer selection, movement, corner/edge resizing, rotation handles, ordering, visibility, locks,
  opacity and blend modes.
- PNG/JPEG/WebP import, raster brush/eraser and non-destructive image adjustments.
- Undo/redo, native .ximply save/open, PNG export and supported-vector SVG export.
- Rotate/Reflect/Scale tool families, triangular flyouts and numeric group transforms.
- Configurable collision-checked shortcuts, Shift angle constraints and tool cursor badge.
- Shared fill/stroke palette with independent alpha, no-color and quick swatches.
- Configurable distance/font units, rulers, guide layers, grid and independent snapping.
- Dark/light themes, EN/ES interface labels and configurable context blocks.
- Three.js layer-plane inspection with camera orbit, zoom and pan.
- About screen with a version selector and bundled Markdown release notes.
- Bearer-protected FastAPI artifact storage for one local user.

Native saves now use format 2; preserve original v1 files because older readers
cannot open new saves. Tracing is capped at 64 pixels per side; curved vector erasure
is sampled. Nonuniform group scaling preserves rotated child geometry through centered shear.
Nine-slice insets are fixed; registration/slice-guide editing and full
graphic styles remain pending. See the [drawing roadmap](doc/planning/drawing-roadmap.md).

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
- [Drawing iteration and acceptance](doc/implementation/PLAN-0008-0001.md)
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

The earlier local preview has [recorded container evidence](https://github.com/Yoshikemolo/ximply-design-studio/actions/runs/35444283893).
That historical run does not validate this drawing iteration. Record current revision
build/test/CI evidence in the [drawing plan](doc/implementation/PLAN-0008-0001.md).
Visual browser acceptance, the strict SonarQube gate, protection verification and
independent human review remain required before merging. Feature-branch availability
allows local evaluation; it is not full product certification.

Public visibility is requested. A distribution license is not yet selected; see
[LICENSE-DECISION.md](LICENSE-DECISION.md). Owner and reviewer: Yoshikemolo.
