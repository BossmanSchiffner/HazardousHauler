import {difficultyStepAtDistance, sectorAtDistance} from './sectors.js';
import {settleBlueprintAward} from './economy.js';
import {GAME_BALANCE} from '../data/gameBalance.js';

/** Indexed by difficulty step (sector position); the final entry applies past the finish. */
export const BLUEPRINT_SPAWN_BUDGETS = GAME_BALANCE.physics.blueprint.spawnBudgetsBySectorStep;
// Provisional tuning approved for Slice 1, not a guaranteed drop.
const BLUEPRINT_PICKUP_AMOUNT = GAME_BALANCE.physics.blueprint.pickupAmount;
export const BLUEPRINT_SPAWN_CHANCE = GAME_BALANCE.physics.blueprint.spawnChance;

/** Separate random stream: Blueprint attempts do not change existing chunks or coin rolls. */
export function createBlueprintRun(seed, runId) {
  if (!Number.isInteger(seed) || typeof runId !== 'string' || !runId) throw new Error('Invalid Blueprint run');
  const attempted = new Set();
  const spawned = new Set();
  return {
    authorize(distance, safeLanes, occupiedLanes = [], levelId = 'level1', mode = 'normal') {
      const sector = sectorAtDistance(distance, levelId, mode);
      const lanes = safeLanes.filter(lane => !occupiedLanes.includes(lane));
      if (!BLUEPRINT_SPAWN_BUDGETS[difficultyStepAtDistance(distance, levelId, mode)] || attempted.has(sector.id) || !lanes.length) return null;
      attempted.add(sector.id);
      let value = (seed ^ Math.imul(sector.number, 0x9e3779b9)) >>> 0;
      value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
      value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
      const roll = ((value ^ (value >>> 15)) >>> 0) / 4294967296;
      if (roll >= BLUEPRINT_SPAWN_CHANCE) return null;
      spawned.add(sector.id);
      return {id: `${runId}:${sector.id}`, lane: lanes[Math.floor(roll / BLUEPRINT_SPAWN_CHANCE * lanes.length)],
        amount: BLUEPRINT_PICKUP_AMOUNT};
    },
    get spawnedCount() { return spawned.size; },
  };
}

export function blueprintEligible(profile) {
  return profile.milestones.includes(GAME_BALANCE.physics.blueprint.unlockMilestone);
}

/** Non-road sources are retained, not discarded, before first Sector 3 eligibility. */
export function awardBlueprint(profile, {id, amount}, {road = false} = {}) {
  if (typeof id !== 'string' || !id || !Number.isInteger(amount) || amount <= 0) throw new Error('Invalid Blueprint reward');
  if (profile.blueprintRewardIds.includes(id) || profile.deferredBlueprintRewards.some(reward => reward.id === id)) {
    return {profile, blueprints: 0, coins: 0};
  }
  if (!blueprintEligible(profile)) {
    if (road) throw new Error('Road Blueprint award before Sector 3 eligibility');
    return {profile: {...profile, deferredBlueprintRewards: [...profile.deferredBlueprintRewards, {id, amount}]},
      blueprints: 0, coins: 0};
  }
  const payout = settleBlueprintAward(profile.ownedVehicleIds, amount);
  return {profile: {...profile, blueprints: profile.blueprints + payout.blueprints, coins: profile.coins + payout.coins,
    blueprintRewardIds: [...profile.blueprintRewardIds, id]}, ...payout};
}

export function releaseDeferredBlueprints(profile) {
  if (!blueprintEligible(profile) || !profile.deferredBlueprintRewards.length) return profile;
  let next = {...profile, deferredBlueprintRewards: []};
  for (const reward of profile.deferredBlueprintRewards) next = awardBlueprint(next, reward).profile;
  return next;
}
