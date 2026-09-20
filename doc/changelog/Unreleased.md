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
breaking_changes: false
capability_status: "local-preview"
---

# Unreleased — Pending changes

Corrections on top of 0.4.0, kept at that version number until the next release.

## Breaking changes

None.

## New features

- Import SVG drawings as editable native layers, with their shapes, paths, text, colours, stroke widths, transforms and groups, and report in the status line whatever the reader could not represent.
- Export as PDF, with the vector geometry of the drawing rather than a picture of it: paths keep their curves, strokes keep their dashes and text keeps its characters, drawn with the standard font.
- Choose what to export from one dialog: the format, and which of the open documents are included, with the current one chosen to begin with. A PDF collects them as one page each; SVG and PNG write one file per document.
- Print the chosen documents through the printing dialog of the browser, one page each, from the File menu or the export dialog.
- Cut paths with two clicks: the scissors open a path at two of its own points, leaving independent open paths, and the knife divides the closed shapes its line crosses into two independent closed shapes. Both draw the cut in progress, both are undone in one step, and Escape forgets a cut that was started.
- Import ASCII DXF drawings: lines, polylines, circles, arcs, ellipses, points and text, with each drawing layer kept as a group and the drawing mirrored into document coordinates.

## Improvements

- Offer SVG and DXF beside the images in the import dialog, and refuse DWG, PDF and Illustrator files with the export that does work instead of a silent failure.
- Raise the document size ceiling from 4096 to 8192 pixels, so A3 and A2 at 300 dots per inch can be set up and stored. A1 and A0 at that resolution stay out of range.

## Fixes

- Bring the transform pivot back with undo and forward with redo: each history step now carries the pivot it was taken with, and placing the pivot is a step of its own that leaves the artwork untouched.

## Security

None.

## Engineering

- Let the document history carry the session state of each step beside the document, which is how the pivot travels with undo and redo.
