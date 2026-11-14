import test from 'node:test';
import assert from 'node:assert/strict';
import {awardBlueprint, BLUEPRINT_SPAWN_BUDGETS, BLUEPRINT_SPAWN_CHANCE, createBlueprintRun, releaseDeferredBlueprints} from '../src/game/core/blueprints.js';
import {defaultProfile, normalizeProfile, SCHEMA_VERSION} from '../src/game/core/save.js';
import {IMPLEMENTED_SECTORS} from '../src/game/core/sectors.js';
import {createTrackStream} from '../src/game/core/trackGenerator.js';
import {milestonesForDistance, moduleLevelCap} from '../src/game/core/modules.js';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';
import {VEHICLES} from '../src/game/data/catalog.js';

const L1 = GAME_BALANCE.routes.level1;
const BLUEPRINT_TO_COINS = GAME_BALANCE.rewards.blueprintToCoins;

test('approved Blueprint price: the Swift costs 6 Blueprints in balance and catalog', () => {
  assert.equal(GAME_BALANCE.vehicles.swift.blueprintCost, 6);
  assert.equal(VEHICLES.find(vehicle => vehicle.id === 'swift').bpCost, GAME_BALANCE.vehicles.swift.blueprintCost);
});

test('1,000 seeded runs honor spawn budgets, miss chances, queued rows and repeated Depot clearing', () => {
  assert.deepEqual(Object.values(BLUEPRINT_SPAWN_BUDGETS), [0, 0, 1, 1, 0]);
  let total = 0;
  // Full generation with repeated Depot replans is ~0.8 s per stream, so a fixed pool of real
  // streams (with resets) feeds the 1,000 independently seeded Blueprint runs.
  const STREAM_POOL = 25;
  const streamRows = seed => {
    const stream = createTrackStream(seed);
    return IMPLEMENTED_SECTORS.map(sector => Array.from({length: 25}, (_, i) => {
      const row = stream.nextRow(sector.startsAt, true);
      if (i % 4 === 0) stream.resetAfterDepot(sector.startsAt);
      return row;
    }));
  };
  const pool = Array.from({length: STREAM_POOL}, (_, seed) => streamRows(seed));
  assert.deepEqual(streamRows(0), pool[0], 'stream with Depot resets is reproducible');
  const sequence = seed => {
    const run = createBlueprintRun(seed, `run-${seed}`);
    const rowsBySector = pool[seed % STREAM_POOL];
    const found = [];
    for (const [sectorIndex, sector] of IMPLEMENTED_SECTORS.entries()) {
      let spawned = 0;
      for (const row of rowsBySector[sectorIndex]) {
        const pickup = run.authorize(sector.startsAt, row.safeLanes, row.pickups.map(p => p.lane));
        if (pickup) {
          assert.ok(row.safeLanes.includes(pickup.lane));
          assert.ok(!row.pickups.some(p => p.lane === pickup.lane));
          spawned++;
          found.push(pickup);
        }
      }
      assert.ok(spawned <= BLUEPRINT_SPAWN_BUDGETS[sector.difficultyStep]);
    }
    assert.equal(run.spawnedCount, found.length);
    assert.ok(found.length <= 2);
    return found;
  };
  for (let seed = 0; seed < 1000; seed++) {
    const found = sequence(seed);
    assert.deepEqual(found, sequence(seed));
    total += found.length;
  }
  const expected = 1000 * Object.values(BLUEPRINT_SPAWN_BUDGETS).filter(Boolean).length * BLUEPRINT_SPAWN_CHANCE;
  assert.ok(total > expected * 0.8 && total < expected * 1.2,
    `provisional ${BLUEPRINT_SPAWN_CHANCE * 100}% chance, not guaranteed: ${total} vs ~${expected}`);
});

test('Blueprints are independent of cargo capacity, persist once through reload/crash, and substitute after Apex', () => {
  const profile = {...defaultProfile(), milestones: ['level1,sector3']};
  const reward = {id: 'run-a:neon', amount: 1};
  const first = awardBlueprint(profile, reward, {road: true});
  assert.equal(first.profile.blueprints, 1);
  assert.equal(first.profile.coins, 0);
  const reloaded = normalizeProfile(JSON.parse(JSON.stringify(first.profile)));
  assert.equal(awardBlueprint(reloaded, reward, {road: true}).profile, reloaded);
  const crashed = {...reloaded, coins: 25, totalRuns: 1};
  assert.equal(normalizeProfile(crashed).blueprints, 1);
  const apex = {...profile, ownedVehicleIds: ['standard', 'swift', 'armoured', 'apex']};
  const converted = awardBlueprint(apex, reward, {road: true});
  assert.equal(converted.profile.blueprints, 0);
  assert.equal(converted.profile.coins, reward.amount * BLUEPRINT_TO_COINS);
  assert.equal(awardBlueprint(converted.profile, reward, {road: true}).coins, 0);
});

test('non-road sources defer intact until first Sector 3 and release exactly once, separately from road budget', () => {
  let profile = defaultProfile();
  const reward = {id: 'future-contract:one', amount: 4};
  assert.throws(() => awardBlueprint(profile, reward, {road: true}), /before Sector 3/);
  profile = awardBlueprint(profile, reward).profile;
  assert.equal(profile.blueprints, 0);
  assert.equal(awardBlueprint(profile, reward).profile, profile);
  profile = normalizeProfile(JSON.parse(JSON.stringify(profile)));
  assert.equal(profile.deferredBlueprintRewards.length, 1);
  assert.equal(releaseDeferredBlueprints(profile), profile);
  profile = releaseDeferredBlueprints({...profile, milestones: ['level1,sector3']});
  assert.equal(profile.blueprints, 4);
  assert.deepEqual(profile.deferredBlueprintRewards, []);
  assert.equal(releaseDeferredBlueprints(profile), profile);
  assert.equal(awardBlueprint(profile, reward).profile, profile);
  const converted = releaseDeferredBlueprints({...defaultProfile(), milestones: ['level1,sector3'],
    ownedVehicleIds: ['standard', 'apex'], deferredBlueprintRewards: [reward]});
  assert.equal(converted.coins, reward.amount * BLUEPRINT_TO_COINS);
});

test('v1/v2 migration preserves old unlocks, currencies, vehicles, bests, gear and receipts without granting new progress early', () => {
  const legacyProfile = {...defaultProfile()};
  delete legacyProfile.shipStates;
  delete legacyProfile.levelProgress;
  const [, , l1Sector3, l1Sector4] = L1.sectorStartsMeters;
  const old = {...legacyProfile, schemaVersion: 2, coins: 912, blueprints: 7, bestDistance: l1Sector4 + 1,
    cargoCapacityRank: 5,
    ownedModules: {hand_precision: 4}, equippedModuleIds: ['hand_precision'],
    ownedVehicleIds: ['standard', 'swift'], unlockedSlotCount: 6, totalRuns: 42, milestones: [],
    blueprintRewardIds: ['old-collection']};
  const migrated = normalizeProfile(old);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(migrated.milestones, ['level1', 'level1,depot1', 'level1,sector2', 'level1,sector3', 'level1,sector4']);
  assert.equal(moduleLevelCap(migrated.milestones), GAME_BALANCE.upgrades.maxRank);
  for (const key of ['coins', 'blueprints', 'bestDistance', 'ownedModules',
    'ownedVehicleIds', 'totalRuns', 'blueprintRewardIds']) {
    assert.deepEqual(migrated[key], old[key], key);
  }
  assert.deepEqual(migrated.shipStates.standard.equippedModuleIds, ['hand_precision']);
  assert.equal(migrated.shipStates.standard.unlockedSlotCount, 6);
  assert.equal(migrated.levelProgress.level1.completed, false);
  assert.equal(migrated.levelProgress.level2.unlocked, false);
  assert.equal(migrated.bestDistance, old.bestDistance, 'legacy global distance is retained without creating a level record');
  assert.deepEqual(normalizeProfile(migrated), migrated, 'migration is one-time');
  assert.ok(normalizeProfile({schemaVersion: 1, bestDistance: l1Sector4 - 1, milestones: ['sector4']}).milestones.includes('level1,sector4'),
    'a legacy sector milestone id survives even below the current distance boundary');
  assert.deepEqual(normalizeProfile({...defaultProfile(), bestDistance: l1Sector3 - 1}).milestones, ['level1'],
    'current-schema global distance may include other levels, so it never infers Level 1 milestones');
  const level1Best = defaultProfile();
  level1Best.levelProgress.level1.bestDistance = l1Sector4;
  assert.deepEqual(normalizeProfile(level1Best).milestones, ['level1', 'level1,sector2', 'level1,sector3', 'level1,sector4']);
  assert.deepEqual(milestonesForDistance(l1Sector3 - 1), ['level1', 'level1,sector2']);
  assert.deepEqual(milestonesForDistance(l1Sector4 - 1), ['level1', 'level1,sector2', 'level1,sector3']);
  assert.deepEqual(milestonesForDistance(l1Sector4), ['level1', 'level1,sector2', 'level1,sector3', 'level1,sector4']);
  assert.deepEqual(normalizeProfile({...defaultProfile(), blueprintRewardIds: 9,
    deferredBlueprintRewards: [{id: 'pending', amount: 2}]}).deferredBlueprintRewards, [{id: 'pending', amount: 2}]);
});
