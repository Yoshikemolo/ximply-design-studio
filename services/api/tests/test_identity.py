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
from fastapi.testclient import TestClient
from src import identity
from src.identity import (IdentityConfig, IdentityError, TokenVerifier, extended_expiry, licence_expiry, parse_instant)
from src.main import FileDocumentRepository, create_app

from tests.support import (ADMIN, CONFIG, ISSUER, KEY, NOW, OTHER_KEY, USER, FakeKeycloak, admin_token, encode_part,
                           jwks, licensed, token)


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
                          'permissions': ['ai-tools', 'change-control'], 'tiers': ['free', 'pro', 'teams', 'studio', 'enterprise']}, answer)
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
                          'licence': {'state': 'valid', 'expires': '2026-09-24T10:00:00Z', 'tier': 'pro', 'permissions': ['ai-tools', 'change-control']}},
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
        self.assertEqual({'state': 'expired', 'expires': '2026-09-23T09:59:59Z', 'tier': 'pro', 'permissions': []}, expired)
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
        self.assertEqual({'state': 'unrestricted', 'expires': None, 'tier': None, 'permissions': ['ai-tools', 'change-control']}, session['licence'])
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

    def test_refusals_carry_a_reason_without_echoing_input(self):
        def refused(code, body):
            return urllib.error.HTTPError('u', code, 'x', {}, __import__('io').BytesIO(body))
        cases = [(409, b'{"errorMessage": "User exists with same username"}', 409, 'That username or email is already in use'),
                 (404, b'', 404, 'There is no such user'),
                 (400, b'{"error": "invalidPasswordMinLengthMessage", "error_description": "Invalid password: minimum length 8."}',
                  422, 'Keycloak refused the change: Invalid password: minimum length 8.'),
                 (400, b'not json', 502, 'Keycloak answered 400')]
        for code, body, status, reason in cases:
            with mock.patch('urllib.request.urlopen', side_effect=refused(code, body)):
                with self.assertRaises(IdentityError) as answer:
                    identity.fetch_json('http://127.0.0.1:1/x')
            self.assertEqual((status, reason), (answer.exception.status, answer.exception.reason))

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
