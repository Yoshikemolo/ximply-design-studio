"""Validate fresh per-module analysis against the strict project policy."""
from __future__ import annotations
import argparse
import json
import math
from pathlib import Path
from typing import Any

POLICY = Path(__file__).with_name("quality-policy.json")

def numeric(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

def check_report(report: dict[str, Any], revision: str, policy: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if report.get("revision") != revision:
        errors.append("Analysis revision does not match the required source revision")
    modules = report.get("modules")
    if not isinstance(modules, dict):
        return errors + ["Missing module analysis"]
    for module in policy["requiredModules"]:
        result = modules.get(module)
        if not isinstance(result, dict):
            errors.append(f"{module}: missing analysis")
            continue
        if result.get("revision") != revision or result.get("analysisStatus") != "SUCCESS":
            errors.append(f"{module}: stale or unsuccessful analysis")
        if result.get("qualityGate") != "OK":
            errors.append(f"{module}: Sonar quality gate is not OK")
        for scope in policy["requiredScopes"]:
            metrics = result.get(scope)
            if not isinstance(metrics, dict):
                errors.append(f"{module}/{scope}: missing metrics")
                continue
            prefix = f"{module}/{scope}"
            for key in policy["zeroMetrics"]:
                value = metrics.get(key)
                if not numeric(value) or value != 0:
                    errors.append(f"{prefix}: {key} must be zero")
            for key in ("coverage", "lineCoverage"):
                value = metrics.get(key)
                if not numeric(value) or not policy["strictMinimumCoverage"] < value <= 100:
                    errors.append(f"{prefix}: {key} must exceed 80 and not exceed 100")
            branches = metrics.get("branchesToCover")
            if not isinstance(branches, int) or isinstance(branches, bool) or branches < 0:
                errors.append(f"{prefix}: missing or invalid branchesToCover")
            elif branches > 0:
                value = metrics.get("branchCoverage")
                if not numeric(value) or not policy["strictMinimumCoverage"] < value <= 100:
                    errors.append(f"{prefix}: branchCoverage must exceed 80")
            duplication = metrics.get("duplication")
            if not numeric(duplication) or not 0 <= duplication < policy["strictMaximumDuplication"]:
                errors.append(f"{prefix}: duplication must be below 3")
    return errors

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--revision", required=True)
    args = parser.parse_args()
    try:
        errors = check_report(json.loads(args.report.read_text()), args.revision, json.loads(POLICY.read_text()))
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(f"Invalid quality evidence: {error}")
        return 1
    for error in errors:
        print(error)
    return int(bool(errors))

if __name__ == "__main__":
    raise SystemExit(main())
