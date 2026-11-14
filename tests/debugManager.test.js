import test from 'node:test';
import assert from 'node:assert/strict';
import {DebugManager, BOT_LOOKAHEAD_PX, DEBUG_FAST_MULTIPLIER, parseDebugFlags} from '../src/game/core/DebugManager.js';
import {defaultProfile} from '../src/game/core/save.js';
import {hazardGeometry, hazardX, LANE_CENTERS, movingHazardOffset} from '../src/game/core/hazards.js';
import {routeTimeAtDistance, SLOT_MAX} from '../src/game/core/economy.js';
import {loadoutStats, MODULE_DEFS} from '../src/game/core/modules.js';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';

test('debug flags activate only on exact explicit true values or validated paired warp', () => {
  for (const search of ['', '?unrelated=true', '?god=false&bot=false&unlockAll=false&fast=false']) {
    const debug = new DebugManager(search);
    const profile = defaultProfile();
    assert.equal(debug.active, false);
    assert.equal(debug.timeScale, 1);
    assert.equal(debug.profileForSession(profile), profile);
  }
  for (const name of ['god', 'bot', 'unlockAll', 'fast']) {
    const flags = parseDebugFlags(`?${name}=true`);
    assert.equal(flags.active, true);
    assert.equal(flags[name], true);
    assert.equal(Object.values(flags).filter(value => value === true).length, 2);
  }
  assert.deepEqual(parseDebugFlags('?level=2&sector=3').warp, {levelId: 'level2', sectorNumber: 3});
  for (const search of ['?god', '?god=1', '?bot=TRUE', '?fast=true&fast=false',
    '?level=3&sector=1', '?level=2', '?sector=3', '?level=2&sector=5', '?level=1.5&sector=1']) {
    assert.throws(() => parseDebugFlags(search), /debug|Debug/);
  }
});

test('debug unlock grants only implemented vehicles, live sockets and modules in an isolated profile', () => {
  const profile = defaultProfile();
  const before = JSON.stringify(profile);
  const unlocked = new DebugManager('?unlockAll=true').profileForSession(profile);
  assert.equal(unlocked.coins, 99999);
  assert.deepEqual(unlocked.ownedVehicleIds, ['standard', 'swift', 'armoured']);
  for (const id of unlocked.ownedVehicleIds) {
    assert.equal(unlocked.shipStates[id].unlockedSlotCount, SLOT_MAX);
    assert.ok(Array.isArray(unlocked.shipStates[id].equippedModuleIds));
  }
  for (const def of MODULE_DEFS) assert.ok(unlocked.ownedModules[def.id] >= 1);
  assert.ok(unlocked.shipStates.standard.ownedColorIds.includes('gold'));
  assert.ok(!unlocked.shipStates.swift.ownedColorIds.includes('gold'));
  unlocked.seenHints.push('inspection-only');
  assert.equal(JSON.stringify(profile), before);
});

test('debug save routing never calls storage, while normal mode propagates save failure', () => {
  let writes = 0;
  const save = () => { writes++; return false; };
  const profile = defaultProfile();
  for (const search of ['?god=true', '?bot=true', '?fast=true', '?unlockAll=true', '?level=2&sector=3']) {
    assert.equal(new DebugManager(search).persist(profile, save), true);
  }
  assert.equal(writes, 0);
  assert.equal(new DebugManager('').persist(profile, save), false);
  assert.equal(writes, 1);
});

const botScene = () => ({ship: {x: LANE_CENTERS[1], y: 684}, objects: [],
  distance: 1000, levelId: 'level2', runMode: 'normal', shipVelocityX: 0,
  cargoWeight: 0, stats: loadoutStats(defaultProfile()), keyboardBrakeRemaining: 0});
const hazard = (lane, y, kind = 'divider', extra = {}) =>
  ({type: 'hazard', kind, lane, sprite: {x: LANE_CENTERS[lane], y}, ...extra});

test('debug bot looks ahead 350px, selects an adjacent open lane and retains safe lane-change targets', () => {
  const debug = new DebugManager('?bot=true');
  const scene = botScene();
  assert.equal(BOT_LOOKAHEAD_PX, 350);
  assert.equal(debug.botTarget(scene), LANE_CENTERS[1]);
  scene.objects = [hazard(1, scene.ship.y - 200), hazard(0, scene.ship.y - 150)];
  assert.equal(debug.botTarget(scene), LANE_CENTERS[2]);
  scene.ship.x += 10;
  assert.equal(debug.botTarget(scene), LANE_CENTERS[2]);
  scene.ship.x = LANE_CENTERS[2];
  assert.equal(debug.botTarget(scene), LANE_CENTERS[2]);
  assert.equal(scene.objects.length, 2, 'obstacles are never removed or altered by the bot');
});

test('debug bot ignores collectibles and distant hazards but accounts for extended guardrails', () => {
  const debug = new DebugManager('?bot=true');
  const scene = botScene();
  scene.objects = [{...hazard(1, 500), type: 'cargo'}, hazard(1, 0)];
  assert.equal(debug.botTarget(scene), LANE_CENTERS[1]);
  scene.ship.x = LANE_CENTERS[0];
  debug.resetBot(scene.ship.x);
  const wall = {kind: 'sideWall', lengthPx: 800};
  // Body reaches the truck after ~250 px of scroll while its sprite centre is beyond the lookahead.
  const wallY = scene.ship.y - hazardGeometry(wall).hitY - 250;
  assert.ok(wallY < scene.ship.y - BOT_LOOKAHEAD_PX);
  scene.objects = [hazard(0, wallY, 'sideWall', {lengthPx: 800})];
  assert.equal(debug.botTarget(scene), LANE_CENTERS[1], 'long physical bodies are not missed by sprite-center lookahead');
});

test('debug bot checks shared canonical mover motion through the complete predicted turn/contact window', () => {
  const debug = new DebugManager('?bot=true');
  const scene = botScene();
  scene.ship.x = LANE_CENTERS[2];
  const movement = {minOffsetPx: 0, maxOffsetPx: 150, speedPxPerSecond: 76,
    direction: 1, phase: 0};
  const item = hazard(1, scene.ship.y - 200, 'forklift', {movement, motionAge: 0});
  item.sprite.x = hazardX({...item, movementOffsetPx: movingHazardOffset(movement, 0)});
  scene.objects = [item];
  const before = JSON.stringify(item);
  assert.notEqual(debug.botTarget(scene), LANE_CENTERS[2]);
  assert.equal(JSON.stringify(item), before, 'prediction does not mutate the moving hazard');
  scene.ship.x = LANE_CENTERS[1];
  // Far enough that the returning Forklift re-enters lane 1 before its body passes the truck.
  item.sprite.y = scene.ship.y - 250;
  item.sprite.x = LANE_CENTERS[2];
  item.movement.maxOffsetPx = LANE_CENTERS[2] - LANE_CENTERS[1];
  item.movement.phase = item.movement.maxOffsetPx;
  item.motionAge = 0;
  debug.resetBot(scene.ship.x);
  assert.equal(debug.botTarget(scene), LANE_CENTERS[0],
    'the currently empty lane is unsafe when the mover returns during the predicted contact window');
});

test('approved debug 3.5x speed inspects both current full routes in under 60 simulated seconds', () => {
  const debug = new DebugManager('?fast=true');
  assert.equal(DEBUG_FAST_MULTIPLIER, 3.5);
  for (const levelId of ['level1', 'level2']) {
    const end = GAME_BALANCE.routes[levelId].finishDistanceMeters;
    assert.equal(debug.inspectionSeconds(levelId), routeTimeAtDistance(end, levelId) / 3.5);
    assert.ok(debug.inspectionSeconds(levelId) < 60);
  }
});
