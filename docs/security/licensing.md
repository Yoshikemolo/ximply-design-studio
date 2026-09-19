# Signed licence and entitlement security

Status: Proposed. Related: ADR-0019, ADR-0020, SEC-0011, FEAT-0025, FEAT-0026.

## Public hash versus signature

A SHA-256 digest identifies exact licence bytes and detects accidental modification
when compared against a trusted value. It does not prove issuer authority: an attacker
can modify a payload and recompute its hash. The licence therefore uses a standard
asymmetric signature envelope (JWS with an explicitly allowed, library-supported
Ed25519/EdDSA profile subject to current algorithm review). Verifiers hold only the
public key; the issuer's private key stays in a KMS/HSM or equivalent protected signing
service. No private signing key appears in browser bundles, desktop binaries, images,
source control, test fixtures or environment files distributed with the application.

Expose licence ID and public fingerprint in settings for verification/support. Do not
publish a customer entitlement payload or identity list publicly. A hash is neither
password nor bearer authority. Do not reuse Keycloak access tokens as long-lived licences.
Identity, authorization, licence eligibility and plugin package integrity are four
separate checks. A signed licence does not authenticate plugin code.

## Envelope and claims

Protected header: allowed algorithm, trusted key ID and type `xds-license+jwt` (versioned
profile). Payload: schemaVersion, issuer, audience `ximply-design-studio`, licence ID,
serial/version, opaque customer/installation IDs, plan snapshot/version, bundle snapshots,
plugin grants/capabilities, max users, seat model, issued-at, not-before, expiry,
offline allowance, revocation policy version and optional minimum application version.
Optional terms are explicit, never interpreted as 'unlimited' merely because absent.
Validation rejects unknown critical fields, unsupported schema/algorithms, `none`,
algorithm/key-type confusion, duplicate JSON keys, excessive size, malformed dates,
wrong issuer/audience/scope and untrusted key IDs. Do not follow attacker-provided
jku/x5u URLs. Trusted public keys are shipped or updated through an authenticated,
versioned trust channel. Verify the signed bytes with a maintained library, not
custom serialization or hand-written cryptography.

## Issuance and enforcement

1. Authorized vendor super administrator approves the plugin/bundle offer and its terms.
2. Signing service validates approval, limits and account scope, records issuance and
   signs an immutable entitlement snapshot; private-key use is separately audited.
3. Installation admin imports/activates the signed licence. Server validates signature,
   time, scope and revocation, then stores encrypted-at-rest metadata and digest.
4. EntitlementResolver computes effective access; SeatAllocator atomically assigns a
   named subject to the necessary bundle/plugin seat. The API and workers recheck at
   commit/job execution. MCP uses the same resolver. UI receives a readonly capability
   projection and cannot mint licence authority.
5. Renewal issues a new version; monotonic serial/revocation state prevents downgrade
   to an older grant. A plugin may be installed but disabled due to entitlement.

Separate vendor licensing administration from customer installation super-admin.
A customer administrator may approve activation inside purchased/free entitlements,
but cannot sign or widen them. In local development a separate test issuer can approve
synthetic plans; its trust root must be rejected by production configuration. A
single root access token must not control IAM, code deployment and signing keys.

## Offline and on-premise limits

Online authority provides current revocation and seat allocation. Offline licences
have an explicit bounded grace lease, persisted last trusted server time/serial and
rollback detection where possible. Distributed offline machines cannot guarantee a
global concurrent-seat cap without preallocated signed sub-leases. Clock rollback,
VM snapshots and a hostile machine administrator cannot be fully prevented by pure
software in an entirely offline open-source deployment. Do not promise unbreakable
DRM. Public source can be modified; enforce paid hosted capabilities server-side and
use signed entitlements plus contractual terms for authorized on-premise distribution.

If licensing service is unavailable, a previously verified licence may remain usable
only within its signed offline/grace policy; no silent unlimited fallback. First-time
activation fails closed for restricted features. Read/recovery paths remain available
according to published product policy, so outages do not destroy work. Grace duration
and seat limits remain explicit owner decisions; do not invent commercial numbers.

## Rotation, revocation and audit

Use kid and overlapping trusted verification keys for planned rotation. Signed revocation
updates have issuedAt/nextUpdate/sequence and cannot roll back. Emergency key compromise
revokes the key and affected serials, with recovery/renewal guidance. Store issuance,
approval, activation, allocation, rejection and revocation audit records without raw
customer documents. Monitor invalid-signature spikes, seat races, clock regressions
and stale revocation caches. Independent tests use published cryptographic vectors
and a separate verified library; test signing keys are ephemeral, clearly synthetic
and never included in a production trust store.
