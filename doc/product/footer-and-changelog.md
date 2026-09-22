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
bottom row of the authenticated application.

The bottom row of the studio follows the one the company already ships in its data
mapping product, at the owner's request and in the same order: the copyright of the
year with Ximplicity Software Solutions and the author, each one a link; the version,
which opens the about screen with the running release; and the links to LinkedIn, to
Ximplicity and to the repository of this project, each opening in its own tab. The
product name replaces the one that product uses. The site map and the level indicator
of that footer belong to that product and are not copied. Browser access was declined; no attempt
was made to bypass it. Do not invent missing destinations or claim footer parity yet.
The user requires the same bottom-row links: implementation acceptance requires a
confirmed ordered label/URL mapping from the reference application or a supplied
screenshot/export. Keep this requirement explicitly open until that evidence exists.

## Version and changelog design

`release/version.json` remains the single current-version source. Authoritative
release notes are Markdown files under `/doc/changelog/<version>.md`; pending work
uses [Unreleased](../changelog/Unreleased.md). `release/changelog.json`, root
CHANGELOG.md and `apps/web/public/assets/changelog/` are derived outputs generated
by `python3 harness/changelog.py --write`. Never edit them independently.

The owner-supplied screenshot and `/about?version=3.7.1` reference confirm the intended
information hierarchy: About identity, release selector, dated summary, prominent
breaking-change notice and categorized entries. This establishes the layout pattern,
not the exact footer destinations or another product's release claims.

In the about screen the identity, the licence with its SHA-256 and the release selector sit
above the dividing line and stay in place, with the credits of the footer fixed at the
foot; only the release notes between them, from the breaking changes on, scroll. On a
screen too short to hold both, under 560 pixels high, the whole screen scrolls instead.

The future Angular About route is `/about?version=<exact-version>`. The footer links
to the running version; changing the selector updates that parameter. Read versions
from the bundled index, newest semantic version first; load only the selected
Markdown asset named by the index. Resolve versions by exact manifest membership,
never interpolate an unchecked query parameter into a file path. A missing parameter
selects the current version. An unknown version displays an accessible not-found
message and a current-version action; do not silently show a different release.
Browser back/forward restores the selected release. The local preview implements version selection, exact manifest lookup and browser
history handling; full accessibility and offline-browser acceptance remain pending.

All published notes ship with the application and work offline. Labels belong to EN/ES
catalogs; authored release prose starts in English with explicit English fallback for
untranslated releases. The selector is labelled, keyboard-operable and responsive;
selected version and heading changes are announced without taking keyboard focus.
Markdown rendering must disable raw HTML and embedded scripts, allow only safe link
schemes and use the application's sanitization boundary. Do not insert raw Markdown
or raw HTML using an unchecked innerHTML path. Never fetch remote changelog content
or execute Markdown. Bundled assets are data, not a plugin execution surface.

## Maintenance contract

Every note includes date, summary, explicit breaking_changes boolean and capability
status. Required sections: Breaking changes, New features, Improvements, Fixes,
Security and Engineering. Empty sections say `None.`. Entries use one Markdown bullet
per change. A breaking release must include explicit `Migration:` instructions.
The boolean and breaking entries must agree; no breaking change means an explicit
empty list in generated data and a no-breaking-changes message in the future UI.

For each implementation PR, edit Unreleased.md or add a version note. At a release
checkpoint, transfer relevant pending notes into a new version file, update the
current-version source, regenerate assets and validate. Preserve existing published
notes; correct material errors through a documented correction rather than silently
rewriting history. Conventional Commits help classification but do not replace
reviewed user-facing descriptions. A design prerelease must not claim editor features.

```bash
python3 harness/changelog.py --write
python3 harness/changelog.py --check
```

Use the [release-note template](../templates/release-note.md) for a new version.

CI also compares PR base/head changes and rejects implementation changes without a
Markdown note update. This proves a note was changed, not that its prose is accurate;
human review still checks completeness, classification and compatibility impact.
Current local implementation provides source files, generator, assets and checks.
The Angular version-selector screen is implemented in the local preview. Its
Markdown sections render as escaped text and lists; rich Markdown is intentionally
not interpreted. Visual browser acceptance is still pending.

Footer layout and exact links remain governed by the reference-confirmation section
above. The screenshot does not establish destination URLs for the small bottom row.

## Acceptance

SC-0082: version source equals footer/About/API/scanner build input; missing release fails.
SC-0083: every release states breaking status and typed changes; offline About works.
SC-0084: bottom-row labels, order and hrefs equal the confirmed reference manifest;
missing evidence blocks this parity claim. Safe external targets use appropriate
navigation protections; legal pages must actually apply to this product.
