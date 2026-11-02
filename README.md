# Hazardous Hauler

Portrait, one-thumb cargo runner: collect value, manage weight, choose Depot
stops and improve the next run. Phaser web prototype targeting browser gaming
sites first, with mobile secondary; not a packaged mobile release.

## Run and check

From this project folder in PowerShell:

```powershell
npm.cmd run dev
npm.cmd test
npm.cmd run build
```

Use a Node version supported by Vite 7. Install dependencies only on a fresh
setup or an actual missing-dependency failure. Open Vite's printed URL, normally
http://localhost:5173/; do not open index.html directly.

Desktop: move the mouse over the road, or use A/D or Left/Right. Touch: press and
drag. Garage cards scroll; purchases require the existing confirmation.

Home actions: **Normal Run**, **Endless Run**, **Garage & Upgrades**, **How-To**.
Normal Run's level cards start directly from Sector 1 or that level's unlocked
Sector 3 checkpoint. Endless Run keeps one rules screen and unlocks after
Level 1 completion. Levels 3-5 Coming Soon cards are not playable.

## Source of truth

| Document | Responsibility |
| --- | --- |
| [GAME_DESIGN](docs/GAME_DESIGN.md) | Implemented rules, four-sector 4,000/5,000 m routes, economy, equipment and presentation |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | State/code ownership, persistence, lifecycle, assets and local setup |
| [TEST_PLAN](docs/TEST_PLAN.md) | Active regression matrix, commands, URL inspection and pending V1-V4 human checks |
| [DECISIONS](docs/DECISIONS.md) | Current overrides, unfinished specification conflicts and gated backlog |
| [AUDIT_REPORT](AUDIT_REPORT.md) | Latest before/after hygiene evidence, exact failures and prioritized health findings |
| [Implementation plan](docs/ImplimentationPan.md) | Owner-supplied six-slice polish roadmap and current execution checkpoint |
| [AGENTS](AGENTS.md) | Concise project working instructions |

The old guide/phase logs/handoffs were consolidated by owner authorization on
1 November 2026. Do not restore obsolete routes, prices or requirements from old
ZIPs/chat copies. Live values remain owned by
[gameBalance.js](src/game/data/gameBalance.js), not duplicated prose.

## Current status and internal inspection

Playable Levels 1/2, Standard/Swift, per-ship Garage/colors, equipped upgrades,
Depot Shield, layered roads and sector lighting are implemented. Future trucks
remain Coming Soon. Known repository failures and bot-only browser reliability
are **not resolved** by cleanup; consult the audit rather than old passing claims.
Human/mobile acceptance is PENDING.

The polish plan has been read completely. Slice 1 remains blocked: its latest
scoped gate is **6 PASS / 1 FAIL**, with collision-empty time above the existing
density limits. The seed 153 Overdrive entry and three-rate physical proofs now
pass. Retained physical coverage scoring improves empty time to 177.06 s overall
/ 141.24 s late, still above the unchanged limits. Spacing/filler rules are
unchanged; Slices 2-6 have not started.

Protected hands-free inspection:
http://localhost:5173/?god=true&bot=true&fast=true&level=2&sector=1

Temporary Garage unlock: http://localhost:5173/?unlockAll=true

URL-debug sessions never persist test Coins/progression. Approved fast mode is
3.5x. Remove the query string and reload for normal saved gameplay.

No deployment, Git initialization, Level 3, new tiers or Android packaging was
performed. Local build label `mobile-20261024-06` and last recorded public
`mobile-20261024-01` are provenance, not new release verification.
