---
id: "DOC-ARCHITECTURE-0002"
title: "Events, concurrency and collaboration"
status: "proposed"
domain: "architecture"
owners: ["Yoshikemolo"]
applies_to: ["ximply-design-studio"]
related: []
source: ["Project owner requirements and design foundation; methodology application recorded in AUDIT-0001"]
---

# Events, concurrency and collaboration

## Three different channels

| Channel | Guarantee | Use |
| --- | --- | --- |
| Local typed event bus + signals | In-process delivery only | UI commands, effects, derived view state |
| Redis Pub/Sub + SignalR presence | Ephemeral, gaps accepted | Cursor, camera, connection awareness |
| PostgreSQL outbox + Redis Streams | Recoverable at-least-once | Committed document events, jobs |

Signals retain current state and can coalesce updates. They are not a queue of every
command. `EventHub` is a typed observable/async stream with bounded buffers; reducers
update readonly signals; Angular `effect` bridges controlled side effects and
registers cleanup. No effect loops in which receiving a remote event republishes
it as a new local command. Envelopes carry source and causation IDs. Binary brush
patches use the asset path; messages carry hashes, not huge base64 payloads.

## Authoritative commit protocol

1. UI validates locally, allocates commandId/idempotency key, records base revision,
   previews the operation and submits to FastAPI with bearer token.
2. API verifies identity, project rights and command schema. Persistence rechecks
   current membership and scope and starts one transaction with document row lock.
3. Unique (projectId, commandId) detects replay. A different payload for the same
   commandId returns conflict. Check expectedRevision and semantic preconditions.
4. Validate operation; append immutable revision and command record; update head;
   append outbox record in the same transaction. Commit before acknowledging.
5. Outbox relay publishes committed event to Redis Streams. It marks publication
   after publish; crash between these actions may duplicate. Consumers deduplicate.
6. Gateway emits `DocumentCommitted` with sequence/revision. Clients reconcile
   preview, drop duplicates and fetch gaps from the durable event/revision API.

No exactly-once claim. Order is per document, not global. Redis stream trimming
cannot invalidate recovery: durable PostgreSQL events/checkpoints remain authoritative.
Slow clients receive a resync instruction instead of an unbounded queue. A reconnect
presents last sequence, receives deltas or a snapshot watermark then subsequent events.
Snapshot subscription handover must buffer events after that watermark to avoid a gap.

## Concurrent edits

Initial implementation is online-authoritative optimistic concurrency. Commands
specify expected document revision. Nonoverlapping edits may be retried after loading
a newer revision and revalidating target-specific preconditions; this is an explicit
retry, never silently applying a stale transform. Overlapping edits return 409 with
current revision and a retained local draft. Short object leases improve UX for
brush/geometry work but are advisory; revision checks are the correctness mechanism.

A follow-on CRDT for text and order may be adopted only with an ADR and migration.
It cannot solve raster overwrite, topology validity, access revocation or global
constraints by itself. Offline work is a private draft/fork until reconciled, not
promised seamless merging. User undo is a conditional inverse command referencing
the original command. If later edits invalidate the inverse, offer selective undo
or a fork, preserving collaborators' changes. Redo similarly checks preconditions.

## Presence and following

One stable userId with separate sessionId/windowId/viewId prevents duplicate avatars
from multiple windows. Active session determines displayed pointer; expand avatar to
inspect sessions. Suggested presence emission 20 Hz, interpolation locally, 10-second
heartbeat and 30-second expiry; tune by load tests. Cursor payload includes world/
document position, view projection, tool and monotonic sequence. Server stamps actor
and rejects spoofed identity/color claims; color allocation is session-stable with
patterns/initials for accessibility. No persistence of raw pointer history by default.

Follow state lives locally, references an authorized actor/view and blocks cyclic
follow chains. Manual navigation exits follow. Member revocation triggers group
removal, token/session invalidation where appropriate and client purge of inaccessible
state. A token that remains valid cannot override changed project membership.

## Jobs

Job states: queued -> leased -> running -> succeeded / failed / cancelRequested ->
cancelled. Leases expire and are renewed; workers acknowledge only after durable
completion. Attempt number, input hash and output manifest make retries idempotent.
Unrecoverable failures go to a dead-letter queue with safe diagnostics. Timeouts,
quotas and cancellation are checked between chunks/frames. A GPU job cancelled
mid-kernel may finish the kernel but its result is not automatically published.
Out-of-date results become candidates tied to their input revision, never overwrite
newer edits. Retry limits and retention are configured and versioned, not hard-coded
without operational evidence.
