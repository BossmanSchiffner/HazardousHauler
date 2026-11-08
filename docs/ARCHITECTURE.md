# Hazardous Haul - Current Architecture

Updated 4 November 2026. This is the single maintained ownership/setup/asset
document. Rules live in [GAME_DESIGN](GAME_DESIGN.md); overrides and pending work
in [DECISIONS](DECISIONS.md); checks in [TEST_PLAN](TEST_PLAN.md).
The latest engineering evidence and defects are in [AUDIT_REPORT](../AUDIT_REPORT.md).

## Stack and directory layout

JavaScript ES modules, Node built-in tests, Phaser **3.90.0 pinned**, Vite 7.
No backend, account system, telemetry SDK, native Android wrapper or additional
lint framework. This workspace is not Git-tracked; do not initialize/restore it
without an explicit task.

```text
src/
  main.js                  Phaser configuration and boot
  styles.css               Page, portrait fit and safe-area styling
  game/
    assets/sprites/         31 referenced production PNGs
    core/                   Deterministic rules and persistence boundary
    data/                   Catalogs, balance, route/theme configuration
    rendering/              Cached textures, visual factories and environment FX
    scenes/                 RoutePrototypeScene: gameplay and every menu
tests/                      28 active Node test files
scripts/                    Route/balance simulation and Depot verification
docs/                       Four maintained design/architecture/test/decision docs
```

Root README is setup navigation; AGENTS is a short instruction entry point;
AUDIT_REPORT is evidence, not a second balance authority. `dist` is generated
production output, `node_modules` installed dependencies, and `package-lock.json`
the dependency lock. Neither is a dead source tree.

## Ownership map

Active runtime modes are `normal` and global `continuous`, not per-level
Overdrive. MAX_TRACK_SPEED is exported once by gameBalance and reexported to
balance/economy/generator; scene scrolling clamps through the same constant.
Economy integrates the exact interpolated campaign/stepped Continuous clock.
Continuous selects the fixed L1S2 challenge independently from its Mid-Day
visual policy. The existing generator, validator, Depot scheduler and terminal
receipt transaction serve both modes. Continuous adds no save schema/record:
old Overdrive fields remain preserved history, with no new run updates.

Player-facing naming is now **Endless Run** while the internal mode remains
`continuous`. `RoutePrototypeScene.showMenu` owns the four home actions;
`showLevelSelect` renders the final scrollable Normal level cards from implemented
level IDs and launches the existing `startRun` directly for either start tab.
The old `showModeSelect`, `showNormalStartSelect` and `showNormalRunConfirm`
screens are removed, including result-screen return paths. Coming Soon cards
are UI-only, without start handlers or changes to the level registry. Each card
uses the existing grouped scroll bounds and button handler, preserving clipping,
the 10 px drag deadband and fixed navigation. No new scene/save/generator owner.

| Owner | Responsibility / boundary |
| --- | --- |
| [gameBalance.js](../src/game/data/gameBalance.js) | Sole live balance/geometry/progression/price configuration; frozen derived route fields |
| [challengeProfiles.js](../src/game/data/challengeProfiles.js) | Immutable structural hazard, filler and Beta families selected by route/sector challengeProfileId; no visual imports |
| [catalog.js](../src/game/data/catalog.js), [sectors.js](../src/game/core/sectors.js) | Implemented sector identities; full design catalog is not a playable feature inventory |
| [trackGenerator.js](../src/game/core/trackGenerator.js) | One seeded stream, shared Normal sweep baseline, local mover crossing/recovery courses, quotas, continuations and certification requests |
| [trackValidation.js](../src/game/core/trackValidation.js), [steering.js](../src/game/core/steering.js) | Shared connected physical movement/clearance; no renderer or DOM dependencies |
| [hazards.js](../src/game/core/hazards.js) | Physical footprints, guardrail contact/lifetime, canonical mover positions and pressure accounting |
| [cargo.js](../src/game/core/cargo.js), [magnet.js](../src/game/core/magnet.js) | Cargo accounting/replacement, cosmetic bounded trail math, attraction |
| [collision.js](../src/game/core/collision.js) | Shield-before-Hull numerical damage decision |
| [depots.js](../src/game/core/depots.js) | Facility schedule, outer-lane threshold entry, integrated dock/launch motion and half-open mover intervals |
| [depotEconomy.js](../src/game/core/depotEconomy.js), [economy.js](../src/game/core/economy.js) | Quotes, repair, banking, terminal receipts/rewards and shared pace/stat helpers |
| [modules.js](../src/game/core/modules.js), [vehicles.js](../src/game/core/vehicles.js) | Shared ranks, per-ship equipment/slots/colors, derived stats, pure shop transactions |
| [progression.js](../src/game/core/progression.js), [blueprints.js](../src/game/core/blueprints.js) | Per-level sector gates and deterministic reward eligibility/deduplication |
| [save.js](../src/game/core/save.js) | Profile normalization, migrations, storage load/save and unreadable backup |
| [DebugManager.js](../src/game/core/DebugManager.js), [developerRuns.js](../src/game/core/developerRuns.js) | Explicit URL inspection, in-memory profiles, steering predictions and nonrewarding run marker |
| [RoutePrototypeScene.js](../src/game/scenes/RoutePrototypeScene.js) | Run snapshot/phase, input, spawn/update/removal, persistence commit and all menus/HUD |
| [industrial.js](../src/game/rendering/industrial.js), [roadEnvironment.js](../src/game/rendering/roadEnvironment.js) | Visual assets, pooled effects, ambient/headlight/light-pool rendering |
| [runFeedback.js](../src/game/rendering/runFeedback.js) | Cosmetic synthesis/haptics, gesture unlock and bounded audio-node/listener lifecycle; reuses Phaser's AudioContext/master destination, no gameplay or persistence writes |
| [routeVisualPool.js](../src/game/rendering/routeVisualPool.js) | Scene-owned Phaser Groups for route images, compound containers and tiled surfaces; reset/get/release only, never generates route descriptors or changes geometry |
| [environments.js](../src/game/data/environments.js), [balance.js](../src/game/data/balance.js) | Theme lookup and cosmetic lighting/suspension tunables; not currency/physics owners |
| [onboarding.js](../src/game/core/onboarding.js), [playerGuidance.js](../src/game/core/playerGuidance.js), [menuLayout.js](../src/game/core/menuLayout.js) | Contextual copy and pure responsive/scroll layout rules |

There is **no separate GarageScene, DepotScene, parallel generator or reward
service**. Do not create one to repair a small menu problem. No source import
cycle or core-to-renderer/scene/Phaser import was found during this audit.
The large scene/generator/renderer remain maintainability risks, not authorization
to refactor them during a dead-code sweep.

### Audio and device feedback

The scene creates one `RunFeedback` per `create`, before building the world.
The scene creates one `RunFeedback` per `create`, before building the world.
Capture-phase canvas pointerdown/document keydown unlock even when menu controls
stop Phaser propagation. The `GameLogo.svg` and `BG_Music.mp3` are bundled from
`art-direction`; ordinary startup opens the Main Menu without a load-in screen.
No new AudioContext, SDK or dependency.

Background music uses a separate 0.35 gain and loops only during Normal runs.
The shared SFX gain is 0.525, 50% above its previous 0.35 level. Neither plays
before the first real gesture; music follows audio suspension and stops at run end.
Engine noise is removed by the 2 November owner revision; high-quality engine
audio is deferred. There is no engine oscillator/filter/gain, speed-update
hook or engine ducking. Unlock creates only the shared effects output
gain/compressor and reusable noise buffer, with no continuous source.
Transient voices remain capped at twelve and disconnect on end/eviction.
Web Audio one-shot sources cannot be restarted/recycled; the shared output/
noise and bounded transient lifecycle remain the single owner.

Scene hooks deliver accepted crate pickup chimes, actual Hull/shield crashes,
rate-limited wall scrapes, continuous-steering lane crossings, once-only braking
entry and completed Depot whoosh/chime. Shared button/tile handlers play a short click after a confirmed
action, so new-run resets cannot immediately cancel it. Dragged, canceled,
foreign-pointer, clipped and repeated releases remain silent. Rendering a
Depot panel or center bypass never triggers brake/arrival sound/haptics.
Driving, docking and launch have no engine loop. The pickup chime does not alter
gameplay state. Noise uses the one scene-load buffer; every sound remains within
the 12-voice cap and is released on end, eviction, pause or shutdown.
No feedback callback alters RNG, collision, economy, saves or equipped stats.

Manual pause and independent scene-pause/sleep/blur/hidden reasons mute the owner, cancel transient
voices and stop vibration; all reasons must clear before resuming. Shutdown
removes owned DOM/scene/game listeners and disconnects nodes without closing
Phaser's context or modifying other sound owners. Unlock errors and denied
haptics warn once and remain nonfatal; unsupported APIs are optional-capability
fallbacks. Delayed unlock promises cannot recreate a destroyed graph.

`RoutePrototypeScene` pauses on Space or touch release during active driving.
The translucent overlay leaves the frozen run visible. Resume shows a lighter
three-second countdown over the road; simulation and run distance remain stopped
until it completes. This transient pause does not persist run state.

New roadside guardrail containers ease in visually over 220 ms at spawn. Their
world position, certified collision body and route timing are unchanged.

### Off-thread route planning (2 November)

`trackGenerator.createTrackStream` remains the single route owner, but the
scene no longer plans rows on the render thread. `routeStream.js`
(`createRouteStream`) wraps it:

- `routeStreamPlanner.js` records a deterministic call log (`nextRow`,
  `resetAfterDepot`) and derives the scene's `{nextDepotDistance,
  protectedUntilDistance}` context for planned rows (`initialRouteContext`,
  `advanceRouteContext`, `depotExitContext`).
- `routeStreamWorker.js` runs that planner in a module Web Worker
  (`init`/`apply`/`produce`/`allow`), yielding between rows.
- `BackgroundRouteStream` keeps a producer 48 rows ahead
  (`ROUTE_STREAM_AHEAD_ROWS`). A lazily created follower mirrors consumed
  calls; `prepareDepotReset` during docking braking lets the follower plan the
  reset branch, promoted on `resetAfterDepot`. A mismatched reset replays the
  log (`rebuild`). When no worker row arrives for 250 ms, the stream replays its
  consumed call log into the same synchronous generator and supplies the next
  certified row. Worker rows resume seamlessly at the same deterministic index.
  This precedes the scene's 500 ms late-row cutoff, preventing worker stalls from
  silently turning obstacle rows into clear road. Placement stays exact by
  `plannedDistance`; fallback counts remain available in stream diagnostics.
- `warmRouteStreamWorkers()` pre-spawns workers in `create`; the level select
  prepares checkpoint streams (`prepareRunStream`/`takeRunStream`), and
  `predictRouteDistance` integrates run/launch motion to the first row distance.
- Without `Worker` (Node tests) `createRouteStream` returns the synchronous
  stream, so tests exercise the identical generator output.

`trackValidation.js` hoists per-hazard clearance invariants
(`clearanceProbe`/`probeClearance`) out of the transition loop; output hashes are
identical across six seed/level/mode cases.

### Route display pooling and fixed portrait scaling

`RouteVisualPool` owns three Phaser Groups. Shared images include hazards,
shadows, warning lights, guardrail tiles/beacons, cargo/glows and Depot art.
Compound guardrails/facilities use the container group; road surfaces/overlay/
Dawn glints use the TileSprite group. The 2 November strict-preallocation
revision fills all three groups during scene `create`, after texture baking
and before world construction or URL-autostart. Fixed capacities are
**3,005 Images / 70 Containers / 4 TileSprites**. No group can grow in play.
`ROUTE_VISUAL_CAPACITY` derives a conservative bound from canonical minimum/
maximum row spacing, 680 px/s, reaction/stagger gaps, maximum four-row wall
tails, modular tile geometry, whole-body offscreen lifetime, slower Sweepers,
Beta slots, lane/pickup/attachment limits and persistent shadows/Depots/skids.
This intentionally reserves more than observed demand; startup object memory
replaces first-use allocations without relying on seeds, quotas or pressure
filters. Future geometry/spawn changes must keep the bound/tests valid.

Acquisition checks an inactive slot before `get`; exhaustion/unavailable pools
throw explicitly, never allocate, reuse a live hazard or silently omit one.
Groups have their fixed `maxSize` and contain precreated Images, not on-demand
default Group Sprites. Acquiring a route visual without its pool during an
active phase is also an error. Acquisition restores texture,
frame, active/visible, transforms, tint, origin and blend. Release cancels
tweens and uses `killAndHide`; containers detach and release all child images.
Inactive objects cannot participate in scene collision loops because their
separate gameplay records leave `objects` through the existing removal owner.
The rare Blueprint text/menu/transient text owners retain their own lifecycle.

The common image capacity includes four skid slots: two longitudinal
segments for each of at most two remembered Depots. There is no scattered
all-lane decal emitter or spacing setting. Whole segments lie between the
existing core `depotDockingStart` and the canopy site, on the indicated side
only, alpha 0.15; nothing extends beyond the gate. Braking start is computed
once per remembered site, not duplicated in a renderer simulation.
Offscreen/hidden slots release and reacquire from the shared Group.
Cracks, worn seams and tiny shoulder rubble bake deterministically into the
opaque Industrial/Dustlands base textures, not collision or pooled decal data.
Persistent surfaces scroll in place; no first-use group expansion remains.
Shutdown is idempotent and tolerates Phaser's earlier DisplayList/UpdateList
destruction of groups and children. No second cleanup may read a dead Group.

The audited generator is intentionally untouched/Phaser-free: it produces
descriptors, not display objects. Rendering reuses its pure spacing helper to
size display capacity, not its encounter selection/PRNG. Texture baking stays
at scene load. The texture-catalog, missing-obstacle fallback and particle-dot
bake guards reject active-phase generation instead of creating late canvases.
Pooling removes measured cold/warm route display allocation, not every
JavaScript/text/particle allocation, generator planning cost or device spike.

`main.js` now uses FIT/CENTER_BOTH at the existing 390 x 844 logical resolution.
Phaser controls the canvas CSS display dimensions; CSS must not force 100%
canvas width/height. Desktop pillarboxes and shorter phones preserve aspect
ratio without changing lane/cab dimensions or menu input coordinates.

## State, persistence and transactions

Schema **11**, storage key `cargo-run-prototype-profile-v1`. The profile contains
wallet/Blueprints, shared ranks, owned vehicles, per-ship equipment/slots/colors,
per-level entry/completion/checkpoint/records, reward IDs, hints and settlement
receipts. Run-only cargo, Hull, shield charges, Depot visit and timers belong to
the scene/economy run; restarting is not resuming a persisted run.

Pure actions return candidate state. The scene normally saves the complete
candidate through `persistProfile` **before** committing the corresponding
purchase/bank/repair/result state. Save failures keep those transitions paused
and expose retry/error UI. `recordSectorProgress` cannot credit skipped early
sectors to a checkpoint segment. Legacy schemas 1-10, Radar conversion and
stored Shield ranks are still supported; they are live input paths, not dead shims.

Slice 6: `loadProfile(onWarning)` reports corrupt/unsupported saves or read
failures to the scene, which displays the existing error toast after startup.
Loading never writes the main key. Unreadable bytes are backed up under
`cargo-run-prototype-profile-v1-unreadable-backup`; a distinct earlier backup
is preserved using numbered suffixes, while an identical backup is reused.
If backup fails, `saveProfile` refuses main-key writes until a backup retry
succeeds. A storage read failure blocks writes for the session until a
successful reload; unread defaults cannot replace progress simply because
write access returns. Both failures are logged explicitly.

`triggerHint` also saves a candidate profile before committing seen-hint state
or queuing/displaying the hint. A failed write leaves it unseen and retryable.
Retries are suppressed while that failure's error toast is visible, preventing
per-frame synchronous storage retries during a Depot approach.
Existing cross-tab reconciliation and receipt-growth concerns remain outside
this recovery change; there is no new save schema or storage owner.

URL-debug sessions deep-clone the loaded profile. Every scene persistence call
goes through the same boundary: explicit debug mode commits only in scene memory,
ordinary sessions use `saveProfile`. Developer markers suppress completion/
milestone rewards. Plain reload returns to actual stored progress. Hidden owner
wallet tools are distinct: **without URL debug flags they can permanently change
Coins after confirmation**.

## Geometry, theme and asset boundaries

Generator/validator use authoritative world-unit footprints, lane centers,
movement and level/sector policy. Renderer texture crops, sprite scale, colors,
lighting and seasonal theme metadata must not change those inputs or RNG.
Sector `challengeProfileId` comes from route balance, independently of
`visualThemeId`. Generator filler selection and encounter identity read challenge
data only. Visual environments keep their asset inventories and lighting, not
structural filler policy. The A1 extraction preserved the bounded seeded output
hash. The authorized Slice 1 physical-coverage selection work passes its scoped
gate; the latest full-suite status and remaining deferred findings are recorded
in the [audit report](../AUDIT_REPORT.md).

Pressure projection preserves standalone pinch offsets; it resolves only
multi-row structure continuations. Candidate/Beta and bridge replay reject
projected clear-streak violations. Selected bridge witnesses are emitted directly,
without new augmentation that could diverge from their committed geometry.
Seam speed certification indexes the previous/local segment instead of the
next row. Fresh certification now includes the scene's committed 0.6 s launch
lead-in at the actual first collision-window speed; Depot-reset approach is not
double-counted. Certificates expose their configured `hz`, and each physical
proof still requires completion and >=6 px clearance. The seed 153 fresh
Continuous entry at 8,000 m (670 px/s), at the 9,000 m speed ceiling (680), and
all 16 distinct actual-mode scoped route cases pass.

Useful collision-bearing secondary fillers need not further narrow the straight
corridor to be considered; they still require all existing connected, pressure,
overlap and Depot checks. An approved 0.75 Industrial Normal static-gap
experiment caused new fallback exhaustion and was reverted. No spacing-scale
policy remains in challenge data; baseline reaction/spacing guarantees are
unchanged.

The historical candidate-aware seam/internal-transition experiment also missed density
and was reverted after two corrections. All-16 proofs passed during both, but
shorter gaps/filler counts did not guarantee better whole-route physical coverage.
The restored composer still uses existing local existential-path certification
and committed witness replay, not a prohibition across all potential travel lanes.
Pressure history is the largest observed filler-rejection source. No compaction
helper, changed palette order or experimental assertions remain in production.

The authorized physical-coverage scorer now passes its scoped Slice 1 gate with
one-step trajectory lookahead. `chunkCollisionCoverage` derives physical bodies
from `projectPhysicalEvents`, unions their ship-expanded longitudinal compound
footprints, clips emission/lifetime/selected planning windows and measures actual
route seconds; overlapping bodies are not counted twice. `chunkCollisionSpan`
provides the first-to-last occupied row span without inventing extra rows.
In Normal Sectors 3-4 outside recovery/forced mover scheduling, `planChunk`
gathers already certified Alpha/Beta candidates, then performs one seeded weighted
draw. Eight probes remain the default; the latest authorized Slice 1 allows sixteen
before campaign finish only when the observed overall or late collision-empty
time exceeds its distance-normalized target. The observation ledger uses bounded
active projected bodies, two scalar occupied-time accumulators and exact route
time. It counts emitted geometry only, unions overlaps, clips lifetimes and discards
future bodies on Depot reset without discarding accumulated past time. Selected
committed witness geometry is included in scoring, not credited as already emitted.
The latest selection-only follow-up restores Correction 1's variant multiplicity.
Coverage now separately exposes sustained physical body span, complete committed
witness rows and coverage per route meter. Isolated obstacle rows cannot inflate
the structural span; incomplete/expired bodies earn no witness bonus. The existing
score's `1 + 0.4 * span` / `1 + 0.6 * occupiedSeconds * span` use physical
structural span (one for isolated aliases), normalized by committed route meters.
Complete witnesses gain `1 + 0.6 * structuralOccupiedSeconds / routeSeconds`.
The latest trajectory follow-up leaves that physical scorer unchanged.
`planChunk` commits each admitted candidate into a cloned planning graph and
advances its already-bound witnesses, preserving certified exits, pressure,
quota reservations, recent layouts and physical structure references. It then
uses the same composer/validator once in provisional-pool mode with the existing
8/16 budget; no parallel generator or recursive trajectory probe is introduced.
Final weight equals current physical score plus maximum valid successor physical
score (zero at finish/no successor). Behind-target sixteen-proposal pools shortlist
the greatest combined trajectory weight; eight-proposal pools retain weighting.
Zero-score facility windows retain uniform seeded choice.
The PRNG can `fork()` its current state for isolated probes. The mutable planning
graph, PRNG and trace references are restored in `finally`; neither speculative
rows nor probe RNG consumption enter live history or density accounting.
Physical structural span, union, witness bonus and fallback/Depot rules are unchanged.
Before planning, a separate `committedDensity` view projects pending/bound rows
with active bodies to the planning horizon. It never changes observed credit,
double counts future emission or changes the observed-debt budget trigger.
Optional `{traceCandidateSelection}` factory diagnostics receive detached
snapshots of rejected/pool/committed coverage; default play retains no trace log.
Requesting pacing, measured debt and applied budget travel through existing
chunk/stream metadata; fallback recovery labels do not misrepresent the original
request. Committed witness search remains at its existing budget.
Existing useful outgoing seams at protected facilities retain preference.
Zero-coverage facility windows retain a deterministic uniform selection.
The selected proof/pressure/witness is committed through the original owner.
No spacing/filler/geometry policy changes. Final trajectory gate is 7 PASS /
0 FAIL, 258.165 s; actual-campaign density is 106.063712 s / 75.666741 s against
unchanged <107.437701 / <75.793677. The explicit non-greedy regression passes.
Slice 1 is complete. The latest full-suite and build results are in the audit
report; browser/device performance and human acceptance remain pending.
Visual theme lookup has an existing development warning/current-art fallback.
Obstacle creation separately checks its Phaser texture cache. Missing obstacle
or guardrail pixels are replaced by the already-loaded standard Barrier raster
at the declared frame dimensions, with an explicit warning once per missing
key/texture manager. Missing the standard fallback itself aborts initialization
explicitly instead of producing a missing-texture square. This is visual asset
recovery, not hazard-kind or collision substitution at render time.
Unused future catalogs/texture keys cannot be discarded merely because no current
level selects them: several are tested, baked or addressed dynamically.

Art is bound by registries in `industrial.js`: Standard/Swift gameplay and
display art, obstacle art, modular guardrail entry/middle/exit, collectibles,
Depot and eight Garage upgrade images. Source art in the parent `art-direction`
folder is outside this cleanup and remains referenced by asset-verification tests.

Active candidates now use only sprite-backed kinds: Barrier/Divider, Rock Slab,
Signal Cabinet, forklift and the approved chicane tile set for elongated
structures. `trackGenerator.js` replaces retired primitive-only candidates
before normal safe-lane/connected certification; `environments.js` removes them
from hazard/filler/Beta lists. Old diagnostic geometry definitions remain
available, but their procedural renderers and baked roadway textures are gone.
Outside-road scenery, lighting, particles and coupling graphics remain cosmetic
and are not part of the roadway-obstacle purge.

`trackGenerator.js` fits live forklift sweeps to at most three contiguous lane
centers, considering native companions and active wall references before
certification. Restricted openings keep two centers. `usesTimedMoverLanes` in
`hazards.js` recognizes both explicitly tagged, matching lane/bound layouts;
the existing validator still uses canonical elapsed-time collision checks.
Untagged or malformed layouts retain conservative swept geometry. Existing
lateral speed and one-lane physical collider dimensions remain unchanged.

Latest owner revision (2 November): the `moving_intercept` recipe always emits
`forklift` (default `movingEncounterRows` kind) and `movingSchedule` projects
Forklift contact. Level 2 no longer selects `sweeper`; the code below is retained
unselected for a future Level 3 StreetSweeper owner.

Slice 4 separates live `forklift` lateral motion from `sweeper` forward motion,
using the same approved raster/texture. Forklift canonical motion includes a
0.5 s stationary warning and its beacon starts on that same motion clock.
Forward Sweeper motion carries `axis: 'forward'` / `forwardSpeedRatio: 0.5`;
the scene and debug bot use `hazardScrollScale`. Its source Y preserves the
existing row arrival anchor. `hazardRouteOffsetY` / `hazardRouteGeometry` express
the exact longer longitudinal collision window in route-distance coordinates,
including the player half-height. `hazardClearance` converts longitudinal
separation back to physical pixels before computing the signed distance, so
the unchanged 6 px criterion is not accidentally doubled.

The existing pressure, collision-density, facility exclusion, row lifetime and
route-audit consumers use that shared projection. No second motion registry,
generator or validation path. Eligible quota intervals begin at Level 2 Sector
2; their 4-14 body counts, 40 m separation, existing proposal budgets, side
quotas, 0.8 s reaction and connected certification remain in force. Level 1
and Continuous stay mover-free; approved lighting/speeds are unchanged.
Slice 4's final required gate is **12/0**, 217.594 s; related Depot/scene/
render/debug-lifetime **65/0**, 2.864 s; 17 individual JS syntax checks PASS.
Browser smoke confirms the 0.5 s warning, fixed-lane half-scroll Sweeper,
one beacon each and unchanged stored progress. Human acceptance is pending.

`industrial.js` reuses the Barrier strobe owner for a single amber mover
beacon, attached through the scene's existing `cautionLights` lifecycle.
`syncCargoPickupVisuals` applies slightly dimmed neutral pickup art and 90%
glows in Dusk/Night above the ambient mask, including shadows already present
in the supplied raster. Daylight and rejected-pickup cues use the same helper;
it cannot change collection/value/mass or collision geometry.
Normal and sandbox road cargo no longer allocate coin/value/load annotation
objects. Separate Blueprint reward labels and HUD/collection feedback remain.
`balance.COLLECTIBLE_VISUAL_SCALE` multiplies only road collectible body scale
by `0.95 * 0.95` at creation after the second approved 5% reduction;
cargo/Blueprint under-pickup layers keep the original
`SPRITE_ART_SCALE`. Source textures and gameplay geometry are not resized.
`balance.RUN_TRUCK_VISUAL_SCALE = 1.05` multiplies the active ship's base scale
in `syncShipAppearance`, preserving the Swift ratio and all Standard finishes.
Roll restores that base without accumulating scale; menu preview sizing remains
independent. `recolorLargeCargoPickup` changes only cyan pixels in the cached
Large pickup texture to orange at bake time, preserving grayscale/alpha and the
original supplied PNG. No per-frame pixel processing or Blueprint recoloring.

Trailer constraints stay in the existing cosmetic `data/balance.js`, not
`gameBalance.js`: 18 px displacement, 8-degree absolute/cab-relative angle,
five-frame time-normalized history delay, spring/rotation tracking and y + 2 px /
0.5 shadow. `cargo.js` owns the single pure bounded history chain;
`industrial.js` mirrors its pose to beds/shadows/scaled hitches. No Phaser import
or new physics owner is needed in core.

The retained Slice 2 implementation keeps the same owners. `gameBalance.js`
defines the latest approved 12.54 px player half-width (25.08 x 32 px body,
5% narrower than the previous widened body) and cargo-only 1.2 trigger scale;
`hazards.js` derives expanded horizontal extents from the unchanged authored
component bodies. `collision.js` reuses those bodies for swept relative-motion
clean-pass tracking. State is attached to the existing live obstacle instance
and dies with that instance; no second collision registry or generator.
`depotEconomy.js` owns the separate capped current-hold close-call bonus and
transactional bank/reset. The scene wires it through existing movement,
quotes/HUD/Depot/results and 30 px / 400 ms text. No rendering reward writes.
Canonical step/cap are now +5/+50%; the existing non-immune collision branch
clears only the current-hold bonus on Hull/shield hits. A frame-local hit flag
prevents later clean passes in that frame from immediately recreating it;
immune overlaps and the separate harmless flank-grind path are unchanged.
`industrial.js` reuses grind sparks for directional impacts and adds one bounded
low-Hull smoke emitter stopped off-track/with existing cleanup. The existing
cab owner performs a frame-normalized 120 ms cubic return to avoid pickup tween
cancellation and preserves active-run scale.

The authorized cab-only follow-up assigns literal `0` at completed return,
preserving the cubic formula before completion, 120 ms timing and 3.5-degree cap.
Latest Slice 2 gate **17 PASS / 0 FAIL**, 20.954 s; three changed JS syntax checks PASS.
The new fractional half-width exposed sequential close-call subtraction rounding;
`collision.js` now subtracts combined extents once, without threshold/tolerance
changes. Latest generator recertification is **7 PASS / 0 FAIL**, 242.783 s:
overall/late density, all 16 proofs and roadside assertions PASS. Only the two
authorized fixtures now derive canonical-width inside/outside probes; no
production geometry or generator changes. Slice 3 is now implemented in the
same scene/Depot/economy/environment owners. The scene interpolates threshold
crossing X. The latest owner makes entry indicated-side-only, requiring at
least 50% of the canonical cab width inside that approach bay, replacing the
old two-outer-lane centre predicate. `depots.js` owns `depotEntryBounds` and
the decision; the scene supplies actual `Phaser.Geom.Rectangle.Intersection`
on Rectangle instances, while pure simulations use the equivalent rectangle
adapter. The geometry is 25.08 x 32 px, not sprite artwork/roll/pulse bounds.
Crossing-plane sampling preserves swept frame behavior; a few ULPs of
coordinate subtraction roundoff normalize the inclusive threshold, not a
physical clearance tolerance. The approach bay uses the existing mouth
dimensions at the derived braking line, preserving the canopy endpoint.
The scene freezes steering while docking and uses `depotMotionStep` to
integrate smoothstep speed into actual distance/scroll over 1.5 s. Timer
endpoints normalize frame-sum roundoff at 30/60/120 Hz. Resume ramps up over
the requested 1 s immunity window; generator recovery/envelopes remain intact.
`depotDockingStart` now solves the braking line from that same integral and the
live speed curve. Docking integrates the remaining site distance over the
unchanged 1.5 s, ending exactly at the bay anchor; center passes still count at
the actual gate, including opposite-side outer passes. Chevron segments clip to the approach side of `depotWorldY`,
so road decals never extend beyond the facility.
`showDepot` also records arrival progress through the existing `recordMilestones`
owner after rendering. This preserves immediate checkpoint persistence now that
the final approach runs in the docking phase rather than the running phase;
failure leaves profile state intact and keeps the existing warning visible.
`showDepot` recharges Normal shields without banking. The existing maintenance
menu offers manual Bank & Continue / Bank & End Run; `bankAtDepot` uses
`bankCargo`/`persistProfile` transactionally. Failed writes retain cargo and
block exits/services until retry. Successful Bank & Continue leaves only
disabled Cargo Secured, Resume Run and Repair Hull, with a stale End-button
guard. The HUD parent hides while stopped, including bank/repair refreshes
and confirmation, and returns on resume.
Endless arrival never banks/recharges; stopped Skip restores equipped charges
and reuses passed-Depot accounting, while End Run uses existing settlement.
Any out-of-bay bypass never resets the stream, brakes or recharges. Hints and menus
share those mode-specific choices. No passive shield owner was added.
The environment owns one bounded chevron Graphics layer, visible only in the
Depot-side outer lane within the canonical 60 m notice distance and destroyed
with existing lighting resources. Upper notice and HUD Depot indicator share
that timing/direction; the physical bay now follows the indicated side.
Existing HUD
hex pips, trailer spring state, silhouette shadows and exhaust remain owned
by their existing renderers; docking is a visible gameplay phase.
Original Slice 3 gates: generator 7/0 (239.560 s), Depot 18/0 (2.715 s), related
scene/render/lifetime 68/0 (21.753 s), exact Slice 2 regression 17/0 (21.468 s).
Latest owner follow-up: **104/0**, 32.311 s, ten individual syntax checks PASS.
Real Phaser smoke confirms both modes, side-only 60 m indicators, opposite-side
docking, hit resets and the three post-bank controls; stored progress unchanged.
See [handoff](../AUDIT_REPORT.md#latest-execution-near-miss-and-depot-follow-ups-pass).

`environments.js` also owns explicit per-level lighting preset maps.
`lightingForSector` receives the level at run start/URL warp, sector transition
and Depot exit. Level 1 maps Dawn/Dawn/Mid-Day/Mid-Day, Level 2 maps
Dawn/Mid-Day/Mid-Day/Dusk. Night remains a supported future preset; Continuous
uses Mid-Day from zero independently of campaign sector lighting. Lights/strobes/glints derive from the selected preset, not
from an independent sector-number switch.

Garage upgrade bindings:

| Card | Production PNG | Supplied source wrapper |
| --- | --- | --- |
| Cargo Capacity | cargo-capacity-upgrade.png | CargoCap_Upgrade_Sprite.svg |
| Precision Steering | precision-steering-upgrade.png | PrecisionSteering_Upgrade_Sprite.svg |
| Magnetic Collector | magnetic-collector-upgrade.png | Magnet_Upgrade_Sprite.svg |
| Lightweight Rack | lightweight-rack-upgrade.png | LWRack_Upgrade_Sprite.svg |
| Reinforced Plating | reinforced-plating-upgrade.png | Plating_Upgrade_Sprite.svg |
| Cargo Insurance | cargo-insurance-upgrade.png | CargoInsurance_Upgrade_Sprite.svg |
| Impact Pulse | impact-pulse-upgrade.png | ImpactPulse_Upgrade_Sprite.svg |
| Depot Shield | depot-shield-upgrade.png | RechargeShield_Upgrade_Sprite.svg |

The upgrade PNGs preserve embedded source bytes; socket fits are 36 px and grid
art fits dynamically up to 72 px as card height changes.
Detail and purchase-confirmation menus use the same registry at 72 px.
Reinforced Cargo Hold reuses Cargo Capacity art, not an unrelated module icon.
Scaled standalone icons carry explicit scroll bounds so native image dimensions
cannot incorrectly hide them. Existing scroll containers, masks and pinned
footers remain the only menu layout/lifecycle owners.

Upgrade headers measure title/subtitle height before starting scroll content.
The wallet and compact heading have separate horizontal space.
`peekingCardMetrics` sizes list rows from the logical viewport after header and
fixed-footer offsets: 35% of truck card three and 30% of the next upgrade row
remain visible at top scroll, with 12 px row gaps. The existing responsive
camera converts scale dimensions into logical menu height; do not subtract
logical header/footer coordinates directly from physical screen pixels.
Upgrades advance their Y accumulator by the subsection header's `displayHeight`
plus 24 px before instantiating sockets;
the unlock button and grid inherit that socket position. Compact socket offers
show unavailable reasons inside their button rather than spending a separate
text row. Cards and truck controls are compact enough for 320 x 568; detailed
effects still live in the existing scrollable detail menus.
`addCardText` centers text at `left + width / 2`, with center/middle origin,
explicit inner width and measured scale-down for long text. Grid titles override
the vertical origin with center/top `(0.5, 0)` at the actual card background top
plus 16 px; horizontal padding stays
12 px. The steel background's Y is its center, so its top is
`tile.y - tile.height / 2`, not `tile.y`. Single-line labels preserve their line
while fitting their width. No text padding substitutes for sibling translation.
Trucks retain preview and equip/unlock on one shared 54 px-high action row.
The 10 screen-pixel drag deadband, input clipping, inertia, mask cleanup and
16 px footer-to-mask gap are unchanged.
Truck previews separate steering labels/bars and put summary stats below the
display sprite. `garageUpgradeBenefit` and `MODULE_CAPTIONS` own presentation
copy only; core stat formatting, effect calculations, prices and gates remain
authoritative and unchanged.
Truck display art is separate from in-run hull textures. No production asset was
removed or reencoded in this audit; all 31 PNGs have code/test consumers.

## Lifecycle and bounded resources

- Scene input/keyboard listeners are owned by Phaser's scene plugins, which
  remove listeners/keys on shutdown. The external scale resize handler has
  explicit scene-shutdown deregistration.
- `destroyRoadEnvironment` releases leased decals/glints and removes ambient
  canvas texture, lamps, beams, streaks and particles; zoom tweens are stopped.
  Final Phaser/Group teardown destroys retained pooled nodes, not each pass.
- `clearOverlay` destroys current containers/masks, stops relevant tweens and
  resets scroll/gesture/coasting state. Menu rebuilding is not parallel rendering.
- Hazard/collectible attachments leave through `removeObjectAt`; guardrail
  continuations do not create extra bodies. Depot facilities expire downstream.
- Cosmetic trailers use a 120-entry history and four individually rotated
  beds/shadows/hitches. Lamps/decals/sparks/exhaust are bounded/reused.
- Three desktop restarts held 127 textures and stable input/resize listener
  counts; display children stabilized after initialization. This is a bounded
  smoke, not proof against all long-session/mobile leaks.

## Running locally

From the project folder in PowerShell, with the currently installed dependencies:

```powershell
npm.cmd run dev
npm.cmd test
npm.cmd run build
npm.cmd run sim:route
npm.cmd run sim:balance
```

Open the URL Vite prints (normally localhost:5173); do not open index.html directly.
Use the Node version supported by Vite 7. Install dependencies only on a genuinely
fresh/missing-dependency setup. No automatic reinstall/version bump is needed.
The standalone `scripts/depot-verification.mjs` is a retained diagnostic and writes
a regenerable JSON report; it is not a production entry point.

Local build labels/public references are historical provenance, not deployment
proof. Publishing/Android packaging are separate owner-authorized tasks.
