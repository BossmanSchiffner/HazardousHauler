# Hazardous Haul - Current Game Design

Updated 4 November 2026. This describes the current two-level web prototype,
not all concepts in the design catalog. Current values come from
[gameBalance.js](../src/game/data/gameBalance.js); change them only through an
authorized gameplay task. See [decisions](DECISIONS.md) for overrides and
unimplemented requirements, [architecture](ARCHITECTURE.md) for owners, and
[testing](TEST_PLAN.md) for acceptance.

The current product priority is **browser gaming sites first, mobile secondary**.
Preserve portrait readability and touch controls while polishing desktop play.
The owner-supplied [implementation plan](ImplimentationPan.md) records proposed
next work; it does not certify release quality or override the implemented rules
below without completing the relevant authorized slice.

## Core loop and controls

New sessions begin directly on the Main Menu; there is no load-in video or image.
The first touch records touch controls, while a mouse click or key records
desktop mode. No audio plays before that first interaction.

Automatic forward travel, continuous lateral steering, four obstacle lanes.
Collect cargo, trade value against carried weight, choose Depot stops, and buy
permanent improvements. The cab is the collision body; articulated cargo beds
are cosmetic. A heavy load reduces steering response; buying capacity alone
does not simulate carrying that weight.

- Desktop: move the mouse over the roadway without holding a button, or hold
  A/D or Left/Right. Keyboard release brakes lateral velocity within 60 ms;
  moving the mouse restores pointer steering. Space pauses or resumes; resuming
  starts a three-second countdown over the visible road before the run continues.
- Touch: press and drag. Lifting a finger during a run pauses it. Resume from
  the translucent pause overlay; the frozen run remains visible behind it. The
  same three-second road-visible countdown applies. The top HUD band is excluded
  from steering input.
- The pause menu offers End Run with confirmation. It shows coins banked this
  run, the current unbanked hold, and what is lost by ending. Normal loses the
  unbanked hold and bonuses; Endless follows its existing wreck rule, retaining
  25% of current cargo and losing the rest and its unbanked bonuses. The wallet
  remains safe.
- Garage cards scroll; a drag/coasting/clipped card must not activate a purchase.
- No active jumping, forced ads, audio SDK, online service or persistent run-resume save.

## Levels, sectors and modes

Both implemented levels have four sectors with independent route lengths.

| Level | Theme throughout | Sector ends (m) | Sector 3 checkpoint | Normal finish |
| --- | --- | --- | --- | --- |
| 1 | Industrial | 500 / 1,000 / 1,500 / 2,000 | 1,000 m | 2,000 m |
| 2 | Dustlands | 500 / 1,000 / 2,000 / 3,000 | 1,000 m | 3,000 m |

Level 1 Depots are at 500, 1,000 and 1,500 m; Level 2 Depots are at 500,
1,000 and 2,000 m. The finish settles the final interval without another Depot.

Level 1 completion unlocks Level 2. Each level keeps independent entry/completion
evidence, checkpoint access and records. Normal start selection offers the
beginning or that level's unlocked checkpoint. Full-run achievements must not be
earned by skipping early sectors.

Normal runs clear all hazards at 10 m before the finish and do not spawn
obstacles at or beyond that point. Cargo and Blueprint pickups remain independent.
New roadside guardrail bodies use a brief visual ease-in as their leading cap
enters the road view; route distance, collision geometry and timing are unchanged.

The main menu uses the supplied Hazardous Haul logo instead of a text title or
truck preview, followed by four actions: **Normal Run**, **Endless Run**,
**Garage & Upgrades** and **How-To**. Normal Run opens the final level-card screen:
each implemented level has a title with side-by-side **Sector 1** and
**Checkpoint - Sector 3** start tabs beneath it. Enabled tabs start immediately,
without mode/start/reward confirmation menus. Checkpoint tabs remain grey and
disabled until that level's Sector 3 checkpoint is reached; a locked level
disables both tabs. Both starts still use full health and empty cargo and preserve
their existing independent progression/reward eligibility.

The level list scrolls above fixed Return to Menu navigation, with 12 px card
gaps. Levels 3-5 have non-interactive **Coming Soon** cards only; no additional
levels are playable. Newly implemented entries use the same list/card path
without an extra navigation screen. Endless Run retains one short rules screen
before starting and returns directly to the main menu. Its overview gives only
four main details: endless driving with increasing speed, no mid-run cargo
banking, +10% cargo bonus per passed Depot capped at +100%, and stopping at a
Depot to cash out and end the run. Starting settings, numerical pacing and wreck
retention are omitted from this overview only; their gameplay rules are unchanged.

Campaign speed interpolates smoothly between sector-start values:
Level 1 320/350/380/410 px/s; Level 2 350/380/410/440 px/s. The last sector holds
its final value. One global ceiling is 680 px/s. Level 4 Sector 4 reaching that
ceiling is a future target, not authorization to implement Levels 3/4.

Per-level Overdrive is retired; saved records remain historical data.
Separate **Endless Run** (internal mode `continuous`) unlocks after Level 1 completion. It starts at 0 m
with Level 1 Sector 2 challenges and Mid-Day Industrial visuals, at 350 px/s.
Each 1,000 m milestone raises speed by 40 px/s, capped at 680. Challenge/pickup
baseline stays Sector 2, without campaign progress/completion or new levels.

## Generation and collision contracts

One seeded generator and connected physics validator serve both levels/modes.
Rendering and visual-theme changes must not alter RNG, footprints, rewards or
generation policy. Geometry is expressed in world units, not PNG alpha bounds.

- Logical world: 390 x 844; lane centers: 86 / 159 / 232 / 305 px.
- Encounter families include recovery, offset/split gates, narrow corridors,
  risk/reward and modular roadside pinches/chicanes. Existing tests remain
  contracts even when currently failing; no audit permission to weaken them.
- Roadway hazards use supplied sprites exclusively. Industrial container slots
  now select the existing standard Barrier; machinery and Dustlands wreckage
  slots select Rock Slab. Signal Cabinets, forklifts and modular guardrails
  remain available in their configured pools. Procedural container/machinery/
  wreckage/energy/drum/shield/bollard/gate drawings are not active obstacles.
  Replacements retain authored row/object counts and use normal connected
  certification; no new pylons, blank replacement rows or relaxed quotas.
- Side-hazard target is 4.5%, within 3-6% of emitted collision-body instances.
  Decorative scenery and nonspawning continuations do not count.
- Continuous side structures have one body, an entry, at least one full middle
  tile, and an exit. Intrusions occupy one outer lane. Preserve staggered
  opposite-curb starts and the approved extra 54 px chicane transition spacing.
- If adjacent Alpha rows block a common lane, place any generated Beta in the
  rightmost lane open in both rows; retain the existing physical certification.
  Do not place a Beta if the next Alpha row leaves no adjacent in-road escape lane;
  the edge of the road counts as blocked, as do roadside-wall blockers.
- Entry artwork: Lane 0 flipped horizontally; Lane 3 unflipped. Middles/exits
  flip on Lane 3. Artwork handedness is not a new collision calculation.
- Glancing cab flank contacts clamp/repel and emit grind sparks without Hull
  damage. Entry-lip/head-on contacts remain damaging. Pylons are retired.
- Level 1 has static obstacles only. Level 2 introduces **lateral Forklifts
  only** from Sector 2 (source distance >=500 m), using existing approved
  artwork. The latest owner revision (2 November) removes the forward Sweeper
  from Level 2; a vertically moving StreetSweeper with its own sprite is
  reserved for Level 3 (not implemented). The Sweeper notes below describe that
  retained, unselected mechanism.
  Forklifts wait for a 0.5 s amber-beacon warning before lateral movement:
  live intercepts sweep three contiguous lane centers when surrounding static
  hazards permit, or two when outer walls restrict the opening. Neither sweep
  may overlap the reserved wall/filler geometry; both require full route-time
  connected certification. Authored two-lane opening lessons remain restricted.
  Each forklift has one amber construction beacon using the Barrier double-flash
  rhythm and shared attachment cleanup. Sweepers use the same approved art
  with one flashing amber beacon but stay in a single lane, driving forward at
  half track speed (half relative road scroll). Their nearer source position
  preserves the advertised row arrival anchor; connected certification, physical
  pressure, facility envelopes and lifetime accounting use the exact projected
  longitudinal collision window, not a second validator or artwork geometry.
  Quotas remain 4-14 real bodies per eligible half-open banking interval,
  500-1,000 / 1,000-2,000 / 2,000-3,000 m, including the final Normal interval;
  minimum 40 m encounter separation is unchanged. Sector 1 has no movers or
  mover quota, rather than a silently failed four-body requirement.
  Timed and explicitly tagged potential-lane patterns
  retain their distinct existing validation semantics.
- Baseline selection uses stock Standard, half of the live baseline capacity,
  0.8 s reaction and >=6 px connected clearance. Other loadouts/frame rates are
  diagnostics and regression coverage, not permission for a parallel generator.
- Clear-event limits are three in Normal and the Sector 2 Continuous baseline. Retries,
  quota failures, connected access and object lifetime are required checks.

The latest scoped generator gate passes density, fresh Continuous entry,
all configured physical proofs and resolved scenery tails. This is engineering
evidence, not a human gameplay or commercial-quality certification.
Failed static-gap tightening was reverted; no new spacing/balance policy or
Slice 2 gameplay is active. The later physical-coverage scorer favors already
certified Alpha/Beta coverage in Normal late sectors without changing recovery,
spacing, reaction or filler rules. Under the new campaign speed ladder the
historical beyond-finish diagnostic yielded 169.43 s overall / 139.50 s late.
The latest owner explicitly reconciled density to 0-4,000 m / 1,000-4,000 m
with proportionally preserved limits of <107.437701 / <75.793677 s. Adaptive
eight/sixteen-proposal selection scores only certified geometry, expands only
when measured collision-empty time is behind target, and keeps quotas, recovery,
spacing and reaction rules. The latest follow-up distinguishes sustained physical
bodies from isolated row aliases, restores variant multiplicity, measures committed
coverage per meter, and credits complete witnesses in a separate future view
without fabricating emitted credit. The latest one-step trajectory selection
scores existing admitted candidates together with their best certified successor
under the candidate's exit, pressure and quota context. A cloned context and
forked PRNG keep provisional choices from affecting live state; the original
composer, budgets, physical/witness scoring and fallback/Depot rules remain.
Final **106.063712 / 75.666741 s** passes both unchanged limits:
**7 PASS / 0 FAIL**, 258.165 s, including the explicit non-greedy regression.
Slice 1 is complete. See the audit report for the latest full-suite and build
results; device performance and human acceptance remain pending.
See the [audit report](../AUDIT_REPORT.md).

## Cargo, damage and currencies

Slice 2 game feel's latest focused gate is **17 PASS / 0 FAIL** (20.954 s).
Canonical-width recertification now passes **7 PASS / 0 FAIL** (242.783 s)
after owner-authorized dynamic inside/outside roadside fixture reconciliation.
Overall/late density, all 16 route proofs and roadside checks PASS.
The owner reduced the widened cab width by 5% to **25.08 x 32 px**, height
unchanged, not a sprite-relative contraction. Cargo-only pickup thresholds are 36/48 px;
Blueprint and purchased Magnet attraction bounds are unchanged. Existing cab
roll now targets +/-3.5 degrees with a 120 ms cubic return; trailer constraints
remain unchanged. Slice 3 tactical Depots now pass their scoped gates.

A clean 15-25 px passing obstacle gap, once per physical instance while holding
cargo, adds five separate bonus points capped at +50%. This pays only on the
surviving current hold at banking/cash-out, without compounding Depot/clean-run
bonuses; Normal banking resets it and wrecks never pay it. Hull-damaging and
shield-absorbed hits reset the unbanked bonus to zero, including any clean pass
in that frame. Harmless wall grinding and invulnerable overlaps leave it intact;
previously banked Coins remain safe. The scene uses
30 px / 400 ms close-call text, 100 ms / 0.012 nonfatal collision shake,
pooled directional metal sparks and dark smoke at positive Hull <= one third.
These are retained changes, not human/player acceptance. See
[actual gate evidence](../AUDIT_REPORT.md#slice-2-width-reduction-5-density-pass-two-boundary-failures).

Cargo stores value, mass and occupied slots. Pickups occur on the existing
2-4-row rhythm; values progress by sector position through the configured
5/10/20/25 tables; Continuous stays at the Sector 2 table. Freight mass and pickups share
existing value eligibility, not artwork-derived tiers. A full hold can replace
one strictly cheaper item if the replacement fits.

Up to four cosmetic trailer beds follow a 120-step cab history with five
60 Hz-equivalent frame delays per segment and load-damped spring lag. Each
segment stays within 18 px laterally of the cab; its angle stays within both
8 degrees of road-forward and 8 degrees of the cab. Fixed 46/29 px drawbar
spacing, scaled metal coupling links and navy silhouette shadows at y + 2 px /
alpha 0.5 keep the beds attached. This does not add trailer collision bodies or
change carried-weight steering, cargo accounting, pickups or damage.

Damaging collisions jettison the lowest-value item and apply the configured
percentage value-loss target. Cargo Insurance reduces percentage loss, not the
mandatory jettison. Previously secured wallet Coins remain safe.

Coins buy equipment/ranks, slots and paid colors. Blueprints buy playable chassis.
Road Blueprints use their separate deterministic stream and eligible-sector
budget; they are not guaranteed early rewards. Pre-eligibility non-road rewards
are deferred. Future Apex conversion helpers are retained/tested, but Apex is
not currently purchasable.

## Depots and settlement: implemented behavior

Slice 3 and the latest entry override are implemented: only the indicated-side
bay can dock, requiring >=50% overlap of the physical 25.08 px cab width.
Partial overlaps below that threshold and the opposite outer lane bypass.
Braking lasts 1.5 s to stop at the Depot, with green chevrons, upper notice and HUD indicator only on the
Depot side in the final 60 m. Chevrons terminate at the site, never farther
along the road. The braking
line is derived from speed and the existing smoothstep stopping integral, so
the truck stops under the canopy instead of rolling beyond it. Entry position
at that line is interpolated over the frame, then compared with the indicated
bay's canonical mouth rectangle, not inferred from steering target or scaled
sprite bounds. No services occur until the stop completes.
Normal stop completion records sector/checkpoint progress immediately through
the existing save boundary, independently of manual banking; failed writes
retain profile state and show the existing progress-save warning.
Out-of-bay bypass keeps full speed/cargo and earns the unchanged mode-specific
pass bonus, with no shield recharge. Resume accelerates during a 1 s protection
window. Existing cyan hexagonal HUD pips show equipped capacity/current charges.
The gameplay HUD hides while stopped in either mode, stays hidden through
banking, repair and confirmation, and returns on resume.

Normal Depots occur at sector starts after Sector 1, not a periodic loop:
Both levels stop at sector transitions: 1,000 / 2,000 / 3,000 m.
Continuous Depots appear every 1,000 m from zero. Approach/exit protection and
the new threshold predicate use the existing Depot owner; bypass preserves the stream.
The retained `loopMeters` field influences side placement, not periodic stops.

- Normal: arrival restores equipped shields but leaves cargo unbanked. The
  maintenance menu offers Bank & Continue, Bank & End Run (confirmed), optional
  wallet-funded repair or an unbanked Skip. Bank & Continue secures cargo plus
  hold bonuses and clears cargo/risk/close-call bonus. Its post-bank menu has
  only disabled Cargo Secured, Resume Run and Repair Hull; Bank & End Run is
  removed. The limit is **one bank per visit**, not one per run. Banking an
  empty hold resets bonuses too, but does not grant the first-bank milestone.
  Failed Bank & Continue persistence retains cargo/accounting and blocks
  exits/services until Retry Banking succeeds.
- Normal center bypass adds 20 percentage points, capped at 60%. No extra
  distance reward for ending safely at a Depot.
- Repair restores one Hull per visit, paid from the wallet with increasing
  difficulty/prior-run-repair cost. There is no current run-wide repair cap or
  collectible repair voucher. Continuous has no repair menu.
- Continuous stopped menu offers End Run (terminal cash-out) or Skip (no banking,
  restores equipped shield charges before continuing). Arrival alone does not
  restore charges; neither does a straight center-lane bypass.
  Each passed Depot adds 10 percentage points to current-hold value, capped at
  100% total bonus, not compounded. Wreck retains floor(25% of current-hold
  Coins) without Depot bonus. Blueprint, distance, completion and no-damage
  rewards do not enter this settlement. Existing wallet Coins remain safe.
- Normal crash consolation, records, completion and clean-run rewards use one
  settlement owner. First/repeat completion pays configured 500/250 Coins.
  Receipt IDs prevent duplicate terminal settlement.

The prior one-bank-per-run/finite-repair proposal is **unimplemented**, not
silently restored by documentation cleanup; see [decisions](DECISIONS.md).

## Garage and equipment

Standard and Swift are playable. Swift costs **6 Blueprints** after Level 2
unlock, has 1.30x steering response and four fewer cargo slots at matching rank.
Armoured, Prospector and Apex remain locked Coming Soon placeholders.

Ranks are shared; equipment/loadout, purchased slots and colors are per ship.
Standard starts with two slots, Swift with three; the current maximum is six.
Extra slots require their configured milestone and payment. Previewing a truck
does not equip it. Colors are managed in the viewed truck's preview menu; paid
choices cost 750 Coins. Gold appears only for Standard and is earned by a clean
Level 1 completion from Sector 1 in Standard, never purchased.

The eight Upgrades cards represent Cargo Capacity plus seven modules:

Cards, details and purchase confirmations use each upgrade's matching supplied
sprite. Detail screens explain the upgrade in plain English and show current,
next and maximum bonuses where applicable. Shield copy says one charge blocks
one hit and only stopping at a Depot refills it; Insurance explicitly excludes
dropped cargo. Impact Pulse explains that a damaging hit clears road obstacles
on screen and adds temporary safety. This copy does not change gameplay effects.
Headers/wallets remain separate; cards and long descriptions scroll above pinned
footer actions without overlapping the truck display or card borders.
Mobile Trucks show two complete cards and approximately 35% of card three;
the two-column Upgrades grid shows its first row and approximately 30% of the
next row. Row gaps are 12 px. The module subsection header has 24 px of whitespace
before the socket bay, and card titles retain 16 px top / 12 px side
insets. These responsive presentation rules do not change slots, prices,
requirements, equipped state or purchase behavior.

Latest menu text rule: center every label within its own padded region. Truck
cards keep two columns with centered text/stat bars alongside their image;
upgrade text and image share the tile center line. Button titles/subtitles and
menu-tile text stacks are centered together vertically. Coin-image labels remain
a centered group, and popup labels/values share a centered row baseline.

| Line | Live role / gate |
| --- | --- |
| Cargo Capacity | Eight paid ranks, 11 through 32 slots on Standard while equipped |
| Precision Steering | Starter; improved handling |
| Magnetic Collector | Reach Level 1 Sector 1; attraction range |
| Lightweight Rack | Complete Level 1 Sector 3; load relief with capacity drawback |
| Reinforced Plating | Complete Level 1 Sector 4; Hull with handling drawback |
| Cargo Insurance | Reach Level 2 Sector 1; percentage loss reduction |
| Depot Shield | Complete Level 2 Sector 3; three ranks with exactly 1/2/3 charges |
| Impact Pulse | Implemented effect, but new purchases gated to future Level 4 Sector 3 |

Depot Shield starts charged and absorbs before Hull/cargo damage. Normal dock
arrival refills it; Endless restores it only on Skip after an actual stop.
No passive or bypass recharge; capacity remains the equipped 1/2/3-charge rank.
Immune contacts and harmless grinds consume no charges.

Cargo Capacity occupies one equipment slot; unequipping restores baseline
capacity. Rank 8 opens the current four-rank Reinforced Cargo track; mitigation
applies only with Cargo Capacity equipped. Its future-tier policy conflict
remains recorded, not changed by this audit.

## Presentation and internal inspection

Industrial challenge fillers may use existing Barrier, Rock Slab and Signal
Cabinet sprites in certified secondary gaps. No pylons or placeholder artwork
were reintroduced. Normal lanes retain a maximum three meaningful unthreatened
events in both active modes; Alpha, Beta and continuous bodies share the physical
pressure owner. Newly allowed fillers must satisfy clearance, Depot protection
and pressure caps, not merely fill visual space.

The scoped generator density gate is complete; the latest full-suite status and
remaining deferred findings are recorded in the audit report. The historical
760 px/s Overdrive contract is retired, not waived at the old speed. Active-mode
entry and all-rate >=6 px proofs must pass with the same 0.8 s reaction buffer.
Continuous-rail geometry and lifetime remain certified by the existing physical
owner, not artwork.

Roads have fully opaque roadbeds with no drainage/mesh alpha holes. A full-screen
0.7x scrolling overlay supplies multiply-blend Industrial grunge or additive
Dustlands dust. Noncolliding pooled road decals are only linear tire skids,
alpha 0.15 (<0.2); circular oil, crack and rut decal variants are removed.
Random all-lane skids are removed: tire strips occupy only the indicated
Depot's longitudinal braking approach, entirely between braking start and
the canopy site, never past it. Fine branching cracks, worn asphalt seams and
tiny shoulder rubble are deterministic baked base-road detail on Industrial
and Dustlands, not standalone decals or collision hazards.
Hazards/attachments/compound guardrails and tiled surfaces reuse scene-owned
Phaser Groups without changing route geometry. They are fully preallocated
at scene load, including drop shadows and Depot braking skids; no first-use
expansion during play. Route art is baked before driving; missing active-play
textures or exhausted pools fail explicitly instead of creating sprites/
textures or silently dropping hazards. Cold and warm route-display reuse is
verified, not a blanket guarantee of zero JS allocation/GC/jitter on devices.

Desktop uses a centered FIT 390 x 844 portrait playfield, with pillarboxing
rather than width stretching. Shorter phones preserve that same aspect ratio.
Sector lighting is Level 1: Dawn / Dawn / Mid-Day / Mid-Day; Level 2:
Dawn / Mid-Day / Mid-Day / Dusk. Night is retained only as a future-level
preset. Continuous starts and stays Mid-Day. Soft 84 x 220 px headlights and roadside
sodium pools activate in Level 2 Sector 4 Dusk; hazard strobes brighten then.
In Dusk and the reserved Night preset, cargo pickup art (including its embedded
drop shadow) uses a slight neutral dimming (230/255 brightness) above the heavy
road mask; blue/gold pickup glows retain 90% of their normal pulsing intensity.
Dawn/Mid-Day/Overdrive presentation and the 35% rejected-pickup cue are preserved.
Road cargo has no coin/value/load annotation underneath, in normal play or the
steering sandbox. Pickup rasters, embedded shadows and pulsing glows are unchanged
by label removal; cargo values, collection feedback and HUD totals remain active.
All road collectible bodies (four cargo sizes, Blueprints and converted Blueprint
coin stacks) render another 5% smaller than the preceding 95% presentation:
90.25% of the size before both reductions. The separate under-pickup
shadow/glow layers retain their original size and offset. This applies in normal
play and the sandbox; collision/collection ranges, trailers and HUD/menu art
remain unchanged.
Active-run Standard and Swift truck art is 5% larger than its prior scale,
including every equipped finish; menu previews and trailer art are unchanged.
The Large (20-value) cargo pickup's cyan center is now orange, distinct from
the blue Blueprint pickup. Its neutral casing and transparency are preserved.
Sector/Depot bursts are 1.8 s visual
cues, not gameplay speed multipliers. Shadows follow each rotated silhouette.
The running HUD is a fixed three-column 70 px band with Hull and shield pips.

Explicit URL flags enable internal God/bot/warp/unlock/fast tools with
**temporary in-memory progress**. Approved fast mode is 3.5x. God plus bot
completed a desktop Level 2 inspection in 58.40 s; **bot-only browser full
clearance remains blocked**. Debug tools are not balance/player certification.
See [URL procedures](TEST_PLAN.md#internal-url-inspection).

## Audio and haptic feedback

Engine noise is removed per the 2 November owner revision. High-quality
engine audio will be considered later; there is no replacement loop, engine
oscillator or velocity-driven audio during driving, docking or launch.
Other sounds and haptics remain enabled. Real pointer/keyboard interaction
unlocks playback; background music runs only during Normal runs at the previous
SFX master level (0.35), while the SFX master is raised 50% to 0.525. Browser
restrictions do not block play. Stronger impacts, air brakes and short UI clicks
retain shared output compression. No extra AudioContext or gameplay speed change.
The focused engine-removal gate passes **16/0**; the earlier Slice 5 **13/0**
and audio/road/input/lifetime/Depot **93/0** results are historical.

Each accepted crate plays a C4/D4/E4/G4/C5 chime. This is audio only, not a new
scoring multiplier. Hull/shield impacts combine a sub-bass drop and filtered
noise crunch; held wall grinds add a rate-limited metal scrape. Completed Depot
arrival plays a filtered whoosh followed by a two-note chime.
Actual braking entry gets one air-brake burst. Confirmed shared button/tile
actions play one click after the action; drags, aborted/foreign/repeated releases
do not. Bypass, panel repaint, immune overlaps and harmless grinding do not
replay impact/braking/arrival feedback.

Supported browsers vibrate 15 ms per lane crossing, 30 ms per crate,
80 ms total double-pulse `[30,20,30]` on impact (including pause), and 200 ms
at docking. Browser/OS decides intensity; desktop/unsupported-device fallback
is no vibration. Feedback mutes/cancels when paused, asleep, hidden or blurred,
and cleans up on scene shutdown. No added currency, settings, SDK or save state.
Human sound/mix and real-device haptic acceptance remain **PENDING**.

## Not released / not authorized

Local build label remains `mobile-20261024-06`; the last recorded public label
is `mobile-20261024-01`, not newly verified by this audit. No push/deployment,
Android packaging, Level 3, new tiers, seasonal art, new chassis, contracts,
ads or analytics are implemented or authorized here. Slice 5's scoped synthetic
audio/browser haptics above are implemented, not release certification.
Human touch-device and V1-V4 experience acceptance remain PENDING.
