"""Verify bounded context retrieval and navigation failure cases."""
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from harness.context import generated, graph, packet

ROOT = Path(__file__).resolve().parents[1]


class ContextTests(unittest.TestCase):
    def test_scenario_retrieves_its_parent_without_full_corpus(self):
        result = packet(ROOT, 'SC-0008')
        self.assertEqual(['FEAT-0003'], [x['id'] for x in result['related']])
        self.assertEqual([], result['entry']['implementation'])

    def test_relationships_have_reverse_links(self):
        nodes = graph(ROOT)
        for node in nodes.values():
            for target in node['links']:
                self.assertIn(node['id'], nodes[target]['links'])

    def test_unknown_id_fails(self):
        with self.assertRaisesRegex(ValueError, 'Unknown context ID'):
            packet(ROOT, 'FEAT-9999')

    def test_generated_navigation_is_current(self):
        for path, content in generated(ROOT).items():
            self.assertEqual(content, (ROOT/path).read_text(), path)

    def test_missing_implementation_and_unknown_decision_fail(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            shutil.copytree(ROOT/'doc', root/'doc')
            path = root/'doc/planning/traceability.json'
            registry = json.loads(path.read_text())
            registry['features'][0]['implementation'] = ['services/api/missing.py']
            path.write_text(json.dumps(registry))
            with self.assertRaisesRegex(ValueError, 'Missing implementation'):
                graph(root)
            registry['features'][0]['implementation'] = []
            registry['features'][0]['adrs'].append('ADR-9999')
            path.write_text(json.dumps(registry))
            with self.assertRaisesRegex(ValueError, 'Unknown document relationship'):
                graph(root)
