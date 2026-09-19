# TEST-STRATEGY-0001 — Verification portfolio

Coverage is execution evidence, not proof. Each FEAT links SC oracles defined before
implementation; human-curated fixtures and mathematical invariants supplement tests
written by the same agent. Harness code is tested, versioned and review-protected.

| Area | Test types and independent oracle |
| --- | --- |
| Layer tree and commands | Unit + property: no cycles, inverse/replay invariants, exact IDs |
| Layout tree | Reducer/property plus Playwright: ownership, focus and recovery |
| Compositor and masks | CPU scalar formulas, hand-calculated pixels, curated goldens with tolerances |
| Vector/3D geometry | Winding, area/volume, topology, transform inverse and degeneracy corpus |
| Brush engine | Fixed seed/input capture, tile seam and pressure interpolation fixtures |
| API/persistence | Real PostgreSQL + Redis + Keycloak; migration/ACL/outbox fault injection |
| Contracts | OpenAPI validation, generated-client compatibility, event schema and plugin ABI |
| Collaboration | Two browsers, latency/reorder/disconnect simulation, immutable revision oracle |
| Windows and desktop | Web popup denial/crash plus Electron on Windows/macOS/Linux |
| Security | Cross-project matrix, malicious SVG/archive/plugin, revoked tools and log redaction |
| Accessibility/i18n | Keyboard, screen reader, EN/ES parity, 200% zoom, contrast and RTL smoke |
| Performance | Fixed hardware and source hashes, p95 budgets and leak soak |

Every implemented package and service must have tests, even support/SDK modules.
Mocks implement ports and run shared contract suites; they cannot replace real IAM,
transaction or transport failure tests. FastAPI integration uses TestClient/httpx
with real authorization cases. Angular uses its verified current runner plus DOM
component tests; Electron/SPA workflows use Playwright. Property tests use fast-check
and Hypothesis if accepted in dependency review. Geometry/policy mutation tests target
wrong sign, dropped revision check, mask inversion and unauthorized event leakage.
Do not insist on a mutation percentage before benchmarking meaningful operators.

Fixtures carry seed, generator version, source classification, scenario ID, schema
version and review status. Golden outputs change only with justified behavior change
and human review. Export tests compare semantic vectors/layers as well as pixels;
a flat PNG cannot prove editability or native-file round trip.

Quality analysis must cover the same commit and all authored modules. Required
reports: LCOV for TS, coverage XML for Python, OpenCover for .NET, plus line/branch
metrics, test counts, scan status and report hashes. Zero executable branches is
reported as not applicable with verified count, never silently 100. CI reports
missing tests or reports as failures. See harness/quality-policy.json.
