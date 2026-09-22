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

Changes after 0.6.0 are recorded here until the next release.

## Breaking changes

- Documents that carry a gradient or pattern fill, patterns or swatches are refused by 0.6.0 and earlier editors and APIs, which do not know those fields (ADR-0033, proposed). To open such a document in an earlier version, set the fills back to plain colours and remove its patterns and swatches.

## New features

- Lock and hide objects as Illustrator does: Lock and Hide the selection with Ctrl+2 and Ctrl+3, the artwork above it that overlaps it, or everything outside its top-level groups with Ctrl+Alt+Shift+2 and Ctrl+Alt+Shift+3; Unlock All with Ctrl+Alt+2 and Show All with Ctrl+Alt+3 bring every object back and select it. Keys with a digit are read by their place on the keyboard, so they work on layouts whose Ctrl+Alt types a character of its own.
- Use the studio on a phone. The column of tools and the panels become drawers that slide in from the left and right edges, opened with a swipe from the edge or a tap on its handle and closed with a swipe back or a tap outside; the menus fold behind a menu button, with the credits of the footer fixed at their foot; and the page fits the screen, with the drawers scrolling only down.
- Switch documents on a phone from a list in the header, between the application icon and the language, which also makes a new document and closes the one shown; the strip of tabs gives its height to the canvas. The document is renamed in Properties, where its name now sits with the rest of the page.
- Paint shapes and text with gradients and patterns, stored in the native format with the patterns and swatches of the document and checked on open by the editor and the API. A linear gradient crosses the object along its angle and a radial one spreads from its centre, each with its colour stops and midpoints, and turns with the object; a pattern tiles its artwork from the document origin, as Illustrator lays patterns out. Both are drawn on the canvas and written to SVG.
- Open context menus with a long press, since a phone has no right button; the canvas, the layers and the guides each open their own.
- Zoom and pan the canvas with two fingers, and scale the selection in proportion, turn it and move it with two fingers that land on it, around its pivot and as one step.
- Show the properties of the document in Properties when nothing is selected, as Illustrator does: width and height in the ruler unit, the orientation, the ruler unit, the margin guides with their centre guides, the registration marks and the background, each applied at once while the rest of the page setup is kept, with the full Document dimensions dialog a button away.

## Improvements

- Select a filled open curve by clicking inside its fill, as a closed one is, since the fill paints it as if closed; an open curve without a fill is still selected by its outline only, and locked or hidden curves never are.
- Redraw the icons of the Bezier tools as Illustrator draws them: the Pen as a fountain-pen nib, Add Anchor Point, Delete Anchor Point and Convert Anchor Point as the same nib with a plus, a minus or a small square at its top left corner. The Paintbrush and the raster brush now show a brush with a pointed tip, above a vector path or a painted stroke.
- Make the strip of document tabs 38 pixels high and each tab 36, so the tabs sit inside the strip.
- Bring the agent instructions in line with the project as it is: the promotion from dev to release and main without qa and demo branches, the docs branches, the licence, the imitation of Illustrator's behaviour and keys, and the preview publishing rules.
- Bring the contribution guide in line with the licence and the way the project works now: outside contributions need the author's written agreement first, work reaches dev through pull requests and goes on to release and main, the checks are the ones the project runs, and the paused Sonar check is never taken as a pass.

## Fixes

- Draw the marks of tool icons without a background the icon cannot resolve: a plus, a minus or a square on a badge filled from a theme variable showed as a solid dot, since an icon loaded as a picture does not see the page's variables.
- Tint the document icon of Properties with the theme, as every other icon is.
- Lay the quick backgrounds of the document out in equal columns across the panel, a little closer together, so No color ends where the other controls end instead of against the edge.
- Give everything in Properties the side margins the other panels have; only its transform fields had them.
- Let a page change keep up to the thousand layers a document may hold; it still refused more than a hundred and fifty.

## Security

None.

## Engineering

- Record the owner's decisions on 0.6.0: ADR-0032, the brush carried by a path in the native format, is accepted, and the drawing tools are accepted visually for the maturity of this preview. The strict Sonar gate remains outstanding, so no scenario is marked Verified.
