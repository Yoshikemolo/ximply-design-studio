"""Keycloak identity, licences kept in Keycloak and their administration (FEAT-0032, ADR-0041).

The API trusts only access tokens signed by the realm, and decides a licence from the
token's expiry attribute and permission roles against its own clock on every request.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Protocol

import jwt

PERMISSIONS = ('ai-tools', 'change-control')
ADMIN_ROLE = 'xds-admin'
LICENCE_ATTRIBUTE = 'xds_licence_expires'
STATUS_ATTRIBUTE = 'xds_licence_status'
ISSUED_ATTRIBUTE = 'xds_licence_issued'
ALGORITHMS = ['RS256']
USER_ID = re.compile(r'^[0-9a-fA-F-]{36}$')


class IdentityError(Exception):
    """A refusal with the HTTP status and a reason the editor can show."""

    def __init__(self, status: int, reason: str):
        super().__init__(reason)
        self.status = status
        self.reason = reason


@dataclass(frozen=True)
class IdentityConfig:
    issuer: str
    audience: str = 'xds-api'
    client_id: str = 'xds-studio'
    jwks_url: str = ''
    internal_url: str = ''
    admin_client_id: str = ''
    admin_client_secret: str = field(default='', repr=False)

    @property
    def realm(self) -> str:
        return self.issuer.rstrip('/').rsplit('/realms/', 1)[-1]

    @property
    def base_url(self) -> str:
        """Where the API reaches Keycloak, which may differ from the browser's address."""
        return (self.internal_url or self.issuer.rstrip('/').rsplit('/realms/', 1)[0]).rstrip('/')

    @property
    def certs_url(self) -> str:
        return self.jwks_url or f'{self.base_url}/realms/{self.realm}/protocol/openid-connect/certs'

    @staticmethod
    def from_environment() -> 'IdentityConfig | None':
        issuer = os.environ.get('XDS_OIDC_ISSUER', '').strip()
        if not issuer:
            return None
        return IdentityConfig(
            issuer=issuer,
            audience=os.environ.get('XDS_OIDC_AUDIENCE', 'xds-api'),
            client_id=os.environ.get('XDS_OIDC_CLIENT_ID', 'xds-studio'),
            jwks_url=os.environ.get('XDS_OIDC_JWKS_URL', ''),
            internal_url=os.environ.get('XDS_KEYCLOAK_INTERNAL_URL', ''),
            admin_client_id=os.environ.get('XDS_ADMIN_CLIENT_ID', ''),
            admin_client_secret=os.environ.get('XDS_ADMIN_CLIENT_SECRET', ''),
        )


def fetch_json(url: str, data: bytes | None = None, headers: dict | None = None, method: str | None = None, timeout: float = 10):
    request = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - configured Keycloak URL only
            body = response.read()
    except urllib.error.HTTPError as error:
        raise IdentityError(502, f'Keycloak answered {error.code}') from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise IdentityError(503, 'Keycloak is unreachable') from None
    return json.loads(body) if body else None


class TokenVerifier:
    """Validates realm-signed access tokens; keys come only from the configured realm."""

    def __init__(self, config: IdentityConfig, keys: Callable[[], dict] | None = None, refresh_after: float = 300):
        self.config = config
        self._load = keys or (lambda: fetch_json(config.certs_url))
        self._keys: dict[str, object] = {}
        self._loaded = 0.0
        self._refresh_after = refresh_after
        self._lock = threading.Lock()

    def _key(self, kid: str):
        with self._lock:
            stale = time.monotonic() - self._loaded > self._refresh_after
            if kid not in self._keys or stale:
                keys = {}
                for entry in (self._load() or {}).get('keys', []):
                    if entry.get('kty') == 'RSA' and entry.get('use', 'sig') == 'sig' and entry.get('kid'):
                        keys[entry['kid']] = jwt.PyJWK(entry, 'RS256').key
                self._keys, self._loaded = keys, time.monotonic()
            return self._keys.get(kid)

    def verify(self, token: str) -> dict:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError:
            raise IdentityError(401, 'The sign-in token is malformed') from None
        if header.get('alg') not in ALGORITHMS:
            raise IdentityError(401, 'The sign-in token uses an algorithm that is not allowed')
        key = self._key(str(header.get('kid', '')))
        if key is None:
            raise IdentityError(401, 'The sign-in token was not signed by the realm')
        try:
            return jwt.decode(token, key, algorithms=ALGORITHMS, audience=self.config.audience,
                              issuer=self.config.issuer, leeway=30,
                              options={'require': ['exp', 'iat', 'iss', 'aud', 'sub']})
        except jwt.ExpiredSignatureError:
            raise IdentityError(401, 'The sign-in has expired') from None
        except jwt.PyJWTError:
            raise IdentityError(401, 'The sign-in token is not valid for this service') from None


def parse_instant(value) -> datetime | None:
    if isinstance(value, list):
        value = value[0] if len(value) == 1 else None
    if not isinstance(value, str) or not value:
        return None
    try:
        instant = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None
    return instant if instant.tzinfo else None


def format_instant(instant: datetime) -> str:
    return instant.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def licence_state(expires: datetime | None, now: datetime, status: str | None = None) -> str:
    """none, expired, suspended or valid; an expired licence is expired whatever its status."""
    if expires is None:
        return 'none'
    if expires <= now:
        return 'expired'
    return 'suspended' if status == 'suspended' else 'valid'


def single(value) -> str | None:
    if isinstance(value, list):
        value = value[0] if len(value) == 1 else None
    return value if isinstance(value, str) else None


def session_from_claims(claims: dict, audience: str, now: datetime) -> dict:
    roles = ((claims.get('resource_access') or {}).get(audience) or {}).get('roles') or []
    permissions = sorted(role for role in roles if role in PERMISSIONS)
    expires = parse_instant(claims.get(LICENCE_ATTRIBUTE))
    admin = ADMIN_ROLE in ((claims.get('realm_access') or {}).get('roles') or [])
    # The super administrator uses every advanced capability without a licence (ADR-0041 amendment).
    state = 'unrestricted' if admin else licence_state(expires, now, single(claims.get(STATUS_ATTRIBUTE)))
    return {
        'subject': claims['sub'],
        'username': claims.get('preferred_username', ''),
        'name': claims.get('name') or claims.get('preferred_username', ''),
        'email': claims.get('email', ''),
        'admin': admin,
        'licence': {'state': state, 'expires': format_instant(expires) if expires and not admin else None,
                    'permissions': list(PERMISSIONS) if admin else permissions if state == 'valid' else []},
    }


def require_permission(session: dict, permission: str) -> None:
    licence = session['licence']
    if licence['state'] == 'none':
        raise IdentityError(403, 'You have no licence for advanced capabilities')
    if licence['state'] == 'expired':
        raise IdentityError(403, 'Your licence has expired')
    if licence['state'] == 'suspended':
        raise IdentityError(403, 'Your licence is suspended')
    if permission not in licence['permissions']:
        raise IdentityError(403, 'Your licence does not include this capability')


def licence_expiry(now: datetime, days: int | None = None, until: str | None = None) -> datetime:
    """A new expiry from a number of days from now, or the end of a date in UTC."""
    if (days is None) == (until is None):
        raise IdentityError(422, 'Give either a number of days or an expiry date')
    if days is not None:
        if not 1 <= days <= 3650:
            raise IdentityError(422, 'A licence lasts from 1 to 3650 days')
        return now + timedelta(days=days)
    try:
        day = datetime.strptime(until, '%Y-%m-%d').replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        raise IdentityError(422, 'The expiry date must be written as YYYY-MM-DD') from None
    expiry = day + timedelta(days=1) - timedelta(seconds=1)
    if expiry <= now:
        raise IdentityError(422, 'The expiry date has already passed')
    if expiry > now + timedelta(days=3650):
        raise IdentityError(422, 'A licence lasts at most 3650 days')
    return expiry


def extended_expiry(current: datetime | None, now: datetime, days: int) -> datetime:
    if not 1 <= days <= 3650:
        raise IdentityError(422, 'A licence is extended by 1 to 3650 days')
    return max(current or now, now) + timedelta(days=days)


class KeycloakAdmin(Protocol):
    """The user administration the Admin menu needs; the real adapter talks to Keycloak."""

    def list_users(self, search: str, first: int, maximum: int) -> tuple[int, list[dict]]: ...
    def get_user(self, user_id: str) -> dict: ...
    def set_licence(self, user_id: str, expires: datetime | None, permissions: list[str]) -> None: ...


class KeycloakAdminClient:
    """Keycloak admin REST through a service account allowed only to manage realm users."""

    def __init__(self, config: IdentityConfig, http=fetch_json):
        if not config.admin_client_id or not config.admin_client_secret:
            raise IdentityError(503, 'Administration is not configured')
        self.config = config
        self.http = http
        self._token = ''
        self._token_until = 0.0
        self._client_uuid = ''
        self._lock = threading.Lock()

    def _headers(self) -> dict:
        with self._lock:
            if time.monotonic() >= self._token_until:
                form = urllib.parse.urlencode({'grant_type': 'client_credentials', 'client_id': self.config.admin_client_id,
                                               'client_secret': self.config.admin_client_secret}).encode()
                answer = self.http(f'{self.config.base_url}/realms/{self.config.realm}/protocol/openid-connect/token', form,
                                   {'Content-Type': 'application/x-www-form-urlencoded'}, 'POST')
                self._token = answer['access_token']
                self._token_until = time.monotonic() + max(10, int(answer.get('expires_in', 60)) - 20)
            return {'Authorization': 'Bearer ' + self._token, 'Content-Type': 'application/json'}

    def _admin(self, path: str, body=None, method: str = 'GET'):
        data = json.dumps(body).encode() if body is not None else None
        return self.http(f'{self.config.base_url}/admin/realms/{self.config.realm}{path}', data, self._headers(), method)

    def _api_client(self) -> str:
        if not self._client_uuid:
            clients = self._admin('/clients?' + urllib.parse.urlencode({'clientId': self.config.audience})) or []
            if not clients:
                raise IdentityError(503, 'The API client is missing from the realm')
            self._client_uuid = clients[0]['id']
        return self._client_uuid

    def _roles(self, user_id: str) -> list[str]:
        mapped = self._admin(f'/users/{user_id}/role-mappings/clients/{self._api_client()}') or []
        return [role['name'] for role in mapped]

    def _describe(self, user: dict) -> dict:
        return {'id': user['id'], 'username': user.get('username', ''),
                'name': ' '.join(part for part in (user.get('firstName'), user.get('lastName')) if part) or user.get('username', ''),
                'email': user.get('email', ''), 'enabled': bool(user.get('enabled')),
                'expires': parse_instant((user.get('attributes') or {}).get(LICENCE_ATTRIBUTE)),
                'roles': [role for role in self._roles(user['id']) if role in PERMISSIONS]}

    def list_users(self, search: str, first: int, maximum: int) -> tuple[int, list[dict]]:
        query = urllib.parse.urlencode({'search': search, 'first': first, 'max': maximum, 'briefRepresentation': 'false'})
        # Keycloak counts service accounts when a search is given, even an empty one.
        total = self._admin('/users/count' + ('?' + urllib.parse.urlencode({'search': search}) if search else ''))
        return int(total or 0), [self._describe(user) for user in self._admin('/users?' + query) or []]

    def get_user(self, user_id: str) -> dict:
        return self._describe(self._admin(f'/users/{user_id}'))

    def set_licence(self, user_id: str, expires: datetime | None, permissions: list[str]) -> None:
        user = self._admin(f'/users/{user_id}')
        attributes = dict(user.get('attributes') or {})
        if expires is None:
            attributes.pop(LICENCE_ATTRIBUTE, None)
        else:
            attributes[LICENCE_ATTRIBUTE] = [format_instant(expires)]
        self._admin(f'/users/{user_id}', {**user, 'attributes': attributes}, 'PUT')
        client = self._api_client()
        available = {role['name']: role for role in self._admin(f'/clients/{client}/roles') or [] if role['name'] in PERMISSIONS}
        current = set(self._roles(user_id))
        grant = [available[name] for name in permissions if name not in current and name in available]
        revoke = [available[name] for name in current if name not in permissions and name in available]
        if grant:
            self._admin(f'/users/{user_id}/role-mappings/clients/{client}', grant, 'POST')
        if revoke:
            self._admin(f'/users/{user_id}/role-mappings/clients/{client}', revoke, 'DELETE')


class AuditLog:
    """Append-only record of administrative changes, without tokens or secrets."""

    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()

    def record(self, administrator: str, subject: str, change: str, detail: dict, now: datetime) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps({'time': format_instant(now), 'administrator': administrator, 'user': subject,
                           'change': change, **detail}, sort_keys=True)
        with self._lock, self.path.open('a', encoding='utf-8') as handle:
            handle.write(line + '\n')


def valid_user_id(user_id: str) -> str:
    if not USER_ID.fullmatch(user_id):
        raise IdentityError(404, 'There is no such user')
    return user_id


def public_user(user: dict, now: datetime) -> dict:
    expires = user['expires']
    state = licence_state(expires, now)
    return {'id': user['id'], 'username': user['username'], 'name': user['name'], 'email': user['email'],
            'enabled': user['enabled'],
            'licence': {'state': state, 'expires': format_instant(expires) if expires else None, 'permissions': sorted(user['roles'])}}
