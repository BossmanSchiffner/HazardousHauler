import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createTrackStream} from '../src/game/core/trackGenerator.js';
import {DEPOT_RULES, nextDepotAfter} from '../src/game/core/depots.js';
import {METERS_PER_PIXEL} from '../src/game/core/economy.js';
import {
  advanceRouteContext, createRoutePlanner, depotExitContext, initialRouteContext, ROUTE_STREAM_HEARTBEAT_MS,
} from '../src/game/core/routeStreamPlanner.js';
import {
  createRouteStream, ROUTE_STREAM_AHEAD_ROWS, ROUTE_STREAM_FALLBACK_MS,
  ROUTE_STREAM_LATE_ROW_MS, ROUTE_STREAM_STALL_MS,
} from '../src/game/core/routeStream.js';

const workerSource = readFileSync(new URL('../src/game/core/routeStreamWorker.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '');

/** Runs the real worker module in its own VM context with asynchronous, cloned message passing. */
class VmWorker {
  static created = 0;

  constructor() {
    VmWorker.created += 1;
    this.terminated = false;
    this.self = {postMessage: data => setImmediate(() => {
      if (!this.terminated) this.onmessage?.({data: structuredClone(data)});
    })};
    vm.runInNewContext(workerSource, {
      createRoutePlanner, ROUTE_STREAM_HEARTBEAT_MS, performance: VmWorker.clock ?? performance,
      self: this.self, String,
      setTimeout: (fn, ms) => setTimeout(() => { if (!this.terminated) fn(); }, ms),
    });
  }

  postMessage(data) {
    const copy = structuredClone(data);
    setImmediate(() => { if (!this.terminated) this.self.onmessage({data: copy}); });
  }

  terminate() {
    this.terminated = true;
  }
}

async function withWorkers(run) {
  const previous = globalThis.Worker;
  globalThis.Worker = VmWorker;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete globalThis.Worker;
    else globalThis.Worker = previous;
  }
}

async function nextRow(stream, context) {
  for (let attempt = 0; attempt < 100000; attempt++) {
    const row = stream.nextRow(0, context);
    if (row) return row;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('Background row never arrived');
}

function replay(seed, levelId, mode, calls) {
  const stream = createTrackStream(seed, levelId, mode);
  return calls.flatMap(call => call.kind === 'reset'
    ? (stream.resetAfterDepot(call.distance), [])
    : [structuredClone(stream.nextRow(call.distance, call.context))]);
}

test('route planner rows equal the synchronous track stream for the same calls', () => {
  const planner = createRoutePlanner(153, 'level1', 'normal');
  planner.begin({firstDistance: 3, context: initialRouteContext(0, 'level1', 'normal')});
  const produced = Array.from({length: 24}, () => planner.produce());
  assert.deepEqual(replay(153, 'level1', 'normal', produced.map(item => item.call)), produced.map(item => item.row));
  for (let i = 1; i < produced.length; i++) {
    const prior = produced[i - 1].row;
    assert.equal(produced[i].call.distance, prior.plannedDistance + prior.spacingPx * METERS_PER_PIXEL);
  }
});

test('route context rule matches the scene Depot advance', () => {
  for (const [levelId, mode] of [['level1', 'normal'], ['level2', 'normal'], ['level1', 'continuous']]) {
    const start = initialRouteContext(0, levelId, mode);
    const first = nextDepotAfter(0, DEPOT_RULES, levelId, mode).distance;
    assert.deepEqual(start, {nextDepotDistance: first, protectedUntilDistance: 0});
    assert.equal(advanceRouteContext(start, first, levelId, mode), start);
    const second = nextDepotAfter(first, DEPOT_RULES, levelId, mode).distance;
    assert.deepEqual(advanceRouteContext(start, first + 0.01, levelId, mode),
      {nextDepotDistance: second, protectedUntilDistance: first + DEPOT_RULES.exitMeters});
    assert.deepEqual(depotExitContext(first, levelId, mode),
      {nextDepotDistance: second, protectedUntilDistance: first + DEPOT_RULES.exitMeters});
    assert.deepEqual(advanceRouteContext(start, second + 1, levelId, mode), depotExitContext(second, levelId, mode));
  }
});

test('route stream falls back to the synchronous track stream without workers', () => {
  assert.equal(typeof globalThis.Worker, 'undefined');
  const stream = createRouteStream(7, 'level2', 'normal', {startDistance: 0, firstDistance: 4});
  assert.equal(stream.prepareDepotReset, undefined);
  assert.deepEqual(stream.nextRow(4, initialRouteContext(0, 'level2', 'normal')),
    createTrackStream(7, 'level2', 'normal').nextRow(4, initialRouteContext(0, 'level2', 'normal')));
});

test('background route stream replays exactly through Depot bypass and docking resets', async () => {
  await withWorkers(async () => {
    const seed = 22;
    const stream = createRouteStream(seed, 'level1', 'normal', {startDistance: 0, firstDistance: 5});
    try {
      assert.equal(typeof stream.prepareDepotReset, 'function');
      const rows = [];
      let context = initialRouteContext(0, 'level1', 'normal');
      const firstDepot = context.nextDepotDistance;
      // Bypass the first Depot like the scene: rows past it see the advanced context.
      while (rows.length < 70 && (rows.at(-1)?.plannedDistance ?? 0) < firstDepot + 60) {
        const row = await nextRow(stream, context);
        rows.push(row);
        const following = row.plannedDistance + row.spacingPx * METERS_PER_PIXEL;
        context = advanceRouteContext(context, following, 'level1', 'normal');
      }
      const secondDepot = context.nextDepotDistance;
      // Dock at the second Depot; the shadow branch is prepared during braking and promoted on resume.
      stream.prepareDepotReset(secondDepot, secondDepot + 9);
      stream.resetAfterDepot(secondDepot, {firstDistance: secondDepot + 9});
      context = depotExitContext(secondDepot, 'level1', 'normal');
      const afterDock = await nextRow(stream, context);
      rows.push(afterDock);
      assert.equal(stream.log.at(-1).distance, secondDepot + 9);
      for (let i = 0; i < 6; i++) rows.push(await nextRow(stream, context));
      // A resume that differs from the prepared reset rebuilds from the consumed log.
      const lastDistance = rows.at(-1).plannedDistance;
      stream.prepareDepotReset(lastDistance + 40, lastDistance + 45);
      stream.resetAfterDepot(lastDistance + 41, {firstDistance: lastDistance + 46});
      context = depotExitContext(lastDistance + 41, 'level1', 'normal');
      for (let i = 0; i < 4; i++) rows.push(await nextRow(stream, context));
      assert.equal(stream.stats.rebuilds, 1);
      assert.equal(stream.stats.contextMismatches, 0);
      assert.deepEqual(stream.log.filter(call => call.kind === 'reset').map(call => call.distance),
        [secondDepot, lastDistance + 41]);
      assert.deepEqual(rows, replay(seed, 'level1', 'normal', stream.log));
    } finally {
      stream.destroy();
    }
  });
});

test('background route stream stays a bounded distance ahead of consumption', async () => {
  await withWorkers(async () => {
    const stream = createRouteStream(9001, 'level1', 'continuous', {startDistance: 0, firstDistance: 2});
    try {
      await nextRow(stream, initialRouteContext(0, 'level1', 'continuous'));
      for (let i = 0; i < 400 && stream.bufferedRows < ROUTE_STREAM_AHEAD_ROWS; i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.ok(stream.bufferedRows <= ROUTE_STREAM_AHEAD_ROWS);
      assert.ok(stream.bufferedRows >= ROUTE_STREAM_AHEAD_ROWS - 1);
    } finally {
      stream.destroy();
    }
  });
});

// Holding delivered rows back models a worker that is still planning or starved of CPU.
const starvedRow = (stream, context) => {
  const held = new Map(stream.buffer);
  stream.buffer.clear();
  const row = stream.nextRow(0, context);
  for (const [index, entry] of held) if (index >= stream.consumed) stream.buffer.set(index, entry);
  return row;
};

test('a starved background stream deterministically falls back before late rows can clear the road', async () => {
  await withWorkers(async () => {
    const seed = 41;
    const stream = createRouteStream(seed, 'level1', 'normal', {startDistance: 0, firstDistance: 6});
    try {
      let context = initialRouteContext(0, 'level1', 'normal');
      assert.equal(starvedRow(stream, context), null, 'a just-due row waits for the worker');
      await new Promise(resolve => setTimeout(resolve, ROUTE_STREAM_FALLBACK_MS + 20));
      const firstFallback = starvedRow(stream, context);
      assert.ok(firstFallback, 'a certified row arrives before the scene late-row cutoff');
      assert.equal(stream.stats.fallbackRows, 1);
      assert.equal(stream.consumed, 1);
      const rows = [firstFallback];
      context = advanceRouteContext(context, firstFallback.plannedDistance +
        firstFallback.spacingPx * METERS_PER_PIXEL, 'level1', 'normal');
      for (let i = 1; i < 12; i++) {
        const row = await nextRow(stream, context);
        rows.push(row);
        context = advanceRouteContext(context, row.plannedDistance + row.spacingPx * METERS_PER_PIXEL, 'level1', 'normal');
      }
      const depot = context.nextDepotDistance;
      stream.prepareDepotReset(depot, depot + 7);
      stream.resetAfterDepot(depot, {firstDistance: depot + 7});
      context = depotExitContext(depot, 'level1', 'normal');
      assert.equal(starvedRow(stream, context), null, 'the Depot exit row also waits for the worker');
      await new Promise(resolve => setTimeout(resolve, ROUTE_STREAM_FALLBACK_MS + 20));
      const exitFallback = starvedRow(stream, context);
      assert.ok(exitFallback, 'the Depot exit also uses deterministic fallback');
      rows.push(exitFallback);
      context = advanceRouteContext(context, exitFallback.plannedDistance +
        exitFallback.spacingPx * METERS_PER_PIXEL, 'level1', 'normal');
      for (let i = 1; i < 5; i++) {
        const row = await nextRow(stream, context);
        rows.push(row);
        context = advanceRouteContext(context, row.plannedDistance + row.spacingPx * METERS_PER_PIXEL,
          'level1', 'normal');
      }
      assert.equal(stream.log.at(-5).distance, depot + 7, 'the worker restarts from the Depot exit origin');
      assert.ok(stream.stats.fallbackRows >= 2);
      assert.ok(stream.stats.starved >= 3);
      assert.ok(stream.stats.longestStarvedMs >= ROUTE_STREAM_FALLBACK_MS);
      assert.deepEqual(rows, replay(seed, 'level1', 'normal', stream.log));
    } finally {
      stream.destroy();
    }
  });
});

test('a worker error immediately falls back to the same emitted obstacle row', async () => {
  await withWorkers(async () => {
    const seed = 2026;
    const stream = createRouteStream(seed, 'level1', 'normal', {startDistance: 0, firstDistance: 6});
    try {
      const context = initialRouteContext(0, 'level1', 'normal');
      stream.receive(stream.producer, {type: 'error', index: 0, message: 'worker module failure'});
      const row = stream.nextRow(6, context);
      assert.ok(row.emitted && row.plannedObstacleCount > 0);
      assert.equal(stream.stats.fallbackRows, 1);
      assert.deepEqual(row, replay(seed, 'level1', 'normal', stream.log)[0]);
    } finally {
      stream.destroy();
    }
  });
});

test('a silent dead producer falls back immediately and is still respawned from the consumed log', async () => {
  await withWorkers(async () => {
    const seed = 777;
    const stream = createRouteStream(seed, 'level1', 'normal', {startDistance: 0, firstDistance: 4});
    const due = async context => {
      for (let waited = 0; waited < ROUTE_STREAM_STALL_MS * 3; waited += 10) {
        const row = stream.nextRow(0, context);
        if (row) return row;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error('Respawned producer never delivered');
    };
    try {
      // A worker that never answers and never raises an error, as when its module fails to start.
      stream.producer.terminate();
      let context = initialRouteContext(0, 'level1', 'normal');
      const rows = [];
      for (let i = 0; i < 6; i++) {
        const row = await due(context);
        rows.push(row);
        context = advanceRouteContext(context, row.plannedDistance + row.spacingPx * METERS_PER_PIXEL, 'level1', 'normal');
      }
      assert.ok(stream.stats.fallbackRows >= 1, 'a certified row arrives before the worker restart window');
      await new Promise(resolve => setTimeout(resolve, ROUTE_STREAM_STALL_MS + 20));
      let row = stream.nextRow(0, context);
      assert.ok(row, 'fallback continues during producer recovery');
      rows.push(row);
      context = advanceRouteContext(context, row.plannedDistance + row.spacingPx * METERS_PER_PIXEL, 'level1', 'normal');
      assert.equal(stream.stats.restarts, 1);
      assert.ok(stream.stats.longestStarvedMs >= ROUTE_STREAM_STALL_MS, 'starvation is measured across the respawn');
      stream.producer.terminate();
      stream.buffer.clear();
      await new Promise(resolve => setTimeout(resolve, ROUTE_STREAM_STALL_MS + 20));
      row = stream.nextRow(0, context);
      assert.ok(row, 'fallback continues when the replacement producer also dies');
      rows.push(row);
      assert.equal(stream.stats.restarts, 2, 'a producer that dies mid-run is replaced as well');
      assert.deepEqual(rows, replay(seed, 'level1', 'normal', stream.log));
    } finally {
      stream.destroy();
    }
  });
});

test('a busy producer that keeps sending heartbeats is never replaced, and its planner emits them', async () => {
  await withWorkers(async () => {
    const stream = createRouteStream(4242, 'level1', 'normal', {startDistance: 0, firstDistance: 4});
    try {
      // Silence real rows; only liveness heartbeats arrive while the scene stays starved past the stall window.
      const busy = stream.producer;
      busy.terminate();
      stream.buffer.clear();
      let context = initialRouteContext(0, 'level1', 'normal');
      let fallbackRows = 0;
      const started = Date.now();
      while (Date.now() - started < ROUTE_STREAM_STALL_MS * 1.5) {
        stream.receive(busy, {type: 'alive'});
        const row = stream.nextRow(0, context);
        if (row) {
          fallbackRows++;
          context = advanceRouteContext(context, row.plannedDistance + row.spacingPx * METERS_PER_PIXEL,
            'level1', 'normal');
        }
        await new Promise(resolve => setTimeout(resolve, ROUTE_STREAM_HEARTBEAT_MS));
      }
      assert.equal(stream.stats.restarts, 0, 'a slow but live worker keeps its planning state');
      assert.ok(fallbackRows > 0, 'heartbeat liveness does not block certified fallback rows');
    } finally {
      stream.destroy();
    }
    // Every planner step reports progress, throttled to the heartbeat cadence, without changing rows.
    let clock = 0;
    VmWorker.clock = {now: () => (clock += ROUTE_STREAM_HEARTBEAT_MS)};
    try {
      const worker = new VmWorker();
      const messages = [];
      worker.onmessage = ({data}) => messages.push(data.type);
      worker.postMessage({type: 'init', seed: 4242, levelId: 'level1', mode: 'normal'});
      const context0 = initialRouteContext(0, 'level1', 'normal');
      worker.postMessage({type: 'produce', firstDistance: 4, context: context0, allowance: 2});
      for (let waited = 0; messages.filter(type => type === 'row').length < 2 && waited < 2000; waited++) {
        await new Promise(resolve => setImmediate(resolve));
      }
      worker.terminate();
      assert.equal(messages.filter(type => type === 'row').length, 2);
      assert.ok(messages.includes('alive'), 'planning progress reaches the stream as a heartbeat');
    } finally {
      delete VmWorker.clock;
    }
  });
});

test('late worker rows keep the deterministic route after repeated starvation', async () => {
  await withWorkers(async () => {
    const seed = 1234;
    const stream = createRouteStream(seed, 'level1', 'normal', {startDistance: 0, firstDistance: 3});
    try {
      let context = initialRouteContext(0, 'level1', 'normal');
      const rows = [];
      for (let i = 0; i < 40; i++) {
        // Two of every three demands find the due row missing, as on a CPU-starved device.
        if (i % 3) assert.equal(starvedRow(stream, context), null);
        const row = await nextRow(stream, context);
        rows.push(row);
        context = advanceRouteContext(context, row.plannedDistance + row.spacingPx * METERS_PER_PIXEL, 'level1', 'normal');
      }
      assert.ok(stream.stats.starved >= 26);
      assert.deepEqual(rows, replay(seed, 'level1', 'normal', stream.log));
    } finally {
      stream.destroy();
    }
  });
});
