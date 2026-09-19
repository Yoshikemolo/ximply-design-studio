# Troubleshooting

This filename retains the spelling requested for the README link.

| Symptom | Check and recovery |
| --- | --- |
| No editor at localhost | This package is design-stage; application modules/images are not implemented yet. Infrastructure startup is not editor startup. |
| Compose says a variable is required | Fill every value in infra/.env, including optional quality-profile variables; interpolation happens before profile selection. |
| Python command not found on Windows | Install Python 3.11+; the PowerShell wrapper tries python then py -3. |
| PostgreSQL will not start after image change | Verify selected major/data-directory compatibility and migration path; never delete a volume to hide an upgrade failure. |
| Keycloak redirects incorrectly | Configure exact browser-visible origin and callback path; use a public client and PKCE; distinguish container DNS from browser URLs. |
| CORS failure in future local app | Use the shared localhost edge origin and /api and /hub proxy paths; do not call container hostnames from browser. Never enable wildcard origins with credentials. |
| SignalR connects but no updates | Verify JWT audience, project group authorization, hub route, outbox relay and proxy WebSocket upgrade. |
| Sonar cannot be reached from GitHub | Hosted runners cannot reach your laptop localhost; use the documented secured analysis topology. |
| Sonar reports missing coverage | Generate reports for the same analyzed commit/module and correct paths; missing reports are failures. |
| GPU unavailable | Use capability diagnostics and CPU/WebGL fallback; browser GPU differs from server CUDA/Metal. |
| Popup blocked | Open a companion window through a user click; source panel remains until transfer acknowledgment. |
| NUKE refuses | Use exact project confirmation and local context; it deliberately refuses unknown scope or Swarm-managed deletion. |
| Port already used | Identify the process/project; change the environment override, not a global kill/prune. |

Capture command, environment, source revision and redacted logs. Never post tokens,
.env files or private document contents in public issues. Use `status`, `logs` and
`--dry-run` before mutation. See docs/operations/runbooks.md for operation scope.
