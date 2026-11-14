import {createTrackStream} from './trackGenerator.js';
import {DEPOT_RULES, nextDepotAfter} from './depots.js';
import {METERS_PER_PIXEL} from './economy.js';

/** Busy background planners report liveness at this cadence, well inside the stream's stall window. */
export const ROUTE_STREAM_HEARTBEAT_MS = 250;

/** Depot context the scene holds before any facility has been passed or docked. */
export function initialRouteContext(startDistance, levelId = 'level1', mode = 'normal') {
  return {nextDepotDistance: nextDepotAfter(startDistance, DEPOT_RULES, levelId, mode).distance,
    protectedUntilDistance: 0};
}

/** Context after a Depot is passed or docked, matching the scene's advanceDepot(). */
export function depotExitContext(depotDistance, levelId = 'level1', mode = 'normal') {
  return {nextDepotDistance: nextDepotAfter(depotDistance, DEPOT_RULES, levelId, mode).distance,
    protectedUntilDistance: depotDistance + DEPOT_RULES.exitMeters};
}

/** A row spawned beyond a Depot sees the scene's advanced context, so it is derived from distance alone. */
export function advanceRouteContext(context, spawnDistance, levelId = 'level1', mode = 'normal') {
  let next = context;
  while (next.nextDepotDistance < spawnDistance) next = depotExitContext(next.nextDepotDistance, levelId, mode);
  return next;
}

/**
 * Deterministic call log over the existing track stream. Replaying the same calls always rebuilds the
 * same generator state, which lets planning run ahead of the scene without changing any generator rule.
 */
export function createRoutePlanner(seed, levelId = 'level1', mode = 'normal', {onPlanningProgress} = {}) {
  const stream = createTrackStream(seed, levelId, mode, {onPlanningProgress});
  let rows = 0;
  let cursor = null;
  const apply = call => {
    if (call.kind === 'reset') {
      stream.resetAfterDepot(call.distance);
      return null;
    }
    if (call.kind !== 'row') throw new Error(`Unknown route call ${call.kind}`);
    rows += 1;
    return stream.nextRow(call.distance, call.context);
  };
  return {
    get rows() { return rows; },
    apply,
    begin({firstDistance, context}) {
      if (!Number.isFinite(firstDistance) || !context) throw new Error('Invalid route planning start');
      cursor = {distance: firstDistance, context};
    },
    produce() {
      if (!cursor) throw new Error('Route planning has not begun');
      const context = advanceRouteContext(cursor.context, cursor.distance, levelId, mode);
      const call = {kind: 'row', distance: cursor.distance, context};
      const row = apply(call);
      cursor = {distance: row.plannedDistance + row.spacingPx * METERS_PER_PIXEL, context};
      return {call, row};
    },
  };
}
