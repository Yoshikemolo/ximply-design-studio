# Workspaces, windows and design system

## Serializable layout tree

`WorkspaceLayout` contains schemaVersion, presetId, dockRoot, floatingWindows and
personal preferences. `SplitNode` contains direction, children, relative weights
and minima. `TabGroup` contains ordered panel instances and activePanelId. `ViewLeaf`
contains document/view identity and camera settings. Stable IDs make migration,
undo and cross-window transfer independent of Angular component instance identity.

Layout invariants: no cycles; every visible panel instance has exactly one owner;
active tab exists; split weights are positive and normalized; minimum sizes are
respected when space permits; at least one recoverable viewport remains. Unmet
minima activate overflow/compact mode instead of negative dimensions. Coordinate
conversion accounts for DPR, browser zoom, monitor origin and viewport bounds.

Docking is a reducer of commands (`MovePanel`, `GroupPanels`, `SplitGroup`, `HidePanel`,
`FloatGroup`, `TransferPanel`, `RestoreWorkspace`). State transitions are unit/property
tested without a browser. Angular CDK can supply drag primitives and accessibility;
it is not itself a complete desktop docking manager. Evaluate Golden Layout as a
candidate behind `DockingAdapter`; do not bind persisted documents to its private
serialization. A spike must cover tabs, group drag, popouts, Angular lifecycle,
keyboard operation and memory leaks before selecting it over a custom tree renderer.

## Multiwindow protocol

Each same-origin host has a windowId and connection/session identifier. BroadcastChannel
carries control envelopes, not credentials or large buffers. Every window authenticates
independently; no token broadcast or localStorage tokens. SharedWorker can coordinate
where supported; fallback is per-window connection plus deduplication. IndexedDB
stores recoverable local drafts; permissions and storage quotas can fail.

Transfer handshake: source offers transferId + panel snapshot + target windowId;
target validates, loads plugin and returns ready; ownership coordinator commits new
owner epoch; target acknowledges; source releases. If timeout occurs before commit,
source retains. After commit, recovery consults owner epoch; fencing prevents both
hosts mutating panel-local state. A tab crash cannot delete document data. Cross-window
native drag is an enhancement; explicit Move to window is the portable baseline.

Electron main process owns window placement and native file handles. Renderers have
sandbox and contextIsolation enabled, nodeIntegration disabled, and a narrow typed
preload bridge. Sender frame, origin, path and operation are validated in main IPC.
Never expose ipcRenderer or filesystem APIs wholesale. Use system-browser PKCE login
and OS-protected credential storage where needed; never embed an IAM client secret.
Native menus route into the command registry. Keep desktop and browser file access
behind the same `FileAccessPort` with capability checks.

## Central styles and assets

All authored SCSS belongs to `packages/design-system/styles`: tokens, semantic themes,
base typography/reset, layout primitives, component styles and accessibility. Angular
components use class names rather than scattered color literals or private SCSS copies.
Runtime themes set semantic CSS custom properties. Token categories: surface, text,
border, accent, selection, danger, focus, elevation, spacing, radius, type and density.
Theme contrast tests cover both light and dark; theme plugins may not remove focus
indicators. Canvas palettes read the same semantic color tokens via a typed adapter.

Icons reside at `apps/web/public/assets/icons/*.svg`, served under `/assets/icons`.
Use external image references or CSS masks with validated static URLs. No inline SVG
markup, `innerHTML`, remote scripts or arbitrary plugin URL substitution. Icon manifest
maps semantic name -> file, viewBox metadata, title key and licence/provenance.
Icons remain legible at 16/20/24 CSS px and 200% zoom. Localization owns accessible
names; decorative icons have empty alt and adjacent text.

## i18n contract

EN/ES catalogs use identical keys and native wording. Store enum IDs, numbers and dates
canonically; format them with Intl at the edge. ICU-style plurals, units, shortcut
labels, validation errors, ARIA text and plugin strings are covered. Plan RTL layout
with logical CSS properties and bidi text testing. Fonts must support accented text.
A runtime catalog adapter permits plugin translations without rebuilding the host;
select the concrete Angular-compatible i18n library in the version spike. Missing
plugin locale falls back to EN with a diagnostic. Automated parity checks reject
missing keys; human review verifies semantic parity. Do not translate code symbols,
file extensions, command IDs or shader property identifiers.
