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

- Point the readme at the published preview, https://xds.ximplicity.es, and clone the default branch instead of a branch that was retired.
- Publish the editor on the owner's preview address with `scripts/deploy-production.ps1`, which builds the checkout, uploads it under the commit it was built from, moves the link the web server reads and reloads it only after the configuration is accepted, keeping the earlier releases so a return to one of them is a single command.
- Name the import command Import, not Import image: it reads drawings as well as pictures.
- Show or hide the column of tools from View, Layout, like the other blocks of the workspace. The canvas takes the width the column leaves, and the choice is remembered.
- Build the spatial preview by group: every element of a group is painted on the same plane and a layer outside a group takes a plane of its own, so the depth of the preview follows how the drawing is organised.
- Offer a parallax view in the spatial preview. The camera faces the planes head on and follows the pointer a fraction of the page, so the near planes travel further across the view than the far ones; the orbit view returns with the same button.
- Show the same credits in the footer as the other product of the company, in the same order: the copyright with the company and the author, each one a link, then the version that opens the about screen, then the links to LinkedIn, to Ximplicity and to the repository of this project, each in its own tab.
- Give the text tool a list of its own, so Create outlines sits beside the tool that writes the text; every tool family with a command of its own now shows the arrow that opens its list.
- Name what an outline of the stroke left alone: a selection of several objects outlines every one that carries a stroke and says which ones it passed over, text, images, dimensions or objects with no stroke, instead of doing nothing visible.

## Fixes

- Run the keyboard commands of the editor while a text is being written or a field has the keyboard. The inline writing of a text kept every key for itself, so Ctrl+Shift+O and the other commands did nothing; what is written is now committed first and the command runs on the object, as it does in Illustrator. A field keeps the keys that write in it.
- Show and hide the Pivot and Selection blocks of the workspace from the Layout menu. Their entries did nothing, because the settings accepted only four block names out of six.
- Create outlines and outline stroke did nothing from the Object menu, the list of the text tool or the context menu: those surfaces read a table of commands that did not carry them, while the keyboard read another. Every surface now reads one table, so a command cannot reach one of them and not the others.
- Keep the keyboard settings the owner saved when a new command appears. A command that the saved settings had never heard of made the whole file invalid, and every customised shortcut was replaced by the defaults; the new command now takes its own keys and the rest are left alone.
- Create outlines produced one shape for a whole text, painted with the colour of a new path rather than the colour of the text, and the contours of a letter were left open because a font does not write the closing word; each letter is now its own closed shape in the paint the text carried.
- Keep the appearance popovers of the fill and the stroke on the screen: the one opened from the squares at the bottom of the tool rail ran past the lower edge, since the place was chosen from the square before the popover had a height.

## Security

None.

## Engineering

None.
