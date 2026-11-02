/**
 * Headless balance simulation: a human-like bot drives the real pure rules
 * (track generator, steering, route speed, row spacing, hit rules).
 * Usage: npm run sim:balance [-- runs=400]
 * The bot is a rough proxy for a player, not a substitute for playtesting.
 */
import {crashReward, METERS_PER_PIXEL, routeSpeedAtDistance} from '../src/game/core/economy.js';
import {
  addMilestones, buyModule, cargoCapacityStatus, loadoutStats, milestonesForDistance,
  moduleStatus, nextSlotOffer, unlockNextSlot, upgradeCargoCapacity, upgradeModule,
} from '../src/game/core/modules.js';
import {defaultProfile} from '../src/game/core/save.js';
import {SECTORS, ROUTE_END_DISTANCE_M} from '../src/game/data/catalog.js';
import {advanceSteering} from '../src/game/core/steering.js';
import {cargoOffer, cargoTotals, collectCargo, damageCargo} from '../src/game/core/cargo.js';
import {HAZARD_ROW_ENVELOPE_PX, hazardHits, hazardX, hazardGeometry, LANE_CENTERS as LANES} from '../src/game/core/hazards.js';
import {ROAD_LEFT, ROAD_RIGHT, SHIP_Y, SPAWN_Y} from '../src/game/data/route.js';
import {DEPOT_RULES, nextDepotAfter, depotEntryAllowed, depotApproachMeters} from '../src/game/core/depots.js';
import {bankingQuote, createRunEconomy, skipDepot} from '../src/game/core/depotEconomy.js';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';
import {
  CARGO_COLLISION_DISTANCE_PX,
  createSeededRandom,
  createTrackStream,
  hazardsBeforeDepot,
  resumeSpawnDelay,
  rowSpacingAtSpeed,
  WORST_CASE_LANE_CLEAR_SECONDS,
} from '../src/game/core/trackGenerator.js';

const H = GAME_BALANCE.routes.geometry.logicalHeightPx;
const VERTICAL_HIT = GAME_BALANCE.physics.collision.cargoHalfHeightPx, DT = 1 / 60;
const SECTOR_ENDS = [...SECTORS.slice(1).map(sector => sector.startsAt), ROUTE_END_DISTANCE_M];

const gauss = (rand, mean, sd) =>
  mean + sd * Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Skill profiles: reaction (s), notice distance above ship (px), dodge timing jitter (s), aim error (px). */
export const PLAYERS = {
  newcomer: {reaction: 0.34, reactionSd: 0.08, notice: 330, noticeSd: 90, dodge: 0.06, dodgeSd: 0.11, aimSd: 7},
  improving: {reaction: 0.305, reactionSd: 0.07, notice: 380, noticeSd: 85, dodge: 0.05, dodgeSd: 0.095, aimSd: 6},
  practised: {reaction: 0.27, reactionSd: 0.06, notice: 430, noticeSd: 80, dodge: 0.04, dodgeSd: 0.08, aimSd: 5},
};

/** Legacy comparison loadout, mapping former Expanded Hold levels to equivalent new cargo ranks. */
export function starterStats(level, extra = {}) {
  const capacityRankByLegacyLevel = [2, 3, 4, 4, 5, 7];
  const ownedModules = {hand_precision: level, ...extra};
  const profile = defaultProfile();
  profile.cargoCapacityRank = capacityRankByLegacyLevel[Math.min(5, Math.max(0, level))];
  profile.ownedModules = ownedModules;
  profile.shipStates.standard = {...profile.shipStates.standard, unlockedSlotCount: 6,
    equippedModuleIds: Object.keys(ownedModules)};
  return loadoutStats(profile);
}

export function simulateRun({seed, stats, player, greed = 0.75, maxDistance = ROUTE_END_DISTANCE_M, bankAtDepot}) {
  const rand = createSeededRandom(seed ^ 0xa5a5a5a5);
  const stream = createTrackStream(seed);
  const {capacity, handling, loadRelief, insurance, shieldCooldown, cargoMitigation} = stats;
  let shieldReady = shieldCooldown > 0, shieldTimer = 0;
  let x = LANES[1] + 36, vx = 0, targetX = x, distance = 0, time = 0;
  let hull = stats.hull, invulnerable = 0, load = 0, value = 0,
    spawnTimer = GAME_BALANCE.routes.spawning.initialRowDelaySeconds;
  let cargoItems = [];
  let runEconomy = createRunEconomy();
  const metrics = {firstFullHoldSeconds: null, sectorSeconds: {}};
  const syncCargo = () => {
    const total = cargoTotals(cargoItems);
    load = total.mass;
    value = total.value;
    if (load >= capacity && metrics.firstFullHoldSeconds === null) metrics.firstFullHoldSeconds = time;
  };
  let decidedLane = 1, depot1Value = null, hits = 0, depot = nextDepotAfter(0), protectedUntil = 0;
  const firstDepotDistance = depot.distance;
  let nextDepot = depot.distance;
  const rows = [];

  while (distance < maxDistance) {
    time += DT;
    invulnerable = Math.max(0, invulnerable - DT);
    if (!shieldReady && shieldCooldown > 0 && (shieldTimer -= DT) <= 0) shieldReady = true;
    const scroll = routeSpeedAtDistance(distance);
    const priorDistance = distance;
    distance += DT * scroll * METERS_PER_PIXEL;
    for (const sector of SECTORS.slice(1)) {
      if (distance >= sector.startsAt && metrics.sectorSeconds[sector.id] === undefined) metrics.sectorSeconds[sector.id] = time;
    }
    if (depot1Value === null && distance >= firstDepotDistance) depot1Value = value;
    if (distance >= nextDepot + DEPOT_RULES.triggerHalfMeters) {
      runEconomy = skipDepot(runEconomy);
      protectedUntil = nextDepot + DEPOT_RULES.exitMeters;
      depot = nextDepotAfter(nextDepot);
      nextDepot = depot.distance;
    }

    spawnTimer -= DT;
    if (spawnTimer <= 0) {
      const r = stream.nextRow(distance);
      rows.push({
        y: SPAWN_Y, hazards: (hazardsBeforeDepot(r, distance, nextDepot, protectedUntil) ? [...r.hazards, ...r.intermediates] : [])
          .filter(h => !h.continuation).map(hazard => ({...hazard, alive: true})), safe: r.safeLanes,
        pickups: r.pickups.map(p => ({...p, alive: true})),
        noticeY: SHIP_Y - Math.max(120, gauss(rand, player.notice, player.noticeSd)),
        readyAt: null, lane: null, dodgeDelay: gauss(rand, player.dodge, player.dodgeSd),
      });
      spawnTimer += r.spacingPx / scroll;
    }

    // Perception and decision: one lane per row, at most one lane change from the previous decision.
    for (const row of rows) {
      if (row.readyAt === null && row.y >= row.noticeY) {
        row.readyAt = time + clamp(gauss(rand, player.reaction, player.reactionSd), 0.15, 0.6);
      }
      if (row.lane === null && row.readyAt !== null && time >= row.readyAt) {
        const options = row.safe.filter(l => Math.abs(l - decidedLane) <= 1);
        const coinLane = rand() < greed
          ? row.pickups.find(p => p.alive && options.includes(p.lane) && cargoOffer(cargoItems, p, capacity).accepted)?.lane : undefined;
        row.lane = coinLane ?? (options.includes(decidedLane) ? decidedLane
          : options[Math.floor(rand() * options.length)] ?? decidedLane);
        row.aim = gauss(rand, 0, player.aimSd);
        decidedLane = row.lane;
      }
    }

    // Steering target: lane chosen for the next row; wait for the current row to pass when it blocks that lane.
    const pending = rows.filter(r => r.y - HAZARD_ROW_ENVELOPE_PX / 2 <= SHIP_Y);
    const current = pending[0];
    const next = pending[1];
    if (current?.lane != null) targetX = LANES[current.lane] + current.aim;
    if (current && next?.lane != null) {
      const blocksNext = current.hazards.some(h => h.alive &&
        hazardHits(h, hazardX(h), current.y + h.offsetY, LANES[next.lane], SHIP_Y));
      const passTime = (SHIP_Y + HAZARD_ROW_ENVELOPE_PX / 2 - current.y) / scroll;
      if (!blocksNext || passTime <= -next.dodgeDelay) targetX = LANES[next.lane] + next.aim;
    }
    if (nextDepot - distance <= depotApproachMeters(nextDepot) &&
        bankAtDepot?.({distance: nextDepot, hull, load, capacity, value})) {
      targetX = depot.side === 'left' ? ROAD_LEFT + 30 : ROAD_RIGHT - 30;
    }

    ({x, velocity: vx} = advanceSteering({
      x, velocity: vx, targetX: clamp(targetX, ROAD_LEFT + 30, ROAD_RIGHT - 30), dt: DT,
      minX: ROAD_LEFT + 30, maxX: ROAD_RIGHT - 30, load, capacity, handling, loadRelief,
    }));
    if (depotEntryAllowed(depot, distance, x, priorDistance)) {
      if (bankAtDepot?.({distance: nextDepot, hull, load, capacity, value})) {
        return {distance, depot1Value: depot1Value ?? value, hits, time, banked: true,
          value: bankingQuote(cargoItems, runEconomy).payout, ...metrics};
      }
      // The bot's non-banking policy chooses Push On if its path crosses the green entrance.
      runEconomy = skipDepot(runEconomy);
      protectedUntil = nextDepot + DEPOT_RULES.exitMeters;
      depot = nextDepotAfter(nextDepot);
      nextDepot = depot.distance;
      stream.resetAfterDepot(distance);
      rows.length = 0;
      x = targetX = (ROAD_LEFT + ROAD_RIGHT) / 2;
      vx = 0;
      const travel = SHIP_Y - HAZARD_ROW_ENVELOPE_PX / 2 - SPAWN_Y;
      spawnTimer = Math.max(resumeSpawnDelay(scroll, travel),
        (protectedUntil - distance - travel * METERS_PER_PIXEL) / (scroll * METERS_PER_PIXEL));
    }

    for (const row of rows) {
      row.y += scroll * DT;
      for (const p of row.pickups) {
        if (p.alive && Math.abs(row.y - SHIP_Y) < VERTICAL_HIT && Math.abs(LANES[p.lane] - x) < CARGO_COLLISION_DISTANCE_PX) {
          const collected = collectCargo(cargoItems, p, capacity);
          if (collected.accepted) {
            p.alive = false;
            cargoItems = collected.items;
            syncCargo();
          }
        }
      }
      for (const h of row.hazards) {
        if (h.alive && invulnerable <= 0 && hazardHits(h, hazardX(h), row.y + h.offsetY, x, SHIP_Y)) {
          h.alive = false;
          if (shieldReady) {
            shieldReady = false;
            shieldTimer = shieldCooldown;
            invulnerable = GAME_BALANCE.physics.collision.shieldInvulnerabilitySeconds;
            continue;
          }
          hull -= GAME_BALANCE.hazards.hullDamagePerHit;
          hits += 1;
          invulnerable = GAME_BALANCE.physics.collision.hitInvulnerabilitySeconds;
          cargoItems = damageCargo(cargoItems,
            GAME_BALANCE.cargo.hitValueLossFraction * (1 - insurance), cargoMitigation).items;
          syncCargo();
          if (hull <= 0) return {distance, depot1Value: depot1Value ?? 0, hits, time, banked: false, value: 0, ...metrics};
        }
      }
    }
    while (rows.length && rows[0].y + Math.min(0, ...rows[0].hazards.map(h =>
      h.offsetY - hazardGeometry(h).height / 2)) > H + 60) rows.shift();
  }
  return {distance, depot1Value: depot1Value ?? 0, hits, time, banked: false, survived: true, value, ...metrics};
}

const lerpPlayer = (a, b, t) => Object.fromEntries(Object.keys(a).map(k => [k, a[k] + (b[k] - a[k]) * t]));

/** Spends coins in a typical order: starters to Lv 2, slot 3, Plating, then the lowest equipped module. */
function shop(profile) {
  for (;;) {
    const level = id => profile.ownedModules[id] ?? 0;
    const offer = nextSlotOffer(profile);
    let result = null;
    if (cargoCapacityStatus(profile).rank < 2) result = upgradeCargoCapacity(profile);
    else if (level('hand_precision') < 2) result = upgradeModule(profile, 'hand_precision');
    else if (offer?.slot === 3 && offer.reached) result = unlockNextSlot(profile);
    else if (moduleStatus(profile, 'def_plating').unlocked && !level('def_plating')) result = buyModule(profile, 'def_plating');
    else {
      const upgradable = profile.shipStates.standard.equippedModuleIds
        .filter(id => !moduleStatus(profile, id).capped && !moduleStatus(profile, id).atMax)
        .sort((a, b) => level(a) - level(b));
      if (upgradable.length) result = upgradeModule(profile, upgradable[0]);
    }
    if (!result?.ok) return profile;
    profile = result.profile;
  }
}

/** A player who improves from newcomer to practised over 20 runs, banks, and buys modules. */
export function simulateCareer(careerSeed, maxRuns = 25) {
  let profile = defaultProfile(), earned = 0;
  const career = {firstClear: null, clearLevels: null, firstDepot: null, bothL2: null, plating: null};
  for (let run = 1; run <= maxRuns; run++) {
    const player = lerpPlayer(PLAYERS.newcomer, PLAYERS.practised, Math.min(1, (run - 1) / 19));
    const result = simulateRun({
      seed: careerSeed * 131 + run * 7919, stats: loadoutStats(profile), player, maxDistance: SECTOR_ENDS[0],
      // Bank early when damaged or heavy; otherwise press on toward the Sector 1 finish.
      bankAtDepot: ({distance, hull, load, capacity}) => distance >= SECTOR_ENDS[0] || hull <= 1 || load >= capacity,
    });
    if (result.banked && career.firstDepot === null) career.firstDepot = run;
    if (result.distance >= SECTOR_ENDS[0] && career.firstClear === null) {
      career.firstClear = run;
      career.clearLevels = Math.min(cargoCapacityStatus(profile).rank, profile.ownedModules.hand_precision);
    }
    const payout = result.banked ? result.value : crashReward(result.distance);
    profile = addMilestones({...profile, coins: profile.coins + payout},
      [...milestonesForDistance(result.distance), ...(result.banked ? ['depot1'] : [])]).profile;
    earned += payout;
    profile = shop(profile);
    if (Math.min(cargoCapacityStatus(profile).rank, profile.ownedModules.hand_precision) >= 2 &&
        career.bothL2 === null) career.bothL2 = run;
    if (profile.ownedModules.def_plating && career.plating === null) career.plating = run;
  }
  return {...career, coinsPerRun: earned / maxRuns};
}

const pct = v => `${(v * 100).toFixed(0).padStart(3)}%`;

function main() {
  const runsArg = process.argv.find(a => a.startsWith('runs='));
  const runs = runsArg ? Number(runsArg.split('=')[1]) : 400;
  console.log(`Worst-case lane clear: ${WORST_CASE_LANE_CLEAR_SECONDS.toFixed(3)} s`);
  console.log('Pace:', [0, 450, ...SECTOR_ENDS].map(d => {
    const v = routeSpeedAtDistance(d), s = rowSpacingAtSpeed(v);
    return `${d}m ${v.toFixed(0)}px/s gap ${((s - 80) / v).toFixed(2)}s`;
  }).join(' | '));
  for (const [name, player] of Object.entries(PLAYERS)) {
    console.log(`\n${name}`);
    for (const [label, stats] of [
      ['starters L1', starterStats(1)], ['starters L2', starterStats(2)],
      ['L2 + Plating L1', starterStats(2, {def_plating: 1})], ['starters L3', starterStats(3)],
    ]) {
      const results = Array.from({length: runs}, (_, i) =>
        simulateRun({seed: 1000 + i * 7919, stats, player}));
      const reach = SECTOR_ENDS.map(end => results.filter(r => r.distance >= end).length / runs);
      const median = [...results].sort((a, b) => a.distance - b.distance)[Math.floor(runs / 2)];
      const depotCoins = results.reduce((sum, r) => sum + r.depot1Value, 0) / runs;
      console.log(`  ${label.padEnd(16)} clear S1 ${pct(reach[0])}  S2 ${pct(reach[1])}  S3 ${pct(reach[2])}  S4 ${pct(reach[3])}` +
        `  | median ${median.distance.toFixed(0)} m  | avg coins held @450m ${depotCoins.toFixed(0)}`);
    }
  }
  const careers = Array.from({length: Math.max(50, Math.floor(runs / 2))}, (_, i) => simulateCareer(i + 1));
  const median = key => {
    const values = careers.map(c => c[key]).filter(v => v !== null).sort((a, b) => a - b);
    return values.length ? `${values[Math.floor(values.length / 2)]} (${pct(values.length / careers.length)} reach it in 25 runs)` : 'never';
  };
  console.log(`\ncareer (newcomer -> practised over 20 runs, banking + buying modules), ${careers.length} careers:`);
  console.log(`  avg Coins earned per run: ${(careers.reduce((s, c) => s + c.coinsPerRun, 0) / careers.length).toFixed(0)}`);
  console.log(`  run of first Sector 1 clear: median ${median('firstClear')}`);
  console.log(`  run of first Depot bank: median ${median('firstDepot')}`);
  console.log(`  run when both starters reach L2: median ${median('bothL2')}`);
  console.log(`  run when Plating is bought: median ${median('plating')}`);
  console.log(`  starter level at first clear: median ${median('clearLevels')}`);
}

if (process.argv[1]?.endsWith('balance-sim.mjs')) main();
