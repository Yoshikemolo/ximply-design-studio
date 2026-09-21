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

- Import encapsulated PostScript drawings, the EPS files Illustrator and CorelDRAW export: their paths, colours and stroke widths arrive as editable layers, read with the names of the language and the aliases each program defines for them, and whatever falls outside that vocabulary is reported.

## Improvements

- Give the text tool a list of its own, so Create outlines sits beside the tool that writes the text; every tool family with a command of its own now shows the arrow that opens its list.
- Name what an outline of the stroke left alone: a selection of several objects outlines every one that carries a stroke and says which ones it passed over, text, images, dimensions or objects with no stroke, instead of doing nothing visible.

## Fixes

- Keep the appearance popovers of the fill and the stroke on the screen: the one opened from the squares at the bottom of the tool rail ran past the lower edge, since the place was chosen from the square before the popover had a height.

## Security

None.

## Engineering

None.
