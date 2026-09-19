---
id: "DOC-ARCHITECTURE-0001"
title: "Document model, rendering and performance"
status: "proposed"
domain: "architecture"
owners: ["Yoshikemolo"]
applies_to: ["ximply-design-studio"]
related: []
source: ["Project owner requirements and design foundation; methodology application recorded in AUDIT-0001"]
---

# Document model, rendering and performance

## Canonical document

`Project -> Document -> Revision -> Artboards + Nodes + Resources + Timeline`.
Node IDs are stable UUIDs. `parentId` and stable order keys define an acyclic tree;
references (masks, textures, booleans, links) form a separately validated dependency
DAG. Node types are a discriminated union. Source geometry and source pixels are
immutable resources; edits create new references or editable modifier parameters.
A plugin-owned node records plugin ID, schema version and opaque validated data;
missing plugins preserve data and show a placeholder. Readers never drop unknown
nodes on save. Native archive schema version is independent of application version.

Vector coordinates use double-precision canonical document units (96 px/in conversion
for screen units). World coordinates use meters by default; document-to-world scale
is explicit. 2D affine matrices, pivot and 3D TRS are distinct fields. Singular,
non-finite or out-of-bounds transforms are rejected. Path winding, closure, fill rule,
stroke alignment, joins, caps and dashes are data, not inferred from GPU meshes.
Mesh topology stores indexed geometry, attributes and material slots; caches never
become the only source. Text records font hash/face, glyph shaping settings and
language/direction. Font embedding honours the font's licence.

## Non-destructive evaluation

Sources feed typed operators in an evaluation DAG. A layer's declared stages are:
source decoding/geometry, source-space operations and masks, local transform,
world-space operations, compositing and output/display conversion. Each operator
states input/output type, coordinate space, affected bounds, required tile halo,
time dependence, determinism, kernel version and supported backends. Users can
reorder compatible operators; incompatible moves explain why. Effects that sample
neighbours invalidate expanded bounds. A displacement or blur cannot be cached
only by the original object rectangle. Cycles, incompatible spaces and resource
limits fail before publication of a revised graph.

Cache key = source hashes + canonical operator parameters + kernel/plugin version +
color profile + scale/LOD + time + precision. Device-specific caches are tagged with
backend identity. Editing a parameter invalidates dependent nodes, not every layer.
A stale asynchronous result is discarded when its input revision no longer matches.

## Two render paths

**2D compositor:** tile/region evaluation preserving layer order, masks, clipping,
blend rules, isolated groups and adjustment scopes. It renders into offscreen
surfaces. Vector tessellation is view-dependent; source Bézier paths remain intact.
Transparency is premultiplied internally; conversions occur at explicit boundaries.
Define each blend mode over a chosen working color space with CPU reference samples.
`normal` source-over obeys alpha_out = alpha_src + alpha_dst * (1-alpha_src).
Mask coverage multiplies source alpha before source-over. sRGB decode/encode is
performed once at the chosen pipeline boundaries; prevent double gamma conversion.

**3D renderer:** Three.js scene, cameras, geometry and materials. A layer plane uses
the compositor output, source geometry or a projected mesh representation. 2D order
is not emulated by arbitrary z offsets and transparent-material sorting. Spatial
transparency has its own limitations and quality settings. Explicit depth ordering,
alpha test and alpha blend modes are tested. 2D overlay, guides, bounding handles
and remote cursors do not enter export results.

WebGL2 is the first compatibility path. WebGPU is an optional strategy after parity
spikes. Three.js WebGPURenderer and traditional WebGL EffectComposer/OutlinePass
are not assumed interchangeable. Implement `SelectionOutlineRenderer` independently
for each supported backend: WebGL OutlinePass where verified, WebGPU node/render
pipeline with object-ID, depth and normal buffers. A silhouette edge detector
renders thickness in CSS pixels and handles DPR, occlusion and transparent selection.
Use stencil/object IDs for selected subsets; test nested objects and shared materials.

## Tiled raster and brush engine

Default candidate tile size 256 or 512 px; choose through benchmarks, not belief.
Sparse tiles, dirty rectangles, mip pyramids, LRU caches and copy-on-write patches
bound cost. A 512x512 RGBA16F tile is 2 MiB before mips; a full 8192x8192 RGBA16F
surface is 512 MiB. A hundred such layers cannot be eagerly allocated. Keep only
visible/dirty working tiles on GPU; persist compressed lossless sources and patches.
Brush input samples coalesced pointer events into a ring buffer; render prediction
locally, commit finalized strokes with deterministic seeds and timestamps. Network
latency cannot be on the brush-to-screen path. Tile halos avoid seams across blur,
feather and convolution boundaries. Canvas resize is a metadata operation until
raster evaluation requires new bounds. Avoid GPU readbacks during normal pointer motion.

## Geometry and hit testing

Spatial indices (2D bounds tree and mesh BVH), broad phase then exact tests, cached
flattened paths at a screen-error tolerance and bounded picking buffers. Object,
path/anchor, face/edge/vertex and pixel selections are distinct typed models.
Dragging renders a preview transform; release commits one undoable operation.
Boolean kernels must specify tolerance, handling of coplanar faces and manifold
requirements. `three-bvh-csg` is a candidate for fast preview, not a guarantee of
watertight CAD output. Evaluate Manifold as a validated robust-kernel alternative;
retain source operands whichever engine is selected. CPU fixtures define expected
volumes/topology within tolerances. Never assert all inputs can be repaired.

## Linked projects

A link identifies project/document/revision/artboard plus render settings. Default
is a pinned immutable revision; auto-update is opt-in and yields a new host revision.
Updates are debounced, dependency-aware and cancellable. Direct and transitive cycles
are rejected, including cross-project cycles. Export pins the entire dependency
closure. Cache reads enforce source permissions; possession of a content hash is
not authorization. Revocation removes unentitled previews; a deliberate embedded
copy has explicit disclosure and retention semantics. Missing sources retain a
permitted last-good preview and a relink warning, never leak revoked content.

## Measurable performance targets (not measured achievements)

| Fixture / hardware class | Initial target | Measurement |
| --- | --- | --- |
| 100 vector layers / 10k paths, laptop 16 GB | interaction p95 ≤16.7 ms frame CPU budget | 30s scripted pan/transform, 5 warm runs |
| 4K document / 20 raster layers, 512 MiB working GPU budget | brush visual latency p95 <30 ms | timestamp input to first rendered feedback |
| 1000 layer nodes | panel toggle p95 <100 ms | virtualized tree, 50 repetitions |
| 20 participants, 100 ms injected RTT | edit convergence p95 <500 ms | ack-to-client revision probes |
| Four views / two windows | active view ≥30 fps | background views adaptive rate |
| Large source image exceeding texture limits | open without monolithic texture allocation | tile counters / device-limit assertions |

Record CPU/GPU model, RAM/VRAM, OS, browser, DPR, driver, viewport, thermal state,
asset hash and build SHA. Use rAF demand rendering, event coalescing, immutable
normalized state, virtualized panels and worker threads. OffscreenCanvas is a
capability-gated optimization; SharedArrayBuffer requires cross-origin isolation
and cannot be a baseline assumption. Throttle hidden views, cap DPR, dispose textures,
geometries and render targets. Device loss recreates caches from canonical data;
unsaved work remains recoverable. Performance gate uses dedicated stable hardware,
not noisy generic CI as a hard latency oracle.
