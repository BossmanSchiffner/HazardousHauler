import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHUNK_REGISTRIES, prepareTrackChunk, createTrackStream, encounterDensityAtDistance,
  hazardsBeforeDepot, rowSpacingAtSpeed, trackEncounterSignature, chunkCollisionCoverage,
  maximumObstacleGapSeconds,
} from '../src/game/core/trackGenerator.js';
import {routeSpeedAtDistance, METERS_PER_PIXEL, MAX_TRACK_SPEED} from '../src/game/core/economy.js';
import {HAZARD_TRAVEL_PX} from '../src/game/data/route.js';
import {validateTrackSequence, driveTrackTransition} from '../src/game/core/trackValidation.js';
import {hazardX, hazardBlockedIntervals, hasStraightRoute, straightRouteWidth, hazardArtOverlaps} from '../src/game/core/hazards.js';
import {WORST_CASE_HANDLING, loadoutStats} from '../src/game/core/modules.js';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';
import {HAZARD_ROW_ENVELOPE_PX, hazardGeometry, physicalPressureMetrics, sideHazardQuota,
  movingHazardQuota, movingHazardMinimumForInterval, hazardFirstContactDistance,
  hazardRouteOffsetY, hazardRouteGeometry} from '../src/game/core/hazards.js';
import {sampleRoute, layoutMetrics, auditRoutes, minimumLaneChanges, depotPacing} from '../scripts/route-audit.mjs';
import {DEPOT_RULES, nextMoverWindowAfter} from '../src/game/core/depots.js';
import {DEPOT_APPROACH_HINT_M} from '../src/game/core/onboarding.js';
import {IMPLEMENTED_SECTORS, IMPLEMENTED_LEVELS} from '../src/game/core/sectors.js';

// Owner rule: routes must be geometrically open at >= 6 px; whether a build can steer them is decided by
// upgrades, so route checks use the generator's own geometric certificate rather than the stock truck.
const baselineOptions = {geometric: true,
  minimumClearancePx: GAME_BALANCE.routes.track.routeValidation.minimumClearancePx};
// Same last-contact envelope depotPacing uses for warningEncounters (which counts hazards, not encounters).
const warningContactEnd = (hazard, spawnDistance) => spawnDistance + (HAZARD_TRAVEL_PX -
  hazardRouteOffsetY(hazard) + Math.max(HAZARD_ROW_ENVELOPE_PX / 2, hazardRouteGeometry(hazard).hitY)) *
  METERS_PER_PIXEL;

test('static baseline retains certified Beta pressure throughout every Level 1 sector', () => {
  for (const seed of [1, 153, 2330762723]) {
    const rows = sampleRoute(seed, GAME_BALANCE.routes.level1.finishDistanceMeters, false, 'level1', 'normal');
    const emitted = rows.filter(row => row.emitted);
    assert.ok(emitted.every(row => row.hazards.length > 0));
    assert.ok(emitted.every(row => row.hazards.every(hazard => !hazard.movement)));
    assert.ok(emitted.filter(row => row.motifId).length > emitted.length / 2);
    assert.ok(emitted.every(row => row.certificates.every(proof => proof.completed && proof.clearance >= 6)));
    for (const [index, start] of GAME_BALANCE.routes.level1.sectorStartsMeters.entries()) {
      const end = GAME_BALANCE.routes.level1.sectorEndsMeters[index];
      const sector = emitted.filter(row => row.plannedDistance >= start && row.plannedDistance < end);
      assert.ok(sector.flatMap(row => row.intermediates).length >= sector.length / 2,
        `${seed}/${start}: static baseline lost its Beta obstacles`);
    }
    const actual = chunkCollisionCoverage(rows);
    assert.ok(actual.occupiedSeconds / actual.routeSeconds >= 1 / 3,
      `${seed}: physical obstacle occupancy regressed below the sampled baseline target`);
    assert.ok(new Set(emitted.flatMap(row => row.hazards).map(hazard => hazard.kind)).size >= 3,
      `${seed}: static formations lost their hazard variety`);
    const groups = [];
    let group = null;
    for (const row of rows) {
      if (!row.emitted) { group = null; continue; }
      if (!group) { group = []; groups.push(group); }
      group.push(row);
    }
    assert.ok(groups.every(rows => maximumObstacleGapSeconds(rows) <= 1.55),
      `${seed}: non-Depot obstacle cadence regressed`);
    const alphaOnly = chunkCollisionCoverage(rows.map(row => ({...row, intermediates: []})));
    assert.ok(actual.occupiedSeconds > alphaOnly.occupiedSeconds * 1.35,
      `${seed}: Betas must add meaningful physical occupancy, not merely row labels`);
  }
});

test('connected coverage: actual collision-free time stays distinct from padded gap guards and continuation counts', () => {
  const distance = 100;
  const hazard = {kind: 'divider', lane: 0, offsetX: 0, offsetY: 0};
  const center = distance + HAZARD_TRAVEL_PX * METERS_PER_PIXEL;
  const row = {spawnDistance: distance, plannedDistance: distance, emitted: true, phase: 0,
    family: 'single_pressure', hazards: [hazard], intermediates: []};
  const options = {startDistance: center - 10, endDistance: center + 10};
  const metrics = layoutMetrics([row], options);
  assert.ok(Math.abs(metrics.collisionEmptyMeters -
    (20 - 2 * hazardGeometry(hazard).hitY * METERS_PER_PIXEL)) < 1e-8);
  const continuation = {...row, phase: 1, hazards: [{...hazard, continuation: true}]};
  assert.deepEqual(layoutMetrics([row, continuation], options), metrics);
  const cleared = {...row, lifetime: {clearedAtDistance: distance}};
  assert.equal(layoutMetrics([cleared], options).collisionEmptyMeters, 20);
});

test('side coverage repair: missed wall opportunities retain useful physical pressure', t => {
  const options = {levelId: 'level1', mode: 'normal', startDistance: 9, endDistance: 8000};
  const started = performance.now();
  const rows = sampleRoute(153, options.endDistance, false, options.levelId, options.mode,
    options.startDistance);
  const generationMs = performance.now() - started;
  const metrics = layoutMetrics(rows, options);
  const nonSideMetrics = layoutMetrics(rows.map(row => ({...row,
    hazards: row.hazards.filter(hazard => !hazard.sideObstacle),
    intermediates: row.intermediates.filter(hazard => !hazard.sideObstacle)})), options);
  const sideExclusiveSeconds = nonSideMetrics.collisionEmptySeconds - metrics.collisionEmptySeconds;
  const pressure = physicalPressureMetrics(rows, options);
  const commonClearPairs = pressure.events.slice(1).filter((event, index) =>
    event.threatenedLanes.some((threat, lane) => !threat &&
      !pressure.events[index].threatenedLanes[lane])).length;
  const sources = rows.flatMap((row, index) => row.emitted ? row.hazards.filter(hazard =>
    hazard.sideObstacle && !hazard.continuation &&
    hazardFirstContactDistance(hazard, row.plannedDistance) < options.endDistance)
    .map(hazard => ({row, index, hazard})) : []);
  const walls = sources.filter(({hazard}) => hazard.kind === 'sideWall');
  const encounters = new Map();
  const anchors = new Map();
  const layouts = [];
  for (const row of rows) {
    if (!encounters.has(row.encounterId)) encounters.set(row.encounterId, []);
    encounters.get(row.encounterId).push(row);
    assert.ok([GAME_BALANCE.routes.track.encounters.candidateBudget,
      GAME_BALANCE.routes.track.encounters.densityRecovery.candidateBudget].includes(row.candidateBudget));
    assert.ok(row.candidateAttempts <= row.candidateBudget);
    assert.ok(row.intermediates.length <= GAME_BALANCE.routes.track.betaSlots.length);
    assert.ok(row.certificates.every(proof => proof.completed &&
      proof.clearance >= GAME_BALANCE.routes.track.routeValidation.minimumClearancePx));
    for (const hazard of row.hazards.filter(hazard => hazard.sideObstacleId)) {
      const center = row.plannedDistance - hazard.offsetY * METERS_PER_PIXEL;
      if (!hazard.continuation) {
        assert.ok(!anchors.has(hazard.sideObstacleId));
        anchors.set(hazard.sideObstacleId, center);
        if (!hazard.pinch) assert.ok(row.hazards.some(other => !other.sideObstacle && !other.continuation));
        else assert.ok([0, 3].includes(hazard.lane) && hazard.spanRows === 1);
      } else assert.ok(Math.abs(anchors.get(hazard.sideObstacleId) - center) < 1e-8);
    }
  }
  for (const encounter of encounters.values()) if (encounter.length === encounter[0].sequenceLength) {
    assert.equal(encounter[0].signature, trackEncounterSignature(encounter[0].family, encounter));
  }
  for (const {row, index, hazard} of walls) {
    const tail = rows.slice(index, index + hazard.spanRows);
    assert.equal(tail.length, 4);
    assert.ok(tail.every(part => part.emitted && part.hazards.some(reference =>
      reference.sideObstacleId === hazard.sideObstacleId)));
    const layout = rows.slice(index - 1, index + hazard.spanRows + 1);
    const proof = validateTrackSequence(layout, i => routeSpeedAtDistance(
      layout[i].plannedDistance + (HAZARD_TRAVEL_PX + HAZARD_ROW_ENVELOPE_PX / 2) *
      METERS_PER_PIXEL, options.levelId, options.mode),
    {...baselineOptions, initialStates: row.certificates[0].entries});
    assert.ok(proof.completed && proof.clearance >=
      GAME_BALANCE.routes.track.routeValidation.minimumClearancePx,
    `connected wall tail at ${row.plannedDistance}`);
    layouts.push({sourceDistance: row.plannedDistance, lane: hazard.lane,
      clearance: proof.clearance, lanes: proof.lanes,
      rows: layout.map(part => ({distance: part.plannedDistance, family: part.family,
        phase: part.phase, safe: part.safeLanes, hazards: part.hazards.map(h => ({
          kind: h.kind, lane: h.lane, continuation: h.continuation ?? false})),
        betas: part.intermediates.map(h => ({lane: h.lane, offsetY: h.offsetY}))}))});
  }
  const entries = [...encounters.values()].map(encounter => encounter[0]);
  t.diagnostic(JSON.stringify({seed: 153, options, generationMs, rows: rows.length, metrics,
    rails: sources.length - walls.length, walls: walls.length, sideExclusiveSeconds,
    commonClearPairs, adjacentEventPairs: pressure.events.length - 1,
    maximumClearStreakByLane: pressure.maximumClearStreakByLane,
    meanCandidateAttempts: entries.reduce((sum, row) => sum + row.candidateAttempts, 0) / entries.length,
    wallLayouts: layouts}));
  assert.ok(pressure.events.length > 0, 'pressure history is diagnostic; actual path certificates gate generation');
  assert.ok(sideHazardQuota(metrics.obstacles, metrics.side).acceptable);
  assert.ok(metrics.obstacles - metrics.side >= 296);
  assert.ok(metrics.drivingMaximumEmptySeconds <= 3 + 1e-8);
  assert.equal(rows.filter(row => row.emitted).flatMap(row => row.hazards)
    .filter(hazard => hazard.movement && !hazard.continuation).length, 0);
  assert.ok(pressure.events.some(event =>
    event.threatenedLanes.filter(threat => !threat).length >= 2), 'retain wider recovery');
  // Retained pre-repair L1/153 measurements use these same event and footprint definitions.
  assert.ok(walls.length > 0, 'retain occasional long single-lane guardrails');
  assert.ok(sideExclusiveSeconds > 0, 'physical side bodies add occupied time');
});

test('connected coverage: three production routes reduce accidental openness without waiving existing guards', async context => {
  // Current-source pre-edit measurements, not new gameplay quotas. L2 Normal aborted at finish;
  // its comparison uses the retained completed prefix, while safety checks cover the full run.
  const cases = [
    {levelId: 'level1', mode: 'normal', seed: 153, startDistance: 9, endDistance: 8000,
      compareEnd: 8000, beforeEmpty: 201.96721254298316, beforeMulti: 213 / 331,
      beforeConsecutive: 141 / 330, beforeSideChanges: 12 / 24, nonSideFloor: 296, gapCeiling: 3.114},
    {levelId: 'level2', mode: 'normal', seed: 153, startDistance: 9, endDistance: 4000,
      compareEnd: 4000, beforeEmpty: 154.68937022627523, beforeMulti: 145 / 241,
      beforeConsecutive: 98 / 240, beforeSideChanges: 10 / 16, nonSideFloor: 284, gapCeiling: 3.279},
    {levelId: 'level1', mode: 'continuous', seed: 98765, startDistance: 9, endDistance: 6000,
      compareEnd: 6000, nonSideFloor: null},
  ];
  for (const options of cases) await context.test(`${options.levelId}/${options.mode}/${options.seed}`, t => {
    const rows = sampleRoute(options.seed, options.endDistance, false, options.levelId,
      options.mode, options.startDistance);
    const metrics = layoutMetrics(rows, options);
    const comparison = {...options, endDistance: options.compareEnd};
    const comparedMetrics = layoutMetrics(rows, comparison);
    const pressure = physicalPressureMetrics(rows, options);
    const comparedPressure = physicalPressureMetrics(rows, comparison);
    const multi = comparedPressure.events.filter(event => event.simultaneousMulti).length;
    const consecutive = comparedPressure.events.slice(1).filter((event, index) =>
      event.simultaneousMulti && comparedPressure.events[index].simultaneousMulti).length;
    const sides = rows.filter(row => row.emitted).flatMap(row => row.hazards.filter(hazard =>
      hazard.sideObstacle && !hazard.continuation &&
      hazardFirstContactDistance(hazard, row.plannedDistance) < options.compareEnd));
    const sideChanges = sides.slice(1).filter((hazard, index) => hazard.lane !== sides[index].lane).length;
    const movers = rows.filter(row => row.emitted).flatMap(row => row.hazards.filter(hazard =>
      hazard.movement && !hazard.continuation).map(hazard => ({
        row, hazard, contact: hazardFirstContactDistance(hazard, row.plannedDistance),
      }))).filter(mover => mover.contact < options.endDistance);
    const moverCounts = new Map();
    for (const mover of movers) {
      const end = nextMoverWindowAfter(mover.contact, DEPOT_RULES, options.levelId, options.mode).distance;
      moverCounts.set(end, (moverCounts.get(end) ?? 0) + 1);
    }
    const encounters = new Map();
    for (const row of rows) {
      if (!encounters.has(row.encounterId)) encounters.set(row.encounterId, []);
      encounters.get(row.encounterId).push(row);
    }
    t.diagnostic(JSON.stringify({options, rows: rows.length, metrics,
      comparison: {collisionEmptySeconds: comparedMetrics.collisionEmptySeconds,
        events: comparedPressure.events.length, multi, consecutive,
        sideLanes: sides.map(hazard => hazard.lane), sideChanges},
      maximumClearStreakByLane: pressure.maximumClearStreakByLane,
      moverCounts: Object.fromEntries(moverCounts),
      orientations: [...new Set(movers.map(mover => mover.hazard.lane))],
      pairedBodies: movers.filter(mover => mover.row.sequenceLength === 4).length,
      sideExamples: rows.filter(row => row.emitted && row.hazards.some(hazard =>
        hazard.sideObstacle && !hazard.continuation)).slice(0, 3).map(row => ({
          distance: row.plannedDistance, family: row.family, hazards: row.hazards, betas: row.intermediates,
        }))}));
    assert.ok(pressure.events.length > 0);
    assert.ok(sideHazardQuota(metrics.obstacles, metrics.side).acceptable);
    if (options.nonSideFloor !== null) assert.ok(metrics.obstacles - metrics.side >= options.nonSideFloor);
    assert.ok(metrics.drivingMaximumEmptySeconds <= 3 + 1e-8,
      `ordinary driving gap ${metrics.drivingMaximumEmptySeconds}s`);
    assert.ok(sideChanges > 0, 'both shoulders remain represented');
    assert.ok(comparedPressure.events.some(event =>
      event.threatenedLanes.filter(threat => !threat).length >= 2), 'preserve wider recovery');
    assert.ok(comparedMetrics.collisionEmptySeconds > 0, 'not a continuous physical wall');
    const sources = new Map();
    for (const row of rows) {
      assert.ok([GAME_BALANCE.routes.track.encounters.candidateBudget,
        GAME_BALANCE.routes.track.encounters.densityRecovery.candidateBudget].includes(row.candidateBudget));
      assert.ok(row.candidateAttempts <= row.candidateBudget);
      assert.ok(row.intermediates.length <= GAME_BALANCE.routes.track.betaSlots.length);
      assert.ok(row.certificates.every(proof => proof.completed && proof.clearance >= 6));
      for (const hazard of row.hazards.filter(hazard => hazard.sideObstacleId)) {
        const center = row.plannedDistance - hazard.offsetY * METERS_PER_PIXEL;
        if (!hazard.continuation) {
          assert.ok(!sources.has(hazard.sideObstacleId));
          sources.set(hazard.sideObstacleId, center);
          if (!hazard.pinch) assert.ok(row.hazards.some(other => !other.sideObstacle && !other.continuation),
            'long side modifiers retain discrete hazards');
          else assert.ok([0, 3].includes(hazard.lane) && hazard.spanRows === 1);
        } else assert.ok(Math.abs(sources.get(hazard.sideObstacleId) - center) < 1e-8);
      }
    }
    for (const encounter of encounters.values()) {
      if (encounter.length === encounter[0].sequenceLength) {
        assert.equal(encounter[0].signature, trackEncounterSignature(encounter[0].family, encounter));
      }
      if (encounter[0].family !== 'moving_intercept' || encounter[0].sequenceLength !== 4 ||
          encounter.length < 4) continue;
      const first = encounter[0].hazards.find(hazard => hazard.movement);
      const second = encounter[2].hazards.find(hazard => hazard.movement);
      const secondCompanion = encounter[2].hazards.find(hazard => hazard.moverCompanion);
      assert.equal(second.lane, secondCompanion.lane === 0 ? 1 : 0);
      assert.equal(second.movement.direction, -first.movement.direction);
      assert.equal(encounter[2].phase - encounter[0].phase, 2);
      assert.ok(encounter[0].emitted && encounter[2].emitted);
    }
    if (options.levelId === 'level2') {
      const moving = GAME_BALANCE.routes.movingHazards;
      const introduction = IMPLEMENTED_LEVELS.level2[moving.firstSector - 1].startsAt;
      for (const {row, hazard} of movers) {
        assert.equal(hazard.kind, 'forklift', 'Level 2 movers are lateral Forklifts only');
        assert.ok([0, 3].includes(hazard.moverReservation.bypassLane));
        assert.ok(row.safeLanes.includes(hazard.moverReservation.bypassLane),
          'the local overlay retains a reachable outer bypass');
      }
      assert.ok(movers.every(mover => mover.contact >= introduction), 'Forklifts begin at their introduction sector');
      assert.ok(movers.some(mover => mover.row.moverOverlay), 'real Forklifts overlay ordinary baseline rows');
      assert.deepEqual([...moverCounts.keys()],
        IMPLEMENTED_LEVELS.level2.slice(moving.firstSector - 1).map(sector => sector.endsAt));
      for (const [end, count] of moverCounts) {
        const start = IMPLEMENTED_LEVELS.level2.find(sector => sector.endsAt === end).startsAt;
        assert.ok(movingHazardQuota(count, movingHazardMinimumForInterval(start, end)).acceptable);
      }
      for (let index = 1; index < movers.length; index++) assert.ok(
        movers[index].contact - movers[index - 1].contact >=
          GAME_BALANCE.routes.movingHazards.minimumEncounterSpacingMeters);
      for (const {row, hazard} of movers) assert.ok(row.safeLanes.includes(hazard.moverReservation.bypassLane));
      if (options.mode === 'normal') assert.ok(rows.filter(row => row.plannedDistance < 500)
        .every(row => row.family !== 'moving_intercept' || row.sequenceLength === 2));
    } else assert.equal(movers.length, 0);
  });
});

test('density targets are additive and bounded across sectors and Depot stretches', () => {
  for (const [index, target] of [1, 1.15, 1.3, 1.45].entries()) {
    const start = IMPLEMENTED_SECTORS[index].startsAt;
    for (let stretch = 0; stretch < 4; stretch++) {
      const end = IMPLEMENTED_SECTORS.find(s => s.startsAt > start)?.startsAt ?? Infinity;
      const distance = start + stretch * 600;
      if (distance < end) assert.ok(Math.abs(encounterDensityAtDistance(distance) - target - stretch * 0.02) < 1e-9);
    }
  }
  assert.ok(Math.abs(encounterDensityAtDistance(1e6) - 1.51) < 1e-9, 'normal density stays at the Sector 4 step');
  for (const levelId of ['level1', 'level2']) {
    const finish = GAME_BALANCE.routes[levelId].finishDistanceMeters;
    const final = encounterDensityAtDistance(finish - 1, levelId);
    for (const distance of [finish, finish + 2000, 1e6]) {
      assert.equal(encounterDensityAtDistance(distance, levelId), final,
        `${levelId} holds its final sector step past the finish`);
    }
    assert.throws(() => encounterDensityAtDistance(finish, levelId, 'overdrive'), /overdrive/);
  }
  const continuous = GAME_BALANCE.routes.continuous;
  const baselineDensity = encounterDensityAtDistance(
    IMPLEMENTED_LEVELS[continuous.baselineLevelId][continuous.baselineSector - 1].startsAt,
    continuous.baselineLevelId);
  for (const distance of [0, 999, 1000, 8000, 1e6]) {
    assert.equal(encounterDensityAtDistance(distance, 'level1', 'continuous'), baselineDensity,
      'Continuous keeps the baseline sector density instead of compounding');
  }
});

test('Continuous Run raises speed per Depot milestone to the single track cap with baseline density', () => {
  const rules = GAME_BALANCE.routes.continuous;
  for (let milestone = 0; milestone < 12; milestone++) {
    const expected = Math.min(MAX_TRACK_SPEED, rules.startSpeedPxPerSecond + milestone * rules.milestoneSpeedStep);
    const start = milestone * rules.depotIntervalMeters;
    assert.equal(routeSpeedAtDistance(start, 'level1', 'continuous'), expected);
    assert.equal(routeSpeedAtDistance(start + rules.depotIntervalMeters - 0.001, 'level1', 'continuous'), expected,
      'speed steps at Depot milestones, not between them');
  }
  assert.equal(routeSpeedAtDistance(100000, 'level1', 'continuous'), MAX_TRACK_SPEED);
  assert.throws(() => routeSpeedAtDistance(0, 'level2', 'continuous'));
  const stream = createTrackStream(209, 'level1', 'continuous');
  assert.ok(stream.nextRow(5000, true).hazards.length > 0, 'Continuous reuses certified route hazards');
});

test('Continuous route chunks remain traversable across speed milestones up to the track cap', () => {
  const rules = GAME_BALANCE.routes.continuous;
  const capped = Math.ceil((MAX_TRACK_SPEED - rules.startSpeedPxPerSecond) / rules.milestoneSpeedStep) *
    rules.depotIntervalMeters;
  for (const seed of [1, 1234]) {
    const stream = createTrackStream(seed, 'level1', 'continuous');
    const chunks = [];
    let distance = capped - 3 * rules.depotIntervalMeters;
    while (distance < capped + 2 * rules.depotIntervalMeters) {
      const row = stream.nextRow(distance, true);
      row.spawnDistance = distance;
      let chunk = chunks.at(-1);
      if (!chunk || chunk.id !== row.chunkId) chunks.push(chunk = {id: row.chunkId, rows: []});
      chunk.rows.push(row);
      distance += row.spacingPx * METERS_PER_PIXEL;
    }
    assert.ok(chunks.some(chunk => chunk.rows.some(row =>
      routeSpeedAtDistance(row.spawnDistance, 'level1', 'continuous') < MAX_TRACK_SPEED)));
    assert.ok(chunks.some(chunk => chunk.rows.some(row =>
      routeSpeedAtDistance(row.spawnDistance, 'level1', 'continuous') === MAX_TRACK_SPEED)));
    for (const chunk of chunks) {
      const route = validateTrackSequence(chunk.rows,
        index => routeSpeedAtDistance(chunk.rows[index].spawnDistance +
          (HAZARD_TRAVEL_PX + HAZARD_ROW_ENVELOPE_PX / 2) * METERS_PER_PIXEL, 'level1', 'continuous'),
        {...baselineOptions, levelId: 'level1', mode: 'continuous', hz: 60});
      assert.ok(route.completed && route.clearance >= 6,
        `continuous, seed ${seed}, ${chunk.id} was not reachable with >=6 px clearance`);
    }
  }
});

test('production-stream Depot stretches compose across chunk joins as geometrically open corridors', () => {
  let joins = 0, stretches = 0;
  for (const enterDepots of [false, true]) for (const seed of [1, 153, 1234, 98765]) {
    let segment = [];
    const check = () => {
      if (segment.length < 2) return;
      stretches++;
      joins += segment.length - 1;
      for (const hz of [30, 60, 120]) {
        const result = validateTrackSequence(segment, i =>
          routeSpeedAtDistance(segment[i].spawnDistance +
            (HAZARD_TRAVEL_PX + HAZARD_ROW_ENVELOPE_PX / 2) * METERS_PER_PIXEL),
        {...baselineOptions, hz});
        assert.ok(result.completed && result.clearance >= 6,
          `seed ${seed}, ${segment[0].spawnDistance}, ${hz}Hz: ${result.clearance}`);
      }
    };
    for (const row of sampleRoute(seed, undefined, enterDepots)) {
      if (!row.emitted || (segment.length && segment[0].nextDepot !== row.nextDepot)) {
        check();
        segment = [];
      }
      if (row.emitted) segment.push(row);
    }
    check();
  }
  assert.ok(joins >= 800, `four-sector integrated transitions: ${joins}`);
  assert.ok(stretches >= 24, `composed optional-Depot intervals: ${stretches}`);
});

test('capped four-sector encounters preserve open paths and permit centered pinch recovery', () => {
  const {sectors, depotPacing: pacing} = auditRoutes();
  assert.deepEqual(Object.keys(sectors), IMPLEMENTED_SECTORS.map(sector => sector.id));
  for (const s of Object.values(sectors)) {
    assert.ok(s.encountersPer100m > 0 && s.encountersPer100m < 15, 'single capped schedule');
    assert.ok(s.lateralPercent > 0 && s.lateralPercent <= 100, 'retain actual steering encounters');
    assert.equal(s.builds.open.completed, s.sequences, 'a geometrically open corridor is the mandatory reference');
    assert.ok(s.builds.open.minimumClearancePx >= 6);
    assert.ok(s.minimumAlphaChangesPer100m > 0, 'retain forced lane changes in every distance step');
  }
  assert.ok(Number.isFinite(pacing.maximumEmptyApproachSeconds) &&
    Number.isFinite(pacing.maximumEmptyExitSeconds), 'intentional Depot protection stays measured separately');
});

test('early Depot notice windows respect the 50 m clean approach: at most one encounter, pickups retained', () => {
  // Label, chevron and HUD visibility at exactly <= 60 m is asserted in rendering.test.js and sceneLifecycle.test.js.
  assert.equal(DEPOT_RULES.noticeMeters, 60);
  assert.equal(DEPOT_APPROACH_HINT_M, DEPOT_RULES.noticeMeters);
  // Pickups follow a seeded row cadence and a 60 m window holds one or two rows, so retention is judged
  // across the sampled seeds; protected (unemitted) rows must keep their pickups as well.
  let noticePickups = 0, protectedPickups = 0;
  for (const seed of [1, 153, 1234, 98765]) {
    const rows = sampleRoute(seed);
    const early = depotPacing(rows).filter(b => b.distance <= 2000);
    for (const bay of early) {
      // The protected 50 m approach nearly fills the 60 m notice window.
      const windowStart = bay.distance - DEPOT_RULES.noticeMeters;
      // Multi-row families (offset_pair, chicanes) share one encounterId, so count encounters, not rows.
      const encounters = new Set(rows.filter(r => r.emitted && [...r.hazards, ...r.intermediates].some(h =>
        !h.continuation && warningContactEnd(h, r.spawnDistance) >= windowStart &&
        warningContactEnd(h, r.spawnDistance) < bay.distance)).map(r => r.encounterId)).size;
      assert.ok(encounters <= 1, `seed ${seed} bay ${bay.distance}: ${encounters} encounters inside the notice window`);
      assert.ok(bay.emptyApproachMeters >= DEPOT_RULES.approachMeters,
        'preserve the owner-set clean Depot approach');
    }
    noticePickups += early.reduce((n, b) => n + b.warningPickups, 0);
    protectedPickups += rows.filter(r => !r.emitted).reduce((n, r) => n + r.pickups.length, 0);
  }
  assert.ok(noticePickups > 0, 'Depot notice windows retain pickups');
  assert.ok(protectedPickups > 0, 'Depot-protected rows keep their pickups');
});

test('sustained authored gates require repeated adjacent decisions, never a two-lane jump', () => {
  for (const chunks of Object.values(CHUNK_REGISTRIES).slice(1)) {
    const sustained = chunks.filter(c => c.sustained);
    assert.equal(sustained.length, 4);
    for (const chunk of sustained) {
      assert.ok(minimumLaneChanges(chunk.rows) >= 7);
      assert.equal(chunk.rows.filter(r => r.safeLanes.length === 1).length, 8);
      assert.ok(!hasStraightRoute(chunk.rows));
      const distance = IMPLEMENTED_SECTORS.at(-1).endsAt - 1;
      const prepared = prepareTrackChunk(chunk, distance, () => 1);
      const chosen = prepared.rows.map((r, i) => i === prepared.rows.length - 1
        ? {...r, safeLanes: r.cargoLanes} : r);
      assert.ok(validateTrackSequence(chosen, routeSpeedAtDistance(distance), baselineOptions).completed,
        'exit rewards remain reachable through the entire return, not a two-lane jump');
    }
  }
});

test('premium pickup choices retain open complete paths through the combined Alpha/Beta sequence', () => {
  let checked = 0;
  for (const seed of [153, 98765]) for (const distance of IMPLEMENTED_SECTORS.slice(1).map(s => s.startsAt)) {
    const stream = createTrackStream(seed);
    let sequence = [];
    let previous, approach;
    for (let i = 0; i < 160; i++) {
      const row = stream.nextRow(distance);
      if (row.phase === 0) { sequence = []; approach = previous; }
      sequence.push(row);
      previous = row;
      if (row.phase !== row.sequenceLength - 1 || !sequence.some(r => r.pickups.some(p => p.value > 5))) continue;
      const chosen = sequence.map(r => ({...r, safeLanes:
        r.pickups.some(p => p.value > 5) ? r.pickups.map(p => p.lane) : r.safeLanes}));
      const entry = approach ?? {hazards: [], intermediates: [], safeLanes: [1, 2],
        spacingPx: HAZARD_TRAVEL_PX + HAZARD_ROW_ENVELOPE_PX / 2};
      for (const hz of [30, 60, 120]) {
        const result = validateTrackSequence([entry, ...chosen], i =>
          routeSpeedAtDistance(chosen[i - 1].plannedDistance +
            (HAZARD_TRAVEL_PX + HAZARD_ROW_ENVELOPE_PX / 2) * METERS_PER_PIXEL),
        {...baselineOptions, hz, initialStates: row.certificates[0].entries});
        assert.ok(result.completed && result.clearance >= 6,
          `${row.chunkId}/${seed}/${hz}Hz: ${result.clearance}`);
      }
      checked++;
    }
  }
  assert.ok(checked >= 10, `actual rewarding sequences validated: ${checked}`);
});

test('authored augmented chunks retain complete half-load paths at 30/60/120 Hz without secondary-lane guarantees', () => {
  let added = 0;
  const positions = new Set();
  for (const [sectorIndex, chunks] of Object.values(CHUNK_REGISTRIES).entries()) {
    for (const stretch of [0, 3]) {
      // Legacy art registries are not extra playable sectors; reuse the final distance step.
      const step = Math.min(sectorIndex, IMPLEMENTED_SECTORS.length - 1);
      const start = IMPLEMENTED_SECTORS[step].startsAt;
      const end = IMPLEMENTED_SECTORS[step].endsAt;
      const distance = Math.min(start + stretch * 600, end - 100);
      const speed = routeSpeedAtDistance(distance + 100);
      for (const chunk of chunks) {
        const prepared = prepareTrackChunk(chunk, distance, () => 0);
        added += prepared.rows.reduce((n, r) => n + r.intermediates.length, 0);
        assert.ok(!hasStraightRoute(prepared.rows.map(r =>
          ({hazards: [...r.hazards, ...r.intermediates]}))), 'gentle and advanced sequences both deny straight driving');
        for (const row of prepared.rows) {
          assert.equal(row.spacingPx, rowSpacingAtSpeed(routeSpeedAtDistance(distance)));
          assert.ok(row.hazards.every(h => h.placement === 'alpha'));
          for (const h of row.intermediates) {
            assert.equal(h.kind, 'divider', 'authored characterization remains Jersey-only in every sector');
            assert.equal(h.placement, 'beta');
            positions.add(h.lane);
            assert.ok(h.offsetY < -64, 'genuinely between groups, not cosmetic intra-row stagger');
            assert.notEqual(hazardX(h), [86, 159, 232, 305][h.lane], 'off-grid horizontal composition');
            assert.ok(hazardBlockedIntervals(h).every(([left, right]) => Number.isFinite(left + right)));
          }
          for (let i = 0; i < prepared.rows.length - 1; i++) {
            const r = prepared.rows[i], next = prepared.rows[i + 1], accepted = [];
            for (const h of r.intermediates) {
              assert.ok(![...r.hazards, ...accepted].some(other => hazardArtOverlaps(h, other)));
              assert.ok(!next.hazards.some(other => hazardArtOverlaps(h, other, -r.spacingPx)),
                'Beta must not visually merge into the following Alpha set-piece');
              const local = [{hazards: [...r.hazards, ...accepted]}, next];
              const before = straightRouteWidth(local);
              const after = straightRouteWidth([...local, {hazards: [h]}]);
              assert.ok(before === 0 || after < before, 'Beta must shape an opening, not duplicate already-blocked space');
              accepted.push(h);
            }
          }
        }
        for (const hz of [30, 60, 120]) {
          const result = validateTrackSequence(prepared.rows, i => routeSpeedAtDistance(distance +
            (HAZARD_TRAVEL_PX + HAZARD_ROW_ENVELOPE_PX / 2 +
              prepared.rows.slice(0, i).reduce((sum, row) => sum + row.spacingPx, 0)) * METERS_PER_PIXEL),
          {...baselineOptions, reactionSeconds: 0, hz});
          assert.ok(result.completed && result.clearance >= 6, `${chunk.id} ${distance}/${hz}: ${result.clearance}`);
        }
      }
    }
  }
  assert.ok(added > 20, `intermediates actually present: ${added}`);
  assert.deepEqual([...positions].sort(), [0, 1, 2, 3]);
});

test('emitted stream is reproducible and resets safely at Depots without additional pickups', () => {
  const sequence = seed => {
    const stream = createTrackStream(seed);
    const rows = [];
    for (let i = 0; i < 400; i++) {
      const d = i * 20;
      const row = stream.nextRow(d);
      assert.ok(row.pickups.length <= 1);
      for (const h of row.intermediates) assert.ok(row.warningLanes.includes(h.lane));
      if (row.hazardLanes.length === 2 && row.hazardLanes.includes(0) && row.hazardLanes.includes(3) &&
          row.intermediates.every(h => h.lane === 0 || h.lane === 3)) {
        assert.deepEqual(row.warningLanes, [0, 3], 'outer warnings must not imply a four-lane wall');
      }
      assert.equal(hazardsBeforeDepot(row, 450 - HAZARD_TRAVEL_PX * METERS_PER_PIXEL, 450), false);
      assert.equal(hazardsBeforeDepot(row, 451, 900), true);
      rows.push(row);
      if (i % 17 === 0) {
        stream.resetAfterDepot(d);
      }
    }
    return rows;
  };
  assert.deepEqual(sequence(123), sequence(123));
  assert.notDeepEqual(sequence(123), sequence(456));
});
