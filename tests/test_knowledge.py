"""Negative oracles for corpus metadata and traversal constraints."""
from pathlib import Path
import shutil
import tempfile
import unittest
from harness.knowledge import check, read_document

ROOT = Path(__file__).resolve().parents[1]


class KnowledgeTests(unittest.TestCase):
    def test_repository_corpus(self):
        self.assertEqual([], check(ROOT))

    def test_missing_front_matter_fails(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'plain.md'
            path.write_text('# Missing metadata\n')
            with self.assertRaisesRegex(ValueError, 'Missing metadata'):
                read_document(path)

    def test_duplicate_fields_fail(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'duplicate.md'
            path.write_text('---\nid: "DOC-0001"\nid: "DOC-0002"\n---\n# Title\n')
            with self.assertRaisesRegex(ValueError, 'Duplicate metadata'):
                read_document(path)

    def test_invalid_relationship_anchor_and_unreachable_document(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            shutil.copytree(ROOT/'doc', root/'doc')
            (root/'README.md').write_text('[Entry](doc/INDEX.md)\n')
            path = root/'doc/po/PO-0001.md'
            text = path.read_text().replace('related: [', 'related: ["UNKNOWN-0001", ', 1)
            path.write_text(text+'\n[Invalid anchor](PO-0002.md#missing-heading)\n')
            orphan = root/'doc/po/PO-9999.md'
            orphan.write_text(text.replace('PO-0001', 'PO-9999'))
            errors = check(root)
            self.assertTrue(any('unknown related ID UNKNOWN-0001' in x for x in errors))
            self.assertTrue(any('broken anchor' in x for x in errors))
            self.assertTrue(any('Unreachable document: doc/po/PO-9999.md' in x for x in errors))
