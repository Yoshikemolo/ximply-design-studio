# Local development

## Bootstrap that runs now

Python 3.11+ runs the governance harness without third-party dependencies. Clone the
review branch to begin:

```bash
git clone --branch feat/initial-design https://github.com/Yoshikemolo/ximply-design-studio.git
cd ximply-design-studio
python3 harness/check_docs.py
python3 -m unittest discover -s tests -v
```

There is no `npm start` or production FastAPI server yet. Product services and their
build/test pipelines are the first implementation iteration, not hidden completed work.
The architecture package is useful locally as the versioned source of design truth.

## Toolchain resolution — SPIKE-0001

Select the latest stable Angular 22 release available from official metadata at the
implementation date, then check its documented Node/TypeScript/RxJS ranges. Research
verified the Angular 22 family, not the newest patch. Use a compatible supported Node
24 release, Python version supported by selected FastAPI/native/GPU libraries, .NET
10 for SignalR and a current compatible Electron. Pin exact versions and hashes in
package-lock/uv.lock/packages.lock.json as appropriate. Run reproducible installs,
licence/advisory checks and compile a minimal cross-service fixture before accepting.
Do not use floating `latest` tags in release builds.

Proposed commands after manifests are generated and reviewed: `npm ci` for TS packages,
locked Python environment sync for services, locked NuGet restore for realtime,
Angular production AOT build, Python strict typing/lint/test, and .NET analyzers/test.
Each module README must replace these plans with its exact working commands.

## Infrastructure template

`infra/compose.yaml` provisions PostgreSQL, Redis, Keycloak and optional SonarQube,
with separate databases for application, IAM and analysis. It deliberately requires
reviewed image references and local secrets through `.env`; no credentials are committed.
Copy `infra/.env.example` to `infra/.env`, fill exact official image tags/digests and
fresh local passwords. Example image repositories to verify: postgres, redis,
quay.io/keycloak/keycloak and sonarqube. No tag is claimed tested by this bootstrap.

```bash
docker compose --env-file infra/.env -f infra/compose.yaml config
docker compose --env-file infra/.env -f infra/compose.yaml up -d
# Optional local analysis service:
docker compose --env-file infra/.env -f infra/compose.yaml --profile quality up -d
```

Ports bind loopback only: PostgreSQL 5432, Redis 6379, Keycloak 8080, SonarQube 9000.
Keycloak starts in development mode for local use only, with durable PostgreSQL storage.
Configure a realm, public SPA client, exact localhost redirect URIs, PKCE S256, valid
audiences and service clients before product auth tests. Never enable implicit flow
or put client secrets in the SPA. Configure production IAM separately with TLS,
restricted admin endpoints, backup and rotation.

Allocate at least 16 GB RAM for a comfortable local multi-service development setup;
GPU work and large documents may need more. This is planning guidance, not a measured
minimum. SonarQube may need host virtual-memory settings per its chosen image docs.
GPU is optional. Containers access a GPU only via an explicitly configured adapter;
macOS/Linux/Windows acceleration paths differ. No NVIDIA-only baseline is assumed.

## Application launch plan

After ITER-0001 implementation, edge proxy maps `/` to Angular, `/api` to FastAPI,
`/hub` to SignalR and IAM routes to Keycloak. Persistence is private. Worker and
object-store adapters are configured explicitly. Local content-addressed files are
permitted for a single developer; shared environments use authorized object storage.
Add an application Compose profile only after real Dockerfiles and health checks exist.
No empty service is presented as running.

## Git identity and review

Use the GitHub account Yoshikemolo. Configure local Git name `Yoshikemolo` and its
verified no-reply email `11328759+Yoshikemolo@users.noreply.github.com` if privacy is
preferred. PR author must be Yoshikemolo. Commit/PR text is English, emoji-free and
has no attribution trailers or provider/model mentions. Local hooks and CI enforce
the general policy; see doc/engineering/contribution-policy.md. Human review verifies
natural English where deterministic checks cannot.
