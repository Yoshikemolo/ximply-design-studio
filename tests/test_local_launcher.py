"""Local preview operations never target an unrelated or remote Docker project."""
from contextlib import redirect_stdout, redirect_stderr
from io import StringIO
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from scripts import local


class LocalLauncherTests(unittest.TestCase):
    def test_start_generates_private_secret_and_scopes_compose(self):
        with tempfile.TemporaryDirectory() as folder, redirect_stdout(StringIO()):
            with patch.object(local, 'ROOT', Path(folder)), patch('sys.argv', ['local.py','start']), patch.dict('os.environ', {}, clear=True), patch.object(local.subprocess,'run', return_value=SimpleNamespace(stdout='unix:///var/run/docker.sock')) as run:
                self.assertEqual(0, local.main())
                content=(Path(folder)/'.env.local').read_text()
                self.assertGreater(len(content.splitlines()[0].split('=',1)[1]),32)
                command=next(call.args[0] for call in run.call_args_list if call.args[0][:2] == ['docker', 'compose'])
                self.assertIn('ximply-design-studio-preview',command)
                self.assertEqual(['up','--build','-d','--wait'],command[-4:])

    def test_remote_context_never_runs_compose(self):
        with tempfile.TemporaryDirectory() as folder, redirect_stdout(StringIO()):
            with patch.object(local,'ROOT',Path(folder)),patch('sys.argv',['local.py','start']),patch.object(local.subprocess,'run',return_value=SimpleNamespace(stdout='tcp://remote:2376')) as run:
                self.assertEqual(1,local.main())
                self.assertEqual(1,run.call_count)

    def test_nuke_requires_exact_project_confirmation(self):
        with patch('sys.argv',['local.py','nuke']),redirect_stderr(StringIO()),self.assertRaises(SystemExit):
            local.main()

    def test_info_reports_checkout_without_docker_or_environment_file(self):
        with tempfile.TemporaryDirectory() as folder, redirect_stdout(StringIO()) as output:
            root = Path(folder)
            (root / 'release').mkdir()
            (root / 'release/version.json').write_text('{"version":"0.3.1-alpha.1"}')
            with patch.object(local, 'ROOT', root), patch('sys.argv', ['local.py', 'info']), \
                 patch.object(local.subprocess, 'check_output', side_effect=['abc123\n', 'feat/drawing-preview\n']), \
                 patch.object(local.subprocess, 'run') as docker:
                self.assertEqual(0, local.main())
            self.assertIn('0.3.1-alpha.1 | source: feat/drawing-preview | commit: abc123', output.getvalue())
            self.assertFalse((root / '.env.local').exists())
            docker.assert_not_called()

    def test_archive_info_works_without_git(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(local, 'ROOT', Path(folder)), \
                 patch.object(local.subprocess, 'check_output', side_effect=FileNotFoundError):
                self.assertEqual('Ximply Design Studio unknown | source: archive | commit: unavailable', local.preview_info())
