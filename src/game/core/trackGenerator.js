import {
  COIN_ROW_GAP_MAX,
  COIN_ROW_GAP_MIN,
  ROUTE_END_SPEED_PX_PER_SECOND,
  ROUTE_START_SPEED_PX_PER_SECOND,
  routeSpeedAtDistance,
  routeTimeAtDistance,
  METERS_PER_PIXEL,
  SINGLE_COIN_PAYOUT,
} from './economy.js';
import {laneClearTimeSeconds} from './steering.js';
import {MAX_MODULE_LEVEL, WORST_CASE_HANDLING, loadoutStats} from './modules.js';
import {PICKUP_RADIUS_PX, HAZARD_TRAVEL_PX} from '../data/route.js';
import {difficultyStepAtDistance, sectorAtDistance} from './sectors.js';
import {cargoPickupForRoll} from './cargo.js';
import {HAZARD_ROW_ENVELOPE_PX, MAX_HAZARD_HIT_X, hazardsForRow, hazardBlockedIntervals, LANE_CENTERS,
hasStraightRoute, straightRouteWidth, hazardSweptArtOverlaps, hazardGeometry, hazardDefinition, hazardX,
sideHazardQuota, movingHazardQuota, hazardFirstContactDistance, routeHazardBlockedIntervals, usesPotentialMoverLanes,
projectPhysicalEvents, eventPressure, advancePressureHistory, movingHazardOffset, usesTimedMoverLanes,
guardrailMinimumLength, hazardRouteGeometry, hazardRouteOffsetY} from './hazards.js';
import {driveTrackTransition, validateTrackSequence} from './trackValidation.js';
import {DEPOT_RULES, MOVER_WINDOW_RULES, depotApproachMeters, nextDepotAfter, nextMoverWindowAfter} from './depots.js';
import {GAME_BALANCE} from '../data/gameBalance.js';
import {challengeProfile} from '../data/challengeProfiles.js';
export {MAX_TRACK_SPEED} from '../data/gameBalance.js';

const routeBalance = GAME_BALANCE.routes.level1;
const trackBalance = GAME_BALANCE.routes.track;
const baselineSelection = trackBalance.routeValidation.baseline;
const baselineStats = loadoutStats({cargoCapacityRank: 0, ownedModules: {},
  shipStates: {[baselineSelection.vehicleId]: {equippedModuleIds: []}}}, baselineSelection.vehicleId);
const baselineReference = Object.freeze({
  id: 'standard-stock-half', load: baselineStats.capacity * baselineSelection.loadFraction,
  capacity: baselineStats.capacity, handling: baselineStats.handling, loadRelief: baselineStats.loadRelief,
  vehicleMultiplier: baselineStats.vehicleSteeringMultiplier,
  reactionSeconds: GAME_BALANCE.routes.movingHazards.reactionMarginSeconds,
  geometric: trackBalance.routeValidation.certification === 'geometric',
});
export const DENSITY_TARGETS = routeBalance.densityTargets;
const BETA_HAZARD_KIND = 'divider';
const BETA_SLOTS = trackBalance.betaSlots;
const STRAIGHT_RUN_ROWS = 4;
const transitionCertificates = new Map();
const routeBalanceForLevel = levelId => GAME_BALANCE.routes[levelId];
export function encounterDensityAtDistance(distance, levelId = 'level1', mode = 'normal') {
  const route = routeBalanceForLevel(levelId);
  const sector = sectorAtDistance(distance, levelId, mode);
  const step = difficultyStepAtDistance(distance, levelId, mode);
  const stretch = mode === 'continuous' ? 0 : Math.min(route.densityStretch.maxIntervals,
    Math.floor((distance - sector.startsAt) / route.densityStretch.intervalMeters));
  // Additive, capped tuning: not another multiplier on speed or chunk difficulty.
  return route.densityTargets[step] + stretch * route.densityStretch.increment;
}

export function chunkCollisionSpan(rows) {
  const occupied = rows.flatMap((row, index) => row.emitted === false ||
    ![...row.hazards, ...(row.intermediates ?? [])].length ? [] : [index]);
  return occupied.length ? occupied.at(-1) - occupied[0] + 1 : 0;
}

function collisionCoverageSpans(bodies) {
  return bodies.flatMap(body => {
    const geometry = hazardRouteGeometry(body.hazard);
    const parts = geometry.footprint ?? [{y: 0,
      halfHeight: geometry.hitY - GAME_BALANCE.hazards.playerHalfHeightPx}];
    return parts.map(part => ({
      from: body.center - (part.y + part.halfHeight +
        GAME_BALANCE.hazards.playerHalfHeightPx) * METERS_PER_PIXEL,
      to: Math.min(body.lifetime?.clearedAtDistance ?? Infinity,
        body.center - (part.y - part.halfHeight -
          GAME_BALANCE.hazards.playerHalfHeightPx) * METERS_PER_PIXEL),
    })).filter(span => span.to > span.from);
  }).sort((a, b) => a.from - b.from);
}

function occupiedSecondsIn(spans, from, to, levelId, mode) {
  let tail = from, occupiedSeconds = 0;
  for (const span of spans) {
    const start = Math.max(tail, span.from);
    const end = Math.min(to, span.to);
    if (end > start) occupiedSeconds += routeTimeAtDistance(end, levelId, mode) -
      routeTimeAtDistance(start, levelId, mode);
    tail = Math.max(tail, span.to);
  }
  return occupiedSeconds;
}

export function chunkCollisionCoverage(rows, {levelId = 'level1', mode = 'normal',
  witnessStartRow = rows.length} = {}) {
  const empty = {occupiedSpan: 0, occupiedSeconds: 0, routeMeters: 0, occupiedSecondsPerMeter: 0,
    routeSeconds: 0, structuralSpanRows: 0, structuralOccupiedSeconds: 0, committedWitnessRows: 0};
  if (!rows.length) return empty;
  const from = rows[0].plannedDistance +
    (HAZARD_TRAVEL_PX - HAZARD_ROW_ENVELOPE_PX / 2) * METERS_PER_PIXEL;
  const to = rows.at(-1).plannedDistance +
    (rows.at(-1).spacingPx + HAZARD_TRAVEL_PX - HAZARD_ROW_ENVELOPE_PX / 2) * METERS_PER_PIXEL;
  const bodies = projectPhysicalEvents(rows, {levelId, mode}).bodies;
  const spans = collisionCoverageSpans(bodies);
  const structural = bodies.filter(body => (body.hazard.spanRows ?? 1) >=
    GAME_BALANCE.routes.sideObstacles.minimumSpanRows &&
    collisionCoverageSpans([body]).some(span => span.to > from && span.from < to));
  const witnessedRows = new Set();
  for (const body of structural) {
    const references = rows.flatMap((row, index) => row.emitted !== false &&
      row.hazards.some(hazard => hazard.sideObstacleId === body.id) ? [index] : []);
    if (references.length >= body.hazard.spanRows && references[0] < witnessStartRow) {
      for (const index of references.filter(index => index >= witnessStartRow)) witnessedRows.add(index);
    }
  }
  const occupiedSeconds = occupiedSecondsIn(spans, from, to, levelId, mode);
  const routeMeters = to - from;
  return {occupiedSpan: chunkCollisionSpan(rows),
    occupiedSeconds, routeMeters, occupiedSecondsPerMeter: occupiedSeconds / routeMeters,
    routeSeconds: routeTimeAtDistance(to, levelId, mode) - routeTimeAtDistance(from, levelId, mode),
    structuralSpanRows: Math.max(0, ...structural.map(body => body.hazard.spanRows)),
    structuralOccupiedSeconds: occupiedSecondsIn(collisionCoverageSpans(structural), from, to, levelId, mode),
    committedWitnessRows: witnessedRows.size};
}

/** Reject any Alpha/Beta envelope intersecting a facility approach or protected re-entry. */
export function hazardsBeforeDepot(row, distance, nextDepotDistance, protectedUntil = 0,
  levelId = 'level1', mode = 'normal') {
  const hazards = [...row.hazards, ...(row.intermediates ?? [])].filter(h => !h.continuation);
  if (!hazards.length) return true;
  const envelope = h => Math.max(HAZARD_ROW_ENVELOPE_PX / 2, hazardRouteGeometry(h).hitY);
  const head = Math.min(...hazards.map(h => HAZARD_TRAVEL_PX - hazardRouteOffsetY(h) - envelope(h)));
  const tail = Math.max(...hazards.map(h => HAZARD_TRAVEL_PX - hazardRouteOffsetY(h) + envelope(h)));
  const first = distance + head * METERS_PER_PIXEL;
  const last = distance + tail * METERS_PER_PIXEL;
  if (nextDepotDistance === Infinity) return first > protectedUntil;
  return first > protectedUntil &&
    (last < nextDepotDistance - depotApproachMeters(nextDepotDistance, levelId, mode) ||
      first > nextDepotDistance + DEPOT_RULES.exitMeters);
}

/** Extend existing authored groups; no new pickup rolls and no independently sprinkled walls. */
export function prepareTrackChunk(chunk, distance, random, levelId = 'level1', mode = 'normal') {
  const sector = sectorAtDistance(distance, levelId, mode);
  let speed = routeSpeedAtDistance(distance, levelId, mode);
  let spacing = rowSpacingAtSpeed(speed, mode, distance);
  let safetyDistance = distance;
  let arrivalSpeed = routeSpeedAtDistance(
    distance + (HAZARD_TRAVEL_PX + spacing * chunk.rows.length) * METERS_PER_PIXEL, levelId, mode,
  );
  if (mode === 'continuous') {
    for (let iteration = 0; iteration < 3; iteration++) {
      const estimatedEnd = distance + (HAZARD_TRAVEL_PX + spacing * chunk.rows.length) * METERS_PER_PIXEL;
      arrivalSpeed = routeSpeedAtDistance(estimatedEnd, levelId, mode);
      const nextSafetyDistance = Math.max(safetyDistance, estimatedEnd);
      const nextSpeed = Math.max(speed, arrivalSpeed);
      if (nextSafetyDistance === safetyDistance && nextSpeed === speed) break;
      safetyDistance = nextSafetyDistance;
      speed = nextSpeed;
      spacing = rowSpacingAtSpeed(speed, mode, safetyDistance);
    }
    spacing = rowSpacingAtSpeed(speed, mode, safetyDistance);
  }
  const rows = chunk.rows.map((row, phase) => ({...row,
    hazards: hazardsForRow(row, sector.number, phase).map(h => ({...h, placement: 'alpha',
      ...(h.motionBounds ? {movement: {
        ...h.motionBounds,
        speedPxPerSecond: GAME_BALANCE.routes.movingHazards.speedPxPerSecond,
        warningSeconds: GAME_BALANCE.routes.movingHazards.forkliftWarningSeconds,
        direction: random() < 0.5 ? -1 : 1,
        phase: random() * 2 * (h.motionBounds.maxOffsetPx - h.motionBounds.minOffsetPx),
      }} : {}),
      ...(h.spanRows ? {
        lengthPx: (h.spanRows - 1) * spacing + hazardGeometry(h).height,
        offsetY: (h.spanPhase - (h.spanRows - 1) / 2) * spacing,
      } : {})})),
    intermediates: [], spacingPx: spacing}));
  const requestedIntermediates = composeTrackIntermediates(rows, distance, random, levelId, mode,
    speed, arrivalSpeed, (index, proposed) => trackBalance.routeValidation.sampleHz.every(hz => {
      const candidate = rows.map((row, phase) => phase === index ? proposed : row);
      const proof = validateTrackSequence(candidate, i => routeSpeedAtDistance(distance +
        (HAZARD_TRAVEL_PX + HAZARD_ROW_ENVELOPE_PX / 2 +
          rows.slice(0, i).reduce((sum, row) => sum + row.spacingPx, 0)) * METERS_PER_PIXEL, levelId, mode),
      {...baselineReference, reactionSeconds: 0, hz,
        minimumClearancePx: trackBalance.routeValidation.minimumClearancePx});
      return proof.completed;
    }));
  return {...chunk, rows, requestedIntermediates};
}

export function shouldSuppressBetaBetweenAlpha(previous, next, lookahead) {
  const primaryLanes = row => [...new Set(row.hazards.filter(hazard =>
    !hazard.continuation && !hazard.sideObstacle).map(hazard => hazard.lane))];
  const blockedLanes = row => row.hazardLanes ?? TRACK_LANES.filter(lane => !row.safeLanes.includes(lane));
  const previousPrimary = primaryLanes(previous);
  const nextPrimary = primaryLanes(next);
  const futurePrimary = lookahead ? primaryLanes(lookahead) : [];
  const repeatedLaneTurn = lookahead && previousPrimary.length === 1 && nextPrimary.length === 1 &&
    futurePrimary.length === 1 && previousPrimary[0] === nextPrimary[0] &&
    futurePrimary[0] !== previousPrimary[0];
  const commonOpen = previous.safeLanes.filter(lane => next.safeLanes.includes(lane)).sort((a, b) => a - b);
  const lastOpenLane = commonOpen.at(-1);
  const wallClosesLastOpenLane = lookahead && Number.isInteger(lastOpenLane) &&
    !lookahead.safeLanes.includes(lastOpenLane) && blockedLanes(lookahead).includes(lastOpenLane);
  const sharedAlphaBlock = blockedLanes(previous).some(lane => blockedLanes(next).includes(lane));
  return Boolean(sharedAlphaBlock && (repeatedLaneTurn || wallClosesLastOpenLane));
}

export function betaIsSandwichedByAlpha(row, lane) {
  const blockedLanes = row.hazardLanes ?? TRACK_LANES.filter(candidate => !row.safeLanes.includes(candidate));
  const adjacentLanes = [lane - 1, lane + 1].filter(candidate =>
    candidate >= TRACK_LANES[0] && candidate <= TRACK_LANES.at(-1));
  return adjacentLanes.length === 0 || adjacentLanes.every(candidate => blockedLanes.includes(candidate));
}

function composeTrackIntermediates(rows, distance, random, levelId, mode, speed, arrivalSpeed,
  accept = () => true, allowFillers = false) {
  if (rows.length < 2) return 0;
  const route = routeBalanceForLevel(levelId);
  const spacing = rows[0].spacingPx;
  // The authored and live paths share the same capped, useful-pressure composer.
  const expected = Math.min(BETA_SLOTS.length, Math.max(0,
    (spacing / rowSpacingAtSpeed(ROUTE_START_SPEED_PX_PER_SECOND) *
      route.densityStretch.intermediateDensityScale * encounterDensityAtDistance(distance, levelId, mode) - 1) *
    rows.length / (rows.length - 1)));
  let requestedIntermediates = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const previous = rows[i], next = rows[i + 1];
    const suppressBeta = shouldSuppressBetaBetweenAlpha(previous, next, rows[i + 2]);
    const previousBlocked = previous.hazardLanes ?? TRACK_LANES.filter(lane => !previous.safeLanes.includes(lane));
    const nextBlocked = next.hazardLanes ?? TRACK_LANES.filter(lane => !next.safeLanes.includes(lane));
    const sharedAlphaBlock = previousBlocked.some(lane => nextBlocked.includes(lane));
    const lastOpenLane = sharedAlphaBlock
      ? previous.safeLanes.filter(lane => next.safeLanes.includes(lane)).sort((a, b) => a - b).at(-1)
      : null;
    const spacing = previous.spacingPx;
    const rowDistance = distance + rows.slice(0, i)
      .reduce((sum, row) => sum + row.spacingPx, 0) * METERS_PER_PIXEL;
    for (let slot = 0; slot < BETA_SLOTS.length; slot++) {
      if (previous.intermediates.some(hazard =>
        Math.abs(hazard.offsetY + spacing * BETA_SLOTS[slot]) < 1e-8)) continue;
      const roll = random();
      if (roll >= Math.min(1, Math.max(0, expected - slot))) continue;
      requestedIntermediates++;
      if (suppressBeta) continue;
      // Fixed candidate composition, not arbitrary x/y sprinkling. The center
      // option closes between-lane shortcuts; outer options commit an edge.
      const lanes = i % 2 ? [2, 1, 3, 0] : [1, 2, 0, 3];
      const local = [{hazards: [...previous.hazards, ...previous.intermediates]}, next];
      const openWidth = straightRouteWidth(local);
      const positionLanes = sharedAlphaBlock ? Number.isInteger(lastOpenLane) ? [lastOpenLane] : [] : lanes;
      const positions = positionLanes.map(lane => ({lane,
        offsetX: lane === 0 ? 6 : lane === 3 ? -6 : lane === 1 ? 10 : -10}));
      if (!sharedAlphaBlock) positions.push({lane: 1, offsetX: 36});
      const movers = [previous, next].flatMap(row => row.hazards.filter(hazard => hazard.movement));
      const centralMoverWindow = movers.length > 0 && movers.every(usesTimedMoverLanes);
      const filler = allowFillers && slot === 0 && (!movers.length || centralMoverWindow);
      const palette = filler
        ? challengeProfile(sectorAtDistance(rowDistance, levelId, mode).challengeProfileId).fillerHazardFamilies : [];
      const firstKind = Math.floor(roll * palette.length);
      const kinds = palette.length
        ? [palette[firstKind], BETA_HAZARD_KIND, ...palette.slice(firstKind + 1), ...palette.slice(0, firstKind)]
        : [BETA_HAZARD_KIND];
      const offset = trackBalance.laneSpacingPx / 4 * (0.5 + roll / 2);
      const firstLane = Math.floor(roll * TRACK_LANES.length);
      const fillerPositions = [...positionLanes.slice(firstLane), ...positionLanes.slice(0, firstLane)]
        .map(lane => ({lane, offsetX: lane === 0 ? -6 : lane === 3 ? 6 : lane === 1 ? -offset : offset}));
      // Reuse the density roll for variation; fillers flank lanes rather than camping between centres.
      const candidates = kinds.flatMap(kind =>
        (kind === BETA_HAZARD_KIND ? positions : fillerPositions)
          .filter(position => !centralMoverWindow || [0, 3].includes(position.lane)).map(position => {
          const hazard = Object.freeze({...position, kind, placement: 'beta',
            offsetY: -spacing * BETA_SLOTS[slot], intermediate: true,
            ...(kind !== BETA_HAZARD_KIND ? {filler: true} : {})});
          return {hazard, pressure: openWidth - straightRouteWidth([...local, {hazards: [hazard]}]),
            openingDistance: Math.min(...next.safeLanes.map(lane =>
              Math.abs(hazardX(hazard) - LANE_CENTERS[lane])))};
        }).filter(({hazard, pressure}) => !betaIsSandwichedByAlpha(next, hazard.lane) && (pressure > 0 ||
          (hazard.filler && pressure <= 0) ||
          (openWidth === 0 && (previous.safeLanes.includes(hazard.lane) || next.safeLanes.includes(hazard.lane)))))
        .sort((a, b) => kind === BETA_HAZARD_KIND ? b.pressure - a.pressure
          : b.openingDistance - a.openingDistance || b.pressure - a.pressure));
      for (const {hazard} of candidates) {
        if ([...previous.hazards, ...previous.intermediates].some(h => hazardSweptArtOverlaps(hazard, h)) ||
            next.hazards.some(h => hazardSweptArtOverlaps(hazard, h, -spacing))) continue;
        const proposed = {...previous, intermediates: [...previous.intermediates, hazard]};
        const targetDistance = rowDistance +
            (HAZARD_TRAVEL_PX + HAZARD_ROW_ENVELOPE_PX / 2) * METERS_PER_PIXEL;
        const transitionSpeed = routeSpeedAtDistance(targetDistance, levelId, mode);
        const key = JSON.stringify([levelId, mode, previous.plannedDistance, next.plannedDistance,
          transitionSpeed, spacing, previous.hazards, previous.safeLanes,
          next.hazards, next.intermediates, next.safeLanes, next.cargoLanes, proposed.intermediates]);
        if (!transitionCertificates.has(key)) {
          if (transitionCertificates.size >= 4096) transitionCertificates.clear();
          transitionCertificates.set(key, (() => {
            const routes = previous.safeLanes.map(from => next.safeLanes.filter(to =>
              Math.abs(from - to) <= trackBalance.maxLaneChangesPerRow &&
                trackBalance.routeValidation.sampleHz.every(hz => {
                  const result = driveTrackTransition(proposed, next, from, to, transitionSpeed,
                    {...baselineReference, hz, levelId, mode});
                  return result.completed && result.clearance >=
                    trackBalance.routeValidation.minimumClearancePx;
                })));
            return routes.some(lanes => lanes.length > 0);
          })());
        }
        if (transitionCertificates.get(key) && accept(i, proposed)) {
          previous.intermediates = Object.freeze(proposed.intermediates);
          break;
        }
      }
    }
  }
  return requestedIntermediates;
}

/** Authored sector track layouts and deterministic chunk selection. */
export const TRACK_LANES = trackBalance.lanes;
export const LANE_SPACING_PX = trackBalance.laneSpacingPx;
export const MIN_ROW_SPACING_PX = trackBalance.minRowSpacingPx;
export const COLLISION_CLEARANCE_PX = HAZARD_ROW_ENVELOPE_PX;
export const HAZARD_COLLISION_DISTANCE_PX = trackBalance.routeValidation.hazardClearDistancePx;
export const CARGO_COLLISION_DISTANCE_PX = PICKUP_RADIUS_PX;
const MAX_LANE_CHANGES_PER_ROW = trackBalance.maxLaneChangesPerRow;
/** Worst case: completely full hold, no handling modules plus every steering drawback, zero reaction time. */
export const WORST_CASE_LANE_CLEAR_SECONDS = laneClearTimeSeconds({
  load: 1, capacity: 1, handling: WORST_CASE_HANDLING,
  laneSpacing: LANE_SPACING_PX, clearDistance: MAX_HAZARD_HIT_X,
});
/** Best case: every chassis with maximum Precision Steering and an empty hold, zero reaction time. */
export const BEST_CASE_LANE_CLEAR_SECONDS = Math.min(...Object.keys(GAME_BALANCE.vehicles).map(chassis => {
  const precision = 'hand_precision';
  const stats = loadoutStats({cargoCapacityRank: 0, ownedModules: {[precision]: MAX_MODULE_LEVEL},
    shipStates: {[chassis]: {equippedModuleIds: [precision]}}}, chassis);
  return laneClearTimeSeconds({load: 0, capacity: stats.capacity, handling: stats.handling,
    loadRelief: stats.loadRelief, vehicleMultiplier: stats.vehicleSteeringMultiplier,
    laneSpacing: LANE_SPACING_PX, clearDistance: MAX_HAZARD_HIT_X});
}));
/** Reaction padding added to every row gap on top of the best-case clear time. */
export const ROW_REACTION_SECONDS = trackBalance.rowReactionSeconds;
/** Gap time between hazard rows as a multiple of the best-case clear time. */
const ROW_GAP_MARGIN_AT_START = trackBalance.rowGapMargin.start;
const ROW_GAP_MARGIN_AT_END = trackBalance.rowGapMargin.end;

/**
 * Reserve the full staggered collision envelope plus time for the best possible truck to clear the
 * widest hazard. Callers add ROW_REACTION_SECONDS of travel; openness is certified geometrically.
 */
export function rowSpacingAtSpeed(speed, mode = 'normal', distance = 0) {
  if (!Number.isFinite(speed) || speed <= 0) throw new Error('Scroll speed must be positive');
  const progress = Math.min(1, Math.max(0,
    (speed - ROUTE_START_SPEED_PX_PER_SECOND) /
    (ROUTE_END_SPEED_PX_PER_SECOND - ROUTE_START_SPEED_PX_PER_SECOND)));
  const margin = ROW_GAP_MARGIN_AT_START + (ROW_GAP_MARGIN_AT_END - ROW_GAP_MARGIN_AT_START) * progress;
  const spacing = Math.max(MIN_ROW_SPACING_PX,
    COLLISION_CLEARANCE_PX + speed * BEST_CASE_LANE_CLEAR_SECONDS * margin);
  return spacing;
}

const CENTER_LANES = Object.freeze([1, 2]);
const allLanesExcept = (...blocked) => TRACK_LANES.filter(lane => !blocked.includes(lane));
const row = (hazards, cargo = []) => Object.freeze({
  hazardLanes: Object.freeze(hazards),
  cargoLanes: Object.freeze(cargo),
  safeLanes: Object.freeze(allLanesExcept(...hazards)),
});

const routeChunk = (id, tier, rows) => Object.freeze({
  id, tier, name: id, entrySafeLanes: CENTER_LANES, exitSafeLanes: CENTER_LANES,
  rows: Object.freeze(rows),
});
const industrialRow = (placements, cargo = []) => {
  const hazards = Object.freeze(placements.map(([lane, kind, offsetY = 0, offsetX = 0]) =>
    Object.freeze({lane, kind, offsetY, offsetX})));
  const blocked = hazards.flatMap(hazardBlockedIntervals);
  return Object.freeze({
    ...row(TRACK_LANES.filter(lane => blocked.some(([left, right]) => LANE_CENTERS[lane] > left && LANE_CENTERS[lane] < right)), cargo),
    hazards,
  });
};
const industrialChunk = (id, rows, tier) => {
  if (hasStraightRoute(rows.slice(-2))) {
    let reachable = [...CENTER_LANES];
    for (const row of rows) reachable = row.safeLanes.filter(to =>
      reachable.some(from => Math.abs(from - to) <= MAX_LANE_CHANGES_PER_ROW));
    const turnCargo = [0, 3].filter(to =>
      reachable.some(from => Math.abs(from - to) <= MAX_LANE_CHANGES_PER_ROW));
    const returnCargo = CENTER_LANES.filter(to =>
      turnCargo.some(from => Math.abs(from - to) <= MAX_LANE_CHANGES_PER_ROW));
    rows = [...rows, industrialRow([[1, 'divider'], [2, 'divider']], turnCargo),
      industrialRow(channel[0], returnCargo)];
  }
  const manoeuvring = !hasStraightRoute(rows);
  return Object.freeze({...routeChunk(id, tier ?? (manoeuvring ? 2 : 1), rows), manoeuvring});
};
function countChunkHazards(chunk) {
  return chunk.rows.flatMap(row => [...row.hazards, ...(row.intermediates ?? [])])
    .filter(hazard => !hazard.continuation).length;
}
function countSideObstacles(chunk) {
  return chunk.rows.flatMap(row => [...row.hazards, ...(row.intermediates ?? [])])
    .filter(hazard => hazard.sideObstacle && !hazard.continuation).length;
}
export function trackEncounterSignature(family, rows) {
  const coordinate = value => Math.round((value ?? 0) * 1e8) / 1e8;
  return `${family}:${rows.map(row => {
    const alpha = row.hazards.map(h => `${h.kind}@${h.lane}:${coordinate(h.offsetX)}:${coordinate(h.offsetY)}:${coordinate(h.lengthPx)}${h.movement
      ? `:${coordinate(h.movement.phase)}:${h.movement.direction}` : ''}`).join(',');
    const beta = (row.intermediates ?? []).map(h => {
      const slot = BETA_SLOTS.find(slot => Math.abs(h.offsetY + row.spacingPx * slot) < 1e-8);
      return `${h.kind}@${h.lane}:${h.offsetX ?? 0}:${slot ?? h.offsetY}`;
    }).join(',');
    return alpha + (beta ? `[${beta}]` : '');
  }).join('|')}`;
}
function withChunkAccounting(chunk) {
  return Object.freeze({...chunk, obstacleCount: countChunkHazards(chunk),
    sideObstacleCount: countSideObstacles(chunk)});
}
function sideStructureVariant(chunk, placements) {
  const rows = chunk.rows.map(row => ({...row, hazards: [...row.hazards]}));
  for (const {rowIndex, hazardIndex, kind, spanRows, sideLane} of placements) {
    const source = rows[rowIndex].hazards[hazardIndex];
    const structure = {...source, lane: sideLane, offsetX: 0, offsetY: 0, kind, sideObstacle: true,
      sideObstacleId: `${chunk.id}:${rowIndex}:${hazardIndex}`, spanRows, spanPhase: 0};
    rows[rowIndex].hazards[hazardIndex] = structure;
    for (let phase = 1; phase < spanRows; phase++) {
      rows[rowIndex + phase].hazards.push({...structure, spanPhase: phase, continuation: true});
    }
  }
  const spacing = MIN_ROW_SPACING_PX;
  for (const {rowIndex, hazardIndex, spanRows} of placements) {
    const main = rows[rowIndex].hazards[hazardIndex];
    const resolved = {...main, lengthPx: (spanRows - 1) * spacing + hazardGeometry(main).height,
      offsetY: (main.spanPhase - (spanRows - 1) / 2) * spacing};
    for (let otherRow = Math.max(0, rowIndex - 1);
      otherRow < Math.min(rows.length, rowIndex + spanRows + 1); otherRow++) {
      for (const other of rows[otherRow].hazards) {
        if (other.sideObstacleId === main.sideObstacleId || other.continuation) continue;
        if (Math.abs(hazardX(resolved) - hazardX(other)) <
            (hazardGeometry(resolved).width + hazardGeometry(other).width) / 2 + 8) return null;
        if (hazardSweptArtOverlaps(resolved, other,
          (otherRow - rowIndex) * spacing, 0)) return null;
      }
    }
  }
  const mappedRows = rows.map(source => {
    const blocked = source.hazards.flatMap(hazardBlockedIntervals);
    const safeLanes = TRACK_LANES.filter(lane => !blocked.some(([left, right]) =>
      LANE_CENTERS[lane] > left && LANE_CENTERS[lane] < right));
    const cargoLanes = source.cargoLanes.filter(lane => safeLanes.includes(lane) &&
      source.hazards.every(hazard => Math.abs(LANE_CENTERS[lane] -
        LANE_CENTERS[hazard.lane] - (hazard.offsetX ?? 0)) >= hazardGeometry(hazard).hitX + 30));
    return Object.freeze({...source, safeLanes: Object.freeze(safeLanes),
      hazardLanes: Object.freeze(TRACK_LANES.filter(lane => !safeLanes.includes(lane))),
      cargoLanes: Object.freeze(cargoLanes),
      hazards: Object.freeze(source.hazards.map(Object.freeze))});
  });
  const variant = {...chunk,
    id: `${chunk.id}-side-${placements.map(p => `${p.rowIndex}-${p.hazardIndex}-${p.kind}-${p.spanRows}`).join('-')}`,
    baseChunkId: chunk.baseChunkId ?? chunk.id,
    sideVariantOf: chunk.baseChunkId ?? chunk.id,
    rows: Object.freeze(mappedRows),
    entrySafeLanes: mappedRows[0].safeLanes,
    exitSafeLanes: mappedRows.at(-1).safeLanes};
  if (!isChunkReachable(variant) || !hasNoTrapLanes(variant.rows) ||
      !requiresLaneChanges(variant.rows)) return null;
  return withChunkAccounting(variant);
}
function withSideObstacleVariants(chunks) {
  const output = [];
  for (const source of chunks) {
    const base = withChunkAccounting(source);
    output.push(base);
    if (base.sideObstacleCount || base.rows.length < 3) continue;
    const sources = [];
    for (let rowIndex = 0; rowIndex < base.rows.length; rowIndex++) {
      base.rows[rowIndex].hazards.forEach((hazard, hazardIndex) => {
        if (hazardDefinition(hazard.kind).roadside || hazard.continuation ||
            hazard.spanRows || hazard.motionBounds || ['forklift', 'sweeper'].includes(hazard.kind)) return;
        const sideLane = [0, 3].includes(hazard.lane) ? hazard.lane
          : (rowIndex + hazardIndex) % 2 === 0 ? 0 : 3;
        sources.push({rowIndex, hazardIndex, sideLane});
      });
    }
    for (let targetCount = 1; targetCount <= Math.min(3, sources.length); targetCount++) {
      const variants = [];
      let attempts = 0;
      const visit = (start, placements) => {
        if (variants.length >= 1 || attempts >= 40) return;
        if (placements.length === targetCount) {
          attempts++;
          const variant = sideStructureVariant(base, placements);
          if (variant) variants.push(variant);
          return;
        }
        for (let index = start; index <= sources.length - (targetCount - placements.length); index++) {
          const sourcePlacement = sources[index];
          const options = [
            {kind: sourcePlacement.sideLane === 0 ? 'sideRail' : 'sideWall', spanRows: 3},
            {kind: sourcePlacement.sideLane === 0 ? 'sideWall' : 'sideRail', spanRows: 4},
            {kind: sourcePlacement.sideLane === 0 ? 'sideRail' : 'sideWall', spanRows: 4},
            {kind: sourcePlacement.sideLane === 0 ? 'sideWall' : 'sideRail', spanRows: 3},
          ].filter(option => sourcePlacement.rowIndex + option.spanRows <= base.rows.length);
          for (const option of options) {
            visit(index + 1, [...placements, {...sourcePlacement, ...option}]);
            if (variants.length >= 1 || attempts >= 40) return;
          }
        }
      }
      visit(0, []);
      output.push(...variants);
    }
  }
  return Object.freeze(output);
}
const longSideSequence = (mirror = false) => {
  const rows = [];
  const append = (placements, cargo) => rows.push(industrialRow(placements, cargo));
  append(...channel);
  for (const [phase, blocked] of [2, 1, 3].entries()) {
    append([[0, 'sideRail', 0, -22], ...(phase === 2 ? [1, 2] : [blocked]).map(lane => [lane, 'divider'])],
      [phase === 2 || blocked === 2 ? 3 : 2]);
    const structure = rows.at(-1).hazards[0];
    rows[rows.length - 1] = {...rows.at(-1), hazards: [
      {...structure, sideObstacle: true, spanRows: 3, spanPhase: phase, continuation: phase > 0},
      ...rows.at(-1).hazards.slice(1),
    ]};
  }
  append(...channel);
  for (let phase = 0; phase < 4; phase++) {
    append([[3, 'sideWall'], [phase % 2, 'divider']], [1 - phase % 2]);
    const structure = rows.at(-1).hazards[0];
    rows[rows.length - 1] = {...rows.at(-1), hazards: [
      {...structure, sideObstacle: true, spanRows: 4, spanPhase: phase, continuation: phase > 0},
      ...rows.at(-1).hazards.slice(1),
    ]};
  }
  append(...channel);
  append([[1, 'divider'], [2, 'divider']], [0, 3]);
  append(...channel);
  return Object.freeze({...industrialChunk(`industrial-roadside-weave-${mirror ? 'right' : 'left'}`,
    rows.map(source => {
      const hazards = source.hazards.map(h => ({...h, lane: mirror ? 3 - h.lane : h.lane,
        offsetX: mirror ? -h.offsetX : h.offsetX}));
      const derived = industrialRow(hazards.map(h => [h.lane, h.kind, h.offsetY, h.offsetX]),
        source.cargoLanes.map(lane => mirror ? 3 - lane : lane));
      return Object.freeze({...derived, hazards: Object.freeze(hazards.map(Object.freeze))});
    })), family: 'roadside-weave'});
};
const mirroredSequence = (family, placements) => [false, true].map(mirror => {
  const rows = placements.map(([hazards, cargo]) => industrialRow(
    hazards.map(([lane, kind, offset = 0]) => [mirror ? 3 - lane : lane, kind, offset]),
    cargo.map(lane => mirror ? 3 - lane : lane)));
  return Object.freeze({...industrialChunk(`industrial-${family}-${mirror ? 'right' : 'left'}`, rows), family});
});
const channel = [[[0, 'divider'], [3, 'divider']], [1, 2]];
const leftApproach = [[[2, 'divider'], [3, 'barrier']], [0, 1]];
const leftGate = [[[1, 'divider'], [2, 'divider'], [3, 'divider']], [0]];
const leftReturn = [[[2, 'divider'], [3, 'barrier']], [0, 1]];
/** Explicit object arrangements: chunk choice is seeded; positions and families are not randomized. */
export const INDUSTRIAL_CHUNKS = Object.freeze([
  industrialChunk('industrial-divider-blockade', [
    industrialRow([[0, 'divider'], [3, 'divider']], [1, 2]),
    industrialRow([[1, 'divider']], [2]),
    industrialRow([[2, 'divider']], [1]),
    industrialRow([[0, 'divider'], [3, 'divider']], [1, 2]),
  ], 1),
  industrialChunk('industrial-container-bays', [
    industrialRow([[0, 'divider'], [3, 'divider']], [1, 2]),
    industrialRow([[2, 'divider']], [1]),
    industrialRow([[1, 'divider']], [2]),
    industrialRow([[0, 'divider'], [3, 'divider']], [1, 2]),
  ], 1),
  industrialChunk('industrial-power-corridor', [
    industrialRow([[0, 'divider'], [1, 'divider']], [2, 3]),
    industrialRow([[0, 'divider'], [3, 'divider']], [1, 2]),
    industrialRow([[2, 'divider'], [3, 'divider']], [0, 1]),
    industrialRow([[0, 'divider'], [3, 'divider']], [1, 2]),
  ], 1),
  ...mirroredSequence('side-squeeze', [
    channel, leftApproach, leftGate, leftReturn, channel,
  ]),
  ...mirroredSequence('center-denial', [
    channel,
    [[[1, 'divider'], [2, 'divider']], [0, 3]],
    [[[1, 'barrier'], [2, 'divider']], [0, 3]],
    channel,
  ]),
  ...mirroredSequence('split-path', [
    channel,
    [[[1, 'divider'], [2, 'divider']], [0, 3]],
    [[[1, 'divider'], [2, 'rockSlab']], [0, 3]],
    channel,
    [[[0, 'divider'], [1, 'divider'], [3, 'divider']], [2]],
  ]),
  ...mirroredSequence('narrow-gate', [
    channel, leftApproach,
    [[[1, 'divider'], [2, 'barrier'], [3, 'divider']], [0]],
    leftReturn, channel,
  ]),
  ...mirroredSequence('offset-chicane', [
    channel, leftApproach,
    [[[1, 'divider', 18], [2, 'divider', -18], [3, 'divider', -18]], [0]],
    leftReturn, channel,
    [[[0, 'divider', -18], [1, 'divider', -18], [3, 'divider', 18]], [2]],
    channel,
  ]),
  ...mirroredSequence('edge-commitment', [
    channel, leftApproach,
    [[[1, 'divider'], [2, 'divider'], [3, 'divider']], [0]],
    channel,
    leftReturn, channel,
  ]),
  longSideSequence(), longSideSequence(true),
]);
export const AUTHORED_CHUNKS = INDUSTRIAL_CHUNKS;
/** Reuse authored choreography and recompute safe lanes from each sector's footprints. */
function sectorChunks(sector, kinds, extended = false) {
  const mapRow = source => {
    const mapped = industrialRow(source.hazards.map(h =>
      [h.lane, h.keepKind ? h.kind : kinds[h.kind] ?? h.kind, h.offsetY, h.offsetX]), source.cargoLanes);
    return Object.freeze({...mapped, hazards: Object.freeze(mapped.hazards.map((h, i) =>
      Object.freeze({...source.hazards[i], ...h})))});
  };
  const chunks = INDUSTRIAL_CHUNKS.map(chunk => {
    const id = chunk.id.replace('industrial', sector);
    const rows = chunk.rows.map(mapRow);
    return Object.freeze({...industrialChunk(id, rows, chunk.tier), family: chunk.family});
  });
  // Single-lane gates move one lane at a time; no extra density or faster steering is needed.
  for (const [family, path] of [
    ['rolling-chicane', [1, 0, 1, 2, 3, 2, 1, 0]],
    ['switchback', [1, 2, 1, 0, 1, 2, 3, 2]],
  ]) {
    for (const mirror of [false, true]) {
      const gates = path.map((safe, phase) => {
        const lane = mirror ? 3 - safe : safe;
        return industrialRow(TRACK_LANES.filter(blocked => blocked !== lane).map(blocked =>
          [blocked, blocked === (lane + 2) % 4 ? kinds.barrier : 'divider',
            phase % 2 ? 12 : -12]), [lane]);
      });
      const exitLane = gates.at(-1).safeLanes[0];
      const exit = industrialRow(channel[0], channel[1].filter(lane =>
        Math.abs(lane - exitLane) <= MAX_LANE_CHANGES_PER_ROW));
      chunks.push(Object.freeze({
        ...industrialChunk(`${sector}-${family}-${mirror ? 'right' : 'left'}`,
          [mapRow(industrialRow(...channel)), ...gates, mapRow(exit)]),
        family, sustained: true,
      }));
    }
  }
  if (extended) {
    for (const side of ['left', 'right']) {
      const opposite = side === 'left' ? 'right' : 'left';
      const first = chunks.find(c => c.id === `${sector}-offset-chicane-${side}`);
      const second = chunks.find(c => c.id === `${sector}-edge-commitment-${opposite}`);
      chunks.push(Object.freeze({
        ...industrialChunk(`${sector}-cross-route-${side}`, [...first.rows,
          mapRow(industrialRow([[1, 'divider'], [2, 'divider']], [0, 3])),
          mapRow(industrialRow(...channel)), ...second.rows.slice(1)]),
        family: 'cross-route',
      }));
    }
  }
  return Object.freeze(chunks);
}

const DUSTLANDS_CHUNKS = sectorChunks('dustlands', {
  barrier: 'rockSlab', rockSlab: 'rockSlab',
  loadingPlatform: 'wreckPlatform', pipeAssembly: 'dustConduit',
  roadsideMachine: 'wreckPlatform', cargoDock: 'wreckPlatform',
  serviceBoom: 'dustConduit',
});
const NEON_CHUNKS = sectorChunks('neon', {
  barrier: 'signalCabinet', rockSlab: 'signalCabinet',
  loadingPlatform: 'signGantry', pipeAssembly: 'neonConduit',
  roadsideMachine: 'signGantry', cargoDock: 'signGantry',
  serviceBoom: 'neonConduit',
}, true);
const REACTOR_CHUNKS = sectorChunks('reactor', {
  barrier: 'rockSlab', rockSlab: 'divider',
  loadingPlatform: 'containment', pipeAssembly: 'reactorPipe',
  roadsideMachine: 'containment', cargoDock: 'containment',
  serviceBoom: 'reactorPipe',
}, true);
const OVERDRIVE_CHUNKS = Object.freeze(sectorChunks('overdrive', {
  barrier: 'rockSlab', rockSlab: 'signalCabinet',
  loadingPlatform: 'containment', pipeAssembly: 'reactorPipe',
  roadsideMachine: 'signGantry', cargoDock: 'containment',
  serviceBoom: 'reactorPipe',
}, true).filter(chunk => chunk.tier === 2));
export const CHUNK_REGISTRIES = Object.freeze({
  industrial: withSideObstacleVariants(INDUSTRIAL_CHUNKS),
  dustlands: withSideObstacleVariants(DUSTLANDS_CHUNKS),
  neon: withSideObstacleVariants(NEON_CHUNKS),
  reactor: withSideObstacleVariants(REACTOR_CHUNKS),
  overdrive: withSideObstacleVariants(OVERDRIVE_CHUNKS),
});

function splitLevel2Chunks(chunk, maxRows = 4) {
  if (chunk.rows.length <= maxRows || chunk.sideObstacleCount) {
    return [withChunkAccounting({...chunk, id: `level2-${chunk.id}`})];
  }
  const parts = [];
  for (let start = 0; start < chunk.rows.length; start += maxRows) {
    const end = Math.min(chunk.rows.length, start + maxRows);
    const part = {
      ...chunk,
      id: `level2-${chunk.id}-part-${parts.length + 1}`,
      entrySafeLanes: start === 0 ? chunk.entrySafeLanes : chunk.rows[start - 1].safeLanes,
      exitSafeLanes: end === chunk.rows.length ? chunk.exitSafeLanes : chunk.rows[end].safeLanes,
      rows: Object.freeze(chunk.rows.slice(start, end)),
    };
    if (!isChunkReachable(part) || !hasNoTrapLanes(part.rows)) return [];
    parts.push(withChunkAccounting(part));
  }
  return parts;
}

function movingOpeningChunks(themeId) {
  return Array.from({length: 3}, (_, firstLane) => {
    const lastLane = firstLane + 1;
    const escapeLane = firstLane === 0 ? 2 : firstLane === 1 ? 3 : 1;
    const recoveryHazards = firstLane === 0
      ? [[0, 'divider'], [2, 'divider'], [3, 'divider']]
      : firstLane === 2
        ? [[0, 'divider'], [1, 'divider'], [3, 'divider']]
      : [[0, 'divider'], [3, 'divider']];
    const rows = [
      industrialRow([[0, 'divider'], [3, 'divider']], [1, 2]),
      industrialRow([], []),
      industrialRow([[TRACK_LANES.find(lane => lane !== escapeLane &&
        ![firstLane, lastLane].includes(lane)), 'divider']], []),
      industrialRow(recoveryHazards, []),
    ];
    const mover = Object.freeze({
      lane: firstLane, kind: 'forklift', offsetY: 0, offsetX: 0,
      openingLanes: [firstLane, lastLane],
      recoveryLane: firstLane === 0 ? 1 : 2,
      motionBounds: {minOffsetPx: 0, maxOffsetPx: LANE_SPACING_PX},
    });
    const movingRow = Object.freeze({...rows[1], hazards: Object.freeze([mover]),
      safeLanes: Object.freeze([0, 1, 2, 3].filter(lane => lane !== firstLane && lane !== lastLane)),
      hazardLanes: Object.freeze([firstLane, lastLane]),
      cargoLanes: Object.freeze([])});
    const mappedRows = [rows[0], movingRow, rows[2], rows[3]];
    const chunk = Object.freeze({
      ...routeChunk(`level2-${themeId}-moving-opening-${firstLane}`, 2, mappedRows),
      family: 'moving-opening', sustained: true,
      exitSafeLanes: mappedRows.at(-1).safeLanes,
    });
    if (!isChunkReachable(chunk) || !hasNoTrapLanes(chunk.rows) ||
        !requiresLaneChanges(chunk.rows)) {
      throw new Error(`Invalid moving-opening route ${chunk.id} ` +
        `(reachable=${isChunkReachable(chunk)}, noTrap=${hasNoTrapLanes(chunk.rows)}, ` +
        `laneChanges=${requiresLaneChanges(chunk.rows)}, safe=${JSON.stringify(chunk.rows.map(row => row.safeLanes))}, ` +
        `blocked=${JSON.stringify(chunk.rows.map(row => row.hazards.flatMap(hazardBlockedIntervals)))})`);
    }
    return withChunkAccounting(chunk);
  });
}

export const LEVEL2_CHUNK_REGISTRIES = Object.freeze(Object.fromEntries(
  Object.entries(CHUNK_REGISTRIES).map(([themeId, chunks]) => {
    const variants = [];
    const moving = GAME_BALANCE.routes.movingHazards;
    chunks.forEach(chunk => {
      const baseParts = splitLevel2Chunks(chunk);
      variants.push(...baseParts);
    });
    if (moving.eligibleLevelIds.includes('level2') && moving.eligibleModes.includes('normal')) {
      variants.push(...movingOpeningChunks(themeId));
    }
    return [themeId, Object.freeze(variants)];
  }),
));

/** Owner rule: the first post-Depot row reaches the ship this many metres after the Depot. */
export const DEPOT_RESUME_METERS = DEPOT_RULES.resumeMeters;

/**
 * Planned distance of the first row after leaving a Depot at `distance`. It is earlier than `distance`, so
 * the row is already on the road (hidden by the Depot overlay) and reaches the ship DEPOT_RESUME_METERS on.
 */
export function depotResumeFirstDistance(distance) {
  if (!Number.isFinite(distance)) throw new Error('Invalid Depot resume distance');
  return distance + DEPOT_RESUME_METERS - (HAZARD_TRAVEL_PX - HAZARD_ROW_ENVELOPE_PX / 2) * METERS_PER_PIXEL;
}

/** Challenge composition is separate from encounter density. */
function hardChunkChance(distance, levelId = 'level1', mode = 'normal') {
  const route = routeBalanceForLevel(levelId);
  if (mode === 'normal' && distance < route.openingLesson.durationMeters) return route.openingLesson.challengeChance;
  return route.challengeChance[difficultyStepAtDistance(Math.max(0, distance), levelId, mode)];
}

/** True when every safe lane in each row can reach a safe lane in the next row (no dead ends). */
export function hasNoTrapLanes(rows) {
  for (let index = 1; index < rows.length; index++) {
    if (!rows[index - 1].safeLanes.every(lane => canReachLaneSet([lane], rows[index].safeLanes))) return false;
  }
  return true;
}

export function canReachLaneSet(fromLanes, toLanes, maxChanges = MAX_LANE_CHANGES_PER_ROW) {
  return fromLanes.some(from => toLanes.some(to => Math.abs(from - to) <= maxChanges));
}

export function isChunkReachable(chunk) {
  let reachable = [...chunk.entrySafeLanes];
  for (const trackRow of chunk.rows) {
    reachable = trackRow.safeLanes.filter(lane =>
      reachable.some(previous => Math.abs(previous - lane) <= MAX_LANE_CHANGES_PER_ROW));
    if (reachable.length === 0) return false;
  }
  return reachable.some(lane => chunk.exitSafeLanes.includes(lane));
}

/** Every rolling four-row window denies constant-x driving, including between lane centers. */
export function requiresLaneChanges(rows) {
  for (let i = 0; i <= rows.length - 4; i++) {
    if (hasStraightRoute(rows.slice(i, i + 4))) return false;
  }
  return true;
}

/**
 * Least sideways travel (px) that any truck line needs from the previous row's free road through
 * these rows, using real blocked intervals (truck half-width included). Steering-rate limits are
 * ignored, so this is a lower bound on demanded movement, not a reachability proof.
 */
export function lateralDemandPx(previousRow, rows) {
  const {minX, maxX} = trackBalance.routeValidation;
  const width = Math.floor(maxX - minX) + 1;
  const open = row => {
    const blocked = [...row.hazards, ...(row.intermediates ?? [])].flatMap(hazardBlockedIntervals);
    return Array.from({length: width}, (_, index) =>
      blocked.every(([left, right]) => minX + index <= left || minX + index >= right));
  };
  let cost = open(previousRow).map(free => free ? 0 : Infinity);
  for (const row of rows) {
    const free = open(row);
    for (let index = 1; index < width; index++) cost[index] = Math.min(cost[index], cost[index - 1] + 1);
    for (let index = width - 2; index >= 0; index--) cost[index] = Math.min(cost[index], cost[index + 1] + 1);
    cost = cost.map((value, index) => free[index] ? value : Infinity);
  }
  return Math.min(...cost);
}

export function createSeededRandom(seed) {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  random.fork = () => createSeededRandom(state);
  return random;
}

function fitForkliftOpening(hazard, obstacles, sourceDistance, levelId, mode) {
  const moving = GAME_BALANCE.routes.movingHazards;
  for (let travel = moving.travelLaneCount; travel >= moving.centralTravelLaneCount; travel--) {
    const starts = TRACK_LANES.filter(lane => lane + travel < TRACK_LANES.length)
      .sort((a, b) => Math.abs(a - hazard.lane) - Math.abs(b - hazard.lane));
    for (const lane of starts) {
      const movement = {...hazard.movement, maxOffsetPx: LANE_CENTERS[lane + travel] - LANE_CENTERS[lane]};
      const candidate = {...hazard, lane, movement,
        openingLanes: TRACK_LANES.filter(opening => opening >= lane && opening <= lane + travel)};
      if (obstacles.some(other => hazardSweptArtOverlaps(candidate, other, 0,
        other.moverCompanion ? 0 : 8))) continue;
      movement.impactOffsetPx = movingHazardOffset(movement, routeTimeAtDistance(sourceDistance +
        HAZARD_TRAVEL_PX * METERS_PER_PIXEL, levelId, mode) - routeTimeAtDistance(sourceDistance, levelId, mode));
      return candidate;
    }
  }
  return null;
}

/** Available-lane movers use canonical route-time collision certification. */
export function movingEncounterRows(distance, spacing, {
  levelId = 'level2', mode = 'normal', mirrored = false, reversed = false, paired = false, phase = 0,
  pinches = false, kind = 'forklift',
} = {}) {
  if (!['forklift', 'sweeper'].includes(kind)) throw new Error(`Unknown moving encounter ${kind}`);
  const moving = GAME_BALANCE.routes.movingHazards;
  const span = moving.travelLaneCount * LANE_SPACING_PX;
  const direction = reversed ? -1 : 1;
  const outer = mirrored ? 3 : 0;
  const make = (sign, motionPhase, sourceDistance, side) => {
    const forward = kind === 'sweeper';
    const movement = forward
      ? {axis: 'forward', forwardSpeedRatio: moving.sweeperForwardSpeedRatio}
      : {minOffsetPx: 0, maxOffsetPx: span, speedPxPerSecond: moving.speedPxPerSecond,
        direction: sign, phase: motionPhase, warningSeconds: moving.forkliftWarningSeconds};
    // Keep the advertised row's arrival anchor while the slower vehicle spawns nearer the cab.
    const hazards = [{kind, lane: side === 0 ? 2 : 1, offsetX: 0,
      offsetY: forward ? HAZARD_TRAVEL_PX * moving.sweeperForwardSpeedRatio : 0,
      ...(forward ? {} : {routeValidation: 'central-timed', openingLanes: [1, 2, 3]}), movement},
    {kind: pinches ? 'sideRail' : 'rockSlab', lane: side,
      offsetX: 0, offsetY: 0, moverCompanion: true,
      ...(pinches ? {lengthPx: guardrailMinimumLength('sideRail'), spanRows: 1,
        sideObstacle: true, pinch: true} : {filler: true})}];
    if (!forward) hazards[0] = fitForkliftOpening(hazards[0], hazards.slice(1), sourceDistance, levelId, mode);
    if (!hazards[0]) throw new Error('Moving encounter has no two-lane opening');
    const blocked = hazards.flatMap(routeHazardBlockedIntervals);
    return {hazards, safeLanes: TRACK_LANES.filter(lane =>
      !blocked.some(([left, right]) => LANE_CENTERS[lane] > left && LANE_CENTERS[lane] < right)), cargoLanes: []};
  };
  const recoveryGap = sourceDistance => {
    const sector = sectorAtDistance(sourceDistance, levelId, mode);
    const seconds = moving.recoverySecondsBySector[sector.number - 1];
    const speed = routeSpeedAtDistance(sourceDistance, levelId, mode);
    return Math.max(rowSpacingAtSpeed(speed, mode, sourceDistance), COLLISION_CLEARANCE_PX + speed * seconds);
  };
  const firstGap = recoveryGap(distance);
  const recovery = side => {
    if (!pinches) return industrialRow([[side, 'rockSlab']], [1, 2]);
    const hazard = {kind: 'sideRail', lane: side, offsetX: 0, offsetY: 0, pinch: true,
      lengthPx: guardrailMinimumLength('sideRail'), spanRows: 1, sideObstacle: true};
    return {hazards: [hazard], safeLanes: TRACK_LANES.filter(lane => lane !== side), cargoLanes: [1, 2]};
  };
  const rows = [make(direction, phase, distance, outer), recovery(3 - outer)];
  const gaps = [firstGap, spacing];
  if (paired) {
    const secondDistance = distance + (firstGap + spacing) * METERS_PER_PIXEL;
    const deltaTime = routeTimeAtDistance(secondDistance, levelId, mode) -
      routeTimeAtDistance(distance, levelId, mode);
    const secondPhase = span - phase - direction * moving.speedPxPerSecond * deltaTime;
    rows.push(make(-direction, secondPhase, secondDistance, 3 - outer), recovery(outer));
    gaps.push(recoveryGap(secondDistance), spacing);
  }
  let cursor = distance;
  return rows.map((row, index) => {
    const plannedDistance = cursor;
    cursor += gaps[index] * METERS_PER_PIXEL;
    return {...row, spacingPx: gaps[index], plannedDistance,
    hazards: row.hazards.map(hazard => ({...hazard, placement: 'alpha', sideObstacle: Boolean(hazard.pinch)})),
    intermediates: []};
  });
}

export function createTrackGenerator(seed, levelId = 'level1', mode = 'normal',
  {traceCandidateSelection, onPlanningProgress} = {}) {
  if (!Number.isInteger(seed)) throw new Error('Track seed must be an integer');
  const route = routeBalanceForLevel(levelId);
  if (!route) throw new Error(`Unknown track level ${levelId}`);
  if (!['normal', 'continuous'].includes(mode)) throw new Error(`Unknown track mode ${mode}`);
  if (mode === 'continuous' && levelId !== 'level1') throw new Error('Continuous Run has no per-level generator');
  if (traceCandidateSelection !== undefined && typeof traceCandidateSelection !== 'function') {
    throw new Error('Candidate selection trace must be a function');
  }
  let trace = traceCandidateSelection ? event => traceCandidateSelection(structuredClone(event)) : null;
  // Read-only liveness signal for background planners; it never influences choices or RNG.
  const progress = typeof onPlanningProgress === 'function' ? onPlanningProgress : () => {};
  let random = createSeededRandom(seed);
  const families = ['single_pressure', 'split_gate', 'offset_pair', 'side_squeeze', 'narrow_corridor',
    'static_chicane', 'risk_reward'];
  const {candidateBudget, recentLayouts, densityRecovery} = trackBalance.encounters;
  const clearLimit = trackBalance.maximumClearEvents[mode];
  const reactionSeconds = ROW_REACTION_SECONDS;
  const references = trackBalance.routeValidation.sampleHz.map(hz => ({...baselineReference, hz}));
  const initialExits = () => references.map(reference => reference.reactionSeconds === 0
    ? TRACK_LANES.map(lane => ({lane, x: LANE_CENTERS[lane], velocity: 0}))
    : [{lane: 1, x: (LANE_CENTERS[1] + LANE_CENTERS[2]) / 2, velocity: 0}]);
  let previousRow = null;
  let exits = initialExits();
  let previousFamily = null;
  let recent = [];
  let recentRows = [];
  // Last committed rows (derived from planning state, so probes and Depot resets stay consistent).
  const laneOpenHistory = () => recentRows.flatMap(entry => entry.rows).slice(-(STRAIGHT_RUN_ROWS - 1));
  // Data-only: any constant-x corridor (lane or between-lane) left open by row bodies across
  // STRAIGHT_RUN_ROWS consecutive rows that include a new row disqualifies the proposal.
  // Owner rule: an obstacle, Beta filler or pinch body all block the lane.
  const physicalRow = row => ({hazards: [...row.hazards, ...(row.intermediates ?? [])]});
  const opensStraightRun = steps => {
    const added = steps.flatMap(step => step.rows).map(physicalRow);
    const sequence = [...laneOpenHistory().map(physicalRow), ...added];
    for (let end = Math.max(STRAIGHT_RUN_ROWS, sequence.length - added.length + 1); end <= sequence.length; end++) {
      if (hasStraightRoute(sequence.slice(end - STRAIGHT_RUN_ROWS, end))) return true;
    }
    return false;
  };
  const emittedRecentRows = [];
  let familyUse = new Map([...families, 'moving_intercept'].map(family => [family, 0]));
  let rowsUntilPickup = 1;
  const account = {obstacles: 0, sideObstacles: 0};
  const moving = GAME_BALANCE.routes.movingHazards;
  const movingEligible = moving.eligibleLevelIds.includes(levelId) && moving.eligibleModes.includes(mode);
  const movingStart = route.sectorStartsMeters[moving.firstSector - 1];
  let pending = [];
  let obligations = [];
  let reservations = new Map();
  let structures = [];
  let movingIntervals = new Map();
  const emptyPressure = () => ({rows: [], bodies: [], streaks: [0, 0, 0, 0]});
  // Last resort only: a connected fallback may close a lane after one clear row, never exceed the maximum.
  let relaxMinimumClear = false;
  let plannedPressure = emptyPressure();
  let emittedPressure = emptyPressure();
  let wallUse = [0, 0];
  const steeringBalance = trackBalance.encounters.steeringDemand;
  let steering = {sector: null, encounters: 0, dashes: 0};
  let lastEmittedSideLane = null;
  let planningDistance = null;
  let planningStart = null;
  let rowOrdinal = 0;
  let structureOrdinal = 0;
  let reportedInterval = null;
  let movingQuotaConflict = null;
  const coverageBodies = new Map();
  const lateStart = route.sectorStartsMeters[2];
  let coverageThrough = 0, occupiedSeconds = 0, lateOccupiedSeconds = 0;
  const advanceCoverage = distance => {
    if (mode !== 'normal') return;
    const through = Math.min(distance, route.finishDistanceMeters);
    if (through <= coverageThrough) return;
    const spans = collisionCoverageSpans([...coverageBodies.values()]);
    occupiedSeconds += occupiedSecondsIn(spans, coverageThrough, through, levelId, mode);
    if (through > lateStart) lateOccupiedSeconds += occupiedSecondsIn(spans,
      Math.max(lateStart, coverageThrough), through, levelId, mode);
    coverageThrough = through;
    for (const [id, body] of coverageBodies) {
      if (collisionCoverageSpans([body]).every(span => span.to <= through)) coverageBodies.delete(id);
    }
  };
  const densitySnapshot = () => ({
    through: coverageThrough,
    emptySeconds: routeTimeAtDistance(coverageThrough, levelId, mode) - occupiedSeconds,
    lateEmptySeconds: coverageThrough <= lateStart ? 0 :
      routeTimeAtDistance(coverageThrough, levelId, mode) -
      routeTimeAtDistance(lateStart, levelId, mode) - lateOccupiedSeconds,
  });
  const committedDensitySnapshot = through => {
    through = Math.min(route.finishDistanceMeters, Math.max(coverageThrough, through));
    const committedRows = [...pending.flatMap(({chunk}) => chunk.rows),
      ...obligations.flatMap(step => step.rows.map((row, index) =>
        ({...row, plannedDistance: step.positions[index]})))]
      .map(row => ({...row, emitted: fitsDepot(row, row.plannedDistance)}));
    const spans = collisionCoverageSpans(projectPhysicalEvents(committedRows,
      {levelId, mode, bodies: [...coverageBodies.values()]}).bodies);
    const futureOccupiedSeconds = occupiedSecondsIn(spans, coverageThrough, through, levelId, mode);
    const futureLateOccupiedSeconds = through > lateStart ? occupiedSecondsIn(spans,
      Math.max(lateStart, coverageThrough), through, levelId, mode) : 0;
    if (trace) trace({type: 'committedCoverage', from: coverageThrough, through, futureOccupiedSeconds,
      rows: [...[...coverageBodies.values()].map(body => ({plannedDistance: body.sourceDistance,
        hazards: [body.hazard], intermediates: [], emitted: true, lifetime: body.lifetime})), ...committedRows]});
    return {through, futureOccupiedSeconds,
      emptySeconds: routeTimeAtDistance(through, levelId, mode) - occupiedSeconds - futureOccupiedSeconds,
      lateEmptySeconds: through <= lateStart ? 0 : routeTimeAtDistance(through, levelId, mode) -
        routeTimeAtDistance(lateStart, levelId, mode) - lateOccupiedSeconds - futureLateOccupiedSeconds};
  };
  const recordedRows = new WeakSet();
  const intervalFor = (contact, start, create = true) => {
    const depot = nextMoverWindowAfter(contact, MOVER_WINDOW_RULES, levelId, mode);
    if (movingIntervals.has(depot.distance)) return movingIntervals.get(depot.distance);
    const interval = {start: depot.startDistance, depot, encounters: []};
    if (create) movingIntervals.set(depot.distance, interval);
    return interval;
  };
  const contactFor = hazardFirstContactDistance;
  const fitsDepot = (row, distance) => hazardsBeforeDepot(row, distance,
    nextDepotAfter(distance, DEPOT_RULES, levelId, mode).distance, 0, levelId, mode);
  const countsFor = rows => {
    const counts = {obstacles: 0, sideObstacles: 0};
    for (const {row, distance} of rows) {
      if (!fitsDepot(row, distance)) continue;
      const hazards = [...row.hazards, ...row.intermediates].filter(hazard => !hazard.continuation);
      counts.obstacles += hazards.length;
      counts.sideObstacles += hazards.filter(hazard => hazard.sideObstacle).length;
    }
    return counts;
  };
  const projectPressure = (rows, positions, seam = null, context = plannedPressure,
    encounter = `encounter:${rowOrdinal}`, family = null) => {
    const prior = context.rows.map(row => seam && row.plannedDistance === seam.distance
      ? {...row, intermediates: seam.row.intermediates} : row);
    const proposed = rows.map((row, index) => ({...row, plannedDistance: positions[index],
      encounterId: encounter, family: row.family ?? family,
      emitted: row.emitted ?? fitsDepot(row, positions[index])}));
    const allRows = [...prior, ...proposed];
    const spans = new Map(context.bodies.filter(body => body.hazard.sideObstacleId).map(body => [
      body.id, {start: body.sourceDistance, last: body.sourceDistance +
        ((body.hazard.lengthPx ?? hazardDefinition(body.hazard.kind).height) -
          hazardDefinition(body.hazard.kind).height) * METERS_PER_PIXEL},
    ]));
    for (const row of allRows) for (const hazard of row.hazards) {
      if (!hazard.sideObstacleId) continue;
      if (!hazard.continuation) spans.set(hazard.sideObstacleId,
        {start: row.plannedDistance, last: row.plannedDistance});
      const span = spans.get(hazard.sideObstacleId);
      if (span) span.last = Math.max(span.last, row.plannedDistance);
    }
    const resolved = (hazard, distance) => {
      if (hazard.pinch) return hazard;
      const span = spans.get(hazard.sideObstacleId);
      if (!span) return hazard;
      const tail = (span.last - span.start) / METERS_PER_PIXEL;
      return {...hazard, lengthPx: tail + hazardDefinition(hazard.kind).height,
        offsetY: (distance - span.start) / METERS_PER_PIXEL - tail / 2};
    };
    // Unresolved side tails may conservatively deny a route, but cannot grant pressure.
    const physicalRows = allRows.map(row => ({...row,
      hazards: row.hazards.map(hazard => resolved(hazard, row.plannedDistance))}));
    const bodies = context.bodies.map(body => {
      const hazard = resolved(body.hazard, body.sourceDistance);
      return {...body, hazard, center: body.sourceDistance +
        (HAZARD_TRAVEL_PX - hazardRouteOffsetY(hazard)) * METERS_PER_PIXEL};
    });
    const projection = projectPhysicalEvents(physicalRows, {levelId, mode, bodies});
    const history = advancePressureHistory(context.streaks, projection.events, {mode});
    // Short clear runs stay accepted only where a relaxed connected fallback already committed them.
    const shortKey = violation => `${violation.lane}@${Math.round(violation.distance * 1e3)}`;
    const waivedShort = new Set(context.waivedShort ?? []);
    const acceptable = history.violations.every(violation => violation.short &&
      (relaxMinimumClear || waivedShort.has(shortKey(violation))));
    if (relaxMinimumClear && acceptable) {
      for (const violation of history.violations) waivedShort.add(shortKey(violation));
    }
    return {...context, rows: allRows, projection, history, acceptable, waivedShort: [...waivedShort]};
  };
  const compactPressure = context => {
    if (context.rows.length <= 8) return context;
    let cut = context.rows.length - 8;
    while (cut > 0 && context.rows[cut].encounterId === context.rows[cut - 1].encounterId) cut--;
    if (!cut) return context;
    const prefix = context.projection.events.filter(event => event.rowIndex < cut);
    const rows = context.rows.slice(cut);
    const boundary = rows[0].plannedDistance +
      (HAZARD_TRAVEL_PX - HAZARD_ROW_ENVELOPE_PX) * METERS_PER_PIXEL;
    return {rows, history: context.history,
      waivedShort: (context.waivedShort ?? []).filter(key =>
        Number(key.split('@')[1]) >= (rows[0].plannedDistance - 100) * 1e3),
      streaks: advancePressureHistory(context.streaks, prefix, {mode}).streaks,
      bodies: context.projection.bodies.filter(body => body.sourceDistance < rows[0].plannedDistance &&
        body.center + hazardRouteGeometry(body.hazard).hitY * METERS_PER_PIXEL >= boundary)};
  };
  const reachedPressure = (context, distance) => {
    const projection = projectPressure([], [], null, context).projection;
    const events = projection.events.filter(event => event.distance <= distance).map(event => {
      const clipped = {...event, to: Math.min(event.to, distance)};
      return {...clipped, ...eventPressure(clipped, projection.bodies, {levelId, mode})};
    }).filter(event => event.meaningful);
    return advancePressureHistory(context.streaks, events, {mode});
  };
  const reservedCounts = () => {
    const counts = {...account};
    for (const reservation of reservations.values()) {
      counts.obstacles += reservation.counts.obstacles;
      counts.sideObstacles += reservation.counts.sideObstacles;
    }
    return counts;
  };
  const movingContacts = interval => [...interval.encounters,
    ...[...reservations.values()].flatMap(reservation => reservation.movingContacts)
      .filter(contact => contact >= interval.start && contact < interval.depot.distance)]
    .sort((a, b) => a - b);
  const movingSchedule = (distance, spacing, extraContacts = [], lastFamily = previousFamily) => {
    if (!movingEligible) return {due: false, deadline: false};
    const contact = hazardFirstContactDistance({kind: 'forklift', offsetY: 0}, distance);
    const interval = intervalFor(contact, planningStart ?? distance, false);
    const encounters = [...movingContacts(interval), ...extraContacts.filter(contact =>
      contact >= interval.start && contact < interval.depot.distance)].sort((a, b) => a - b);
    const remaining = interval.depot.distance <= movingStart ||
      (mode === 'normal' && interval.start >= route.finishDistanceMeters)
      ? 0 : moving.minimumPerWindow - encounters.length;
    // Quota boundaries are not facilities; only actual banks impose clearance.
    let safeEnd = interval.depot.distance;
    const target = interval.start + (safeEnd - interval.start) * moving.scheduleWindowFraction *
      (encounters.length + 1) / moving.minimumPerWindow;
    const rowMeters = spacing * METERS_PER_PIXEL;
    if (mode === 'normal') safeEnd = Math.min(safeEnd, route.finishDistanceMeters - rowMeters -
      HAZARD_ROW_ENVELOPE_PX * METERS_PER_PIXEL);
    const bank = nextDepotAfter(distance, DEPOT_RULES, levelId, mode);
    let beforeBank = 0, bankDeadline = false, bankSafeEnd = Infinity;
    if (Number.isFinite(bank.distance) && bank.distance <= interval.depot.distance) {
      const bankSpeed = routeSpeedAtDistance(bank.distance, levelId, mode);
      const earliestAfterBank = bank.distance + Math.max(DEPOT_RULES.exitMeters, DEPOT_RESUME_METERS);
      const gapAfterBank = rowSpacingAtSpeed(bankSpeed, mode, bank.distance) + bankSpeed * reactionSeconds;
      const moverStride = Math.max(moving.minimumEncounterSpacingMeters, 2 * gapAfterBank * METERS_PER_PIXEL);
      const afterBank = earliestAfterBank > safeEnd ? 0
        : 1 + Math.floor((safeEnd - earliestAfterBank) / moverStride);
      beforeBank = Math.max(0, remaining - afterBank);
      bankSafeEnd = bank.distance - depotApproachMeters(bank.distance, levelId, mode) -
        HAZARD_ROW_ENVELOPE_PX * METERS_PER_PIXEL;
      bankDeadline = beforeBank > 0 && contact +
        ((beforeBank - 1) * 3 + (lastFamily === 'moving_intercept' ? 1 : 0)) * rowMeters > bankSafeEnd;
    }
    const due = distance >= movingStart && remaining > 0 && contact <= safeEnd &&
      (contact + 2 * rowMeters >= target || bankDeadline) &&
      (!encounters.length || contact - encounters.at(-1) >= moving.minimumEncounterSpacingMeters);
    return {due, remaining, count: encounters.length, overCapacity: encounters.length > moving.maximumPerWindow,
      contact, safeEnd, rowMeters, depot: interval.depot.distance,
      blockedByDepot: beforeBank > 0 && contact > bankSafeEnd,
      deadline: due && (bankDeadline || contact +
        ((remaining - 1) * 3 + (lastFamily === 'moving_intercept' ? 1 : 0)) * rowMeters > safeEnd)};
  };
  const movingVariants = (distance, spacing, context) => {
    const first = Math.floor(random() * TRACK_LANES.length);
    const chance = route.sustainedChance[difficultyStepAtDistance(distance, levelId, mode)];
    const canPair = movingEligible && moving.travelLaneCount === 2 && chance > 0 &&
      moving.chicane.rowOffset * spacing * METERS_PER_PIXEL >= moving.minimumEncounterSpacingMeters;
    if (!canPair) return [first, first ^ 1, first ^ 2, first ^ 3];
    const lastMover = context.rows.findLast(row => row.hazards.some(hazard => hazard.movement));
    const lastWasPair = lastMover && context.rows.filter(row =>
      row.encounterId === lastMover.encounterId && row.hazards.some(hazard => hazard.movement)).length > 1;
    const recovered = lastMover && context.rows.some(row =>
      row.encounterId !== lastMover.encounterId && row.plannedDistance > lastMover.plannedDistance &&
      row.safeLanes.length >= 2 && !row.hazards.some(hazard => hazard.movement));
    const preferred = (!lastWasPair || recovered) && random() < chance ? TRACK_LANES.length : 0;
    const alternative = TRACK_LANES.length - preferred;
    // Both live selection and committed proofs keep singles available within the same four probes.
    return [first + preferred, (first ^ 1) + preferred,
      first + alternative, (first ^ 1) + alternative];
  };
  const recipe = (family, lane, mirror, spacing, distance = planningDistance, pinches = false) => {
    if (family === 'moving_intercept') {
      // Level 2 movers are lateral Forklifts only; the forward Sweeper is reserved for Level 3 with its own sprite.
      return movingEncounterRows(distance, spacing, {levelId, mode, mirrored: lane % 2 === 1,
        reversed: lane >= 2, paired: mirror, phase: random() * 2 * LANE_SPACING_PX, pinches});
    }
    const pinch = (side, offsetY = 0) => ({kind: 'sideRail', lane: side, offsetX: 0, offsetY,
      lengthPx: guardrailMinimumLength('sideRail'), spanRows: 1, sideObstacle: true, pinch: true});
    if (['side_squeeze', 'narrow_corridor', 'static_chicane'].includes(family)) {
      const source = family === 'static_chicane'
        ? [industrialRow([[mirror ? 2 : 1, 'divider']], [mirror ? 1 : 2]),
          industrialRow([[mirror ? 1 : 2, 'divider']], [mirror ? 2 : 1])]
        : [0, 1].map(() => ({hazards: [], safeLanes: [1, 2], cargoLanes: [1, 2]}));
      return source.map((row, index) => ({...row, spacingPx: spacing +
        (family === 'static_chicane' && index === 0 ? GAME_BALANCE.routes.sideObstacles.chicaneTransitionExtraPx : 0),
        intermediates: [],
        hazards: [...row.hazards.map(h => ({...h, placement: 'alpha'})),
          pinch(index === 0 ? (mirror ? 3 : 0) : (mirror ? 0 : 3),
            family === 'static_chicane' && index === 1
              ? -spacing * (GAME_BALANCE.routes.sideObstacles.chicaneStaggerRows - 1) : 0)]
          .map(h => ({...h, placement: 'alpha'}))}));
    }
    const gate = opening => industrialRow(TRACK_LANES.filter(blocked => blocked !== opening)
      .map(blocked => [blocked, 'divider']), [opening]);
    let source = family === 'single_pressure'
      ? [industrialRow([[lane, 'divider']], TRACK_LANES.filter(other => other !== lane))]
      : family === 'split_gate' ? [gate(lane)]
      : family === 'risk_reward'
      ? [industrialRow([[mirror ? 1 : 2, 'divider']], [mirror ? 3 : 0])]
      // offset_pair is a chicane that holds each opening for two rows (owner rule: a lane stays open 2..3 rows).
      : (() => {
        const shifted = gate(lane === 0 ? 1 : lane === 3 ? 2 : lane + (mirror ? -1 : 1));
        return [gate(lane), gate(lane), shifted, shifted, gate(lane), gate(lane)];
      })();
    return source.map(row => ({...row,
      hazards: row.hazards.map(h => ({...h, placement: 'alpha',
        sideObstacle: Boolean(hazardDefinition(h.kind).roadside)})),
      intermediates: [], spacingPx: spacing}));
  };
  const signatureFor = trackEncounterSignature;
  const recentHistory = (context, seam = null) => {
    const groups = new Map();
    for (const row of context.rows) {
      if (!groups.has(row.encounterId)) groups.set(row.encounterId, {family: row.family, rows: []});
      groups.get(row.encounterId).rows.push(row);
    }
    const preceding = recentRows.filter(entry => !groups.has(entry.rows[0].encounterId));
    return [...preceding, ...groups.values()].slice(-recentLayouts).map(entry =>
      signatureFor(entry.family, entry.rows.map(row =>
        seam && row.plannedDistance === seam.distance
          ? {...row, intermediates: seam.row.intermediates} : row)));
  };
  const refreshSignatures = () => {
    recent.splice(0, recent.length, ...recentHistory(plannedPressure));
    for (const entry of pending) {
      const signature = signatureFor(entry.chunk.family, entry.chunk.rows);
      entry.chunk = withChunkAccounting({...entry.chunk, signature,
        id: entry.chunk.id.slice(0, entry.chunk.id.indexOf(':') + 1) + signature});
    }
  };
  const certify = (rows, distance, approachRow = previousRow, states = exits) => {
    const initialDelayPx = planningStart === distance
      ? GAME_BALANCE.routes.spawning.initialRowDelaySeconds * routeSpeedAtDistance(distance, levelId, mode) : 0;
    const approach = approachRow ?? {hazards: [], intermediates: [], safeLanes: [1, 2],
      spacingPx: HAZARD_TRAVEL_PX + HAZARD_ROW_ENVELOPE_PX / 2 +
        Math.max(0, distance - (planningStart ?? distance)) / METERS_PER_PIXEL + initialDelayPx};
    const physicalAt = (row, position) => {
      if (fitsDepot(row, position)) return row;
      const hazards = row.hazards.filter(hazard => hazard.continuation);
      const blocked = hazards.flatMap(hazardBlockedIntervals);
      return {...row, hazards, intermediates: [], cargoLanes: [],
        safeLanes: TRACK_LANES.filter(lane => !blocked.some(([left, right]) =>
          LANE_CENTERS[lane] > left && LANE_CENTERS[lane] < right))};
    };
    let position = distance;
    const physicalRows = rows.map(row => {
      const physical = {...physicalAt(row, position), plannedDistance: position};
      position += row.spacingPx * METERS_PER_PIXEL;
      return physical;
    });
    const approachDistance = approach.plannedDistance ?? distance - approach.spacingPx * METERS_PER_PIXEL;
    const physicalApproach = approachRow
      ? {...physicalAt(approach, approachDistance), plannedDistance: approachDistance}
      : {...approach, plannedDistance: approachDistance};
    // Bound each collision window, not a later speed stage of the whole encounter.
    const actualSpeed = index => {
      if (index === 1 && !approachRow) {
        return routeSpeedAtDistance(distance +
          (HAZARD_TRAVEL_PX + HAZARD_ROW_ENVELOPE_PX / 2) * METERS_PER_PIXEL, levelId, mode);
      }
      const position = index === 1 ? approachDistance
        : physicalRows[index - 2].plannedDistance;
      return routeSpeedAtDistance(position +
        (HAZARD_TRAVEL_PX + HAZARD_ROW_ENVELOPE_PX / 2) * METERS_PER_PIXEL, levelId, mode);
    };
    return references.map((reference, index) => validateTrackSequence([physicalApproach, ...physicalRows],
      actualSpeed, {
        ...reference, initialStates: states[index], reactionSeconds: reference.reactionSeconds ?? reactionSeconds,
        levelId, mode, minimumClearancePx: trackBalance.routeValidation.minimumClearancePx,
      }));
  };
  const certified = results => results.every(result => result.completed &&
    result.clearance >= trackBalance.routeValidation.minimumClearancePx);
  const structureReference = (body, ordinal, distance) => ({
    ...body.hazard, spanPhase: ordinal - body.startOrdinal,
    continuation: ordinal > body.startOrdinal,
    lengthPx: body.tailPx + hazardDefinition(body.hazard.kind).height,
    offsetY: (distance - body.startDistance) / METERS_PER_PIXEL - body.tailPx / 2,
  });
  const compose = (source, distance, family, variant, addSide, sideVariant = 0,
    ordinalStart = rowOrdinal, bodies = structures) => {
    if (family === 'moving_intercept' && addSide) {
      source = recipe(family, variant % TRACK_LANES.length, variant >= TRACK_LANES.length,
        source.at(-1).spacingPx, distance, true);
    }
    const positions = [];
    let cursor = distance;
    for (const row of source) {
      positions.push(cursor);
      cursor += row.spacingPx * METERS_PER_PIXEL;
    }
    let body = null;
    if (addSide && !source.some(row => row.hazards.some(hazard => hazard.pinch))) {
      for (let phase = 0; phase < source.length; phase++) {
        const ordinal = ordinalStart + phase;
        const ongoing = bodies.filter(structure => structure.endOrdinal >= ordinal);
        if (ongoing.some(structure => structure.hazard.kind === 'sideWall') ||
            ongoing.length >= 2) continue;
        const raw = source[phase];
        const opening = raw.cargoLanes[0] ?? raw.safeLanes[0];
        let side = opening === 0 ? 3 : opening === 3 ? 0
          : (variant + sideVariant) % 2 ? 3 : 0;
        const precedingSide = bodies.at(-1)?.hazard.lane ?? lastEmittedSideLane;
        if (precedingSide !== null) side = sideVariant === 0 ? 3 - precedingSide : precedingSide;
        if (family === 'moving_intercept' && phase === 0) {
          const mover = raw.hazards.find(hazard => hazard.movement);
          side = mover.lane === 0 ? 3 : mover.lane === 2 ? 0
            : source[1].safeLanes[0] === 2 ? 0 : 3;
        }
        if (ongoing.length) side = ongoing[0].hazard.lane === 0 ? 3 : 0;
        const kind = !movingEligible && phase === 0 && !ongoing.length &&
          (wallUse[0] + wallUse[1] < 2 || (wallUse[0] + wallUse[1]) * 4 <= structureOrdinal)
          ? 'sideWall' : 'sideRail';
        if (kind === 'sideWall') side = opening < 2 ? 3 : 0;
        const spanRows = kind === 'sideWall' ? GAME_BALANCE.routes.sideObstacles.maximumSpanRows
          : GAME_BALANCE.routes.sideObstacles.minimumSpanRows;
        let tailPx = 0;
        let future = positions[phase];
        for (let occupied = 1; occupied < spanRows; occupied++) {
          const speed = routeSpeedAtDistance(future, levelId, mode);
          const gap = occupied === 1 ? raw.spacingPx
            : rowSpacingAtSpeed(speed, mode, future) + speed * reactionSeconds;
          tailPx += gap;
          future += gap * METERS_PER_PIXEL;
        }
        const proposed = {
          startOrdinal: ordinal, endOrdinal: ordinal + spanRows - 1,
          startDistance: positions[phase], tailPx, references: [],
          hazard: {kind, lane: side, offsetX: 0, placement: 'alpha', sideObstacle: true,
            sideObstacleId: `${seed}:${levelId}:${mode}:${structureOrdinal}`, spanRows},
        };
        const reference = structureReference(proposed, ordinal, positions[phase]);
        if (!fitsDepot({...raw, hazards: [reference], intermediates: []}, positions[phase]) ||
            !fitsDepot(raw, positions[phase])) continue;
        if (!raw.safeLanes.some(lane => !hazardBlockedIntervals(reference)
          .some(([left, right]) => LANE_CENTERS[lane] > left && LANE_CENTERS[lane] < right))) continue;
        const incompatible = source.slice(phase).some((row, index) => {
          const ordinal = ordinalStart + phase + index;
          if (ordinal > proposed.endOrdinal) return false;
          const reference = structureReference(proposed, ordinal, positions[phase + index]);
          const intended = ['split_gate', 'offset_pair', 'narrow_corridor', 'side_squeeze'].includes(family) ||
            (family === 'moving_intercept' && phase + index > 0) ? row.cargoLanes : [];
          return row.hazards.some(hazard => hazard.movement && hazardSweptArtOverlaps(reference, hazard)) ||
            intended.some(lane => hazardBlockedIntervals(reference).some(([left, right]) =>
              LANE_CENTERS[lane] > left && LANE_CENTERS[lane] < right));
        });
        if (incompatible) continue;
        body = proposed;
        break;
      }
    }
    const rows = [];
    for (let phase = 0; phase < source.length; phase++) {
      const raw = source[phase];
      const ordinal = ordinalStart + phase;
      const references = [...bodies, ...(body ? [body] : [])]
        .filter(structure => structure.startOrdinal <= ordinal && structure.endOrdinal >= ordinal)
        .map(structure => structureReference(structure, ordinal, positions[phase]));
      const nativeHazards = [];
      for (const hazard of raw.hazards) {
        const fitted = usesTimedMoverLanes(hazard)
          ? fitForkliftOpening(hazard, [...references, ...raw.hazards.filter(other =>
            other !== hazard && !other.movement)], positions[phase], levelId, mode) : hazard;
        if (!fitted) return null;
        nativeHazards.push(fitted);
      }
      const hazards = [...references];
      const overlaps = (first, second) => hazardSweptArtOverlaps(first, second, 0,
        (first.moverCompanion && (usesPotentialMoverLanes(second) || usesTimedMoverLanes(second))) ||
        (second.moverCompanion && (usesPotentialMoverLanes(first) || usesTimedMoverLanes(first))) ? 0 : 8);
      const intended = ['side_squeeze', 'narrow_corridor'].includes(family) ? [1, 2]
        : ['split_gate', 'offset_pair'].includes(family) ? raw.cargoLanes : [];
      if (intended.some(lane => references.some(hazard => hazardBlockedIntervals(hazard)
        .some(([left, right]) => LANE_CENTERS[lane] > left && LANE_CENTERS[lane] < right)))) return null;
      for (const hazard of nativeHazards) {
        if (!hazards.some(other => overlaps(hazard, other))) {
          hazards.push(hazard.pinch ? {...hazard,
            sideObstacleId: `${seed}:${levelId}:${mode}:pinch:${ordinal}:${hazard.lane}`} : hazard);
          continue;
        }
        if (hazard.movement || hazard.moverCompanion || hazard.pinch) return null;
        // Recompose occupied gate positions into the remaining native lane slots;
        // compatible interior obstacles are never cleared along with an edge.
        const replacements = TRACK_LANES.map(lane => ({...hazard, lane}))
          .filter(candidate => !intended.includes(candidate.lane) &&
            !hazards.some(other => hazardSweptArtOverlaps(candidate, other)) &&
            !raw.hazards.some(other => other !== hazard && other.lane === candidate.lane &&
              !references.some(reference => hazardSweptArtOverlaps(other, reference))));
        if (replacements.length) hazards.push(replacements[variant % replacements.length]);
      }
      if (!hazards.some(hazard => !hazard.continuation)) return null;
      const blocked = hazards.flatMap(routeHazardBlockedIntervals);
      const safeLanes = TRACK_LANES.filter(lane => !blocked.some(([left, right]) =>
        LANE_CENTERS[lane] > left && LANE_CENTERS[lane] < right));
      if (!safeLanes.length) return null;
      const cargoLanes = raw.cargoLanes.filter(lane => safeLanes.includes(lane) &&
        hazards.every(hazard => Math.abs(LANE_CENTERS[lane] - hazardX(hazard)) >=
          hazardGeometry(hazard).hitX + PICKUP_RADIUS_PX));
      rows.push({...raw, hazards, safeLanes, cargoLanes,
        hazardLanes: TRACK_LANES.filter(lane => !safeLanes.includes(lane)), intermediates: []});
    }
    return {rows, body, positions, endDistance: cursor};
  };
  const finishNative = (composed, family, distance, approach, states, context, encounter) => {
    const contacts = movingContactsFor(composed);
    const moverRows = composed.rows.filter(row => row.hazards.some(hazard =>
      hazard.movement && !hazard.continuation));
    if (moverRows.length > 1 && (contacts.length !== moverRows.length ||
        composed.rows.some((row, index) => !fitsDepot(row, composed.positions[index])) ||
        contacts.some((contact, index) =>
          intervalFor(contact, distance, false).depot.distance !==
            intervalFor(contacts[0], distance, false).depot.distance ||
          (index > 0 && contact - contacts[index - 1] < moving.minimumEncounterSpacingMeters)))) return null;
    if (contacts.some(contact => {
      const interval = intervalFor(contact, distance, false);
      return movingContacts(interval).length +
        contacts.filter(at => at >= interval.start && at < interval.depot.distance).length > moving.maximumPerWindow ||
        movingContacts(interval).some(prior => Math.abs(prior - contact) < moving.minimumEncounterSpacingMeters);
    })) return null;
    const results = certify(composed.rows, distance, approach, states);
    if (!certified(results)) return null;
    if (family === 'risk_reward' && !results.every(result =>
      result.exits.some(exit => composed.rows[0].cargoLanes.includes(exit.lane)) &&
      result.exits.some(exit => !composed.rows[0].cargoLanes.includes(exit.lane)))) return null;
    const pressure = projectPressure(composed.rows, composed.positions, null, context, encounter, family);
    return {...composed, results, pressure, requestedIntermediates: 0};
  };
  const movingContactsFor = composed => composed.rows.flatMap((row, index) =>
    fitsDepot(row, composed.positions[index]) ? [...row.hazards, ...row.intermediates]
      .filter(hazard => hazard.movement && !hazard.continuation)
      .map(hazard => contactFor(hazard, composed.positions[index])) : []);
  const preservesMovingReservation = (composed, family, results, pacing) => {
    const bodies = [...structures, ...(composed.body ? [composed.body] : [])];
    if (!movingEligible && !bodies.length) return [];
    const extra = movingContactsFor(composed);
    const firstOrdinal = rowOrdinal + composed.rows.length;
    const lastOccupied = Math.max(firstOrdinal - 1, ...bodies.map(body => body.endOrdinal));
    const limit = firstOrdinal + GAME_BALANCE.routes.sideObstacles.maximumSpanRows + 1;
    const visited = new Set();
    const search = (distance, ordinal, approach, states, lastFamily, history, context,
      requiredDepot = null, scheduled = extra, priorSchedule = null) => {
      const speed = routeSpeedAtDistance(distance, levelId, mode);
      const spacing = rowSpacingAtSpeed(speed, mode, distance) + speed * reactionSeconds;
      const schedule = movingSchedule(distance, spacing, scheduled, lastFamily);
      if (schedule.overCapacity) return null;
      if (schedule.blockedByDepot) return null;
      const quotaRequired = window => movingEligible && window.depot > movingStart &&
        (mode === 'continuous' || window.depot <= route.finishDistanceMeters);
      // Past a scheduling window is not the same as having fulfilled its quota.
      if (quotaRequired(schedule) && schedule.remaining > 0 && schedule.contact > schedule.safeEnd) return null;
      if (priorSchedule && priorSchedule.depot !== schedule.depot && quotaRequired(priorSchedule) &&
          schedule.contact > priorSchedule.safeEnd &&
          movingSchedule(priorSchedule.distance, priorSchedule.spacing, scheduled,
            priorSchedule.lastFamily).remaining > 0) return null;
      const currentSchedule = {...schedule, distance, spacing, lastFamily};
      if (requiredDepot !== null && schedule.depot !== requiredDepot) return null;
      if (schedule.remaining <= 0 && ordinal > lastOccupied) return [];
      if ((!schedule.due || (scheduled.length > extra.length && !schedule.deadline)) &&
          ordinal > lastOccupied && requiredDepot === null) return [];
      if (requiredDepot !== null && schedule.contact > schedule.safeEnd) return null;
      if (ordinal > limit) return null;
      const key = JSON.stringify([distance, ordinal, lastFamily, history, requiredDepot, scheduled, approach.hazards,
        approach.intermediates, context.history?.streaks ?? context.streaks,
        states.map(states => states.map(({lane, x, velocity}) => [lane, x, velocity]))]);
      if (visited.has(key)) return null;
      visited.add(key);
      const step = (future, source, family, lane, mirror, variant, proof, attempts) => ({
        ...future, source, family, lane, mirror, variant, distance, ordinal, entries: states,
        pressureEntries: [...(context.history?.streaks ?? context.streaks)],
        results: proof, signature: signatureFor(family, future.rows),
        candidateAttempts: attempts, movingDeadline: schedule.deadline,
        pacing: family === 'single_pressure' ? 'recovery' : 'pressure', fallback: false,
        requestedIntermediates: 0,
      });
      let attempts = 0;
      if (schedule.due && (lastFamily !== 'moving_intercept' || schedule.deadline)) {
        for (const variant of movingVariants(distance, spacing, context)) {
          attempts++;
          const lane = variant % TRACK_LANES.length;
          const mirror = variant >= TRACK_LANES.length;
          const source = recipe('moving_intercept', lane, mirror, spacing, distance);
          let future = compose(source, distance, 'moving_intercept', variant, false, 0, ordinal, bodies);
          if (!future || !fitsDepot(future.rows[0], distance) ||
              history.includes(signatureFor('moving_intercept', future.rows))) continue;
          future = finishNative(future, 'moving_intercept', distance, approach, states, context,
            `encounter:${ordinal}`);
          if (!future || !future.pressure.acceptable) continue;
          const nextScheduled = [...scheduled, ...movingContactsFor(future)];
          const tail = search(future.endDistance, ordinal + future.rows.length, future.rows.at(-1),
            future.results.map(result => result.exits), 'moving_intercept',
            recentHistory(future.pressure), future.pressure, null, nextScheduled, currentSchedule);
          if (tail !== null) return [
            step(future, source, 'moving_intercept', lane, mirror, variant, future.results, attempts), ...tail];
        }
      }
      if (ordinal >= limit) return null;
      const streaks = context.history?.streaks ?? context.streaks;
      const singles = [...TRACK_LANES].sort((a, b) => streaks[b] - streaks[a])
        .map(lane => ['single_pressure', lane, false]);
      const gates = [...TRACK_LANES].sort((a, b) => streaks[a] - streaks[b])
        .map(lane => ['split_gate', lane, false]);
      // Normal pacing permits gates too; only recovery should prefer every single first.
      const bridgeVariants = streaks.filter(streak => streak >= clearLimit).length > 1
        ? [...gates, ...singles] : pacing !== 'recovery'
          ? gates.flatMap((gate, index) => [gate, singles[index]]) : [...singles, ...gates];
      for (const [family, lane, mirror] of bridgeVariants) {
        if (family === lastFamily) continue;
        if (attempts >= candidateBudget) break;
        attempts++;
        const variant = lane + (mirror ? TRACK_LANES.length : 0);
        const source = recipe(family, lane, mirror, spacing);
        let bridge = compose(source, distance, family, variant, false, 0, ordinal, bodies);
        if (!bridge || history.includes(signatureFor(family, bridge.rows))) continue;
        bridge = finishNative(bridge, family, distance, approach, states, context, `encounter:${ordinal}`);
        if (!bridge || !bridge.pressure.acceptable) continue;
        const proof = bridge.results;
        const nextHistory = recentHistory(bridge.pressure);
        const tail = search(bridge.endDistance, ordinal + bridge.rows.length, bridge.rows.at(-1),
          proof.map(result => result.exits), family, nextHistory, bridge.pressure,
          requiredDepot ?? (schedule.due ? schedule.depot : null), scheduled, currentSchedule);
        if (tail !== null) return [step(bridge, source, family, lane, mirror, variant, proof, attempts), ...tail];
      }
      return null;
    };
    return search(composed.endDistance, firstOrdinal, composed.rows.at(-1),
      results.map(result => result.exits), family,
      [...recent, signatureFor(family, composed.rows)].slice(-recentLayouts), composed.pressure);
  };
  const replayWitness = (candidate, future, family, distance) => {
    const approach = candidate.seam?.row ?? previousRow;
    const results = certify(candidate.rows, distance, approach, exits);
    if (!certified(results)) return null;
    if (family === 'risk_reward' && !results.every(result =>
      result.exits.some(exit => candidate.rows[0].cargoLanes.includes(exit.lane)) &&
      result.exits.some(exit => !candidate.rows[0].cargoLanes.includes(exit.lane)))) return null;
    let context = projectPressure(candidate.rows, candidate.positions, candidate.seam,
      plannedPressure, `encounter:${rowOrdinal}`, family);
    if (!context.acceptable) return null;
    const pressure = context;
    let states = results.map(result => result.exits);
    let prior = candidate.rows.at(-1);
    const witness = [];
    for (const step of future) {
      if (!step.fallback && recentHistory(context, step.seam)
        .includes(signatureFor(step.family, step.rows))) return null;
      const proof = certify(step.rows, step.distance, step.seam?.row ?? prior, states);
      if (!certified(proof)) return null;
      const pressureEntries = [...context.history.streaks];
      context = projectPressure(step.rows, step.positions, step.seam, context,
        `encounter:${step.ordinal}`, step.family);
      if (!context.acceptable) return null;
      witness.push({...step, entries: states, results: proof, pressureEntries, pressure: context,
        signature: signatureFor(step.family, step.rows)});
      states = proof.map(result => result.exits);
      prior = step.rows.at(-1);
    }
    return {results, pressure, witness};
  };
  const resolveNativeBody = (candidate, family, distance) => {
    if (!candidate.body) return candidate;
    const resolved = structuredClone(candidate);
    const steps = [{...resolved, ordinal: rowOrdinal}, ...resolved.witness];
    const points = steps.flatMap(step => step.positions.map((position, phase) =>
      ({ordinal: step.ordinal + phase, distance: position})));
    const tail = points.find(point => point.ordinal === resolved.body.endOrdinal);
    if (!tail) throw new Error(`Certified structure witness has no tail for seed ${seed}, ${distance} m`);
    resolved.body.tailPx = (tail.distance - resolved.body.startDistance) / METERS_PER_PIXEL;
    for (const step of steps) for (const [phase, row] of step.rows.entries()) {
      row.hazards = row.hazards.map(hazard =>
        hazard.sideObstacleId === resolved.body.hazard.sideObstacleId
          ? structureReference(resolved.body, step.ordinal + phase, step.positions[phase]) : hazard);
    }
    const proof = replayWitness(resolved, resolved.witness, family, distance);
    return proof ? {...resolved, results: proof.results, pressure: proof.pressure, witness: proof.witness} : null;
  };
  const augmentCandidate = (native, family, distance, future, pacing) => {
    const candidate = structuredClone(native);
    const fixedFuture = structuredClone(future);
    const arrivalSpeed = routeSpeedAtDistance(candidate.endDistance +
      HAZARD_TRAVEL_PX * METERS_PER_PIXEL, levelId, mode);
    let acceptedProof = {results: native.results, pressure: native.pressure, witness: fixedFuture};
    const rows = candidate.rows;
    const allowFillers = pacing !== 'recovery' && sectorAtDistance(distance, levelId, mode).number > 1;
    const cleanPinch = ['side_squeeze', 'narrow_corridor', 'static_chicane'].includes(family);
    candidate.requestedIntermediates = cleanPinch ? 0 : composeTrackIntermediates(rows, distance, random, levelId, mode,
      routeSpeedAtDistance(distance, levelId, mode), arrivalSpeed, (index, proposed) => {
        if (fitsDepot(rows[index], candidate.positions[index]) &&
            !fitsDepot(proposed, candidate.positions[index])) return false;
        const proposedRows = rows.map((row, phase) => phase === index ? proposed : row);
        if (!candidate.fallback && recentHistory(plannedPressure)
          .includes(signatureFor(family, proposedRows))) return false;
        const proof = replayWitness({...candidate, rows: proposedRows}, fixedFuture, family, distance);
        if (!proof) return false;
        acceptedProof = proof;
        return true;
      }, allowFillers);
    const previousPending = pending.at(-1);
    if (previousPending && previousPending.chunk.rows.at(-1) === previousRow &&
        fitsDepot(previousRow, previousPending.lastDistance)) {
      rows[0] = {...rows[0], cargoLanes: rows[0].cargoLanes.filter(lane =>
        acceptedProof.results.every(result => result.exits.some(exit => exit.lanes[1] === lane)))};
      const seamRows = [{...previousRow, intermediates: [...previousRow.intermediates]}, rows[0]];
      if (!cleanPinch && !['side_squeeze', 'narrow_corridor', 'static_chicane'].includes(previousPending.chunk.family)) {
      composeTrackIntermediates(seamRows, previousPending.lastDistance, random, levelId, mode,
        routeSpeedAtDistance(previousPending.lastDistance, levelId, mode), arrivalSpeed, (_, proposed) => {
          if (!fitsDepot(proposed, previousPending.lastDistance)) return false;
          const previousIndex = recentRows.findIndex(entry => entry.rows.includes(previousRow));
          if (previousIndex >= 0) {
            const entry = recentRows[previousIndex];
            const changed = signatureFor(entry.family, entry.rows.map(row =>
              row === previousRow ? {...row, intermediates: proposed.intermediates} : row));
            if (recentRows.slice(Math.max(0, previousIndex - recentLayouts), previousIndex)
              .some(prior => signatureFor(prior.family, prior.rows) === changed)) return false;
          }
          const seam = {row: proposed, distance: previousPending.lastDistance,
            added: proposed.intermediates.length - previousRow.intermediates.length};
          const proof = replayWitness({...candidate, seam}, fixedFuture, family, distance);
          if (!proof) return false;
          if (!candidate.fallback && recentHistory(plannedPressure, seam)
            .includes(signatureFor(family, rows))) return false;
          acceptedProof = proof;
          return true;
        }, allowFillers && previousPending.chunk.pacing !== 'recovery' &&
          sectorAtDistance(previousPending.lastDistance, levelId, mode).number > 1);
      }
      if (seamRows[0].intermediates.length > previousRow.intermediates.length) candidate.seam = {
        row: seamRows[0], distance: previousPending.lastDistance,
        added: seamRows[0].intermediates.length - previousRow.intermediates.length,
      };
    }
    candidate.results = acceptedProof.results;
    candidate.pressure = acceptedProof.pressure;
    candidate.witness = acceptedProof.witness;
    if (!candidate.pressure.acceptable ||
        candidate.witness.some(step => !step.pressure.acceptable)) return null;
    candidate.counts = countsFor(rows.map((row, index) =>
      ({row, distance: candidate.positions[index]})));
    candidate.counts.obstacles += candidate.seam?.added ?? 0;
    return candidate;
  };
  const physicalChoice = candidate => {
    const steps = [candidate, ...(candidate.witness ?? [])];
    const physical = steps.flatMap(step => step.rows.map((row, index) => ({...row,
      plannedDistance: step.positions[index], emitted: fitsDepot(row, step.positions[index])})));
    const coverage = chunkCollisionCoverage(physical,
      {levelId, mode, witnessStartRow: candidate.rows.length});
    const scoringSpan = coverage.structuralSpanRows || 1;
    const baseWeight = (1 + 0.4 * scoringSpan) * coverage.occupiedSeconds;
    const witnessBonus = coverage.committedWitnessRows > 0
      ? 1 + densityRecovery.occupancyWeight * coverage.structuralOccupiedSeconds / coverage.routeSeconds : 1;
    const physicalScore = baseWeight * (1 + densityRecovery.occupancyWeight *
      coverage.occupiedSeconds * scoringSpan) * witnessBonus / coverage.routeMeters;
    return {candidate, coverage, physicalScore, weight: physicalScore};
  };
  const hasMover = row => [...row.hazards, ...(row.intermediates ?? [])]
    .some(hazard => hazard.movement || hazard.motionBounds);
  // Null when the encounter is exempt: recovery pacing, movers (timed separately), a fresh
  // start/Depot exit, or a facility-protected window with nothing emitted.
  const steeringDemandPx = (candidate, family, pacing) => {
    if (pacing === 'recovery' || family === 'moving_intercept' || candidate.movingObligation ||
        !previousRow || !fitsDepot(previousRow, previousRow.plannedDistance)) return null;
    const approach = candidate.seam?.row ?? previousRow;
    const rows = candidate.rows.filter((row, phase) => fitsDepot(row, candidate.positions[phase]));
    if (!rows.some(row => row.hazards.length) || [approach, ...rows].some(hasMover)) return null;
    return lateralDemandPx(approach, rows);
  };
  const wantsDash = (distance, pacing) => {
    if (pacing === 'recovery') return false;
    const sector = sectorAtDistance(distance, levelId, mode).number;
    const shares = steeringBalance.sectorDashShare;
    const counts = steering.sector === sector ? steering : {encounters: 0, dashes: 0};
    return counts.dashes < shares[Math.min(sector, shares.length) - 1] * (counts.encounters + 1);
  };
  const isDash = (candidate, family, pacing) =>
    (steeringDemandPx(candidate, family, pacing) ?? 0) >= steeringBalance.dashPx;
  const capturePlanningState = () => ({
    previousRow, exits, previousFamily, recent, recentRows, familyUse, pending, obligations,
    reservations, structures, movingIntervals, plannedPressure, wallUse, planningDistance,
    rowOrdinal, structureOrdinal, steering,
  });
  const installPlanningState = state => {
    ({previousRow, exits, previousFamily, recent, recentRows, familyUse, pending, obligations,
      reservations, structures, movingIntervals, plannedPressure, wallUse, planningDistance,
      rowOrdinal, structureOrdinal, steering} = state);
  };
  const successorPool = (choice, commitment) => {
    const state = capturePlanningState();
    const liveRandom = random, liveTrace = trace;
    try {
      // Clone together so structure references still point to the cloned pending rows.
      installPlanningState(structuredClone(state));
      random = liveRandom.fork();
      // The eventual weighted draw consumes one roll; probes never consume the live stream.
      random();
      trace = null;
      planChunk(commitment.distance, {commitment: {...commitment, candidate: structuredClone(choice.candidate)}});
      while (obligations.length) planChunk(planningDistance);
      if (planningDistance >= route.finishDistanceMeters) return {choices: [], proposalBudget: 0, terminal: true};
      return planChunk(planningDistance, {probe: true});
    } finally {
      installPlanningState(state);
      random = liveRandom;
      trace = liveTrace;
    }
  };
  const planChunk = (distance, {probe = false, commitment = null} = {}) => {
      refreshSignatures();
      const sector = sectorAtDistance(distance, levelId, mode);
      const speed = routeSpeedAtDistance(distance, levelId, mode);
      const spacing = rowSpacingAtSpeed(speed, mode, distance) + speed * reactionSeconds;
      let candidate;
      let certificates;
      let attempts = 0;
      let proposalBudget = candidateBudget;
      let density;
      let committedDensity;
      let pacing;
      let movingDeadline = false;
      if (commitment) {
        candidate = commitment.candidate;
        certificates = candidate.results;
        pacing = commitment.pacing;
        proposalBudget = commitment.proposalBudget;
        attempts = commitment.attempts;
      } else if (obligations.length) {
        const obligation = obligations[0];
        const states = entries => entries.map(entries =>
          entries.map(({lane, x, velocity}) => [lane, x, velocity]));
        if (obligation.distance !== distance || obligation.ordinal !== rowOrdinal ||
            JSON.stringify(states(obligation.entries)) !== JSON.stringify(states(exits))) {
          throw new Error(`Moving witness lost its certified entry for seed ${seed}, ${distance} m`);
        }
        if (JSON.stringify(obligation.pressureEntries) !==
            JSON.stringify(plannedPressure.history?.streaks ?? plannedPressure.streaks)) {
          throw new Error(`Committed witness lost its pressure history for seed ${seed}, ${distance} m`);
        }
        candidate = {...obligation, movingObligation: true, witness: []};
        certificates = obligation.results;
        attempts = obligation.candidateAttempts - 1;
        pacing = obligation.pacing;
        movingDeadline = obligation.movingDeadline;
        obligations.shift();
      } else {
      const hard = random() < hardChunkChance(distance, levelId, mode);
      const sustained = hard && random() < route.sustainedChance[difficultyStepAtDistance(distance, levelId, mode)];
      pacing = !hard ? 'recovery' : sustained ? 'pressure' : 'normal';
      let available = trackBalance.encounters.pacingFamilies[pacing].filter(family => family !== previousFamily);
      const schedule = movingSchedule(distance, spacing);
      movingDeadline = schedule.deadline;
      if (movingEligible) {
        const {due, remaining, contact, safeEnd, rowMeters} = schedule;
        if (due && (previousFamily !== 'moving_intercept' || movingDeadline)) {
          available = ['moving_intercept'];
        } else if (due && contact + (2 + (remaining - 1) * 3) * rowMeters > safeEnd) {
          available = families.filter(family =>
            family !== previousFamily && !['offset_pair', 'narrow_corridor'].includes(family));
        }
      }
      const familyAttempts = new Map(available.map(family => [family, 0]));
      const variantOrders = new Map();
      const before = reservedCounts();
      const coverageSelection = mode === 'normal' && sector.number >= 3 && pacing !== 'recovery' && !schedule.due;
      if (coverageSelection) {
        density = densitySnapshot();
        committedDensity = committedDensitySnapshot(distance);
        if (distance < route.finishDistanceMeters &&
            (density.emptySeconds > density.through * densityRecovery.maximumEmptySecondsPerMeter ||
              density.lateEmptySeconds > Math.max(0, density.through - lateStart) *
                densityRecovery.maximumLateEmptySecondsPerMeter)) proposalBudget = densityRecovery.candidateBudget;
      }
      const coverageCandidates = [];
      // Mover windows supply their own steering, so the dash preference stands aside while one is due.
      const steeringNeed = Boolean(previousRow) && !schedule.due && wantsDash(distance, pacing);
      const approachOpen = Boolean(pending.at(-1)) && fitsDepot(previousRow, pending.at(-1).lastDistance);
      const traceProposal = trace ? (family, stage, composed) => {
        const steps = [composed, ...(composed.witness ?? [])];
        const physical = steps.flatMap(step => step.rows.map((row, index) => ({...row,
          plannedDistance: step.positions[index], emitted: fitsDepot(row, step.positions[index])})));
        trace({type: stage, distance, family, coverage: chunkCollisionCoverage(physical,
          {levelId, mode, witnessStartRow: composed.rows.length})});
      } : null;
      const proposal = (family, lane, mirror, variant, allowSide,
        source = recipe(family, lane, mirror, spacing)) => {
        progress();
        for (let sideVariant = 0; sideVariant < (allowSide ? 2 : 1); sideVariant++) {
          const next = compose(source, distance, family, variant, allowSide, sideVariant);
          if (!next) {
            trace?.({type: 'rejected', stage: 'compose', distance, family});
            continue;
          }
          let composed = finishNative(next, family, distance, previousRow, exits,
            plannedPressure, `encounter:${rowOrdinal}`);
          if (!composed) {
            traceProposal?.(family, 'rejectedPhysical', next);
            continue;
          }
          composed.witness = preservesMovingReservation(composed, family, composed.results, pacing);
          if (composed.witness === null) {
            traceProposal?.(family, 'rejectedWitness', {...composed, witness: []});
            continue;
          }
          composed = resolveNativeBody(composed, family, distance);
          if (!composed) {
            trace?.({type: 'rejected', stage: 'resolvedBody', distance, family});
            continue;
          }
          const augmented = augmentCandidate(composed, family, distance, composed.witness, pacing);
          if (!augmented) traceProposal?.(family, 'rejectedPressure', composed);
          return augmented;
        }
        return null;
      };
      for (; attempts < proposalBudget; attempts++) {
        const fewestAttempts = Math.min(...familyAttempts.values());
        const untried = available.filter(family => familyAttempts.get(family) === fewestAttempts);
        const leastUsed = Math.min(...untried.map(family => familyUse.get(family)));
        const preferred = untried.filter(family => familyUse.get(family) === leastUsed);
        const family = preferred[Math.floor(random() * preferred.length)];
        const familyAttempt = familyAttempts.get(family);
        familyAttempts.set(family, familyAttempt + 1);
        if (!variantOrders.has(family)) {
          const offset = family === 'moving_intercept' ? null
            : Math.floor(random() * TRACK_LANES.length * 2);
          variantOrders.set(family, family === 'moving_intercept'
            ? movingVariants(distance, spacing, plannedPressure)
            : Array.from({length: TRACK_LANES.length * 2}, (_, index) =>
              (offset + index) % (TRACK_LANES.length * 2)));
        }
        const order = variantOrders.get(family);
        const variant = order[familyAttempt % order.length];
        const lane = variant % TRACK_LANES.length;
        let mirror = variant >= TRACK_LANES.length;
        if (!movingEligible && family === 'narrow_corridor' && wallUse[0] !== wallUse[1] &&
            structures.every(body => body.endOrdinal < rowOrdinal + 1)) {
          mirror = wallUse[0] > wallUse[1];
        }
        const anticipated = recipe(family, lane, mirror, spacing);
        // Recipe rows only estimate the composed demand; once a backup exists, skip proving
        // layouts whose authored hazards cannot plausibly force a steering dash.
        if (steeringNeed && !coverageSelection && !approachOpen && candidate && !candidate.lateralDash &&
            family !== 'moving_intercept' && ![previousRow, ...anticipated].some(hasMover) &&
            lateralDemandPx(previousRow, anticipated) < steeringBalance.dashPx) continue;
        const wantSide = before.sideObstacles <
          GAME_BALANCE.routes.sideObstacles.targetShare *
          (before.obstacles + countChunkHazards({rows: anticipated}));
        let composed = proposal(family, lane, mirror, variant, wantSide, anticipated);
        if (!composed && wantSide) composed = proposal(family, lane, mirror, variant, false, anticipated);
        if (!composed) continue;
        if (composed.counts.sideObstacles) {
          const quota = sideHazardQuota(before.obstacles + composed.counts.obstacles,
            before.sideObstacles + composed.counts.sideObstacles);
          const without = composed.counts.sideObstacles ? sideHazardQuota(
            before.obstacles + composed.counts.obstacles - 1,
            before.sideObstacles + composed.counts.sideObstacles - 1) : quota;
          if (before.sideObstacles >= quota.targetShare * (before.obstacles + composed.counts.obstacles) ||
              !composed.counts.sideObstacles ||
              (quota.share > quota.maximumShare && Math.abs(quota.share - quota.targetShare) >=
                Math.abs(without.share - quota.targetShare))) {
            traceProposal?.(family, 'rejectedQuota', composed);
            if (['side_squeeze', 'narrow_corridor', 'static_chicane'].includes(family)) continue;
            composed = proposal(family, lane, mirror, variant, false, anticipated);
            if (!composed) continue;
          }
        }
        if (opensStraightRun([composed, ...(composed.witness ?? [])])) {
          traceProposal?.(family, 'rejectedStraightRun', composed);
          continue;
        }
        const {rows} = composed;
        const signature = signatureFor(family, rows);
        if (recent.includes(signature)) {
          traceProposal?.(family, 'rejectedRecent', composed);
          continue;
        }
        if (coverageSelection) {
          const choice = physicalChoice({family, signature, ...composed, fallback: false});
          choice.lateralDash = steeringNeed && isDash(composed, family, pacing);
          coverageCandidates.push(choice);
          continue;
        }
        const lateralDash = steeringNeed && isDash(composed, family, pacing);
        if (!candidate || composed.seam || (lateralDash && !candidate.lateralDash && !candidate.seam)) {
          candidate = {family, signature, ...composed, fallback: false, lateralDash};
          certificates = composed.results;
        }
        const previousPending = pending.at(-1);
        const protectedApproach = previousPending &&
          fitsDepot(previousRow, previousPending.lastDistance) && !fitsDepot(rows[0], distance);
        // Spend the existing retry budget on a useful, safe outgoing slot before
        // accepting a whole protected approach with that last gap uncomposed.
        if ((!protectedApproach || composed.seam) && (!steeringNeed || candidate.lateralDash)) break;
      }
      if (coverageCandidates.length) {
        const previousPending = pending.at(-1);
        const protectedApproach = previousPending && fitsDepot(previousRow, previousPending.lastDistance);
        const useful = coverageCandidates.filter(({candidate}) => !protectedApproach ||
          fitsDepot(candidate.rows[0], distance) || candidate.seam);
        let choices = useful.length ? useful : coverageCandidates;
        let steeringExcluded = [];
        if (steeringNeed) {
          const dashes = choices.filter(choice => choice.lateralDash);
          if (dashes.length) {
            steeringExcluded = choices.filter(choice => !choice.lateralDash);
            choices = dashes;
          }
        }
        if (probe) return {choices, proposalBudget, terminal: false};
        for (const choice of choices) {
          const successors = successorPool(choice, {distance, pacing, proposalBudget, attempts});
          choice.successorScore = Math.max(0, ...successors.choices.map(successor => successor.physicalScore));
          choice.successorBudget = successors.proposalBudget;
          choice.successors = successors.choices.map(successor => ({
            family: successor.candidate.family, coverage: successor.coverage, physicalScore: successor.physicalScore,
            certificates: successor.candidate.results.map((result, index) => ({
              hz: references[index].hz, completed: result.completed, clearance: result.clearance,
            })),
            pressureAcceptable: successor.candidate.pressure.acceptable,
          }));
          choice.weight = choice.physicalScore + choice.successorScore;
        }
        const maximumWeight = Math.max(...choices.map(choice => choice.weight));
        const selectable = proposalBudget > candidateBudget && maximumWeight > 0
          ? choices.filter(choice => choice.weight === maximumWeight) : choices;
        const totalWeight = selectable.reduce((sum, choice) => sum + choice.weight, 0);
        // Entirely protected facility windows retain a deterministic uniform choice.
        let roll = random() * (totalWeight || selectable.length);
        const chosen = selectable.find(choice => (roll -= totalWeight ? choice.weight : 1) < 0) ?? selectable.at(-1);
        if (trace) trace({type: 'certifiedPool', distance, proposalBudget, density, committedDensity,
          choices: choices.map(choice => ({family: choice.candidate.family, weight: choice.weight,
            physicalScore: choice.physicalScore, successorScore: choice.successorScore,
            successorBudget: choice.successorBudget, successors: choice.successors,
            coverage: choice.coverage, selectable: selectable.includes(choice), selected: choice === chosen})),
          steeringExcluded: steeringExcluded.map(choice => ({family: choice.candidate.family,
            physicalScore: choice.physicalScore, coverage: choice.coverage}))});
        candidate = chosen.candidate;
        certificates = candidate.results;
      }
      if (!candidate) {
        const streaks = plannedPressure.history?.streaks ?? plannedPressure.streaks;
        const urgent = TRACK_LANES.filter(lane => streaks[lane] >= clearLimit);
        // Dense gates first: lanes still inside their minimum clear run are the preferred openings.
        const openings = TRACK_LANES.filter(lane => !urgent.includes(lane)).sort((a, b) =>
          Number(streaks[b] === 1) - Number(streaks[a] === 1) || streaks[a] - streaks[b]);
        const fallback = [...openings.map(lane => ['split_gate', lane]),
          ...(urgent.length === 1 ? [['single_pressure', urgent[0]]]
            : urgent.length ? [] : [0, 3, 1, 2].map(lane => ['single_pressure', lane]))];
        let straightFallback = null;
        for (const relax of [false, true]) {
          relaxMinimumClear = relax;
          try {
            for (const [family, lane] of fallback) {
              const composed = proposal(family, lane, false, lane, false,
                recipe(family, lane, false, spacing));
              if (!composed) continue;
              // Prefer a certified fallback that also closes straight runs; never drop the connected route.
              if (opensStraightRun([composed, ...(composed.witness ?? [])])) {
                straightFallback ??= {family, composed};
                continue;
              }
              candidate = {family, signature: signatureFor(family, composed.rows), ...composed, fallback: true};
              certificates = composed.results;
              break;
            }
          } finally {
            relaxMinimumClear = false;
          }
          if (candidate || straightFallback) break;
        }
        if (!candidate && straightFallback) {
          const {family, composed} = straightFallback;
          candidate = {family, signature: signatureFor(family, composed.rows), ...composed, fallback: true};
          certificates = composed.results;
        }
      }
        if (probe) return {choices: candidate ? [physicalChoice(candidate)] : [], proposalBudget, terminal: false};
      }
      if (!candidate) {
        const error = new Error(`No connected fallback for seed ${seed}, ${levelId}, ${distance} m`);
        error.pressure = {distance, rowOrdinal, previousFamily,
          streaks: plannedPressure.history?.streaks ?? plannedPressure.streaks,
          entries: exits.map(states => states.map(({lane, x, velocity}) => ({lane, x, velocity})))};
        throw error;
      }
      if (trace) {
        const steps = [candidate, ...(candidate.witness ?? [])];
        const physical = steps.flatMap(step => step.rows.map((row, index) => ({...row,
          plannedDistance: step.positions[index], emitted: fitsDepot(row, step.positions[index])})));
        trace({type: 'committed', distance, family: candidate.family,
          obligation: Boolean(candidate.movingObligation), coverage: chunkCollisionCoverage(physical,
            {levelId, mode, witnessStartRow: candidate.rows.length})});
      }
      if (candidate.seam) {
        // These slots lie beyond the settled previous gate; certify their outgoing
        // transition before publishing that row, without changing its entry proof.
        previousRow.intermediates = candidate.seam.row.intermediates;
        const previousPending = pending.at(-1);
        previousPending.chunk = withChunkAccounting(previousPending.chunk);
        const reservation = reservations.get(previousRow.hazards);
        if (reservation) reservation.counts.obstacles += candidate.seam.added;
      }
      const entries = exits;
      exits = certificates.map(result => result.exits);
      candidate.rows = candidate.rows.map((row, phase) => {
        const safePickupLanes = row.safeLanes.filter(lane => certificates.every(result =>
          result.exits.some(exit => exit.lanes[phase + 1] === lane)));
        const planned = {...row, plannedDistance: candidate.positions[phase], safePickupLanes,
          encounterId: `encounter:${rowOrdinal}`, family: candidate.family,
          cargoLanes: row.cargoLanes.filter(lane => safePickupLanes.includes(lane))};
        Object.defineProperty(planned, 'plannedDistance', {writable: false, configurable: false});
        return planned;
      });
      if (candidate.body) {
        structures.push(candidate.body);
        if (candidate.body.hazard.kind === 'sideWall') {
          wallUse[candidate.body.hazard.lane === 0 ? 0 : 1]++;
        }
        structureOrdinal++;
      }
      for (const [phase, row] of candidate.rows.entries()) {
        const distance = candidate.positions[phase];
        for (const body of structures) {
          const hazard = row.hazards.find(hazard => hazard.sideObstacleId === body.hazard.sideObstacleId);
          if (hazard) body.references.push({hazard, distance});
          if (body.references.length === body.hazard.spanRows) {
            body.tailPx = (body.references.at(-1).distance - body.startDistance) / METERS_PER_PIXEL;
            for (const reference of body.references) {
              reference.hazard.lengthPx = body.tailPx + hazardDefinition(body.hazard.kind).height;
              reference.hazard.offsetY = (reference.distance - body.startDistance) / METERS_PER_PIXEL -
                body.tailPx / 2;
            }
          }
        }
        const emitted = fitsDepot(row, distance);
        const physical = emitted
          ? [...row.hazards, ...row.intermediates].filter(hazard => !hazard.continuation) : [];
        reservations.set(row.hazards, {
          counts: {obstacles: physical.length, sideObstacles: physical.filter(hazard => hazard.sideObstacle).length},
          movingContacts: physical.filter(hazard => hazard.movement).map(hazard => contactFor(hazard, distance)),
          sideContacts: physical.filter(hazard => hazard.sideObstacle).map(hazard => contactFor(hazard, distance)),
          published: false,
        });
      }
      const steeringDemand = steeringDemandPx(candidate, candidate.family, pacing);
      if (steeringDemand !== null) {
        const counts = steering.sector === sector.number ? steering : {encounters: 0, dashes: 0};
        steering = {sector: sector.number, encounters: counts.encounters + 1,
          dashes: counts.dashes + (steeringDemand >= steeringBalance.dashPx ? 1 : 0)};
      }
      previousRow = candidate.rows.at(-1);
      previousFamily = candidate.family;
      familyUse.set(candidate.family, familyUse.get(candidate.family) + 1);
      plannedPressure = compactPressure(projectPressure(candidate.rows, candidate.positions, candidate.seam,
        {...plannedPressure, waivedShort: [...new Set([...(plannedPressure.waivedShort ?? []),
          ...(candidate.pressure?.waivedShort ?? []),
          ...(candidate.witness?.at(-1)?.pressure?.waivedShort ?? [])])]},
        `encounter:${rowOrdinal}`, candidate.family));
      candidate.signature = signatureFor(candidate.family, candidate.rows);
      recentRows.push({family: candidate.family, rows: candidate.rows});
      if (recentRows.length > recentLayouts + 1) recentRows.shift();
      refreshSignatures();
      const requiredOrdinal = Math.max(rowOrdinal + candidate.rows.length - 1,
        candidate.body?.endOrdinal ?? rowOrdinal);
      rowOrdinal += candidate.rows.length;
      planningDistance = candidate.endDistance;
      // Only a selected, fully certified candidate may bind subsequent choices.
      // The exact seeded sources and proof results are reused without new modifiers.
      obligations.push(...(candidate.witness ?? []));
      for (let index = structures.length - 1; index >= 0; index--) {
        if (structures[index].endOrdinal < rowOrdinal) structures.splice(index, 1);
      }
      const {body, positions, endDistance, counts, results, seam, witness, source, pressure, pressureEntries,
        entries: witnessEntries, distance: witnessDistance, ordinal, lane, mirror, variant, lateralDash,
        ...layout} = candidate;
      const chunk = withChunkAccounting({...layout, id: `${sector.challengeProfileId}:${candidate.signature}`,
        sideQuotaBefore: {...account}, steeringDemandPx: steeringDemand,
        tier: candidate.family === 'single_pressure' ? 1 : 2,
        entrySafeLanes: candidate.rows[0].safeLanes, exitSafeLanes: previousRow.safeLanes,
        candidateAttempts: Math.min(attempts + 1, proposalBudget),
        candidateBudget: proposalBudget, selectionPacing: pacing, density, committedDensity,
        pacing: candidate.fallback ? 'recovery' : pacing, movingDeadline, movingQuotaConflict,
        certificates: certificates.map((result, index) =>
          ({reference: references[index].id, hz: references[index].hz, entries: entries[index], ...result}))});
      pending.push({chunk, requiredOrdinal, lastDistance: positions.at(-1)});
  };
  return {
    nextChunk(distance = 0) {
      for (const [key, reservation] of reservations) {
        if (reservation.published) reservations.delete(key);
      }
      if (planningDistance === null) {
        planningDistance = distance;
        if (planningStart === null) planningStart = distance;
      }
      if (!pending.length) planChunk(planningDistance);
      // Only the advertised head's three/four occupied rows are needed, not a route.
      while (rowOrdinal <= pending[0].requiredOrdinal || pending.length < 2) planChunk(planningDistance);
      const {chunk} = pending.shift();
      for (const row of chunk.rows) {
        const reservation = reservations.get(row.hazards);
        if (reservation) reservation.published = true;
      }
      return {...chunk, sideQuotaBefore: {...account}, movingQuotaConflict};
    },
    resetAfterDepot(distance) {
      if (!Number.isFinite(distance) || distance < 0) throw new Error('Invalid moving-hazard interval start');
      advanceCoverage(distance);
      coverageBodies.clear();
      previousRow = null;
      previousFamily = null;
      exits = initialExits();
      pending.length = 0;
      obligations.length = 0;
      reservations.clear();
      structures.length = 0;
      for (const interval of movingIntervals.values()) {
        interval.encounters = interval.encounters.filter(contact => contact <= distance);
      }
      emittedPressure = {rows: [], bodies: [], streaks: reachedPressure(emittedPressure, distance).streaks};
      plannedPressure = emittedPressure;
      const reached = new Set(projectPhysicalEvents(emittedRecentRows.flatMap(entry => entry.rows),
        {levelId, mode}).events.filter(event => event.distance <= distance).map(event => event.encounter));
      recentRows.splice(0, recentRows.length, ...emittedRecentRows
        .filter(entry => reached.has(entry.rows[0].encounterId)).slice(-recentLayouts));
      refreshSignatures();
      planningDistance = null;
      planningStart = distance;
      if (movingEligible && !reportedInterval) reportedInterval = intervalFor(distance, distance);
    },
    recordSpawn(row, emitted, distance) {
      if (recordedRows.has(row)) throw new Error('Physical row already recorded');
      recordedRows.add(row);
      distance = row.plannedDistance ?? distance;
      if (mode === 'normal') {
        for (const body of projectPhysicalEvents([{...row, emitted}], {levelId, mode}).bodies) {
          coverageBodies.set(body.id, body);
        }
        advanceCoverage(distance);
      }
      reservations.delete(row.hazards);
      const hazards = emitted ? [...row.hazards, ...(row.intermediates ?? [])].filter(h => !h.continuation) : [];
      account.obstacles += hazards.length;
      account.sideObstacles += hazards.filter(h => h.sideObstacle).length;
      const side = hazards.findLast(hazard => hazard.sideObstacle);
      if (side) lastEmittedSideLane = side.lane;
      emittedPressure = compactPressure(projectPressure([{...row, emitted}], [distance], null, emittedPressure,
        row.encounterId ?? `row:${distance}`, row.family));
      const prior = emittedRecentRows.at(-1);
      if (prior && prior.rows[0].encounterId === row.encounterId) prior.rows.push(row);
      else emittedRecentRows.push({family: row.family, rows: [row]});
      if (emittedRecentRows.length > recentLayouts + GAME_BALANCE.routes.sideObstacles.maximumSpanRows) {
        emittedRecentRows.shift();
      }
      if (movingEligible) {
        const contact = distance + (HAZARD_TRAVEL_PX - HAZARD_ROW_ENVELOPE_PX / 2) * METERS_PER_PIXEL;
        if (!reportedInterval) reportedInterval = intervalFor(contact, planningStart ?? distance);
        while (contact >= reportedInterval.depot.distance) {
          movingQuotaConflict = reportedInterval.depot.distance > movingStart &&
            !movingHazardQuota(reportedInterval.encounters.length).acceptable
            ? {start: reportedInterval.start, depot: reportedInterval.depot.distance,
              encounters: reportedInterval.encounters.length,
              required: moving.minimumPerWindow, maximum: moving.maximumPerWindow}
            : null;
          if (movingQuotaConflict) throw new Error(`Moving quota failed: ${JSON.stringify(movingQuotaConflict)}`);
          reportedInterval = intervalFor(reportedInterval.depot.distance, reportedInterval.depot.distance);
        }
        for (const depot of movingIntervals.keys()) {
          if (depot < reportedInterval.start) movingIntervals.delete(depot);
        }
      }
      for (const hazard of hazards.filter(h => h.movement)) {
        const contact = contactFor(hazard, distance);
        if (!movingEligible || (mode === 'normal' && contact >= route.finishDistanceMeters)) continue;
        const interval = intervalFor(contact, distance);
        if (interval.encounters.length >= moving.maximumPerWindow) {
          throw new Error(`Moving quota cap exceeded: ${interval.start}-${interval.depot.distance} m`);
        }
        interval.encounters.push(contact);
      }
      return {...account};
    },
    nextCargoPickup(distance = 0) {
      return cargoPickupForRoll(distance, random(), levelId, mode);
    },
    pressureSnapshot(distance) {
      return {streaks: [...reachedPressure(emittedPressure, distance).streaks]};
    },
    /**
     * One pickup every COIN_ROW_GAP_MIN..MAX rows (deferred past rows without a cargo lane),
     * so coins keep a steady rhythm without random droughts or floods.
     */
    nextRowPickups(cargoLanes, distance = 0, row = null) {
      rowsUntilPickup -= 1;
      if (rowsUntilPickup > 0 || cargoLanes.length === 0) return [];
      rowsUntilPickup = COIN_ROW_GAP_MIN + Math.floor(random() * (COIN_ROW_GAP_MAX - COIN_ROW_GAP_MIN + 1));
      let lane = cargoLanes[Math.floor(random() * cargoLanes.length)];
      const pickup = this.nextCargoPickup(distance);
      const premium = pickup.value > SINGLE_COIN_PAYOUT;
      if (row) {
        // Owner rule: premium cargo baits the riskiest open lane (hemmed in by this row's
        // obstacles or the roadside); ordinary cargo sits on the least exposed one.
        const blocked = [...row.hazards, ...(row.intermediates ?? [])].flatMap(hazardBlockedIntervals);
        const closed = other => other < 0 || other >= TRACK_LANES.length ||
          blocked.some(([left, right]) => LANE_CENTERS[other] > left && LANE_CENTERS[other] < right);
        const risk = candidate => Number(closed(candidate - 1)) + Number(closed(candidate + 1));
        const target = (premium ? Math.max : Math.min)(...cargoLanes.map(risk));
        if (risk(lane) !== target) lane = cargoLanes.find(candidate => risk(candidate) === target);
      } else if (premium && cargoLanes.some(candidate => candidate === 0 || candidate === 3)) {
        // Better cargo rewards an optional outside commitment, never an extra roll or payout.
        if (lane !== 0 && lane !== 3) lane = cargoLanes.find(candidate => candidate === 0 || candidate === 3);
      }
      return [{lane, ...pickup}];
    },
  };
}

/** Keep already advertised rows and finish their chunk before selecting a new sector's chunk. */
export function createTrackStream(seed, levelId = 'level1', mode = 'normal', diagnostics) {
  const generator = createTrackGenerator(seed, levelId, mode, diagnostics);
  let chunk = null;
  let index = 0;
  let liveRows = [];
  const build = (distance, spawnContext) => {
    if (!chunk || index >= chunk.rows.length) {
      chunk = generator.nextChunk(distance);
      index = 0;
    }
    const phase = index++;
    const row = chunk.rows[phase];
    const plannedDistance = row.plannedDistance;
    const warningIntervals = [...row.hazards, ...row.intermediates].flatMap(hazardBlockedIntervals);
    const result = {...row, lifetime: {clearedAtDistance: null},
      chunkId: chunk.id, family: chunk.family, signature: chunk.signature,
      fallback: chunk.fallback, pacing: chunk.pacing, candidateAttempts: chunk.candidateAttempts,
      candidateBudget: chunk.candidateBudget, selectionPacing: chunk.selectionPacing, density: chunk.density,
      committedDensity: chunk.committedDensity,
      certificates: chunk.certificates, phase, sequenceLength: chunk.rows.length,
      movingDeadline: chunk.movingDeadline, movingQuotaConflict: chunk.movingQuotaConflict,
      movingObligation: Boolean(chunk.movingObligation),
      plannedObstacleCount: chunk.obstacleCount ?? countChunkHazards(chunk),
      plannedSideObstacleCount: chunk.sideObstacleCount ?? countSideObstacles(chunk),
      sideQuotaBefore: chunk.sideQuotaBefore,
      sideQuotaAfter: chunk.sideQuotaAfter,
      challenge: (chunk.tier ?? 1) === 2,
      sustained: Boolean(chunk.sustained), steeringDemandPx: chunk.steeringDemandPx ?? null,
      warningLanes: TRACK_LANES.filter(lane => warningIntervals.some(([left, right]) =>
        LANE_CENTERS[lane] > left && LANE_CENTERS[lane] < right) ||
        row.intermediates.some(h => h.lane === lane)),
      pickups: generator.nextRowPickups(row.cargoLanes, plannedDistance, row)};
    Object.defineProperty(result, 'plannedDistance', {writable: false, configurable: false});
    result.emitted = hazardsBeforeDepot(result, plannedDistance,
      spawnContext?.nextDepotDistance ?? nextDepotAfter(plannedDistance, DEPOT_RULES, levelId, mode).distance,
      spawnContext?.protectedUntilDistance ?? 0, levelId, mode);
    result.safePickupLanes = result.safePickupLanes.filter(lane =>
      !result.pickups.some(pickup => pickup.lane === lane));
    result.sideQuotaAfter = generator.recordSpawn(result, result.emitted, plannedDistance);
    liveRows = liveRows.filter(previous => [...previous.hazards, ...previous.intermediates]
      .some(hazard => !hazard.continuation && previous.plannedDistance +
        (HAZARD_TRAVEL_PX - hazardRouteOffsetY(hazard) + hazardRouteGeometry(hazard).hitY) * METERS_PER_PIXEL >= plannedDistance));
    if (result.emitted) liveRows.push(result);
    return result;
  };
  return {
    nextRow(distance, spawnContext) { return build(distance, spawnContext); },
    pressureSnapshot(distance) { return generator.pressureSnapshot(distance); },
    resetAfterDepot(distance) {
      for (const row of liveRows) row.lifetime.clearedAtDistance = distance;
      liveRows = [];
      chunk = null;
      index = 0;
      generator.resetAfterDepot(distance);
    },
  };
}
