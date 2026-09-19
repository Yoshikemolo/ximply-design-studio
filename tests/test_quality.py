"""Boundary and missing-evidence tests for quality policy."""
import copy
import json
from pathlib import Path
import unittest
from harness.check_quality import check_report

class QualityTests(unittest.TestCase):
    def setUp(self):
        self.policy = json.loads(Path("harness/quality-policy.json").read_text())
        metrics = {"bugs":0,"vulnerabilities":0,"codeSmells":0,"securityHotspots":0,"coverage":80.01,"lineCoverage":80.01,"branchCoverage":80.01,"branchesToCover":10,"duplication":2.99}
        self.report = {"revision":"abc","modules":{name:{"revision":"abc","analysisStatus":"SUCCESS","qualityGate":"OK","overall":copy.deepcopy(metrics),"newCode":copy.deepcopy(metrics)} for name in self.policy["requiredModules"]}}
    def test_valid_strict_values(self):
        self.assertEqual([],check_report(self.report,"abc",self.policy))
    def test_exact_boundaries_fail(self):
        for metric,value in [("coverage",80),("lineCoverage",80),("branchCoverage",80),("duplication",3)]:
            with self.subTest(metric=metric):
                report=copy.deepcopy(self.report)
                report["modules"]["web"]["overall"][metric]=value
                self.assertTrue(check_report(report,"abc",self.policy))
    def test_hotspot_is_not_reviewed_away(self):
        self.report["modules"]["api"]["newCode"]["securityHotspots"]=1
        self.assertTrue(check_report(self.report,"abc",self.policy))
    def test_missing_and_stale_fail(self):
        del self.report["modules"]["worker"]
        self.assertTrue(check_report(self.report,"abc",self.policy))
        self.assertTrue(check_report(self.report,"def",self.policy))
    def test_non_finite_and_boolean_fail(self):
        for value in [float("nan"),float("inf"),True,None,-1,101]:
            with self.subTest(value=value):
                report=copy.deepcopy(self.report)
                report["modules"]["domain"]["overall"]["coverage"]=value
                self.assertTrue(check_report(report,"abc",self.policy))
    def test_unanalysed_module_fails(self):
        self.report["modules"]["web"]["analysisStatus"]="PENDING"
        self.assertTrue(check_report(self.report,"abc",self.policy))
    def test_zero_branches_requires_explicit_count(self):
        for scope in self.policy["requiredScopes"]:
            self.report["modules"]["design-system"][scope]["branchesToCover"]=0
            del self.report["modules"]["design-system"][scope]["branchCoverage"]
        self.assertEqual([],check_report(self.report,"abc",self.policy))
