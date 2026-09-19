# Delivery plan

Scope is a professional product programme, not a one-iteration editor. No calendar
promise is made before spikes and measured team capacity. Each iteration consists
of small reviewed vertical slices; dependency order inside an iteration is explicit.

| Iteration | Objective | Exit evidence |
| --- | --- | --- |
| ITER-0001 | Version/dependency spikes; quality harness; identity; English shell; plugins; docking/themes/locales | FEAT-0023 first, then 0001 -> 0002 -> 0003 -> 0004/0005/0020; real auth and layout tests |
| ITER-0002 | Save and reopen editable native document; layers and history | Atomic revision/outbox, mask/source round trip, locks/undo |
| ITER-0003 | Vector and text editing | Geometry/shaping fixtures, supported SVG subset |
| ITER-0004 | Tiled raster, brushes, selection masks and blending | Pixel oracles, seams/pressure, memory and latency results |
| ITER-0005 | Spatial views, modeling, materials and outlines | Kernel comparison, silhouette and transparency tests |
| ITER-0006 | Gallery/project textures, collaboration and multiwindow | Two-user conflict/reconnect and transfer-crash tests |
| ITER-0007 | Permissioned MCP/AI and animation | Consent/injection tests, deterministic frame export |
| ITER-0008 | Interchange/print hardening and operations | Preflight, restore drill, platform/performance matrix |

## First implementation slice

1. SPIKE-0001: Resolve latest stable Angular and compatible toolchain, pin all selected
   packages and images; create lockfiles and dependency/licence records. No previews
   unless explicitly approved. Verify Sonar edition, scanners and exact metrics.
2. SPIKE-0002: Build throwaway docking adapter prototype with tabs, drag/group, keyboard
   navigation and two-window transfer. Choose adapter by evidence.
3. SPIKE-0003: Compare Three.js WebGL2/WebGPU, outlines, 2D blending and candidate CSG
   kernels on a fixed synthetic fixture; record unsupported features and memory.
4. Establish module inventory, tests, CI and Sonar collector. Then scaffold Angular,
   FastAPI, persistence and realtime services behind authenticated contracts.
5. Implement one vertical use case: login -> create project/document -> create vector
   layer -> save revision -> reload. Only then expand the tool catalog.

## Per-iteration handoff

Update doc/planning/traceability.json with actual source/test paths and evidence;
record accepted ADRs, changed contracts/migrations, unresolved risks and the next
smallest task. Include an exact source SHA and commands, not a claimed percentage.
Do not move Planned to Verified just because scaffold files compile.

## Risk register

| Risk | Early resolution |
| --- | --- |
| Four application runtimes increase maintenance | Accept ADR-0002/0003 or explicitly change ORM/transport requirements |
| Professional blend/print fidelity differs from browser rendering | CPU/golden color oracles and codec subset reports |
| Browser windows and WebGPU vary by platform | Capability matrix and portable fallback actions |
| GPU memory and CSG numeric edge cases | Bounded fixtures, quotas and kernel comparison |
| Untrusted plugins and models access user data | Brokered capabilities and adversarial tests before ecosystem launch |
| Public forks cannot safely use local secret-bearing CI | Isolated runner/analysis design before required product checks |
| Solo authorship cannot supply independent approval | Name a second human reviewer before implementation integration |
| No licence or format-compatibility promise selected | Owner decision and dependency/codec/font audit before distribution |

## Branching and operations additions

Use feat/* and fix/* from dev, then qa/demo/release/main as defined in the GitFlow
profile. ITER-0001 includes the general contribution harness, container build pipeline,
local same-origin ingress, shell/PowerShell runbooks and Sonar collector. Production
deployment remains unconfigured until the owner supplies the target.

## Commercial and UX foundations

FEAT-0025 and FEAT-0027 join ITER-0001; FEAT-0026 follows in ITER-0002. The first
vertical slice includes Community entitlement resolution so paid capabilities do not
require a later authorization rewrite. No commercial cap, price or term is assumed.
