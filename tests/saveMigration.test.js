import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultProfile, loadProfile, saveProfile, normalizeProfile, SCHEMA_VERSION} from '../src/game/core/save.js';
import {CARGO_CAPACITY_ID, MODULE_DEFS, loadoutStats, moduleStatus, equipModule, unequipModule} from '../src/game/core/modules.js';
import {SLOT_MAX} from '../src/game/core/economy.js';
import {createRunEconomy, settleRun} from '../src/game/core/depotEconomy.js';
import {purchaseVehicle, selectVehicle, vehicleStatus} from '../src/game/core/vehicles.js';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';

const SAVE_KEY = 'cargo-run-prototype-profile-v1';
const BACKUP_KEY = `${SAVE_KEY}-unreadable-backup`;

function mockStorage(context, raw = null) {
  const originalStorage = globalThis.localStorage;
  const values = new Map(raw === null ? [] : [[SAVE_KEY, raw]]);
  const fixture = {values, readBlocked: false, backupBlocked: false};
  globalThis.localStorage = {
    getItem(key) {
      if (fixture.readBlocked) throw new Error('Storage read denied');
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (fixture.backupBlocked && key !== SAVE_KEY) throw new Error('Backup quota exceeded');
      values.set(key, value);
    },
  };
  context.mock.method(console, 'warn', () => {});
  context.after(() => {
    fixture.readBlocked = false;
    values.delete(SAVE_KEY);
    loadProfile();
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  });
  return fixture;
}

test('Endless distance survives saving without inheriting legacy campaign distance', context => {
  const fixture = mockStorage(context, JSON.stringify({
    ...defaultProfile(), schemaVersion: 12, bestDistance: 90000, coins: 1234,
  }));
  const migrated = loadProfile();
  assert.equal(migrated.endlessBestDistance, 0);
  assert.equal(migrated.coins, 1234, 'adding the record must not reset existing saves');
  assert.equal(saveProfile({...migrated, endlessBestDistance: 6789}), true);
  assert.equal(loadProfile().endlessBestDistance, 6789);
  assert.equal(JSON.parse(fixture.values.get(SAVE_KEY)).schemaVersion, SCHEMA_VERSION);
  assert.equal(normalizeProfile({...migrated, endlessBestDistance: -1}).endlessBestDistance, 0);
});

test('corrupt save recovery warns visibly and preserves original bytes before any replacement', context => {
  const fixture = mockStorage(context);
  for (const raw of ['{"coins":123', '{"schemaVersion":99,"coins":123}', 'null', '[]']) {
    fixture.values.clear();
    fixture.values.set(SAVE_KEY, raw);
    const warnings = [];
    const profile = loadProfile(message => warnings.push(message));
    assert.deepEqual(profile, defaultProfile());
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /backed up/);
    assert.equal(fixture.values.get(SAVE_KEY), raw, 'loading alone never overwrites the original');
    assert.equal(fixture.values.get(BACKUP_KEY), raw);
    assert.equal(saveProfile({...profile, coins: 50}), true);
    assert.equal(fixture.values.get(BACKUP_KEY), raw);
    assert.equal(JSON.parse(fixture.values.get(SAVE_KEY)).coins, 50);
  }
});

test('failed unreadable backup blocks replacement and a later retry preserves the original first', context => {
  const raw = '{"schemaVersion":99,"coins":987}';
  const fixture = mockStorage(context, raw);
  fixture.backupBlocked = true;
  const warnings = [];
  const profile = loadProfile(message => warnings.push(message));
  assert.match(warnings[0], /saving is blocked/i);
  assert.equal(saveProfile(profile), false, 'main-key writes would succeed, but cannot bypass backup');
  assert.equal(fixture.values.get(SAVE_KEY), raw);
  assert.equal(fixture.values.has(BACKUP_KEY), false);
  fixture.backupBlocked = false;
  assert.equal(saveProfile(profile), true);
  assert.equal(fixture.values.get(BACKUP_KEY), raw);
  assert.deepEqual(JSON.parse(fixture.values.get(SAVE_KEY)), profile);
});

test('recovery never overwrites earlier distinct backups and reuses identical ones', context => {
  const fixture = mockStorage(context, '{"schemaVersion":99,"coins":300}');
  fixture.values.set(BACKUP_KEY, 'first damaged save');
  fixture.values.set(`${BACKUP_KEY}-1`, 'second damaged save');
  loadProfile();
  assert.equal(fixture.values.get(BACKUP_KEY), 'first damaged save');
  assert.equal(fixture.values.get(`${BACKUP_KEY}-1`), 'second damaged save');
  assert.equal(fixture.values.get(`${BACKUP_KEY}-2`), fixture.values.get(SAVE_KEY));
  loadProfile();
  assert.equal(fixture.values.has(`${BACKUP_KEY}-3`), false);
});

test('storage read failure warns and blocks writes until the original can be reloaded', context => {
  const original = normalizeProfile({...defaultProfile(), coins: 912});
  const fixture = mockStorage(context, JSON.stringify(original));
  fixture.readBlocked = true;
  const warnings = [];
  const temporary = loadProfile(message => warnings.push(message));
  assert.match(warnings[0], /Saving is paused/);
  assert.equal(saveProfile(temporary), false);
  fixture.readBlocked = false;
  assert.equal(saveProfile(temporary), false, 'restored access alone must not commit unread defaults');
  assert.equal(fixture.values.get(SAVE_KEY), JSON.stringify(original));
  const reloaded = loadProfile();
  assert.deepEqual(reloaded, original);
  assert.equal(saveProfile({...reloaded, coins: 913}), true);
});

test('Level 1 finish, Level 2 access and six-Blueprint Swift purchase survive storage reload', context => {
  mockStorage(context);
  const initial = {...defaultProfile(), blueprints: 6};
  const run = createRunEconomy({runId: 'slice6-finish', levelId: 'level1', mode: 'normal', fullStart: true});
  const settled = settleRun(initial, run, [], 4000, true, true);
  assert.equal(saveProfile(settled.profile), true);
  const finished = loadProfile();
  assert.equal(finished.levelProgress.level1.completed, true);
  assert.equal(finished.levelProgress.level2.unlocked, true);
  assert.equal(vehicleStatus(finished, 'swift').canPurchase, true);
  assert.equal(finished.ownedVehicleIds.includes('swift'), false, 'completion does not waive the purchase');
  const bought = purchaseVehicle(finished, 'swift');
  assert.equal(bought.ok, true);
  const selected = selectVehicle(bought.profile, 'swift');
  assert.equal(saveProfile(selected.profile), true);
  const reloaded = loadProfile();
  assert.equal(reloaded.selectedVehicleId, 'swift');
  assert.equal(reloaded.blueprints, 0);
  assert.equal(reloaded.ownedVehicleIds.includes('swift'), true);
  assert.equal(reloaded.shipStates.swift.unlockedSlotCount, 3);
  assert.deepEqual(settleRun(reloaded, run, [], 4000, true, true).profile, reloaded,
    'reload preserves the settlement receipt against duplicate rewards');
});

test('every implemented equipment item and full six-slot per-truck loadouts round-trip without stat loss', context => {
  mockStorage(context);
  const ids = [CARGO_CAPACITY_ID, ...MODULE_DEFS.map(def => def.id)];
  assert.equal(ids.length, 8);
  let profile = normalizeProfile({
    ...defaultProfile(), coins: 912, blueprints: 7, cargoCapacityRank: 3, reinforcedCargoRank: 2,
    ownedVehicleIds: ['standard', 'swift'],
    ownedModules: Object.fromEntries(MODULE_DEFS.map(def => [def.id, 2])),
    shipStates: Object.fromEntries(['standard', 'swift'].map(id => [id, {
      unlockedSlotCount: SLOT_MAX, equippedModuleIds: [], ownedColorIds: ['default'], equippedColorId: 'default',
    }])),
  });
  assert.equal(SLOT_MAX, 6, 'latest six-slot decision supersedes the stale slice prompt');
  for (let offset = 0; offset < ids.length; offset++) {
    for (const chassis of ['standard', 'swift']) {
      for (const id of [...profile.shipStates[chassis].equippedModuleIds]) {
        profile = unequipModule(profile, id, chassis).profile;
      }
      for (let slot = 0; slot < SLOT_MAX; slot++) {
        const equipped = equipModule(profile, ids[(offset + slot) % ids.length], chassis);
        assert.equal(equipped.ok, true);
        profile = equipped.profile;
      }
    }
    assert.equal(saveProfile(profile), true);
    const reloaded = loadProfile();
    assert.deepEqual(reloaded, profile);
    for (const chassis of ['standard', 'swift']) {
      assert.equal(reloaded.shipStates[chassis].equippedModuleIds.length, SLOT_MAX);
      assert.deepEqual(loadoutStats(reloaded, chassis), loadoutStats(profile, chassis));
    }
    profile = reloaded;
  }
});

test('v5 save migration preserves wallet, ownership, milestones and Standard loadout without inventing level records', () => {
  const previous = {
    schemaVersion: 5,
    coins: 912,
    blueprints: 7,
    ownedVehicleIds: ['standard', 'swift'],
    blueprintRewardIds: ['receipt'],
    deferredBlueprintRewards: [{id: 'pending', amount: 2}],
    bestDistance: 9000,
    totalRuns: 42,
    seenHints: [],
    milestones: ['depot1', 'sector2'],
    unlockedSlotCount: 5,
    ownedModules: {cargo_expanded: 4, hand_precision: 3, coll_magnet: 1},
    equippedModuleIds: ['hand_precision', 'coll_magnet'],
  };

  const migrated = normalizeProfile(previous);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.equal(migrated.coins, previous.coins);
  assert.equal(migrated.blueprints, previous.blueprints);
  assert.deepEqual(migrated.ownedVehicleIds, previous.ownedVehicleIds);
  assert.deepEqual(migrated.blueprintRewardIds, previous.blueprintRewardIds);
  assert.deepEqual(migrated.deferredBlueprintRewards, previous.deferredBlueprintRewards);
  // Legacy global ids become Level 1 ids; the legacy global best distance still repairs Level 1 milestones.
  assert.deepEqual(migrated.milestones, ['level1', 'level1,depot1', 'level1,sector2', 'level1,sector3', 'level1,sector4']);
  assert.equal(migrated.shipStates.standard.unlockedSlotCount, 5);
  assert.equal(migrated.cargoCapacityRank, 4);
  assert.deepEqual(migrated.shipStates.standard.equippedModuleIds, [...previous.equippedModuleIds, CARGO_CAPACITY_ID]);
  assert.equal(migrated.shipStates.standard.equippedColorId, 'default');
  assert.deepEqual(migrated.shipStates.swift.equippedModuleIds, [CARGO_CAPACITY_ID]);
  assert.equal(migrated.shipStates.swift.unlockedSlotCount, 3);
  assert.equal(migrated.bestDistance, previous.bestDistance);
  assert.deepEqual(migrated.levelProgress.level1, {
    unlocked: true, completed: false, sector3CheckpointUnlocked: false, bestDistance: 0,
    checkpointBestDistance: 0, overdriveBestDistance: 0,
    reachedSectors: [1], completedSectors: [],
  });
  assert.deepEqual(migrated.levelProgress.level2, {
    unlocked: false, completed: false, sector3CheckpointUnlocked: false, bestDistance: 0,
    checkpointBestDistance: 0, overdriveBestDistance: 0,
    reachedSectors: [], completedSectors: [],
  });
  assert.ok(!('unlockedSlotCount' in migrated));
  assert.ok(!('equippedModuleIds' in migrated));
  assert.deepEqual(normalizeProfile(migrated), migrated, 'normalization is stable after migration');
});

test('schema 6 migration preserves canonical ship state without granting progress from legacy distance', () => {
  const source = defaultProfile();
  const profile = normalizeProfile({
    ...source,
    schemaVersion: 6,
    bestDistance: 100_000,
    ownedModules: {...source.ownedModules, hand_precision: 1},
    shipStates: {
      ...source.shipStates,
      standard: {
        ...source.shipStates.standard,
        unlockedSlotCount: 5,
        equippedModuleIds: ['hand_precision'],
        ownedColorIds: ['default', 'white-blue', 'unknown'],
        equippedColorId: 'white-blue',
      },
    },
    levelProgress: {
      level1: {unlocked: true, completed: true, sector3CheckpointUnlocked: true, bestDistance: 2000,
        overdriveBestDistance: 500},
      level2: {unlocked: false, completed: true, sector3CheckpointUnlocked: false, bestDistance: 100,
        overdriveBestDistance: 0},
    },
  });
  assert.equal(profile.schemaVersion, SCHEMA_VERSION);
  assert.equal(profile.shipStates.standard.unlockedSlotCount, 5);
  assert.deepEqual(profile.shipStates.standard.equippedModuleIds, ['hand_precision']);
  assert.deepEqual(profile.shipStates.standard.ownedColorIds, ['default', 'white-blue']);
  assert.equal(profile.shipStates.standard.equippedColorId, 'white-blue');
  assert.equal(profile.levelProgress.level1.completed, true);
  assert.equal(profile.levelProgress.level2.completed, true);
  assert.equal(profile.levelProgress.level2.unlocked, true, 'a stored completion implies the level is unlocked');
  assert.equal(profile.bestDistance, 100_000);
  assert.deepEqual(profile.settledRunIds, []);
});

test('Level 2 unlock and checkpoint progress normalize independently during schema migration', () => {
  const source = defaultProfile();
  const profile = normalizeProfile({
    ...source,
    levelProgress: {
      ...source.levelProgress,
      level1: {...source.levelProgress.level1, completed: true, bestDistance: 9000},
      level2: {...source.levelProgress.level2, sector3CheckpointUnlocked: true, checkpointBestDistance: 700},
    },
  });
  assert.equal(profile.schemaVersion, SCHEMA_VERSION);
  assert.equal(profile.levelProgress.level2.unlocked, true, 'Level 1 completion grants Level 2 access');
  assert.equal(profile.levelProgress.level2.sector3CheckpointUnlocked, true);
  assert.equal(profile.levelProgress.level2.checkpointBestDistance, 700);
  assert.equal(profile.levelProgress.level1.sector3CheckpointUnlocked, false);
  assert.equal(profile.levelProgress.level1.bestDistance, 9000);
});

test('v7 migration rejects a Level 2 checkpoint flag unsupported by Level 2 progress', () => {
  const source = defaultProfile();
  const profile = normalizeProfile({
    ...source,
    schemaVersion: 7,
    levelProgress: {
      ...source.levelProgress,
      level1: {...source.levelProgress.level1, sector3CheckpointUnlocked: true},
      level2: {...source.levelProgress.level2, unlocked: true, sector3CheckpointUnlocked: true},
    },
  });
  assert.equal(profile.levelProgress.level1.sector3CheckpointUnlocked, true);
  assert.equal(profile.levelProgress.level2.sector3CheckpointUnlocked, false);
  assert.equal(profile.coins, source.coins);
  assert.deepEqual(profile.ownedVehicleIds, source.ownedVehicleIds);
});

test('v8 migration preserves equivalent cargo capacity and equipped Radar as Impact Pulse', () => {
  const source = defaultProfile();
  const profile = normalizeProfile({
    ...source,
    schemaVersion: 8,
    coins: 431,
    ownedModules: {...source.ownedModules, cargo_expanded: 5, util_radar: 4},
    shipStates: {
      standard: {...source.shipStates.standard,
        equippedModuleIds: ['cargo_expanded', 'hand_precision', 'util_radar']},
    },
  });
  assert.equal(profile.coins, 431);
  assert.equal(profile.cargoCapacityRank, 5);
  assert.equal(profile.shipStates.standard.equippedModuleIds.includes(CARGO_CAPACITY_ID), true);
  assert.equal(profile.ownedModules.util_impact_pulse, 4);
  assert.equal(profile.shipStates.standard.equippedModuleIds.includes('util_impact_pulse'), true);
  assert.equal(profile.ownedModules.util_radar, undefined);
  assert.deepEqual(profile.shipStates.standard.equippedModuleIds, ['util_impact_pulse', CARGO_CAPACITY_ID],
    'Impact Pulse stays equipped and schema 11 restores owned capacity into the available slot');
});

test('v9 migration preserves cargo ranks and independently selected per-ship loadouts', () => {
  const source = defaultProfile();
  const profile = normalizeProfile({
    ...source,
    schemaVersion: 9,
    cargoCapacityRank: 6,
    reinforcedCargoRank: 3,
    ownedVehicleIds: ['standard', 'swift'],
    selectedVehicleId: 'swift',
    shipStates: {
      ...source.shipStates,
      standard: {...source.shipStates.standard, unlockedSlotCount: 5, ownedColorIds: ['default', 'black-red']},
      swift: {unlockedSlotCount: 4, equippedModuleIds: ['hand_precision'],
        ownedColorIds: ['default', 'white-blue'], equippedColorId: 'white-blue'},
    },
    levelProgress: {
      ...source.levelProgress,
      level1: {...source.levelProgress.level1, completed: true},
      level2: {...source.levelProgress.level2, unlocked: true},
    },
  });
  assert.equal(profile.schemaVersion, SCHEMA_VERSION);
  assert.equal(profile.cargoCapacityRank, 6);
  assert.equal(profile.reinforcedCargoRank, 3);
  assert.equal(profile.selectedVehicleId, 'swift');
  assert.equal(profile.shipStates.standard.unlockedSlotCount, 5);
  assert.equal(profile.shipStates.swift.unlockedSlotCount, 4);
  assert.equal(profile.shipStates.swift.equippedColorId, 'white-blue');
  assert.equal(profile.shipStates.standard.ownedColorIds.includes('gold'), false);
});

test('unknown save schemas are backed up before defaults are returned', () => {
  const originalStorage = globalThis.localStorage;
  const values = new Map([['cargo-run-prototype-profile-v1', '{"schemaVersion":99,"coins":123}']]);
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    assert.deepEqual(loadProfile(), defaultProfile());
    assert.equal(values.get('cargo-run-prototype-profile-v1-unreadable-backup'),
      '{"schemaVersion":99,"coins":123}');
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
});

test('v10 capacity migration keeps ranks, wallet, full loadouts and grandfathered gear without a reset', () => {
  const initial = defaultProfile();
  const old = {...initial, schemaVersion: 10, coins: 912, cargoCapacityRank: 6,
    reinforcedCargoRank: 3, ownedVehicleIds: ['standard', 'swift'], selectedVehicleId: 'swift',
    ownedModules: {...initial.ownedModules, hand_precision: 1, util_impact_pulse: 4},
    shipStates: {
      standard: {...initial.shipStates.standard, equippedModuleIds: ['hand_precision', 'util_impact_pulse']},
      swift: {unlockedSlotCount: 3, equippedModuleIds: ['util_impact_pulse'],
        ownedColorIds: ['default'], equippedColorId: 'default'},
    }};
  const profile = normalizeProfile(old);
  assert.equal(profile.schemaVersion, SCHEMA_VERSION);
  assert.equal(profile.coins, 912);
  assert.equal(profile.cargoCapacityRank, 6);
  assert.equal(profile.reinforcedCargoRank, 3);
  assert.equal(profile.selectedVehicleId, 'swift');
  assert.deepEqual(profile.shipStates.standard.equippedModuleIds, ['hand_precision', 'util_impact_pulse']);
  assert.deepEqual(profile.shipStates.swift.equippedModuleIds, ['util_impact_pulse', CARGO_CAPACITY_ID]);
  assert.equal(loadoutStats(profile).capacity, 11);
  assert.equal(loadoutStats(profile, 'swift').capacity, 23);
  assert.equal(moduleStatus(profile, 'util_impact_pulse').grandfathered, true);
  assert.equal(profile.ownedModules.util_impact_pulse, 4);
  assert.deepEqual(normalizeProfile(profile), profile, 'repeated loads do not re-run migration');
  const manuallyRemoved = unequipModule(profile, CARGO_CAPACITY_ID, 'swift').profile;
  assert.deepEqual(normalizeProfile(manuallyRemoved).shipStates.swift.equippedModuleIds, ['util_impact_pulse']);
  assert.equal(equipModule(profile, CARGO_CAPACITY_ID).ok, false, 'full loadout is not evicted');
});

test('cargo tier saves retain both purchased ranks and the same equipment ID without a reset', () => {
  for (const schemaVersion of [9, 10, 11, 12]) {
    for (const equipped of [false, true]) {
      const source = defaultProfile();
      source.schemaVersion = schemaVersion;
      source.coins = 1234;
      source.cargoCapacityRank = 8;
      source.reinforcedCargoRank = 3;
      source.shipStates.standard.equippedModuleIds = equipped
        ? ['hand_precision', CARGO_CAPACITY_ID] : ['hand_precision'];
      const profile = normalizeProfile(source);
      assert.equal(profile.coins, 1234);
      assert.equal(profile.cargoCapacityRank, 8);
      assert.equal(profile.reinforcedCargoRank, 3);
      assert.equal(profile.shipStates.standard.equippedModuleIds.filter(id => id === CARGO_CAPACITY_ID).length,
        schemaVersion < 11 || equipped ? 1 : 0);
      assert.equal(profile.shipStates.standard.unlockedSlotCount, 2);
      assert.deepEqual(normalizeProfile(profile), profile);
      const removed = profile.shipStates.standard.equippedModuleIds.includes(CARGO_CAPACITY_ID)
        ? unequipModule(profile, CARGO_CAPACITY_ID).profile : profile;
      const reloaded = normalizeProfile(removed);
      assert.equal(loadoutStats(reloaded).capacity, 11);
      assert.equal(loadoutStats(reloaded).cargoMitigation, 0);
      assert.equal(reloaded.reinforcedCargoRank, 3);
      const restored = normalizeProfile(equipModule(reloaded, CARGO_CAPACITY_ID).profile);
      assert.equal(loadoutStats(restored).capacity, 32);
      assert.equal(loadoutStats(restored).cargoMitigation, 0.45);
    }
  }
});

test('sector evidence migrates only from the correct Level normal-run records, not global or Overdrive distance', () => {
  const initial = defaultProfile();
  const source = {...initial, schemaVersion: 10, bestDistance: 99999, milestones: ['sector3', 'sector4'],
    levelProgress: {
      level1: {...initial.levelProgress.level1,
        bestDistance: GAME_BALANCE.routes.level1.sectorEndsMeters[2] - 1, overdriveBestDistance: 99999},
      level2: {...initial.levelProgress.level2, unlocked: true, sector3CheckpointUnlocked: true},
    }};
  const profile = normalizeProfile(source);
  assert.deepEqual(profile.levelProgress.level1.completedSectors, [1, 2]);
  assert.equal(moduleStatus(profile, 'cargo_light').unlocked, false);
  assert.equal(moduleStatus(profile, 'def_shield').unlocked, false);
  assert.equal(moduleStatus(profile, 'util_insurance').unlocked, false, 'unlocking Level 2 is not entering it');
  const exact = normalizeProfile({...source, levelProgress: {
    ...source.levelProgress,
    level1: {...source.levelProgress.level1, bestDistance: GAME_BALANCE.routes.level1.finishDistanceMeters},
    level2: {...source.levelProgress.level2, checkpointBestDistance:
      GAME_BALANCE.routes.level2.sectorEndsMeters[2] - GAME_BALANCE.routes.level2.checkpointDistanceMeters},
  }});
  assert.equal(moduleStatus(exact, 'cargo_light').unlocked, true);
  assert.equal(moduleStatus(exact, 'def_shield').unlocked, true);
  assert.deepEqual(exact.levelProgress.level2.completedSectors, [3],
    'a checkpoint record adds its authored start but does not invent earlier completions');
  const completion = normalizeProfile({...source, levelProgress: {
    ...source.levelProgress, level1: {...source.levelProgress.level1, completed: true},
  }});
  assert.equal(moduleStatus(completion, 'def_plating').unlocked, false,
    'Plating now requires completing Level 2, Sector 4, not Level 1');
  const plated = normalizeProfile({...completion, levelProgress: {
    ...completion.levelProgress, level2: {...completion.levelProgress.level2, completed: true},
  }});
  assert.equal(moduleStatus(plated, 'def_plating').unlocked, true);
  assert.equal(moduleStatus(completion, 'util_insurance').unlocked, false);
});

test('tutorial state defaults false and established saves migrate as completed', () => {
  assert.equal(defaultProfile().tutorialCompleted, false);
  const fresh = normalizeProfile({...defaultProfile(), schemaVersion: 11});
  assert.equal(fresh.tutorialCompleted, false);
  for (const returning of [
    {...defaultProfile(), schemaVersion: 11, totalRuns: 1},
    {...defaultProfile(), schemaVersion: 11, bestDistance: 1},
    {...defaultProfile(), schemaVersion: 11,
      levelProgress: {...defaultProfile().levelProgress, level1: {...defaultProfile().levelProgress.level1, bestDistance: 100}}},
  ]) assert.equal(normalizeProfile(returning).tutorialCompleted, true);
});
