import {normalizeSeenHints} from './onboarding.js';
import {
  BASE_STATS, MAX_MODULE_LEVEL, MILESTONES, migrateMilestoneId, milestonesForDistance, moduleDef, MODULE_DEFS,
  CARGO_CAPACITY_ID, STARTER_MODULE_IDS, STARTING_SLOT_COUNT,
} from './modules.js';
import {SLOT_MAX} from './economy.js';
import {VEHICLES} from '../data/catalog.js';
import {GAME_BALANCE} from '../data/gameBalance.js';
import {recordSectorProgress} from './progression.js';
import {IMPLEMENTED_LEVELS} from './sectors.js';

const KEY = 'cargo-run-prototype-profile-v1'; // storage key kept so existing saves are found
let unreadableSave = null;
let saveReadFailed = false;
export const SCHEMA_VERSION = 12;
const LEVEL_IDS = GAME_BALANCE.progression.levelIds;

const defaultShipState = (id, slots = GAME_BALANCE.vehicles[id]?.baseEquipmentSlots ?? STARTING_SLOT_COUNT) => ({
  unlockedSlotCount: slots,
  equippedModuleIds: id === 'standard' ? [...STARTER_MODULE_IDS] : [],
  ownedColorIds: [GAME_BALANCE.presentation.defaultOwnedTrim],
  equippedColorId: GAME_BALANCE.presentation.defaultOwnedTrim,
});

const defaultLevelProgress = () => ({
  unlocked: false,
  completed: false,
  sector3CheckpointUnlocked: false,
  bestDistance: 0,
  checkpointBestDistance: 0,
  overdriveBestDistance: 0,
  reachedSectors: [],
  completedSectors: [],
});

export const defaultProfile = () => ({
  schemaVersion: SCHEMA_VERSION,
  coins: 0,
  blueprints: 0,
  ownedVehicleIds: ['standard'],
  selectedVehicleId: 'standard',
  blueprintRewardIds: [],
  deferredBlueprintRewards: [],
  bestDistance: 0,
  totalRuns: 0,
  tutorialCompleted: false,
  rookieTrialRewardsCredited: false,
  settledRunIds: [],
  seenHints: [],
  milestones: [],
  cargoCapacityRank: 0,
  reinforcedCargoRank: 0,
  ownedModules: Object.fromEntries(STARTER_MODULE_IDS.map(id => [id, 1])),
  shipStates: {
    standard: {...defaultShipState('standard'), unlockedSlotCount: STARTING_SLOT_COUNT},
  },
  levelProgress: Object.fromEntries(LEVEL_IDS.map(id => [id, {
    ...defaultLevelProgress(), unlocked: id === GAME_BALANCE.progression.firstPlayableLevel,
    reachedSectors: id === 'level1' ? [1] : [],
  }])),
});

const nonNegativeInt = value => Number.isInteger(value) && value >= 0 ? value : 0;

/** Lowest module level whose benefit is at least the old upgrade's value, so migration never weakens a player. */
function levelAtLeast(moduleId, oldValue) {
  const def = moduleDef(moduleId);
  const index = def.benefit.values.findIndex(v => v >= oldValue - 1e-9);
  return index === -1 ? MAX_MODULE_LEVEL : index + 1;
}

/** v1 had two fixed upgrades (levels 0–5); v2 has owned/equipped modules, slots and milestones. */
export function migrateV1(data) {
  const capacityLevel = Math.min(5, nonNegativeInt(data.upgrades?.capacity));
  const handlingLevel = Math.min(5, nonNegativeInt(data.upgrades?.handling));
  const legacyModuleBenefits = [3, 7, 11, 11, 14, 17];
  const requiredCapacity = BASE_STATS.capacity + legacyModuleBenefits[capacityLevel];
  const ownedModules = {
    hand_precision: levelAtLeast('hand_precision', handlingLevel * 0.18),
  };
  const cargoCapacityRank = Math.max(0, GAME_BALANCE.cargoProgression.capacityByRank.findIndex(
    capacity => capacity >= requiredCapacity));
  return {
    ...data,
    schemaVersion: SCHEMA_VERSION,
    cargoCapacityRank,
    milestones: Array.isArray(data.milestones) ? data.milestones : [],
    ownedModules,
    shipStates: {
      standard: {
        ...defaultShipState('standard'),
        unlockedSlotCount: STARTING_SLOT_COUNT,
        // v1 handling was always active, so migrated Precision must stay equipped to never weaken the save.
        equippedModuleIds: [...new Set(['hand_precision', ...STARTER_MODULE_IDS,
          ...(cargoCapacityRank > 0 ? [CARGO_CAPACITY_ID] : [])])].slice(0, STARTING_SLOT_COUNT),
      },
    },
    levelProgress: defaultProfile().levelProgress,
  };
}

/** Sanitises stored save data (migrating older schemas). Unknown or corrupt data yields a fresh profile. */
export function normalizeProfile(input) {
  if (!input || typeof input !== 'object') return defaultProfile();
  const sourceSchemaVersion = input.schemaVersion;
  const legacy = input.schemaVersion === 1 || input.schemaVersion === 2;
  let data = input.schemaVersion === 1 ? migrateV1(input) : input;
  if (legacy) {
    // Old distance records prove old unlocks even when an early save omitted its flags.
    const oldThresholds = [['depot1', 450], ['sector2', 900], ['sector3', 1800], ['sector4', 2700]];
    data = {...data, schemaVersion: SCHEMA_VERSION, milestones: [
      ...(Array.isArray(data.milestones) ? data.milestones : []),
      ...oldThresholds.filter(([, distance]) => data.bestDistance >= distance).map(([id]) => id),
    ]};
  }
  if (data.schemaVersion === 3 || data.schemaVersion === 4) {
    const oldSectorThresholds = [['sector2', 1800], ['sector3', 3600], ['sector4', 5400]];
    data = {...data, schemaVersion: SCHEMA_VERSION, milestones: [
      ...(Array.isArray(data.milestones) ? data.milestones : []),
      ...(data.schemaVersion === 3 && data.bestDistance >= 450 ? ['depot1'] : []),
      ...oldSectorThresholds.filter(([, distance]) => data.bestDistance >= distance).map(([id]) => id),
    ]};
  }
  if ([5, 6, 7, 8, 9, 10, 11].includes(data.schemaVersion)) {
    data = {...data, schemaVersion: SCHEMA_VERSION};
  }
  if (data.schemaVersion !== SCHEMA_VERSION) return defaultProfile();

  const legacyCapacityLevel = Math.min(5, nonNegativeInt(data.ownedModules?.cargo_expanded));
  const legacyCapacityBonus = [0, 3, 7, 11, 14, 17][legacyCapacityLevel];
  const capacityTable = GAME_BALANCE.cargoProgression.capacityByRank;
  const migratedCapacityRank = Math.max(0, capacityTable.findIndex(capacity =>
    capacity >= Math.max(capacityTable[0], BASE_STATS.capacity + legacyCapacityBonus)));
  const cargoCapacityRank = sourceSchemaVersion >= 9
    ? Math.min(capacityTable.length - 1, nonNegativeInt(data.cargoCapacityRank))
    : sourceSchemaVersion === 1
      ? Math.min(capacityTable.length - 1, nonNegativeInt(data.cargoCapacityRank))
      : migratedCapacityRank;
  const oldImpactPulseRank = nonNegativeInt(data.ownedModules?.util_radar);
  const ownedModulesSource = sourceSchemaVersion < 9
    ? {...data.ownedModules, util_impact_pulse: Math.max(oldImpactPulseRank,
      nonNegativeInt(data.ownedModules?.util_impact_pulse))}
    : data.ownedModules;
  const totalRuns = nonNegativeInt(data.totalRuns);
  const bestDistance = nonNegativeInt(data.bestDistance);
  const establishedProgress = totalRuns > 0 || bestDistance > 0 ||
    LEVEL_IDS.some(id => nonNegativeInt(data.levelProgress?.[id]?.bestDistance) > 0 ||
      nonNegativeInt(data.levelProgress?.[id]?.checkpointBestDistance) > 0 ||
      data.levelProgress?.[id]?.completed === true);
  const ownedModules = {};
  for (const def of MODULE_DEFS) {
    const stored = ownedModulesSource?.[def.id];
    const level = Number.isInteger(stored) ? Math.min(MAX_MODULE_LEVEL, Math.max(0, stored)) : 0;
    if (level > 0 || def.starter) ownedModules[def.id] = Math.max(level, def.starter ? 1 : 0);
  }
  const ownedVehicleIds = [...new Set(['standard', ...(Array.isArray(data.ownedVehicleIds)
    ? data.ownedVehicleIds.filter(id => VEHICLES.some(vehicle => vehicle.id === id)) : [])])];
  const legacySlots = Math.min(SLOT_MAX, Math.max(STARTING_SLOT_COUNT, nonNegativeInt(data.unlockedSlotCount)));
  const shipStates = {};
  for (const id of ownedVehicleIds) {
    const stored = sourceSchemaVersion >= 6 ? data.shipStates?.[id] : null;
    const legacyStandard = id === 'standard' ? {
      unlockedSlotCount: data.unlockedSlotCount,
      equippedModuleIds: data.equippedModuleIds,
    } : null;
    const defaults = defaultShipState(id);
    const unlockedSlotCount = Math.min(SLOT_MAX, Math.max(defaults.unlockedSlotCount,
      nonNegativeInt(stored?.unlockedSlotCount ?? legacyStandard?.unlockedSlotCount ??
        (id === 'standard' ? legacySlots : defaults.unlockedSlotCount))));
    const sourceEquipped = Array.isArray(stored?.equippedModuleIds) ? stored.equippedModuleIds
      : Array.isArray(legacyStandard?.equippedModuleIds) ? legacyStandard.equippedModuleIds : defaults.equippedModuleIds;
    const storedEquipped = sourceSchemaVersion < 9
      ? sourceEquipped.map(moduleId => moduleId === 'util_radar' ? 'util_impact_pulse' : moduleId)
      : sourceEquipped;
    const equippedModuleIds = [...new Set(storedEquipped)].filter(moduleId =>
      moduleId === CARGO_CAPACITY_ID ? sourceSchemaVersion >= 11 && cargoCapacityRank > 0
        : ownedModules[moduleId] > 0)
      .slice(0, unlockedSlotCount);
    if (sourceSchemaVersion < 11 && cargoCapacityRank > 0 && equippedModuleIds.length < unlockedSlotCount) {
      equippedModuleIds.push(CARGO_CAPACITY_ID);
    }
    const knownColors = [GAME_BALANCE.presentation.defaultOwnedTrim, ...GAME_BALANCE.presentation.trimChoices,
      ...(id === 'standard' ? [GAME_BALANCE.rewards.level1NoDamageGold.colorId] : [])];
    const ownedColorIds = [...new Set(Array.isArray(stored?.ownedColorIds)
      ? stored.ownedColorIds.filter(colorId => knownColors.includes(colorId)) : defaults.ownedColorIds)];
    if (!ownedColorIds.length) ownedColorIds.push(GAME_BALANCE.presentation.defaultOwnedTrim);
    const equippedColorId = ownedColorIds.includes(stored?.equippedColorId)
      ? stored.equippedColorId : GAME_BALANCE.presentation.defaultOwnedTrim;
    shipStates[id] = {unlockedSlotCount, equippedModuleIds, ownedColorIds, equippedColorId};
  }
  let levelProgress = Object.fromEntries(LEVEL_IDS.map(id => {
    const stored = data.levelProgress?.[id];
    const checkpointDistance = GAME_BALANCE.routes[id].sectorStartsMeters[
      GAME_BALANCE.progression.checkpointSector - 1];
    const hasLevelSpecificCheckpointEvidence = stored?.completed === true ||
      nonNegativeInt(stored?.bestDistance) >= checkpointDistance ||
      nonNegativeInt(stored?.checkpointBestDistance) > 0;
    const checkpointUnlocked = sourceSchemaVersion < 9
      ? hasLevelSpecificCheckpointEvidence ||
        (id === 'level1' && stored?.sector3CheckpointUnlocked === true)
      : stored?.sector3CheckpointUnlocked === true;
    return [id, {
      unlocked: id === GAME_BALANCE.progression.firstPlayableLevel ||
        stored?.unlocked === true || stored?.completed === true ||
        (id === 'level2' && data.levelProgress?.level1?.completed === true),
      completed: stored?.completed === true,
      sector3CheckpointUnlocked: checkpointUnlocked,
      bestDistance: nonNegativeInt(stored?.bestDistance),
      checkpointBestDistance: nonNegativeInt(stored?.checkpointBestDistance),
      overdriveBestDistance: nonNegativeInt(stored?.overdriveBestDistance),
      reachedSectors: IMPLEMENTED_LEVELS[id].filter(sector =>
        (id === 'level1' && sector.number === 1) ||
        (sourceSchemaVersion >= 11 && Array.isArray(stored?.reachedSectors) &&
          stored.reachedSectors.includes(sector.number)))
        .map(sector => sector.number),
      completedSectors: IMPLEMENTED_LEVELS[id].filter(sector =>
        sourceSchemaVersion >= 11 && Array.isArray(stored?.completedSectors) &&
          stored.completedSectors.includes(sector.number))
        .map(sector => sector.number),
    }];
  }));
  let progressProfile = {levelProgress};
  for (const id of LEVEL_IDS) {
    const progress = levelProgress[id];
    if (progress.completed) {
      progressProfile = recordSectorProgress(progressProfile, id,
        IMPLEMENTED_LEVELS[id].at(-1).endsAt);
    } else if (sourceSchemaVersion >= 9) {
      if (progress.bestDistance > 0) {
        progressProfile = recordSectorProgress(progressProfile, id, progress.bestDistance);
      }
      if (progress.checkpointBestDistance > 0) {
        const start = GAME_BALANCE.routes[id].sectorStartsMeters[GAME_BALANCE.progression.checkpointSector - 1];
        progressProfile = recordSectorProgress(progressProfile, id, start + progress.checkpointBestDistance, start);
      }
    }
  }
  levelProgress = progressProfile.levelProgress;
  // Best distance proves milestones were reached, which also repairs saves from before milestones existed.
  // Legacy unprefixed ids were Level 1 milestones; pre-level saves only recorded Level 1 distance.
  const storedMilestones = Array.isArray(data.milestones) ? data.milestones.map(migrateMilestoneId) : [];
  const earned = new Set([...storedMilestones,
    ...(sourceSchemaVersion < 9 ? milestonesForDistance(bestDistance, 'level1') : []),
    ...LEVEL_IDS.flatMap(id => levelProgress[id].reachedSectors.flatMap(number =>
      milestonesForDistance(GAME_BALANCE.routes[id].sectorStartsMeters[number - 1], id).slice(-1)))]);
  const blueprintRewardIds = [...new Set(Array.isArray(data.blueprintRewardIds)
    ? data.blueprintRewardIds.filter(id => typeof id === 'string' && id) : [])];

  return {
    schemaVersion: SCHEMA_VERSION,
    coins: nonNegativeInt(data.coins),
    blueprints: nonNegativeInt(data.blueprints),
    ownedVehicleIds,
    selectedVehicleId: ownedVehicleIds.includes(data.selectedVehicleId) &&
      ['standard', 'swift'].includes(data.selectedVehicleId) ? data.selectedVehicleId : 'standard',
    blueprintRewardIds,
    deferredBlueprintRewards: Array.isArray(data.deferredBlueprintRewards)
      ? data.deferredBlueprintRewards.filter((reward, index, all) => reward && typeof reward.id === 'string' &&
        reward.id && Number.isInteger(reward.amount) && reward.amount > 0 &&
        all.findIndex(other => other?.id === reward.id) === index &&
        !blueprintRewardIds.includes(reward.id)).map(({id, amount}) => ({id, amount})) : [],
    bestDistance,
    totalRuns,
    tutorialCompleted: data.tutorialCompleted === true || establishedProgress,
    rookieTrialRewardsCredited: data.rookieTrialRewardsCredited === true,
    settledRunIds: [...new Set(Array.isArray(data.settledRunIds)
      ? data.settledRunIds.filter(id => typeof id === 'string' && id) : [])],
    seenHints: normalizeSeenHints(data.seenHints, totalRuns),
    milestones: MILESTONES.filter(id => earned.has(id)),
    cargoCapacityRank,
    reinforcedCargoRank: sourceSchemaVersion >= 9
      ? Math.min(GAME_BALANCE.cargoProgression.reinforcementMitigationByRank.length - 1,
        nonNegativeInt(data.reinforcedCargoRank)) : 0,
    ownedModules,
    shipStates,
    levelProgress,
  };
}

export function loadProfile(onWarning) {
  unreadableSave = null;
  saveReadFailed = false;
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch (error) {
    saveReadFailed = true;
    const message = 'Saved progress could not be read. Saving is paused; check browser storage and reload.';
    console.warn(message, error);
    onWarning?.(message);
    return defaultProfile();
  }
  if (!raw) return defaultProfile();
  try {
    const data = JSON.parse(raw);
    if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, SCHEMA_VERSION].includes(data?.schemaVersion)) {
      throw new Error('Unsupported local save schema');
    }
    return normalizeProfile(data);
  } catch (error) {
    unreadableSave = raw;
    const backedUp = backupUnreadable(raw);
    if (backedUp) unreadableSave = null;
    const message = backedUp
      ? 'Saved progress could not be loaded. The original was backed up; using a temporary fresh profile.'
      : 'Saved progress could not be loaded or backed up. The original is preserved; saving is blocked until backup succeeds.';
    console.warn(message, error);
    onWarning?.(message);
    return defaultProfile();
  }
}

/** Keeps a copy of a save this version can't read, so a later version (or a person) can recover it. */
function backupUnreadable(raw) {
  try {
    const baseKey = `${KEY}-unreadable-backup`;
    let backupKey = baseKey, suffix = 0;
    let existing = localStorage.getItem(backupKey);
    while (existing !== null && existing !== raw) {
      backupKey = `${baseKey}-${++suffix}`;
      existing = localStorage.getItem(backupKey);
    }
    if (existing !== raw) localStorage.setItem(backupKey, raw);
    return true;
  } catch (error) {
    console.warn('Could not back up unreadable local save; original progress will not be overwritten.', error);
    return false;
  }
}

export function saveProfile(profile) {
  if (saveReadFailed) {
    console.warn('Local prototype save blocked after a read failure; reload once browser storage is available.');
    return false;
  }
  if (unreadableSave !== null) {
    if (!backupUnreadable(unreadableSave)) return false;
    unreadableSave = null;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
    return true;
  } catch (error) {
    console.warn('Local prototype save failed.', error);
    return false;
  }
}