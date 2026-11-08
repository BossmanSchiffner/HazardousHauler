import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTHORED_CHUNKS,
  CHUNK_REGISTRIES,
  LEVEL2_CHUNK_REGISTRIES,
  canReachLaneSet,
  CARGO_COLLISION_DISTANCE_PX,
  COLLISION_CLEARANCE_PX,
  createTrackGenerator,
  createTrackStream,
  DEPOT_RESUME_METERS,
  HAZARD_COLLISION_DISTANCE_PX,
  hasNoTrapLanes,
  hazardsBeforeDepot,
  isChunkReachable,
  lateralDemandPx,
  LANE_SPACING_PX,
  depotResumeFirstDistance,
  rowSpacingAtSpeed,
  TRACK_LANES,
  WORST_CASE_LANE_CLEAR_SECONDS,
  BEST_CASE_LANE_CLEAR_SECONDS,
  ROW_REACTION_SECONDS,
} from '../src/game/core/trackGenerator.js';
import {laneClearTimeSeconds} from '../src/game/core/steering.js';
import {WORST_CASE_HANDLING} from '../src/game/core/modules.js';
import {MAX_HAZARD_HIT_X, hazardDefinition, hazardGeometry, hazardSweptArtOverlaps, straightRouteWidth, sideHazardQuota,
  HAZARD_ROW_ENVELOPE_PX, LANE_CENTERS, guardrailLayout, guardrailMinimumLength} from '../src/game/core/hazards.js';
import {HAZARD_TRAVEL_PX} from '../src/game/data/route.js';
import {DEPOT_RULES, MOVER_WINDOW_RULES, nextDepotAfter, nextMoverWindowAfter} from '../src/game/core/depots.js';
import {traceRoute, sampleRoute, layoutMetrics} from '../scripts/route-audit.mjs';
import {driveTrackTransition, hazardClearance, validateTrackSequence} from '../src/game/core/trackValidation.js';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';
import {ENVIRONMENTS} from '../src/game/data/environments.js';
import {CHALLENGE_PROFILES} from '../src/game/data/challengeProfiles.js';
import {sectorAtDistance, IMPLEMENTED_LEVELS} from '../src/game/core/sectors.js';
import {
  COIN_ROW_GAP_MAX,
  COIN_ROW_GAP_MIN,
  COIN_STACK_CHANCE,
  COIN_STACK_PAYOUT,
  METERS_PER_PIXEL,
  ROUTE_END_DISTANCE_M,
  routeSpeedAtDistance,
  SINGLE_COIN_PAYOUT,
} from '../src/game/core/economy.js';

// Normal Campaign ends at each level's finish; per-level Overdrive past the finish is retired.
const campaignEnd = levelId => GAME_BALANCE.routes[levelId].finishDistanceMeters;

test('pylons are removed from all hazard palettes and authored encounter registries', () => {
  assert.equal(GAME_BALANCE.hazards.collision.pylon, undefined);
  assert.throws(() => hazardDefinition('pylon'), /Unknown hazard pylon/);
  for (const environment of Object.values(ENVIRONMENTS)) {
    assert.ok(!environment.hazardFamilies.includes('pylon'));
  }
  for (const profile of Object.values(CHALLENGE_PROFILES)) {
    assert.ok(!profile.hazardFamilies.includes('pylon'));
    assert.ok(!profile.fillerHazardFamilies.includes('pylon'));
    assert.ok(!profile.betaHazardFamilies.includes('pylon'));
  }
  for (const registry of [CHUNK_REGISTRIES, LEVEL2_CHUNK_REGISTRIES]) {
    for (const chunks of Object.values(registry)) for (const chunk of chunks) {
      for (const row of chunk.rows) {
        assert.ok([...row.hazards, ...(row.intermediates ?? [])].every(hazard => hazard.kind !== 'pylon'));
      }
    }
  }
});

test('sprite-only replacement preserves authored row and obstacle density with no new blank rows', () => {
  const retired = new Set(['container', 'machinery', 'wreckage', 'energySpine', 'coolingDrum',
    'reactorShield', 'bollard', 'gate']);
  const rows = AUTHORED_CHUNKS.flatMap(chunk => chunk.rows);
  assert.equal(rows.length, 126, 'same authored row count as before sprite replacement');
  assert.equal(rows.flatMap(row => row.hazards).filter(h => !h.continuation).length, 252,
    'one-for-one obstacle replacement, not removal');
  assert.ok(rows.every(row => row.hazards.length > 0));
  for (const registry of [CHUNK_REGISTRIES, LEVEL2_CHUNK_REGISTRIES]) {
    for (const chunks of Object.values(registry)) for (const chunk of chunks) for (const row of chunk.rows) {
      assert.ok([...row.hazards, ...(row.intermediates ?? [])].every(hazard => !retired.has(hazard.kind)));
    }
  }
});

test('seed 153: Continuous entry at 8000 m includes committed launch delay and all physical sample-rate proofs', () => {
  const distance = 8000;
  const speed = routeSpeedAtDistance(distance, 'level1', 'continuous');
  assert.equal(speed, 670);
  const profile = {load: 5.5, capacity: 11, handling: 0, reactionSeconds: 0.8,
    initialState: {x: (LANE_CENTERS[1] + LANE_CENTERS[2]) / 2, velocity: 0}};
  const approach = {hazards: [], intermediates: [], safeLanes: [1, 2],
    spacingPx: HAZARD_TRAVEL_PX + HAZARD_ROW_ENVELOPE_PX / 2};
  const next = {hazards: [], intermediates: [], safeLanes: [1, 2], spacingPx: 1000};
  for (const hz of GAME_BALANCE.routes.track.routeValidation.sampleHz) {
    const committed = {...approach, spacingPx: approach.spacingPx +
      GAME_BALANCE.routes.spawning.initialRowDelaySeconds * speed};
    const proof = driveTrackTransition(committed, next, 1, 1, speed, {...profile, hz});
    assert.equal(proof.completed, true);
    assert.ok(proof.clearance >= 6);
    assert.equal(proof.state.x, LANE_CENTERS[1]);
    assert.equal(proof.state.velocity, 0);
  }
  const options = ['level1', 'continuous', distance];
  const rows = sampleRoute(153, 8600, false, ...options);
  assert.deepEqual(sampleRoute(153, 8600, false, ...options), rows);
  for (const row of rows) {
    assert.deepEqual(row.certificates.map(proof => proof.hz), GAME_BALANCE.routes.track.routeValidation.sampleHz);
    assert.ok(row.certificates.every(proof => proof.completed && proof.clearance >= 6));
  }
  const capped = sampleRoute(153, 9600, false, 'level1', 'continuous', 9000);
  assert.equal(routeSpeedAtDistance(9000, 'level1', 'continuous'), 680);
  assert.deepEqual(sampleRoute(153, 9600, false, 'level1', 'continuous', 9000), capped);
  for (const row of capped) {
    assert.deepEqual(row.certificates.map(proof => proof.hz), GAME_BALANCE.routes.track.routeValidation.sampleHz);
    assert.ok(row.certificates.every(proof => proof.completed && proof.clearance >= 6));
  }
});

test('certification carries actual x/velocity and excludes individually sub-threshold exits', () => {
  const previous = {hazards: [], intermediates: [], safeLanes: [1], spacingPx: 1200};
  const next = {hazards: [{kind: 'divider', lane: 1, offsetX: -26, offsetY: 0}],
    intermediates: [], safeLanes: [0, 2], spacingPx: 1200};
  const initialState = {lane: 1, x: 170, velocity: 40};
  const options = {load: 5.5, capacity: 11, handling: 0, hz: 60, initialStates: [initialState]};
  const unrestricted = validateTrackSequence([previous, next], 300, options);
  assert.ok(unrestricted.exits.some(exit => exit.lane === 0 && exit.clearance < 6));
  const certified = validateTrackSequence([previous, next], 300, {...options, minimumClearancePx: 6});
  assert.deepEqual(certified.exits.map(exit => exit.lane), [2]);
  const direct = driveTrackTransition(previous, next, 1, 2, 300, {...options, initialState});
  assert.equal(certified.clearance, direct.clearance, 'do not substitute centered neutral entry');
  assert.deepEqual([certified.exits[0].x, certified.exits[0].velocity], [direct.state.x, direct.state.velocity]);
});

test('all integrated seeded Normal/Continuous routes keep a geometrically open >=6 px corridor at 30/60/120 Hz', () => {
  for (const [levelId, mode] of [['level1', 'normal'], ['level2', 'normal'], ['level1', 'continuous']]) {
    for (const seed of [153, 1, 1234, 98765]) {
      const start = mode === 'normal' ? 9 : 5000, end = mode === 'normal' ? 5000 : 11000;
      const rows = sampleRoute(seed, end, false, levelId, mode, start);
      for (const [index, row] of rows.entries()) {
        assert.ok([...row.hazards, ...row.intermediates].every(hazard => hazard.kind !== 'pylon'),
          'removed pylons never reach live Alpha/Beta routes');
        const roots = row.hazards.filter(hazard => hazard.sideObstacle && !hazard.continuation);
        assert.ok(!(roots.some(hazard => hazard.lane === 0) && roots.some(hazard => hazard.lane === 3)),
          'never start opposite-curb structures in the same row');
        for (const hazard of roots) {
          const layout = guardrailLayout(hazard);
          assert.ok(layout.midLength >= layout.width * GAME_BALANCE.hazards.guardrail.midLengthPerWidth - 1e-9);
        }
        if (!['side_squeeze', 'narrow_corridor'].includes(row.family) || row.phase !== 0) continue;
        const next = rows[index + 1];
        if (!next) continue; // The partner curb lies beyond the sampled end distance.
        assert.equal(next.chunkId, row.chunkId);
        const first = roots.find(hazard => hazard.pinch);
        const second = next.hazards.find(hazard => hazard.pinch);
        assert.equal(second.lane, 3 - first.lane);
        const stagger = (next.plannedDistance - row.plannedDistance) / METERS_PER_PIXEL -
          second.offsetY + first.offsetY;
        assert.ok(stagger >= row.spacingPx - 1e-8, 'paired curbs are at least one actual row apart');
      }
      const physical = rows.map(row => row.emitted ? row : {...row,
        hazards: row.hazards.filter(hazard => hazard.continuation),
        intermediates: [], safeLanes: TRACK_LANES});
      const approach = {hazards: [], intermediates: [], safeLanes: [1, 2],
        spacingPx: HAZARD_TRAVEL_PX + HAZARD_ROW_ENVELOPE_PX / 2};
      for (const hz of [30, 60, 120]) {
        const proof = validateTrackSequence([approach, ...physical], i =>
          routeSpeedAtDistance(rows[i - 1].plannedDistance +
            (HAZARD_TRAVEL_PX + HAZARD_ROW_ENVELOPE_PX / 2) * METERS_PER_PIXEL, levelId, mode),
        {geometric: true, minimumClearancePx: 6, levelId, mode, hz, initialStates: [{lane: 1, x: 195, velocity: 0}]});
        assert.ok(proof.completed && proof.clearance >= 6,
          `${seed}/${levelId}/${mode}/${hz}Hz: ${proof.clearance}`);
        assert.equal(proof.approximateMovingSafety, undefined);
      }
      assert.ok(layoutMetrics(rows, {levelId, mode, startDistance: start, endDistance: end})
        .drivingMaximumEmptySeconds <= 3);
    }
  }
});

test('dev-only trace reproduces production rows without changing gameplay RNG in either level or mode', () => {
  for (const [levelId, mode] of [['level1', 'normal'], ['level2', 'normal'], ['level1', 'continuous']]) {
    const startDistance = mode === 'continuous' ? 6000 : 9;
    const endDistance = startDistance + 700;
    const options = {levelId, mode, startDistance, endDistance};
    const trace = traceRoute(153, options);
    assert.deepEqual(traceRoute(153, options), trace);
    const rows = sampleRoute(153, endDistance, false, levelId, mode, startDistance);
    assert.deepEqual(trace.rows.map(row => row.layoutId), rows.map(row => row.chunkId));
    assert.deepEqual(trace.rows.map(row => row.hazards.map(({contactDistance, ...hazard}) => hazard)),
      rows.map(row => [...row.hazards, ...row.intermediates].filter(h => !h.continuation)));
    assert.deepEqual(trace.rows.map(row => row.pickups), rows.map(row => row.pickups));
    assert.equal(trace.counts.collisionSpawns, trace.rows.reduce((sum, row) =>
      sum + (row.emitted ? row.hazards.length : 0), 0));
    assert.equal(trace.counts.sideSpawns, trace.rows.reduce((sum, row) =>
      sum + (row.emitted ? row.hazards.filter(h => h.sideObstacle).length : 0), 0));
    assert.ok(trace.rows.every(row => Number.isInteger(row.encounterIndex) && row.sector >= 1));
    assert.notDeepEqual(traceRoute(1234, options).rows, trace.rows);
  }
  for (const [seed, options] of [[NaN, {}], [1, {levelId: 'level3'}],
    [1, {endDistance: Infinity}], [1, {startDistance: 900, endDistance: 800}]]) {
    assert.throws(() => traceRoute(seed, options), /Invalid route trace/);
  }
});

test('row spacing leaves the best possible truck time to leave a blocked lane, plus reaction padding', () => {
  const worstCase = laneClearTimeSeconds({
    load: 10, capacity: 10, handling: WORST_CASE_HANDLING,
    laneSpacing: LANE_SPACING_PX, clearDistance: MAX_HAZARD_HIT_X,
  });
  assert.ok(Math.abs(worstCase - WORST_CASE_LANE_CLEAR_SECONDS) < 1e-9);
  // Owner rule: rows are sized for the best build (max Precision, empty hold, best chassis), not stock.
  assert.ok(BEST_CASE_LANE_CLEAR_SECONDS > 0 && BEST_CASE_LANE_CLEAR_SECONDS < worstCase);
  assert.equal(ROW_REACTION_SECONDS, GAME_BALANCE.routes.track.rowReactionSeconds);
  for (let distance = 0; distance <= ROUTE_END_DISTANCE_M + 900; distance += 25) {
    const spawnSpeed = routeSpeedAtDistance(distance);
    const spacing = rowSpacingAtSpeed(spawnSpeed) + spawnSpeed * ROW_REACTION_SECONDS;
    // Speed keeps rising while the rows scroll ~1,200 px to the ship; judge at the faster arrival speed.
    const arrivalSpeed = routeSpeedAtDistance(distance + 1_200 * METERS_PER_PIXEL);
    const gapSeconds = (spacing - COLLISION_CLEARANCE_PX) / arrivalSpeed;
    assert.ok(gapSeconds > BEST_CASE_LANE_CLEAR_SECONDS * 1.05, `gap ${gapSeconds.toFixed(3)} s at ${distance} m`);
  }
  assert.ok(rowSpacingAtSpeed(routeSpeedAtDistance(ROUTE_END_DISTANCE_M)) >
    rowSpacingAtSpeed(routeSpeedAtDistance(0)), 'faster sections spread rows further apart');
});

test('upgraded handling clears a lane faster than the worst case', () => {
  const upgraded = laneClearTimeSeconds({
    load: 10, capacity: 16, handling: 0.32,
    laneSpacing: LANE_SPACING_PX, clearDistance: HAZARD_COLLISION_DISTANCE_PX,
  });
  assert.ok(upgraded < WORST_CASE_LANE_CLEAR_SECONDS * 0.85);
});

test('no layout row leaves a safe lane that dead-ends into the next row', () => {
  for (const chunk of AUTHORED_CHUNKS) {
    assert.ok(hasNoTrapLanes(chunk.rows), `${chunk.id} has a trap lane`);
    for (const lane of [1, 2]) {
      assert.ok(canReachLaneSet([lane], chunk.rows[0].safeLanes), `${chunk.id} entry unreachable from lane ${lane}`);
    }
    assert.ok(chunk.rows.at(-1).safeLanes.every(lane =>
      AUTHORED_CHUNKS.every(next => canReachLaneSet([lane], next.rows[0].safeLanes))),
    `${chunk.id} exit can strand the player before another chunk`);
  }
});

test('short recipes preserve certified physical states and encounter variety without a per-seed rare-pinch quota', () => {
  for (const [levelId, mode] of [['level1', 'normal'], ['level2', 'normal'], ['level1', 'continuous']]) {
    const generator = createTrackGenerator(153, levelId, mode);
    const families = new Set();
    const recent = [];
    let previous;
    let distance = mode === 'continuous' ? 6000 : 0;
    for (let index = 0; distance < (mode === 'continuous' ? 12000 : campaignEnd(levelId)); index++) {
      assert.ok(index < 1000, 'full route generation remains bounded');
      const chunk = generator.nextChunk(distance);
      for (const row of chunk.rows) {
        const depot = nextDepotAfter(row.plannedDistance, DEPOT_RULES, levelId, mode).distance;
        generator.recordSpawn(row, hazardsBeforeDepot(row, row.plannedDistance, depot, 0, levelId, mode),
          row.plannedDistance);
      }
      families.add(chunk.family);
      const lengths = chunk.family === 'offset_pair' ? [6] :
        chunk.family === 'moving_intercept' ? [2, 4] : [1, 2];
      assert.ok(lengths.includes(chunk.rows.length));
      assert.ok([GAME_BALANCE.routes.track.encounters.candidateBudget, GAME_BALANCE.routes.track.encounters.densityRecovery.candidateBudget].includes(chunk.candidateBudget));
      assert.ok(chunk.candidateAttempts <= chunk.candidateBudget);
      assert.ok(chunk.obstacleCount > 0, 'fallback is not an empty road');
      if (!chunk.fallback) {
        assert.ok(!recent.includes(chunk.signature), 'do not disguise repeated geometry with a different signature');
        if (previous && !chunk.movingDeadline) assert.notEqual(chunk.family, previous.family);
      }
      for (const [reference, certificate] of chunk.certificates.entries()) {
        assert.ok(certificate.completed && certificate.clearance >=
          GAME_BALANCE.routes.track.routeValidation.minimumClearancePx);
        assert.ok(certificate.exits.every(exit => Number.isFinite(exit.x) && Math.abs(exit.velocity) < 0.01 &&
          exit.clearance >= GAME_BALANCE.routes.track.routeValidation.minimumClearancePx));
        if (previous) assert.deepEqual(certificate.entries, previous.certificates[reference].exits,
          'carry actual certified x and lateral momentum across encounter boundaries');
      }
      recent.push(chunk.signature);
      if (recent.length > GAME_BALANCE.routes.track.encounters.recentLayouts) recent.shift();
      distance += chunk.rows.reduce((sum, row) => sum + row.spacingPx * METERS_PER_PIXEL, 0);
      previous = chunk;
    }
    const expected = ['offset_pair', 'risk_reward', 'single_pressure', 'split_gate'];
    assert.ok(expected.every(family => families.has(family)), `${levelId}/${mode}: ${[...families]}`);
    assert.ok(['narrow_corridor', 'side_squeeze', 'static_chicane'].some(family => families.has(family)));
    assert.equal(families.has('moving_intercept'), levelId === 'level2');
  }
});

test('actual emitted collision instances meet the side quota without counting scenery or excluded Depot rows', t => {
  for (const [levelId, mode] of [['level1', 'normal'], ['level2', 'normal'], ['level1', 'continuous']]) {
    for (const seed of [1, 153, 1234, 98765]) {
      const startDistance = mode === 'continuous' ? 6000 : 9;
      const endDistance = mode === 'continuous' ? 12000 : campaignEnd(levelId);
      const trace = traceRoute(seed, {levelId, mode, startDistance, endDistance});
      const counts = trace.contactAccounting.total;
      assert.equal(sideHazardQuota(counts.obstacles, counts.sideObstacles).acceptable, true,
        `${seed}/${levelId}/${mode}: ${counts.sideSharePercent}% side instances`);
      assert.deepEqual(counts.sideQuota, sideHazardQuota(counts.obstacles, counts.sideObstacles));
      const intervals = new Map();
      const sideContacts = [];
      for (const row of trace.rows) for (const hazard of row.hazards) {
        assert.equal(Boolean(hazard.sideObstacle), Boolean(hazardDefinition(hazard.kind).roadside));
        if (!row.emitted || hazard.contactDistance < startDistance || hazard.contactDistance >= endDistance) continue;
        const key = nextDepotAfter(hazard.contactDistance, DEPOT_RULES, levelId, mode).distance;
        const interval = intervals.get(key) ?? {obstacles: 0, side: 0};
        interval.obstacles++;
        if (hazard.sideObstacle) {
          interval.side++;
          sideContacts.push(hazard.contactDistance);
        }
        intervals.set(key, interval);
      }
      assert.ok([...intervals.entries()].filter(([depot, interval]) =>
        depot <= endDistance && interval.side > 0).length >= 2,
      `${seed}/${levelId}/${mode}: side bodies clustered in only one complete interval`);
      sideContacts.sort((a, b) => a - b);
      const boundaries = [startDistance, ...sideContacts, endDistance];
      const longestDroughtMeters = Math.max(...boundaries.slice(1).map((value, index) =>
        value - boundaries[index]));
      t.diagnostic(`${seed}/${levelId}/${mode}: ${counts.sideSharePercent}% side bodies; longest side-free stretch ${longestDroughtMeters.toFixed(2)}m`);
    }
  }
});

test('live instance accounting counts physical Alpha and Beta once after Depot filtering', () => {
  let continuations = 0, beta = 0, excluded = 0;
  for (const seed of [1, 153]) for (const levelId of ['level1', 'level2']) {
    for (const mode of levelId === 'level1' ? ['normal', 'continuous'] : ['normal']) {
      const start = mode === 'continuous' ? 6000 : 9;
      const rows = sampleRoute(seed, start + 1200, false, levelId, mode, start);
      const expected = {obstacles: 0, sideObstacles: 0};
      const identities = new Set();
      for (const row of rows) {
        const all = [...row.hazards, ...row.intermediates];
        continuations += all.filter(hazard => hazard.continuation).length;
        if (row.emitted) {
          for (const hazard of all.filter(hazard => !hazard.continuation)) {
            expected.obstacles++;
            if (hazard.placement === 'beta') beta++;
            if (hazard.sideObstacle) {
              assert.ok(hazard.sideObstacleId);
              assert.ok(!identities.has(hazard.sideObstacleId), 'a physical side body must not spawn twice');
              identities.add(hazard.sideObstacleId);
              expected.sideObstacles++;
            }
          }
        } else {
          excluded += all.filter(hazard => !hazard.continuation).length;
        }
        assert.deepEqual(row.sideQuotaAfter, expected,
          `${seed}/${levelId}/${mode}/${row.spawnDistance}: use emitted bodies, not rows or references`);
        assert.equal(expected.sideObstacles, identities.size);
      }
    }
  }
  assert.ok(continuations > 0 && beta > 0 && excluded > 0,
    'exercise real continuing bodies, augmentation and protected/Depot exclusions');
});

test('outer pinch pairs preserve both center lanes and stagger opposite curbs by at least one row', () => {
  const sides = new Set();
  for (const seed of [153, 1, 1234, 98765]) {
    const rows = sampleRoute(seed, 12000, false, 'level1', 'continuous', 6000);
    for (const [index, row] of rows.entries()) {
      if (!['narrow_corridor', 'side_squeeze'].includes(row.family) || row.phase !== 0) continue;
      const next = rows[index + 1];
      assert.equal(next?.chunkId, row.chunkId);
      assert.equal(row.hazards.filter(hazard => hazard.pinch).length, 1);
      assert.equal(next.hazards.filter(hazard => hazard.pinch).length, 1);
      const first = row.hazards.find(hazard => hazard.pinch);
      const second = next.hazards.find(hazard => hazard.pinch);
      assert.equal(second.lane, 3 - first.lane);
      const stagger = (next.plannedDistance - row.plannedDistance) / METERS_PER_PIXEL -
        second.offsetY + first.offsetY;
      assert.ok(stagger >= row.spacingPx - 1e-8, 'opposite wedges are at least one actual row apart');
      for (const current of [row, next]) {
        assert.ok([1, 2].every(lane => current.safeLanes.includes(lane)));
        assert.ok(current.hazards.every(hazard => hazard.pinch && hazard.spanRows === 1 &&
          hazard.lengthPx === guardrailMinimumLength(hazard)));
        current.hazards.forEach(hazard => sides.add(hazard.lane));
      }
      assert.ok(row.certificates.every(result => result.completed &&
        result.clearance >= GAME_BALANCE.routes.track.routeValidation.minimumClearancePx));
    }
  }
  assert.deepEqual([...sides].sort(), [0, 3]);
});

test('static chicanes force an adjacent weave with the approved extra 54 px transition window', () => {
  let checked = 0;
  for (const levelId of ['level1', 'level2']) {
    const rows = sampleRoute(153, 5000, false, levelId);
    for (const [index, row] of rows.entries()) {
      if (row.family !== 'static_chicane' || row.phase !== 0) continue;
      const next = rows[index + 1];
      assert.equal(next?.chunkId, row.chunkId);
      // A chicane inside a Depot-protected window is not emitted; the truck sees open road there.
      if (!row.emitted || !next.emitted) continue;
      const first = row.hazards.find(hazard => hazard.pinch);
      const second = next.hazards.find(hazard => hazard.pinch);
      assert.equal(second.lane, 3 - first.lane);
      const stagger = (next.plannedDistance - row.plannedDistance) / METERS_PER_PIXEL -
        second.offsetY + first.offsetY;
      assert.ok(Math.abs(row.spacingPx - next.spacingPx -
        GAME_BALANCE.routes.sideObstacles.chicaneTransitionExtraPx) < 1e-8);
      assert.ok(Math.abs(stagger - next.spacingPx *
        GAME_BALANCE.routes.sideObstacles.chicaneStaggerRows -
        GAME_BALANCE.routes.sideObstacles.chicaneTransitionExtraPx) < 1e-8);
      assert.ok(row.hazards.some(hazard => hazard.kind === 'divider' && [1, 2].includes(hazard.lane)));
      assert.ok(!row.safeLanes.some(lane => next.safeLanes.includes(lane)), 'no straight lane survives both gates');
      assert.ok(row.certificates.every(proof => proof.completed && proof.clearance >= 6 &&
        Math.abs(proof.lanes[2] - proof.lanes[1]) === 1));
      checked++;
    }
  }
  assert.ok(checked > 0, 'the approved weave must reach real generated routes');
});

test('live side structures retain configured full-length geometry and continuous certified tails', () => {
  const kinds = new Set();
  let varyingSpacingBodies = 0;
  for (const [levelId, mode] of [['level1', 'normal'], ['level2', 'normal'], ['level1', 'continuous']]) {
    for (const seed of [1, 153, 1234, 98765]) {
      const start = mode === 'continuous' ? 6000 : 9;
      const end = mode === 'continuous' ? 12000 : campaignEnd(levelId);
      const tailSpeed = routeSpeedAtDistance(end + 1000, levelId, mode);
      const tailMeters = GAME_BALANCE.routes.sideObstacles.maximumSpanRows *
        (rowSpacingAtSpeed(tailSpeed, mode, end + 1000) +
          tailSpeed * ROW_REACTION_SECONDS) * METERS_PER_PIXEL;
      const rows = sampleRoute(seed, end + tailMeters, false, levelId, mode, start);
      const bodies = new Map();
      for (const [index, row] of rows.entries()) for (const hazard of row.hazards) {
        if (row.spawnDistance >= end) continue;
        if (!hazard.sideObstacle) continue;
        const definition = hazardDefinition(hazard.kind);
        const geometry = hazardGeometry(hazard);
        const layout = guardrailLayout(hazard);
        assert.ok(layout.midLength >= layout.width * GAME_BALANCE.hazards.guardrail.midLengthPerWidth - 1e-9);
        if (hazard.pinch) {
          assert.equal(hazard.spanRows, 1);
          assert.equal(geometry.height, guardrailMinimumLength(hazard));
          assert.ok(!hazard.continuation && hazard.sideObstacleId);
          continue;
        }
        const span = hazard.kind === 'sideWall'
          ? GAME_BALANCE.routes.sideObstacles.maximumSpanRows
          : GAME_BALANCE.routes.sideObstacles.minimumSpanRows;
        assert.equal(hazard.spanRows, span, `${seed}/${levelId}/${mode}/${hazard.kind}`);
        assert.ok(geometry.height > definition.height, 'not a native-height single-row substitute');
        const center = row.spawnDistance - hazard.offsetY * METERS_PER_PIXEL;
        if (!hazard.continuation) {
          const occupied = rows.slice(index, index + span);
          assert.equal(occupied.length, span, 'include the full tail even at the sample boundary');
          const distancePx = (occupied.at(-1).spawnDistance - row.spawnDistance) / METERS_PER_PIXEL;
          assert.ok(Math.abs(geometry.height - distancePx - definition.height) < 1e-8);
          assert.ok(Math.abs(hazard.offsetY + distancePx / 2) < 1e-8);
          if (occupied.slice(0, -1).some(other => other.spacingPx !== row.spacingPx)) varyingSpacingBodies++;
          bodies.set(hazard.sideObstacleId, {center, geometry});
          if (row.emitted) kinds.add(hazard.kind);
        } else {
          const original = bodies.get(hazard.sideObstacleId);
          assert.ok(original, 'a continuation must reference an earlier physical body');
          assert.ok(Math.abs(center - original.center) < 1e-8, 'one continuous world-space collider');
          assert.deepEqual(geometry, original.geometry);
        }
        assert.ok(row.certificates.every(result => result.completed &&
          result.clearance >= GAME_BALANCE.routes.track.routeValidation.minimumClearancePx));
      }
      const metrics = layoutMetrics(rows.filter(row => row.spawnDistance < end),
        {levelId, mode, startDistance: start, endDistance: end});
      assert.ok(metrics.longSide <= metrics.side, 'short pinches and long bodies are each counted once');
    }
  }
  assert.deepEqual([...kinds].sort(), ['sideRail', 'sideWall']);
  assert.ok(varyingSpacingBodies > 0, 'prove actual intervening spacings, not one assumed constant grid');
});

test('live density augmentation uses the capped budget and certified useful divider or filler geometry', () => {
  let added = 0;
  for (const [levelId, mode] of [['level1', 'normal'], ['level2', 'normal'], ['level1', 'continuous']]) {
    let modeAdded = 0;
    for (const seed of [1, 153, 1234, 98765]) {
      const rows = sampleRoute(seed, mode === 'continuous' ? 12000 : campaignEnd(levelId),
        false, levelId, mode, mode === 'continuous' ? 6000 : 9);
      for (const [index, row] of rows.entries()) {
        assert.ok(row.intermediates.length <= GAME_BALANCE.routes.track.betaSlots.length);
        const accepted = [];
        for (const hazard of row.intermediates) {
          if (hazard.filler) {
            assert.ok(CHALLENGE_PROFILES[sectorAtDistance(row.plannedDistance, levelId, mode).challengeProfileId]
              .fillerHazardFamilies.includes(hazard.kind));
            assert.ok(row.plannedDistance >= GAME_BALANCE.routes[levelId].sectorStartsMeters[1]);
            assert.notEqual(row.pacing, 'recovery');
            assert.ok(Math.abs(hazard.offsetY +
              row.spacingPx * GAME_BALANCE.routes.track.betaSlots[0]) < 1e-8);
          } else assert.equal(hazard.kind, 'divider');
          assert.equal(hazard.placement, 'beta');
          assert.ok(GAME_BALANCE.routes.track.betaSlots.some(slot =>
            Math.abs(hazard.offsetY + row.spacingPx * slot) < 1e-8));
          assert.ok(row.certificates.every(result => result.completed &&
            result.clearance >= GAME_BALANCE.routes.track.routeValidation.minimumClearancePx));
          assert.ok(![...row.hazards, ...accepted].some(other => hazardSweptArtOverlaps(hazard, other)));
          const next = rows[index + 1];
          if (next?.chunkId === row.chunkId && next.phase > 0) {
            assert.ok(!next.hazards.some(other => hazardSweptArtOverlaps(hazard, other, -row.spacingPx)));
            const local = [{hazards: [...row.hazards, ...accepted]}, next];
            const before = straightRouteWidth(local);
            assert.ok(before === 0 || straightRouteWidth([...local, {hazards: [hazard]}]) < before,
              'density additions must shape a corridor, not duplicate already blocked space');
          }
          accepted.push(hazard);
          if (row.emitted) modeAdded++;
        }
      }
    }
    assert.ok(modeAdded > 0, `${levelId}/${mode}: configured density must reach the production stream`);
    added += modeAdded;
  }
  assert.ok(added > 20, `existing density-regression coverage floor, not a balance target: ${added}`);
});

test('live composition preserves baseline non-side contacts and populated Depot approaches', () => {
  // Captured before continuation repair; gap ceilings round up by at most one millisecond.
  const baseline = [
    ['level1', 'normal', 1, 292, 3.176], ['level1', 'normal', 153, 296, 3.114],
    ['level1', 'normal', 1234, 295, 3.181], ['level1', 'normal', 98765, 293, 3.179],
    ['level1', 'continuous', 1, 139, 3.350], ['level1', 'continuous', 153, 145, 3.350],
    ['level1', 'continuous', 1234, 138, 3.173], ['level1', 'continuous', 98765, 142, 3.173],
    ['level2', 'normal', 1, 296, 3.279], ['level2', 'normal', 153, 284, 3.279],
    ['level2', 'normal', 1234, 293, 3.279], ['level2', 'normal', 98765, 296, 3.284],
  ];
  for (const [levelId, mode, seed, nonSideContacts, maximumEmptySeconds] of baseline) {
    // Fixed deterministic stream window of the captured pre-repair baseline (not a playable mode);
    // shortening it to the campaign finish would require inventing new floors.
    const startDistance = mode === 'continuous' ? 6000 : 9;
    const endDistance = mode === 'continuous' ? 12000 : 8000;
    const rows = sampleRoute(seed, endDistance, false, levelId, mode, startDistance);
    const metrics = layoutMetrics(rows, {levelId, mode, startDistance, endDistance});
    assert.ok(metrics.obstacles - metrics.side >= nonSideContacts,
      `${seed}/${levelId}/${mode}: continuing side bodies displaced other collision encounters`);
    assert.ok(metrics.drivingMaximumEmptySeconds <= 3 + 1e-8,
      `${seed}/${levelId}/${mode}: ordinary driving gap ${metrics.drivingMaximumEmptySeconds}s`);
  }
});

test('live encounter cadence retains the existing reaction allowance without stretching gaps', () => {
  for (const [levelId, mode] of [['level1', 'normal'], ['level2', 'normal'], ['level1', 'continuous']]) {
    const start = mode === 'continuous' ? 6000 : 9;
    const end = mode === 'continuous' ? 12000 : campaignEnd(levelId);
    for (const seed of [1, 153, 1234, 98765]) {
      const rows = sampleRoute(seed, end, false, levelId, mode, start);
      let chunkStart = start;
      for (const [index, row] of rows.entries()) {
        if (row.phase === 0) chunkStart = row.spawnDistance;
        const speed = routeSpeedAtDistance(chunkStart, levelId, mode);
        const mover = row.hazards.some(hazard => hazard.movement);
        const moverSpeed = routeSpeedAtDistance(row.spawnDistance, levelId, mode);
        const expected = (mover ? Math.max(rowSpacingAtSpeed(moverSpeed, mode, row.spawnDistance),
          COLLISION_CLEARANCE_PX + moverSpeed * GAME_BALANCE.routes.movingHazards
            .recoverySecondsBySector[sectorAtDistance(row.spawnDistance, levelId, mode).number - 1])
          : rowSpacingAtSpeed(speed, mode, chunkStart) +
            speed * ROW_REACTION_SECONDS) +
          (row.family === 'static_chicane' && row.phase === 0
            ? GAME_BALANCE.routes.sideObstacles.chicaneTransitionExtraPx : 0);
        // Equivalent lookahead sums may differ by a few floating-point ULPs, not a gameplay gap.
        assert.ok(Math.abs(row.spacingPx - expected) <= Number.EPSILON * Math.max(1, expected) * 8,
          `${row.spacingPx} vs ${expected}: cadence changed beyond numerical precision`);
        const lengths = row.family === 'offset_pair' ? [6] :
          row.family === 'moving_intercept' ? [2, 4] : [1, 2];
        assert.ok(lengths.includes(row.sequenceLength));
        assert.ok([GAME_BALANCE.routes.track.encounters.candidateBudget, GAME_BALANCE.routes.track.encounters.densityRecovery.candidateBudget].includes(row.candidateBudget));
        assert.ok(row.candidateAttempts <= row.candidateBudget);
        if (index > 0) assert.ok(Math.abs(row.spawnDistance - rows[index - 1].spawnDistance -
          rows[index - 1].spacingPx * METERS_PER_PIXEL) < 1e-8);
      }
    }
  }
});

test('live structures cross actual encounter seams through every configured occupied row', () => {
  const crossedKinds = new Set();
  for (const [levelId, mode] of [['level1', 'normal'], ['level2', 'normal'], ['level1', 'continuous']]) {
    const start = mode === 'continuous' ? 6000 : 9;
    const end = mode === 'continuous' ? 12000 : campaignEnd(levelId);
    for (const seed of [1, 153, 1234, 98765]) {
      const rows = sampleRoute(seed, end, false, levelId, mode, start);
      for (const [index, row] of rows.entries()) {
        if (!row.emitted) continue;
        for (const source of row.hazards.filter(hazard => hazard.sideObstacle && !hazard.continuation)) {
          if (source.pinch) continue;
          const span = source.kind === 'sideWall'
            ? GAME_BALANCE.routes.sideObstacles.maximumSpanRows
            : GAME_BALANCE.routes.sideObstacles.minimumSpanRows;
          if (index + span > rows.length) continue;
          const last = rows[index + span - 1];
          const requiredLength = (last.spawnDistance - row.spawnDistance) / METERS_PER_PIXEL +
            hazardDefinition(source.kind).height;
          assert.ok(hazardGeometry(source).height >= requiredLength - 1e-8,
            `${seed}/${levelId}/${mode}/${source.kind}: ${span} actual rows require ${requiredLength}px`);
          assert.ok(source.sideObstacleId, 'every continuing body has an identity');
          const center = row.spawnDistance - source.offsetY * METERS_PER_PIXEL;
          for (let phase = 1; phase < span; phase++) {
            const following = rows[index + phase];
            const continuation = following.hazards.find(hazard =>
              hazard.continuation && hazard.sideObstacleId === source.sideObstacleId);
            assert.ok(continuation, 'an occupied subsequent row must retain the continuing collider');
            assert.ok(Math.abs(following.spawnDistance - continuation.offsetY * METERS_PER_PIXEL -
              center) < 1e-8, 'continuations preserve the full world-space body');
            assert.deepEqual(hazardGeometry(continuation), hazardGeometry(source));
            if (following.phase === 0) crossedKinds.add(source.kind);
          }
        }
      }
    }
  }
  assert.deepEqual([...crossedKinds].sort(), ['sideRail', 'sideWall']);
});

test('long side modifiers do not suppress an otherwise Depot-safe moving primary', () => {
  // Continuous Run is Level 1 only, so Level 2 Forklifts are exercised on the full Normal campaign route.
  for (const seed of [1, 153, 1234, 98765]) for (const mode of ['normal']) {
    const rows = sampleRoute(seed, GAME_BALANCE.routes.level2.finishDistanceMeters, false, 'level2', mode, 9);
    for (const row of rows.filter(row => row.hazards.some(hazard => hazard.movement))) {
      const primary = {...row, hazards: row.hazards.filter(hazard => !hazard.sideObstacle)};
      if (hazardsBeforeDepot(primary, row.spawnDistance, row.nextDepot, 0, 'level2', mode)) {
        assert.ok(row.emitted, `${seed}/${mode}/${row.spawnDistance}: modifier suppressed a valid mover`);
      }
    }
  }
});

test('risk reward cargo has a connected collectible branch and a separate no-pickup route', () => {
  let temptations = 0;
  // Live routes only: both Normal campaigns to their finish plus Level 1 Continuous Run.
  const routes = [['level1', 'normal', 9, campaignEnd('level1')], ['level2', 'normal', 9, campaignEnd('level2')],
    ['level1', 'continuous', 6000, 12000]];
  for (const seed of [1, 153, 1234, 98765]) for (const [levelId, mode, start, end] of routes) {
    for (const row of sampleRoute(seed, end, false, levelId, mode, start)) {
      if (row.family !== 'risk_reward' || !row.emitted) continue;
      for (const pickup of row.pickups.filter(pickup => pickup.value > SINGLE_COIN_PAYOUT)) {
        assert.ok(row.certificates.every(result =>
          result.exits.some(exit => exit.lane === pickup.lane) &&
          result.exits.some(exit => exit.lane !== pickup.lane)));
        temptations++;
      }
    }
  }
  assert.ok(temptations > 0, 'test actual seeded premium cargo, not just a recipe label');
});

test('Level 2 moving intercepts meet complete moving-window quotas and timed phases threaten a following opening', () => {
  const phaseCases = new Map([30, 60, 120].map(hz => [hz, {blocked: 0, clear: 0}]));
  const introduction = IMPLEMENTED_LEVELS.level2[GAME_BALANCE.routes.movingHazards.firstSector - 1].startsAt;
  const level2Finish = GAME_BALANCE.routes.level2.finishDistanceMeters;
  for (const seed of [1, 153, 1234, 98765]) {
    for (const [mode, start, end] of [['normal', 9, level2Finish], ['normal', 2500, level2Finish]]) {
      const groups = sampleRoute(seed, end, false, 'level2', mode, start);
      const counts = new Map();
      for (const [index, row] of groups.entries()) {
        assert.equal(row.movingQuotaConflict, null, `${seed}/${mode}/${start}: ${JSON.stringify(row.movingQuotaConflict)}`);
        if (!row.emitted) continue;
        for (const hazard of row.hazards.filter(h => h.movement)) {
          const contact = row.spawnDistance +
            (HAZARD_TRAVEL_PX - HAZARD_ROW_ENVELOPE_PX / 2) * METERS_PER_PIXEL;
          if (contact >= end) continue;
          assert.ok(contact >= introduction, 'Forklifts are introduced in their configured sector, never the opening sector');
          const depot = nextMoverWindowAfter(contact, MOVER_WINDOW_RULES, 'level2', mode).distance;
          counts.set(depot, (counts.get(depot) ?? 0) + 1);
          const following = groups[index + 1];
          if (!following) {
            assert.ok(index === groups.length - 1 &&
              row.spawnDistance + row.spacingPx * METERS_PER_PIXEL >= end,
            'only the explicitly truncated end of a sampled trace can clip the following row');
            continue;
          }
          assert.equal(following.chunkId, row.chunkId);
          const opening = following.safeLanes.find(lane => hazard.openingLanes.includes(lane));
          assert.notEqual(opening, undefined, 'forklift sweep must share the useful following-row opening');
          assert.equal(hazard.movement.maxOffsetPx - hazard.movement.minOffsetPx,
            LANE_CENTERS[hazard.openingLanes.at(-1)] - LANE_CENTERS[hazard.openingLanes[0]]);
          assert.ok([2, 3].includes(hazard.openingLanes.length));
          assert.ok(row.certificates.every(result => result.completed &&
            result.clearance >= GAME_BALANCE.routes.track.routeValidation.minimumClearancePx));
          const speed = routeSpeedAtDistance(contact, 'level2', mode);
          const center = HAZARD_TRAVEL_PX / speed;
          const halfWindow = hazardGeometry(hazard).hitY / speed;
          for (const [hz, cases] of phaseCases) {
            let blocked = false;
            for (let elapsed = center - halfWindow; elapsed <= center + halfWindow; elapsed += 1 / hz) {
              const y = elapsed * speed - HAZARD_TRAVEL_PX;
              const timed = hazardClearance(hazard, y, LANE_CENTERS[opening], elapsed);
              if (hazard.routeValidation !== 'three-center-potential') {
                assert.ok(timed >= hazardClearance(hazard, y, LANE_CENTERS[opening]) - 1e-8,
                  'legacy swept-envelope certification includes every sampled timed collider');
              }
              if (timed < 0) blocked = true;
            }
            cases[blocked ? 'blocked' : 'clear']++;
          }
        }
      }
      for (let depot = nextMoverWindowAfter(Math.max(start, introduction), MOVER_WINDOW_RULES, 'level2', mode);
        depot.distance <= end;
        depot = nextMoverWindowAfter(depot.distance, MOVER_WINDOW_RULES, 'level2', mode)) {
        assert.ok((counts.get(depot.distance) ?? 0) >= GAME_BALANCE.routes.movingHazards.minimumPerWindow &&
          (counts.get(depot.distance) ?? 0) <= GAME_BALANCE.routes.movingHazards.maximumPerWindow,
          `${seed}/${mode}/${start}/${depot.distance}: ${counts.get(depot.distance) ?? 0} moving encounters`);
      }
    }
    assert.ok(sampleRoute(seed, GAME_BALANCE.routes.level1.finishDistanceMeters)
      .every(row => row.hazards.every(h => !h.movement)), 'Level 1 cannot gain forklifts');
  }
  for (const [hz, cases] of phaseCases) assert.ok(cases.blocked > 0 && cases.clear > 0,
    `${hz}Hz must see both an intercepted opening and a phase-clear opening`);
});

test('pacing and safe pickup hook retain certified lanes without a second spawn loop', () => {
  const rows = sampleRoute(153, campaignEnd('level1'));
  assert.deepEqual([...new Set(rows.map(row => row.pacing))].sort(), ['normal', 'pressure', 'recovery']);
  let available = 0;
  for (const row of rows) {
    for (const lane of row.safePickupLanes) {
      assert.ok(row.safeLanes.includes(lane));
      assert.ok(!row.pickups.some(pickup => pickup.lane === lane));
      assert.ok(row.certificates.every(result =>
        result.exits.some(exit => exit.lanes[row.phase + 1] === lane)));
      available++;
    }
  }
  assert.ok(available > 0, 'later repair pickup can reuse existing certified spawn positions');
});

test('authored layouts preserve a one-lane-change path at full cargo', () => {
  assert.ok(AUTHORED_CHUNKS.length >= 6);
  assert.ok(LANE_SPACING_PX > HAZARD_COLLISION_DISTANCE_PX + CARGO_COLLISION_DISTANCE_PX);

  for (const chunk of AUTHORED_CHUNKS) {
    assert.ok(isChunkReachable(chunk), `${chunk.id} has no safe route`);
    for (const trackRow of chunk.rows) {
      assert.ok(trackRow.safeLanes.length > 0, `${chunk.id} blocks every lane`);
      assert.deepEqual(
        trackRow.safeLanes,
        TRACK_LANES.filter(lane => !trackRow.hazardLanes.includes(lane)),
      );
    }
  }
});

test('1,000 seeded encounters retain certified connected routes instead of isolated safe lanes', () => {
  const generator = createTrackGenerator(0xC0A60);
  let distance = 0;
  for (let index = 0; index < 1_000; index++) {
    const chunk = generator.nextChunk(distance);
    assert.ok(isChunkReachable(chunk), `chunk ${index} (${chunk.id}) is unreachable`);
    assert.ok(chunk.certificates.every(result => result.completed && result.exits.length > 0));
    distance += chunk.rows.reduce((sum, row) => sum + row.spacingPx * METERS_PER_PIXEL, 0);
  }
  const gate = safe => ({safeLanes: [safe], hazards: [], spacingPx: 160});
  assert.equal(validateTrackSequence([gate(0), gate(3)], 600).completed, false,
    'two individually open gates do not prove a connected transition');
  assert.equal(validateTrackSequence([{safeLanes: [], hazards: []}], 600).completed, false);
});

test('exhausted candidate budget uses a collision-bearing fallback certified from the reachable entry band', () => {
  const generator = createTrackGenerator(2);
  let distance = 0;
  let fallback;
  for (let index = 0; index < 1000 && !fallback; index++) {
    const chunk = generator.nextChunk(distance);
    if (chunk.fallback) fallback = chunk;
    distance += chunk.rows.reduce((sum, row) => sum + row.spacingPx * METERS_PER_PIXEL, 0);
  }
  assert.ok(fallback, 'fixed seed exercises exhaustion, not just the ordinary proposal path');
  assert.ok([GAME_BALANCE.routes.track.encounters.candidateBudget, GAME_BALANCE.routes.track.encounters.densityRecovery.candidateBudget].includes(fallback.candidateBudget));
  assert.equal(fallback.candidateAttempts, fallback.candidateBudget);
  assert.ok(fallback.obstacleCount > 0);
  assert.ok(fallback.certificates.every(result => result.completed && result.exits.length > 0 &&
    result.clearance >= GAME_BALANCE.routes.track.routeValidation.minimumClearancePx));
});

test('same seed reproduces the same chunk sequence', () => {
  const sequence = seed => {
    const generator = createTrackGenerator(seed);
    return Array.from({length: 32}, () => ({
      chunk: generator.nextChunk().id,
      pickups: Array.from({length: 4}, () => generator.nextCargoPickup()),
    }));
  };
  assert.deepEqual(sequence(123456), sequence(123456));
  assert.notDeepEqual(sequence(123456), sequence(654321));
});

test('Industrial single coins and stacks both pay 5 Coins for one cargo slot', () => {
  const generator = createTrackGenerator(90712);
  let singles = 0;
  let stacks = 0;
  for (let index = 0; index < 1_000; index++) {
    const pickup = generator.nextCargoPickup();
    assert.equal(pickup.mass, 1);
    if (pickup.kind === 'coin') {
      assert.equal(pickup.value, SINGLE_COIN_PAYOUT);
      singles++;
    } else {
      assert.equal(pickup.kind, 'coinStack');
      assert.equal(pickup.value, COIN_STACK_PAYOUT);
      stacks++;
    }
  }
  assert.ok(stacks > 0);
  assert.ok(singles > stacks);
  assert.ok(Math.abs(stacks / 1_000 - COIN_STACK_CHANCE) < 0.05);
});

test('coins keep a steady rhythm: one pickup every 1–2 eligible rows', () => {
  const generator = createTrackGenerator(4242);
  let rowsWithCoins = 0;
  let gap = 0;
  for (let index = 0; index < 2_000; index++) {
    const pickups = generator.nextRowPickups([1, 2]);
    assert.ok(pickups.length <= 1);
    gap++;
    if (pickups.length) {
      assert.ok([1, 2].includes(pickups[0].lane));
      if (rowsWithCoins > 0) assert.ok(gap >= COIN_ROW_GAP_MIN && gap <= COIN_ROW_GAP_MAX, `gap ${gap}`);
      rowsWithCoins++;
      gap = 0;
    }
  }
  const expectedRate = 2 / (COIN_ROW_GAP_MIN + COIN_ROW_GAP_MAX);
  assert.ok(Math.abs(rowsWithCoins / 2_000 - expectedRate) < 0.03);
  assert.deepEqual(createTrackGenerator(1).nextRowPickups([]), []);
});

test('leaving a Depot resumes obstacles exactly DEPOT_RESUME_METERS after the facility', () => {
  assert.equal(DEPOT_RESUME_METERS, DEPOT_RULES.resumeMeters);
  const hitOffset = (HAZARD_TRAVEL_PX - HAZARD_ROW_ENVELOPE_PX / 2) * METERS_PER_PIXEL;
  for (const depot of [500, 1000, 1500, 2000, 3000]) {
    const first = depotResumeFirstDistance(depot);
    assert.ok(first < depot, 'the first row is already on the road, hidden by the Depot overlay');
    assert.ok(Math.abs(first + hitOffset - depot - DEPOT_RESUME_METERS) < 1e-9);
  }
  assert.throws(() => depotResumeFirstDistance(Number.NaN), /Invalid Depot resume distance/);
});

test('lane connection checks only accept reachable adjacent transitions', () => {
  assert.equal(canReachLaneSet([1], [2]), true);
  assert.equal(canReachLaneSet([0], [2]), false);
});

test('lateral demand measures the laziest physical line, not lane centers', () => {
  const gate = opening => ({hazards: TRACK_LANES.filter(lane => lane !== opening)
    .map(lane => ({kind: 'divider', lane})), intermediates: []});
  const {dashPx} = GAME_BALANCE.routes.track.encounters.steeringDemand;
  // A one-lane gate change lets the truck hug the shared lane line.
  assert.ok(lateralDemandPx(gate(1), [gate(2)]) < dashPx);
  assert.ok(lateralDemandPx(gate(1), [gate(2)]) > 0);
  // A two-lane switch is a real dash.
  assert.ok(lateralDemandPx(gate(1), [gate(3)]) >= dashPx);
  assert.equal(lateralDemandPx(gate(1), [gate(1)]), 0);
});

test('late sectors prefer certified steering dashes without scoring recovery breathers', () => {
  const {dashPx} = GAME_BALANCE.routes.track.encounters.steeringDemand;
  let eligible = 0, dashes = 0;
  for (const seed of [1, 153]) {
    const stream = createTrackStream(seed, 'level1', 'normal');
    const seen = new Set();
    let distance = 9;
    while (distance < GAME_BALANCE.routes.level1.finishDistanceMeters) {
      const row = stream.nextRow(distance);
      distance = row.plannedDistance + row.spacingPx * METERS_PER_PIXEL;
      if (seen.has(row.encounterId)) continue;
      seen.add(row.encounterId);
      if (row.selectionPacing === 'recovery') assert.equal(row.steeringDemandPx, null);
      if (row.steeringDemandPx === null || sectorAtDistance(row.plannedDistance, 'level1', 'normal').number < 3) continue;
      eligible++;
      if (row.steeringDemandPx >= dashPx) dashes++;
    }
  }
  assert.ok(eligible > 40, `eligible ${eligible}`);
  assert.ok(dashes / eligible >= 0.4, `late dash share ${dashes}/${eligible}`);
});
