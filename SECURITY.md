# Security

Status: design-stage project; no supported production release exists.

Do not put exploitable details, secrets, private documents or access tokens in public
issues. Use GitHub private vulnerability reporting if enabled; otherwise contact the
repository owner privately through an established channel. No unverified contact
address is invented here. Response SLAs will be defined before the first release.

The threat model and testable controls live under docs/security and docs/SEC.
Keycloak is identity; project membership and tool/resource policy are server-enforced.
Plugin code, SVG, archives, shaders, model output and MCP tool arguments are untrusted.
Public source does not authorize access to user assets or internal services.
