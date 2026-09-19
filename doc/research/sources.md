# Research register — 2026-09-19

Primary product documentation and upstream projects were inspected. The following
brief observations support the design; the proposed architecture, limits, budgets,
feature decomposition and acceptance rules are this project's engineering choices.
No benchmark, dependency installation or Adobe compatibility test was performed.

| Source | Observation used | Design consequence |
| --- | --- | --- |
| [Illustrator workspace](https://helpx.adobe.com/illustrator/desktop/get-started/learn-the-basics/workspace-overview.html) | Tool panels, document area and workspace customization organize authoring | Serializable docking and personal presets |
| [Photoshop layer masks](https://helpx.adobe.com/photoshop/desktop/create-masks/layer-masks/add-layer-masks.html) | Masks control visibility without replacing source pixels | Continuous editable mask resources |
| [Photoshop Smart Objects](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/smart-objects/create-embedded-smart-objects.html) | Source content can be preserved in an embedded object | Pinned linked/embedded project resources |
| [Angular releases](https://angular.dev/reference/releases) | Angular 22 is active; 22.2 is scheduled around September, which alone does not prove release | Select latest stable patch from verified registry metadata in SPIKE-0001 |
| [Angular compatibility](https://angular.dev/reference/versions) | 22.0.x lists Node ^22.22.3 / ^24.15.0 / ^26.0.0 and TS >=6.0 <6.1 | Validate exact minor/patch compatibility; Node 24 supported baseline candidate |
| [TypeORM](https://typeorm.io/) | TypeScript/JavaScript ORM ecosystem | Private Node persistence service when TypeORM is retained |
| [FastAPI concurrency](https://fastapi.tiangolo.com/async/) | Async I/O and parallel CPU work solve different problems | Bounded I/O on API; compute in workers |
| [SignalR overview](https://learn.microsoft.com/en-us/aspnet/core/signalr/introduction?view=aspnetcore-10.0) | ASP.NET Core hubs support real-time client delivery | Small .NET gateway, not a Python hub claim |
| [Redis Pub/Sub](https://redis.io/doc/latest/develop/pubsub/) | Pub/Sub has at-most-once delivery | Presence only; durable outbox/replay for edits |
| [Three.js WebGPURenderer](https://threejs.org/doc/pages/WebGPURenderer.html) | Dedicated renderer with backend behavior to inspect | Separate backend compatibility spike |
| [Three.js OutlinePass](https://threejs.org/doc/pages/OutlinePass.html) | Postprocessing selected-object outlines is available | WebGL adapter; no automatic WebGPU parity assumption |
| [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) | CSG on mesh BVH, with documented constraints | Preview candidate; test topology and failure behavior |
| [Manifold](https://github.com/elalish/manifold) | Geometry library targets topological robustness | Compare as validated boolean kernel |
| [Golden Layout](https://github.com/golden-layout/golden-layout) | Multi-window layout manager | Evaluate behind an adapter, not assumed Angular compatibility |
| [Electron security](https://www.electronjs.org/doc/latest/tutorial/security) | Isolation and narrow privileged access matter | Sandboxed renderer and validated IPC |
| [Keycloak JS adapter](https://www.keycloak.org/securing-apps/javascript-adapter) | Public clients and in-memory bearer tokens | Code + PKCE; no client secret or persistent browser tokens |
| [MCP authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) | Authorization is a protocol boundary | Pin SDK/protocol and enforce resource-scoped delegated access |
| [BroadcastChannel](https://developer.mozilla.org/en-US/doc/Web/API/Broadcast_Channel_API) | Same-origin browsing contexts exchange messages | Window coordination capability, not cross-origin token transport |
| [SonarQube gates](https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/managing-quality-gates/introduction-to-quality-gates) | Quality gates evaluate analysis conditions | Strict project policy plus explicit metrics checks |
| [GitHub CLI create](https://cli.github.com/manual/gh_repo_create) | CLI can create a repository from local source | Optional local publication workflow |

## Research limits

Initial search results were noisy; primary URLs were opened directly. The user's
secondary menu references were not relied on for technical implementation. Current
Angular release-family evidence does not establish the newest package patch. The
site footer observed 22.1.7, but a site build version is not a package-registry oracle.
Do not write `latest` into reproducible manifests. SPIKE-0001 resolves exact versions,
peer dependencies, security advisories, licences, install scripts and lockfiles.
No unreviewed package is accepted merely because it appears in this register.

## Brand and licensing additions

[Ximplicity](https://ximplicity.es/) was inspected for messaging, navigation, language
and theme behavior. Studio visual tokens are proposals, not extracted brand standards.
[JWS](https://www.rfc-editor.org/info/rfc7515/) and
[JOSE elliptic-curve signatures](https://www.rfc-editor.org/info/rfc8037/) provide the
standards basis for asymmetric licence signatures; implementation must verify the
current algorithm registry/profile and vetted library support before use. A public
hash alone supplies no issuer authentication.
