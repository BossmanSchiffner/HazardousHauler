import test from 'node:test';
import assert from 'node:assert/strict';
import {buyVehicleTrim, purchaseVehicle, selectVehicle, selectVehicleTrim, vehicleStatus} from '../src/game/core/vehicles.js';
import {equipModule, loadoutStats, nextSlotOffer, unlockNextSlot, buyModule} from '../src/game/core/modules.js';
import {defaultProfile, normalizeProfile} from '../src/game/core/save.js';
import {steeringMultiplier} from '../src/game/core/economy.js';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';

const SWIFT_BLUEPRINTS = GAME_BALANCE.vehicles.swift.blueprintCost;
const SWIFT_STEERING = GAME_BALANCE.vehicles.swift.steeringMultiplier;

test('Standard trim refinements preserve legacy IDs, purchase prices and saved ownership', () => {
  for (const id of ['white-blue', 'black-red', 'yellow-blue']) {
    const cost = GAME_BALANCE.presentation.cosmeticPriceCoins[id];
    const profile = {...defaultProfile(), coins: cost + 10};
    const bought = buyVehicleTrim(profile, 'standard', id);
    assert.equal(bought.ok, true);
    assert.equal(bought.profile.coins, 10);
    const equipped = selectVehicleTrim(bought.profile, 'standard', id);
    assert.equal(equipped.ok, true);
    assert.equal(equipped.profile.coins, 10);
    const restored = normalizeProfile(equipped.profile);
    assert.equal(restored.shipStates.standard.equippedColorId, id);
    assert.ok(restored.shipStates.standard.ownedColorIds.includes(id));
    assert.equal(profile.coins, cost + 10);
  }
  const locked = defaultProfile();
  assert.equal(selectVehicleTrim(locked, 'standard', 'gold').ok, false);
  const earned = {...locked, shipStates: {...locked.shipStates, standard: {
    ...locked.shipStates.standard, ownedColorIds: ['default', 'gold'], equippedColorId: 'gold',
  }}};
  assert.equal(normalizeProfile(earned).shipStates.standard.equippedColorId, 'gold');
  assert.throws(() => buyVehicleTrim(locked, 'standard', 'gold'), /Invalid vehicle trim purchase/,
    'gold remains earned, not purchasable');
});

test('Swift Runner stays locked until Level 2 unlock and costs its configured Blueprints', () => {
  assert.equal(SWIFT_BLUEPRINTS, 6);
  const initial = {...defaultProfile(), blueprints: SWIFT_BLUEPRINTS};
  assert.equal(purchaseVehicle({...initial, blueprints: SWIFT_BLUEPRINTS - 1, levelProgress: {
    ...initial.levelProgress, level2: {...initial.levelProgress.level2, unlocked: true},
  }}, 'swift').ok, false, 'one Blueprint short cannot buy the Swift Runner');
  assert.equal(vehicleStatus(initial, 'swift').canPurchase, false);
  assert.equal(purchaseVehicle(initial, 'swift').reason, 'Finish Level 1 to unlock the Swift Runner.');
  const ready = {...initial, levelProgress: {
    ...initial.levelProgress,
    level1: {...initial.levelProgress.level1, completed: true},
    level2: {...initial.levelProgress.level2, unlocked: true},
  }};
  const bought = purchaseVehicle(ready, 'swift');
  assert.ok(bought.ok);
  assert.equal(bought.profile.blueprints, 0);
  assert.equal(bought.profile.selectedVehicleId, 'standard');
  assert.equal(bought.profile.shipStates.swift.unlockedSlotCount, 3);
  assert.deepEqual(bought.profile.shipStates.swift.equippedModuleIds, []);
  assert.equal(bought.profile.shipStates.standard.unlockedSlotCount, 2);
  const selected = selectVehicle(bought.profile, 'swift');
  assert.equal(selected.profile.selectedVehicleId, 'swift');
  assert.equal(selectVehicle(initial, 'swift').ok, false);
});

test('cargo capacity and one shared steering calculation apply Swift trade-offs exactly once', () => {
  const base = defaultProfile();
  const withSwift = purchaseVehicle({...base, blueprints: SWIFT_BLUEPRINTS, levelProgress: {
    ...base.levelProgress, level2: {...base.levelProgress.level2, unlocked: true},
  }}, 'swift').profile;
  const ranked = {...withSwift, cargoCapacityRank: 8};
  assert.equal(loadoutStats(ranked, 'standard').capacity, 11,
    'owned capacity ranks apply only while Expanded Cargo is equipped');
  const maxed = {...ranked, shipStates: Object.fromEntries(Object.entries(ranked.shipStates).map(([id, state]) =>
    [id, {...state, equippedModuleIds: [...state.equippedModuleIds, 'cargo_expanded']}]))};
  assert.equal(loadoutStats(maxed, 'standard').capacity, 32);
  assert.equal(loadoutStats(maxed, 'swift').capacity, 28);
  assert.equal(loadoutStats(maxed, 'swift').vehicleSteeringMultiplier, SWIFT_STEERING);
  assert.ok(Math.abs(steeringMultiplier(0, 28, 0, 0, SWIFT_STEERING) / steeringMultiplier(0, 32, 0, 0) -
    SWIFT_STEERING) < 1e-12);
  assert.ok(steeringMultiplier(28, 28, 0, 0, SWIFT_STEERING) < SWIFT_STEERING,
    'the full-load penalty is preserved under the chassis response multiplier');
});

test('Armoured Transport costs 12 Blueprints, stays unselected until equipped and survives save normalization', () => {
  const initial = {...defaultProfile(), blueprints: 12};
  assert.equal(vehicleStatus(initial, 'armoured').canPurchase, true);
  assert.equal(purchaseVehicle({...initial, blueprints: 11}, 'armoured').reason, 'Not enough Blueprints');
  assert.equal(selectVehicle(initial, 'armoured').ok, false);
  const bought = purchaseVehicle(initial, 'armoured');
  assert.equal(bought.ok, true);
  assert.equal(bought.profile.blueprints, 0);
  assert.equal(bought.profile.selectedVehicleId, 'standard');
  assert.equal(bought.profile.shipStates.armoured.unlockedSlotCount, 2);
  assert.deepEqual(bought.profile.shipStates.armoured.equippedModuleIds, []);
  assert.equal(initial.blueprints, 12, 'purchase is immutable');
  assert.equal(initial.ownedVehicleIds.includes('armoured'), false);
  assert.equal(purchaseVehicle(bought.profile, 'armoured').reason, 'Already owned');
  const restored = normalizeProfile(selectVehicle(bought.profile, 'armoured').profile);
  assert.equal(restored.selectedVehicleId, 'armoured');
  assert.ok(restored.ownedVehicleIds.includes('armoured'));
  assert.deepEqual(restored.shipStates.armoured, bought.profile.shipStates.armoured);
});

test('retired chassis ownership and selection are removed from old saves without losing currency or modules', () => {
  const profile = {...defaultProfile(), coins: 321, blueprints: 7,
    ownedVehicleIds: ['standard', 'prospector'], selectedVehicleId: 'prospector',
    ownedModules: {hand_precision: 2}};
  profile.shipStates.prospector = structuredClone(profile.shipStates.standard);
  const normalized = normalizeProfile(profile);
  assert.deepEqual(normalized.ownedVehicleIds, ['standard']);
  assert.equal(normalized.selectedVehicleId, 'standard');
  assert.equal(normalized.shipStates.prospector, undefined);
  assert.equal(normalized.coins, 321);
  assert.equal(normalized.blueprints, 7);
  assert.equal(normalized.ownedModules.hand_precision, 2);
});

test('Armoured chassis stats and equipped upgrades combine without losing its built-in shield', () => {
  const base = purchaseVehicle({...defaultProfile(), blueprints: 12}, 'armoured').profile;
  const stats = loadoutStats(base, 'armoured');
  assert.equal(stats.hull, 4);
  assert.equal(stats.shieldCapacity, 1);
  assert.equal(stats.capacity, 16);
  assert.equal(stats.vehicleSteeringMultiplier, 0.8);
  assert.ok(Math.abs(steeringMultiplier(0, 16, 0, 0, stats.vehicleSteeringMultiplier) /
    steeringMultiplier(0, 11, 0, 0) - 0.8) < 1e-12);
  const upgraded = {...base, cargoCapacityRank: 8, ownedModules: {def_shield: 3, def_plating: 1},
    shipStates: {...base.shipStates, armoured: {...base.shipStates.armoured, unlockedSlotCount: 6,
      equippedModuleIds: ['cargo_expanded', 'def_plating', 'def_shield']}}};
  const equipped = loadoutStats(upgraded, 'armoured');
  assert.equal(equipped.capacity, 37, 'capacity upgrades preserve the chassis advantage');
  assert.equal(equipped.hull, 5);
  assert.equal(equipped.shieldCapacity, 4, 'three module charges add to the built-in charge');
  assert.equal(loadoutStats(upgraded, 'standard').shieldCapacity, 0);
  const trimmed = buyVehicleTrim({...base, coins: 750}, 'armoured', 'white-blue');
  assert.equal(trimmed.ok, true);
  assert.equal(normalizeProfile(selectVehicleTrim(trimmed.profile, 'armoured', 'white-blue').profile)
    .shipStates.armoured.equippedColorId, 'white-blue');
});

test('equipment ranks are shared but slot purchases and loadouts belong to each ship', () => {
  const source = defaultProfile();
  const levelOneOnly = purchaseVehicle({...source, blueprints: SWIFT_BLUEPRINTS, coins: 3000,
    milestones: ['depot1', 'sector2', 'sector3', 'sector4'],
    levelProgress: {...source.levelProgress, level2: {...source.levelProgress.level2, unlocked: true}}},
  'swift').profile;
  assert.deepEqual(nextSlotOffer(levelOneOnly, 'swift'), {
    slot: 4, cost: 500, reached: false, requirement: 'Reach Level 2, Sector 1', canBuy: false,
  });
  const profile = {...levelOneOnly, milestones: [...levelOneOnly.milestones, 'level2']};
  assert.deepEqual(nextSlotOffer(profile, 'swift'), {
    slot: 4, cost: 500, reached: true, requirement: 'Reach Level 2, Sector 1', canBuy: true,
  });
  let upgraded = unlockNextSlot(profile, 'swift');
  assert.ok(upgraded.ok);
  assert.equal(upgraded.profile.shipStates.swift.unlockedSlotCount, 4);
  assert.equal(upgraded.profile.shipStates.standard.unlockedSlotCount, 2);
  const purchased = buyModule(upgraded.profile, 'hand_precision', 'swift');
  assert.ok(purchased.ok);
  assert.ok(purchased.profile.shipStates.swift.equippedModuleIds.includes('hand_precision'));
  assert.equal(purchased.profile.shipStates.standard.equippedModuleIds.includes('hand_precision'), false);
  assert.equal(purchased.profile.ownedModules.hand_precision, 1);
  const equippedOnStandard = equipModule(purchased.profile, 'hand_precision', 'standard');
  assert.ok(equippedOnStandard.ok);
  assert.ok(equippedOnStandard.profile.shipStates.standard.equippedModuleIds.includes('hand_precision'));
  assert.equal(equippedOnStandard.profile.ownedModules.hand_precision, 1);
  const sanitized = normalizeProfile({...equippedOnStandard.profile, shipStates: {
    ...equippedOnStandard.profile.shipStates,
    swift: {...equippedOnStandard.profile.shipStates.swift,
      equippedModuleIds: ['hand_precision', 'hand_precision']},
  }});
  assert.deepEqual(sanitized.shipStates.swift.equippedModuleIds, ['hand_precision']);
  assert.ok(sanitized.shipStates.standard.equippedModuleIds.includes('hand_precision'));
});

test('trim purchase and selection are persistent per ship and do not purchase on selection', () => {
  const source = defaultProfile();
  const profile = purchaseVehicle({...source, blueprints: SWIFT_BLUEPRINTS, coins: 1500, levelProgress: {
    ...source.levelProgress, level2: {...source.levelProgress.level2, unlocked: true},
  }}, 'swift').profile;
  const bought = buyVehicleTrim(profile, 'swift', 'white-blue');
  assert.ok(bought.ok);
  assert.equal(bought.profile.coins, 750);
  assert.equal(bought.profile.shipStates.swift.equippedColorId, 'default');
  assert.equal(selectVehicleTrim(bought.profile, 'swift', 'white-blue').profile.shipStates.swift.equippedColorId,
    'white-blue');
  assert.equal(bought.profile.shipStates.standard.ownedColorIds.includes('white-blue'), false);
  assert.equal(selectVehicleTrim(profile, 'swift', 'white-blue').ok, false);
  assert.equal(normalizeProfile(bought.profile).shipStates.swift.ownedColorIds.includes('white-blue'), true);
});
