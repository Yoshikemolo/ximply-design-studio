"""SC-0067/0068 negative oracles using independently specified API fixtures."""
import copy
from io import BytesIO, StringIO
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import URLError
from harness.collect_quality import (EvidenceError, MAX_RESPONSE, NoRedirect, SonarClient,
                                     collect, main, normalize, server_url, write_report)
from harness.check_quality import check_report

REVISION = 'a' * 40
POLICY = {'requiredModules': ['engineering'], 'requiredScopes': ['overall', 'newCode'],
          'zeroMetrics': ['bugs', 'vulnerabilities', 'codeSmells', 'securityHotspots'],
          'strictMinimumCoverage': 80, 'strictMaximumDuplication': 3}
MANIFEST = {'serverVersion': '2026.1.0.1', 'modules': {'engineering': {'projectKey': 'xds-engineering', 'taskId': 'task-1'}}}
VALUES = [('bugs', '0'), ('vulnerabilities', '0'), ('code_smells', '0'),
          ('security_hotspots', '0'), ('coverage', '80.01'), ('line_coverage', '90'),
          ('branch_coverage', '85'), ('conditions_to_cover', '20'), ('duplicated_lines_density', '2.99')]


def measures():
    result = [{'metric': key, 'value': value} for key, value in VALUES]
    result += [{'metric': 'new_' + key, 'period': {'value': value}} for key, value in VALUES]
    return result


class FixtureClient:
    def __init__(self):
        self.task = {'id': 'task-1', 'type': 'REPORT', 'componentKey': 'xds-engineering',
                     'status': 'SUCCESS', 'analysisId': 'analysis-1'}
        self.analysis = {'key': 'analysis-1', 'revision': REVISION}
        self.component = {'key': 'xds-engineering', 'measures': measures()}
        self.gate = 'OK'
        self.version = '2026.1.0.1'
        self.queries = []
        self.move = False

    def get(self, path, parameters=None, text=False):
        self.queries.append((path, parameters))
        if path == 'api/server/version':
            return self.version
        if path == 'api/ce/task':
            return {'task': self.task}
        if path == 'api/project_analyses/search':
            self.assert_query(parameters)
            analysis = dict(self.analysis)
            if self.move and sum(x[0] == path for x in self.queries) > 1:
                analysis['key'] = 'analysis-2'
            return {'analyses': [analysis]}
        if path == 'api/measures/component':
            return {'component': self.component}
        if path == 'api/qualitygates/project_status':
            if parameters != {'analysisId': 'analysis-1'}:
                raise AssertionError('Gate must be queried by analysis ID')
            return {'projectStatus': {'status': self.gate}}
        raise AssertionError(path)

    @staticmethod
    def assert_query(parameters):
        if parameters != {'project': 'xds-engineering', 'ps': 1, 'p': 1}:
            raise AssertionError('Latest analysis must be scoped and bounded')


class CollectorTests(unittest.TestCase):
    def test_exact_analysis_normalizes_both_scopes(self):
        report = collect(FixtureClient(), MANIFEST, REVISION, POLICY)
        self.assertEqual([], check_report(report, REVISION, POLICY))
        module = report['modules']['engineering']
        self.assertEqual('analysis-1', module['analysisId'])
        self.assertEqual(20, module['newCode']['branchesToCover'])
        self.assertEqual(80.01, module['overall']['coverage'])

    def test_stale_task_and_revision_fail(self):
        mutations = [('task', 'id', 'other'), ('task', 'componentKey', 'other'),
                     ('task', 'status', 'PENDING'), ('task', 'status', 'FAILED'),
                     ('task', 'type', 'OTHER'), ('task', 'analysisId', None),
                     ('analysis', 'revision', 'b' * 40), ('analysis', 'key', 'old'),
                     ('component', 'key', 'other')]
        for target, key, value in mutations:
            with self.subTest(target=target, key=key, value=value):
                client = FixtureClient()
                getattr(client, target)[key] = value
                with self.assertRaises(EvidenceError):
                    collect(client, MANIFEST, REVISION, POLICY)

    def test_concurrent_analysis_rejected(self):
        client = FixtureClient()
        client.move = True
        with self.assertRaisesRegex(EvidenceError, 'Latest analysis'):
            collect(client, MANIFEST, REVISION, POLICY)

    def test_version_and_manifest_fail_closed(self):
        client = FixtureClient()
        client.version = '2026.2.0'
        with self.assertRaises(EvidenceError):
            collect(client, MANIFEST, REVISION, POLICY)
        for manifest in ({}, {'serverVersion': 'latest', 'modules': {}},
                         {'serverVersion': '2026.1', 'modules': {}}, None):
            with self.subTest(manifest=manifest), self.assertRaises(EvidenceError):
                collect(FixtureClient(), manifest, REVISION, POLICY)
        with self.assertRaises(EvidenceError):
            collect(FixtureClient(), MANIFEST, 'short-sha', POLICY)

    def test_duplicate_project_and_branch_manifest_rejected(self):
        manifest = copy.deepcopy(MANIFEST)
        manifest['modules']['engineering']['branch'] = 'dev'
        with self.assertRaises(EvidenceError):
            collect(FixtureClient(), manifest, REVISION, POLICY)
        manifest = copy.deepcopy(MANIFEST)
        manifest['modules']['web'] = dict(manifest['modules']['engineering'])
        with self.assertRaises(EvidenceError):
            collect(FixtureClient(), manifest, REVISION, {**POLICY, 'requiredModules': ['engineering', 'web']})

    def test_missing_duplicate_and_invalid_metrics_fail(self):
        for value in (None, True, 'NaN', 'Infinity', '-1', 'invalid'):
            data = measures()
            data[0]['value'] = value
            with self.subTest(value=value), self.assertRaises(EvidenceError):
                normalize(data)
        with self.assertRaises(EvidenceError):
            normalize(measures()[1:])
        with self.assertRaises(EvidenceError):
            normalize(measures() + [measures()[0]])
        data = measures()
        next(x for x in data if x['metric'] == 'conditions_to_cover')['value'] = '1.5'
        with self.assertRaises(EvidenceError):
            normalize(data)

    def test_branch_metric_absence_only_with_explicit_zero(self):
        data = [x for x in measures() if 'branch_coverage' not in x['metric']]
        with self.assertRaises(EvidenceError):
            normalize(data)
        for item in data:
            if item['metric'] == 'conditions_to_cover':
                item['value'] = '0'
            if item['metric'] == 'new_conditions_to_cover':
                item['period']['value'] = '0'
        self.assertNotIn('branchCoverage', normalize(data)['newCode'])

    def test_red_gate_and_exact_boundaries_never_pass(self):
        client = FixtureClient()
        client.gate = 'ERROR'
        self.assertTrue(check_report(collect(client, MANIFEST, REVISION, POLICY), REVISION, POLICY))
        for key, value in [('coverage', '80'), ('duplicated_lines_density', '3')]:
            client = FixtureClient()
            next(x for x in client.component['measures'] if x['metric'] == key)['value'] = value
            self.assertTrue(check_report(collect(client, MANIFEST, REVISION, POLICY), REVISION, POLICY))

    def test_malformed_api_structure_is_rejected(self):
        client = FixtureClient()
        client.component['measures'] = [None]
        with self.assertRaisesRegex(EvidenceError, 'Malformed'):
            collect(client, MANIFEST, REVISION, POLICY)


class TransportTests(unittest.TestCase):
    def test_url_policy_and_redirect(self):
        self.assertEqual('https://sonar.example/base', server_url('https://sonar.example/base/', False))
        self.assertEqual('http://127.0.0.1:9000', server_url('http://127.0.0.1:9000', True))
        for value in ('http://sonar.example', 'http://127.0.0.1', 'https://user:pass@host',
                      'https://host?token=x', 'https://host#fragment', 'file:///secret', 'https://host/a b'):
            with self.subTest(value=value), self.assertRaises(EvidenceError):
                server_url(value, False)
        with self.assertRaises(EvidenceError):
            NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other')

    def test_credentials_and_bounded_response(self):
        for token in ('', 'line\nbreak'):
            with self.assertRaises(EvidenceError):
                SonarClient('https://sonar.example', token)
        client = SonarClient('https://sonar.example', 'secret-value')
        with patch.object(client._opener, 'open', return_value=BytesIO(b'{"task": {}}')) as opened:
            self.assertEqual({'task': {}}, client.get('api/ce/task', {'id': 'a&b'}))
            request = opened.call_args.args[0]
            self.assertIn('id=a%26b', request.full_url)
            self.assertNotIn('secret-value', request.full_url)
            self.assertEqual('Bearer secret-value', request.get_header('Authorization'))
        for data in (b'bad-json', b'\xff', b'x' * (MAX_RESPONSE + 1)):
            with patch.object(client._opener, 'open', return_value=BytesIO(data)), self.assertRaises(EvidenceError):
                client.get('api/ce/task')
        with patch.object(client._opener, 'open', side_effect=URLError('secret-value')):
            with self.assertRaises(EvidenceError) as caught:
                client.get('api/ce/task')
            self.assertNotIn('secret-value', str(caught.exception))
        with self.assertRaises(EvidenceError):
            client.get('https://other.example')

    def test_failed_cli_removes_stale_output_without_network(self):
        with tempfile.TemporaryDirectory() as folder, patch('sys.stdout', new_callable=StringIO):
            previous = Path.cwd()
            try:
                os.chdir(folder)
                Path('reports').mkdir()
                Path('reports/quality.json').write_text('{"old":"pass"}')
                result = main(['--server', 'https://sonar.example', '--manifest', 'absent.json', '--revision', REVISION])
                self.assertEqual(1, result)
                self.assertFalse(Path('reports/quality.json').exists())
            finally:
                os.chdir(previous)

    def test_cli_writes_complete_report_and_checks_policy(self):
        with tempfile.TemporaryDirectory() as folder, patch('sys.stdout', new_callable=StringIO):
            previous = Path.cwd()
            try:
                os.chdir(folder)
                Path('manifest.json').write_text(json.dumps(MANIFEST))
                Path('policy.json').write_text(json.dumps(POLICY))
                with patch('harness.collect_quality.POLICY', Path('policy.json')), patch('harness.collect_quality.SonarClient', return_value=FixtureClient()):
                    self.assertEqual(0, main(['--server', 'https://sonar.example', '--manifest', 'manifest.json', '--revision', REVISION]))
                report = json.loads(Path('reports/quality.json').read_text())
                self.assertEqual(REVISION, report['revision'])
                self.assertEqual([], list(Path('reports').glob('tmp*')))
            finally:
                os.chdir(previous)

    def test_atomic_write_and_source_output_protection(self):
        with tempfile.TemporaryDirectory() as folder, patch('sys.stdout', new_callable=StringIO):
            path = Path(folder)/'quality.json'
            write_report(path, {'revision': REVISION})
            self.assertEqual({'revision': REVISION}, json.loads(path.read_text()))
            self.assertEqual(1, main(['--server', 'https://sonar.example', '--manifest', 'absent.json', '--revision', REVISION, '--output', 'README.md']))
