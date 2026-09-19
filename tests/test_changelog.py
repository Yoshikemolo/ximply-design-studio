"""Release-note oracles for current version, compatibility and generated assets."""
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from harness.changelog import build, compare_versions, require_note_update, sections, version_parts

ROOT = Path(__file__).resolve().parents[1]


class ChangelogTests(unittest.TestCase):
    def test_bundled_notes_match_markdown_and_current_version(self):
        outputs = build(ROOT)
        for filename, content in outputs.items():
            self.assertEqual(content, (ROOT/filename).read_text(), filename)
        manifest = json.loads(outputs['release/changelog.json'])
        self.assertEqual('0.3.8-alpha.1', manifest['currentVersion'])
        self.assertEqual(['0.3.8-alpha.1', '0.3.7-alpha.1', '0.3.6-alpha.1', '0.3.5-alpha.1', '0.3.4-alpha.1', '0.3.3-alpha.1', '0.3.2-alpha.1', '0.3.1-alpha.1', '0.3.0-alpha.1', '0.2.0-alpha.2', '0.2.0-alpha.1', '0.1.0-design.2', '0.1.0-design.1'], [x['version'] for x in manifest['entries']])
        for entry in manifest['entries']:
            if entry['version'] in ('0.3.0-alpha.1', '0.3.5-alpha.1', '0.3.7-alpha.1'):
                self.assertTrue(any('Migration:' in note for note in entry['breakingChanges']))
            else:
                self.assertEqual([], entry['breakingChanges'])
            self.assertIn(entry['capabilityStatus'], ['design-only', 'local-preview'])
            self.assertNotIn('---', outputs['apps/web/public/assets/changelog/'+entry['markdown']])

    def test_semantic_version_order_and_invalid_values(self):
        for left, right in [('1.10.0', '1.9.0'), ('1.0.0', '1.0.0-rc.1'),
                            ('1.0.0-rc.10', '1.0.0-rc.2'), ('1.0.0-beta', '1.0.0-alpha'),
                            ('1.0.0-a', '1.0.0-1'), ('1.0.0-a.1', '1.0.0-a')]:
            self.assertGreater(compare_versions(left, right), 0)
            self.assertLess(compare_versions(right, left), 0)
        self.assertEqual(0, compare_versions('1.0.0', '1.0.0'))
        for value in ('v1', '1.0', '../1.0.0', '01.0.0', '1.0.0-01'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                version_parts(value)

    def test_implementation_changes_require_source_notes(self):
        for path in ('apps/web/main.ts', 'services/api/main.py', 'harness/check.py', 'infra/compose.yml'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                require_note_update([path])
            require_note_update([path, 'doc/changelog/Unreleased.md'])
        require_note_update(['doc/architecture/system-overview.md'])
        with self.assertRaises(ValueError):
            require_note_update(['harness/check.py', 'release/changelog.json'])

    def test_missing_or_repeated_sections_fail(self):
        for body in ('## Fixes\n\nNone.\n', '## Fixes\n\nNone.\n\n## Fixes\n\nNone.\n', '## Unknown\n\nNone.\n'):
            with self.assertRaises(ValueError):
                sections(body)

    def test_missing_current_version_and_breaking_mismatch_fail(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            shutil.copytree(ROOT/'doc/changelog', root/'doc/changelog')
            shutil.copytree(ROOT/'release', root/'release')
            (root/'release/version.json').write_text('{"version":"9.9.9"}')
            with self.assertRaisesRegex(ValueError, 'Current version'):
                build(root)
            (root/'release/version.json').write_text('{"version":"0.1.0-design.2"}')
            path = root/'doc/changelog/0.1.0-design.2.md'
            original = path.read_text()
            path.write_text(original.replace('breaking_changes: false', 'breaking_changes: true'))
            with self.assertRaisesRegex(ValueError, 'flag and notes'):
                build(root)
            path.write_text(original.replace('breaking_changes: false', 'breaking_changes: true').replace('## Breaking changes\n\nNone.', '## Breaking changes\n\n- Incompatible project format.'))
            with self.assertRaisesRegex(ValueError, 'Migration:'):
                build(root)
            path.write_text(path.read_text().replace('- Incompatible project format.', '- Incompatible project format. Migration: export before upgrading.'))
            result = json.loads(build(root)['release/changelog.json'])
            self.assertTrue(next(entry for entry in result['entries'] if entry['version']=='0.1.0-design.2')['breakingChanges'])
