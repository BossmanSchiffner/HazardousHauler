import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMilestones, buyModule, equipModule, loadoutStats, MAX_MODULE_LEVEL, MILESTONE_REWARDS, MILESTONES,
  cargoCapacityStatus, formatStat, milestonesForDistance, MODULE_DEFS, moduleLevelCap, moduleStatus, nextSlotOffer,
  reinforcedCargoStatus, unequipModule, unlockNextSlot, upgradeCargoCapacity, upgradeModule,
  upgradeReinforcedCargo, WORST_CASE_HANDLING,
  CARGO_CAPACITY_ID,
} from '../src/game/core/modules.js';
import {defaultProfile, migrateV1, normalizeProfile} from '../src/game/core/save.js';
import {MODULES as DESIGN_MODULES} from '../src/game/data/catalog.js';
import {upgradeCost} from '../src/game/core/economy.js';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';
import {IMPLEMENTED_LEVELS} from '../src/game/core/sectors.js';
import {recordSectorProgress} from '../src/game/core/progression.js';
import {supportedTrackProfiles} from '../src/game/core/trackValidation.js';
import {damageCargo} from '../src/game/core/cargo.js';

const BALANCE_MODULES = GAME_BALANCE.upgrades.modules;
const PRECISION = BALANCE_MODULES.hand_precision;
const CARGO = GAME_BALANCE.cargoProgression;
const STANDARD = GAME_BALANCE.vehicles.standard;
const SWIFT = GAME_BALANCE.vehicles.swift;
const BASE_CAPACITY = CARGO.capacityByRank[0];
const MAX_CAPACITY = CARGO.capacityByRank.at(-1);
const MAX_CAPACITY_RANK = CARGO.capacityUpgradePrices.length;
const L1 = GAME_BALANCE.routes.level1;
const L2 = GAME_BALANCE.routes.level2;
const RICH_COINS = 100_000;

// Precision Steering is a paid module (no free starter), so loadout fixtures buy it explicitly.
function withPrecision(profile = defaultProfile()) {
  const bought = buyModule({...profile, coins: PRECISION.price}, 'hand_precision');
  assert.ok(bought.ok, bought.reason);
  return {...bought.profile, coins: profile.coins};
}
const rich = (overrides = {}) => ({...withPrecision(), coins: RICH_COINS, ...overrides});

test('approved economy constants: Cargo rank 1 costs 150 Coins and Precision Steering is purchasable', () => {
  assert.equal(CARGO.capacityUpgradePrices[0], 150);
  assert.equal(PRECISION.starter, false);
  assert.equal(PRECISION.unlock, null);
});

test('every implemented module is a catalog module with rising ranks and a three-level depot shield', () => {
  assert.equal(MODULE_DEFS.length, Object.keys(BALANCE_MODULES).length);
  for (const def of MODULE_DEFS) {
    assert.ok(DESIGN_MODULES.some(m => m.id === def.id), def.id);
    assert.equal(def.tier, 1);
    assert.equal(def.benefit.values.length, BALANCE_MODULES[def.id].values.length);
    assert.equal(def.benefit.values.length, def.id === 'def_shield' ? BALANCE_MODULES.def_shield.values.length : MAX_MODULE_LEVEL);
    assert.equal(moduleStatus(defaultProfile(), def.id).maxRank, def.benefit.values.length);
    for (let i = 1; i < def.benefit.values.length; i++) {
      assert.ok(def.benefit.values[i] >= def.benefit.values[i - 1], def.id);
    }
  }
  assert.ok(Math.abs(WORST_CASE_HANDLING - BALANCE_MODULES.def_plating.drawback.value) < 1e-9);
  for (const id of MILESTONES) assert.ok(MILESTONE_REWARDS[id], id);
});

test('a new profile starts with no free module, the base cargo capacity, and can buy Precision Steering', () => {
  const p = defaultProfile();
  assert.deepEqual(p.shipStates.standard.equippedModuleIds, []);
  assert.deepEqual(p.ownedModules, {});
  assert.equal(p.shipStates.standard.unlockedSlotCount, GAME_BALANCE.upgrades.startingSlots);
  const stats = loadoutStats(p);
  assert.equal(stats.capacity, BASE_CAPACITY);
  assert.equal(p.cargoCapacityRank, 0);
  assert.equal(stats.hull, STANDARD.baseStats.hull);
  assert.equal(stats.handling, STANDARD.baseStats.handling);
  assert.equal(buyModule({...p, coins: PRECISION.price - 1}, 'hand_precision').reason, 'Not enough Coins');
  const bought = buyModule({...p, coins: PRECISION.price}, 'hand_precision');
  assert.ok(bought.ok);
  assert.equal(bought.profile.coins, 0);
  assert.deepEqual(bought.profile.shipStates.standard.equippedModuleIds, ['hand_precision']);
  assert.ok(Math.abs(loadoutStats(bought.profile).handling - PRECISION.values[0]) < 1e-9);
});

test('milestones come from distance, persist, and raise the level cap', () => {
  const [, l1Sector2, l1Sector3, l1Sector4] = L1.sectorStartsMeters;
  const {baseLevelCap, maxRank} = GAME_BALANCE.upgrades;
  assert.deepEqual(milestonesForDistance(0), ['level1']);
  assert.deepEqual(milestonesForDistance(l1Sector2 - 1), ['level1']);
  assert.deepEqual(milestonesForDistance(l1Sector2), ['level1', 'level1,sector2']);
  assert.deepEqual(milestonesForDistance(l1Sector3 - 1), ['level1', 'level1,sector2']);
  assert.deepEqual(milestonesForDistance(l1Sector4), ['level1', 'level1,sector2', 'level1,sector3', 'level1,sector4']);
  assert.deepEqual(milestonesForDistance(L2.sectorStartsMeters[3], 'level2'), ['level2', 'level2,sector2', 'level2,sector3', 'level2,sector4'],
    'each level records its own sector milestones');
  assert.deepEqual(MILESTONES, ['level1', 'level1,depot1', 'level1,sector2', 'level1,sector3', 'level1,sector4',
    'level2', 'level2,depot1', 'level2,sector2', 'level2,sector3', 'level2,sector4',
    'level3', 'level3,depot1', 'level3,sector2', 'level3,sector3', 'level3,sector4',
    'level4', 'level4,depot1', 'level4,sector2', 'level4,sector3', 'level4,sector4']);
  const {profile, added} = addMilestones(defaultProfile(), ['level1,sector2', 'level1,depot1']);
  assert.deepEqual(added, ['level1,sector2', 'level1,depot1']);
  assert.deepEqual(profile.milestones, ['level1,depot1', 'level1,sector2']);
  assert.equal(addMilestones(profile, ['level1,depot1']).added.length, 0);
  assert.equal(moduleLevelCap([]), baseLevelCap);
  assert.equal(moduleLevelCap(['level1,depot1', 'level1,sector2']), baseLevelCap + 1);
  assert.equal(moduleLevelCap(['level2,depot1', 'level2,sector2', 'level2,sector3', 'level2,sector4']), baseLevelCap,
    'another level\u2019s milestones never satisfy Level 1 gates');
  assert.equal(moduleLevelCap(MILESTONES), maxRank);
  // Reloading never forgets a milestone, and per-level best distance repairs missing ones.
  assert.deepEqual(normalizeProfile(profile).milestones, ['level1', 'level1,depot1', 'level1,sector2']);
  const repaired = defaultProfile();
  repaired.levelProgress.level1.bestDistance = l1Sector4;
  assert.deepEqual(normalizeProfile(repaired).milestones, ['level1', 'level1,sector2', 'level1,sector3', 'level1,sector4']);
});

test('upgrades respect the level cap, cost coins, and never overspend', () => {
  let p = rich();
  let r = upgradeModule(p, 'hand_precision');
  assert.ok(r.ok);
  assert.equal(r.profile.ownedModules.hand_precision, 2);
  assert.equal(r.profile.coins, p.coins - upgradeCost(GAME_BALANCE.upgrades.modules.hand_precision.upgradeBase, 1));
  p = r.profile;
  r = upgradeModule(p, 'hand_precision');
  assert.equal(r.ok, false, 'Lv 3 needs Sector 2');
  assert.match(r.reason, /Sector 2/);
  p = {...p, milestones: ['level1,depot1', 'level1,sector2']};
  assert.ok(upgradeModule(p, 'hand_precision').ok);

  const poor = {...defaultProfile(), coins: 10};
  assert.equal(upgradeModule(poor, 'hand_precision').ok, false);
  assert.equal(upgradeModule(withPrecision({...defaultProfile(),
    coins: upgradeCost(PRECISION.upgradeBase, 1) - 1}), 'hand_precision').reason, 'Not enough Coins');
  assert.equal(upgradeModule(defaultProfile(), 'coll_magnet').reason, 'Buy the module first');
  const maxed = rich({milestones: [...MILESTONES], ownedModules: {...defaultProfile().ownedModules, hand_precision: GAME_BALANCE.upgrades.maxRank}});
  assert.equal(upgradeModule(maxed, 'hand_precision').ok, false);
});

test('levels owned above the current cap are kept (grandfathered)', () => {
  const migrated = normalizeProfile({schemaVersion: 1, coins: 0, bestDistance: 0, totalRuns: 3, upgrades: {capacity: 5, handling: 5}});
  assert.equal(migrated.cargoCapacityRank, 5);
  assert.equal(migrated.ownedModules.hand_precision, 5);
  assert.equal(cargoCapacityStatus(migrated).rank, 5);
  assert.equal(loadoutStats(migrated).capacity, 25);
});

test('v1 migration is never weaker than the old upgrades', () => {
  for (let capacity = 0; capacity <= 5; capacity++) {
    for (let handling = 0; handling <= 5; handling++) {
      const stats = loadoutStats(migrateV1({schemaVersion: 1, upgrades: {capacity, handling}}));
      assert.ok(stats.capacity >= 10 + capacity * 3, `capacity ${capacity}`);
      assert.ok(stats.handling >= handling * 0.18 - 1e-9, `handling ${handling}`);
    }
  }
});

test('buying requires the unlock milestone and enough coins, and auto-equips into a free slot', () => {
  assert.ok(buyModule(rich(), 'coll_magnet').ok);
  const atDepot = rich({milestones: ['level1,depot1', 'level1,sector2']});
  assert.match(buyModule(atDepot, 'def_shield').reason, /Complete Level 2, Sector 3/);
  assert.equal(buyModule({...atDepot, coins: 5}, 'coll_magnet').reason, 'Not enough Coins');
  assert.equal(upgradeCargoCapacity({...atDepot, coins: 0}).reason, 'Not enough Coins');

  const both = buyModule(atDepot, 'coll_magnet');
  assert.ok(both.ok);
  assert.equal(both.profile.ownedModules.coll_magnet, 1);
  assert.equal(both.profile.coins, atDepot.coins - GAME_BALANCE.upgrades.modules.coll_magnet.price);
  assert.ok(both.profile.shipStates.standard.equippedModuleIds.includes('coll_magnet'),
    'a newly purchased module auto-equips into the free slot');

  const withSlot = unlockNextSlot(atDepot);
  assert.ok(withSlot.ok);
  const bought = buyModule(withSlot.profile, 'coll_magnet');
  assert.ok(bought.profile.shipStates.standard.equippedModuleIds.includes('coll_magnet'));
});

test('equip and unequip never exceed slots, duplicate, or equip unowned gear', () => {
  const atDepot = rich({milestones: ['level1,depot1']});
  const withMagnet = buyModule(atDepot, 'coll_magnet').profile;
  const p = {...withMagnet, ownedModules: {...withMagnet.ownedModules, util_impact_pulse: 1}};
  assert.match(equipModule(p, 'util_impact_pulse').reason, /slots are full/);
  assert.equal(equipModule(p, 'def_shield').reason, 'Buy the module first');
  const freed = unequipModule(p, 'hand_precision');
  assert.ok(freed.ok);
  const swapped = equipModule(freed.profile, 'util_impact_pulse');
  assert.ok(swapped.ok);
  assert.deepEqual(swapped.profile.shipStates.standard.equippedModuleIds, ['coll_magnet', 'util_impact_pulse']);
  assert.equal(unequipModule(swapped.profile, 'hand_precision').ok, false);
  // Saves can't smuggle in duplicates, unowned modules or extra slots.
  const sanitized = normalizeProfile({...swapped.profile, shipStates: {
    ...swapped.profile.shipStates,
    standard: {...swapped.profile.shipStates.standard,
      equippedModuleIds: ['util_impact_pulse', 'util_impact_pulse', 'def_shield', 'hand_precision', 'coll_magnet']},
  }});
  assert.deepEqual(sanitized.shipStates.standard.equippedModuleIds, ['util_impact_pulse', 'hand_precision']);
});

test('slots unlock one at a time, in order, after their milestone', () => {
  const slotPurchases = Object.entries(GAME_BALANCE.upgrades.slotPurchases)
    .map(([slot, offer]) => [Number(slot), offer.costCoins]);
  const [firstSlot, firstCost] = slotPurchases[0];
  let p = rich();
  assert.deepEqual(nextSlotOffer(p), {slot: firstSlot, cost: firstCost, reached: false,
    requirement: `Reach Level 1, Sector 2 (${L1.sectorStartsMeters[1].toLocaleString('en-US')} m)`, canBuy: false});
  assert.equal(unlockNextSlot(p).ok, false);
  p = {...p, milestones: [...MILESTONES]};
  for (const [slot, cost] of slotPurchases) {
    const before = p.coins;
    const r = unlockNextSlot(p);
    assert.ok(r.ok, `slot ${slot}`);
    assert.equal(r.profile.shipStates.standard.unlockedSlotCount, slot);
    assert.equal(r.profile.coins, before - cost);
    p = r.profile;
  }
  assert.equal(nextSlotOffer(p), null);
  assert.equal(unlockNextSlot(p).ok, false);
  assert.equal(unlockNextSlot({...defaultProfile(), milestones: ['level1,depot1', 'level1,sector2'], coins: firstCost - 1}).reason, 'Not enough Coins');
});

test('loadout stats add benefits and drawbacks; Apex boosts only benefits', () => {
  const p = rich({
    milestones: [...MILESTONES],
    shipStates: {
      ...defaultProfile().shipStates,
      standard: {...defaultProfile().shipStates.standard, unlockedSlotCount: 6,
        equippedModuleIds: ['hand_precision', 'cargo_light', 'def_plating', 'def_shield', 'util_insurance']},
      apex: {unlockedSlotCount: 2,
        equippedModuleIds: ['hand_precision', 'cargo_light', 'def_plating', 'def_shield', 'util_insurance']},
    },
    ownedModules: {hand_precision: 1, cargo_light: 1, def_plating: 3, def_shield: 1, util_insurance: 5},
  });
  const M = BALANCE_MODULES;
  const handling = M.hand_precision.values[0] + M.def_plating.drawback.value;
  const reducedCapacity = BASE_CAPACITY + M.cargo_light.drawback.value;
  const stats = loadoutStats(p);
  assert.equal(stats.capacity, reducedCapacity);
  assert.equal(stats.hull, STANDARD.baseStats.hull + M.def_plating.values[2]);
  assert.ok(Math.abs(stats.handling - handling) < 1e-9);
  assert.equal(stats.loadRelief, M.cargo_light.values[0]);
  assert.equal(stats.shieldCapacity, M.def_shield.values[0]);
  assert.equal(stats.insurance, Math.min(GAME_BALANCE.upgrades.statCaps.insurance, M.util_insurance.values[4]));

  const apex = loadoutStats(p, 'apex');
  const apexMultiplier = GAME_BALANCE.vehicles.apex.moduleBenefitMultiplier;
  assert.ok(Math.abs(apex.handling - (M.hand_precision.values[0] * apexMultiplier + M.def_plating.drawback.value)) < 1e-9,
    'drawback not boosted');
  assert.equal(apex.capacity, reducedCapacity, 'cargo rank is not an equipped module benefit');
  assert.equal(apex.shieldCapacity, M.def_shield.values[0], 'shield charges are exactly rank, not boosted or fractional');
  // Unequipped modules contribute nothing.
  assert.equal(loadoutStats({...p, shipStates: {...p.shipStates, standard: {
    ...p.shipStates.standard, equippedModuleIds: [],
  }}}).capacity, BASE_CAPACITY);
});

test('depot shield has three exact capacity ranks, respects existing costs/gates and retains legacy ownership', () => {
  let profile = rich({milestones: [...MILESTONES],
    ownedModules: {...defaultProfile().ownedModules, def_shield: 1}});
  profile = equipModule(profile, 'def_shield').profile;
  const shieldValues = BALANCE_MODULES.def_shield.values;
  for (const [index, charges] of shieldValues.entries()) {
    const rank = index + 1;
    const status = moduleStatus(profile, 'def_shield');
    assert.equal(status.def.name, 'Depot Shield');
    assert.equal(status.level, rank);
    assert.equal(status.maxRank, shieldValues.length);
    assert.equal(status.atMax, rank === shieldValues.length);
    assert.equal(loadoutStats(profile).shieldCapacity, charges);
    assert.match(formatStat('shieldCapacity', charges), /refills at Depot stops/);
    if (rank < shieldValues.length) {
      const upgraded = upgradeModule(profile, 'def_shield');
      assert.equal(upgraded.ok, true);
      assert.equal(upgraded.profile.coins, profile.coins - status.upgradeCost);
      profile = upgraded.profile;
    }
  }
  assert.equal(upgradeModule(profile, 'def_shield').ok, false);
  assert.equal(loadoutStats(unequipModule(profile, 'def_shield').profile).shieldCapacity, 0);
  const unlock = moduleStatus(defaultProfile(), 'def_shield').def.unlock;
  assert.deepEqual(unlock, {levelId: 'level2', sector: 3, event: 'complete'});
  const boundary = IMPLEMENTED_LEVELS.level2.find(sector => sector.number === 3).endsAt;
  assert.equal(moduleStatus(recordSectorProgress(defaultProfile(), 'level2', boundary - 0.001),
    'def_shield').unlocked, false);
  const eligible = recordSectorProgress(rich(), 'level2', boundary);
  const bought = buyModule(eligible, 'def_shield');
  assert.equal(bought.ok, true);
  assert.equal(bought.profile.coins, eligible.coins - GAME_BALANCE.upgrades.modules.def_shield.price);
  assert.equal(bought.profile.ownedModules.def_shield, 1);
  assert.equal(loadoutStats(bought.profile).shieldCapacity, shieldValues[0], 'purchase still auto-equips in an available slot');
  assert.equal(loadoutStats(profile, 'swift').shieldCapacity, 0, 'ownership alone cannot shield an unequipped truck');
  const swift = {...profile, shipStates: {...profile.shipStates,
    swift: {...profile.shipStates.standard, equippedModuleIds: ['def_shield']}}};
  assert.equal(loadoutStats(swift, 'swift').shieldCapacity, shieldValues.at(-1));
  for (const oldRank of [GAME_BALANCE.upgrades.maxRank - 1, GAME_BALANCE.upgrades.maxRank]) {
    const saved = normalizeProfile({...profile, ownedModules: {...profile.ownedModules, def_shield: oldRank}});
    assert.equal(saved.ownedModules.def_shield, oldRank, 'stored progress is not reset');
    assert.equal(loadoutStats(saved).shieldCapacity, shieldValues.at(-1));
    assert.equal(moduleStatus(saved, 'def_shield').level, shieldValues.length);
    assert.equal(moduleStatus(saved, 'def_shield').atMax, true);
    assert.equal(upgradeModule(saved, 'def_shield').ok, false);
  }
});

test('cargo capacity has eight paid ranks to exactly 32 and unlocks bounded reinforcement', () => {
  let profile = rich({coins: RICH_COINS});
  assert.deepEqual(cargoCapacityStatus(profile), {
    rank: 0, maxRank: MAX_CAPACITY_RANK, owned: false, equipped: false,
    capacity: BASE_CAPACITY, nextCapacity: CARGO.capacityByRank[1], cost: CARGO.capacityUpgradePrices[0],
    atMax: false, canAfford: true,
  });
  for (let rank = 1; rank <= MAX_CAPACITY_RANK; rank++) {
    const result = upgradeCargoCapacity(profile);
    assert.ok(result.ok);
    profile = result.profile;
    assert.equal(cargoCapacityStatus(profile).rank, rank);
  }
  assert.equal(loadoutStats(profile).capacity, MAX_CAPACITY);
  assert.equal(upgradeCargoCapacity(profile).ok, false);
  assert.equal(reinforcedCargoStatus(profile).unlocked, true);
  for (let rank = 1; rank <= CARGO.reinforcementUpgradePrices.length; rank++) {
    const result = upgradeReinforcedCargo(profile);
    assert.ok(result.ok);
    profile = result.profile;
    assert.equal(reinforcedCargoStatus(profile).rank, rank);
    assert.equal(loadoutStats(profile).cargoMitigation, CARGO.reinforcementMitigationByRank[rank]);
  }
  assert.equal(reinforcedCargoStatus(profile).mitigation, CARGO.reinforcementMitigationByRank.at(-1));
  assert.equal(upgradeReinforcedCargo(profile).reason, 'Reinforced Cargo Hold is already at maximum level');
  assert.equal(upgradeReinforcedCargo(defaultProfile()).reason, 'Reach maximum cargo capacity first');
});

test('Tier 2 cargo stacks capacity and hit protection in one per-ship slot without changing prices', () => {
  let profile = rich();
  for (let rank = 1; rank <= MAX_CAPACITY_RANK; rank++) profile = upgradeCargoCapacity(profile).profile;
  assert.equal(profile.cargoCapacityRank, MAX_CAPACITY_RANK);
  assert.equal(profile.reinforcedCargoRank, 0);
  assert.deepEqual(profile.shipStates.standard.equippedModuleIds, ['hand_precision', CARGO_CAPACITY_ID]);
  assert.equal(reinforcedCargoStatus(profile).owned, true);
  assert.equal(reinforcedCargoStatus(profile).equipped, true);
  assert.equal(loadoutStats(profile).cargoMitigation, 0, 'Tier 2 starts with no free protection rank');
  for (const [rank, price] of CARGO.reinforcementUpgradePrices.entries()) {
    const before = profile;
    const result = upgradeReinforcedCargo(before);
    assert.ok(result.ok);
    profile = result.profile;
    assert.equal(profile.coins, before.coins - price);
    assert.equal(profile.cargoCapacityRank, MAX_CAPACITY_RANK);
    assert.equal(profile.reinforcedCargoRank, rank + 1);
    assert.deepEqual(profile.shipStates.standard.equippedModuleIds, before.shipStates.standard.equippedModuleIds);
    assert.equal(loadoutStats(profile).capacity, MAX_CAPACITY);
  }
  const maxReinforcement = CARGO.reinforcementUpgradePrices.length;
  const maxMitigation = CARGO.reinforcementMitigationByRank.at(-1);
  const cargo = [{kind: 'coinStack', mass: 1, slots: 1, value: 100}];
  const hitLoss = GAME_BALANCE.cargo.hitValueLossFraction;
  assert.ok(Math.abs(damageCargo(cargo, hitLoss, loadoutStats(profile).cargoMitigation).lostValue -
    cargo[0].value * (1 - maxMitigation)) < 1e-9, 'maximum reinforcement keeps its mitigated share');
  const unequipped = unequipModule(profile, CARGO_CAPACITY_ID).profile;
  assert.equal(loadoutStats(unequipped).capacity, BASE_CAPACITY);
  assert.equal(loadoutStats(unequipped).cargoMitigation, 0);
  assert.equal(damageCargo(cargo, hitLoss, loadoutStats(unequipped).cargoMitigation).lostValue, cargo[0].value);
  assert.equal(unequipped.cargoCapacityRank, MAX_CAPACITY_RANK);
  assert.equal(unequipped.reinforcedCargoRank, maxReinforcement);
  assert.equal(reinforcedCargoStatus(unequipped).equipped, false);
  assert.equal(reinforcedCargoStatus(unequipped).owned, true);
  const restored = equipModule(unequipped, CARGO_CAPACITY_ID).profile;
  assert.equal(loadoutStats(restored).capacity, MAX_CAPACITY);
  assert.equal(loadoutStats(restored).cargoMitigation, maxMitigation);
  assert.equal(restored.shipStates.standard.equippedModuleIds.length, 2);

  const swift = {...profile, shipStates: {...profile.shipStates,
    swift: {unlockedSlotCount: SWIFT.baseEquipmentSlots, equippedModuleIds: []}}};
  assert.equal(loadoutStats(swift, 'swift').capacity, BASE_CAPACITY + SWIFT.cargoCapacityOffset);
  assert.equal(loadoutStats(swift, 'swift').cargoMitigation, 0);
  const swiftEquipped = equipModule(swift, CARGO_CAPACITY_ID, 'swift').profile;
  assert.equal(loadoutStats(swiftEquipped, 'swift').capacity, MAX_CAPACITY + SWIFT.cargoCapacityOffset);
  assert.equal(loadoutStats(swiftEquipped, 'swift').cargoMitigation, maxMitigation);
  assert.equal(swiftEquipped.shipStates.swift.equippedModuleIds.length, 1);
  assert.equal(loadoutStats(unequipModule(swiftEquipped, CARGO_CAPACITY_ID, 'swift').profile, 'swift').cargoMitigation, 0);
  assert.equal(loadoutStats(swiftEquipped, 'standard').cargoMitigation, maxMitigation);
});

test('Tier 2 cargo upgrades never re-equip the shared slot or spend on failed purchases', () => {
  const capped = rich({cargoCapacityRank: MAX_CAPACITY_RANK});
  const before = structuredClone(capped);
  const upgraded = upgradeReinforcedCargo(capped);
  assert.ok(upgraded.ok);
  assert.equal(upgraded.profile.reinforcedCargoRank, 1);
  assert.deepEqual(upgraded.profile.shipStates.standard.equippedModuleIds, ['hand_precision']);
  assert.equal(loadoutStats(upgraded.profile).capacity, BASE_CAPACITY);
  assert.equal(loadoutStats(upgraded.profile).cargoMitigation, 0);
  assert.deepEqual(capped, before);
  const poor = {...capped, coins: CARGO.reinforcementUpgradePrices[0] - 1};
  const poorBefore = structuredClone(poor);
  assert.equal(upgradeReinforcedCargo(poor).ok, false);
  assert.deepEqual(poor, poorBefore);
  const full = buyModule(upgraded.profile, 'coll_magnet').profile;
  assert.match(equipModule(full, CARGO_CAPACITY_ID).reason, /slots are full/);
  const freed = unequipModule(full, 'coll_magnet').profile;
  assert.equal(loadoutStats(equipModule(freed, CARGO_CAPACITY_ID).profile).cargoMitigation,
    CARGO.reinforcementMitigationByRank[1]);
});

test('purchased capacity bonuses require a per-ship equipment slot while baseline and rank prices stay unchanged', () => {
  const initial = rich();
  const bought = upgradeCargoCapacity(initial);
  assert.equal(bought.ok, true);
  assert.equal(bought.profile.coins, initial.coins - CARGO.capacityUpgradePrices[0]);
  assert.equal(bought.profile.cargoCapacityRank, 1);
  assert.deepEqual(bought.profile.shipStates.standard.equippedModuleIds, ['hand_precision', CARGO_CAPACITY_ID]);
  assert.equal(loadoutStats(bought.profile).capacity, CARGO.capacityByRank[1]);
  const unequipped = unequipModule(bought.profile, CARGO_CAPACITY_ID).profile;
  assert.equal(unequipped.cargoCapacityRank, 1);
  assert.equal(loadoutStats(unequipped).capacity, BASE_CAPACITY);
  const ranked = upgradeCargoCapacity(unequipped).profile;
  assert.equal(ranked.cargoCapacityRank, 2);
  assert.equal(loadoutStats(ranked).capacity, BASE_CAPACITY, 'upgrading owned but unequipped capacity must not re-equip it');
  assert.equal(loadoutStats(equipModule(ranked, CARGO_CAPACITY_ID).profile).capacity, CARGO.capacityByRank[2]);
  assert.equal(equipModule(initial, CARGO_CAPACITY_ID).ok, false);

  const full = buyModule(initial, 'coll_magnet').profile;
  const waiting = upgradeCargoCapacity(full).profile;
  assert.deepEqual(waiting.shipStates.standard.equippedModuleIds, full.shipStates.standard.equippedModuleIds);
  assert.equal(loadoutStats(waiting).capacity, BASE_CAPACITY);
  assert.match(equipModule(waiting, CARGO_CAPACITY_ID).reason, /slots are full/);

  const swift = {...ranked, ownedVehicleIds: ['standard', 'swift'], shipStates: {
    ...ranked.shipStates, swift: {unlockedSlotCount: SWIFT.baseEquipmentSlots, equippedModuleIds: []},
  }};
  assert.equal(loadoutStats(swift, 'swift').capacity, BASE_CAPACITY + SWIFT.cargoCapacityOffset);
  const swiftEquipped = equipModule(swift, CARGO_CAPACITY_ID, 'swift').profile;
  assert.equal(loadoutStats(swiftEquipped, 'swift').capacity, CARGO.capacityByRank[2] + SWIFT.cargoCapacityOffset);
  assert.equal(loadoutStats(swiftEquipped, 'standard').capacity, BASE_CAPACITY);
  assert.equal(loadoutStats(unequipModule(swiftEquipped, CARGO_CAPACITY_ID, 'swift').profile, 'swift').capacity,
    BASE_CAPACITY + SWIFT.cargoCapacityOffset);
});

test('owned equipment remains equipable after the new gate, including higher grandfathered ranks', () => {
  let profile = rich({ownedModules: {hand_precision: 1, cargo_light: 5, def_shield: 4}});
  assert.equal(moduleStatus(profile, 'cargo_light').grandfathered, true);
  profile = equipModule(profile, 'cargo_light').profile;
  assert.equal(loadoutStats(profile).loadRelief, BALANCE_MODULES.cargo_light.values[4]);
  profile = unequipModule(profile, 'cargo_light').profile;
  assert.equal(equipModule(profile, 'def_shield').ok, true);
  const unlocked = recordSectorProgress(rich(), 'level1', L1.finishDistanceMeters);
  assert.equal(moduleStatus(unlocked, 'cargo_light').unlocked, true);
});

test('supported route loadout descriptions explicitly equip purchased capacity to preserve their existing stats', () => {
  const profiles = supportedTrackProfiles('level1');
  for (const chassis of ['standard', 'swift']) {
    const offset = chassis === 'swift' ? SWIFT.cargoCapacityOffset : 0;
    assert.equal(profiles.find(profile => profile.id === `${chassis}-c1-s2-full`).capacity, CARGO.capacityByRank[1] + offset);
    assert.equal(profiles.find(profile => profile.id === `${chassis}-c8-s5-full`).capacity, MAX_CAPACITY + offset);
  }
});
