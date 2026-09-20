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

None.

## Improvements

- Raise the document size ceiling from 4096 to 8192 pixels, so A3 and A2 at 300 dots per inch can be set up and stored. A1 and A0 at that resolution stay out of range.

## Fixes

- Bring the transform pivot back with undo and forward with redo: each history step now carries the pivot it was taken with, and placing the pivot is a step of its own that leaves the artwork untouched.

## Security

None.

## Engineering

- Let the document history carry the session state of each step beside the document, which is how the pivot travels with undo and redo.
