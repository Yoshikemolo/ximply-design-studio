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
capability_status: "design-only"
---

# Unreleased — Pending changes

The editor is not implemented. These notes describe engineering foundations.

## Breaking changes

None.

## New features

None.

## Improvements

None.

## Fixes

- Generated documentation navigation is identical on Windows and POSIX hosts, with forward-slash links and case-sensitive document order.

## Security

None.

## Engineering

- The contribution check accepts two pinned historical GitHub merge commits on dev by exact SHA and reason, without rewriting history; all other commits remain fully checked.
