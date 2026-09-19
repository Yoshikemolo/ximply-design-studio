"""Documentation graph consistency checks."""
from pathlib import Path
import unittest
from harness.check_docs import check

class DocumentationTests(unittest.TestCase):
    def test_repository_graph_and_contract_references(self):
        self.assertEqual([],check(Path.cwd()))
