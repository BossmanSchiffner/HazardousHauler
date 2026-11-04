/** Pure gameplay/economy functions: test without Phaser. */
import {ROUTE_END_DISTANCE_M} from '../data/catalog.js';
import {GAME_BALANCE, MAX_TRACK_SPEED} from '../data/gameBalance.js';
export {MAX_TRACK_SPEED};
export {ROUTE_END_DISTANCE_M};
const APEX_ID = 'apex';
const INTERMEDIATE_VEHICLES = GAME_BALANCE.vehicles.apexUnlock.prerequisites;
export const BP_TO_COINS = GAME_BALANCE.rewards.blueprintToCoins;
export const SINGLE_COIN_PAYOUT = GAME_BALANCE.cargo.singleCoinValue;
export const COIN_STACK_PAYOUT = GAME_BALANCE.cargo.stackCoinValue;
export const COIN_STACK_CHANCE = GAME_BALANCE.cargo.stackChance;
/** A pickup appears every 2–4 track rows: steady rhythm, never a long empty stretch. */
export const COIN_ROW_GAP_MIN = GAME_BALANCE.cargo.pickupRowGap.min;
export const COIN_ROW_GAP_MAX = GAME_BALANCE.cargo.pickupRowGap.max;
export const SLOT_RULES = Object.freeze(Object.fromEntries(
  Object.entries(GAME_BALANCE.upgrades.slotPurchases)
    .map(([slot, rule]) => [slot, Object.freeze({milestone: rule.milestone, cost: rule.costCoins})]),
));
export const SLOT_MAX = GAME_BALANCE.upgrades.maxSlots;

export const ROUTE_START_SPEED_PX_PER_SECOND = GAME_BALANCE.routes.level1.speed.startPxPerSecond;
export const ROUTE_END_SPEED_PX_PER_SECOND = GAME_BALANCE.routes.level1.speed.endPxPerSecond;
/** Route metres per scrolled pixel, shared by motion and facility placement. */
export const METERS_PER_PIXEL = GAME_BALANCE.routes.metersPerPixel;

/** Smooth sector-start interpolation; the final sector holds its approved speed. */
export function routeSpeedAtDistance(distance, levelId = 'level1', mode = 'normal') {
  if (!Number.isFinite(distance)) throw new Error('Route distance must be numeric');
  if (!['normal', 'continuous'].includes(mode)) throw new Error(`Unknown route mode ${mode}`);
  if (mode === 'continuous') {
    if (levelId !== 'level1') throw new Error('Continuous Run uses the global Level 1 Sector 2 baseline');
    const rules = GAME_BALANCE.routes.continuous;
    return Math.min(MAX_TRACK_SPEED, rules.startSpeedPxPerSecond +
      continuousStageAtDistance(Math.max(0, distance)) * rules.milestoneSpeedStep);
  }
  const route = GAME_BALANCE.routes[levelId];
  if (!route?.speed) throw new Error(`Unknown route level ${levelId}`);
  const at = Math.max(0, distance);
  const index = route.sectorStartsMeters.findLastIndex(start => at >= start);
  const speeds = route.speed.sectorStartsPxPerSecond;
  const next = Math.min(index + 1, speeds.length - 1);
  const fraction = next === index ? 0 :
    (at - route.sectorStartsMeters[index]) /
      (route.sectorStartsMeters[next] - route.sectorStartsMeters[index]);
  return Math.min(MAX_TRACK_SPEED, speeds[index] + (speeds[next] - speeds[index]) * fraction);
}

/** Canonical world clock integrates the exact piecewise-linear/capped speed curve. */
export function routeTimeAtDistance(distance, levelId = 'level1', mode = 'normal') {
  if (!Number.isFinite(distance) || distance < 0) throw new Error('Invalid route clock distance');
  const route = GAME_BALANCE.routes[levelId];
  if (!route || !['normal', 'continuous'].includes(mode)) throw new Error('Invalid route clock configuration');
  if (mode === 'continuous') {
    if (levelId !== 'level1') throw new Error('Continuous Run uses the global Level 1 Sector 2 baseline');
    const interval = GAME_BALANCE.routes.continuous.depotIntervalMeters;
    let seconds = 0;
    for (let from = 0; from < distance;) {
      const to = Math.min(distance, from + interval);
      const speed = routeSpeedAtDistance(from, levelId, mode);
      if (speed === MAX_TRACK_SPEED) return seconds + (distance - from) / (speed * METERS_PER_PIXEL);
      seconds += (to - from) / (speed * METERS_PER_PIXEL);
      from = to;
    }
    return seconds;
  }
  const breaks = [0, distance, ...route.sectorStartsMeters.filter(at => at > 0 && at < distance)]
    .sort((a, b) => a - b);
  let seconds = 0;
  for (let index = 1; index < breaks.length; index++) {
    const from = breaks[index - 1], to = breaks[index];
    if (to <= from) continue;
    const opening = routeSpeedAtDistance(from, levelId, mode);
    const ending = routeSpeedAtDistance(to, levelId, 'normal');
    const slope = (ending - opening) / (to - from);
    seconds += Math.abs(slope) < 1e-12 ? (to - from) / (opening * METERS_PER_PIXEL)
      : Math.log(ending / opening) / (slope * METERS_PER_PIXEL);
  }
  return seconds;
}

export function continuousStageAtDistance(distance) {
  if (!Number.isFinite(distance) || distance < 0) throw new Error('Continuous distance must be non-negative');
  return Math.floor(distance / GAME_BALANCE.routes.continuous.depotIntervalMeters);
}

export function routeFinishDistance(levelId = 'level1') {
  const route = GAME_BALANCE.routes[levelId];
  if (!route?.finishDistanceMeters) throw new Error(`Unknown route level ${levelId}`);
  return route.finishDistanceMeters;
}

export function upgradeCost(base, currentLevel) {
  if (!Number.isFinite(base) || base < 0 || !Number.isInteger(currentLevel) || currentLevel < 1) {
    throw new Error('Invalid module upgrade cost arguments');
  }
  return Math.round(base * Math.pow(GAME_BALANCE.upgrades.moduleUpgradeCostMultiplier, currentLevel - 1));
}

/** Share of steering response lost with a completely full hold, before module relief. */
const FULL_LOAD_STEERING_PENALTY = GAME_BALANCE.physics.steering.fullLoadPenalty;
const MIN_STEERING_RESPONSE = GAME_BALANCE.physics.steering.minimumResponse;

/**
 * Steering response: cargo load slows the ship, module handling speeds it up.
 * `handling` is the summed handling bonus (may be negative from drawbacks); `loadRelief`
 * removes that fraction of the full-load penalty. Floored so full loads stay controllable.
 */
export function steeringMultiplier(load, capacity, handling = 0, loadRelief = 0, vehicleMultiplier = 1) {
  if (!Number.isFinite(vehicleMultiplier) || vehicleMultiplier <= 0) {
    throw new Error('Vehicle steering multiplier must be positive');
  }
  const safeCapacity = Math.max(1, capacity);
  const ratio = Math.max(0, Math.min(1, load / safeCapacity));
  const penalty = FULL_LOAD_STEERING_PENALTY * (1 - Math.max(0, Math.min(1, loadRelief)));
  return Math.max(MIN_STEERING_RESPONSE, (1 - penalty * ratio) * (1 + handling)) * vehicleMultiplier;
}

export function crashReward(distance) {
  const {baseCoins, stepCoins, stepDistanceMeters, maxCoins} = GAME_BALANCE.rewards.crash;
  return Math.min(maxCoins, baseCoins + Math.floor(Math.max(0, distance) / stepDistanceMeters) * stepCoins);
}

export function canUnlockSlot(profile, targetSlot, chassisId = 'standard') {
  const rule = chassisId === 'swift'
    ? GAME_BALANCE.vehicles.swift.additionalSlotPurchases[targetSlot]
    : SLOT_RULES[targetSlot];
  const ship = profile.shipStates?.[chassisId];
  if (!rule || !ship || targetSlot !== ship.unlockedSlotCount + 1) return false;
  const milestone = rule.milestone;
  const cost = rule.costCoins ?? rule.cost;
  return Boolean(profile.milestones?.includes(milestone)) && profile.coins >= cost;
}

export function canUnlockApex(profile) {
  const owned = new Set(profile.ownedVehicleIds || []);
  return Boolean(profile.milestones?.includes(GAME_BALANCE.vehicles.apexUnlock.milestone)) &&
    INTERMEDIATE_VEHICLES.every(id => owned.has(id)) && !owned.has(APEX_ID);
}

/** Multiply only a module's positive numerical effect, never base chassis stat or negative drawback. */
export function applyVehicleModuleBenefit(moduleBenefit, chassisId) {
  if (!Number.isFinite(moduleBenefit)) throw new Error('Module benefit must be numeric');
  const multiplier = GAME_BALANCE.vehicles[chassisId]?.moduleBenefitMultiplier ?? 1;
  return moduleBenefit > 0 ? moduleBenefit * multiplier : moduleBenefit;
}

/** Blueprint awards are changed to coin awards once the capstone vehicle is owned. */
export function settleBlueprintAward(ownedVehicleIds, blueprintAmount) {
  if (!Number.isInteger(blueprintAmount) || blueprintAmount < 0) throw new Error('Invalid blueprint award');
  return ownedVehicleIds.includes(APEX_ID)
    ? {blueprints: 0, coins: blueprintAmount * BP_TO_COINS}
    : {blueprints: blueprintAmount, coins: 0};
}

/** One-time balance conversion called when acquiring Apex; consuming existing blueprint balance. */
export function convertLeftoverBlueprints(profile) {
  if (!profile.ownedVehicleIds.includes(APEX_ID)) throw new Error('Apex must be owned');
  return { ...profile, blueprints: 0, coins: profile.coins + profile.blueprints * BP_TO_COINS };
}
