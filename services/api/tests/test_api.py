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

    def test_a3_at_three_hundred_dots_per_inch_is_stored(self):
        document = copy.deepcopy(DOCUMENT)
        document['width'], document['height'] = 3508, 4961
        self.assertEqual(201, self.client.post('/api/projects', json=document, headers=self.headers).status_code)
        document['width'], document['height'] = 3508, 9933
        self.assertEqual(422, self.client.post('/api/projects', json=document, headers=self.headers).status_code)

    def test_invalid_documents_and_identifiers(self):
        for key, value in [('version', 3), ('width', 50000), ('background', 'url(secret)'), ('layers', [{}])]:
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


class NativeDrawingTests(unittest.TestCase):
    """API acceptance cases for editable curves and reusable native symbols."""

    def setUp(self):
        ApiTests.setUp(self)
        self.anchor = {'point': {'x': 10, 'y': 20}, 'incoming': {'x': -5, 'y': 15},
                       'outgoing': {'x': 35, 'y': 40}, 'smooth': True}
        self.layer = {'id': 'curve-one', 'name': 'Editable curve', 'kind': 'path',
                      'x': 25, 'y': 40, 'width': 100, 'height': 100, 'rotation': 15,
                      'opacity': 0.75, 'visible': True, 'locked': False, 'blend': 'multiply',
                      'fill': '#336699', 'stroke': '#000000', 'strokeWidth': 2, 'points': [],
                      'text': '', 'fontSize': 48, 'source': '',
                      'adjustments': {'brightness': 100, 'contrast': 100, 'saturation': 100, 'blur': 0},
                      'curves': [{'nodes': [self.anchor, {'point': {'x': 90, 'y': 80},
                                  'incoming': {'x': 60, 'y': 95}, 'outgoing': {'x': 90, 'y': 80},
                                  'smooth': False}], 'closed': False}]}
        self.document = {**DOCUMENT, 'version': 2, 'layers': [self.layer]}

    def assert_round_trip(self, document):
        response = self.client.post('/api/projects', json=document, headers=self.headers)
        self.assertEqual(201, response.status_code, response.text)
        saved = self.client.get('/api/projects/' + response.json()['id'], headers=self.headers)
        self.assertEqual(document, saved.json())
        artifact = Path(self.folder.name) / (response.json()['id'] + '.json')
        import json
        self.assertEqual(document, json.loads(artifact.read_text()))

    def assert_invalid(self, document):
        response = self.client.post('/api/projects', json=document, headers=self.headers)
        self.assertEqual(422, response.status_code, response.text)
        self.assertEqual([], list(Path(self.folder.name).glob('*.json')))

    def test_shear_round_trip_and_omission(self):
        self.layer['skewX'] = 28.5
        self.assert_round_trip(self.document)
        del self.layer['skewX']
        self.assert_round_trip(self.document)

    def test_shear_contract_rejects_invalid_values_and_legacy_format(self):
        for value in (None, True, '45', 90, -90):
            with self.subTest(value=value):
                self.layer['skewX'] = value
                self.assert_invalid(self.document)
        self.layer['skewX'] = 0
        del self.layer['curves']
        self.document['version'] = 1
        self.assert_invalid(self.document)

    def test_cubic_controls_and_tracing_provenance_round_trip(self):
        self.layer['traceSourceId'] = 'raster-source'
        self.assert_round_trip(self.document)

    def test_symbol_definition_and_instance_round_trip(self):
        definition = copy.deepcopy(self.layer)
        definition['id'] = 'definition-layer'
        self.document['symbols'] = [{'id': 'symbol-one', 'name': 'Mark', 'layer': definition}]
        self.layer['symbolId'] = 'symbol-one'
        self.assert_round_trip(self.document)

    def test_version_one_layer_is_preserved_without_new_fields(self):
        del self.layer['curves']
        self.document['version'] = 1
        self.assert_round_trip(self.document)

    def test_version_one_rejects_drawing_extensions_even_empty(self):
        del self.layer['curves']
        self.document['version'] = 1
        for key, value in [('curves', []), ('traceSourceId', 'image-source')]:
            with self.subTest(key=key):
                document = copy.deepcopy(self.document)
                document['layers'][0][key] = value
                self.assert_invalid(document)
        self.assert_invalid({**self.document, 'symbols': []})

    def test_explicit_null_extensions_are_invalid(self):
        for key in ('curves', 'symbolId', 'traceSourceId'):
            with self.subTest(key=key):
                document = copy.deepcopy(self.document)
                document['layers'][0][key] = None
                self.assert_invalid(document)
        self.assert_invalid({**self.document, 'symbols': None})

    def test_malformed_nodes_and_non_boolean_flags_are_invalid(self):
        for node in [{}, {**self.anchor, 'incoming': None}, {**self.anchor, 'smooth': 'true'},
                     {**self.anchor, 'smooth': 1}, {**self.anchor, 'unexpected': 1}]:
            with self.subTest(node=node):
                document = copy.deepcopy(self.document)
                document['layers'][0]['curves'][0]['nodes'] = [node]
                self.assert_invalid(document)
        self.layer['curves'][0]['closed'] = 'false'
        self.assert_invalid(self.document)

    def test_control_coordinates_reject_nonfinite_coercion_and_out_of_bounds(self):
        import json
        for coordinate in (float('inf'), float('-inf'), float('nan'), 100001, -100001, '3', True):
            with self.subTest(coordinate=coordinate):
                document = copy.deepcopy(self.document)
                document['layers'][0]['curves'][0]['nodes'][0]['incoming']['x'] = coordinate
                response = self.client.post('/api/projects', content=json.dumps(document), headers=self.headers)
                self.assertEqual(422, response.status_code, response.text)
        self.assertEqual([], list(Path(self.folder.name).glob('*.json')))

    def test_curve_node_budget_is_cumulative_across_subpaths(self):
        self.layer['curves'] = [{'nodes': [self.anchor] * 10001, 'closed': False},
                                {'nodes': [self.anchor] * 10000, 'closed': False}]
        self.assert_invalid(self.document)

    def test_curve_budget_allows_exact_limit(self):
        self.layer['curves'] = [{'nodes': [self.anchor] * 10000, 'closed': False},
                                {'nodes': [self.anchor] * 10000, 'closed': False}]
        self.assert_round_trip(self.document)

    def test_curve_path_count_and_non_path_layer_are_invalid(self):
        self.layer['curves'] = [{'nodes': [], 'closed': False}] * 4097
        self.assert_invalid(self.document)
        self.layer['curves'] = []
        self.layer['kind'] = 'rectangle'
        self.assert_invalid(self.document)

    def test_unknown_symbol_duplicate_definitions_and_recursive_symbols_are_invalid(self):
        self.layer['symbolId'] = 'missing'
        self.assert_invalid(self.document)
        del self.layer['symbolId']
        definition = {'id': 'symbol-one', 'name': 'Mark', 'layer': copy.deepcopy(self.layer)}
        self.document['symbols'] = [definition, copy.deepcopy(definition)]
        self.assert_invalid(self.document)
        self.document['symbols'] = [definition]
        definition['layer']['symbolId'] = 'symbol-one'
        self.assert_invalid(self.document)

    def test_symbol_definition_has_same_curve_limits_as_document_layer(self):
        definition = copy.deepcopy(self.layer)
        definition['curves'][0]['nodes'][0]['outgoing']['y'] = 100001
        self.document['symbols'] = [{'id': 'symbol-one', 'name': 'Mark', 'layer': definition}]
        self.assert_invalid(self.document)

    def test_symbol_definition_enforces_cumulative_node_budget(self):
        definition = copy.deepcopy(self.layer)
        definition['curves'] = [{'nodes': [self.anchor] * 10001, 'closed': False},
                                {'nodes': [self.anchor] * 10000, 'closed': True}]
        self.document['symbols'] = [{'id': 'symbol-one', 'name': 'Mark', 'layer': definition}]
        self.assert_invalid(self.document)

    def test_nested_group_path_round_trip(self):
        self.layer['groupPath'] = ['composition', 'mark', 'detail']
        self.assert_round_trip(self.document)

    def test_invalid_group_paths_are_rejected(self):
        for group_path in (['same', 'same'], [str(index) for index in range(17)],
                           None, [''], ['x' * 101], [123], 'group'):
            with self.subTest(group_path=group_path):
                document = copy.deepcopy(self.document)
                document['layers'][0]['groupPath'] = group_path
                self.assert_invalid(document)

    def test_group_path_requires_version_two_even_when_empty(self):
        del self.layer['curves']
        self.document['version'] = 1
        for group_path in ([], ['group-one']):
            with self.subTest(group_path=group_path):
                self.layer['groupPath'] = group_path
                self.assert_invalid(self.document)

    def test_group_path_exact_depth_limit_round_trip(self):
        self.layer['groupPath'] = [str(index) for index in range(16)]
        self.assert_round_trip(self.document)

    def test_mirrored_vector_and_image_round_trip(self):
        self.layer.update(flipX=True, flipY=False)
        image = copy.deepcopy(self.layer)
        del image['curves']
        image.update(id='image-one', kind='image', flipX=False, flipY=True,
                     source='data:image/png;base64,AAAA')
        self.document['layers'].append(image)
        self.assert_round_trip(self.document)

    def test_mirror_flags_reject_null_and_non_boolean_values(self):
        for key in ('flipX', 'flipY'):
            for value in (None, 0, 1, 'true', 'false', [], {}):
                with self.subTest(key=key, value=value):
                    document = copy.deepcopy(self.document)
                    document['layers'][0][key] = value
                    self.assert_invalid(document)

    def test_mirror_flags_require_version_two_even_when_false(self):
        del self.layer['curves']
        self.document['version'] = 1
        for key in ('flipX', 'flipY'):
            for value in (False, True):
                with self.subTest(key=key, value=value):
                    document = copy.deepcopy(self.document)
                    document['layers'][0][key] = value
                    self.assert_invalid(document)

    def test_guide_and_transparent_paint_round_trip(self):
        self.layer.update(guide='vertical', fill='none', stroke='none', groupPath=[])
        self.assert_round_trip(self.document)
        self.layer.update(guide='horizontal', stroke='#ffffff', x=-100000, y=100000)
        self.assert_round_trip(self.document)

    def test_transparent_paints_on_artwork_and_symbol_definitions_round_trip(self):
        self.layer.update(fill='none', stroke='none')
        definition = copy.deepcopy(self.layer)
        self.document['symbols'] = [{'id': 'clear-symbol', 'name': 'Clear', 'layer': definition}]
        self.layer['symbolId'] = 'clear-symbol'
        self.assert_round_trip(self.document)

    def test_transparent_paints_do_not_relax_the_color_contract(self):
        for key in ('fill', 'stroke'):
            for value in ('transparent', 'NONE', '#fff0', '#fffffff', '#fffffffff', '#ffffffgg', '#fff', '', None, False):
                with self.subTest(key=key, value=value):
                    document = copy.deepcopy(self.document)
                    document['layers'][0][key] = value
                    self.assert_invalid(document)
        for background in ('transparent', '#fff0', '#fff', '', None, False):
            with self.subTest(background=background):
                self.assert_invalid({**self.document, 'background': background})

    def test_guides_reject_invalid_orientation_kind_and_grouping(self):
        for value in ('diagonal', '', None, False, 0):
            with self.subTest(guide=value):
                document = copy.deepcopy(self.document)
                document['layers'][0]['guide'] = value
                self.assert_invalid(document)
        self.layer['guide'] = 'vertical'
        del self.layer['curves']
        for kind in ('rectangle', 'ellipse', 'image', 'text'):
            with self.subTest(kind=kind):
                document = copy.deepcopy(self.document)
                document['layers'][0]['kind'] = kind
                self.assert_invalid(document)
        self.layer['groupPath'] = ['group-one']
        self.assert_invalid(self.document)

    def test_guides_cannot_be_symbol_instances_or_definitions(self):
        definition = copy.deepcopy(self.layer)
        self.document['symbols'] = [{'id': 'symbol-one', 'name': 'Mark', 'layer': definition}]
        self.layer.update(guide='vertical', symbolId='symbol-one')
        self.assert_invalid(self.document)
        del self.layer['symbolId']
        del self.layer['guide']
        definition['guide'] = 'horizontal'
        self.assert_invalid(self.document)

    def test_guides_and_transparent_paints_require_native_version_two(self):
        del self.layer['curves']
        self.document['version'] = 1
        for key, value in (('guide', 'vertical'), ('guide', 'horizontal'), ('fill', 'none'), ('stroke', 'none')):
            with self.subTest(key=key, value=value):
                document = copy.deepcopy(self.document)
                document['layers'][0][key] = value
                self.assert_invalid(document)

    def test_guide_positions_remain_finite_bounded_numbers(self):
        import json
        self.layer['guide'] = 'vertical'
        for axis in ('x', 'y'):
            for value in (float('inf'), float('-inf'), float('nan'), -100001, 100001, True, '12'):
                with self.subTest(axis=axis, value=value):
                    document = copy.deepcopy(self.document)
                    document['layers'][0][axis] = value
                    response = self.client.post('/api/projects', content=json.dumps(document), headers=self.headers)
                    self.assertEqual(422, response.status_code, response.text)
        self.assertEqual([], list(Path(self.folder.name).glob('*.json')))


    def test_independent_alpha_paints_round_trip_on_artwork_and_symbols(self):
        self.layer.update(fill='#33669980', stroke='#abcdef40')
        definition = copy.deepcopy(self.layer)
        definition.update(fill='#FFFFFF00', stroke='#000000FF')
        self.document['symbols'] = [{'id': 'alpha-symbol', 'name': 'Alpha', 'layer': definition}]
        self.layer['symbolId'] = 'alpha-symbol'
        self.assert_round_trip(self.document)

    def test_transparent_page_background_round_trips(self):
        for background in ('#ffffff80', 'none'):
            with self.subTest(background=background):
                self.assert_round_trip({**copy.deepcopy(self.document), 'background': background})

    def test_alpha_paints_require_native_version_two(self):
        self.assert_invalid({**self.document, 'background': '#ffffffzz'})
        del self.layer['curves']
        self.document['version'] = 1
        for key in ('fill', 'stroke'):
            for value in ('#12345600', '#123456ff'):
                with self.subTest(key=key, value=value):
                    document = copy.deepcopy(self.document)
                    document['layers'][0][key] = value
                    self.assert_invalid(document)

    def text_document(self):
        document = copy.deepcopy(self.document)
        layer = document['layers'][0]
        del layer['curves']
        layer.update(kind='text', text='Engineering\nTipografía',
                     textLayout={'sizing': 'fixed', 'wrap': True, 'hyphenate': True, 'fit': True},
                     typography={'fontFamily': 'Arial', 'fontWeight': 400, 'fontStyle': 'italic',
                                 'lineHeight': 0, 'letterSpacing': -1.5, 'wordSpacing': 3,
                                 'paragraphSpacing': 12, 'horizontalScale': 1.2, 'verticalScale': 0.9,
                                 'baselineShift': 2, 'align': 'justify', 'decoration': 'underline', 'language': 'es'})
        return document

    def test_typography_and_layout_round_trip_for_text_and_symbols(self):
        document = self.text_document()
        definition = copy.deepcopy(document['layers'][0])
        document['symbols'] = [{'id': 'text-symbol', 'name': 'Text', 'layer': definition}]
        document['layers'][0]['symbolId'] = 'text-symbol'
        self.assert_round_trip(document)
        for sizing in ('content', 'width', 'height'):
            with self.subTest(sizing=sizing):
                document['layers'][0]['textLayout'].update(sizing=sizing, fit=False)
                self.assert_round_trip(document)

    def test_text_extensions_are_full_non_null_objects_for_text_only(self):
        for extension in ('textLayout', 'typography'):
            for value in (None, {}, [], 'text'):
                with self.subTest(extension=extension, value=value):
                    document = self.text_document()
                    document['layers'][0][extension] = value
                    self.assert_invalid(document)
            for field in self.text_document()['layers'][0][extension]:
                with self.subTest(extension=extension, missing=field):
                    document = self.text_document()
                    del document['layers'][0][extension][field]
                    self.assert_invalid(document)
            document = self.text_document()
            document['layers'][0][extension]['extra'] = 1
            self.assert_invalid(document)
            document = self.text_document()
            other = 'typography' if extension == 'textLayout' else 'textLayout'
            del document['layers'][0][other]
            for kind in ('path', 'image', 'ellipse', 'rectangle'):
                document['layers'][0]['kind'] = kind
                self.assert_invalid(document)
            document['layers'][0]['kind'] = 'text'
            document['version'] = 1
            self.assert_invalid(document)

    def test_invalid_nested_symbol_text_extensions_are_rejected(self):
        document = self.text_document()
        definition = copy.deepcopy(document['layers'][0])
        document['symbols'] = [{'id': 'text-symbol', 'name': 'Text', 'layer': definition}]
        definition['kind'] = 'rectangle'
        self.assert_invalid(document)
        definition['kind'] = 'text'
        definition['typography']['language'] = 'xx'
        self.assert_invalid(document)
        definition['typography']['language'] = 'es'
        document['version'] = 1
        self.assert_invalid(document)

    def test_text_layout_boolean_flags_and_fit_modes_are_strict(self):
        for field in ('wrap', 'hyphenate', 'fit'):
            for value in (0, 1, 'true', None):
                with self.subTest(field=field, value=value):
                    document = self.text_document()
                    document['layers'][0]['textLayout'][field] = value
                    self.assert_invalid(document)
        for sizing in ('content', 'width', 'height', 'other'):
            document = self.text_document()
            document['layers'][0]['textLayout']['sizing'] = sizing
            self.assert_invalid(document)

    def test_typography_numeric_bounds_types_and_discrete_weight(self):
        import json
        bounds = {'fontWeight': (100, 900), 'lineHeight': (0, 2000), 'letterSpacing': (-100, 500),
                  'wordSpacing': (-100, 1000), 'paragraphSpacing': (0, 2000),
                  'horizontalScale': (0.1, 10), 'verticalScale': (0.1, 10), 'baselineShift': (-1000, 1000)}
        for field, (minimum, maximum) in bounds.items():
            for value in (minimum - 1, maximum + 1, True, '1', None, float('nan'), float('inf')):
                with self.subTest(field=field, value=value):
                    document = self.text_document()
                    document['layers'][0]['typography'][field] = value
                    response = self.client.post('/api/projects', content=json.dumps(document), headers=self.headers)
                    self.assertEqual(422, response.status_code, response.text)
        document = self.text_document()
        document['layers'][0]['typography']['fontWeight'] = 450
        self.assert_invalid(document)
        for index in (0, 1):
            document = self.text_document()
            document['layers'][0]['typography'].update({field: values[index] for field, values in bounds.items()})
            self.assert_round_trip(document)

    def test_typography_enumerations_reject_unsupported_values(self):
        for field, value in [('fontFamily', 'url(remote-font)'), ('fontStyle', 'oblique'),
                             ('align', 'start'), ('decoration', 'overline'), ('language', 'fr')]:
            with self.subTest(field=field):
                document = self.text_document()
                document['layers'][0]['typography'][field] = value
                self.assert_invalid(document)

    def test_stroke_style_round_trip_on_layer_and_symbol(self):
        self.layer['strokeStyle'] = {'alignment': 'inside', 'join': 'miter', 'cap': 'square'}
        definition = copy.deepcopy(self.layer)
        definition['strokeStyle'] = {'alignment': 'outside', 'join': 'bevel', 'cap': 'round'}
        self.document['symbols'] = [{'id': 'stroke-symbol', 'name': 'Stroke', 'layer': definition}]
        self.layer['symbolId'] = 'stroke-symbol'
        self.assert_round_trip(self.document)
        self.layer['strokeStyle'] = {'alignment': 'center', 'join': 'round', 'cap': 'butt'}
        self.assert_round_trip(self.document)

    def test_stroke_style_requires_exact_complete_object(self):
        for value in (None, {}, [], 'round',
                      {'alignment': 'inside', 'join': 'miter'},
                      {'alignment': 'inside', 'cap': 'round'},
                      {'join': 'miter', 'cap': 'round'},
                      {'alignment': 'center', 'join': 'round', 'cap': 'butt', 'extra': True}):
            with self.subTest(value=value):
                document = copy.deepcopy(self.document)
                document['layers'][0]['strokeStyle'] = value
                self.assert_invalid(document)
        for field in ('alignment', 'join', 'cap'):
            for value in ('unknown', None, True, 1):
                with self.subTest(field=field, value=value):
                    document = copy.deepcopy(self.document)
                    document['layers'][0]['strokeStyle'] = {'alignment': 'center', 'join': 'round', 'cap': 'butt', field: value}
                    self.assert_invalid(document)

    def test_dash_patterns_round_trip(self):
        document = copy.deepcopy(self.document)
        document['layers'][0]['strokeStyle'] = {'alignment': 'center', 'join': 'round', 'cap': 'butt', 'dash': [24, 6, 4, 6]}
        self.assert_round_trip(document)

    def test_dash_patterns_reject_unusable_sequences(self):
        for dash in ([], [0], [0, 4], [-1, 4], [1001, 2], [1, 2, 3, 4, 5, 6, 7], ['4', 2], None):
            with self.subTest(dash=dash):
                document = copy.deepcopy(self.document)
                document['layers'][0]['strokeStyle'] = {'alignment': 'center', 'join': 'round', 'cap': 'butt', 'dash': dash}
                self.assert_invalid(document)

    def test_stroke_style_is_native_v2_only_and_validated_inside_symbols(self):
        self.layer['strokeStyle'] = {'alignment': 'center', 'join': 'round', 'cap': 'butt'}
        del self.layer['curves']
        self.document['version'] = 1
        self.assert_invalid(self.document)
        self.document['version'] = 2
        definition = copy.deepcopy(self.layer)
        definition['strokeStyle']['join'] = 'arcs'
        self.document['symbols'] = [{'id': 'invalid-stroke', 'name': 'Stroke', 'layer': definition}]
        self.assert_invalid(self.document)

    def blended_document(self):
        document = copy.deepcopy(self.document)
        layers = []
        for identifier in ('back', 'step', 'front'):
            layer = copy.deepcopy(self.layer)
            layer.update(id=identifier, groupPath=['blend-group'])
            if identifier == 'step':
                layer['groupPath'].append('step')
            layers.append(layer)
        document.update(layers=layers, blends=[{'id': 'blend-one', 'groupId': 'blend-group',
                        'backIds': ['back'], 'frontIds': ['front'], 'stepIds': [['step']],
                        'steps': 1, 'easing': 'linear'}])
        return document

    def test_object_blend_metadata_and_generated_layers_round_trip(self):
        for easing in ('linear', 'ease-in', 'ease-out', 'ease-in-out'):
            document = self.blended_document()
            document['blends'][0]['easing'] = easing
            self.assert_round_trip(document)
        self.assert_round_trip({**self.document, 'blends': []})

    def test_blends_require_exact_non_null_native_v2_metadata(self):
        for value in (None, {}, [{}], 'blend'):
            self.assert_invalid({**self.document, 'blends': value})
        document = self.blended_document()
        for field in document['blends'][0]:
            with self.subTest(missing=field):
                candidate = copy.deepcopy(document)
                del candidate['blends'][0][field]
                self.assert_invalid(candidate)
        document['blends'][0]['extra'] = True
        self.assert_invalid(document)
        self.assert_invalid({**DOCUMENT, 'blends': []})

    def test_blend_step_counts_easing_and_id_types_are_strict(self):
        for field, values in {'steps': [0, 101, 1.5, True, '1'], 'easing': ['smooth', None],
                              'id': ['', 'x' * 101, 1], 'groupId': ['', None],
                              'backIds': [[], [1]], 'frontIds': [[], ['missing']],
                              'stepIds': [[], [[]], [['missing']]]}.items():
            for value in values:
                with self.subTest(field=field, value=value):
                    document = self.blended_document()
                    document['blends'][0][field] = value
                    self.assert_invalid(document)

    def test_blend_cardinality_duplicate_and_missing_references_are_rejected(self):
        for changes in ({'backIds': ['missing']}, {'frontIds': ['back']}, {'steps': 2},
                        {'backIds': ['back', 'front']}, {'stepIds': [['step', 'front']]},
                        {'stepIds': [['back']]}):
            document = self.blended_document()
            document['blends'][0].update(changes)
            self.assert_invalid(document)
        document = self.blended_document()
        document['blends'].append(copy.deepcopy(document['blends'][0]))
        self.assert_invalid(document)
        document['blends'][1].update(id='other-blend', groupId='other-group')
        self.assert_invalid(document)

    def test_blend_group_membership_subgroups_and_layer_order_are_validated(self):
        for group_path in ([], ['other'], ['blend-group', 'wrong-step'], ['blend-group', 'step', 'nested']):
            document = self.blended_document()
            document['layers'][1]['groupPath'] = group_path
            self.assert_invalid(document)
        document = self.blended_document()
        document['layers'].reverse()
        self.assert_invalid(document)
        document = self.blended_document()
        extra = copy.deepcopy(document['layers'][0])
        extra['id'] = 'extra'
        document['layers'].append(extra)
        self.assert_invalid(document)
        extra['groupPath'] = ['outside-group']
        document['layers'].insert(1, document['layers'].pop())
        self.assert_invalid(document)

    def test_blends_reject_text_images_guides_and_symbol_instances(self):
        for index in range(3):
            for kind in ('text', 'image'):
                document = self.blended_document()
                layer = document['layers'][index]
                layer['kind'] = kind
                del layer['curves']
                self.assert_invalid(document)
            document = self.blended_document()
            document['layers'][index]['guide'] = 'vertical'
            self.assert_invalid(document)
            document = self.blended_document()
            definition = copy.deepcopy(self.layer)
            document['symbols'] = [{'id': 'symbol-one', 'name': 'Mark', 'layer': definition}]
            document['layers'][index]['symbolId'] = 'symbol-one'
            self.assert_invalid(document)

    def test_blend_nested_parent_group_round_trip(self):
        document = self.blended_document()
        for layer in document['layers']:
            layer['groupPath'].insert(0, 'outer')
        self.assert_round_trip(document)

    def test_blends_reject_incompatible_contours_and_node_budgets(self):
        for nodes, closed in (([], False), ([self.anchor], False), ([self.anchor] * 2, True),
                              ([self.anchor] * 257, False), ([self.anchor] * 3, True)):
            document = self.blended_document()
            document['layers'][2]['curves'] = [{'nodes': nodes, 'closed': closed}]
            self.assert_invalid(document)
        document = self.blended_document()
        document['layers'][2]['curves'] *= 2
        self.assert_invalid(document)
        document = self.blended_document()
        for layer in document['layers']:
            layer['curves'] = []
        self.assert_invalid(document)

    def dimension_data(self, kind='linear'):
        return {'kind': kind, 'anchors': [{'x': 0, 'y': 0}, {'x': 96, 'y': 0}] +
                ([{'x': 96, 'y': 96}] if kind == 'angular' else []),
                'labelPosition': {'x': 48, 'y': -20}, 'text': '',
                'format': {'scale': 1, 'unit': 'in', 'decimals': 2, 'separator': '.'},
                'extension': {'stroke': '#00000080', 'strokeWidth': 1, 'gap': 2, 'overshoot': 4}}

    def test_dimension_and_line_ends_round_trip(self):
        self.layer['lineEnds'] = {'start': {'kind': 'triangle', 'placement': 'tip', 'size': 10},
                                 'end': {'kind': 'slash', 'placement': 'base', 'size': 8}, 'linked': False}
        for kind in ('linear', 'angular'):
            self.layer['dimension'] = self.dimension_data(kind)
            self.layer['textLayout'] = {'sizing': 'fixed', 'wrap': True, 'hyphenate': False, 'fit': True}
            self.assert_round_trip(self.document)

    def test_dimension_format_bounds_and_types(self):
        for field, invalid in {'scale': [0, -1, 1000001, True, '2'],
                               'unit': ['yd', '', None], 'decimals': [-1, 9, 1.5, True, '2'],
                               'separator': [';', '', None]}.items():
            for value in invalid:
                with self.subTest(field=field, value=value):
                    self.layer['dimension'] = self.dimension_data()
                    self.layer['dimension']['format'][field] = value
                    self.assert_invalid(self.document)

    def test_dimensions_reject_missing_extra_null_and_wrong_cardinality(self):
        for section in (None, 'format', 'extension', 'labelPosition'):
            original = self.dimension_data()
            target = original if section is None else original[section]
            for field in list(target):
                candidate = copy.deepcopy(original)
                nested = candidate if section is None else candidate[section]
                del nested[field]
                self.layer['dimension'] = candidate
                self.assert_invalid(self.document)
            target['extra'] = 1
            self.layer['dimension'] = original
            self.assert_invalid(self.document)
        for value in (None, {}, [], 'linear'):
            self.layer['dimension'] = value
            self.assert_invalid(self.document)
        for kind, count in (('linear', 3), ('angular', 2)):
            self.layer['dimension'] = self.dimension_data('angular')
            self.layer['dimension'].update(kind=kind, anchors=self.layer['dimension']['anchors'][:count])
            self.assert_invalid(self.document)

    def test_dimension_coordinates_extension_and_text_limits(self):
        for field in ('strokeWidth', 'gap', 'overshoot'):
            for value in (-1, 1001, True, '2'):
                self.layer['dimension'] = self.dimension_data()
                self.layer['dimension']['extension'][field] = value
                self.assert_invalid(self.document)
        for point in ('anchor', 'label'):
            for value in (-10000001, 10000001, True, '2'):
                self.layer['dimension'] = self.dimension_data()
                target = (self.layer['dimension']['anchors'][0] if point == 'anchor'
                          else self.layer['dimension']['labelPosition'])
                target['x'] = value
                self.assert_invalid(self.document)
        self.layer['dimension'] = self.dimension_data()
        self.layer['dimension']['text'] = 'a' * 10001
        self.assert_invalid(self.document)
        self.layer['dimension']['text'] = ''
        self.layer['dimension']['extension']['stroke'] = 'red'
        self.assert_invalid(self.document)

    def test_dimension_incompatible_layers_symbols_and_blends(self):
        for kind in ('rectangle', 'ellipse', 'text', 'image'):
            document = copy.deepcopy(self.document)
            document['layers'][0].update(kind=kind, dimension=self.dimension_data())
            document['layers'][0].pop('curves')
            self.assert_invalid(document)
        self.layer['dimension'] = self.dimension_data()
        self.layer['guide'] = 'vertical'
        self.assert_invalid(self.document)
        del self.layer['guide']
        self.document['symbols'] = [{'id': 'dim-symbol', 'name': 'Dimension', 'layer': copy.deepcopy(self.layer)}]
        self.assert_invalid(self.document)
        self.document['symbols'][0]['layer'].pop('dimension')
        self.layer['symbolId'] = 'dim-symbol'
        self.assert_invalid(self.document)
        for index in range(3):
            document = self.blended_document()
            for layer in document['layers']:
                layer.pop('dimension', None)
                layer.pop('symbolId', None)
            document['layers'][index]['dimension'] = self.dimension_data()
            self.assert_invalid(document)

    def test_line_end_styles_and_strict_nested_validation(self):
        base = {'start': {'kind': 'none', 'placement': 'tip', 'size': 10},
                'end': {'kind': 'arrow', 'placement': 'base', 'size': 10}, 'linked': True}
        for kind in ('none', 'arrow', 'openArrow', 'triangle', 'dot', 'slash', 'cross'):
            self.layer['lineEnds'] = copy.deepcopy(base)
            self.layer['lineEnds']['start']['kind'] = kind
            self.assert_round_trip(self.document)

    def test_line_end_nested_types_are_strict(self):
        base = {'start': {'kind': 'none', 'placement': 'tip', 'size': 10},
                'end': {'kind': 'arrow', 'placement': 'base', 'size': 10}, 'linked': True}
        for value in (None, {}, {**base, 'linked': 1}, {**base, 'extra': True}):
            self.layer['lineEnds'] = value
            self.assert_invalid(self.document)
        for side in ('start', 'end'):
            for field, invalid in {'kind': ['square', None], 'placement': ['center', None],
                                   'size': [0, -1, 1001, True, '10']}.items():
                for value in invalid:
                    self.layer['lineEnds'] = copy.deepcopy(base)
                    self.layer['lineEnds'][side][field] = value
                    self.assert_invalid(self.document)

    def test_new_extensions_require_version_two_and_non_null_regroup_path(self):
        for field, value in (('regroupPath', ['outer', 'inner']), ('dimension', self.dimension_data()),
                             ('lineEnds', {'start': {'kind': 'none', 'placement': 'tip', 'size': 1},
                                           'end': {'kind': 'none', 'placement': 'tip', 'size': 1}, 'linked': True})):
            document = copy.deepcopy(self.document)
            document['layers'][0].pop('curves')
            document['layers'][0][field] = value
            document['version'] = 1
            self.assert_invalid(document)
        for value in (None, ['a', 'a'], [''], ['x' * 101], list(map(str, range(17))), [1], 'group'):
            self.layer['regroupPath'] = value
            self.assert_invalid(self.document)
        self.layer['regroupPath'] = ['outer', 'inner']
        self.assert_round_trip(self.document)


    def test_dimension_label_size_is_optional_and_bounded(self):
        for value in (None, {}, {'width': 10}, {'width': 10, 'height': 10, 'extra': 1},
                      {'width': 0, 'height': 10}, {'width': 10, 'height': 1000001},
                      {'width': True, 'height': 10}, {'width': 10, 'height': '10'}):
            self.layer['dimension'] = {**self.dimension_data(), 'labelSize': value}
            self.assert_invalid(self.document)
        self.layer['dimension'] = {**self.dimension_data(), 'labelSize': {'width': 1, 'height': 1000000}}
        self.assert_round_trip(self.document)

    def test_dimension_and_endings_reject_nonfinite_values(self):
        from pydantic import ValidationError
        from src.main import Document
        for value in (float('nan'), float('inf'), -float('inf')):
            for field in ('scale', 'decimals'):
                self.layer['dimension'] = self.dimension_data()
                self.layer['dimension']['format'][field] = value
                with self.assertRaises(ValidationError):
                    Document.model_validate(self.document)
            self.layer.pop('dimension')
            self.layer['lineEnds'] = {'start': {'kind': 'arrow', 'placement': 'tip', 'size': value},
                                     'end': {'kind': 'none', 'placement': 'tip', 'size': 1}, 'linked': False}
            with self.assertRaises(ValidationError):
                Document.model_validate(self.document)
            self.layer.pop('lineEnds')

    def test_line_ends_are_preserved_and_validated_in_symbol_definitions(self):
        definition = copy.deepcopy(self.layer)
        definition['lineEnds'] = {'start': {'kind': 'dot', 'placement': 'tip', 'size': 1000},
                                  'end': {'kind': 'cross', 'placement': 'base', 'size': 1}, 'linked': False}
        self.document['symbols'] = [{'id': 'ended-symbol', 'name': 'Ended', 'layer': definition}]
        self.layer['symbolId'] = 'ended-symbol'
        definition['lineEnds']['end']['extra'] = 1
        self.assert_invalid(self.document)
        definition['lineEnds']['end'].pop('extra')
        self.assert_round_trip(self.document)


class ProceduralTests(unittest.TestCase):
    """Parameter and reference acceptance; generated geometry is frontend-owned."""

    setUp = NativeDrawingTests.setUp
    assert_round_trip = NativeDrawingTests.assert_round_trip
    assert_invalid = NativeDrawingTests.assert_invalid
    dimension_data = NativeDrawingTests.dimension_data
    blended_document = NativeDrawingTests.blended_document

    def procedural_data(self, kind):
        if kind == 'wall':
            return {'type': 'wall', 'start': {'x': 0, 'y': 0}, 'end': {'x': 400, 'y': 0}, 'thickness': 16}
        if kind == 'pillar':
            return {'type': 'pillar', 'shape': 'rectangle', 'width': 40, 'depth': 80}
        return {'type': kind, 'width': 100, 'depth': 16, 'leafWidths': [40, 60],
                'operation': 'swing', 'swing': 'left', 'openingAngle': 90}

    def test_procedural_parameters_and_generated_cache_round_trip(self):
        for kind in ('wall', 'door', 'window', 'pillar'):
            self.layer['procedural'] = self.procedural_data(kind)
            self.assert_round_trip(self.document)

    def test_procedural_exact_fields_and_null_types(self):
        for kind in ('wall', 'door', 'window', 'pillar'):
            original = self.procedural_data(kind)
            for field in original:
                self.layer['procedural'] = copy.deepcopy(original)
                del self.layer['procedural'][field]
                self.assert_invalid(self.document)
            self.layer['procedural'] = {**original, 'script': 'return arbitraryGeometry()'}
            self.assert_invalid(self.document)
        for value in (None, [], {}, 'wall', {'type': 'script'}):
            self.layer['procedural'] = value
            self.assert_invalid(self.document)

    def test_procedural_length_numeric_bounds_are_strict(self):
        for kind, fields in {'wall': ['thickness'], 'door': ['width', 'depth'],
                             'window': ['width', 'depth'], 'pillar': ['width', 'depth']}.items():
            for field in fields:
                for value in (0, 0.9, 16385, True, '16', None):
                    with self.subTest(kind=kind, field=field, value=value):
                        self.layer['procedural'] = self.procedural_data(kind)
                        self.layer['procedural'][field] = value
                        self.assert_invalid(self.document)
        for length in (0, 0.9, 16385):
            self.layer['procedural'] = self.procedural_data('wall')
            self.layer['procedural']['end']['x'] = length
            self.assert_invalid(self.document)
        self.layer['procedural'] = self.procedural_data('wall')
        self.layer['procedural']['start']['x'] = -10000001
        self.assert_invalid(self.document)

    def test_procedural_leaves_and_operations(self):
        for kind, maximum in (('door', 4), ('window', 8)):
            for widths in ([], [0, 100], [50, 49], [True, 99], ['40', 60], [100 / (maximum + 1)] * (maximum + 1)):
                self.layer['procedural'] = {**self.procedural_data(kind), 'leafWidths': widths}
                self.assert_invalid(self.document)
            for field, values in {'operation': ['rotate', None, ['swing']], 'swing': ['top', None, ['left']],
                                   'openingAngle': [-1, 181, True, '90']}.items():
                for value in values:
                    self.layer['procedural'] = {**self.procedural_data(kind), field: value}
                    self.assert_invalid(self.document)
        self.layer['procedural'] = {**self.procedural_data('door'), 'operation': 'fixed'}
        self.assert_invalid(self.document)

    def test_procedural_supported_variants_and_boundary_leaf_counts(self):
        for kind, operations, count in (('door', ('swing', 'sliding'), 4),
                                         ('window', ('fixed', 'sliding', 'swing'), 8)):
            for operation in operations:
                self.layer['procedural'] = {**self.procedural_data(kind), 'operation': operation,
                                             'swing': 'right', 'leafWidths': [100 / count] * count,
                                             'openingAngle': 180}
                self.assert_round_trip(self.document)
        self.layer['procedural'] = {'type': 'pillar', 'shape': 'circle', 'width': 16384, 'depth': 16384}
        self.assert_round_trip(self.document)
        self.layer['procedural'] = {'type': 'wall', 'start': {'x': 0, 'y': 0},
                                     'end': {'x': 1, 'y': 0}, 'thickness': 1}
        self.assert_round_trip(self.document)

    def test_circular_pillars_require_equal_dimensions(self):
        for value in ({'type': 'pillar', 'shape': 'circle', 'width': 40, 'depth': 80},
                      {'type': 'pillar', 'shape': 'ellipse', 'width': 40, 'depth': 40},
                      {'type': 'pillar', 'shape': ['circle'], 'width': 40, 'depth': 40}):
            self.layer['procedural'] = value
            self.assert_invalid(self.document)

    def hosted_document(self, kind='door'):
        wall = copy.deepcopy(self.layer)
        wall.update(id='wall-one', procedural=self.procedural_data('wall'))
        opening = copy.deepcopy(self.layer)
        opening.update(id='opening-one', procedural={**self.procedural_data(kind),
                                                     'host': {'wallId': 'wall-one', 'offset': 0.5}})
        return {**DOCUMENT, 'version': 2, 'layers': [wall, opening]}

    def test_hosted_openings_round_trip_and_shear_length(self):
        for kind in ('door', 'window'):
            document = self.hosted_document(kind)
            self.assert_round_trip(document)
        document = self.hosted_document()
        document['layers'][0].update(skewX=45, flipY=True, rotation=75)
        document['layers'][0]['procedural']['end'] = {'x': 0, 'y': 80}
        self.assert_round_trip(document)

    def test_opening_host_references_types_and_bounds(self):
        for host in (None, {}, {'wallId': 'missing', 'offset': 0.5},
                     {'wallId': 'opening-one', 'offset': 0.5},
                     {'wallId': 'wall-one', 'offset': 0.5, 'extra': 1},
                     {'wallId': 'wall-one', 'offset': True},
                     {'wallId': 'wall-one', 'offset': '0.5'},
                     {'wallId': 'wall-one', 'offset': -0.1},
                     {'wallId': 'wall-one', 'offset': 1.1},
                     {'wallId': 'wall-one', 'offset': 0.01}):
            document = self.hosted_document()
            document['layers'][1]['procedural']['host'] = host
            self.assert_invalid(document)
        document = self.hosted_document()
        document['layers'][0]['procedural'] = self.procedural_data('pillar')
        self.assert_invalid(document)
        document = self.hosted_document()
        document['layers'][0]['procedural']['end']['x'] = 90
        self.assert_invalid(document)

    def test_procedural_rejects_incompatible_layers_and_native_version(self):
        for kind in ('rectangle', 'ellipse', 'text', 'image'):
            document = copy.deepcopy(self.document)
            document['layers'][0].pop('curves')
            document['layers'][0].update(kind=kind, procedural=self.procedural_data('wall'))
            self.assert_invalid(document)
        for field, value in (('dimension', self.dimension_data()), ('guide', 'vertical')):
            document = copy.deepcopy(self.document)
            document['layers'][0].update(procedural=self.procedural_data('wall'))
            document['layers'][0][field] = value
            self.assert_invalid(document)
        document = copy.deepcopy(self.document)
        document['layers'][0].pop('curves')
        document['layers'][0]['procedural'] = self.procedural_data('wall')
        document['version'] = 1
        self.assert_invalid(document)

    def test_procedural_objects_cannot_be_symbols_or_blends(self):
        document = copy.deepcopy(self.document)
        definition = copy.deepcopy(self.layer)
        definition['procedural'] = self.procedural_data('wall')
        document['symbols'] = [{'id': 'wall-symbol', 'name': 'Wall', 'layer': definition}]
        self.assert_invalid(document)
        definition.pop('procedural')
        document['layers'][0].update(symbolId='wall-symbol', procedural=self.procedural_data('wall'))
        self.assert_invalid(document)
        for index in range(3):
            document = self.blended_document()
            document['layers'][index]['procedural'] = self.procedural_data('wall')
            self.assert_invalid(document)

    def test_procedural_nonfinite_values_fail_before_storage(self):
        from pydantic import ValidationError
        from src.main import Document
        for value in (float('nan'), float('inf'), -float('inf')):
            for kind, field in (('wall', 'thickness'), ('door', 'openingAngle'), ('pillar', 'width')):
                self.layer['procedural'] = {**self.procedural_data(kind), field: value}
                with self.assertRaises(ValidationError):
                    Document.model_validate(self.document)
