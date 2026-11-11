import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMPAIGN_SPEEDS, GAME_BALANCE, MAX_TRACK_SPEED, ROUTE_TOPOLOGY} from '../src/game/data/gameBalance.js';
import {LEVEL2_SECTORS, SECTOR_CARGO, SECTORS, VEHICLES} from '../src/game/data/catalog.js';
import {MODULE_DEFS} from '../src/game/core/modules.js';
import {HAZARDS, LANE_CENTERS, hazardX, guardrailLayout, guardrailMinimumLength} from '../src/game/core/hazards.js';
import {DEPOT_ENTRANCE_GEOMETRY, DEPOT_RULES} from '../src/game/core/depots.js';
import {ROUTE_END_DISTANCE_M, routeSpeedAtDistance} from '../src/game/core/economy.js';

test('runtime consumers use the single frozen balance source and owner-approved tuning', () => {
  assert.equal(MAX_TRACK_SPEED, 720);
  assert.deepEqual(CAMPAIGN_SPEEDS, {
    level1: [320, 350, 380, 410],
    level2: [350, 380, 410, 440],
    level3: [380, 410, 440, 470],
    level4: [410, 440, 470, 500],
  });
  assert.deepEqual(ROUTE_TOPOLOGY, {
    level1: {
      finishDistance: 2000, depotDistances: [500, 1000, 1500],
      checkpointDistance: 1000, sectorEnds: [500, 1000, 1500, 2000],
    },
    level2: {
      finishDistance: 3000, depotDistances: [500, 1000, 2000],
      checkpointDistance: 1000, sectorEnds: [500, 1000, 2000, 3000],
    },
    level3: {
      finishDistance: 4000, depotDistances: [500, 1500, 2500],
      checkpointDistance: 1500, sectorEnds: [500, 1500, 2500, 4000],
    },
    level4: {
      finishDistance: 4000, depotDistances: [500, 1500, 2500],
      checkpointDistance: 1500, sectorEnds: [500, 1500, 2500, 4000],
    },
  });
  assert.ok(Object.isFrozen(GAME_BALANCE));
  assert.ok(Object.isFrozen(GAME_BALANCE.routes.track));
  assert.deepEqual(LANE_CENTERS, GAME_BALANCE.routes.track.laneCentersPx);
  assert.equal(ROUTE_END_DISTANCE_M, GAME_BALANCE.routes.level1.finishDistanceMeters);
  assert.equal(GAME_BALANCE.routes.finishClearanceMeters, 10);
  assert.equal(GAME_BALANCE.routes.level1.finishDistanceMeters, 2000);
  assert.deepEqual(GAME_BALANCE.routes.level1.sectorEndsMeters, [500, 1000, 1500, 2000]);
  assert.deepEqual(GAME_BALANCE.routes.level1.sectorStartsMeters, [0, 500, 1000, 1500]);
  assert.equal(GAME_BALANCE.progression.sectorsPerLevel, 4);
  assert.equal(GAME_BALANCE.routes.level1.sectorStartsMeters[GAME_BALANCE.progression.checkpointSector - 1], 1000,
    'the checkpoint follows Sector 2 completion');
  assert.equal(routeSpeedAtDistance(0), GAME_BALANCE.routes.level1.speed.startPxPerSecond);
  assert.equal(routeSpeedAtDistance(99_999), GAME_BALANCE.routes.level1.speed.endPxPerSecond);
  assert.deepEqual(GAME_BALANCE.routes.level2.openingSpeedSource, {levelId: 'level1', distanceMeters: 500});
  assert.equal(routeSpeedAtDistance(0, 'level2'), routeSpeedAtDistance(500, 'level1'));
  assert.equal(GAME_BALANCE.routes.level2.finishDistanceMeters, 3000);
  assert.deepEqual(GAME_BALANCE.routes.level2.sectorEndsMeters, [500, 1000, 2000, 3000]);
  assert.equal(LEVEL2_SECTORS.length, 4);
  assert.deepEqual(SECTORS.map(sector => sector.themeId), ['industrial', 'industrial', 'industrial', 'industrial']);
  assert.deepEqual(LEVEL2_SECTORS.map(sector => sector.themeId), ['dustlands', 'dustlands', 'dustlands', 'dustlands']);
  assert.deepEqual(GAME_BALANCE.routes.movingHazards, {
    eligibleLevelIds: ['level2'], eligibleModes: ['normal'], firstSector: 2,
    minimumPerWindow: 4, maximumPerWindow: 14,
    minimumEncounterSpacingMeters: 40, scheduleWindowFraction: 0.60,
    widthLanes: 1, travelLaneCount: 2, centralTravelLaneCount: 1, speedPxPerSecond: 76, reactionMarginSeconds: 0.8,
    forkliftWarningSeconds: 0.5, sweeperForwardSpeedRatio: 0.5,
    recoverySecondsBySector: [1.8, 1.2, 1.2, 1.2],
    chicane: {rowOffset: 2, validation: 'potential-lanes'},
  });

  test('every roadside restriction is a single-lane modular guardrail on either curb', () => {
    for (const [kind, geometry] of Object.entries(HAZARDS).filter(([, geometry]) => geometry.roadside)) {
      assert.ok(geometry.elongated && geometry.scenery, kind);
      assert.ok(geometry.width < LANE_CENTERS[1] - LANE_CENTERS[0], kind);
      const left = hazardX({kind, lane: 0}) + geometry.width / 2;
      const right = hazardX({kind, lane: 3}) - geometry.width / 2;
      assert.ok(left < (LANE_CENTERS[0] + LANE_CENTERS[1]) / 2, kind);
      assert.ok(right > (LANE_CENTERS[2] + LANE_CENTERS[3]) / 2, kind);
      for (const lane of [0, 3]) {
        const layout = guardrailLayout({kind, lane, lengthPx: 160});
        assert.ok(layout.entry > 0 && layout.midCount >= 1 && layout.exit > 0);
        assert.equal(layout.length, guardrailMinimumLength(kind));
        assert.ok(layout.midLength >= layout.width * GAME_BALANCE.hazards.guardrail.midLengthPerWidth - 1e-9);
        assert.equal(layout.side, lane === 0 ? 1 : -1);
      }
    }
  });
  assert.deepEqual(GAME_BALANCE.routes.sideObstacles, {
    minimumShare: 0.0225, maximumShare: 0.06, targetShare: 0.045,
    minimumSpanRows: 3, maximumSpanRows: 4, accountingWindowMeters: 600,
    chicaneStaggerRows: 1.5, chicaneTransitionExtraPx: 54,
  });
  assert.deepEqual(GAME_BALANCE.routes.continuous, {
    baselineLevelId: 'level1', baselineSector: 2,
    depotIntervalMeters: 1000, startSpeedPxPerSecond: 350, milestoneSpeedStep: 40,
  });
  assert.deepEqual(GAME_BALANCE.cargoProgression.capacityByRank,
    [11, 13, 15, 19, 22, 25, 27, 30, 32]);
  assert.equal(GAME_BALANCE.cargoProgression.capacityUpgradePrices.length, 8);
  assert.equal(GAME_BALANCE.cargoProgression.capacityUpgradePrices[0], 150);
  assert.equal(GAME_BALANCE.vehicles.swift.blueprintCost, 6);
  assert.equal(GAME_BALANCE.rewards.crash.maxCoins, 50);
  assert.equal(GAME_BALANCE.cargoProgression.reinforcementMitigationByRank.at(-1), 0.6);
  assert.equal(GAME_BALANCE.routes.track.routeValidation.loadedCapacity, 32);
  assert.equal(HAZARDS.sweeper.width, LANE_CENTERS[1] - LANE_CENTERS[0]);
  assert.equal(HAZARDS.sweeper.texture, 'hazard_forklift');
  assert.deepEqual(DEPOT_RULES, {
    ...GAME_BALANCE.routes.depot,
    triggerHalfMeters: (GAME_BALANCE.routes.depot.entrance.mouthHeight / 2 -
      GAME_BALANCE.hazards.playerHalfHeightPx) * GAME_BALANCE.routes.metersPerPixel,
  });
  assert.equal(DEPOT_ENTRANCE_GEOMETRY.width, GAME_BALANCE.routes.depot.entrance.width);

  for (const module of MODULE_DEFS) {
    const tuning = GAME_BALANCE.upgrades.modules[module.id];
    assert.equal(module.price, tuning.price);
    assert.equal(module.upgradeBase, tuning.upgradeBase);
    assert.deepEqual(module.benefit, {stat: tuning.stat, values: tuning.values});
  }
  for (const vehicle of VEHICLES) {
    assert.equal(vehicle.bpCost, GAME_BALANCE.vehicles[vehicle.id].blueprintCost);
  }
  assert.equal(SECTOR_CARGO.length, SECTORS.length + 1, 'one cargo table per sector position plus Overdrive');
  for (const [step, table] of SECTOR_CARGO.entries()) {
    assert.deepEqual(table.map(({value, weight}) => [value, weight]), GAME_BALANCE.cargo.valuesBySectorStep[step]);
  }
  for (const [kind, geometry] of Object.entries(GAME_BALANCE.hazards.collision)) {
    const width = geometry.widthLanes
      ? geometry.widthLanes * (LANE_CENTERS[1] - LANE_CENTERS[0])
      : kind === 'sweeper'
        ? GAME_BALANCE.routes.movingHazards.widthLanes * (LANE_CENTERS[1] - LANE_CENTERS[0])
        : geometry.width;
    const laneWide = kind === 'sweeper' || geometry.widthLanes;
    const solidFootprint = geometry.footprint && !laneWide && !geometry.roadside;
    const expectedHitX = laneWide
      ? width / 2 - (geometry.collisionInsetPx ?? 2) + GAME_BALANCE.hazards.playerHalfWidthPx
      : solidFootprint
        ? Math.max(...geometry.footprint.map(([x, , halfWidth]) => Math.abs(x) + halfWidth)) +
          GAME_BALANCE.hazards.playerHalfWidthPx
        : geometry.roadside
          ? geometry.width / 2 - 2 + GAME_BALANCE.hazards.playerHalfWidthPx
          : geometry.hitX ?? (width / 2 - 2 + GAME_BALANCE.hazards.playerHalfWidthPx);
    const expectedHitY = laneWide
      ? geometry.height / 2 - (geometry.collisionInsetPx ?? 2) + GAME_BALANCE.hazards.playerHalfHeightPx
      : geometry.hitY ?? (geometry.height / 2 - 2 + GAME_BALANCE.hazards.playerHalfHeightPx);
    assert.equal(HAZARDS[kind].width, width, kind);
    assert.equal(HAZARDS[kind].height, geometry.height, kind);
    assert.equal(HAZARDS[kind].hitX, expectedHitX, kind);
    assert.equal(HAZARDS[kind].hitY, expectedHitY, kind);
  }
});
