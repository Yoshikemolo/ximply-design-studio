"""Check documentation traceability and local contract references."""
from __future__ import annotations
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def check(root: Path) -> list[str]:
    errors: list[str] = []
    parsed: dict[Path, object] = {}
    for path in root.rglob("*.json"):
        if ".git" in path.parts or "reports" in path.parts:
            continue
        try:
            parsed[path] = json.loads(path.read_text())
        except (ValueError, OSError) as error:
            errors.append(f"Invalid JSON {path.relative_to(root)}: {error}")
    registry = parsed.get(root / "doc/planning/traceability.json")
    if not isinstance(registry, dict):
        return errors + ["Missing traceability registry"]
    features = registry.get("features", [])
    ids = [item["id"] for item in features]
    if len(ids) != len(set(ids)):
        errors.append("Duplicate feature identifiers")
    known = set(ids)
    graph = {item["id"]: item["dependsOn"] for item in features}
    for item in features:
        if not (root / item["path"]).is_file():
            errors.append(f"Missing feature {item['id']}")
        for dependency in item["dependsOn"]:
            if dependency not in known:
                errors.append(f"Unknown dependency {dependency}")
        for adr in item["adrs"]:
            if not (root / "doc/adr" / f"{adr}.md").is_file():
                errors.append(f"Missing decision {adr}")
        for scenario in item["scenarios"]:
            target = root / "doc/sc" / f"{scenario}.md"
            if not target.is_file() or f"Feature: {item['id']}" not in target.read_text():
                errors.append(f"Missing or mismatched scenario {scenario}")
        if item["status"] == "Verified" and not all(item.get(key) for key in ("implementation","tests","evidence")):
            errors.append(f"{item['id']}: Verified without evidence")
    def visit(node: str, active: set[str], done: set[str]) -> None:
        if node in active:
            errors.append(f"Dependency cycle at {node}")
            return
        if node in done:
            return
        active.add(node)
        for child in graph.get(node, []):
            visit(child, active, done)
        active.remove(node)
        done.add(node)
    done: set[str] = set()
    for node in graph:
        visit(node, set(), done)
    for path in root.rglob("*.md"):
        if ".git" in path.parts:
            continue
        for link in re.findall(r"\[[^\]]*\]\(([^)]+)\)", path.read_text()):
            if "://" in link or link.startswith(("#","mailto:")):
                continue
            target = link.split("#")[0]
            if target and not (path.parent / target).exists():
                errors.append(f"Broken link {path.relative_to(root)} -> {link}")
    for path, document in parsed.items():
        def refs(value: object) -> None:
            if isinstance(value, dict):
                ref = value.get("$ref")
                if isinstance(ref, str) and ref.startswith("#/"):
                    target = document
                    try:
                        for token in ref[2:].split("/"):
                            target = target[token.replace("~1","/").replace("~0","~")]
                    except (KeyError, TypeError):
                        errors.append(f"Unresolved reference {path.relative_to(root)} {ref}")
                for child in value.values():
                    refs(child)
            elif isinstance(value, list):
                for child in value:
                    refs(child)
        refs(document)
    api = parsed.get(root / "contracts/openapi.json", {})
    if not isinstance(api, dict) or api.get("security") != [{"bearerAuth":[]}]:
        errors.append("Business API must require bearer authentication globally")
    else:
        operations: set[str] = set()
        for path, methods in api.get("paths", {}).items():
            for operation in methods.values():
                name = operation.get("operationId")
                if not name or name in operations:
                    errors.append("Missing or duplicate operationId")
                operations.add(name)
                if path != "/health/live" and operation.get("security") == []:
                    errors.append(f"Anonymous business route {path}")
    return errors

def main() -> int:
    errors = check(ROOT)
    for error in errors:
        print(error)
    if not errors:
        print("Documentation traceability, JSON syntax, local references and API auth declarations passed.")
    return int(bool(errors))

if __name__ == "__main__":
    raise SystemExit(main())
