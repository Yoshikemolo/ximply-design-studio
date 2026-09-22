---
id: "REL-0003"
title: "Pending changes"
status: "proposed"
domain: "changelog"
owners: ["Yoshikemolo"]
applies_to: ["ximply-design-studio"]
related: ["FEAT-0028"]
source: ["Project change history and owner changelog requirements"]
version: "Unreleased"
date: null
summary: "Pending changes"
breaking_changes: true
capability_status: "local-preview"
---

# Unreleased — Pending changes

Changes after 0.7.0 are recorded here until the next release.

## Breaking changes

- Documents that hold an envelope are refused by 0.7.0 and earlier editors and APIs, which do not know the field (ADR-0034, proposed). Migration: to open such a document in an earlier version, expand or release its envelopes first.

## New features

- Shear with the Shear tool, beside Scale and Reshape: a drag that starts up or down shears along the vertical axis and one that starts sideways along the horizontal axis, about the pivot, with Shift keeping the original width or height; a click moves the reference point first, and Alt-click moves it and opens the Shear dialog, which takes an angle from -359 to 359 along a horizontal, vertical or angled axis, with Copy. Every object keeps its kind, text and pictures included.
- Scale with the Scale dialog, from a double-click on the tool, Alt-click or Object > Transform > Scale: Uniform or Non-Uniform percentages, negative ones reflecting, Scale Strokes & Effects and Copy.
- Transform with the Free Transform tool (E): its box moves the selection from inside, scales it from a handle against the opposite one, Shift keeping the proportions and Alt scaling from the centre, and rotates it from outside, Shift by 45 degrees. Holding Ctrl+Alt while a side handle is dragged shears along that side, Ctrl on a corner handle distorts freely and Shift+Alt+Ctrl distorts in perspective. Distorted shapes become paths that pass within half a pixel of the exact map; text, pictures, symbols, dimensions and floor-plan objects are left as they are and named.
- Reshape with the liquify tools, in a family of their own: Warp (Shift+R) pushes the outline with the drag; Twirl turns it about the brush, counterclockwise for a positive rate; Pucker pulls it in and Bloat pushes it out; Scallop, Crystallize and Wrinkle add curved, spiked and wrinkled details. They act inside an elliptical brush drawn at the cursor, keep acting while the button is held, reshape only the selection when there is one and every unlocked vector object under the brush when there is none, and add anchors at the spacing of Detail. Alt-drag sizes the brush, Shift+Alt as a circle, and a double-click on the tool opens its options with the ranges of the manual, kept between sessions.
- Reshape objects with envelopes, from Object > Envelope Distort: Make With Warp (Alt+Shift+Ctrl+W) with the Warp Options and a live preview, the fifteen styles shown by pictures, the axis, Bend and the horizontal and vertical Distortion; Make With Mesh (Alt+Ctrl+M) with its rows and columns; and Make With Top Object (Alt+Ctrl+C), the topmost selected shape taking the others. The objects stay whole inside one Envelope. Edit Contents (Shift+Ctrl+V) brings them out to be edited with every tool while the envelope keeps drawing them through its mesh, and Edit Envelope takes them back, recentred; Reset With Warp and Reset With Mesh, which can keep the shape, replace the mesh; Envelope Options sets the Fidelity; Release gives back the objects and the envelope's shape, and Expand leaves the distorted paths. The Direct Selection tool drags the points and handles of the mesh, the Mesh tool (U) adds a row and a column through a click, and Delete on a chosen point removes them. The canvas, SVG and PDF draw the same distortion. Text is outlined first (Ctrl+Shift+O).
- Transform each selected object about its own reference point with Object > Transform > Transform Each (Alt+Shift+Ctrl+D): scale, move, rotate and reflect, with the nine reference points and Copy.

## Improvements

- Fill the icon of the Selection tool, as Illustrator draws its black arrow, and keep the Direct Selection tool's icon as an outline, so the two are told apart at a glance.
- Drag with the Scale tool as in Illustrator: the point pressed follows the pointer on each axis about the pivot, Shift keeps the proportions on a diagonal drag and scales one axis on a drag along it, and a click sets the reference point.
- Repeat a scale or a shear with Transform Again (Ctrl+D) as the same map about the same point.
- Gather the transformations of the selection in an Object > Transform section of the menu.

## Fixes

None.

## Security

None.

## Engineering

- Record the owner's decisions on 0.7.0: ADR-0033, the gradients, patterns and swatches of the native format, is accepted, and the colour tools and the phone layout are accepted visually for the maturity of this preview. The strict Sonar gate remains outstanding, so no scenario is marked Verified.
- Keep the affine map of layers, the quadrilateral map, the liquify tools and the envelope mesh of Coons patches in the domain package, tested against geometric oracles; the API validates envelopes as the editor does, and its request schema stops at the layers an envelope holds instead of expanding them forever.
