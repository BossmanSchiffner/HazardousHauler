import {createRoutePlanner, ROUTE_STREAM_HEARTBEAT_MS} from './routeStreamPlanner.js';

// Runs the unchanged generator off the render thread. Producers plan ahead; followers mirror consumed calls.
let planner = null;
let producing = false;
let allowance = 0;
let failed = false;
let pending = null;
let lastBeat = 0;

// A long plan or log replay is busy, not dead: tell the stall watchdog this worker is alive.
const heartbeat = () => {
  const time = performance.now();
  if (time - lastBeat < ROUTE_STREAM_HEARTBEAT_MS) return;
  lastBeat = time;
  self.postMessage({type: 'alive'});
};

const fail = (error, index) => {
  failed = true;
  producing = false;
  self.postMessage({type: 'error', index, message: String(error?.message ?? error)});
};

const pump = () => {
  pending = null;
  if (!producing || failed || planner.rows >= allowance) return;
  const index = planner.rows;
  try {
    const {call, row} = planner.produce();
    self.postMessage({type: 'row', index, call, row});
  } catch (error) {
    fail(error, index);
    return;
  }
  schedule();
};

// Yield between rows so allowance and termination messages are handled promptly.
const schedule = () => {
  if (pending === null) pending = setTimeout(pump, 0);
};

self.onmessage = ({data}) => {
  if (failed) return;
  try {
    if (data.type === 'init') {
      planner = createRoutePlanner(data.seed, data.levelId, data.mode, {onPlanningProgress: heartbeat});
    } else if (data.type === 'apply') {
      for (const call of data.calls) {
        heartbeat();
        planner.apply(call);
      }
    } else if (data.type === 'produce') {
      if (data.reset !== undefined) planner.apply({kind: 'reset', distance: data.reset});
      planner.begin(data);
      producing = true;
      allowance = data.allowance;
      schedule();
    } else if (data.type === 'allow') {
      allowance = Math.max(allowance, data.allowance);
      schedule();
    }
  } catch (error) {
    fail(error, planner?.rows ?? 0);
  }
};
