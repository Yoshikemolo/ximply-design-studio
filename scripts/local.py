"""Start and manage only the isolated local preview Compose project."""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PROJECT = 'ximply-design-studio-preview'


def preview_info() -> str:
    """Identify the source checkout without reading credentials or contacting services."""
    try:
        version = json.loads((ROOT / 'release/version.json').read_text())['version']
    except (OSError, ValueError, KeyError):
        version = 'unknown'
    try:
        revision = subprocess.check_output(
            ['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT, text=True,
            stderr=subprocess.DEVNULL, timeout=5).strip()
        branch = subprocess.check_output(
            ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd=ROOT, text=True,
            stderr=subprocess.DEVNULL, timeout=5).strip()
    except (OSError, subprocess.SubprocessError):
        branch, revision = 'archive', 'unavailable'
    return f'Ximply Design Studio {version} | source: {branch} | commit: {revision}'


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'stop', 'logs', 'status', 'info', 'nuke'])
    parser.add_argument('--confirm')
    args = parser.parse_args()
    if args.action == 'nuke' and args.confirm != PROJECT:
        parser.error('NUKE requires --confirm ximply-design-studio-preview; only its project data is removed')
    if args.action == 'info':
        print(preview_info())
        return 0
    environment = ROOT/'.env.local'
    if args.action == 'start' and not environment.exists():
        descriptor = os.open(environment, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            stream.write('XDS_API_TOKEN='+secrets.token_urlsafe(36)+'\nXDS_PORT=8090\n')
    if not environment.exists():
        parser.error('Local environment missing; run start first')
    commands = {'start': ['up', '--build', '-d', '--wait'], 'stop': ['down'],
                'logs': ['logs', '--tail', '100'], 'status': ['ps'],
                'nuke': ['down', '--volumes', '--rmi', 'local', '--remove-orphans']}
    try:
        # Refuse accidental execution against a remote Docker context.
        context = subprocess.run(['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], check=True, capture_output=True, text=True).stdout.strip()
        override = os.environ.get('DOCKER_HOST', '')
        if not context.startswith(('unix://', 'npipe://')) or (override and not override.startswith(('unix://', 'npipe://'))):
            raise ValueError('This launcher requires a local Docker socket context')
        subprocess.run(['docker', 'compose', '--project-name', PROJECT, '--env-file', str(environment),
                        '-f', str(ROOT/'compose.local.yaml'), *commands[args.action]], cwd=ROOT, check=True)
    except (OSError, ValueError, subprocess.CalledProcessError):
        print('Local preview command failed. Check Docker Desktop, the local context and the troubleshooting guide.')
        return 1
    if args.action == 'start':
        print(preview_info())
        print('Open http://localhost:8090 (or the XDS_PORT you configured).')
        print('For server storage, enter XDS_API_TOKEN from .env.local in File > Server. Do not share that file.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
