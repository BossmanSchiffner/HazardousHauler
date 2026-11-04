import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHUNK_REGISTRIES, createTrackStream, hazardsBeforeDepot, prepareTrackChunk,
  requiresLaneChanges, rowSpacingAtSpeed,
} from '../src/game/core/trackGenerator.js';
import {hazardDefinition, hazardGeometry, hazardHits, hazardX, hasStraightRoute, hazardArtOverlaps} from '../src/game/core/hazards.js';
import {driveTrackTransition, validateTrackSequence} from '../src/game/core/trackValidation.js';
import {routeSpeedAtDistance, METERS_PER_PIXEL} from '../src/game/core/economy.js';
import {IMPLEMENTED_SECTORS} from '../src/game/core/sectors.js';
import {HAZARD_TRAVEL_PX} from '../src/game/data/route.js';
import {depotApproachMeters} from '../src/game/core/depots.js';

test('every four-row window denies a straight lane or between-lane shortcut, including seeded chunk joins', () => {
  // Registries are legacy templates; production rows are procedural and certified by the seeded stream below.
  for (const chunks of Object.values(CHUNK_REGISTRIES)) for (const chunk of chunks) {
    assert.ok(chunk.rows.every(row => row.hazards.every(h => !hazardDefinition(h.kind).roadside || h.spanRows)),
      'every generated roadside obstruction is elongated; short gates are ordinary road hazards');
  }
  let windows = 0;
  const sizes = new Set();
  for (const seed of [1, 153, 1234, 98765]) {
    const stream = createTrackStream(seed);
    const recent = [];
    for (let i = 0; i < 600; i++) {
      const row = stream.nextRow(i * 15, true);
      sizes.add(row.hazards.filter(h => !h.continuation).length);
      // Owner rule: the Depot approach is deliberately clean, so unemitted rows break the window.
      if (row.emitted === false) {
        recent.length = 0;
        continue;
      }
      // Owner rule: an obstacle, Beta filler or pinch body blocks the corridor.
      recent.push({...row, hazards: [...row.hazards, ...row.intermediates]});
      if (recent.length > 4) recent.shift();
      if (recent.length === 4) {
        assert.ok(!hasStraightRoute(recent), `${seed}/${i}/${row.chunkId}`);
        windows++;
      }
    }
  }
  assert.ok(windows >= 2300);
  assert.ok(sizes.has(1) && sizes.has(2), 'single obstacles and pairs remain in production');
});

test('side structures are single continuous three/four-row bodies with exact full-length geometry', () => {
  for (const distance of IMPLEMENTED_SECTORS.map(sector => sector.startsAt)) {
    const sector = IMPLEMENTED_SECTORS.find(s => s.startsAt === distance);
    for (const chunk of CHUNK_REGISTRIES[sector.themeId].filter(c => c.family === 'roadside-weave')) {
      const rows = prepareTrackChunk(chunk, distance, () => 0).rows;
      const starts = rows.flatMap((row, phase) => row.hazards
        .filter(h => h.spanRows && !h.continuation).map(h => ({h, phase})));
      assert.deepEqual(starts.map(({h}) => h.spanRows), [3, 4]);
      assert.notEqual(starts[0].h.lane, starts[1].h.lane, 'sides alternate');
      assert.deepEqual(starts.map(({h}) => h.kind), ['sideRail', 'sideWall']);
      for (const {h, phase} of starts) {
        const spec = hazardGeometry(h);
        const spacing = rows[phase].spacingPx;
        assert.equal(h.lengthPx, (h.spanRows - 1) * spacing + hazardGeometry(h.kind).height,
          'span rows plus one modular guardrail body (never shorter than the guardrail minimum)');
        assert.equal(spec.footprint[0].halfHeight, h.lengthPx / 2 - 2);
        for (let p = 0; p < h.spanRows; p++) {
          const reference = rows[phase + p].hazards.find(other => other.kind === h.kind);
          assert.equal(reference.continuation, p > 0);
          assert.ok(Math.abs(reference.offsetY - p * spacing - h.offsetY) < 1e-9,
            'all occupied rows refer to the same world body, not disconnected blocks');
          assert.equal(reference.lengthPx, h.lengthPx);
          assert.equal(rows[phase + p].hazardLanes.filter(lane => h.lane === 0 ? lane < 1 : lane >= 3).length, 1,
            'every roadside body is a single-lane modular guardrail on its curb');
          for (const other of rows[phase + p].hazards.filter(other => !other.spanRows)) {
            assert.ok(!hazardArtOverlaps(reference, other), 'ordinary hazards do not overlap the long body');
          }
          for (const cargo of rows[phase + p].cargoLanes) {
            assert.ok(Math.abs([86, 159, 232, 305][cargo] - hazardX(h)) >= spec.hitX + 30);
          }
        }
        for (let y = -h.lengthPx / 2 + 3; y <= h.lengthPx / 2 - 3; y += 5) {
          assert.ok(hazardHits(h, hazardX(h), 0, hazardX(h), y), 'no collision gaps between rows');
        }
        assert.ok(!hazardHits(h, hazardX(h), 0, hazardX(h), spec.hitY), 'clear beyond the real trailing edge');
      }
    }
  }
});

test('continuous structures keep an open corridor at multiple speeds and frame rates', () => {
  const chunks = CHUNK_REGISTRIES.industrial.filter(c => c.family === 'roadside-weave');
  for (const distance of [IMPLEMENTED_SECTORS[0].startsAt, IMPLEMENTED_SECTORS[2].startsAt,
    IMPLEMENTED_SECTORS.at(-1).endsAt]) for (const chunk of chunks) {
    const rows = prepareTrackChunk(chunk, distance, () => 0).rows;
    const speed = routeSpeedAtDistance(distance + 100);
    // Owner rule: certify an open corridor (geometry only); upgrades decide who can drive it.
    for (const hz of [30, 60, 120]) {
      const result = validateTrackSequence(rows, speed, {hz, geometric: true, minimumClearancePx: 2});
      assert.ok(result.completed && result.clearance >= 2, `${chunk.id}/${speed}/${hz}: ${result.clearance}`);
    }
    const long = rows[2].hazards.find(h => h.spanRows);
    assert.ok(long.continuation);
    // Only the continuation body guards its curb lane; every other lane is walled off.
    const open = {...rows[1], hazards: [], intermediates: [], safeLanes: [0, 1, 2, 3]};
    const walls = [0, 1, 2, 3].filter(lane => lane !== long.lane)
      .map(lane => ({lane, kind: 'divider', offsetY: 0}));
    const interior = hazards => [open, {...rows[2], hazards, intermediates: [], safeLanes: [long.lane]}];
    const options = {geometric: true, minimumClearancePx: 0};
    assert.ok(validateTrackSequence(interior(walls), speed, options).completed, 'control: curb lane is open');
    assert.ok(!validateTrackSequence(interior([long, ...walls]), speed, options).completed,
      'validator must inspect the occupied interior, not just the spawning row');
  }
});

test('Depot safety rejects an entire long structure when its far end reaches the protected approach', () => {
  const chunk = CHUNK_REGISTRIES.industrial.find(c => c.family === 'roadside-weave');
  for (const distance of [IMPLEMENTED_SECTORS[0].startsAt, IMPLEMENTED_SECTORS.at(-1).endsAt]) {
    const rows = prepareTrackChunk(chunk, distance, () => 1).rows;
    const h = rows[1].hazards.find(h => h.spanRows);
    const row = {...rows[1], hazards: [h], intermediates: []};
    const leadingArrival = 450 - depotApproachMeters(450) - 1;
    const spawn = leadingArrival - (HAZARD_TRAVEL_PX - h.offsetY - hazardGeometry(h).hitY) * METERS_PER_PIXEL;
    assert.equal(hazardsBeforeDepot(row, spawn, 450), false, 'a safe leading edge cannot conceal an unsafe far end');
    assert.equal(hazardsBeforeDepot(row, 100, 2000), true);
    assert.equal(hazardsBeforeDepot({...row, hazards: [{...h, continuation: true}]}, spawn, 450), true,
      'continuations never respawn a previously rejected structure or suppress another whole approach');
  }
});

test('transitions preserve frozen Beta and long-body inputs across repeated calls', () => {
  const speed = routeSpeedAtDistance(IMPLEMENTED_SECTORS.at(-1).endsAt);
  const spacingPx = rowSpacingAtSpeed(speed);
  const previous = {
    spacingPx,
    hazards: [{kind: 'sideRail', lane: 0, offsetY: 0, lengthPx: 600, spanRows: 3}],
    intermediates: [{kind: 'divider', lane: 1, offsetY: -100, placement: 'beta'}],
  };
  const next = {
    spacingPx,
    hazards: [{...previous.hazards[0], offsetY: spacingPx, continuation: true}],
    intermediates: [{kind: 'divider', lane: 2, offsetY: -100, placement: 'beta'}],
  };
  const inputs = [previous, next];
  const before = structuredClone(inputs);
  const freeze = value => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  };
  freeze(inputs);

  const first = driveTrackTransition(previous, next, 3, 3, speed);
  assert.ok(first.completed);
  assert.ok(Number.isFinite(first.clearance));
  assert.deepEqual(driveTrackTransition(previous, next, 3, 3, speed), first);
  assert.deepEqual(inputs, before);
});
