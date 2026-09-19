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

Engineering follow-up for incremental preview delivery.

## Breaking changes

- Extended native-v2 paints and guide metadata require the updated reader. Migration: preserve original files and use this version for new saves; older readers may reject or discard these extensions.

## New features

None.

## Improvements

None.

## Fixes

None.

## Security

None.

## Engineering

- Add a disposable SonarQube trial with pinned images, real coverage inputs, retained findings and automatic container/volume teardown. This diagnostic run does not replace the strict integration gate.
- Exercise the actual trial image-resolution and teardown commands with regression tests, including preservation of unrelated containers. These tests do not claim a live scan.
- Record incremental product checkpoints and explicit branch/version feedback as permanent project instructions.
- Retry temporary connection resets while the disposable server starts; sanitize transport errors before writing diagnostic output.
- Add native-v2 absent/alpha paints and nonprinting guide metadata with matching API validation, renderer tests and measurement preferences; interface integration is in progress.
