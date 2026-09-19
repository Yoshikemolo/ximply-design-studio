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

- Generated documentation navigation is identical on Windows and POSIX hosts, with forward-slash links and case-sensitive document order.
- Load the full editor stylesheet directly in production so the Content Security Policy does not leave the interface unstyled. Rebuild the local containers to apply the correction.
- Use localhost:8090 by default for the local editor to avoid conflicts with port 8080. Existing installations should set XDS_PORT=8090 in .env.local and restart; credentials and saved projects are preserved.

## Security

None.

## Engineering

- Add the GitHub web merges of PR #13 and PR #15 on dev to the pinned legacy-commit exemptions by exact SHA and reason, without rewriting history.
- Temporarily pause the Sonar quality job at the owner's request, preserving its commented analysis steps and strict policy for reactivation; skipped analysis is not passing quality evidence.
- Add a disposable SonarQube trial with pinned images, real coverage inputs, retained findings and automatic container/volume teardown. This diagnostic run does not replace the strict integration gate.
- Exercise the actual trial image-resolution and teardown commands with regression tests, including preservation of unrelated containers. These tests do not claim a live scan.
- Record incremental product checkpoints and explicit branch/version feedback as permanent project instructions.
- Retry temporary connection resets while the disposable server starts; sanitize transport errors before writing diagnostic output.
- Add native-v2 absent/alpha paints and nonprinting guide metadata with matching API validation, renderer tests and measurement preferences; interface integration is in progress.
