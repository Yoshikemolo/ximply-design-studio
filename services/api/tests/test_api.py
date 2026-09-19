"""Local artifact auth and round-trip acceptance oracles."""
import copy
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from src.main import create_app, FileDocumentRepository

TOKEN = 'x' * 40
DOCUMENT = {'format': 'ximply-document', 'version': 1, 'name': 'A design', 'width': 800,
            'height': 600, 'background': '#ffffff', 'layers': []}


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.repository = FileDocumentRepository(Path(self.folder.name))
        self.client = TestClient(create_app(self.repository, TOKEN))
        self.headers = {'Authorization': 'Bearer ' + TOKEN}

    def test_health_and_unauthorized_paths(self):
        self.assertEqual(200, self.client.get('/api/health').status_code)
        self.assertEqual(401, self.client.get('/api/projects').status_code)
        self.assertEqual(401, self.client.post('/api/projects', json=DOCUMENT).status_code)
        self.assertEqual(401, self.client.get('/api/projects', headers={'Authorization': 'Bearer wrong'}).status_code)

    def test_missing_configuration_fails_closed(self):
        client = TestClient(create_app(self.repository, ''))
        self.assertEqual(503, client.get('/api/projects', headers=self.headers).status_code)

    def test_document_round_trip_and_listing(self):
        response = self.client.post('/api/projects', json=DOCUMENT, headers=self.headers)
        self.assertEqual(201, response.status_code)
        identifier = response.json()['id']
        self.assertEqual(DOCUMENT, self.client.get('/api/projects/'+identifier, headers=self.headers).json())
        items = self.client.get('/api/projects', headers=self.headers).json()
        self.assertEqual('A design', items[0]['name'])
        self.assertEqual([identifier+'.json'], [x.name for x in Path(self.folder.name).iterdir()])

    def test_invalid_documents_and_identifiers(self):
        for key, value in [('version', 2), ('width', 50000), ('background', 'url(secret)'), ('layers', [{}])]:
            document = copy.deepcopy(DOCUMENT)
            document[key] = value
            self.assertEqual(422, self.client.post('/api/projects', json=document, headers=self.headers).status_code)
        self.assertEqual(404, self.client.get('/api/projects/not-a-uuid', headers=self.headers).status_code)
        self.assertEqual(404, self.client.get('/api/projects/00000000-0000-0000-0000-000000000000', headers=self.headers).status_code)
        self.assertEqual(422, self.client.post('/api/projects', content='not json', headers=self.headers).status_code)

    def test_openapi_declares_security(self):
        schema = self.client.get('/api/openapi.json').json()
        self.assertIn('HTTPBearer', schema['components']['securitySchemes'])
        self.assertTrue(schema['paths']['/api/projects']['get']['security'])

    def test_storage_quota_payload_limit_and_corrupt_artifacts(self):
        from unittest.mock import patch
        with patch('src.main.MAX_DOCUMENT', 5):
            self.assertEqual(413, self.client.post('/api/projects', json=DOCUMENT, headers=self.headers).status_code)
        with patch('src.main.MAX_STORAGE', 1):
            self.assertEqual(507, self.client.post('/api/projects', json=DOCUMENT, headers=self.headers).status_code)
        invalid = Path(self.folder.name)/'00000000-0000-0000-0000-000000000000.json'
        invalid.write_text('not valid')
        self.assertEqual([], self.client.get('/api/projects', headers=self.headers).json())
        self.assertEqual(500, self.client.get('/api/projects/'+invalid.stem, headers=self.headers).status_code)
        from fastapi import HTTPException
        with self.assertRaises(HTTPException):
            self.repository.read('../outside')

    def test_layer_validation_and_editable_raster_round_trip(self):
        layer = {'id':'one','name':'Image','kind':'image','x':0,'y':0,'width':100,'height':100,
                 'rotation':0,'opacity':1,'visible':True,'locked':False,'blend':'source-over',
                 'fill':'#ffffff','stroke':'#000000','strokeWidth':1,'points':[],
                 'text':'','fontSize':48,'source':'data:image/png;base64,AAAA',
                 'adjustments':{'brightness':100,'contrast':100,'saturation':100,'blur':0}}
        document = {**DOCUMENT, 'layers':[layer]}
        response = self.client.post('/api/projects', json=document, headers=self.headers)
        self.assertEqual(201, response.status_code)
        saved = self.client.get('/api/projects/'+response.json()['id'], headers=self.headers).json()
        self.assertEqual(layer, saved['layers'][0])
        document['layers'] = [layer, layer]
        self.assertEqual(422, self.client.post('/api/projects', json=document, headers=self.headers).status_code)
        document['layers'] = [{**layer, 'source':'https://remote.example/image.png'}]
        self.assertEqual(422, self.client.post('/api/projects', json=document, headers=self.headers).status_code)

    def test_container_version_override_does_not_require_repository_layout(self):
        from unittest.mock import patch
        version = Path(self.folder.name)/'version.json'
        version.write_text('{"version":"0.2.0-alpha.1"}')
        with patch('src.main.__file__','/app/src/main.py'), patch.dict('os.environ', {'XDS_VERSION_FILE':str(version)}):
            client = TestClient(create_app(self.repository, TOKEN))
            self.assertEqual('0.2.0-alpha.1', client.get('/api/health').json()['version'])
