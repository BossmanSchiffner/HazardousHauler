import {createTrackStream} from './trackGenerator.js';
import {depotExitContext, initialRouteContext} from './routeStreamPlanner.js';

/** Rows planned beyond the scene's consumption: roughly 15 s of driving at the fastest spacing. */
export const ROUTE_STREAM_AHEAD_ROWS = 48;
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
    this.levelId = levelId;
    this.mode = mode;
    this.log = [];
    this.buffer = new Map();
    this.consumed = 0;
    this.failure = null;
    this.followerFailure = null;
    this.prepared = null;
    this.stats = {starved: 0, contextMismatches: 0, rebuilds: 0, received: 0};
    this.producer = this.attach(takeWorker());
    this.producer.postMessage(this.config);
    this.producer.postMessage({type: 'produce', firstDistance,
      context: initialRouteContext(startDistance, levelId, mode), allowance: ROUTE_STREAM_AHEAD_ROWS});
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

  nextRow(_distance, context) {
    const entry = this.buffer.get(this.consumed);
    if (!entry) {
      if (this.failure && this.failure.index <= this.consumed) throw new Error(this.failure.message);
      this.stats.starved += 1;
      return null;
    }
    this.buffer.delete(this.consumed);
    this.consumed += 1;
    const shadow = this.shadow;
    this.log.push(entry.call);
    shadow.postMessage({type: 'apply', calls: [entry.call]});
    this.producer.postMessage({type: 'allow', allowance: this.consumed + ROUTE_STREAM_AHEAD_ROWS});
    if (context && (context.nextDepotDistance !== entry.call.context.nextDepotDistance ||
        context.protectedUntilDistance !== entry.call.context.protectedUntilDistance)) {
      this.stats.contextMismatches += 1;
    }
    return entry.row;
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
    this.producer = shadow;
    this.producer.postMessage({type: 'produce', reset: distance, firstDistance,
      context: depotExitContext(distance, this.levelId, this.mode),
      allowance: this.consumed + ROUTE_STREAM_AHEAD_ROWS});
    this.follower = this.createFollower(this.log);
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
