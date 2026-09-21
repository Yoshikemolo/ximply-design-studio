# Quick install — local editor preview

Version: see [release notes](CHANGELOG.md). This distribution is a single-user local
alpha. It does not require a paid service or expose a public server.

## Docker Desktop route

Requirements: Git, Docker Engine/Desktop with Docker Compose v2, and Python 3.11+.
Allow roughly 4 GB available memory for the initial build. Docker must use a local
socket context. Windows users should enable Docker Desktop's Linux containers.

```bash
git clone --branch feat/drawing-preview https://github.com/Yoshikemolo/ximply-design-studio.git
cd ximply-design-studio
./scripts/local.sh start
```

PowerShell:

```powershell
git clone --branch feat/drawing-preview https://github.com/Yoshikemolo/ximply-design-studio.git
Set-Location ximply-design-studio
./scripts/local.ps1 start
```

Open **http://localhost:8090**. The launcher creates an ignored `.env.local` with a
random API token; it never prints the token. If your Python executable is named
`python` on macOS/Linux, use `python scripts/local.py start` instead.

Drawing, native save/open and PNG/SVG export work immediately without an API login.
For server storage, open `.env.local` locally, copy XDS_API_TOKEN, then use **File >
Server** and paste it into the token field. Click Connect, then Save to server.
The token stays only in page memory. Browser reload requires entering it again.
Never commit or share `.env.local`. The service supports one local user, not tenant
isolation. Keycloak and PostgreSQL integration remain later slices.

## First trial

1. Choose Rectangle, drag on the artboard, then Select and move/resize it.
2. Draw an ellipse or a freehand path. Edit fill, stroke and transforms in Properties.
3. Use the Layers panel to reorder, hide, lock, duplicate or delete objects.
4. Import a PNG/JPEG/WebP. Adjust brightness/contrast/saturation/blur in Properties.
5. Select Brush to paint; select an image/paint layer and Eraser to remove pixels.
6. Undo and redo. Save a .ximply project, reload the page and reopen that file.
7. Export PNG or SVG. SVG preserves supported vectors and embeds raster layers;
   downstream SVG applications may differ in filter/blend rendering.
8. Open About from the footer and change the version selector.

Use Pen to place anchors; drag an anchor while placing it to create cubic handles.
Use the Selection family flyout for rectangular, circular or lasso area selection.
Drag empty canvas with Select to reuse the last area mode. Circular selection starts
at its center and grows to the pointer. Hold Shift to toggle reached objects;
Escape cancels the gesture. Explicit area tools can begin over existing artwork.
Use Direct selection to adjust existing anchors and controls. Finish an open path
with Enter. Use the Text tool over existing text to edit it inline. Transform edge
handles change one dimension; the rotation handle turns the selected object. Hold
Shift for the angle configured in Settings (default 45 degrees).

Defaults: V Select, A Direct selection, P Pen, N Pencil, M Rectangle, L Ellipse,
T Text, B Brush, Shift+E Eraser, R Rotate, O Reflect, S Scale, Z Zoom, H Pan; Ctrl/Cmd+Z Undo,
Ctrl/Cmd+Shift+Z Redo, Ctrl/Cmd+Alt+D Duplicate, Ctrl/Cmd+G Group,
Ctrl/Cmd+Shift+G Ungroup and Ctrl/Cmd+S Save.
Use a tool family's triangular flyout to choose its sibling tools. Click elsewhere
or press Escape to close the flyout. Reflect preserves editable mirror flags;
nonuniform group resizing does not add arbitrary shear.
Open Settings with Ctrl/Cmd+K to change shortcuts, the constraint angle and the
cursor badge. Duplicate normalized key chords cannot be saved. Current assignments
appear in tooltips and menus. Hold Ctrl+Space and scroll over the canvas to zoom the
artwork without scaling the interface.

New saves use native format 2. Format 1 files import, but earlier applications cannot
read new saves. Preserve original files before migrating. Tracing is a 64-pixel-side
scanline preview; vector erasure approximates curved boundaries. Symbol nine-slice
resizing uses fixed insets; see the [roadmap](doc/planning/drawing-roadmap.md) for
remaining fidelity work.

Small drafts auto-restore; save large or important work explicitly to a project file.

## Try an editable object blend

Draw two vector objects and give them different positions, colors or outlines.
Select both, open the **Blend objects** panel, choose the intermediate step count
and easing, then click **Make blend**. Stacking order determines back and front.
Use the endpoint controls to edit originals and recompute the intermediate objects.
Two selected vector groups must have matching object counts and compatible contours.

**Expand blend** keeps every step as ordinary editable objects; ungroup and regroup
these objects as needed. **Release blend** removes the intermediate objects and
retains the endpoints. Save native format to preserve the editable relationship;
SVG and PNG preserve the rendered result. The step limit also respects the existing
150-layer document capacity. Text, raster images and editable blend spines are not
part of this preview.

## Stop, logs and cleanup

```bash
./scripts/local.sh status
./scripts/local.sh logs
./scripts/local.sh stop
```

PowerShell uses the same arguments with `./scripts/local.ps1`.
Stop preserves the project volume. NUKE deletes only the preview project's containers,
volume and locally built images; export projects first:

```bash
./scripts/local.sh nuke --confirm ximply-design-studio-preview
```

The token file is retained. No global Docker prune is performed.
If upgrading from the previous 8080 default, set `XDS_PORT=8090` in `.env.local`,
then stop and start again. Existing credentials and project volumes are preserved.

To change port, set XDS_PORT in `.env.local`, stop, then start again.

## Development without Docker

Use Node 24.19.0 (Angular supports the compatible Node ranges recorded by its package
metadata), npm, and Python 3.12. Frontend-only drawing can be tested with:

```bash
npm ci --ignore-scripts
npm start
```

Open http://localhost:4200. For optional server storage, create a virtual environment,
install `services/api/requirements.txt`, set a random XDS_API_TOKEN of at least 32
characters in your local environment, then run from the repository root:

```bash
python -m uvicorn services.api.src.main:app --host 127.0.0.1 --port 8000
```

Angular proxies `/api` to port 8000, keeping same-origin browser requests. Do not add
permissive CORS. Production build: `npm run build`; output is `dist/studio/browser`.
The Docker nginx config serves SPA routes, including `/about?version=...`.

## Validation status

Earlier preview builds passed automated and Docker smoke checks; those results do
not establish this iteration's status. Current evidence belongs to the
[drawing implementation plan](doc/implementation/PLAN-0008-0001.md). Visual browser
acceptance, SonarQube and independent review remain pre-merge requirements.

See [trhouble-shooting.md](trhouble-shooting.md) for diagnosis and the
[drawing roadmap](doc/planning/drawing-roadmap.md) for bounded and pending features.

## Identify a feedback preview

Before starting, run `./scripts/local.ps1 info` on Windows or
`./scripts/local.sh info` on Linux/macOS. This read-only action prints the checkout
version, branch and commit without Docker. It identifies source files, not a running
container. After pulling, restart with `stop` and `start` to rebuild the container;
confirm version **0.5.0** in the application footer or About.
The drawing features are on `feat/drawing-preview` until integration gates pass.
