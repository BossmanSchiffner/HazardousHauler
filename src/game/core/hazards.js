import {GAME_BALANCE} from '../data/gameBalance.js';
import {METERS_PER_PIXEL, routeTimeAtDistance, routeSpeedAtDistance} from './economy.js';
import {HAZARD_TRAVEL_PX, SHIP_Y, SPAWN_Y} from '../data/route.js';

export const LANE_CENTERS = GAME_BALANCE.routes.track.laneCentersPx;
const footprint = (x, y, halfWidth, halfHeight) => Object.freeze({x, y, halfWidth, halfHeight});
const {minX, maxX} = GAME_BALANCE.routes.track.routeValidation;
export const INDUSTRIAL_HAZARD_KINDS = Object.freeze(['divider', 'barrier', 'rockSlab']);
/** Half-extents include the ship body. Compound footprints retain recessed corners. */
const hazardDefinitions = Object.fromEntries(Object.entries(GAME_BALANCE.hazards.collision).map(([kind, spec]) => {
  const anchorX = spec.anchorX ?? LANE_CENTERS[0];
  const laneWidth = LANE_CENTERS[1] - LANE_CENTERS[0];
  const widthLanes = kind === 'sweeper' ? GAME_BALANCE.routes.movingHazards.widthLanes : spec.widthLanes;
  const width = widthLanes ? widthLanes * laneWidth : spec.width;
  const geometry = {...spec, width, texture: spec.texture ?? `hazard_${kind}`};
  if (spec.footprint && !widthLanes) {
    geometry.footprint = Object.freeze(spec.footprint.map(part => footprint(...part)));
    geometry.hitX = Math.max(...geometry.footprint.map(part => Math.abs(part.x) + part.halfWidth)) +
      GAME_BALANCE.hazards.playerHalfWidthPx;
  } else if (widthLanes) {
    const inset = spec.collisionInsetPx ?? 2;
    geometry.hitX = width / 2 - inset + GAME_BALANCE.hazards.playerHalfWidthPx;
    geometry.hitY = spec.height / 2 - inset + GAME_BALANCE.hazards.playerHalfHeightPx;
    geometry.footprint = Object.freeze([footprint(0, 0, width / 2 - inset, spec.height / 2 - inset)]);
  }
  if (spec.roadside) {
    geometry.hitX = spec.width / 2 - 2 + GAME_BALANCE.hazards.playerHalfWidthPx;
    geometry.hitY = spec.height / 2 - 2 + GAME_BALANCE.hazards.playerHalfHeightPx;
    geometry.footprint ??= Object.freeze([footprint(0, 0, spec.width / 2 - 2, spec.height / 2 - 2)]);
  }
  if (spec.scenery) geometry.scenery = Object.freeze({
    kind: spec.scenery, width: anchorX + spec.width / 2,
    height: spec.elongated ? spec.height : 116, anchorX,
  });
  return [kind, Object.freeze(geometry)];
}));
hazardDefinitions.energy_orb = Object.freeze({
  ...GAME_BALANCE.hazards.collision.energy_orb,
  kind: 'energy_orb', radius: 24,
  isMover: true, moverType: 'roaming_lateral', lateralSpeed: 45,
  minX: 75, maxX: 315, ignoresObstacles: true,
});
export const HAZARDS = Object.freeze(hazardDefinitions);
const HAZARD_STAGGER_PX = GAME_BALANCE.hazards.staggerPx;
// Imported roadside scenery can overhang the shoulder; guardrail collision bodies occupy one lane.
export const MAX_HAZARD_HIT_X = Math.max(...Object.values(HAZARDS).filter(h => !h.roadside).map(hazard => hazard.hitX));
// The Street Sweeper is an overlay with its own clearance rules, so its long body does not widen row spacing.
export const HAZARD_ROW_ENVELOPE_PX = 2 * (Math.max(...Object.values(HAZARDS)
  .filter(hazard => hazard !== HAZARDS.sweeper).map(hazard => hazard.hitY)) + HAZARD_STAGGER_PX);

export function hazardDefinition(kind) {
  const definition = HAZARDS[kind];
  if (!definition) throw new Error(`Unknown hazard ${kind}`);
  return definition;
}

export function sideHazardQuota(obstacles, sideObstacles) {
  if (!Number.isSafeInteger(obstacles) || !Number.isSafeInteger(sideObstacles) ||
      obstacles < 0 || sideObstacles < 0 || sideObstacles > obstacles) {
    throw new Error('Invalid emitted side-hazard counts');
  }
  const {minimumShare, maximumShare, targetShare} = GAME_BALANCE.routes.sideObstacles;
  const share = obstacles === 0 ? 0 : sideObstacles / obstacles;
  return {share, acceptable: obstacles > 0 && share >= minimumShare && share <= maximumShare,
    minimumShare, maximumShare, targetShare};
}

export function movingHazardMinimumForInterval(startDistance, endDistance) {
  if (!Number.isFinite(startDistance) || Number.isNaN(endDistance) || endDistance <= startDistance)
    throw new Error('Invalid moving-hazard interval');
  if (endDistance === Infinity) return 0;
  const {minimumPerWindow} = GAME_BALANCE.routes.movingHazards;
  return Math.max(2, Math.ceil(minimumPerWindow * (endDistance - startDistance) / 1000));
}

export function movingHazardQuota(count, minimumPerWindow = GAME_BALANCE.routes.movingHazards.minimumPerWindow) {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid emitted moving-hazard count');
  if (!Number.isSafeInteger(minimumPerWindow) || minimumPerWindow < 0)
    throw new Error('Invalid moving-hazard quota minimum');
  const {maximumPerWindow: maximum} = GAME_BALANCE.routes.movingHazards;
  const minimum = minimumPerWindow;
  return {count, minimum, maximum, acceptable: count >= minimum && count <= maximum};
}

export function hazardFirstContactDistance(hazard, sourceDistance) {
  return sourceDistance + (HAZARD_TRAVEL_PX - hazardRouteOffsetY(hazard) -
    Math.max(HAZARD_ROW_ENVELOPE_PX / 2, hazardRouteGeometry(hazard).hitY)) * METERS_PER_PIXEL;
}

export function hazardScrollScale(hazard) {
  if (hazard.movement?.axis !== 'forward') return 1;
  const ratio = hazard.movement.forwardSpeedRatio;
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) {
    throw new Error('Invalid forward hazard speed ratio');
  }
  return 1 - ratio;
}

export function hazardRouteOffsetY(hazard) {
  const offset = hazard.offsetY ?? 0;
  const scale = hazardScrollScale(hazard);
  return scale === 1 ? offset : HAZARD_TRAVEL_PX - (HAZARD_TRAVEL_PX - offset) / scale;
}

/** Exact distance-domain projection of a fixed-lane mover, including the cab's Y extent. */
export function hazardRouteGeometry(hazard) {
  const geometry = hazardGeometry(hazard);
  const scale = hazardScrollScale(hazard);
  if (scale === 1) return geometry;
  const halfHeight = GAME_BALANCE.hazards.playerHalfHeightPx;
  return {...geometry, hitY: geometry.hitY / scale,
    footprint: geometry.footprint.map(part => ({...part, y: part.y / scale,
      halfHeight: (part.halfHeight + halfHeight) / scale - halfHeight}))};
}

/** Length is authored in row units, then resolved once at the chunk's actual spacing. */
export function hazardGeometry(hazard) {
  const spec = hazardDefinition(typeof hazard === 'string' ? hazard : hazard.kind);
  const length = spec.elongated
    ? Math.max(hazard.lengthPx ?? spec.height, guardrailMinimumLength(hazard))
    : hazard.lengthPx;
  if (!length) return spec;
  return {...spec, height: length,
    hitY: length / 2 - 2 + GAME_BALANCE.hazards.playerHalfHeightPx,
    footprint: [footprint(0, 0, spec.width / 2 - 2, length / 2 - 2)]};
}

export function hazardHits(kind, hazardX, hazardY, shipX, shipY) {
  const {hitX, hitY, footprint, radius} = hazardGeometry(kind);
  if (radius) {
    const dx = Math.max(0, Math.abs(hazardX - shipX) - GAME_BALANCE.hazards.playerHalfWidthPx);
    const dy = Math.max(0, Math.abs(hazardY - shipY) - GAME_BALANCE.hazards.playerHalfHeightPx);
    return dx * dx + dy * dy < radius * radius;
  }
  if (footprint) return footprint.some(part =>
    Math.abs(hazardX + part.x - shipX) < part.halfWidth + GAME_BALANCE.hazards.playerHalfWidthPx &&
    Math.abs(hazardY + part.y - shipY) < part.halfHeight + GAME_BALANCE.hazards.playerHalfHeightPx);
  return Math.abs(hazardX - shipX) < hitX && Math.abs(hazardY - shipY) < hitY;
}

export function energyOrbX(orb, elapsedSeconds) {
  const {minX, maxX, lateralSpeed} = hazardDefinition('energy_orb');
  if (![orb.initialX, orb.direction, elapsedSeconds].every(Number.isFinite) ||
      ![-1, 1].includes(orb.direction) || elapsedSeconds < 0) {
    throw new Error('Invalid energy orb trajectory');
  }
  const span = maxX - minX;
  const distance = orb.initialX - minX + orb.direction * lateralSpeed * elapsedSeconds;
  const phase = ((distance % (span * 2)) + span * 2) % (span * 2);
  return minX + (phase <= span ? phase : span * 2 - phase);
}

export const isGuardrail = hazard => Boolean(hazardDefinition(typeof hazard === 'string' ? hazard : hazard.kind).elongated);

export function guardrailMinimumLength(hazard) {
  const {scenery} = hazardDefinition(typeof hazard === 'string' ? hazard : hazard.kind);
  const {entryLengthPerWidth, midLengthPerWidth, exitLengthPerWidth} = GAME_BALANCE.hazards.guardrail;
  return scenery.width * (entryLengthPerWidth + midLengthPerWidth + exitLengthPerWidth);
}

/**
 * Atomic guardrail layout along the road: one entry wedge at the leading (lower) end, N tiling mids and
 * one exit cap. Tile lengths scale with the configured drawn width, so artwork never moves collisions.
 */
export function guardrailLayout(hazard) {
  const {scenery} = hazardDefinition(hazard.kind);
  const {entryLengthPerWidth, midLengthPerWidth, exitLengthPerWidth} = GAME_BALANCE.hazards.guardrail;
  const width = scenery.width;
  const length = hazardGeometry(hazard).height;
  const entry = width * entryLengthPerWidth;
  const exit = width * exitLengthPerWidth;
  const midSpan = length - entry - exit;
  const midCount = Math.max(1, Math.floor(midSpan / (width * midLengthPerWidth)));
  return {width, length, entry, exit, midCount, midLength: midSpan / midCount,
    side: hazard.lane > 1 ? -1 : 1, anchorX: scenery.anchorX};
}

/**
 * Lateral boundary of the blocked region, measured from the structure centre toward the open road
 * (positive = inward). The entry ramps the last `rampLateralPx` in from the lip; the exit tapers back
 * to the outer edge.
 */
function guardrailEdge(layout, half, front, back, y) {
  const {rampLateralPx} = GAME_BALANCE.hazards.guardrail;
  if (y > front - layout.entry) return half - rampLateralPx * (y - front + layout.entry) / layout.entry;
  if (y < back + layout.exit) return -half + 2 * half * (y - back) / layout.exit;
  return half;
}

/**
 * Collides the lead hauler cab with a guardrail. `scrollPx` is this frame's road travel: a head-on
 * impact needs the forward lip to sweep past the cab's front bumper this frame while the cab overlaps
 * the lip. Every other overlap is a non-lethal flank contact resolved by clamping the cab's x.
 */
export function guardrailContact(hazard, structureX, structureY, shipX, shipY, scrollPx = 0) {
  const layout = guardrailLayout(hazard);
  const {playerHalfWidthPx, playerHalfHeightPx} = GAME_BALANCE.hazards;
  const half = hazardDefinition(hazard.kind).width / 2 - 2;
  const front = structureY + layout.length / 2 - 2;
  const back = structureY - layout.length / 2 + 2;
  const bumper = shipY - playerHalfHeightPx;
  const tail = shipY + playerHalfHeightPx;
  if (tail <= back || bumper >= front) return null;
  const inward = layout.side * (shipX - structureX);
  if (inward + playerHalfWidthPx <= -half) return null;
  const top = Math.max(back, bumper), bottom = Math.min(front, tail);
  const edge = top <= front - layout.entry && bottom >= back + layout.exit ? half
    : Math.max(guardrailEdge(layout, half, front, back, top), guardrailEdge(layout, half, front, back, bottom));
  if (inward - playerHalfWidthPx >= edge) return null;
  const lip = half - GAME_BALANCE.hazards.guardrail.rampLateralPx;
  const headOn = front - scrollPx <= bumper && inward - playerHalfWidthPx < lip;
  return {
    kind: headOn ? 'headOn' : 'flank', side: layout.side,
    clampX: structureX + layout.side * (edge + playerHalfWidthPx),
    contactX: structureX + layout.side * edge,
    contactY: Math.min(front, Math.max(back, shipY)),
  };
}

const hazardBaseX = hazard => LANE_CENTERS[hazard.lane] + (hazard.offsetX ?? 0);
export const hazardX = hazard => hazardBaseX(hazard) + (hazard.movementOffsetPx ?? 0);

export function movingHazardOffset(movement, elapsedSeconds) {
  if (movement?.axis === 'forward') {
    hazardScrollScale({movement});
    if (!Number.isFinite(elapsedSeconds)) throw new Error('Invalid moving hazard motion');
    return 0;
  }
  if (!movement || ![movement.minOffsetPx, movement.maxOffsetPx, movement.speedPxPerSecond,
    movement.direction, movement.phase].every(Number.isFinite) || !Number.isFinite(elapsedSeconds) ||
      movement.maxOffsetPx <= movement.minOffsetPx || movement.speedPxPerSecond <= 0 ||
      Math.abs(movement.direction) !== 1) {
    throw new Error('Invalid moving hazard motion');
  }
  const span = movement.maxOffsetPx - movement.minOffsetPx;
  const periodDistance = span * 2;
  const warning = movement.warningSeconds ?? 0;
  if (!Number.isFinite(warning) || warning < 0) throw new Error('Invalid moving hazard warning');
  const distance = movement.phase + movement.direction * movement.speedPxPerSecond *
    Math.max(0, elapsedSeconds - warning);
  const phase = ((distance % periodDistance) + periodDistance) % periodDistance;
  const offset = phase <= span ? phase : periodDistance - phase;
  return movement.minOffsetPx + offset;
}

export function hazardArtOverlaps(a, b, bOffsetY = 0, padding = 8) {
  const first = hazardGeometry(a), second = hazardGeometry(b);
  return Math.abs(hazardX(a) - hazardX(b)) < (first.width + second.width) / 2 + padding &&
    Math.abs(a.offsetY - b.offsetY - bOffsetY) < (first.height + second.height) / 2 + padding;
}

export function hazardSweptArtOverlaps(a, b, bOffsetY = 0, padding = 8) {
  const first = hazardGeometry(a), second = hazardGeometry(b);
  const firstMovement = a.movement ?? a.motionBounds;
  const secondMovement = b.movement ?? b.motionBounds;
  const firstBaseX = hazardX(a) - (a.movementOffsetPx ?? 0);
  const secondBaseX = hazardX(b) - (b.movementOffsetPx ?? 0);
  const firstLeft = firstBaseX + (firstMovement?.minOffsetPx ?? 0) - first.width / 2;
  const firstRight = firstBaseX + (firstMovement?.maxOffsetPx ?? 0) + first.width / 2;
  const secondLeft = secondBaseX + (secondMovement?.minOffsetPx ?? 0) - second.width / 2;
  const secondRight = secondBaseX + (secondMovement?.maxOffsetPx ?? 0) + second.width / 2;
  const xOverlaps = firstLeft < secondRight + padding && secondLeft < firstRight + padding;
  const yOverlaps = Math.abs(hazardRouteOffsetY(a) - hazardRouteOffsetY(b) - bOffsetY) <
    first.height / (2 * hazardScrollScale(a)) + second.height / (2 * hazardScrollScale(b)) + padding;
  return xOverlaps && yOverlaps;
}

export function hazardBlockedIntervals(hazard) {
  const spec = hazardDefinition(hazard.kind);
  const x = hazardBaseX(hazard);
  const movement = hazard.movement ?? hazard.motionBounds;
  const minMotion = movement?.minOffsetPx ?? 0;
  const maxMotion = movement?.maxOffsetPx ?? 0;
  return spec.footprint
    ? spec.footprint.map(part => [x + minMotion + part.x - part.halfWidth - GAME_BALANCE.hazards.playerHalfWidthPx,
      x + maxMotion + part.x + part.halfWidth + GAME_BALANCE.hazards.playerHalfWidthPx])
    : [[x + minMotion - spec.hitX, x + maxMotion + spec.hitX]];
}

export function obstacleLaneMask(hazards) {
  const intervals = hazards.flatMap(hazardBlockedIntervals);
  return LANE_CENTERS.reduce((mask, center, lane) =>
    intervals.some(([left, right]) => center > left && center < right)
      ? mask | (1 << lane) : mask, 0);
}

export function moverReservation(hazard, sourceDistance, levelId = 'level2', mode = 'normal') {
  if (!hazard.movement) return null;
  const geometry = hazardGeometry(hazard);
  const startX = hazardBaseX(hazard) + (hazard.movement.minOffsetPx ?? 0);
  const endX = hazardBaseX(hazard) + (hazard.movement.maxOffsetPx ?? 0);
  const sweptMinX = Math.min(startX, endX) - geometry.width / 2 - 4;
  const sweptMaxX = Math.max(startX, endX) + geometry.width / 2 + 4;
  const speed = routeSpeedAtDistance(sourceDistance, levelId, mode);
  const sweptMinY = SPAWN_Y + (hazard.offsetY ?? 0) - (hazard.movement.warningSeconds ?? 0) * speed;
  const sweptMaxY = SHIP_Y + geometry.height / 2 + 4;
  const affectedMask = obstacleLaneMask([hazard]);
  const bypassLanes = LANE_CENTERS.map((_, lane) => lane)
    .filter(lane => !(affectedMask & (1 << lane)));
  if (!bypassLanes.length) return null;
  const fromDistance = sourceDistance + (SHIP_Y - sweptMaxY) * METERS_PER_PIXEL;
  const toDistance = sourceDistance + (SHIP_Y - sweptMinY) * METERS_PER_PIXEL;
  return {fromDistance, toDistance, affectedMask, bypassLane: bypassLanes[0],
    sourceDistance, sweptMinX, sweptMaxX, sweptMinY, sweptMaxY,
    affectedLanes: LANE_CENTERS.map((_, lane) => lane).filter(lane => affectedMask & (1 << lane)),
    fromSeconds: routeTimeAtDistance(Math.max(0, fromDistance), levelId, mode),
    toSeconds: routeTimeAtDistance(toDistance, levelId, mode)};
}

export function staticIntersectsMoverReservation(hazard, sourceDistance, reservation) {
  if (hazard.movement || hazard.motionBounds) return false;
  const geometry = hazardGeometry(hazard);
  const x = hazardBaseX(hazard);
  const physical = hazardBlockedIntervals(hazard);
  const left = Math.min(x - geometry.width / 2, ...physical.map(interval => interval[0]));
  const right = Math.max(x + geometry.width / 2, ...physical.map(interval => interval[1]));
  const center = sourceDistance + (HAZARD_TRAVEL_PX - hazardRouteOffsetY(hazard)) * METERS_PER_PIXEL;
  const halfRange = Math.max(geometry.height / (2 * hazardScrollScale(hazard)),
    hazardRouteGeometry(hazard).hitY) * METERS_PER_PIXEL;
  return left < reservation.sweptMaxX && right > reservation.sweptMinX &&
    center - halfRange < reservation.toDistance && center + halfRange > reservation.fromDistance;
}

export function usesPotentialMoverLanes(hazard) {
  const moving = GAME_BALANCE.routes.movingHazards;
  return moving.chicane.validation === 'potential-lanes' && hazard.routeValidation === 'three-center-potential' &&
    ['forklift', 'sweeper'].includes(hazard.kind) && [0, 1].includes(hazard.lane) && hazard.movement?.minOffsetPx === 0 &&
    hazard.movement.maxOffsetPx === LANE_CENTERS[2] - LANE_CENTERS[0];
}

export function usesTimedMoverLanes(hazard) {
  const travel = (hazard.movement?.maxOffsetPx ?? 0) / (LANE_CENTERS[1] - LANE_CENTERS[0]);
  const opening = hazard.openingLanes;
  return ['forklift', 'sweeper'].includes(hazard.kind) && hazard.routeValidation === 'central-timed' &&
    Number.isInteger(hazard.lane) && hazard.lane >= 0 && hazard.lane + travel < LANE_CENTERS.length &&
    hazard.movement?.minOffsetPx === 0 && [1, 2].includes(travel) &&
    Array.isArray(opening) && opening.length === travel + 1 &&
    opening.every((lane, index) => lane === hazard.lane + index);
}

/** Lane-selection hints only; timed movers still require full trajectory certification. */
export function routeHazardBlockedIntervals(hazard) {
  if (usesTimedMoverLanes(hazard)) {
    if (!Number.isFinite(hazard.movement.impactOffsetPx)) throw new Error('Timed mover layout needs an impact phase');
    return hazardBlockedIntervals({...hazard, movement: undefined,
      offsetX: (hazard.offsetX ?? 0) + hazard.movement.impactOffsetPx});
  }
  if (!usesPotentialMoverLanes(hazard)) return hazardBlockedIntervals(hazard);
  return hazardBlockedIntervals({...hazard, movement: undefined, motionBounds: undefined,
    offsetX: (hazard.offsetX ?? 0) + movingHazardOffset(hazard.movement, 0)});
}

/** Test continuous ship positions, including exact near-miss boundaries, not just lane centers. */
export function hasStraightRoute(rows, routeMinX = minX, routeMaxX = maxX) {
  const blocked = rows.flatMap(row => row.hazards.flatMap(hazardBlockedIntervals));
  const boundaries = [...new Set([routeMinX, routeMaxX,
    ...blocked.flat().filter(x => x >= routeMinX && x <= routeMaxX)])].sort((a, b) => a - b);
  const candidates = [...boundaries, ...boundaries.slice(1).map((x, i) => (x + boundaries[i]) / 2)];
  return candidates.some(x => blocked.every(([left, right]) => x <= left || x >= right));
}

/** Positive-width constant-x corridors, used to prefer useful Beta lane pressure over duplicates. */
export function straightRouteWidth(rows, routeMinX = minX, routeMaxX = maxX) {
  const blocked = rows.flatMap(row => row.hazards.flatMap(hazardBlockedIntervals))
    .map(([left, right]) => [Math.max(routeMinX, left), Math.min(routeMaxX, right)])
    .filter(([left, right]) => right > left).sort((a, b) => a[0] - b[0]);
  let cursor = routeMinX, width = 0;
  for (const [left, right] of blocked) {
    width += Math.max(0, left - cursor);
    cursor = Math.max(cursor, right);
  }
  return width + Math.max(0, routeMaxX - cursor);
}

/** Authored row phase determines shape and stagger; no extra generator random draws. */
export function hazardsForRow(row, sectorNumber, phase) {
  if (row.hazards) return row.hazards;
  return row.hazardLanes.map((lane, index) => {
    const kinds = sectorNumber >= 3 ? ['divider', 'signalCabinet', 'divider', 'barrier']
      : ['barrier', 'signalCabinet', 'divider', 'barrier'];
    const kind = kinds[(phase + index) % kinds.length];
    return Object.freeze({lane, kind, offsetY: (index % 2 ? 1 : -1) * HAZARD_STAGGER_PX});
  });
}

export function canonicalMotionAge(sourceDistance, distance, levelId = 'level1', mode = 'normal') {
  return Math.max(0, routeTimeAtDistance(Math.max(0, distance), levelId, mode) -
    routeTimeAtDistance(Math.max(0, sourceDistance), levelId, mode));
}

const pressureParts = hazard => {
  const geometry = hazardRouteGeometry(hazard);
  return geometry.footprint ?? [{x: 0, y: 0,
    halfWidth: geometry.hitX - GAME_BALANCE.hazards.playerHalfWidthPx,
    halfHeight: geometry.hitY - GAME_BALANCE.hazards.playerHalfHeightPx}];
};
const bodyOccupiesPlane = (body, distance) => bodyOccupiesWindow(body, distance, distance);
/** A body threatens an event if any of its parts overlaps the event's [from, to] window. */
const bodyOccupiesWindow = (body, from, to) =>
  (body.lifetime?.clearedAtDistance ?? Infinity) >= from &&
  pressureParts(body.hazard).some(part => {
    const center = body.center - part.y * METERS_PER_PIXEL;
    const extent = (part.halfHeight + GAME_BALANCE.hazards.playerHalfHeightPx) * METERS_PER_PIXEL;
    return center - extent < to && center + extent > from;
  });

/** Project actual physical bodies once; Alpha and each occupied Beta slot remain separate events. */
export function projectPhysicalEvents(rows, {levelId = 'level1', mode = 'normal', bodies = []} = {}) {
  const physical = new Map(bodies.map(body => [body.id, body]));
  const events = [];
  for (const [index, row] of rows.entries()) {
    const sourceDistance = row.plannedDistance ?? row.spawnDistance;
    if (!Number.isFinite(sourceDistance)) throw new Error('Physical event needs a world anchor');
    const encounter = row.encounterId ?? row.chunkId ?? `row:${sourceDistance}`;
    const hazards = [...row.hazards, ...(row.intermediates ?? []), ...(row.sweepers ?? [])];
    const ids = new Map(hazards.map((hazard, index) =>
      [hazard, hazard.sideObstacleId ?? `${sourceDistance}:${index}`]));
    if (row.emitted !== false) {
      for (const [hazardIndex, hazard] of hazards.entries()) {
        if (hazard.continuation) continue;
        const id = hazard.sideObstacleId ?? `${sourceDistance}:${hazardIndex}`;
        physical.set(id, {id, hazard, sourceDistance, encounter, lifetime: row.lifetime,
          center: sourceDistance + (HAZARD_TRAVEL_PX - hazardRouteOffsetY(hazard)) * METERS_PER_PIXEL});
      }
    }
    const alpha = row.hazards.filter(hazard => !hazard.continuation && !hazard.lengthPx);
    const add = (offsetY, placement, primary, owners = primary) => {
      const distance = sourceDistance + (HAZARD_TRAVEL_PX - offsetY) * METERS_PER_PIXEL;
      const halfWindowPx = primary.length ? Math.max(...primary.map(hazard => hazardRouteGeometry(hazard).hitY)) : 0;
      events.push({distance, from: distance - halfWindowPx * METERS_PER_PIXEL,
        to: distance + halfWindowPx * METERS_PER_PIXEL,
        placement, encounter, rowIndex: index, sourceDistance,
        ...(row.protectedLaneMask && primary.some(hazard => hazard.depotChicane)
          ? {protectedLaneMask: row.protectedLaneMask} : {}),
        ...(row.moverReservedMask ? {reservedLaneMask: row.moverReservedMask} : {}),
        ownerIds: owners.map(hazard => ids.get(hazard))});
    };
    add(0, 'alpha', alpha, row.hazards);
    if (row.emitted !== false) {
      const slots = new Map();
      for (const hazard of row.intermediates ?? []) {
        if (!slots.has(hazard.offsetY)) slots.set(hazard.offsetY, []);
        slots.get(hazard.offsetY).push(hazard);
      }
      for (const [offsetY, primary] of slots) add(offsetY, 'beta', primary);
    }
  }
  const allBodies = [...physical.values()];
  return {bodies: allBodies, events: events.sort((a, b) => a.distance - b.distance)
    .filter(event => event.ownerIds.some(id => {
      const body = physical.get(id);
      return body && bodyOccupiesPlane(body, event.distance);
    }))
    .map(({ownerIds, ...event}) => ({...event, ...eventPressure(event, allBodies, {levelId, mode})}))
    .filter(event => event.meaningful)};
}

/** Threat union and simultaneous pressure are deliberately different measurements. */
export function eventPressure(event, bodies, {levelId = 'level1', mode = 'normal'} = {}) {
  const halfWidth = GAME_BALANCE.hazards.playerHalfWidthPx;
  const halfHeight = GAME_BALANCE.hazards.playerHalfHeightPx;
  const active = bodies.filter(body =>
    bodyOccupiesWindow(body, event.from ?? event.distance, event.to ?? event.distance));
  const points = new Set([event.from, event.distance, event.to]);
  // Every transition of a pressure mask occurs at a physical Y boundary or a
  // triangular mover crossing a ship-expanded lane boundary.
  for (const body of active) for (const part of pressureParts(body.hazard)) {
    const center = body.center - part.y * METERS_PER_PIXEL;
    const extent = (part.halfHeight + halfHeight) * METERS_PER_PIXEL;
    for (const distance of [center - extent, center + extent]) {
      if (distance > event.from && distance < event.to) points.add(distance);
    }
    const cleared = body.lifetime?.clearedAtDistance;
    if (cleared > event.from && cleared < event.to) points.add(cleared);
    if (!body.hazard.movement || body.hazard.movement.axis === 'forward') continue;
    const movement = body.hazard.movement;
    const span = movement.maxOffsetPx - movement.minOffsetPx;
    const sourceTime = routeTimeAtDistance(body.sourceDistance, levelId, mode);
    const start = routeTimeAtDistance(Math.max(0, event.from), levelId, mode) - sourceTime;
    const end = routeTimeAtDistance(Math.max(0, event.to), levelId, mode) - sourceTime;
    const warning = movement.warningSeconds ?? 0;
    const phaseAt = time => movement.phase + movement.direction * movement.speedPxPerSecond *
      Math.max(0, time - warning);
    const low = Math.min(phaseAt(start), phaseAt(end)), high = Math.max(phaseAt(start), phaseAt(end));
    const positions = [0, span, ...LANE_CENTERS.flatMap(x =>
      [x - hazardBaseX(body.hazard) - part.x - part.halfWidth - halfWidth,
        x - hazardBaseX(body.hazard) - part.x + part.halfWidth + halfWidth])]
      .filter(offset => offset >= 0 && offset <= span);
    for (const offset of positions) for (const reflected of [offset, 2 * span - offset]) {
      const first = Math.ceil((low - reflected) / (2 * span));
      const last = Math.floor((high - reflected) / (2 * span));
      for (let cycle = first; cycle <= last; cycle++) {
        const elapsed = warning + (reflected + cycle * 2 * span - movement.phase) /
          (movement.direction * movement.speedPxPerSecond);
        const target = sourceTime + elapsed;
        let left = Math.max(0, event.from), right = event.to;
        for (let iteration = 0; iteration < 40; iteration++) {
          const middle = (left + right) / 2;
          if (routeTimeAtDistance(middle, levelId, mode) < target) left = middle;
          else right = middle;
        }
        points.add((left + right) / 2);
      }
    }
  }
  const boundaries = [...points].sort((a, b) => a - b);
  const samples = [...boundaries, ...boundaries.slice(1).map((right, index) =>
    (boundaries[index] + right) / 2)];
  const masks = samples.map(distance => {
    const mask = [false, false, false, false];
    for (const body of active) {
      if (distance > (body.lifetime?.clearedAtDistance ?? Infinity)) continue;
      const hazard = body.hazard;
      const x = hazardBaseX(hazard) + (hazard.movement
        ? movingHazardOffset(hazard.movement,
          canonicalMotionAge(body.sourceDistance, distance, levelId, mode)) : 0);
      for (const part of pressureParts(hazard)) {
        const center = body.center - part.y * METERS_PER_PIXEL;
        if (Math.abs(distance - center) >= (part.halfHeight + halfHeight) * METERS_PER_PIXEL) continue;
        for (const [lane, laneX] of LANE_CENTERS.entries()) {
          if (Math.abs(laneX - x - part.x) < part.halfWidth + halfWidth) mask[lane] = true;
        }
      }
    }
    return mask;
  });
  const threatenedLanes = LANE_CENTERS.map((_, lane) => masks.some(mask => mask[lane]));
  const simultaneousMasks = [...new Set(masks.map(mask => mask.map(Number).join('')))];
  const reservedBypassMask = active.reduce((mask, body) => {
    const reservation = body.hazard.moverReservation;
    return reservation ? mask | (1 << reservation.bypassLane) |
      (reservation.paired ? reservation.affectedMask : 0) : mask;
  }, event.reservedLaneMask ?? 0);
  return {meaningful: threatenedLanes.some(Boolean), threatenedLanes,
    simultaneousMulti: masks.some(mask => mask.filter(Boolean).length > 1), simultaneousMasks,
    reservedBypassMask};
}

export function advancePressureHistory(history, events, {mode = 'normal'} = {}) {
  const limits = GAME_BALANCE.routes.track.maximumClearEvents;
  if (!Object.hasOwn(limits, mode)) throw new Error(`Unknown clear-event mode ${mode}`);
  const limit = limits[mode];
  // Owner rule: a lane that opens stays open for at least this many rows before it is threatened.
  const minimum = GAME_BALANCE.routes.track.minimumClearEvents?.[mode] ?? 1;
  const streaks = [...history];
  const maximum = [...history];
  const violations = [];
  // Streaks count rows: an Alpha event and the Beta events of the same row form one row.
  const groups = [];
  for (const event of events) {
    const last = groups.at(-1);
    if (last && event.rowIndex !== undefined && last[0].rowIndex === event.rowIndex &&
        last[0].sourceDistance === event.sourceDistance) last.push(event);
    else groups.push([event]);
  }
  for (const group of groups) for (let lane = 0; lane < streaks.length; lane++) {
    if (group.some(event => event.protectedLaneMask & (1 << lane))) {
      streaks[lane] = 0;
      continue;
    }
    const threat = group.find(event => event.threatenedLanes[lane]);
    if (threat && streaks[lane] > 0 && streaks[lane] < minimum) {
      violations.push({distance: threat.distance, lane, streak: streaks[lane], short: true,
        rowIndex: threat.rowIndex});
    }
    streaks[lane] = threat ? 0 : streaks[lane] + 1;
    maximum[lane] = Math.max(maximum[lane], streaks[lane]);
    if (streaks[lane] > limit) violations.push({distance: group[0].distance, lane, streak: streaks[lane]});
  }
  return {streaks, maximum, violations, acceptable: violations.length === 0};
}

function physicalEncounterSignature(rows) {
  return rows.map(row => [...row.hazards, ...(row.intermediates ?? [])]
    .map(hazard => [hazard.kind, hazard.lane, hazard.offsetX ?? 0,
      Math.round((hazard.offsetY ?? 0) / (row.spacingPx ?? 1) * 1e6) / 1e6,
      hazard.spanRows ?? 1, hazard.spanPhase ?? 0, Boolean(hazard.continuation),
      hazard.movement?.impactLane ?? '', hazard.movement?.direction ?? ''].join('@'))
    .sort().join(',')).join('|');
}

export function physicalPressureMetrics(rows, options = {}) {
  const projection = projectPhysicalEvents(rows, options);
  const events = projection.events.filter(event => event.distance >= (options.startDistance ?? 0) &&
    event.distance < (options.endDistance ?? Infinity));
  const history = advancePressureHistory([0, 0, 0, 0], events, {mode: options.mode ?? 'normal'});
  const encounters = new Map();
  for (const event of events) {
    encounters.set(event.encounter, Boolean(encounters.get(event.encounter) || event.simultaneousMulti));
  }
  const multiEncounters = [...encounters.values()].filter(Boolean).length;
  const signatures = new Map();
  for (const row of rows) {
    const id = row.encounterId ?? row.chunkId;
    if (!encounters.has(id)) continue;
    if (!signatures.has(id)) signatures.set(id, []);
    signatures.get(id).push(row);
  }
  const physicalSignatures = [...signatures.values()].map(physicalEncounterSignature);
  return {events, maximumClearStreakByLane: history.maximum,
    violations: history.violations, singlePlanes: events.filter(event => !event.simultaneousMulti).length,
    multiPlanes: events.filter(event => event.simultaneousMulti).length,
    encounters: encounters.size, multiEncounters, singleEncounters: encounters.size - multiEncounters,
    physicalSignatures, distinctPhysicalSignatures: new Set(physicalSignatures).size};
}
