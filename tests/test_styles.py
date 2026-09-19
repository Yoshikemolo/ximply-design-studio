"""Regression oracles for production CSS delivery under a strict script policy."""
import unittest
from scripts.check_styles import screen_stylesheets


class ProductionStylesTests(unittest.TestCase):
    def test_accepts_direct_screen_stylesheet(self):
        self.assertEqual(screen_stylesheets('<link rel="stylesheet" href="styles-hash.css">'), ['styles-hash.css'])

    def test_rejects_previous_angular_onload_pattern(self):
        with self.assertRaisesRegex(ValueError, 'Inline event'):
            screen_stylesheets('''<link rel="stylesheet" href="styles.css" media="print" onload="this.media='all'">''')

    def test_noscript_and_print_fallbacks_are_not_screen_styles(self):
        with self.assertRaisesRegex(ValueError, 'No directly applicable'):
            screen_stylesheets('<link rel="stylesheet" href="styles.css" media="print"><noscript><link rel="stylesheet" href="styles.css"></noscript>')

    def test_rejects_external_stylesheet(self):
        with self.assertRaisesRegex(ValueError, 'local stylesheet'):
            screen_stylesheets('<link rel="stylesheet" href="https://example.com/styles.css">')
