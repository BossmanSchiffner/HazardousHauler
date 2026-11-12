import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {IMPLEMENTED_LEVELS, IMPLEMENTED_SECTORS, difficultyStepAtDistance, sectorAtDistance} from '../src/game/core/sectors.js';
import {MAX_TRACK_SPEED, METERS_PER_PIXEL, routeSpeedAtDistance, routeTimeAtDistance} from '../src/game/core/economy.js';
import {
  CHUNK_REGISTRIES, LEVEL2_CHUNK_REGISTRIES, createTrackGenerator, createTrackStream, prepareTrackChunk,
  MIN_ROW_SPACING_PX, canReachLaneSet, hasNoTrapLanes, isChunkReachable,
} from '../src/game/core/trackGenerator.js';
import {addMilestones, milestonesForDistance, moduleStatus, moduleLevelCap, nextSlotOffer, formatStat} from '../src/game/core/modules.js';
import {defaultProfile, normalizeProfile} from '../src/game/core/save.js';
import {isRunStartAvailable} from '../src/game/core/progression.js';
import {PLAYABLE_ROAD_WIDTH, PICKUP_RADIUS_PX} from '../src/game/data/route.js';
import {hazardGeometry, hazardFirstContactDistance, hazardScrollScale, hazardSweptArtOverlaps,
  HAZARD_ROW_ENVELOPE_PX, LANE_CENTERS, movingHazardMinimumForInterval} from '../src/game/core/hazards.js';
import {sampleRoute} from '../scripts/route-audit.mjs';
import {validateTrackSequence} from '../src/game/core/trackValidation.js';
import {HAZARD_TRAVEL_PX} from '../src/game/data/route.js';
import {MOVER_WINDOW_RULES, depotApproachMeters, nextMoverWindowAfter} from '../src/game/core/depots.js';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';
import {CHALLENGE_PROFILES, challengeProfile} from '../src/game/data/challengeProfiles.js';
import {LEVEL_SECTOR_LIGHTING} from '../src/game/data/environments.js';

const level2Routes = new Map();
const level2Route = (seed, start = 9, end = GAME_BALANCE.routes.level2.finishDistanceMeters) => {
  const key = `${seed}:${Math.max(9, start)}:${end}`;
  if (!level2Routes.has(key)) level2Routes.set(key, sampleRoute(seed, end, false, 'level2', 'normal', start));
  return level2Routes.get(key);
};

test('sector challenge identity is independent of visual metadata and gameplay owns collider sizes', () => {
  const profile = defaultProfile();
  assert.equal(isRunStartAvailable(profile, 'level1', 'beginning', 'continuous'), false);
  profile.levelProgress.level1.completed = true;
  assert.equal(isRunStartAvailable(profile, 'level1', 'beginning', 'continuous'), true);
  assert.equal(isRunStartAvailable(profile, 'level2', 'beginning', 'continuous'), false);
  assert.equal(isRunStartAvailable(profile, 'level1', 'beginning', 'overdrive'), false);
  for (const sectors of Object.values(IMPLEMENTED_LEVELS)) for (const sector of sectors) {
    assert.ok(Object.isFrozen(sector));
    assert.equal(sector.difficultyStep, sector.number - 1, 'difficulty follows sector position, not theme');
    assert.equal(sector.visualThemeId, sector.themeId, 'each sector shows its level theme');
    const changedArt = {...sector, visualThemeId: 'unavailable-art', color: 0};
    assert.equal(changedArt.difficultyStep, sector.difficultyStep);
    assert.equal(changedArt.challengeProfileId, sector.challengeProfileId);
    assert.equal(challengeProfile(changedArt.challengeProfileId),
      CHALLENGE_PROFILES[changedArt.challengeProfileId]);
  }
  assert.ok(Object.isFrozen(CHALLENGE_PROFILES));
  for (const profile of Object.values(CHALLENGE_PROFILES)) {
    assert.ok(Object.isFrozen(profile) && Object.isFrozen(profile.fillerHazardFamilies));
  }
  assert.throws(() => challengeProfile('missing'), /Unknown challenge profile/);
  // Rendering tests exercise the lookup; gameplay must not import visual resources.
  for (const name of ['trackGenerator', 'hazards']) {
    const source = readFileSync(new URL(`../src/game/core/${name}.js`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /visualThemeId|displayWidth|displayHeight|texture\.get/);
    assert.doesNotMatch(source, /from ['"].*(?:rendering|environments)/);
  }
});

test('Level 1 has four data-driven sector boundaries and difficulty steps up at each one', () => {
  assert.equal(sectorAtDistance(0).id, 'level1-sector1');
  assert.deepEqual(IMPLEMENTED_SECTORS.map(sector => sector.startsAt),
    GAME_BALANCE.routes.level1.sectorStartsMeters);
  assert.deepEqual(IMPLEMENTED_SECTORS.map(sector => sector.endsAt),
    GAME_BALANCE.routes.level1.sectorEndsMeters);
  assert.deepEqual(IMPLEMENTED_SECTORS.map(sector => sector.endsAt - sector.startsAt), [500, 500, 500, 500]);
  assert.deepEqual(IMPLEMENTED_SECTORS.map(sector => sector.themeId), ['industrial', 'industrial', 'industrial', 'industrial']);
  for (const [distance, step] of [[0, 0], [499.999, 0], [500, 1], [1000, 2], [1500, 3], [1999, 3], [2000, 3]]) {
    assert.equal(difficultyStepAtDistance(distance), step, `${distance} m`);
  }
  assert.equal(difficultyStepAtDistance(0, 'level1', 'continuous'), 1);
  assert.equal(difficultyStepAtDistance(
    4 * GAME_BALANCE.routes.continuous.depotIntervalMeters, 'level1', 'continuous'), 1,
    'Continuous stays at the Sector 2 baseline independently of milestone speeds');
  for (let i = 1; i < IMPLEMENTED_SECTORS.length; i++) {
    const sector = IMPLEMENTED_SECTORS[i];
    assert.equal(sectorAtDistance(sector.startsAt - 0.001).id, IMPLEMENTED_SECTORS[i - 1].id);
    assert.equal(sectorAtDistance(sector.startsAt).id, sector.id);
    assert.equal(sectorAtDistance(sector.startsAt + 0.001).id, sector.id);
  }
  assert.equal(sectorAtDistance(99999).id, 'level1-sector4');
  for (const invalid of [NaN, Infinity, -1]) assert.throws(() => sectorAtDistance(invalid), /Invalid/);
});

test('Level 4 registers four Neon challenge sectors at the approved route boundaries', () => {
  const sectors = IMPLEMENTED_LEVELS.level4;
  assert.deepEqual(sectors.map(({startsAt, endsAt}) => [startsAt, endsAt]),
    [[0, 500], [500, 1500], [1500, 2500], [2500, 4000]]);
  assert.deepEqual(sectors.map(sector => sector.challengeProfileId),
    ['level4_neon_s1', 'level4_neon_s2', 'level4_neon_s3', 'level4_neon_s4']);
  assert.deepEqual(sectors.map(sector => sector.visualThemeId), ['neon', 'neon', 'neon', 'neon']);
  assert.equal(sectorAtDistance(0, 'level4'), sectors[0]);
  assert.equal(sectorAtDistance(500, 'level4'), sectors[1]);
  assert.equal(sectorAtDistance(1500, 'level4'), sectors[2]);
  assert.equal(sectorAtDistance(2500, 'level4'), sectors[3]);
  assert.equal(sectorAtDistance(4000, 'level4'), sectors[3]);
});

test('Level 2 has independent four-sector progress and opens at its configured Level 1 speed', () => {
  const sectors = IMPLEMENTED_LEVELS.level2;
  assert.equal(sectors.length, 4);
  assert.deepEqual(sectors.map(sector => sector.startsAt),
    [0, ...GAME_BALANCE.routes.level2.sectorEndsMeters.slice(0, -1)]);
  assert.deepEqual(sectors.map(sector => sector.endsAt), GAME_BALANCE.routes.level2.sectorEndsMeters);
  assert.deepEqual(sectors.map(sector => sector.id),
    ['level2-sector1', 'level2-sector2', 'level2-sector3', 'level2-sector4']);
  assert.deepEqual(sectors.map(sector => sector.themeId), ['dustlands', 'dustlands', 'dustlands', 'dustlands']);
  for (const sector of sectors) assert.equal(sectorAtDistance(sector.startsAt, 'level2').id, sector.id);
  assert.equal(routeSpeedAtDistance(0, 'level2'), routeSpeedAtDistance(500, 'level1'));
  assert.equal(sectorAtDistance(1000, 'level1').id, 'level1-sector3');
  assert.equal(sectorAtDistance(1000, 'level2').id, 'level2-sector3');
  assert.equal(difficultyStepAtDistance(1000, 'level2'), difficultyStepAtDistance(1000, 'level1'));
  assert.equal(sectorAtDistance(0, 'level3').id, 'level3-sector1');
  assert.equal(IMPLEMENTED_LEVELS.level3[0].themeId, 'reactor');
});

test('speed ladder interpolates approved sector starts and clamps every runtime velocity', () => {
  assert.equal(MAX_TRACK_SPEED, 720);
  for (const [levelId, speeds] of [
    ['level1', [320, 350, 380, 410]], ['level2', [350, 380, 410, 440]],
    ['level3', [380, 410, 440, 470]], ['level4', [410, 440, 470, 500]],
  ]) {
    const sectors = IMPLEMENTED_LEVELS[levelId];
    for (const [index, sector] of sectors.entries()) {
      assert.equal(routeSpeedAtDistance(sector.startsAt, levelId), speeds[index]);
      if (index < sectors.length - 1) assert.equal(routeSpeedAtDistance(
        (sector.startsAt + sectors[index + 1].startsAt) / 2, levelId), (speeds[index] + speeds[index + 1]) / 2);
    }
    assert.equal(routeSpeedAtDistance(1e7, levelId), speeds.at(-1));
    for (const mode of levelId === 'level1' ? ['normal', 'continuous'] : ['normal']) {
      const route = GAME_BALANCE.routes[levelId];
      for (const distance of [0, route.sectorEndsMeters[1], route.finishDistanceMeters,
        route.finishDistanceMeters + 3 * GAME_BALANCE.routes.continuous.depotIntervalMeters, 1e7]) {
        assert.ok(routeSpeedAtDistance(distance, levelId, mode) <= MAX_TRACK_SPEED);
      }
    }
  }
  const elapsedSeconds = (start, end, levelId) => {
    let seconds = 0;
    for (let distance = start; distance < end; distance += 1) {
      seconds += 1 / (routeSpeedAtDistance(distance + 0.5, levelId) * METERS_PER_PIXEL);
    }
    return seconds;
  };

  for (const levelId of ['level1', 'level2', 'level3', 'level4']) {
    const finish = GAME_BALANCE.routes[levelId].finishDistanceMeters;
    for (const end of [1000, finish, finish + 2 * GAME_BALANCE.routes.continuous.depotIntervalMeters]) {
      assert.ok(Math.abs(routeTimeAtDistance(end, levelId) - elapsedSeconds(0, end, levelId)) < 0.001);
    }
  }
});

test('Level 2 forklift variants keep open corridors and actual emitted connected certificates', () => {
  const chunks = Object.values(LEVEL2_CHUNK_REGISTRIES).flat();
  const variants = chunks.filter(chunk => chunk.rows.some(row => row.hazards.some(hazard => hazard.kind === 'forklift')));
  assert.ok(variants.length >= 10);
  for (const chunk of chunks) {
    assert.ok(isChunkReachable(chunk), chunk.id);
    assert.ok(hasNoTrapLanes(chunk.rows), chunk.id);
    for (const [rowIndex, row] of chunk.rows.entries()) {
      assert.ok(row.cargoLanes.every(lane => row.safeLanes.includes(lane)), chunk.id);
      for (const hazard of row.hazards.filter(item => item.kind === 'forklift')) {
        assert.ok(row.safeLanes.length > 0, `${chunk.id}: mover leaves a clear lane`);
        assert.ok(hazard.motionBounds.maxOffsetPx > hazard.motionBounds.minOffsetPx);
        assert.equal(hazard.motionBounds.maxOffsetPx - hazard.motionBounds.minOffsetPx,
          LANE_CENTERS[1] - LANE_CENTERS[0]);
        assert.ok(hazard.lane < 3, 'forklift starts in one of the three adjacent-lane pairs');
        assert.deepEqual(hazard.openingLanes, [hazard.lane, hazard.lane + 1]);
        assert.ok(chunk.rows[rowIndex + 1]?.safeLanes &&
          hazard.openingLanes.every(lane => chunk.rows[rowIndex + 1].safeLanes.includes(lane)),
        `${chunk.id}: following row exposes the mover's approach pair`);
        assert.ok(chunk.rows[rowIndex + 1].safeLanes.includes(hazard.recoveryLane),
          `${chunk.id}: opening lets the player dodge and enter the recovery lane`);
        if (rowIndex + 2 < chunk.rows.length) {
          assert.ok(chunk.rows[rowIndex + 2].safeLanes.includes(hazard.recoveryLane),
            `${chunk.id}: recovery remains open through the next fixed row`);
        }
      }
    }
    if (chunk.rows.some(row => row.hazards.some(hazard => hazard.kind === 'forklift'))) {
      const resolvedRows = chunk.rows.map(row => row.hazards.filter(hazard => !hazard.continuation)
        .map(hazard => hazard.spanRows ? {...hazard,
          lengthPx: (hazard.spanRows - 1) * MIN_ROW_SPACING_PX + hazardGeometry(hazard).height,
          offsetY: (hazard.spanPhase - (hazard.spanRows - 1) / 2) * MIN_ROW_SPACING_PX,
        } : hazard));
      for (let movingRow = 0; movingRow < resolvedRows.length; movingRow++) {
        for (const mover of resolvedRows[movingRow].filter(hazard => hazard.kind === 'forklift')) {
          for (let otherRow = 0; otherRow < resolvedRows.length; otherRow++) {
            for (const other of resolvedRows[otherRow]) {
              if (other === mover) continue;
              assert.ok(!hazardSweptArtOverlaps(mover, other,
                (otherRow - movingRow) * MIN_ROW_SPACING_PX),
              `${chunk.id}: swept forklift overlaps ${other.kind} in row ${otherRow}`);
            }
          }
        }
      }
    }
  }
  const representativeChunks = variants.filter((chunk, index) => index % 17 === 0);
  for (const chunk of representativeChunks) {
    for (const distance of [1500, GAME_BALANCE.routes.level2.finishDistanceMeters - 1]) {
      const rows = prepareTrackChunk(chunk, distance, () => 1, 'level2').rows;
      const speed = routeSpeedAtDistance(distance, 'level2');
      // Owner rule: certify an open corridor (geometry only); upgrades decide who can drive it.
      for (const hz of [30, 60, 120]) {
        assert.ok(validateTrackSequence(rows, speed, {hz, geometric: true, minimumClearancePx: 0, levelId: 'level2'}).completed,
          `${chunk.id}: open corridor at ${speed}px/s, ${hz}Hz`);
      }
    }
  }
  for (const seed of [1, 153, 1234, 98765]) {
    const rows = level2Route(seed);
    let movers = 0;
    for (const row of rows) {
      assert.ok(row.certificates.every(proof => proof.completed && proof.clearance >= 6),
        `seed ${seed}, ${row.plannedDistance} m`);
      movers += row.emitted ? row.hazards.filter(hazard => hazard.movement).length : 0;
    }
    assert.ok(movers > 0, `seed ${seed} generated no moving hazards`);
  }
  const movementSample = seed => {
    for (const row of level2Route(seed, 9, 1500)) {
      const hazard = row.hazards.find(item => row.emitted && item.movement);
      if (hazard) return {chunkId: row.chunkId, lane: hazard.lane, movement: hazard.movement};
    }
    return null;
  };
  assert.deepEqual(movementSample(20261025), movementSample(20261025));
  assert.notDeepEqual(movementSample(20261025), movementSample(20261026));
});

test('Level 2 schedules four to fourteen separated movers per sampled banking interval', () => {
  const {metersPerPixel} = GAME_BALANCE.routes;
  const starts = IMPLEMENTED_LEVELS.level2.map(sector => sector.startsAt);
  for (const seed of [1, 153, 1234, 98765]) {
    for (const start of starts) {
      const end = nextMoverWindowAfter(start, MOVER_WINDOW_RULES, 'level2').distance;
      const encounters = [];
      const chunks = [];
      const rows = start === 0 ? level2Route(seed) : level2Route(seed, start, end);
      for (const row of rows.filter(row => row.plannedDistance < end)) {
        if (row.phase === 0) chunks.push(`${row.plannedDistance.toFixed(1)}:${row.chunkId}`);
        for (const hazard of row.hazards.filter(item => row.emitted && item.movement)) {
          const contact = hazardFirstContactDistance(hazard, row.plannedDistance);
          if (contact >= start && contact < end) encounters.push(contact);
        }
      }
      if (start === 0) assert.ok(encounters.every(at => at >= 1000), 'Sector 1 has no movers');
      if (start === 0) continue;
      assert.ok(encounters.length >= movingHazardMinimumForInterval(start, end),
        `seed ${seed}, interval ${start}-${end}, generated ${encounters.length}: ${encounters.join(', ')}; ${chunks.join(' | ')}`);
      assert.ok(encounters.length <= GAME_BALANCE.routes.movingHazards.maximumPerWindow);
      for (let i = 1; i < encounters.length; i++) {
        assert.ok(encounters[i] - encounters[i - 1] >=
          GAME_BALANCE.routes.movingHazards.minimumEncounterSpacingMeters,
        `seed ${seed}, interval ${start}-${end}, encounters too close`);
      }
    }
  }
});

test('Level 1 stays static and Level 2 introduces only lateral Forklifts from Sector 2', () => {
  assert.deepEqual(LEVEL_SECTOR_LIGHTING.level1.map(light => light.name),
    ['DAWN TRANSIT', 'DAWN TRANSIT', 'MID-DAY TRANSIT', 'MID-DAY TRANSIT']);
  assert.equal(LEVEL_SECTOR_LIGHTING.level2[3].name, 'DUSK TRANSIT');
  assert.equal(LEVEL_SECTOR_LIGHTING.level2[3].headlights, true);
  const level1 = sampleRoute(153, GAME_BALANCE.routes.level1.finishDistanceMeters, false, 'level1', 'normal');
  assert.ok(level1.every(row => [...row.hazards, ...row.intermediates].every(hazard => !hazard.movement)));
  const patrolLanes = new Set();
  for (const seed of [1, 153, 1234, 98765]) {
    let movers = 0;
    for (const row of level2Route(seed).filter(row => row.emitted)) {
      for (const hazard of [...row.hazards, ...row.intermediates].filter(hazard => hazard.movement)) {
        assert.ok(row.plannedDistance >= GAME_BALANCE.routes.level2.sectorEndsMeters[0],
          'Forklifts begin in the configured Sector 2');
        movers += 1;
        assert.equal(hazard.kind, 'forklift', `seed ${seed}: Level 2 has no forward Sweeper`);
        assert.equal(hazard.movement.axis, undefined, 'Level 2 movers never move along the road');
        assert.equal(hazardScrollScale(hazard), 1);
        assert.ok([2, 3].includes(hazard.openingLanes.length));
        assert.equal(hazard.movement.maxOffsetPx,
          LANE_CENTERS[hazard.lane + hazard.openingLanes.length - 1] - LANE_CENTERS[hazard.lane]);
        assert.equal(hazard.movement.warningSeconds, 0.5);
        patrolLanes.add(hazard.openingLanes.length);
      }
    }
    assert.ok(movers > 0, `seed ${seed}`);
  }
  assert.ok(patrolLanes.has(3), 'Forklifts patrol across three lanes wherever the opening allows');
});

test('continuous speed milestones use a global Industrial Sector 2 baseline instead of per-level Overdrive stages', () => {
  const continuousInterval = GAME_BALANCE.routes.continuous.depotIntervalMeters;
  for (const distance of [0, ...[1, 5, 7, 8, 9, 11].map(milestone => milestone * continuousInterval)]) {
    assert.equal(routeSpeedAtDistance(distance, 'level1', 'continuous'),
      Math.min(MAX_TRACK_SPEED, 350 + Math.floor(distance / 1000) * 40));
    assert.equal(sectorAtDistance(distance, 'level1', 'continuous'), IMPLEMENTED_LEVELS.level1[1]);
    assert.equal(nextMoverWindowAfter(distance, MOVER_WINDOW_RULES, 'level1', 'continuous').distance,
      (Math.floor(distance / 1000) + 1) * 1000);
  }
  assert.throws(() => routeSpeedAtDistance(8000, 'level2', 'continuous'), /global/);
});

test('every registry has no trap lanes, including every cross-sector connection and safe pickups', () => {
  const chunks = Object.values(CHUNK_REGISTRIES).flat();
  for (const chunk of chunks) {
    assert.ok(isChunkReachable(chunk));
    assert.ok(hasNoTrapLanes(chunk.rows), chunk.id);
    for (const row of chunk.rows) {
      assert.ok(row.cargoLanes.every(lane => row.safeLanes.includes(lane)));
    }
    for (const next of chunks) {
      assert.ok(chunk.rows.at(-1).safeLanes.every(lane => canReachLaneSet([lane], next.rows[0].safeLanes)),
        `${chunk.id} -> ${next.id}`);
    }
  }
});

test('6,000 seeded connections exercise every registry and boundary reproducibly', () => {
  const profiles = new Set(IMPLEMENTED_SECTORS.map(sector => sector.challengeProfileId));
  const sequence = seed => {
    const generator = createTrackGenerator(seed);
    let previous = null;
    const ids = [];
    for (let i = 0; i < 6000; i++) {
      const distance = IMPLEMENTED_SECTORS[Math.floor(i / 2) % IMPLEMENTED_SECTORS.length].startsAt;
      const chunk = generator.nextChunk(distance);
      // Production chunks are procedural: `${challengeProfileId}:${signature}`, not legacy registry ids.
      const [profile, signature] = chunk.id.split(/:(.*)/s);
      assert.ok(profiles.has(profile) && signature === chunk.signature, chunk.id);
      // Joins are certified physically from the previous chunk's actual exit states at every sampled rate.
      assert.deepEqual(chunk.certificates.map(proof => proof.hz), GAME_BALANCE.routes.track.routeValidation.sampleHz);
      assert.ok(chunk.certificates.every(proof => proof.completed &&
        proof.clearance >= GAME_BALANCE.routes.track.routeValidation.minimumClearancePx), chunk.id);
      ids.push(chunk.id);
      previous = chunk;
    }
    return ids;
  };
  assert.deepEqual(sequence(123), sequence(123));
  assert.notDeepEqual(sequence(123), sequence(456));
});

test('emitted rows cross sector boundaries and resume after Depots with certified physical clearance', () => {
  // Production chunks are procedural; the live contract is physical, not the legacy raw lane graph.
  const lead = HAZARD_TRAVEL_PX + HAZARD_ROW_ENVELOPE_PX / 2;
  const approach = {hazards: [], intermediates: [], safeLanes: [1, 2], spacingPx: lead};
  const replay = (rows, label) => {
    // Unemitted planned rows spawn nothing except continuing long bodies, exactly as in the live scene.
    const physical = rows.map(row => row.emitted ? row : {...row,
      hazards: row.hazards.filter(hazard => hazard.continuation), intermediates: [],
      safeLanes: LANE_CENTERS.map((_, lane) => lane)});
    const proof = validateTrackSequence([approach, ...physical], i =>
      routeSpeedAtDistance(rows[i - 1].plannedDistance + lead * METERS_PER_PIXEL, 'level1', 'normal'),
    {geometric: true, minimumClearancePx: GAME_BALANCE.routes.track.routeValidation.minimumClearancePx,
      levelId: 'level1', mode: 'normal', hz: 60, initialStates: [{lane: 1, x: 195, velocity: 0}]});
    assert.ok(proof.completed && proof.clearance >= GAME_BALANCE.routes.track.routeValidation.minimumClearancePx,
      `${label}: ${proof.clearance}`);
  };
  for (const sector of IMPLEMENTED_SECTORS.slice(1)) {
    for (let seed = 0; seed < 100; seed++) {
      const stream = createTrackStream(seed);
      const rows = [stream.nextRow(sector.startsAt - 150)];
      while (rows.at(-1).plannedDistance < sector.startsAt + 300) rows.push(stream.nextRow(sector.startsAt));
      assert.ok(rows[0].plannedDistance < sector.startsAt, `${sector.id}/${seed} starts before the boundary`);
      replay(rows, `${sector.id}/${seed}`);
      stream.resetAfterDepot(sector.startsAt);
      replay(Array.from({length: 6}, () => stream.nextRow(sector.startsAt)), `${sector.id}/${seed} after Depot`);
    }
  }
});

test('later milestones persist before settlement, open caps/slots once, and Overdrive adds no currency or milestone', () => {
  let profile = {...defaultProfile(), coins: 2200};
  for (const [distance, milestone, slots, cap] of [
    [GAME_BALANCE.routes.level1.sectorEndsMeters[1], 'level1,sector3', 4, 4],
    [GAME_BALANCE.routes.level1.sectorEndsMeters[2], 'level1,sector4', 5, 5],
  ]) {
    profile = {...profile, shipStates: {...profile.shipStates, standard: {
      ...profile.shipStates.standard, unlockedSlotCount: slots,
    }}};
    const result = addMilestones(profile, milestonesForDistance(distance));
    assert.ok(result.added.includes(milestone));
    profile = normalizeProfile(JSON.parse(JSON.stringify(result.profile)));
    assert.equal(profile.coins, 2200);
    assert.equal(profile.bestDistance, 0);
    assert.equal(moduleLevelCap(profile.milestones), cap);
    assert.ok(nextSlotOffer(profile).reached);
    assert.deepEqual(addMilestones(profile, milestonesForDistance(distance)).added, []);
  }
  assert.deepEqual(addMilestones(profile, milestonesForDistance(99999)).added, []);
  assert.equal(profile.coins, 2200);
});

test('sector milestone is idempotent, survives normalization/crash, and opens existing gates without free coins', () => {
  const old = {...defaultProfile(), coins: 750, bestDistance: 450, milestones: ['level1', 'level1,depot1'],
    shipStates: {...defaultProfile().shipStates, standard: {
      ...defaultProfile().shipStates.standard, unlockedSlotCount: 3,
    }}};
  const first = addMilestones(old, milestonesForDistance(500));
  assert.deepEqual(first.added, ['level1,sector2']);
  const repeat = addMilestones(first.profile, milestonesForDistance(501));
  assert.deepEqual(repeat.added, []);
  assert.equal(repeat.profile, first.profile);
  const loaded = normalizeProfile(JSON.parse(JSON.stringify(first.profile)));
  assert.equal(loaded.coins, 750);
  assert.equal(loaded.bestDistance, 450, 'milestone persists even before best-distance settlement');
  assert.equal(moduleStatus(loaded, 'def_shield').unlocked, false,
    'the Shield now unlocks by completing Level 2 Sector 3, not by the legacy Sector 2 milestone');
  assert.equal(moduleStatus(loaded, 'util_insurance').unlocked, false,
    'Cargo Insurance now unlocks by reaching Level 2 Sector 1');
  assert.equal(moduleLevelCap(loaded.milestones), 3);
  assert.ok(nextSlotOffer(loaded).reached);
  const normalizedOld = normalizeProfile(old);
  assert.equal(normalizedOld.tutorialCompleted, true,
    'established run history marks the tutorial complete during save normalization');
  assert.deepEqual(normalizeProfile(normalizedOld), normalizedOld);
  assert.ok(milestonesForDistance(5500).includes('level1,sector4'));
});

test('magnet presentation uses actual attraction threshold / road width consistently without changing pixel values', () => {
  for (const radius of [36, 48, 60, 72, 84, 105]) {
    assert.equal(formatStat('magnet', radius),
      `Collection range: ${Math.round((radius + PICKUP_RADIUS_PX) / PLAYABLE_ROAD_WIDTH * 100)}% of road width`);
  }
  assert.equal(formatStat('magnet', 0), 'Collection range: 0% of road width');
});
