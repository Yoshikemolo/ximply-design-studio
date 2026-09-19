# Quick install — local editor preview

Version: see [release notes](CHANGELOG.md). This distribution is a single-user local
alpha. It does not require a paid service or expose a public server.

## Docker Desktop route

Requirements: Git, Docker Engine/Desktop with Docker Compose v2, and Python 3.11+.
Allow roughly 4 GB available memory for the initial build. Docker must use a local
socket context. Windows users should enable Docker Desktop's Linux containers.

```bash
git clone --branch feat/first-editor https://github.com/Yoshikemolo/ximply-design-studio.git
cd ximply-design-studio
./scripts/local.sh start
```

PowerShell:

```powershell
git clone --branch feat/first-editor https://github.com/Yoshikemolo/ximply-design-studio.git
Set-Location ximply-design-studio
./scripts/local.ps1 start
```

Open **http://localhost:8080**. The launcher creates an ignored `.env.local` with a
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

Shortcuts: V select, R rectangle, O ellipse, P pencil, T text, B brush, E eraser,
H pan, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo, Ctrl/Cmd+D duplicate, Ctrl/Cmd+S save.
Small drafts auto-restore; save large or important work explicitly to a project file.

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

The Angular build and automated domain/renderer/editor/API tests pass. GitHub Actions
has built and started the Docker preview and passed the packaged HTTP smoke test.
The remote browser cannot reach the development host, so visual browser acceptance
is not claimed. SonarQube and independent human review remain pre-merge gates.
This preview can be downloaded from its feature branch for local evaluation.

See [trhouble-shooting.md](trhouble-shooting.md) for diagnosis and
[the implementation plan](doc/implementation/PLAN-0002-0001.md) for boundaries.
