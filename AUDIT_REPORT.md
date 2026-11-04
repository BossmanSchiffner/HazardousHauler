# Repository Audit & Architecture Health Report

**Date:** 1 November 2026. **Audit checkpoint status:** cleanup and verification complete;
full suite retains 45 pre-existing failures, with zero changed test outcomes.
This report was created before removals and updated with actual
actions/evidence. No gameplay, balance, save-schema, collision, physics or
rendering-pipeline refactoring was authorized or performed.

The audit sections below are the **hygiene checkpoint**, not a claim that
subsequent feature edits are removal-only. See the [subsequent cargo/sprite and
lighting task record](#subsequent-cargosprite-and-lighting-task-record) for the
latest authorized changes and focused verification.

## Latest execution: Slice 6 CLOSED (4 November)

Owner decision: close Slice 6 on the known-good generator. **Slice 6 is CLOSED; build PASSING.**

- `src/game/core/trackGenerator.js` was restored byte-for-byte (SHA-256 `E698632F…AEB7`) to its
  pre-straight-run, pre-wider-search state. Neither attempted generator change shipped:
  - Straight-run denial (reject candidates that leave a lane open for 4 consecutive rows).
    It removed every straight window. However, it broke three other tests:
    - the late-sector empty budget (77.09 s > 75.79 s);
    - the Level 2 two-lane Forklift coverage;
    - the early-Depot encounter count.
  - Wider certified-variant search (all variants of `split_gate`, `offset_pair` and `narrow_corridor`
    before the certified fallback). It brought seed 153 Level 1 fallbacks to 0. However, it broke four
    other tests:
    - handling 0.32 had no collision-free Level 1 path (`hazards:350`);
    - the Level 2 URL debug bot crashed (`sceneLifecycle:470`);
    - the Level 2 middle section emitted no paired Forklift (`chicanes:82`);
    - seed 1's tier-2 share rose to 0.7645 (`hazards:227`).
  - The attempted source is kept outside the repository for future maintenance. Nothing was pushed or deployed.
- Kept the early-Depot warning test revision in `tests/density.test.js`. It allows at most 1 distinct
  encounter in `[depot-60 m, depot)` for early bays and keeps the 2 s clear approach. Notices at <=60 m are
  covered by `rendering:1579/2440` and `sceneLifecycle:4412`.
- Commands:
  - `npm.cmd test`: **516 PASS / 2 FAIL of 518** (1,129 s).
  - `npm.cmd run build`: **PASS** (13.3 s; existing >500 kB chunk-size warning only).

**Deferred technical debt** (non-breaking; to be addressed in post-launch maintenance):
1. `clearRowRule:326`: seed 153 Level 1 Normal emits 4 certified budget-exhaustion fallbacks in the late
   sectors (expected 0). Fallback rows remain certified and keep >=6 px clearance.
2. `longObstacles:15`: about 1-2.5% of four-row windows keep a straight lane, for example seed 1 sector 3
   `split_gate` divider rows. All rows remain certified and keep >=6 px clearance. A future fix must hold
   the density, mover-coverage, handling-path and debug-bot gates listed above.

**Readiness:** The engineering gate is closed. The owner marked the codebase ready for Human Testing V1-V4
and CrazyGames SDK integration. V1-V4 are **PENDING** (not yet performed). The SDK integration is not
yet implemented. Tester progress is unchanged.

**Owner follow-up (4 November):** both playable levels now use four equal 1,000 m
sectors and finish at 4,000 m; Level 2 opens at Level 1's 1,000 m Sector 2 speed.
Normal runs clear all hazards at 10 m before finish and suppress obstacle spawns
at and beyond that boundary. Cargo and Blueprint pickups are unchanged. Focused
boundary, mover, density/chicane, finish-clear and route-stream tests pass. A
deterministic 250 ms worker-starvation fallback now prevents late worker rows
from creating extended clear-road runs while preserving the logged route and
Depot reset replay. This follow-up does not replace the recorded full-suite
result above.

## Previous execution: stale-fixture batch, tiered tracing and retired-mode reconciliation (4 November)

Owner-authorized test-only reconciliation. No `src/game` file, clearance threshold
(>=6 px), density cap or balance value changed. Full suite **515/3 of 518**
(1,350 s, was 474/43); build **PASS**. The early-Depot warning test was since revised by
owner decision (item 2 below; focused PASS, full suite not rerun). Slice 6 remains **BLOCKED**
on two live findings.

Per-file fixture fixes (expectations now derived from live code / `GAME_BALANCE`):
- `rendering`: Barrier art mount and divider hit edge from `hazardGeometry` footprints.
- `gameBalance`: `hitX`/`hitY` mirror live `hazards.js` derivation (footprint, lane-wide inset, roadside).
- `sceneLifecycle`: Precision is a priced Garage card, not a free starter.
- `economy`: piecewise sector-start speed model for both levels.
- `debugManager`: escape and Forklift fixtures moved outside stale contact windows (no `DebugManager` defect found).
- `longObstacles`: legacy authored-registry check removed; elongated length/spacing from live rows; roadside bodies are single curb lanes.
- `sectors`: procedural `${profile}:${signature}` ids with chunk certificates; boundary replay
  now spawns only emitted rows plus continuations (harness bug, not a generator defect).
- `trackGenerator`: pair truncation at sample end; Normal fixtures bound to each level's
  campaign finish (retired per-level Overdrive); risk-reward premium cargo sampled on live
  routes (Level 1 campaign emits none within 4,000 m; Level 2 and past-finish do). The
  captured pre-repair contact baseline keeps its fixed 8,000 m stream window.
- `chicanes`: spacing follows generator rules (mover recovery gap, chicane transition);
  paired-mover check now asserts Forklift pairs (opposite travel, mirrored companion sides).
  Static Alpha reversals came from the vertical Sweeper, removed from Level 2 by the owner.
- `clearRowRule` formation: steering variety measured per sector on the real 4,000 m level;
  side funnels assert curb-only narrowing; slalom fixture uses curb rails on both sides and
  a closed row that falsely advertises lanes so only physics rejects it.
- `density`/`chicanes`: two files were corrupted by a PowerShell replacement during this slice
  and reconstructed; re-corrupting each reconstruction reproduces the corrupt file byte for byte.

Remaining failures (not weakened; need owner decision or generator work):
1. `clearRowRule` steering variety: seed 153 Level 1 Normal has 4 certified budget-exhaustion
   fallbacks (361, 727, 2,514, 2,660 m). This is the known "seed 153 fallback" in Section 6.
2. RESOLVED by owner decision (4 November): the `density` early-Depot test previously required
   >=2 warning encounters, but the protected approach (2 s at 320-410 px/s, about 55-62 m)
   nearly covers the 60 m notice window. The test now requires <=1 distinct encounter (emitted
   row) whose last contact lies in `[depot - 60, depot)`. The old `warningEncounters` count was
   per hazard: its "3" was one three-divider `offset_pair` row. Measured on seeds 1/153/1234/98765
   (500/1,000/2,000 m bays): 0-1 encounters per bay, approach 54.8-62.6 m (2.40-2.83 s >= 2 s),
   and every seed keeps early pickups. Notice visibility at exactly 60 m (label, chevrons, HUD)
   stays asserted in `rendering` and `sceneLifecycle`. Focused runs: density 1/1, visibility 3/3.
3. `longObstacles` four-row windows: 6-15 of 597 windows per seed keep a straight lane
   (`split_gate`, `offset_pair`, `risk_reward`, `single_pressure`, `side_squeeze`).

Human V1-V4 remain PENDING.

## Previous execution: migration fix, route-starvation fallback and generator test revisions (3 November)

The owner authorized fixing the `migrateV1` bug, revising requirements
#25/#26/#27, and adding a fallback for empty roads ("Why are there no hazards?").
No generator clearance threshold (>=6 px), density cap or balance value changed.

- **`src/game/core/save.js` (`migrateV1`):** migrated v1 profiles now equip
  `hand_precision` first, then the starter IDs and Cargo Capacity when it is
  owned, capped at the starting slot count. The `modules` "v1 migration is
  never weaker" test now passes.
- **Empty road root cause:**
  - The background route worker was CPU-starved during a heavy test run. A
    Vite full reload, triggered by a `save.js` edit, also restarted it.
  - Meanwhile `RoutePrototypeScene` silently skipped spawns while
    `nextRow()` returned `null`. The live stream showed `starved: 986` frames,
    about 16 s.
- **`src/game/core/routeStream.js` (fallback):**
  - After `ROUTE_STREAM_FALLBACK_MS = 500` of starvation, the stream plans
    the next row on the main thread.
  - It uses the same deterministic `createRoutePlanner` call log, starting
    from the last consumed row or the Depot exit origin. Rows are
    `structuredClone`d; `stats.fallbackRows` counts them.
  - The fallback state resets on Depot promotion, rebuild and destroy.
  - The output stays identical to the worker replay.
- **`tests/routeStream.test.js`:**
  - Added a starved-stream test (with a Depot reset).
  - Added an interleaved worker/fallback test.
  - Both compare against `replay()`.
- **`tests/hazards.test.js` revisions:**
  - **#25, mix:**
    - The tier-2 band changes from a provisional 50–60% to 0.65–0.75. The
      measured share is 0.692–0.706 over 2,000 chunks for seeds 1, 153, 1234
      and 98765.
    - Objects per row now count physical bodies, excluding side-structure
      `continuation` references. The value is 2.18–2.19 against the
      unchanged < 2.5 cap; the old count, 2.51, double-counted spans.
    - The no-repeat rule now exempts exhausted-budget `fallback` chunks.
      These were 1–3 per 2,000 chunks, because the generator deliberately
      skips the recent-layout check there.
    - Added checks that tier-1 recovery remains and every row leaves a lane
      open.
  - **#26, weaves:**
    - The lane-change minimum changes from >=5 to >=4. All 10 authored weaves
      in all five registries have exactly 4.
    - A previously hidden stale assertion required both outer single-lane
      commitments in each weave. Authored weaves commit to one side each, so
      the check now asserts that the mirrored pair covers lanes 0 and 3.
    - The mirror, root clearance and divider checks are unchanged.
  - **#27, emitted rows:**
    - The synthetic 7 m pair-wise driver is replaced. Seed 1234 is now played
      back through the production distance domain (`sampleRoute`) for every
      Level 1 and Level 2 sector.
    - Every emitted row's generator certificates must cover 30/60/120 Hz with
      clearance >= 6 px.
    - A whole-route `validateTrackSequence` replay must certify the stock
      half-load baseline at >= 6 px.
    - Each `handlingCases` value (0, 0.32) must have a collision-free path.
    - The Level 1 playback must be deterministic.
- **Recorded finding (not gated):** the validator steers eagerly at reaction
  time.
  - Under that model, whole-route replays at handling 0.52 and above
    (Precision 3+) find no path at >= 0 px.
  - At 0.32 the minimum clearance is 0.17 px on Level 1 and 2.17 px on
    Level 2; the closest point is an offset_pair at about 2,586 m.
  - The generator certifies only the stock baseline reference. Faster
    steering can always wait, so this is a validator-model limitation, not
    an observed collision. Human playtesting with upgraded Precision is
    PENDING.
- **Commands and actual results:**
  - `node --test tests\routeStream.test.js`: **7/7 PASS**.
  - `node --test tests\modules.test.js tests\saveMigration.test.js tests\sceneLifecycle.test.js tests\blueprints.test.js tests\progression.test.js tests\depotEconomy.test.js tests\vehicles.test.js`:
    **215 PASS / 1 FAIL**. The failure is the stale Garage card fixture,
    `sceneLifecycle.test.js` "Garage upgrade cards…": a fresh profile expects
    Precision "EQUIPPED" (old free starter), but it now shows 50 Coins. This
    test is one of the known 58 failures.
  - Focused revised hazards tests (`--test-name-pattern`): **3/3 PASS**.
  - `node --test tests\hazards.test.js`: see the
    [full hazards result](#full-hazards-result) below.

### Full hazards result

`node --test tests\hazards.test.js`: **19 PASS / 0 FAIL** (482 s). Before
these revisions it was 16/3.

### Slice 6 gate rerun

- `npm.cmd test`: **474 PASS / 43 FAIL of 517** (551 s). The previous run
  was 452/58. **Slice 6 remains BLOCKED.**
- `npm.cmd run build`: **PASS** (5.2 s). The only warning is the existing
  chunk-size warning.
- Remaining failures by file (none was introduced by these changes):
  - `density` (10)
  - `controlledMovers` (8)
  - `trackGenerator` (5)
  - `clearRowRule` (4)
  - `debugManager` (3)
  - `cargo` (2)
  - `longObstacles` (2)
  - `rendering` (2)
  - `sectors` (2)
  - `chicanes` (1)
  - `economy` (1)
  - `gameBalance` (1)
  - `sceneLifecycle` (1): the stale Garage card fixture
- Most remaining failures are generator, mover and density contracts. They
  need separate owner-authorized diagnosis; requirements were not weakened.

### Diagnosis of the 43 remaining failures (read-only; no code changed)

The owner chose "diagnose all, no code changes".
- **Method:** reran the 12 failing generator/balance files (`node --test` →
  180/42 of 222; the 43rd failure is the Garage fixture). Captured the
  assertion details, then classified each failure against code and the owner
  decisions in `docs/DECISIONS.md` and `docs/GAME_DESIGN.md`.
- **Who checked what:**
  - I verified the Overdrive and budget clusters directly.
  - Read-only agents classified the mover, side-structure and balance
    clusters; I spot-checked their production-defect claims.

| Cluster | Count | Tests | Classification and evidence | Fix scope |
|---|---|---|---|---|
| Retired `overdrive` mode | 10 | `cargo:91`; `controlledMovers:105,113,138,167,188`; `density` subtest level2/overdrive, `:237`, `:253`, `:270` | **STALE** (high). Per-level Overdrive mode was retired (`DECISIONS.md:32`, `GAME_DESIGN.md:70`), so these throw `Unknown … mode overdrive`. Post-finish difficulty steps still exist in Normal. | Tests: migrate to Normal past the finish or Continuous; delete the retired 760 px/s stage contract. |
| Recovery budget 16 vs ordinary 8 | 6 (+1 parent) | `density:43`, level1/normal/153, level2/normal/153 (parent `:126`); `trackGenerator:238,536`; `clearRowRule:266` | **STALE** (high). `densityRecovery.candidateBudget: 16` (`gameBalance.js:110`) raises `proposalBudget` (`trackGenerator.js:1685`). The tests compare against `encounters.candidateBudget` 8; this audit already called 16 the "approved bounded recovery budget". | Tests: assert `attempts <= row.candidateBudget` and that the budget is 8 or 16. |
| L2 movers are Sector 2+ Forklift only | 6 | `controlledMovers:88` (1000 vs 1500 bank), `:298` (108 px two-lane sweeps), `trackGenerator:637` and `density:326` (no movers in Sector 1); `controlledMovers:208,327` | **STALE** (high for the first four; medium for `:208` and `:327`, whose accounting and outer-filler contracts need a closer read). | Tests only. |
| Test code bugs | 2 | `trackGenerator:608` (`levelId` undeclared); `cargo:118` (reuses L1 distances for L2 boundaries 500/1500/3000/5000) | **TEST_BUG** (high). | Tests only. |
| Spec or snapshot drift | 4 | `gameBalance:10` (snapshot lacks `forkliftWarningSeconds` and `sweeperForwardSpeedRatio`); `debugManager:113` (asserts the historical 2x conflict; 3.5x is approved, `DECISIONS.md:62`); `rendering:1099` (Barrier body 62 vs 60); Garage card (Precision is 50 Coins) | **STALE** (medium–high). | Tests only. |
| Legacy authored-chunk assumptions | 3 | `sectors:289` (procedural ids are not in `CHUNK_REGISTRIES`); `longObstacles:15,41` (authored weave windows and lengths) | **STALE** (medium). The generator is procedural; registries are legacy. | Tests: retarget to procedural output and its physical certification. |
| Need owner decision or deeper trace | 11 | `trackGenerator:129`; `sectors:309`; `clearRowRule:325,630,660`; `debugManager:79,90`; `density:340`; `chicanes:80`; `economy:34`; `rendering:1154` | **UNRESOLVED.** Possible genuine defects or spec conflicts (details below). Do not waive. | Per-item trace. |

Notes on the unresolved 11:
- **`trackGenerator:129`:** stops on chunk identity (`undefined` vs a
  `side_squeeze` descriptor) before its real 30/60/120 Hz collision replay.
  Emitted/truncated encounter identity must be resolved, not deleted.
- **`sectors:309`:** compares raw `safeLanes` across long bodies, the same
  class as the replaced hazards #27. It is likely stale, but physical
  certification should replace it.
- **`clearRowRule:325,630,660`:** formation-variety, two-lane-funnel and
  exact slalom-trace contracts. These need an owner ruling on whether they
  remain generator requirements.
- **`debugManager:79,90` (debug bot only, not gameplay):**
  - `:79`: guardrail flank contact is now non-lethal, so the bot may
    legitimately stay in lane 0.
  - `:90`: uses the Level 3 `sweeper`. Confirm the intent before treating
    either as a defect.
- **`density:340` (seed 1, 1,000 m bay):** the owner-approved Depot spacing
  of 500/1000/2000 leaves 500 m between the first two bays. The rule of ≥2
  warning encounters may conflict with that spacing; measure it before
  changing pacing.
- **`chicanes:80`:** row spacing differs from the recomputed spacing beyond
  8 ε. It is either a genuine propagation defect or a float-domain fixture
  issue; trace it.
- **`economy:34`:** "speed curve still rising at the 4,000 m finish" should
  be checked against the approved sector-start interpolation
  (L1 320/350/380/410).
- **`rendering:1154`:** a Barrier/divider texture-replacement assertion; the
  current texture set should be checked.

## Previous execution: Stale fixture reconciliation with GAME_BALANCE (3 November)

The owner asked for this task: replace stale literals in five test files with
values derived from `src/game/data/gameBalance.js`. No live `src/` code,
generator clearance threshold (>=6 px) or density cap was changed.

- **Files changed:**
  - `tests/depotEconomy.test.js`: repair, record, completion, no-damage,
    crash, skip-bonus and continuous values now come from `GAME_BALANCE`.
  - `tests/modules.test.js`: prices, caps, slots, stats, capacity and
    mitigation are derived. Precision Steering is bought explicitly because
    balance has `starter: false` and a price of 50.
  - `tests/blueprints.test.js`: Blueprint conversion and L1 sector boundaries
    are derived. Adds a Swift = 6 BP guard (balance plus catalog).
  - `tests/progression.test.js`: sector and finish boundaries, Magnet price,
    completion coins and Impact Pulse values are derived.
  - `tests/hazards.test.js`: boundary probes use
    `GAME_BALANCE.hazards.playerHalfWidthPx` (12.54) and `playerHalfHeightPx`.
    Note that `PHYSICS.PLAYER_HALF_WIDTH` does not exist. The outer probe adds
    1e-9 for float drift. The 1,200-row driver now uses backward lane
    reachability and handling cases from balance.
- **Pinned spec guards:** these deliberately keep owner-approved literals:
  L1 = 0/500/1000/2000 with a 4000 finish, L2 finish 5000, Cargo rank 1 = 150,
  Swift = 6 BP, crash cap = 50.
- **Commands:**
  - `node --check` passes for all five files.
  - `node --test tests\depotEconomy.test.js tests\modules.test.js tests\blueprints.test.js tests\progression.test.js`
    gives **48 PASS / 1 FAIL**.
  - `node --test tests\hazards.test.js` gives **16 PASS / 3 FAIL**.
  - Overall: **64/4 of 68**, compared with **52/12 of 64** before.
- **Remaining failures (not weakened):**
  1. `modules` "v1 migration is never weaker": a genuine `save.js` regression.
     `migrateV1` grants owned `hand_precision` ranks but equips only the empty
     `STARTER_MODULE_IDS`, so migrated handling becomes 0. Fixing it needs an
     approved change to live code.
  2. `hazards` manoeuvring mix 0.692 against a 50–60% target: historical
     generator blocker #25.
  3. `hazards` roadside weaves have 4 lane changes against a required >=5:
     historical blocker #26.
  4. `hazards` 1,200-row driver: `0->1 collision with sideRail at 203m`. A
     342 px rail body reaches into a row whose lane 0 is still listed as safe;
     this is the same class as historical blocker #27. After two fix
     iterations, the recommendation is to certify with the generator's own
     `trackValidation` replay instead of a hand-written pair-wise driver.
- **Stale design doc:** `GAME_DESIGN.md` still lists Precision Steering as
  "Starter". Balance and the UI both use 50 Coins.
- The full suite was not rerun. **Slice 6 remains BLOCKED** (last full run:
  452/58).

## Previous execution: Slice 6 persistence PASS, full engineering gate BLOCKED (3 November)

Owner authorized Slice 6. Read the maintained slice requirements, test plan,
current code owners and A3/A4 findings; did not restart completed slices or
perform a new repository audit.

### Persistent changes

- **A3 fixed:** `RoutePrototypeScene.triggerHint` builds and persists a
  candidate before committing seen-hint state or displaying/queuing the hint.
  Failed writes leave the original profile untouched and the hint retryable.
  While its error toast is visible, a failed hint does not retry synchronous
  storage every Depot-approach frame.
- **A4 fixed:** `save.js` reports startup read/corruption/schema failures through
  `loadProfile(onWarning)` and explicit console warnings. The scene displays
  the error toast after world/menu initialization. Loading never overwrites
  the main key. Backup preserves exact raw bytes and earlier distinct backups
  (numbered suffixes; identical backup reuse). Backup failure blocks replacement
  until backup retry succeeds. Read failure blocks all saves until the original
  can be successfully reloaded; restored write access alone cannot commit
  unread defaults.
- Tests in `saveMigration.test.js` cover corrupt JSON/unsupported schemas,
  backup failure/retry/history, read failure, Level 1 completion -> Level 2
  access, paid Swift acquisition/selection and receipt idempotency through
  storage reload, plus eight equipment items rotated through full six-slot
  Standard/Swift loadouts with unchanged stats. Legacy fixtures now explicitly
  own equipped Precision Steering, and the v8 test honors the existing schema
  11 capacity auto-equip migration.
- `sceneLifecycle.test.js` tests startup warning order, hint save-before-commit,
  queued hints and 60 repeated failed-hint frames with just one save attempt.
  Cargo tier fixture checks preserve the actual loadout rather than assuming
  a free starter module.
- Preserved schema/key, geometry, quotas, generator, prices and deployed saves.
  Latest six-slot/current equipment/six-Blueprint Swift decisions supersede
  stale five-socket/Traction Cleats/free-Swift wording in the slice prompt.
  No new module, vehicle grant or Level 3 implementation.

### Commands and actual results

| Command | Actual result |
|---|---|
| Initial save/hint/bank/repair/settlement selectors on `saveMigration`, `sceneLifecycle`, `progression`, `vehicles` | 45 PASS / 2 FAIL; fixture corrections: normalization's existing Level 1 milestone, obsolete free-starter assumptions |
| Two focused fixture retests | 46/1, then **47/0**, 0.384 s; no production balance or assertion threshold changes |
| `npm.cmd test` | **452 PASS / 58 FAIL / 510 tests**, 29 files, **532.021 s**, exit 1 |
| `node --test tests\saveMigration.test.js` after focused legacy-fixture corrections | **16/0**, 0.124 s |
| `node --test --test-name-pattern='startup save\|hint persistence\|persisted hints\|save\|persist\|bank\|repair\|settlement' tests\sceneLifecycle.test.js tests\progression.test.js tests\vehicles.test.js` | **38/0**, 0.383 s |
| Individual `node --check` on the two changed source files and two test files | **4 PASS** |
| `npm.cmd run build` on final source | **PASS**, 4.75 s; main JS 1,516.87 kB / 433.39 kB gzip, route worker 92.43 kB; existing >500 kB chunk warning |
| Inspect final `dist` | One route-worker asset, **0 `.map` files / 0 `sourceMappingURL` files** |

The full suite was **not rerun** after the focused migration/hint corrections.
Do not subtract locally repaired failures and present a fabricated full-suite
result; **452/58 is the last actual full gate, not a PASS**.

### Exact failed-gate inventory and next work

| File | Failures in the full run |
|---|---:|
| `cargo.test.js` | 2 |
| `chicanes.test.js` | 1 |
| `clearRowRule.test.js` | 4 |
| `controlledMovers.test.js` | 9 |
| `debugManager.test.js` | 3 |
| `density.test.js` | 10 (includes three nested route cases) |
| `economy.test.js` | 1 |
| `gameBalance.test.js` | 1 |
| `hazards.test.js` | 4 |
| `longObstacles.test.js` | 2 |
| `modules.test.js` | 8 |
| `rendering.test.js` | 2 |
| `saveMigration.test.js` | 3; subsequent whole-file rerun 16/0 |
| `sceneLifecycle.test.js` | 1; Garage art/rank card fixture outside final selectors |
| `sectors.test.js` | 2 |
| `trackGenerator.test.js` | 5 |

Confirmed examples, not blanket stale-fixture classification:

- Density/short-recipe/cadence assertions still compare attempts only against
  the ordinary candidate budget instead of the row's approved bounded recovery
  budget. Several tests still call removed `overdrive` mode or assume free
  Precision Steering.
- `trackGenerator.test.js:609` references undeclared `levelId`.
  Its mover-window test at line 687 expects four bodies in the static interval
  ending at 500 m; current approved Level 2 movers start at Sector 2.
- The integrated physical route test at line 146 stops on next-row chunk
  identity (`undefined` versus a `side_squeeze` descriptor) **before reaching
  its collision replay**. This is not evidence of a demonstrated collision,
  nor permission to drop the assertion; resolve emitted/truncated encounter
  identity and then execute the real 30/60/120 Hz proof.
- Existing rendering assertions at lines 1128/1178 fail whole-art width fit and
  the divider collision boundary. Formation/chicane/long-obstacle and other
  route expectations also remain unresolved. Do not waive safety, quotas,
  geometry or pressure targets to make the full gate green.

**Next authorized task:** remain in Slice 6. Reconcile remaining failed
fixture contracts against current decisions, then diagnose the actual
generation/geometry assertions with focused reproductions and unchanged
physical gates. Rerun the full repository gate only after those repairs.
No subsequent milestone, deployment or release sign-off is authorized by
the passing persistence/build subset.

### Save protection and human/browser status

All storage mutations in tests used memory fixtures. Browser fault-injection
attempts could not complete (isolated context unsupported; routed reloads timed
out); do **not** claim a live warning-screen PASS. The real scene startup
warning-to-toast path passes its Node lifecycle test. Inspection restored to
`http://localhost:5173/`, ordinary menu, no synthetic fixture retained.
Actual tester-profile SHA-256 before/after remains
`e0965babb3ffb42ce409be2f1fc55828a89aeb1c9cb762675977293eeb0e15ed`.

**Slice 6 remains BLOCKED.** V1-V4, mobile jitter/touch/sound and live recovery
UI acceptance are **PENDING**. The existing V1-V4 checklist is retained, but
engineering sign-off/human-gate advancement awaits a genuine full PASS.

## Previous execution: Off-thread route planning and Forklift-only Level 2 (2 November)

Owner reported persistent micro-pauses ("0 load time in a run") and then
required Level 2 movers to be lateral Forklifts only (vertical StreetSweeper
reserved for Level 3, not implemented).

**Root cause (measured):** frame p50/p95/p99 were a steady ~34.7 ms cadence;
the hitches were synchronous `spawnTrackRow` -> `trackStream.nextRow` route
planning on the render thread (~11 ms average, up to 44 ms in browser; Node
single calls up to 3.3 s). CPU profile: validation (`driveTrackTransition` ->
`hazardClearance` -> `hazardGeometry`), `successorPool` look-ahead and
`structuredClone`.

**Changes:**
- `trackValidation.js`: exact per-hazard invariant hoisting. Output hashes
  identical for 1-L1, 153-L1, 7-L2, 22-L2, 33-Endless and 9001-Endless;
  6 x 70-row planning 44 s -> 18.5 s.
- New `routeStreamPlanner.js`, `routeStreamWorker.js`, `routeStream.js`:
  deterministic Web Worker planning through the existing stream owner
  (see [ARCHITECTURE](docs/ARCHITECTURE.md#off-thread-route-planning-2-november)).
- `RoutePrototypeScene.js`: background stream, worker warm-up, starvation retry,
  Depot reset preparation, route-distance prediction, level-select prepared
  checkpoint streams, shutdown cleanup.
- `trackGenerator.js`: `moving_intercept` emits Forklifts only; Forklift contact
  schedule. Level 2 seeds change intentionally; Level 1/Endless unaffected.
- Tests: new `tests/routeStream.test.js`; `sceneLifecycle.test.js` worker
  injection plus prepared-stream and prediction tests; `sectors.test.js` Level 2
  Forklift-only contract.
- Temporary `tmp_genhash.mjs` deleted.

**Commands/results:** route stream **5/0**; lifecycle/Depot selectors **60/0**;
generator gate **7/0**; nine syntax checks PASS. Mover/sector files **17/11**
versus **15/13** on an isolated prior-recipe copy; every current failure is
pre-existing (see [TEST_PLAN](docs/TEST_PLAN.md)).

**Live browser (inspection page, URL debug, saved profile hash unchanged):**
- Level 1 Sector 1: 0 starvation, spawn max 1.1 ms (was 44 ms).
- Level 2 checkpoint via prepared stream: 0 starved/mismatch/rebuild, first row
  at the designed 0.6 s delay (was 741 ms + 4 starvations), spawn max 0.5 ms,
  1,200 frames p99 34.4 / max 34.5 ms, none >50 ms. Movers: four Forklifts,
  lateral, three-lane patrol.
- Docking cycle at 3,000 m: stopped at 3,000.0, resume used the prepared reset
  (0 rebuild/mismatch/starvation), 10 rows after resume from 3,003 m, spawn max
  0.3 ms, 2,193 running frames max 34.6 ms.

Inspection browser ran at a ~30 Hz cadence; not a device test. Human/mobile
jitter acceptance remains **PENDING**. No full suite/build; Slice 6 not started.

## Previous execution: Strict scene-load route pooling focused PASS (2 November)

Owner requested zero runtime Sprite creation/texture generation and scene-load
preallocation of hazards, roads, drop shadows and decals. Audit found:

- `trackGenerator.js` is pure descriptor/PRNG/validation logic, with no Phaser,
  sprite factory or generateTexture calls; it remains unchanged.
- Existing `RouteVisualPool` recycled warmed demand but Groups could still
  create default Sprites on first larger demand. Containers/TileSprites also
  had explicit on-demand factory branches.
- Catalog/particle textures bake at scene load; missing-obstacle fallback
  could create a late CanvasTexture if an active cached texture vanished.
- Fixed road/environment objects already build at scene load; the common
  image/compound/tile owners cover actual hazard/attachment/shadow/decal use.

### Changes and bounds

- `src/game/rendering/routeVisualPool.js`: precreate **3,005 Images, 70
  Containers and four TileSprites** in scene-owned fixed-maxSize Phaser
  Groups. Capacity derives conservatively from canonical spacing, speed cap,
  reaction/stagger gaps, four-row wall tails/modular parts, offscreen lifetimes,
  slower Sweepers, Beta/pickup/attachment slots and persistent shadows/sites/
  skids. Reuse the existing pure generator spacing/geometry helpers; no new
  generator, seed-specific ceiling, quota assumption or runtime growth.
  `get` only when an inactive member exists; full/unavailable pool throws,
  never steals live bodies, skips hazards or constructs a default Sprite.
  `killAndHide`, complete state reset and Phaser-first teardown remain.
  Active-phase helper calls without the preloaded pool also fail explicitly.
- `src/game/rendering/industrial.js`: guard catalog, fallback and particle-dot
  baking during running/docking/Depot/crash/finish phases. Assets and certified
  fallback pixels remain unchanged during allowed scene-load baking.
- `src/game/rendering/roadEnvironment.js`: remove the redundant four-image
  lease/release warm-up; fixed pool now includes skid capacity from load.
- `tests/rendering.test.js`: exact cold capacity/exhaustion, factories disabled
  before first use, long guardrail/attachment/shadow/cargo/Depot/decal reuse,
  no active bake/fallback and retained reset/lifetime tests.
  `tests/sceneLifecycle.test.js`: logic-only VM fixtures explicitly substitute
  their mock display owner; strict real Group allocation has separate tests
  and the live Phaser evidence below. Five JavaScript files changed total.
- Startup reserves deliberately more objects than measured demand, trading
  fixed object memory for no first-use growth. This is not a promise of zero
  JavaScript/text/particle allocation, zero planning work or all-device jitter.

### Commands, results and independent failures

```powershell
node --test --test-name-pattern='route visual pool|road|environment|shadow|guardrail|depot|Depot|docking|remov|fresh start|shutdown|audio|haptic|feedback' tests\rendering.test.js tests\sceneLifecycle.test.js tests\depots.test.js
node --test tests\rendering.test.js
```

- Initial focused **80/19**, 1341.5255 ms: new bake guard accidentally nested
  inside fallback helper. Hoisted to module scope.
- Focused correction **101/1**, 1400.4733 ms: the new cache-miss fixture removed
  a non-existent baked entry while its preloaded source remained available.
  Corrected the fixture to remove that source.
- Final focused **102 PASS / 0 FAIL**, **1417.1638 ms**. Five individual
  `node --check` calls PASS. Whole capacity acquired/recycled twice with all
  factories disabled; explicit full-pool errors; no destruction until teardown.
- Expanded rendering file **96 PASS / 2 FAIL**, **24561.8446 ms**. Unrelated
  tests `Barrier, Rockslab and Signal Cabinet fit their existing solid bodies
  with whole approved artwork` and `Barrier replaces concrete dividers in
  every sector while retaining each existing texture key and footprint`
  fail at the old visible-width expectation and exact collision boundary.
  An in-memory two-test control removing this task's renderer bake guards
  reproduces both exact assertions (0 PASS / 2 FAIL, 48.4563 ms). Neither
  uses the pool; drawing/collision logic and their assertions are unchanged.
  Left them intact, not a clean full-rendering gate or release certification.

### Live Phaser verification

Ephemeral inspection instruments Sprite and image/container/tile factories,
Graphics.generateTexture, Group.create and all pooled-object destroys.
Across **120 actual generated rows** (24 each at L1 S1/S4, L2 S2/S4, Endless),
every counter is **zero**, with fixed group sizes 3,005 / 70 / 4. Observed
image peaks 40-46 are smoke data, not a substitute for conservative bounds.
Two actual scene restarts release old groups, allow idempotent late teardown,
recreate identical budgets and produce zero new page errors.
Engine noise remains removed. Fresh saved localStorage hash unchanged and
ordinary menu restored at 390 x 844.

Six maintained docs/ledger synchronized. No full repository suite, generator
mega-gate, production build, save reset, push or deployment. Human/device
frame-pacing and V1-V4 remain PENDING. Slice 6 is not advanced; unrelated
rendering failures remain explicitly recorded for their owning work.

## Previous execution: Engine noise removal PASS (2 November)

Owner requested removing engine noise and deferring high-quality engine audio.
Removed the oscillator/filter/gain and velocity/ducking logic from
`src/game/rendering/runFeedback.js`, plus all engine update hooks from
`src/game/scenes/RoutePrototypeScene.js`. Shutdown now disconnects the retained
effects output graph independently of the removed engine. No muted-but-running
loop, no replacement sound or new preference/dependency.

Impact, air brake, UI click, cargo and Depot sounds retain their existing
gains/compression, with haptics, twelve-voice cap, gesture unlock and lifecycle
protections. No gameplay, geometry, road rendering, saves or pace changes.
Updated `tests/rendering.test.js` and `tests/sceneLifecycle.test.js` to require
no continuous source on unlock/reset/resume, finite event sources, no stale
scene engine hooks and correct effects-only shutdown. Six maintained docs
synchronized; earlier pitch/ducking evidence below remains historical.

```powershell
node --test --test-name-pattern='audio|sound|haptic|feedback' tests\rendering.test.js tests\sceneLifecycle.test.js
```

**16 PASS / 0 FAIL**, **346.8169 ms**, no correction required. Four individual
`node --check` calls PASS for the changed JavaScript files.
Live ephemeral-profile Phaser check after real gesture: no engine oscillator,
gain or filter; all five event-sound methods still produce finite voices
(nine total), returning to zero after 1.1 s. Shared context remains running.
Ordinary menu restored; saved localStorage unchanged.
No full repository suite/build, save reset, deployment or Slice 6.
Human sound/device acceptance remains PENDING; next milestone remains Slice 6.

## Previous execution: Audio mix and braking-zone road polish PASS

Owner requested velocity-based engine pitch, louder/punchier impacts, brakes
and UI clicks, removal of scattered all-lane skids and baked gritty road wear.
No new generator, gameplay geometry, balance/economy or persistence owner.
The indicated-side >=50% Depot entry and existing 1.5 s canopy stop remain.

### Changes

- `src/game/rendering/runFeedback.js`: the old engine already rose 90 to
  112.5 Hz over 320-680 px/s, but clamped all lower velocities to 90. Extend
  pitch down to 45 Hz idle, with velocity-driven lowpass sawtooth brightness
  and quieter gain. Raise impact/debris, pneumatic brake and arrival gains,
  add a short UI click, briefly duck engine under foreground events and use
  one shared compressor before Phaser's master destination. Preserve one
  context/engine/noise buffer, twelve transient voices, gesture unlock,
  haptics, background gating and complete shutdown. No per-frame node creation.
- `src/game/scenes/RoutePrototypeScene.js`: air brake only when entering the
  guarded docking transition; UI click only after a validated shared button/
  tile action, so new-run reset does not cancel it. Aborted/dragged/foreign/
  clipped/repeated gestures and bypass/panel repaint stay silent.
- `src/game/rendering/roadEnvironment.js` and `src/game/data/environments.js`:
  remove the all-lane scatter emitter/spacing setting, including old +8 m
  post-site skids. Reserve only four pooled skid images, two segments per
  remembered Depot. Whole extents run from the existing core braking-start
  calculation to the canopy, indicated side only, alpha 0.15. No duplicate
  motion/geometry logic or increased pool budget.
- `src/game/rendering/industrial.js`: deterministic fine branching cracks,
  worn seams and tiny shoulder rubble baked once into both active base roads,
  without alpha carving, runtime GameObjects, collision bodies or seeded RNG.
- `tests/rendering.test.js` / `tests/sceneLifecycle.test.js`: exact speed/
  pitch/filter/gain/mix/duck/cleanup, valid-only clicks, once-only braking,
  whole braking-zone skid bounds on both sides/all modes, fixed pool counts,
  deterministic baked wear and retained road/pooling/lifetime protections.
  Six maintained docs/ledger synchronized.

### Commands and actual results

```powershell
node --test --test-name-pattern='audio|sound|haptic|feedback|road wear|Industrial benchmark|road surfaces|environment|road skid|route visual pool|depot|Depot|docking' tests\rendering.test.js tests\sceneLifecycle.test.js tests\depots.test.js
node --test --test-name-pattern='audio|sound|haptic|feedback|road|environment|route visual pool|depot|Depot|docking|tile|button|gesture|fresh start|remov|shutdown|restart' tests\rendering.test.js tests\sceneLifecycle.test.js tests\depots.test.js
```

First **58 PASS / 0 FAIL**, 1451.9011 ms; expanded relevant input/lifetime gate
**93 PASS / 0 FAIL**, **1348.0983 ms**. No fix/retest corrections required.
Individual `node --check` PASS on all seven JavaScript files listed above.

Live ephemeral-profile Phaser evidence: real gesture unlock; drag zero clicks/
valid tap one; engine 45/67.48/89.98/101.24/112.49 Hz at 0/160/320/500/680;
1,000 speed updates allocate zero audio nodes; real gain ducks from 0.04994 to
0.01287 and recovers to 0.04982. Burst voices cap at twelve, clear to zero.
Across 200 actual skid visibility cycles the image pool remains nine, with
zero destroys; visible segments have alpha 0.15, with no past-site extent.
All five checked baked roads remain alpha 255 at every pixel. Actual scene
braking/arrival fire once each, stop at 500 m under the canopy. Real restart
disconnects engine/filter/gain/master/compressor exactly once, clears transient
voices/noise without closing Phaser's context. Ordinary menu/390 x 844 restored;
fresh saved localStorage hash unchanged.

Human mix/listening, phone haptics/frame pacing and V1-V4 acceptance remain
**PENDING**. No full repository suite, generator mega-gate, production build,
save reset, push or deployment. Next authorized milestone remains **Slice 6**,
not started by this bounded follow-up.

## Previous execution: Depot half-body entry threshold PASS

Owner requested entry when half the truck body crosses into the canopy.
Lowered the existing indicated-side physical cab-width intersection threshold
from 75% to **>=50%** in `src/game/core/depots.js`. The same canonical bay,
Phaser Rectangle intersection adapter, swept crossing and roundoff handling
remain. No artwork-derived bounds or duplicate entry owner.

Updated `tests/depots.test.js` to assert the exact new boundary and +/-0.001 px
on both sides, through pure and actual Phaser intersection. Updated
`tests/sceneLifecycle.test.js` to dock at exact half-body entry, complete the
canopy stop and reject less-than-half/opposite-side entry. Existing 1.5 s
braking, indicated-side restriction, center/opposite bypass, banking, shield,
HUD, save behavior, visual pooling and generator remain unchanged.

```powershell
node --test --test-name-pattern='depot|Depot|docking|canopy|facility' tests\depots.test.js tests\sceneLifecycle.test.js
```

Actual result: **29 PASS / 0 FAIL**, **2.631 s** (2631.4146 ms).
Three individual `node --check` calls PASS for the changed JavaScript files.
All six maintained docs/ledger synchronized. No full repository suite/build,
save reset, push or deployment; no live profile was modified during this task.
Human/device acceptance remains **PENDING**. Slice 6 remains next, not started.

## Previous execution: Performance stability, Depot overlap and visual clarity PASS

Owner requested pooling, a 75% Depot overlap requirement, solid roads/subtle
decals and fixed-aspect desktop scaling. A structured owner clarification
explicitly selected **indicated-side-only docking**, superseding the earlier
both-outer-lane rule. The current bounded follow-up is complete; Slice 6
persistence/full test/build is still pending.

### Changes and retained contracts

- Added `src/game/rendering/routeVisualPool.js`, with scene-owned Phaser
  Groups for images, compound containers and tiled surfaces. Acquire via `get`,
  reset stale frame/texture/transforms/tint/flip/origin/blend/active/visible;
  release through `killAndHide` and cancel owned tweens. Compound containers
  detach/release child images, retain no stale guardrail parts/beacons.
- Pool actual hazard sprites, guardrail tiles/shadows/beacons, warning lights,
  roadside mounts, cargo/glows and Depot facility art. Persistent tiled
  road/overlay/glint surfaces belong to the tile group; fixed lane stripes
  already wrap without runtime allocation. Rare Blueprint labels and floating
  text retain their existing separate lifecycle.
- Pooling is deliberately at actual `RoutePrototypeScene.js`, `industrial.js`
  and `roadEnvironment.js` allocation owners, **not trackGenerator.js**:
  generator data/PRNG/certification are Phaser-free and unchanged. It never
  allocated sprites/tiles to recycle. No parallel generator/validator.
- Decal slots reserve their fixed maximum at initialization and return
  offscreen/hidden images to the pool. Only linear tire skids remain, alpha
  0.15; oil/crack/rut decal drawings and registry entries are removed.
- Removed all road alpha carving, including future mesh variants, without
  creating playable future levels. Existing roadbeds are fully opaque.
  `environments.js` presets now choose full-screen 0.7x scrolling Industrial
  MULTIPLY grunge/0.14 or Dustlands ADD dust/0.12; same layer owner and lighting.
- `depots.js` owns canonical physical cab/bay bounds and indicated-side
  >=75% decision. Scene supplies `Phaser.Geom.Rectangle.Intersection` on
  actual Rectangles; simulations use an equivalent pure rectangle adapter.
  No artwork dimensions enter geometry. Normalize only coordinate-subtraction
  ULP roundoff at the inclusive boundary; +/-0.001 px cases remain distinct.
  Sample the interpolated crossing at the existing derived braking line,
  keeping the 1.5 s stop exactly under the canopy. Opposite outer lane now
  bypasses along with the center lanes, without changing pass accounting,
  banking, shield/HUD timing, progress persistence or collision outcomes.
- `main.js` uses FIT/CENTER_BOTH at the established 390 x 844 base, not an
  unrequested playfield-width change. `styles.css` no longer forces canvas
  width/height to 100%; Phaser owns aspect-correct display size and centering.
- Updated indicated-bay wording in `onboarding.js` / `playerGuidance.js`.
  Tests changed in rendering, sceneLifecycle, depots, onboarding and
  playerGuidance. All six maintained docs/ledger synchronized.

### Commands, results and bounded corrections

```powershell
node --test --test-name-pattern='route visual pool|road|decal|environment|shadow|guardrail|depot|Depot|docking|facility|remov|fresh start|viewport|resize|audio|haptic|feedback|desktop scaling' tests\rendering.test.js tests\sceneLifecycle.test.js tests\depots.test.js tests\menuLayout.test.js tests\onboarding.test.js tests\playerGuidance.test.js
```

- Initial command without the last two guidance files: **96/4**, 3.768 s.
  New hardcoded fractional width, fake container exposing image methods,
  cold decal reserve expectation and old opposite-side checkpoint setup.
  Focused correction: **99/1**, 2.693 s; remaining fake destruction boolean
  versus newly counted value fixed without changing production semantics.
- Expanded directly related guidance gate: **101/2**, 2.725 s. Pre-existing
  fixtures still asserted 150 m and retired copy. Reconciled to retained 60 m
  and new indicated-side wording, preserving service/economy assertions.
  **103/0**, 2.689 s.
- Real Phaser restart then found Groups already destroyed by UpdateList before
  the scene's late shutdown callback. One focused lifecycle fix makes release/
  teardown idempotent and tolerates dead Groups, with a matching regression.
  Final **104 PASS / 0 FAIL**, **2.785 s** (2784.634 ms).
- **14 individual `node --check` calls PASS**: main, routeVisualPool,
  RoutePrototypeScene, environments, industrial, roadEnvironment, depots,
  onboarding, playerGuidance and the five edited test files.

### Actual browser evidence

Ephemeral-profile inspection only:
- Real scene `spawnTrackRow`/`removeObjects`, synthetic repeated barrier,
  Forklift, compound guardrail and cargo row: after warm-up, **200 cycles,
  zero new pooled GameObjects and zero destroys**. Counts stay 22 images /
  one container / four tiles; 9.7 ms total on this desktop sample. Gameplay
  records are still fresh; no stale movement/near-miss state is recycled.
- All five baked roads: alpha 255 everywhere, zero nonopaque pixels. Correct
  full-screen overlay blend/alpha/depth and no retired oil/crack/rut textures.
- Real scene tests of both indicated sides: exact 75% and 0.001 px more dock;
  0.001 px less does not, even after changing sprite scale. Stops remain at
  their actual 500/1,000 m canopy anchor; checkpoint/HUD/banking rules retained.
- Desktop 1440 x 900: canvas 415.875 x 900 at x=512, centered within pixel
  rounding, logical 390 x 844. Real pointer click opens Normal level selection.
  Short portrait 320 x 568: canvas 262.453 x 568 without stretch; restores to
  390 x 844. No gameplay geometry retune.
- After lifecycle correction, **three actual restarts** release old groups and
  audio, recreate stable 12-image/four-tile idle counts, and emit no page errors.
  Ordinary menu and original inspection viewport restored; saved localStorage
  hash unchanged.

This verifies pooled allocation reuse, not elimination of every GC/frame spike:
route planning, records, text and browser/device scheduling remain separate
costs. Human/mobile jitter, visual clarity, sound/haptics and V1-V4 acceptance
remain **PENDING**. No full repository suite, generator mega-gate, production
build, dependency install, save reset, push or deployment.
**Next authorized milestone: Slice 6**, not started here.

## Previous execution: Slice 5 audio and haptic feedback PASS

Slice 5 is complete at its required scoped gate. Slice 6 persistence hardening,
full repository tests and production build have **not** been started.

### Changes and retained contracts

- Added `src/game/rendering/runFeedback.js`, a cosmetic feedback owner using
  Phaser's existing AudioContext and master mute/volume destination. It creates
  no second context, SDK, dependency, save preference or gameplay owner.
- Capture-phase canvas pointer/document keyboard input unlocks audio before
  menu controls can stop Phaser pointer propagation. Resume failures warn once
  and remain retryable; locked/suspended effects are never queued for replay.
  Unsupported Web Audio/vibration APIs intentionally leave gameplay usable.
- One reusable engine oscillator maps 320-680 px/s to 90-112.5 Hz, exactly +25%.
  The original owner's 680/global cap supersedes the plan's stale 600 endpoint.
  Driving, 1.5 s docking and protected launch use actual scroll speed; menus,
  maintenance and crash/result phases mute the engine.
- Accepted cargo only plays C4/D4/E4/G4/C5 within a 2 s consecutive window;
  the fifth adds harmony. The sequence repeats after five, resets after a gap,
  on a new run and at a stopped Depot. No currency/streak accounting changes.
- Actual Hull/shield hits play a falling metallic tone and filtered debris;
  immune overlaps, harmless grinding and debug God contacts do not. Completed
  docking plays steam followed by two chime notes, once per arrival rather than
  on bypass, braking entry, banking, repair or repaint.
- Browser haptics: 15 ms per lane boundary crossing, 30 ms pickup, an 80 ms
  double-pulse pattern `[30,20,30]` including its pause, and 200 ms dock.
  Browser refusal/known permission failures warn once; unsupported browsers
  need no native package. Device intensity is browser/OS controlled.
- Twelve transient voices maximum, one reusable noise buffer, no per-frame
  node allocation. Pause/sleep/blur/hidden mute feedback and cancel transient
  voices/vibration. Shutdown stops/disconnects sources and removes owned
  listeners without closing Phaser's shared context.
- Scene hooks and tests changed only in `RoutePrototypeScene.js`,
  `tests/rendering.test.js` and `tests/sceneLifecycle.test.js`. The six maintained
  docs/ledger are synchronized. No geometry, generator, economy, shield,
  banking, collision outcome, artwork or save changes.

### Exact commands and actual results

```powershell
node --test --test-name-pattern='audio|sound|haptic|feedback' tests\rendering.test.js tests\sceneLifecycle.test.js
```

Initial gate **11 PASS / 2 FAIL**, 0.274 s: two new integration fixtures lacked
the spark emitter's `explode` method and the pre-existing Blueprint eligibility
milestone. One focused fixture correction; no production fix or weakened
assertion. Final **13 PASS / 0 FAIL**, **0.273 s** (273.1305 ms).
Four individual `node --check` calls PASS for the helper, scene and both tests.
The gate covers exact pitch/notes/windows/haptic patterns, retryable unlock
errors, unsupported/blocked APIs, bounded voices, event-listener cleanup, real
accepted/rejected cargo and Hull/shield/immune contacts, and docking/bypass.

Live Phaser smoke at 390 x 844 using the existing ephemeral profile:
no graph before real pointer input; running shared context after the gesture;
actual running speed drives the engine; full pitch target reaches 112.5 Hz.
Real pickup/shield methods create oscillator/noise voices. Actual pause clears
voices and sets master/engine gains to zero. Actual 500 m canopy arrival creates
one hiss/two-note group, leaves cargo unbanked and HUD hidden; repaint does not
repeat it. Restart releases old voices/noise/listeners, keeps the shared context
running and creates an interaction-locked, unallocated new owner. The temporary
unlock URL correctly restarts into Garage, not the ordinary menu. No feedback
warnings were recorded. Inspection page restored to the ordinary main menu;
saved localStorage SHA-256 is unchanged before/after.

**Next authorized slice: Slice 6**, persistence hardening followed by its full
test/build gates. Existing unrelated full-suite fixture disagreements remain
unrecertified, not silently fixed here. Human listening, loudness/mix, physical
phone haptics, touch/background-resume and V1-V4 acceptance remain **PENDING**.
No full suite/build, generator mega-gate, deployment or save reset was run.

## Previous execution: Slice 4 distinct movers and Depot canopy correction PASS

Owner authorized distinct Forklift/Sweeper behavior using approved existing
artwork and explicitly retained Level 1 Sector 2 Dawn. Slice 4 was complete
at its scoped gate; no Slice 5 work or full engineering gate was started then.

### Changes and retained contracts

- `gameBalance.js`: first mover sector 2, Forklift warning 0.5 s and forward
  Sweeper speed ratio 0.5; separate `forklift` kind reuses existing approved
  one-lane physical dimensions/texture. Existing `sweeper` geometry is unchanged.
- `trackGenerator.js`: select distinct mover recipes within the current
  proposal/selection/witness path. Forklift fits 2-3 available lanes; Sweeper
  stays fixed in one lane. Its nearer spawn position keeps the advertised row
  arrival anchor, while physical exposure lasts longer. Existing 8/16 budgets,
  side quotas, 40 m mover separation, reaction, recovery/fallback and canonical
  30/60/120 Hz connected certification remain mandatory.
- Sector 1 has no mover spawns. The original 4-14-body quota conflicts with a
  static opening only if applied before eligibility; it now applies explicitly
  to 500-1,500 / 1,500-3,000 / 3,000-5,000 m, including final Normal settlement.
  No quota is waived within those eligible intervals.
- `hazards.js` / `trackValidation.js`: one exact distance-domain longitudinal
  projection feeds the existing validator, pressure, coverage, facility
  exclusion and lifetime owners. Include cab half-height when projecting;
  convert Y separation back to physical px for the unchanged 6 px clearance.
  Tagged lateral motion retains canonical-time certification and conservative
  untagged handling. No parallel generator, collision registry or validator.
- Scene / `DebugManager.js`: actual scrolling, birth-frame catch-up, docking
  motion and bot prediction use the shared relative-scroll scale. Forklift
  flashes on its canonical 0.5 s warning clock before moving; both kinds reuse
  the existing one-beacon attachment/shadow/destruction lifecycle.
- `industrial.js` / `environments.js`: reuse approved forklift raster/texture,
  both mover names in the visual inventory and shared amber strobe owner;
  no new art, collider-from-art calculation, lighting or speed retune.
- `scripts/route-audit.mjs`: contact, occupancy and accounting consumers use the
  shared exact longitudinal projection. Level 1 and Continuous remain static;
  Level 2 Sector 4 remains Dusk with headlights.
- Tests: `controlledMovers.test.js`, `sectors.test.js`, `hazards.test.js`,
  plus the Depot/render/lifecycle fixtures described below. Old fixed-18m
  stream sampling now uses actual committed spacing. A retired Overdrive
  selected case now covers active Normal 1,500-5,000 m, retaining pair/single,
  mirror, quota, pressure and physical-certificate assertions.
- Depot follow-up: chevrons end at the site; braking ends at the actual canopy.
  The earlier stop now records checkpoint progress on completed arrival through
  `recordMilestones`, independently of banking, and preserves visible failure
  warnings/profile state. Manual bank choices and stopped HUD behavior remain.

### Exact commands and actual results

```powershell
node --test --test-name-pattern='Level 1|Level 2|moving|sweeper|forklift|chicane' tests\sectors.test.js tests\controlledMovers.test.js tests\hazards.test.js
node --test --test-name-pattern='depot|Depot|docking|bank|Bank|HUD|forklift|moving|shadow|removing one|five fresh starts|environment layers' tests\depots.test.js tests\depotEconomy.test.js tests\sceneLifecycle.test.js tests\rendering.test.js tests\debugManager.test.js
```

- Required Slice 4 baseline **5/3**, 183.550 s: retired mode, legacy-width and
  fabricated-spacing fixtures. First implementation gate **9/3**, 439.873 s:
  stale 8-only versus approved Normal 8/16 assertion, exact fractional-width
  arithmetic and a 410-authored Normal recovery expected to pass at unsupported
  680 px/s. One focused correction **12/0**, 215.647 s. Final strengthened
  verification **12 PASS / 0 FAIL**, **217.594 s**.
- The final test equates projected clearance with actual live physical
  clearance, rejects closed walls even with falsely open lane hints, and keeps
  the unsafe 680 fixture as an explicit rejection. It does not relax safety
  gaps, pressure, 6 px clearance, reaction or proposal budgets.
- Four Normal seeds plus each eligible interval start retain generated
  certificates/quotas. Seed 98765 / 1,500-5,000 m: 92 rows, eight movers,
  six paired bodies, both orientations, four per interval, maximum per-lane
  clear streaks [3,3,3,3].
- Related gate initially **64/1**, 2.648 s: shield fixture incorrectly assumed
  no banking meant no checkpoint-progress write. Corrected to unchanged
  wallet/zero banking events plus required Normal checkpoint persistence,
  preserving full Endless profile identity. Final **65 PASS / 0 FAIL**,
  **2.864 s**, including both levels' immediate checkpoint and failed-storage
  tests, Depot HUD/banking/stop timing, scenery/shadows and object cleanup.
- All **17 individual JavaScript syntax checks PASS**: gameBalance,
  environments, hazards, trackValidation, trackGenerator, RoutePrototypeScene,
  DebugManager, industrial, route-audit, depots, roadEnvironment and the six
  edited tests (depots, sceneLifecycle, rendering, controlledMovers, sectors,
  hazards).
- Real Phaser ephemeral-profile smoke: Forklift fixed through 0.499985
  canonical seconds, then moves by 0.599982; Sweeper stays in lane with exactly
  0.5 relative road scroll. Same approved texture, one amber beacon each.
  L1/L2 Normal and Endless stop at their real gates with canopy/cab Y=684
  (actual drawn canopy checked), HUD/chevrons hidden. No page errors; saved
  localStorage unchanged. Inspection page restored to ordinary main menu.

All six maintained docs/ledger synchronized. No full repository test/build,
10,000-encounter gate, push, deployment, save reset or playable future level.
Human/mobile/playtesting remains **PENDING**. **Next slice: Slice 5 audio and
haptics**, followed by Slice 6 persistence/full tests/build at its proper gate.
The existing unrelated fresh-profile hand_precision fixture mismatch remains
recorded; these focused passes are not a full-suite or commercial acceptance claim.

## Previous execution: Depot site cutoff and canopy stop PASS; Slice 4 in progress

Owner follow-up: chevrons must end at the Depot site; the truck must stop under
the canopy rather than roll beyond it. Previously the 1.5 s deceleration began
at the bay centre, so integrated travel necessarily overshot the artwork.

- `depots.js` derives `depotDockingStart` from the existing smoothstep stopping
  integral and live speed curve, without adding a balance distance.
- Scene braking begins on the approach; it integrates the remaining distance
  over the unchanged 1.5 s and finishes exactly at the bay centre. Late-frame
  entry uses its remaining distance, not a fixed extra roll. Sector state is
  synchronized at the stop. Center bypass still counts only at the real gate.
- `roadEnvironment.js` clips every chevron segment at the world-space site,
  retaining the Depot-side-only 60 m notice and existing lifetime owner.
- Related fixtures in `depots.test.js`, `sceneLifecycle.test.js` and
  `rendering.test.js` assert the new braking line, canopy alignment, exact
  30/60/120 Hz duration, clipped segments, manual banking and hidden stopped HUD.

```powershell
node --test --test-name-pattern='depot|Depot|docking|bank|Bank|HUD' tests\depots.test.js tests\depotEconomy.test.js tests\sceneLifecycle.test.js tests\rendering.test.js
```

Initial **47/3**, 2.782 s: VM old-sector assumption and two old threshold-only
fixtures. One focused correction: **49/0**, 2.853 s; final including renamed
canopy test **50/0**, 2.771 s. Real Phaser ephemeral-profile smoke confirms
Level 1/2 Normal stop at 500 m, Endless at 1,000 m; all cab/canopy Y=684,
stopped HUD/chevrons hidden and stored localStorage unchanged. Six maintained
docs updated. No full suite/build, push, deployment or save reset.

Slice 4 remains in progress, not certified. Owner explicitly chose distinct
lateral Forklift / single-lane 0.5x Sweeper using existing art and retained
Level 1 Sector 2 Dawn. Its baseline required gate was **5/3**, 183.550 s
(retired Overdrive fixture, old-width boundary, fixed-18m stream fixture).
Implementation and its first scoped gate are in progress; no Slice 5 advance.

## Latest execution: near-miss and Depot follow-ups PASS

Latest explicit owner decisions supersede the original Slice 3 auto-banking
and both-side 150 m presentation, and Slice 2's +10%/+100% near-miss values.
No new gameplay, collision, economy, generator or save owner was introduced.

### Changes and root causes

- `gameBalance.js`: close-call step/cap now +5/+50%; Depot notice distance 60 m.
  The existing economy owner reads that configuration. Clean-pass gap remains
  15-25 px; cab geometry, generator budgets/quotas/clearances are unchanged.
- `RoutePrototypeScene.js`: reset only the current unbanked near-miss bonus on
  non-immune Hull/shield hits, including fatal hits. A frame-local flag makes
  hits win over clean passes in either processing order. Immune overlaps,
  harmless wall grinding, Depot/pass bonuses and secured Coins are unchanged.
- Normal arrival no longer auto-banks: keep Bank & Continue / Bank & End Run
  and existing unbanked Skip/repair choices. After successful Bank & Continue,
  render only disabled Cargo Secured, Resume Run and Repair Hull; omit the End
  button and guard stale End callbacks. Failed banking retains cargo/accounting
  and blocks services/exits until explicit retry. Existing terminal confirmation,
  persistence and duplicate-settlement protections remain.
- Hide the HUD parent during either mode's stopped Depot, including subsequent
  bank/repair refreshes and confirmation; restore on resume. Endless still has
  no mid-run bank and keeps stopped End Run/Skip shield behavior.
- `roadEnvironment.js` / `industrial.js` / scene HUD: chevrons, upper notice and
  HUD Depot alert appear only within 60 m and indicate the decorative Depot
  side. Physical entry still accepts either outer lane, per explicit owner
  clarification; center bypass is unchanged.
- `onboarding.js` / `playerGuidance.js`: match manual banking, side-only 60 m
  markers and the +5/+50 hit-reset rule.
- Tests changed: `collision.test.js`, `rendering.test.js`, `depots.test.js`,
  `sceneLifecycle.test.js`. They cover capped accrual/quotes, both collision
  modes and hit types, same-frame ordering, immunity/grind exclusions, banked
  wallet safety, manual banking/terminal retries, exact post-bank controls,
  hidden/restored HUD, exact indicator boundary and retained docking timing.

### Commands and actual verification

```powershell
node --test --test-name-pattern="nearmiss|collision|chassis|steering|cargo chain|depot|Depot|bank|Bank|shield|HUD|telemetry|facility|risk|repair|wallet transactions|continuous|exhaust|smoke|environment layers|destroy|lifetime|five fresh starts|run menu" tests\collision.test.js tests\depotEconomy.test.js tests\depots.test.js tests\modules.test.js tests\rendering.test.js tests\sceneLifecycle.test.js tests\cargo.test.js
```

**104 PASS / 0 FAIL**, 32.311 s on the first follow-up run. No correction/retest
needed. Each of the six changed source files and four changed test files above
was individually checked with `node --check`: **10/10 PASS**.

Real Phaser inspection used a temporary `?unlockAll=true` profile, not tester
progress. At 390 x 844: arrival retained 100 cargo/unchanged wallet and hid HUD;
Bank & Continue secured exactly 100 Coins and left only Repair, disabled Cargo
Secured and Resume. Resume restored HUD; Endless stopped/Skip did likewise
without banking. Both side notices/chevrons were absent at 60.01 m and present
at 60/30/0 m on the correct side. Opposite-side outer-lane entry still docked.
Actual shield-absorbed and Hull-damaging contacts reset +50% to zero; browser
reported no page errors. localStorage remained unchanged throughout, including
restoring the inspection page to the ordinary main menu.

Persistent docs synchronized: `DECISIONS.md`, `GAME_DESIGN.md`, `ARCHITECTURE.md`,
`TEST_PLAN.md`, `ImplimentationPan.md` and this ledger. No full repository
tests/build, generator gate, push, deployment or save reset in this follow-up.
Human/mobile acceptance remains **PENDING**. This bounded follow-up is complete;
Slice 4 remains the next commercial workstream, with its recorded mover-policy
conflict requiring resolution before implementation. Slices 4-6 were not started.

## Latest execution: Slice 3 tactical Depots PASS

Historical checkpoint below: the follow-up above supersedes its auto-banking,
150 m/both-side indicators and earlier near-miss rules.

Implemented in the existing owners only:

- `depots.js`: both outer lanes enter on actual threshold crossing, including
  frame overshoot; center-lane crossing immediately bypasses once. Decorative
  alternating-side bay art no longer selects the docking lane. Generator
  approach/exit envelopes, quotas and physical clearance are unchanged.
- `gameBalance.js` / scene: real, integrated smoothstep deceleration over 1.5 s;
  distance, road, stripes, objects and facilities move with the decreasing speed.
  Arrival flashes cyan. Normal automatically banks through the existing
  persistence boundary, restores equipped shield capacity and retains the
  owner-confirmed maintenance menu (repair/resume/end). Failed banking retains
  hold/accounting and blocks exits/services until explicit retry succeeds.
- Endless: stopped menu is End Run / Skip. End Run retains terminal payout;
  Skip restores equipped shields and continues with unchanged cargo/wallet plus
  the existing passed-Depot bonus. Stopping alone and center bypass never
  recharge. No mid-run bank, passive regeneration or duplicated economy owner.
- Resume accelerates over the existing requested one-second protection window;
  Normal banking resets hold bonuses; bypass retains cargo/stream/speed and
  earns the unchanged mode-specific Depot bonus. New state resets on new run/menu.
- `roadEnvironment.js`: one reused green-chevron Graphics layer, both outer
  lanes only in the final 150 m, hidden off-track and destroyed with its owner.
  Existing cyan hexagonal HUD pips are reused, not replaced. Cargo chain,
  shadows and exhaust remain visible through docking.
- Directly related hints, How-To, Endless overview and module copy now match
  those choices. Simulation/verification consumers pass prior distance to the
  same threshold predicate. No duplicate generator or visual-derived geometry.

Verification actually executed:

| Gate | Actual result |
| --- | --- |
| Required seven-test generator recertification | **7 PASS / 0 FAIL**, 239.560 s |
| Required Depot/shield command, including actual scene timing/transactions | **18 PASS / 0 FAIL**, 2.715 s |
| Related scene/rendering/collision/cargo/lifetime regressions | **68 PASS / 0 FAIL**, 21.753 s |
| Exact Slice 2 game-feel regression command | **17 PASS / 0 FAIL**, 21.468 s |
| Updated Endless overview/direct run-menu regressions | **5 PASS / 0 FAIL**, 0.265 s |
| Individual changed JavaScript syntax checks | **16/16 PASS**, including modules, scene and boundary fixtures |

```powershell
node --test --test-name-pattern="all16 actual|secondary fillers|live selection pressures|seed 153|sector challenge identity|guardrail collision|roadside intrusion" tests\clearRowRule.test.js tests\trackGenerator.test.js tests\hazards.test.js
node --test --test-name-pattern="depot|shield|docking|banking|facility" tests\depots.test.js tests\depotEconomy.test.js tests\modules.test.js
node --test --test-name-pattern="depot|Depot|shield|docking|bank|Bank|continuous|chassis|steering|collision|cargo chain|smoke|exhaust|environment layers|compact telemetry|five fresh starts|destroy|lifetime|facility|overview" tests\sceneLifecycle.test.js tests\rendering.test.js tests\collision.test.js tests\cargo.test.js
node --test --test-name-pattern="steering|chassis|collision|nearmiss|cargo chain" tests\rendering.test.js tests\collision.test.js tests\cargo.test.js
node --test --test-name-pattern="run menu" tests\sceneLifecycle.test.js
```

Each syntax path was checked in a separate `node --check` invocation (multiple
positional paths do not check every file). Evidence is retained outside the
project in the session files `slice3-*` logs. The initial required gate failed
on missing VM injections (`resumeSpawnDelay`, then `KEYBOARD_BRAKE_SECONDS`);
two focused fixture corrections reached 17/0. Final review added explicit
30/60/120 Hz endpoint assertions and timer roundoff normalization: now 18/0.
Related initial gate was 65/3; its three legacy Slice 2 fixtures lacked sparks/
chassis initialization or still expected 4.5 degrees. One focused correction
used actual initialization/canonical scale and the approved 3.5-degree contract,
without changing production game-feel behavior, then 68/0.

Real Phaser browser smoke used a dedicated, paused URL-debug session with
in-memory progress only. Normal: docking -> maintenance, 100-Coin auto-bank,
empty hold, 3 shield pips; 390 x 844 maintenance menu inspected. Endless:
103 cargo retained at stop, shield still zero; End Run/Skip shown; Skip restores
3 charges, adds one pass bonus, leaves wallet unchanged and grants 1 s protection.
Chevrons and new-run/menu state cleanup observed. Stored profile contents
unchanged. This is engineering smoke, not human/device playtesting.
The dedicated inspection page was restored to the ordinary main menu afterward;
stored profile contents were again unchanged.

Slice 3 is complete at its scoped gates. Next slice is **Slice 4**, with its
previously recorded distinct Forklift/Sweeper policy conflict to resolve before
implementation; no Slice 4 work has started. Full tests/build remain at Slice 6;
10,000-encounter and V1-V4 human acceptance are NOT claimed. The independent
Garage fresh-module `EQUIPPED` fixture mismatch remains unresolved.

## Boundary recertification before Slice 3

The owner-authorized canonical-width fixture reconciliation in
`tests/hazards.test.js` now probes 0.1 px inside/outside the actual cab/footprint
boundary on both shoulders, retaining tip/tail coverage. No production geometry,
generator, clearance, density threshold or proposal budget changed.

```powershell
node --test --test-name-pattern="all16 actual|secondary fillers|live selection pressures|seed 153|sector challenge identity|guardrail collision|roadside intrusion" tests\clearRowRule.test.js tests\trackGenerator.test.js tests\hazards.test.js
```

Result: **7 PASS / 0 FAIL**, 242.783 s. All 16 route proofs, pressure,
Continuous fillers, seed 153, guardrail and roadside checks PASS. Density:
105.56715104201915 s overall / 75.18938288419635 s late, below unchanged
107.43770054044221 / 75.79367739815207 s limits. Slice 2 is complete at its
focused 17/0 gate plus this recertification. Earlier failures below are history.

At this checkpoint the next authorized task was Slice 3 implementation.
Owner clarified: Normal docking automatically banks and recharges, then keeps
the maintenance menu for repair/resume/end run. Endless never banks mid-run;
an actual stop offers End Run or Skip, and **Skip restores equipped shields**.
A center-lane straight bypass does not recharge. No full suite/build,
10,000-encounter gate or human/device acceptance at this checkpoint.

Previous execution: [5% width reduction and gates](#slice-2-width-reduction-5-density-pass-two-boundary-failures).
Independent menu-centering checkpoint: centered card text in its padded region,
kept the owner-confirmed two-column truck layout and centered button/tile stacks.
Selected regressions 38 PASS / 1 FAIL, 0.354 s; remaining unmodified fixture
expects a fresh unowned/unequipped module to read `EQUIPPED` rather than `50 COINS`.
All new alignment/spacing/gesture/save checks PASS; scene/test syntax PASS.
Seven real menus at 320 x 568, 390 x 844 and desktop inspected with centered
text and unchanged in-memory profile; no purchase, run or deliberate save write.
Files: scene, sceneLifecycle tests, directly related canonical docs. Prior
left-alignment assertions were updated for the latest explicit owner request;
Phaser text doubles now match its origin default and centered-stack placement.
No gameplay/equipment-state fix, generator gate or full suite/build in that task.
Subsequent test-window startup repair: the new page exposed an unsupported
`ParticleEmitter.setTint` call. Smoke tint now uses the existing emitter config;
two focused smoke/exhaust tests and rendering syntax PASS. Reloaded browser
renders the main menu without a reported page error. This does not clear the
two generator-boundary blockers or imply player acceptance.
The owner approved reducing width 5% to **25.08 x 32 px**, height unchanged.
Exact Slice 2 gate **17 PASS / 0 FAIL**, 20.954 s after one focused arithmetic
correction. Generator gate **5 PASS / 2 FAIL**, 280.787 s: overall and late
density now PASS, but guardrail and roadside-boundary assertions still FAIL.
No generator/roadside geometry/threshold changes or Slice 3 were made.

The preceding Slice 1 execution status is recorded in the
[one-step trajectory checkpoint](#one-step-trajectory-selection-slice-1-gate-pass):
the final Slice 1 trajectory gate is **7 PASS / 0 FAIL**, 258.165 s.
The actual 0-4,000 m campaign fixture measures **106.063712 s overall /
75.666741 s late**, versus unchanged distance-normalized
<107.437701 / <75.793677. The explicit non-greedy-choice regression and all
mandatory selected tests pass; Slice 1 and the corresponding mode D gate are complete.
Earlier failed checkpoints below remain historical evidence, not current
acceptance. Independent presentation/menu/mode work remains protected.

## Executive summary and safety

- Audited 31 source JavaScript modules, all 27 former docs, root entry points/
  artifacts, 28 active test files, three scripts and 31 production PNGs.
- Owner explicitly confirmed preserving four sectors with **Level 1 4,000 m /
  Level 2 5,000 m**, rather than changing gameplay to match stale documentation.
- Consolidated docs into exactly [ARCHITECTURE](docs/ARCHITECTURE.md),
  [GAME_DESIGN](docs/GAME_DESIGN.md), [TEST_PLAN](docs/TEST_PLAN.md) and
  [DECISIONS](docs/DECISIONS.md). Updated [README](README.md) and
  [AGENTS](AGENTS.md); no dead guide/handoff links remain in maintained content.
- Retired 25 former doc paths; rewrote the retained design/test paths. Removed
  three root generated snapshots. No executable script, test, sprite, package,
  dependency, parent art source or external session history was deleted.
- Removed two uncalled functions, four unused configuration aliases and 29
  unnecessary public export qualifiers across 11 source files. Locally used
  definitions/initializers remain unchanged.
- **All 31 active source ASTs match their pre-cleanup form**, after accounting
  only for the explicitly removed dead declarations/export wrappers. Baked
  registries and 160 sampled route rows retain exact hashes.
- Pre-cleanup full suite: **382 PASS / 45 FAIL / 427 total**. Existing failures
  include real generation/safety and architectural-contract concerns as well as
  demonstrated fixture drift. They were not waived or repaired by this audit.
- Before/after builds both PASS with the existing large-chunk warning.
  The after-removal full suite also records **382 PASS / 45 FAIL / 427 total**;
  all 427 individual outcomes and the 45 failure identities match the baseline.
  Human/mobile acceptance and reliable bot-only browser clearance remain blocked/
  PENDING; no release or Level 3 readiness claim.

The project has no Git history. Exact originals were copied **before deletion**
to the current session's `files/repository-audit-before` (63 files: docs, source
and root candidates/entry points). Recovery copies/evidence are outside the
project and are not a parallel production source tree.

Exact recovery directory:
`C:\Users\DSchi\.copilot\session-state\4008bf07-fcee-4915-aed0-e88caa6dd79b\files\repository-audit-before`

## 1. Files removed / consolidated

### Documentation: 27 files / 838,324 bytes -> four files / 37,259 bytes

Documentation shrank by **801,065 bytes (95.6%)**. Current rules, ownership,
source-art bindings, player gate, pending workstreams and latest blockers were
preserved in the four authorities. Historical phase transcripts and contradictory
instructions no longer act as working requirements.

Every retired path is listed below. The old guide was expressly approved for
replacement; no guide was deleted merely because a keyword matched.

| Retired file under `docs/` | Consolidated destination / reason |
| --- | --- |
| Cargo_Run_Refinement_Phases.md | Design/Decisions: superseded phase instructions and topology |
| CONTENT_CATALOG.md | Design/Decisions: current playable subset and future constraints, not a duplicate full-product charter |
| DEVELOPMENT_ROADMAP.md | Decisions: current blockers/gated backlog instead of completed phase replay |
| ECONOMY_BALANCE.md | Design/Architecture: live owner/config references; stale distances/prices no longer a competing table |
| PROJECT_HANDOFF.md | This report/Decisions: latest evidence, save boundaries and unfinished gates; retire 383 KB chronology |
| SPRITE_ASSET_INVENTORY.md | Architecture: actual asset registry/source bindings; retain every referenced PNG |
| START_IN_VSCODE.md | README/Architecture: current setup; remove duplicate starter entry point |
| TECH_ARCHITECTURE.md | Architecture: replaced filename/content with verified current ownership |
| DECISIONS_AND_ASSUMPTIONS.md | Decisions: current overrides separated from unresolved proposal conflicts |
| guide/README_START_HERE.md | README/Decisions: superseded v4.1 starter/task charter |
| guide/00_AGENT_CONTRACT_AND_DECISIONS.md | AGENTS/Decisions: retain current constraints; obsolete sector/slot rules retired |
| guide/01_TRACK_GENERATION.md | Design/Test Plan: live physical/seed/quota contracts, not obsolete task prescriptions |
| guide/02_EQUIPMENT_FOUNDATION.md | Design/Decisions: current slots/ranks/shield and future-tier conflict |
| guide/03_DIFFICULTY_AND_VEHICLES.md | Design/Test Plan: live load/steering reference; unimplemented level ladder kept gated |
| guide/04_ECONOMY.md | Design/Decisions: implemented accounting versus proposed changes |
| guide/05_GARAGE_AND_LOADOUTS.md | Design/Architecture/Test Plan: actual single scene/cards/sockets/transactions |
| guide/06_FEEDBACK_AND_FINAL_VALIDATION.md | Test Plan: F3 and actual human acceptance remain required |
| guide/07_ACCEPTANCE_TEST_MATRIX.md | Test Plan: consolidated active matrix; no executable assertions removed |
| guide/08_AGENT_PROMPTS_AND_HANDOFF.md | AGENTS/Decisions: obsolete paste-once prompts and report duplication retired |
| guide/09_DEPOTS_AND_REPAIRS.md | Decisions: one-bank/finite-repair/voucher proposal explicitly NOT implemented |
| guide/10_PLAYER_EXPERIENCE_GATE.md | Test Plan: V1-V4 comprehension/build/replay/mobile observations preserved |
| guide/11_RETENTION_ROADMAP.md | Decisions: optional contracts/sharing/polish/chassis/privacy backlog remains future |
| guide/12_ART_AND_THEME_FRAMEWORK.md | Architecture/Test Plan: geometry/theme separation and source-art coverage |
| guide/13_SCOPED_TEST_STRATEGY.md | Test Plan/Decisions: focused changes, milestone suites, T6/F3 gates |
| guide/14_AUTONOMOUS_EXECUTION.md | Decisions: gated workstream sequence, no automatic failed-gate advancement |

The retained `GAME_DESIGN.md` and `TEST_PLAN.md` were rewritten in place.
`ARCHITECTURE.md` and `DECISIONS.md` are the two new canonical filenames.
The now-empty guide directory was checked for remaining entries and removed
nonrecursively. Root README/AGENTS were cleaned up, not discarded.

### Root generated outputs removed

| File | Bytes | Evidence / reason |
| --- | ---: | --- |
| depot-verification-results.json | 2,312 | Standalone diagnostic writes this output; no runtime/test reader |
| route-audit-output.json | 45,006 | Old generated snapshot, no source/test/script consumer |
| test-audit-output.txt | 54,086 | Old test transcript, not an executable fixture |

Total root snapshot removal: **101,404 bytes**.
No additional `.patch`, `.log` or abandoned source probe was found in the
production/root/script inventory. The three retained scripts are executable
diagnostics: packaged route/balance simulations and standalone Depot verification.
The latter can regenerate its root JSON; changing its output interface is a
future tooling task, not done here.

### Deliberately retained

- All 31 sprite PNGs: each has source/test consumers. No speculative art purge.
- Full design catalogs, tested future theme registries and dynamic texture keys.
  `signGantry`/service-boom compatibility is not unreferenced merely because old
  prose mentions retired gantries.
- Schema 1-10 migrations, Radar mapping and legacy Shield rank handling: reachable
  through `loadProfile` and exercised by active tests.
- `dist`, installed dependencies, package/lock/config files, .vscode settings,
  parent art sources and external session evidence.
- Every existing test. Tests that disagree with current code remain active
  contracts requiring an explicit follow-up, not deletion candidates.

## 2. Exact dead-code actions

**11 source files changed; 7,202 bytes / 122 lines removed.**
No active expression/body/state transition was rewritten.

### Entire unused declarations removed

From [trackGenerator.js](src/game/core/trackGenerator.js):

- `withSweeper`: uncalled legacy chunk-replacement builder; no reference in
  runtime, active tests or scripts. Current mover owners remain intact.
- `areChunksCompatible`: uncalled exported lane/row compatibility wrapper;
  existing reachability/physical validator functions and consumers remain.
- `CHALLENGE_CHANCES`, `SUSTAINED_CHANCES`, `OPENING_LESSON_METERS`,
  `OPENING_CHALLENGE_CHANCE`: unused aliases, not the live configuration tables.
  Current `hardChunkChance` still reads the same authoritative config.

### Public-only exports removed; definitions retained locally

Each named export below had **zero external source/test/script consumers**.
Their local uses and initializers are preserved; this is API-surface pruning,
not elimination of functioning logic.
Together with the four removed public aliases and `areChunksCompatible`,
the public export surface shrank by **34 names** (29 retained private, five
declarations deleted).

| Source file | Now-private names |
| --- | --- |
| [blueprints.js](src/game/core/blueprints.js) | BLUEPRINT_PICKUP_AMOUNT |
| [cargo.js](src/game/core/cargo.js) | FREIGHT_CHANCE |
| [DebugManager.js](src/game/core/DebugManager.js) | createDebugProfile |
| [developerRuns.js](src/game/core/developerRuns.js) | DEVELOPER_RUN |
| [economy.js](src/game/core/economy.js) | APEX_ID, INTERMEDIATE_VEHICLES, FULL_LOAD_STEERING_PENALTY, MIN_STEERING_RESPONSE |
| [hazards.js](src/game/core/hazards.js) | HAZARD_STAGGER_PX, physicalEncounterSignature |
| [modules.js](src/game/core/modules.js) | sectorMilestoneId, MILESTONE_LABELS |
| [trackGenerator.js](src/game/core/trackGenerator.js) | BETA_HAZARD_KIND, BETA_SLOTS, MAX_LANE_CHANGES_PER_ROW, ROW_GAP_MARGIN_AT_START, ROW_GAP_MARGIN_AT_END, DUSTLANDS_CHUNKS, NEON_CHUNKS, REACTOR_CHUNKS, OVERDRIVE_CHUNKS, hardChunkChance |
| [catalog.js](src/game/data/catalog.js) | SECTOR_THEMES |
| [industrial.js](src/game/rendering/industrial.js) | SHADOW_DEPTH_BELOW, TRUCK_CONTACT_SHADOW, PARTICLE_DOT_KEY, ensureParticleDotTexture |
| [roadEnvironment.js](src/game/rendering/roadEnvironment.js) | headlightInfluence, rememberDepotDecals |

### False positives rejected

- The economy `ROUTE_END_DISTANCE_M` import is consumed by its re-export.
  It was not removed as an orphan import.
- Unread local `endDistance`, `witnessEntries`, `witnessDistance` in the generator
  destructuring intentionally **exclude properties from the subsequent object
  rest**. Removing them would change advertised layout shape, so they remain.
- No additional confident unused imports or duplicate class-method declarations
  remained. The conservative AST/name scan is not a full interprocedural
  reachability theorem; dynamic keys, exported data and tested scaffolding were
  kept unless absence of consumers was independently verified.

## 3. Architecture, persistence and lifecycle findings

The following are discoveries/recommendations, **not unauthorized fixes**.
P1 means a correctness/acceptance priority, P2 maintainability/reliability work.

| ID | Priority | Location | Finding and evidence | Next action |
| --- | --- | --- | --- | --- |
| A1 | P1 | [trackGenerator.js:26](src/game/core/trackGenerator.js#L26), [sectors.test.js:20](tests/sectors.test.js#L20) | Generator imports mixed `data/environments.js` and reads filler families by theme. No direct renderer/Phaser import, but the active boundary test explicitly rejects this dependency | Scope challenge-data versus visual-theme ownership separately; preserve exact generated output |
| A2 | P1 | [clearRowRule.test.js:184](tests/clearRowRule.test.js#L184), [clearRowRule.test.js:423](tests/clearRowRule.test.js#L423), [trackGenerator.test.js:330](tests/trackGenerator.test.js#L330) | Physical clear-streak violations, actual seeded fallback exhaustion and certificate assertions fail. These cannot all be explained away as stale prose | Reproduce the exact failing seed/window and restore the intended connected safety/variety contract |
| A3 | P1 | [RoutePrototypeScene.js:445](src/game/scenes/RoutePrototypeScene.js#L445) | `triggerHint` mutates in-memory seen-hints before persistence and ignores the returned failure; unlike shop/bank/repair it can mark a hint seen for the session although storage failed | Separate failure-aware hint commit using normal repository error UX; no fix in this audit |
| A4 | P1 | [save.js:268](src/game/core/save.js#L268), [save.js:287](src/game/core/save.js#L287) | Unknown/corrupt save loads defaults; unreadable backup is best-effort and its own write failure is swallowed. A later save may overwrite the original key even when backup failed | Deliberate recoverable/error-visible save policy and failure tests; preserve old profiles |
| A5 | P2 | [save.js:292](src/game/core/save.js#L292) | Synchronous whole-profile storage has no revision/CAS or cross-tab reconciliation. Same-scene transitions mostly save-before-commit; no same-scene async race was demonstrated | Reproduce two-tab stale-wallet/progression writes before choosing a concurrency policy |
| A6 | P2 | [depotEconomy.js:243](src/game/core/depotEconomy.js#L243), [save.js:254](src/game/core/save.js#L254) | Terminal receipt IDs and Blueprint award IDs grow without a retention bound; serialization cost/storage quota can grow over long use | Measure growth, then design bounded idempotency without allowing duplicate rewards |
| A7 | P1 | [debugManager.test.js](tests/debugManager.test.js), [sceneLifecycle.test.js](tests/sceneLifecycle.test.js) | Recorded real bot-only seed 3118819693 crashes at 4,540.81 m while its stubbed full-clear regression passes | Reconcile actual frame/spawn/load paths; do not enable God implicitly |
| A8 | P1 | [depotEconomy.js:104](src/game/core/depotEconomy.js#L104), [RoutePrototypeScene.js:3103](src/game/scenes/RoutePrototypeScene.js#L3103), [DECISIONS](docs/DECISIONS.md) | Earlier one-bank/finite-repair/voucher/tier proposals do not match current per-visit implementation; documentation now distinguishes them | Owner-scoped specification resolution before new mechanics |
| A9 | P2 | [RoutePrototypeScene.js](src/game/scenes/RoutePrototypeScene.js), [trackGenerator.js](src/game/core/trackGenerator.js), [industrial.js](src/game/rendering/industrial.js) | Scene ~3,500 lines/165 KB, generator ~2,000 lines/104 KB, renderer ~1,700 lines/81 KB carry multiple substantial responsibilities | Future bounded extraction only with direct behavior tests, not a hygiene rewrite |
| A10 | P2 | [package.json](package.json), production build below | Main JS ~1.49 MB minified / 424 KB gzip, beyond Vite's 500 KB warning; 31 PNGs total 36,723,805 source bytes | Profile loading/rendering/memory; consider owner-authorized asset and bundling work, not speculative compression |

### Positive structural/lifecycle evidence

- Rollup AST parsing succeeds for all 31 source modules. No duplicate methods
  or import cycles found in the static source graph; no core import of renderer,
  scene or Phaser. A1 is the distinct **mixed data boundary** issue, not an
  invented direct renderer dependency.
- Core progression records only traversed segment evidence. Milestone/sector
  assertions still fail against several old boundaries; see the catalog below.
  No blanket claim that every migration/progression result is correct.
- Normal purchases, banking, repair and terminal results generally save a
  complete candidate before committing state; duplicate terminal receipts are
  checked. The A3 hint exception and A4/A5 recovery/concurrency risks remain.
- Phaser 3.90 InputPlugin shutdown removes its listeners; KeyboardPlugin removes
  keys/listeners. Anonymous pointer handlers are not automatically leaks.
  External resize handler has explicit shutdown deregistration.
- Road environment cleanup kills zoom tweens, destroys pools/beams/decals/FX
  and removes its owned ambient canvas texture. Overlays/masks and obstacle/
  collectible/guardrail attachments use existing cleanup paths.
- Three actual desktop scene restarts held **127 textures**, **one pointerdown
  and one pointermove handler**, **four total resize listeners**, **14 shutdown
  listeners** stable. Display children stabilized at **104** after initialization.
  The read-only restart smoke left its storage snapshot unchanged.
- Trailer history is capped at 120, visual beds at four, and lamps/decals/particles
  are pooled/bounded. Generator transition-certificate cache clears at 4,096,
  and expired interval/reservation maps have cleanup: these were not falsely
  classified as unbounded leaks.

This is source analysis plus a bounded desktop lifecycle smoke, not a memory
profiler session or physical-phone/long-run certification.

## 4. Current test, static and build status

Both full runs use **`npm.cmd test`** with unchanged test files and dependencies.

| Gate | Before removal | After removal |
| --- | --- | --- |
| Full tests | 382 PASS / 45 FAIL / 427; exit 1 | 382 PASS / 45 FAIL / 427; exit 1 |
| Full-test duration | 527.228 s | 509.283 s |
| Skipped / cancelled / todo | 0 / 0 / 0 | 0 / 0 / 0 |
| Production build | PASS, exit 0 | PASS, exit 0 |
| Build duration | 9.42 s | 8.96 s |
| Main JS | 1,490.25 kB / 424.10 kB gzip | 1,490.15 kB / 424.09 kB gzip |
| CSS | 0.57 kB / 0.31 kB gzip | 0.57 kB / 0.31 kB gzip |
| Build warning | Main chunk >500 kB | Same warning |
| JavaScript syntax | Parser accepts all source | `node --check` PASS for all 31 source JS files |
| Import resolution | Vite build PASS | Vite build PASS |
| Source behavior structure | Original archived | All 31 normalized active ASTs unchanged |
| Generator sample | Original registry + seed hashes | Exact matching registry + 160 row hashes |
| Maintained doc links | Known stale/broken entry points | All seven entry/docs/report files: zero broken paths/anchors |

Small bundle savings are expected: Rollup already tree-shakes uncalled code.
Source/doc maintainability improved without pretending to solve the bundle budget.
Durations reflect these executions/environment, not an isolated performance
benchmark. No extra package/linter was installed.

Additional exact checks:

- All changed source files checked with `node --check` (the command covered all
  31, not just the 11 edits). Build checks import/asset resolution.
- Before/after AST comparison strips only export wrappers and the six listed
  dead declarations in the old generator; otherwise body/statement equality
  is exact. Positions/raw literal spelling are ignored, semantic literals retained.
- All baked `CHUNK_REGISTRIES` data and 20 sampled rows for each of seed 1/153 x
  Level 1/2 x Normal/Overdrive match SHA-256 hashes: 160 rows total. This is a
  pruning-invariance check, **not** the T6 10,000-encounter safety gate.
- No retired doc references remain in runtime/tests/scripts/root entry points
  or the four current docs. Temporary analysis scripts/evidence stayed outside
  the project.
- Compared all 427 individual status/name lines, including nested subtests:
  **zero changed outcomes**, same 45 failure identities. No new regression is
  observed from this cleanup; the full engineering gate is nevertheless failing.

Commands actually executed:

```powershell
npm.cmd test                  # before: 527.228 s; after: 509.283 s
npm.cmd run build             # before: 9.42 s; after: 8.96 s
Get-ChildItem .\src -Recurse -File -Filter '*.js' | ForEach-Object {
  node --check $_.FullName     # all 31 PASS
}
```

Session-only helpers used the existing `rollup/parseAst` dependency for
31-module static analysis, before/after structural comparison, docs link checks
and registry/route hashing. No source tool dependency was added.
UTF-16 PowerShell test/build logs, structured static analysis, failure catalog,
status comparison and original route hashes are retained beside the recovery
directory. The temporary analysis/verifier executables were removed afterward.

## 5. Exact existing failure catalog

All failures below are from the fresh **pre-removal** baseline. File/line is the
owning test definition; the short assertion evidence is not an exhaustive root
cause diagnosis. Some failures stop before their later assertions run.
The after-removal run reproduces the same 45 failure identities.

| # | Test file / line | Failing contract / concrete evidence |
| --- | --- | --- |
| 1 | blueprints.test.js:93 | v1/v2 preservation: actual milestone list additionally reaches Level 1 Sector 4 |
| 2 | cargo.test.js:94 | Sector-weighted tiers: freight actual 10 versus expected 20 |
| 3 | chicanes.test.js:80 | Bounded chicane samples: physical clear-event violations beginning 130.872 m |
| 4 | clearRowRule.test.js:184 | All16 routes: seed 1 Level 1 Normal first clear streak 4 at 92.856 m |
| 5 | clearRowRule.test.js:216 | Urgent-lane pressure: actual Beta event does not threaten the required lane |
| 6 | clearRowRule.test.js:243 | Depot clearing/history: clear-streak violations remain |
| 7 | clearRowRule.test.js:291 | Normal continuation variety: common 291 / pairs 357 / cross 99 comparison fails |
| 8 | clearRowRule.test.js:363 | Secondary filler actual requested-gap coverage assertion fails |
| 9 | clearRowRule.test.js:423 | Seed 153 Level 1 Overdrive at 8,000 m: `No connected fallback` |
| 10 | clearRowRule.test.js:435 | Independent collision replay: Beta physical mask leaves lane streak 4 |
| 11 | clearRowRule.test.js:454 | Side funnels: fixture expects existing two-lane structures to narrow road |
| 12 | clearRowRule.test.js:484 | Interior slalom lanes actual 2/1/1 versus expected 2/3/2 |
| 13 | controlledMovers.test.js:24 | Half-open banking quota boundaries actual 1,000 versus expected 1,500 m |
| 14 | depotEconomy.test.js:104 | Crash award/reconciliation actual 250 versus expected 225 |
| 15 | depotEconomy.test.js:127 | Multiple banking gross/net fixture actual 80 versus expected 65 |
| 16 | depotEconomy.test.js:168 | Gold eligibility fixture attempts Level 2 completion before current finish |
| 17 | depotEconomy.test.js:200 | Level 2 awards fixture attempts completion before current finish |
| 18 | depotEconomy.test.js:297 | Record tier at 2,999 m actual 250 versus expected 100 |
| 19 | depots.test.js:15 | Level 1 Depot list actual 500/1,000/2,000 versus expected 500/1,500/3,000 |
| 20 | depots.test.js:40 | Mover interval/finish list actual Level 1 finish 4,000 versus expected 5,000 |
| 21 | depots.test.js:168 | Facility palette step actual 2 versus expected 1 |
| 22 | economy.test.js:28 | Crash-consolation cap actual 50 versus expected 25 |
| 23 | gameBalance.test.js:10 | Config fixture expects Level 1 finish 5,000; current approved 4,000 |
| 24 | hazards.test.js:125 | Nonintruding scenery assertion finds a trailing collision |
| 25 | hazards.test.js:212 | Provisional 50-60% mix: seed 1 measured 0.7795 |
| 26 | hazards.test.js:247 | Roadside weave requires minimum five lane changes; assertion fails |
| 27 | hazards.test.js:314 | Physical transition fixture collides with sideRail at 112 m |
| 28 | longObstacles.test.js:15 | Straight-route denial fails for industrial-roadside-weave-left |
| 29 | longObstacles.test.js:41 | Continuous body length actual 815.766 versus expected 528.021 px |
| 30 | modules.test.js:47 | Milestone threshold fixture gains Sector 4 earlier than expected |
| 31 | modules.test.js:245 | Cargo rank price actual 150 versus expected 100 Coins |
| 32 | modules.test.js:339 | First-capacity purchase wallet actual 99,850 versus expected 99,900 |
| 33 | progression.test.js:12 | Lightweight Rack eligibility true before fixture's expected boundary |
| 34 | progression.test.js:40 | Entered/completed sectors include Sector 4 versus expected first three |
| 35 | progression.test.js:74 | Completion/normal progression fixture expected false, actual true |
| 36 | saveMigration.test.js:253 | Level-specific sector evidence actual includes Sector 3 versus expected 1/2 |
| 37 | sceneLifecycle.test.js:1011 | Garage price/shortfall actual 150/110 versus expected 100/60 Coins |
| 38 | sectors.test.js:20 | Explicit architectural contract rejects environments import from core generator |
| 39 | sectors.test.js:36 | Level 1 starts actual 0/500/1,000/2,000 versus expected 0/500/1,500/3,000 |
| 40 | sectors.test.js:91 | Full-load moving route reachability fails at seed 1234, 819 m |
| 41 | sectors.test.js:247 | 6,000 seeded connections: required registry/chunk identity assertion fails |
| 42 | sectors.test.js:267 | Native chunk-tail safe-lane transition assertion fails |
| 43 | trackGenerator.test.js:76 | Integrated physical route test stops on missing expected descriptor identity |
| 44 | trackGenerator.test.js:330 | Static-chicane proof completed/clearance/reaction assertion fails |
| 45 | vehicles.test.js:37 | Swift Blueprint price actual 6 versus fixture's 12 |

The unchanged 45 historical failure names also appeared in the previous
URL-debug full-run record. Several are demonstrable fixture/config disagreements;
others require actual generation/geometry investigation. No blanket "all stale"
classification is justified.

## 6. Prioritized next steps

1. **Restore a trustworthy engineering gate.** Triage the 45 exact contracts into
   owner-confirmed specification drift versus real defects. Preserve safety/
   quota/receipt guarantees; change expectations only in an explicitly authorized
   contract-reconciliation task with provenance.
2. **Fix actual connected generation/mover/collision blockers.** Start with the
   seed 153 fallback and physical-clear/chicane failures, using bounded windows
   and existing owners. Do not use a parallel generator or bypass validation.
3. **Resolve the mixed challenge/visual-data seam.** Satisfy the existing boundary
   contract while proving deterministic output/footprint invariance.
4. **Reconcile Depot/repair/tier requirements with current behavior.** A dedicated
   product/implementation task must settle per-run limits and future-tier gating;
   this audit is not permission to restore the old guide.
5. **Harden save failure/recovery and measure concurrent tabs/receipt growth.**
   Fix the ignored hint-save result first; preserve profile compatibility and
   explicit error UX.
6. **Close the real-browser bot/model gap**, then measure mobile timing, memory,
   touch/scrolling and night readability. Keep V1-V4 PENDING until observed.
7. **Profile before structural/bundle optimization.** Future small extractions,
   asset budgeting and split/load strategy require their own functional tests.
   Avoid a wholesale scene/rendering rewrite or new tooling framework.
8. **Establish version-controlled recovery in a separately approved task.**
   This audit did not initialize Git or deploy. Keep only the four docs current;
   output flags for diagnostic scripts can prevent future root snapshot clutter.

Do not proceed to new levels/tiers/releases while the mandatory engineering and
player gates are unresolved.

## Subsequent cargo/sprite and lighting task record

Owner-authorized follow-up, 1 November 2026. Implementation is persistent;
the mandatory hazard/generator gate remains **BLOCKED** by six existing
assertions. No full-repository suite, 10,000-encounter gate or deployment was
performed for this follow-up.

### Implemented cargo slice

- The existing `cargo.js` history chain now samples five 60 Hz-equivalent frame
  delays per segment, retains 120 history steps and uses load-damped spring lag.
- Segment displacement is bounded to 18 px from the cab. Angular tracking is
  0.25 per 60 Hz-equivalent step, with both absolute and cab-relative rotation
  limited to 8 degrees. Fixed 46/29 px center spacing remains.
- Existing trailer-bed art, scaled metal drawbars and matched navy silhouette
  shadows at y + 2 px / alpha 0.5 replace detached/exaggerated presentation.
- Tunables remain in the established cosmetic `data/balance.js`; no economy,
  cargo accounting, player steering/physics or collision body was changed.
- Slice checks: seven focused cargo/rendering tests PASS after updating the
  scaled-hitch expectation. Later final cargo/lifetime regressions also PASS.

### Implemented sprite-only obstacle slice

The owner explicitly selected **hazard-kind remapping and normal
recertification**, rather than reskinning the original unsupported hitboxes.

- Industrial `container` candidate slots -> existing `barrier`;
  Industrial `machinery` and Dustlands `wreckage` -> existing `rockSlab`.
  The narrower Signal Cabinet was considered first, then rejected because it
  changed authored straight-route accounting and added recovery rows.
- Removed primitive-only energy/drum/shield entries from future theme pools/
  candidate mappings too; generic bare-row Gate/Bollard choices now select
  existing sprite-backed Divider/Signal Cabinet/Barrier kinds.
- Removed procedural container, scrap/sector-obstacle and roadside-intrusion
  drawing paths and their baked hazard keys. Outside-road scenery, light/
  particle/connector graphics remain legitimate non-obstacle decoration.
- Original **17 authored chunks / 126 rows / 252 emitted bodies** remain
  unchanged in count; every old candidate slot still has a replacement. Active
  selection retains the single connected validator, quota rules and retry limits.
  Existing hazard geometry definitions/configuration were not rewritten.
- All environment lists and both candidate registries resolve to dedicated
  Barrier/Divider, Rock Slab, Signal Cabinet, forklift or chicane sprite keys.
  Retired diagnostic geometry definitions remain available without being
  reintroduced into active pools.
- Initialization/runtime cache checks recover missing frames from actual
  standard Barrier pixels at the declared frame size and warn once per key/
  texture manager. Failure of the fallback Barrier itself is an explicit fatal
  initialization error, not a geometric box or missing-texture square.
- Tests intentionally update the retired palette/procedural-render expectations,
  scaled hitch/shadow values and mock texture-cache dependency. The brute-force
  straight-route test now handles the existing Barrier's rectangular collider
  as well as compound footprints; its safety assertion is not weakened.

### Latest lighting override

| Implemented level | Sector 1 | Sector 2 | Sector 3 | Sector 4 |
| --- | --- | --- | --- | --- |
| Level 1 | Dawn | Dawn | Mid-Day | Mid-Day |
| Level 2 | Dawn | Mid-Day | Mid-Day | Dusk |

The original Night/dimmest preset is retained exclusively for future levels.
Overdrive continues using High Noon. The scene supplies the level explicitly at
run/URL-warp initialization, sector transition and Depot exit. Dawn glints,
headlights, sodium pools and enhanced strobes derive from the mapped preset:
only current Level 2 Sector 4 enables headlight/dusk-strobe mode.
No speed/density change accompanies this lighting override.

### Files changed

- `src/game/core/cargo.js`
- `src/game/core/hazards.js`
- `src/game/core/trackGenerator.js`
- `src/game/data/balance.js`
- `src/game/data/environments.js`
- `src/game/rendering/industrial.js`
- `src/game/rendering/roadEnvironment.js`
- `src/game/scenes/RoutePrototypeScene.js`
- Directly affected tests: cargo, hazards, trackGenerator, rendering,
  sceneLifecycle.
- All four maintained docs and this current evidence appendix.

### Actual final checks

| Check / command | Result |
| --- | --- |
| `node --test tests\rendering.test.js` after lighting mapping | **75 PASS / 0 FAIL**, 6.396 s |
| `node --test tests\hazards.test.js tests\trackGenerator.test.js` | **43 PASS / 6 FAIL / 49**, 359.340 s |
| Focused palette/straight-route/density/pylon/cargo tests | **6 PASS / 0 FAIL** |
| Full collision unit file | **5 PASS / 0 FAIL** |
| Focused actual scene spawning/guardrails/lifetime/cargo/fast-clock tests | **18 PASS / 0 FAIL**, 8.507 s |
| Focused URL warp/Depot exit/warning-light regressions after lighting mapping | **8 PASS / 0 FAIL** |
| All requested source syntax checks and every changed source module | PASS |
| Final production build including latest lighting override | **PASS**, 4.56 s; main JS 1,485.60 kB / 422.80 kB gzip; existing >500 kB warning |

Final requested rendering/hazard/generator gates therefore do **not** constitute
an all-pass acceptance result. The six remaining failure identities match the
pre-task full baseline:

1. Scenery trailing collision assertion (`hazards.test.js`, scenery assembly).
2. Industrial 50-60% mix: seed 1 remains 0.7795.
3. Roadside weave minimum-five-lane-change assertion.
4. Physical transition fixture collides with sideRail at 112 m.
5. Integrated clearance test stops at the existing missing next encounter identity.
6. Static chicane completion/clearance/reaction certificate assertion.

No unrelated tuning or safety bypass was used to repair these historical
blockers. Rendering test nesting/cache-fixture assumptions introduced during
this task were corrected and rerun; the final suites have no cancelled tests
or new failure identities.

Final syntax checks pass for all eight modified source modules. Direct
comparison with the hygiene recovery copy confirms `GAME_BALANCE` and every
`HAZARDS` geometry record are unchanged. All 97 local links across the seven
maintained entry/docs/report files resolve.

### Browser evidence and limits

- Native scene spawn/update samples from **all eight normal sectors** observed
  **346 obstacle instances**, with zero missing texture keys, load warnings or
  browser errors. This is bounded sampling plus exhaustive candidate/pool key
  coverage, not exhaustive physical-clearance certification.
- The first all-sector sample did not move the truck because it targeted an
  unused field; it is **only obstacle-coverage evidence**, not steering proof.
  A separate corrected four-bed factory/scene presentation check exercised
  250/600 px/s paths at 30/60/120 Hz: distinct segment poses, maximum offset
  18 px, maximum absolute/cab-relative rotation <=8 degrees (floating-point
  tolerance), exactly matched shadow position/rotation/alpha. Screenshot
  inspected the attached four-bed chain; no phone/playtester claim.
- A real texture-cache fault recovered a 60 x 46 Rock Slab frame with **1,675
  nontransparent Barrier-derived pixels** and one warning across two misses;
  no missing-texture square or collision/config change.
- Latest lighting verification **PASS**: all eight start states and the six
  sector-entry Depot exit states use the requested maps (Sector 1 has no entry
  Depot). Only Level 2 Sector 4 has two visible beams/two visible sodium pools;
  Dawn glints appear in Level 1 Sectors 1/2 and Level 2 Sector 1. Night is absent.
  The initial Depot fixture incorrectly resumed against an unavailable upcoming
  Depot; it was corrected to represent each finite visited sector-entry Depot,
  without changing production Depot code.
- Real stored progress remained unchanged during completed browser fixtures;
  the normal Main Menu/debug OFF was restored afterward.

Next authorized work is a separately bounded investigation of the existing
hazard/generator blockers. Do not auto-advance a failed gate or claim CrazyGames/
Poki/mobile/release validation from sprite coverage alone.

## Subsequent pickup visibility, Sweeper and label-removal record

Owner requests: slightly dim Dusk/Night cargo art and drop shadows while keeping
pickups apparent; add a Barrier-style amber Sweeper beacon; use three available
lanes or two restricted lanes. Follow-up removes only the coin/value/load labels
beneath road cargo, preserving the pickup visual.

### Implementation and ownership

- `environments.js` supplies cosmetic 230/255 neutral cargo tint and 90% glow
  intensity for Dusk/Night. `industrial.js` applies them above the heavy ambient
  mask, including drop shadows embedded in the supplied pickup raster.
  Dawn/Mid-Day/Overdrive and rejected-pickup dimming remain intact.
- The existing Barrier light helper now provides one amber double-flash beacon
  for the Sweeper. Scene attachment positioning/removal is reused; no extra
  tweens, collider or light lifecycle owner.
- The live generator previously hard-coded the central two-lane span.
  `fitSweeperOpening` chooses three contiguous centers when native companions
  and current wall references permit, otherwise two. It recalculates the impact
  snapshot before the normal connected canonical-time certification.
  `hazards.js` recognizes both correctly tagged lane/bound layouts; untagged or
  malformed spans remain conservatively validated. Authored restricted opening
  lessons keep their two-lane bounds.
- `RoutePrototypeScene.js` no longer allocates road-cargo coin/value/load labels
  in either `spawnTrackRow` or `spawnSandboxCargo`. Pickup textures, rotations,
  shadows/glows and gameplay value/mass/slots are unchanged by this follow-up.
  HUD totals, collection feedback and separate Blueprint reward labels remain.
- Updated tests: rendering, sceneLifecycle, controlledMovers and the directly
  related moving-intercept assertion in trackGenerator. All four maintained
  docs reflect the owner decisions. `GAME_BALANCE` and the complete `HAZARDS`
  geometry registry compare exactly with the existing recovery copy.

### Actual verification

| Check / command | Actual result |
| --- | --- |
| `node --test tests\rendering.test.js tests\sceneLifecycle.test.js tests\collision.test.js` before label follow-up | **199 PASS / 1 FAIL / 200**, 13.055 s; only the pre-existing Garage 150/110 versus 100/60 price fixture fails |
| `node --test tests\controlledMovers.test.js` | **10 PASS / 1 FAIL / 11**, 14.176 s; pre-existing Level 1 interval expectation 1,000 versus 1,500 m |
| Focused `Level 2 moving intercepts` in trackGenerator | **1 PASS**, 29.495 s; four seeds, normal/checkpoint/Overdrive quotas, following openings and phase checks |
| Focused `real seeded selection\|real Level 2 opening\|central movers retain` | **3 PASS**, 11.976 s; actual seeded pairs/singles and full connected half-load proofs at 30/60/120 Hz |
| Focused returning-mover bot / long Overdrive scene lifecycle | **2 PASS**, 13.659 s; 12,000 update lifetime sample peaks at 8 logical objects and releases every attachment |
| Final label/art/collection/Blueprint focused selector across rendering, sceneLifecycle and cargo | **9 PASS**, 0.274 s |
| `node --check` on five changed source and four changed test files | **PASS**, all nine |
| Final `npm.cmd run build` including label removal | **PASS**, 4.49 s; JS 1,486.47 kB / 423.10 kB gzip; existing >500 kB warning |

Initial scene fixtures omitted the newly used tint method; the fixtures were
corrected and both bot/lifetime tests rerun successfully. An overly broad cargo
name selector also reproduced the historical sector-weighted freight 10-versus-20
assertion; it was neither edited nor waived. All three failed identities above
are present in the archived pre-task baseline. No full repository or 10,000
encounter gate was run for these bounded requests.

### Browser and deterministic route evidence

- Seed 1 normal Level 2: 15 three-lane and 2 restricted two-lane movers;
  seed 153: 16/1; seed 98765: 16/1. The restricted examples have a wall reference
  on one outer side and a native companion on the other; both wider alternatives
  overlap static geometry. Seeded replay equality and selection of both spans
  are asserted in the new regression.
- Actual browser pickup fixtures cover all four art sizes under Dawn, Mid-Day,
  Dusk, reserved Night and High Noon. Low-light tint is `0xe6e6e6`, glow at pulse
  zero is 0.495 versus 0.55 in daylight, and the Sweeper retains the Barrier's
  0/100/180/500 ms double-flash phases. Screenshot inspection confirms readable
  cargo/shadows, an amber beacon and no cargo coin/text annotations.
- Actual scene updates using seed-1 selected mover records cover the two-lane
  range 159.007-231.878 px (limits 159-232) and three-lane range 86.163-231.501 px
  (limits 86-232), within one-frame endpoint tolerance. The beacon follows every
  horizontal update. The initial browser loop incorrectly passed seconds to a
  millisecond update API; correcting that fixture produced the reported result
  without a production timing change.
- Browser sessions are ephemeral; stored progress is unchanged. Night remains
  a fixture/future preset, not a newly enabled live level.

Historical broader generator, Garage/config and bot-only browser/player
acceptance blockers remain separate and unresolved. Do not advance those gates
or claim mobile/release certification from these focused results.

### Collectible 5% downscale follow-up

The owner requested all collectible visuals 5% smaller while keeping the current
drop-shadow sizes. The scene now applies cosmetic
`balance.COLLECTIBLE_VISUAL_SCALE = 0.95` only to road collectible bodies:
four cargo art sizes (normal/sandbox), Blueprint and converted Blueprint coin
stack. Separate under-pickup shadow/glow layers keep their original scale and
offset. No source raster, collision range, trailer, menu/HUD art or save changes.

Changed owners: `src/game/data/balance.js`, `RoutePrototypeScene.js`; related
scene tests and all four maintained docs updated.

- Focused scene/rendering selector covering collectible scaling, Blueprint/Apex
  conversion, normal/sandbox low-light/rejection behavior and trailer shadows:
  **7 PASS / 0 FAIL**, 0.281 s.
- `node --check`: both changed source modules and scene test file **PASS**.
- `npm.cmd run build`: **PASS**, 4.67 s; JS 1,486.56 kB / 423.15 kB gzip;
  existing >500 kB warning remains.
- Actual browser: all four cargo frame displays change from 46.2 x 46.2 px to
  43.89 x 43.89 px (exactly 95%); their under-pickup layers remain 70.4 x
  70.4 px. Repeated visual updates do not compound scaling. Stored progress
  unchanged; ordinary Main Menu restored.
- Initial test insertion accidentally nested the new check and used an exact
  floating-point quotient comparison. It was moved to top level and changed to
  compare the exact multiplication used by production, then all seven focused
  checks passed. No gameplay or safety assertion was relaxed.

No full repository/generator gate was run for this presentation-only follow-up;
historical blockers and human/mobile acceptance remain unresolved.

### Garage / Upgrades clarity and visual inspection follow-up

The owner requested a visual inspection of Garage, truck previews and upgrade
menus, with sufficient spacing, correctly placed titles, matching upgrade sprites
and simple English. This is a presentation-only follow-up, not an economy or
progression repair.

Changes:

- [RoutePrototypeScene.js](src/game/scenes/RoutePrototypeScene.js): separate
  compact heading/wallet space; measured detail/confirmation title/subtitle
  positioning; more grid-card room and 12 px horizontal text padding; clearer
  full Level/Sector card requirements instead of shorthand; separate truck
  steering labels/bars; taller preview cards with summary stats below truck art.
- All eight upgrade details and purchase confirmations use their matching
  supplied sprite at 72 px. Reinforced Cargo Hold shares Cargo Capacity art.
  Explicit scaled icon scroll bounds prevent the native raster origin from
  incorrectly hiding the new standalone detail icons.
- [industrial.js](src/game/rendering/industrial.js): simple module explanations
  and UI-only benefit formatting reused across cards/details/confirmations.
  Keep exact bonuses, Depot-only shield refill, dropped-cargo Insurance exclusion
  and Impact Pulse's damaging-hit/on-screen-obstacle limitations. Reinforced
  Cargo now uses the same plain cargo-value-loss wording.
- [sceneLifecycle.test.js](tests/sceneLifecycle.test.js) and
  [rendering.test.js](tests/rendering.test.js): matching-art/scaled-scroll-bound
  and precise-copy regressions; update VM wiring, scaled image mocks and
  intentional presentation expectations. Real purchase/equip/save-failure and
  unlock contracts remain intact. Four maintained docs updated.

Final commands/results:

```powershell
node --check src\game\scenes\RoutePrototypeScene.js
node --check src\game\rendering\industrial.js
node --test --test-name-pattern='Garage|upgrade tiles|menu descriptions|equipment shop save|cargo tier transition|management|menu scroll|footer|touch' tests\sceneLifecycle.test.js tests\rendering.test.js tests\menuLayout.test.js
npm.cmd run build
```

- Source syntax: **PASS**.
- Focused UI/art/copy/scroll/transaction run: **29 PASS / 1 FAIL / 30**,
  0.351 s. The sole failure is the previously recorded Garage price assertion:
  expected `100 COINS / NEED 60 MORE`, current authoritative config returns
  `150 COINS / NEED 110 MORE`. Neither the prices nor this assertion were changed
  to make this task pass.
- Production build: **PASS**, 5.15 s; JS 1,486.98 kB / 423.42 kB gzip.
  Existing >500 kB chunk warning remains.
- Browser visual inspection: all eight upgrade details, Reinforced Cargo Hold,
  a shield purchase confirmation, both Garage tabs, truck preview and final
  Standard Gold color card. Correct supplied sprites and contained text observed.
- Browser geometry: 22 menu/detail/confirmation states across 390 x 844,
  320 x 568 and 430 x 932; corrected fixtures use the real `garage` tab identifier
  and return through Garage after a locked Swift preview. All five truck cards
  separately verified at all three sizes. No text/art overlap, horizontal
  overflow or tested card-padding failure. Reinforced Cargo's final plain-English
  lines rechecked after the last copy adjustment. Measured compact title/wallet
  gap is 12.5 logical px; scroll content ends 16 px above footer actions.
- Early failures in new tests were fixture-only: missing VM/helper imports,
  image mocks without `setScale`, and a mock panel that did not clear its old
  objects. These were corrected without weakening gameplay assertions.
- Cloned profiles were used only for read-only purchase/max-rank inspection;
  no transaction buttons were activated. Stored progress unchanged. Plain URL,
  ordinary Main Menu, debug OFF and desktop viewport 1858 x 984 restored.

No broad repository/generator gate was rerun. Historical price/generator/bot
blockers remain separate; human mobile readability, touch and playtesting are
still **PENDING**. Next work requires the next owner-directed scoped task or
resolution of the recorded mandatory gate blockers; no release certification,
future level implementation, push or deployment is authorized by this pass.

### Owner-authorized contract / boundary / generator / persistence repairs

Step 1 completed without game logic changes. Named baseline: 68 PASS / 23 FAIL,
49.304 s. Approved Level 1 4,000 m / 500-1,000-2,000 m stops, Level 2 5,000 m,
Swift 6 Blueprints, cargo first rank 150 Coins, crash cap 50 Coins and Sector 4
entry/checkpoint evidence were reconciled in the ten requested test files.
The related Garage shortfall assertion also now expects 150 / 110, not 100 / 60.
Correct Level 2 finish distances are independent from Level 1 fixture constants.
All nine named non-generator suites: 79 PASS / 0 FAIL, 28.640 s.
Level 1/2 topology and Garage price selectors: 3 PASS / 0 FAIL, 0.258 s.
Boundary and generated connection/tail assertions were not weakened; they belong
to Steps 2 and 3. No unsupported ~22-pass estimate is claimed.

Step 2 extraction: new `data/challengeProfiles.js` owns immutable structural
hazard/filler/Beta families; routes/sectors expose `challengeProfileId`, separate
from `visualThemeId`. Generator imports only challenge data, not environments.
Visual environments retain asset inventories/lighting without filler-selection
policy. Relevant palette tests now read their actual challenge-data owner.
Bounded before/after seeded chunks and preparation SHA-256 remained identical:
`79bac628160a72ee0182c0c13315920f5f5d75083b00031c8b2abfeafd299062`.
Initial boundary/art/registry selectors: 6 PASS / 0 FAIL, 0.289 s.
Step 3 is now **BLOCKED after two focused correction/retest attempts**.
Step 4 persistence changes were not started after that prerequisite failure.

#### Step 3 retained partial corrections and root causes

- [trackGenerator.js](src/game/core/trackGenerator.js): certification and Beta
  transition speed use the prior/local segment's source distance, not the next
  physical row's downstream speed. This does not invent a 600 px/s speed at
  genuinely faster Overdrive distances.
- Projected physical pressure is now checked after Beta augmentation and bridge
  replay, and unacceptable candidates/future witnesses are rejected. Witness
  obligations are committed without rerolling Beta augmentation in planChunk.
- Pressure span resolution incorrectly treated self-contained staggered pinch
  bodies as multi-row walls: it erased their real offset/length, so a projected
  threat could differ from emitted geometry. The second correction preserves
  standalone pinch geometry. The prior seed 1 Normal lane-0 streak-4 violation
  at 1,645.004786405762 m no longer blocks the all-16-case urgent-lane test.
- [challengeProfiles.js](src/game/data/challengeProfiles.js): Industrial was
  empty of filler families. It now allows existing certified Barrier, Rock Slab
  and Signal Cabinet sprites. Seed 153 Normal produces 49 secondary fillers
  across all four lanes and three kinds. No pylon, blank replacement row,
  procedural fallback texture, parallel generator or balance value was added.
- Continuous-body/tail geometry is **unchanged**. Current long-body tests mix
  historical two-lane/fixed-length assumptions with actual collision contracts;
  their physical resolution is still pending, not waived.

Focused iteration evidence (logs remain outside the production workspace):

| Stage | PASS | FAIL | Duration | Actual result |
| --- | ---: | ---: | ---: | --- |
| Generator/hazard/long-body/filler baseline | 4 | 6 | 33.288 s | Existing generation and geometry/fixture failures reproduced |
| First correction | 0 | 4 | 6.621 s | Actual pinch pressure mismatch persisted; occupancy and fresh 8,000 m entry failed |
| Second/final correction | 1 | 3 | 40.980 s | All-16-route urgent-lane check passed; three blockers below remain |
| Final focused asset/boundary/quota/frozen regressions | 9 | 0 | 0.304 s | Retained current protection contracts passed |
| Spawn-position / atomic-body / attachment-lifetime regressions | 5 | 0 | 5.532 s | Existing lifetime protections passed |
| Existing same-seed chunk reproducibility | 1 | 0 | 3.881 s | Deterministic retained generator passed |

Second/final correction command:

```powershell
node --test --test-name-pattern='all16 actual|secondary fillers|live selection pressures' tests\clearRowRule.test.js
```

Exact remaining blockers:

1. **Fresh seed 153, Level 1 Overdrive, 8,000 m:**
   `No connected fallback for seed 153, level1, 8000 m`.
   The initial synthetic approach has 783 px travel. At the actual 760 px/s,
   after the required 0.8 s reaction delay, the stock half-load witness cannot
   settle at the target lane by that gate. Diagnostic x167.12417 /
   velocity-157.17234 / clearance46.0785 px is collision-clear but `completed:
   false`; clearance alone is not certification. The same diagnostic settles at
   600/680 px/s, which does not justify using either at 8,000 m. This fails
   before encounter selection, rather than proving a narrow-corridor weighting
   problem. Correct the real spawn/entry timing or model the actual committed
   entry state in a new bounded task; do not teleport, remove reaction/settling,
   substitute a slower speed or force an invalid fallback.
2. **Physical-route fixture mismatch:** `clearRowRule.test.js` expects exactly
   one certificate, whereas current mandatory validation uses 30/60/120 Hz.
   Keep all configured proofs. A future fixture reconciliation must assert the
   exact configured proof set and each proof's completion/clearance. No assertion
   was suppressed here; the all-16 full-clearance/tail test has not passed.
3. **Industrial occupied-time threshold:** actual collision-empty time
   188.0776490455054 s (late 152.2632580297496 s) exceeds the existing
   163.84249332417437 s (late 128.8492515768585 s) thresholds. Without those
   same fillers it is 196.57421360439233 s, so the empty pool was a real contributor
   but was not the entire density problem. Preserve thresholds until approved
   topology/spacing evidence or a density correction establishes their contract.

Final retained-change verification:

```powershell
node --check src\game\core\trackGenerator.js
node --check src\game\data\challengeProfiles.js
node --test --test-name-pattern='sector challenge identity|pylons|sprite-only|side hazard quota|all sector themes|unsprited obstacles|transitions preserve frozen|guardrail collision|roadside intrusion' tests\sectors.test.js tests\trackGenerator.test.js tests\hazards.test.js tests\longObstacles.test.js tests\rendering.test.js
node --test --test-name-pattern='frame-quantized spawning|clearing a route destroys|removing one route object|approved Barrier, Rockslab|long scenery spawns once' tests\sceneLifecycle.test.js
node --test --test-name-pattern='same seed reproduces the same chunk sequence' tests\trackGenerator.test.js
npm.cmd run build
```

- Syntax **PASS**; final focused regressions **15 PASS / 0 FAIL** across the
  three commands above. This does not include or override the blocked 1/3 gate.
- Production build **PASS**, 4.52 s; JS 1,487.88 kB / 423.60 kB gzip.
  Existing >500 kB chunk warning remains.
- No full repository suite, complete generator suite, 10,000-encounter gate,
  release certification, push/deploy or real-save mutation was performed.
  Human/mobile acceptance remains **PENDING**.
- All four maintained docs now record the new challenge owner and blocked gate.
  No competing handoff/guide, production scratch source or test-framework change.

**Step 4 status:** [modules.js](src/game/core/modules.js) already builds its
accepted MILESTONES from every implemented level/sector; `level2`,
`level2,sector3` and `level2,sector4` are present, and
[save.js](src/game/core/save.js) imports that owner. The Step 1 enum fixture
passed; adding duplicate enum values is not warranted. A dedicated Level 2 /
Swift slot round trip is still useful when Step 4 resumes. A3 hint save ordering
and A4 corrupt/read-failure handling remain unchanged and unresolved.

**Next authorized work:** STOP at Step 3. Resume with a separately bounded
entry-timing/fallback and density-contract repair, retaining exact physical
pressure and witness commitment. Reconcile demonstrably stale certificate/
registry/long-wall fixtures without weakening geometry, quotas or sample-rate
proofs. Only after mandatory focused generator checks pass may Step 4 hint/
save hardening proceed. No later workstream or milestone gate is complete.

### Mobile menu peeking / module-header and card-border spacing

The owner requested a UI-only spacing/peek pass, then a follow-up specifically
reserving whitespace between the module subsection header and socket icons.
The actual owner remains
[RoutePrototypeScene.js](src/game/scenes/RoutePrototypeScene.js); separate
GarageScene/UpgradesScene files were not created.

Changes:

- [menuLayout.js](src/game/core/menuLayout.js): validated peeking-card dimensions
  based on available logical viewport height after header/footer offsets.
  Trucks expose 35% of card three; the two-column upgrade grid exposes 30% of
  its next row. Row gaps remain 12 px. The final 30% upgrade target preserves
  room for the owner's additional 18 px header margin without reducing the
  existing footer-to-mask safety gap.
- Existing scene: compact truck cards with side-by-side 54 px Preview and
  Equip/Unlock controls; 90 px truck art; dynamically fitted upgrade sprites.
  Existing buttons, transaction owners, locked states and placeholder trucks
  remain intact. Full detail/confirmation sprites remain 72 px.
- The module subsection header's measured bottom determines socket bay top
  plus **18 px**. Unlock offer and upgrade grid inherit the shifted position.
  Compact unavailable slot offers show their reason inside the existing button.
- `addCardText` provides explicit wrapped inner width, left/middle origin,
  measured scale-down and single-line fitting. Upgrade titles have measured
  **14-20 px top / 12 px left** padding. Truck/preview/color headers use the
  same fitted-label owner. Long effects and exact requirements remain in details.
- [menuLayout.test.js](tests/menuLayout.test.js) and
  [sceneLifecycle.test.js](tests/sceneLifecycle.test.js): exact mobile peek and
  header margin checks, padded/fitted single-line labels, updated compact card
  geometry and action arrangement, matching sprites and unchanged transactions.
  Mocks now implement Phaser text scaling and font-dependent height; card text
  is intentionally left-aligned while general descriptions remain centered.
  No gameplay/certification/clearance assertion was suppressed.

Newest verification:

```powershell
node --check src\game\scenes\RoutePrototypeScene.js
node --check src\game\core\menuLayout.js
node --test --test-name-pattern='Garage|upgrade tiles|management|menu scroll|footer|touch|peeking|mobile lists|equipment shop save|cargo tier transition|card labels' tests\sceneLifecycle.test.js tests\menuLayout.test.js
npm.cmd run test
npm.cmd run build
```

- Final focused UI checks: **30 PASS / 0 FAIL**, 0.332 s.
- Requested full suite: **417 PASS / 24 FAIL / 441 total**, 514.719 s, exit 1.
  It was launched for the initial spacing slice; the final header-margin
  follow-up was then checked by the scoped run and rebuilt. The full suite
  cannot be reported as passing. Failures are outside the changed UI/layout
  owners: cargo-tier/topology fixtures; chicane/spacing/formation/density;
  controlled-mover quota/clearance; physical tails/scenery; old registry
  assumptions; and the previously blocked generator certificates, occupancy
  and seed 153 Overdrive fallback. No sceneLifecycle/menuLayout failures.
  Preserve those failures for their separate authorized gameplay/contract task.
- Final production build: **PASS**, 5.38 s; JS 1,488.23 kB / 423.84 kB gzip.
  Existing >500 kB chunk warning remains. Source syntax checks pass.
- Browser: measured **24 states** (both tabs, current/fresh/max-slot profiles)
  across **320 x 568, 360 x 800, 390 x 844 and 420 x 844** on the newest code.
  No measured label padding overrun or text overlap. Module header gap is
  exactly 18 logical px at every tested size; all eight title top insets are
  14-20 px. Peeks are 35% Trucks / 30% Upgrades, within the requested range.
  Final card bottoms reach the mask bottom at maximum scroll; footer and its
  original 16 px clearance remain pinned. Old scrolling containers are
  destroyed on tab changes. Screenshots inspected at all four requested sizes.
- Actual browser drag: dragging 60 screen px over a Preview control scrolls
  without opening the preview. Existing 10 px deadband/click cancellation,
  clipping, inertia and lifecycle tests pass.
- Cloned profiles were used for inspection only; no purchases or persistence
  calls were triggered. Saved raw profile SHA-256 remained
  `b43dbcbd4352ec3cfd30aa3825a816ecfd7702300c1cfd98c7564f082c9cf814`.
  The shared plain-URL browser is left on Upgrades at 390 x 844 for the owner's
  requested inspection, with its original profile and debug OFF.

All four maintained docs updated. No gameplay balance, save schema,
generation/geometry, dependency, deployment or tester progress changes in this
UI task. Real mobile/playtesting remains **PENDING**. Menu refinements are
complete; the separate Step 3 generator and Step 4 persistence gates remain
blocked as recorded above.

### Explicit menu Y-accumulator / top-left card-title follow-up

The owner's latest instruction supersedes the prior 18 px subsection margin and
middle-origin card-title inset. Only the existing
[RoutePrototypeScene.js](src/game/scenes/RoutePrototypeScene.js) UI builder and
directly related [sceneLifecycle.test.js](tests/sceneLifecycle.test.js) fixtures
were changed.

- The socket Y accumulator now starts at the subsection header Y and advances
  by `sectionHeader.displayHeight + 24` before the socket builder runs.
  The socket bay, unlock offer and following grid all use that updated
  accumulator. A scaled/taller-header regression confirms all three translate
  by exactly the displayed-height difference.
- Upgrade titles use explicit `(0, 0)` origin and physical Y at the card
  background top plus **16 px**. The steel card graphic is center-origin:
  its actual top is `tile.y - tile.height / 2`, not its center Y. Explicit
  word-wrap width and scale-down are retained, with 12 px side inset.
  No `setPadding()` workaround exists in this menu owner.
- The minimum compact card height and maximum benefit text height are adjusted
  slightly to preserve the existing 30% next-row peek and nonoverlap after the
  extra 6 px socket translation. Footer, 12 px row gaps, action hit heights,
  prices, saves and drag protection remain unchanged.
- The only initial focused failure was the previous fixture requiring
  middle-origin titles; it now asserts top-left title origin and exact physical
  Y relative to the actual card background. Other labels remain left/middle.

Commands and actual final results:

```powershell
node --test --test-name-pattern='Garage|upgrade tiles|management|menu scroll|footer|touch|peeking|mobile lists|equipment shop save|cargo tier transition|card labels' tests\sceneLifecycle.test.js tests\menuLayout.test.js
node --check src\game\scenes\RoutePrototypeScene.js
npm.cmd run build
```

- Focused tests: **31 PASS / 0 FAIL**, 0.328 s; scene syntax **PASS**.
- Production build: **PASS**, 4.54 s; JS 1,488.26 kB / 423.86 kB gzip.
  Existing >500 kB chunk warning remains.
- Browser measurement: 12 Upgrades states (current/fresh/full-slot profiles)
  across 320 x 568, 360 x 800, 390 x 844 and 420 x 844. Every state has exactly
  **24 px header-to-socket gap**, **16 px top inset for all eight card titles**,
  and **30% next-row peek**. No measured title/status/benefit/action overlaps
  or border overruns. Latest 390 x 844 screenshot visually inspected.
- Original stored profile unchanged; temporary inspection snapshot removed.
  Shared browser left on plain-URL Upgrades at 390 x 844, original profile,
  debug OFF. All four canonical docs synchronized.

No full suite rerun for this bounded follow-up: the earlier requested broad
run remains 417 PASS / 24 FAIL with unrelated gameplay/contract blockers.
No gameplay, save, generator or asset changes. Real mobile acceptance remains
PENDING; this does not advance the separately blocked generator/persistence gate.

### Six-slice polish plan: Slice 1 generator gate

The entire owner-supplied [ImplimentationPan.md](docs/ImplimentationPan.md) was
read before implementation. Current product direction is browser gaming sites
first, mobile secondary. The six slices are sequential and scoped-test-gated;
no broad audit, full test suite, build, deployment, save reset or later gameplay
slice was performed during this renewed generator task.

Retained changes and root causes:

- [trackGenerator.js](src/game/core/trackGenerator.js): fresh certification had
  omitted the scene's committed 0.6 s launch delay. At 8,000 m, 783 px at 760 px/s
  could not settle after 0.8 s reaction. Include the real launch approach and
  pin its first speed to the actual collision-window speed, not a slower stage
  inferred after extending the approach. Existing Depot-reset distance is not
  double-counted. Validation is still mandatory; no seed-specific production rule.
- The same generator publishes each certificate's configured `hz`; it considers
  useful collision-bearing secondary fillers even when they do not additionally
  narrow the straight corridor. Connected paths, overlap, quotas, pressure,
  Depot and retry checks remain unchanged. No extra filler slot/count was added.
- [trackGenerator.test.js](tests/trackGenerator.test.js): new seed 153 regression
  proves the old entry fails at every configured rate, the committed launch
  settles, output is deterministic and all three >=6 px proofs survive.
- [clearRowRule.test.js](tests/clearRowRule.test.js): require the exact configured
  proof-rate set and every completed physical proof; resolved continuous spans
  must respect both authored length and the existing modular minimum.
  Density thresholds were not changed.
- [hazards.test.js](tests/hazards.test.js): select the scenery regression at the
  mandated gate and compare actual `hazardGeometry` bounds with rendered
  `guardrailLayout`. The old 41.1 px nominal-tail probe was inside the valid
  341.745642 px visible assembly. Its resolved half-hit-length is 184.872821 px.
  No production collision/renderer geometry was shortened.

Exact command executed for baseline, both corrections and restore verification:

```powershell
node --test --test-name-pattern='all16 actual|secondary fillers|live selection pressures|seed 153|sector challenge identity|guardrail collision|roadside intrusion' tests\clearRowRule.test.js tests\trackGenerator.test.js tests\hazards.test.js
```

| Run | Pass | Fail | Duration | Actual result |
| --- | ---: | ---: | ---: | --- |
| Renewed baseline | 3 | 3 | 37.919 s | Entry/proof/density failures |
| Correction 1 | 6 | 1 | 43.938 s | Entry/all-16 physical proofs/pressure/tails pass; density fails |
| Correction 2 | 5 | 3 | 4.067 s | New Normal fallback exhaustion from static-gap tuning |
| Restore verification | 6 | 1 | 43.994 s | First-correction behavior restored; density still fails |

Second correction scope was explicitly approved by the owner: extend density
tuning to certified static encounter gaps without weakening reaction/quotas.
The experiment in [challengeProfiles.js](src/game/data/challengeProfiles.js) and
the generator scaled Industrial Normal base gaps to 0.75 outside Sector 1 and
recovery; full reaction distance and Overdrive gaps were preserved.
It introduced `No connected fallback` for seed 1 / Level 1 Normal at
**2645.7314649443656 m**, and seed 153 / Level 1 Normal at
**2615.492652149251 m**. All-16/urgent-lane/density runs failed before completing.
The protected earlier static intervals did not prevent later connected-path
exhaustion: an unconditional smaller base gap is not a safe density fix.

Only this unsuccessful experiment and its dedicated test were reverted.
There is no remaining spacing-scale option in challenge data. The restore run
is safety verification of the earlier state, **not a third correction attempt**.
Final state: **56 fillers**, kinds Rock Slab/Signal Cabinet/Barrier, all four lanes;
collision-empty **182.88686639438134 s**, required **<163.84249332417437 s**;
late collision-empty **147.07247537862546 s**, required **<128.8492515768585 s**.
The same stream without fillers is 192.4816183173787 s. Fillers improve occupancy
but still fall short; neither requirement was silently waived.

Final static verification: **5 PASS / 0 FAIL** syntax checks:

```powershell
node --check src\game\core\trackGenerator.js
node --check src\game\data\challengeProfiles.js
node --check tests\trackGenerator.test.js
node --check tests\clearRowRule.test.js
node --check tests\hazards.test.js
```

Targeted source search confirms the reverted `normalStaticGapScale`,
`encounterSpacing` helper and experiment-only test are absent.

Persistent state:

- Slice 1 **BLOCKED after two renewed focused corrections**. Slices 2-6 have
  not started. Next bounded task: trace filler rejection/physical coverage and
  select spacing jointly with each candidate's actual connected transition and
  pressure history. Do not repeat an unconditional multiplier or reduce tests.
- [README](README.md), all four canonical docs and the owner plan now carry the
  browser-first direction and actual checkpoint. Existing menu/cargo/presentation
  work, economy, saves, two-level boundaries and sprite assets are protected.
- Browser remains plain-URL menu, debug OFF. Read-only stored-profile verification
  is unchanged:
  `b43dbcbd4352ec3cfd30aa3825a816ecfd7702300c1cfd98c7564f082c9cf814`.
  No actual runs/purchases were started for these checks.
- Full tests/build remain assigned to Slice 6; historical broad result is still
  417 PASS / 24 FAIL / 441 total, not fresh evidence for these core edits.
  Human/browser-player/mobile V1-V4 remains **PENDING**; no chart, release or
  future-level readiness claim.

### Candidate-aware density resolution follow-up

The owner explicitly authorized a new bounded Slice 1 density scope:
diagnose rejection reasons before editing, try adjacent/collinear candidate-aware
spacing and certified secondary fillers, preserve all physical proofs, reaction
buffers, quotas, recovery/opening and Depot protections. No unconditional sector
gap multiplier was introduced.

Diagnostics used a session-only in-memory instrumented import of the current
[trackGenerator.js](src/game/core/trackGenerator.js) and existing
[route-audit.mjs](scripts/route-audit.mjs) playback. No diagnostic counters, copied
generator, scratch script or log was added to production. The final trace assigns
replay failures only while a filler is being proposed; initial mixed Beta/replay
counters must not be confused with filler-only reasons.

Seed 153 / Level 1 Normal / 9-6,100 m, restored production source:

| Outcome | S2 | S3 | S4 | Total |
| --- | ---: | ---: | ---: | ---: |
| Sprite candidate attempts | 24 | 134 | 619 | 777 |
| REJECT_OVERLAP | 1 | 16 | 1 | 18 |
| REJECT_WITNESS_PATH: local physical transition | 5 | 28 | 126 | 159 |
| REJECT_WITNESS_PATH: committed sequence replay | 0 | 3 | 2 | 5 |
| REJECT_LANE_QUOTA: actual physical-event clear-streak rule | 2 | 74 | 441 | 517 |
| REJECT_PRE_DEPOT_BUFFER | 9 | 0 | 0 | 9 |
| REJECT_RECENT_LAYOUT | 0 | 0 | 9 | 9 |
| Accepted filler proposals | 7 | 13 | 40 | 60 |
| Actual emitted fillers | 6 | 11 | 39 | 56 |

Attempts include proposals later discarded with their encounter or excluded at
facility emission. They are not unique live obstacles. Each rejection remains
active; no new reason is silently waived. The lane-quota label here means the
existing physical-event streak cap, not an invented percentage-per-lane limit.
The counts sum exactly to the 777 sprite attempts. Industrial's existing Barrier,
Rock Slab and Signal Cabinet palette is active through Sectors 2, 3 and 4;
Sector 1 correctly has zero fillers.

Findings:

- There is no all-potential-lanes exclusion to loosen. The local checker accepts
  an existential certified route, then `replayWitness` checks the committed
  sequence and pressure history. The main rejection source is legitimate
  clear-event pressure, particularly in late sectors, not missing sprite entries.
- The original palette probes Divider after the first filler type, before other
  types. Reordering all fillers ahead of Divider increased proposals in one
  experiment, but did not improve the complete route enough.
- Raw minimum lane delta does not capture physical settling, intermediate-body
  clearance, risk/reward exits, current pressure history or future side spans.
  Certification correctly rejected compact proposals that could not satisfy
  those constraints. Shortening source spacing also changes subsequent seeded
  selection/contact placement, so local reductions are not a whole-route
  collision-occupancy guarantee.
- The request's arithmetic estimate is insufficient: 12-16 bodies at 0.3-0.6 s
  each gives 3.6-9.6 s before overlap, not 15-20 s. In the restored route, 56
  fillers actually improve collision-empty time by only 9.594752 s. The required
  remaining improvements are 19.044373 s overall and 18.223224 s late.
- Production starts at 250 px/s and uses the existing curve capped at 600 px/s,
  not a new 320/380/410 speed table. Experiments normalized against those actual
  values and preserved the entire reaction-distance component.

Two focused corrections, exact same required command each time:

```powershell
node --test --test-name-pattern='all16 actual|secondary fillers|live selection pressures|seed 153|sector challenge identity|guardrail collision|roadside intrusion' tests\clearRowRule.test.js tests\trackGenerator.test.js tests\hazards.test.js
```

| Run | Pass | Fail | Duration | Overall empty | Late empty | Fillers |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Correction 1: candidate seam/palette/pinch opportunities | 6 | 1 | 218.842 s | 185.938109 s | 151.812642 s | 68 |
| Correction 2: candidate seam/internal static turns, pinch exclusions restored | 6 | 1 | 44.312 s | 189.388005 s | 153.828954 s | 49 |
| Restore verification, no further correction | 6 | 1 | 44.718 s | 182.886866 s | 147.072475 s | 56 |

Both corrections preserved all 16 actual-route physical certificates/pressure
checks, urgent-lane relief, scenery/roadside checks and fresh seed 153 Overdrive
entry. Seed 1 Normal through 2,600 m completed without fallback exhaustion.
The second experiment committed only 18 compact gaps, including ten seams,
in the density route; that was not sufficient to offset changed route coverage.

Experiment files touched were [trackGenerator.js](src/game/core/trackGenerator.js)
and [clearRowRule.test.js](tests/clearRowRule.test.js). Both experiments, including
their dedicated compaction assertions, were reverted. Existing launch/proof/tail
fixes from the prior task remain. There is no new spacing helper or palette-order
change, no challenge-data scale, no extra filler slot/count and no test weakening.
The final command below verifies the restored files:

```powershell
node --check src\game\core\trackGenerator.js
node --check src\game\data\challengeProfiles.js
node --check tests\clearRowRule.test.js
```

Syntax: **3 PASS / 0 FAIL**. No full tests, build, 10,000-encounter gate, browser
gameplay/save mutation or later slice was run.

**STOP: Slice 1 remains BLOCKED after two corrections in this scope.**
Required 7 PASS / 0 FAIL is not achieved. Slices 2-6 and human V1-V4 are PENDING.
Next recommended bounded scope: integrate physical occupied-window coverage into
Alpha/Beta candidate selection before acceptance, jointly with committed pressure
history and safe transition spacing. Reuse current physical-event projection and
validator; retain the exact density thresholds and one-filler/two-slot rules.
Do not run another blind gap-scale or filler-count experiment.

### Independent active-run truck / collectible sizing and Large core color

Owner requested active-run truck sprites +5%, collectibles another -5% with
unchanged drop-shadow size, and orange instead of blue in the Large cargo core.
This presentation-only task does not continue or unblock Slice 1.

Files changed:

- [balance.js](src/game/data/balance.js): cosmetic `RUN_TRUCK_VISUAL_SCALE = 1.05`;
  `COLLECTIBLE_VISUAL_SCALE = 0.95 * 0.95`. This is an additional 5% reduction
  from the previously reduced artwork, not a reset to its old size.
- [RoutePrototypeScene.js](src/game/scenes/RoutePrototypeScene.js): active ship
  base-scale multiplier applies to Standard/Swift/all finishes; existing roll,
  exhaust/contact-shadow attachments follow it. No menu preview scale change.
- [industrial.js](src/game/rendering/industrial.js): one-time cached Large pickup
  cyan-to-orange pixel recolor; neutral casing, transparent/shadow pixels and
  supplied source PNG stay unchanged. No Blueprint or other pickup recoloring.
- [rendering.test.js](tests/rendering.test.js) and
  [sceneLifecycle.test.js](tests/sceneLifecycle.test.js): exact current-scale,
  noncompounding update, preserved glow/offset and suspension assertions; known
  orange/neutral/alpha pixel regression and Large-only texture-bake check.
  Original source-byte assertions remain intact. Four canonical docs updated.

Commands:

```powershell
node --test --test-name-pattern='sprite selection|finish selection|scene preloads|blueprint spawn|spawning preserves shared|scene cargo pickup|all road collectible|large cargo center|approved blueprint|blueprint spin|road cargo pickups|Dusk and Night cargo|menu preview|art scales|diesel exhaust|truck contact shadow|cargo trailers|roll.*|suspension' tests\rendering.test.js tests\sceneLifecycle.test.js
node --check src\game\data\balance.js
node --check src\game\rendering\industrial.js
node --check src\game\scenes\RoutePrototypeScene.js
node --check tests\rendering.test.js
node --check tests\sceneLifecycle.test.js
```

Final focused results: **32 PASS / 0 FAIL**, 0.357 s.
Syntax: **5 PASS / 0 FAIL**. During fixture synchronization, the first focused
run exposed a floating-point grouping mismatch in the new expected collectible
scale; a subsequent broader focused selector exposed the old suspension base
expectation. Both fixtures now assert the approved exact scale; collision
position, roll bounds and glow sizes remain protected. No gameplay fix or
test-contract weakening.

Browser inspection on the existing plain-URL page:

- Standard scale **1.155** (previous 1.1), Swift **1.0626** (previous 1.012);
  collectible body scale **0.99275** (previous 1.045).
- Under-pickup layer scale remains **1.1**, displayed width **70.4 px**;
  existing offset, pulse, night/rejected cues and lifecycle are unchanged.
- Large center browser pixel RGBA **[253, 222, 201, 255]**; screenshot shows a
  distinct orange core beside the unchanged cyan Blueprint. Only cached baked
  artwork is changed, not the supplied raster or art-direction source.
- Temporary live visual objects and the comparison overlay were removed.
  Ephemeral cloned ship state was restored. Current stored-profile SHA-256
  before/after is
  `9c8b35fc682793ccdc683f6ef5945ee8190b9153f9c7baa37e4bc7486309db8c`.
  This is the current user profile, not a restoration of the older task hash.
  Page remains plain-URL menu; no actual run, purchase or storage write performed.

No generator, quota, steering, hitbox, pickup range, economy, save, menu-preview,
sprite-source, dependency or deployment changes. No full suite/build requested
or run for this bounded task. Slice 1 remains **BLOCKED**, Slices 2-6 unchanged,
and human browser/mobile playtesting remains **PENDING**.

### Physical coverage scoring follow-up: retained partial improvement

Owner authorized a new bounded Slice 1 task: score certified Alpha/Beta candidates
by physical coverage before acceptance, not by changing spacing, filler counts
or pressure caps. Both focused corrections pass all-16 route/urgent-lane,
three-rate physical proofs, fresh seed 153 Overdrive entry, scenery and roadside
checks. Density remains the sole mandatory failure. **Do not mark Slice 1 done
or advance to Slice 2.**

Retained files:

- [trackGenerator.js](src/game/core/trackGenerator.js):
  `chunkCollisionSpan` measures the first-to-last occupied row delta plus one,
  excluding nonemitted rows and including Beta-only rows. A single occupied row
  is one; separated first/third rows span three. Current two-row pinch templates
  are not artificially relabeled three-row structures or padded with blank rows.
  `chunkCollisionCoverage` reuses `projectPhysicalEvents` bodies and authoritative
  `hazardGeometry` compound footprints, unions their longitudinal expanded
  collision windows, clips selected planning-window/lifetime bounds and measures
  actual route-time seconds. Duplicate/overlapping windows count once.
- `planChunk` gathers only candidates that have passed existing native proofs,
  full committed-witness/pressure replay, recent layout and side/mover filters.
  The existing **eight-proposal budget** is unchanged. Scoring is limited to
  Normal Sectors 3-4 outside recovery/forced mover scheduling; openings,
  Overdrive and obligated witness emission retain their existing selection path.
  One seeded draw uses
  `weight = occupiedSeconds * (1 + 0.4 * occupiedSpan)`.
  Committed future witnesses are included, and useful outgoing seams ahead of
  protected facilities retain preference. All-zero protected facility coverage
  uses a deterministic uniform draw, not fabricated hazard occupancy.
  Selected geometry, pressure and witnesses are committed through existing code.
- [clearRowRule.test.js](tests/clearRowRule.test.js): added zero/single/staggered,
  nonemitted and Beta-only span assertions, union-overlap deduplication and
  cleared-body coverage assertions inside the existing selected density test.
  Exact empty-time thresholds, filler-slot/geometry protections and all existing
  physical checks remain unchanged. All seven selected tests remain present.
- README, the owner plan and four canonical docs now record the retained partial
  state. Latest truck +5%, collectible second -5% and orange Large core edits
  are untouched. No gameplay speed, gap, filler palette/count rule, quota,
  reaction, hitbox, save, economy, asset or menu changes in this task.

Exact mandatory command:

```powershell
node --test --test-name-pattern='all16 actual|secondary fillers|live selection pressures|seed 153|sector challenge identity|guardrail collision|roadside intrusion' tests\clearRowRule.test.js tests\trackGenerator.test.js tests\hazards.test.js
```

| Run | Pass | Fail | Duration | Overall empty | Late empty | Emitted fillers |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Pre-task restored state | 6 | 1 | 44.718 s | 182.886866 s | 147.072475 s | 56 |
| Correction 1: occupied row-span weighting | 6 | 1 | 55.724 s | 181.582074 s | 145.767683 s | 59 |
| Correction 2: physical union-time weighting, retained | 6 | 1 | 71.991 s | 177.059066 s | 141.244675 s | 54 |
| Required | 7 | 0 | n/a | <163.842493 s | <128.849252 s | Not a fixed-count fixture |

The retained result improves overall/late empty time by **5.827801 s**. Remaining
deficits: **13.216572 s overall / 12.395423 s late**. No filler count was tuned:
unchanged seeded composition rules now select a different route with 54 actual
fillers (three kinds/all four lanes), rather than preserving an incidental count
of 56 from the prior route. Removing those fillers yields 186.264760 s empty
time. Physical helper assertions run before the unchanged density failure.

Before the final correction, read-only session diagnostics evaluated actual
coverage within the certified cohort:

- Union-time fraction weighting: 183.061994 s / 147.247603 s.
- Greedy highest-local-coverage ratio: 177.500213 s / 141.685822 s.
- Absolute occupied-time weighting: 177.059066 s / 141.244675 s, then verified by
  the mandatory gate as the retained correction.

These bounded diagnostics are **not** an exhaustive global feasibility proof,
nor permission for a seed-specific rule or another blind multiplier. They show
that row span alone is too coarse and that the measured local scoring choices
do not close the full gap within current candidate admission. The gate duration
increases because valid late candidates are gathered before choosing, rather
than accepting the first; no browser runtime/performance acceptance is claimed.
The session-only diagnostic script was removed after evidence capture.

Final additional verification:

```powershell
node --check src\game\core\trackGenerator.js
node --check tests\clearRowRule.test.js
```

Syntax **2 PASS / 0 FAIL**. Focused Normal determinism playback using the existing
`sampleRoute` runs seeds 1 and 153 twice through 3,500 m, compares complete rows
with `assert.deepEqual` and requires all certificates completed with >=6 px
clearance: **2 PASS / 0 FAIL**, 10.162 s. Both pass the former 2,600 m exhaustion
region. Complete-row output SHA-256:

- Seed 1, 112 rows:
  `2f0c64b65ef85821393172552e30446136194f81b50717cf75178978d14b41e5`.
- Seed 153, 113 rows:
  `6b11ec943508fd3f7fe6f37e7f0208bf2bd8fcd849b412a640f36c43f3a2ecab`.

**STOP after two focused corrections in this scope.** Retain the verified
partial improvement, but report the failed 6/1 gate explicitly. Next recommended
bounded task: inspect candidate coverage availability/admission and look-ahead
policy under the existing pressure/quota constraints, rather than another
post-filter score multiplier. No further search/behavior change is implemented.
No full suite/build/10,000-encounter gate, browser run or save write occurred.
Slices 2-6 and V1-V4 human browser/mobile playtesting remain **PENDING**.

### Mode separation execution: Slice A PASS

New owner scope supersedes per-level Overdrive and authorizes a global 680 px/s
ceiling, campaign speed ladders and separate Continuous Run. Clarified rules:
smooth campaign sector-start interpolation; Continuous starts at 350, gains
40 px/s per 1,000 m, unlocks after Level 1; additive passed-Depot +10 points
capped at 100%; current hold value only at cash-out/wreck, wreck keeps 25%.
Existing Overdrive records remain saved historical data. No new levels are
authorized; Level 4 Sector 4's 680 target is future-only.

Slice A: one `MAX_TRACK_SPEED = 680` owner in gameBalance, reexported by cosmetic
balance/economy/generator rather than duplicate definitions. Level 1
320/350/380/410 and Level 2 350/380/410/440 interpolate sector starts, last sector
holds its value. Canonical clock integrates that exact piecewise-linear curve.
Legacy speed access is capped during the remaining migration. Scene scroll
clamps through the same constant. Approved fixtures replace exponential timing.
`node --test --test-name-pattern='speed|ladder|velocity|balance' tests\gameBalance.test.js tests\sectors.test.js`:
**5 PASS / 0 FAIL**, 26.329 s (includes nested guardrail and legacy mover-speed
checks selected by the requested regex). Slice B follows; no full build/tests.

### Mode separation: Slice B PASS; Slice C PASS

B removes per-level Overdrive controls/status and active start availability.
The run-select screen has one separate Continuous entry, locked until Level 1
completion; campaign starts remain Normal/checkpoint only. Confirmation states
the owner-confirmed rules. Old saved Overdrive records are not deleted.
`node --test --test-name-pattern='level select|route init|challenge identity' tests\sectors.test.js tests\sceneLifecycle.test.js`:
**2 PASS / 0 FAIL**, 0.261 s.

C wires the existing clock, sector/challenge selector, generator, Depot schedule,
settlement and scene to `normal` / `continuous`; no parallel engine/save schema.
Continuous uses fixed Level 1 Sector 2 gameplay baseline from zero, initial
350 px/s and +40 each 1,000 m capped at 680. Its visual road is Industrial
Mid-Day independently of Normal Sector 2's Dawn. Clear-event limit is the
baseline Normal three (not inherited retired Overdrive four). Normal campaign
rules and presentation work remain. Passed-Depot bonus is additive and capped
at 100%; passing or docked Pass counts once. Bank & Cash Out is terminal, without
bank-and-continue/repair. Wreck retains floor(25% of remaining cargo Coins),
without Depot/distance/completion/no-damage/Blueprint bonuses or campaign
milestones/record updates. Receipt IDs and failed-write retry preserve cargo,
wallet and non-duplicated settlement; retired Overdrive records are untouched.

`node --test --test-name-pattern='continuous|depot banking|crash retention|wallet' tests\depotEconomy.test.js tests\sceneLifecycle.test.js`:
**15 PASS / 0 FAIL**, 0.279 s. Includes current-hold rounding, bonus cap, docked/
bypass idempotence, zero-distance baseline, exact milestone/clock checks and
cash-out/wreck failed-storage retries, alongside selected Normal/UI regressions.
Next authorized chunk **D: actual-mode generator fixture migration and scoped
physical/density gate**. Earlier density measurements predate the new speed
ladder; they are historical, not current proof. No full suite/build/deployment.

### Mode separation final gate: A-C implemented; D BLOCKED

**Actual-mode migration.** The physical matrix retains 16 distinct cases:
Level 1/2 Normal each at seeds 1/153/1234/98765, through their actual 4,000/5,000 m
finishes; global Continuous at seeds 1/153/1234/98765/31415/2718/42/680, through
12,000 m and the 680 ceiling. First emitted distance reflects the scene's
0.6 s launch delay at each opening speed. No duplicate per-level Continuous
owner/case and no retired Overdrive mode entry. Old speed/density stages,
active unlock helper and unused Depot extension settings were removed;
future visual themes and saved historical records remain intact. Continuous
repair and mid-run banking are also blocked by the existing transaction API,
not only absent from its menu.

**Required D command (both runs):**

```powershell
node --test --test-name-pattern='all16 actual|secondary fillers|live selection pressures|seed 153|sector challenge identity|guardrail collision|roadside intrusion' tests\clearRowRule.test.js tests\trackGenerator.test.js tests\hazards.test.js
```

- First run: **5 PASS / 2 FAIL**, 79.855 s. The unchanged density assertion fails.
  The second failure was the obsolete negative expectation that the old approach
  must fail to settle: at the newly authorized 670 px/s at 8,000 m it settles.
- One focused fixture correction removed that retired failure expectation, not
  safety validation. The committed 0.6 s launch lead-in and settled physical
  state still require >=6 px clearance. Seed 153 now repeats actual Continuous
  rows at 8,000 m (670 px/s) and at 9,000 m (680 ceiling), including all three
  published 30/60/120 Hz completed proofs.
- Final required command: **6 PASS / 1 FAIL**, 65.933 s. All 16 routes, urgent
  lane pressure, Continuous deterministic native fillers, resolved guardrail
  tails, roadside intrusion and seed 153 entry PASS. Density is the sole failure.

| Current seed 153 Normal density diagnostic | Actual | Required | Remaining deficit |
| --- | ---: | ---: | ---: |
| Collision-empty seconds | 169.427236 | <163.842493 | 5.584743 |
| Late collision-empty seconds | 139.503030 | <128.849252 | 10.653778 |

There are 67 emitted fillers (Signal Cabinet/Barrier/Rock Slab, all four lanes);
without fillers empty time is 180.502207 s. Counts changed naturally with the
approved speed/selection route, not filler-count tuning. The existing union
coverage scorer, eight-proposal budget, overlap/pressure/quota checks, reaction
buffer and geometry remain. No unconditional gap scale, waived quota, weaker
proof, seed-specific production hack or raised density threshold was added.
The absolute density diagnostic still samples Normal 9-6,100 m, extending past
the actual 4,000 m campaign finish; its original acceptance contract remains
unchanged pending an explicit compatibility decision, not silently reclassified
as a current playable route.

**Related regression checks after final mode wiring:**

```powershell
node --test --test-name-pattern='speed|ladder|velocity|balance|level select|route init|challenge identity|continuous|depot banking|crash retention|wallet|frame-quantized|starts charged|Depots occur|moving windows align|palette progression|sector lighting|sector themes.*road' tests\gameBalance.test.js tests\sectors.test.js tests\depotEconomy.test.js tests\sceneLifecycle.test.js tests\depots.test.js tests\progression.test.js tests\rendering.test.js
node --test --test-name-pattern='visual theme changes and fallback|all environment blends' tests\rendering.test.js
```

- Combined directly related A/B/C/model/transaction/rendering/lifetime gate:
  **36 PASS / 0 FAIL**, 10.547 s. Continuous lifetime smoke retains the >20,000 m
  requirement: 18,000 actual scene updates, peak 11 live objects, all released
  exactly once; desktop model only, not phone performance. Mixed-rate
  frame-quantized source/continuation world-position checks also PASS.
- Separate visual-boundary/blend checks: **2 PASS / 0 FAIL**, 7.769 s.
- Individual `node --check` executions: **25 PASS / 0 FAIL** across every
  changed production/harness/test JavaScript module. The requested generator,
  scene and balance modules each checked separately; a multi-file single
  `node --check` invocation was not mistaken for checking all files.

**Changed owners/files in this task:** gameBalance/balance/catalog;
economy/sectors/depots/depotEconomy/progression/blueprints/trackGenerator;
RoutePrototypeScene; environments/industrial/roadEnvironment;
route-audit/depot-verification; their nine directly related balance, sector,
clear-row, generator, scene, Depot, progression and rendering test fixtures.
Canonical design/architecture/decision/test docs and this existing handoff ledger
are synchronized. The temporary identifier codemod was removed.

**Browser inspection:** existing Vite page, 320x568 Continuous rules and Depot
menus inspected visually without overflow. A paused, in-memory profile clone
confirmed 0 m / Industrial Sector 2 / Mid-Day / first Depot 1,000 m and the
100% bonus cap (100 cargo -> 200 cash-out preview). No purchase, actual
cash-out/player run or storage write. Current saved-profile SHA256 before/after:
`56e2f7eebc0a3b3abcf31a30e1b24d97585d1abacd3e36330042f8b321c24238`.
Original profile/confirmation screen restored, page returned to 390x844,
temporary inspection state removed. Older saved hashes were not restored.

**STOP at failed D.** No full repository suite/build, 10,000-encounter gate,
deployment or later polish slice ran. Human V1-V4/mobile/playtesting is PENDING.
Next bounded generator task: resolve certified candidate coverage admission/
look-ahead under the current authorized ladder and unchanged safety/pressure
contracts; resolve the beyond-finish diagnostic contract explicitly before any
test-range/threshold change. Do not advance to polish Slice 2 on this 6/1 result.

### Run-menu simplification: PASS (independent UI-only owner task)

Owner requested four home buttons and one final Normal level-selection screen.
Clarification confirmed level title plus two start tabs within each card, and
one short Endless rules screen before starting. Gameplay, progression unlocks,
save schema, pricing, generator and balance remain unchanged.

**Changes:** `RoutePrototypeScene.js` now presents Normal Run / Endless Run /
Garage/Upgrades / How-To. Home preview/actions fit the available menu height;
the overlapping decorative tagline is removed. The final Normal screen renders
each implemented level with Sector 1 and Checkpoint - Sector 3 tabs directly
below its title. Enabled tabs start the existing run immediately, with per-level
checkpoint access and resource/reward handling unchanged. Grey locked tabs have
no interactive handlers. The list reuses grouped scroll clipping, 12 px gaps,
the 10 px drag deadband and a fixed Return to Menu footer.

Levels 3-5 are non-interactive Coming Soon cards, not registered playable levels.
Implemented level IDs drive the list, ready to append future authorized levels;
placeholders skip matching implemented IDs to avoid duplicate entries.
Removed Normal mode, start-selection and rewards confirmation screens and their
result-screen return path. Normal Run Again returns to level cards. Endless
keeps one shorter rules screen, Back returns home, and player-facing HUD/Depot/
result copy consistently says Endless; internal `continuous` mode/rules remain.
Garage, help, developer entry and existing save protection remain.

**Changed files:** scene and its `sceneLifecycle.test.js` fixture; README and
canonical GAME_DESIGN/ARCHITECTURE/DECISIONS/TEST_PLAN plus this handoff ledger.
Removed-screen tests were replaced with direct navigation, card geometry,
per-level gate and result-return assertions, not omitted without replacement.

**Commands/results:**

```powershell
node --test --test-name-pattern='run menu|menu footer|main menu|Sector 2 crossing|checkpoint|scroll|coasting|results cards|instruction.*center' tests\sceneLifecycle.test.js tests\menuLayout.test.js tests\progression.test.js
node --test --test-name-pattern='run menu|menu footer|main menu|Sector 2 crossing|checkpoint|scroll|coasting|results cards|continuous cash-out|continuous crash retention|Depot Shield|centered' tests\sceneLifecycle.test.js tests\menuLayout.test.js tests\progression.test.js
node --check src\game\scenes\RoutePrototypeScene.js
node --check tests\sceneLifecycle.test.js
```

Initial relevant gate **20 PASS / 0 FAIL**, 0.288 s. Final gate including added
result navigation/Endless save-retry/Shield/centered-copy regressions:
**25 PASS / 0 FAIL**, 0.303 s. Both syntax checks PASS.

**Browser inspection:** existing shared Vite page; model and screenshots at
320x568, 360x800, 390x844, 420x844. Level titles, paired tabs and locked copy
remain inside card borders; coming entries scroll above the footer. Short-phone
home/rules fit without text overrun. Real browser pointer events confirmed
Normal home -> level list, Sector 1 -> `beginning/level1/normal`, unlocked
checkpoint -> `checkpoint/level1/normal`, disabled checkpoint -> no request,
and >10 px drag -> scroll without start. Endless home -> one rules screen ->
`beginning/level1/continuous`. These used an in-memory profile clone and start
spy: no actual run, purchase, settlement or storage write.

Current saved-profile SHA256 before/after remains
`56e2f7eebc0a3b3abcf31a30e1b24d97585d1abacd3e36330042f8b321c24238`;
raw save comparison was identical. Original profile/start method restored,
inspection state removed, browser left on the main menu at 390x844.

No production build, full repository suite, 10,000-encounter gate, deployment
or generator changes occurred. Previous mode D/polish Slice 1 density failure
remains BLOCKED; later generator/polish work and human V1-V4 are not passed by
these menu checks. Next authorized generator task remains the recorded bounded
coverage/admission investigation, not automatic Slice 2 advancement.

### Run-menu copy follow-up: PASS

Home label is now **Garage & Upgrades**. Endless overview contains only four
owner-requested details: endless driving with increasing speed; no mid-run
cargo banking; passed-Depot +10% cargo bonus capped at +100%; stopping at a
Depot to cash out and end the run. Starting settings, numerical pacing, wreck
retention and campaign reward details were removed from the overview only.
Actual Depot interaction/settlement, unlocks, balance and save schema are unchanged.
Scene, its directly related lifecycle assertions, README and canonical
GAME_DESIGN/DECISIONS/TEST_PLAN copy are synchronized.

`node --test --test-name-pattern='run menu home|run menu Endless entry|run menu results|menu descriptions stay centered' tests\sceneLifecycle.test.js`:
**4 PASS / 0 FAIL**, 0.269 s. Individual scene/test `node --check`: both PASS.
Browser 320x568 home and overview inspected: new label is single-line within
its button, overview fits without scrolling/overrun. Inspection used an
in-memory profile clone, no run/start click or storage write. Raw save unchanged;
original profile restored, temporary state removed, main menu left at 390x844.
No full suite/build/deployment; the prior generator density blocker remains.

## Renewed commercial polish Slice 1: BLOCKED

The latest owner task renewed Slice 1 with conditional 8-to-16 proposal sampling,
certified multi-row occupancy weighting, and explicit reconciliation of density
to the authoritative Level 1 finish. Six sequential slices are authorized, but
advancement still requires the current slice's mandatory runnable gate to PASS.
No Slice 2-6 implementation occurred.

### Contract and implementation

- Density now measures **0-4,000 m**, including the honest 0.6 s launch lead-in
  (first row at 11.52 m), and **1,000-4,000 m** late-route. The old fixture
  sampled from 9 m to 6,100 m beyond the campaign finish.
- Preserve the owner-approved per-meter burden, not the old absolute limits on
  a shorter window: overall `163.84249332417437 * 4000 / 6100` =
  **107.43770054044221 s**; late
  `128.8492515768585 * 3000 / 5100` = **75.79367739815207 s**.
  Denominators use the owner's nominal 6,100 m window and its 5,100 m late
  portion. The 9 m former sampling offset is not treated as a campaign start.
- The generator now maintains bounded active collision bodies and two scalar
  occupied-time accumulators, using the existing physical projector, compound
  ship-expanded footprints and exact route clock. Removed/expired bodies are
  clipped; overlaps count once; Depot clears discard future occupancy, not
  accumulated history. Rejected candidates cannot contribute density credit.
- Eight proposals remain the default, including recovery, Continuous and
  committed witnesses. A Normal late-sector candidate pool may expand to 16
  only before the campaign finish, outside recovery/forced mover scheduling,
  when observed overall or late empty time exceeds its per-meter target.
  Chunk/stream metadata exposes the applied budget, requesting pacing and
  measured debt. Existing witness/fallback certification remains authoritative.
- The existing base physical score
  `occupiedSeconds * (1 + 0.4 * occupiedSpan)` is multiplied by the requested
  `1 + 0.6 * occupiedSeconds * occupiedSpan`. Complete certified candidate and
  committed witness geometry is scored. Variant aliases with identical full
  geometry, anchors/emission and outgoing seam receive only one pool entry.
  Wholly protected zero-coverage windows retain uniform seeded selection.
- No gap/reaction tuning, idle-padding change, filler-count target, quota waiver,
  pressure relaxation, alternative generator, rendering-driven geometry,
  economy/Depot/menu alteration or save write.

Files changed: `src/game/core/trackGenerator.js`,
`src/game/data/gameBalance.js`, `tests/clearRowRule.test.js`; related maintained
GAME_DESIGN/ARCHITECTURE/TEST_PLAN/DECISIONS and the plan checkpoint synchronized.
No replacement PROJECT_HANDOFF was created: this report is the current handoff.

### Executed checks and results

Each gate used exactly:

```powershell
node --test --test-name-pattern='all16 actual|secondary fillers|live selection pressures|seed 153|sector challenge identity|guardrail collision|roadside intrusion' tests\clearRowRule.test.js tests\trackGenerator.test.js tests\hazards.test.js
```

| Run | Pass / Fail | Duration | Overall / late empty seconds |
| --- | --- | --- | --- |
| Initial historical-fixture reproduction | 6 / 1 | 73.041 s | 169.427236 / 139.503030 (9-6,100 m) |
| First adaptive implementation | 5 / 2 | 100.623 s | Diagnostic 112.566480 / 82.169510 (actual campaign) |
| Focused correction 1 | 6 / 1 | 79.551 s | 106.547449 / 76.150479 |
| Focused correction 2, final retained state | **6 / 1** | **109.307 s** | **108.731435 / 78.334465** |

Read-only `node --input-type=module -` diagnostics using `sampleRoute` and
`layoutMetrics` measured the unmodified actual-campaign baseline:
107.9902211364265 overall / 77.59325077167286 late, with 39 actual fillers.
The separate first-implementation diagnostic traced the new coverage-oracle
assertion and fallback metadata; it did not change source or saves.

Initial new assertions incorrectly checked a valid fallback's final recovery
label rather than its requesting pacing, and compared the audit's one-meter
midpoint clock approximation against exact integration at a 1e-8 s tolerance.
Correction 1 publishes requesting pacing and checks the independent oracle
within 1e-5 s (10 microseconds); mandatory density limits are unchanged. It also
preserves the existing base score instead of replacing it with uniform weights.
Overall density passed then, but late missed by **0.35680172796443 s**.
Correction 2 removed repeated weighting of identical certified variant aliases;
this changed seeded choices and worsened whole-route density. It is not evidence
that enlarging/deduplicating the pool guarantees more physical coverage.

Final tests verify deterministic expanded selection, applied 8/16 budgets and
actual emitted density debt against the independent collision oracle. All 16
configured Normal/Continuous routes retain the three-clear-event limit and
completed 30/60/120 Hz >=6 px proofs; urgent lanes, Continuous native fillers,
guardrail tails, roadside collision and seed 153 entry at 670/680 px/s PASS.
No connected-fallback exhaustion occurred in these runnable cases. The final
selected route has 47 fillers and 31 expanded pools; these are outcomes, not
tuned counts. Density remains the sole failed test.

Executed individually (both before/after focused corrections):

```powershell
node --check src\game\core\trackGenerator.js
node --check src\game\data\gameBalance.js
node --check tests\clearRowRule.test.js
```

All three final syntax checks PASS. Exact logs are outside production in session
`files/commercial-slice1-before.txt`, `commercial-slice1-attempt1.txt`,
`commercial-slice1-correction1.txt`, `commercial-slice1-correction2.txt`.

### Stop gate and next step

Both allowed focused corrections have been used. **STOP**: Slice 1 and the
dependent mode D gate are not complete. Final overall deficit is
**1.29373456767810 s**; late deficit is **2.54078734521461 s**.
No later slice tests, full suite/build, 10,000-encounter gate, browser progress
writes, deployment or player-certification claims.

Recommended next step, requiring renewed bounded scope: trace certified pool
composition/rejected alternatives and occupied seconds per committed route
meter, especially single-row aliases versus true multi-row bodies and their
witnesses. Compare against correction 1's nearer result before selecting another
algorithm. Do not continue blind coefficient/PRNG tuning, shorten safety gaps or
weaken the now-explicit actual-campaign budgets. Next authorized work is resolving
this blocker, not Slice 2. Human mobile/player V1-V4 remains PENDING.

## Certified-pool tracing and witness selection follow-up: BLOCKED

The owner first requested read-only tracing of certified pool composition and
collision coverage per committed route meter, then explicitly authorized a
selection-only repair in `trackGenerator.js` and `clearRowRule.test.js`.
Safety gaps, reaction buffers, quota thresholds and the eight/sixteen proposal
budgets were fixed. Correction 2 alias deduplication was to be removed, restoring
Correction 1's pool context; genuine multi-row bodies with committed future
witnesses were to receive a specific selection preference.

### Trace evidence and implementation

The initial trace instrumented the existing generator in memory, rebasing imports
to local file URLs and driving it with the existing `sampleRoute`. Every returned
row and certificate was deep-equal to the uninstrumented production sample.
The retained pre-task route reproduced 108.731435 / 78.334465 s.
No production source, PRNG calls, save, browser state or test thresholds changed
during this initial diagnosis.

- A nominal three-row `offset_pair` commonly offered just **0.007-0.009 occupied
  seconds per meter**. True long-body assemblies/witnesses offered
  **0.029-0.032 s/m**. First-to-last obstacle row span alone does not distinguish
  independent short collision windows from sustained longitudinal bodies.
- At 1,037.805 m, a three-row body plus two witness rows scored as span five:
  3.973293 occupied seconds over 174.916769 committed meters, **0.022715 s/m**.
  An admitted three-row body provided 3.247833 seconds over 104.711460 meters,
  **0.031017 s/m**, but had much less total-second/span weight. A raw witness-row
  bonus amplified this inefficient extra-route-length preference.
- After physical-span/per-meter normalization, weighted randomness could still
  select poor already-certified alternatives: at 3,314.236 m, `risk_reward`
  offered **0.003882 s/m**, versus admitted `static_chicane` **0.021682 s/m**.

Implemented read-only tracing is an optional fourth factory argument:
`createTrackGenerator(seed, levelId, mode, {traceCandidateSelection})` and the same
diagnostics argument on `createTrackStream`. Callbacks receive detached snapshots;
invalid callbacks throw explicitly. Default gameplay has no callback or retained
trace history. Events report rejected physical/witness/pressure/quota/recent
alternatives, certified pool composition/weights/selection, committed candidates,
and committed future collision credit. Trace samples are outside the project.

`chunkCollisionCoverage` now exposes route meters/seconds, occupied seconds per
meter, actual sustained `structuralSpanRows`, `structuralOccupiedSeconds`, and
`committedWitnessRows`. Structural classification uses the authoritative minimum
multi-row span and active physical bodies, not artwork, family names or three
isolated row aliases. Witness bonus eligibility requires complete references
across the head/future boundary; incomplete/expired bodies earn no witness bonus.
Overlapping footprints remain unioned once.

Alias deduplication was removed as requested. The Correction 1 functional score
is retained but uses actual physical structural span (one for isolated aliases),
normalized by the committed route meters:

```text
span = structuralSpanRows || 1
base = occupiedSeconds * (1 + 0.4 * span)
witnessBonus = completeWitness
  ? 1 + 0.6 * structuralOccupiedSeconds / routeSeconds
  : 1
weight = base * (1 + 0.6 * occupiedSeconds * span) * witnessBonus / routeMeters
```

For behind-target sixteen-proposal pools, the final focused correction selects
only the greatest certified occupied-seconds-per-meter alternatives, using the
seeded witness-weighted draw for ties. Ahead-target eight-proposal pools retain
the weighted draw. Zero-coverage protected windows retain uniform seeded choice.
No new candidate, gap, filler, quota waiver or altered certificate is introduced.

Before a late pool plans, `committedDensity` projects pending chunks and already
bound obligations together with active emitted bodies, unioning future collision
seconds from the observed ledger horizon to the planning horizon. This is a
distinct committed-future view, not a fabricated increase in emitted coverage.
It does not overwrite the observed scalar accumulator or alter Correction 1's
observed-debt eight/sixteen scheduling. Future rows acquire observed credit only
when actually emitted, so the two views cannot double count witnesses. Existing
obligation entry/pressure checks and Depot clearing remain authoritative.

### Actual verification

Every iteration ran exactly:

```powershell
node --test --test-name-pattern='all16 actual|secondary fillers|live selection pressures|seed 153|sector challenge identity|guardrail collision|roadside intrusion' tests\clearRowRule.test.js tests\trackGenerator.test.js tests\hazards.test.js
```

| Run | Pass / Fail | Duration | Overall / late collision-empty seconds |
| --- | --- | --- | --- |
| Initial witness bonus / committed-credit view | 6 / 1 | 81.233 s | 110.360452 / 79.963482 |
| Focused correction 1: physical span / per-meter cost | 6 / 1 | 86.141 s | 107.797869 / 77.400899 |
| Focused correction 2: density-first admitted shortlist, final | **6 / 1** | **92.962 s** | **110.273991 / 79.877021** |

All 16 configured actual routes preserve three-clear-event pressure, completed
30/60/120 Hz >=6 px certificates, urgent-lane coverage and zero connected-fallback
exhaustion. Continuous native fillers, scenery tails/intrusion and seed 153
670/680 px/s entry pass. The density case verifies tracing does not alter any
rows/certificates/RNG even when a callback mutates its detached snapshots;
complete versus isolated/incomplete/expired body classification; witness weights
exceed single-row aliases in admitted mixed pools; exact density-first selection;
and observed/committed union accounting against the independent collision oracle.
All these pre-density assertions pass. Density itself still fails.

The final read-only production trace again matches every untraced row:
**29 actual weighted pools**, all using sixteen proposals; **zero missed local
maximum-density choices**; **21/29 pools have no admitted sustained multi-row
body**, including one wholly protected zero-coverage pool. The sampled route
advertises 32 expanded chunks; some use fallback when no weighted pool is available.
The actual selected route emits 40 fillers; this is an outcome, not a target.

Leading late-route trace rejection counts (proposal/subvariant events, not distinct
physical encounters): side-squeeze pressure 80; static-chicane quota 71;
narrow-corridor pressure 55; risk-reward physical proof 50; side-squeeze quota 35;
static-chicane pressure 35; risk-reward pressure 29. Mandatory filters were not
weakened. Locally strongest admitted coverage does not guarantee a stronger
whole route: its committed trajectory/pressure/quota state and subsequent PRNG
position change which candidates can enter later pools.

Final individual syntax checks PASS:

```powershell
node --check src\game\core\trackGenerator.js
node --check tests\clearRowRule.test.js
```

Runtime files changed only in the two owner-targeted files; balance constants,
spacing, Depot/economy/menu/rendering/save owners are unchanged. Maintained docs
and plan checkpoint reflect actual current state. Session evidence:
`certified-pool-trace.json`, `certified-pool-trace-output.txt`,
`witness-pool-summary.json`, `witness-pool-summary.txt`,
`witness-selection-first.txt`, `witness-selection-correction1.txt`,
`witness-selection-correction2.txt`. Temporary session probe scripts were removed.
No full suite/build, 10,000-encounter gate, later slice, deployment or progress write.

### Exact blocker and next step

Both focused corrections are exhausted; **STOP, not 7/0**.
Final deficits: **2.83629094276242 s overall**, **4.08334372029888 s late**.
This implementation is retained as blocked engineering work, not a completed
Slice 1 or validated gameplay improvement.

Another single-pool weight adjustment has no demonstrated remedy for the
21 pools lacking sustained-body choices. Next recommended bounded authorization:
inspect existing committed-witness lookahead and pressure/quota trajectory
compatibility across successive chunks, to identify whether an earlier certified
choice preserves a denser future admitted pool. Reuse the existing generator and
physical validator, without increasing budgets, weakening filters or adding
seed-specific selection. Compare committed route density across complete
trajectories, not just local scores. Slice 2 remains blocked; human V1-V4 PENDING.

## One-step trajectory selection: Slice 1 gate PASS

The latest owner explicitly authorized one-step successor scoring, keeping the
8/16 proposal budgets, >=6 px physical clearance, pressure/quota filters,
physical structural-span/union/witness-bonus rules and existing fallback/Depot
clearing fixed. Runtime changes are limited to `src/game/core/trackGenerator.js`
and `tests/clearRowRule.test.js`; maintained docs/plan checkpoint are synchronized.
No balance, art, save, economy, menu or Depot policy was changed.

### Root cause and implementation

Local scoring cannot see the candidate's downstream exit, pressure and reserved
quota consequences. Quantitative seed 153 evidence at **1,037.805 m**:

| Candidate | Current physical score | Best valid successor score | Combined score |
| --- | --- | --- | --- |
| Locally strongest `split_gate` | 0.667085266 | 0.017873120 | 0.684958387 |
| Selected `offset_pair` | 0.511871259 | 0.458230761 | 0.970102021 |

The denser immediate gate leaves a much weaker certified next pool. The selected
alternative trades some local coverage for a stronger complete certified
trajectory. At 3,533.023 m, the selected local score is 0.019136142 with a
0.607801683 successor, instead of greedy 0.425927916 with only 0.005896821
downstream. These are measured scores, not seed-specific production rules.

- Extracted the existing physical scorer into `physicalChoice`; its structural
  span, overlap union, per-meter normalization and complete-witness bonus remain
  unchanged. Current physical score is computed once for each certified option.
- For each option in the admitted current pool, clone the complete mutable
  planning context as one graph. Shared references between structure tails and
  pending rows remain shared inside the clone, never with live rows.
- Temporarily apply the candidate using the **same `planChunk` commit path**:
  exact certified exits, pressure history, reserved obstacle/side/mover counts,
  recent layouts/family usage, structure references and outgoing seam. Replay all
  already-bound witnesses via that same path before looking beyond their tail.
  Those witnesses are already in the current score; they are not scored twice as
  a new successor.
- Invoke that same `planChunk` once in provisional-pool mode. It uses the existing
  recipes, native composer, augmentation, recent-layout/quota checks, witness
  replay, mover reservation and 30/60/120 Hz physical proof chain. The sub-pool
  has its existing eight or sixteen proposals, not a larger budget or a parallel
  generator. Probe mode returns the admitted pool without selecting/committing
  another candidate or recursively starting trajectory lookahead.
- `createSeededRandom(...).fork()` clones the current PRNG state. Each candidate
  probe starts from the same fork, accounting for the eventual one-roll selection;
  probes cannot consume live randomness. Provisional future pickup rolls are not
  a promise of the later real sampled pool. The isolated context and random/trace
  references are always restored in `finally`, including error paths.
- The final score is exactly
  **`currentPhysicalScore + max(validSuccessorPhysicalScores, 0)`**.
  A weak/empty valid successor pool contributes only its weak/zero score; no quota
  or pressure failure is replaced with an invented successor. After the committed
  block reaches the actual finish, successor score is zero and no post-finish
  sub-pool is generated.
- Behind-target sixteen-proposal selection now shortlists the greatest combined
  trajectory score, not the local occupied-seconds-per-meter maximum. The seeded
  weighted draw resolves ties; eight-proposal pools retain weighting. Wholly
  protected zero-score windows retain uniform selection. Actual fallback and
  Depot clearing paths are unchanged.

Diagnostics add current/successor/combined scores, successor budget and detached
successor physical certificates/pressure acceptance to the existing read-only
pool trace. No probe rows or histories are committed to live density accounting.
Only the selected current candidate and its existing witnesses bind actual
obligations; live successor generation remains with the original owner.

### Actual verification

Initial mandated gate: **7 PASS / 0 FAIL**, **262.815 s**.
Final exact-gate rerun including the explicit non-greedy regression:
**7 PASS / 0 FAIL**, **258.165 s**, with identical density values.
The exact command is:

```powershell
node --test --test-name-pattern='all16 actual|secondary fillers|live selection pressures|seed 153|sector challenge identity|guardrail collision|roadside intrusion' tests\clearRowRule.test.js tests\trackGenerator.test.js tests\hazards.test.js
```

| Actual-campaign collision-empty seconds | Actual | Required | Headroom |
| --- | --- | --- | --- |
| Overall 0-4,000 m | **106.06371175356158** | <107.43770054044221 | 1.37398878688063 |
| Late 1,000-4,000 m | **75.66674138880792** | <75.79367739815207 | 0.12693600934415 |

All 16 distinct campaign/Continuous cases preserve the three-clear-event limit
and completed 30/60/120 Hz >=6 px connected physical proofs. Urgent lanes,
Continuous native filler determinism, guardrail tails, roadside intrusion and
seed 153 fresh Continuous 670/680 px/s entry pass without connected-fallback
exhaustion. The density test also verifies exact combined-score shape,
eight/sixteen bounded successors (zero budget only at finish), every successor's
physical certificates/pressure acceptance, unchanged physical witness preference,
RNG-fork isolation, detached-trace determinism, and observed/committed union
coverage against the independent collision oracle.

Read-only `node --input-type=module -` diagnostics using the existing stream and
sampler verify every row/certificate remains deep-equal with tracing enabled.
The route has **27 weighted pools**, **113 candidate successor probes** and
**17 pools without current sustained bodies** (formerly 21/29). Five behind-target
choices demonstrably sacrifice local score for stronger certified successors.
A sixth traced lower-local-score draw is an ordinary eight-proposal terminal
weighted choice, not evidence of lookahead advantage. All successor budgets are
8/16, or zero at finish. The route advertises 29 expanded encounters and 44
emitted fillers; these are outcomes, not tuned targets.

After the first pass, an explicit regression assertion was added requiring at
least one behind-target non-greedy choice with a strictly stronger successor.
It passes in the final exact gate and records five such choices. No focused
fix/retest correction or further behavior tuning was needed. Final syntax checks PASS:

```powershell
node --check src\game\core\trackGenerator.js
node --check tests\clearRowRule.test.js
```

Initial/final gate logs and diagnostics remain outside production:
`files/trajectory-selection-first.txt`, `files/trajectory-selection-final.txt`,
`files/trajectory-selection-diagnostics.json`. The diagnostic used an inline
script; no temporary source file was added to the project.

### Scope and next work

The seven-test gate, not a full workstream/release gate, is what passed here.
Provisional lookahead increases bounded planning work; the initial scoped runtime
grew from the previous 92.962 s to 258.165 s (final). Browser/device responsiveness and
human mobile/player acceptance remain **PENDING**, not certified by these models.
No full repository suite/build, 10,000-encounter gate, later slice tests,
deployment, tester progress write or new playable level occurred.
Slice 1 and the corresponding seven-test mode D gate are complete under the
explicitly authorized actual-campaign acceptance contract. Next authorized polish chunk is Slice 2; its gameplay
behavior decisions (close-call bonus stacking and geometry contracts) still need
reconciliation before implementation. No later slice was silently started by
this narrow trajectory-selection task.

## Slice 2 game feel: retained, BLOCKED

### Owner decisions and protected scope

The owner explicitly authorized Slice 2 after the trajectory gate passed, then
resolved the behavior conflicts:

- Increase the existing truck collision width by **10%**, from 24 to 26.4 px;
  keep height 32 px. This supersedes the proposed sprite-relative contraction.
  Geometry remains authored world-space data, independent of artwork.
- Cargo-only horizontal/vertical collection thresholds increase **20%**:
  30/40 px becomes 36/48 px. Blueprint pickup bounds, purchased Magnet attraction
  range, road sprite/shadow sizes and cargo-chain geometry stay unchanged.
- Close calls add ten separate percentage points, capped at +100%, paid only
  against the surviving current hold when banking/cashing out. No wreck payout
  or compounding with Depot/clean-run bonuses. Normal banking resets this bonus.
- The owner separately approved rerunning the exact seven-test Slice 1 gate for
  the wider body **after** the required Slice 2 gate passes. That prerequisite
  did not pass, so generator recertification remains PENDING.

### Retained implementation and files

- `src/game/data/gameBalance.js`: authoritative half-width 13.2 px, cargo-only
  trigger scale and close-call thresholds/reward cap. Existing rectangular
  Barrier/Bollard/Gate bodies now explicitly describe their unchanged physical
  footprints so expanded bounds use the same canonical player width.
- `src/game/core/hazards.js`: derive aggregate horizontal collision extents from
  authored component bodies plus the shared player half-width; live collision
  and physical projection no longer disagree after widening the cab.
- `src/game/core/collision.js`: swept relative-motion clean-pass tracking against
  existing compound geometry, once per instance, 15-25 px minimum surface gap;
  contact/immune overlaps cannot award. Cargo-only pickup predicate.
- `src/game/core/depotEconomy.js`: run-local close-call bonus, transactional bank
  candidate/reset and shared quotes; unchanged Normal crash consolation and
  Endless raw-hold 25% wreck retention. No profile/schema change.
- `src/game/data/balance.js`, `src/game/scenes/RoutePrototypeScene.js`: existing
  cab roll capped at 3.5 degrees, frame-normalized 120 ms cubic return; existing
  movement/collision loop wires the rewards and pickup predicate. Close-call
  text rises 30 px/fades 400 ms. Nonfatal hull/shield shake 100 ms / 0.012;
  fatal feedback preserved. HUD/Depot/results display the hold bonuses.
  Pickup pulse now preserves the approved active-run truck base scale.
- `src/game/rendering/industrial.js`: reuse the bounded grind emitter for
  directional impact sparks; one additional bounded dark-smoke emitter activates
  at positive Hull <= one third and stops off-track/with effect cleanup.
  Rendering never awards currency or chooses collision geometry.
- `tests/collision.test.js`, `tests/rendering.test.js`: selected exact threshold,
  payout/cap/reset/wreck, physical-width, effect/lifetime and actual-scene timing
  regressions. `tests/cargo.test.js`: existing chain protections renamed to be
  selected by the mandated `cargo chain` filter, assertions unchanged.
- `tests/depotEconomy.test.js`: existing exact quote fixtures account for the
  new separate zero-bonus fields. `tests/sceneLifecycle.test.js`: inject the
  actual scene's new imports into its existing VM harness. These suites were
  not independently run; syntax was checked.
- Maintained handoff, four canonical docs and owner plan record these decisions
  and the actual blocked gate. No generator or density-test source was changed.

### Commands and actual results

Exact Slice 2 command, run three times:

```powershell
node --test --test-name-pattern='steering|chassis|collision|nearmiss|cargo chain' tests\rendering.test.js tests\collision.test.js tests\cargo.test.js
```

| Attempt | PASS | FAIL | Duration | Diagnosis/action |
| --- | ---: | ---: | ---: | --- |
| Initial | 3 | 5 | 0.136 s | Close-call config accidentally entered hazard definitions, causing an undefined reward policy and NaN hazard envelope/module-load failure; correction 1 moved it into `physics.collision` |
| Correction 1 | 10 | 2 | 30.147 s | Missing rendering `GAME_BALANCE` import and VM stripper expecting default rather than named scene export; correction 2 fixed both and selected existing cargo/collision protections |
| Correction 2, FINAL | 16 | 1 | 29.962 s | Actual-scene centering assertion receives `-0` instead of literal `0` after leftward easing; STOP at the two-correction bound |

All twelve changed source/test JavaScript files passed individual
`node --check <file>` commands. Earlier eleven-file syntax check also passed;
syntax alone did not detect the initial misplaced policy or missing import.
Logs are outside production in the current session's `files/slice2-first.txt`,
`files/slice2-correction1.txt` and `files/slice2-correction2.txt`.

Passing final coverage includes swept close calls at 30/60/120 Hz, independent
bonus caps, current-hold payouts and failed-save candidate immutability,
Normal/Endless wreck exclusion, exact pickup/body dimensions, bounded directional
sparks and smoke lifecycle, cargo-chain protections, shield/damage/terminal
protections and selected theme/guardrail geometry checks. The combined
actual-scene feedback test stops at cab centering; its subsequent camera/alert
assertions are **not yet executed successfully**.

### Exact blocker and recommended next authorized action

`RoutePrototypeScene.applyTruckRoll` multiplies a negative starting roll by
zero at the end of the cubic return, producing signed `-0`.
`tests/rendering.test.js` requires literal zero with strict equality.
Recommended bounded follow-up: explicitly assign literal `0` when elapsed return
time reaches 0.12 seconds, retaining the exact test and all gameplay thresholds;
rerun the same Slice 2 command. Only after PASS run the separately approved
seven-test wider-body generator recertification. Do not claim that the old
24 x 32 px Slice 1 evidence certifies the new body or advance to Slice 3 meanwhile.

No third correction was made. No full suite/build, 10,000-encounter gate,
later slice, browser/device playtest, save write/reset, push or deployment.
Human acceptance and browser/device responsiveness remain **PENDING**.

## Slice 2 literal-zero fix PASS; wider-body recertification BLOCKED

The owner authorized a bounded follow-up fixing the strict signed-zero failure
in `src/game/scenes/RoutePrototypeScene.js` only. `applyTruckRoll` now assigns
literal `0` when elapsed return time reaches `balance.TRUCK_ROLL_RETURN_SECONDS`;
the cubic formula is unchanged before completion. The 0.12 s return, 3.5-degree
cap, collider, generator and test assertions are unchanged.

### Executed checks

```powershell
node --test --test-name-pattern='steering|chassis|collision|nearmiss|cargo chain' tests\rendering.test.js tests\collision.test.js tests\cargo.test.js
node --check src\game\scenes\RoutePrototypeScene.js
node --test --test-name-pattern='all16 actual|secondary fillers|live selection pressures|seed 153|sector challenge identity|guardrail collision|roadside intrusion' tests\clearRowRule.test.js tests\trackGenerator.test.js tests\hazards.test.js
```

- Exact Slice 2 gate: **17 PASS / 0 FAIL**, **30.315 s**, first attempt.
  Existing strict centering checks pass for both directions at 30/60/120 Hz.
  Previously unreached actual-scene camera/close-call timing assertions now pass.
- Scene syntax check: **PASS**.
- Separately owner-approved wider-body generator gate: **4 PASS / 3 FAIL**,
  **216.213 s**. All 16 route cases/physical-rate/seam proofs, urgent-lane pressure,
  short Continuous fillers and seed 153 entry PASS. No fallback exhaustion
  was reported. This does not mean the complete recertification gate passed.

| Failing selected test | Evidence |
| --- | --- |
| Campaign secondary-filler density | Overall 105.34016097150526 s <107.43770054044221 PASS; late 76.4571660516856 s exceeds <75.79367739815207 by 0.66348865353353 s; failure at `tests/clearRowRule.test.js:567` |
| Guardrail collision boundary | `tests/hazards.test.js:141`: the fixture expects the cab safe at 10 px beyond the visible tip; with the approved half-width 13.2 and existing 2 px inset that point is still within the expanded body |
| Roadside intrusion boundary | `tests/hazards.test.js:298`: safety at the aggregate `spec.hitX` tip fails; exact compound boundary/aggregate projection needs a scoped trace before changing any assertion or geometry |

No changes to density thresholds, geometry, hazard fixtures or generator scoring
were made. The latest request fixes cab roll only; do not treat it as permission
to repair these separate failures or advance Slice 3. Next bounded work should
trace and resolve wider-body boundary/late-density failures under explicit scope,
preserving required clearance, quotas, budgets and test contracts.
Slice 2's own gate is PASS, but advancement remains BLOCKED by recertification.

Source change: only `src/game/scenes/RoutePrototypeScene.js`; related maintained
docs/ledger updated. Logs remain outside production in the current session's
`files/slice2-literal-zero.txt` and `files/slice2-wider-body-generator.txt`.
No full suite/build, 10,000-encounter gate, later slice, browser/player validation,
save write/reset, push or deployment. Human acceptance remains PENDING.

## New testing window: smoke-emitter startup repair

Opened a fresh ordinary `http://localhost:5173/` page at the owner's request.
Real Phaser startup failed with `damageSmoke.emitter.setTint is not a function`;
the rendering double had incorrectly allowed that unsupported emitter method.
`industrial.js` now passes the dark tint into the existing exhaust factory's
particle configuration at creation, preserving normal diesel defaults.
`rendering.test.js` asserts the damage smoke config uses `0x20242a`.
No gameplay geometry, reward, save or generator change.

Focused validation:
`node --test --test-name-pattern='collision impact sparks|pooled diesel emitter' tests\rendering.test.js`
**2 PASS / 0 FAIL**, 0.234 s; `node --check src\game\rendering\industrial.js` PASS.
Reloaded new page and verified the real main menu renders; no subsequent page
error reported. No run was started or saved progress deliberately changed.
This startup inspection is not mobile/playtest acceptance and does not clear
the existing two generator-boundary failures. No full suite/build or later slice.

## Slice 2 width reduction 5%: density PASS, two boundary failures

The owner requested a 5% truck hitbox reduction and the same tests, then
explicitly chose **width only**: 26.4 -> 25.08 px, height stays 32 px.
This is multiplicative against the currently widened body, not subtraction of
five percentage points from the original width. Half-width is now 12.54 px.
Artwork, 120 ms/3.5-degree roll, cargo/Blueprint/Magnet bounds, obstacle bodies,
physical clearance, quotas, proposal budgets and density limits remain unchanged.

### Files and focused correction

- `src/game/data/gameBalance.js`: canonical half-width `12 * 1.1 * 0.95`,
  half-height remains 16. Existing live collision/projection/effect helpers
  consume that single owner.
- `tests/collision.test.js`: exact-width regression follows the approved new
  dimensions, asserts full width 25.08 within machine precision and tests contact
  0.01 px inside/outside the new half-width. No safety or close-call assertions
  were removed or weakened.
- `src/game/core/collision.js`: the new fractional width exposed sequential
  subtraction rounding at the existing exact 15 px close-call threshold:
  actual `14.999999999999998`. One focused correction subtracts the combined
  component/player half-widths once, yielding 15 for the reproduced boundary.
  No tolerance, threshold, timing or collision policy was added.
- Maintained handoff/decisions/design/architecture/test plan/owner plan updated.

### Commands and actual results

```powershell
node --test --test-name-pattern='steering|chassis|collision|nearmiss|cargo chain' tests\rendering.test.js tests\collision.test.js tests\cargo.test.js
node --test --test-name-pattern='all16 actual|secondary fillers|live selection pressures|seed 153|sector challenge identity|guardrail collision|roadside intrusion' tests\clearRowRule.test.js tests\trackGenerator.test.js tests\hazards.test.js
```

| Check | PASS | FAIL | Duration | Outcome |
| --- | ---: | ---: | ---: | --- |
| Initial Slice 2 | 16 | 1 | 20.606 s | Exact 15 px close-call lost to sequential subtraction rounding |
| Slice 2 correction 1, final | 17 | 0 | 20.954 s | Width/height, close-call thresholds at 30/60/120 Hz, roll/effects and existing protections PASS |
| Generator recertification | 5 | 2 | 280.787 s | All 16 route proofs, pressure, both density windows, short Continuous fillers and seed 153 entry PASS; two roadside boundaries FAIL |

All three changed JavaScript files passed individual `node --check` commands.
A read-only inline Node numeric probe verified sequential versus combined
subtraction for 14.9/15/20/25/25.1 px; no scratch source file was created.

- Overall collision-empty time **105.56715104201915 s**, limit
  **<107.43770054044221 s**: PASS.
- Late collision-empty time **75.18938288419635 s**, limit
  **<75.79367739815207 s**: PASS.
- `tests/hazards.test.js:141`: guardrail fixture still expects safety at its
  fixed 10 px beyond-tip boundary; FAIL. New half-width minus existing 2 px inset
  is 10.54 px, so the old fixed offset is still within the expanded body.
- `tests/hazards.test.js:298`: safety at aggregate roadside `spec.hitX` fails;
  exact component-boundary/projection arithmetic still needs scoped diagnosis.
  No claim that this assertion is safe to weaken.

No fallback exhaustion was reported, but the complete seven-test gate is still
BLOCKED. Do not advance Slice 3 or silently shrink the hitbox further. Next
bounded scope should reconcile/repair the two boundary failures while preserving
the confirmed dimensions and test contracts.

Logs outside production: current session `files/slice2-width-minus5.txt`,
`files/slice2-width-minus5-correction1.txt`,
`files/slice2-width-minus5-generator.txt`.
No full suite/build, 10,000-encounter gate, later slice, player/browser validation,
save write/reset, push or deployment. Human acceptance remains PENDING.
