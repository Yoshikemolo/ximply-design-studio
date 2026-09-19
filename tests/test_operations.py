"""Verify destructive scope and operation order without running Docker."""
import argparse
import contextlib
import io
import os
from unittest.mock import patch
import unittest
from scripts.studio import operate,compose

class OperationTests(unittest.TestCase):
    def args(self,operation,**values):
        result=dict(operation=operation,environment="dev",application=False,dry_run=False,confirm=None,context=None)
        result.update(values)
        return argparse.Namespace(**result)
    def test_destructive_requires_exact_confirmation(self):
        for operation in ("nuke","reset-db"):
            with self.assertRaises(ValueError):
                operate(self.args(operation,confirm="xds-demo"),lambda *args: self.fail("Must not execute"))
    def test_dry_run_never_executes(self):
        with contextlib.redirect_stdout(io.StringIO()):
            operate(self.args("nuke",dry_run=True),lambda *args:self.fail("Must not execute"))
    def test_remote_cleanup_rejected(self):
        with patch.dict(os.environ,{"DOCKER_HOST":"tcp://remote:2376","DOCKER_CONTEXT":""}):
            with self.assertRaises(ValueError):
                operate(self.args("nuke",confirm="xds-dev"),lambda *args:"")
    def test_cleanup_targets_only_labelled_resources_in_order(self):
        calls=[]
        def execute(command,capture=False):
            calls.append(command)
            if command[1:3]==["volume","ls"]:
                return "xds-dev_app-db"
            if command[1:3]==["image","ls"]:
                return "sha256:owned"
            return ""
        with patch.dict(os.environ,{"DOCKER_HOST":"unix:///var/run/docker.sock","DOCKER_CONTEXT":""}):
            operate(self.args("nuke",confirm="xds-dev"),execute)
        self.assertEqual(["docker","image","rm","sha256:owned"],calls[-1])
        self.assertEqual(["docker","volume","rm","xds-dev_app-db"],calls[-2])
        self.assertIn("down",calls[-3])
        self.assertFalse(any("prune" in command for command in calls))
    def test_reset_refuses_missing_labelled_volume(self):
        with patch.dict(os.environ,{"DOCKER_HOST":"unix:///var/run/docker.sock","DOCKER_CONTEXT":""}):
            with self.assertRaises(ValueError):
                operate(self.args("reset-db",confirm="xds-dev"),lambda *args:"")
    def test_environment_names_are_fixed(self):
        with self.assertRaises(KeyError):
            compose("dev; rm -rf /",False)
        self.assertIn("xds-demo",compose("demo",False))
    def test_swarm_requires_context_and_confirmation(self):
        with self.assertRaises(ValueError):
            operate(self.args("deploy-swarm"),lambda *args:self.fail("Must not execute"))
