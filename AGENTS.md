# Project Instructions - Hazardous Haul

## Sources and scope

- Read [DECISIONS](docs/DECISIONS.md) and the relevant
  [GAME_DESIGN](docs/GAME_DESIGN.md), [ARCHITECTURE](docs/ARCHITECTURE.md) and
  [TEST_PLAN](docs/TEST_PLAN.md) sections before changing behavior.
  [AUDIT_REPORT](AUDIT_REPORT.md) records current health/blockers.
- Current workspace/code and latest explicit owner decisions outrank old ZIPs,
  phase guides and chat snapshots. Distinguish implemented rules from future plans.
- Preserve current work/tester saves. No silent reset, deployment, Level 3,
  unapproved tiers/art or feature inventions. Do not initialize Git unrequested.

## Ownership and edits

- Keep one generator, physical validator, stat owner, settlement owner and
  persistence boundary. Rendering must not select encounters or award currency;
  geometry must not derive from artwork.
- All gameplay/menus are currently in RoutePrototypeScene; do not invent a
  GarageScene or parallel service for a small fix.
- Make one bounded change, preserve active test contracts and update only directly
  related maintained docs. Retain live legacy migrations and tested scaffolding.
- No snapshot source trees, stray probes/logs or competing documentation guides
  in production. Temporary task evidence belongs outside the project.

## Verification and progression

- Use existing Node tests and Vite build commands per
  [TEST_PLAN](docs/TEST_PLAN.md). Run focused checks for direct dependents; full
  workstream suites at gates, full tests/build when explicitly required.
- Report actual counts/times, failures and checks not run. Existing failures are
  blockers, not permission to weaken assertions or change balance without scope.
- Do not advance a mandatory failed gate; stop after bounded focused corrections.
  Phone/playtesting is PENDING until genuinely observed, never inferred from bots.
- Prefer lightweight portrait/touch behavior and reusable assets. No forced ads,
  backend/analytics, monetization or scope expansion without owner authorization.
