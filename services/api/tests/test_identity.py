"""Sign-in, licence and administration oracles (FEAT-0032, SC-0134 to SC-0139, SEC-0014)."""
import base64
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from src import identity
from src.identity import (IdentityConfig, IdentityError, KeycloakAdminClient, TokenVerifier, extended_expiry,
                          licence_expiry, parse_instant)
from src.main import FileDocumentRepository, create_app

NOW = datetime(2026, 9, 23, 10, 0, tzinfo=timezone.utc)
ISSUER = 'http://127.0.0.1:8180/realms/xds'
CONFIG = IdentityConfig(issuer=ISSUER, admin_client_id='xds-admin-service', admin_client_secret='s' * 32)
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
USER = '11111111-2222-3333-4444-555555555555'


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


class FakeKeycloak:
    """Contract double of the KeycloakAdmin port."""

    def __init__(self):
        self.users = {USER: {'id': USER, 'username': 'ana', 'name': 'Ana Diaz', 'email': 'ana@example.test', 'enabled': True,
                             'expires': None, 'roles': []}}
        for index in range(25):
            ident = f'00000000-0000-0000-0000-{index:012d}'
            self.users[ident] = {'id': ident, 'username': f'user{index}', 'name': f'User {index}', 'email': '', 'enabled': True,
                                 'expires': None, 'roles': []}

    def list_users(self, search, first, maximum):
        found = [user for user in self.users.values() if search in user['username']]
        return len(found), [dict(user) for user in found[first:first + maximum]]

    def get_user(self, user_id):
        if user_id not in self.users:
            raise IdentityError(404, 'There is no such user')
        return dict(self.users[user_id])

    def set_licence(self, user_id, expires, permissions):
        self.users[user_id] = {**self.users[user_id], 'expires': expires, 'roles': list(permissions)}


class IdentityApiTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.data = Path(folder.name)
        patcher = mock.patch.dict('os.environ', {'XDS_DATA_DIR': folder.name})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.keycloak = FakeKeycloak()
        self.verifier = TokenVerifier(CONFIG, keys=lambda: jwks())
        self.client = TestClient(create_app(FileDocumentRepository(self.data / 'projects'), 'x' * 40, identity=CONFIG,
                                            verifier=self.verifier, admin=self.keycloak, clock=lambda: NOW))

    def get(self, path, bearer=None, **kwargs):
        headers = {'Authorization': 'Bearer ' + bearer} if bearer else {}
        return self.client.get(path, headers=headers, **kwargs)

    def send(self, method, path, bearer, body=None):
        return self.client.request(method, path, headers={'Authorization': 'Bearer ' + bearer}, json=body)

    # SC-0134 and SC-0139: demo mode.
    def test_demo_mode_without_configuration(self):
        demo = TestClient(create_app(FileDocumentRepository(self.data / 'demo'), 'x' * 40, identity=None))
        self.assertEqual({'configured': False, 'mode': 'demo'}, demo.get('/api/identity').json())
        answer = demo.get('/api/session', headers={'Authorization': 'Bearer ' + licensed()})
        self.assertEqual(503, answer.status_code)
        self.assertEqual('Advanced mode is not configured on this server', answer.json()['detail'])
        self.assertEqual(503, demo.get('/api/licence/ai-tools').status_code)
        # The document store of the demo keeps its own bearer token.
        self.assertEqual(200, demo.get('/api/projects', headers={'Authorization': 'Bearer ' + 'x' * 40}).status_code)

    def test_configuration_names_realm_and_public_client_only(self):
        answer = self.get('/api/identity').json()
        self.assertEqual({'configured': True, 'mode': 'advanced-available', 'issuer': ISSUER, 'clientId': 'xds-studio',
                          'permissions': ['ai-tools', 'change-control']}, answer)
        self.assertNotIn('s' * 32, json.dumps(answer))

    def test_advanced_requests_need_a_token(self):
        answer = self.get('/api/licence/ai-tools')
        self.assertEqual(401, answer.status_code)
        self.assertEqual('Sign in to use advanced capabilities', answer.json()['detail'])
        self.assertEqual('Bearer', answer.headers['WWW-Authenticate'])

    def test_served_contract_declares_bearer_security(self):
        paths = self.client.get('/api/openapi.json').json()['paths']
        for path, method in [('/api/session', 'get'), ('/api/licence/{permission}', 'get'), ('/api/admin/users', 'get'),
                             ('/api/admin/users/{user_id}/licence', 'put'), ('/api/admin/users/{user_id}/licence', 'delete'),
                             ('/api/admin/users/{user_id}/licence/extend', 'post')]:
            self.assertTrue(paths[path][method].get('security'), path)
        self.assertNotIn('security', paths['/api/identity']['get'])

    # SC-0135: the session the editor shows.
    def test_session_reports_user_and_licence(self):
        session = self.get('/api/session', licensed(roles=('ai-tools', 'change-control', 'other'))).json()
        self.assertEqual({'subject': USER, 'username': 'ana', 'name': 'Ana Diaz', 'email': 'ana@example.test', 'admin': False,
                          'licence': {'state': 'valid', 'expires': '2026-09-24T10:00:00Z', 'permissions': ['ai-tools', 'change-control']}},
                         session)

    # SC-0136: licence oracle.
    def test_licence_decides_each_capability(self):
        self.assertEqual({'permission': 'ai-tools', 'allowed': True, 'expires': '2026-09-24T10:00:00Z'},
                         self.get('/api/licence/ai-tools', licensed()).json())
        cases = [
            (licensed(), 'change-control', 'Your licence does not include this capability'),
            (licensed(expires='2026-09-23T09:59:59Z'), 'ai-tools', 'Your licence has expired'),
            (token(resource_access={'xds-api': {'roles': ['ai-tools']}}), 'ai-tools', 'You have no licence for advanced capabilities'),
            (licensed(expires='not a date'), 'ai-tools', 'You have no licence for advanced capabilities'),
            (licensed(expires='2026-12-01T00:00:00'), 'ai-tools', 'You have no licence for advanced capabilities'),
        ]
        for bearer, permission, reason in cases:
            answer = self.get('/api/licence/' + permission, bearer)
            self.assertEqual((403, reason), (answer.status_code, answer.json()['detail']))
        expired = self.get('/api/session', licensed(expires='2026-09-23T09:59:59Z')).json()['licence']
        self.assertEqual({'state': 'expired', 'expires': '2026-09-23T09:59:59Z', 'permissions': []}, expired)
        self.assertEqual(422, self.get('/api/licence/everything', licensed()).status_code)

    # SC-0136: token oracle.
    def test_forged_and_stale_tokens_are_refused(self):
        public_pem = KEY.public_key().public_bytes(encoding=serialization.Encoding.PEM,
                                                   format=serialization.PublicFormat.SubjectPublicKeyInfo)
        valid = licensed()
        head, payload, signature = valid.split('.')
        claims = json.loads(base64.urlsafe_b64decode(payload + '=='))
        claims['resource_access'] = {'xds-api': {'roles': ['ai-tools', 'change-control']}}
        tampered = '.'.join([head, base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('='), signature])
        # Algorithm confusion: an HMAC signature keyed with the realm's public key, built by
        # hand because PyJWT itself refuses to sign that way.
        confused_head = encode_part({'alg': 'HS256', 'typ': 'JWT', 'kid': 'realm-key'})
        signing_input = confused_head + '.' + payload
        confused = signing_input + '.' + base64.urlsafe_b64encode(
            hmac.new(public_pem, signing_input.encode(), hashlib.sha256).digest()).decode().rstrip('=')
        unsigned = '.'.join([base64.urlsafe_b64encode(b'{"alg":"none","kid":"realm-key"}').decode().rstrip('='), payload, ''])
        forged = [
            licensed(iss='http://127.0.0.1:8180/realms/other'),
            licensed(aud='account'),
            licensed(exp=int((datetime.now(timezone.utc) - timedelta(minutes=5)).timestamp())),
            token(key=OTHER_KEY, xds_licence_expires='2026-09-24T10:00:00Z'),
            token(kid='unknown'),
            confused,
            tampered, unsigned, 'not-a-token',
        ]
        for bearer in forged:
            self.assertEqual(401, self.get('/api/licence/ai-tools', bearer).status_code, bearer[:40])
        # A licence named anywhere but in the signed token has no effect.
        answer = self.client.get('/api/licence/ai-tools', headers={'Authorization': 'Bearer ' + token(), 'X-Licence': 'ai-tools'},
                                 params={'xds_licence_expires': '2030-01-01T00:00:00Z'})
        self.assertEqual(403, answer.status_code)

    # SC-0147 and SC-0145: the super administrator and suspended licences.
    def test_super_administrator_is_unrestricted(self):
        admin = token(realm_access={'roles': ['xds-admin']})
        session = self.get('/api/session', admin).json()
        self.assertEqual({'state': 'unrestricted', 'expires': None, 'permissions': ['ai-tools', 'change-control']}, session['licence'])
        for permission in ('ai-tools', 'change-control'):
            self.assertEqual(200, self.get('/api/licence/' + permission, admin).status_code)
        # The role counts only from the verified token.
        forged = self.client.get('/api/licence/ai-tools', headers={'Authorization': 'Bearer ' + token(), 'X-Role': 'xds-admin'})
        self.assertEqual(403, forged.status_code)

    def test_suspended_licence_is_refused_until_it_expires(self):
        suspended = licensed(xds_licence_status=['suspended'])
        answer = self.get('/api/licence/ai-tools', suspended)
        self.assertEqual((403, 'Your licence is suspended'), (answer.status_code, answer.json()['detail']))
        self.assertEqual('suspended', self.get('/api/session', suspended).json()['licence']['state'])
        expired = licensed(expires='2026-09-23T09:00:00Z', xds_licence_status='suspended')
        self.assertEqual('expired', self.get('/api/session', expired).json()['licence']['state'])
        self.assertEqual(200, self.get('/api/licence/ai-tools', licensed(xds_licence_status='active')).status_code)

    # SC-0137: authority.
    def test_admin_endpoints_need_the_admin_role(self):
        self.assertEqual(401, self.get('/api/admin/users').status_code)
        answer = self.get('/api/admin/users', licensed(roles=('ai-tools', 'change-control')))
        self.assertEqual((403, 'Only administrators can manage users and licences'), (answer.status_code, answer.json()['detail']))
        self.assertEqual(403, self.send('PUT', f'/api/admin/users/{USER}/licence', licensed(), {'permissions': ['ai-tools'], 'days': 5}).status_code)
        self.assertEqual(403, self.send('DELETE', f'/api/admin/users/{USER}/licence', licensed()).status_code)
        admin = token(realm_access={'roles': ['xds-admin']})
        self.assertEqual(200, self.get('/api/admin/users', admin).status_code)

    def test_users_are_listed_with_search_and_paging(self):
        admin = token(realm_access={'roles': ['xds-admin']})
        page = self.get('/api/admin/users', admin, params={'search': 'user', 'page': 1, 'size': 10}).json()
        self.assertEqual((25, 1, 10), (page['total'], page['page'], page['size']))
        self.assertEqual([f'user{index}' for index in range(10, 20)], [user['username'] for user in page['users']])
        self.assertEqual({'state': 'none', 'expires': None, 'permissions': []}, page['users'][0]['licence'])
        self.assertEqual(422, self.get('/api/admin/users', admin, params={'size': 101}).status_code)

    # SC-0138: issue, extend, revoke and audit.
    def test_issue_extend_and_revoke(self):
        admin = token(realm_access={'roles': ['xds-admin']}, sub='99999999-9999-9999-9999-999999999999')
        issued = self.send('PUT', f'/api/admin/users/{USER}/licence', admin, {'permissions': ['ai-tools', 'ai-tools'], 'days': 30}).json()
        self.assertEqual({'state': 'valid', 'expires': '2026-10-23T10:00:00Z', 'permissions': ['ai-tools']}, issued['licence'])
        self.assertEqual((datetime(2026, 10, 23, 10, 0, tzinfo=timezone.utc), ['ai-tools']),
                         (self.keycloak.users[USER]['expires'], self.keycloak.users[USER]['roles']))
        dated = self.send('PUT', f'/api/admin/users/{USER}/licence', admin, {'permissions': ['change-control'], 'until': '2026-12-31'}).json()
        self.assertEqual({'state': 'valid', 'expires': '2026-12-31T23:59:59Z', 'permissions': ['change-control']}, dated['licence'])
        extended = self.send('POST', f'/api/admin/users/{USER}/licence/extend', admin, {'days': 10}).json()
        self.assertEqual('2027-01-10T23:59:59Z', extended['licence']['expires'])
        revoked = self.send('DELETE', f'/api/admin/users/{USER}/licence', admin).json()
        self.assertEqual({'state': 'none', 'expires': None, 'permissions': []}, revoked['licence'])
        self.assertEqual((None, []), (self.keycloak.users[USER]['expires'], self.keycloak.users[USER]['roles']))
        lines = (self.data / 'audit' / 'admin.jsonl').read_text().splitlines()
        records = [json.loads(line) for line in lines]
        self.assertEqual(['issue', 'issue', 'extend', 'revoke'], [record['change'] for record in records])
        self.assertEqual({'administrator': '99999999-9999-9999-9999-999999999999', 'user': USER, 'change': 'issue',
                          'time': '2026-09-23T10:00:00Z', 'expires': '2026-10-23T10:00:00Z', 'permissions': ['ai-tools']}, records[0])
        self.assertNotIn(admin, '\n'.join(lines))
        self.assertNotIn('s' * 32, '\n'.join(lines))

    def test_extension_of_an_expired_licence_starts_today(self):
        admin = token(realm_access={'roles': ['xds-admin']})
        self.keycloak.set_licence(USER, datetime(2026, 9, 1, tzinfo=timezone.utc), ['ai-tools'])
        extended = self.send('POST', f'/api/admin/users/{USER}/licence/extend', admin, {'days': 10}).json()
        self.assertEqual('2026-10-03T10:00:00Z', extended['licence']['expires'])
        self.keycloak.set_licence(USER, None, [])
        answer = self.send('POST', f'/api/admin/users/{USER}/licence/extend', admin, {'days': 10})
        self.assertEqual((409, 'This user has no licence to extend; issue one'), (answer.status_code, answer.json()['detail']))

    def test_invalid_licence_requests_are_refused(self):
        admin = token(realm_access={'roles': ['xds-admin']})
        for body, status in [({'permissions': [], 'days': 5}, 422), ({'permissions': ['everything'], 'days': 5}, 422),
                             ({'permissions': ['ai-tools']}, 422), ({'permissions': ['ai-tools'], 'days': 5, 'until': '2026-12-01'}, 422),
                             ({'permissions': ['ai-tools'], 'until': '2026-09-22'}, 422), ({'permissions': ['ai-tools'], 'days': 0}, 422),
                             ({'permissions': ['ai-tools'], 'days': 5, 'admin': True}, 422)]:
            self.assertEqual(status, self.send('PUT', f'/api/admin/users/{USER}/licence', admin, body).status_code, body)
        self.assertEqual(404, self.send('PUT', '/api/admin/users/..%2Fclients/licence', admin, {'permissions': ['ai-tools'], 'days': 5}).status_code)
        self.assertEqual(404, self.send('DELETE', '/api/admin/users/00000000-0000-0000-0000-00000000dead/licence', admin).status_code)
        self.assertFalse((self.data / 'audit' / 'admin.jsonl').exists())


class LicencePolicyTests(unittest.TestCase):
    def test_expiry_from_days_or_date(self):
        self.assertEqual(NOW + timedelta(days=30), licence_expiry(NOW, days=30))
        self.assertEqual(datetime(2026, 9, 23, 23, 59, 59, tzinfo=timezone.utc), licence_expiry(NOW, until='2026-09-23'))
        for kwargs in [{}, {'days': 1, 'until': '2026-10-01'}, {'days': 3651}, {'until': '2026-02-30'}, {'until': '2026-09-22'},
                       {'until': '2040-01-01'}]:
            with self.assertRaises(IdentityError):
                licence_expiry(NOW, **kwargs)

    def test_extension_and_instants(self):
        self.assertEqual(NOW + timedelta(days=12), extended_expiry(NOW + timedelta(days=2), NOW, 10))
        self.assertEqual(NOW + timedelta(days=10), extended_expiry(None, NOW, 10))
        with self.assertRaises(IdentityError):
            extended_expiry(NOW, NOW, 0)
        self.assertEqual(NOW, parse_instant(['2026-09-23T10:00:00Z']))
        self.assertIsNone(parse_instant(['a', 'b']))
        self.assertIsNone(parse_instant(42))


class VerifierTests(unittest.TestCase):
    def test_keys_are_refreshed_for_a_new_key_and_when_stale(self):
        calls = []

        def rotating():
            # The realm first publishes one key, then rotates to a new one.
            calls.append(1)
            return jwks() if len(calls) == 1 else jwks(OTHER_KEY, 'new')
        verifier = TokenVerifier(CONFIG, keys=rotating)
        verifier.verify(licensed())
        verifier.verify(licensed())
        self.assertEqual(1, len(calls))
        verifier.verify(token(key=OTHER_KEY, kid='new'))
        self.assertEqual(2, len(calls))
        stale_calls = []
        stale = TokenVerifier(CONFIG, keys=lambda: stale_calls.append(1) or jwks(), refresh_after=-1)
        stale.verify(licensed())
        stale.verify(licensed())
        self.assertEqual(2, len(stale_calls))

    def test_configuration_from_environment(self):
        with mock.patch.dict('os.environ', {'XDS_OIDC_ISSUER': ''}, clear=False):
            self.assertIsNone(IdentityConfig.from_environment())
        environment = {'XDS_OIDC_ISSUER': ISSUER, 'XDS_KEYCLOAK_INTERNAL_URL': 'http://keycloak:8080/',
                       'XDS_ADMIN_CLIENT_ID': 'svc', 'XDS_ADMIN_CLIENT_SECRET': 'secret'}
        with mock.patch.dict('os.environ', environment, clear=False):
            config = IdentityConfig.from_environment()
        self.assertEqual(('xds', 'http://keycloak:8080', 'http://keycloak:8080/realms/xds/protocol/openid-connect/certs'),
                         (config.realm, config.base_url, config.certs_url))
        self.assertNotIn('secret', repr(config))
        self.assertEqual('http://127.0.0.1:8180', CONFIG.base_url)


class KeycloakClientTests(unittest.TestCase):
    """The real adapter against a recorded Keycloak admin REST exchange."""

    def setUp(self):
        self.calls = []
        self.user = {'id': USER, 'username': 'ana', 'firstName': 'Ana', 'lastName': 'Diaz', 'email': 'ana@example.test',
                     'enabled': True, 'attributes': {'locale': ['es']}}
        self.mapped = [{'id': 'r1', 'name': 'ai-tools'}, {'id': 'rx', 'name': 'uma_protection'}]

        def http(url, data=None, headers=None, method=None):
            self.calls.append((method or 'GET', url.replace('http://127.0.0.1:8180', ''), json.loads(data) if data and data[:1] in b'[{' else data))
            path = url.split('/admin/realms/xds', 1)[-1]
            if url.endswith('/protocol/openid-connect/token'):
                return {'access_token': 'service-token', 'expires_in': 60}
            if path.startswith('/clients?'):
                return [{'id': 'client-uuid', 'clientId': 'xds-api'}]
            if path == '/clients/client-uuid/roles':
                return [{'id': 'r1', 'name': 'ai-tools'}, {'id': 'r2', 'name': 'change-control'}]
            if path.endswith('/role-mappings/clients/client-uuid') and (method or 'GET') == 'GET':
                return self.mapped
            if path.startswith('/users/count'):
                return 1
            if path.startswith('/users?'):
                return [self.user]
            if path == f'/users/{USER}' and (method or 'GET') == 'GET':
                return self.user
            return None
        self.client = KeycloakAdminClient(CONFIG, http=http)

    def test_requires_a_service_account(self):
        with self.assertRaises(IdentityError):
            KeycloakAdminClient(IdentityConfig(issuer=ISSUER))

    def test_lists_and_describes_users(self):
        total, users = self.client.list_users('an', 20, 10)
        self.assertEqual(1, total)
        self.assertEqual({'id': USER, 'username': 'ana', 'name': 'Ana Diaz', 'email': 'ana@example.test', 'enabled': True,
                          'expires': None, 'roles': ['ai-tools']}, users[0])
        self.assertIn(('GET', '/admin/realms/xds/users?search=an&first=20&max=10&briefRepresentation=false', None), self.calls)
        self.assertEqual(1, sum(1 for call in self.calls if call[1].endswith('/token')))

    def test_sets_attribute_and_roles_keeping_other_attributes(self):
        expires = datetime(2026, 10, 23, 10, tzinfo=timezone.utc)
        self.client.set_licence(USER, expires, ['change-control'])
        put = next(call for call in self.calls if call[0] == 'PUT')
        self.assertEqual({'locale': ['es'], 'xds_licence_expires': ['2026-10-23T10:00:00Z']}, put[2]['attributes'])
        self.assertIn(('POST', f'/admin/realms/xds/users/{USER}/role-mappings/clients/client-uuid', [{'id': 'r2', 'name': 'change-control'}]), self.calls)
        self.assertIn(('DELETE', f'/admin/realms/xds/users/{USER}/role-mappings/clients/client-uuid', [{'id': 'r1', 'name': 'ai-tools'}]), self.calls)
        self.calls.clear()
        self.user['attributes'] = {'xds_licence_expires': ['x']}
        self.client.set_licence(USER, None, [])
        put = next(call for call in self.calls if call[0] == 'PUT')
        self.assertEqual({}, put[2]['attributes'])
        self.assertEqual(1, len(self.client.get_user(USER)['roles']))

    def test_missing_api_client_is_reported(self):
        def http(url, *arguments):
            if url.endswith('/token'):
                return {'access_token': 't', 'expires_in': 60}
            return self.user if url.endswith(f'/users/{USER}') else []
        client = KeycloakAdminClient(CONFIG, http=http)
        with self.assertRaises(IdentityError) as refused:
            client.get_user(USER)
        self.assertEqual(503, refused.exception.status)


class TransportTests(unittest.TestCase):
    def test_keycloak_errors_become_refusals(self):
        with mock.patch('urllib.request.urlopen', side_effect=urllib.error.HTTPError('u', 500, 'x', {}, None)):
            with self.assertRaises(IdentityError) as refused:
                identity.fetch_json('http://127.0.0.1:1/x')
            self.assertEqual((502, 'Keycloak answered 500'), (refused.exception.status, refused.exception.reason))
        with mock.patch('urllib.request.urlopen', side_effect=urllib.error.URLError('down')):
            with self.assertRaises(IdentityError) as refused:
                identity.fetch_json('http://127.0.0.1:1/x')
            self.assertEqual(503, refused.exception.status)

    def test_answers_are_decoded(self):
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b'{"keys": []}'
        with mock.patch('urllib.request.urlopen', return_value=response):
            self.assertEqual({'keys': []}, identity.fetch_json('http://127.0.0.1:1/x'))
        response.__enter__.return_value.read.return_value = b''
        with mock.patch('urllib.request.urlopen', return_value=response):
            self.assertIsNone(identity.fetch_json('http://127.0.0.1:1/x'))


if __name__ == '__main__':
    unittest.main()
