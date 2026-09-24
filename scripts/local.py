"""Start and manage only the isolated local preview Compose project."""
import argparse
import base64
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


def read_environment(path: Path) -> dict[str, str]:
    values = {}
    for line in path.read_text().splitlines():
        name, separator, value = line.partition('=')
        if separator and not name.startswith('#'):
            values[name.strip()] = value.strip()
    return values


def add_identity_secrets(path: Path) -> None:
    """Adds the secrets of the local Keycloak once; existing values are never replaced."""
    current = read_environment(path)
    wanted = {'KEYCLOAK_ADMIN_PASSWORD': secrets.token_urlsafe(24), 'XDS_ADMIN_CLIENT_SECRET': secrets.token_urlsafe(36),
              'XDS_TOKEN_KEY': base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
              'XDS_FIRST_ADMIN_USERNAME': 'admin', 'XDS_FIRST_ADMIN_PASSWORD': secrets.token_urlsafe(18)}
    missing = {name: value for name, value in wanted.items() if name not in current}
    if missing:
        with path.open('a') as stream:
            stream.write(''.join(f'{name}={value}\n' for name, value in missing.items()))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'stop', 'logs', 'status', 'info', 'nuke', 'reset-identity'])
    parser.add_argument('--confirm')
    parser.add_argument('--identity', action='store_true',
                        help='also start the local Keycloak of advanced mode (sign-in, licences, Admin menu)')
    args = parser.parse_args()
    if args.action == 'nuke' and args.confirm != PROJECT:
        parser.error('NUKE requires --confirm ximply-design-studio-preview; only its project data is removed')
    if args.action == 'reset-identity' and args.confirm != 'identity':
        parser.error('reset-identity requires --confirm identity; it deletes the local Keycloak users and imports the realm again')
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
    if args.action == 'start' and args.identity:
        add_identity_secrets(environment)
    settings = read_environment(environment)
    process = dict(os.environ)
    # Stopping and removing always include the identity profile, so nothing is left behind.
    if args.identity or args.action in ('stop', 'nuke', 'logs', 'status', 'reset-identity'):
        process['COMPOSE_PROFILES'] = 'identity'
    if args.action == 'start':
        port = settings.get('XDS_PORT', '8090')
        process['XDS_OIDC_ISSUER'] = f'http://localhost:{port}/auth/realms/xds' if args.identity else ''
        process['XDS_KEYCLOAK_INTERNAL_URL'] = 'http://keycloak:8080/auth' if args.identity else ''
    commands = {'start': ['up', '--build', '-d', '--wait'], 'stop': ['down'],
                'logs': ['logs', '--tail', '100'], 'status': ['ps'],
                'nuke': ['down', '--volumes', '--rmi', 'local', '--remove-orphans'],
                # Keycloak imports the realm only once; this drops its data so the next start imports it again.
                'reset-identity': ['rm', '--stop', '--force', '--volumes', 'keycloak']}
    try:
        # Refuse accidental execution against a remote Docker context.
        context = subprocess.run(['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], check=True, capture_output=True, text=True).stdout.strip()
        override = os.environ.get('DOCKER_HOST', '')
        if not context.startswith(('unix://', 'npipe://')) or (override and not override.startswith(('unix://', 'npipe://'))):
            raise ValueError('This launcher requires a local Docker socket context')
        subprocess.run(['docker', 'compose', '--project-name', PROJECT, '--env-file', str(environment),
                        '-f', str(ROOT/'compose.local.yaml'), *commands[args.action]], cwd=ROOT, check=True, env=process)
    except (OSError, ValueError, subprocess.CalledProcessError):
        print('Local preview command failed. Check Docker Desktop, the local context and the troubleshooting guide.')
        return 1
    if args.action == 'reset-identity':
        subprocess.run(['docker', 'volume', 'rm', '-f', PROJECT + '_identity'], check=False, capture_output=True)
        print('The local Keycloak data was removed; start with --identity to import the realm again.')
    if args.action == 'start':
        print(preview_info())
        print('Open http://localhost:8090 (or the XDS_PORT you configured).')
        print('For server storage, enter XDS_API_TOKEN from .env.local in File > Server. Do not share that file.')
        if args.identity:
            print('Advanced mode: sign in as XDS_FIRST_ADMIN_USERNAME with XDS_FIRST_ADMIN_PASSWORD from .env.local;')
            print('Keycloak asks for a new password on the first sign-in. The Admin menu then issues licences.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
