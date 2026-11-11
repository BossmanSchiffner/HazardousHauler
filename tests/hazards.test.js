import test from 'node:test';
import assert from 'node:assert/strict';
import {HAZARDS, INDUSTRIAL_HAZARD_KINDS, HAZARD_ROW_ENVELOPE_PX, LANE_CENTERS, guardrailContact, guardrailLayout, hazardDefinition, hazardGeometry, hazardHits, isGuardrail, hazardsForRow, hasStraightRoute, hazardArtOverlaps, hazardBlockedIntervals, hazardSweptArtOverlaps, hazardX, movingHazardOffset, energyOrbX, sideHazardQuota} from '../src/game/core/hazards.js';
import {CHUNK_REGISTRIES, INDUSTRIAL_CHUNKS, ROW_REACTION_SECONDS, createTrackGenerator, createTrackStream, rowSpacingAtSpeed} from '../src/game/core/trackGenerator.js';
import {ROAD_LEFT, ROAD_RIGHT, HAZARD_TRAVEL_PX} from '../src/game/data/route.js';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';
import {advanceSteering} from '../src/game/core/steering.js';
import {WORST_CASE_HANDLING, loadoutStats} from '../src/game/core/modules.js';
import {routeSpeedAtDistance, METERS_PER_PIXEL} from '../src/game/core/economy.js';
import {TEXTURE_SIZES} from '../src/game/rendering/industrial.js';
import {ENVIRONMENTS} from '../src/game/data/environments.js';
import {IMPLEMENTED_LEVELS, IMPLEMENTED_SECTORS, sectorAtDistance} from '../src/game/core/sectors.js';
import {minimumLaneChanges, sampleRoute} from '../scripts/route-audit.mjs';
import {driveTrackTransition, validateTrackSequence} from '../src/game/core/trackValidation.js';
import {CHALLENGE_PROFILES} from '../src/game/data/challengeProfiles.js';

const lanes = [86, 159, 232, 305];
const {playerHalfWidthPx: CAB_HALF_WIDTH, playerHalfHeightPx: CAB_HALF_HEIGHT} = GAME_BALANCE.hazards;

test('Energy Orb is a non-blocking roaming circular hazard with Level 4 profile pacing', () => {
  const orb = hazardDefinition('energy_orb');
  assert.deepEqual([orb.width, orb.height, orb.radius], [24, 24, 12]);
  assert.equal(orb.isMover, true);
  assert.equal(orb.moverType, 'roaming_lateral');
  assert.equal(orb.lateralSpeed, 45);
  assert.deepEqual([orb.minX, orb.maxX], [75, 315]);
  assert.equal(orb.ignoresObstacles, true);
  assert.equal(hazardHits('energy_orb', 100, 100, 100 + CAB_HALF_WIDTH + 11, 100), true);
  assert.equal(hazardHits('energy_orb', 100, 100, 100 + CAB_HALF_WIDTH + 13, 100), false);
  for (const [sector, gap] of [[1, [170, 210]], [2, [150, 190]], [3, [140, 180]], [4, [130, 160]]]) {
    const profile = CHALLENGE_PROFILES[`level4_neon_s${sector}`];
    assert.deepEqual(profile.obstaclePalette, ['barrier', 'signalCabinet', 'rockSlab']);
    assert.equal(profile.allowSweeper, false);
    assert.equal(profile.allowForklift, false);
    assert.equal(profile.allowEnergyOrb, true);
    assert.deepEqual(profile.orbSpawnIntervalM, [180, 260]);
    assert.deepEqual(profile.baseGapRange, gap);
  }
  assert.equal(energyOrbX({initialX: 75, direction: 1}, 0), 75);
  assert.equal(energyOrbX({initialX: 75, direction: 1}, 4), 255);
  assert.equal(energyOrbX({initialX: 315, direction: -1}, 4), 135);
  assert.equal(energyOrbX({initialX: 315, direction: 1}, 0), 315);
});

test('side hazard quota accepts only the approved inclusive physical-instance range', () => {
  for (const [obstacles, side] of [[10_000, 225], [10_000, 226], [100, 3], [100, 4], [100, 5], [100, 6]]) {
    const result = sideHazardQuota(obstacles, side);
    assert.equal(result.acceptable, true, `${100 * side / obstacles}%`);
    assert.equal(result.share, side / obstacles);
    assert.equal(result.minimumShare, GAME_BALANCE.routes.sideObstacles.minimumShare);
    assert.equal(result.maximumShare, 0.06);
    assert.equal(result.targetShare, 0.045);
  }
  for (const [obstacles, side] of [[100, 0], [10_000, 224], [100, 7], [100, 100]]) {
    assert.equal(sideHazardQuota(obstacles, side).acceptable, false);
  }
  assert.equal(sideHazardQuota(1_000_000, 22_499).acceptable, false,
    'rounding to 2.25% must not waive a below-minimum result');
  assert.equal(sideHazardQuota(999_999, 60_000).acceptable, false,
    'rounding to 6.00% must not waive an above-maximum result');
  assert.equal(sideHazardQuota(0, 0).acceptable, false, 'an empty route is not quota evidence');
});

test('side hazard quota rejects invalid counts rather than reporting success', () => {
  for (const counts of [[-1, 0], [1, -1], [1, 2], [1.5, 1], [2, 0.5], [NaN, 0],
    [Infinity, 0], [Number.MAX_SAFE_INTEGER + 1, 1]]) {
    assert.throws(() => sideHazardQuota(...counts), /Invalid emitted side-hazard counts/);
  }
});

// Owner rule: the generator guarantees an open corridor, not that a given truck can steer it in time.
function driveBetween(previous, next, from, to, distance, phase = 0, hz = 240) {
  const speed = routeSpeedAtDistance(distance + 72);
  const spacingPx = rowSpacingAtSpeed(routeSpeedAtDistance(distance)) +
    routeSpeedAtDistance(distance) * ROW_REACTION_SECONDS;
  const shape = (row, rowPhase) => ({spacingPx, intermediates: [],
    hazards: row.hazards ?? hazardsForRow(row, 4, rowPhase)});
  const result = driveTrackTransition(shape(previous, phase % 4), shape(next, Math.floor(phase / 4)),
    from, to, speed, {geometric: true, hz, minimumClearancePx: 0});
  assert.ok(result.completed, `${from}->${to} corridor closed at ${distance}m, phase ${phase}`);
}

test('hazard art footprints and collision envelopes vary, stay within their lanes and have near-miss margins', () => {
  assert.deepEqual(INDUSTRIAL_HAZARD_KINDS, ['divider', 'barrier', 'rockSlab']);
  assert.equal(new Set(INDUSTRIAL_HAZARD_KINDS.map(kind => HAZARDS[kind].width)).size, INDUSTRIAL_HAZARD_KINDS.length);
  assert.equal(new Set(INDUSTRIAL_HAZARD_KINDS.map(kind => HAZARDS[kind].height)).size, INDUSTRIAL_HAZARD_KINDS.length);
  for (const [kind, spec] of Object.entries(HAZARDS)) {
    const visual = spec.scenery ?? spec;
    if (!isGuardrail(kind) && kind !== 'energy_orb') {
      assert.deepEqual(TEXTURE_SIZES[spec.texture], [visual.width, visual.height]);
    }
    assert.ok(spec.hitX <= spec.width / 2 + CAB_HALF_WIDTH, `${kind}: collider never extends past art plus cab half-width`);
    assert.ok(spec.hitY <= spec.height / 2 + CAB_HALF_HEIGHT, `${kind}: collider never extends past art plus cab half-height`);
    if (!spec.roadside) assert.ok(!hazardHits(kind, 159, 0, 232, 0), 'adjacent safe lane stays safe');
    assert.ok(hazardHits(kind, 159, 0, 159, 0));
    if (spec.footprint) {
      const expectedHitX = Math.max(...spec.footprint.map(p => Math.abs(p.x) + p.halfWidth + CAB_HALF_WIDTH));
      const expectedHitY = Math.max(...spec.footprint.map(p => Math.abs(p.y) + p.halfHeight + CAB_HALF_HEIGHT));
      assert.ok(Math.abs(spec.hitX - expectedHitX) < 1e-9, `${kind}: hitX ${spec.hitX} vs ${expectedHitX}`);
      assert.ok(Math.abs(spec.hitY - expectedHitY) < 1e-9, `${kind}: hitY ${spec.hitY} vs ${expectedHitY}`);
      for (const part of spec.footprint) {
        assert.ok(Math.abs(part.x) + part.halfWidth < spec.width / 2, 'footprint inset from art');
        assert.ok(Math.abs(part.y) + part.halfHeight < spec.height / 2, 'footprint inset from art');
        assert.ok(hazardHits(kind, 159, 0, 159 + part.x + part.halfWidth + CAB_HALF_WIDTH - 0.01,
          part.y + part.halfHeight + CAB_HALF_HEIGHT - 0.01), `${kind}: cab surface touching the footprint collides`);
      }
    } else if (spec.radius) {
      assert.equal(hazardHits(kind, 159, 0,
        159 + CAB_HALF_WIDTH + spec.radius - 0.01, 0), true);
    } else {
      assert.ok(hazardHits(kind, 159, 0, 159 + spec.hitX - 0.01, spec.hitY - 0.01));
    }
    // 1e-9 absorbs float drift from adding the non-integer cab half-width to a lane coordinate.
    const clearX = spec.radius ? CAB_HALF_WIDTH + spec.radius + 1e-9 : spec.hitX + 1e-9;
    assert.ok(!hazardHits(kind, 159, 0, 159 + clearX, 0),
      `${kind}: cab surface clear of the collider stays safe`);
  }
  assert.throws(() => hazardDefinition('unknown'), /Unknown/);
});

test('moving hazard motion is deterministic, bounded and validated over its full swept route', () => {
  const movement = {
    minOffsetPx: 0, maxOffsetPx: LANE_CENTERS[2] - LANE_CENTERS[1], speedPxPerSecond: 76,
    direction: 1, phase: 15,
  };
  const path = Array.from({length: 40}, (_, index) => movingHazardOffset(movement, index / 10));
  assert.deepEqual(path, Array.from({length: 40}, (_, index) => movingHazardOffset(movement, index / 10)));
  assert.ok(path.every(offset => offset >= movement.minOffsetPx && offset <= movement.maxOffsetPx));
  assert.ok(new Set(path).size > 10);
  const reversed = movingHazardOffset({...movement, direction: -1}, 0.5);
  assert.notEqual(reversed, movingHazardOffset(movement, 0.5));
  const moving = {lane: 1, kind: 'sweeper', movement};
  const halfWidth = HAZARDS.sweeper.footprint[0].halfWidth;
  assert.deepEqual(hazardBlockedIntervals(moving),
    [[LANE_CENTERS[1] - halfWidth - GAME_BALANCE.hazards.playerHalfWidthPx,
      LANE_CENTERS[1] + movement.maxOffsetPx + halfWidth + GAME_BALANCE.hazards.playerHalfWidthPx]]);
  assert.equal(hazardHits(moving,
    hazardX({...moving, movementOffsetPx: movement.maxOffsetPx}), 0, 200, 0), true);
  assert.equal(HAZARDS.sweeper.width, LANE_CENTERS[2] - LANE_CENTERS[1]);
  assert.ok(HAZARDS.sweeper.footprint[0].halfWidth < HAZARDS.sweeper.width / 2,
    'collision footprint is inset from the forklift silhouette');
  assert.throws(() => movingHazardOffset({...movement, direction: 0}, 1), /Invalid/);
});

test('moving obstacle reservation uses its full visible sweep against same-row and adjacent-row obstacles', () => {
  const moving = {lane: 0, kind: 'sweeper', offsetY: 0,
    motionBounds: {minOffsetPx: 0, maxOffsetPx: LANE_CENTERS[1] - LANE_CENTERS[0]}};
  const withinSweep = {lane: 2, kind: 'divider', offsetY: 0};
  const outsideSweep = {lane: 3, kind: 'divider', offsetY: 0};
  assert.equal(hazardArtOverlaps(moving, withinSweep), false,
    'the initial forklift position does not reveal the later overlap');
  assert.equal(hazardSweptArtOverlaps(moving, withinSweep), true);
  assert.equal(hazardSweptArtOverlaps(moving, outsideSweep), false);
  assert.equal(hazardSweptArtOverlaps(moving, {...withinSweep, offsetY: 30}), true,
    'longitudinally adjacent art overlap is included');
});

test('guardrail collision: scenery assembly mirrors at the road frame without hits beyond its resolved tail', () => {
  for (const [kind, spec] of Object.entries(HAZARDS).filter(([, h]) => h.scenery)) {
    const {scenery} = spec;
    for (const lane of [0, 3]) {
      const right = lane === 3;
      const x = right ? 391 - scenery.anchorX : scenery.anchorX;
      const origin = right ? 1 - scenery.anchorX / scenery.width : scenery.anchorX / scenery.width;
      const left = x - origin * scenery.width;
      const localToWorld = local => left + (right ? scenery.width - local : local);
      assert.ok(Math.abs(localToWorld(43) - (right ? ROAD_RIGHT : ROAD_LEFT)) <= 1 + 1e-9,
        'housing joins the road frame within the existing 1px asymmetry of the lane anchors');
      assert.ok(Math.abs(localToWorld(scenery.anchorX) - x) < 1e-9);
      const tip = localToWorld(scenery.width);
      assert.equal(Math.round(tip), x + (right ? -1 : 1) * spec.width / 2);
      const geometry = hazardGeometry(kind);
      const inset = spec.width / 2 - geometry.footprint[0].halfWidth;
      const cabTipOffset = GAME_BALANCE.hazards.playerHalfWidthPx - inset;
      assert.ok(hazardHits(kind, x, 0, tip + (right ? -1 : 1) * (cabTipOffset - 0.1), 0),
        'ship body touching the inset visible projection collides');
      assert.ok(!hazardHits(kind, x, 0, tip + (right ? -1 : 1) * (cabTipOffset + 0.1), 0),
        'ship body beyond the inset projection remains safe');
      for (let shipX = 73; shipX <= 317; shipX += 1) {
        const layout = guardrailLayout({kind, lane});
        assert.equal(geometry.height, layout.length, 'rendered atomic tiles span the physical body');
        assert.ok(!hazardHits(kind, x, 0, shipX, geometry.hitY + 0.1),
          'no collision beyond the rendered guardrail tail and cab half-height');
      }
    }
  }
});

test('all sector objects fit their roadway anchors and leave safe pickup corridors without overlapping art', () => {
  const seen = new Set();
  for (const [sectorId, chunks] of Object.entries(CHUNK_REGISTRIES)) for (const chunk of chunks) for (const row of chunk.rows) {
    const blocked = row.hazards.flatMap(hazardBlockedIntervals);
    assert.deepEqual(lanes.map((x, lane) => ({x, lane})).filter(({x}) =>
      blocked.some(([left, right]) => x > left && x < right)).map(({lane}) => lane), row.hazardLanes);
    assert.equal(hazardsForRow(row, 1, 0), hazardsForRow(row, 4, 3), 'queued objects never re-skin');
    for (const h of row.hazards) {
      if (sectorId === 'industrial' && !HAZARDS[h.kind].roadside) seen.add(h.kind);
      const spec = hazardDefinition(h.kind);
      assert.ok(ENVIRONMENTS[sectorId].hazardFamilies.includes(h.kind), 'sector inventory owns its hazards');
      if (spec.roadside) {
        assert.ok(h.lane === 0 || h.lane === 3, 'roadside roots only on road edges');
        assert.ok(spec.width < LANE_CENTERS[1] - LANE_CENTERS[0], 'no single structure spans two lanes');
        const left = hazardX(h) - spec.width / 2;
        const right = hazardX(h) + spec.width / 2;
        assert.ok(h.lane === 0 ? right < (lanes[0] + lanes[1]) / 2
          : left > (lanes[2] + lanes[3]) / 2, 'center corridor stays clear');
        const shoulderEdge = hazardX(h) + (h.lane === 0 ? -1 : 1) * spec.scenery.anchorX;
        assert.ok(h.lane === 0 ? shoulderEdge < ROAD_LEFT : shoulderEdge > ROAD_RIGHT,
          'modular art extends onto the shoulder independently of the collider');
      } else {
        assert.ok(lanes[h.lane] - spec.width / 2 >= ROAD_LEFT + 8, 'inset from left road frame');
        assert.ok(lanes[h.lane] + spec.width / 2 <= ROAD_RIGHT - 8, 'inset from right road frame');
      }
      assert.ok(Math.abs(h.offsetY) + spec.hitY <= HAZARD_ROW_ENVELOPE_PX / 2);
      for (const lane of row.cargoLanes) {
        assert.ok(Math.abs(lanes[lane] - hazardX(h)) >= spec.hitX + 30, 'whole pickup corridor is safe');
      }
    }
    for (let i = 0; i < row.hazards.length; i++) for (const other of row.hazards.slice(i + 1)) {
      const h = row.hazards[i];
      assert.ok(Math.abs(hazardX(h) - hazardX(other)) >=
        (hazardDefinition(h.kind).width + hazardDefinition(other.kind).width) / 2 + 8, 'no overlapping silhouettes');
    }
  }
  assert.deepEqual([...seen].sort(), [...INDUSTRIAL_HAZARD_KINDS].sort());
  assert.ok(!hazardHits('machinery', 0, 0, 39, -30), 'recessed machinery corner is not a solid rectangular hitbox');
  assert.ok(hazardHits('machinery', 0, 0, 39, 20), 'protruding machinery motor collides');
});

test('challenge classification rejects continuous straight routes, including between lane centers', () => {
  const challenge = INDUSTRIAL_CHUNKS.filter(c => c.manoeuvring);
  assert.ok(challenge.length >= 4);
  assert.ok(INDUSTRIAL_CHUNKS.some(c => c.tier === 1), 'gentle staggered sections remain available');
  for (const chunk of INDUSTRIAL_CHUNKS) {
    assert.equal(chunk.manoeuvring, !hasStraightRoute(chunk.rows));
    assert.ok(chunk.manoeuvring, 'gentle sections no longer promise a straight corridor');
    if (!chunk.manoeuvring) continue;
    for (let x = 73; x <= 317; x += 0.25) {
      assert.ok(chunk.rows.some(row => row.hazards.some(h => {
        const spec = HAZARDS[h.kind];
        return spec.footprint
          ? spec.footprint.some(part => hazardHits(h.kind, hazardX(h), 0, x, part.y))
          : hazardHits(h.kind, hazardX(h), 0, x, 0);
      })), `${chunk.id} permits constant x=${x}`);
    }
  }
  // Narrow energy spines can block every named lane while leaving the geometric center open.
  const spines = [0, 1, 2, 3].map(lane => ({lane, kind: 'energySpine', offsetY: 0}));
  assert.equal(hasStraightRoute([{hazards: spines}]), true);
});

test('multiple deterministic Industrial seeds keep the measured manoeuvring mix without more objects', () => {
  // Owner-approved revision: the provisional 50-60% band predates the procedural encounter generator.
  // Geometric-openness revision: recovery chances were reduced, so measured tier-2 share over 2,000 chunks
  // per seed is 0.763-0.776; this band guards drift.
  for (const seed of [1, 153, 1234, 98765]) {
    const generator = createTrackGenerator(seed);
    const chunks = Array.from({length: 2000}, () => generator.nextChunk(300));
    const share = chunks.filter(c => c.tier === 2).length / chunks.length;
    assert.ok(share >= 0.72 && share <= 0.82, `${seed}: ${share}`);
    assert.ok(chunks.some(c => c.tier === 1), `${seed}: single-pressure recovery remains`);
    // Exhausted-budget recovery may repeat a certified layout; selected encounters may not.
    assert.ok(chunks.every((c, i) => i === 0 || c.fallback || c.id !== chunks[i - 1].id));
    const rows = chunks.flatMap(c => c.rows);
    // Side-structure continuation references repeat one physical body across rows; count bodies once.
    const objectsPerRow = rows.reduce((n, r) => n + r.hazards.filter(h => !h.continuation).length, 0) / rows.length;
    assert.ok(objectsPerRow < 2.5, `${seed}: placement, not raw density (${objectsPerRow})`);
    assert.ok(rows.every(r => r.safeLanes.length >= 1 &&
      r.hazards.filter(h => !h.sideObstacle).length < LANE_CENTERS.length), `${seed}: every row leaves a lane open`);
  }
});

test('every challenge family denies the center and offers authored outer commitments or split openings', () => {
  const challenges = INDUSTRIAL_CHUNKS.filter(c => c.tier === 2);
  assert.deepEqual([...new Set(challenges.map(c => c.family))].sort(),
    ['side-squeeze', 'center-denial', 'split-path', 'narrow-gate', 'offset-chicane', 'edge-commitment', 'roadside-weave'].sort());
  for (const chunk of challenges) {
    assert.ok(chunk.rows.some(r => r.safeLanes.every(lane => lane === 0 || lane === 3)),
      `${chunk.id} must leave the middle lanes`);
    assert.ok(chunk.rows.some(r => {
      const blocked = r.hazards.flatMap(hazardBlockedIntervals);
      return Array.from({length: 107}, (_, i) => 142 + i).every(x =>
        blocked.some(([left, right]) => x > left && x < right));
    }), `${chunk.id} denies the continuous middle band, not only lane centers`);
    assert.ok(chunk.rows.every(r => r.safeLanes.length <= 2), 'challenge does not use broad all-lane recovery rows');
  }
  for (const lane of [0, 3]) {
    assert.ok(challenges.some(c => c.rows.some(r => r.safeLanes.length === 1 && r.safeLanes[0] === lane)));
    assert.ok(challenges.some(c => c.family === 'edge-commitment' && c.rows.some(r =>
      r.safeLanes.length === 1 && r.safeLanes[0] === lane)));
  }
  assert.ok(challenges.some(c => c.rows.some(r => JSON.stringify(r.safeLanes) === '[0,3]')));
});

test('roadside weaves alternate connected arms and independent gates through adjacent full-load commitments', () => {
  for (const chunks of Object.values(CHUNK_REGISTRIES)) {
    const weaves = chunks.filter(c => c.family === 'roadside-weave');
    assert.equal(weaves.length, 2);
    for (const chunk of weaves) {
      // Owner-approved revision: every authored weave in all five registries requires exactly 4 changes.
      assert.ok(minimumLaneChanges(chunk.rows) >= 4, `${chunk.id}: ${minimumLaneChanges(chunk.rows)}`);
      const roots = chunk.rows.flatMap(r => r.hazards.filter(h => HAZARDS[h.kind].roadside));
      assert.ok(roots.some(h => h.lane === 0) && roots.some(h => h.lane === 3));
      // Each authored weave makes one outer full-load commitment; the mirrored pair covers both sides.
      const commitments = chunk.rows.filter(r => r.safeLanes.length === 1).map(r => r.safeLanes[0]);
      assert.ok(commitments.length > 0 && commitments.every(lane => lane === 0 || lane === 3), chunk.id);
      assert.ok(chunk.rows.every(r => r.hazards.some(h => !HAZARDS[h.kind].roadside)));
      for (const root of roots) {
        // Probe actual cab-surface clearance from the roadward footprint tip on both mirrored roots.
        const direction = root.lane === 0 ? 1 : -1;
        const expandedTip = Math.max(...hazardGeometry(root.kind).footprint.map(part =>
          direction * part.x + part.halfWidth)) + CAB_HALF_WIDTH;
        assert.ok(hazardHits(root.kind, lanes[root.lane], 0,
          lanes[root.lane] + direction * (expandedTip - 0.1), 0),
        'cab surface overlapping the roadward tip collides on both mirrored roots');
        assert.ok(!hazardHits(root.kind, lanes[root.lane], 0,
          lanes[root.lane] + direction * (expandedTip + 0.1), 0),
        'cab surface clear of the roadward tip stays open on both mirrored roots');
      }
    }
    const [left, right] = weaves;
    assert.deepEqual(new Set(weaves.flatMap(chunk => chunk.rows.filter(r => r.safeLanes.length === 1)
      .map(r => r.safeLanes[0]))), new Set([0, 3]), 'mirrored weaves commit to both outer lanes');
    for (const [phase, row] of left.rows.entries()) {
      assert.deepEqual(right.rows[phase].hazards.map(h => h.lane), row.hazards.map(h => 3 - h.lane));
      assert.deepEqual(right.rows[phase].safeLanes, row.safeLanes.map(lane => 3 - lane).sort());
    }
  }
});

test('Industrial internal and cross-chunk paths keep an open corridor at 30/60/120 Hz', () => {
  const pairs = INDUSTRIAL_CHUNKS.flatMap(c => c.rows.slice(1).map((r, i) => [c.rows[i], r]));
  for (const c of INDUSTRIAL_CHUNKS) for (const n of INDUSTRIAL_CHUNKS) pairs.push([c.rows.at(-1), n.rows[0]]);
  for (const hz of [30, 60, 120]) for (const distance of
    [IMPLEMENTED_SECTORS[0].startsAt, IMPLEMENTED_SECTORS[1].endsAt - 1, IMPLEMENTED_SECTORS.at(-1).endsAt]) {
    for (const [previous, next] of pairs) for (const from of previous.safeLanes) {
      const to = next.safeLanes.find(lane => Math.abs(lane - from) <= 1);
      driveBetween(previous, next, from, to, distance, 0, hz);
    }
  }
});

test('roadside intrusion collision covers the projected body but not open road beyond the tip', () => {
  for (const [kind, spec] of Object.entries(HAZARDS).filter(([, h]) => h.roadside)) {
    for (const lane of [0, 3]) {
      const direction = lane === 0 ? 1 : -1;
      const x = lanes[lane];
      const geometry = hazardGeometry(kind);
      const expandedTip = Math.max(...geometry.footprint.map(part =>
        direction * part.x + part.halfWidth)) + GAME_BALANCE.hazards.playerHalfWidthPx;
      assert.ok(hazardHits(kind, x, 0, x + direction * (spec.width / 2 - 5), 0), 'visible tip damages');
      assert.ok(hazardHits(kind, x, 0, x + direction * (expandedTip - 0.1), 0),
        'inside the canonical cab-expanded tip collides');
      assert.ok(!hazardHits(kind, x, 0, x + direction * (expandedTip + 0.1), 0),
        'outside expanded tip is safe');
      assert.ok(!hazardHits(kind, x, 0, 195, spec.hitY + 1), 'no invisible trailing collision');
    }
  }
});

test('every authored transition and every chunk connection keeps an open corridor', () => {
  const chunks = Object.values(CHUNK_REGISTRIES).flat();
  const pairs = chunks.flatMap(chunk => chunk.rows.slice(1).map((row, i) => [chunk.rows[i], row]));
  for (const chunk of chunks) for (const next of chunks) pairs.push([chunk.rows.at(-1), next.rows[0]]);
  for (const distance of IMPLEMENTED_SECTORS.map(s => s.startsAt)) {
    for (const [previous, next] of pairs) {
      for (const from of previous.safeLanes) {
        const to = next.safeLanes.find(lane => Math.abs(lane - from) <= 1);
        assert.notEqual(to, undefined);
        for (let phase = 0; phase < 16; phase++) driveBetween(previous, next, from, to, distance, phase);
      }
    }
  }
});

test('emitted production routes cross every sector reproducibly and keep an open corridor', () => {
  // Owner-approved revision: replay the production distance-domain stream (actual row spacing and Depot
  // protection) through the generator's own validator instead of a synthetic 7 m call cadence.
  const validation = GAME_BALANCE.routes.track.routeValidation;
  const route = (seed, levelId) =>
    sampleRoute(seed, GAME_BALANCE.routes[levelId].finishDistanceMeters, false, levelId);
  for (const levelId of Object.keys(IMPLEMENTED_LEVELS)) {
    const rows = route(1234, levelId);
    assert.deepEqual(new Set(rows.map(row => sectorAtDistance(row.spawnDistance, levelId).number)),
      new Set(IMPLEMENTED_LEVELS[levelId].map(sector => sector.number)), `${levelId} crosses every sector`);
    for (const row of rows.filter(row => row.emitted)) {
      assert.deepEqual(row.certificates.map(proof => proof.hz), validation.sampleHz);
      assert.ok(row.certificates.every(proof => proof.completed &&
        proof.clearance >= validation.minimumClearancePx), `${levelId} certificate at ${row.spawnDistance}m`);
    }
    // Protected Depot rows are not emitted, so the truck sees open road there.
    const physical = rows.map(row => row.emitted ? row
      : {...row, hazards: [], intermediates: [], safeLanes: [...LANE_CENTERS.keys()]});
    const speed = index => routeSpeedAtDistance(physical[index - 1].spawnDistance +
      (HAZARD_TRAVEL_PX + HAZARD_ROW_ENVELOPE_PX / 2) * METERS_PER_PIXEL, levelId);
    // Owner rule: certify an open corridor (geometry only); upgrades decide who can drive it.
    const certified = validateTrackSequence(physical, speed, {levelId, mode: 'normal', geometric: true,
      hz: validation.sampleHz[0], minimumClearancePx: validation.minimumClearancePx});
    assert.ok(certified.completed, `${levelId}: open corridor through the whole route`);
  }
  const signature = rows => rows.map(row => [row.spawnDistance, row.emitted, row.hazards, row.intermediates]);
  assert.deepEqual(signature(route(1234, 'level1')), signature(route(1234, 'level1')));
});

test('Depot center entry reaches a safe first lane before the earliest staggered hazard', () => {
  for (const chunk of Object.values(CHUNK_REGISTRIES).flat()) {
    const target = chunk.rows[0].safeLanes.includes(1) ? 159 : 232;
    let state = {x: 195, velocity: 0};
    for (let i = 0; i < 240; i++) {
      state = advanceSteering({...state, targetX: target, dt: 1 / 240, minX: 73, maxX: 317,
        load: 11, capacity: 11, handling: WORST_CASE_HANDLING, loadRelief: 0});
    }
    assert.equal(state.x, target);
    for (const h of hazardsForRow(chunk.rows[0], 1, 0)) assert.ok(!hazardHits(h.kind, lanes[h.lane], h.offsetY, state.x, 0));
  }
});

test('Industrial fresh start and Depot approaches allow reaction time at full load at 30/60/120 Hz', () => {
  for (const chunk of INDUSTRIAL_CHUNKS) for (const distance of
    [IMPLEMENTED_SECTORS[0].startsAt, IMPLEMENTED_SECTORS[1].endsAt - 1, IMPLEMENTED_SECTORS.at(-1).endsAt])
    for (const hz of [30, 60, 120]) {
    const hazards = chunk.rows[0].hazards;
    const target = lanes[chunk.rows[0].safeLanes.includes(1) ? 1 : 2];
    const speed = routeSpeedAtDistance(distance + 72);
    let state = {x: 195, velocity: 0};
    // Starts at actual spawn height relative to the ship, including 350 ms reaction.
    for (let time = 0; time < (719 + HAZARD_ROW_ENVELOPE_PX) / speed; time += 1 / hz) {
      for (const h of hazards) assert.ok(!hazardHits(h.kind, lanes[h.lane],
        -719 + time * speed + h.offsetY, state.x, 0), `${chunk.id}, ${hz}Hz, ${distance}m`);
      state = advanceSteering({...state, targetX: time < 0.35 ? 195 : target, dt: 1 / hz,
        minX: 73, maxX: 317, load: 11, capacity: 11, handling: WORST_CASE_HANDLING, loadRelief: 0});
    }
  }
});

test('guardrail layout is one entry, tiling mids and one exit that exactly span the collider length', () => {
  const {rampLateralPx, entryLengthPerWidth, midLengthPerWidth, exitLengthPerWidth} = GAME_BALANCE.hazards.guardrail;
  assert.equal(rampLateralPx, 24);
  for (const kind of ['sideRail', 'sideWall']) {
    assert.equal(isGuardrail(kind), true);
    for (const lengthPx of [54, 160, 342, 600, 1000, 1500]) {
      const left = guardrailLayout({kind, lane: 0, lengthPx});
      const minimum = left.width * (entryLengthPerWidth + midLengthPerWidth + exitLengthPerWidth);
      assert.equal(left.length, Math.max(lengthPx, minimum));
      assert.equal(hazardGeometry({kind, lengthPx}).height, left.length);
      assert.equal(hazardGeometry(kind).height, minimum, 'legacy default bodies also keep a complete mid');
      assert.ok(Math.abs(left.entry + left.midCount * left.midLength + left.exit - left.length) < 1e-9);
      assert.ok(left.midCount >= 1);
      assert.ok(left.midLength >= left.width * midLengthPerWidth - 1e-9, 'never compress a mid tile');
      assert.equal(left.width, HAZARDS[kind].scenery.width);
      assert.ok(Math.abs(left.entry - left.width * entryLengthPerWidth) < 1e-9);
      assert.ok(Math.abs(left.exit - left.width * exitLengthPerWidth) < 1e-9);
      assert.equal(left.side, 1);
      assert.equal(guardrailLayout({kind, lane: 3, lengthPx}).side, -1);
    }
  }
  for (const kind of ['divider', 'drum', 'crate']) if (HAZARDS[kind]) assert.equal(isGuardrail(kind), false);
});

test('guardrail contact separates the lethal lip from non-lethal flank, ramp and exit-taper contact', () => {
  const {playerHalfWidthPx: pw, playerHalfHeightPx: ph} = GAME_BALANCE.hazards;
  const {rampLateralPx} = GAME_BALANCE.hazards.guardrail;
  for (const [lane, side] of [[0, 1], [3, -1]]) {
    const hazard = {kind: 'sideWall', lane, lengthPx: 1000};
    const x = hazardX(hazard);
    const half = HAZARDS.sideWall.width / 2 - 2;
    const at = inward => x + side * inward;
    const lipY = 684 - ph + 0.5 - (1000 / 2 - 2);
    const head = guardrailContact(hazard, x, lipY, at(0), 684, 1);
    assert.equal(head.kind, 'headOn');
    assert.equal(head.side, side);
    assert.equal(guardrailContact(hazard, x, lipY - 1, at(0), 684, 0), null, 'no impact before the lip reaches the bumper');
    const ramp = guardrailContact(hazard, x, lipY + 50, at(half - rampLateralPx + pw + 2), 684, 1);
    assert.equal(ramp.kind, 'flank', 'the diagonal ramp beside the lip deflects instead of damaging');
    const mid = guardrailContact(hazard, x, 684, at(half + pw - 3), 684, 16);
    assert.equal(mid.kind, 'flank');
    assert.equal(mid.clampX, at(half + pw));
    assert.equal(mid.contactX, at(half));
    assert.equal(mid.contactY, 684);
    assert.equal(guardrailContact(hazard, x, 684, at(half + pw + 1), 684, 16), null, 'clear of the wall');
    const backY = 684 + ph + (1000 / 2 - 2) - guardrailLayout(hazard).exit / 2;
    const taper = guardrailContact(hazard, x, backY, at(0), 684, 16);
    assert.ok(taper && taper.kind === 'flank' && side * (taper.clampX - x) < half + pw, 'exit tapers back to the shoulder');
    assert.equal(guardrailContact(hazard, x, 684 + 1000, at(0), 684, 16), null, 'structure fully passed');
  }
});