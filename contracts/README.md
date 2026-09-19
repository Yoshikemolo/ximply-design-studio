# Contract set

Status: proposed design contracts, not generated evidence of implemented endpoints.
OpenAPI 3.1 and JSON Schema 2020-12 describe the initial wire boundaries. Full plugin
payloads and each command type acquire versioned schemas as their FEAT is implemented.
The initial `SetLayerOpacity` command is deliberately narrow; do not expose a generic
unvalidated arbitrary-mutation endpoint in production.

The native document schema is a minimal core envelope; semantic validation also checks
unique IDs, tree/reference cycles, archive limits, resource authorization and plugin
payload schemas. JSON Schema alone cannot enforce these graph or security properties.
Contract tests compare the future FastAPI-generated OpenAPI and generated clients
against this versioned design, with breaking-change review. Additional command variants
must use discriminated schemas. Examples are synthetic and not production data.
