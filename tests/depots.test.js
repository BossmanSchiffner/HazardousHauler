import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {DEPOT_ENTRANCE_GEOMETRY, DEPOT_RULES, MOVER_WINDOW_RULES, nextDepotAfter, nextMoverWindowAfter, depotEntryBounds,
  depotEntryAllowed, depotDockingStart, depotMotionStep, depotWorldY, depotPaletteStep, depotApproachMeters} from '../src/game/core/depots.js';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';
import {ROAD_LEFT, ROAD_RIGHT} from '../src/game/data/route.js';
import {balance} from '../src/game/data/balance.js';
import * as depotEconomy from '../src/game/core/depotEconomy.js';
import {cargoTotals} from '../src/game/core/cargo.js';
import {hazardsBeforeDepot, prepareTrackChunk, CHUNK_REGISTRIES, depotResumeFirstDistance,
  depotApproachRow} from '../src/game/core/trackGenerator.js';
import {HAZARD_TRAVEL_PX, SHIP_Y} from '../src/game/data/route.js';
import {HAZARD_ROW_ENVELOPE_PX, hazardGeometry, hazardScrollScale, obstacleLaneMask} from '../src/game/core/hazards.js';
import {METERS_PER_PIXEL, routeSpeedAtDistance} from '../src/game/core/economy.js';
import {advanceSteering, KEYBOARD_BRAKE_SECONDS} from '../src/game/core/steering.js';
import {WORST_CASE_HANDLING} from '../src/game/core/modules.js';
import {defaultProfile, normalizeProfile, SCHEMA_VERSION} from '../src/game/core/save.js';
import {simulateRun, starterStats, PLAYERS} from '../scripts/balance-sim.mjs';
import {IMPLEMENTED_SECTORS} from '../src/game/core/sectors.js';
import {sectorAtDistance, IMPLEMENTED_LEVELS} from '../src/game/core/sectors.js';
import {MAX_TRACK_SPEED, continuousStageAtDistance, routeFinishDistance} from '../src/game/core/economy.js';
import {PALETTE, SPRITE_ART_SCALE} from '../src/game/rendering/industrial.js';
import Rectangle from 'phaser/src/geom/rectangle/index.js';
import {releaseRouteVisual} from '../src/game/rendering/routeVisualPool.js';

test('depot schedules follow campaign transitions or each global continuous 2000m stage', () => {
  for (const levelId of Object.keys(IMPLEMENTED_LEVELS)) {
    let distance = 0;
    const normal = [];
    const expected = GAME_BALANCE.routes[levelId].sectorEndsMeters.slice(0, -1);
    for (let index = 0; index < expected.length; index++) {
      const next = nextDepotAfter(distance, DEPOT_RULES, levelId, 'normal');
      normal.push(next.distance);
      assert.equal(next.transition, true);
      distance = next.distance;
    }
    assert.deepEqual(normal, expected);
    assert.equal(nextDepotAfter(normal.at(-1), DEPOT_RULES, levelId, 'normal').distance, Infinity);
  }
  let at = 0;
  const endless = [];
  for (let index = 0; index < 5; index++) {
    const next = nextDepotAfter(at, DEPOT_RULES, 'level1', 'continuous');
    endless.push(next.distance);
    at = next.distance;
  }
  assert.deepEqual(endless, Array.from({length: 5}, (_, index) =>
    (index + 1) * GAME_BALANCE.routes.continuous.depotIntervalMeters));
  assert.throws(() => nextDepotAfter(1000, DEPOT_RULES, 'level2', 'continuous'), /per-level/);
  assert.throws(() => nextDepotAfter(-1), /Invalid Depot schedule/);
  assert.throws(() => nextDepotAfter(0, {...DEPOT_RULES, loopMeters: 0}), /Invalid Depot schedule/);
});

test('moving windows align with banking and include the final Normal settlement interval', () => {
  let at = 0;
  const found = [];
  for (let i = 0; i < 4; i++) {
    const next = nextMoverWindowAfter(at);
    assert.ok(next.distance > at);
    found.push(next.distance);
    at = next.distance;
  }
  const level1Ends = GAME_BALANCE.routes.level1.sectorEndsMeters;
  const level2Ends = GAME_BALANCE.routes.level2.sectorEndsMeters;
  assert.deepEqual(found, level1Ends);
  assert.equal(nextMoverWindowAfter(level1Ends[0] - 0.01).distance, level1Ends[0]);
  assert.equal(nextMoverWindowAfter(level1Ends[0]).distance, level1Ends[1]);
  assert.equal(nextMoverWindowAfter(level1Ends[2]).distance, level1Ends[3]);
  assert.equal(nextMoverWindowAfter(level1Ends.at(-1)).distance, Infinity);
  assert.equal(nextMoverWindowAfter(level2Ends[0], MOVER_WINDOW_RULES, 'level2').distance, level2Ends[1]);
  assert.equal(nextMoverWindowAfter(level2Ends.at(-2), MOVER_WINDOW_RULES, 'level2').distance, level2Ends.at(-1));
  assert.equal(nextMoverWindowAfter(level2Ends.at(-1), MOVER_WINDOW_RULES, 'level2').distance, Infinity);
  const continuousInterval = GAME_BALANCE.routes.continuous.depotIntervalMeters;
  assert.equal(nextMoverWindowAfter(5 * continuousInterval, MOVER_WINDOW_RULES, 'level1', 'continuous').distance,
    6 * continuousInterval);
  assert.equal(nextMoverWindowAfter(9000, MOVER_WINDOW_RULES, 'level1', 'continuous').distance, 10000);
  assert.equal(nextMoverWindowAfter(9000, MOVER_WINDOW_RULES, 'level1', 'continuous').startDistance, 8000);
  assert.throws(() => nextMoverWindowAfter(-1), /Invalid Depot schedule/);
});

test('depot docking requires indicated-side 50 percent physical cab intersection at the crossing plane', () => {
  for (const side of ['left', 'right']) {
    const depot = {distance: 1800, side};
    for (const x of side === 'left' ? [73, 86] : [304, 317]) {
      assert.ok(depotEntryAllowed(depot, 1800, x));
      assert.ok(depotEntryAllowed(depot, 1801, x, 1799), 'a frame may cross the whole threshold');
      assert.ok(!depotEntryAllowed(depot, 1799.99, x, 1799));
      assert.ok(!depotEntryAllowed(depot, 1801, x, 1800.01), 'cannot turn in after passing');
    }
    for (const x of [119, 157, 195, 233, 271, side === 'left' ? 317 : 73]) {
      assert.ok(!depotEntryAllowed(depot, 1800, x));
    }
    const {bay, player} = depotEntryBounds(depot, depot.distance, 195);
    const boundary = side === 'left' ? bay.x + bay.width : bay.x;
    const sign = side === 'left' ? 1 : -1;
    const phaserIntersection = (a, b) => Rectangle.Intersection(
      new Rectangle(a.x, a.y, a.width, a.height), new Rectangle(b.x, b.y, b.width, b.height));
    for (const delta of [-0.001, 0, 0.001]) {
      const x = boundary + delta * sign;
      assert.equal(depotEntryAllowed(depot, 1800, x, 1799, phaserIntersection), delta <= 0);
      assert.equal(depotEntryAllowed(depot, 1800, x, 1799), delta <= 0,
        'simulation and live Phaser intersection agree at the exact 50 percent boundary');
    }
    assert.equal(player.width, GAME_BALANCE.hazards.playerHalfWidthPx * 2,
      'canonical physical width, not scaled or banked sprite bounds');
    assert.equal(depotWorldY(depot, 1800), SHIP_Y);
  }
  assert.ok(!depotEntryAllowed({distance: Infinity}, 1e9, 73));
});

test('depot docking motion integrates a smooth 1.5-second stop and 1-second protected launch at all frame rates', () => {
  assert.equal(DEPOT_RULES.dockingSeconds, 1.5);
  assert.equal(DEPOT_RULES.launchSeconds, 1);
  assert.equal(DEPOT_ENTRANCE_GEOMETRY.shipHalfHeight, GAME_BALANCE.hazards.playerHalfHeightPx);
  for (const hz of [30, 60, 120]) for (const accelerating of [false, true]) {
    const duration = accelerating ? DEPOT_RULES.launchSeconds : DEPOT_RULES.dockingSeconds;
    let elapsed = 0, travel = 0, priorSpeed = accelerating ? 0 : 1;
    const frames = Math.round(hz * duration);
    for (let frame = 0; frame < frames; frame++) {
      const step = depotMotionStep(elapsed, 1 / hz, duration, accelerating);
      assert.equal(step.complete, frame === frames - 1, 'ends on the exact frame, without floating-point delay');
      assert.ok(accelerating ? step.speedFraction >= priorSpeed : step.speedFraction <= priorSpeed);
      travel += step.travelSeconds;
      elapsed = step.elapsed;
      priorSpeed = step.speedFraction;
    }
    assert.equal(priorSpeed, accelerating ? 1 : 0);
    assert.ok(Math.abs(travel - duration / 2) < 1e-12);
  }
});

test('depot speed-aware clear approach permits full-load opposite-edge entry after 350 ms reaction', () => {
  for (const depotDistance of [450, 500, 1500, 3000, 5000, 7000]) {
    for (const hz of [30, 60, 120]) for (const handling of [WORST_CASE_HANDLING, 0, 0.32]) for (const side of ['left', 'right']) {
      const targetX = side === 'left' ? 73 : 317;
      let state = {x: side === 'left' ? 317 : 73, velocity: 0};
      const speed = routeSpeedAtDistance(depotDistance), dt = 1 / hz;
      const duration = depotApproachMeters(depotDistance) / (speed * METERS_PER_PIXEL);
      for (let time = 0; time < duration; time += dt) {
        if (time < 0.35) continue;
        state = advanceSteering({...state, targetX, dt, minX: 73, maxX: 317,
          load: 8, capacity: 8, handling, loadRelief: 0});
      }
      assert.ok(depotEntryAllowed({distance: depotDistance, side}, depotDistance, state.x),
        `${depotDistance}/${hz}/${handling}/${side}`);
    }
  }
});

test('depot approaches and exits exclude entire Alpha/Beta collision envelopes, including bypass/re-entry', () => {
  let checked = 0;
  // Each registry is sampled at a distinct section start, including the Overdrive start at the finish.
  const sectionStarts = [...IMPLEMENTED_SECTORS.map(sector => sector.startsAt), IMPLEMENTED_SECTORS.at(-1).endsAt];
  for (const [sector, chunks] of Object.values(CHUNK_REGISTRIES).entries()) {
    const distance = sectionStarts[sector % sectionStarts.length];
    for (const chunk of chunks) {
      const prepared = prepareTrackChunk(chunk, distance, () => 0);
      for (const row of prepared.rows) {
        const depot = distance + 450, protectedUntil = distance + 30;
        for (let spawn = distance; spawn < depot + 40; spawn += 7) {
          if (!hazardsBeforeDepot(row, spawn, depot, protectedUntil)) continue;
          checked++;
          for (const h of [...row.hazards, ...row.intermediates].filter(h => !h.continuation)) {
            const envelope = Math.max(HAZARD_ROW_ENVELOPE_PX / 2, hazardGeometry(h).hitY);
            const first = spawn + (HAZARD_TRAVEL_PX - h.offsetY - envelope) * METERS_PER_PIXEL;
            const last = spawn + (HAZARD_TRAVEL_PX - h.offsetY + envelope) * METERS_PER_PIXEL;
            assert.ok(first > protectedUntil);
            assert.ok(last < depot - depotApproachMeters(depot) || first > depot + DEPOT_RULES.exitMeters);
          }
        }
      }
    }
  }
  assert.ok(checked > 1000);
});

test('Depot approach chicanes alternate only in the opposite half and preserve safe outer envelopes', () => {
  for (const [levelId, mode] of [
    ['level1', 'normal'], ['level2', 'normal'], ['level3', 'normal'], ['level4', 'normal'],
    ['level1', 'continuous'],
  ]) {
    let depot = nextDepotAfter(0, DEPOT_RULES, levelId, mode);
    for (let bank = 0; bank < 2; bank++) {
      const source = {spacingPx: 250, intermediates: [],
        hazards: [{kind: 'barrier', lane: 0, offsetX: 0, offsetY: 0}],
        safeLanes: [1, 2, 3], hazardLanes: [0], cargoLanes: [1]};
      const before = structuredClone(source);
      const chicane = [];
      const clearMask = depot.side === 'left' ? 0b0011 : 0b1100;
      const start = depot.distance - DEPOT_RULES.approachMeters -
        HAZARD_TRAVEL_PX * METERS_PER_PIXEL - 20;
      for (let at = start; at < depot.distance; at += source.spacingPx * METERS_PER_PIXEL) {
        const row = depotApproachRow(source, at, levelId, mode);
        for (const hazard of row.intermediates.filter(hazard => hazard.depotChicane)) {
          assert.equal(obstacleLaneMask([hazard]) & clearMask, 0);
          const contact = at + (HAZARD_TRAVEL_PX - hazard.offsetY) * METERS_PER_PIXEL;
          chicane.push({lane: hazard.lane, contact});
          assert.ok(contact - HAZARD_ROW_ENVELOPE_PX / 2 * METERS_PER_PIXEL >
            depot.distance - DEPOT_RULES.approachMeters);
          assert.ok(contact + HAZARD_ROW_ENVELOPE_PX / 2 * METERS_PER_PIXEL < depot.distance);
        }
        if (row.depotApproach) {
          assert.equal(hazardsBeforeDepot(row, at, depot.distance, 0, levelId, mode), true);
          const hazard = row.intermediates.find(hazard => hazard.depotChicane);
          if (hazard) {
            assert.equal(hazardsBeforeDepot({...row, hazards: [], intermediates: [
              {...hazard, lane: depot.side === 'left' ? 0 : 3},
            ]}, at, depot.distance, 0, levelId, mode), false, 'never waive bay-side collision protection');
            assert.equal(hazardsBeforeDepot(row, at, depot.distance, depot.distance, levelId, mode), false,
              'Depot chicanes do not bypass protected re-entry');
          }
        }
      }
      assert.deepEqual(chicane.map(hazard => hazard.lane), depot.side === 'left' ? [2, 3, 2] : [1, 0, 1]);
      assert.deepEqual(new Set(chicane.map(hazard => hazard.contact)).size, 3, 'no duplicated obstacles at row seams');
      assert.deepEqual(source, before);
      depot = nextDepotAfter(depot.distance, DEPOT_RULES, levelId, mode);
    }
  }
});

test('current schema does not infer new level progress from legacy distance; older saves keep earned unlocks', () => {
  const current = {...defaultProfile(), bestDistance: 999, totalRuns: 4, coins: 999};
  assert.equal(SCHEMA_VERSION, 13);
  assert.ok(!normalizeProfile(current).milestones.includes('level1,depot1'));
  assert.deepEqual(normalizeProfile(current).levelProgress.level1, {
    unlocked: true, completed: false, sector3CheckpointUnlocked: false, bestDistance: 0,
    checkpointBestDistance: 0, overdriveBestDistance: 0, reachedSectors: [1], completedSectors: [],
  });
  assert.deepEqual(normalizeProfile(current).levelProgress.level2, {
    unlocked: false, completed: false, sector3CheckpointUnlocked: false, bestDistance: 0,
    checkpointBestDistance: 0, overdriveBestDistance: 0, reachedSectors: [], completedSectors: [],
  });
  for (const schemaVersion of [1, 2, 3]) {
    const old = {...current, schemaVersion, bestDistance: 500, blueprints: 7,
      blueprintRewardIds: ['receipt'], milestones: [], unlockedSlotCount: 3};
    const migrated = normalizeProfile(old);
    assert.ok(migrated.milestones.includes('level1,depot1'));
    assert.equal(migrated.coins, 999);
    assert.equal(migrated.blueprints, 7);
    assert.deepEqual(migrated.blueprintRewardIds, ['receipt']);
    assert.equal(migrated.levelProgress.level1.completed, false);
    assert.equal(migrated.levelProgress.level2.unlocked, false);
    assert.deepEqual(normalizeProfile(migrated), migrated);
  }
  assert.ok(normalizeProfile({...current, milestones: ['depot1']}).milestones.includes('level1,depot1'),
    'legacy unprefixed ids migrate to Level 1');
  const old = normalizeProfile({...current, schemaVersion: 4, bestDistance: 5400, milestones: []});
  assert.deepEqual(old.milestones, ['level1', 'level1,sector2', 'level1,sector3', 'level1,sector4']);
  assert.deepEqual(normalizeProfile(old), old);
  assert.ok(!normalizeProfile({...current, bestDistance: 999}).milestones.includes('level1,sector2'));
});

test('palette progression counts passed facilities rather than visits and resets at sector boundaries', () => {
  assert.equal(depotPaletteStep(449, 0), 0);
  assert.equal(depotPaletteStep(450, 0), 0);
  assert.equal(depotPaletteStep(999, 0), 1);
  assert.equal(depotPaletteStep(1050, 0), 2);
  assert.equal(depotPaletteStep(2500, 2500), 0);
  assert.equal(depotPaletteStep(2850, 2500), 0);
  assert.equal(depotPaletteStep(6600, 6000), 0);
  const endlessGap = GAME_BALANCE.routes.continuous.depotIntervalMeters;
  assert.equal(depotPaletteStep(8000, 0, 'level1', 'continuous'), Math.floor(8000 / endlessGap));
  assert.equal(depotPaletteStep(12000, 0, 'level1', 'continuous'), Math.floor(12000 / endlessGap));
  assert.equal(depotPaletteStep(1e9, 0, 'level1', 'continuous'), Math.floor(1e9 / endlessGap),
    'endless progress is computed without iterating endless Depots');
});
test('balance bot must steer into a facility to bank; reaching its sample horizon is not banking', () => {
  // This checks Depot policy, not the bot's survival rate through newly staggered encounters.
  const firstDepot = nextDepotAfter(0).distance;
  const options = {seed: 123, stats: {...starterStats(1), hull: 100},
    player: PLAYERS.practised, maxDistance: firstDepot + 150};
  const passing = simulateRun(options);
  assert.equal(passing.banked, false);
  assert.ok(passing.distance >= options.maxDistance);
  const entering = simulateRun({...options, bankAtDepot: () => true});
  assert.equal(entering.banked, true);
  assert.ok(Math.abs(entering.distance - firstDepot) <= DEPOT_RULES.triggerHalfMeters);
});

const sceneSource = readFileSync(new URL('../src/game/scenes/RoutePrototypeScene.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '').replace('export class RoutePrototypeScene', 'class RoutePrototypeScene');
const DepotScene = vm.runInNewContext(`${sceneSource}\nRoutePrototypeScene;`, {
  Phaser: {Scene: class {}, BlendModes: {ADD: 1}, Geom: {Rectangle},
    Math: {Clamp: (v, min, max) => Math.max(min, Math.min(max, v))}},
  releaseRouteVisual,
  GAME_BALANCE, balance, ...depotEconomy, cargoTotals, METERS_PER_PIXEL, MAX_TRACK_SPEED,
  ROAD_LEFT, ROAD_RIGHT, SHIP_Y, DEPOT_RULES, depotEntryAllowed, depotDockingStart, depotMotionStep, nextDepotAfter,
  depotWorldY, depotFacilityHeight: () => 100,
  createDepotFacility: (_scene, depot, y) => ({depot, container: {y}}),
  routeSpeedAtDistance, routeFinishDistance, sectorAtDistance, IMPLEMENTED_LEVELS, continuousStageAtDistance,
  SPRITE_ART_SCALE, PALETTE, advanceSteering, KEYBOARD_BRAKE_SECONDS, HAZARD_ROW_ENVELOPE_PX,
  SPAWN_Y: GAME_BALANCE.routes.geometry.spawnYpx, depotResumeFirstDistance, hazardScrollScale,
  DEPOT_APPROACH_HINT_M: DEPOT_RULES.noticeMeters,
  syncDepotEntrance() {}, syncGuardrailSparks() {}, syncSectorRoad() {}, isDeveloperRun: () => false,
});

test('scheduled Depot facility enters at its distance threshold', () => {
  const facilityHeight = 100;
  const nextDepot = nextDepotAfter(0, DEPOT_RULES, 'level3', 'normal');
  const scene = new DepotScene();
  Object.assign(scene, {
    distance: nextDepot.distance - (SHIP_Y + facilityHeight) * METERS_PER_PIXEL + 0.01,
    nextDepot,
    depotFacilities: [],
  });

  scene.updateDepotFacilities(0);

  assert.equal(scene.depotFacilities.length, 1);
  assert.equal(scene.depotFacilities[0].depot.distance, nextDepot.distance);
  assert.ok(scene.depotFacilities[0].container.y >= -facilityHeight);
});

function tacticalDepotScene(mode = 'normal', rank = 3) {
  const scene = new DepotScene();
  Object.assign(scene, {
    phase: 'running', levelId: 'level1', runMode: mode, profile: defaultProfile(),
    _scratchPlayerRect: new Rectangle(), _scratchDepotRect: new Rectangle(),
    _scratchIntersectionRect: new Rectangle(),
    distance: mode === 'continuous' ? 1000 : 500,
    stats: {shieldCapacity: rank, capacity: 11, handling: 0, loadRelief: 0},
    shieldCharges: 0, hull: 2, maxHull: 3, depotCount: 0, invulnerable: 0, holdFullCooldown: 0,
    runEconomy: depotEconomy.createRunEconomy({mode, levelId: 'level1', runId: 'tactical-test'}),
    runContext: {}, runMilestones: [], objects: [], lines: [{y: 100}],
    roadSurface: {tilePositionY: 0}, dustSurface: {},
    trackStream: {resetAfterDepot() {}, nextRow() { return null; }}, nextTrackRowDistance: null, spawnTimer: 999,
    ship: {x: 73, y: SHIP_Y, setAlpha(value) { this.alpha = value; }},
    shipTargetX: 73, shipVelocityX: 0, cargoItems: [{value: 100, mass: 1, slots: 1}],
    shieldRing: {setPosition() { return this; }, setVisible(value) { this.visible = value; return this; }},
    hudContainer: {visible: true, setVisible(value) { this.visible = value; return this; }},
    cameras: {main: {flash(...args) { scene.arrivalFlash = args; }, setBackgroundColor() {}}},
    persistProfile(profile) { scene.saveAttempts++; if (!scene.storageAvailable) return false;
      scene.savedProfile = profile; return true; },
    storageAvailable: true, saveAttempts: 0,
    showToast(message) { this.lastToast = message; },
  });
  for (const name of ['syncFinishLine', 'refreshHud', 'syncHaulerVisuals', 'hideToast', 'triggerHint',
    'updateDepotFacilities', 'renderDepot', 'renderContinuousDepot', 'clearOverlay', 'recordMilestones',
    'refreshDeveloperReadout', 'resolveGuardrails']) scene[name] = () => {};
  scene.updateSteeringInput = () => false;
  scene.nextDepot = nextDepotAfter(scene.distance - 1, DEPOT_RULES, 'level1', mode);
  scene.nextDepotDistance = scene.nextDepot.distance;
  scene.distance = depotDockingStart(scene.nextDepot, 'level1', mode);
  scene.currentSector = sectorAtDistance(scene.distance, 'level1', mode);
  scene.syncCargoTotals();
  return scene;
}

function completeDocking(scene) {
  for (let frame = 0; frame < 31 && scene.phase === 'docking'; frame++) scene.updateStep(0, 50);
  assert.equal(scene.phase, 'depot');
}

test('depot actual docking reaches maintenance at exactly 1.5 seconds at 30, 60 and 120 Hz', () => {
  for (const hz of [30, 60, 120]) {
    const scene = tacticalDepotScene();
    scene.updateDepot();
    for (let frame = 0; frame < hz * 1.5; frame++) {
      scene.updateStep(0, 1000 / hz);
      assert.equal(scene.phase, frame === hz * 1.5 - 1 ? 'depot' : 'docking');
    }
    assert.equal(scene.saveAttempts, 0);
    assert.equal(scene.depotVisit.banked, false);
    assert.equal(scene.hudContainer.visible, false);
  }
});

test('depot actual scene decelerates before manual banking and recharge, hides HUD during maintenance, launches with one-second protection', () => {
  for (const x of [73, 317]) for (const rank of [0, 1, 2, 3]) {
    const scene = tacticalDepotScene('normal', rank);
    scene.nextDepot = {...scene.nextDepot, side: x < 195 ? 'left' : 'right'};
    scene.ship.x = x;
    scene.runEconomy.consecutiveSkips = 1;
    scene.updateDepot();
    assert.equal(scene.phase, 'docking');
    assert.equal(scene.profile.coins, 0);
    assert.equal(scene.shieldCharges, 0);
    const start = scene.distance, speed = scene.depotMotion.speed;
    const shifts = [];
    for (let i = 0; i < 29; i++) {
      const before = scene.distance;
      scene.updateStep(0, 50);
      shifts.push(scene.distance - before);
      assert.equal(scene.phase, 'docking', 'no menu or save before the full 1.5-second stop');
    }
    completeDocking(scene);
    assert.ok(shifts.every((shift, i) => !i || shift < shifts[i - 1]));
    assert.ok(Math.abs(scene.distance - start - speed * 0.75 * METERS_PER_PIXEL) < 1e-9);
    assert.ok(Math.abs(scene.roadSurface.tilePositionY + speed * 0.75) < 1e-9);
    assert.equal(scene.distance, scene.nextDepotDistance);
    assert.equal(depotWorldY(scene.nextDepot, scene.distance), scene.ship.y,
      'the stopped cab is under the canopy, not downstream of it');
    assert.equal(scene.profile.coins, 0);
    assert.equal(scene.depotVisit.banked, false);
    assert.equal(scene.saveAttempts, 0, 'arrival alone never banks');
    assert.equal(scene.shieldCharges, rank);
    assert.equal(scene.hudContainer.visible, false);
    assert.equal(scene.bankAtDepot(), true);
    assert.equal(scene.profile.coins, 120);
    assert.equal(scene.savedProfile.coins, 120);
    assert.equal(scene.runEconomy.bankingEvents, 1);
    assert.equal(scene.runEconomy.consecutiveSkips, 0);
    assert.equal(scene.cargoItems.length, 0);
    assert.equal(scene.shieldCharges, rank);
    assert.equal(scene.depotVisit.banked, true);
    assert.equal(JSON.stringify(scene.arrivalFlash), '[200,0,255,255,0.4]');
    scene.showDepot();
    scene.bankAtDepot();
    assert.equal(scene.saveAttempts, 1);
    assert.equal(scene.depotCount, 1);
    scene.resumeAfterDepot();
    scene.resumeAfterDepot();
    assert.equal(scene.phase, 'running');
    assert.equal(scene.hudContainer.visible, true);
    assert.equal(scene.depotLaunchElapsed, 0);
    assert.equal(scene.invulnerable, 1);
    assert.equal(scene.ship.x, 195);
    assert.equal(scene.nextDepotDistance, 1000);
    const launchStart = scene.distance, launchSpeed = routeSpeedAtDistance(launchStart);
    scene.spawnTimer = 999;
    for (let i = 0; i < 20; i++) scene.updateStep(0, 50);
    assert.equal(scene.depotLaunchElapsed, null);
    assert.equal(scene.invulnerable, 0);
    const launchTravel = scene.distance - launchStart;
    assert.ok(launchTravel >= launchSpeed * 0.5 * METERS_PER_PIXEL - 1e-9);
    assert.ok(launchTravel <= routeSpeedAtDistance(scene.distance) * 0.5 * METERS_PER_PIXEL + 1e-9);
  }
});

test('depot banking save failure pauses every exit and retry commits cargo/accounting exactly once', () => {
  const scene = tacticalDepotScene();
  scene.storageAvailable = false;
  scene.updateDepot();
  completeDocking(scene);
  assert.equal(scene.bankAtDepot(), false);
  assert.equal(scene.depotVisit.banked, false);
  assert.equal(scene.cargoValue, 100);
  assert.equal(scene.profile.coins, 0);
  const before = JSON.stringify({profile: scene.profile, run: scene.runEconomy, cargo: scene.cargoItems});
  scene.resumeAfterDepot();
  scene.confirmBankFinish();
  scene.repairAtDepot();
  assert.equal(scene.phase, 'depot');
  assert.match(scene.lastToast, /banking/i);
  assert.equal(JSON.stringify({profile: scene.profile, run: scene.runEconomy, cargo: scene.cargoItems}), before);
  scene.storageAvailable = true;
  assert.equal(scene.bankAtDepot(), true);
  scene.bankAtDepot();
  assert.equal(scene.profile.coins, 100);
  assert.equal(scene.runEconomy.bankingEvents, 1);
  assert.equal(scene.saveAttempts, 2);
  scene.resumeAfterDepot();
  assert.equal(scene.phase, 'running');
});

test('depot center bypass preserves speed, cargo and stream; crossing interpolation prevents late turn-in', () => {
  for (const mode of ['normal', 'continuous']) {
    for (const x of [157, 233]) {
      const scene = tacticalDepotScene(mode);
      scene.distance = scene.nextDepotDistance;
      const cargo = scene.cargoItems, stream = scene.trackStream, distance = scene.distance;
      scene.ship.x = x;
      scene.updateDepot(distance - 1, x);
      scene.updateDepot();
      assert.equal(scene.phase, 'running');
      assert.equal(scene.depotMotion, undefined);
      assert.equal(scene.depotLaunchElapsed, undefined);
      assert.equal(scene.shieldCharges, 0);
      assert.equal(scene.cargoItems, cargo);
      assert.equal(scene.trackStream, stream);
      assert.equal(scene.ship.x, x);
      assert.equal(scene.saveAttempts, 0);
      assert.equal(scene.runEconomy.depotsSkipped, 1);
      assert.equal(scene.runEconomy.depotsReached, 1);
    }
    const crossedOuter = tacticalDepotScene(mode);
    const outerStart = crossedOuter.distance;
    crossedOuter.distance += 1;
    crossedOuter.ship.x = 195;
    crossedOuter.updateDepot(outerStart - 0.01, 73);
    assert.equal(crossedOuter.phase, 'docking', 'crossing lane, not end-of-frame lane determines docking');
    const crossedCenter = tacticalDepotScene(mode);
    const centerStart = crossedCenter.distance;
    crossedCenter.distance += 1;
    crossedCenter.ship.x = 73;
    crossedCenter.updateDepot(centerStart - 0.01, 195);
    assert.equal(crossedCenter.phase, 'running');
    assert.equal(crossedCenter.runEconomy.depotsSkipped, 0, 'express pass is not awarded before the site');
    crossedCenter.distance = crossedCenter.nextDepotDistance;
    crossedCenter.ship.x = 195;
    crossedCenter.updateDepot();
    assert.equal(crossedCenter.runEconomy.depotsSkipped, 1);
  }
});

test('depot Endless stopped Skip alone restores equipped shields without banking or duplicate pass bonus', () => {
  for (const rank of [0, 1, 2, 3]) {
    const scene = tacticalDepotScene('continuous', rank);
    const profile = JSON.stringify(scene.profile), cargo = scene.cargoItems;
    scene.updateDepot();
    completeDocking(scene);
    assert.equal(scene.hudContainer.visible, false);
    assert.equal(scene.shieldCharges, 0, 'stopping alone does not restore Endless shields');
    scene.resumeAfterDepot();
    scene.resumeAfterDepot();
    assert.equal(scene.hudContainer.visible, true);
    assert.equal(scene.shieldCharges, rank);
    assert.equal(scene.cargoItems, cargo);
    assert.equal(JSON.stringify(scene.profile), profile);
    assert.equal(scene.saveAttempts, 0);
    assert.equal(scene.runEconomy.continuousPassedDepots, 1);
    assert.equal(scene.runEconomy.depotsSkipped, 1);
    assert.equal(scene.runEconomy.depotsReached, 1);
    assert.equal(scene.nextDepotDistance, 2 * GAME_BALANCE.routes.continuous.depotIntervalMeters);
    assert.equal(scene.invulnerable, 1);
  }
});
