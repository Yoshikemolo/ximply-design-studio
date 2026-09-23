"""Shared test keys, tokens and a contract double of the Keycloak administration port."""
import base64
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from src.identity import ADMIN_ROLE, IdentityConfig, IdentityError

NOW = datetime(2026, 9, 23, 10, 0, tzinfo=timezone.utc)
ISSUER = 'http://127.0.0.1:8180/realms/xds'
CONFIG = IdentityConfig(issuer=ISSUER, admin_client_id='xds-admin-service', admin_client_secret='s' * 32)
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
USER = '11111111-2222-3333-4444-555555555555'
ADMIN = '99999999-9999-9999-9999-999999999999'


def encode_part(value: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')


def jwks(key=KEY, kid='realm-key'):
    entry = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    return {'keys': [{**entry, 'kid': kid, 'use': 'sig', 'alg': 'RS256'}]}


def token(key=KEY, kid='realm-key', algorithm='RS256', **claims):
    # Signature times follow the real clock, which PyJWT checks; licences follow the test clock.
    issued = datetime.now(timezone.utc)
    body = {'iss': ISSUER, 'aud': ['xds-api', 'account'], 'sub': USER, 'iat': int(issued.timestamp()),
            'exp': int((issued + timedelta(minutes=5)).timestamp()), 'preferred_username': 'ana', 'name': 'Ana Diaz',
            'email': 'ana@example.test', **claims}
    return jwt.encode(body, key, algorithm=algorithm, headers={'kid': kid})


def licensed(expires='2026-09-24T10:00:00Z', roles=('ai-tools',), admin=False, **claims):
    return token(xds_licence_expires=expires, resource_access={'xds-api': {'roles': list(roles)}},
                 realm_access={'roles': ['xds-admin'] if admin else []}, **claims)


def admin_token(**claims):
    return token(sub=ADMIN, realm_access={'roles': ['xds-admin']}, **claims)


class FakeKeycloak:
    """Contract double of the KeycloakAdmin port, holding users in memory."""

    def __init__(self):
        self.users_by_id: dict[str, dict] = {}
        self.logins: dict[str, datetime] = {}
        self.passwords: dict[str, tuple[str, bool]] = {}
        self.sessions_ended: list[str] = []
        self.add(USER, 'ana', 'Ana', 'Diaz', 'ana@example.test')
        self.add(ADMIN, 'owner', 'Studio', 'Owner', 'owner@example.test', roles={ADMIN_ROLE})

    def add(self, user_id, username, first, last, email, roles=None, attributes=None, created=None, enabled=True):
        self.users_by_id[user_id] = {'id': user_id, 'username': username, 'firstName': first, 'lastName': last, 'email': email,
                                     'enabled': enabled, 'created': created or NOW - timedelta(days=10),
                                     'attributes': dict(attributes or {}), 'roles': set(roles or ())}

    def _copy(self, user):
        return {**user, 'attributes': dict(user['attributes']), 'roles': set(user['roles'])}

    def users(self, limit=2000):
        return [self._copy(user) for user in list(self.users_by_id.values())[:limit]]

    def get_user(self, user_id):
        if user_id not in self.users_by_id:
            raise IdentityError(404, 'There is no such user')
        return self._copy(self.users_by_id[user_id])

    def create_user(self, data):
        if any(user['username'] == data['username'] or user['email'] == data['email'] for user in self.users_by_id.values()):
            raise IdentityError(409, 'That username or email is already in use')
        user_id = f'00000000-0000-0000-0000-{len(self.users_by_id):012d}'
        self.add(user_id, data['username'], data['firstName'], data['lastName'], data['email'], created=NOW)
        self.passwords[user_id] = (data['password'], data['temporary'])
        return user_id

    def update_user(self, user_id, data):
        self.get_user(user_id)
        self.users_by_id[user_id].update(data)

    def delete_user(self, user_id):
        self.get_user(user_id)
        del self.users_by_id[user_id]

    def set_password(self, user_id, password, temporary):
        self.get_user(user_id)
        self.passwords[user_id] = (password, temporary)

    def end_sessions(self, user_id):
        self.sessions_ended.append(user_id)

    def set_attributes(self, user_id, values):
        self.get_user(user_id)
        for name, value in values.items():
            if value is None:
                self.users_by_id[user_id]['attributes'].pop(name, None)
            else:
                self.users_by_id[user_id]['attributes'][name] = value

    def set_role(self, user_id, role, granted):
        self.get_user(user_id)
        (self.users_by_id[user_id]['roles'].add if granted else self.users_by_id[user_id]['roles'].discard)(role)

    def last_logins(self):
        return dict(self.logins)
