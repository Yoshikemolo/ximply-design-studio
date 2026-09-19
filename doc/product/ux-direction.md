---
id: "DOC-PRODUCT-0005"
title: "UX direction — Ximplicity studio"
status: "proposed"
domain: "product"
owners: ["Yoshikemolo"]
applies_to: ["ximply-design-studio"]
related: []
source: ["Project owner requirements and design foundation; methodology application recorded in AUDIT-0001"]
---

# UX direction — Ximplicity studio

Status: Proposed design direction, based on the live public website inspected on
2026-09-19. Source: [ximplicity.es](https://ximplicity.es/).

The public site leads with “Make IT easy”, concise enterprise-engineering messaging,
a small navigation set, explicit language selection and a theme switch. These are
observed characteristics. The studio's tokens, interaction rules and layout below
are proposals rather than a claimed copy of a brand manual or exact logo reconstruction.
No logo geometry or official font asset has been invented.

## Product personality

Quiet, precise and technically confident. The artwork is the focus; chrome uses clear
hierarchy, restrained accent color and short labels. Ximplicity personality appears
in the wordmark area, balanced spacing, crisp geometry and a controlled electric-blue
accent, not glowing decoration around every panel. Avoid gradients behind data,
oversized marketing cards in the editor, emoji icons and unexplained abbreviations.
Use original approved vector icon assets consistently. Reserve strong color for
active tool, selection, focus and warnings; layer color tags have separate meaning.

## Shell composition

Desktop reference viewport: 1440x900. App bar 44 px, menu/context strip 32 px each,
left tool rail 44 px, primary right dock 288 px and optional secondary dock 240 px,
status strip 24 px. These are starting dimensions, with user density options and
minimum readable text sizes. Docks should not consume more than 40% of the initial
viewport; collapse secondary docks first. The central canvas stays visually neutral
with a subtle boundary between pasteboard and artboard. Floating panels have a clear
header/drag target, small elevation and visible focus, without heavy nested borders.

Top bar: project/document and save state on the left; activity preset and view controls
near center; participant avatars, Share, account/settings on the right. Avatar colors
are stable, supplemented by initials and accessible labels. Do not place global
administration/licence controls in the main drawing workflow; they belong in settings.
A licensing limitation gives a precise reason and a nonblocking route to resolve it.

## Settings navigation — owner requirement

Settings uses two columns: a category menu on the left and only the selected
category's form on the right. Keep navigation visible while long forms scroll,
use localized category names and explanatory icon tooltips, and preserve keyboard
navigation and visible focus. On narrow screens adapt the navigation without
restoring one long form containing every category.

Apply this structure whenever adding settings. Register each category centrally;
do not append unrelated controls to the end of a shared scrolling form. Switching
categories must cancel transient shortcut recording without resetting saved values.

Future memory and storage categories should follow this same structure. Candidate
settings include maximum undo count, maximum undo-memory size, clearing undo history,
temporary directory and default work directory. These are recorded future needs,
not implemented capabilities; directory controls require an appropriate filesystem
capability and undo-memory controls require defined history accounting semantics.

## Core interactions

- Selecting an object updates Properties without moving panel positions.
- Drag target previews distinguish tab grouping from split insertion through shape
  and label, not color alone. Escape restores state; keyboard Move offers the same result.
- Tool options are contextual and stable; secondary parameters expand deliberately.
- Numeric input supports keyboard increment, unit parsing, reset and mixed selection values.
- Destructive bake, overwrite and format-loss choices show concrete consequences.
- Autosave state says Draft, Saving, Saved, Offline or Failed, with revision details on demand.
- Progress appears near the initiating control, supports cancel and preserves input.
- Empty galleries teach Import, Create or Link project; no disabled fake examples.
- Error messages say what happened, what is preserved and the next available action.

## Accessibility and responsive behavior

Keyboard-first menu/toolbar/tab semantics; visible focus, screen-reader names and
announcements for save/error states. Minimum touch target 44 px; no hover-only action.
At narrow widths, one bottom-sheet tool panel and one viewport are primary. Desktop
functionality is adapted, not squeezed into unreadable controls. Respect reduced
motion and high contrast. Follow mode visibly indicates whose view is followed and
always offers Escape/Stop. Use native text fields and accessible equivalents to canvas
manipulation where practical. Check WCAG targets during implementation; no compliance
certification is claimed by this design.

## Candidate token system

Dark: neutral near-black pasteboard, slightly lighter dock surfaces, off-white text.
Light: warm-neutral canvas surround, white panels, dark text. Accent: a single blue
family with separate selected/focus states. Destructive red and warning amber remain
semantic tokens independent of brand. Exact values must be contrast-tested and approved
against the real logo assets; the initial proposal is in design-tokens.json. Font stack
starts with system sans-serif until the site's font licence/assets are verified.
Spacing uses a 4 px base with 8/12/16/24 steps. Panel radius 6 px; floating group 8 px.
Animation 120–180 ms for local UI, disabled with reduced-motion preference.

## UX acceptance before implementation completion

Task tests: create/save document; draw/select/edit; paint mask; rearrange/recover panels;
compare split views; follow and stop; understand a licence limitation; recover failed
save. Record task completion, errors and user feedback; do not equate visual polish
with usability. Deliver annotated desktop/tablet/mobile screens and interaction
prototypes in FEAT-0027 before declaring the shell UX complete.

## Observed brand values

Live DOM computed styles on Ximplicity's home page: Space Grotesk for body/navigation,
Kodchasan for the hero title, primary blue rgb(13,89,242) (#0D59F2), light background
rgb(245,246,248) (#F5F6F8), text rgb(15,17,21) (#0F1115). These observed website values
can anchor the studio theme; font distribution/licensing still needs verification.
Use the actual vector mark supplied by the website, not a newly drawn approximation.
