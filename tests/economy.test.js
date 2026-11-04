import test from 'node:test';
import assert from 'node:assert/strict';
import {
  steeringMultiplier, upgradeCost, crashReward,
  routeSpeedAtDistance, METERS_PER_PIXEL, ROUTE_END_DISTANCE_M,
  ROUTE_END_SPEED_PX_PER_SECOND, ROUTE_START_SPEED_PX_PER_SECOND,
  applyVehicleModuleBenefit, canUnlockApex, canUnlockSlot,
  settleBlueprintAward, convertLeftoverBlueprints,
} from '../src/game/core/economy.js';
import {MODULES, VEHICLES, SECTORS} from '../src/game/data/catalog.js';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';

test('catalog meets the documented full-scope counts', () => {
  assert.equal(MODULES.length, 24);
  assert.equal(VEHICLES.length, 5);
  assert.equal(SECTORS.length, 4);
  assert.equal(new Set(MODULES.map(x => x.id)).size, MODULES.length);
});
test('cargo slows steering without causing an unsteerable ship', () => {
  assert.ok(steeringMultiplier(10, 10) < steeringMultiplier(0, 10));
  assert.ok(steeringMultiplier(10, 10, 0.9) > steeringMultiplier(10, 10, 0));
  assert.ok(steeringMultiplier(10, 10, 0, 0.5) > steeringMultiplier(10, 10, 0, 0), 'load relief softens the penalty');
  assert.equal(steeringMultiplier(10, 10, 0, 1), steeringMultiplier(0, 10, 0));
  assert.ok(steeringMultiplier(999, 10, -0.06) >= 0.52);
  assert.equal(steeringMultiplier(0, 10, 0, 0, 1.2), steeringMultiplier(0, 10) * 1.2);
  assert.ok(steeringMultiplier(10, 10, 0, 0, 1.2) < 1.2, 'Swift retains the full-load steering penalty');
});
test('price progression and crash consolation are bounded', () => {
  assert.equal(upgradeCost(30, 1), 30);
  assert.ok(upgradeCost(30, 4) > upgradeCost(30, 3));
  assert.equal(crashReward(0), 5);
  assert.equal(crashReward(99_999), 50);
});
test('route speed rises continuously through the level and on to its configured cap, then holds', () => {
  for (const levelId of ['level1', 'level2']) {
    const route = GAME_BALANCE.routes[levelId];
    const starts = route.sectorStartsMeters;
    const speeds = route.speed.sectorStartsPxPerSecond;
    const holdFrom = starts.at(-1);
    starts.forEach((start, index) => assert.equal(routeSpeedAtDistance(start, levelId), speeds[index], `${levelId} ${start} m`));
    assert.equal(routeSpeedAtDistance(99_999, levelId), speeds.at(-1), 'the final sector holds its approved speed');
    // No jumps: always rising until the final sector, never by more than 2 px/s in a single metre, then holding.
    for (let d = 0; d < holdFrom + 500; d += 1) {
      const rise = routeSpeedAtDistance(d + 1, levelId) - routeSpeedAtDistance(d, levelId);
      if (d + 1 <= holdFrom) assert.ok(rise > 0 && rise < 2, `${levelId} speed step ${rise} at ${d} m`);
      else assert.equal(rise, 0, `${levelId} holds past ${holdFrom} m`);
    }
    assert.equal(routeSpeedAtDistance(-10, levelId), routeSpeedAtDistance(0, levelId));
  }
  assert.equal(routeSpeedAtDistance(0), ROUTE_START_SPEED_PX_PER_SECOND);
  assert.throws(() => routeSpeedAtDistance(Number.NaN), /Route distance must be numeric/);
});
test('the first Depot arrives quickly and the pace is noticeably higher by then', () => {
  let distance = 0;
  let seconds = 0;
  while (distance < 450) {
    distance += (1 / 60) * routeSpeedAtDistance(distance) * METERS_PER_PIXEL;
    seconds += 1 / 60;
  }
  assert.ok(seconds > 18 && seconds < 35, `first Depot took ${seconds.toFixed(1)} s`);
  // The exponential curve begins building pace immediately without compromising section-time parity.
  assert.ok(routeSpeedAtDistance(450) > 1.05 * ROUTE_START_SPEED_PX_PER_SECOND);
  assert.ok(routeSpeedAtDistance(450) < 1.1 * ROUTE_START_SPEED_PX_PER_SECOND);
});
test('slot purchase requires sequential eligibility, milestone and coins', () => {
  const profile = {shipStates: {standard: {unlockedSlotCount: 2}}, milestones: ['level1,depot1'], coins: 100};
  assert.equal(canUnlockSlot(profile, 3), false, 'slot 3 now needs Sector 2, not the first Depot');
  profile.milestones.push('level1,sector2');
  profile.coins = 99;
  assert.equal(canUnlockSlot(profile, 3), false);
  profile.coins = 100;
  assert.equal(canUnlockSlot(profile, 3), true);
  assert.equal(canUnlockSlot(profile, 4), false);
});
test('Apex requires all other purchasable vehicles and Sector 4', () => {
  const p = {ownedVehicleIds: ['standard', 'swift', 'armoured', 'prospector'], milestones: []};
  assert.equal(canUnlockApex(p), false);
  p.milestones.push('level1,sector4');
  assert.equal(canUnlockApex(p), true);
  p.ownedVehicleIds.splice(2, 1);
  assert.equal(canUnlockApex(p), false);
});
test('Apex gives exactly a 25% module benefit boost, not penalty or base stat', () => {
  assert.equal(applyVehicleModuleBenefit(8, 'apex'), 10);
  assert.equal(applyVehicleModuleBenefit(8, 'standard'), 8);
  assert.equal(applyVehicleModuleBenefit(-4, 'apex'), -4);
  assert.equal(applyVehicleModuleBenefit(0, 'apex'), 0);
});
test('Blueprint rewards become coins after Apex; leftover balance converted once', () => {
  assert.deepEqual(settleBlueprintAward(['standard'], 2), {blueprints: 2, coins: 0});
  assert.deepEqual(settleBlueprintAward(['apex'], 2), {blueprints: 0, coins: 70});
  const p = {coins: 100, blueprints: 4, ownedVehicleIds: ['apex']};
  const converted = convertLeftoverBlueprints(p);
  assert.deepEqual({coins: converted.coins, blueprints: converted.blueprints}, {coins: 240, blueprints: 0});
  assert.equal(convertLeftoverBlueprints(converted).coins, 240);
});
