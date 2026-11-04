import test from 'node:test';
import assert from 'node:assert/strict';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';
import {DEPOT_RULES, nextDepotAfter, nextMoverWindowAfter} from '../src/game/core/depots.js';
import {hazardBlockedIntervals, routeHazardBlockedIntervals, usesPotentialMoverLanes, usesTimedMoverLanes, movingHazardQuota,
  hazardFirstContactDistance, hazardSweptArtOverlaps, movingHazardOffset, hazardRouteGeometry,
  hazardRouteOffsetY, hazardGeometry, hazardHits, hazardScrollScale, projectPhysicalEvents, LANE_CENTERS}
  from '../src/game/core/hazards.js';
import {physicalPressureMetrics} from '../src/game/core/hazards.js';
import {createTrackGenerator, movingEncounterRows} from '../src/game/core/trackGenerator.js';
import {HAZARD_TRAVEL_PX, SHIP_Y, SPAWN_Y} from '../src/game/data/route.js';
import {HAZARD_ROW_ENVELOPE_PX} from '../src/game/core/hazards.js';
import {hazardClearance, validateTrackSequence} from '../src/game/core/trackValidation.js';
import {METERS_PER_PIXEL, routeTimeAtDistance, routeSpeedAtDistance} from '../src/game/core/economy.js';
import {IMPLEMENTED_LEVELS} from '../src/game/core/sectors.js';
import {sampleRoute} from '../scripts/route-audit.mjs';

const lanes = [0, 1, 2, 3];
const baseline = {load: 5.5, capacity: 11, handling: 0, reactionSeconds: 0.8,
  levelId: 'level2', mode: 'normal'};
const empty = {hazards: [], intermediates: [], safeLanes: lanes, spacingPx: 1200};
const safe = hazards => lanes.filter(lane => !hazards.flatMap(routeHazardBlockedIntervals)
  .some(([left, right]) => LANE_CENTERS[lane] > left && LANE_CENTERS[lane] < right));
const moverOf = row => row.hazards.find(hazard => hazard.movement);

test('moving forklift warns for exactly 0.5 seconds before a bounded lateral patrol', () => {
  const mover = moverOf(movingEncounterRows(1500, 1200)[0]);
  assert.equal(mover.kind, 'forklift');
  const movement = {...mover.movement, phase: 0, direction: 1};
  for (const seconds of [0, 0.1, 0.499, 0.5]) assert.equal(movingHazardOffset(movement, seconds), 0);
  assert.equal(movingHazardOffset(movement, 0.75), 19);
  assert.equal(movingHazardOffset(movement, 0.5 + 146 / 76), 146);
  assert.equal(movingHazardOffset(movement, 0.5 + 292 / 76), 0);
  assert.equal(hazardScrollScale(mover), 1);
});

test('moving sweeper stays in one lane at half track speed and shares exact physical route geometry', () => {
  const rows = movingEncounterRows(1500, 1200, {kind: 'sweeper'});
  const mover = moverOf(rows[0]);
  const physical = hazardGeometry(mover);
  assert.equal(hazardScrollScale(mover), 0.5);
  assert.equal(hazardRouteOffsetY(mover), 0);
  assert.equal(hazardRouteGeometry(mover).hitY, physical.hitY * 2);
  for (const elapsed of [0, 0.5, 5, 100]) assert.equal(movingHazardOffset(mover.movement, elapsed), 0);
  for (const routeY of [-160, -100, -90.01, -89.99, -10, 0, 10, 89.99, 90.01, 160]) {
    const scroll = HAZARD_TRAVEL_PX + routeY;
    const actualY = SPAWN_Y + mover.offsetY + scroll * hazardScrollScale(mover);
    for (const x of [LANE_CENTERS[mover.lane], LANE_CENTERS[mover.lane] + physical.hitX - 0.01,
      LANE_CENTERS[mover.lane] + physical.hitX + 0.01]) {
      assert.equal(hazardClearance(mover, routeY, x, 0) < 0,
        hazardHits(mover, LANE_CENTERS[mover.lane], actualY, x, SHIP_Y));
      const dx = Math.abs(x - LANE_CENTERS[mover.lane]) - physical.hitX;
      const dy = Math.abs(actualY - SHIP_Y) - physical.hitY;
      const liveClearance = Math.hypot(Math.max(0, dx), Math.max(0, dy)) + Math.min(0, Math.max(dx, dy));
      assert.ok(Math.abs(hazardClearance(mover, routeY, x, 0) - liveClearance) < 1e-10,
        'the required clearance is measured in physical px, not doubled route-projection px');
    }
  }
  const projection = projectPhysicalEvents(rows, {levelId: 'level2'});
  const body = projection.bodies.find(body => body.hazard === mover);
  assert.equal(body.center, 1500 + HAZARD_TRAVEL_PX * METERS_PER_PIXEL);
  assert.equal(hazardFirstContactDistance(mover, 1500),
    1500 + (HAZARD_TRAVEL_PX - physical.hitY * 2) * METERS_PER_PIXEL);
  for (const ratio of [0, 1, NaN, -1]) assert.throws(() =>
    hazardScrollScale({...mover, movement: {axis: 'forward', forwardSpeedRatio: ratio}}), /Invalid/);
});

test('moving sweeper and forklift encounters retain connected 6px physical clearance at Normal speeds and reject walls', () => {
  for (const kind of ['forklift', 'sweeper']) for (const mirrored of [false, true]) {
    const rows = movingEncounterRows(1500, 1200, {kind, mirrored});
    for (const hz of [30, 60, 120]) {
      const proof = validateTrackSequence([empty, ...rows], 440,
        {...baseline, mode: 'normal', hz, minimumClearancePx: 6});
      assert.equal(proof.completed, true, `${kind}/${mirrored}/${hz}: ${proof.clearance}`);
      assert.ok(proof.clearance >= 6);
      assert.equal(proof.approximateMovingSafety, undefined);
      const wall = {...rows[0], hazards: [...rows[0].hazards, ...lanes.map(lane =>
        ({kind: 'barrier', lane, offsetX: 0, offsetY: 0}))], safeLanes: lanes};
      assert.equal(validateTrackSequence([empty, wall], 680, {...baseline, mode: 'normal', hz}).completed, false);
      if (kind === 'forklift' && mirrored) {
        assert.equal(validateTrackSequence([empty, ...rows], 680,
          {...baseline, mode: 'normal', hz, minimumClearancePx: 6}).completed, false,
        'a Normal-authored short recovery must not be certified at unsupported Level 2 speeds');
      }
    }
  }
});

test('controlled movers: half-open quotas follow real banks and Normal finish, then endless sections', () => {
  for (const levelId of ['level1', 'level2']) {
    const sectors = IMPLEMENTED_LEVELS[levelId];
    const finish = GAME_BALANCE.routes[levelId].finishDistanceMeters;
    const depots = sectors.slice(1).map(sector => sector.startsAt);
    for (const [index, sector] of sectors.entries()) {
      const end = sectors[index + 1]?.startsAt ?? finish;
      for (const at of [sector.startsAt, end - 0.001]) {
        const interval = nextMoverWindowAfter(at, DEPOT_RULES, levelId);
        assert.equal(interval.startDistance, sector.startsAt, `${levelId}@${at}`);
        assert.equal(interval.distance, end, `${levelId}@${at}`);
        assert.equal(nextDepotAfter(at, DEPOT_RULES, levelId).distance, depots[index] ?? Infinity);
      }
    }
    for (const at of [finish, finish + 2000]) {
      const interval = nextMoverWindowAfter(at, DEPOT_RULES, levelId);
      assert.equal(interval.startDistance, finish);
      assert.equal(interval.distance, Infinity, 'past the finish there is no further bank');
    }
    assert.throws(() => nextMoverWindowAfter(0, DEPOT_RULES, levelId, 'overdrive'), /Invalid Depot schedule/);
  }
  const cadence = GAME_BALANCE.routes.continuous.depotIntervalMeters;
  for (const [at, start] of [[0, 0], [cadence - 0.001, 0], [cadence, cadence],
    [5 * cadence + 1, 5 * cadence], [100 * cadence, 100 * cadence]]) {
    const interval = nextMoverWindowAfter(at, DEPOT_RULES, 'level1', 'continuous');
    assert.equal(interval.startDistance, start);
    assert.equal(interval.distance, start + cadence);
    assert.equal(interval.distance, nextDepotAfter(at, DEPOT_RULES, 'level1', 'continuous').distance);
  }
  assert.throws(() => nextMoverWindowAfter(0, DEPOT_RULES, 'level2', 'continuous'), /Continuous Run/);
});

test('controlled movers: inclusive range is four to fourteen physical bodies, not encounters', () => {
  for (const count of [4, 5, 13, 14]) assert.equal(movingHazardQuota(count).acceptable, true);
  for (const count of [0, 3, 15]) assert.equal(movingHazardQuota(count).acceptable, false);
  for (const count of [-1, 4.5, NaN]) assert.throws(() => movingHazardQuota(count), /Invalid emitted/);
  const pair = movingEncounterRows(3000, 1200, {paired: true});
  assert.equal(pair.flatMap(row => row.hazards).filter(hazard => hazard.movement).length, 2);
});

test('controlled movers: both mirrors sweep all three available lanes beside a native outer filler', () => {
  for (const mirrored of [false, true]) {
    const rows = movingEncounterRows(3000, 1200, {mirrored, paired: true});
    for (const row of rows.filter(row => moverOf(row))) {
      const mover = moverOf(row);
      assert.equal(usesTimedMoverLanes(mover), true);
      assert.equal(usesPotentialMoverLanes(mover), false);
      const companion = row.hazards.find(hazard => hazard.moverCompanion);
      assert.equal(mover.lane, companion.lane === 0 ? 1 : 0);
      assert.deepEqual(mover.openingLanes, companion.lane === 0 ? [1, 2, 3] : [0, 1, 2]);
      assert.equal(mover.movement.maxOffsetPx, 146);
      assert.ok(['rockSlab', 'wreckage'].includes(companion.kind));
      assert.ok([0, 3].includes(companion.lane));
      assert.equal(companion.offsetY, mover.offsetY);
      assert.equal(hazardSweptArtOverlaps(mover, companion, 0, 0), false,
        'the intentional companion may use the existing 4.5px art gap, not overlap a sprite');
      assert.ok(!row.safeLanes.includes(companion.lane));
    }
    const mover = moverOf(rows[0]);
    const warning = GAME_BALANCE.routes.movingHazards.forkliftWarningSeconds;
    const offsets = [0, warning + 73 / 76, warning + 146 / 76, warning + 292 / 76].map(time =>
      movingHazardOffset({...mover.movement, phase: 0, direction: 1}, time));
    assert.deepEqual(offsets, [0, 73, 146, 0]);
  }
});

test('controlled movers: complementary pairs are exactly two rows apart in both mirrors and reversals', () => {
  for (const mirrored of [false, true]) for (const reversed of [false, true]) {
    const rows = movingEncounterRows(3000, 1200, {mirrored, reversed, paired: true,
      phase: mirrored ? LANE_CENTERS[2] - LANE_CENTERS[0] : 0});
    const first = moverOf(rows[0]), second = moverOf(rows[2]);
    assert.equal(moverOf(rows[1]), undefined);
    assert.ok(Math.abs(rows[2].plannedDistance - rows[0].plannedDistance -
      (rows[0].spacingPx + rows[1].spacingPx) * METERS_PER_PIXEL) < 1e-8);
    assert.equal(second.movement.direction, -first.movement.direction);
    const delta = routeTimeAtDistance(rows[2].plannedDistance, 'level2', 'normal') -
      routeTimeAtDistance(rows[0].plannedDistance, 'level2', 'normal');
    const warning = GAME_BALANCE.routes.movingHazards.forkliftWarningSeconds;
    for (const seconds of [warning, warning + 0.5, warning + 1, warning + 2]) {
      const firstOffset = movingHazardOffset(first.movement, delta + seconds);
      const secondOffset = movingHazardOffset(second.movement, seconds);
      assert.ok(Math.abs(firstOffset + secondOffset - 146) < 1e-8,
        'complementary motion shares the canonical clock despite different spawn rows');
    }
    const proof = validateTrackSequence([empty, ...rows], 440, baseline);
    assert.equal(proof.completed, true, JSON.stringify({mirrored, reversed, proof}));
    assert.ok(proof.clearance >= 6);
    assert.equal(proof.approximateMovingSafety, undefined, 'central movers are evaluated with the canonical clock');
    assert.ok([1, 2].every(lane => rows[1].safeLanes.includes(lane)));
    assert.ok([1, 2].every(lane => rows[3].safeLanes.includes(lane)));
    assert.ok(rows[2].hazards.some(hazard => hazard.moverCompanion &&
      hazard.lane !== rows[0].hazards.find(hazard => hazard.moverCompanion).lane),
    'the second companion alternates the occupied shoulder');
  }
});

test('controlled movers: potential lanes still reject a closed static route and unreachable connectivity', () => {
  const rows = movingEncounterRows(3000, 1200);
  const mover = moverOf(rows[0]);
  const closed = {...rows[0], hazards: [mover, ...lanes.map(lane =>
    ({kind: 'divider', lane, offsetX: 0, offsetY: 0}))]};
  closed.safeLanes = safe(closed.hazards);
  assert.deepEqual(closed.safeLanes, []);
  assert.equal(validateTrackSequence([empty, closed], 440, baseline).completed, false);
  const isolated = {...rows[0], safeLanes: [2]};
  assert.equal(validateTrackSequence([{...empty, safeLanes: [0]}, isolated], 440, baseline).completed, false);
  const companion = rows[0].hazards.find(hazard => hazard.moverCompanion);
  assert.ok(hazardClearance(companion, 0, LANE_CENTERS[companion.lane]) < 0);
  const pair = movingEncounterRows(3000, 1200, {paired: true});
  pair[2] = {...pair[2], hazards: [...pair[2].hazards, ...lanes.map(lane =>
    ({kind: 'divider', lane, offsetX: 0, offsetY: 0}))], safeLanes: []};
  assert.equal(validateTrackSequence([empty, ...pair], 440, baseline).completed, false,
    'an invalid second mover row must reject the combined encounter');
  const noAnchor = {...rows[0], plannedDistance: undefined};
  assert.throws(() => validateTrackSequence([empty, noAnchor], 440, baseline), /source distance/);
});

test('controlled movers: untagged and other-span movers keep conservative swept geometry and collisions', () => {
  const row = movingEncounterRows(3000, 1200)[0];
  const tagged = moverOf(row);
  const legacy = {...tagged, routeValidation: undefined};
  assert.deepEqual(routeHazardBlockedIntervals(legacy), hazardBlockedIntervals(legacy));
  assert.ok(hazardClearance(legacy, 0, LANE_CENTERS[2]) < 0);
  assert.equal(hazardClearance(tagged, 0, LANE_CENTERS[2]),
    hazardClearance(legacy, 0, LANE_CENTERS[2]), 'no elapsed time means conservative swept clearance');
  const otherSpan = {...tagged, movement: {...tagged.movement, maxOffsetPx: 219}};
  assert.equal(usesPotentialMoverLanes(otherSpan), false);
  assert.deepEqual(routeHazardBlockedIntervals(otherSpan), hazardBlockedIntervals(otherSpan));
  const hazards = row.hazards.map(hazard => hazard === tagged ? legacy : hazard);
  assert.deepEqual(safe(hazards), [], 'all three available lanes require timed, not swept, certification');
  const closed = [...hazards, {kind: 'divider', lane: 3, offsetX: 0, offsetY: 0}];
  assert.deepEqual(safe(closed), []);
  assert.equal(validateTrackSequence([empty, {...row, hazards: closed, safeLanes: safe(closed)}], 440, baseline).completed, false);
  assert.ok(hazardClearance(tagged, 0, LANE_CENTERS[2], 73 / 76) < 0,
    'actual elapsed-time collision queries use the moving collider');
});

test('controlled movers: actual accounting rejects duplicate rows, quota overflow and incomplete closed intervals', () => {
  const generator = createTrackGenerator(1, 'level2');
  const mover = moverOf(movingEncounterRows(0, 1200)[0]);
  const recorded = [];
  for (let index = 0; index < 14; index++) {
    const row = {...empty, plannedDistance: 100 + index * 20, hazards: [{...mover}]};
    recorded.push(row);
    generator.recordSpawn(row, true, row.plannedDistance);
  }
  assert.throws(() => generator.recordSpawn(recorded[0], true, recorded[0].plannedDistance), /already recorded/);
  const extra = {...empty, plannedDistance: 400, hazards: [{...mover}]};
  assert.throws(() => generator.recordSpawn(extra, true, 400), /quota cap exceeded/);
  const incomplete = createTrackGenerator(1, 'level2');
  incomplete.recordSpawn({...empty, plannedDistance: 9}, false, 9);
  const contactLead = hazardFirstContactDistance(mover, 0);
  const moving = GAME_BALANCE.routes.movingHazards;
  const firstWindow = IMPLEMENTED_LEVELS.level2[moving.firstSector - 1];
  const firstBank = IMPLEMENTED_LEVELS.level2[moving.firstSector].startsAt;
  const introduction = firstWindow.startsAt - contactLead;
  assert.doesNotThrow(() => incomplete.recordSpawn({...empty, plannedDistance: introduction}, false, introduction),
    'the opening sector precedes Forklift introduction and has no moving quota');
  const atBoundary = firstBank - contactLead;
  assert.throws(() => incomplete.recordSpawn({...empty, plannedDistance: atBoundary}, false, atBoundary),
    new RegExp(`Moving quota failed.*"start":${firstWindow.startsAt},"depot":${firstBank}.*"required":${moving.minimumPerWindow}`));
});

test('controlled moving encounters: real Normal selection emits optional chicanes with both mover behaviors', context => {
  const rows = sampleRoute(98765, 4000, false, 'level2', 'normal', 1000);
  const counts = new Map([[2000, 0], [3000, 0], [4000, 0]]);
  const orientations = new Set();
  const encounters = new Map();
  let paired = 0, movers = 0;
  for (const row of rows) {
    assert.ok([GAME_BALANCE.routes.track.encounters.candidateBudget,
      GAME_BALANCE.routes.track.encounters.densityRecovery.candidateBudget].includes(row.candidateBudget));
    assert.ok(row.candidateAttempts <= row.candidateBudget);
    assert.ok(row.certificates.every(proof => proof.completed && proof.clearance >= 6));
    if (row.family === 'moving_intercept') {
      if (!encounters.has(row.encounterId)) encounters.set(row.encounterId, []);
      encounters.get(row.encounterId).push(row);
    }
    if (!row.emitted) continue;
    for (const mover of row.hazards.filter(hazard => hazard.movement && !hazard.continuation)) {
      const contact = hazardFirstContactDistance(mover, row.plannedDistance);
      if (contact >= 4000) continue;
      const end = nextMoverWindowAfter(contact, DEPOT_RULES, 'level2', 'normal').distance;
      counts.set(end, (counts.get(end) ?? 0) + 1);
      movers++;
      orientations.add(row.hazards.find(hazard => hazard.moverCompanion).lane);
      assert.ok(row.hazards.some(hazard => hazard.moverCompanion && [0, 3].includes(hazard.lane)));
      if (row.sequenceLength === 4) paired++;
    }
  }
  for (const [end, count] of counts) assert.equal(movingHazardQuota(count).acceptable, true, `${end}: ${count}`);
  const pressure = physicalPressureMetrics(rows, {levelId: 'level2', mode: 'normal',
    startDistance: 1000, endDistance: 4000});
  context.diagnostic(JSON.stringify({seed: 98765, start: 1000, end: 4000, rows: rows.length,
    movers, pairedMoverBodies: paired, orientations: [...orientations].sort(),
    counts: Object.fromEntries(counts), maximumClearStreakByLane: pressure.maximumClearStreakByLane,
    safety: 'canonical route-time collision certification'}));
  assert.deepEqual([...orientations].sort(), [0, 3]);
  assert.ok(paired > 0, 'a real selected encounter, not only helper fixtures, must contain a pair');
  assert.ok(movers > paired, 'this fixture also emits singles without a pair-appearance quota');
  assert.ok(pressure.events.length > 0);
  for (const encounter of encounters.values()) {
    if (encounter[0].sequenceLength !== 4 ||
        hazardFirstContactDistance(moverOf(encounter[0]), encounter[0].plannedDistance) >= 4000) continue;
    assert.equal(encounter.length, 4);
    const first = moverOf(encounter[0]), second = moverOf(encounter[2]);
    assert.ok(encounter.every(row => row.emitted), 'never truncate a paired chicane or its return gates at a Depot');
    assert.equal(moverOf(encounter[1]), undefined);
    assert.equal(moverOf(encounter[3]), undefined);
    assert.equal(second.kind, first.kind);
    if (first.kind === 'forklift') {
      assert.equal(second.lane, encounter[2].hazards.find(hazard => hazard.moverCompanion).lane === 0 ? 1 : 0);
      assert.equal(second.movement.direction, -first.movement.direction);
    } else {
      assert.equal(second.movement.forwardSpeedRatio, 0.5);
      assert.equal(first.movement.forwardSpeedRatio, 0.5);
    }
    assert.equal(encounter[2].phase - encounter[0].phase, GAME_BALANCE.routes.movingHazards.chicane.rowOffset);
    const firstContact = hazardFirstContactDistance(first, encounter[0].plannedDistance);
    const secondContact = hazardFirstContactDistance(second, encounter[2].plannedDistance);
    assert.ok(secondContact - firstContact >= GAME_BALANCE.routes.movingHazards.minimumEncounterSpacingMeters);
    assert.equal(nextMoverWindowAfter(firstContact, DEPOT_RULES, 'level2', 'normal').distance,
      nextMoverWindowAfter(secondContact, DEPOT_RULES, 'level2', 'normal').distance);
    assert.ok(encounter[0].certificates.every(proof => !proof.approximateMovingSafety));
  }
});

test('controlled movers: real Level 2 opening keeps pairs optional under existing sector difficulty', () => {
  const rows = sampleRoute(98765, 250, false, 'level2', 'normal');
  assert.ok(rows.length > 0);
  assert.ok(rows.every(row => row.family !== 'moving_intercept' || row.sequenceLength === 2));
  assert.ok(rows.every(row => row.certificates.every(proof => proof.completed && proof.clearance >= 6)));
});

test('controlled movers: seeded routes use three free lanes or two restricted lanes, deterministically', () => {
  const finish = GAME_BALANCE.routes.level2.finishDistanceMeters;
  const first = sampleRoute(1, finish, false, 'level2', 'normal', 9);
  assert.deepEqual(first, sampleRoute(1, finish, false, 'level2', 'normal', 9));
  const counts = {2: 0, 3: 0};
  for (const row of first.filter(row => row.emitted)) {
    for (const mover of row.hazards.filter(hazard => hazard.movement)) {
      const staticHazards = row.hazards.filter(hazard => hazard !== mover && !hazard.movement);
      assert.equal(usesTimedMoverLanes(mover), true);
      assert.ok(!staticHazards.some(other => hazardSweptArtOverlaps(mover, other, 0,
        other.moverCompanion ? 0 : 8)), 'the entire sweep fits the surrounding static geometry');
      const hasThreeLaneOpening = [0, 1].some(lane => {
        const wider = {...mover, lane, movement: {...mover.movement, maxOffsetPx: 146}};
        return !staticHazards.some(other => hazardSweptArtOverlaps(wider, other, 0,
          other.moverCompanion ? 0 : 8));
      });
      assert.equal(mover.openingLanes.length, hasThreeLaneOpening ? 3 : 2);
      counts[mover.openingLanes.length]++;
      assert.ok(row.certificates.every(proof => proof.completed && proof.clearance >= 6));
      const span = mover.movement.maxOffsetPx;
      const warning = mover.movement.warningSeconds;
      assert.equal(warning, GAME_BALANCE.routes.movingHazards.forkliftWarningSeconds);
      for (const direction of [-1, 1]) {
        const movement = {...mover.movement, direction, phase: 0};
        const offsets = [0, warning + span / 76, warning + 2 * span / 76].map(time => movingHazardOffset(movement, time));
        assert.deepEqual(offsets, [0, span, 0]);
      }
    }
  }
  assert.ok(counts[2] > 0 && counts[3] > 0, JSON.stringify(counts));
});

test('central movers retain fully connected geometrically open routes at 30/60/120 Hz across Normal sector speeds', () => {
  // Owner rule: routes must be geometrically open at >= 6 px; whether a build can steer them is decided by upgrades.
  const geometric = {geometric: true, levelId: 'level2',
    minimumClearancePx: GAME_BALANCE.routes.track.routeValidation.minimumClearancePx};
  for (const seed of [153, 98765]) {
    const mode = 'normal';
    const rows = sampleRoute(seed, GAME_BALANCE.routes.level2.finishDistanceMeters, false, 'level2', mode, 9);
    const physical = rows.map(row => row.emitted ? row : {...row,
      hazards: [], intermediates: [], safeLanes: lanes});
    const approach = {...empty, spacingPx: HAZARD_TRAVEL_PX + HAZARD_ROW_ENVELOPE_PX / 2};
    for (const hz of [30, 60, 120]) {
      const proof = validateTrackSequence([approach, ...physical], i =>
        routeSpeedAtDistance(rows[i - 1].plannedDistance +
          (HAZARD_TRAVEL_PX + HAZARD_ROW_ENVELOPE_PX / 2) * METERS_PER_PIXEL, 'level2', mode),
      {...geometric, mode, hz, initialStates: [{lane: 1, x: 195, velocity: 0}]});
      assert.ok(proof.completed && proof.clearance >= 6,
        `${seed}/${mode}/${hz}Hz: ${proof.clearance}`);
      assert.equal(proof.approximateMovingSafety, undefined);
    }
    assert.ok(rows.some(row => row.emitted && row.hazards.some(usesTimedMoverLanes) &&
      row.hazards.some(hazard => hazard.filler && hazard.moverCompanion && [0, 3].includes(hazard.lane))),
    'native outer fillers must be emitted alongside actual central movers');
  }
});
