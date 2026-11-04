import {advanceSteering} from './steering.js';
import {CARGO_CAPACITY_ID, WORST_CASE_HANDLING, loadoutStats} from './modules.js';
import {hazardX, movingHazardOffset, usesPotentialMoverLanes, usesTimedMoverLanes,
  hazardRouteGeometry, hazardRouteOffsetY, hazardScrollScale, LANE_CENTERS, HAZARD_ROW_ENVELOPE_PX} from './hazards.js';
import {GAME_BALANCE} from '../data/gameBalance.js';
import {HAZARD_TRAVEL_PX} from '../data/route.js';
import {METERS_PER_PIXEL, routeTimeAtDistance} from './economy.js';

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

/**
 * Per-transition invariants of hazardClearance, resolved once instead of every simulation step.
 * Evaluates the identical floating-point expressions, so certification results are unchanged.
 */
function clearanceProbe(hazard, row, levelId, mode) {
  const spec = hazardRouteGeometry(hazard);
  const movement = hazard.movement ?? hazard.motionBounds;
  const timed = usesTimedMoverLanes(hazard);
  let sourceDistance = null;
  let sourceTime = null;
  if (timed) {
    sourceDistance = row.plannedDistance ?? row.spawnDistance;
    if (!Number.isFinite(sourceDistance)) throw new Error('Timed mover certification needs its source distance');
    sourceTime = routeTimeAtDistance(Math.max(0, sourceDistance), levelId, mode);
  }
  const snapshot = usesPotentialMoverLanes(hazard) ? movingHazardOffset(hazard.movement, 0) : undefined;
  const movementMin = snapshot ?? movement?.minOffsetPx ?? 0;
  const movementMax = snapshot ?? movement?.maxOffsetPx ?? 0;
  const baseX = hazardX(hazard);
  return {
    movement: hazard.movement, timed, sourceDistance, sourceTime, baseX,
    centerX: baseX + (movementMin + movementMax) / 2,
    radius: (movementMax - movementMin) / 2,
    offsetY: hazardRouteOffsetY(hazard),
    scale: hazardScrollScale(hazard),
    parts: spec.footprint ?? [{x: 0, y: 0,
      halfWidth: spec.hitX - playerHalfWidthPx, halfHeight: spec.hitY - playerHalfHeightPx}],
  };
}

function probeClearance(probe, origin, x, levelId, mode) {
  let centerX = probe.centerX;
  let radius = probe.radius;
  if (probe.timed) {
    // Mirrors canonicalMotionAge with the source clock reused for this hazard.
    const elapsed = Math.max(0, routeTimeAtDistance(Math.max(0, probe.sourceDistance +
      (HAZARD_TRAVEL_PX + origin) * METERS_PER_PIXEL), levelId, mode) - probe.sourceTime);
    const offset = movingHazardOffset(probe.movement, elapsed);
    centerX = probe.baseX + (offset + offset) / 2;
    radius = (offset - offset) / 2;
  }
  let clearance = Infinity;
  for (const part of probe.parts) {
    const dx = Math.abs(x - centerX - part.x) - part.halfWidth - radius - playerHalfWidthPx;
    const dy = (Math.abs(origin + probe.offsetY + part.y) - part.halfHeight - playerHalfHeightPx) * probe.scale;
    clearance = Math.min(clearance, Math.hypot(Math.max(0, dx), Math.max(0, dy)) + Math.min(0, Math.max(dx, dy)));
  }
  return clearance;
}

function probeCenter(probe, origin, levelId, mode) {
  if (!probe.timed) return {centerX: probe.centerX, radius: probe.radius};
  const elapsed = Math.max(0, routeTimeAtDistance(Math.max(0, probe.sourceDistance +
    (HAZARD_TRAVEL_PX + origin) * METERS_PER_PIXEL), levelId, mode) - probe.sourceTime);
  return {centerX: probe.baseX + movingHazardOffset(probe.movement, elapsed), radius: 0};
}

/** Open x-intervals (ship centre) keeping at least `clearance` px from every probe at this row offset. */
function freeIntervals(probes, origins, clearance, levelId, mode) {
  const blocked = [];
  probes.forEach((probe, index) => {
    const origin = origins[index];
    const {centerX, radius} = probeCenter(probe, origin, levelId, mode);
    for (const part of probe.parts) {
      const dy = (Math.abs(origin + probe.offsetY + part.y) - part.halfHeight - playerHalfHeightPx) * probe.scale;
      if (dy >= clearance) continue;
      const reach = dy > 0 ? Math.sqrt(clearance * clearance - dy * dy) : clearance;
      const half = part.halfWidth + radius + playerHalfWidthPx + reach;
      blocked.push([centerX + part.x - half, centerX + part.x + half]);
    }
  });
  blocked.sort((a, b) => a[0] - b[0]);
  const free = [];
  let cursor = minX;
  for (const [start, end] of blocked) {
    if (start > cursor) free.push([cursor, Math.min(start, maxX)]);
    cursor = Math.max(cursor, end);
    if (cursor >= maxX) break;
  }
  if (cursor <= maxX) free.push([cursor, maxX]);
  return free.filter(([start, end]) => end >= start && start <= maxX);
}

/**
 * Geometry-only openness (owner rule): the generator guarantees an open corridor, not that a given truck
 * can steer it in time. The ship may slide sideways freely, so a transition is open when a continuous
 * corridor keeping `minimumClearancePx` from every hitbox links the `from` lane centre to the `to` lane
 * centre across the whole row gap. Upgrades, not the generator, decide who can actually make the move.
 */
function geometricTransition(previous, next, from, to, speed, {hz, initialState, minimumClearancePx,
  levelId, mode}) {
  const clearance = minimumClearancePx ?? GAME_BALANCE.routes.track.routeValidation.minimumClearancePx;
  const gap = previous.spacingPx;
  const steps = Math.ceil(gap / speed * hz);
  const previousProbes = [...previous.hazards, ...(previous.intermediates ?? [])]
    .map(hazard => clearanceProbe(hazard, previous, levelId, mode));
  const nextProbes = [...next.hazards, ...(next.intermediates ?? [])]
    .map(hazard => clearanceProbe(hazard, next, levelId, mode));
  const probes = [...previousProbes, ...nextProbes];
  const startX = initialState?.x ?? LANE_CENTERS[from];
  const targetX = LANE_CENTERS[to];
  let reachable = null;
  for (let step = 0; step <= steps; step++) {
    const y = HAZARD_ROW_ENVELOPE_PX / 2 + step * gap / steps;
    const origins = probes.map((_, index) => index < previousProbes.length ? y : y - gap);
    const free = freeIntervals(probes, origins, clearance, levelId, mode);
    reachable = reachable === null
      ? free.filter(([start, end]) => start <= startX && startX <= end)
      : free.filter(([start, end]) => reachable.some(([a, b]) => start <= b && a <= end));
    if (!reachable.length) return {completed: false, clearance: -Infinity, state: {...initialState}};
  }
  const completed = reachable.some(([start, end]) => start <= targetX && targetX <= end);
  return {completed, clearance: completed ? clearance : -Infinity,
    state: completed ? {x: targetX, velocity: 0} : {...initialState}};
}

/** A complete transition, including the previous group's downstream intermediate. */
export function driveTrackTransition(previous, next, from, to, speed, {
  handling = WORST_CASE_HANDLING, hz = simulationHz,
  initialState = {x: LANE_CENTERS[from], velocity: 0},
  load = loadedCapacity, capacity = loadedCapacity, loadRelief = 0, vehicleMultiplier = 1,
  reactionSeconds = 0,
  levelId = 'level1', mode = 'normal', geometric = false, minimumClearancePx,
} = {}) {
  if (geometric) {
    return geometricTransition(previous, next, from, to, speed,
      {hz, initialState, minimumClearancePx, levelId, mode});
  }
  let state = {...initialState};
  let clearance = Infinity;
  const gap = previous.spacingPx;
  const duration = gap / speed;
  const steps = Math.ceil(duration * hz);
  const dt = duration / steps;
  const previousProbes = [...previous.hazards, ...(previous.intermediates ?? [])]
    .map(hazard => clearanceProbe(hazard, previous, levelId, mode));
  const nextProbes = [...next.hazards, ...(next.intermediates ?? [])]
    .map(hazard => clearanceProbe(hazard, next, levelId, mode));
  for (let step = 0; step <= steps; step++) {
    const y = HAZARD_ROW_ENVELOPE_PX / 2 + step * dt * speed;
    const nextOrigin = y - gap;
    for (const probe of previousProbes) {
      clearance = Math.min(clearance, probeClearance(probe, y, state.x, levelId, mode));
    }
    for (const probe of nextProbes) {
      clearance = Math.min(clearance, probeClearance(probe, nextOrigin, state.x, levelId, mode));
    }
    if (clearance < 0) return {completed: false, clearance, state};
    if (step < steps) state = advanceSteering({...state,
      targetX: step * dt < reactionSeconds ? initialState.x : LANE_CENTERS[to], dt,
      minX, maxX, load, capacity, handling, loadRelief, vehicleMultiplier});
  }
  return {completed: Math.abs(state.x - LANE_CENTERS[to]) < 0.01 && Math.abs(state.velocity) < 0.01,
    clearance, state};
}

/**
 * Maximin certified path: every gate state is settled, so transitions compose without teleporting.
 * `departureDelaysSeconds` lets a transition begin its turn later than the reaction time, modelling a
 * driver with faster steering who waits for the previous gate to pass instead of turning eagerly.
 */
export function validateTrackSequence(rows, speed, options = {}) {
  const minimumClearance = options.minimumClearancePx ?? 0;
  const departureDelays = options.geometric ? [0] : options.departureDelaysSeconds ?? [0];
  const reaction = options.reactionSeconds ?? 0;
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
        for (const delay of path.lane === to ? [0] : departureDelays) {
          const result = driveTrackTransition(rows[i - 1], rows[i], path.lane, to,
            typeof speed === 'function' ? speed(i) : speed,
            {...options, reactionSeconds: reaction + delay, initialState: path.state});
          if (result.completed && result.clearance >= minimumClearance) candidates.push({lane: to, lanes: [...path.lanes, to],
            state: result.state,
            clearance: Math.min(path.clearance, result.clearance)});
        }
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
