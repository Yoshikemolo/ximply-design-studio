---
id: "DOC-PRODUCT-0001"
title: "Commercial product and entitlement model"
status: "proposed"
domain: "product"
owners: ["Yoshikemolo"]
applies_to: ["ximply-design-studio"]
related: []
source: ["Project owner requirements and design foundation; methodology application recorded in AUDIT-0001"]
---

# Commercial product and entitlement model

Status: Proposed. Initial edition: Community / Free. No price, paid-plan contract,
user cap or term length has been commercially approved. The design supports these
parameters without hard-coding them into tools. Public repository visibility and
product entitlements are separate from the source-code licence decision.

## Product boundaries

A plan is a named versioned product offer. A bundle is a versioned grouping of plugin
entitlements. An individual plugin can be licensed independently. A licence grants
an explicit snapshot of bundle/plugin entitlements to a customer/installation scope,
subject to validity dates and user allocation. A super administrator approves what
can be licensed; an installation administrator can enable only approved, licensed
plugins. A project owner can further narrow access. None of these steps silently
bypasses user consent or tool/resource permissions.

Initial Community catalog uses the same entitlement resolver as commercial editions.
Its exact included plugins, maximum users and term are configurable published plan
policy. During local development, a development issuer creates clearly marked
non-production licences from a separate development trust root. It must not ship a
production private key or accept unsigned licences under a generic 'free mode'.
A legitimate Free deployment can receive a vendor-signed free entitlement; licensing
checks do not imply payment or telemetry. No credit card or billing provider is added
until the commercial workflow is explicitly selected.

## Plans and packaging

| Object | Key data | Version behavior |
| --- | --- | --- |
| Plan | planId, version, displayName, billingMode, defaults | Existing grants retain their issued terms |
| Bundle | bundleId, version, explicit plugin IDs/capabilities | New bundle version does not auto-expand old licences |
| Plugin offer | pluginId, compatible version range, capabilities | Renewal/upgrade may add a new grant |
| Licence | licenceId, accountId, installation scope, issued/not-before/expiry, entitlements, seat policy | Immutable signed payload; amend by new serial/version |
| Seat assignment | licenceId, subjectId, grant IDs, assigned/released timestamps | Transactional unique allocation |
| Revocation | licenceId/keyId, effectiveAt, reason code | Versioned signed list with bounded cache lifetime |

Add-ons combine through an explicit resolver: union of valid positive grants within
their scopes, then intersection with issuer approval, administrator policy, IAM role,
project ACL, user tool consent and runtime capability. Explicit denial wins. Plugin
dependencies must also be entitled, or the product shows the dependency requirement.
Avoid surprise activation when a bundle changes. Upgrades preview the entitlement
diff; downgrades preserve documents and unknown/locked plugin nodes.

### Licence tiers requested by the owner — future requirement

On 2026-09-24 the owner announced licence tiers named Free/Demo, Pro, Teams, Studio and
Enterprise, which will differ in limits such as the number of users, the tools available
and the number of works. They are recorded here as a future requirement; no tier, limit
or price is decided or implemented. The current Keycloak licence of ADR-0041 carries only
an expiry, a state and permissions; tiers will need a plan field, limits enforced by the
API, and the badge after the logo will name the tier instead of Pro.

## Time and seats

Default proposed user metric: named active human subjects per installation, not
browser tabs or network connections. Multiple sessions/windows by one subject use
one seat. Service identities have a separately declared policy and cannot be used
to launder human seats. Licence can also express concurrent seats for a future offer,
but enforcement mode is immutable in an issued licence. Bundle caps and plugin caps
are independently enforceable: allocating a user into a bundle does not create extra
plugin seats. Reservations use one serializable transaction or row-lock protocol;
unique constraints prevent races. Reassignment cooldown is a policy parameter.

Expiry denies new licensed mutations and paid job starts, but preserves open documents,
local drafts and a defined read/export-recovery capability. The exact recovery export
formats are a published product policy, not a blanket promise of paid functionality.
Jobs recheck entitlement at dispatch and publication; expired results remain safe
candidates if policy permits retrieval, never auto-apply. Warn before expiry without
interrupting brush strokes; current stroke can be locally retained, not falsely saved.

## Administration and UX

Super-admin screens: offers/bundles, approved plugins, licence issuance/renewal/revoke,
seat usage, key lifecycle and audit. Require step-up authentication and separation
between routine tenant administration and signing authority. Emergency access is
short-lived and logged. Users see current edition, plugin availability, expiry and
seat status with a precise action (request access, assign seat, renew, activate).
Do not show misleading 'installed means licensed' states. No intrusive upsell overlays
in the canvas. Free mode remains a coherent editing experience with clear boundaries.

## Commercial readiness gates

Before selling: accepted licence terms/source licence; verified entitlements and seat
race tests; support/update policy; privacy/provider disclosures; backup/recovery drills;
format compatibility matrix; signed distributables; supply-chain review; accessibility;
licensing outage behavior; price/tax/payment integration only if selected. These are
product decisions to complete, not claims that the current bootstrap is market-ready.
