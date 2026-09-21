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

Corrections on top of 0.5.0, kept at that version number until the next release.

## Breaking changes

None.

## New features

- Turn a text into one shape per letter, each with the holes of that letter inside it, the letters of a word grouped together, the words grouped into the text and the whole thing kept inside the group the text belonged to. A selection of several texts outlines every one of them.
- Import encapsulated PostScript drawings, the EPS files Illustrator and CorelDRAW export: their paths, colours and stroke widths arrive as editable layers, read with the names of the language and the aliases each program defines for them, and whatever falls outside that vocabulary is reported.

## Improvements

- Show the same credits in the footer as the other product of the company, in the same order: the copyright with the company and the author, each one a link, then the version that opens the about screen, then the links to LinkedIn, to Ximplicity and to the repository of this project, each in its own tab.
- Give the text tool a list of its own, so Create outlines sits beside the tool that writes the text; every tool family with a command of its own now shows the arrow that opens its list.
- Name what an outline of the stroke left alone: a selection of several objects outlines every one that carries a stroke and says which ones it passed over, text, images, dimensions or objects with no stroke, instead of doing nothing visible.

## Fixes

- Create outlines produced one shape for a whole text, painted with the colour of a new path rather than the colour of the text, and the contours of a letter were left open because a font does not write the closing word; each letter is now its own closed shape in the paint the text carried.
- Keep the appearance popovers of the fill and the stroke on the screen: the one opened from the squares at the bottom of the tool rail ran past the lower edge, since the place was chosen from the square before the popover had a height.

## Security

None.

## Engineering

None.
