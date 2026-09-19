# Plugin architecture and MCP

## Extension contract

Host primitives: identity/policy, command registry, documents/history, workspace
manager, resource registry, localization, themes, transport, notifications and
accessibility. Drawing, raster editing, effects, modeling and specialized panels
are first-party plugins using the same SDK as third parties where safe.

A manifest contains stable reverse-domain ID, SemVer version, host API range,
entry points, integrity hash, dependency ranges, localized name, icons, command/menu/
panel/tool declarations, codec/operator schemas, permissions and migrations.
Activation is lazy (command invocation, panel open or supported document type).
Lifecycle: discovered -> validated -> installed -> enabled -> activating -> active ->
suspended/error -> deactivated. Disabling disposes listeners, GPU objects and workers;
retains document payload and placeholder panels. Updating validates migration in a
copy and rolls back on failure. A crash quarantines that plugin, not the entire shell.

`CommandRegistry`, `ToolRegistry`, `PanelRegistry`, `OperatorRegistry`, `CodecRegistry`,
`ThemeRegistry` and `McpToolRegistry` accept namespaced contributions. Menu slots are
stable IDs, not translated labels. A plugin can contribute under multiple main menus
and under Plugins/{plugin}. Menus dispatch exactly the same handler as MCP and shortcuts.
A command declares parameter schema, authorization, undo strategy, preconditions,
side effects, maximum cost and progress/cancellation contract.

## Isolation

First-party reviewed code may run in the Angular process. Untrusted UI runs in a
sandboxed separate-origin iframe with restrictive CSP, no ambient token and validated
MessageChannel RPC. `allow-scripts` plus `allow-same-origin` is not a safe sandbox
for content sharing the host origin. Web Workers isolate work from rendering but
are not a security sandbox for arbitrary code. Capability RPC brokers limited
resources. Do not give plugins document store references, window globals, arbitrary
fetch, filesystem, SQL, Redis or generic shell execution. Server/native extensions
require separate reviewed containers/processes and explicit administrator enablement.

Theme plugins declare schema-validated tokens and approved assets, not arbitrary CSS
or network URLs. Font and SVG assets are sanitized and referenced as files. Shader
nodes are a typed bounded language; arbitrary WGSL/GLSL is not a normal third-party
permission. Resource quotas include memory, tile count, CPU duration, GPU dispatch
size, network domains and disk bytes. An infinite GPU kernel may still threaten the
device context; isolate developer shaders and recover from device loss.

## Permissions and settings

Permissions are intersection(user rights, project policy, plugin grants, tool grant,
resource rights, runtime capability). Defaults deny unknown permissions. UI states
are deny, ask per invocation, allow within explicit scope/expiry. Changing tool
arguments invalidates prior approval if the approved operation digest differs.
Grant updates are atomic and audited. Disabled tools disappear from advertised MCP
tool lists and server enforcement rejects cached calls. Installation does not mean
permission to send assets externally. Provider, destination, resource scope and
estimated cost appear in the approval preview for external AI calls.

Settings show publisher, version, integrity, compatibility, requested/granted scopes,
menus, panels, storage use and failures. Users can enable/disable, update, pin a
version, reset settings, export configuration and revoke a tool. Administrator
policy can narrow but never invisibly widen a user's grants.

## MCP bridge

Implement an authenticated MCP server with the official SDK and a pinned protocol
version verified in the dependency spike. Protocol tools call application use cases;
resources expose authorized read models; progress/subscriptions use supported MCP
mechanisms. MCP is not a subscriber to browser memory across processes: the client
EventHub and server event adapter exchange versioned events through authorized
transports. Adapter filtering prevents internal secrets or unrelated project events
from entering AI context. Not every UI event becomes an MCP event.

Initial tools: get_document_summary, list_layers, get_selection, propose_commands,
apply_approved_commands, render_preview, start_export, cancel_job. No generic SQL,
shell, arbitrary URL fetch or grant-editing tools. Apply requires the same revision
and policy checks as direct edits. Proposals contain command IDs and bounded JSON
arguments, never executable code. User consent is bound to the proposed batch hash.
Batch failure is atomic where transaction-local, otherwise returns explicit partial
job state with compensating operations; it cannot claim atomic external effects.

AI event states: requested, contextPrepared, running, proposalReady, approvalRequired,
applied, rejected, cancelled, failed. A model cannot publish `approved` authoritatively.
Images, text and project metadata are untrusted input, including apparent instructions
inside them. Log actor, tool, resource scope, operation digest, policy decision,
provider and outcome; redact sensitive arguments. Default prompt retention is off;
retention changes require project policy. Tool access revoked during a job prevents
result publication and cancels further work where possible.
