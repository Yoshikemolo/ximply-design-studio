"""Trusted metadata collection rejects incomplete or moving snapshots."""
from unittest.mock import patch
import unittest
from harness.collect_contribution import collect,normalize_commit

class CollectorTests(unittest.TestCase):
    def test_normalizes_unmapped_identity_as_missing(self):
        result=normalize_commit({"sha":"a","author":None,"committer":None,"commit":{"message":"docs: add a spec"}})
        self.assertIsNone(result["authorLogin"])
    def test_rejects_untrusted_paths(self):
        with self.assertRaises(ValueError):
            collect("x/y/../../secrets",1,"a"*40)
    def test_rejects_moving_head(self):
        with patch("harness.collect_contribution.fetch",return_value={"head":{"sha":"b"*40}}):
            with self.assertRaises(ValueError):
                collect("Yoshikemolo/ximply-design-studio",1,"a"*40)
    def test_collects_exact_snapshot(self):
        pr={"head":{"sha":"a"*40},"commits":1,"user":{"login":"Yoshikemolo"},"title":"docs: define contracts","body":"Define versioned contracts."}
        commit={"sha":"a"*40,"author":{"login":"Yoshikemolo"},"committer":{"login":"Yoshikemolo"},"commit":{"message":"docs: define contracts"}}
        with patch("harness.collect_contribution.fetch",side_effect=[pr,[commit],pr]):
            self.assertEqual(1,len(collect("Yoshikemolo/ximply-design-studio",1,"a"*40)["commits"]))
    def test_normalizes_signature_verification_strictly(self):
        item={"sha":"a","author":None,"committer":None,"commit":{"message":"docs: add a spec","verification":{"verified":True}}}
        self.assertTrue(normalize_commit(item)["verified"])
        for verification in (None,{},{"verified":"true"},{"verified":False}):
            with self.subTest(verification=verification):
                item["commit"]["verification"]=verification
                self.assertFalse(normalize_commit(item)["verified"])
