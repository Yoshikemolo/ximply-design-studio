"""Agent tool oracles (FEAT-0029, SC-0151, SC-0152, SC-0153 and SC-0154)."""
import base64
import io
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
from src.agent_tools import OpenAiProvider, instruction, png_bytes, svg_from, GenerationRequest
from src.identity import IdentityError, TokenVerifier
from src.main import FileDocumentRepository, create_app
from tests.support import CONFIG, NOW, FakeKeycloak, admin_token, jwks, licensed, token

PNG = b'\x89PNG\r\n\x1a\n' + b'pixels'
DATA_URL = 'data:image/png;base64,' + base64.b64encode(PNG).decode()
SECRET = 'sk-test-' + 'a' * 40


class FakeProvider:
    def __init__(self):
        self.calls = []

    def edit_image(self, token, images, prompt, transparent):
        self.calls.append(('edit', token, images, prompt, transparent))
        return PNG + b'result'

    def vectorize(self, token, image, prompt, temperature):
        self.calls.append(('vectorize', token, image, prompt, temperature))
        return '<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>'


class AgentApiTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.data = Path(folder.name)
        patcher = mock.patch.dict('os.environ', {'XDS_DATA_DIR': folder.name, 'XDS_TOKEN_KEY': Fernet.generate_key().decode()})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.provider = FakeProvider()
        self.client = TestClient(create_app(FileDocumentRepository(self.data / 'p'), 'x' * 40, identity=CONFIG,
                                            verifier=TokenVerifier(CONFIG, keys=lambda: jwks()), admin=FakeKeycloak(),
                                            clock=lambda: NOW, lift_bans_every=None, provider=self.provider))
        self.user = licensed()
        self.call('PUT', '/api/me/tokens/openai', {'token': SECRET})

    def call(self, method, path, body=None, bearer=None):
        return self.client.request(method, path, headers={'Authorization': 'Bearer ' + (bearer or self.user)}, json=body)

    def audit(self):
        return (self.data / 'audit' / 'admin.jsonl').read_text()

    def test_access_needs_the_agent_tools_licence(self):
        body = {'prompt': 'Blue', 'action': 'style', 'selectionPng': DATA_URL}
        self.assertEqual(401, self.client.post('/api/ai/generate', json=body).status_code)
        for bearer in (token(), licensed(roles=('change-control',)), licensed(expires='2026-09-22T00:00:00Z')):
            self.assertEqual(403, self.call('POST', '/api/ai/generate', body, bearer).status_code)
        self.assertEqual([], self.provider.calls)

    def test_a_picture_comes_back_for_an_image_action(self):
        answer = self.call('POST', '/api/ai/generate', {'prompt': 'watercolour', 'action': 'style', 'scope': 'selection', 'creativity': 0.9,
                                                       'selectionPng': DATA_URL, 'documentPng': DATA_URL, 'selectionData': '[{"kind":"path"}]'})
        self.assertEqual(200, answer.status_code, answer.text)
        self.assertEqual({'kind': 'image', 'png': 'data:image/png;base64,' + base64.b64encode(PNG + b'result').decode()}, answer.json())
        kind, used, images, prompt, transparent = self.provider.calls[0]
        self.assertEqual(('edit', SECRET, [PNG, PNG], True), (kind, used, images, transparent))
        self.assertIn('Image 1 is the selected objects', prompt)
        self.assertIn('Instruction of the user: watercolour', prompt)
        self.assertIn('[{"kind":"path"}]', prompt)
        self.assertIn('creative liberties', prompt)
        # The audit keeps the action and the outcome, never the prompt.
        self.assertIn('"action": "style"', self.audit())
        self.assertIn(f'"bytes": {2 * len(PNG)}', self.audit())
        self.assertIn('"outcome": "answered"', self.audit())
        self.assertNotIn('watercolour', self.audit())

    def test_the_document_is_the_image_when_it_is_the_context(self):
        self.call('POST', '/api/ai/generate', {'action': 'enhance', 'scope': 'document', 'documentPng': DATA_URL, 'creativity': 0.1})
        kind, _, images, prompt, transparent = self.provider.calls[0]
        self.assertEqual((1, False), (len(images), transparent))
        self.assertIn('whole design document', prompt)
        self.assertIn('strictly', prompt)

    def test_removing_the_background_asks_for_transparency(self):
        self.call('POST', '/api/ai/generate', {'action': 'remove-background', 'scope': 'document', 'documentPng': DATA_URL})
        self.assertTrue(self.provider.calls[0][4])

    def test_a_drawing_comes_back_for_vectorize(self):
        answer = self.call('POST', '/api/ai/generate', {'action': 'vectorize', 'selectionPng': DATA_URL, 'creativity': 0.25})
        self.assertEqual({'kind': 'svg', 'svg': '<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>'}, answer.json())
        self.assertEqual(0.4, self.provider.calls[0][4])

    def test_requests_are_validated_before_the_provider_is_called(self):
        cases = [({'action': 'style', 'selectionPng': DATA_URL}, 'Write what the model should do'),
                 ({'action': 'enhance', 'scope': 'selection'}, 'Select objects, or choose the whole document as the context'),
                 ({'action': 'enhance', 'scope': 'document'}, 'The document image is missing'),
                 ({'action': 'enhance', 'selectionPng': 'data:image/jpeg;base64,AAAA'}, 'The selection image must be a PNG image'),
                 ({'action': 'enhance', 'selectionPng': 'data:image/png;base64,QUJD'}, 'The selection image is not a PNG under 20 MB')]
        for body, reason in cases:
            answer = self.call('POST', '/api/ai/generate', body)
            self.assertEqual((422, reason), (answer.status_code, answer.json()['detail']), body)
        self.assertEqual(422, self.call('POST', '/api/ai/generate', {'action': 'paint-a-mustache', 'selectionPng': DATA_URL}).status_code)
        self.assertEqual([], self.provider.calls)

    def test_without_a_token_the_user_is_told_where_to_save_one(self):
        self.call('DELETE', '/api/me/tokens/openai')
        answer = self.call('POST', '/api/ai/generate', {'action': 'enhance', 'selectionPng': DATA_URL})
        self.assertEqual((409, 'Save your OpenAI API token in Settings > External tokens first'), (answer.status_code, answer.json()['detail']))

    def test_prompts_are_saved_per_user(self):
        prompts = [{'id': 'p1', 'title': 'Watercolour', 'prompt': 'Paint it as a watercolour', 'action': 'style', 'creativity': 0.7, 'favorite': True}]
        self.assertEqual({'prompts': prompts}, self.call('PUT', '/api/me/prompts', {'prompts': prompts}).json())
        self.assertEqual({'prompts': prompts}, self.call('GET', '/api/me/prompts').json())
        self.assertEqual({'prompts': []}, self.call('GET', '/api/me/prompts', bearer=admin_token()).json())
        self.assertEqual(422, self.call('PUT', '/api/me/prompts', {'prompts': [{**prompts[0], 'id': '../x'}]}).status_code)


class HelperTests(unittest.TestCase):
    def test_svg_answers_are_extracted_and_screened(self):
        self.assertEqual('<svg><path d="M0 0"/></svg>', svg_from('Here it is:\n```svg\n<svg><path d="M0 0"/></svg>\n```'))
        for bad in ('no drawing here', '<svg><script>alert(1)</script></svg>', '<svg onload="x()"></svg>',
                    '<svg><a href="javascript:x"/></svg>', '<svg>' + 'x' * 2_000_001 + '</svg>'):
            with self.assertRaises(IdentityError):
                svg_from(bad)

    def test_png_data_urls_are_checked(self):
        self.assertIsNone(png_bytes(None, 'image'))
        self.assertEqual(PNG, png_bytes(DATA_URL, 'image'))
        with self.assertRaises(IdentityError):
            png_bytes('data:image/png;base64,!!', 'image')

    def test_the_instruction_names_each_image(self):
        text = instruction(GenerationRequest(action='remove-object', prompt='the lamp', scope='selection', creativity=0.5), True)
        self.assertIn('Remove the object the user names', text)
        self.assertIn('Image 2, when present, is the whole document', text)
        self.assertNotIn('strictly', text)


class OpenAiProviderTests(unittest.TestCase):
    def answer(self, body):
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(body).encode()
        return response

    def test_an_image_edit_sends_every_image_and_field(self):
        provider = OpenAiProvider(image_model='image-model', text_model='text-model')
        with mock.patch('urllib.request.urlopen', return_value=self.answer({'data': [{'b64_json': base64.b64encode(PNG).decode()}]})) as sent:
            self.assertEqual(PNG, provider.edit_image(SECRET, [PNG, PNG + b'2'], 'Do it', True))
        request = sent.call_args.args[0]
        body = request.data
        self.assertEqual(('https://api.openai.com/v1/images/edits', 'Bearer ' + SECRET), (request.full_url, request.headers['Authorization']))
        for piece in (b'name="model"\r\n\r\nimage-model', b'name="prompt"\r\n\r\nDo it', b'name="background"\r\n\r\ntransparent',
                      b'filename="image-1.png"', b'filename="image-2.png"', PNG + b'2'):
            self.assertIn(piece, body)

    def test_a_drawing_is_read_from_the_responses_answer(self):
        provider = OpenAiProvider(image_model='image-model', text_model='text-model')
        answer = {'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': '<svg><path d="M1 1"/></svg>'}]}]}
        with mock.patch('urllib.request.urlopen', return_value=self.answer(answer)) as sent:
            self.assertEqual('<svg><path d="M1 1"/></svg>', provider.vectorize(SECRET, PNG, 'Draw', 0.5))
        body = json.loads(sent.call_args.args[0].data)
        self.assertEqual(('text-model', 0.5), (body['model'], body['temperature']))
        self.assertTrue(body['input'][0]['content'][1]['image_url'].startswith('data:image/png;base64,'))

    def test_the_current_image_model_is_the_default(self):
        with mock.patch.dict('os.environ', {}, clear=False):
            import os
            os.environ.pop('XDS_OPENAI_IMAGE_MODEL', None)
            self.assertEqual('gpt-image-2.5-flare', OpenAiProvider().image_model)
        with mock.patch.dict('os.environ', {'XDS_OPENAI_IMAGE_MODEL': 'gpt-image-2.5-sunburst'}):
            self.assertEqual('gpt-image-2.5-sunburst', OpenAiProvider().image_model)

    def test_provider_failures_are_explained(self):
        provider = OpenAiProvider(image_model='m', text_model='t')
        cases = [(401, b'{}', 'OpenAI refused the token'), (429, b'{}', 'OpenAI limits the rate or quota of this token'),
                 (429, b'{"error": {"code": "insufficient_quota", "message": "You exceeded your current quota"}}',
                  'The OpenAI account of this token has no API credit left; add credit or raise its limit in the OpenAI billing settings'),
                 (429, b'{"error": {"code": "rate_limit_exceeded", "message": "Rate limit reached"}}',
                  'OpenAI limits how many requests this token can make per minute; wait a moment and try again'),
                 (429, b'{"error": {"type": "tokens", "message": "Too many tokens"}}', 'OpenAI limits the rate or quota of this token: Too many tokens'),
                 (400, b'{"error": {"message": "Invalid size"}}', 'OpenAI refused the request: Invalid size'),
                 (403, b'{"error": {"message": "Project `proj_x` does not have access to model `gpt-image-2.5-flare`"}}',
                  'OpenAI refused the request: Project `proj_x` does not have access to model `gpt-image-2.5-flare`. Allow the model in'
                  ' the limits of the OpenAI project, or verify the organization in its general settings'), (500, b'', 'OpenAI answered 500')]
        for code, body, reason in cases:
            with mock.patch('urllib.request.urlopen', side_effect=urllib.error.HTTPError('u', code, 'x', {}, io.BytesIO(body))):
                with self.assertRaises(IdentityError) as refused:
                    provider.edit_image(SECRET, [PNG], 'x', False)
            self.assertEqual(reason, refused.exception.reason)
        with mock.patch('urllib.request.urlopen', side_effect=urllib.error.URLError('down')):
            with self.assertRaises(IdentityError) as refused:
                provider.vectorize(SECRET, PNG, 'x', 0.5)
        self.assertEqual(504, refused.exception.status)
        with mock.patch('urllib.request.urlopen', return_value=self.answer({'data': []})):
            with self.assertRaises(IdentityError):
                provider.edit_image(SECRET, [PNG], 'x', False)


if __name__ == '__main__':
    unittest.main()
