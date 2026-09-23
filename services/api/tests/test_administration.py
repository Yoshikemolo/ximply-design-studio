"""Administration workspace oracles (FEAT-0032, SC-0137, SC-0138, SC-0141 to SC-0147)."""
import io
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from src.administration import lift_expired_bans
from src.identity import AuditLog, IdentityError, KeycloakAdminClient, TokenVerifier
from src.main import FileDocumentRepository, create_app
from tests.support import ADMIN, CONFIG, NOW, USER, FakeKeycloak, admin_token, jwks, licensed, token

DOCUMENT = {'format': 'ximply-document', 'version': 1, 'name': 'A design', 'width': 800, 'height': 600,
            'background': '#ffffff', 'layers': []}


class AdministrationTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.data = Path(folder.name)
        patcher = mock.patch.dict('os.environ', {'XDS_DATA_DIR': folder.name})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.keycloak = FakeKeycloak()
        self.clock = [NOW]
        self.store = FileDocumentRepository(self.data / 'projects')
        self.client = TestClient(create_app(self.store, 'x' * 40, identity=CONFIG, verifier=TokenVerifier(CONFIG, keys=lambda: jwks()),
                                            admin=self.keycloak, clock=lambda: self.clock[0], lift_bans_every=None))
        self.admin = admin_token()

    def call(self, method, path, body=None, bearer=None):
        return self.client.request(method, path, headers={'Authorization': 'Bearer ' + (bearer or self.admin)}, json=body)

    def audit(self):
        path = self.data / 'audit' / 'admin.jsonl'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    # SC-0137 and SC-0141: authority over every endpoint.
    def test_every_endpoint_needs_the_super_administrator(self):
        routes = [('GET', '/api/admin/users'), ('POST', '/api/admin/users'), ('PATCH', f'/api/admin/users/{USER}'),
                  ('DELETE', f'/api/admin/users/{USER}'), ('PUT', f'/api/admin/users/{USER}/password'),
                  ('PUT', f'/api/admin/users/{USER}/ban'), ('DELETE', f'/api/admin/users/{USER}/ban'), ('GET', '/api/admin/roles'),
                  ('PUT', f'/api/admin/roles/ai-tools/members/{USER}'), ('GET', '/api/admin/licences'),
                  ('PUT', f'/api/admin/users/{USER}/licence'), ('PATCH', f'/api/admin/users/{USER}/licence'),
                  ('GET', '/api/admin/documents'), ('DELETE', '/api/admin/documents/00000000-0000-0000-0000-000000000000')]
        for method, path in routes:
            self.assertEqual(401, self.client.request(method, path).status_code, path)
            self.assertEqual(403, self.call(method, path, {}, licensed(roles=('ai-tools', 'change-control'))).status_code, path)
        self.assertEqual([], self.audit())

    # SC-0142: creating, editing and deleting users, with their facts.
    def test_create_edit_and_delete_users(self):
        created = self.call('POST', '/api/admin/users', {'username': 'marta', 'email': 'marta@example.test', 'firstName': 'Marta',
                                                        'lastName': 'Gil', 'password': 'Secret-Pass-9', 'temporary': True, 'admin': True})
        self.assertEqual(201, created.status_code)
        user = created.json()
        self.assertEqual(('marta', 'Marta Gil', True, '2026-09-23T10:00:00Z', None, 0),
                         (user['username'], user['name'], user['admin'], user['created'], user['lastLogin'], user['documents']))
        self.assertEqual(('Secret-Pass-9', True), self.keycloak.passwords[user['id']])
        duplicate = self.call('POST', '/api/admin/users', {'username': 'marta', 'email': 'other@example.test', 'firstName': 'M',
                                                          'lastName': 'G', 'password': 'Secret-Pass-9'})
        self.assertEqual((409, 'That username or email is already in use'), (duplicate.status_code, duplicate.json()['detail']))
        for bad in [{'username': 'x', 'email': 'x@example.test', 'firstName': 'A', 'lastName': 'B', 'password': 'Secret-Pass-9'},
                    {'username': 'luis', 'email': 'not-an-email', 'firstName': 'A', 'lastName': 'B', 'password': 'Secret-Pass-9'},
                    {'username': 'luis', 'email': 'luis@example.test', 'firstName': 'A', 'lastName': 'B', 'password': 'short'},
                    {'username': 'luis', 'email': 'luis@example.test', 'firstName': 'A', 'lastName': 'B', 'password': 'Secret-Pass-9', 'role': 'root'}]:
            self.assertEqual(422, self.call('POST', '/api/admin/users', bad).status_code, bad)
        edited = self.call('PATCH', f"/api/admin/users/{user['id']}", {'email': 'marta.gil@example.test', 'lastName': 'Gil Ruiz'}).json()
        self.assertEqual(('marta.gil@example.test', 'Marta Gil Ruiz'), (edited['email'], edited['name']))
        self.assertEqual(204, self.call('DELETE', f"/api/admin/users/{user['id']}").status_code)
        self.assertNotIn(user['id'], self.keycloak.users_by_id)
        self.assertEqual(['create-user', 'edit-user', 'delete-user'], [entry['change'] for entry in self.audit()])
        self.assertNotIn('Secret-Pass-9', json.dumps(self.audit()))

    def test_users_show_sign_in_and_documents(self):
        self.keycloak.logins[USER] = NOW - timedelta(hours=3)
        self.client.post('/api/projects', json=DOCUMENT, headers={'Authorization': 'Bearer ' + licensed()})
        self.client.post('/api/projects', json=DOCUMENT, headers={'Authorization': 'Bearer ' + licensed()})
        self.client.post('/api/projects', json=DOCUMENT, headers={'Authorization': 'Bearer ' + 'x' * 40})
        listing = self.call('GET', '/api/admin/users').json()
        ana = next(user for user in listing['users'] if user['id'] == USER)
        self.assertEqual((2, '2026-09-23T07:00:00Z', '2026-09-13T10:00:00Z'), (ana['documents'], ana['lastLogin'], ana['created']))
        self.assertEqual(2, listing['total'])

    def test_administrators_cannot_remove_themselves(self):
        for method, path in [('DELETE', f'/api/admin/users/{ADMIN}'), ('PUT', f'/api/admin/users/{ADMIN}/ban'),
                             ('DELETE', f'/api/admin/roles/xds-admin/members/{ADMIN}')]:
            answer = self.call(method, path, {})
            self.assertEqual(409, answer.status_code, path)
        self.assertIn(ADMIN, self.keycloak.users_by_id)
        self.assertIn('xds-admin', self.keycloak.users_by_id[ADMIN]['roles'])

    def test_unknown_or_malformed_users(self):
        self.assertEqual(404, self.call('PATCH', '/api/admin/users/00000000-0000-0000-0000-00000000dead', {'firstName': 'X'}).status_code)
        self.assertEqual(404, self.call('DELETE', '/api/admin/users/..%2Fclients').status_code)

    # SC-0143: passwords and bans.
    def test_password_overwrite_ends_sessions_without_leaking(self):
        answer = self.call('PUT', f'/api/admin/users/{USER}/password', {'password': 'New-Pass-123', 'temporary': False})
        self.assertEqual(200, answer.status_code)
        self.assertEqual(('New-Pass-123', False), self.keycloak.passwords[USER])
        self.assertEqual([USER], self.keycloak.sessions_ended)
        self.assertNotIn('New-Pass-123', answer.text + json.dumps(self.audit()))
        self.assertEqual(422, self.call('PUT', f'/api/admin/users/{USER}/password', {'password': 'short'}).status_code)

    def test_temporary_ban_ends_on_its_own_and_permanent_ban_stays(self):
        until = (NOW + timedelta(days=2)).isoformat()
        banned = self.call('PUT', f'/api/admin/users/{USER}/ban', {'until': until, 'reason': 'abuse'}).json()
        self.assertEqual((False, {'permanent': False, 'until': '2026-09-25T10:00:00Z', 'reason': 'abuse', 'expired': False}),
                         (banned['enabled'], banned['ban']))
        self.assertEqual([USER], self.keycloak.sessions_ended)
        self.assertEqual(422, self.call('PUT', f'/api/admin/users/{USER}/ban', {'until': (NOW - timedelta(days=1)).isoformat()}).status_code)
        self.assertEqual(422, self.call('PUT', f'/api/admin/users/{USER}/ban', {'until': '2026-10-01T00:00:00'}).status_code)
        self.clock[0] = NOW + timedelta(days=3)
        ana = next(user for user in self.call('GET', '/api/admin/users').json()['users'] if user['id'] == USER)
        self.assertEqual((True, None), (ana['enabled'], ana['ban']))
        self.assertIn('ban-ended', [entry['change'] for entry in self.audit()])
        permanent = self.call('PUT', f'/api/admin/users/{USER}/ban', {}).json()
        self.assertEqual({'permanent': True, 'until': None, 'reason': '', 'expired': False}, permanent['ban'])
        self.clock[0] = NOW + timedelta(days=3000)
        self.assertEqual(0, lift_expired_bans(self.keycloak, AuditLog(self.data / 'a.jsonl'), self.clock[0]))
        lifted = self.call('DELETE', f'/api/admin/users/{USER}/ban').json()
        self.assertEqual((True, None), (lifted['enabled'], lifted['ban']))

    # SC-0144: roles and permissions.
    def test_roles_catalogue_and_membership(self):
        roles = {role['name']: role for role in self.call('GET', '/api/admin/roles').json()['roles']}
        self.assertEqual(['xds-admin', 'ai-tools', 'change-control'], list(roles))
        self.assertEqual(([ADMIN], []), (roles['xds-admin']['members'], roles['ai-tools']['members']))
        self.assertEqual('permission', roles['ai-tools']['kind'])
        granted = self.call('PUT', f'/api/admin/roles/ai-tools/members/{USER}').json()
        self.assertEqual(['ai-tools'], granted['licence']['permissions'])
        # A permission without a licence expiry grants nothing yet.
        self.assertEqual('none', granted['licence']['state'])
        self.call('PUT', f'/api/admin/roles/xds-admin/members/{USER}')
        self.assertTrue(self.call('DELETE', f'/api/admin/roles/ai-tools/members/{USER}').json()['admin'])
        self.assertEqual(422, self.call('PUT', f'/api/admin/roles/root/members/{USER}').status_code)

    # SC-0138 and SC-0145: licences with tier, state and period.
    def test_licence_lifecycle(self):
        issued = self.call('PUT', f'/api/admin/users/{USER}/licence', {'tier': 'studio', 'permissions': ['ai-tools'], 'days': 30}).json()
        self.assertEqual({'state': 'valid', 'tier': 'studio', 'status': 'active', 'issued': '2026-09-23T10:00:00Z',
                          'expires': '2026-10-23T10:00:00Z', 'permissions': ['ai-tools']}, issued['licence'])
        suspended = self.call('PATCH', f'/api/admin/users/{USER}/licence', {'status': 'suspended'}).json()['licence']
        self.assertEqual(('suspended', 'suspended'), (suspended['state'], suspended['status']))
        changed = self.call('PATCH', f'/api/admin/users/{USER}/licence', {'status': 'active', 'tier': 'enterprise',
                                                                         'permissions': ['change-control'], 'until': '2026-12-31'}).json()['licence']
        self.assertEqual(('valid', 'enterprise', '2026-12-31T23:59:59Z', ['change-control']),
                         (changed['state'], changed['tier'], changed['expires'], changed['permissions']))
        self.assertEqual('2027-01-10T23:59:59Z', self.call('POST', f'/api/admin/users/{USER}/licence/extend', {'days': 10}).json()['licence']['expires'])
        listing = self.call('GET', '/api/admin/licences').json()
        self.assertEqual((1, USER, 'enterprise'), (listing['total'], listing['licences'][0]['userId'], listing['licences'][0]['tier']))
        self.clock[0] = datetime(2027, 2, 1, tzinfo=timezone.utc)
        self.assertEqual('expired', self.call('GET', '/api/admin/licences').json()['licences'][0]['state'])
        revoked = self.call('DELETE', f'/api/admin/users/{USER}/licence').json()['licence']
        self.assertEqual({'state': 'none', 'tier': None, 'status': None, 'issued': None, 'expires': None, 'permissions': []}, revoked)
        self.assertEqual(0, self.call('GET', '/api/admin/licences').json()['total'])
        changes = [entry['change'] for entry in self.audit()]
        self.assertEqual(['issue', 'edit-licence', 'edit-licence', 'extend', 'revoke'], changes)

    def test_licence_requests_are_validated(self):
        for body in [{'permissions': [], 'days': 5}, {'permissions': ['ai-tools']}, {'tier': 'gold', 'permissions': ['ai-tools'], 'days': 5},
                     {'permissions': ['ai-tools'], 'days': 5, 'until': '2026-12-01'}, {'permissions': ['ai-tools'], 'until': '2026-09-22'}]:
            self.assertIn(self.call('PUT', f'/api/admin/users/{USER}/licence', body).status_code, (409, 422), body)
        answer = self.call('PATCH', f'/api/admin/users/{USER}/licence', {'status': 'suspended'})
        self.assertEqual((409, 'This user has no licence to change; issue one'), (answer.status_code, answer.json()['detail']))
        self.assertEqual(409, self.call('POST', f'/api/admin/users/{USER}/licence/extend', {'days': 5}).status_code)
        self.assertEqual(422, self.call('PATCH', f'/api/admin/users/{USER}/licence', {'days': 5, 'until': '2026-12-01'}).status_code)

    # SC-0146: documents and owners.
    def test_documents_with_owner_and_deletion(self):
        mine = self.client.post('/api/projects', json=DOCUMENT, headers={'Authorization': 'Bearer ' + licensed()}).json()['id']
        # An owner named in the document or a header is ignored; the verified subject counts.
        forged = self.client.post('/api/projects', json={**DOCUMENT, 'owner': ADMIN},
                                  headers={'Authorization': 'Bearer ' + 'x' * 40, 'X-Owner': ADMIN})
        self.assertEqual(422, forged.status_code)
        anonymous = self.client.post('/api/projects', json=DOCUMENT, headers={'Authorization': 'Bearer ' + 'x' * 40, 'X-Owner': ADMIN}).json()['id']
        documents = {entry['id']: entry for entry in self.call('GET', '/api/admin/documents').json()['documents']}
        self.assertEqual((USER, None), (documents[mine]['owner'], documents[anonymous]['owner']))
        self.assertGreater(documents[mine]['size'], 0)
        self.assertEqual(204, self.call('DELETE', f'/api/admin/documents/{mine}').status_code)
        self.assertEqual([anonymous], [entry['id'] for entry in self.call('GET', '/api/admin/documents').json()['documents']])
        self.assertEqual(404, self.call('DELETE', f'/api/admin/documents/{mine}').status_code)
        self.assertEqual(404, self.call('DELETE', '/api/admin/documents/not-an-id').status_code)
        self.assertEqual(0, next(user for user in self.call('GET', '/api/admin/users').json()['users'] if user['id'] == USER)['documents'])

    def test_storage_refuses_invalid_sign_in(self):
        self.assertEqual(401, self.client.get('/api/projects', headers={'Authorization': 'Bearer ' + token(iss='other')}).status_code)
        self.assertEqual(401, self.client.get('/api/projects').status_code)
        demo = TestClient(create_app(FileDocumentRepository(self.data / 'demo'), '', identity=None))
        self.assertEqual(503, demo.get('/api/projects', headers={'Authorization': 'Bearer anything'}).status_code)


class KeycloakAdapterTests(unittest.TestCase):
    """The real adapter against a recorded Keycloak admin REST exchange."""

    def setUp(self):
        self.calls = []
        self.user = {'id': USER, 'username': 'ana', 'firstName': 'Ana', 'lastName': 'Diaz', 'email': 'ana@example.test',
                     'enabled': True, 'createdTimestamp': 1758621600000, 'attributes': {'locale': ['es'], 'xds_licence_tier': ['team', 'x']}}

        def http(url, data=None, headers=None, method=None):
            method = method or 'GET'
            body = json.loads(data) if data and data[:1] in b'[{' else data
            path = url.split('/admin/realms/xds', 1)[-1]
            self.calls.append((method, path if '/admin/' in url else url.split('/realms/', 1)[-1], body))
            if url.endswith('/protocol/openid-connect/token'):
                return {'access_token': 'service-token', 'expires_in': 60}
            if path.startswith('/clients?'):
                return [{'id': 'client-uuid', 'clientId': 'xds-api'}]
            if path == '/roles/xds-admin':
                return {'id': 'r0', 'name': 'xds-admin'}
            if path.startswith('/clients/client-uuid/roles/') and path.endswith('/users?first=0&max=5000'):
                return [{'id': USER}] if '/ai-tools/' in path else []
            if path.startswith('/clients/client-uuid/roles/'):
                return {'id': 'r-' + path.rsplit('/', 1)[-1], 'name': path.rsplit('/', 1)[-1]}
            if path.startswith('/roles/xds-admin/users'):
                return []
            if path == f'/users/{USER}/role-mappings/realm':
                return [{'name': 'default-roles-xds'}]
            if path == f'/users/{USER}/role-mappings/clients/client-uuid':
                return [{'name': 'ai-tools'}]
            if path.startswith('/users?first=0'):
                return [self.user]
            if path.startswith('/users?username='):
                return [{'id': 'new-id'}]
            if path == f'/users/{USER}' and method == 'GET':
                return self.user
            if path.startswith('/events'):
                return [{'userId': USER, 'time': 1758600000000}, {'userId': USER, 'time': 1758610000000}, {'time': 1}]
            return None
        self.client = KeycloakAdminClient(CONFIG, http=http)

    def test_requires_a_service_account(self):
        from src.identity import IdentityConfig
        with self.assertRaises(IdentityError):
            KeycloakAdminClient(IdentityConfig(issuer=CONFIG.issuer))

    def test_users_come_with_roles_from_role_members(self):
        users = self.client.users()
        self.assertEqual({'id': USER, 'username': 'ana', 'firstName': 'Ana', 'lastName': 'Diaz', 'email': 'ana@example.test',
                          'enabled': True, 'created': datetime(2025, 9, 23, 10, tzinfo=timezone.utc),
                          'attributes': {'locale': 'es'}, 'roles': {'ai-tools'}}, users[0])
        self.assertEqual({'ai-tools'}, self.client.get_user(USER)['roles'])
        self.assertEqual(1, sum(1 for call in self.calls if call[1] == 'xds/protocol/openid-connect/token'))

    def test_writes_go_to_the_expected_endpoints(self):
        self.assertEqual('new-id', self.client.create_user({'username': 'marta', 'email': 'm@example.test', 'firstName': 'M',
                                                            'lastName': 'G', 'password': 'Secret-Pass-9', 'temporary': True}))
        self.client.update_user(USER, {'enabled': False})
        self.client.set_attributes(USER, {'xds_licence_tier': 'pro', 'locale': None})
        self.client.set_password(USER, 'New-Pass-123', False)
        self.client.end_sessions(USER)
        self.client.set_role(USER, 'change-control', True)
        self.client.set_role(USER, 'xds-admin', False)
        self.client.delete_user(USER)
        writes = [call for call in self.calls if call[0] != 'GET' and 'token' not in call[1]]
        self.assertEqual(('POST', '/users'), writes[0][:2])
        self.assertEqual([{'type': 'password', 'value': 'Secret-Pass-9', 'temporary': True}], writes[0][2]['credentials'])
        self.assertEqual(('PUT', f'/users/{USER}', False), (writes[1][0], writes[1][1], writes[1][2]['enabled']))
        self.assertEqual({'xds_licence_tier': ['pro']}, writes[2][2]['attributes'])
        self.assertEqual(('PUT', f'/users/{USER}/reset-password', {'type': 'password', 'value': 'New-Pass-123', 'temporary': False}), writes[3])
        self.assertEqual(('POST', f'/users/{USER}/logout', None), writes[4])
        self.assertEqual(('POST', f'/users/{USER}/role-mappings/clients/client-uuid', [{'id': 'r-change-control', 'name': 'change-control'}]), writes[5])
        self.assertEqual(('DELETE', f'/users/{USER}/role-mappings/realm', [{'id': 'r0', 'name': 'xds-admin'}]), writes[6])
        self.assertEqual(('DELETE', f'/users/{USER}', None), writes[7])
        with self.assertRaises(IdentityError):
            self.client.set_role(USER, 'root', True)

    def test_last_sign_in_is_the_latest_login_event(self):
        self.assertEqual({USER: datetime.fromtimestamp(1758610000, timezone.utc)}, self.client.last_logins())

    def test_missing_api_client_is_reported(self):
        client = KeycloakAdminClient(CONFIG, http=lambda url, *a: {'access_token': 't', 'expires_in': 60} if url.endswith('/token') else [])
        with self.assertRaises(IdentityError) as refused:
            client.set_role(USER, 'ai-tools', True)
        self.assertEqual(503, refused.exception.status)


class DocumentStoreTests(unittest.TestCase):
    def test_owner_is_kept_beside_the_document(self):
        with tempfile.TemporaryDirectory() as folder:
            from src.main import Document
            store = FileDocumentRepository(Path(folder))
            owned = store.create(Document.model_validate(DOCUMENT), USER)
            plain = store.create(Document.model_validate(DOCUMENT))
            self.assertEqual((USER, None), (store.owner(owned), store.owner(plain)))
            (Path(folder) / 'meta' / f'{plain}.json').write_text('not json')
            self.assertIsNone(store.owner(plain))
            self.assertEqual(2, len(store.describe()))
            store.delete(owned)
            self.assertFalse((Path(folder) / 'meta' / f'{owned}.json').exists())


if __name__ == '__main__':
    unittest.main()
