import {createTrackStream} from './trackGenerator.js';
import {advanceRouteContext, depotExitContext, initialRouteContext} from './routeStreamPlanner.js';
import {METERS_PER_PIXEL} from './economy.js';

/** Rows planned beyond the scene's consumption: roughly 15 s of driving at the fastest spacing. */
export const ROUTE_STREAM_AHEAD_ROWS = 48;
/** Use the same deterministic stream on the main thread before a late row can be discarded. */
export const ROUTE_STREAM_FALLBACK_MS = 250;
/**
 * A row the scene receives later than this is spawned as clear road (pickups only), which keeps every
 * certified path valid. The synchronous fallback is deliberately earlier than this cutoff.
 */
export const ROUTE_STREAM_LATE_ROW_MS = 500;
/**
 * A producer that delivers nothing for this long while the scene is starved is treated as dead (for
 * example a worker whose module never started) and is respawned from the consumed log. Busy workers send
 * heartbeats while planning or replaying, so a slow but live worker is never replaced.
 */
export const ROUTE_STREAM_STALL_MS = 3000;
const now = () => globalThis.performance?.now?.() ?? Date.now();
const spareWorkers = [];

const workersSupported = () => typeof Worker === 'function';

function spawnWorker() {
  return new Worker(new URL('./routeStreamWorker.js', import.meta.url), {type: 'module'});
}

/** Load worker modules before a run so the first rows never wait for script startup. */
export function warmRouteStreamWorkers(count = 2) {
  if (!workersSupported()) return;
  try {
    while (spareWorkers.length < count) spareWorkers.push(spawnWorker());
  } catch {
    // Worker construction can be blocked by the host; runs then use the synchronous stream.
  }
}

function takeWorker() {
  const worker = spareWorkers.pop() ?? spawnWorker();
  setTimeout(() => warmRouteStreamWorkers(), 0);
  return worker;
}

/**
 * Generates the existing deterministic track stream on a background thread. One worker produces rows
 * ahead of the scene; a follower mirrors exactly the consumed calls so a Depot reset can continue from
 * the consumed state without replanning on the render thread.
 */
class BackgroundRouteStream {
  constructor(seed, levelId, mode, startDistance, firstDistance) {
    this.config = {type: 'init', seed, levelId, mode};
    this.seed = seed;
    this.levelId = levelId;
    this.mode = mode;
    this.log = [];
    this.buffer = new Map();
    this.consumed = 0;
    this.failure = null;
    this.followerFailure = null;
    this.prepared = null;
    this.fallbackStream = null;
    this.starvedSince = null;
    this.stats = {starved: 0, contextMismatches: 0, rebuilds: 0, received: 0, fallbackRows: 0,
      longestStarvedMs: 0, restarts: 0};
    // Where a producer resumes planning: the run or Depot origin, then just after the last consumed row.
    this.origin = {firstDistance, context: initialRouteContext(startDistance, levelId, mode)};
    this.producerHeardAt = now();
    this.producer = this.attach(takeWorker());
    this.producer.postMessage(this.config);
    this.producer.postMessage({type: 'produce', ...this.origin, allowance: ROUTE_STREAM_AHEAD_ROWS});
    // The follower is only needed once rows are consumed, keeping prepared menu streams to one worker.
    this.follower = null;
  }

  get shadow() {
    this.follower ??= this.createFollower(this.log);
    return this.follower;
  }

  attach(worker) {
    worker.onmessage = ({data}) => this.receive(worker, data);
    worker.onerror = event => {
      event.preventDefault?.();
      this.receive(worker, {type: 'error', index: this.consumed, message: event.message ?? 'Route worker failed'});
    };
    return worker;
  }

  createFollower(calls) {
    const follower = this.attach(takeWorker());
    follower.postMessage(this.config);
    if (calls.length) follower.postMessage({type: 'apply', calls});
    return follower;
  }

  receive(worker, data) {
    if (worker === this.producer) {
      this.producerHeardAt = now();
      if (data.type === 'row' && data.index >= this.consumed) {
        this.buffer.set(data.index, data);
        this.stats.received += 1;
      } else if (data.type === 'error') {
        this.failure ??= {index: data.index, message: data.message};
      }
    } else if (worker === this.follower && data.type === 'error') {
      this.followerFailure ??= data.message;
    }
  }

  get bufferedRows() {
    return this.buffer.size;
  }

  createFallbackStream() {
    const stream = createTrackStream(this.seed, this.levelId, this.mode);
    for (const call of this.log) {
      if (call.kind === 'reset') stream.resetAfterDepot(call.distance);
      else stream.nextRow(call.distance, call.context);
    }
    return stream;
  }

  consume(entry, context, fallback = false) {
    if (!fallback && this.fallbackStream) {
      const expected = this.fallbackStream.nextRow(entry.call.distance, entry.call.context);
      if (JSON.stringify(expected) !== JSON.stringify(entry.row)) {
        throw new Error(`Route fallback diverged at row ${this.consumed} for seed ${this.seed}`);
      }
      this.fallbackStream = null;
    }
    if (fallback) {
      this.stats.fallbackRows += 1;
      if (this.starvedSince !== null) {
        this.stats.longestStarvedMs = Math.max(this.stats.longestStarvedMs, now() - this.starvedSince);
      }
    }
    this.buffer.delete(this.consumed);
    this.consumed += 1;
    const shadow = this.shadow;
    this.log.push(entry.call);
    this.origin = {firstDistance: entry.row.plannedDistance + entry.row.spacingPx * METERS_PER_PIXEL,
      context: entry.call.context};
    shadow.postMessage({type: 'apply', calls: [entry.call]});
    this.producer.postMessage({type: 'allow', allowance: this.consumed + ROUTE_STREAM_AHEAD_ROWS});
    if (context && (context.nextDepotDistance !== entry.call.context.nextDepotDistance ||
        context.protectedUntilDistance !== entry.call.context.protectedUntilDistance)) {
      this.stats.contextMismatches += 1;
    }
    return entry.row;
  }

  nextRow(_distance, context) {
    const entry = this.buffer.get(this.consumed);
    if (!entry) {
      const failed = this.failure && this.failure.index <= this.consumed;
      this.stats.starved += 1;
      const time = now();
      this.starvedSince ??= time;
      if (time - this.starvedSince >= ROUTE_STREAM_STALL_MS && time - this.producerHeardAt >= ROUTE_STREAM_STALL_MS) {
        this.restartProducer();
      }
      if (failed || time - this.starvedSince >= ROUTE_STREAM_FALLBACK_MS) {
        if (failed) this.failure = null;
        this.fallbackStream ??= this.createFallbackStream();
        const distance = this.origin.firstDistance;
        const rowContext = advanceRouteContext(this.origin.context, distance, this.levelId, this.mode);
        const call = {kind: 'row', distance, context: rowContext};
        const row = this.fallbackStream.nextRow(distance, rowContext);
        return this.consume({index: this.consumed, call, row}, context, true);
      }
      return null;
    }
    if (this.starvedSince !== null) {
      this.stats.longestStarvedMs = Math.max(this.stats.longestStarvedMs, now() - this.starvedSince);
      this.starvedSince = null;
    }
    return this.consume(entry, context);
  }

  /** Docking stops consumption, so the follower can continue from the Depot while the truck brakes. */
  prepareDepotReset(distance, firstDistance) {
    this.promote(distance, firstDistance);
    this.prepared = {distance, consumed: this.consumed};
  }

  resetAfterDepot(distance, {firstDistance = distance} = {}) {
    const prepared = this.prepared;
    this.prepared = null;
    if (prepared && prepared.distance === distance && prepared.consumed === this.consumed) return;
    if (prepared) this.rebuild();
    this.promote(distance, firstDistance);
  }

  promote(distance, firstDistance) {
    const shadow = this.shadow;
    this.producer.terminate();
    this.buffer.clear();
    this.failure = this.followerFailure ? {index: this.consumed, message: this.followerFailure} : null;
    this.followerFailure = null;
    this.log.push({kind: 'reset', distance});
    this.fallbackStream = null;
    this.producer = shadow;
    this.origin = {firstDistance, context: depotExitContext(distance, this.levelId, this.mode)};
    this.starvedSince = null;
    this.producerHeardAt = now();
    this.producer.postMessage({type: 'produce', reset: distance, ...this.origin,
      allowance: this.consumed + ROUTE_STREAM_AHEAD_ROWS});
    this.follower = this.createFollower(this.log);
  }

  /** A silent producer is replaced by a fresh worker that replays the consumed log and plans the same rows. */
  restartProducer() {
    this.stats.restarts += 1;
    this.producer.terminate();
    this.buffer.clear();
    this.failure = null;
    this.producerHeardAt = now();
    this.producer = this.attach(takeWorker());
    this.producer.postMessage(this.config);
    if (this.log.length) this.producer.postMessage({type: 'apply', calls: this.log});
    this.producer.postMessage({type: 'produce', ...this.origin, allowance: this.consumed + ROUTE_STREAM_AHEAD_ROWS});
  }

  /** Rare path: a prepared reset did not match the actual resume, so replay the consumed log. */
  rebuild() {
    this.stats.rebuilds += 1;
    this.producer.terminate();
    this.follower?.terminate();
    this.log.pop();
    this.producer = {terminate() {}};
    this.follower = this.createFollower(this.log);
  }

  destroy() {
    this.producer.terminate();
    this.follower?.terminate();
    this.buffer.clear();
    this.fallbackStream = null;
  }
}

/** Browser runs plan in workers; hosts without workers (Node tests) keep the synchronous stream. */
export function createRouteStream(seed, levelId = 'level1', mode = 'normal',
  {startDistance = 0, firstDistance = startDistance} = {}) {
  if (!workersSupported()) return createTrackStream(seed, levelId, mode);
  try {
    return new BackgroundRouteStream(seed, levelId, mode, startDistance, firstDistance);
  } catch {
    return createTrackStream(seed, levelId, mode);
  }
}
