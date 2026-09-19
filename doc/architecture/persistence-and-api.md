---
id: "DOC-ARCHITECTURE-0003"
title: "Persistence and REST API"
status: "proposed"
domain: "architecture"
owners: ["Yoshikemolo"]
applies_to: ["ximply-design-studio"]
related: []
source: ["Project owner requirements and design foundation; methodology application recorded in AUDIT-0001"]
---

# Persistence and REST API

## Logical schema

| Table | Key relationships and invariants |
| --- | --- |
| projects | UUID, owner subject, name, policy version, created/updated timestamps |
| project_members | unique(project_id, subject), role; FK project |
| documents | project_id, title, head_revision, schema_version; FK project |
| document_revisions | unique(document_id, revision); snapshot hash, actor, command_id |
| document_commands | unique(project_id, command_id); payload hash, base/result revision |
| assets | project_id, content hash, media type, byte size, scan state; scoped dedup |
| document_asset_refs | document revision -> asset; validated project authorization |
| project_links | source/target document+revision; cycle-checked dependencies |
| workspace_layouts | subject, layout ID, schema_version, JSONB, revision |
| plugin_installations | scope, plugin ID, version, integrity, lifecycle state |
| tool_grants | subject/project/plugin/tool, policy, expiry, operation scope |
| jobs | owner/project/input revision, state, lease, attempt, output hash |
| outbox | event ID, aggregate ID, sequence, payload, published timestamp |
| audit_events | actor, action, resource, decision, timestamp, safe metadata |

Normalize identity, ownership and constraints; JSONB holds versioned snapshots and
plugin payloads. Do not create a relational row per raster pixel. Index project
membership, document head, event replay sequence and job state/lease. Partition very
large histories only after measured need. Soft delete preserves references; a separate
purge workflow respects retention and backups. Restore creates a new revision, never
rewrites accepted history. Retention periods are policy settings to decide, not invented
promises. Content dedup is project-scoped to avoid hash-based existence leakage.

TypeORM Data Mapper repositories plus transaction-bound UnitOfWork. `synchronize`
is always false. Checked-in migrations are the only schema evolution path. Repository
interfaces expose domain operations, not arbitrary query builders to controllers.
Authorization is also enforced by PostgreSQL RLS or equivalent scoped queries verified
against real PostgreSQL tests; RLS context is set transaction-locally with pooled
connections and cannot leak to the next request. Dedicated owner-only migration role;
application role cannot bypass RLS. Constraints catch duplicate commands and invalid
references. Parameterized queries only. Migration test performs upgrade from previous
schema, data verification and supported rollback or forward repair.

## Public resources

OpenAPI 3.1 proposed contract is in `contracts/openapi.json`. It is a design contract;
FastAPI must generate and compare the same contract once implemented. All business
routes require bearer JWT, including export, asset retrieval, history and hub negotiate.
Liveness is intentionally anonymous and reveals no environment details.

| Method / path | Behavior |
| --- | --- |
| GET /api/v1/session | Authenticated user and effective capabilities |
| GET/POST /api/v1/projects | Cursor-paged list / create |
| GET /api/v1/projects/{projectId} | Project visible to actor |
| GET/POST /api/v1/projects/{projectId}/documents | List / create |
| GET /api/v1/projects/{projectId}/documents/{documentId} | Versioned document head and ETag |
| POST .../commands | Typed command with expected revision, idempotency key |
| GET .../events?afterSequence= | Durable replay, or resync-required snapshot |
| POST .../checkpoints | Name immutable revision; never changes content |
| POST .../exports | Enqueue immutable-input export job |
| POST /api/v1/projects/{projectId}/uploads | Create bounded staged upload |
| POST /api/v1/projects/{projectId}/uploads/{uploadId}/complete | Verify/hash/register |
| GET /api/v1/projects/{projectId}/assets | Authorized paged gallery |
| GET /api/v1/projects/{projectId}/members | Membership visible to policy |
| PUT/DELETE .../members/{subjectId} | Owner-managed role / revoke |
| GET/PUT /api/v1/me/layouts/{layoutId} | Versioned personal layout |
| GET /api/v1/plugins | Approved plugin catalog/capabilities |
| PUT /api/v1/projects/{projectId}/tool-grants/{grantId} | Explicit scoped permission update |
| GET /api/v1/jobs/{jobId} | Owner/project-scoped job state |
| POST /api/v1/jobs/{jobId}/cancellation | Idempotent cancellation request |

Use 201 with Location for created resources; 202 for asynchronous jobs; 409 for
revision or idempotency conflict; 413 for excessive input; 422 for schema/semantic
validation; 429 with Retry-After for quota. Unauthenticated -> 401; known denied
operation -> 403; resources outside actor visibility -> 404 to limit enumeration.
Problem responses include type/title/status/code/traceId and safe field errors, never
stack traces. Cursor tokens are opaque and bounded, page maximum 100 by default.
API version and document schema version evolve independently. Deprecation is explicit.

Internal persistence routes are typed use-case endpoints, not a generic database proxy.
A command request contains actor assertion, project ID, expected revision, idempotency
key and command body. Apply in a single transaction; no distributed transaction across
FastAPI, Redis and PostgreSQL. Outbox dispatch is a recovery boundary. External storage
writes use staged blobs and reconciliation, not pretending a DB rollback removes blobs.

## Licensing persistence additions

Add versioned plan/bundle/plugin offers, immutable issued licence records, trusted-key
metadata, revocation serials, installation activations and seat assignments. The vendor
signing key is never in PostgreSQL plaintext. Unique licence/subject/grant constraints
and a transaction on the seat pool prevent final-seat races. Store opaque subjects,
not personal licence payloads in public logs. See security/licensing.md.
