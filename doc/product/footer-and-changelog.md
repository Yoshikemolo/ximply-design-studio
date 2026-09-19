---
id: "DOC-PRODUCT-0002"
title: "Footer and changelog contract"
status: "proposed"
domain: "product"
owners: ["Yoshikemolo"]
applies_to: ["ximply-design-studio"]
related: []
source: ["Project owner requirements and design foundation; methodology application recorded in AUDIT-0001"]
---

# Footer and changelog contract

Status: Proposed; exact application bottom-row mapping requires confirmation.

## Observed reference

The public [EvidentApp changelog](https://evidentapp.ai/changelog/) was retrieved on
2026-09-19. It presents recent releases from application-shipped data, identifies
breaking changes explicitly, separates feature/usability/security/fix entries and
links the footer version to that exact release. Reuse this information architecture,
not another product's release claims or legal disclaimer.

The public home/footer text exposes company links labelled Ximplicity, GitHub,
Contact us, Privacy policy and Legal notice, and reference links Architecture,
Documentation, Changelog and Security advisories. This does not establish the exact
bottom row of the authenticated application. Browser access was declined; no attempt
was made to bypass it. Do not invent missing destinations or claim footer parity yet.
The user requires the same bottom-row links: implementation acceptance requires a
confirmed ordered label/URL mapping from the reference application or a supplied
screenshot/export. Keep this requirement explicitly open until that evidence exists.

## Version and changelog design

`release/version.json` is the single version source for About, footer, health/version,
scanner projectVersion, image metadata and release packaging. `release/changelog.json`
contains typed entries linked to versions. A build validates the current version
exists, versions are unique, dates parse and breakingChanges is explicitly an array
(including empty). The initial version is a design prerelease, not an editor release.

Footer: a restrained, single compact status/legal line; version link opens About at
its matching entry. Longer legal/reference links can wrap responsively, preserving
order, keyboard access and labels. Put content/navigation in a central footer manifest
rather than repeating literals in components. Locale catalogs translate labels when
other interface languages are enabled. Core copyright owner is Ximplicity Software
Solutions; do not import Evident's data-governance-specific disclaimer into a design tool.

The full changelog ships with the application and works offline. A public page can
render the latest five entries from the same file. Types are Feature, Usability,
Security and Fix; add Engineering for bootstrap-only changes without pretending they
are new editor capabilities. Show explicit migration/compatibility instructions for
breaking releases. Conventional Commits assist classification, but a human writes
user-facing release notes; do not expose raw commit messages as the whole changelog.

## Acceptance

SC-0082: version source equals footer/About/API/scanner build input; missing release fails.
SC-0083: every release states breaking status and typed changes; offline About works.
SC-0084: bottom-row labels, order and hrefs equal the confirmed reference manifest;
missing evidence blocks this parity claim. Safe external targets use appropriate
navigation protections; legal pages must actually apply to this product.
