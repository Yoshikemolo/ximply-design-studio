---
id: "DOC-SECURITY-0002"
title: "Threat model"
status: "proposed"
domain: "security"
owners: ["Yoshikemolo"]
applies_to: ["ximply-design-studio"]
related: []
source: ["Project owner requirements and design foundation; methodology application recorded in AUDIT-0001"]
---

# Threat model

Status: Proposed. Assets: editable work, licensed resources, identity/session data,
GPU/CPU capacity, private project links and integrity of revisions. Adversaries include
unauthorized users, malicious project members, plugin publishers, crafted imports,
injected model output and compromised dependencies. Trust boundaries: browser/host,
plugin/host, API/internal services, IAM/application, object store, AI provider and CI.

| Threat | Control | Independent evidence required |
| --- | --- | --- |
| Project IDOR / forged actor | SEC-0001 | Cross-project matrix with real tokens and PostgreSQL |
| Expired/revoked membership | SEC-0002 | Live removal during subscription/job/commit |
| Plugin exfiltration and privilege escalation | SEC-0003 | Malicious iframe and capability RPC tests |
| MCP confused deputy / injection | SEC-0004 | Asset text demanding grants has no authority |
| Archive bomb / path traversal / SVG XSS | SEC-0005 | Hostile fixture corpus and limits |
| Duplicate/out-of-order edit corruption | SEC-0006 | Replay and crash-injection against real outbox |
| GPU/CPU exhaustion | SEC-0007 | Quota, OOM, timeout and cancellation tests |
| CI secret exposure / dependency substitution | SEC-0008 | Untrusted fork workflow inspection and SBOM |
| Cross-window token leak / forged IPC | SEC-0009 | Origin/sender/epoch validation |
| Sensitive logs and cached revoked assets | SEC-0010 | Redaction and cache authorization tests |
| Unconsented egress to an external model, key leak, out-of-scope model edits | SEC-0012 | Payload equality at the adapter, injected and out-of-scope operation tests |
| Git option injection, path traversal, hostile hooks, credential leak | SEC-0013 | Adversarial fixture repositories and credential absence checks |
| Forged or stale tokens, licence tampering, admin escalation | SEC-0014 | Signed test tokens, non-admin calls, secret absence checks |

Access tokens validate signature, algorithm allowlist, issuer, audience, expiry and
not-before with bounded clock skew. Cache JWKS with controlled refresh; unknown keys
fail closed after a bounded refresh attempt. Validate WebSocket origin separately
from CORS. Hub groups require resource authorization, not just login. Query-string
tokens when transport requires them are accepted only at exact hub routes, over TLS,
and redacted at gateway/proxy/telemetry. Keep their lifetime short.

Internal services use separate audiences and authenticated caller identity. No
arbitrary user headers. ACL/membership checks at commit prevent a stale token from
writing after revocation. Per-user/project quotas cover uploads, jobs, canvas size,
plugin memory, AI cost and presence rates. Resource dimensions and decompressed
size are validated before allocation. Parsers operate in restricted workers.

Recovery: revoke plugin/provider/tool grants, quarantine malicious assets, cancel
jobs, restore a checkpoint as a new revision and replay authoritative events. Audit
who acted and why without retaining sensitive content. Residual risks include GPU
driver defects, licensed font/codec compatibility and an authorized user copying
already disclosed content. These are reviewed before release, not asserted solved.
