"""Per-user external token oracles (FEAT-0029, ADR-0037 amendment, SC-0122)."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from src import external_tokens
from src.external_tokens import TokenVault, check_openai
from src.identity import IdentityError, TokenVerifier
from src.main import FileDocumentRepository, create_app
from tests.support import ADMIN, CONFIG, NOW, USER, FakeKeycloak, admin_token, jwks, licensed, token

SECRET = 'sk-test-' + 'a' * 40
OTHER = 'sk-other-' + 'b' * 40


class TokenApiTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.data = Path(folder.name)
        self.key = Fernet.generate_key().decode()
        patcher = mock.patch.dict('os.environ', {'XDS_DATA_DIR': folder.name, 'XDS_TOKEN_KEY': self.key})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.checked = []
        def checker(value):
            self.checked.append(value)
            return {'ok': value == SECRET, 'detail': 'OpenAI accepted the token' if value == SECRET else 'OpenAI refused the token'}
        self.client = TestClient(create_app(FileDocumentRepository(self.data / 'p'), 'x' * 40, identity=CONFIG,
                                            verifier=TokenVerifier(CONFIG, keys=lambda: jwks()), admin=FakeKeycloak(),
                                            clock=lambda: NOW, lift_bans_every=None, token_checker=checker))

    def call(self, method, path, bearer, body=None):
        return self.client.request(method, path, headers={'Authorization': 'Bearer ' + bearer}, json=body)

    def test_each_user_keeps_their_own_token_encrypted(self):
        ana, owner = licensed(), admin_token()
        self.assertEqual({'provider': 'openai', 'configured': False, 'updatedAt': None, 'hint': None}, self.call('GET', '/api/me/tokens/openai', ana).json())
        stored = self.call('PUT', '/api/me/tokens/openai', ana, {'token': SECRET})
        # Only the prefix and the last four characters are shown, as the owner asked.
        self.assertEqual({'provider': 'openai', 'configured': True, 'updatedAt': '2026-09-23T10:00:00Z', 'hint': 'sk-…aaaa'}, stored.json())
        # The super administrator has a token of their own and cannot see the user's.
        self.assertFalse(self.call('GET', '/api/me/tokens/openai', owner).json()['configured'])
        self.call('PUT', '/api/me/tokens/openai', owner, {'token': OTHER})
        self.assertEqual({'provider': 'openai', 'ok': True, 'detail': 'OpenAI accepted the token'},
                         self.call('POST', '/api/me/tokens/openai/test', ana).json())
        self.assertFalse(self.call('POST', '/api/me/tokens/openai/test', owner).json()['ok'])
        self.assertEqual([SECRET, OTHER], self.checked)
        # Nothing on disk, in answers or in the audit holds the token in the clear.
        files = list((self.data / 'tokens').glob('*.json'))
        self.assertEqual(2, len(files))
        on_disk = ''.join(path.read_text() for path in files)
        audit = (self.data / 'audit' / 'admin.jsonl').read_text()
        answers = stored.text + self.call('GET', '/api/me/tokens/openai', ana).text
        for text in (on_disk, audit, answers):
            self.assertNotIn(SECRET, text)
            # Nothing beyond the last four characters of the token leaves it.
            self.assertNotIn(SECRET[-5:], text)
        self.assertEqual(['set-token', 'set-token'], [json.loads(line)['change'] for line in audit.splitlines()])
        self.assertEqual(204, self.call('DELETE', '/api/me/tokens/openai', ana).status_code)
        self.assertFalse(self.call('GET', '/api/me/tokens/openai', ana).json()['configured'])
        answer = self.call('POST', '/api/me/tokens/openai/test', ana)
        self.assertEqual((409, 'There is no token to test; save one first'), (answer.status_code, answer.json()['detail']))

    def test_access_needs_the_agent_tools_licence(self):
        self.assertEqual(401, self.client.get('/api/me/tokens/openai').status_code)
        for bearer in (token(), licensed(roles=('change-control',)), licensed(expires='2026-09-22T00:00:00Z')):
            self.assertEqual(403, self.call('PUT', '/api/me/tokens/openai', bearer, {'token': SECRET}).status_code)
        self.assertFalse((self.data / 'tokens').exists())

    def test_tokens_are_validated(self):
        for value in ('short', 'not-an-sk-token-' + 'x' * 30, 'sk-' + 'x' * 500, 'sk-has spaces and more text here'):
            self.assertEqual(422, self.call('PUT', '/api/me/tokens/openai', licensed(), {'token': value}).status_code, value)
        self.assertEqual(422, self.call('GET', '/api/me/tokens/other', licensed()).status_code)

    def test_storage_needs_the_service_key(self):
        with mock.patch.dict('os.environ', {'XDS_TOKEN_KEY': ''}):
            client = TestClient(create_app(FileDocumentRepository(self.data / 'q'), 'x' * 40, identity=CONFIG,
                                           verifier=TokenVerifier(CONFIG, keys=lambda: jwks()), admin=FakeKeycloak(),
                                           clock=lambda: NOW, lift_bans_every=None))
        answer = client.put('/api/me/tokens/openai', headers={'Authorization': 'Bearer ' + licensed()}, json={'token': SECRET})
        self.assertEqual((503, 'Token storage is not configured on this server'), (answer.status_code, answer.json()['detail']))


class VaultTests(unittest.TestCase):
    def test_a_wrong_key_reads_nothing(self):
        with tempfile.TemporaryDirectory() as folder:
            TokenVault(Path(folder), Fernet.generate_key().decode()).put(USER, 'openai', SECRET, NOW)
            other = TokenVault(Path(folder), Fernet.generate_key().decode())
            self.assertIsNone(other.get(USER, 'openai'))
            self.assertTrue(other.status(USER, 'openai')['configured'])
            with self.assertRaises(IdentityError):
                TokenVault(Path(folder), 'not a key').status(USER, 'openai')


class OpenAiCheckTests(unittest.TestCase):
    def test_answers_are_explained(self):
        response = mock.MagicMock()
        response.__enter__.return_value.status = 200
        with mock.patch('urllib.request.urlopen', return_value=response) as opened:
            self.assertEqual({'ok': True, 'detail': 'OpenAI accepted the token, and its project can use image-model, text-model'},
                             check_openai(SECRET, ('image-model', 'text-model')))
        urls = [call.args[0].full_url for call in opened.call_args_list]
        self.assertEqual([external_tokens.OPENAI_MODELS, external_tokens.OPENAI_MODELS + '/image-model', external_tokens.OPENAI_MODELS + '/text-model'], urls)
        self.assertEqual('Bearer ' + SECRET, opened.call_args_list[0].args[0].headers['Authorization'])
        for code, detail in [(401, 'OpenAI refused the token'), (403, 'The token has no access to the API'),
                             (429, 'OpenAI limits the rate or quota of this token'), (500, 'OpenAI answered 500')]:
            with mock.patch('urllib.request.urlopen', side_effect=urllib.error.HTTPError('u', code, 'x', {}, None)):
                self.assertEqual({'ok': False, 'detail': detail}, check_openai(SECRET, ('m',)))
        with mock.patch('urllib.request.urlopen', side_effect=urllib.error.URLError('down')):
            self.assertEqual({'ok': False, 'detail': 'OpenAI is unreachable from the server'}, check_openai(SECRET, ('m',)))

    def test_a_model_the_project_cannot_use_is_named(self):
        response = mock.MagicMock()
        response.__enter__.return_value.status = 200
        refused = urllib.error.HTTPError('u', 404, 'x', {}, None)
        with mock.patch('urllib.request.urlopen', side_effect=[response, response, refused]):
            answer = check_openai(SECRET, ('image-model', 'text-model'))
        self.assertEqual({'ok': False, 'detail': 'OpenAI accepted the token, but its project cannot use text-model. '
                          'Allow the models in the limits of the OpenAI project, or verify the organization'}, answer)

    def test_the_models_checked_are_those_the_agent_tools_call(self):
        from src.agent_tools import required_models
        with mock.patch.dict('os.environ', {'XDS_OPENAI_IMAGE_MODEL': 'i', 'XDS_OPENAI_TEXT_MODEL': 't'}):
            self.assertEqual(('i', 't'), required_models())


if __name__ == '__main__':
    unittest.main()
