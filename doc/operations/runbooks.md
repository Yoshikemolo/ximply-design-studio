# Container runbooks

`studio.sh` and `studio.ps1` call the same reviewed Python controller so platform
behavior is consistent. It uses argument arrays, never shell interpolation. Operations:
install, status, logs, stop, reset-db, nuke and deploy-swarm. Every command has --dry-run.
Environments map to fixed project names xds-dev, xds-qa, xds-demo and xds-prod; arbitrary
project/volume names are not accepted. Confirm exact project for destructive actions.

## Install and localhost

Dev/qa/demo installation starts the dependency Compose stack using its environment
override. Application services are added only with `--application` and require all
built/pinned images from infra/application.compose.yaml. Prod always uses the full
application contract. No runtime fallback to mock application is allowed.

The edge proxy serves static SPA resources and routes /api and /hub to internal
services. Browser clients use relative paths; FastAPI accepts only the configured
origin when a separate dev server is explicitly selected. Keycloak public origin
and issuer must remain consistent between browser and service JWT verification.
HTTP loopback is development-only. Production TLS terminates at the declared ingress;
configure allowed origins, forwarded-header trust and host names explicitly.

## Reset database

Stop the application services when enabled, stop/remove the application PostgreSQL
container, verify the exact volume's Compose project label, remove only that volume,
then recreate PostgreSQL. The controller requires local Docker context and refuses
remote reset. IAM and analysis databases remain untouched. Reapply migrations and
synthetic seed using the implemented persistence task before restarting writers.
No truncate-all SQL is injected into an arbitrary connection string.

## NUKE

Requires --confirm xds-<environment> and a local Docker endpoint. Record a backup first.
Enumerate volumes and built images by exact project labels before stopping. Execute
Compose down --remove-orphans for that project. Remove enumerated labelled volumes,
then remove only images labelled com.ximply.project=<project>. Failure stops execution;
there is no --force image removal or global prune. Shared postgres/redis/keycloak images
are deliberately not removed because they may serve other projects. The requested
image cleanup applies to project-owned build images. Read the dry-run list first.

Swarm teardown is a separate operator runbook: list stack services and associated
labelled resources; drain/stop writers, back up state, remove only the named stack,
wait for its tasks to disappear, then clean explicitly identified local volumes on
each relevant node and project-owned images. The controller refuses Compose NUKE
against a Swarm-labelled stack; it does not pretend local volume deletion clears all
Swarm nodes. Do not use this procedure on production until target-specific storage,
backup and retention decisions are approved.

## Deployment and rollback

Build each service once per source candidate, scan it and record image digest/SBOM.
Deploy the same digests across qa/demo/release with environment configuration. Deploy
Swarm using the versioned stack template and explicit manager context. Use external
secrets, pinned images, placement constraints and backups. Database migrations are a
separate reviewed job before compatible services roll; Docker depends_on does not
sequence Swarm readiness. Services must retry dependencies and expose real readiness.

Rollback points to previously verified image digests only when schema compatibility
allows. Do not automatically down-migrate a destructive schema. No server, domain,
registry credential, runner or production secret has been invented. GitHub workflow
environments remain unconfigured until the owner supplies deployment destinations.
