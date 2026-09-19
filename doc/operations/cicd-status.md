---
id: "DOC-OPERATIONS-0001"
title: "CI/CD status and activation"
status: "proposed"
domain: "operations"
owners: ["Yoshikemolo"]
applies_to: ["ximply-design-studio"]
related: []
source: ["Project owner requirements and design foundation; methodology application recorded in AUDIT-0001"]
---

# CI/CD status and activation

The design workflow executes documentation and harness tests plus PR metadata checks.
The editor workflow additionally builds the Angular preview and tests domain, renderer,
editor-state and local API behavior. It does not establish a passing Sonar analysis. The deployment
workflow is a deliberately blocking activation contract: destination, candidate,
image/provenance checks and target adapter must be implemented before it can deploy.
A successful design workflow is not a successful Sonar/app build or deploy pipeline.

Read doc/operations/container-builds.md for the complete pipeline stages to implement.
Targets and credentials will be supplied by the owner later. No bypass, fake deployment,
placeholder image publication or automatic production action is included. Pin workflow
actions to reviewed immutable SHAs during security hardening; current major tags are
bootstrap dependencies and do not constitute a locked application supply chain.

Repository required checks, GitHub environments and branch protection still need
configuration and verification. Tests within a PR can themselves be changed; protect
harness/workflow paths with required review and validate critical policy using trusted
base-branch code or an externally controlled reusable workflow before implementation
merges. The bootstrap workflow alone is not tamper-proof enforcement.

The quality-evidence feature branch provides a tested collector and a required
engineering module. It depends on foundation PR #1 and does not enable live analysis
or required-check enforcement. Its API contract must be validated on the selected
Sonar version before a trusted runner is activated.
