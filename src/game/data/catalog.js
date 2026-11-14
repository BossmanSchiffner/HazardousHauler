/** Design catalog, NOT a declaration that all items are implemented. */
import {GAME_BALANCE} from './gameBalance.js';

export const MODULES = [
  ['eng_turbo', 'Turbo Drive', 'engine', 1],
  ['eng_efficient', 'Efficient Drive', 'engine', 1],
  ['eng_heavy', 'Heavy-Duty Drive', 'engine', 2],
  ['eng_adaptive', 'Adaptive Drive', 'engine', 3],
  ['cargo_expanded', 'Expanded Hold', 'cargo', 1],
  ['cargo_armoured', 'Armoured Hold', 'cargo', 2],
  ['cargo_light', 'Lightweight Rack', 'cargo', 1],
  ['cargo_vault', 'Secure Vault', 'cargo', 4],
  ['def_plating', 'Reinforced Plating', 'defence', 1],
  ['def_shield', 'Depot Shield', 'defence', 2],
  ['def_repair', 'Emergency Repair', 'defence', 3],
  ['def_deflector', 'Deflector Field', 'defence', 4],
  ['coll_magnet', 'Magnetic Collector', 'collection', 1],
  ['coll_grabber', 'Wide Grabber', 'collection', 2],
  ['coll_scanner', 'Rare Cargo Scanner', 'collection', 3],
  ['coll_auto', 'Auto-Collector', 'collection', 4],
  ['hand_precision', 'Precision Steering', 'handling', 1],
  ['hand_stabilizer', 'Stabilizers', 'handling', 2],
  ['hand_boost', 'Emergency Boost', 'handling', 3],
  ['hand_drift', 'Drift Control', 'handling', 4],
  ['util_insurance', 'Cargo Insurance', 'utility', 2],
  ['util_impact_pulse', 'Impact Pulse', 'utility', 1],
  ['util_processor', 'Salvage Processor', 'utility', 3],
  ['util_sorter', 'Cargo Sorter', 'utility', 4],
].map(([id, name, family, sector]) => ({
  id, name, family, sector, maxLevel: GAME_BALANCE.upgrades.maxRank,
}));

export const IMPLEMENTED_VEHICLE_IDS = Object.freeze(['standard', 'swift', 'armoured']);

export const VEHICLES = [
  ['standard', 'Standard Hauler', 'Balanced'],
  ['swift', 'Swift Runner', 'Faster steering, lower cargo capacity'],
  ['armoured', 'Armoured Transport', '4 Hull, 1 Shield, 16 base cargo; 20% slower steering'],
  ['apex', 'Apex Transport', '+25% beneficial effects of all equipped modules', true],
].map(([id, name, ability, final]) => ({
  id, name, ability, bpCost: GAME_BALANCE.vehicles[id].blueprintCost, ...(final ? {final} : {}),
}));

export const ROUTE_END_DISTANCE_M = GAME_BALANCE.routes.level1.finishDistanceMeters;

const cargoTable = entries => Object.freeze(entries.map(([value, weight]) => Object.freeze({value, weight})));
/** Indexed by difficulty step (sector position); the final entry applies past the finish. */
export const SECTOR_CARGO = Object.freeze(GAME_BALANCE.cargo.valuesBySectorStep.map(cargoTable));

/** Sector themes own look and hazard families; difficulty, cargo tiers and Blueprints follow sector position. */
const SECTOR_THEMES = Object.freeze({
  industrial: Object.freeze({name: 'Industrial Outskirts', color: 0x34485d}),
  dustlands: Object.freeze({name: 'Dustlands', color: 0x927147}),
  neon: Object.freeze({name: 'Neon District', color: 0x594a91}),
  reactor: Object.freeze({name: 'Reactor Zone', color: 0x9f3a4e}),
});

const levelSectors = levelId => GAME_BALANCE.routes[levelId].sectorThemeIds.map((themeId, index) => {
  if (!SECTOR_THEMES[themeId]) throw new Error(`Unknown sector theme ${themeId} in ${levelId}`);
  return {id: `${levelId}-sector${index + 1}`, themeId, ...SECTOR_THEMES[themeId],
    startsAt: GAME_BALANCE.routes[levelId].sectorStartsMeters[index]};
});
export const SECTORS = levelSectors('level1');
export const LEVEL2_SECTORS = levelSectors('level2');
export const LEVEL3_SECTORS = levelSectors('level3');
