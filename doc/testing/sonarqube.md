---
id: "DOC-TESTING-0003"
title: "SonarQube installation and gate design"
status: "proposed"
domain: "testing"
owners: ["Yoshikemolo"]
applies_to: ["ximply-design-studio"]
related: []
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
The supplied normalized-report verifier enforces policy but is not yet a Sonar API
collector; implementing/authenticating that collector is part of ITER-0001.

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
Sonar scanner installation, API collector and required GitHub checks remain planned.
No Sonar analysis, coverage percentage or zero-issue result is claimed in this package.
