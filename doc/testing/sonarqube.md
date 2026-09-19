---
id: "DOC-TESTING-0003"
title: "SonarQube installation and gate design"
status: "proposed"
domain: "testing"
owners: ["Yoshikemolo"]
applies_to: ["ximply-design-studio"]
related: ["PLAN-0023-0001"]
source: ["Project owner requirements and design foundation; methodology application recorded in AUDIT-0001"]
---

# SonarQube installation and gate design

A local SonarQube service plus a dedicated PostgreSQL database is defined in the
infrastructure Compose template. Pin images and scanner versions in SPIKE-0001.
Scanners run per module: TS/Angular and Python with the generic scanner and correct
coverage paths; .NET with begin -> build/test -> end. One Sonar server is enough;
frontend and backend analysis are separate projects with module-specific evidence.

## Exact requirements

Apply whole-code and new-code checks: bugs=0, vulnerabilities=0, code_smells=0,
security_hotspots=0, line coverage >80%, branch coverage >80% where branches exist,
overall Sonar coverage >80%, duplicated_lines_density <3%. Ratings A are additional,
not substitutes. Reviewed hotspots are still hotspots; do not turn the zero-count
requirement into 100% reviewed. Resolved false positives require independent review
and explicit evidence; agents cannot suppress findings to pass.

Built-in gate thresholds and metric names depend on the pinned Sonar version and
mode. Disable the small-change coverage/duplication exemption where configurable.
Use `sonar.qualitygate.wait=true` and an external fail-closed verifier for exact
strict inequalities and per-module line/branch coverage. A built-in pass alone is
not sufficient. Verify scanner compute-task completion and analyzed revision before
fetching measures. Never accept metrics from an earlier successful main analysis.
The normalized-report verifier enforces policy. `harness/collect_quality.py` now
collects revision-bound API evidence; live-server verification remains outstanding.

The template properties files point to planned source/report directories. They are
not runnable scans until those modules exist. Missing sources or coverage must fail.
An empty module cannot become green by excluding its source. Only generated clients,
vendored dependencies and build output have justified exclusions, recorded in review.

## Public GitHub CI

A GitHub-hosted runner cannot reach a laptop's localhost SonarQube. Options: a secured
reachable Sonar instance, or an isolated trusted local runner feeding a check for
the exact reviewed commit. Never execute arbitrary public-fork code on a persistent
privileged local runner or using `pull_request_target` with secrets. Sonar edition
support for branches/PR decoration must be verified before selecting topology. If
PR analysis is unavailable in the chosen edition, record a supported trusted analysis
strategy; do not skip the mandatory gate.

Bootstrap CI executes doc/contracts/governance tests only. Application pipelines,
Sonar scanner installation and required GitHub checks remain planned; the collector
has local negative-path tests but has not been exercised against a configured server.
No Sonar analysis, coverage percentage or zero-issue result is claimed in this package.

## Collector runbook

The collector covers all required modules, including engineering harness/scripts.
Use a trusted manifest with exactly `serverVersion` (the reviewed exact numeric
server version) and `modules` (keys equal requiredModules in quality-policy.json).
Each module has distinct `projectKey` and `taskId` fields. Obtain taskId from that
module's scanner report after scanning the exact commit with `sonar.scm.revision`.
Do not accept an arbitrary manifest or source checkout supplied by an untrusted PR.

The first adapter supports Standard Experience metric keys and main-project scans
only. It rejects branch/pullRequest manifest fields. Run trusted isolated candidate
projects if the selected edition lacks branch support; validate the actual server
contract before adopting that topology. No silent fallback or MQR metric remapping.
Task and project permissions must allow Execute Analysis and Browse; administrative
credentials are not needed for this collector. Inject SONAR_TOKEN through the local
secret environment or a trusted CI secret store; never put it in a command argument.

```bash
python3 harness/collect_quality.py --server https://sonar.example.invalid --manifest reports/sonar-manifest.json --revision FULL_COMMIT_SHA --output reports/quality.json
```

For local loopback development use `--server http://127.0.0.1:9000 --allow-local-http`.
The illustrative host and revision above are intentionally not deployment values.
The same command works with `python` in PowerShell. HTTP elsewhere, redirects and
implicit proxy configuration are rejected. HTTP errors and server response bodies
are not echoed. Requests have a 20-second timeout and a 2 MiB response limit.

Successful task identity, analysis ID and exact SCM revision must agree. The latest
analysis is checked before and after fetching measures because measures are not
queried by immutable analysis ID. Gate status is queried by analysis ID. Missing
metrics fail rather than becoming zero; omitted branch coverage is allowed only
when conditions-to-cover is explicitly zero. A failed strict gate writes its complete
failing report and exits nonzero; collection failure removes a previous output and
writes no replacement. Reports are confined to the local reports directory.

Tests: [collector tests](../../tests/test_quality_collector.py). Plan and scope:
[PLAN-0023-0001](../implementation/PLAN-0023-0001.md). The official
[Web API](https://docs.sonarsource.com/sonarqube-server/extension-guide/web-api) and
[metric definitions](https://docs.sonarsource.com/sonarqube-server/user-guide/code-metrics/metrics-definition)
were checked on 2026-09-19, together with the official next.sonarqube.com API response
examples for ce/task, project_analyses/search and measures/component. API examples
support fixture shapes; they do not prove compatibility with an installed version.
