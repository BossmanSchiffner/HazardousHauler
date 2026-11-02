import {advanceSteering} from './steering.js';
import {CARGO_CAPACITY_ID, WORST_CASE_HANDLING, loadoutStats} from './modules.js';
import {hazardX, movingHazardOffset, canonicalMotionAge, usesPotentialMoverLanes, usesTimedMoverLanes,
  hazardRouteGeometry, hazardRouteOffsetY, hazardScrollScale, LANE_CENTERS, HAZARD_ROW_ENVELOPE_PX} from './hazards.js';
import {GAME_BALANCE} from '../data/gameBalance.js';
import {HAZARD_TRAVEL_PX} from '../data/route.js';
import {METERS_PER_PIXEL} from './economy.js';

const {minX, maxX, loadedCapacity, simulationHz} = GAME_BALANCE.routes.track.routeValidation;
const maximumLaneChangesPerRow = GAME_BALANCE.routes.track.maxLaneChangesPerRow;
const {playerHalfWidthPx, playerHalfHeightPx} = GAME_BALANCE.hazards;
/** Signed distance from the expanded ship/obstacle rectangle union, in px. */
export function hazardClearance(hazard, y, x, elapsedSeconds) {
  const spec = hazardRouteGeometry(hazard);
  const movement = hazard.movement ?? hazard.motionBounds;
  const timedOffset = hazard.movement && elapsedSeconds !== undefined
    ? movingHazardOffset(hazard.movement, elapsedSeconds) : undefined;
  // Only the tagged three-centre pattern uses a fixed phase snapshot, not timed collision certification.
  const snapshot = usesPotentialMoverLanes(hazard) ? movingHazardOffset(hazard.movement, 0) : undefined;
  const movementMin = timedOffset ?? snapshot ?? movement?.minOffsetPx ?? 0;
  const movementMax = timedOffset ?? snapshot ?? movement?.maxOffsetPx ?? 0;
  const movementCenter = (movementMin + movementMax) / 2;
  const movementRadius = (movementMax - movementMin) / 2;
  const hazardCenterX = hazardX(hazard) + movementCenter;
  const parts = spec.footprint ?? [{x: 0, y: 0,
    halfWidth: spec.hitX - playerHalfWidthPx, halfHeight: spec.hitY - playerHalfHeightPx}];
  return Math.min(...parts.map(part => {
    const dx = Math.abs(x - hazardCenterX - part.x) - part.halfWidth - movementRadius - playerHalfWidthPx;
    const dy = (Math.abs(y + hazardRouteOffsetY(hazard) + part.y) -
      part.halfHeight - playerHalfHeightPx) * hazardScrollScale(hazard);
    return Math.hypot(Math.max(0, dx), Math.max(0, dy)) + Math.min(0, Math.max(dx, dy));
  }));
}

/** A complete transition, including the previous group's downstream intermediate. */
export function driveTrackTransition(previous, next, from, to, speed, {
  handling = WORST_CASE_HANDLING, hz = simulationHz,
  initialState = {x: LANE_CENTERS[from], velocity: 0},
  load = loadedCapacity, capacity = loadedCapacity, loadRelief = 0, vehicleMultiplier = 1,
  reactionSeconds = 0,
  levelId = 'level1', mode = 'normal',
} = {}) {
  let state = {...initialState};
  let clearance = Infinity;
  const gap = previous.spacingPx;
  const duration = gap / speed;
  const steps = Math.ceil(duration * hz);
  const dt = duration / steps;
  const previousHazards = [...previous.hazards, ...(previous.intermediates ?? [])];
  const nextHazards = [...next.hazards, ...(next.intermediates ?? [])];
  for (let step = 0; step <= steps; step++) {
    const y = HAZARD_ROW_ENVELOPE_PX / 2 + step * dt * speed;
    for (const [hazards, origin, row] of [
      [previousHazards, y, previous],
      [nextHazards, y - gap, next],
    ]) {
      for (const hazard of hazards) {
        let elapsed;
        if (usesTimedMoverLanes(hazard)) {
          const source = row.plannedDistance ?? row.spawnDistance;
          if (!Number.isFinite(source)) throw new Error('Timed mover certification needs its source distance');
          elapsed = canonicalMotionAge(source, source +
            (HAZARD_TRAVEL_PX + origin) * METERS_PER_PIXEL, levelId, mode);
        }
        clearance = Math.min(clearance, hazardClearance(hazard, origin, state.x, elapsed));
      }
    }
    if (clearance < 0) return {completed: false, clearance, state};
    if (step < steps) state = advanceSteering({...state,
      targetX: step * dt < reactionSeconds ? initialState.x : LANE_CENTERS[to], dt,
      minX, maxX, load, capacity, handling, loadRelief, vehicleMultiplier});
  }
  return {completed: Math.abs(state.x - LANE_CENTERS[to]) < 0.01 && Math.abs(state.velocity) < 0.01,
    clearance, state};
}

/** Maximin certified path: every gate state is settled, so transitions compose without teleporting. */
export function validateTrackSequence(rows, speed, options = {}) {
  const minimumClearance = options.minimumClearancePx ?? 0;
  let paths = (options.initialStates ?? rows[0].safeLanes.map(lane =>
    ({lane, x: LANE_CENTERS[lane], velocity: 0})))
    .map(state => ({lane: state.lane, state: {x: state.x, velocity: state.velocity},
      lanes: [state.lane], clearance: Infinity}));
  if (!paths.length) return {completed: false, clearance: -Infinity, lanes: []};
  for (let i = 1; i < rows.length; i++) {
    const candidates = [];
    for (const to of rows[i].safeLanes) {
      for (const path of paths) {
        if (Math.abs(path.lane - to) > maximumLaneChangesPerRow) continue;
        const result = driveTrackTransition(rows[i - 1], rows[i], path.lane, to,
          typeof speed === 'function' ? speed(i) : speed, {...options, initialState: path.state});
        if (result.completed && result.clearance >= minimumClearance) candidates.push({lane: to, lanes: [...path.lanes, to],
          state: result.state,
          clearance: Math.min(path.clearance, result.clearance)});
      }

    }
    paths = rows[i].safeLanes.map(lane => candidates.filter(p => p.lane === lane)
      .sort((a, b) => b.clearance - a.clearance)[0]).filter(Boolean);
    if (!paths.length) return {completed: false, clearance: -Infinity, lanes: []};
  }
  const best = paths.sort((a, b) => b.clearance - a.clearance)[0];
  return {completed: true, clearance: best.clearance, lanes: best.lanes,
    ...(rows.some(row => [...row.hazards, ...(row.intermediates ?? [])].some(usesPotentialMoverLanes))
      ? {approximateMovingSafety: true} : {}),
    exits: paths.map(path => ({lane: path.lane, ...path.state, clearance: path.clearance, lanes: path.lanes}))};
}

/** Actual supported chassis/load cases; stock-heavy cases characterize, not gate purchases. */
export function supportedTrackProfiles(levelId = 'level1') {
  const steering = levelId === 'level1' ? 1 : 2;
  const profiles = [];
  for (const chassis of ['standard', 'swift']) {
    for (const [cargoRank, rank, loadCase, nominal] of [
      [0, steering, 'full', true], [1, steering + 1, 'full', true],
      [0, 0, 'empty', false], [0, 0, 'mid', false], [0, 0, 'full', false],
      [8, 5, 'full', false],
    ]) {
      const stats = loadoutStats({cargoCapacityRank: cargoRank, ownedModules: {hand_precision: rank},
        shipStates: {[chassis]: {equippedModuleIds: [
          ...(rank ? ['hand_precision'] : []), ...(cargoRank ? [CARGO_CAPACITY_ID] : []),
        ]}}}, chassis);
      profiles.push({id: `${chassis}-c${cargoRank}-s${rank}-${loadCase}`, nominal, chassis,
        load: loadCase === 'empty' ? 0 : loadCase === 'mid' ? stats.capacity / 2 : stats.capacity,
        capacity: stats.capacity, handling: stats.handling, loadRelief: stats.loadRelief,
        vehicleMultiplier: stats.vehicleSteeringMultiplier,
        reactionSeconds: GAME_BALANCE.routes.movingHazards.reactionMarginSeconds});
    }
  }
  return profiles;
}
