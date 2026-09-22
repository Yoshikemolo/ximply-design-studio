# Troubleshooting

## Local preview does not start

Start Docker Desktop and verify `docker compose version`. The launcher deliberately
rejects remote Docker contexts. Select your local Docker Desktop/default socket
context. Run `python3 scripts/local.py logs` (or `python` on Windows) and inspect
which service failed. Ports bind to 127.0.0.1 only.

If port 8090 is in use, change XDS_PORT in `.env.local`, stop and start again.
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

## Project, image or drawing rejected

The preview opens native projects saved as `.xds`, and older `.ximply` files, in
formats 1 and 2, up to 35 MB, 1000 layers (150 when the document keeps editable
blends) and a page from 16 to 8192 pixels per side.
A project saved by a newer version can be refused by an older editor or API when it
uses a field that version does not know, such as an envelope, a gradient mesh or the
marker of a paint layer; the
release notes name each such change with its migration. Image imports accept
PNG/JPEG/WebP up to 20 MB, downsampled to a 2048-pixel maximum side. Drawings in SVG,
ASCII DXF, PDF, EPS and PDF-compatible Illustrator files up to 20 MB are imported as
editable paths, and whatever the reader cannot represent is reported in the status
line rather than approximated. PSD, native Illustrator fidelity and remote image URLs
are not supported.

## Brush, eraser or selection behaves unexpectedly

Unlock the layer first. B is the vector Paintbrush, as in Illustrator; the raster brush
has no default key and can be given one in Settings > Keyboard shortcuts. The raster
brush paints the selected image layer, or creates a paint layer when nothing or a
vector is selected; a paint layer keeps only the area that was painted, including
pixels outside the page. The Eraser (Shift+E) removes pixels when one image or paint
layer is selected and erases vector artwork otherwise. Hidden layers are not selected
by canvas hit testing. Select a visible layer in the Layers panel to inspect it.

## Tools, panels or bars are missing

View > Layout shows and hides the tools, the panels, the context bar, the document tabs
and the Swatches panel. On a wide screen a hidden tools or panels column leaves a
handle at its edge of the canvas; the handle opens it as a drawer over the canvas, which
stays open while you work, and the same handle, then on the drawer's edge, closes it. On a
phone both columns are always drawers, and a tap outside or a chosen tool closes them.

## The canvas looks blurred or pixelated

While the view pans or zooms, a magnified page is drawn at one pixel per page unit and
enlarged; it is redrawn sharp at the screen's resolution once the view is still. A page
that stays blocky while still is usually in Pixel Preview: turn it off in View > Pixel
Preview or with Alt+Ctrl+Y. Ctrl+Y switches between the preview and the outline view.

## Draft was not restored

Browser storage is a convenience, not project backup. Each tab is recovered from
browser storage, up to 12 tabs of 4 MB each; larger drafts are not kept there, so save
a `.xds` file. Private browsing or storage limits may disable draft saving. File > Save
As (Shift+Ctrl+S) writes to a file you choose where the browser allows a page to do so,
and downloads the project elsewhere. Undo history is session-local. Stop preserves
server files; NUKE removes the preview volume and cannot recover projects that were not
exported.

## Spatial preview or export differs

Spatial inspection requires WebGL and is not a modeling or CSG implementation. SVG
filters and blending vary between applications; use PNG for flattened pixel output
and `.xds` for this editor's editable data. PDF export keeps vector geometry, and some
content, such as transparent gradient stops, is reported as not carried. CMYK colours
use the device formula without colour management, so they are not print separations,
and PSD/AI fidelity is not part of the preview. If a graphic operation fails, the
status line reports it.

## Quality and integration

A green build or test job does not imply the strict Sonar gate passed; that check is
paused at the owner's request, and a skipped result is not quality evidence. Pending
Sonar, protection verification and human review are recorded in the PRs and methodology
audit. Do not bypass them to merge a local preview. Broader infrastructure templates
remain separate from the runnable `compose.local.yaml` preview.
