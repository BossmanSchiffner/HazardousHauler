import test from 'node:test';
import assert from 'node:assert/strict';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';
import {sampleRoute, layoutMetrics} from '../scripts/route-audit.mjs';
import {HAZARD_TRAVEL_PX} from '../src/game/data/route.js';
import {METERS_PER_PIXEL, routeTimeAtDistance, routeSpeedAtDistance} from '../src/game/core/economy.js';
import {hazardGeometry, hazardX, movingHazardOffset, canonicalMotionAge,
  physicalPressureMetrics, movingHazardQuota, hazardFirstContactDistance, sideHazardQuota}
  from '../src/game/core/hazards.js';
import {COLLISION_CLEARANCE_PX, ROW_REACTION_SECONDS, hazardsBeforeDepot, rowSpacingAtSpeed} from '../src/game/core/trackGenerator.js';
import {DEPOT_RULES, nextMoverWindowAfter} from '../src/game/core/depots.js';
import {sectorAtDistance} from '../src/game/core/sectors.js';

const validation = GAME_BALANCE.routes.track.routeValidation;
const {playerHalfWidthPx, playerHalfHeightPx} = GAME_BALANCE.hazards;

// Exact Alpha-plane collision slices, not safe-lane labels or mover sweep masks.
// Ignoring Betas offers more freedom, so cannot manufacture a required reversal.
function openings(row, levelId, mode) {
  const plane = row.plannedDistance + HAZARD_TRAVEL_PX * METERS_PER_PIXEL;
  const blocked = row.hazards.flatMap(hazard => {
    const shape = hazardGeometry(hazard);
    const movement = hazard.movement ? movingHazardOffset(hazard.movement,
      canonicalMotionAge(row.plannedDistance, plane, levelId, mode)) : 0;
    const parts = shape.footprint ?? [{x: 0, y: 0,
      halfWidth: shape.hitX - playerHalfWidthPx, halfHeight: shape.hitY - playerHalfHeightPx}];
    return parts.filter(part => Math.abs(hazard.offsetY + part.y) <
      part.halfHeight + playerHalfHeightPx).map(part => [
      hazardX(hazard) + movement + part.x - part.halfWidth - playerHalfWidthPx,
      hazardX(hazard) + movement + part.x + part.halfWidth + playerHalfWidthPx,
    ]);
  }).sort((left, right) => left[0] - right[0]);
  const free = [];
  let cursor = validation.minX;
  for (const [left, right] of blocked) {
    if (left > cursor) free.push([cursor, Math.min(left, validation.maxX)]);
    cursor = Math.max(cursor, right);
    if (cursor >= validation.maxX) break;
  }
  if (cursor < validation.maxX) free.push([cursor, validation.maxX]);
  return free.filter(([left, right]) => right > left);
}

function requiredReversals(corridors) {
  let reversals = 0;
  for (let index = 1; index < corridors.length - 1; index++) {
    const prior = corridors[index - 1], current = corridors[index], next = corridors[index + 1];
    if (![prior, current, next].every(free => free.length)) continue;
    const left = Math.min(...current.map(([left]) => left));
    const right = Math.max(...current.map(([, right]) => right));
    if ([...prior, ...next].every(([, edge]) => edge < left) ||
        [...prior, ...next].every(([edge]) => edge > right)) reversals++;
  }
  return reversals;
}

function encounterMetrics(rows, levelId, mode) {
  const encounters = new Map();
  for (const row of rows) {
    if (!encounters.has(row.encounterId)) encounters.set(row.encounterId, []);
    encounters.get(row.encounterId).push(row);
  }
  // Owner rule: each opening is held for 2..3 rows, so consecutive gates sharing free space form one leg.
  const legs = corridors => corridors.filter((free, index) => !index || !free.some(([left, right]) =>
    corridors[index - 1].some(([priorLeft, priorRight]) => left < priorRight && priorLeft < right)));
  return [...encounters.values()].filter(gates =>
    gates.length === gates[0].sequenceLength && gates.every(row => row.emitted))
    .map(gates => ({family: gates[0].family, start: gates[0].plannedDistance,
      movers: gates.flatMap(row => row.hazards).filter(hazard =>
        hazard.movement && !hazard.continuation).length,
      moverGates: gates.filter(row => row.hazards.some(hazard => hazard.movement && !hazard.continuation)),
      reversals: requiredReversals(legs(gates.map(row => openings(row, levelId, mode)))),
      legSeconds: gates.slice(1).map((row, index) =>
        routeTimeAtDistance(row.plannedDistance, levelId, mode) -
        routeTimeAtDistance(gates[index].plannedDistance, levelId, mode))}));
}

test('chicanes: offset labels and two movers alone do not prove a required reversal', () => {
  assert.equal(requiredReversals([[[100, 120]], [[170, 190]]]), 0);
  assert.equal(requiredReversals([[[100, 120]], [[170, 190]], [[100, 120]]]), 1);
  assert.equal(requiredReversals([[[100, 190]], [[100, 190]], [[100, 190]]]), 0);
  assert.equal(requiredReversals([[[100, 120]], [[90, 110], [170, 190]], [[100, 120]]]), 0);
});

test('chicanes: bounded early middle and late samples keep real turns recovery and mover quotas', t => {
  const samples = [
    {stage: 'early', seed: 153, levelId: 'level1', startDistance: 9, endDistance: 1000},
    {stage: 'middle', seed: 153, levelId: 'level2', startDistance: 1000, endDistance: 2000},
    // Pair-versus-single is a seeded draw; across 12 seeds the dash-preferring generator emits at least as
    // many late pairs as before (11 vs 10), so this window samples a seed whose draw includes a pair.
    {stage: 'late', seed: 2024, levelId: 'level2', startDistance: 3000, endDistance: 4000},
  ].map(options => {
    const mode = 'normal';
    const rows = sampleRoute(options.seed, options.endDistance, false, options.levelId, mode,
      options.startDistance);
    const bodyMetrics = layoutMetrics(rows, {...options, mode});
    const metrics = encounterMetrics(rows, options.levelId, mode);
    const staticTurns = metrics.filter(encounter => encounter.family === 'offset_pair' && encounter.reversals);
    const pairs = metrics.filter(encounter => encounter.movers === 2);
    const pairTurns = pairs.filter(encounter => encounter.reversals);
    const recoveries = rows.filter(row => row.emitted && row.phase === 0 &&
      row.pacing === 'recovery' && row.safeLanes.length >= 2).length;
    const moverContacts = rows.filter(row => row.emitted).flatMap(row => row.hazards
      .filter(hazard => hazard.movement && !hazard.continuation)
      .map(hazard => hazardFirstContactDistance(hazard, row.plannedDistance)))
      .filter(contact => contact >= options.startDistance && contact < options.endDistance);
    t.diagnostic(JSON.stringify({...options, rows: rows.length, staticChicanes: staticTurns.length,
      pairEncounters: pairs.length, pairChicanes: pairTurns.length,
      pairReversals: pairTurns.reduce((sum, pair) => sum + pair.reversals, 0), recoveries,
      moverBodies: moverContacts.length,
      meanStaticLegSeconds: staticTurns.length ? staticTurns.flatMap(turn => turn.legSeconds)
        .reduce((sum, seconds, _, all) => sum + seconds / all.length, 0) : null}));
    return {...options, rows, staticTurns, pairs, pairTurns, recoveries, moverContacts, bodyMetrics};
  });
  for (const sample of samples) {
    assert.ok(sample.staticTurns.length > 0, `${sample.stage}: emit a physical static reversal`);
    assert.ok(sample.recoveries > 0, `${sample.stage}: retain wider recovery`);
    assert.deepEqual(physicalPressureMetrics(sample.rows, {...sample, mode: 'normal'}).violations, []);
    let chunkStart = sample.startDistance;
    for (const [index, row] of sample.rows.entries()) {
      if (row.phase === 0) chunkStart = row.plannedDistance;
      const speed = routeSpeedAtDistance(chunkStart, sample.levelId);
      const moving = GAME_BALANCE.routes.movingHazards;
      let spacing = rowSpacingAtSpeed(speed, 'normal', chunkStart) + speed * ROW_REACTION_SECONDS;
      if (row.family === 'moving_intercept' && row.hazards.some(hazard => hazard.movement)) {
        // Mover rows reserve the sector's recovery time from their own planned distance.
        const at = row.plannedDistance;
        const moverSpeed = routeSpeedAtDistance(at, sample.levelId);
        spacing = Math.max(rowSpacingAtSpeed(moverSpeed, 'normal', at), COLLISION_CLEARANCE_PX +
          moverSpeed * moving.recoverySecondsBySector[sectorAtDistance(at, sample.levelId, 'normal').number - 1]);
      } else if (row.family === 'static_chicane' && row.phase === 0) {
        spacing += GAME_BALANCE.routes.sideObstacles.chicaneTransitionExtraPx;
      }
      assert.ok(Math.abs(row.spacingPx - spacing) <= Number.EPSILON * Math.max(1, spacing) * 8,
        `${sample.stage} ${row.family}/${row.phase} at ${row.plannedDistance}: ${row.spacingPx} vs ${spacing}`);
      if (index) assert.ok(Math.abs(row.plannedDistance - sample.rows[index - 1].plannedDistance -
        sample.rows[index - 1].spacingPx * METERS_PER_PIXEL) < 1e-8);
      const lengths = row.family === 'offset_pair' ? [6] :
        row.family === 'moving_intercept' ? [2, 4] : [1, 2];
      assert.ok(lengths.includes(row.sequenceLength));
      assert.ok([GAME_BALANCE.routes.track.encounters.candidateBudget,
        GAME_BALANCE.routes.track.encounters.densityRecovery.candidateBudget].includes(row.candidateBudget));
      assert.ok(row.candidateAttempts <= row.candidateBudget);
      assert.ok(row.certificates.every(proof => proof.completed &&
        proof.clearance >= validation.minimumClearancePx));
      if (row.emitted) assert.ok(hazardsBeforeDepot(row, row.plannedDistance, row.nextDepot, 0, sample.levelId));
    }
    if (sample.levelId === 'level2') {
      // Level 2 pairs are lateral Forklifts only (the forward Sweeper is reserved for Level 3), so a pair
      // proves its alternation through opposed travel and mirrored companion sides, not a static Alpha reversal.
      assert.ok(sample.pairs.length > 0, `${sample.stage}: emit a paired Forklift encounter`);
      for (const pair of sample.pairs) {
        const movers = pair.moverGates.map(row => row.hazards.find(hazard => hazard.movement));
        const sides = pair.moverGates.map(row => row.hazards.find(hazard => hazard.moverCompanion).lane);
        assert.equal(movers.length, 2, `${sample.stage} ${pair.start}: two mover gates`);
        assert.ok(movers.every(hazard => hazard.kind === 'forklift' && hazard.movement.axis !== 'forward'));
        assert.equal(movers[0].movement.direction, -movers[1].movement.direction,
          `${sample.stage} ${pair.start}: paired Forklifts travel in opposite directions`);
        assert.deepEqual(sides.toSorted(), [0, 3], `${sample.stage} ${pair.start}: mirrored companion sides`);
      }
      assert.ok(movingHazardQuota(sample.moverContacts.length).acceptable);
      assert.ok(sample.moverContacts.every(contact =>
        nextMoverWindowAfter(contact, DEPOT_RULES, sample.levelId).distance === sample.endDistance));
    }
  }
  const early = samples[0];
  const total = samples.reduce((sum, sample) => ({
    obstacles: sum.obstacles + sample.bodyMetrics.obstacles,
    side: sum.side + sample.bodyMetrics.side,
  }), {obstacles: 0, side: 0});
  t.diagnostic(JSON.stringify({representativeBodies: total,
    sideShare: total.side / total.obstacles}));
  assert.ok(sideHazardQuota(total.obstacles, total.side).acceptable);
  assert.deepEqual(sampleRoute(early.seed, early.endDistance, false, early.levelId, 'normal',
    early.startDistance), early.rows);
});
