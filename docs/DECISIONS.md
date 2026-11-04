| Title/input/audio | Ordinary startup begins on the silent, full-frame-fitted `LoadIn_Screen.mp4`. First touch classifies mobile; mouse/key classifies desktop. No audio before interaction. `BG_Music.mp3` loops only for Normal runs at 0.35; SFX master is 0.525 (+50%). Preserve the shared context, 12-voice cap and bounded lifecycle. |
| Slice 5 feedback | Reuse Phaser's shared Web Audio context/master destination with real pointer/keyboard unlock. Engine noise remains removed; high-quality engine audio deferred. Each accepted crate plays C4/D4/E4/G4/C5; Hull/shield hits use sub-bass and filtered-noise crashes; held wall grinds use rate-limited metal scrapes; completed Depot arrival uses a filtered whoosh and two-note chime. Once-only air brake, confirmed button/tile clicks and shared effects compression remain. Browser haptics 15/30/80-total-double/200 ms for lane/pickup/impact/dock; no native dependency or save preference. Twelve-voice cap and bounded lifecycle remain; actual listening/phone acceptance pending |
# Hazardous Haul - Active Decisions and Overrides

Updated 4 November 2026. Latest explicit owner decisions outrank superseded
guide examples; live code establishes what actually runs. Neither old docs nor
failing tests authorize an unrequested behavior change.
See [design](GAME_DESIGN.md), [architecture](ARCHITECTURE.md),
[test procedures](TEST_PLAN.md) and the [current audit](../AUDIT_REPORT.md).

## Current locked direction

- Browser gaming sites first, mobile secondary; preserve one-thumb continuous
  steering alongside desktop mouse/keyboard controls, automatic forward travel,
  meaningful carried-weight/cargo-value/Depot risk decisions.
- One seeded generator and physical connected validator for the two implemented
  levels/modes. No wallet/rank-based hidden difficulty, duplicate gameplay owners
  or geometry derived from decorative pixels.
- Preserve deployed/tester progress and current work. No silent reset, pricing
  change, feature invention, push, deployment or Level 3 implementation.
- Coins equipment economy and separate Blueprint chassis economy remain.
  No forced ads, pay-to-win, waiting/streak punishment, analytics/backend or
  accounts. Optional earned ads require a real future SDK callback, not simulated
  rewards; none is currently integrated.
- Keep human/mobile checks PENDING until observed. No build/test/bot result is
  player-experience or release certification.

## Overrides preserved from current owner work

| Area | Current override |
| --- | --- |
| Route topology | Owner update (4 November): both implemented levels have four equal 1,000 m sectors, ending at 4,000 m; Sector 3 checkpoint at 2,000 m |
| Finish clearance | Normal runs remove all roadway hazards at 10 m before the level finish and do not spawn hazards at or beyond that point. Continuous Run has no finish boundary; cargo and Blueprint pickups are unchanged |
| Pause End Run | The pause menu can end either run after confirmation. Show banked-this-run coins and the unbanked amount at risk. Normal loses the unbanked hold/bonuses; Endless uses the existing 25% wreck retention, not a mid-run cash-out. Wallet funds remain secure |
| Run navigation | Four home buttons: Normal Run / Endless Run / Garage & Upgrades / How-To. Owner confirmed level cards with titles above paired Sector 1 and Checkpoint - Sector 3 tabs; enabled tabs launch immediately from the level list. No Normal mode/start/reward confirmation screens. Checkpoints stay grey/locked per level; non-playable Coming Soon cards for Levels 3-5 only. Endless overview gives only endless increasing speed, no mid-run banking, passed-Depot +10% cargo bonus capped +100%, and stopping to cash out/end; no starting settings or technical pacing. Existing Level 1 completion unlock and internal `continuous` gameplay rules are unchanged |
| Active modes / speed | Normal campaign only per level; separate Continuous Run unlocked after Level 1. Single MAX_TRACK_SPEED 680 owner. Smooth campaign sector-start interpolation: L1 320/350/380/410, L2 350/380/410/440; L4S4 680 is future-only. Continuous starts 0 m with L1S2 challenge/pickup baseline, Mid-Day Industrial, speed 350 +40 per 1,000 m capped 680. No inherited per-level Overdrive density/spacing stages; three-clear-event baseline. Saved Overdrive records stay historical |
| Continuous economy | Depots every 1,000 m; each passed Depot +10 additive percentage points capped at 100%. Stopped End Run cashes out terminally; stopped Skip restores equipped shields and continues without banking. Center bypass never recharges. No bank-and-continue/repair. Wreck retains floor(25% current cargo Coins), no Depot bonus. Only current hold at settlement, not lifetime collected value; exclude Blueprint/distance/completion/no-damage rewards and campaign progress |
| Themes | Level 1 Industrial / Level 2 Dustlands; sector position drives difficulty/cargo, not artwork |
| Side hazards | 3-6% emitted collision bodies, target 4.5%; one-lane modular walls; opposite starts staggered |
| Chicanes | Entry + full middle + exit, approved extra 54 px transition; mirrored entry artwork Lane 0 flipped / Lane 3 unflipped |
| Collisions | Lead cab only; glancing wall grind does not damage, entry-lip/head-on still does |
| Slice 2 geometry override | Latest owner reduced the widened cab width by 5%: 26.4 -> 25.08 px, height stays 32 px (half-width 12.54). This supersedes the earlier 10% widening result, not the artwork. Cargo-only collection thresholds 36 x 48 px (20% larger); Blueprint pickup, Magnet attraction range and artwork/shadows unchanged. Exact Slice 2 and seven-test generator gates required |
| Close-call economy | Once per clean passing physical instance at 15-25 px minimum surface gap, while carrying cargo: +5 separate percentage points capped +50%, current surviving hold only. Hull-damaging or shield-absorbed hits reset the unbanked bonus to zero; harmless wall grinding and invulnerable overlaps do not. A hit wins over clean passes in the same frame. Add to existing Depot payout without compounding Depot/clean-run bonuses; Normal bank resets it. No Normal or Endless wreck payout, no immediate profile writes |
| Cargo presentation | Five-frame time-normalized history lag; 18 px maximum cab-relative displacement and 8-degree absolute/cab-relative rotation, attached drawbars, y + 2 px / 0.5 silhouette shadows; no physics changes |
| Obstacle purge | Owner selected active hazard-kind remapping and normal recertification, not merely reskinning unsupported hitboxes. Container -> Barrier; machinery/wreckage -> Rock Slab; procedural future/fallback pool entries removed. Preserve authored 126 rows / 252 bodies, quotas and retired-pylon policy |
| Challenge boundary / fillers | Structural families live in challengeProfiles.js and are selected by challengeProfileId, independently from visualThemeId. Industrial fillers use existing Barrier/Rock Slab/Signal Cabinet art; no pylon reinstatement |
| Menu text centering | Latest owner centers all menu/card/tile text in its padded region, keeping two-column truck cards with text centered in its column beside the image. Upgrade text shares its image center line. Title/subtitle button and tile stacks are vertically centered; coin-image amounts stay grouped. Shared card title origin is center/top at the same 16 px top / 12 px side inset. Preserve 12 px gaps, 35%/30% peeks, measured-header accumulator, prices, saves and gesture protections |
| Fairness reference | Stock Standard at half live capacity, 0.8 s reaction, >=6 px connected clearance; do not restore obsolete universal full-load guarantees |
| Persistence / Slice 6 | Preserve schema 11 and the deployed key. Hint seen-state commits only after save success. Startup recovery reports an error toast; preserve raw unreadable saves and earlier distinct backups before allowing a replacement. Failed backup blocks writes until backup retry succeeds; failed reads block writes until a successful reload. Do not reset tester storage. The stale five-socket/Traction Cleats/automatic Swift language in the slice prompt does not override the current six-slot roster, future-gated grandfathered Impact Pulse or six-Blueprint Swift purchase |
| Slots | Six actual slots per ship; Standard starts two, Swift three; owner chose all six visible in one compact socket row |
| Swift | Current config: six Blueprints after Level 2 unlock, 1.30x steering, -4 cargo capacity |
| Colors | Per-truck preview/purchase/equip; paid 750-Coin trims; achievement-only Gold visible only for Standard |
| Shield / Slice 3 implemented | Existing `def_shield` is Depot Shield, three ranks/charges; starts full, no timed/bypass regeneration. Latest owner explicitly chose indicated-side-only docking, superseding both outer lanes; subsequent owner revision lowers required physical cab-width intersection from 75% to >=50% with that approach bay at the interpolated braking-line crossing. Use canonical dimensions, not sprite scale. Dock over 1.5 s, stopping exactly under the canopy. Braking start derives from the existing smoothstep integral; any out-of-bay bypass counts only at the actual gate. Depot-side indicators appear within 60 m and chevrons terminate at the site. Normal arrival recharges shields but leaves cargo unbanked for manual Bank & Continue / Bank & End Run. After Bank & Continue, show only disabled Cargo Secured, Resume Run and Repair Hull. Failed banking blocks exits/services until retry. Hide HUD throughout maintenance/confirmation; restore on resume. Endless has no mid-run banking; stopped End Run or Skip, recharge on Skip only. Bypass never recharges; resume ramps over its 1 s protection window |
| Performance / road clarity / scaling | Latest owner strict-preallocation revision (2 November): all route hazard/guardrail/attachment/cargo/Depot images, drop shadows, road TileSprites and skid slots are precreated in fixed Phaser Groups at scene load; get/killAndHide reuse only, no first-use expansion. Conservative descriptor-derived capacities: 3,005 Images / 70 Containers / 4 TileSprites. Explicit error on exhausted/missing pools or active-phase texture baking; never skip hazards or create late fallback textures. Audited trackGenerator remains Phaser-free/data-only. Preserve Phaser-first shutdown safety. Solid roadbed, 0.7x multiply Industrial grunge/additive Dustlands dust; four alpha-0.15 skid segments only inside indicated-side Depot braking approaches, no past-site extension; fine cracks/seams/shoulder rubble baked into base roads. Fixed 390 x 844 FIT/CENTER_BOTH, no CSS stretch; unchanged geometry, saves and pace. No claim that all JS/particle/text allocation, generator cost or device jitter is solved |
| Art | Preserve supplied gameplay/display/upgrade/guardrail sprites and silhouette shadows; do not resurrect pylons or retired shadow instructions |
| Garage clarity | Matching supplied sprites in cards, details and purchase confirmations; simple descriptions and exact current/next/max bonuses. Separate titles/wallets, readable card padding and stats below truck art. Presentation only: preserve all prices, progression gates, effects and saves |
| Lighting | Level 1 Dawn/Dawn/Mid-Day/Mid-Day; Level 2 Dawn/Mid-Day/Mid-Day/Dusk. Reserve Night for future levels. Keep softer 84 x 220 headlights/strobes/pools and 1.8 s visual bursts; no pace changes |
| Slice 5 feedback | Reuse Phaser's shared Web Audio context/master destination with real pointer/keyboard unlock. Engine noise remains removed; high-quality engine audio deferred. Each accepted crate plays C4/D4/E4/G4/C5; Hull/shield hits use sub-bass and filtered-noise crashes; held wall grinds use rate-limited metal scrapes; completed Depot arrival uses a filtered whoosh and two-note chime. Once-only air brake, confirmed button/tile clicks and shared effects compression remain. Browser haptics 15/30/80-total-double/200 ms for lane/pickup/impact/dock; no native dependency or save preference. Twelve-voice cap and bounded lifecycle remain; actual listening/phone acceptance pending |
| Low-light cargo | Dusk/Night cargo art and embedded shadows remain readable above the road mask with 230/255 neutral brightness and 90% pulsing blue/gold glows; preserve daylight and rejected-pickup cues |
| Pickup labels | No coin/value/load annotations beneath road cargo in normal play or sandbox; keep the actual pickup visual, HUD totals and collection feedback |
| Collectible size | Road cargo, Blueprints and converted reward bodies are another 5% smaller (0.95 x 0.95 = 0.9025 of pre-reduction presentation); separate under-pickup shadow/glow layers retain their original size and offset. No change to collision ranges, trailer or UI art |
| Run truck size / Large pickup color | Standard/Swift active-run truck artwork is 5% larger, preserving trim selection, hitboxes, suspension and menu previews. Large cargo core changes cyan to orange during cached texture baking; neutral casing/alpha and Blueprint artwork stay unchanged |
| Level 2 movers / latest owner revision (2 November) | **Supersedes the Slice 4 Level 2 Sweeper.** Level 2 generates lateral Forklifts only: 0.5 s beacon warning, then patrol three contiguous lane centers where static geometry permits, otherwise two. Level 3 will introduce the forward/vertical mover as a StreetSweeper with its own sprite; Level 3 is not implemented or authorized. Retain the Sweeper hazard definition, motion projection, art entry, pool bound and unit fixtures for that future owner, but never select it in Level 2. With the current equal-length sectors, Sector 2 starts at 1,000 m; eligible quota intervals are 1,000-2,000 / 2,000-3,000 / 3,000-4,000 m, with 4-14 bodies, 40 m separation and connected certification unchanged |
| Route planning / jitter (2 November) | Owner requires zero in-run loading pauses. Root cause measured: synchronous `trackStream.nextRow` planning on the render thread (up to 44 ms per spawn in browser). Keep one generator: exact validator hoisting (hash-identical) plus deterministic off-thread planning through the existing stream owner (Web Worker producer 48 rows ahead, follower replay for Depot reset, synchronous fallback where Workers are unavailable). Level-select prepares checkpoint streams. No seed/route/geometry change and no skipped validation. Human/device jitter acceptance remains PENDING |
| Level 2 movers / Slice 4 (historical; Sweeper superseded) | The original Slice 4 proposal used Forklifts and Sweepers. Its old 500/1,500/3,000/5,000 m windows are superseded by the current equal 1,000 m sector boundaries above. Level 2 currently selects lateral Forklifts only; Level 1 remains static-only |
| URL tools | Explicit true flags only; all URL-debug progress temporary; `fast=true` approved at 3.5x after measured 2x full-route times exceeded 100 s |
| Documentation | Four canonical design/architecture/test/decision docs; current handoff evidence in root AUDIT_REPORT. The later owner-supplied ImplimentationPan.md governs six-slice polish sequencing, not a claim that its proposed features already run |

## Specification conflicts still unresolved: do not silently fix

Slices 1-3 have passed their scoped gates. Slice 6 was closed by the owner on
4 November; the full suite had two deferred failures and the production build
passed. The [audit report](../AUDIT_REPORT.md) is the source for exact current
results and remaining findings. Earlier gate failures below are historical.

Latest owner renewal: commercial Slice 1 may use conditional 8-to-16 certified
proposal selection and the specified 0.6 occupancy multiplier. The density fixture
now uses actual 0-4,000 m / 1,000-4,000 m windows with independently proportional
limits <107.437701 / <75.793677 s. Actual launch lead-in is included, rather than
reusing the old 9 m sampling start. The later witness-selection task authorizes
restoring Correction 1's variant multiplicity, differentiating sustained bodies,
read-only pool tracing and complete future-witness credit. Latest scoring uses
physical structural span, per-meter normalization, a sustained witness bonus and
a certified successor-trajectory shortlist within existing admitted sixteen-proposal pools.
Observed and committed-future coverage remain distinct; budget values/trigger,
safety and quota policy are unchanged. The latest owner authorized one-step
lookahead through the same composer in cloned contexts with forked PRNGs, scoring
current physical score plus maximum valid successor physical score. No recursive
trajectory lookahead, extra budget, relaxed certificate or parallel generator.
Final gate 7 PASS / 0 FAIL, 258.165 s, 106.063712 / 75.666741 s, including the
explicit non-greedy regression. Slice 1 and the corresponding seven-test mode D
gate are complete. Broader gates and human/device checks remain
pending. History below records older checkpoints, not the active
window or permission to waive quotas, pressure or clearance.

1. **Depot/repair proposal versus implementation.** The earlier v4 roadmap asked
   for one bank per run, service without skip bonus, a finite paid-repair budget
   and one collectible repair/voucher. Current code still banks/repairs per visit,
   has no free-repair pickup; Continuous uses its separately authorized cash-out/pass rules. Record this as
   an unfinished workstream requiring a dedicated owner-approved behavior task.
2. **Future tiers versus Reinforced Cargo.** Tier 2 was proposed after genuine
   Level 3 completion and Tier 3 after Level 7, with prior-line mastery and one
   occupied slot per line. Current Reinforced Cargo is already available after
   Cargo rank 8. Do not disable purchases, add effects, alter saves or fabricate
   higher-tier prices during hygiene work.
3. **Deferred route-quality findings.** The current known-good generator keeps
   certified fallbacks and the approved physical thresholds. The two remaining
   quality findings and their attempted-but-reverted fixes are recorded in the
   audit report; do not change safety, quota, occupancy or clearance requirements
   without a bounded, owner-authorized task.
4. **Bot reliability.** God/bot/fast desktop inspection completes the route.
   Bot-only browser seed 3118819693 reaches Sector 4 but crashes near 4,541 m,
   while its stubbed full-clear regression passes. Real timing/load paths require
   investigation. Never silently enable God or waive collisions to obtain a pass.
5. **Future catalog reachability.** Impact Pulse has a live effect/legacy saves
   but new purchases require unimplemented Level 4. Armoured/Prospector/Apex and
   many catalog modules are future/tested scaffolding, not disposable dead code
   or permission to make them playable.
6. **Concurrent tabs and receipt growth.** Hint failure handling and unreadable
   save backup protections are implemented. Cross-tab overwrite and growing
   receipt risks still need focused follow-up. No schema reset or migration
   deletion is authorized by this audit.

## Workstream and evidence discipline

The former guide's ordered plan is retained as a **pending roadmap**, not a
claim of completion:

`T1 -> A1 -> T2 -> T3 -> T4 -> T5 -> A2 -> T6 -> S1-S4 -> E1-E4 -> D1-D4 -> C1-C3 -> G1-G3 -> F1-F3 -> V1-V4`

Track gates cover deterministic encounters, connected geometry, quotas,
Depot clearing/lifetime and theme independence; later gates cover Depot/repair,
equipment/saves, measured difficulty, economy and Garage. Skip only completed
chunks with traceable evidence. Use scoped tests for each bounded change; full
workstream checks at gates; full tests/build at F3 or when explicitly requested.
Do not advance a mandatory failed gate. Limit focused correction attempts and
report unresolved blockers; do not restart a broad audit on every small task.

This audit does not repair those workstreams or certify a 10,000-encounter gate.
The owner-supplied [polish plan](ImplimentationPan.md) records the six-slice
execution history. Slices 1-3 passed their scoped gates; Slice 6 is closed by
owner decision on the known-good generator. See the [audit report](../AUDIT_REPORT.md)
for the latest full-suite/build result, deferred route-quality findings, and
pending human/device acceptance. Preserve physical proofs, pressure, quotas and
clearance requirements in any future generator task.

Before later slices, resolve significant behavior conflicts rather than
silently replacing implemented owners. The owner has now approved distinct
Sweeper/Forklift motion for Slice 4 and explicitly retained Level 1 Sector 2
Dawn; approved speed curves and themes remain unchanged. Preserve the current
six sockets/eight modules/Impact Pulse, not the old five-socket/Traction Cleats
proposal. Close-call stacking and mode-specific Depot service were resolved
explicitly in Slices 2-3 and their follow-ups.
Run each slice's scoped gate before advancing; full tests/build belong to Slice 6.

## Future backlog: recorded, not implemented

Historical scoped checkpoint (superseded by the current audit status):
Slice 2 gate 17/0 plus canonical-width boundary recertification **7/0**,
242.783 s. Density 105.567151 s overall / 75.189383 s late PASS; only the two
authorized fixtures changed, not geometry/thresholds. Slice 3 now passes its
18/0 Depot gate plus 68/0 related regressions; latest generator rerun 7/0,
239.560 s and exact Slice 2 regression 17/0. Later full-suite/build status is in
the audit report; human testing remains pending.

After engineering and V1-V4 player gates, separately scope Level 3 using Tier 1,
then data-driven optional contracts/personal records, further audio/onboarding
polish, fair local shared-seed challenges/shareable results and later tiers/
chassis. Privacy, Android packaging and optional rewarded ads are later release
decisions, not dependencies of normal play.

Planned Apex boosts only beneficial numeric effects of equipped modules by 25%;
not base stats, drawbacks or payouts. Its prerequisites/BP substitution helpers
remain tested. Future Prospector/Apex utility and viable earlier chassis need
their own product decision before implementation.

## Maintenance rule

Keep only these four authorities in docs. Update the relevant rule/owner/check
document when a decision changes, and record actual current results/blockers in
the root audit/report requested for that task. Do not reintroduce competing
phase guides, backup source trees or unverified "all tests pass" claims.
