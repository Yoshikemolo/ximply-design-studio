# CI/CD status and activation

The design workflow executes documentation and harness tests plus PR metadata checks.
It does not build or analyze application code because none exists. The deployment
workflow is a deliberately blocking activation contract: destination, candidate,
image/provenance checks and target adapter must be implemented before it can deploy.
A successful design workflow is not a successful Sonar/app build or deploy pipeline.

Read docs/operations/container-builds.md for the complete pipeline stages to implement.
Targets and credentials will be supplied by the owner later. No bypass, fake deployment,
placeholder image publication or automatic production action is included. Pin workflow
actions to reviewed immutable SHAs during security hardening; current major tags are
bootstrap dependencies and do not constitute a locked application supply chain.

Repository required checks, GitHub environments and branch protection still need
configuration and verification. Tests within a PR can themselves be changed; protect
harness/workflow paths with required review and validate critical policy using trusted
base-branch code or an externally controlled reusable workflow before implementation
merges. The bootstrap workflow alone is not tamper-proof enforcement.
