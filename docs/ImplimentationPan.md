# Hazardous Haul: Production Polish Plan and Execution History (Levels 1 & 2)
# Original prompt dated 1 Nov 2026; current status is in the checkpoint below.

This plan preserves its original scope and dated execution notes. Older gate
counts below are historical; the latest status is in the owner checkpoint and
[AUDIT_REPORT](../AUDIT_REPORT.md).

> **Instructions for Coding Agent**: 
> You are polishing and completing Levels 1 & 2 of *Hazardous Haul*, a top-down cargo runner built with Phaser 3 and Vite.
> This prompt is strictly grounded in the **November 1, 2026 Architecture Health Report**:
> - **Original prompt topology, superseded 4 November:** both implemented levels now use four 1,000 m sectors and finish at 4,000 m.
> - **Scene Architecture:** All gameplay, garage tabs, and upgrade menus live in `src/game/scenes/RoutePrototypeScene.js` (assisted by `src/game/core/menuLayout.js` and `src/game/rendering/industrial.js`). Do not invent separate GarageScene files.
> - **Recent Upgrades Already Implemented:** Cargo trailer spring physics/shadows, sprite-only obstacle remapping, 4-preset lighting (Dawn/Mid-Day/Dusk/High Noon), Sweeper amber beacon & 3-lane opening, road cargo value labels removed, 5% collectible visual scale, and mobile menu peek/Y-accumulator padding.
> - **Original gate status:** The 417 PASS / 24 FAIL / 441 total count was the status when this prompt was written; it is not the current result.
> 
> **Execution Guardrails**:
> 1. Execute in the **6 sequential slices** below.
> 2. Run **only each slice's targeted test command** to verify before advancing. 
> 3. Preserve confirmed economy numbers: First Cargo Capacity rank = 150 Coins, Swift Blueprint = 6 Blueprints, Crash Consolation Cap = 50 Coins.

---

## Latest owner execution checkpoint: Slices 1-5 scoped PASS

Slice 6 **CLOSED** (4 November, owner decision): the generator was restored to its known-good state.
Full suite **516/2 of 518**; build **PASS**. The two remaining failures are deferred technical debt for
post-launch maintenance (AUDIT_REPORT):
- the seed 153 late-sector certified fallbacks;
- about 1-2.5% four-row straight-lane windows.

The codebase is ready for Human Testing V1-V4 (PENDING, not yet performed) and CrazyGames SDK
integration (not yet implemented).

Earlier Slice 6 status (3 November, BLOCKED): A3/A4 persistence hardening implemented; initial
save/hint/banking/repair/settlement gate **47/47 PASS**, final whole migration
file **16/0** and lifecycle/progression selectors **38/0**. Failed hints
remain unseen/retryable; startup errors warn visibly; unreadable bytes and
earlier backups are preserved, failed backups/read failures block unsafe
replacement. Real storage round-trip tests cover Level 1 completion, Level 2
access, paid Swift acquisition and all eight implemented equipment items in
six-slot per-truck loadouts. Final production build PASS (4.75 s), no sourcemaps,
worker asset emitted. Full 29-file repository suite **452 PASS / 58 FAIL / 510**,
532.021 s. Remaining fixture/generator/geometry contracts require focused
repair; no blanket stale-failure waiver. The full suite was not rerun after
the focused migration/hint corrections. Tester progress is unchanged;
live warning UI and V1-V4 remain PENDING. Next work remains Slice 6, not release.

Latest jitter/mover follow-up (2 November): route planning moved off the render
thread through the existing stream owner (deterministic Web Worker, prepared
checkpoint streams, Depot reset branch) plus hash-identical validator speedup.
Live spawn max 0.3-1.1 ms (was 44 ms), zero starvation in steady play, Level 2
checkpoint start and docking/resume. Level 2 now generates lateral Forklifts
only; the vertical StreetSweeper is reserved for unimplemented Level 3. Gates:
route stream 5/0, lifecycle/Depot 60/0, generator 7/0; mover/sector failures
all pre-existing (17/11 versus 15/13 prior recipe). Device jitter PENDING; no
full suite/build or Slice 6 advance. Details: AUDIT_REPORT.

Latest strict-pooling follow-up (2 November): **102/0** focused, 1.417 s;
five syntax checks PASS. Route groups are now fully preallocated at scene
load (3,005 Images / 70 Containers / four TileSprites), with canonical
descriptor-derived conservative bounds, get/killAndHide recycling and explicit
errors on exhaustion or active-phase baking. No first-demand growth. Generator
remains Phaser-free; geometry, road/Depot behavior and absent engine unchanged.
Live 120 generated rows across both levels/Endless record zero Sprite/
generateTexture/Group.create/image/container/tile/destroy calls; two clean
restarts preserve budgets. Saved localStorage unchanged, ordinary menu restored.
Broader rendering file **96/2**, 24.562 s: unrelated Barrier art-fit/divider
boundary failures reproduce with new bake guards removed. Not repaired or
reported as PASS; see audit. Human/device jitter remains PENDING. No full
repository suite/build or Slice 6 advance.

Latest owner revision (2 November): **engine noise removed**, high-quality
engine audio deferred. Removed synthesized engine graph, speed hooks and
engine-only ducking; kept impact/brake/UI/cargo/Depot sounds, compression and
haptics. Focused audio/sound/haptic/feedback gate **16/0**, 346.8169 ms;
four syntax checks PASS. No continuous source on unlock/reset/resume; finite
effects and shutdown remain tested. Earlier engine/pitch evidence below is
historical, not authorization to restore it. Slice 6 remains unstarted.

Owner's subsequent audio/road polish is PASS: **93/0**, 1.348 s; initial
narrower check **58/0**, 1.452 s, no corrections, seven syntax checks PASS.
Filtered velocity-driven engine now pitches down through braking/launch to
45 Hz idle, retaining 90 Hz at 320 and 112.5 Hz at 680; stronger impacts/
brakes/confirmed UI clicks duck the quieter engine, with shared compression.
One graph/twelve-voice cap, gesture unlock and cleanup remain. Scattered
all-lane skids are removed; four reserved segments serve only indicated-side
Depot braking zones, entirely before the site. Fine cracks/seams/tiny shoulder
rubble bake into opaque Industrial/Dustlands roads, not collision/decal data.
Live gesture/pitch/gain/voice cap, 200 allocation-free skid cycles, opaque
pixels, canopy arrival and real shutdown PASS. Fresh saved localStorage
unchanged; inspection restored ordinary menu. Human mix/device acceptance
PENDING; no Slice 6/full suite/build performed.

Owner's interim performance/Depot/clarity follow-up is complete at its focused
gate **104/0**, 2.785 s; 14 individual JS syntax checks PASS. Display owners
now pool hazards/attachments/compound guardrails/Depot art, tiled surfaces and
subtle linear decals with Phaser Groups; generator remains Phaser-free.
Roadbeds are fully opaque with full-screen multiply grunge/additive dust.
Fixed 390 x 844 FIT/CENTER_BOTH preserves portrait geometry on desktop.
Owner explicitly selected indicated-side-only entry, now requiring >=50% physical
cab overlap with that approach bay, superseding both-outer-lane entry below.
Existing braking/canopy, banking, HUD and shield timing remain. Real Phaser
warm reuse, opaque pixels, exact entry boundary, desktop input/scaling and
three clean restarts PASS; saved localStorage unchanged. Device/frame-pacing
acceptance remains PENDING. Slice 6 is still not started.

Slice 5 is complete: exact audio/sound/haptic/feedback gate **13/0**, 0.273 s;
four individual JavaScript syntax checks PASS. One fixture-only correction
after initial 11/2 (spark emitter stub and Blueprint eligibility), no weakened
assertions. New `runFeedback.js` uses Phaser's existing AudioContext/master
destination with capture-phase gesture unlock, one engine oscillator, bounded
transient voices/noise, precise cargo/impact/Depot synthesis and browser haptics.
Original owner/global MAX_TRACK_SPEED 680 supersedes stale audio endpoint 600.
Pause/background and shutdown cleanup are covered. Real Phaser interaction,
speed/pitch, pickup/shield, canopy arrival, restart and unchanged saved-profile
smoke PASS; inspection restored ordinary menu. Human listening/mobile haptics
remain PENDING. Next: Slice 6 persistence/full tests/build, not started here.

Slice 4 is complete at its required gate: **12/0**, 217.594 s. Owner selected
distinct lateral Forklift (0.5 s beacon warning) and fixed-lane forward Sweeper
(0.5x track speed) using existing art; both spawn from Level 2 Sector 2.
Level 1 stays static, L1 Sector 2 stays Dawn, all approved themes/speeds and
eligible-interval quotas remain. Related Depot/scene/render/debug-lifetime
checks **65/0**, 2.864 s; 17 individual JS syntax checks PASS. Immediate
checkpoint persistence at the completed canopy stop is covered in both levels.
Real Phaser smoke and stored-profile isolation PASS. No full suite/build was
run at that checkpoint. Human acceptance is PENDING.

Canonical-width fixture reconciliation now passes the exact generator gate
**7/0**, 242.783 s; density **105.567151 / 75.189383 s**. No production
geometry/generator/threshold changes. Earlier 5/2 results below are historical.
Slice 3 is complete at its scoped gate. Latest owner overrides: Normal arrival
recharges without banking; manual Bank & Continue / Bank & End Run are restored.
After Bank & Continue show only disabled Cargo Secured, Resume Run and Repair Hull.
Hide the HUD while stopped, restore on resume. Show indicators only on the
Depot side within 60 m; the latest follow-up restricts entry to that bay.
Latest site correction clips chevrons at the facility and begins braking early
enough to stop under its canopy, with the same 1.5 s deceleration. Gate **50/0**,
2.771 s; real Phaser Level 1/2/Endless stop alignment and save isolation PASS.
Near misses add +5 percentage points, capped +50%; Hull/shield hits reset the
unbanked bonus, but immune overlaps and harmless wall grinding do not.
Follow-up regressions **104/0**, 32.311 s; ten individual JS syntax checks PASS.
Real Phaser smoke confirmed these behaviors with saved localStorage unchanged.
Endless has no mid-run banking, offers
End Run/Skip after stopping, and Skip restores equipped shields. Straight
center bypass never recharges. Preserve existing terminal Endless payout.

Original Slice 3 checks before those overrides: required Depot command **18/0**, 2.715 s; generator
combined rerun **7/0**, 239.560 s; directly related scene/render/collision/
cargo/lifetime **68/0**, 21.753 s; exact Slice 2 regression **17/0**, 21.468 s;
16 individual JS syntax checks PASS. Real Phaser ephemeral-profile smoke
confirmed both flows, 390 x 844 maintenance and unchanged saved profile.
Full suite/build and human/device acceptance remain pending.

Latest owner width-only adjustment: 26.4 -> **25.08 px** (-5%), height stays 32 px.
Slice 2 **17 PASS / 0 FAIL**, 20.954 s after one combined-extents arithmetic
correction; three changed JS syntax checks PASS. Generator **5 PASS / 2 FAIL**,
280.787 s: both density windows and all 16 route proofs PASS; guardrail/roadside
boundaries FAIL. No additional width reduction, roadside geometry/fixture repair,
threshold change or Slice 3. See
[latest handoff](../AUDIT_REPORT.md#slice-2-width-reduction-5-density-pass-two-boundary-failures).

The cab-only completion and 26.4 px geometry checkpoint below is historical.

The authorized cab-only completion fix assigns literal `0` at 120 ms without
changing timing, roll cap or tests. Exact Slice 2 gate **17 PASS / 0 FAIL**,
30.315 s; scene syntax PASS. Separately approved wider-body recertification
**4 PASS / 3 FAIL**, 216.213 s: late density and two roadside boundary checks.
No generator/geometry/test repairs or Slice 3 in this cab-only follow-up.

Owner clarification supersedes the proposed contraction below: cab body width
increases 10% to 26.4 x 32 px, height unchanged and independent of artwork.
Cargo-only collection thresholds increase 20% (36/48 px); Blueprint/Magnet
attraction/artwork/shadows stay unchanged. Close calls add ten separate bonus
points capped +100%, current surviving hold only, non-compounding and never
paid on wreck; Normal bank resets them. The owner approved exact seven-test
wider-body generator recertification after Slice 2 PASS; it ran but has not passed.
Human checks, full suite/build and later slices remain PENDING.
See [current handoff](../AUDIT_REPORT.md#slice-2-literal-zero-fix-pass-wider-body-recertification-blocked).

## Previous owner execution checkpoint: trajectory Slice 1 and mode D gate PASS

The newest six-slice owner task explicitly renewed conditional candidate
selection and density-window reconciliation. The later one-step trajectory task
passes **7 PASS / 0 FAIL**, 258.165 s including the final non-greedy regression. The actual
0-4,000 m campaign / 1,000-4,000 m late window measures
106.063712 / 75.666741 s; proportional limits are unchanged <107.437701 / <75.793677.
The same composer probes one successor pool under cloned pressure/quota/exit
contexts and forked RNGs. 8/16 budgets, physical span/union/witness scoring,
>=6 px proof and pressure/quota rules remain unchanged.
All 16 physical route cases and the explicit non-greedy regression pass.
Slice 1 and the corresponding mode D gate are complete. No Slice 2-6 work,
full tests/build or human acceptance. Details are in
[AUDIT_REPORT](../AUDIT_REPORT.md#one-step-trajectory-selection-slice-1-gate-pass).
The older mode-gate and density figures below remain historical evidence.

The later mode-separation task supersedes this plan's per-level Overdrive and
exponential-speed assumptions. Approved rules and actual A/B/C results are in
[DECISIONS](DECISIONS.md) and [AUDIT_REPORT](../AUDIT_REPORT.md). A speed gate:
5/0, 26.329 s; B menu gate: 2/0, 0.261 s; C Continuous/transaction gate: 15/0,
0.279 s. Final D: **6 PASS / 1 FAIL**, 65.933 s, after actual Normal/Continuous
fixture migration. All 16 distinct physical routes PASS; density remains
169.427236 s overall / 139.503030 s late versus <163.842493 / <128.849252.
Related regression selector 36/0, 10.547 s; visual-boundary checks 2/0, 7.769 s;
25 individual JavaScript syntax checks PASS. No advance to polish Slice 2, broad suites/build or
human acceptance until the mandatory gate passes. Earlier density values below
are historical: speed/mode policy has changed.

## Historical execution checkpoint: Slice 1 BLOCKED

The entire six-slice plan has been reviewed. The latest owner direction is
**browser gaming sites primary, mobile secondary**, superseding mobile-first
wording above. Preserve the current portrait/touch support.

- Slice 1: **BLOCKED**, not complete. Baseline 3 PASS / 3 FAIL; first correction
  6 PASS / 1 FAIL. The committed launch lead-in resolves seed 153 Overdrive entry,
  all configured physical proofs pass, and scenery assertions now compare the
  actual modular body/rendered layout rather than an obsolete nominal tail.
- Current remaining density after retained physical coverage scoring: seed 153
  Normal empty time 177.059066 s, required <163.842493 s; late 141.244675 s,
  required <128.849252 s. This improves the prior 182.886866 s / 147.072475 s
  but does not pass Slice 1.
- The owner explicitly approved extending the second correction to certified
  static gaps. A 0.75 Industrial Normal base-gap scale caused new fallback
  exhaustion: seed 1 at 2645.731465 m; seed 153 at 2615.492652 m.
  That experiment and its dedicated fixture were reverted. Restore verification
  is **6 PASS / 1 FAIL**, 43.994 s, with no further tuning.
- The later owner density-resolution task tested two candidate-aware corrections.
  Both retained all-16 physical/pressure proofs but missed density: 185.938109 s /
  151.812642 s, then 189.388005 s / 153.828954 s. Both were reverted.
  Latest restore verification: **6 PASS / 1 FAIL**, 44.718 s.
  Filler-only tracing counts 517 pressure/streak rejections versus 164 physical
  path rejections; late-sector palette eligibility is already active.
- The subsequent physical-coverage scope tested occupied-row-span weighting,
  then actual ship-expanded collision-window union weighting of already
  certified Alpha/Beta candidates. Final **6 PASS / 1 FAIL**, 71.991 s.
  The partial union-scoring improvement is retained, not certified as complete.
  Spacing, reaction, filler composition, quotas and pressure caps are unchanged.
  Selected seed 153 filler count is now 54, not a tuned target of 56.
- Stop after the two corrections in that scope. Next bounded work should
  investigate coverage availability in the bounded candidate-admission/search
  policy; a larger local score alone has not shown the required improvement.
- Slices 2-6: **PENDING**, not started. Full tests/build have not been rerun.
  Human V1-V4 and chart/release acceptance remain **PENDING**.
- Later behavior conflicts need explicit decisions before their slices:
  near-miss stacking/payouts, auto-docking/banking versus optional Depot service,
  separate Sweeper/Forklift behavior, lighting/speed overrides, five versus six
  sockets and Traction Cleats versus the existing Impact Pulse card.

Commands, exact results and retained-file changes are recorded in the
[persistent audit/handoff](../AUDIT_REPORT.md#physical-coverage-scoring-follow-up-retained-partial-improvement).

## Slice 1: Resolve Physical Generator & Route Blockers (Engineering Gate)

### Objective
Resolve the core generation and collision test blockers to restore a trustworthy, deterministic track generator for Levels 1 & 2.

### Context & Root Causes (from Audit Report)
* **Seed 153 Overdrive Entry Fallback:** At 8,000m synthetic Overdrive entry, the 783 px approach at 760 px/s with 0.8s reaction delay fails to settle. Ensure initial entry state and lead-in distance correctly model committed approach conditions so the half-load witness settles without throwing `No connected fallback`.
* **Multi-Rate Proof Fixture Mismatch:** `tests/clearRowRule.test.js` expects 1 certificate, but the generator now validates across 30, 60, and 120 Hz. Reconcile the test fixture to assert the configured 30/60/120 Hz proof set and clearance rather than expecting a single legacy certificate.
* **Occupied-Time Density Thresholds:** Industrial occupied time currently exceeds old thresholds (188.07s vs 163.84s). Balance secondary filler intervals in `src/game/data/challengeProfiles.js` so road density stays within target thresholds while maintaining continuous safe paths.
* **Scenery Assembly & Trailing Collision:** In `src/game/core/hazards.js` and `industrial.js`, fix the trailing collision on roadside scenery assemblies that trips `hazards.test.js:125`.

### Targeted Verification (Slice 1 Only)
```powershell
node --test --test-name-pattern='all16 actual|secondary fillers|live selection pressures|seed 153|sector challenge identity|guardrail collision|roadside intrusion' tests\clearRowRule.test.js tests\trackGenerator.test.js tests\hazards.test.js
```
*Confirm generator blockers are resolved and zero new generation regressions occur before proceeding.*

---

## Slice 2: Kinesthetic "Game Feel" & High-Velocity Juice

### Objective
Elevate the moment-to-moment driving feel from functional prototype to high-impact arcade hit with physical chassis banking, near-miss adrenaline, and responsive hitboxes.

### Requirements
1. **Chassis Banking (Visual Roll):**
   * In `src/game/scenes/RoutePrototypeScene.js` (within the player vehicle update loop), apply a rotational tilt to the truck cab sprite of $\pm 3.5^\circ$ ($\approx \pm 0.06$ rad) during lateral lane changes.
   * When lateral velocity reaches zero or snaps to a lane center, smoothly tween rotation back to $0^\circ$ over 120ms with ease-out. Ensure the attached trailer chain (`src/game/core/cargo.js`) follows naturally within its existing 8° boundary.
2. **Near-Miss ("Close Call") System:**
   * In `RoutePrototypeScene.js`, calculate distance between the player truck body and passing obstacles during active movement.
   * If the truck passes within $15\text{--}25\text{ px}$ of an obstacle without colliding:
     - Trigger a brief floating arcade text alert (`"+5% CLOSE CALL!"`) that rises 30px and fades out over 400ms.
     - Add 5 separate percentage points to the current unbanked hold bonus, capped at 50%, without compounding other bonuses.
     - Hull-damaging and shield-absorbed collisions reset this bonus to zero. Harmless wall grinding and invulnerable overlaps do not; previously banked Coins stay safe.
3. **Fair Hitbox Margins:**
   * Contract the player truck's physical collision body by $12\text{--}15\%$ relative to its visual sprite boundaries (especially front corners) in `src/game/core/hazards.js` / vehicle config.
   * Expand the cargo pickup collision trigger by $20\%$ relative to visual crate boundaries to create an intuitive suction/magnetic feel.
4. **Collision Impact Juice:**
   * When hull HP or shield takes damage, trigger an immediate 100ms camera impulse: `this.cameras.main.shake(100, 0.012)`.
   * Emit directional metal sparks outward from the collision point.
   * At 1/3 hull HP, activate dark smoke particles trailing the cab.

### Targeted Verification (Slice 2 Only)
```powershell
node --test --test-name-pattern='steering|chassis|collision|nearmiss|cargo chain' tests\rendering.test.js tests\collision.test.js tests\cargo.test.js
```

---

## Slice 3: Tactical Depot Pit Stop & Shield Rework

### Objective
Rebalance the Rechargeable Shield around active Depot pit stops, transforming depot gates from passive thresholds into strategic risk-vs-reward decisions.

### Requirements
1. **Designated Docking Lanes:**
   * In `RoutePrototypeScene.js` and `src/game/rendering/roadEnvironment.js`, only in the final 60m before each depot threshold (500m, 1,000m, 2,000m in Level 1; 500m, 1,500m, 3,000m in Level 2; every 1,000m in Endless), show green docking chevrons only on the Depot side. Upper notice and HUD indicator share this timing and direction. Latest owner override: only that indicated bay docks.
   * If the physical cab has >=50% width intersection with the indicated bay at the interpolated derived braking-line crossing:
     - Smoothly decelerate the truck over 1.5 seconds, ending under the Depot canopy at its actual distance. Clip chevrons to the approach side of the site; center bypass still occurs at the actual gate.
     - Fire an arrival camera flash (`cameras.main.flash(200, 0, 255, 255, 0.4)`).
     - **Normal Bank Cargo:** Leave cargo unbanked on arrival; offer manual Bank & Continue / Bank & End Run (confirmed). Successful Bank & Continue leaves only disabled Cargo Secured, Resume Run and Repair Hull. Failed Bank & Continue keeps the hold and blocks exits/services until retry.
     - **Normal Depot Shield:** Restore equipped Tier 1/2/3 charges on arrival; retain maintenance and the existing unbanked Skip choice before banking.
     - Hide the gameplay HUD while stopped, including banking/repair/confirmation; restore on resume.
     - **Endless override:** No mid-run banking. After stopping, End Run cashes out terminally; Skip restores equipped shield charges and continues with cargo unbanked. Stopping alone never recharges.
     - Resume ramps back to track speed during a 1-second invulnerability boost.
2. **Express Bypass:**
   * Center lanes and the opposite outer lane remain open through the depot threshold.
   * Crossing outside the indicated bay bypasses docking: track speed and cargo multiplier streaks remain intact, but shields do **not** recharge and cargo remains unbanked.
3. **Eliminate Open-Road Shield Regeneration:**
   * In `src/game/core/modules.js` and `RoutePrototypeScene.js`, ensure the Depot Shield never regenerates passively on open asphalt. It is restored exclusively upon completing an active Depot pit stop.
4. **HUD Shield Pips:**
   * Display distinct cyan hexagonal shield pips next to the hull HP meter showing active charges.

### Targeted Verification (Slice 3 Only)
```powershell
node --test --test-name-pattern='depot|shield|docking|banking|facility' tests\depots.test.js tests\depotEconomy.test.js tests\modules.test.js
```

---

## Slice 4: Level 1 & Level 2 Hazard Polish & Pacing

Owner conflict resolution: implement distinct Forklift/Sweeper behaviors using
approved existing artwork; retain L1 Sector 2 Dawn, all approved themes and
speed curves. Normal's existing final settlement remains the finish owner.

### Objective
Ensure Levels 1 and 2 deliver distinct, escalating gameplay curves with polished obstacle behavior and zero unavoidable trap states.

### Requirements
1. **Level 1 (Industrial Yard - 4,000m):**
   * Obstacle Pool: Certified sprite-backed Barriers, Rock Slabs, and Signal Cabinets only. Zero moving hazards.
   * Sector Progression:
     - Sector 1 (0–500m): Generous 4-lane dodging room, dense cargo lines, daylight Dawn lighting.
     - Sector 2 (500–1,000m): Staggered barrier pairs, approved Dawn lighting. Reaching 1,000m depot locks the permanent mid-level checkpoint.
     - Sectors 3 & 4 (1,000–4,000m): Speed steps up (380 to 410 px/s), chicanes and tight lane squeezes leading to the 4,000m finish depot.
2. **Level 2 (Freight Yard - historical 5,000m proposal; current finish 4,000m):**
   * Obstacle Pool: Static obstacles + **Forklift** (moving lateral patrol) + **Sweeper** (slower moving hazard with amber beacon).
   * Mover Spawning & Telegraphing:
     - Forklifts and Sweepers begin spawning in Sector 2.
     - Forklifts wait for a 0.5s beacon warning, then patrol horizontally across 2–3 contiguous available lanes, fitted to static companions and walls.
     - Sweepers occupy a single lane moving at 0.5x speed with their flashing amber beacon.
     - The existing 4–14-body quota and minimum 40m separation apply to eligible Sector 2–4 intervals; static Sector 1 has no movers or mover quota.
     - Ensure movers never spawn in configurations that completely wall off all 4 lanes without a traversable escape path.
     - Sector 4 shifts into Dusk lighting with active truck headlight cones and sodium depot pools.

### Targeted Verification (Slice 4 Only)
```powershell
node --test --test-name-pattern='Level 1|Level 2|moving|sweeper|forklift|chicane' tests\sectors.test.js tests\controlledMovers.test.js tests\hazards.test.js
```

---

## Slice 5: Audio Engine & Haptic Sensory Layer

### Objective
Integrate dynamic audio synthesis / playback and mobile device haptics to deliver rich sensory feedback on every turn, pickup, and collision.

### Requirements
1. **Audio Manager Setup:**
   * Implement or update an `AudioManager` in `src/game/rendering/` or `RoutePrototypeScene.js` with browser interaction-unlock protection.
   * **Engine Throttle Hum:** Looping engine tone whose pitch shifts upwards by $25\%$ as track speed scales from 320 to 680 px/sec (original owner request and authoritative global cap).
   * **Cargo Pickup Streak:** Ascending musical chime (C4 $\rightarrow$ D4 $\rightarrow$ E4 $\rightarrow$ G4 $\rightarrow$ C5) on consecutive crate collections within 2 seconds. The 5th streak plays a celebratory harmony.
   * **Hull Scrape:** Deep metallic crunch with high-frequency debris clatter on barrier impact.
   * **Depot Docking:** Pneumatic airlock steam hiss followed by a clean two-tone electronic chime.
2. **Mobile Haptics Integration (Capacitor Ready):**
   * Hook lightweight haptic vibrations into key gameplay events (with graceful fallback if running in a desktop browser):
     - Lane change snap: 15ms light tick.
     - Cargo pickup: 30ms medium pulse.
     - Barrier crash: 80ms heavy double-pulse.
     - Depot dock: 200ms gentle hum.

### Targeted Verification (Slice 5 Only)
```powershell
node --test --test-name-pattern='audio|sound|haptic|feedback' tests\rendering.test.js tests\sceneLifecycle.test.js
```

---

## Slice 6: Persistence Hardening & Full Engineering Gate

### Objective
Harden save failure edge cases (A3 & A4 from Audit Report), ensure seamless level unlock persistence, and bring the full repository test suite to clean passing status.

### Requirements
1. **Persistence Error Handling (A3 & A4):**
   * In `src/game/scenes/RoutePrototypeScene.js`, ensure `triggerHint` only marks a hint as seen in session memory after persistence succeeds (or rolls back if save fails).
   * In `src/game/core/save.js`, ensure corrupted profile recovery leaves a visible warning and backs up the original string without silent overwrite.
2. **Progression & Unlocks:**
   * Confirm that clearing Level 1 (4,000m) reliably unlocks Level 2 and awards the Swift Runner unlock state in `localStorage`.
   * Verify all 8 upgrade modules (`CargoCapacity`, `PrecisionSteering`, `DepotShield`, `MagneticCollector`, `LightweightRack`, `ReinforcedPlating`, `CargoInsurance`, `TractionCleats`) load, save, and equip cleanly in the 5-socket bay.
   * **Current authority correction:** preserve six slots (Standard starts two,
     Swift three), Cargo Capacity plus the seven current `MODULE_DEFS`, including
     the grandfathered/future-gated Impact Pulse. Do not invent Traction Cleats.
     Level 1 completion unlocks Swift purchase eligibility, not free ownership;
     the existing six-Blueprint price remains in force.
3. **Full Suite Execution:**
   * Run the complete test suite across all 28 test files:
     ```powershell
     npm.cmd test
     ```
   * Ensure that previously recorded fixture drift and generator blockers are resolved.
4. **Production Build:**
   ```powershell
   npm.cmd run build
   ```
   *Verify Vite compiles `dist/` cleanly with `sourcemap: false`.*

---

## Summary Checklist for Coding Agent
- [x] Slice 1: Scoped density/certification gate passed; two remaining route-quality findings are deferred and documented in the audit.
- [x] Slice 2: Chassis banking ($\pm 3.5^\circ$), near-miss alerts (+5%, cap 50%, Hull/shield hit reset), and approved 25.08 x 32 px cab implemented; scoped gates PASS.
- [x] Slice 3: Tactical pit stops, side-only 60m indicators, manual Normal banking/three post-bank controls, hidden stopped HUD and Endless stopped-Skip shield recharge; scoped follow-up PASS, human checks pending.
- [x] Slice 4: Scoped gate passed; latest owner policy is Level 1 static-only / Level 2 Sector 2+ lateral Forklifts only. StreetSweeper reserved for unimplemented Level 3. Human acceptance pending.
- [x] Slice 5: Retained interaction-unlocked finite cargo/impact/Depot/UI sounds, bounded cleanup and browser haptics. Latest owner removed engine noise; do not restore it. Human sound/device acceptance pending.
- [x] Slice 6 **CLOSED** (4 November, owner decision): persistence/upgrade round trips PASS; build PASS. Full suite **516/2 of 518** (1,129 s) on the restored known-good generator. The remaining failures are deferred technical debt for post-launch maintenance: (1) the seed 153 late-sector fallbacks (`clearRowRule:326`, 4 vs 0); (2) four-row straight windows (`longObstacles:15`). The straight-run denial and wider-search attempts were reverted because they regressed the handling, debug-bot, Forklift-pair and density gates. Ready for Human Testing V1-V4 (PENDING) and CrazyGames SDK integration. History: full suite was previously **BLOCKED at 515/3 of 518** (4 November, 1,350 s). Stale/buggy fixtures in 14 test files were reconciled to live code, `GAME_BALANCE`, retired per-level Overdrive and Forklift-only Level 2, with no `src/game` change. Three failures were reported as live findings needing owner decision: (1) seed 153 Level 1 Normal emits 4 certified budget-exhaustion fallbacks (the audit's known seed-153 fallback); (2) RESOLVED by owner decision: early-Depot notice windows now assert <=1 encounter, respecting the 2 s clear approach (focused PASS); (3) 1-2.5% of four-row windows keep a straight lane. Human V1-V4 PENDING.