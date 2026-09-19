# Troubleshooting

## Local preview does not start

Start Docker Desktop and verify `docker compose version`. The launcher deliberately
rejects remote Docker contexts. Select your local Docker Desktop/default socket
context. Run `python3 scripts/local.py logs` (or `python` on Windows) and inspect
which service failed. Ports bind to 127.0.0.1 only.

If port 8080 is in use, change XDS_PORT in `.env.local`, stop and start again.
First build requires network access to the official npm, Python and container
registries. Do not resolve installation failures using unverified package mirrors or
`--force` peer dependency overrides. Node 24.19.0 is the tested local runtime.

## PowerShell or shell launcher fails

Use `python scripts/local.py start` directly if script execution policy blocks the
PowerShell wrapper. Use `python3 scripts/local.py start` on macOS/Linux if executable
bits were lost when extracting a ZIP. No system execution-policy change is required.

## API returns 401 or 503

401 means the token entered in File > Server is missing or does not match XDS_API_TOKEN
in `.env.local`. 503 means the server token is absent or shorter than 32 characters.
After changing the environment file, stop and start the containers. Do not place the
token in frontend files, URLs, screenshots or source control. The browser forgets it
on reload. Drawing and project-file export do not depend on server authentication.

## Project or image rejected

The preview accepts version-1 .ximply native files, up to 35 MB, 150 layers and a
4096-by-4096 artboard. Image imports accept PNG/JPEG/WebP up to 20 MB, downsampled to a
2048-pixel maximum side. PSD, Illustrator native files, arbitrary SVG import and
remote image URLs are not supported. A future migration must be explicit.

## Brush, eraser or selection behaves unexpectedly

Unlock the layer first. Eraser requires an image or paint layer; vector objects remain
editable through selection and properties. Brush paints the selected image layer or
creates a new paint layer when a vector is selected. Hidden layers are not selected
by canvas hit testing. Select a visible layer in the Layers panel to inspect it.

## Draft was not restored

Browser storage is a convenience, not project backup. Large drafts are not persisted
there; save a .ximply file. Private browsing or storage limits may disable draft saving.
Undo history is session-local. Stop preserves server files; NUKE removes the preview
volume and cannot recover projects that were not exported.

## Spatial preview or export differs

Spatial inspection requires WebGL and is not a modeling or CSG implementation. SVG
filters and blending vary between applications; use PNG for flattened pixel output
and .ximply for this editor's editable data. Color-managed print and PSD/AI fidelity
are not part of the alpha. If a graphic operation fails, the status line reports it.

## Quality and integration

A green build or test job does not imply the strict Sonar gate passed. Pending Sonar,
protection verification and human review are recorded in the PRs and methodology
audit. Do not bypass them to merge a local preview. Broader infrastructure templates
remain separate from the runnable `compose.local.yaml` preview.
