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

def legacy_exemptions(policy: dict[str, Any]) -> set[str]:
    """Return exact full SHAs of reviewed historical commits that predate enforcement."""
    exemptions = set()
    for entry in policy.get("legacyCommitExemptions", []):
        sha = entry.get("sha", "") if isinstance(entry, dict) else ""
        if not re.fullmatch(r"[0-9a-f]{40}", sha) or not str(entry.get("reason", "")).strip():
            raise ValueError("Legacy exemptions require a full SHA and a reason")
        exemptions.add(sha)
    return exemptions

def check_metadata(report: dict[str, Any], expected_head: str, policy: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    exempt = legacy_exemptions(policy)
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
            if commit.get("sha") in exempt:
                continue
            for identity in ("authorLogin", "committerLogin"):
                if commit.get(identity) != policy["owner"]:
                    errors.append(f"Commit {commit.get('sha', 'unknown')} {identity} must be {policy['owner']}; received {commit.get(identity)!r}")
            errors += [f"{commit.get('sha', 'unknown')}: {error}" for error in check_text(str(commit.get("message", "")), "Commit", policy)]
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
    parser.add_argument("--pr-title-file", type=Path)
    parser.add_argument("--pr-body-file", type=Path)
    args = parser.parse_args()
    try:
        policy = json.loads(POLICY_PATH.read_text())
        errors = []
        if bool(args.report) != bool(args.head):
            parser.error("Provide both report and --head")
        if bool(args.pr_title_file) != bool(args.pr_body_file):
            parser.error("Provide both --pr-title-file and --pr-body-file")
        if not (args.report or args.message_file or args.pr_title_file):
            parser.error("Provide metadata evidence or proposed contribution text files")
        if args.report:
            errors += check_metadata(json.loads(args.report.read_text()), args.head, policy)
        for path, label in ((args.message_file, "Commit"), (args.pr_title_file, "PR title"), (args.pr_body_file, "PR body")):
            if path:
                errors += check_text(path.read_text(encoding="utf-8"), label, policy)
        for error in errors:
            print(error)
        return int(bool(errors))
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(f"Invalid contribution evidence: {error}")
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
