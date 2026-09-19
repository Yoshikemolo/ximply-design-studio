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
                command=run.call_args.args[0]
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
