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

Pending corrections to the local editor preview.

## Breaking changes

None.

## New features

None.

## Improvements

- Add explicit Help > About and footer About entries, with Ximplicity company links opening its website in a new tab.

## Fixes

- Prevent accidental text selection in interface labels while preserving native selection in inputs, text areas and editable text.
- Load the full editor stylesheet directly in production so the Content Security Policy does not leave the interface unstyled. Rebuild the local containers to apply the correction.
- Use localhost:8090 by default for the local editor to avoid conflicts with port 8080. Existing installations should set XDS_PORT=8090 in .env.local and restart; credentials and saved projects are preserved.

## Security

None.

## Engineering

None.
