import {pathToFileURL} from 'node:url';
import {createTrackStream, depotResumeFirstDistance, DENSITY_TARGETS} from '../src/game/core/trackGenerator.js';
import {routeSpeedAtDistance, METERS_PER_PIXEL} from '../src/game/core/economy.js';
import {IMPLEMENTED_LEVELS, IMPLEMENTED_SECTORS, sectorAtDistance} from '../src/game/core/sectors.js';
import {hasStraightRoute, straightRouteWidth, hazardBlockedIntervals, LANE_CENTERS, hazardGeometry,
  sideHazardQuota, hazardRouteGeometry, hazardRouteOffsetY, hazardFirstContactDistance,
  HAZARD_ROW_ENVELOPE_PX} from '../src/game/core/hazards.js';
import {validateTrackSequence, supportedTrackProfiles} from '../src/game/core/trackValidation.js';
import {WORST_CASE_HANDLING} from '../src/game/core/modules.js';
import {HAZARD_TRAVEL_PX} from '../src/game/data/route.js';
import {DEPOT_RULES, MOVER_WINDOW_RULES, nextDepotAfter, nextMoverWindowAfter} from '../src/game/core/depots.js';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';

/** Minimum required adjacent lane decisions through the Alpha gates, not a human clear rate. */
export function minimumLaneChanges(rows) {
  let costs = new Map(rows[0].safeLanes.map(lane => [lane, 0]));
  for (const row of rows.slice(1)) {
    costs = new Map(row.safeLanes.map(to => [to, Math.min(...[...costs]
      .filter(([from]) => Math.abs(from - to) <= 1)
      .map(([from, cost]) => cost + Math.abs(from - to)))]));
  }
  return Math.min(...costs.values());
}

const travelSeconds = (from, to, levelId = 'level1', mode = 'normal') => {
  let seconds = 0;
  for (let at = from; at < to; at += 1) {
    const step = Math.min(1, to - at);
    seconds += step / (routeSpeedAtDistance(at + step / 2, levelId, mode) * METERS_PER_PIXEL);
  }
  return seconds;
};

export function depotPacing(groups, end = GAME_BALANCE.routes.level1.finishDistanceMeters) {
  const envelopes = groups.filter(r => r.emitted).flatMap(r =>
    [...r.hazards, ...r.intermediates].filter(h => !h.continuation).map(h => ({
      first: hazardFirstContactDistance(h, r.spawnDistance),
      last: r.spawnDistance + (HAZARD_TRAVEL_PX - hazardRouteOffsetY(h) +
        Math.max(HAZARD_ROW_ENVELOPE_PX / 2, hazardRouteGeometry(h).hitY)) * METERS_PER_PIXEL,
    })));
  const samples = [];
  for (let bay = nextDepotAfter(0); bay.distance < end - 100; bay = nextDepotAfter(bay.distance)) {
    const last = Math.max(...envelopes.filter(h => h.last < bay.distance).map(h => h.last));
    const first = Math.min(...envelopes.filter(h => h.first > bay.distance).map(h => h.first));
    samples.push({distance: bay.distance,
      emptyApproachMeters: bay.distance - last,
      emptyApproachSeconds: travelSeconds(last, bay.distance),
      emptyExitSeconds: travelSeconds(bay.distance, first),
      warningEncounters: envelopes.filter(h => h.last >= bay.distance - DEPOT_RULES.noticeMeters &&
        h.last < bay.distance).length,
      prominentEncounters: envelopes.filter(h => h.last >= bay.distance - DEPOT_RULES.announcementMeters &&
        h.last < bay.distance).length,
      warningPickups: groups.filter(r => r.spawnDistance + HAZARD_TRAVEL_PX * METERS_PER_PIXEL >=
        bay.distance - DEPOT_RULES.noticeMeters &&
        r.spawnDistance + HAZARD_TRAVEL_PX * METERS_PER_PIXEL < bay.distance)
        .reduce((n, r) => n + r.pickups.length, 0),
    });
  }
  return samples;
}

/** Distance-domain playback of the production stream, including safe Depot clearing. */
export function sampleRoute(seed, end = GAME_BALANCE.routes.level1.finishDistanceMeters,
  enterDepots = false, levelId = 'level1', mode = 'normal', startDistance = 9) {
  const stream = createTrackStream(seed, levelId, mode);
  let distance = Math.max(9, startDistance);
  let nextDepot = nextDepotAfter(distance, DEPOT_RULES, levelId, mode).distance;
  let protectedUntil = 0;
  const groups = [];
  while (distance < end) {
    if (distance >= nextDepot + (enterDepots ? 0 : DEPOT_RULES.triggerHalfMeters)) {
      protectedUntil = nextDepot + DEPOT_RULES.exitMeters;
      if (enterDepots) {
        distance = nextDepot;
        stream.resetAfterDepot(distance);
        distance = depotResumeFirstDistance(distance);
      }
      nextDepot = nextDepotAfter(nextDepot, DEPOT_RULES, levelId, mode).distance;
    }
    const row = stream.nextRow(distance, {nextDepotDistance: nextDepot, protectedUntilDistance: protectedUntil});
    groups.push({...row, spawnDistance: distance, nextDepot,
      emitted: row.emitted});
    distance += row.spacingPx * METERS_PER_PIXEL;
  }
  return groups;
}

/** Physical occupancy and actual instance counts, including complete optional-Depot intervals. */
export function layoutMetrics(groups, {
  levelId = 'level1', mode = 'normal', startDistance = 9, endDistance = GAME_BALANCE.routes[levelId].finishDistanceMeters,
} = {}) {
  const envelopes = groups.filter(row => row.emitted).flatMap(row =>
    [...row.hazards, ...row.intermediates].filter(hazard => !hazard.continuation).map(hazard => {
      const geometry = hazardRouteGeometry(hazard);
      const halfHeight = Math.max(HAZARD_ROW_ENVELOPE_PX / 2, geometry.hitY);
      const center = row.spawnDistance + (HAZARD_TRAVEL_PX - hazardRouteOffsetY(hazard)) * METERS_PER_PIXEL;
      return {first: center - halfHeight * METERS_PER_PIXEL,
        last: center + halfHeight * METERS_PER_PIXEL,
        side: Boolean(hazard.sideObstacle), moving: Boolean(hazard.movement),
        lengthPx: geometry.height, spanRows: hazard.spanRows ?? 1};
    })).filter(hazard => hazard.last > hazard.first).sort((a, b) => a.first - b.first);
  const contacts = envelopes.filter(hazard => hazard.first >= startDistance && hazard.first < endDistance);
  const sides = contacts.filter(hazard => hazard.side);
  const physicalEnvelopes = groups.filter(row => row.emitted).flatMap(row =>
    [...row.hazards, ...row.intermediates].filter(hazard => !hazard.continuation).flatMap(hazard => {
      const geometry = hazardRouteGeometry(hazard);
      const center = row.spawnDistance + (HAZARD_TRAVEL_PX - hazardRouteOffsetY(hazard)) * METERS_PER_PIXEL;
      const parts = geometry.footprint ?? [{y: 0,
        halfHeight: geometry.hitY - GAME_BALANCE.hazards.playerHalfHeightPx}];
      return parts.map(part => ({
        first: center - (part.y + part.halfHeight +
          GAME_BALANCE.hazards.playerHalfHeightPx) * METERS_PER_PIXEL,
        last: Math.min(row.lifetime?.clearedAtDistance ?? Infinity,
          center - (part.y - part.halfHeight -
            GAME_BALANCE.hazards.playerHalfHeightPx) * METERS_PER_PIXEL),
      }));
    })).sort((a, b) => a.first - b.first);
  const gapsIn = (from, to, occupied = envelopes) => {
    let tail = from;
    const gaps = [];
    for (const hazard of occupied) {
      if (hazard.last <= from || hazard.first >= to) continue;
      if (hazard.first > tail) gaps.push({from: tail, to: hazard.first});
      tail = Math.max(tail, Math.min(to, hazard.last));
    }
    if (tail < to) gaps.push({from: tail, to});
    return gaps.map(gap => ({...gap, meters: gap.to - gap.from,
      seconds: travelSeconds(gap.from, gap.to, levelId, mode)}));
  };
  const intervals = [];
  let from = 0;
  for (let depot = nextDepotAfter(0, DEPOT_RULES, levelId, mode);
    depot.distance <= endDistance;
    depot = nextDepotAfter(depot.distance, DEPOT_RULES, levelId, mode)) {
    if (from >= startDistance) {
      const actual = contacts.filter(hazard => hazard.first >= from && hazard.first < depot.distance);
      const gaps = gapsIn(from, depot.distance);
      intervals.push({from, to: depot.distance, obstacles: actual.length,
        side: actual.filter(hazard => hazard.side).length,
        longSide: actual.filter(hazard => hazard.side &&
          hazard.spanRows >= GAME_BALANCE.routes.sideObstacles.minimumSpanRows).length,
        moving: actual.filter(hazard => hazard.moving).length,
        maximumEmptyMeters: Math.max(0, ...gaps.map(gap => gap.meters)),
        maximumEmptySeconds: Math.max(0, ...gaps.map(gap => gap.seconds))});
    }
    from = depot.distance;
  }
  const encounters = groups.filter(row => row.phase === 0);
  const familyCounts = {};
  for (const row of encounters) familyCounts[row.family] = (familyCounts[row.family] ?? 0) + 1;
  const lengths = sides.map(hazard => hazard.lengthPx).sort((a, b) => a - b);
  const gaps = gapsIn(startDistance, endDistance);
  const physicalGaps = gapsIn(startDistance, endDistance, physicalEnvelopes);
  const drivingEnd = mode === 'normal' ? Math.min(endDistance, GAME_BALANCE.routes[levelId].finishDistanceMeters)
    : endDistance;
  const banks = [];
  for (let bank = nextDepotAfter(startDistance, DEPOT_RULES, levelId, mode);
    bank.distance < drivingEnd; bank = nextDepotAfter(bank.distance, DEPOT_RULES, levelId, mode)) {
    banks.push(bank.distance);
  }
  const drivingGaps = gapsIn(startDistance, drivingEnd, physicalEnvelopes).filter(gap =>
    gap.from > startDistance && gap.to < drivingEnd &&
    !banks.some(bank => gap.from <= bank && gap.to >= bank));
  return {obstacles: contacts.length, side: sides.length,
    sidePercent: contacts.length ? 100 * sides.length / contacts.length : 0,
    longSide: sides.filter(hazard =>
      hazard.spanRows >= GAME_BALANCE.routes.sideObstacles.minimumSpanRows).length,
    sideLengthPx: lengths.length
      ? {min: lengths[0], median: lengths[Math.floor(lengths.length / 2)], max: lengths.at(-1)} : null,
    encounters: encounters.length, fallbacks: encounters.filter(row => row.fallback).length,
    familyCounts, intervals,
    collisionEmptyMeters: physicalGaps.reduce((sum, gap) => sum + gap.meters, 0),
    collisionEmptySeconds: physicalGaps.reduce((sum, gap) => sum + gap.seconds, 0),
    drivingMaximumEmptySeconds: Math.max(0, ...drivingGaps.map(gap => gap.seconds)),
    maximumEmptyMeters: Math.max(0, ...gaps.map(gap => gap.meters)),
    maximumEmptySeconds: Math.max(0, ...gaps.map(gap => gap.seconds))};
}

function obstacleAccounting(groups, levelId, start, end) {
  const sectorCounts = Object.fromEntries(IMPLEMENTED_LEVELS[levelId].map(sector => [sector.id, {
    obstacles: 0, sideObstacles: 0, excludedObstacles: 0, excludedSideObstacles: 0,
  }]));
  const total = {obstacles: 0, sideObstacles: 0, excludedObstacles: 0, excludedSideObstacles: 0};
  for (const row of groups) {
    const actual = [...row.hazards, ...row.intermediates].filter(hazard => !hazard.continuation);
    for (const hazard of actual) {
      const contact = hazardFirstContactDistance(hazard, row.spawnDistance);
      if (contact < start || contact >= end) continue;
      const sector = sectorAtDistance(contact, levelId);
      const scope = sectorCounts[sector.id];
      if (!row.emitted) {
        total.excludedObstacles++;
        scope.excludedObstacles++;
        if (hazard.sideObstacle) {
          total.excludedSideObstacles++;
          scope.excludedSideObstacles++;
        }
        continue;
      }
      total.obstacles++;
      scope.obstacles++;
      if (hazard.sideObstacle) {
        total.sideObstacles++;
        scope.sideObstacles++;
      }
    }
  }
  const summarize = counts => ({
    ...counts,
    sideQuota: sideHazardQuota(counts.obstacles, counts.sideObstacles),
    sideSharePercent: counts.obstacles
      ? +(100 * counts.sideObstacles / counts.obstacles).toFixed(2) : 0,
    targetSideCount: Math.round(counts.obstacles * GAME_BALANCE.routes.sideObstacles.targetShare),
  });
  return {definition: 'Count each emitted non-continuation hazard once when its leading collision edge reaches the ship before the route end; Depot-excluded objects are reported separately.',
    targetShare: GAME_BALANCE.routes.sideObstacles.targetShare,
    total: summarize(total),
    sectors: Object.fromEntries(Object.entries(sectorCounts)
      .map(([id, counts]) => [id, summarize(counts)]))};
}

/** Opt-in headless trace of the production stream; never imported by the game. */
export function traceRoute(runSeed, {
  levelId = 'level1', mode = 'normal', startDistance = 9,
  endDistance = GAME_BALANCE.routes[levelId]?.finishDistanceMeters, enterDepots = false,
} = {}) {
  if (!Number.isInteger(runSeed) || runSeed < 0 || runSeed > 0xffffffff ||
      !IMPLEMENTED_LEVELS[levelId] || !['normal', 'continuous'].includes(mode) ||
      !Number.isFinite(startDistance) || startDistance < 0 ||
      !Number.isFinite(endDistance) || endDistance <= Math.max(9, startDistance) ||
      typeof enterDepots !== 'boolean') {
    throw new Error('Invalid route trace seed, level, mode or distance range');
  }
  const groups = sampleRoute(runSeed, endDistance, enterDepots, levelId, mode, startDistance);
  const streaks = LANE_CENTERS.map(() => 0);
  let longestUnthreatenedLaneStreakRows = 0;
  let encounterIndex = -1;
  const movingPerWindow = new Map();
  const rows = groups.map((row, spawnIndex) => {
    if (row.phase === 0) encounterIndex++;
    const hazards = [...row.hazards, ...row.intermediates].filter(h => !h.continuation);
    const blocked = row.emitted ? hazards.flatMap(hazardBlockedIntervals) : [];
    for (const [lane, x] of LANE_CENTERS.entries()) {
      streaks[lane] = blocked.some(([left, right]) => x > left && x < right) ? 0 : streaks[lane] + 1;
      longestUnthreatenedLaneStreakRows = Math.max(longestUnthreatenedLaneStreakRows, streaks[lane]);
    }
    return {
      spawnIndex, encounterIndex, sector: sectorAtDistance(row.spawnDistance, levelId, mode).number,
      layoutId: row.chunkId, family: row.family, signature: row.signature, pacing: row.pacing,
      safePickupLanes: row.safePickupLanes,
      candidateAttempts: row.candidateAttempts, fallback: row.fallback,
      movingDeadline: row.movingDeadline, movingQuotaConflict: row.movingQuotaConflict,
      phase: row.phase, spawnDistance: row.spawnDistance,
      spacingPx: row.spacingPx, emitted: row.emitted,
      collisionSpawnCount: row.emitted ? hazards.length : 0,
      sideSpawnCount: row.emitted ? hazards.filter(h => h.sideObstacle).length : 0,
      pickups: row.pickups,
      hazards: hazards.map(hazard => {
        const contactDistance = hazardFirstContactDistance(hazard, row.spawnDistance);
        if (row.emitted && hazard.movement && contactDistance >= startDistance && contactDistance < endDistance) {
          const depot = nextMoverWindowAfter(contactDistance, MOVER_WINDOW_RULES, levelId, mode).distance;
          movingPerWindow.set(depot, (movingPerWindow.get(depot) ?? 0) + 1);
        }
        return {...hazard, contactDistance};
      }),
    };
  });
  return {
    runSeed, levelId, mode, startDistance, endDistance, enterDepots, rows,
    counts: {
      collisionSpawns: rows.reduce((sum, row) => sum + row.collisionSpawnCount, 0),
      sideSpawns: rows.reduce((sum, row) => sum + row.sideSpawnCount, 0),
      pickupSpawns: rows.reduce((sum, row) => sum + row.pickups.length, 0),
      longestUnthreatenedLaneStreakRows,
      movingPerWindow: [...movingPerWindow].map(([windowEndMeters, encounters]) =>
        ({windowEndMeters, encounters})),
    },
    contactAccounting: obstacleAccounting(groups, levelId, startDistance, endDistance),
  };
}

export function auditLevel2Routes(seeds = [1, 153, 1234, 98765]) {
  let totalGroups = 0, movingHazards = 0, certifiedChunks = 0;
  const sectorGroups = Object.fromEntries(IMPLEMENTED_LEVELS.level2.map(sector => [sector.id, 0]));
  const movingBySector = Object.fromEntries(IMPLEMENTED_LEVELS.level2.map(sector => [sector.id, 0]));
  const sideObstacleRuns = [];
  for (const seed of seeds) {
    const groups = sampleRoute(seed, GAME_BALANCE.routes.level2.finishDistanceMeters, false, 'level2');
    sideObstacleRuns.push({seed, ...obstacleAccounting(groups, 'level2', 0,
      GAME_BALANCE.routes.level2.finishDistanceMeters)});
    totalGroups += groups.length;
    let sequence = [];
    for (const row of groups) {
      sectorGroups[sectorAtDistance(row.spawnDistance, 'level2').id]++;
      if (row.phase === 0) sequence = [];
      sequence.push(row);
      if (row.phase !== row.sequenceLength - 1 ||
          !sequence.every(item => item.chunkId === row.chunkId && item.emitted)) continue;
      const speed = routeSpeedAtDistance(row.spawnDistance + HAZARD_TRAVEL_PX * METERS_PER_PIXEL, 'level2');
      const baseline = supportedTrackProfiles('level2').find(profile => profile.id === 'standard-c0-s0-mid');
      for (const hz of GAME_BALANCE.routes.track.routeValidation.sampleHz) {
        if (!validateTrackSequence(sequence, speed, {...baseline, levelId: 'level2', hz, geometric: true,
          minimumClearancePx: GAME_BALANCE.routes.track.routeValidation.minimumClearancePx}).completed) {
          throw new Error(`Unreachable Level 2 chunk ${row.chunkId} with seed ${seed}`);
        }
      }
      certifiedChunks++;
      const count = sequence.flatMap(item => [...item.hazards, ...item.intermediates])
        .filter(hazard => hazard.movement).length;
      movingHazards += count;
      movingBySector[sectorAtDistance(sequence[0].spawnDistance, 'level2').id] += count;
    }
  }
  const moverIntroduction = GAME_BALANCE.routes.movingHazards.firstSector - 1;
  if (movingHazards === 0 || certifiedChunks === 0 ||
      IMPLEMENTED_LEVELS.level2.some((sector, index) =>
        (movingBySector[sector.id] > 0) !== (index >= moverIntroduction))) {
    throw new Error('Level 2 audit did not encounter certified moving-hazard routes in every Forklift sector');
  }
  return {seeds, totalGroups, certifiedChunks, movingHazards, movingBySector, sectorGroups,
    sideObstacleRuns};
}

export function auditRoutes(seeds = [1, 153, 1234, 98765]) {
  const stats = Object.fromEntries(IMPLEMENTED_SECTORS.map(s => [s.id, {
    target: DENSITY_TARGETS[s.difficultyStep], encounters: 0, hazards: 0, intermediate: 0,
    sequences: 0, lateral: 0, outer: 0, challengeSequences: 0, movingChallenges: 0,
    requiredLaneChanges: 0, sequenceRows: 0, singleLaneRows: 0, sustainedSequences: 0,
    routeRequiredLaneChanges: 0,
    fourRowWindows: 0, straightFourRowWindows: 0, longStructures: 0,
    betaPressureTransitions: 0, betaTransitions: 0, stretchEncounters: [0, 0, 0, 0],
    builds: Object.fromEntries(['open', 'worst', 'baseline', 'upgraded'].map(id => [id, {completed: 0, minimumClearancePx: Infinity}])),
  }]));
  let totalGroups = 0;
  const level1SideObstacleRuns = [];
  const depotSamples = [];
  for (const seed of seeds) {
    const groups = sampleRoute(seed);
    level1SideObstacleRuns.push({seed, ...obstacleAccounting(groups, 'level1', 0,
      GAME_BALANCE.routes.level1.finishDistanceMeters)});
    for (let i = 3; i < groups.length; i++) {
      const s = stats[sectorAtDistance(groups[i].spawnDistance).id];
      s.fourRowWindows++;
      if (hasStraightRoute(groups.slice(i - 3, i + 1))) s.straightFourRowWindows++;
    }
    depotSamples.push(...depotPacing(groups));
    totalGroups += groups.length;
    let sequence = [], previousRow, approach;
    let routeSegment = [], segmentCost = 0;
    for (const row of groups) {
      if (!row.emitted || (routeSegment.length && routeSegment[0].nextDepot !== row.nextDepot)) {
        routeSegment = [];
        segmentCost = 0;
      }
      if (row.emitted) {
        routeSegment.push(row);
        const cost = minimumLaneChanges(routeSegment);
        const arrival = row.spawnDistance + HAZARD_TRAVEL_PX * METERS_PER_PIXEL;
        if (arrival < GAME_BALANCE.routes.level1.finishDistanceMeters) {
          stats[sectorAtDistance(arrival).id].routeRequiredLaneChanges += cost - segmentCost;
        }
        segmentCost = cost;
        for (const offset of [0, ...row.intermediates.map(h => h.offsetY)]) {
          const arrival = row.spawnDistance + (HAZARD_TRAVEL_PX - offset) * METERS_PER_PIXEL;
          const sector = sectorAtDistance(arrival);
          if (arrival >= GAME_BALANCE.routes.level1.finishDistanceMeters) continue;
          const s = stats[sector.id];
          s.encounters++;
          s.stretchEncounters[Math.min(3, Math.floor((arrival - sector.startsAt) /
            GAME_BALANCE.routes.level1.densityStretch.intervalMeters))]++;
          if (offset !== 0) s.intermediate++;
        }
        if (arrival < GAME_BALANCE.routes.level1.finishDistanceMeters) {
          const s = stats[sectorAtDistance(arrival).id];
          const spawned = [...row.hazards, ...row.intermediates].filter(h => !h.continuation);
          s.hazards += spawned.length;
          s.longStructures += spawned.filter(h => h.spanRows).length;
        }
      }
      if (row.phase === 0) { sequence = []; approach = previousRow; }
      sequence.push(row);
      previousRow = row;
      if (sequence[0].phase !== 0 || row.phase !== row.sequenceLength - 1 ||
          !sequence.every(r => r.chunkId === row.chunkId && r.emitted)) continue;
      const s = stats[sectorAtDistance(sequence[0].spawnDistance).id];
      const geometry = sequence.map(r => ({hazards: [...r.hazards, ...r.intermediates]}));
      s.sequences++;
      s.requiredLaneChanges += minimumLaneChanges(sequence);
      s.sequenceRows += sequence.length;
      s.singleLaneRows += sequence.filter(r => r.safeLanes.length === 1).length;
      if (row.sustained) s.sustainedSequences++;
      for (let i = 0; i < sequence.length - 1; i++) {
        const previous = sequence[i], next = sequence[i + 1];
        if (!previous.intermediates.length) continue;
        s.betaTransitions++;
        if (straightRouteWidth([previous, next]) >
          straightRouteWidth([{hazards: [...previous.hazards, ...previous.intermediates]}, next])) {
          s.betaPressureTransitions++;
        }
      }
      const lateral = !hasStraightRoute(geometry);
      if (lateral) s.lateral++;
      if (row.challenge) {
        s.challengeSequences++;
        if (lateral) s.movingChallenges++;
      }
      if (sequence.some(r => r.safeLanes.every(lane => lane === 0 || lane === 3))) s.outer++;
      const speed = routeSpeedAtDistance(row.spawnDistance + HAZARD_TRAVEL_PX * METERS_PER_PIXEL);
      // 'open' is the owner's mandatory geometric certificate; the steering builds are characterisation only.
      for (const [id, handling] of [['open', null], ['worst', WORST_CASE_HANDLING], ['baseline', 0], ['upgraded', 0.32]]) {
        const baseline = supportedTrackProfiles().find(profile => profile.id === 'standard-c0-s0-mid');
        const entry = approach?.emitted ? approach : {...approach, hazards: approach?.hazards
          .filter(hazard => hazard.continuation) ?? [], intermediates: [], safeLanes: [0, 1, 2, 3],
          spacingPx: approach?.spacingPx ?? HAZARD_TRAVEL_PX + HAZARD_ROW_ENVELOPE_PX / 2};
        const anchored = id === 'baseline' || id === 'open';
        const result = validateTrackSequence(anchored ? [entry, ...sequence] : sequence,
          i => routeSpeedAtDistance(sequence[anchored ? i - 1 : i].plannedDistance +
          (HAZARD_TRAVEL_PX + HAZARD_ROW_ENVELOPE_PX / 2) * METERS_PER_PIXEL),
        id === 'open' ? {geometric: true, hz: GAME_BALANCE.routes.track.routeValidation.sampleHz[0],
          minimumClearancePx: GAME_BALANCE.routes.track.routeValidation.minimumClearancePx,
          initialStates: row.certificates[0].entries}
          : id === 'baseline' ? {...baseline, hz: 60, initialStates:
          row.certificates[0].entries}
          : {handling, hz: 60});
        if (result.completed) s.builds[id].completed++;
        s.builds[id].minimumClearancePx = Math.min(s.builds[id].minimumClearancePx, result.clearance);
      }
    }
  }
  const sectorLength = id => {
    const index = IMPLEMENTED_SECTORS.findIndex(s => s.id === id);
    return (IMPLEMENTED_SECTORS[index + 1]?.startsAt ??
      GAME_BALANCE.routes.level1.finishDistanceMeters) - IMPLEMENTED_SECTORS[index].startsAt;
  };
  const baselineRate = stats[IMPLEMENTED_SECTORS[0].id].encounters / (seeds.length * sectorLength(IMPLEMENTED_SECTORS[0].id) / 100);
  const level2CheckpointStart = GAME_BALANCE.routes.level2.sectorStartsMeters[2];
  const continuousStart = GAME_BALANCE.routes.spawning.initialRowDelaySeconds *
    routeSpeedAtDistance(0, 'level1', 'continuous') * METERS_PER_PIXEL;
  const continuousEnd = 12000;
  const checkpointSideObstacleRuns = seeds.map(seed => {
    const groups = sampleRoute(seed, GAME_BALANCE.routes.level2.finishDistanceMeters, false,
      'level2', 'normal', level2CheckpointStart);
    return {seed, startDistance: level2CheckpointStart,
      ...obstacleAccounting(groups, 'level2', level2CheckpointStart,
        GAME_BALANCE.routes.level2.finishDistanceMeters)};
  });
  const continuousSideObstacleRuns = seeds.map(seed => {
    const groups = sampleRoute(seed, continuousEnd, false, 'level1', 'continuous', continuousStart);
    return {seed, startDistance: continuousStart, endDistance: continuousEnd,
      ...obstacleAccounting(groups, 'level1', continuousStart, continuousEnd)};
  });
  const level2Audit = auditLevel2Routes(seeds);
  return {seeds, totalGroups, level2: level2Audit,
    sideObstacleAccounting: {
      normalLevel1: level1SideObstacleRuns,
      normalLevel2: level2Audit.sideObstacleRuns,
      level2CheckpointStarts: checkpointSideObstacleRuns,
      continuous: continuousSideObstacleRuns,
    },
    definition: 'Encounter = a primary group or a separate intermediate; rates include Depot safe areas.',
    depotPacing: {samples: depotSamples.length,
      maximumEmptyApproachSeconds: Math.max(...depotSamples.map(s => s.emptyApproachSeconds)),
      maximumEmptyExitSeconds: Math.max(...depotSamples.map(s => s.emptyExitSeconds)),
      minimumWarningEncounters: Math.min(...depotSamples.map(s => s.warningEncounters)),
      warningPickups: depotSamples.reduce((n, s) => n + s.warningPickups, 0)},
    sectors: Object.fromEntries(Object.entries(stats).map(([id, s]) => [id, {
      ...s, encountersPer100m: +(s.encounters / (seeds.length * sectorLength(id) / 100)).toFixed(3),
      versusIndustrial: +(s.encounters / (seeds.length * sectorLength(id) / 100) / baselineRate).toFixed(3),
      lateralPercent: +(100 * s.lateral / s.sequences).toFixed(2),
      movingChallengePercent: +(100 * s.movingChallenges / s.challengeSequences).toFixed(2),
      requiredChangesPerSequence: +(s.requiredLaneChanges / s.sequences).toFixed(3),
      minimumAlphaChangesPer100m: +(s.routeRequiredLaneChanges / (seeds.length * sectorLength(id) / 100)).toFixed(3),
      singleLanePercent: +(100 * s.singleLaneRows / s.sequenceRows).toFixed(2),
      outerPercent: +(100 * s.outer / s.sequences).toFixed(2),
      stretchEncountersPer100m: s.stretchEncounters.map((n, index) => {
        const length = Math.max(0, index === 3 ? sectorLength(id) - index * 600 : Math.min(600, sectorLength(id) - index * 600));
        return length ? +(n / (seeds.length * length / 100)).toFixed(3) : null;
      }),
    }]))};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--trace') {
    const [, , , seed = '1', levelId = 'level1', mode = 'normal', start = '9', end] = process.argv;
    console.log(JSON.stringify(traceRoute(Number(seed), {
      levelId, mode, startDistance: Number(start),
      ...(end === undefined ? {} : {endDistance: Number(end)}),
    }), null, 2));
  } else {
    console.log(JSON.stringify(auditRoutes(), null, 2));
  }
}
