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

Corrections on top of 0.4.0, kept at that version number until the next release.

## Breaking changes

- A document may now hold up to a thousand layers instead of a hundred and fifty, which drawings imported from other tools often need. Migration: a file with more than a hundred and fifty layers is refused by earlier versions of this editor and of the API; keep the original file if you need to open it there.

## New features

- Import SVG drawings as editable native layers, with their shapes, paths, text, colours, stroke widths, transforms and groups, and report in the status line whatever the reader could not represent.
- Duplicate in series with Ctrl+Shift+D: a linear series with its own step, turn and relative size per copy; a circular series around the pivot, with the copies turning with it or keeping their rotation; and a grid series with its columns, rows and gaps.
- Copy, cut and paste artwork, with paste in front and paste in back, which keep the coordinates of the copy and place it immediately above or below the selected object. Copy is Ctrl+C, cut Ctrl+X, paste Ctrl+V, paste in front Ctrl+F and paste in back Ctrl+B.
- Show or hide the bounding box of the selection, the frame with its handles and the rotation knob, with Ctrl+Shift+B.
- Lay the list of documents in the export dialog out as a table with a heading, the document name on the left and its selection box on the right, alternating rows and a box that chooses or clears them all. The table is a component of its own, with multiple selection as a feature, so other lists can be built on it.
- Offer the clipboard actions, the duplicate and the bounding box on the selected objects in the context menu, each with its key.
- Add a copy and paste group to the tool rail beside the import action, with copy, cut, the three pastes, the duplicate and the duplication in series in its list of subtools, each enabled only when it applies.
- Export as PDF, with the vector geometry of the drawing rather than a picture of it: paths keep their curves, strokes keep their dashes and text keeps its characters, drawn with the standard font.
- Choose what to export from one dialog: the format, and which of the open documents are included, with the current one chosen to begin with. A PDF collects them as one page each; SVG and PNG write one file per document.
- Print the chosen documents through the printing dialog of the browser, one page each, from the File menu or the export dialog.
- Cut paths with two clicks: the scissors open a path at two of its own points, leaving independent open paths, and the knife divides the closed shapes its line crosses into two independent closed shapes. Both draw the cut in progress, both are undone in one step, and Escape forgets a cut that was started.
- Import Illustrator and PDF drawings: the page of the file is read and its paths, colours and stroke widths arrive as editable layers, with the page turned upright and measured in pixels. Text, placed objects, inline images, gradients and clipping paths are reported instead of approximated.
- Import ASCII DXF drawings: lines, polylines, circles, arcs, ellipses, points and text, with each drawing layer kept as a group and the drawing mirrored into document coordinates.

## Improvements

- Offer SVG and DXF beside the images in the import dialog, and refuse DWG, PDF and Illustrator files with the export that does work instead of a silent failure.
- Repeat the last transformation with Ctrl+D: the move, the turn, the scaling or the duplication just applied is performed again on the selection, the copy it left behind included, and around the same pivot the original transformation used. A pivot placed by hand also travels to the copies a duplication makes, so successive repeats turn around one point.
- Leave the original behind while transforming: holding Alt during a move, a turn or a scaling duplicates the objects on release. The original stays drawn in its place while the copy follows the pointer, the tool badge beside the cursor doubles and the cursor takes the copy sign, and the keys held at the moment of the release decide the outcome, so Alt can be pressed without moving the pointer again.
- Raise the document size ceiling from 4096 to 8192 pixels, so A3 and A2 at 300 dots per inch can be set up and stored. A1 and A0 at that resolution stay out of range.

## Fixes

- Prepare the raster layers of a PDF with an image element instead of a network request, which a strict content security policy can refuse.
- Bring the transform pivot back with undo and forward with redo: each history step now carries the pivot it was taken with, and placing the pivot is a step of its own that leaves the artwork untouched.

## Security

None.

## Engineering

- Let the document history carry the session state of each step beside the document, which is how the pivot travels with undo and redo.
