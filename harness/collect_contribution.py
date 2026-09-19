"""Collect contribution metadata from GitHub with read-only authorization."""
from __future__ import annotations
import argparse
import json
import os
import re
import urllib.request
from pathlib import Path
from typing import Any

API = "https://api.github.com"

def fetch(path: str) -> Any:
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise ValueError("GITHUB_TOKEN is required for trusted collection")
    request = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)

def normalize_commit(item: dict[str, Any]) -> dict[str, Any]:
    return {"sha":item["sha"], "authorLogin":(item.get("author") or {}).get("login"), "committerLogin":(item.get("committer") or {}).get("login"), "verified":((item["commit"].get("verification") or {}).get("verified") is True), "message":item["commit"]["message"]}

def collect(repository: str, pr_number: int, head: str) -> dict[str, Any]:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("Invalid repository")
    if not re.fullmatch(r"[0-9a-f]{40}", head) or pr_number < 1:
        raise ValueError("Invalid PR number or head revision")
    prefix = f"/repos/{repository}/pulls/{pr_number}"
    pr = fetch(prefix)
    if pr["head"]["sha"] != head:
        raise ValueError("PR head changed during collection")
    commits = []
    page = 1
    while True:
        batch = fetch(f"{prefix}/commits?per_page=100&page={page}")
        if not isinstance(batch, list):
            raise ValueError("Invalid commits response")
        commits.extend(normalize_commit(item) for item in batch)
        if len(batch) < 100:
            break
        page += 1
        if page > 3:
            raise ValueError("PR exceeds safe collection limit; split the change")
    if len(commits) != pr["commits"]:
        raise ValueError("Commit metadata is incomplete")
    if fetch(prefix)["head"]["sha"] != head:
        raise ValueError("PR head changed during collection")
    return {"headSha":head,"commits":commits,"pullRequest":{"authorLogin":pr["user"]["login"],"title":pr["title"],"body":pr.get("body") or ""}}

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository",required=True)
    parser.add_argument("--pr",type=int,required=True)
    parser.add_argument("--head",required=True)
    parser.add_argument("--output",type=Path,required=True)
    args = parser.parse_args()
    try:
        report = collect(args.repository,args.pr,args.head)
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(report,indent=2)+"\n")
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"Contribution metadata collection failed: {type(error).__name__}")
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
