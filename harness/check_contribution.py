"""Enforce owner identity and contribution text policy."""
from __future__ import annotations
import argparse
import json
import re
from pathlib import Path
from typing import Any

POLICY_PATH = Path(__file__).with_name("contribution-policy.json")
EMOJI = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F\u20E3]")
NON_ENGLISH = re.compile(r"\b(añade|añadir|corrige|corregir|actualiza|actualizar|implementación|cambios|documentación|mejora|mejoras|pruebas|revisión|configuración|creación|funcionalidad|soluciona)\b", re.I)

def check_text(text: str, label: str, policy: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if not text.strip():
        return [f"{label}: text is empty"]
    if label in ("Commit", "PR title") and not re.match(r"^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9][a-z0-9/-]*\))?!?: [A-Z a-z0-9].+", text.splitlines()[0]):
        errors.append(f"{label}: Conventional Commit header required")
    if EMOJI.search(text):
        errors.append(f"{label}: emoji is forbidden")
    if NON_ENGLISH.search(text):
        errors.append(f"{label}: non-English wording detected")
    for term in policy["blockedTerms"]:
        if re.search(r"(?<![a-z0-9])" + re.escape(term) + r"(?![a-z0-9])", text, re.I):
            errors.append(f"{label}: forbidden provider/model or attribution wording")
            break
    if re.search(r"\bAI\b|\b(?:generated|assisted|powered|written)\s+(?:by|with)\b", text, re.I):
        errors.append(f"{label}: attribution wording is forbidden")
    for trailer in policy["blockedTrailers"]:
        if re.search(r"^\s*" + re.escape(trailer) + r"\s*:", text, re.I | re.M):
            errors.append(f"{label}: attribution trailer is forbidden")
            break
    return errors

def check_metadata(report: dict[str, Any], expected_head: str, policy: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if report.get("headSha") != expected_head:
        errors.append("Metadata does not match the expected head revision")
    commits = report.get("commits")
    if not isinstance(commits, list) or not commits:
        errors.append("No commit metadata supplied")
    else:
        for commit in commits:
            if not isinstance(commit, dict):
                errors.append("Invalid commit metadata")
                continue
            for identity in ("authorLogin", "committerLogin"):
                if commit.get(identity) != policy["owner"]:
                    errors.append(f"Commit {identity} must be {policy['owner']}")
            errors += check_text(str(commit.get("message", "")), "Commit", policy)
    pr = report.get("pullRequest")
    if pr is not None:
        if not isinstance(pr, dict):
            errors.append("Invalid pull request metadata")
        else:
            if pr.get("authorLogin") != policy["owner"]:
                errors.append(f"PR author must be {policy['owner']}")
            errors += check_text(str(pr.get("title", "")), "PR title", policy)
            errors += check_text(str(pr.get("body", "")), "PR body", policy)
    return errors

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path, nargs="?")
    parser.add_argument("--head")
    parser.add_argument("--message-file", type=Path)
    args = parser.parse_args()
    try:
        policy = json.loads(POLICY_PATH.read_text())
        if args.message_file:
            errors = check_text(args.message_file.read_text(), "Commit", policy)
        elif args.report and args.head:
            errors = check_metadata(json.loads(args.report.read_text()), args.head, policy)
        else:
            parser.error("Provide a report and --head, or --message-file")
        for error in errors:
            print(error)
        return int(bool(errors))
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(f"Invalid contribution evidence: {error}")
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
