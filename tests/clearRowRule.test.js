import test from 'node:test';
import assert from 'node:assert/strict';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';
import {CHALLENGE_PROFILES} from '../src/game/data/challengeProfiles.js';
import {sectorAtDistance} from '../src/game/core/sectors.js';
import {HAZARD_TRAVEL_PX, SHIP_Y} from '../src/game/data/route.js';
import {METERS_PER_PIXEL, routeTimeAtDistance, routeSpeedAtDistance} from '../src/game/core/economy.js';
import {createTrackStream, trackEncounterSignature, rowSpacingAtSpeed, ROW_REACTION_SECONDS,
  hazardsBeforeDepot, chunkCollisionSpan, chunkCollisionCoverage, createSeededRandom,
  shouldSuppressBetaBetweenAlpha, betaIsSandwichedByAlpha, campingWindows} from '../src/game/core/trackGenerator.js';
import {advancePressureHistory, projectPhysicalEvents, physicalPressureMetrics,
  hazardDefinition, hazardGeometry, hazardHits, hazardX, hazardBlockedIntervals,
  movingHazardOffset, canonicalMotionAge, sideHazardQuota, hazardSweptArtOverlaps,
  HAZARD_ROW_ENVELOPE_PX, LANE_CENTERS, guardrailMinimumLength} from '../src/game/core/hazards.js';
import {validateTrackSequence, hazardClearance} from '../src/game/core/trackValidation.js';
import {loadoutStats} from '../src/game/core/modules.js';
import {DEPOT_RULES, nextDepotAfter} from '../src/game/core/depots.js';
import {sampleRoute, layoutMetrics} from '../scripts/route-audit.mjs';

const event = lanes => ({distance: 0, threatenedLanes: [0, 1, 2, 3].map(lane => lanes.includes(lane))});
const row = (distance, lane) => ({plannedDistance: distance, spacingPx: 300, emitted: true,
  hazards: [{kind: 'divider', lane, offsetX: 0, offsetY: 0}], intermediates: [],
  safeLanes: [0, 1, 2, 3].filter(other => other !== lane), cargoLanes: []});
const cases = [
  ...['level1', 'level2'].flatMap(levelId => [1, 153, 1234, 98765].map(seed => ({
    levelId, seed, mode: 'normal',
    startDistance: GAME_BALANCE.routes.spawning.initialRowDelaySeconds *
      routeSpeedAtDistance(0, levelId) * METERS_PER_PIXEL,
    endDistance: GAME_BALANCE.routes[levelId].finishDistanceMeters,
  }))),
  ...[1, 153, 1234, 98765, 31415, 2718, 42, 680].map(seed => ({
    levelId: 'level1', mode: 'continuous', seed,
    startDistance: GAME_BALANCE.routes.spawning.initialRowDelaySeconds *
      routeSpeedAtDistance(0, 'level1', 'continuous') * METERS_PER_PIXEL,
    endDistance: 12000,
  })),
];
const cache = new Map();
function routeFor(options) {
  const key = `${options.levelId}/${options.mode}/${options.seed}`;
  if (!cache.has(key)) {
    try {
      const rows = sampleRoute(options.seed, options.endDistance, false, options.levelId,
        options.mode, options.startDistance);
      cache.set(key, {rows, metrics: physicalPressureMetrics(rows, options)});
    } catch (error) {
      cache.set(key, {error});
    }
  }
  const result = cache.get(key);
  if (result.error) throw result.error;
  return result;
}

function collisionEvents(rows, options) {
  const bodies = [], owners = new Map(), structures = new Map(), events = [];
  for (const physical of rows) {
    if (!physical.emitted) continue;
    for (const hazard of [...physical.hazards, ...physical.intermediates]) {
      if (hazard.continuation) continue;
      const body = {hazard, source: physical.plannedDistance, lifetime: physical.lifetime,
        center: physical.plannedDistance + (HAZARD_TRAVEL_PX - hazard.offsetY) * METERS_PER_PIXEL};
      bodies.push(body);
      owners.set(hazard, body);
      if (hazard.sideObstacleId) structures.set(hazard.sideObstacleId, body);
    }
  }
  const collides = (body, distance, lane) => {
    if (distance > (body.lifetime?.clearedAtDistance ?? Infinity)) return false;
    const movementOffsetPx = body.hazard.movement
      ? movingHazardOffset(body.hazard.movement,
        canonicalMotionAge(body.source, distance, options.levelId, options.mode)) : 0;
    return hazardHits(body.hazard, hazardX({...body.hazard, movementOffsetPx}),
      SHIP_Y + (distance - body.center) / METERS_PER_PIXEL, LANE_CENTERS[lane], SHIP_Y);
  };
  for (const [rowIndex, physical] of rows.entries()) {
    const add = (offset, placement, primary, owned) => {
      const distance = physical.plannedDistance + (HAZARD_TRAVEL_PX - offset) * METERS_PER_PIXEL;
      const sources = owned.map(hazard => owners.get(hazard) ?? structures.get(hazard.sideObstacleId))
        .filter(Boolean);
      if (!sources.some(body => LANE_CENTERS.some((_, lane) => collides(body, distance, lane)))) return;
      const extent = Math.max(0, ...primary.map(hazard => hazardGeometry(hazard).hitY)) * METERS_PER_PIXEL;
      const active = bodies.filter(body => Math.abs(body.center - distance) <=
        hazardGeometry(body.hazard).hitY * METERS_PER_PIXEL + extent);
      const mask = [false, false, false, false], side = [...mask], discrete = [...mask];
      const positions = [distance, distance - extent + 1e-9, distance + extent - 1e-9,
        ...Array.from({length: 129}, (_, index) => distance - extent + index / 128 * 2 * extent)];
      for (const at of positions) for (const body of active) for (let lane = 0; lane < 4; lane++) {
        if (!collides(body, at, lane)) continue;
        mask[lane] = true;
        (body.hazard.sideObstacle ? side : discrete)[lane] = true;
      }
      if (mask.some(Boolean)) events.push({distance, rowIndex, placement, mask, side, discrete});
    };
    add(0, 'alpha', physical.hazards.filter(hazard => !hazard.continuation && !hazard.lengthPx),
      physical.hazards);
    if (!physical.emitted) continue;
    for (const offset of new Set(physical.intermediates.map(hazard => hazard.offsetY))) {
      const primary = physical.intermediates.filter(hazard => hazard.offsetY === offset);
      add(offset, 'beta', primary, primary);
    }
  }
  return events.filter(event => event.distance >= (options.startDistance ?? 0) &&
    event.distance < (options.endDistance ?? Infinity))
    .sort((left, right) => left.distance - right.distance);
}

test('camping diagnostic credits only actual certified off-pair cargo, not intended destinations', () => {
  const rows = Array.from({length: 4}, (_, index) => ({plannedDistance: 100 + index * 20,
    phase: 0, emitted: true, spacingPx: 300,
    hazards: [{kind: 'divider', lane: 2, offsetX: 0, offsetY: 0}], intermediates: [],
    pickups: [], cargoDestination: 3,
    certificates: [{completed: true, clearance: 6, exits: [{lanes: [1, 3]}]}]}));
  assert.ok(campingWindows(rows).some(violation => violation.band === 0b0011));
  rows[3].pickups = [{lane: 3, value: 10}];
  assert.ok(!campingWindows(rows).some(violation => violation.band === 0b0011));
  rows[3].certificates = [];
  assert.ok(campingWindows(rows).some(violation => violation.band === 0b0011));
});

test('camping diagnostic does not combine sequential Alpha and Beta blockers into a pair closure', () => {
  const rows = Array.from({length: 4}, (_, index) => ({plannedDistance: 100 + index * 30,
    phase: 0, emitted: true, spacingPx: 500,
    hazards: [{kind: 'divider', lane: 0, offsetX: 0, offsetY: 0}],
    intermediates: [{kind: 'divider', lane: 1, offsetX: 0, offsetY: -150}], pickups: []}));
  assert.ok(campingWindows(rows).some(violation => violation.band === 0b0011));
});

test('Normal baseline prevents four-row lane and adjacent-pair camping across both complete levels', () => {
  for (const levelId of ['level1', 'level2']) for (const seed of [0, 1, 7, 42, 153, 1234, 98765, 2330762723]) {
    const rows = sampleRoute(seed, GAME_BALANCE.routes[levelId].finishDistanceMeters, false, levelId, 'normal');
    assert.deepEqual(campingWindows(rows, {levelId}), [], `${levelId}/${seed}: four-row camping window`);
    assert.ok(rows.filter(row => row.emitted).every(row => row.certificates.every(proof =>
      proof.completed && proof.clearance >= 6)));
  }
});

test('clear-row rule: Normal and Continuous allow three clear events but the next event fails', () => {
  assert.deepEqual(GAME_BALANCE.routes.track.maximumClearEvents, {normal: 3, continuous: 3});
  for (const [mode, limit] of [['normal', 3], ['continuous', 3]]) {
    const accepted = advancePressureHistory([0, 0, 0, 0],
      Array.from({length: limit}, () => event([1, 2, 3])), {mode});
    assert.equal(accepted.acceptable, true);
    assert.equal(accepted.streaks[0], limit);
    const rejected = advancePressureHistory(accepted.streaks, [event([1, 2, 3])], {mode});
    assert.equal(rejected.acceptable, false);
    assert.deepEqual(rejected.violations.map(({lane, streak}) => ({lane, streak})),
      [{lane: 0, streak: limit + 1}]);
  }
  assert.equal(advancePressureHistory([3, 0, 0, 0], [event([1, 2, 3])]).acceptable, false,
    'omitting mode retains the Normal3 contract');
  assert.throws(() => advancePressureHistory([0, 0, 0, 0], [], {mode: 'unsupported'}), /Unknown clear-event mode/);
});

test('clear-row rule: all four lanes retain independent history across encounter and section seams', () => {
  let history = [0, 0, 0, 0];
  for (const lanes of [[0, 1, 2, 3], [1, 2, 3], [2, 3], [3]]) {
    const result = advancePressureHistory(history, [event(lanes)]);
    assert.equal(result.acceptable, true);
    history = result.streaks;
  }
  assert.deepEqual(history, [3, 2, 1, 0]);
  assert.equal(advancePressureHistory(history, [event([1, 2, 3])]).acceptable, false,
    'a section marker cannot erase lane0 history');
  const short = advancePressureHistory(history, [event([0, 2])]);
  assert.deepEqual(short.violations.map(({lane, streak, short}) => ({lane, streak, short})),
    [{lane: 2, streak: 1, short: true}], 'owner rule: an opened lane stays open for at least two rows');
});

test('clear-row rule: cargo scenery and suppressed sources do not create meaningful pressure rows', () => {
  const cosmetic = {...row(0, 0), hazards: [], pickups: [{lane: 0, value: 30}],
    scenery: [{lane: 1, kind: 'decorative'}]};
  assert.deepEqual(projectPhysicalEvents([cosmetic]).events, []);
  assert.deepEqual(projectPhysicalEvents([{...row(0, 0), emitted: false}]).events, []);
  assert.deepEqual(advancePressureHistory([3, 2, 1, 0], []).streaks, [3, 2, 1, 0]);
  const cleared = {...row(0, 0), lifetime: {clearedAtDistance: 20},
    intermediates: [{kind: 'divider', lane: 1, offsetX: 0, offsetY: -30}]};
  const replacement = row(1, 2);
  const afterClear = projectPhysicalEvents([cleared, replacement]).events;
  assert.equal(afterClear.length, 1, 'a new body must not reactivate cleared Alpha/Beta event planes');
  assert.equal(afterClear[0].sourceDistance, 1);
});

test('clear-row rule: one continuous physical body pressures its actual rows but not beyond its resolved tail', () => {
  const rows = [row(0, 1), row(18, 2), row(36, 3), row(54, 2)];
  const body = {kind: 'sideRail', lane: 0, offsetX: 0, sideObstacle: true,
    sideObstacleId: 'rail', spanRows: 3, lengthPx: 654};
  for (let phase = 0; phase < 3; phase++) rows[phase].hazards.push({...body,
    offsetY: phase * 300 - 300, spanPhase: phase, continuation: phase > 0});
  const projected = projectPhysicalEvents(rows);
  assert.equal(projected.bodies.filter(physical => physical.id === 'rail').length, 1);
  assert.ok(projected.events.slice(0, 3).every(physical => physical.threatenedLanes[0]));
  assert.equal(projected.events[3].threatenedLanes[0], false);
});

test('clear-row rule: movers receive only timed collision-window lane pressure rather than full-sweep credit', () => {
  const moving = row(0, 0);
  const seconds = routeTimeAtDistance(HAZARD_TRAVEL_PX * METERS_PER_PIXEL);
  moving.hazards = [{kind: 'sweeper', lane: 0, offsetX: 0, offsetY: 0,
    movement: {minOffsetPx: 0, maxOffsetPx: 73, speedPxPerSecond: 76,
      direction: 1, phase: ((-76 * seconds) % 146 + 146) % 146}}];
  const projected = projectPhysicalEvents([moving]);
  assert.deepEqual(projected.events[0].threatenedLanes, [true, false, false, false]);
  assert.equal(advancePressureHistory([0, 3, 0, 0], projected.events).acceptable, false);
});

test('clear-row rule: each Beta is separate and recomposition updates the existing signature and physical validation', () => {
  const rows = [row(0, 0), row(36, 3)];
  rows.forEach(physical => { physical.spacingPx = 600; });
  const signature = trackEncounterSignature('offset_pair', rows);
  rows[0].intermediates.push({kind: 'divider', lane: 1, offsetX: 10, offsetY: -330,
    placement: 'beta', intermediate: true});
  const betaSignature = trackEncounterSignature('offset_pair', rows);
  assert.notEqual(betaSignature, signature);
  let projection = projectPhysicalEvents(rows);
  assert.deepEqual(projection.events.map(physical => physical.placement), ['alpha', 'beta', 'alpha']);
  const options = {initialStates: [{lane: 2, x: LANE_CENTERS[2], velocity: 0}]};
  assert.ok(validateTrackSequence(rows, 350, options).clearance >= 6);
  rows[0].hazards[0].lane = 1;
  rows[0].safeLanes = [0, 2, 3];
  assert.notEqual(trackEncounterSignature('offset_pair', rows), betaSignature);
  projection = projectPhysicalEvents(rows);
  assert.deepEqual(projection.events[0].threatenedLanes, [false, true, false, false]);
  const certificate = validateTrackSequence(rows, 350, options);
  assert.ok(certificate.completed && certificate.clearance >= 6);
});

test('clear-row rule: Beta uses the last open lane between adjacent Alpha rows blocking the same lane', () => {
  let constrainedBetas = 0;
  for (const seed of [1, 153, 98765]) {
    const stream = createTrackStream(seed, 'level1', 'normal');
    let distance = 0;
    let previous = null;
    let checked = 0;
    while (distance < GAME_BALANCE.routes.level1.finishDistanceMeters) {
      const current = stream.nextRow(distance);
      if (!current) break;
      if (previous) {
        assert.ok(previous.intermediates.every(hazard => !betaIsSandwichedByAlpha(current, hazard.lane)),
          `${seed}: Beta is flanked by the next Alpha row at ${current.plannedDistance} m`);
        const sharedAlphaBlockedLanes = previous.hazardLanes.filter(lane =>
          current.hazardLanes.includes(lane));
        if (sharedAlphaBlockedLanes.length && previous.intermediates.length) {
          const lastOpenLane = previous.safeLanes.filter(lane => current.safeLanes.includes(lane))
            .sort((a, b) => a - b).at(-1);
            if (previous.intermediates.some(hazard => !hazard.filler ||
              !sharedAlphaBlockedLanes.includes(hazard.lane))) assert.ok(Number.isInteger(lastOpenLane));
          assert.ok(previous.intermediates.every(hazard => hazard.lane === lastOpenLane ||
            hazard.filler && sharedAlphaBlockedLanes.includes(hazard.lane)),
            `${seed}: constrained Beta should use last open lane ${lastOpenLane}`);
          constrainedBetas += previous.intermediates.length;
        }
        checked++;
      }
      previous = current;
      distance += current.spacingPx * METERS_PER_PIXEL;
    }
    assert.ok(checked > 0);
  }
  assert.ok(constrainedBetas > 0, 'exercise actual constrained Alpha/Beta placements');
});

test('clear-row rule: suppress Beta in L0,L0,L2 and wall-closed last-lane formations', () => {
  const makeRow = (primaryLane, wallLane = null) => {
    const blocked = [primaryLane, ...(wallLane === null ? [] : [wallLane])];
    return {hazards: [{lane: primaryLane, placement: 'alpha'}, ...(wallLane === null ? []
      : [{lane: wallLane, placement: 'alpha', sideObstacle: true}])],
    hazardLanes: blocked, safeLanes: [0, 1, 2, 3].filter(lane => !blocked.includes(lane))};
  };
  assert.equal(shouldSuppressBetaBetweenAlpha(makeRow(0), makeRow(0), makeRow(2)), true,
    'L0,L0,L2 has no Beta between the repeated L0 blockers');
  assert.equal(shouldSuppressBetaBetweenAlpha(makeRow(0, 3), makeRow(0, 3), makeRow(2, 2)), true,
    'a wall closing the remaining last lane suppresses Beta');
  assert.equal(shouldSuppressBetaBetweenAlpha(makeRow(0), makeRow(0), makeRow(0)), false,
    'repeated Alpha lanes without a turn retain last-open-lane Beta placement');
});

test('clear-row rule: Beta never occupies a lane flanked by obstacles on the next Alpha row', () => {
  const row = blocked => ({hazardLanes: blocked, safeLanes: [0, 1, 2, 3].filter(lane => !blocked.includes(lane))});
  assert.equal(betaIsSandwichedByAlpha(row([0, 2]), 1), true);
  assert.equal(betaIsSandwichedByAlpha(row([1, 3]), 2), true);
  assert.equal(betaIsSandwichedByAlpha(row([0, 1]), 1), false);
  assert.equal(betaIsSandwichedByAlpha(row([1]), 0), true,
    'a missing off-road neighbor does not count as an escape lane');
  assert.equal(betaIsSandwichedByAlpha(row([2]), 3), true,
    'the opposite road edge uses the same no-adjacent-lane rule');
  assert.equal(betaIsSandwichedByAlpha(row([0]), 1), false,
    'a real open adjacent in-road lane remains a valid escape');
});

test('clear-row rule: all16 actual production routes preserve the limit and approved half-load baseline clearance across seams', context => {
  assert.equal(cases.length, 16);
  assert.equal(new Set(cases.map(options => `${options.levelId}/${options.mode}/${options.seed}`)).size, 16);
  assert.equal(GAME_BALANCE.routes.track.encounters.candidateBudget, 8);
  assert.equal(GAME_BALANCE.routes.track.encounters.densityRecovery.candidateBudget, 16);
  for (const options of cases) {
    const {rows, metrics} = routeFor(options);
    assert.deepEqual(metrics.violations, [], JSON.stringify({options, first: metrics.violations[0]}));
    assert.ok(metrics.maximumClearStreakByLane.every(streak =>
      streak <= GAME_BALANCE.routes.track.maximumClearEvents[options.mode]), JSON.stringify(options));
    for (const physical of rows) {
      const encounters = GAME_BALANCE.routes.track.encounters;
      assert.ok(physical.candidateAttempts <= physical.candidateBudget);
      assert.ok([encounters.candidateBudget, encounters.densityRecovery.candidateBudget].includes(physical.candidateBudget));
      if (physical.candidateBudget > encounters.candidateBudget) {
        const sector = sectorAtDistance(physical.plannedDistance, options.levelId, options.mode);
        assert.equal(options.mode, 'normal');
        assert.ok(sector.number >= 3);
        assert.notEqual(physical.selectionPacing, 'recovery');
        assert.ok(physical.density.through < GAME_BALANCE.routes[options.levelId].finishDistanceMeters);
        assert.ok(physical.density.emptySeconds > physical.density.through *
          encounters.densityRecovery.maximumEmptySecondsPerMeter ||
          physical.density.lateEmptySeconds > Math.max(0, physical.density.through -
            GAME_BALANCE.routes[options.levelId].sectorStartsMeters[2]) *
            encounters.densityRecovery.maximumLateEmptySecondsPerMeter);
      }
    }
    assert.ok(rows.every(physical => physical.intermediates.length <= GAME_BALANCE.routes.track.betaSlots.length));
    for (let index = 0; index + 1 < rows.length; index++) {
      assert.ok(rows[index].intermediates.every(hazard =>
        !betaIsSandwichedByAlpha(rows[index + 1], hazard.lane)),
      `Beta is flanked by next Alpha row at ${rows[index + 1].plannedDistance} m`);
      const sharedAlphaBlockedLanes = rows[index].hazardLanes.filter(lane =>
        rows[index + 1].hazardLanes.includes(lane));
      if (sharedAlphaBlockedLanes.length && rows[index].intermediates.length) {
        const lastOpenLane = rows[index].safeLanes.filter(lane =>
          rows[index + 1].safeLanes.includes(lane)).sort((a, b) => a - b).at(-1);
        assert.ok(Number.isInteger(lastOpenLane));
        assert.ok(rows[index].intermediates.every(hazard => hazard.lane === lastOpenLane),
          `Beta should use last open lane ${lastOpenLane} between Alpha rows at ` +
          `${rows[index].plannedDistance} and ${rows[index + 1].plannedDistance} m`);
      }
    }
    for (const physical of rows) {
      assert.deepEqual(physical.certificates.map(certificate => certificate.hz),
        GAME_BALANCE.routes.track.routeValidation.sampleHz);
      assert.ok(physical.certificates.every(certificate => certificate.reference === 'standard-stock-half' &&
        certificate.completed && certificate.clearance >= 6));
    }
    const encounters = new Map();
    for (const physical of rows) {
      if (!encounters.has(physical.encounterId)) encounters.set(physical.encounterId, []);
      encounters.get(physical.encounterId).push(physical);
    }
    for (const sequence of encounters.values()) {
      if (sequence.length !== sequence[0].sequenceLength || sequence[0].fallback) continue;
      assert.equal(sequence[0].signature, trackEncounterSignature(sequence[0].family, sequence),
        'published signature must describe actual finalized Alpha/Beta geometry');
    }
    for (const [index, physical] of rows.entries()) for (const hazard of physical.hazards) {
      if (!hazard.sideObstacle || hazard.continuation || index + hazard.spanRows > rows.length) continue;
      const tail = rows[index + hazard.spanRows - 1].plannedDistance - physical.plannedDistance;
      const expectedLength = Math.max(tail / METERS_PER_PIXEL + hazardDefinition(hazard.kind).height,
        guardrailMinimumLength(hazard));
      assert.ok(Math.abs(hazardGeometry(hazard).height - expectedLength) < 1e-8);
    }
    context.diagnostic(JSON.stringify({case: `${options.levelId}/${options.mode}/${options.seed}`,
      maximumClearStreakByLane: metrics.maximumClearStreakByLane, meaningfulEvents: metrics.events.length}));
  }
});

test('clear-row rule: live selection pressures every urgent lane instead of exceeding the mode limit', () => {
  let reliefs = 0;
  for (const options of cases) {
    let history = [0, 0, 0, 0];
    // Streaks count rows: an Alpha and the Betas of the same physical row form one row.
    const groups = [];
    for (const physical of routeFor(options).metrics.events) {
      const last = groups.at(-1);
      if (last && physical.rowIndex !== undefined && last[0].rowIndex === physical.rowIndex &&
          last[0].sourceDistance === physical.sourceDistance) last.push(physical);
      else groups.push([physical]);
    }
    for (const group of groups) {
      for (let lane = 0; lane < 4; lane++) if (
        history[lane] === GAME_BALANCE.routes.track.maximumClearEvents[options.mode]) {
        assert.ok(group.some(physical => physical.threatenedLanes[lane]), JSON.stringify({options, lane, group}));
        reliefs++;
      }
      history = advancePressureHistory(history, group, {mode: options.mode}).streaks;
    }
  }
  assert.ok(reliefs > 0, 'exercise actual binding constraints, not just paths that never approach the limit');
});

test('clear-row rule: exhausted live budgets use bounded certified collision-bearing native fallbacks', () => {
  const fallbacks = cases.flatMap(options => routeFor(options).rows.filter(physical =>
    physical.phase === 0 && physical.fallback));
  assert.ok(fallbacks.length > 0, 'the deterministic suite must exercise real exhaustion');
  for (const physical of fallbacks) {
    assert.ok([GAME_BALANCE.routes.track.encounters.candidateBudget, GAME_BALANCE.routes.track.encounters.densityRecovery.candidateBudget].includes(physical.candidateBudget));
    assert.equal(physical.candidateAttempts, physical.candidateBudget);
    assert.ok(physical.plannedObstacleCount > 0);
    assert.ok(physical.certificates.every(certificate => certificate.completed && certificate.clearance >= 6));
  }
});

test('clear-row rule: Depot clearing expires future pressure while preserving reached history and fresh runs start clean', () => {
  for (const levelId of ['level1', 'level2']) {
    const stream = createTrackStream(153, levelId);
    const bank = nextDepotAfter(0, DEPOT_RULES, levelId).distance;
    assert.deepEqual(stream.pressureSnapshot(0).streaks, [0, 0, 0, 0]);
    const rows = [];
    let distance = 9;
    while (distance < bank) {
      const physical = stream.nextRow(distance);
      rows.push(physical);
      distance += physical.spacingPx * METERS_PER_PIXEL;
    }
    const before = stream.pressureSnapshot(bank);
    const future = rows.filter(physical => physical.emitted &&
      [...physical.hazards, ...physical.intermediates].some(hazard => !hazard.continuation &&
        physical.plannedDistance + (HAZARD_TRAVEL_PX - hazard.offsetY +
          hazardGeometry(hazard).hitY) * METERS_PER_PIXEL >= bank));
    stream.resetAfterDepot(bank);
    assert.deepEqual(stream.pressureSnapshot(bank), before);
    assert.ok(future.every(physical => physical.lifetime.clearedAtDistance === bank));
    const reached = projectPhysicalEvents(rows, {levelId}).events;
    assert.ok(reached.every(physical => physical.distance <= bank));
    assert.deepEqual(advancePressureHistory([0, 0, 0, 0], reached).streaks, before.streaks);
    const resumed = sampleRoute(153, 2000, true, levelId);
    assert.deepEqual(physicalPressureMetrics(resumed, {levelId}).violations, []);
    assert.deepEqual(createTrackStream(153, levelId).pressureSnapshot(0).streaks, [0, 0, 0, 0]);
    const clearing = createTrackStream(153, levelId);
    const futureRow = clearing.nextRow(9);
    assert.equal(futureRow.emitted, true);
    assert.ok(futureRow.hazards.some(hazard => !hazard.continuation));
    clearing.resetAfterDepot(20);
    assert.equal(futureRow.lifetime.clearedAtDistance, 20, 'explicitly exercise a surviving future body');
    assert.deepEqual(projectPhysicalEvents([futureRow], {levelId}).events, []);
  }
});

test('formation: baseline is the real stock Standard half-load model, not an all-build guarantee', () => {
  assert.deepEqual(GAME_BALANCE.routes.track.routeValidation.baseline,
    {vehicleId: 'standard', loadFraction: 0.5});
  const stats = loadoutStats({cargoCapacityRank: 0, ownedModules: {},
    shipStates: {standard: {equippedModuleIds: []}}});
  assert.equal(stats.capacity, 11);
  assert.equal(stats.handling, 0);
  assert.equal(stats.capacity * GAME_BALANCE.routes.track.routeValidation.baseline.loadFraction, 5.5);
  assert.equal(GAME_BALANCE.routes.movingHazards.reactionMarginSeconds, 0.8);
  assert.equal(GAME_BALANCE.routes.track.routeValidation.minimumClearancePx, 6);
});

test('formation: normal continuation keeps steering variety without replacing recovery or weakening connected safety', t => {
  const options = {levelId: 'level1', mode: 'normal', startDistance: 9,
    endDistance: GAME_BALANCE.routes.level1.finishDistanceMeters};
  const rows = sampleRoute(153, options.endDistance, false, options.levelId, options.mode,
    options.startDistance);
  const metrics = physicalPressureMetrics(rows, options);
  const countPairs = events => {
    let common = 0, cross = 0, crossCommon = 0;
    for (let index = 1; index < events.length; index++) {
      const left = events[index - 1], right = events[index];
      const shared = right.threatenedLanes.some((blocked, lane) =>
        !blocked && !left.threatenedLanes[lane]);
      if (shared) common++;
      if (left.encounter !== right.encounter) {
        cross++;
        if (shared) crossCommon++;
      }
    }
    return {common, pairs: events.length - 1, cross, crossCommon};
  };
  const full = countPairs(metrics.events);
  const bySector = Object.fromEntries([...new Set(metrics.events.map(event =>
    sectorAtDistance(event.distance, options.levelId, options.mode).number))].map(number =>
    [number, countPairs(metrics.events.filter(event =>
      sectorAtDistance(event.distance, options.levelId, options.mode).number === number))]));
  t.diagnostic(JSON.stringify({full, bySector, rows: rows.length}));
  // Steering variety: consecutive pressure events with no shared open lane force a lane change in every
  // sector and across encounter seams, while the clear-row limit below forbids a permanent open lane.
  assert.ok(full.common < full.pairs && full.crossCommon < full.cross, JSON.stringify(full));
  assert.ok(Object.keys(bySector).length >= 2, 'route spans several sectors');
  for (const [number, sector] of Object.entries(bySector)) {
    assert.ok(sector.pairs > 0 && sector.common < sector.pairs, `sector ${number}: ${JSON.stringify(sector)}`);
  }
  assert.deepEqual(metrics.violations, []);
  assert.ok(metrics.maximumClearStreakByLane.every(streak =>
    streak <= GAME_BALANCE.routes.track.maximumClearEvents.normal));
  const encounters = rows.filter(physical => physical.phase === 0);
  const families = new Set(encounters.map(physical => physical.family));
  for (const family of ['single_pressure', 'split_gate', 'offset_pair', 'risk_reward']) {
    assert.ok(families.has(family), `steering family ${family} appears in the level`);
  }
  assert.ok(['side_squeeze', 'narrow_corridor', 'static_chicane'].some(family => families.has(family)),
    `a side-structure family appears in the level: ${[...families]}`);
  assert.ok(encounters.some(physical => physical.pacing === 'recovery' && physical.safeLanes.length >= 2));
  assert.ok(encounters.some(physical => physical.pacing === 'pressure'));
  // Owner rule (min 2 / max 3 open rows) binds often; fallbacks are certified dense obstacle rows, not
  // empty road, so they stay a bounded minority rather than zero.
  const fallbacks = encounters.filter(physical => physical.fallback);
  assert.ok(fallbacks.length <= encounters.length / 5, `${fallbacks.length}/${encounters.length} fallbacks`);
  assert.ok(fallbacks.every(physical => physical.hazards.some(hazard => !hazard.continuation)));
  assert.ok(rows.every(physical => physical.candidateAttempts <= physical.candidateBudget &&
    physical.certificates.every(proof => proof.completed &&
      proof.clearance >= GAME_BALANCE.routes.track.routeValidation.minimumClearancePx)));
  const sources = rows.flatMap(physical => physical.emitted
    ? [...physical.hazards, ...physical.intermediates].filter(hazard => !hazard.continuation) : []);
  const sides = sources.filter(hazard => hazard.sideObstacle);
  assert.ok(sideHazardQuota(sources.length, sides.length).acceptable);
  assert.ok(sides.some(hazard => hazard.lane === 0) && sides.some(hazard => hazard.lane === 3));
  const stats = loadoutStats({cargoCapacityRank: 0, ownedModules: {},
    shipStates: {standard: {equippedModuleIds: []}}});
  let segment = [], stretches = 0;
  const certify = () => {
    if (segment.length < 2) return;
    const first = segment[0];
    const entryLanes = [...new Set(first.certificates[0].exits.map(exit => exit.lanes[first.phase + 1]))];
    const proof = validateTrackSequence(segment, index => routeSpeedAtDistance(
      segment[index].plannedDistance + (HAZARD_TRAVEL_PX + HAZARD_ROW_ENVELOPE_PX / 2) *
      METERS_PER_PIXEL, options.levelId, options.mode), {
      geometric: true, levelId: options.levelId, mode: options.mode,
      minimumClearancePx: GAME_BALANCE.routes.track.routeValidation.minimumClearancePx,
      initialStates: entryLanes.map(lane => ({lane, x: LANE_CENTERS[lane], velocity: 0})),
    });
    assert.ok(proof.completed && proof.clearance >= GAME_BALANCE.routes.track.routeValidation.minimumClearancePx,
      `connected stretch ${segment[0].plannedDistance}: ${proof.clearance}`);
    stretches++;
  };
  for (const physical of rows) {
    if (!physical.emitted || (segment.length && segment[0].nextDepot !== physical.nextDepot)) {
      certify();
      segment = [];
    }
    if (physical.emitted) segment.push(physical);
  }
  certify();
  let depots = 0;
  for (let bay = nextDepotAfter(options.startDistance, DEPOT_RULES, options.levelId, options.mode);
    bay.distance < options.endDistance;
    bay = nextDepotAfter(bay.distance, DEPOT_RULES, options.levelId, options.mode)) depots++;
  assert.equal(stretches, depots + 1, 'connected geometry on both sides of each Normal banking boundary');
});

test('secondary fillers: themed lane and edge obstacles improve occupied time without filling recovery or the opening', t => {
  const random = createSeededRandom(153), controlRandom = createSeededRandom(153);
  assert.equal(random(), controlRandom());
  const provisional = random.fork();
  const expectedRoll = controlRandom();
  assert.equal(provisional(), expectedRoll);
  for (let index = 0; index < 16; index++) provisional();
  assert.equal(random(), expectedRoll, 'successor proposals cannot advance the live seeded stream');
  const obstacle = row(0, 0), empty = {...obstacle, hazards: [], intermediates: []};
  assert.equal(chunkCollisionSpan([empty]), 0);
  assert.equal(chunkCollisionSpan([obstacle]), 1);
  assert.equal(chunkCollisionSpan([obstacle, empty, obstacle]), 3);
  assert.equal(chunkCollisionSpan([{...obstacle, emitted: false}, empty, obstacle]), 1);
  assert.equal(chunkCollisionSpan([{...empty, intermediates: obstacle.hazards}]), 1);
  const coverage = chunkCollisionCoverage([obstacle]);
  assert.ok(coverage.occupiedSeconds > 0);
  const emptyCoverage = chunkCollisionCoverage([empty]);
  assert.equal(emptyCoverage.occupiedSpan, 0);
  assert.equal(emptyCoverage.occupiedSeconds, 0);
  assert.equal(emptyCoverage.structuralOccupiedSeconds, 0);
  assert.equal(emptyCoverage.committedWitnessRows, 0);
  assert.ok(coverage.routeMeters > 0);
  assert.equal(coverage.occupiedSecondsPerMeter, coverage.occupiedSeconds / coverage.routeMeters);
  const isolatedRows = [obstacle, row(18, 1), row(36, 2)];
  const isolatedCoverage = chunkCollisionCoverage(isolatedRows, {witnessStartRow: 1});
  assert.equal(isolatedCoverage.structuralOccupiedSeconds, 0);
  assert.equal(isolatedCoverage.structuralSpanRows, 0);
  assert.equal(isolatedCoverage.committedWitnessRows, 0, 'three isolated rows are not a sustained body witness');
  const longBody = {kind: 'sideRail', lane: 0, offsetX: 0, offsetY: -300, lengthPx: 654,
    spanRows: 3, sideObstacleId: 'coverage-witness'};
  const structuralRows = isolatedRows.map((row, index) => ({...row,
    hazards: [{...longBody, continuation: index > 0}]}));
  const structuralCoverage = chunkCollisionCoverage(structuralRows, {witnessStartRow: 1});
  assert.ok(structuralCoverage.structuralOccupiedSeconds > 0);
  assert.equal(structuralCoverage.structuralSpanRows, 3);
  assert.equal(structuralCoverage.committedWitnessRows, 2);
  assert.equal(chunkCollisionCoverage(structuralRows.slice(0, 2), {witnessStartRow: 1})
    .committedWitnessRows, 0, 'incomplete future obligations cannot earn witness credit');
  assert.equal(chunkCollisionCoverage(structuralRows.map(row => ({...row,
    lifetime: {clearedAtDistance: 0}})), {witnessStartRow: 1}).structuralOccupiedSeconds, 0);
  assert.equal(chunkCollisionCoverage(structuralRows.map(row => ({...row,
    lifetime: {clearedAtDistance: 0}})), {witnessStartRow: 1}).committedWitnessRows, 0);
  assert.equal(chunkCollisionCoverage([{...obstacle, hazards: [...obstacle.hazards, ...obstacle.hazards]}])
    .occupiedSeconds, coverage.occupiedSeconds, 'overlapping collision windows count only once');
  assert.equal(chunkCollisionCoverage([{...obstacle, lifetime: {clearedAtDistance: 0}}])
    .occupiedSeconds, 0, 'removed bodies cannot receive coverage weight');
  const options = {levelId: 'level1', mode: 'normal', startDistance: 0,
    endDistance: GAME_BALANCE.routes.level1.finishDistanceMeters};
  assert.equal(options.endDistance, 4000);
  const firstSpawn = GAME_BALANCE.routes.spawning.initialRowDelaySeconds *
    routeSpeedAtDistance(0, options.levelId, options.mode) * METERS_PER_PIXEL;
  const lateStart = GAME_BALANCE.routes.level1.sectorStartsMeters[2];
  const maximumEmptySeconds = 163.84249332417437 * options.endDistance / 6100;
  const maximumLateEmptySeconds = 128.8492515768585 * (options.endDistance - lateStart) / (6100 - lateStart);
  const rows = sampleRoute(153, options.endDistance, false, options.levelId, options.mode,
    firstSpawn);
  assert.deepEqual(rows, sampleRoute(153, options.endDistance, false, options.levelId, options.mode,
    firstSpawn), 'expanded certified selection must remain deterministic');
  const traces = [];
  const tracedStream = createTrackStream(153, options.levelId, options.mode, {
    traceCandidateSelection(event) {
      traces.push(structuredClone(event));
      if (event.choices) event.choices.length = 0;
      if (event.rows) event.rows.length = 0;
    },
  });
  const tracedRows = [];
  let tracedDistance = firstSpawn, protectedUntil = 0;
  let nextDepot = nextDepotAfter(tracedDistance, DEPOT_RULES, options.levelId, options.mode).distance;
  while (tracedDistance < options.endDistance) {
    if (tracedDistance >= nextDepot + DEPOT_RULES.triggerHalfMeters) {
      protectedUntil = nextDepot + DEPOT_RULES.exitMeters;
      nextDepot = nextDepotAfter(nextDepot, DEPOT_RULES, options.levelId, options.mode).distance;
    }
    const emitted = tracedStream.nextRow(tracedDistance,
      {nextDepotDistance: nextDepot, protectedUntilDistance: protectedUntil});
    tracedRows.push({...emitted, spawnDistance: tracedDistance, nextDepot});
    tracedDistance += emitted.spacingPx * METERS_PER_PIXEL;
  }
  assert.deepEqual(tracedRows, rows, 'read-only tracing must not change choices, geometry, certificates or RNG');
  assert.ok(traces.some(event => event.type === 'rejectedQuota'));
  assert.ok(traces.some(event => event.type === 'rejectedPressure'));
  assert.ok(traces.some(event => event.type === 'committed' && event.coverage.committedWitnessRows > 0));
  let witnessedPools = 0;
  // Which pools mix single-row aliases with witnessed bodies is a seeded outcome, so a second traced
  // route widens the sample; every pool still satisfies the same scoring invariants.
  const extraPools = [];
  const extraStream = createTrackStream(98765, options.levelId, options.mode, {
    traceCandidateSelection(event) {
      if (event.type === 'certifiedPool') extraPools.push(structuredClone(event));
    },
  });
  let extraDistance = firstSpawn, extraProtected = 0;
  let extraDepot = nextDepotAfter(extraDistance, DEPOT_RULES, options.levelId, options.mode).distance;
  while (extraDistance < options.endDistance) {
    if (extraDistance >= extraDepot + DEPOT_RULES.triggerHalfMeters) {
      extraProtected = extraDepot + DEPOT_RULES.exitMeters;
      extraDepot = nextDepotAfter(extraDepot, DEPOT_RULES, options.levelId, options.mode).distance;
    }
    extraDistance += extraStream.nextRow(extraDistance,
      {nextDepotDistance: extraDepot, protectedUntilDistance: extraProtected}).spacingPx * METERS_PER_PIXEL;
  }
  for (const event of [...traces.filter(event => event.type === 'certifiedPool'), ...extraPools]) {
    assert.equal(event.choices.filter(choice => choice.selected).length, 1);
    const selected = event.choices.find(choice => choice.selected);
    assert.ok(selected.selectable);
    if (event.proposalBudget === 16) {
      assert.equal(selected.weight, Math.max(...event.choices.map(choice => choice.weight)),
        'a behind-target pool must compare the combined certified trajectory, not local density');
    }
    for (const choice of event.choices) {
      assert.equal(choice.weight, choice.physicalScore + choice.successorScore);
      assert.equal(choice.successorScore, Math.max(0, ...choice.successors.map(successor => successor.physicalScore)));
      assert.ok([0, 8, 16].includes(choice.successorBudget));
      for (const successor of choice.successors) {
        assert.equal(successor.pressureAcceptable, true);
        assert.deepEqual(successor.certificates.map(certificate => certificate.hz),
          GAME_BALANCE.routes.track.routeValidation.sampleHz);
        assert.ok(successor.certificates.every(certificate => certificate.completed && certificate.clearance >= 6));
      }
    }
    // Candidates set aside by the steering-dash preference were still scored in the same admitted pool.
    const scored = [...event.choices, ...(event.steeringExcluded ?? [])];
    const aliases = scored.filter(choice => choice.coverage.occupiedSpan === 1);
    const witnesses = scored.filter(choice => choice.coverage.committedWitnessRows > 0);
    if (aliases.length && witnesses.length) {
      witnessedPools++;
      assert.ok(witnesses.every(witness => aliases.every(alias => witness.physicalScore > alias.physicalScore)),
        'sustained committed bodies outscore single-row aliases in the same admitted pool');
    }
  }
  assert.ok(witnessedPools > 0);
  const trajectoryTradeoffs = [...traces, ...extraPools].filter(event => event.type === 'certifiedPool' &&
    event.proposalBudget === 16).filter(event => {
    const selected = event.choices.find(choice => choice.selected);
    const greedy = event.choices.reduce((best, choice) =>
      choice.physicalScore > best.physicalScore ? choice : best);
    if (selected.physicalScore >= greedy.physicalScore) return false;
    assert.ok(selected.successorScore > greedy.successorScore,
      'sacrificing local coverage must preserve a better certified successor');
    return true;
  });
  assert.ok(trajectoryTradeoffs.length > 0, 'exercise a trajectory choice rejected by local greedy scoring');
  t.diagnostic(JSON.stringify({trajectoryTradeoffs: trajectoryTradeoffs.map(event => event.distance)}));
  for (const event of traces.filter(event => event.type === 'committedCoverage')) {
    const projected = layoutMetrics(event.rows.map(row => ({...row, spawnDistance: row.plannedDistance})),
      {...options, startDistance: event.from, endDistance: event.through});
    const futureTime = routeTimeAtDistance(event.through, options.levelId, options.mode) -
      routeTimeAtDistance(event.from, options.levelId, options.mode);
    assert.ok(Math.abs(futureTime - projected.collisionEmptySeconds - event.futureOccupiedSeconds) < 1e-5,
      'committed witness credit uses a union, not duplicated future/emitted bodies');
  }
  assert.ok(rows.some(physical => physical.candidateBudget === 16), 'exercise measured density recovery');
  for (const physical of rows.filter(physical => physical.phase === 0 && physical.density)) {
    const through = physical.density.through;
    const prefix = rows.filter(row => row.plannedDistance <= through);
    const observed = layoutMetrics(prefix, {...options, endDistance: through});
    // The audit uses one-meter midpoint integration; selection uses the exact route clock.
    assert.ok(Math.abs(observed.collisionEmptySeconds - physical.density.emptySeconds) < 1e-5,
      'selection debt must match the independent emitted collision oracle');
    if (through > lateStart) {
      const observedLate = layoutMetrics(prefix, {...options, startDistance: lateStart, endDistance: through});
      assert.ok(Math.abs(observedLate.collisionEmptySeconds - physical.density.lateEmptySeconds) < 1e-5);
    }
  }
  const fillers = rows.flatMap((physical, index) => physical.emitted
    ? physical.intermediates.filter(hazard => hazard.filler).map(hazard => ({physical, index, hazard})) : []);
  const metrics = layoutMetrics(rows, options);
  const late = layoutMetrics(rows, {...options, startDistance: lateStart});
  const withoutFillers = layoutMetrics(rows.map(physical => ({...physical,
    intermediates: physical.intermediates.filter(hazard => !hazard.filler)})), options);
  t.diagnostic(JSON.stringify({fillers: fillers.length,
    kinds: [...new Set(fillers.map(({hazard}) => hazard.kind))],
    lanes: [...new Set(fillers.map(({hazard}) => hazard.lane))],
    collisionEmptySeconds: metrics.collisionEmptySeconds,
    lateCollisionEmptySeconds: late.collisionEmptySeconds,
    maximumEmptySeconds, maximumLateEmptySeconds,
    expandedEncounters: rows.filter(physical => physical.phase === 0 && physical.candidateBudget === 16).length,
    withoutFillersSeconds: withoutFillers.collisionEmptySeconds}));
  assert.ok(fillers.length > 0, 'fill actual requested gaps, not just offer unused candidate types');
  assert.ok(new Set(fillers.map(({hazard}) => hazard.kind)).size >= 3, 'real asset variety across sectors');
  assert.ok(new Set(fillers.map(({hazard}) => hazard.lane)).size > 1, 'stagger across different lanes');
  const centerX = (LANE_CENTERS[1] + LANE_CENTERS[2]) / 2;
  assert.ok(fillers.some(({hazard}) => hazardX(hazard) < centerX) &&
    fillers.some(({hazard}) => hazardX(hazard) > centerX), 'physical positions vary, not just lane labels');
  assert.ok(fillers.some(({hazard}) => hazard.lane === 0 || hazard.lane === 3),
    'use road edges as well as interior lanes');
  assert.ok(metrics.collisionEmptySeconds < withoutFillers.collisionEmptySeconds,
    'count actual additional collision-body occupancy, not decorations or duplicate footprints');
  // Preserve the original per-meter budgets on the authoritative campaign window.
  assert.ok(metrics.collisionEmptySeconds < maximumEmptySeconds);
  assert.ok(late.collisionEmptySeconds < maximumLateEmptySeconds);
  for (const {physical, index, hazard} of fillers) {
    const palette = CHALLENGE_PROFILES[sectorAtDistance(physical.plannedDistance, options.levelId).challengeProfileId];
    assert.ok(palette.fillerHazardFamilies.includes(hazard.kind));
    assert.notEqual(hazard.kind, 'pylon');
    assert.ok(!hazardDefinition(hazard.kind).roadside);
    assert.ok(Math.abs(hazardX(hazard) - centerX) >= GAME_BALANCE.routes.track.laneSpacingPx / 2,
      'do not repeat the former central-gap placement');
    assert.ok(physical.plannedDistance >= GAME_BALANCE.routes.level1.sectorStartsMeters[1]);
    assert.notEqual(physical.pacing, 'recovery');
    assert.equal(physical.intermediates.filter(candidate => candidate.filler).length, 1);
    assert.ok(physical.intermediates.length <= GAME_BALANCE.routes.track.betaSlots.length);
    assert.ok(Math.abs(hazard.offsetY +
      physical.spacingPx * GAME_BALANCE.routes.track.betaSlots[0]) < 1e-8);
    assert.ok(!physical.hazards.some(candidate => candidate.movement));
    assert.ok(!rows[index + 1]?.hazards.some(candidate => candidate.movement));
    assert.ok(![...physical.hazards, ...physical.intermediates.filter(candidate => candidate !== hazard)]
      .some(candidate => hazardSweptArtOverlaps(hazard, candidate)));
    assert.ok(hazardsBeforeDepot(physical, physical.plannedDistance, physical.nextDepot));
    assert.ok(physical.certificates.every(proof => proof.completed &&
      proof.clearance >= GAME_BALANCE.routes.track.routeValidation.minimumClearancePx));
  }
  const predicted = physicalPressureMetrics(rows, options);
  assert.deepEqual(predicted.violations, []);
  const actual = collisionEvents(rows, options);
  assert.equal(actual.length, predicted.events.length);
  for (const [index, event] of actual.entries()) {
    assert.equal(event.distance, predicted.events[index].distance);
    assert.deepEqual(event.mask, predicted.events[index].threatenedLanes);
  }
});

test('secondary fillers: short Continuous continuation is deterministic and uses its native palette', () => {
  const rows = sampleRoute(153, 8600, false, 'level1', 'continuous', 8000);
  assert.deepEqual(sampleRoute(153, 8600, false, 'level1', 'continuous', 8000), rows);
  const fillers = rows.flatMap(physical => physical.intermediates.filter(hazard => hazard.filler));
  assert.ok(fillers.length > 0);
  for (const hazard of fillers) assert.ok(CHALLENGE_PROFILES.industrial.fillerHazardFamilies.includes(hazard.kind));
  assert.ok(rows.every(physical => physical.certificates.every(proof => proof.completed &&
    proof.clearance >= GAME_BALANCE.routes.track.routeValidation.minimumClearancePx)));
  assert.deepEqual(physicalPressureMetrics(rows, {levelId: 'level1', mode: 'continuous',
    startDistance: 8000, endDistance: 8600}).violations, []);
});

test('formation: actual collision checks independently verify Alpha Beta continuation and timed pressure in all16 routes', () => {
  for (const options of cases) {
    const {rows, metrics} = routeFor(options);
    const physical = collisionEvents(rows, options);
    assert.equal(physical.length, metrics.events.length, JSON.stringify(options));
    const streaks = [0, 0, 0, 0];
    let rowMask = [false, false, false, false];
    for (const [index, actual] of physical.entries()) {
      const predicted = metrics.events[index];
      assert.equal(actual.distance, predicted.distance);
      assert.deepEqual(actual.mask, predicted.threatenedLanes, JSON.stringify({options, index, actual, predicted}));
      // Streaks count rows: the last event of a physical row closes it.
      rowMask = rowMask.map((blocked, lane) => blocked || actual.mask[lane]);
      if (physical[index + 1]?.rowIndex === actual.rowIndex) continue;
      for (let lane = 0; lane < 4; lane++) {
        streaks[lane] = rowMask[lane] ? 0 : streaks[lane] + 1;
        assert.ok(streaks[lane] <= GAME_BALANCE.routes.track.maximumClearEvents[options.mode],
          JSON.stringify({options, actual, lane, streaks}));
      }
      rowMask = [false, false, false, false];
    }
  }
});

test('formation: emitted side funnels alternate with interior hazards and wider recovery rather than a permanent open lane', context => {
  let curbFunnels = 0, interiorSideContacts = 0;
  for (const options of cases) {
    const {rows} = routeFor(options);
    const structures = rows.filter(physical => physical.emitted).flatMap(physical =>
      physical.hazards.filter(hazard => hazard.sideObstacle && !hazard.continuation));
    assert.ok(structures.some(hazard => hazard.lane === 0), JSON.stringify(options));
    assert.ok(structures.some(hazard => hazard.lane === 3), JSON.stringify(options));
    assert.ok(structures.some((hazard, index) => index > 0 && hazard.lane !== structures[index - 1].lane));
    const events = collisionEvents(rows, options);
    let funnels = 0, interior = 0, narrow = false, widerRecovery = false;
    for (const physical of events) {
      const corridor = [0, 1, 2, 3].filter(lane => !physical.side[lane]);
      if (corridor.length > 0 && corridor.length < 4) {
        funnels++;
        if (physical.side[0] || physical.side[3]) curbFunnels++;
        if (physical.side[1] || physical.side[2]) interiorSideContacts++;
        if (corridor.some(lane => physical.discrete[lane])) interior++;
      }
      const open = physical.mask.filter(blocked => !blocked).length;
      if (open <= 1) narrow = true;
      if (narrow && open >= 2) widerRecovery = true;
    }
    assert.ok(funnels > 0 && interior > 0 && widerRecovery, JSON.stringify({options, funnels, interior}));
    assert.ok(rows.some(physical => physical.certificates[0].lanes.some((lane, index, path) =>
      index > 0 && lane !== path[index - 1])), 'certified formations require actual lateral transitions');
    context.diagnostic(JSON.stringify({options, structures: structures.length, funnels, interior, widerRecovery}));
  }
  // Roadside bodies are single-lane curb guardrails: they narrow the road at a curb, never inside it.
  assert.ok(curbFunnels > 0, 'side structures must physically narrow the road at a curb');
  assert.equal(interiorSideContacts, 0, 'side structures never occupy an interior lane');
});

test('formation: a slalom inside a continuous two-lane funnel is geometrically open but a closed physical passage is rejected', () => {
  // Owner rule: certification proves an open corridor at >= 6 px, not that a stock truck can steer it.
  const options = {geometric: true, minimumClearancePx: GAME_BALANCE.routes.track.routeValidation.minimumClearancePx,
    initialStates: [{lane: 1, x: LANE_CENTERS[1], velocity: 0}]};
  const spacing = rowSpacingAtSpeed(600) + 600 * ROW_REACTION_SECONDS;
  // Roadside bodies are single curb lanes, so a two-lane funnel needs continuous rails on both curbs.
  const rail = side => ({kind: 'sideWall', lane: side, offsetX: 0, sideObstacle: true,
    sideObstacleId: `fixture-wall-${side}`, spanRows: 3,
    lengthPx: spacing * 2 + hazardDefinition('sideWall').height});
  const rows = [2, 1, 2].map((lane, index) => {
    const hazards = [...[0, 3].map(side => ({...rail(side), continuation: index > 0, spanPhase: index,
      offsetY: index * spacing - spacing})), {kind: 'divider', lane, offsetX: 0, offsetY: 0}];
    const blocked = hazards.flatMap(hazardBlockedIntervals);
    return {hazards, intermediates: [], spacingPx: spacing, cargoLanes: [],
      safeLanes: [0, 1, 2, 3].filter(lane => !blocked.some(([left, right]) =>
        LANE_CENTERS[lane] > left && LANE_CENTERS[lane] < right))};
  });
  assert.ok(rows.every(row => row.safeLanes.every(lane => lane === 1 || lane === 2)), 'curb rails funnel to two lanes');
  const viable = validateTrackSequence(rows, 600, options);
  assert.ok(viable.completed && viable.clearance >= 6, JSON.stringify(viable));
  assert.deepEqual(viable.lanes, [1, 2, 1], 'interior hazards require successive steering changes');
  const curbs = [0, 3].map(lane => ({kind: 'sideWall', lane, offsetX: 0, offsetY: 0, sideObstacle: true}));
  const funnel = {hazards: curbs, intermediates: [], spacingPx: spacing, safeLanes: [1, 2], cargoLanes: []};
  const open = validateTrackSequence([rows[0], funnel], 600, options);
  assert.ok(open.completed && open.clearance >= 6, 'curbs alone leave a viable two-lane passage');
  // The closed row falsely advertises both interior lanes, so only physical clearance can reject it.
  const closed = {...funnel, hazards: [...curbs, ...[1, 2].map(lane =>
    ({kind: 'divider', lane, offsetX: 0, offsetY: 0}))]};
  const {minX, maxX} = GAME_BALANCE.routes.track.routeValidation;
  let best = -Infinity;
  for (let x = minX; x <= maxX; x += 0.25) {
    best = Math.max(best, Math.min(...closed.hazards.map(hazard => hazardClearance(hazard, 0, x))));
  }
  assert.ok(best < 6, `no continuous road position has required clearance: ${best}`);
  assert.equal(validateTrackSequence([rows[0], closed], 600, options).completed, false);
});

test('formation: speculative rejections and diagnostic reads never mutate published physical layouts or deterministic successors', () => {
  const observed = createTrackStream(1234, 'level1', 'continuous');
  const untouched = createTrackStream(1234, 'level1', 'continuous');
  const published = [];
  let distance = 6000, retried = false;
  while (distance < 9000) {
    const actual = observed.nextRow(distance);
    assert.deepEqual(actual, untouched.nextRow(distance));
    for (const [physical, frozen] of published) assert.equal(JSON.stringify(physical), frozen);
    observed.pressureSnapshot(distance);
    retried ||= actual.candidateAttempts > 1;
    published.push([actual, JSON.stringify(actual)]);
    distance += actual.spacingPx * METERS_PER_PIXEL;
  }
  assert.ok(retried, 'exercise actual rejected or unselected proposals');
});
