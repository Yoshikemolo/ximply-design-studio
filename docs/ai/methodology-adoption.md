# AI-ENG-0001 — Project implementation profile

Source: user-supplied *AI-Assisted Software Engineering Framework*,
SOP-ENG-2026 draft v0.1, filename ending EN202608161000.md. The source itself says
it is a proposal, not a ratified organizational standard. Jorge explicitly requested
using its methodology for this project. This profile operationalizes that request
without claiming organization-wide ratification. The original is not included in
public source because it contains organizational examples irrelevant to this product.

| Source principle | Repository implementation |
| --- | --- |
| Repository is source of truth (§12–16) | README, docs/INDEX, ADR, traceability.json |
| Addressable selective context (§4,7,19–20) | Stable IDs, dependency links and per-feature plans |
| Human ownership and integration (§8–11,58–65) | AGENTS, PR template, Proposed ADRs, reviewed integration |
| Versioned safe agent instructions (§17–23) | docs/ai; local private config ignored |
| Dependency governance (§24) | SPIKE-0001, dependency register, exact lockfiles before product code |
| Small batches (§25–26) | Vertical iterations and FEAT plans with evidence checkpoint |
| Independent evidence (§27–44) | SC acceptance oracles, fixture provenance, mutation/property testing |
| Static/security quality (§45–51) | Strict quality policy, threat controls, protected pipeline design |
| API/DB change discipline (§53–54) | Versioned contracts, migration/replay tests and rollback notes |
| Observability (§52,66) | Structured telemetry, perf fixtures and delivery metrics |

## Explicit project overrides and extensions

1. Jorge's quality threshold is stricter than Annex B: **all modules**, whole authored
   code and new code, coverage >80%, duplication <3%, zero bugs/code smells/hotspots.
   Also require zero vulnerabilities. Do not substitute >=80, <=3 or reviewed hotspots.
   Both line and branch coverage must exceed 80% where executable branches exist.
2. `ADR/` is the canonical decision directory specified by the source. `docs/FEAT`,
   `docs/SC`, `docs/SEC` and the identifier registry are project extensions. SC means
   Scenario, not Security Constraint; SEC is used to avoid ambiguity.
3. Initial repository creation and publication of this design are explicitly requested.
   The design branch/PR do not authorize future automatic merging or production releases.
4. ADRs remain Proposed until Jorge or another named human accepts them. Implementation
   spikes can gather evidence without representing architecture as already accepted.
5. Use the owner-defined GitFlow profile: dev, feat/*, fix/*, qa, demo, release, main;
   new work starts from dev and promotion follows passing checks and review. Empty bootstrap is not
   a product-quality result. A solo author cannot provide an independent self-approval;
   recruit another reviewer before protected implementation integration.

## Document status model

Proposed -> Accepted (human) -> Implementing -> Verified -> Released, with Blocked,
Rejected and Superseded alternatives. FEAT and SC remain Planned until evidence
exists. Verified requires concrete tests/build/analysis and owner review, not prose.
Every iteration updates traceability, status, evidence, contracts, ADR consequences
and README limitations together. Do not append contradictory success claims.

## Owner contribution-policy override

All engineering prose is English and emoji-free. No attribution fields or provider/model
mentions appear in commits or PRs; identities map to Yoshikemolo. Conventional Commits
and the custom GitFlow profile are mandatory. These explicit user requirements
override the source methodology examples. Product i18n catalogs remain multilingual.
