import {LEVEL2_SECTORS, LEVEL3_SECTORS, SECTORS} from '../data/catalog.js';
import {GAME_BALANCE, ROUTE_TOPOLOGY} from '../data/gameBalance.js';
import {challengeProfile} from '../data/challengeProfiles.js';

const DIFFICULTY_TABLES = ['densityTargets', 'challengeChance', 'sustainedChance'];
const STEP_TABLES = {
  'cargo.valuesBySectorStep': GAME_BALANCE.cargo.valuesBySectorStep,
  'blueprint.spawnBudgetsBySectorStep': GAME_BALANCE.physics.blueprint.spawnBudgetsBySectorStep,
};

/** Theme drives look and hazards; difficulty, cargo tiers and Blueprints step up at each sector boundary. */
const buildLevel = (levelId, sectors) => {
  const route = GAME_BALANCE.routes[levelId];
  challengeProfile(route.challengeProfileId);
  const tables = {...Object.fromEntries(DIFFICULTY_TABLES.map(table => [table, route[table]])), ...STEP_TABLES};
  for (const [table, values] of Object.entries(tables)) {
    // One step per sector plus the Overdrive extension beyond the finish.
    if (values?.length !== sectors.length + 1) {
      throw new Error(`${levelId} ${table} needs ${sectors.length + 1} difficulty steps`);
    }
  }
  return Object.freeze(sectors.map((sector, index) => Object.freeze({
    ...sector, visualThemeId: sector.themeId, challengeProfileId: route.challengeProfileId, difficultyStep: index,
    number: index + 1, endsAt: route.sectorEndsMeters[index],
  })));
};

export const IMPLEMENTED_LEVELS = Object.freeze({
  level1: buildLevel('level1', SECTORS),
  level2: buildLevel('level2', LEVEL2_SECTORS),
  level3: buildLevel('level3', LEVEL3_SECTORS),
  level4: Object.freeze(ROUTE_TOPOLOGY.level4.sectorEnds.map((endsAt, index) => {
    const challengeProfileId = `level4_neon_s${index + 1}`;
    challengeProfile(challengeProfileId);
    return Object.freeze({
      id: `level4-sector${index + 1}`, name: 'Neon District', color: 0x594a91,
      themeId: 'neon', visualThemeId: 'neon', challengeProfileId,
      difficultyStep: index, number: index + 1,
      startsAt: index === 0 ? 0 : ROUTE_TOPOLOGY.level4.sectorEnds[index - 1],
      endsAt,
    });
  })),
});
const continuousInterval = GAME_BALANCE.routes.continuous.depotIntervalMeters;
export const CONTINUOUS_SECTORS = Object.freeze([
  Object.freeze({id: 'continuous-industrial', name: 'Industrial Outskirts', color: 0x34485d,
    themeId: 'industrial', visualThemeId: 'industrial', challengeProfileId: 'industrial',
    difficultyStep: 0, number: 1, startsAt: 0, endsAt: continuousInterval}),
  Object.freeze({id: 'continuous-dustlands', name: 'Dustlands', color: 0x927147,
    themeId: 'dustlands', visualThemeId: 'dustlands', challengeProfileId: 'dustlands',
    difficultyStep: 1, number: 2, startsAt: 0, endsAt: continuousInterval}),
  Object.freeze({id: 'continuous-dusklands', name: 'Dustlands at Dusk', color: 0x927147,
    themeId: 'dustlands', visualThemeId: 'dustlands', challengeProfileId: 'dustlands_dusk',
    difficultyStep: 2, number: 3, startsAt: 0, endsAt: continuousInterval}),
  Object.freeze({id: 'continuous-neon', name: 'Neon Gridway', color: 0x594a91,
    themeId: 'neon', visualThemeId: 'neon', challengeProfileId: 'level4_neon_s1',
    difficultyStep: 3, number: 4, startsAt: 0, endsAt: continuousInterval}),
]);
/** Kept as the Level 1 alias for existing route consumers and tests. */
export const IMPLEMENTED_SECTORS = IMPLEMENTED_LEVELS.level1;

export function sectorAtDistance(distance, levelId = 'level1', mode = 'normal') {
  if (!Number.isFinite(distance) || distance < 0) throw new Error('Invalid sector distance');
  const sectors = IMPLEMENTED_LEVELS[levelId];
  if (!sectors) throw new Error(`Unknown level ${levelId}`);
  if (mode === 'continuous') {
    if (levelId !== GAME_BALANCE.routes.continuous.baselineLevelId) throw new Error('Continuous Run has no per-level selection');
    const stage = Math.floor(distance / continuousInterval) % CONTINUOUS_SECTORS.length;
    return CONTINUOUS_SECTORS[stage];
  }
  if (mode !== 'normal') throw new Error(`Unknown sector mode ${mode}`);
  return sectors.findLast(sector => distance >= sector.startsAt);
}

/** Distance-based difficulty index; Overdrive past the finish uses the final extension step. */
export function difficultyStepAtDistance(distance, levelId = 'level1', mode = 'normal') {
  const sectors = IMPLEMENTED_LEVELS[levelId];
  const sector = sectorAtDistance(distance, levelId, mode);
  return sector.difficultyStep;
}
