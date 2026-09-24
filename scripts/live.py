"""Live preview: the editor with hot reload at the usual address, http://localhost:8090.

The Angular development server runs on 127.0.0.1:4390, and a small nginx takes the place of
the packaged web container on the preview port: the page comes from the development server,
while /api and /auth still go to the API and to Keycloak. Every saved change of the web
source reloads the page. Stopping the live preview (Ctrl+C) brings the packaged web
container back. Start the stack first with scripts/local.py start --identity.
"""
import os
from pathlib import Path
import shutil
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.local import PROJECT, read_environment  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
NODE = '24.15.0'
DEV_PORT = 4390


def compose(environment: Path, process: dict, *arguments: str) -> None:
    subprocess.run(['docker', 'compose', '--project-name', PROJECT, '--env-file', str(environment),
                    '-f', str(ROOT / 'compose.local.yaml'), *arguments], cwd=ROOT, check=True, env=process)


def main() -> int:
    environment = ROOT / '.env.local'
    if not environment.exists():
        print('Start the stack first: scripts/local.py start --identity')
        return 1
    settings = read_environment(environment)
    port = settings.get('XDS_PORT', '8090')
    process = dict(os.environ, COMPOSE_PROFILES='identity,live',
                   XDS_OIDC_ISSUER=f'http://localhost:{port}/auth/realms/xds', XDS_KEYCLOAK_INTERNAL_URL='http://keycloak:8080/auth')
    npx = shutil.which('npx') or 'npx'  # npx.cmd on Windows
    try:
        compose(environment, process, 'stop', 'web')
        compose(environment, process, 'up', '-d', '--no-build', 'live-web')
        print(f'Live preview on http://localhost:{port}; saved changes reload the page. Ctrl+C restores the packaged preview.')
        return subprocess.run([npx, '-y', f'node@{NODE}', 'node_modules/@angular/cli/bin/ng.js', 'serve', '--host', '127.0.0.1',
                               '--port', str(DEV_PORT)], cwd=ROOT).returncode
    except KeyboardInterrupt:
        return 0
    except (OSError, subprocess.CalledProcessError):
        print('The live preview could not start. Check Docker Desktop, npm ci and that the stack runs.')
        return 1
    finally:
        try:
            compose(environment, process, 'stop', 'live-web')
            compose(environment, process, 'start', 'web')
        except (OSError, subprocess.CalledProcessError):
            print('Restore the packaged preview with scripts/local.py start --identity.')


if __name__ == '__main__':
    raise SystemExit(main())
