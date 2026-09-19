---
id: "ROADMAP-0001"
title: "Drawing tools delivery roadmap"
status: "implementing"
domain: "planning"
owners: ["Yoshikemolo"]
applies_to: ["ximply-design-studio"]
related: ["FEAT-0008", "FEAT-0007", "FEAT-0002", "FEAT-0006", "FEAT-0016", "PLAN-0008-0001"]
source: ["Owner drawing-workbench and interaction requirements"]
---

# Drawing tools delivery roadmap

This ordered roadmap separates working preview behavior from unfinished fidelity.
It is not a calendar commitment or a declaration that the complete drawing scope is
finished. Every iteration requires native persistence, undo semantics, export behavior,
meaningful tests and the unchanged quality gate.

| Iteration | Preview implementation | Next acceptance boundary |
| --- | --- | --- |
| Editable drawing | Cubic Pen; direct selection; add, delete and convert anchors; line, rectangle, rounded rectangle, ellipse, polygon, star, arc, spiral, rectangular grid, polar grid and flare | Verify construction parameters and cubic topology through native/API/SVG round trips; broader geometric degeneracy and interaction coverage |
| Path refinement | Pencil; smooth, simplify, average, join/close, scissors, path eraser, filled-vector eraser and stray-point cleanup | Validate endpoint selection and topology semantics; improve freehand continuation/reshaping and curve-preserving boolean precision |
| Transform and input | Rotate/Reflect/Scale tool families with triangular flyouts; corner and edge scaling, rotation handle, numeric group transforms, configurable Shift angle, editable shortcuts, inline text, tool cursor badge and canvas-local zoom | Browser acceptance across keyboard layouts, pointer devices, responsive layouts and accessibility modes |
| Arrange and combine | Multiple selection, nested group/ungroup, six alignment directions, horizontal/vertical distribution and union/subtract/intersect/exclude | Groups retain nested membership through native round trips; vector-only boolean results match independent polygon area/topology oracles |
| Raster tracing | Monochrome, grayscale and color scanline tracing; update, expand, release; retained source and template image | Contour fitting, larger images, named presets, richer preview and quantified fidelity/performance budgets |
| Reusable artwork | Local symbol definitions/instances; redefine, replace, expand and library import/export | Editable registration and nine-slice guides; grouped artwork and complete graphic-style semantics |
| Symbol painting | Spray, shift, scrunch, size, spin, stain, screen and initial style manipulation | Brush behavior parity, pressure control and reusable appearance libraries |
| Precision and production | Planned | Rich snapping, units, rulers, color management, print export and production-scale performance |
| Wider studio | Planned in existing feature contracts | Docking, multiwindow, collaboration, masks, 3D modeling and animation |

## Explicit preview limits

Tracing downsamples to at most 64 pixels per side and emits editable scanline shapes.
It is not contour-fitted curve tracing. Source images are retained so users can retry
or release the trace. Inspect results before replacing production artwork.

Filled-vector erasing uses polygon clipping with 24 samples per curved segment.
The result is approximate geometry, not an exact cubic boolean. Boolean combination
excludes raster and text layers; nested group paths are limited to 16 levels. Nine-slice resizing
uses a fixed 25 percent inset; there is no editable registration or slice-guide UI.
Symbol Style is an initial appearance operation, not a complete graphic-style library.
These limitations remain requested work and must not be marked Done by the presence
of a toolbar button.

Multi-object nonuniform resizing preserves rotated child geometry using centered
shear. Native v2 carries the optional skew angle through rendering and export.
Reflect uses optional flipX/flipY flags across vector, image and text rendering, hit
testing and export. Tool families expose sibling tools through triangular flyouts;
outside interaction and Escape dismiss them. Matching familiar tool names does not
establish complete behavioral parity; pending fidelity remains part of the scope.

## Navigation and delivery discipline

[Implementation plan](../implementation/PLAN-0008-0001.md) describes acceptance,
migration, contracts and evidence. [ADR-0023](../adr/ADR-0023.md) records the proposed
geometry/dependency choice. [Current release notes](../changelog/0.3.0-alpha.1.md)
describe the local preview. Continue using the existing FEAT and SC contracts;
Verified requires the full quality policy and independent human review.
