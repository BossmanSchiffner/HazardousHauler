/**
 * Equipment rules: module definitions with per-module rank tables, loadout stats, milestones,
 * level caps and pure shop actions. No Phaser here; every action returns a new profile.
 */
import {applyVehicleModuleBenefit, canUnlockSlot, SLOT_MAX, SLOT_RULES, upgradeCost} from './economy.js';
import {MODULES as DESIGN_MODULES} from '../data/catalog.js';
import {PICKUP_RADIUS_PX, PLAYABLE_ROAD_WIDTH} from '../data/route.js';
import {GAME_BALANCE} from '../data/gameBalance.js';
import {equipmentRequirementStatus} from './progression.js';
import {IMPLEMENTED_LEVELS} from './sectors.js';

export const MAX_MODULE_LEVEL = GAME_BALANCE.upgrades.maxRank;
export const STARTING_SLOT_COUNT = GAME_BALANCE.upgrades.startingSlots;
export const CARGO_CAPACITY_ID = 'cargo_expanded';

/** Standard Hauler chassis stats before modules. */
export const BASE_STATS = Object.freeze({...GAME_BALANCE.vehicles.standard.baseStats});
const STAT_CAPS = GAME_BALANCE.upgrades.statCaps;

const levelNumber = levelId => Number(levelId.replace('level', ''));
/** Per-level milestone ids: `level2` = reach Level 2, `level2,sector3` = reach its Sector 3. */
const sectorMilestoneId = (levelId, sectorNumber) =>
  sectorNumber === 1 ? levelId : `${levelId},sector${sectorNumber}`;
export const depotMilestoneId = levelId => `${levelId},depot1`;
/** Every implemented level records each of its milestones separately. */
export const MILESTONES = Object.freeze(GAME_BALANCE.progression.levelIds.flatMap(levelId => [
  sectorMilestoneId(levelId, 1), depotMilestoneId(levelId),
  ...IMPLEMENTED_LEVELS[levelId].slice(1).map(sector => sectorMilestoneId(levelId, sector.number)),
]));
const MILESTONE_LABELS = Object.freeze(Object.fromEntries(
  GAME_BALANCE.progression.levelIds.flatMap(levelId => [
    [depotMilestoneId(levelId), `Bank your cargo at the first Level ${levelNumber(levelId)} Cargo Depot`],
    ...IMPLEMENTED_LEVELS[levelId].map(sector => [sectorMilestoneId(levelId, sector.number),
      `Reach Level ${levelNumber(levelId)}, Sector ${sector.number}` +
      (sector.number > 1 ? ` (${sector.startsAt.toLocaleString('en-US')} m)` : '')]),
  ])));
const GATING_MILESTONES = new Set([
  ...GAME_BALANCE.upgrades.levelCapMilestones,
  ...Object.values(GAME_BALANCE.upgrades.slotPurchases).map(rule => rule.milestone),
  ...Object.values(GAME_BALANCE.vehicles.swift.additionalSlotPurchases).map(rule => rule.milestone),
  GAME_BALANCE.vehicles.apexUnlock.milestone,
  GAME_BALANCE.physics.blueprint.unlockMilestone,
]);
/** What each milestone opens up. */
export const MILESTONE_REWARDS = Object.freeze(Object.fromEntries(MILESTONES.map(id => [id, {
  'level1,depot1': 'First cargo banked.',
  'level1,sector2': 'Level 1, Sector 2 reached! Slots 3–4 and Lv 3 upgrades unlocked.',
  'level1,sector3': 'Level 1, Sector 3 reached! Slot 5 and Lv 4 upgrades unlocked.',
  'level1,sector4': 'Level 1, Sector 4 reached! Slot 6 and Lv 5 upgrades unlocked.',
}[id] ?? (id.endsWith(',depot1') ? `First Level ${levelNumber(id.split(',')[0])} cargo banked.`
  : `${MILESTONE_LABELS[id].replace(/^Reach /, '').replace(/ \(.*\)$/, '')} reached!`)])));
/** True when a milestone gates a Garage purchase, upgrade rank, vehicle or Blueprint pickups. */
export const milestoneUnlocksUpgrades = id => GATING_MILESTONES.has(id);
/** Older saves stored Level 1 milestones without a level prefix. */
const LEGACY_MILESTONES = Object.freeze({depot1: depotMilestoneId('level1'),
  ...Object.fromEntries([2, 3, 4].map(number => [`sector${number}`, sectorMilestoneId('level1', number)]))});
export const migrateMilestoneId = id => LEGACY_MILESTONES[id] ?? id;
/** Each sector milestone raises the module level cap by one, starting at Lv 2. */
const LEVEL_CAP_MILESTONES = GAME_BALANCE.upgrades.levelCapMilestones;
const BASE_LEVEL_CAP = GAME_BALANCE.upgrades.baseLevelCap;

const define = (id, summary) => {
  const design = DESIGN_MODULES.find(m => m.id === id);
  if (!design) throw new Error(`Unknown design module ${id}`);
  const tuning = GAME_BALANCE.upgrades.modules[id];
  if (!tuning || !Array.isArray(tuning.values) || tuning.values.length === 0) {
    throw new Error(`${id} needs at least one upgrade rank`);
  }
  const {stat, values, ...fields} = tuning;
  return Object.freeze({id, name: design.name, family: design.family, summary, ...fields,
    tier: tuning.tier ?? 1,
    benefit: Object.freeze({stat, values})});
};

/** Implemented modules. `benefit` scales per level; `drawback` is fixed and never boosted. */
export const MODULE_DEFS = Object.freeze([
  define('hand_precision', 'Sharper steering response, loaded or empty.'),
  define('cargo_light', 'Cargo affects on your steering much less.'),
  define('def_plating', '+1 hull: survive more barrier hits.'),
  define('coll_magnet', 'Attracts cargo from a distance.'),
  define('util_impact_pulse', 'A collision clears all obstacles and grants temporary immunity.'),
  define('def_shield', 'Absorbs hits before hull damage. Stop at a Depot during a run to Recharge 1 charge'),
  define('util_insurance', 'Reduces cargo loss upon collision'),
]);

export const STARTER_MODULE_IDS = Object.freeze(MODULE_DEFS.filter(m => m.starter).map(m => m.id));
const DEFS_BY_ID = new Map(MODULE_DEFS.map(m => [m.id, m]));
export const moduleDef = id => DEFS_BY_ID.get(id) ?? null;
const STANDARD_SHIP_ID = 'standard';
const shipState = (profile, chassisId = STANDARD_SHIP_ID) => profile.shipStates?.[chassisId];
const withShipState = (profile, chassisId, state) => ({
  ...profile, shipStates: {...profile.shipStates, [chassisId]: state},
});

/** Lowest summed handling any loadout can reach; track fairness is computed against it. */
export const WORST_CASE_HANDLING = MODULE_DEFS
  .filter(m => m.drawback?.stat === 'handling' && m.drawback.value < 0)
  .reduce((sum, m) => sum + m.drawback.value, 0);

const pct = v => `${Math.round(v * 100)}%`;
const signed = v => (v >= 0 ? `+${v}` : `−${Math.abs(v)}`);
/** Player-facing text for one stat contribution. */
export function formatStat(stat, value) {
  switch (stat) {
    case 'capacity': return `${signed(value)} cargo slots`;
    case 'handling': return `${value >= 0 ? '+' : '−'}${pct(Math.abs(value))} steering`;
    case 'loadRelief': return `−${pct(value)} cargo steering penalty`;
    case 'hull': return `${signed(value)} hull`;
    case 'magnet': return `Collection range: ${Math.round((value > 0 ? value + PICKUP_RADIUS_PX : 0) / PLAYABLE_ROAD_WIDTH * 100)}% of road width`;
    case 'impactPulseSeconds': return `+${value.toFixed(2)} s obstacle-clear immunity`;
    case 'shieldCapacity': return `${value} shield ${value === 1 ? 'charge' : 'charges'}; refills at Depot stops`;
    case 'insurance': return `${pct(value)} less percentage hit loss`;
    default: throw new Error(`Unknown stat ${stat}`);
  }
}

/** Effective stats of the equipped loadout. Apex boosts benefits only, never drawbacks or base stats. */
export function loadoutStats(profile, chassisId = 'standard') {
  const stats = {...BASE_STATS, ...GAME_BALANCE.vehicles[chassisId]?.baseStats};
  const cargoRanks = GAME_BALANCE.cargoProgression.capacityByRank;
  const cargoRank = Math.min(cargoRanks.length - 1, Math.max(0, profile.cargoCapacityRank ?? 0));
  const equipped = shipState(profile, chassisId)?.equippedModuleIds ?? [];
  const cargoEquipped = equipped.includes(CARGO_CAPACITY_ID);
  stats.capacity = cargoRanks[cargoEquipped ? cargoRank : 0] +
    (GAME_BALANCE.vehicles[chassisId]?.cargoCapacityOffset ?? 0);
  stats.vehicleSteeringMultiplier = GAME_BALANCE.vehicles[chassisId]?.steeringMultiplier ?? 1;
  for (const id of shipState(profile, chassisId)?.equippedModuleIds ?? []) {
    const def = moduleDef(id);
    const level = profile.ownedModules[id] ?? 0;
    if (!def || level < 1) continue;
    const value = def.benefit.values[Math.min(level, def.benefit.values.length) - 1];
    if (def.benefit.stat === 'shieldCapacity') stats.shieldCapacity += value;
    else stats[def.benefit.stat] += applyVehicleModuleBenefit(value, chassisId);
    if (def.drawback) stats[def.drawback.stat] += def.drawback.value;
  }
  stats.capacity = Math.max(1, Math.round(stats.capacity));
  stats.hull = Math.max(1, Math.floor(stats.hull));
  stats.cargoMitigation = GAME_BALANCE.cargoProgression.reinforcementMitigationByRank[
    cargoEquipped ? Math.min(GAME_BALANCE.cargoProgression.reinforcementMitigationByRank.length - 1,
      Math.max(0, profile.reinforcedCargoRank ?? 0)) : 0];
  for (const [stat, cap] of Object.entries(STAT_CAPS)) stats[stat] = Math.min(cap, stats[stat]);
  return stats;
}

const CARGO_CAPACITY_PRICES = GAME_BALANCE.cargoProgression.capacityUpgradePrices;
const CARGO_REINFORCEMENT_PRICES = GAME_BALANCE.cargoProgression.reinforcementUpgradePrices;

export function cargoCapacityStatus(profile, chassisId = STANDARD_SHIP_ID) {
  const rank = Math.min(CARGO_CAPACITY_PRICES.length, Math.max(0, profile.cargoCapacityRank ?? 0));
  const capacities = GAME_BALANCE.cargoProgression.capacityByRank;
  return {
    rank, maxRank: CARGO_CAPACITY_PRICES.length, owned: rank > 0,
    equipped: shipState(profile, chassisId)?.equippedModuleIds.includes(CARGO_CAPACITY_ID) ?? false,
    capacity: capacities[rank], nextCapacity: capacities[rank + 1] ?? null,
    cost: CARGO_CAPACITY_PRICES[rank] ?? null,
    atMax: rank === CARGO_CAPACITY_PRICES.length,
    canAfford: rank < CARGO_CAPACITY_PRICES.length && profile.coins >= CARGO_CAPACITY_PRICES[rank],
  };
}

export function upgradeCargoCapacity(profile, chassisId = STANDARD_SHIP_ID) {
  const status = cargoCapacityStatus(profile, chassisId);
  if (status.atMax) return fail('Cargo capacity is already at maximum rank');
  if (!status.canAfford) return fail('Not enough Coins');
  const next = {...profile, coins: profile.coins - status.cost, cargoCapacityRank: status.rank + 1};
  return {ok: true, profile: status.owned ? next : autoEquip(next, CARGO_CAPACITY_ID, chassisId)};
}

export function reinforcedCargoStatus(profile, chassisId = STANDARD_SHIP_ID) {
  const capacity = cargoCapacityStatus(profile, chassisId);
  const values = GAME_BALANCE.cargoProgression.reinforcementMitigationByRank;
  const rank = Math.min(values.length - 1, Math.max(0, profile.reinforcedCargoRank ?? 0));
  const price = CARGO_REINFORCEMENT_PRICES[rank] ?? null;
  return {
    unlocked: capacity.atMax,
    owned: capacity.owned, equipped: capacity.equipped,
    rank, maxRank: values.length - 1,
    mitigation: values[rank], nextMitigation: values[rank + 1] ?? null, cost: price,
    atMax: rank === values.length - 1,
    canAfford: capacity.atMax && price !== null && profile.coins >= price,
  };
}

export function upgradeReinforcedCargo(profile) {
  const status = reinforcedCargoStatus(profile);
  if (!status.unlocked) return fail('Reach maximum cargo capacity first');
  if (status.atMax) return fail('Reinforced Cargo Hold is already at maximum level');
  if (!status.canAfford) return fail('Not enough Coins');
  return {ok: true, profile: {...profile, coins: profile.coins - status.cost,
    reinforcedCargoRank: status.rank + 1}};
}

/** Milestones earned by travelling `distance` metres on `levelId`. */
export function milestonesForDistance(distance, levelId = 'level1') {
  const sectors = IMPLEMENTED_LEVELS[levelId];
  if (!sectors) throw new Error(`Unknown level ${levelId}`);
  return sectors.filter(sector => distance >= sector.startsAt)
    .map(sector => sectorMilestoneId(levelId, sector.number));
}

/** Permanently records milestones; returns the new profile and which ones were newly earned. */
export function addMilestones(profile, ids) {
  const added = ids.filter(id => MILESTONES.includes(id) && !profile.milestones.includes(id));
  if (!added.length) return {profile, added};
  return {profile: {...profile, milestones: MILESTONES.filter(id => profile.milestones.includes(id) || added.includes(id))}, added};
}

export function moduleLevelCap(milestones) {
  return BASE_LEVEL_CAP + LEVEL_CAP_MILESTONES.filter(id => milestones.includes(id)).length;
}

/** Everything the Garage needs to show one module. */
export function moduleStatus(profile, id, chassisId = STANDARD_SHIP_ID) {
  const def = moduleDef(id);
  if (!def) throw new Error(`Unknown module ${id}`);
  const level = Math.min(profile.ownedModules[id] ?? 0, def.benefit.values.length);
  const requirement = equipmentRequirementStatus(profile, def.unlock);
  const unlocked = level > 0 || requirement.met;
  const maxRank = def.benefit.values.length;
  const levelCap = Math.min(moduleLevelCap(profile.milestones), maxRank);
  const atMax = level >= maxRank;
  const capped = !atMax && level >= levelCap;
  return {
    def, level, maxRank, levelCap, owned: level > 0, unlocked,
    requirement, grandfathered: level > 0 && !requirement.met,
    equipped: shipState(profile, chassisId)?.equippedModuleIds.includes(id) ?? false,
    lockReason: unlocked ? null : requirement.description,
    atMax, capped,
    capReason: capped ? `${MILESTONE_LABELS[LEVEL_CAP_MILESTONES[levelCap - BASE_LEVEL_CAP]]} to upgrade past Lv ${level}` : null,
    upgradeCost: level > 0 && !atMax && !capped ? upgradeCost(def.upgradeBase, level) : null,
  };
}

const fail = reason => ({ok: false, reason});

function autoEquip(profile, id, chassisId) {
  const state = shipState(profile, chassisId);
  if (state.equippedModuleIds.length >= state.unlockedSlotCount ||
      state.equippedModuleIds.includes(id)) return profile;
  return withShipState(profile, chassisId,
    {...state, equippedModuleIds: [...state.equippedModuleIds, id]});
}

export function buyModule(profile, id, chassisId = STANDARD_SHIP_ID) {
  const status = moduleStatus(profile, id, chassisId);
  if (status.owned) return fail('Already owned');
  if (!status.unlocked) return fail(status.lockReason);
  if (profile.coins < status.def.price) return fail('Not enough Coins');
  const next = {...profile, coins: profile.coins - status.def.price, ownedModules: {...profile.ownedModules, [id]: 1}};
  // New gear goes straight into a free slot so the purchase is felt on the next run.
  return {ok: true, profile: autoEquip(next, id, chassisId)};
}

export function upgradeModule(profile, id) {
  const status = moduleStatus(profile, id);
  if (!status.owned) return fail('Buy the module first');
  if (status.atMax) return fail('Already at max level');
  if (status.capped) return fail(status.capReason);
  if (profile.coins < status.upgradeCost) return fail('Not enough Coins');
  return {ok: true, profile: {
    ...profile, coins: profile.coins - status.upgradeCost,
    ownedModules: {...profile.ownedModules, [id]: status.level + 1},
  }};
}

export function equipModule(profile, id, chassisId = STANDARD_SHIP_ID) {
  const status = id === CARGO_CAPACITY_ID
    ? cargoCapacityStatus(profile, chassisId) : moduleStatus(profile, id, chassisId);
  const state = shipState(profile, chassisId);
  if (!status.owned) return fail('Buy the module first');
  if (status.equipped) return fail('Already equipped');
  if (state.equippedModuleIds.length >= state.unlockedSlotCount) return fail('All slots are full — unequip a module first');
  return {ok: true, profile: withShipState(profile, chassisId,
    {...state, equippedModuleIds: [...state.equippedModuleIds, id]})};
}

export function unequipModule(profile, id, chassisId = STANDARD_SHIP_ID) {
  const state = shipState(profile, chassisId);
  if (!state.equippedModuleIds.includes(id)) return fail('Not equipped');
  return {ok: true, profile: withShipState(profile, chassisId,
    {...state, equippedModuleIds: state.equippedModuleIds.filter(x => x !== id)})};
}

/** State of the next lockable slot, or null when all six are open. */
export function nextSlotOffer(profile, chassisId = STANDARD_SHIP_ID) {
  const slot = shipState(profile, chassisId).unlockedSlotCount + 1;
  if (slot > SLOT_MAX) return null;
  const rule = chassisId === 'swift'
    ? GAME_BALANCE.vehicles.swift.additionalSlotPurchases[slot]
    : SLOT_RULES[slot];
  if (!rule) return null;
  const cost = rule.costCoins ?? rule.cost;
  const reached = profile.milestones.includes(rule.milestone);
  return {slot, cost, reached, requirement: MILESTONE_LABELS[rule.milestone],
    canBuy: canUnlockSlot(profile, slot, chassisId)};
}

export function unlockNextSlot(profile, chassisId = STANDARD_SHIP_ID) {
  const offer = nextSlotOffer(profile, chassisId);
  if (!offer) return fail('All slots unlocked');
  if (!offer.reached) return fail(offer.requirement);
  if (!offer.canBuy) return fail('Not enough Coins');
  const state = shipState(profile, chassisId);
  return {ok: true, profile: withShipState({...profile, coins: profile.coins - offer.cost},
    chassisId, {...state, unlockedSlotCount: offer.slot})};
}
