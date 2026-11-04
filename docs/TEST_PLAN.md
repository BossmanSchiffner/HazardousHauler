# Hazardous Haul - Active Test Plan

Updated 4 November 2026. This is the current testing/acceptance authority.
Live topology is [four equal 1,000 m sectors with 4,000 m finishes](GAME_DESIGN.md#levels-sectors-and-modes).
The hygiene audit did **not** edit test expectations to fit it. The subsequent
explicit owner repair task reconciles approved stale topology/economy/progression
fixtures only; generator safety, pressure and occupancy thresholds remain active.
Exact fresh results, failures, durations and bundle sizes are in
[AUDIT_REPORT](../AUDIT_REPORT.md). Engineering and human acceptance are distinct.
Latest repo-wide status: **516 PASS / 2 FAIL of 518**; production build **PASS**.
The audit report identifies the two deferred route-quality findings.

Latest topology follow-up: both implemented levels now use boundaries 0/1,000/
2,000/3,000/4,000 m. Normal finish clearance removes roadway hazards at 3,990 m
and blocks hazard spawns thereafter; pickups are unchanged. Focused check:

```powershell
node --test --test-name-pattern="approved route boundaries|Level 1 has four data-driven|Level 2 has independent|Normal finish clears hazards" tests\gameBalance.test.js tests\progression.test.js tests\sectors.test.js tests\sceneLifecycle.test.js
```

Worker-starvation fallback verification: `node --test tests\routeStream.test.js`
passes **9/9**, including deterministic fallback rows before the late-row cutoff,
Depot reset replay parity, dead-worker recovery and heartbeat behavior.

## Commands and scope

### Title screen and run music

```powershell
node --test --test-name-pattern="Normal-run music waits|ordinary startup shows" tests\rendering.test.js tests\sceneLifecycle.test.js
```

Browser checks: the Load-In video is the first ordinary screen and keeps its
full 720 x 1280 frame visible at 320 x 568, 390 x 844 and desktop aspect ratios.
The main menu uses the Hazardous Haul logo and contains no separate truck preview.
Confirm touch starts classify as mobile, mouse/key starts as desktop, and no
audio plays before the first gesture. Verify looped music during Normal runs,
no music during Endless, pause muting, and the 0.525 SFX gain. Debug URLs bypass
the title screen but still require interaction to unlock audio.

### Pause and resume

```powershell
node --test --test-name-pattern='touch release pauses|Space pauses|pause End Run confirmation' tests\sceneLifecycle.test.js
```

The focused lifecycle checks cover touch release versus mouse release, Space
pause/resume, key-repeat handling, frozen run distance, HUD/audio suspension,
the full three-second countdown, banked/unbanked confirmation amounts and
mode-specific wreck retention.

### Stale-fixture batch, tiered tracing and retired-mode reconciliation (4 November)

Tests only; no `src/game` change. `scripts/route-audit.mjs` `auditLevel2Routes`
requires movers only from `movingHazards.firstSector` (earlier this slice).

```powershell
node --test tests\chicanes.test.js tests\trackGenerator.test.js
node --test --test-name-pattern="6,000 seeded connections|emitted rows cross sector boundaries" tests\sectors.test.js
node --test --test-name-pattern="^formation" tests\clearRowRule.test.js
npm.cmd test
npm.cmd run build
```

Results:
- `chicanes` + `trackGenerator`: **33/33**; after retired-mode edits `trackGenerator` **31/31**.
- `sectors` 6,000 connections + boundary replay: **2/2** (504 s / 333 s).
- Formation: **5/6** (steering-variety test blocked by seed 153 fallbacks).
- Initial full suite: **515/3 of 518**, 1,350 s. This result was superseded by
  the later **516/2 of 518** run recorded in the audit report. Build: **PASS**.
- Remaining failures (live findings, owner decision): `clearRowRule` steering
  variety (4 seed-153 fallbacks), `density` early-Depot warnings
  (`approachSeconds` 2 x speed ~55-62 m vs `noticeMeters` 60), `longObstacles`
  four-row straight windows (6-15 of 597 per seed).
- Owner decision (later, 4 November): early-Depot notice windows now allow **<=1** distinct
  encounter inside `[depot - 60 m, depot)`, respecting the 2 s clear approach.
  `node --test --test-name-pattern="early Depot notice windows" tests\density.test.js`: **1/1**.
  Notice visibility at exactly 60 m (rendering label + chevrons, sceneLifecycle HUD): **3/3**.
  At this checkpoint the full suite had not been rerun. The later full run and
  current findings are recorded in the audit report.

Details and rationale per file are in the [AUDIT_REPORT](../AUDIT_REPORT.md).
### Migration fix, starvation fallback and hazards revisions (3 November)

```powershell
node --test tests\routeStream.test.js
node --test tests\modules.test.js tests\saveMigration.test.js tests\sceneLifecycle.test.js tests\blueprints.test.js tests\progression.test.js tests\depotEconomy.test.js tests\vehicles.test.js
node --test --test-name-pattern="measured manoeuvring mix|roadside weaves alternate|emitted production routes cross" tests\hazards.test.js
node --test tests\hazards.test.js
```

Results:
- `routeStream`: **7/7**. This includes two new tests: a starved stream
  using the main-thread fallback, and interleaved worker/fallback rows. Both
  equal `replay()`.
- Regression group: **215/1**. The only failure is the stale Garage card
  fixture (fresh Precision "EQUIPPED"), one of the known 58.
- Revised hazards tests: **3/3**.
- Full hazards file: **19/19**.
- Slice 6 gate rerun:
  - `npm.cmd test` gives **474/43 of 517** (was 452/58), so the gate is
    **BLOCKED**.
  - `npm.cmd run build`: **PASS**.
  - The per-file failure list is in the AUDIT_REPORT.

Requirement revisions (#25 measured mix band, #26 authored 4-change weaves,
#27 production playback through `validateTrackSequence`) and their evidence
are recorded in the AUDIT_REPORT.

### Fixture reconciliation with GAME_BALANCE (3 November)

```powershell
node --test tests\depotEconomy.test.js tests\modules.test.js tests\blueprints.test.js tests\progression.test.js
node --test tests\hazards.test.js
```

Results: **48/1** and **16/3**, for **64/4 of 68**; before the change it was
52/12 of 64. The remaining failures are the `migrateV1` Precision regression
in `save.js` and hazards blockers #25, #26 and #27 (sideRail body in the
1,200-row driver). Assertions now derive from `GAME_BALANCE`; spec-guard tests
pin the owner-approved values. Details are in [AUDIT_REPORT](../AUDIT_REPORT.md).

### Slice 6: persistence PASS / full engineering gate BLOCKED (3 November)

Final focused commands:

```powershell
node --test tests\saveMigration.test.js
node --test --test-name-pattern='startup save|hint persistence|persisted hints|save|persist|bank|repair|settlement' tests\sceneLifecycle.test.js tests\progression.test.js tests\vehicles.test.js
```

**16/0 + 38/0**. Covers backup/read failures, preserved prior backups, warning
startup order, failed-hint retry without per-frame storage writes, queued
hints, bank/repair/save-before-commit, completion/unlocks, paid Swift and
eight equipment items in six-slot per-truck loadouts. Four JS syntax checks
PASS. Existing legacy migration fixtures explicitly own equipped gear and
retain the current schema 11 capacity migration.

Actual `npm.cmd test`: **452 PASS / 58 FAIL / 510**, 29 files, 532.021 s.
Do not advance: unrelated fixture drift and unresolved route/art/geometry
assertions still block the required full gate. The integrated route test
stops on identity before collision replay, not a certified route PASS.
Full suite was not rerun after the final focused corrections; do not infer
new aggregate counts. Detailed failed-file inventory and next owner are in
[AUDIT_REPORT](../AUDIT_REPORT.md).

Final `npm.cmd run build`: **PASS**, 4.75 s, one route-worker asset,
no `.map` files or sourceMappingURL references. Existing main-chunk size
warning remains; no speculative bundling/asset changes.

Fault-injection browser reloads timed out; only the real scene's Node
startup-warning path is verified. Actual tester-profile SHA-256 is unchanged;
inspection restored to the ordinary menu with no synthetic storage fixture.
Live recovery UI, phone/device acceptance and V1-V4 remain **PENDING**.

### Off-thread route planning and Forklift-only Level 2: focused PASS (2 November)

```powershell
node --test tests\routeStream.test.js
node --test --test-name-pattern='route|seed|stream|spawn|depot|Depot|docking|checkpoint|level select|shutdown|fresh start|resume|remov' tests\sceneLifecycle.test.js tests\depots.test.js
node --test --test-name-pattern='all16 actual|secondary fillers|live selection pressures|seed 153|sector challenge identity|guardrail collision|roadside intrusion' tests\clearRowRule.test.js tests\trackGenerator.test.js tests\hazards.test.js
node --test tests\controlledMovers.test.js tests\sectors.test.js
```

Results: route stream **5/0**; lifecycle/Depot **60/0**; generator gate **7/0**;
nine `node --check` PASS. Mover/sector files **17/11**; the same files against
an isolated copy with the prior mixed Forklift/Sweeper recipe are **15/13**, and
all 11 current failures appear there (stale `overdrive` mode, 1,500 versus
1,000 m interval fixture, warning-delay offset fixture, outer-filler,
accounting, 6,000-connection and chunk-tail assertions). The new
"Level 2 introduces only lateral Forklifts from Sector 2" contract fails on the
old recipe and passes now. `trackGenerator.test.js` mover selectors fail
identically before/after (test-code `levelId` ReferenceError; Sector 1 window
expecting movers despite the approved Sector 2 start). Not repaired here.
Live evidence is in [AUDIT_REPORT](../AUDIT_REPORT.md). Human/device jitter
acceptance remains PENDING.

### Strict scene-load route pooling: focused PASS (2 November)

```powershell
node --test --test-name-pattern='route visual pool|road|environment|shadow|guardrail|depot|Depot|docking|remov|fresh start|shutdown|audio|haptic|feedback' tests\rendering.test.js tests\sceneLifecycle.test.js tests\depots.test.js
node --test tests\rendering.test.js
```

Focused final **102 PASS / 0 FAIL**, 1417.1638 ms. Five changed JavaScript
files individually syntax-check PASS. New tests require the entire cold
3,005-image / 70-container / four-tile capacity to exist before use, acquire
every slot twice with factories disabled, check explicit exhaustion without
growth or omission, and recycle long compound guardrails/shadows/lights/
cargo/Depots/skids on the very first peak. All owned objects destroy once at
shutdown. Missing pools and active-phase texture/catalog/fallback baking
fail explicitly; generator source remains Phaser-free.

Initial focused check **80/19**, 1341.5255 ms: new bake guard accidentally
nested in the fallback helper. Hoisted the guard: **101/1**, 1400.4733 ms;
the new missing-texture test had deleted a baked-cache entry instead of its
preloaded source. Fixed the fixture to remove the source; final **102/0**.
No gameplay filter, geometry, quota or expectation weakened.

The complete directly affected rendering file is **96 PASS / 2 FAIL**,
24561.8446 ms, not a clean gate. Independent existing failures:
- Whole-art fitting assertion requires the old Barrier width.
- Divider exact-boundary assertion reports a hit at the expected boundary.
Both same assertions reproduce in a two-test in-memory control with this
task's renderer guards removed (0/2, 48.4563 ms). Pool methods are not used
by either test; crop/collision logic and these assertions were not changed.
Do not silently fix unrelated art/hitbox contracts or claim full rendering PASS.

Live Phaser smoke, instrumenting Sprite factories, Graphics.generateTexture,
Group.create, Image/Container/TileSprite factories and pooled destroys:
**120 actual generated rows**, L1 S1/S4, L2 S2/S4 and Endless:
all seven counters **zero**; pool sizes fixed at 3,005 / 70 / 4. Observed
peak image demand 40-46, not the capacity proof. Two real restarts recreate
the exact budgets and release old groups with zero new page errors. Engine
audio remains absent. Fresh saved localStorage hash unchanged; ordinary menu
restored at 390 x 844.

No full repository/generator mega-gate/build, save reset or Slice 6 advance.
Human/device frame-pacing and V1-V4 acceptance remain PENDING.

### Engine noise removal: PASS (2 November)

Owner removed engine noise pending future high-quality audio. No engine
oscillator/filter/gain or driving/docking/launch audio speed hooks remain;
all event sounds, shared compression and haptics are retained.

```powershell
node --test --test-name-pattern='audio|sound|haptic|feedback' tests\rendering.test.js tests\sceneLifecycle.test.js
```

**16 PASS / 0 FAIL**, 346.8169 ms; four changed JavaScript files individually
syntax-check PASS. Regression requires no continuous source on unlock, reset
or resume, only finite event sources, cleanup without an engine graph, no scene
engine hooks, and unchanged impact/brake/click/cargo/Depot behavior. Existing
unlock failure, voice cap, lifecycle, haptic and valid-gesture checks pass.
Live gesture check confirms absent engine graph, nine finite voices across
the five event-sound methods and zero after 1.1 s. Ordinary menu restored,
saved localStorage unchanged.
Prior pitch/ducking checks below describe historical implementations, not
requirements to restore. No full repository suite/build or Slice 6.

### Audio mix and braking-zone road polish: PASS

```powershell
node --test --test-name-pattern='audio|sound|haptic|feedback|road|environment|route visual pool|depot|Depot|docking|tile|button|gesture|fresh start|remov|shutdown|restart' tests\rendering.test.js tests\sceneLifecycle.test.js tests\depots.test.js
```

Final **93 PASS / 0 FAIL**, **1.348 s** (1348.0983 ms). Initial narrower
audio/road/pooling/Depot selection **58/0**, 1.452 s; no correction required.
Seven changed JavaScript files individually syntax-check PASS.
New assertions cover 0/160/200/320/500/600/680/clamped-speed pitch,
velocity-driven filter/gain, impact/brake/click envelope gains, engine ducking
and recovery, output compression, no frame allocations, valid-only button/tile
clicks and once-only air brake versus bypass/repaint. Existing unlock,
voice cap/cleanup, background, geometry, Hull/shield/economy and lifetime
contracts remain active.

Road assertions cover no all-lane emitter, whole skid extents bounded by
core-derived braking start and canopy, both sides in L1/L2/Endless, alpha <0.2
and fixed warmed allocation counts. Branching cracks/worn seams/tiny shoulder
rubble are deterministic baked Industrial/Dustlands detail; opaque roads,
overlay behavior and strict Group reuse remain tested.

Live Phaser inspection with an ephemeral profile:
- Real gesture unlock, rejected button drag = zero clicks, valid tap = one.
- Measured engine approximately 45 / 67.48 / 89.98 / 101.24 / 112.49 Hz at
  0 / 160 / 320 / 500 / 680 px/s; 1,000 speed updates allocate no audio nodes.
- Actual high-speed engine gain 0.04994 -> 0.01287 during impact -> 0.04982
  after recovery. Burst demand caps at twelve voices and returns to zero.
- 200 actual skid visibility cycles keep nine pooled images with zero destroys;
  two visible strips have alpha 0.15 and end at/before the canopy.
- All five checked baked road textures retain alpha 255 at every pixel.
- Actual braking entry fires once, arrival once at exactly 500 m under canopy.
  Real restart disconnects engine/filter/gain/master/compressor once each,
  clears noise/voices, preserves Phaser's running shared context.
- Inspection restored ordinary menu at 390 x 844; fresh saved localStorage
  hash unchanged. Human hearing/mix, physical phone haptics/frame pacing and
  V1-V4 remain PENDING. No full repository suite/build or Slice 6.

### Depot half-body entry threshold: PASS

Latest owner revision lowers the indicated-side canopy entry threshold from
75% to **>=50% of the physical cab width**. The bay geometry, interpolated
braking-line crossing, 1.5 s canopy stop, other-lane bypass and all services
remain unchanged. The earlier 75% results below are historical.

```powershell
node --test --test-name-pattern='depot|Depot|docking|canopy|facility' tests\depots.test.js tests\sceneLifecycle.test.js
```

**29 PASS / 0 FAIL**, 2.631 s (2631.4146 ms), plus three individual JavaScript
syntax checks PASS. Pure and real Phaser Rectangle intersection agree at 50%
and +/-0.001 px for both indicated sides. Actual scene entry at the exact
boundary reaches the canopy; less than half and the opposite outer lane bypass.
No full suite/build or player/device acceptance is implied.

### Performance stability, Depot overlap and visual clarity: PASS

This earlier owner follow-up superseded the two-outer-lane entry assertions.
Only the indicated-side bay docks. Require >=75% canonical cab-width overlap,
including the exact boundary and +/-0.001 px, with actual Phaser Rectangle
intersection and identical pure-simulation results. Opposite outer and center
lanes bypass; interpolated crossing and unchanged 1.5 s canopy stop remain.

```powershell
node --test --test-name-pattern='route visual pool|road|decal|environment|shadow|guardrail|depot|Depot|docking|facility|remov|fresh start|viewport|resize|audio|haptic|feedback|desktop scaling' tests\rendering.test.js tests\sceneLifecycle.test.js tests\depots.test.js tests\menuLayout.test.js tests\onboarding.test.js tests\playerGuidance.test.js
```

Final **104 PASS / 0 FAIL**, **2.785 s** (2784.634 ms), plus fourteen
individual JavaScript syntax checks PASS. Pool tests require reset of stale
texture/frame/flip/tint/alpha/origin/blend, `get`/`killAndHide` reuse, 1,000 image
cycles at constant object count, atomic compound-child release, TileSprite
reuse and no duplicate destruction. The shutdown regression explicitly
destroys Groups before the scene's late cleanup, matching Phaser's real order.
Decal tests assert only linear skid textures, alpha <0.2 and constant warmed
object count; roads assert solid fills/no carving and correct overlay modes.
Boot configuration verifies FIT/CENTER_BOTH and removal of CSS stretch.
Existing cargo/shield/collision, audio, HUD/banking, progress and lifetime
assertions stay active; no generator/model budget/geometry changes.

History: initial 100-test scope **96/4**, 3.768 s; correction **99/1**, 2.693 s
(remaining mismatch was boolean versus destruction counter in the fixture).
Expanded guidance checks **101/2**, 2.725 s exposed old 150 m/retired-copy
fixtures. Reconciled directly related current 60 m/indicated-bay copy checks;
**103/0**, 2.689 s. Real Phaser restart then exposed earlier Group destruction
before late cleanup; fixed idempotence and added the regression above.

Live Phaser smoke:
- 200 actual scene spawn/remove iterations after warm-up: **zero Group creates
  and zero pooled GameObject destroys**, stable 22 images / one container /
  four tiled surfaces, 9.7 ms total for this synthetic repeated row fixture.
  This measures visual reuse, not route generation or end-to-end frame pacing.
- All five baked road textures have alpha 255 at every pixel. Industrial
  full-screen grunge MULTIPLY/0.14; Dustlands dust ADD/0.12. Oil/crack/rut
  textures absent; solid road alpha 1.
- Both indicated sides accept exact 75% and 0.001 px more, reject 0.001 px
  less, independently of sprite scale; actual stops remain 500/1,000 m.
- 1440 x 900 desktop canvas is 415.875 x 900 at x=512, retaining 390 x 844
  logical coordinates. A real mapped click opens Normal level selection.
  320 x 568 phone canvas is 262.453 x 568; 390 x 844 restored to full size.
- Three actual scene restarts release old groups/audio and recreate stable
  counts with no page errors. Ephemeral-profile inspection restores ordinary
  menu; saved localStorage unchanged.

Human/device jitter, touch feel, mix/haptics and V1-V4 remain **PENDING**.
No full repository suite, generator mega-gate, build, deployment or save reset.
Slice 6 remains the next authorized milestone, not completed by this follow-up.

### Slice 5 audio and haptic feedback: PASS

```powershell
node --test --test-name-pattern='audio|sound|haptic|feedback' tests\rendering.test.js tests\sceneLifecycle.test.js
```

Final **13 PASS / 0 FAIL**, **0.273 s**. Initial **11/2**, 0.274 s:
new integration fixtures needed the existing spark emitter method and Blueprint
eligibility milestone. One fixture-only correction; no weakened assertions.
Four changed JavaScript files individually syntax-check PASS.

The exact selector covers mobile gesture unlock, retryable/report-once failure,
no stale playback, shared-context ownership, no engine loop and no per-frame
allocation; five-note pickup, sub-bass crash, rate-limited scrape, Depot whoosh
and two-note arrival timing; 15/30/[30,20,30]/200 ms haptics and
unsupported/blocked APIs; twelve-voice cap, reusable noise, end/disposal cleanup,
pause/hidden/blur gating, listener release and unlock-after-shutdown safety.
Actual scene integration verifies accepted versus rejected/distant/Blueprint
pickups, Hull/shield versus immune/God/grind, real braking speed, single arrival
versus bypass/repaint, and new-run/Depot-steering reset.

Live 390 x 844 Phaser smoke confirms real gesture allocation, shared running
context, actual-speed engine target, 112.5 Hz upper pitch, real pickup/shield
sources, pause zero gains/zero voices and one actual canopy-arrival hiss/chime.
The stopped HUD remains hidden and cargo unbanked; repaint is silent.
Restart releases old voices/noise/listeners without closing Phaser's context.
Ephemeral URL correctly lands in Garage on restart; inspection then restored
ordinary menu. Saved localStorage hash unchanged. Human hearing/mix, physical
phone vibration/permissions and touch/background-resume remain **PENDING**.
Slice 6 persistence/full tests/build is next; no full suite/build was run here.

### Slice 4 distinct movers and preserved level policies: PASS

Owner chose separate lateral Forklift and single-lane forward Sweeper, using
approved existing art, and kept Level 1 Sector 2 Dawn. Level 1 remains static.
Level 2 spawns both only from Sector 2; 4-14 actual mover bodies per eligible
interval and 40 m separation remain mandatory, including the final interval.

```powershell
node --test --test-name-pattern='Level 1|Level 2|moving|sweeper|forklift|chicane' tests\sectors.test.js tests\controlledMovers.test.js tests\hazards.test.js
```

Final **12 PASS / 0 FAIL**, 217.594 s. Baseline **5/3**, 183.550 s exposed
retired Overdrive, old-width and fixed-18m sampling fixtures. First implementation
gate **9/3**, 439.873 s: three fixture contracts needed reconciliation (8-only
proposal cap versus approved Normal 8/16, exact fractional-width arithmetic,
and a Normal-authored 410 px/s mover expected to succeed at unsupported 680).
One focused correction **12/0**, 215.647 s. Final rerun also verifies physical
clearance equality for the forward projection and rejects closed walls even
when their lane hints falsely claim openings. It retains the unsafe 680 fixture
as an explicit rejection, not a bypass or relaxed clearance.

The selected tests assert 0.5 s Forklift warning, actual 0.5 Sweeper relative
scroll, fixed lane, physical collision equivalence, 6 px connected paths at
30/60/120 Hz, original authored full-load registry proofs, current stock
half-load generated certificates, both mirrors and modes' unchanged lighting.
Four seeded Normal routes and each eligible interval start retain quota checks.
The seed 98765 / 1,500-5,000 m case emits eight movers (six paired bodies),
four per interval, both orientations and maximum clear streaks [3,3,3,3].
Fixtures now advance by real committed spacing, not a fabricated 18 m step;
cached route evidence and exact interval endpoints avoid duplicate generation.

Related Depot/scene/render/debug-lifetime checks:

```powershell
node --test --test-name-pattern='depot|Depot|docking|bank|Bank|HUD|forklift|moving|shadow|removing one|five fresh starts|environment layers' tests\depots.test.js tests\depotEconomy.test.js tests\sceneLifecycle.test.js tests\rendering.test.js tests\debugManager.test.js
```

Final **65/0**, 2.864 s; 17 changed JavaScript files individually syntax-check
PASS. Added immediate canopy-arrival checkpoint persistence for both levels,
before any manual bank, including failed-storage state/warning checks. Initial
expanded gate **64/1**, 2.648 s: one shield fixture wrongly equated no banking
with no checkpoint write; it now verifies unchanged wallet/zero banking events
while requiring Normal checkpoint progress and full Endless profile identity.

Real Phaser ephemeral-profile smoke confirms Forklift X stays fixed through
0.5 canonical seconds and then moves; Sweeper X stays fixed and Y advances at
exactly half road scroll. Both use the approved texture and one attached amber
beacon. Canopy stop/HUD/chevron checks remain PASS, saved localStorage unchanged
and inspection page restored to the ordinary menu. No generator mega-gate,
full repository tests/build, deployment or human acceptance. Next slice: 5.

### Depot site cutoff and canopy stop: PASS

The owner requires chevrons to end at the actual site and the cab to stop under
the canopy. Assert every decal segment stays on the approach side of the
world-space site, and that braking begins from the existing smoothstep stopping
distance. Maintenance must open only after the unchanged 1.5 s stop, with cab
and bay Y equal, including both outer lanes and 30/60/120 Hz. Express passes
still count only at the actual gate, never early at the braking line.

```powershell
node --test --test-name-pattern='depot|Depot|docking|bank|Bank|HUD' tests\depots.test.js tests\depotEconomy.test.js tests\sceneLifecycle.test.js tests\rendering.test.js
```

Final **50/0**, 2.771 s. Initial **47/3**: the changed stop location exposed a
VM's old-sector assumption plus two threshold-only fixtures; one focused
correction aligned sector state and fixture expectations. Intermediate **49/0**,
2.853 s; final selector also includes the renamed canopy test. Real Phaser
ephemeral smoke confirms Level 1/2 Normal stop at 500 m and Endless at 1,000 m,
all at cab/canopy Y=684, with hidden HUD/chevrons and unchanged saved profile.
No new braking duration, generator clearance or economy policy.
The later 65/0 gate above also covers checkpoint persistence at the completed
stop, independently of manual banking.

### Latest near-miss and Depot follow-up: PASS

The latest owner overrides replace Normal automatic banking and both-side
150 m indicators. Verify +5 percentage points per clean pass capped +50%;
Hull/shield hit reset (both modes, fatal hits, either same-frame ordering),
immune/grind exclusions, later re-accrual and already-banked Coin safety.
Normal arrival must remain unbanked. Bank & Continue leaves exactly disabled
Cargo Secured, Resume Run and Repair Hull; no Bank & End Run or stale End action.
Before banking, Bank & End Run must still confirm, save transactionally and
retry safely. Hide the HUD during both modes' stops, bank/repair/confirmation,
then restore on resume. Check exact 60 m visibility and correct side for upper
notice, chevrons and HUD alert, without restricting either outer docking lane.

```powershell
node --test --test-name-pattern="nearmiss|collision|chassis|steering|cargo chain|depot|Depot|bank|Bank|shield|HUD|telemetry|facility|risk|repair|wallet transactions|continuous|exhaust|smoke|environment layers|destroy|lifetime|five fresh starts|run menu" tests\collision.test.js tests\depotEconomy.test.js tests\depots.test.js tests\modules.test.js tests\rendering.test.js tests\sceneLifecycle.test.js tests\cargo.test.js
```

Actual result: **104 PASS / 0 FAIL**, 32.311 s, first run; ten changed JavaScript
files individually syntax-checked PASS. Real Phaser ephemeral-profile smoke at
390 x 844 confirms the pre/post-bank controls, hidden/restored HUD, both indicator
sides at 60.01/60/30/0 m, opposite-side outer docking and actual Hull/shield
reset from +50% to zero. Endless still stops unbanked and restores the HUD on
Skip. Saved localStorage is unchanged; inspection page restored to the ordinary
main menu. No generator/clearance/lifetime-owner changes, full suite or build.
Human/device acceptance and Slices 4-6 remain PENDING.

### Run-menu simplification: PASS

Four home actions route Normal directly to level cards, Endless to one rules
screen, Garage & Upgrades to the existing management UI and How-To to help.
Per-level Sector 1/checkpoint tabs are inside the same card; enabled tabs call
the existing start owner directly. Assert independent level/checkpoint gates,
grey disabled controls, non-playable Levels 3-5 Coming Soon and no removed
intermediate screens from either home or result navigation.

```powershell
node --test --test-name-pattern='run menu|menu footer|main menu|Sector 2 crossing|checkpoint|scroll|coasting|results cards|continuous cash-out|continuous crash retention|Depot Shield|centered' tests\sceneLifecycle.test.js tests\menuLayout.test.js tests\progression.test.js
node --check src\game\scenes\RoutePrototypeScene.js
node --check tests\sceneLifecycle.test.js
```

Latest result: **25 PASS / 0 FAIL**, 0.303 s; both syntax checks PASS.
Model layout and browser screenshots checked 320x568, 360x800, 390x844 and
420x844. Browser pointer checks verified direct Sector 1/checkpoint requests,
disabled tabs and drag-without-start behavior; an in-memory clone/start spy
prevented actual runs or writes. Existing save remained byte-for-byte unchanged.
No full suite/build or generator retuning in this UI-only task.

### Current mode-separation checkpoint

Active runtime modes are Normal campaign (two implemented levels) and one
Continuous Run. Retired per-level Overdrive save records remain migration/history
fixtures, not playable modes. A/B/C gates PASS; historical final D was **6 PASS / 1 FAIL**,
65.933 s. Latest trajectory-selection Slice 1 passes **7 PASS / 0 FAIL**,
258.165 s including the final explicit non-greedy regression. The corresponding
seven-test mode D gate is complete under the owner-authorized actual-campaign
contract. Follow the exact current commands,
changed-file list and results in [AUDIT_REPORT](../AUDIT_REPORT.md).
Additional directly related mode/clock/transaction/lighting/lifetime selector:
36 PASS / 0 FAIL, 10.547 s; independent visual-boundary checks 2/0, 7.769 s.
25 individually syntax-checked JavaScript modules PASS. No fresh full suite/build.

The physical matrix keeps 16 unique routes: eight campaign (four seeds per level,
actual finish distances) plus eight global Continuous seeds through 12,000 m
and the 680 ceiling. All completed 30/60/120 Hz >=6 px proofs, 0.8 s reaction,
physical event pressure and three-clear-event baseline limits stay mandatory.
The owner-authorized density fixture now covers Normal 0-4,000 m, including
the true 11.52 m launch emission, and 1,000-4,000 m late-route. Retain the original
per-meter burden: <163.84249332417437 * 4000 / 6100 = **107.437701 s** overall;
<128.8492515768585 * 3000 / 5100 = **75.793677 s** late. Final actual values:
**106.063712 / 75.666741 s**, both passing. Conditional eight/sixteen proposal
budgets, requesting pacing, deterministic seeded output and measured debt are
tested inside the existing selected cases; the independent audit collision oracle
must agree within 10 microseconds (its approximate clock versus exact production
clock). This tolerance is not a density-threshold waiver. Historical synthetic
9-6,100 m measurements remain in the ledger, not the active campaign fixture.
The only slice gate executed was:

```powershell
node --test --test-name-pattern='all16 actual|secondary fillers|live selection pressures|seed 153|sector challenge identity|guardrail collision|roadside intrusion' tests\clearRowRule.test.js tests\trackGenerator.test.js tests\hazards.test.js
```

The selected density case also verifies detached tracing preserves exact emitted
rows/certificates/RNG, complete sustained body witnesses versus isolated/incomplete/
expired aliases, physical witness preference and committed future union credit
against the independent collision oracle. New assertions verify exact current-plus-
maximum-successor weights, 8/16 provisional budgets, all successor 30/60/120 Hz
>=6 px certificates/pressure acceptance, forked-RNG isolation and maximum combined
trajectory score instead of local greedy density. A final regression requires a
non-greedy current choice justified by a strictly stronger certified successor.
Read-only diagnostics reproduce unchanged output and five such behind-target
trade-offs; final selected assertions and both density limits PASS.
Both targeted JavaScript files pass individual syntax checks. No full
suite/build or later slice gate at this checkpoint.
Slice 1 is complete at its scoped gate. No full suite/build,
device responsiveness or human playtesting is implied by this scoped gate.

## Latest Slice 2 gate and wider-body recertification PASS

Owner-authorized fixture reconciliation derives probe offsets from the
canonical half-width and physical footprints, testing 0.1 px inside/outside
both shoulders. The unchanged seven-test command now passes **7/0**, 242.783 s.
Density remains **105.567151 / 75.189383 s**, below unchanged limits.
No production geometry/generator/threshold changes. Slice 3 now passes;
its required gate is:

```powershell
node --test --test-name-pattern="depot|shield|docking|banking|facility" tests\depots.test.js tests\depotEconomy.test.js tests\modules.test.js
```

Original Slice 3 verification (before the manual-banking follow-up above)
tested Normal auto-bank/maintenance and Endless stopped-Skip recharge
separately, including save failure, center bypass, timing and repeated callbacks.
Its final result **18/0**, 2.715 s: includes actual scene threshold
interpolation, both outer lanes, equipped capacity 0-3, 1.5 s docking at
30/60/120 Hz, real scroll/deceleration, 1 s protected launch, failed bank
blocking/retry and idempotent mode-specific stop/Skip accounting.
Combined verification generator rerun **7/0**, 239.560 s with identical density.
Related scene/render/collision/cargo/lifetime **68/0**, 21.753 s; exact Slice 2
game-feel command **17/0**, 21.468 s. Sixteen individual changed-JS syntax
checks PASS. Three old Slice 2 fixtures in sceneLifecycle were reconciled to
actual sparks/ship initialization and the approved 3.5-degree cap, not by
changing production behavior. Browser smoke used an ephemeral URL-debug
profile: Normal bank + maintenance and Endless unbanked Skip/recharge observed,
with stored profile contents unchanged. Not human acceptance.
The updated Endless overview/direct-run navigation check also passes **5/0**,
0.265 s (`node --test --test-name-pattern="run menu" tests\sceneLifecycle.test.js`).
No full suite/build or human acceptance yet. Earlier failed gates below are history.

Historical owner width-only reduction (superseded by the completed Slice 2 gate):
26.4 -> **25.08 px**, height stays 32 px.
Same Slice 2 command: initial **16/1**, 20.606 s (exact 15 px close-call rounding);
combined-extents subtraction correction **17/0**, 20.954 s. Required limits and
assertions retained; the exact-width regression reflects the approved dimension
and contact 0.01 px inside/outside it. Three changed JavaScript syntax checks PASS.
Same seven-test generator command: **5/2**, 280.787 s. All 16 route proofs,
pressure, Continuous fillers, seed 153 entry and both density windows PASS.
Overall **105.567151 s <107.437701**, late **75.189383 s <75.793677**.
Guardrail boundary (`hazards.test.js:141`) and roadside boundary (`:298`) failed
at this checkpoint; the later passing recertification is summarized above.
See the [audit report](../AUDIT_REPORT.md) for the full chronology.

The following narrower-scope cab fix and 26.4 px gate results are historical.

The required command was run initially and after both permitted focused
corrections:

```powershell
node --test --test-name-pattern='steering|chassis|collision|nearmiss|cargo chain' tests\rendering.test.js tests\collision.test.js tests\cargo.test.js
```

Historical initial **3/5**, 0.136 s; correction 1 **10/2**, 30.147 s;
correction 2 **16/1**, 29.962 s stopped at strict signed-zero cab centering.
The later explicitly authorized application-only completion fix passes
**17/0**, 30.315 s on its first attempt. Existing strict centering and subsequent
actual-scene camera/alert assertions now pass, without test changes.
Scene syntax PASS; historical twelve-file syntax checks also passed.

The owner approved a separate rerun of the existing seven-test Slice 1 gate
after Slice 2 PASS because its new 26.4 x 32 px collider invalidates the old
narrower-body certification. That gate ran: **4/3**, 216.213 s.
All 16 route proofs, pressure, short Continuous fillers and seed 153 entry PASS;
late density 76.457166 s exceeds <75.793677 s by 0.663489 s; guardrail and roadside
boundary assertions also FAIL. Overall density 105.340161 s <107.437701 PASS.
No separate failure repairs or Slice 3; broader gates remain blocked.
No full repository suite/build, 10,000-encounter gate or human/device acceptance.
Next bounded work needs scope for wider-body boundary and density diagnosis,
without weakening requirements.
See [commands, files and evidence](../AUDIT_REPORT.md#slice-2-literal-zero-fix-pass-wider-body-recertification-blocked).

From the project folder in PowerShell:

Latest independent menu-centering task:
`node --test --test-name-pattern='Garage|menu descriptions|upgrade tiles|popup stat rows|menu button|menu tiles|button drags|run menu|scroll|coasting|currency presentation' tests\sceneLifecycle.test.js tests\menuLayout.test.js`
initial 36 PASS / 3 FAIL (0.343 s), focused fixture correction 38 PASS / 1 FAIL
(0.354 s). All centered-text, spacing, columns, scrolling/gesture/currency and
save-preservation checks PASS. The remaining unmodified equipment-state fixture
expects `EQUIPPED` for fresh `hand_precision`, while the untouched core reports
unowned/unequipped and the UI says `50 COINS`; not repaired by presentation work.
Scene/test syntax PASS. Real Phaser inspections of seven menu screens at
320 x 568, 390 x 844 and 1858 x 984 report centered text and unchanged in-memory
profile. No purchase/run/save write or player-acceptance claim.

```powershell
npm.cmd test
npm.cmd run build
node --check src\game\core\trackGenerator.js
```

`npm test` uses the existing Node runner and every `tests/*.test.js` file.
Use `node --test` with the smallest relevant files/name selectors during a
bounded task; do not add a new test framework or routinely reinstall packages.
`node --check` verifies syntax, not module resolution; the Vite build validates
the browser module graph and assets.

Useful targeted examples:

```powershell
node --test tests\collision.test.js tests\cargo.test.js tests\steering.test.js
node --test tests\modules.test.js tests\vehicles.test.js tests\progression.test.js tests\saveMigration.test.js
node --test tests\debugManager.test.js tests\developerRuns.test.js tests\sceneLifecycle.test.js
node --test tests\rendering.test.js tests\menuLayout.test.js tests\sceneLifecycle.test.js
node --test tests\depots.test.js tests\depotEconomy.test.js
node --test --test-name-pattern="debug|URL debug" tests\debugManager.test.js tests\sceneLifecycle.test.js
```

Run complete workstream suites at their gate. The T6 track gate includes >=10,000
pure encounter candidates, connected intervals, both levels/modes, seams, quotas,
retry diagnostics and mobile follow-up; a small reproducibility sample is not that
gate. Full repository tests/build belong to F3/release candidates or an explicit
request such as this before/after hygiene audit. Failing gates stay blocked.
Documentation-only maintenance needs link checks, not a full baseline every time.

### Historical four-step repair gate

- Step 1 fixture-only reconciliation: nine named non-generator suites **79 PASS /
  0 FAIL**; focused topology/Garage selectors **3 PASS / 0 FAIL**.
- Step 2 A1 extraction: **6 PASS / 0 FAIL**, bounded seeded output hash unchanged.
- Step 3 second/final focused gate: **1 PASS / 3 FAIL**, 40.980 s. The urgent-lane
  check covers all 16 production-route cases and passes. The other failures are
  the stale one-certificate assertion versus three configured sample rates, unmet
  absolute filler empty-time, and uncertifiable fresh seed 153 Overdrive entry at
  8,000 m. Do not infer clearance/tail acceptance from the urgent-lane pass.
- Retained asset/boundary/quota/frozen-input regressions: **9 PASS / 0 FAIL**.
  Existing spawn/lifetime checks: **5 PASS / 0 FAIL**; same-seed chunk
  reproducibility: **1 PASS / 0 FAIL**. Syntax checks and production build pass;
  broader generator/release gates remain blocked. No third correction, full
  repository suite or 10,000-encounter run.
- Step 4 is not started. Existing implemented-level MILESTONES already includes
  the requested Level 2 ids; async hint persistence and corrupt-read recovery
  remain open. Resume only with a newly bounded blocker-resolution scope.

### Historical six-slice polish gate (superseded)

This checkpoint records the earlier blocked state and is retained for test
history. Slices 1-3 later passed their scoped gates and Slice 6 was closed by
owner decision; consult the [audit report](../AUDIT_REPORT.md) for current status.
The [owner's full plan](ImplimentationPan.md) preserves the execution history.

```powershell
node --test --test-name-pattern='all16 actual|secondary fillers|live selection pressures|seed 153|sector challenge identity|guardrail collision|roadside intrusion' tests\clearRowRule.test.js tests\trackGenerator.test.js tests\hazards.test.js
```

| Slice 1 run | Pass | Fail | Duration | Outcome |
| --- | ---: | ---: | ---: | --- |
| Before renewed corrections | 3 | 3 | 37.919 s | Entry/proof/density blockers |
| First correction | 6 | 1 | 43.938 s | Entry/proofs/pressure/tails pass; density fails |
| Second correction, approved static-gap tuning | 5 | 3 | 4.067 s | New Normal fallback exhaustion; reverted |
| Restore verification, no new tuning | 6 | 1 | 43.994 s | First-correction state restored; density remains blocked |
| New candidate-aware scope: seams/palette/pinch opportunities | 6 | 1 | 218.842 s | Density 185.938109 s / late 151.812642 s; reverted |
| New scope correction 2: seams/internal static transitions | 6 | 1 | 44.312 s | Density 189.388005 s / late 153.828954 s; reverted |
| Latest restore verification, no further tuning | 6 | 1 | 44.718 s | Original 182.886866 s / 147.072475 s restored |
| New physical-coverage scope: occupied-span weighting | 6 | 1 | 55.724 s | Empty 181.582074 s / late 145.767683 s |
| Physical collision-window union weighting, retained partial | 6 | 1 | 71.991 s | Empty 177.059066 s / late 141.244675 s; still blocked |

Current seed 153 Normal empty time is **177.059066 s**, required
**<163.842493 s**; late empty time is **141.244675 s**, required
**<128.849252 s**. There are 54 emitted fillers spanning three kinds/all four
lanes. Thresholds, one-filler/0.55-slot protection, recovery/opening exclusions,
quota policy and 30/60/120 Hz >=6 px proofs were not weakened.
The scenery assertion uses the resolved modular body and renderer layout:
the old nominal tail point was inside the actual visible assembly. No
production geometry was shortened to accommodate that obsolete expectation.
The renewed candidate-aware scope also stopped after two corrections. Both
passed the all-16 safety/pressure checks but missed density and were reverted,
including experiment-only assertions. The latest restored seven-test selector
is **6 PASS / 1 FAIL**, not the required 7 PASS / 0 FAIL.
Seed 1 Normal through 2,600 m and seed 153 fresh Overdrive at 8,000 m complete.
Restored generator/challenge/density-test syntax checks: **3 PASS / 0 FAIL**.
Filler-only diagnostics establish pressure/streak rejection as the largest
constraint, not missing late-sector palettes or overly wide Depot clearing.
The newer retained scorer gathers only certified, quota-filtered candidates
within the existing eight-proposal budget in Normal Sectors 3-4, excluding
recovery and forced-mover scheduling. It weights actual union collision time
and occupied span, including committed future witnesses. Neither fixture limits
nor spawn spacing were changed. Added density-test assertions exercise zero,
single and staggered spans, Beta-only bodies, overlap deduplication and removed
body coverage before the remaining density failure.
Seeds 1 and 153 Normal are separately reproduced twice through 3,500 m with
identical complete output and >=6 px proofs: **2 PASS / 0 FAIL**, 10.162 s.
Retained generator/density-test syntax: **2 PASS / 0 FAIL**.
This does not override the mandatory **6 PASS / 1 FAIL** gate.
See the [physical coverage checkpoint](../AUDIT_REPORT.md#physical-coverage-scoring-follow-up-retained-partial-improvement)
and [earlier rejection table](../AUDIT_REPORT.md#candidate-aware-density-resolution-follow-up).
At this historical checkpoint, Slices 2-6 and human V1-V4 were pending; later
slice status is recorded in the audit report.
The historical 417 PASS / 24 FAIL full run is not a result for these edits.

## Active regression matrix

Task-specific results below are checkpoint evidence, not the current repo-wide
gate. See the audit report for the latest full-suite and build results.

Latest independent run-art sizing/color task: **32 PASS / 0 FAIL**, 0.357 s,
across focused rendering/scene selectors. Five edited JavaScript syntax checks
PASS. Exact assertions cover Standard/Swift/all trims +5%, the second collectible
5% reduction without compounding, unchanged under-pickup scale/offset, orange
Large core with preserved neutral/alpha pixels, original source bytes, preview
sizing, suspension/collision position and attachment cleanup.
Browser texture/scale inspection confirms the orange core versus blue Blueprint
and unchanged 70.4 px glow; temporary objects/overlay removed and current saved
profile unchanged. No full suite/build or generator gate rerun for this UI-only
task; the density blocker above is not advanced.

| Area | Existing files | Mandatory behavior / coverage |
| --- | --- | --- |
| Configuration/sector ownership | gameBalance, sectors | Frozen single configuration, independent challenge/visual metadata, Normal finish/checkpoint, global Continuous baseline/unlock/milestones and single 680 cap |
| Generation/connected safety | trackGenerator, clearRowRule, chicanes, density | Seed reproducibility, native registry/seam access, finite retries, Alpha/Beta/continuation pressure, >=6 px physical clearance; baseline and diagnostic builds at 30/60/120 Hz |
| Side walls/lifetime | hazards, longObstacles, sceneLifecycle | One continuous body, full-tail removal, actual flank/lip discrimination, no trailer collision, correct mirrored tiles and stagger |
| Moving hazards | controlledMovers, hazards, sectors | Half-open 4-14-body banking quotas, canonical motion, paired/central/tagged pattern rules; no art-derived collider |
| Cargo/collection | cargo, magnet, blueprints | Value/mass/slots, replacement, hit loss, eligibility, separate seeded Blueprint budget, reward deduplication |
| Steering/collision | steering, collision, sceneLifecycle | Continuous loaded steering, keyboard braking, Shield-before-Hull, immunity, fatal contacts and harmless grinds |
| Depot/economy | depots, depotEconomy, economy | Actual facility entry/protection, Normal banking/pass/repair, Continuous terminal cash-out/capped bonus/current-hold wreck retention, protected wallet and receipt idempotence |
| Equipment/vehicles | modules, vehicles | Purchased versus equipped, shared ranks/per-ship states, slots/gates, Cargo/reinforcement, Standard/Swift/colors and future placeholders |
| Saves/progression | saveMigration, progression, blueprints | Fresh and schemas 1-11, legacy Radar/Shield, independent level/checkpoint/sector evidence, unsupported-save backup, write-failure handling |
| Presentation/resources | rendering, sceneLifecycle | Assets/source bytes, layer/tint/light falloff, shadows/hitches, object/attachment cleanup, guarded texture creation and bounded active populations |
| Menus/HUD/input | menuLayout, sceneLifecycle, onboarding, playerGuidance | Six sockets/cards, transaction/error/cancel flows, tab cleanup, clipping/coasting/drag, footer/safe areas and guidance |
| Internal inspection | debugManager, developerRuns, sceneLifecycle | Strict opt-in flags, exact warps, ephemeral saves, real God feedback, predictive nonteleport bot and shared fast clock |

All 28 existing test files remain active and were not edited by this audit.
Tests are not deleted because they fail. Historical failures may reflect
both obsolete fixtures and real defects: classify before fixing. Do not suppress
assertions, excuse quota/certification failures or call a partial suite a full pass.

The subsequent cargo/sprite task intentionally updates presentation/palette
expectations: retired procedural textures must be absent, replacements must
resolve to approved pixels, and cargo shadows use y + 2 px / alpha 0.5. Geometry
assertions still cover all definitions, including both compound footprints and
the existing standard Barrier's rectangular collision path. Scene fixtures
declare cached texture keys rather than omitting the new cache dependency.
No clearance, quota, reaction-time or route-variety assertion is relaxed.

Additional cargo/sprite acceptance:

- Dusk/Night cargo art and its embedded shadow stay slightly dimmed but readable
  above the road mask (230/255 tint, 90% glow), with no accumulating dimming.
  Dawn/Mid-Day/Overdrive and 35% rejected-pickup cues restore exactly.
  Normal and sandbox road cargo must create no coin/value/load annotation;
  verify identical art/glow state and retained collection/accounting.
  Assert 0.95 body scaling for every cargo size, Blueprint and converted reward,
  unchanged under-pickup layer size/offset, no accumulated scaling during
  updates, and unchanged collision/collection ranges.
- Forklift construction beacons reuse Barrier double-flash timing, follow both
  motion axes, brighten in Dusk/Night, and are destroyed with their obstacle.
- Seeded live forklift intercepts span three contiguous free lanes or two when
  static companions/walls restrict the opening. Prove both are selected,
  deterministic, nonoverlapping and fully certified at 30/60/120 Hz; retain
  quota, pair, following-opening and conservative untagged-layout regressions.

- Hard sweeps at 250/600 px/s and 30/60/120 Hz: all four trailer offsets <=18 px,
  absolute and cab-relative rotation <=8 degrees, fixed hitch lengths, bounded
  history, matched shadows and no movement of the cab by the cosmetic helper.
- Every environment pool and both candidate registries must resolve exclusively
  to supplied sprite keys; baked hazard canvases contain raster draws, not
  geometric obstacle painting. Original authored rows/bodies remain 126/252.
- Missing obstacle/guardrail cache entries must warn once and recover using
  actual standard Barrier pixels, without changing gameplay geometry. Missing
  the fallback asset itself must fail explicitly.
- Sample all eight implemented sectors in an ephemeral browser session; inspect
  texture validity, shadows and absence of unexpected loading warnings. This is
  coverage/visual evidence, not full-route fairness or phone certification.

Simulation commands remain `npm.cmd run sim:route`, `npm.cmd run sim:balance`
and standalone `node scripts\depot-verification.mjs`. These generate diagnostic
data; balance bots are optimistic proxies, not human clear-rate/affordability
proof. No extra broad simulation gate was run merely to remove dead exports.

## Internal URL inspection

Use the existing dev server:

- Full protected inspection:
  `http://localhost:5173/?god=true&bot=true&fast=true&level=2&sector=1`
- Manual protected Dusk:
  `http://localhost:5173/?god=true&level=2&sector=4`
- Temporary Garage:
  `http://localhost:5173/?unlockAll=true`
- Unprotected bot:
  `http://localhost:5173/?bot=true`

Flags accept exact true/false only. Warp requires both integer parameters;
implemented Levels 1/2 and Sectors 1-4 only. Run flags auto-start;
unlockAll alone opens Upgrades with 99,999 temporary Coins, Standard/Swift,
six sockets and owned current modules. Future trucks remain Coming Soon.
All active URL sessions use an in-memory profile; remove the query and reload
to return to the actual save. Never use debug to claim genuine progression.

Owner-approved fast mode is **3.5x**, not 2x. The prior desktop timing run used
the then-current 5,000 m Level 2 route; it is historical and not a duration
baseline for the current 4,000 m topology. It remains prior desktop evidence,
not a new audit mobile test.

Fifteen debug contracts passed in the previous focused verification. The
stubbed returning-mover seed 3118819693 reaches the full finish without God,
but the **actual bot-only browser replay crashed at 4,540.81 m** after reaching
all sectors. Reliable bot-only browser full clearance is blocked after two
focused corrections. Do not silently enable God or alter colliders to mask it.

## Browser and resource smoke

Use a fresh read-only storage snapshot before testing. Do not purchase from a
real tester profile or reset it without consent. Prefer temporary URL sessions.
Restore the ordinary Main Menu/debug OFF after fixtures.

- Desktop and 320 px-wide layouts: HUD columns/shield pips, Garage sockets/cards,
  viewed-truck identity, clipping, tab switching and safe-area footer.
  Garage clarity checks also cover 390 x 844 and 430 x 932 portrait viewports:
  all eight matching detail/confirmation sprites, Reinforced Cargo Hold's shared
  Cargo Capacity art, title/wallet separation, card text padding, exact bonuses,
  unchanged buy/equip/save behavior and long color requirements. Check scaled
  standalone sprite visibility and scrolling to the final Gold card on Standard.
  Use cloned in-memory profiles for owned/future/max-rank inspection, never
  purchase into the tester's real save.
- Mobile peek/header regressions also cover 320 x 568, 360 x 800, 390 x 844
  and 420 x 844. At top scroll require 30-40% of card three/next grid row above
  the existing fixed footer, with 12 px gaps. Measure the subsection header's
  real bottom to the socket bay top: 24 px. A scaled/taller subsection header
  must translate sockets, unlock button and grid by its displayed-height delta.
  Titles use `(0, 0)` origin at the card's actual top plus 16 px, with >=12 px
  side padding after wrapping/scaling and no label overlap or overrun.
  Check current/fresh/max-slot states, the final card at bottom scroll,
  destroyed old containers after tab changes, and drag cancellation over a
  Preview button. Preserve the 10 px deadband and 44 px mobile control height.
  Newest focused UI verification: 31 PASS / 0 FAIL; see the report for requested
  full-suite and production build outcomes. At that checkpoint, the requested broad run returned
  417 PASS / 24 FAIL / 441 total, with no sceneLifecycle/menuLayout failures;
  final header follow-up focused checks and build pass. Generator/gameplay
  contract blockers stay separate; no full-repository PASS is claimed.
- Real collisions: shield charges consumed before Hull; wall grinds leave Hull.
  Normal dock arrival refills but banks only by manual choice; Endless stopped
  Skip refills without banking. Only the indicated bay at >=50% physical cab
  overlap docks; opposite outer/center bypass never recharge.
- Cross all sector boundaries: solid road, 0.7x scrolling full-screen multiply
  grunge/additive dust, subtle linear skids, smooth lighting, cones/streetlights/
  strobes and 1.8 s peripheral transition cue without obscuring lane centers.
  Assert Level 1 Dawn/Dawn/Mid-Day/Mid-Day and Level 2 Dawn/Mid-Day/Mid-Day/Dusk;
  only Level 2 Sector 4 activates headlight/night-strobe mode. Keep the Night
  preset renderable for future levels but absent from current normal runs.
- Restart and repeated menu/Depot/result transitions: stable listener/texture/
  object counts and no storage changes from read-only inspection.
- Shutdown/resume, offscreen hazard/collectible/Depot pooled release, safe
  reacquisition/reset and final teardown, and long Endless boundedness.
  Desktop samples alone do not prove phone performance.

## V1-V4 human gate: PENDING

Record anonymous tester/device category, seed/mode/loadout, observed actions,
confusion/fairness examples, voluntary replay and smallest recommended fix.
Use a consenting small qualitative group; do not claim retention statistics.

1. **V1 - Uncoached comprehension and ergonomics.** Observe first 30 seconds,
   steering/cargo/hazard readability, weight feedback, Depot expectation versus
   the actual implemented Bank/Skip/repair behavior, results and safe areas.
   No guide-based one-bank/voucher expectation unless that feature is genuinely
   implemented before testing.
2. **V2 - Variety and builds.** Three different seeds per level plus a repeat;
   record actual gap/reversal/mover/cargo/Depot decisions. Compare empty/full,
   Standard/Swift and legitimate equipped Handling builds on matched seeds.
3. **V3 - Motivation and return.** Observe readable mistakes, affordable next
   goals and voluntary retry; invite a voluntary return after a few days without
   nags/streak pressure. Do not coach a replay then label it spontaneous.
4. **V4 - Release recommendation.** Physical touch input, suspension, sustained
   frame/memory performance, storage/reload, critical fairness and no repeated
   confusion; record device, duration and actual results.

Engineering blockers must pass before final sign-off. At F3 engineering PASS,
prepare this human checklist and stop for actual observation. Until V1-V4 pass,
do not call the game validated, phone-ready, release-ready or Level 3-ready.
