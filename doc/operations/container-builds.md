---
id: "DOC-OPERATIONS-0002"
title: "Container build and CI/CD implementation contract"
status: "proposed"
domain: "operations"
owners: ["Yoshikemolo"]
applies_to: ["ximply-design-studio"]
related: []
source: ["Project owner requirements and design foundation; methodology application recorded in AUDIT-0001"]
---

# Container build and CI/CD implementation contract

| Image | Build stages | Runtime contract |
| --- | --- | --- |
| web | Pinned Node install/test/AOT -> static non-root server | Port 8080, SPA fallback, immutable assets |
| api | Locked Python dependencies/wheels -> slim non-root runtime | FastAPI port 8000, bounded workers, ready/live |
| persistence | Pinned Node lockfile -> compiled TypeScript | Port 3000, TypeORM migrations, no synchronize |
| realtime | Locked .NET restore/build/test -> ASP.NET runtime | Port 8080, hub authentication, readiness |
| worker | Locked native/Python dependencies -> CPU or GPU variant | Stream leases, bounded compute, no public ports |
| desktop | Per-OS Electron build/sign/package | Distribution artifacts, not a Linux container pretending to be all desktop OSs |

Every image carries source revision, SBOM and project/environment labels needed for
safe ownership-based cleanup. Use multistage Dockerfiles, non-root user, read-only root
where supported, writable temp/cache mounts, dropped capabilities and no Docker socket.
The actual Dockerfiles are created with each implemented service; this bootstrap does
not fabricate successful builds for missing code. Build/test/image publication is
therefore explicitly pending and remains a gate before deployment.

CI stages: validate contribution + docs -> install locked dependencies -> lint/type/
build -> unit/component -> real integration/contract -> security/SBOM -> Sonar and
strict per-module verifier -> image build/scan/sign -> immutable candidate manifest.
Run performance/device suites on approved hardware before declaring those capabilities.
Promotion verifies source SHA and all digests, deploys qa, then demo/release and eventually
main/production with approvals. Deployment workflow in this package is manual and
fail-closed until destination variables, verified images and required checks exist.
