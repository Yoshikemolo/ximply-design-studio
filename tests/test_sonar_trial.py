"""Independent boundary and failure-path checks for the disposable diagnostic."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from scripts import sonar_trial as trial


class TrialTests(unittest.TestCase):
    def test_strict_metric_boundaries_and_missing_evidence(self):
        passing = dict(bugs=0, vulnerabilities=0, code_smells=0, security_hotspots=0,
                       coverage=81, line_coverage=81, branch_coverage=81,
                       conditions_to_cover=10, duplicated_lines_density=2.9)
        self.assertEqual(trial.overall_errors(passing), [])
        for key, value in [('bugs', 1), ('vulnerabilities', 1), ('code_smells', 1),
                           ('security_hotspots', 1), ('coverage', 80), ('line_coverage', 80),
                           ('branch_coverage', 80), ('conditions_to_cover', -1),
                           ('duplicated_lines_density', 3), ('coverage', float('nan')),
                           ('coverage', True), ('coverage', 101)]:
            with self.subTest(key=key, value=value):
                self.assertTrue(trial.overall_errors({**passing, key: value}))
        self.assertTrue(trial.overall_errors({}))
        self.assertEqual(trial.overall_errors({**passing, 'conditions_to_cover': 0, 'branch_coverage': None}), [])

    def test_loopback_and_redirect_restrictions(self):
        for server in ('https://example.com', 'http://localhost.example.com:19000',
                       'http://user:secret@localhost:19000', 'http://localhost/private',
                       'http://localhost/?redirect=elsewhere'):
            with self.subTest(server=server), self.assertRaises(trial.TrialError):
                trial.Api(server)
        trial.Api('http://127.0.0.1:19000')
        with self.assertRaises(trial.TrialError):
            trial.NoRedirect().redirect_request(None, None, 302, '', {}, 'http://example.com')

    def test_wait_has_bounded_timeout(self):
        with patch.object(trial.time, 'monotonic', side_effect=[0, 0, 10]), patch.object(trial.time, 'sleep'):
            with self.assertRaises(trial.TrialError):
                trial.wait_for(lambda: {}, lambda _: False, 5)

    def test_issue_export_paginates_and_preserves_findings(self):
        api = Mock()
        api.call.side_effect = [{'issues': [{'key': 'a'}], 'paging': {'total': 2}},
                                {'issues': [{'key': 'b'}], 'paging': {'total': 2}}]
        self.assertEqual(trial.collect_pages(api, 'issues/search', {}, 'issues'),
                         {'issues': [{'key': 'a'}, {'key': 'b'}], 'total': 2, 'complete': True})
        self.assertEqual(api.call.call_args.args[1]['p'], 2)

    def test_failed_compute_task_records_failure_without_claiming_gate(self):
        api = Mock()
        api.call.side_effect = [{'status': 'UP'}, {}, {'token': 'secret'},
                                {'task': {'status': 'FAILED'}}]
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            def scanner(*args):
                (args[-1] / 'report-task.txt').write_text('ceTaskId=123\n')
            with patch.object(trial.subprocess, 'check_output', return_value='abc\n'), \
                    patch.object(trial, 'run_scanner', side_effect=scanner):
                self.assertEqual(trial.trial(root, 'http://127.0.0.1:19000', api), 1)
            status = json.loads((root / 'reports/sonar-trial/status.json').read_text())
            self.assertEqual(status['status'], 'ERROR')
            self.assertEqual(status['fullProductGate'], 'NOT_EVALUATED')
            self.assertNotIn('secret', json.dumps(status))
            self.assertIn('compute task', status['error'])

    def test_scanner_settings_are_private_and_removed_on_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'infra/sonar').mkdir(parents=True)
            (root / 'infra/sonar/trial-images.json').write_text(json.dumps({'scanner': 'scanner@sha256:' + 'a' * 64}))
            paths = []
            def docker(command, **kwargs):
                path = Path(command[-1].split('=', 1)[1])
                paths.append(path)
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                self.assertNotIn('secret-token', ' '.join(command))
                self.assertIn('sonar.token=secret-token', path.read_text())
                self.assertIn('xds-sonar-trial-scanner', command)
                return Mock(returncode=1, stdout='secret-token sonar.token=other-secret', stderr='failure')
            with patch.object(trial.subprocess, 'run', side_effect=docker), self.assertRaises(trial.TrialError):
                trial.run_scanner(root, 'http://127.0.0.1:19000', 'secret-token', 'abc', root)
            self.assertFalse(paths[0].exists())
            self.assertNotIn('secret-token', (root / 'scanner.log').read_text())
            self.assertNotIn('other-secret', (root / 'scanner.log').read_text())


if __name__ == '__main__':
    unittest.main()
