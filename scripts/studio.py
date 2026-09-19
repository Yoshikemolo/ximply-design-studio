"""Scoped container operations for ximply-design-studio."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import subprocess
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
ENVIRONMENTS = {"dev": "xds-dev", "qa": "xds-qa", "demo": "xds-demo", "prod": "xds-prod"}

def run(command: list[str], capture: bool = False) -> str:
    result = subprocess.run(command, cwd=ROOT, check=True, text=True, capture_output=capture)
    return result.stdout.strip() if capture else ""

def compose(environment: str, application: bool) -> list[str]:
    command = ["docker", "compose", "--project-name", ENVIRONMENTS[environment], "--env-file", str(ROOT / "infra/.env"), "-f", str(ROOT / "infra/compose.yaml"), "-f", str(ROOT / f"infra/compose.{environment}.yaml")]
    if application or environment == "prod":
        command += ["-f", str(ROOT / "infra/application.compose.yaml")]
    return command

def require_local(executor: Callable[..., str]) -> None:
    endpoint = os.environ.get("DOCKER_HOST")
    context_override = os.environ.get("DOCKER_CONTEXT")
    if context_override or not endpoint:
        name = context_override or executor(["docker", "context", "show"], True)
        contexts = json.loads(executor(["docker", "context", "inspect", name], True))
        endpoint = contexts[0]["Endpoints"]["docker"]["Host"]
    if not endpoint.startswith(("unix://", "npipe://")):
        raise ValueError("Destructive maintenance requires a local Docker endpoint")

def resource_ids(project: str, kind: str, executor: Callable[..., str]) -> list[str]:
    label = f"com.docker.compose.project={project}" if kind == "volume" else f"com.ximply.project={project}"
    command = ["docker", kind, "ls", "--quiet", "--filter", f"label={label}"]
    return sorted(set(executor(command, True).split()))

def operate(args: argparse.Namespace, executor: Callable[..., str] = run) -> None:
    project = ENVIRONMENTS[args.environment]
    base = compose(args.environment, args.application)
    if args.operation in ("reset-db", "nuke") and not args.dry_run and args.confirm != project:
        raise ValueError(f"Destructive action requires --confirm {project}")
    if args.dry_run:
        print(json.dumps({"operation":args.operation,"project":project,"compose":base,"destructive":args.operation in ("reset-db","nuke"),"resourceFilters":[f"com.docker.compose.project={project}",f"com.ximply.project={project}"],"note":"Preview only; resource enumeration and label checks occur before execution."},indent=2))
        return
    if args.operation == "deploy-swarm":
        if not args.context or args.confirm != project:
            raise ValueError(f"Swarm deployment requires --context and --confirm {project}")
        executor(["docker", "--context", args.context, "stack", "deploy", "--compose-file", str(ROOT / "infra/swarm/stack.yaml"), "--with-registry-auth", project])
        return
    if args.operation == "install":
        executor(base + ["config", "--quiet"])
        executor(base + ["up", "-d", "--wait", "--wait-timeout", "180"])
    elif args.operation == "status":
        executor(base + ["ps"])
    elif args.operation == "logs":
        executor(base + ["logs", "--tail", "100"])
    elif args.operation == "stop":
        executor(base + ["stop"])
    elif args.operation == "reset-db":
        require_local(executor)
        volume = project + "_app-db"
        available = resource_ids(project, "volume", executor)
        if volume not in available:
            raise ValueError("Expected application database volume with matching ownership label is absent")
        if args.application or args.environment == "prod":
            executor(base + ["stop", "api", "persistence", "realtime", "worker"])
        executor(base + ["stop", "postgres"])
        executor(base + ["rm", "--force", "postgres"])
        executor(["docker", "volume", "rm", volume])
        executor(base + ["up", "-d", "--wait", "postgres"])
        print("Database recreated. Apply reviewed migrations and seed before restarting application writers.")
    elif args.operation == "nuke":
        require_local(executor)
        containers = executor(["docker", "ps", "-aq", "--filter", f"label=com.docker.stack.namespace={project}"], True)
        if containers:
            raise ValueError("Swarm resources detected; use the target-specific Swarm teardown runbook")
        volumes = resource_ids(project, "volume", executor)
        images = resource_ids(project, "image", executor)
        executor(base + ["down", "--remove-orphans"])
        for volume in volumes:
            executor(["docker", "volume", "rm", volume])
        for image in images:
            executor(["docker", "image", "rm", image])

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["install","status","logs","stop","reset-db","nuke","deploy-swarm"])
    parser.add_argument("--environment", choices=ENVIRONMENTS, default="dev")
    parser.add_argument("--application", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--confirm")
    parser.add_argument("--context")
    args = parser.parse_args()
    try:
        operate(args)
    except (OSError, ValueError, KeyError, IndexError, subprocess.CalledProcessError) as error:
        print(f"Operation stopped: {error}")
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
