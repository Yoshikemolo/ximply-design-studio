# Functional specification

Status: Proposed target. Every capability below is planned unless evidence explicitly states otherwise.

## 1. Product scope and actors

An editor can author vector artwork, paint and retouch images, compose mixed media,
model simple 3D assets, animate properties, collaborate, and export deliverables.
A viewer can inspect permitted documents without mutation. A project owner manages
membership and assets. A workspace administrator controls plugin policy. An AI
assistant acts as a delegated user with tool-specific grants; it is never an owner.
Desktop and web share file semantics. Public source code does not imply public
user documents. Users own projects and may collaborate across explicit memberships.

## 2. Shell and command surfaces

A top application bar contains brand, active project/document, save state, workspace
switcher, participant avatars, command search and account menu. The main menu is
keyboard accessible. A compact tool rail, contextual tool options, rulers, central
views, side docks and a status strip surround the artboard. Unavailable commands
show a localized reason; no active-looking control silently does nothing.

| Menu | Required groups and command examples |
| --- | --- |
| File | New/open/recent; tabs; save/checkpoint/save as; import/place/link; export; document setup; print; close |
| Edit | Undo/redo/history; cut/copy/paste in place; duplicate; find; preferences; shortcuts |
| Object | Group/ungroup/isolate; arrange; align/distribute; transform; compound paths; expand/bake; boolean operations |
| Type | Font/style/size; paragraph; glyphs; text on path; text area; outline conversion with duplicate option |
| Select | All/none/invert; same fill/stroke/type; object/path/face mode; pixel selection; feather; grow/shrink; save/load selection |
| Effect | Transform stack; vector effects; raster filters; adjustment layers; 3D materials; plugin effects |
| View | Zoom/fit/actual size; pan/rotate; orthographic/perspective; grids/guides/rulers; split views; selection outlines; proof preview |
| Window | Show/hide every registered panel; dock/float; workspace presets; save/reset layout; detach/restore; document windows |
| Plugins | Installed plugin list; each plugin's commands and panels; install/enable/disable/update; permissions and diagnostics |
| Help | Search commands; tutorials; accessibility; shortcuts; about/version; capability diagnostics; report issue |

The command registry is the common source for menus, command palette, shortcuts,
context menus and MCP tools. Contributions identify a stable command ID, menu slot,
order, localization key, permission and enablement selector. Plugins cannot replace
host authentication, overwrite another plugin's ID or hide mandatory system controls.
Conflicting shortcuts produce a resolver; focus in a text field suppresses canvas shortcuts.

## 3. Docking and responsive workspace

Panel state includes panel type, instance ID, plugin ID, title key, minimum size,
restore data and visibility. A workspace is a tree of horizontal/vertical splits,
tab groups and view leaves, plus floating windows. Dropping at a group's center
adds a tab; dropping at its edge creates a split; dropping outside docks floats it.
The preview indicates the exact destination before release. Escape cancels the drag.
Dragging a tab moves only that tab; dragging a group header moves the entire group.
An empty group disappears, adjacent redundant splits collapse, and focus moves to
the nearest surviving panel. Panels support collapse to title strip or icon rail,
resize, reorder, tab overflow, pinning, hide/show and reset. Undo layout changes uses
its own history, separate from document undo.

Preset layouts: Artistic Drawing (brush/color/layers), Vector Drawing (path/align/
appearance), Design (assets/type/artboards), Photo Retouching (histogram/adjustments/
masks/history), Animation (timeline/curves/preview), 3D (scene/materials/camera).
Each preset defines tools and panels, not document content. Save-as, rename, duplicate,
export/import and delete personal layouts; built-ins can be reset but not destroyed.
Unknown plugin panels become recoverable placeholders. Schema migrations preserve
old layouts; invalid configurations open the safe default with a recoverable backup.

Desktop ≥1280 CSS px uses multiple columns; 768–1279 uses one primary dock and
optional overlays; below 768 uses a bottom sheet and a single active view. These
are starting design breakpoints, tested against actual content. Floating geometry
is clamped to available displays. Touch targets are at least 44 CSS px; keyboard
users can invoke Move panel and choose a destination without dragging. Splitter,
tab and focus semantics support screen readers. Reduced motion avoids animated
camera/docking transitions. Zoom and a device scale of 200% do not hide core controls.

## 4. Document and layer editing

Documents contain artboards, a typed object graph, assets, resources, timeline and
metadata. Layers include vector, raster, text, group, adjustment, mask, linked-project,
mesh, camera and light. Layers can be nested, renamed, tagged, searched, reordered,
selected, hidden, soloed, locked and duplicated. Separate locks protect content,
transform and alpha. Local isolation is not a collaborative permission mechanism.

Every drawable retains local transform, pivot, blend mode, opacity and an ordered
modifier stack. Users can toggle, reorder, duplicate or remove modifiers and edit
their parameters. Baking creates a new source and a checkpoint; it is explicit.
Vector paths preserve anchors, cubic/quadratic curves, winding and stroke settings.
Text retains editable Unicode text, shaping inputs, font references and paragraph
layout. Missing fonts trigger substitution warnings and relinking, not silent outlining.

Grouping preserves world transforms. Reparenting into a singular transform is
rejected. Copy/paste between documents remaps IDs and dependencies atomically.
Undo operates on authored commands, not camera motion. Save state distinguishes
local draft, queued, server acknowledged, checkpointed and failed.

## 5. Raster, selections, blending and color

Brushes support size, hardness, opacity, flow, spacing, pressure, tilt, texture,
scatter, stabilization, erasing and presets. A stroke samples pointer data locally,
produces tiled preview and commits an immutable stroke/patch with engine version,
seed and input revision. Pointer cancel cannot leave a partial committed stroke.
Painting and selection editing share brush geometry and dynamics with different targets.

Selections include rectangle, ellipse, lasso, polygon, path-derived, color range,
contiguous magic wand and brush/quick mask. A selection is a grayscale field, not
just a polygon. Add, subtract, intersect and replace are explicit modes. Feather,
grow, shrink, invert, smooth and edge refinement are reversible modifiers. Selection
can be saved as a named alpha channel, attached as a layer mask or used as an effect
mask. Selection state is private unless explicitly stored/shared in the document.
Masks can be linked/unlinked from layer transforms, disabled and visualized as overlays.

Specify normal, multiply, screen, overlay, darken, lighten, difference, exclusion,
color dodge/burn, hard/soft light and hue/saturation/color/luminosity incrementally.
Every advertised mode must have a pixel oracle. Group isolation and pass-through
semantics are distinct. Clipping masks and adjustment scope are explicit. Internal
compositing uses defined alpha/color conventions; artistic compatibility can require
an encoded-color mode and is tested separately from physically linear operations.

Phase one supports sRGB assets and explicit profile metadata. Professional print
adds ICC transforms, CMYK/spot inks, overprint preview, separations, bleed and PDF
preflight through dedicated processors. A display preview is not proof of press
color fidelity. No CMYK/PSD/AI round-trip fidelity claim without tested format support.

## 6. Views and 3D

A document can have multiple 2D/3D views with independent camera, zoom, display mode,
artboard and selection visualization. Split horizontally/vertically or four ways;
maximize a view and restore. Include orientation cube, axis gizmo, orbit, pan,
dolly, fit selection, named views, orthographic/perspective switching and numeric
camera input. Right-handed scene units and document-to-world mapping are recorded.
2D pointer hit tests resolve document coordinates, not guessed CSS pixel offsets.

Spatial mode exposes layers as planes with optional separation for inspection.
Users may project and transform them independently. Extrude/bevel/revolve vector
profiles, create primitives, transform vertices/edges/faces, and apply union,
difference and intersection via geometry plugins. Preserve source operands for
editable boolean modifiers. Invalid/open/non-manifold inputs show diagnostics;
a failed boolean cannot replace valid geometry. Selection uses a visible silhouette
and optional occluded edges, with distinct hover/selected colors; wireframe is optional.

Materials support base color, normal, roughness, metalness, opacity, emission and
UV transforms; light/environment presets and postprocessing are scoped to the view
or exported scene. Shader graphs are portable typed nodes with resource limits.
Raw shader authoring is a privileged developer feature with validation and timeout.
A linked project can appear as an editable placed object or a baked/versioned
texture in a material. Resolution, artboard, color profile and version are explicit.

## 7. Assets and file interchange

A project gallery accepts supported images, vectors, models and native documents;
shows previews, provenance, hashes, usage and missing links; supports folders/tags,
search, replacement, deduplication and orphan inspection. Importers validate before
publishing assets. Browser uploads are cancellable/resumable. Images cannot execute
scripts, fonts cannot load arbitrary URLs, and archive paths cannot escape extraction.

The native `.xds` archive preserves layers, paths, modifiers, masks, animation,
resources and references. Initial interchange: PNG/JPEG/WebP raster, tested SVG
subset, glTF/GLB scene subset and image export. Follow-on: SVG/PDF vector export,
layer-aware interchange and professional print. Unsupported constructs yield a
per-object report and selectable flatten/skip/cancel, never silent success. Photoshop
and Illustrator compatibility is an importer roadmap, not a claim of full PSD/AI
support. Rasterizing a vector for display never replaces its source paths.

## 8. Collaboration and multiwindow

Membership roles are owner/editor/viewer. Avatars at top show accessible identity,
color, connection state and a popover. Cursors show small circular initials, tool,
view and document coordinates; remote pointers never intercept local clicks.
Clicking an avatar follows that user's active document/view and camera only when
access is permitted. Local camera input, Escape or Stop following cancels follow.
A user moving to a private project does not reveal that project's title or assets.

Shared edits are committed by the authority; optimistic previews are reconciled.
Selections, tool choice, panels, themes and language remain personal by default.
Opt-in presentation sessions share camera; opt-in layout sharing imports a copy.
Presence expires and is rebuilt on reconnect. Concurrent edits use revision checks,
not timestamp guesses; conflicts preserve the rejected local command for retry/fork.
User undo does not erase another user's accepted work.

The SPA can detach panels/views into new same-origin windows, and open independent
tabs. A transfer moves serialized panel state, not DOM nodes or GPU handles. The
source remains until the target acknowledges ownership. A closed/crashed window
returns its panels to the surviving host. Popup restrictions offer Open companion
window as an explicit action. Browser differences cannot promise arbitrary OS-window
placement. Electron supplies native window placement and a restricted IPC bridge.

## 9. AI, settings, localization and animation

An AI panel offers proposal, preview, apply, cancel, audit trail and per-tool grants:
deny/ask/allow, scoped to user/project/plugin/tool and expiry. Providers are explicit;
no cloud fallback for a local-only project. MCP reads sanitized state and proposes
commands through the same authorization path as the UI. Long jobs report progress
and cancellation; results remain separate candidate layers until approved/applied.
Content inside documents, plugins and model outputs cannot grant permissions.

Preferences include theme, language, density, units, color, performance/GPU/cache,
shortcuts, autosave, collaboration/privacy, AI providers/permissions, plugin lifecycle,
workspace presets and accessibility. EN and ES ship from the first shell iteration.
All menus, errors, tooltips, ARIA labels and plugin UI strings use localization keys.
Documents store canonical numeric values; parsing/formatting is locale-aware.
SCSS and design tokens are centralized. Dark/light themes and future theme plugins
use semantic variables. Icons are external SVG files in `/assets/icons` without
inline SVG markup or remote scriptable assets.

Animation supports timeline tracks for transforms, opacity, effect parameters,
material properties and camera; keyframes, easing, interpolation, loop and frame
range. Evaluation at time t does not mutate source state. Export jobs pin document,
plugin versions, seeds and frame rate; resume by frame hash. Raster brushes on a
video timeline and audio editing are separate later capabilities.

## 10. Commercial licences and Ximplicity UX

See [commercial model](commercial-model.md), [UX direction](ux-direction.md) and
[licence security](../security/licensing.md). Community/Free is the initial edition;
signed bundle/plugin grants enforce time and named-user limits through the same
server-side permission intersection used by tools and MCP.
