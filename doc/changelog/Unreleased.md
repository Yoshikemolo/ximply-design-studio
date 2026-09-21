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

Changes after 0.6.0 are recorded here until the next release.

## Breaking changes

None.

## New features

- Show the properties of the document in Properties when nothing is selected, as Illustrator does: width and height in the ruler unit, the orientation, the ruler unit, the margin guides with their centre guides, the registration marks and the background, each applied at once while the rest of the page setup is kept, with the full Document dimensions dialog a button away.

## Improvements

- Make the strip of document tabs 38 pixels high and each tab 36, so the tabs sit inside the strip.
- Bring the agent instructions in line with the project as it is: the promotion from dev to release and main without qa and demo branches, the docs branches, the licence, the imitation of Illustrator's behaviour and keys, and the preview publishing rules.
- Bring the contribution guide in line with the licence and the way the project works now: outside contributions need the author's written agreement first, work reaches dev through pull requests and goes on to release and main, the checks are the ones the project runs, and the paused Sonar check is never taken as a pass.

## Fixes

- Give everything in Properties the side margins the other panels have; only its transform fields had them.
- Let a page change keep up to the thousand layers a document may hold; it still refused more than a hundred and fifty.

## Security

None.

## Engineering

- Record the owner's decisions on 0.6.0: ADR-0032, the brush carried by a path in the native format, is accepted, and the drawing tools are accepted visually for the maturity of this preview. The strict Sonar gate remains outstanding, so no scenario is marked Verified.
