import {IMPLEMENTED_LEVELS} from './sectors.js';
import {METERS_PER_PIXEL, routeSpeedAtDistance} from './economy.js';
import {ROAD_LEFT, ROAD_RIGHT, SHIP_Y} from '../data/route.js';
import {GAME_BALANCE} from '../data/gameBalance.js';

export const DEPOT_ENTRANCE_GEOMETRY = Object.freeze({
  ...GAME_BALANCE.routes.depot.entrance,
  shipHalfHeight: GAME_BALANCE.hazards.playerHalfHeightPx,
});
const entryHalfMeters = (DEPOT_ENTRANCE_GEOMETRY.mouthHeight / 2 -
  DEPOT_ENTRANCE_GEOMETRY.shipHalfHeight) * METERS_PER_PIXEL;

export const DEPOT_RULES = Object.freeze({
  ...GAME_BALANCE.routes.depot,
  triggerHalfMeters: entryHalfMeters,
});
const transitionsFor = levelId => IMPLEMENTED_LEVELS[levelId].slice(1).map(sector => sector.startsAt);
export const MOVER_WINDOW_RULES = DEPOT_RULES;

/** Full-road loaded steering plus reaction, measured at the fastest approach speed. */
export function depotApproachMeters(distance, levelId = 'level1', mode = 'normal') {
  return routeSpeedAtDistance(distance, levelId, mode) * METERS_PER_PIXEL * DEPOT_RULES.approachSeconds;
}

/** Half-open banking intervals; Normal's final interval ends at finish settlement. */
export function nextMoverWindowAfter(distance, rules = MOVER_WINDOW_RULES, levelId = 'level1', mode = 'normal') {
  const depot = nextDepotAfter(distance, rules, levelId, mode);
  if (mode === 'continuous') return Object.freeze({...depot,
    startDistance: Math.floor(distance / GAME_BALANCE.routes.continuous.depotIntervalMeters) *
      GAME_BALANCE.routes.continuous.depotIntervalMeters});
  const finish = GAME_BALANCE.routes[levelId].finishDistanceMeters;
  const startDistance = distance >= finish ? finish
    : IMPLEMENTED_LEVELS[levelId].findLast(sector => sector.startsAt <= distance).startsAt;
  return Object.freeze({...depot, startDistance,
    distance: mode === 'normal' && distance < finish && depot.distance === Infinity ? finish : depot.distance});
}

/** Normal stops are section transitions; endless sections retain their cash-out boundary. */
export function nextDepotAfter(distance, rules = DEPOT_RULES, levelId = 'level1', mode = 'normal') {
  if (!Number.isFinite(distance) || distance < 0 || !IMPLEMENTED_LEVELS[levelId] ||
      !Number.isFinite(rules.loopMeters) || rules.loopMeters <= 0 ||
      !['normal', 'continuous'].includes(mode)) throw new Error('Invalid Depot schedule');
  if (mode === 'continuous') {
    if (levelId !== 'level1') throw new Error('Continuous Run has no per-level Depot schedule');
    const interval = GAME_BALANCE.routes.continuous.depotIntervalMeters;
    const index = Math.floor(distance / interval) + 1;
    return Object.freeze({distance: index * interval, transition: true, side: index % 2 ? 'left' : 'right'});
  }
  const transitions = transitionsFor(levelId);
  const transition = transitions.find(at => at > distance);
  const at = transition ?? Infinity;
  return Object.freeze({distance: at, transition: Number.isFinite(at),
    side: at === transitions[0] || Math.floor(at / rules.loopMeters) % 8 === 0 ? 'left' : 'right'});
}

/** Canonical cab and indicated-side approach bay; sprite scaling never changes entry. */
export function depotEntryBounds(depot, distance, x) {
  const {mouthLeft, mouthWidth, mouthHeight} = DEPOT_ENTRANCE_GEOMETRY;
  const halfWidth = GAME_BALANCE.hazards.playerHalfWidthPx;
  const halfHeight = GAME_BALANCE.hazards.playerHalfHeightPx;
  return {
    player: {x: x - halfWidth, y: SHIP_Y - halfHeight, width: halfWidth * 2, height: halfHeight * 2},
    bay: {x: depot.side === 'left' ? mouthLeft : ROAD_LEFT + ROAD_RIGHT - mouthLeft - mouthWidth,
      y: depotWorldY(depot, distance) - mouthHeight / 2, width: mouthWidth, height: mouthHeight},
  };
}

function intersectBounds(a, b) {
  return {width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))};
}

export function depotEntryAllowed(depot, distance, x, priorDistance = distance, intersect = intersectBounds) {
  if (!Number.isFinite(depot.distance) || !['left', 'right'].includes(depot.side) ||
      priorDistance > depot.distance || distance < depot.distance) return false;
  // Sample the crossing plane, even if one frame travels through the whole bay.
  const {player, bay} = depotEntryBounds(depot, depot.distance, x);
  const overlap = intersect(player, bay);
  // Subtracting world coordinates can lose a few ULPs at the inclusive boundary.
  const roundoff = Number.EPSILON * Math.max(Math.abs(player.x), Math.abs(bay.x), bay.width) * 4;
  return overlap.height > 0 && overlap.width + roundoff >= player.width * 0.5;
}

/** Begin braking early enough for the existing 1.5 s stop to end at the bay centre. */
export function depotDockingStart(depot, levelId = 'level1', mode = 'normal') {
  if (depot.distance === Infinity) return Infinity;
  const travelSeconds = DEPOT_RULES.dockingSeconds / 2;
  let left = Math.max(0, depot.distance -
    routeSpeedAtDistance(depot.distance, levelId, mode) * travelSeconds * METERS_PER_PIXEL);
  let right = depot.distance;
  for (let iteration = 0; iteration < 40; iteration++) {
    const middle = (left + right) / 2;
    if (middle + routeSpeedAtDistance(middle, levelId, mode) * travelSeconds * METERS_PER_PIXEL <
        depot.distance) left = middle;
    else right = middle;
  }
  return (left + right) / 2;
}

/** Integrate smoothstep speed exactly so Depot motion is independent of frame rate. */
export function depotMotionStep(elapsed, dt, duration, accelerating = false) {
  const from = Math.min(1, elapsed / duration);
  const next = Math.min(duration, elapsed + dt);
  // Snap frame-sum roundoff at the exact timer endpoint, not an extra rendered frame later.
  const end = duration - next <= Number.EPSILON * duration * 16 ? duration : next;
  const to = end / duration;
  const integral = t => t ** 3 - t ** 4 / 2;
  const acceleratingSeconds = duration * (integral(to) - integral(from));
  const seconds = duration * (to - from);
  const fraction = to * to * (3 - 2 * to);
  return {elapsed: end, complete: to === 1,
    travelSeconds: accelerating ? acceleratingSeconds : seconds - acceleratingSeconds,
    speedFraction: accelerating ? fraction : 1 - fraction};
}

/** Number of actual facilities passed locally; independent of entering or continuing. */
export function depotPaletteStep(distance, sectorStart, levelId = 'level1', mode = 'normal') {
  if (mode === 'continuous') return Math.floor(distance / GAME_BALANCE.routes.continuous.depotIntervalMeters);
  const transitions = transitionsFor(levelId);
  return transitions.filter(at => at > sectorStart && at <= distance).length;
}

export function depotWorldY(depot, distance) {
  return SHIP_Y - (depot.distance - distance) / METERS_PER_PIXEL;
}
