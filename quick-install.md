# Quick install

## What is available

This is a design and engineering bootstrap. You can validate documentation/contracts,
run the harness tests and start the dependency infrastructure locally. The Angular
editor and application services have not been implemented; opening localhost will
not yet show an editor. The full application image/deployment contracts are provided
for ITER-0001 to implement. No Sonar or application-runtime result is claimed.

## Prerequisites

Git, Python 3.11+, Docker Engine/Desktop with Compose v2. Desktop Windows can use
PowerShell; Linux/macOS can use Bash. Optional Swarm commands require a configured
manager. No production destination has been configured.

```bash
git clone --branch feat/initial-design https://github.com/Yoshikemolo/ximply-design-studio.git
cd ximply-design-studio
python3 harness/check_docs.py
python3 -m unittest discover -s tests -v
```

Copy `infra/.env.example` to `infra/.env`; fill reviewed image references and fresh
local passwords. Select versions compatible with the Compose template before running.
No actual secrets belong in Git. The initial compose profile is infrastructure only.

### Bash

```bash
./scripts/studio.sh install --environment dev --dry-run
./scripts/studio.sh install --environment dev
./scripts/studio.sh status --environment dev
```

### PowerShell

```powershell
./scripts/studio.ps1 install --environment dev --dry-run
./scripts/studio.ps1 install --environment dev
./scripts/studio.ps1 status --environment dev
```

The same commands accept `demo`, `qa` and `prod` profiles. `prod` install invokes the
full image contract and requires TLS/host/image configuration. It does not invent a
public host or deploy remotely. `deploy-swarm` requires a Docker context pointing to
the intended manager and explicit target confirmation. Read the runbook first.

## Destructive maintenance

Preview before executing. Confirmation string must exactly match the scoped project,
for example xds-dev. Never run a global Docker prune.

```bash
./scripts/studio.sh reset-db --environment dev --dry-run
./scripts/studio.sh reset-db --environment dev --confirm xds-dev
./scripts/studio.sh nuke --environment dev --dry-run
./scripts/studio.sh nuke --environment dev --confirm xds-dev
```

PowerShell uses identical arguments. NUKE stops/removes this environment's containers,
then its labelled volumes and only project-built labelled images. Shared upstream
images, unrelated projects and other environments remain untouched. It is irreversible
for local project data; backups must be handled before execution. Database reset
recreates the application database volume only; IAM and Sonar databases are preserved.
After reset, run the future reviewed migrations/seed task before opening the editor.

See [troubleshooting](trhouble-shooting.md),
[full runbooks](doc/operations/runbooks.md) and
[local development](doc/operations/local-development.md).
