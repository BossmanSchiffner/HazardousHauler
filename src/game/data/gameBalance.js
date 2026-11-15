/**
 * Runtime balance editing guide
 *
 * Keep gameplay tuning here; route art, text, and authored obstacle arrangements remain in
 * their owning data/rendering modules. Distances use metres, speeds use px/s, durations use
 * seconds, probabilities/bonuses use fractions (0.15 = 15%), and module rank arrays are
 * indexed by `rank - 1`; cargo capacity is indexed from rank 0. Keep probabilities in [0, 1],
 * prices/rewards non-negative, and capacities,
 * intervals, distances, and durations positive unless a documented zero disables a feature.
 * Module benefits are additive to the chassis stat except shield capacity, which is exactly its
 * equipped rank; steering and Apex benefit multipliers multiply. Depot skip bonuses are additive.
 *
 * Example: change `cargoProgression.capacityUpgradePrices` to alter capacity upgrade prices, or
 * increase `upgrades.modules.hand_precision.values[0]` to change its Rank 1 steering boost.
 * New calculations use the new balance; saved ownership is retained and past purchases are
 * never refunded automatically. Moving-hazard bounds and speed live beside their route.
 */
export const MAX_TRACK_SPEED = 700;

export const CAMPAIGN_SPEEDS = deepFreeze({
  level1: [320, 350, 380, 410],
  level2: [350, 380, 410, 440],
  level3: [380, 410, 440, 470],
  level4: [410, 440, 470, 500],
});

export const ROUTE_TOPOLOGY = deepFreeze({
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

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const balance = {
  rewards: {
    continuous: {skipBonusPerDepot: 0.10, maximumBonus: 1, wreckRetention: 0},
    blueprintToCoins: 35,
    crash: {baseCoins: 5, stepCoins: 3, stepDistanceMeters: 150, maxCoins: 50},
    levelRecord: {sector1: 50, sectors2to3: 100, sectors4to5: 250, fullStartOnly: true},
    levelCompletion: {firstCoins: 500, repeatCoins: 250},
    noDamageCargo: {eligibleAfterPassedDepots: 2, multiplier: 1.5},
    level1NoDamageGold: {
      implemented: true, levelId: 'level1', startingSector: 1, vehicleId: 'standard',
      colorId: 'gold',
    },
    rounding: {crashDistance: 'floor', cargoBank: 'floor', bonusPayout: 'floor'},
  },
  routes: {
    metersPerPixel: 0.06,
    finishClearanceMeters: 10,
    continuous: {baselineLevelId: 'level1',
      depotIntervalMeters: 2000, startSpeedPxPerSecond: 460, maximumSpeedPxPerSecond: 620,
      milestoneSpeedStep: 20, speedStepIntervalMeters: 1000,
      cargoValue: 25, lateCargoValue: 30, lateCargoDistanceMeters: 6000},
    level1: {
      challengeProfileId: 'industrial',
      sectorEndsMeters: ROUTE_TOPOLOGY.level1.sectorEnds,
      depotDistancesMeters: ROUTE_TOPOLOGY.level1.depotDistances,
      checkpointDistanceMeters: ROUTE_TOPOLOGY.level1.checkpointDistance,
      sectorThemeIds: ['industrial', 'industrial', 'industrial', 'industrial'],
      speed: {startPxPerSecond: CAMPAIGN_SPEEDS.level1[0], endPxPerSecond: CAMPAIGN_SPEEDS.level1.at(-1),
        sectorStartsPxPerSecond: CAMPAIGN_SPEEDS.level1},
      // Difficulty steps up at each sector milestone; the final entry applies past the finish (Overdrive).
      densityTargets: [1, 1.15, 1.30, 1.45, 1.55],
      densityStretch: {intervalMeters: 600, increment: 0.02, maxIntervals: 3, intermediateDensityScale: 1.08},
      challengeChance: [0.78, 0.83, 0.88, 0.93, 1],
      sustainedChance: [0, 0.3, 0.55, 0.75, 0.85],
      openingLesson: {durationMeters: 300, challengeChance: 0.65},
    },

    level2: {
      challengeProfileId: 'dustlands',
      sectorEndsMeters: ROUTE_TOPOLOGY.level2.sectorEnds,
      depotDistancesMeters: ROUTE_TOPOLOGY.level2.depotDistances,
      checkpointDistanceMeters: ROUTE_TOPOLOGY.level2.checkpointDistance,
      sectorThemeIds: ['dustlands', 'dustlands', 'dustlands', 'dustlands'],
      openingSpeedSource: {levelId: 'level1', distanceMeters: 500},
      speed: {startPxPerSecond: CAMPAIGN_SPEEDS.level2[0], endPxPerSecond: CAMPAIGN_SPEEDS.level2.at(-1),
        sectorStartsPxPerSecond: CAMPAIGN_SPEEDS.level2},
      // Difficulty steps up at each sector milestone; the final entry applies past the finish (Overdrive).
      densityTargets: [1, 1.15, 1.30, 1.45, 1.55],
      densityStretch: {intervalMeters: 600, increment: 0.02, maxIntervals: 3, intermediateDensityScale: 1.08},
      challengeChance: [0.78, 0.83, 0.88, 0.93, 1],
      sustainedChance: [0, 0.3, 0.55, 0.75, 0.85],
      openingLesson: {durationMeters: 300, challengeChance: 0.65},
    },
    level3: {
      challengeProfileId: 'reactor',
      sectorEndsMeters: ROUTE_TOPOLOGY.level3.sectorEnds,
      depotDistancesMeters: ROUTE_TOPOLOGY.level3.depotDistances,
      checkpointDistanceMeters: ROUTE_TOPOLOGY.level3.checkpointDistance,
      sectorThemeIds: ['reactor', 'reactor', 'reactor', 'reactor'],
      speed: {startPxPerSecond: CAMPAIGN_SPEEDS.level3[0], endPxPerSecond: CAMPAIGN_SPEEDS.level3.at(-1),
        sectorStartsPxPerSecond: CAMPAIGN_SPEEDS.level3},
      densityTargets: [1, 1.15, 1.30, 1.45, 1.55],
      densityStretch: {intervalMeters: 600, increment: 0.02, maxIntervals: 3, intermediateDensityScale: 1.08},
      challengeChance: [0.78, 0.83, 0.88, 0.93, 1],
      sustainedChance: [0, 0.3, 0.55, 0.75, 0.85],
      openingLesson: {durationMeters: 300, challengeChance: 0.65},
    },
    level4: {
      challengeProfileId: 'neon',
      sectorEndsMeters: ROUTE_TOPOLOGY.level4.sectorEnds,
      depotDistancesMeters: ROUTE_TOPOLOGY.level4.depotDistances,
      checkpointDistanceMeters: ROUTE_TOPOLOGY.level4.checkpointDistance,
      sectorThemeIds: ['neon', 'neon', 'neon', 'neon'],
      speed: {startPxPerSecond: CAMPAIGN_SPEEDS.level4[0], endPxPerSecond: CAMPAIGN_SPEEDS.level4.at(-1),
        sectorStartsPxPerSecond: CAMPAIGN_SPEEDS.level4},
      densityTargets: [1, 1.15, 1.30, 1.45, 1.55],
      densityStretch: {intervalMeters: 600, increment: 0.02, maxIntervals: 3, intermediateDensityScale: 1.08},
      challengeChance: [0.78, 0.83, 0.88, 0.93, 1],
      sustainedChance: [0, 0.3, 0.55, 0.75, 0.85],
      openingLesson: {durationMeters: 300, challengeChance: 0.65},
    },
    
    movingHazards: {
      eligibleLevelIds: ['level2'],
      eligibleModes: ['normal'],
      firstSector: 2,
      continuousLevelId: 'level1',
      continuousSectorNumbers: [2, 3],
      minimumPerWindow: 4,
      maximumPerWindow: 14,
      minimumEncounterSpacingMeters: 40,
      scheduleWindowFraction: 0.60,
      widthLanes: 1,
      travelLaneCount: 2,
      speedPxPerSecond: 76,
      forkliftWarningSeconds: 0.5,
      sweeperForwardSpeedRatio: 0.5,
      reactionMarginSeconds: 0.8,
      chicane: {rowOffset: 2, validation: 'potential-lanes'},
      centralTravelLaneCount: 1,
      recoverySecondsBySector: [1.8, 1.2, 1.2, 1.2],
    },
    // Street Sweepers overlay certified rows: their lane stays free of static obstacles while on screen.
    streetSweeper: {
      firstMeters: 120,
      // Each sweeper sector guarantees this many, alternating left (lanes 0-1) and right (lanes 2-3) halves.
      minimumPerSector: 2,
      // One sweeper clears the hauler's bumper line before the next one spawns.
      minimumGapMeters: 90,
      sectorLeadMeters: 40,
      spawnOffsetPx: -40,
      visualClearancePx: 24,
      contactWindowMeters: 25,
      wallLookbackMeters: 60,
    },
    sideObstacles: {
      minimumShare: 0.0225,
      maximumShare: 0.06,
      targetShare: 0.045,
      minimumSpanRows: 3,
      maximumSpanRows: 6,
      accountingWindowMeters: 600,
      chicaneStaggerRows: 1.5,
      chicaneTransitionExtraPx: 54,
    },
    track: {
      lanes: [0, 1, 2, 3],
      laneCentersPx: [86, 159, 232, 305],
      minRowSpacingPx: 140,
      rowGapMargin: {start: 1.3, end: 1.1},
      // Rows use an empty Swift Runner with maximum Precision Steering,
      // plus this reaction padding. Stock trucks are expected to fail, upgrade and retry.
      rowReactionSeconds: 0.5,
      maxLaneChangesPerRow: 1,
      betaSlots: [1 / 3, 1 / 2, 2 / 3],
      continuousBetaSlots: [1 / 3, 1 / 2, 2 / 3],
      // Owner rule: a lane that opens stays open 2..3 consecutive rows before it is threatened again.
      minimumClearEvents: {normal: 2, continuous: 2},
      maximumClearEvents: {normal: 3, continuous: 3},
      maximumClearHalfRows: 1,
      // Owner rule: no stretch longer than this planned distance may leave a middle lane (1 or 2) open on
      // every row; some row must leave only an outer lane (0 or 3) open, so the truck cannot shuttle 1<->2.
      edgeLaneDemandMeters: {normal: 160, continuous: 160},
      encounters: {
        candidateBudget: 8, recentLayouts: 4,
        densityRecovery: {
          candidateBudget: 16, occupancyWeight: 0.6,
          maximumEmptySecondsPerMeter: 163.84249332417437 / 6100,
          maximumLateEmptySecondsPerMeter: 128.8492515768585 / 5100,
        },
        pacingFamilies: {
          recovery: ['single_pressure', 'risk_reward'],
          normal: ['split_gate', 'side_squeeze', 'static_chicane', 'offset_pair', 'risk_reward'],
          pressure: ['offset_pair', 'narrow_corridor', 'side_squeeze', 'static_chicane', 'risk_reward'],
        },
        // Owner-approved steering demand: a "dash" forces at least dashPx of sideways travel
        // (about a two-lane switch) even for the laziest line through real hitboxes. Shares are
        // per-sector targets among non-recovery, non-mover encounters; selection preference only.
        steeringDemand: {dashPx: 37, sectorDashShare: [0.30, 0.45, 0.60, 0.75]},
      },
      routeValidation: {
        baseline: {id: 'swift-max-steering-empty', vehicleId: 'swift', loadFraction: 0,
          moduleIds: ['hand_precision']},
        // 'geometric': certify only that an open corridor exists (>= minimumClearancePx); no steering model.
        certification: 'connected',
        edgeMarginPx: 30, simulationHz: 120,
        sampleHz: [30, 60, 120], minimumClearancePx: 6, handlingCases: [0, 0.32],
        hazardClearDistancePx: 40,
      },
    },
    geometry: {
      roadLeftPx: 43,
      roadRightPx: 347,
      shipYpx: 684,
      spawnYpx: -35,
      logicalWidthPx: 390,
      logicalHeightPx: 844,
    },
    depot: {
      loopMeters: 450,
      // The Depot-side half stays clear for 50 m; the opposite half gets a staggered chicane.
      approachMeters: 50,
      approachChicaneCount: 3,
      exitMeters: 18,
      noticeMeters: 60,
      announcementMeters: 75,
      entranceRevealMeters: 28,
      resumeMeters: 25,
      dockingSeconds: 1.5,
      launchSeconds: 1,
      normalSkipBonusStep: 0.20,
      normalSkipBonusCap: 0.60,
      repair: {baseCoins: 30, sectorStepCoins: 15, priorRunRepairStepCoins: 20, hullRestored: 1},
      entrance: {width: 112, height: 180, mouthLeft: 10, mouthWidth: 87, mouthTop: 33, mouthHeight: 114},
    },
    spawning: {initialRowDelaySeconds: 0.6},
  },
  cargo: {
    singleCoinValue: 5,
    stackCoinValue: 5,
    stackChance: 0.2,
    freightChance: 0.04,
    pickupRowGap: {min: 1, max: 2},
    // Every sector (Continuous: every Depot interval) offers at least this many pickups outside Depot zones.
    minPickupsPerSector: 10,
    pickupCollisionRadiusPx: 30,
    pickupTriggerScale: 1.2,
    singleCoinMass: 1,
    singleCoinSlots: 1,
    freightMass: 2,
    pickupSlots: 1,
    // Cargo tiers step up with sector position (difficulty step), not theme; the final entry applies
    // past the finish (Overdrive). Step 0 carries no heavy freight.
    valuesBySectorStep: [
      [[5, 1]],
      [[10, 0.9], [5, 0.1]],
      [[20, 0.8], [10, 0.15], [5, 0.05]],
      [[25, 0.8], [20, 0.15], [10, 0.05], [5, 0.0]],
      [[30, 0.9], [25, 0.05], [20, 0.05], [10, 0.0], [5, 0.0]],
    ],
    hitValueLossFraction: 0.15,
  },
  cargoProgression: {
    // Provisional tuning. Rank 0 is the existing 11-capacity start; eight purchases reach 32.
    capacityByRank: [11, 13, 15, 19, 22, 25, 27, 30, 32],
    capacityUpgradePrices: [150, 250, 250, 350, 450, 600, 800, 1050],
    // Provisional hit-loss reduction; maximum reinforcement still loses at least some cargo.
    reinforcementMitigationByRank: [0, 0.15, 0.30, 0.45, 0.60],
    reinforcementUpgradePrices: [200, 325, 500, 750],
  },
  upgrades: {
    maxRank: 5,
    startingSlots: 2,
    maxSlots: 6,
    baseLevelCap: 2,
    levelCapMilestones: ['level1,sector2', 'level1,sector3', 'level1,sector4'],
    statCaps: {loadRelief: 0.9, insurance: 0.95},
    slotPurchases: {
      3: {milestone: 'level1,sector2', costCoins: 100},
      4: {milestone: 'level1,sector2', costCoins: 300},
      5: {milestone: 'level1,sector3', costCoins: 800},
      6: {milestone: 'level1,sector4', costCoins: 1600},
    },
    moduleUpgradeCostMultiplier: 1,
    modules: {
      hand_precision: {
        starter: false, unlock: null, price: 200, upgradeBase: 250,
        stat: 'handling', values: [0.10, 0.20, 0.30, 0.40, 0.50], drawback: null,
      },
      cargo_light: {
        starter: false, unlock: {levelId: 'level1', sector: 3, event: 'complete'}, price: 300, upgradeBase: 200,
        stat: 'loadRelief', values: [0.1, 0.2, 0.3, 0.4, 0.5],
        drawback: {stat: 'capacity', value: -2},
      },
      def_plating: {
        starter: false, unlock: {levelId: 'level2', sector: 4, event: 'complete'}, price: 400, upgradeBase: 500,
        stat: 'hull', values: [1, 1, 1],
        drawback: {stat: 'handling', value: -0.06},
      },
      coll_magnet: {
        starter: false, unlock: {levelId: 'level3', sector: 1, event: 'reach'}, price: 300, upgradeBase: 250,
        stat: 'magnet', values: [10, 20, 30, 40, 50], drawback: null,
      },
      util_impact_pulse: {
        starter: false, unlock: {levelId: 'level4', sector: 3, event: 'reach'}, price: 1000, upgradeBase: 300,
        stat: 'impactPulseSeconds', values: [0.2, 0.35, 0.5, 0.65, 0.8], drawback: null,
      },
      def_shield: {
        starter: false, unlock: {levelId: 'level2', sector: 4, event: 'complete'}, price: 750, upgradeBase: 350,
        stat: 'shieldCapacity', values: [1, 2, 3], drawback: null,
      },
      util_insurance: {
        starter: false, unlock: {levelId: 'level2', sector: 2, event: 'reach'}, price: 500, upgradeBase: 250,
        stat: 'insurance', values: [0.3, 0.45, 0.6, 0.75, 0.9], drawback: null,
      },
    },
  },
  vehicles: {
    standard: {
      baseEquipmentSlots: 2,
      baseStats: {capacity: 8, handling: 0, loadRelief: 0, hull: 2, magnet: 0, impactPulseSeconds: 0, shieldCapacity: 0, insurance: 0},
      blueprintCost: 0,
    },
    swift: {
      baseStats: {hull: 3},
      blueprintCost: 6,
      baseEquipmentSlots: 3,
      steeringMultiplier: 1.30,
      cargoCapacityOffset: -4,
      additionalSlotPurchases: {
        4: {milestone: 'level2', costCoins: 500},
        5: {milestone: 'level2,sector3', costCoins: 750},
        6: {milestone: 'level2,sector4', costCoins: 1000},
      },
    },
    armoured: {
      blueprintCost: 12,
      baseEquipmentSlots: 2,
      baseStats: {hull: 4, shieldCapacity: 1},
      cargoCapacityOffset: 5,
      steeringMultiplier: 0.8,
    },
    apex: {blueprintCost: 20, moduleBenefitMultiplier: 1.25, baseStats: {hull: 3}},
    apexUnlock: {milestone: 'level4,sector4', prerequisites: ['swift', 'armoured']},
  },
  progression: {
    levelIds: ['level1', 'level2', 'level3', 'level4'],
    firstPlayableLevel: 'level1',
    sectorsPerLevel: 4,
    checkpointSector: 3,
  },
  hazards: {
    staggerPx: 18,
    playerHalfWidthPx: 12 * 1.1 * 0.95,
    playerHalfHeightPx: 16,
    hullDamagePerHit: 1,
    // Elongated side structures are modular guardrails: a lethal entry lip, then a solid scrape wall.
    guardrail: {
      // Owner-approved (1 Nov): the diagonal at the inner edge of the entry lip spans one cab width.
      rampLateralPx: 24,
      // Tile length per unit of drawn width, taken from the approved chicane_* rasters (353x289,
      // 233x461, 335x321). The owner chose the entry ramp length to equal the entry tile length.
      entryLengthPerWidth: 289 / 353,
      midLengthPerWidth: 461 / 233,
      exitLengthPerWidth: 321 / 335,
    },
    collision: {
      energy_orb: {texture: 'hazard_energy_orb', width: 48, height: 48, hitX: 37, hitY: 40},
      rockSlab: {width: 60, height: 46, hitX: 40, hitY: 36, footprint: [[0, 0, 28, 20]]},
      wreckage: {width: 60, height: 58, hitX: 40, hitY: 41, footprint: [[-9, 0, 19, 25], [19, 10, 9, 15]]},
      signalCabinet: {width: 40, height: 58, hitX: 30, hitY: 43, footprint: [[0, 0, 18, 27]]},
      energySpine: {width: 24, height: 60, hitX: 22, hitY: 44, footprint: [[0, 0, 10, 28]]},
      coolingDrum: {width: 56, height: 60, hitX: 38, hitY: 44, footprint: [[0, 0, 26, 28]]},
      reactorShield: {width: 64, height: 38, hitX: 42, hitY: 33, footprint: [[0, 0, 30, 17]]},
      // Free-standing lane obstacles drawn from the approved Vent and Service Boom art.
      vent: {width: 40, height: 60, hitX: 30, hitY: 44, footprint: [[0, 0, 18, 28]]},
      ventGrille: {width: 42, height: 58, hitX: 32, hitY: 43, footprint: [[0, 0, 19, 27]]},
      boomLift: {width: 38, height: 64, hitX: 29, hitY: 46, footprint: [[0, 0, 17, 30]]},
      dustConduit: {width: 54, height: 46, roadside: true, anchorX: 64, elongated: true, scenery: 'pipes'},
      wreckPlatform: {width: 54, height: 60, roadside: true, anchorX: 64, elongated: true, scenery: 'loading'},
      neonConduit: {width: 54, height: 46, roadside: true, anchorX: 64, elongated: true, scenery: 'pipes'},
      signGantry: {width: 54, height: 54, roadside: true, anchorX: 64, elongated: true, scenery: 'utility'},
      reactorPipe: {width: 54, height: 46, roadside: true, anchorX: 64, elongated: true, scenery: 'pipes'},
      containment: {width: 54, height: 64, roadside: true, anchorX: 64, elongated: true, scenery: 'loading'},
      loadingPlatform: {width: 54, height: 54, roadside: true, scenery: 'loading', anchorX: 64, elongated: true},
      pipeAssembly: {width: 54, height: 46, roadside: true, scenery: 'pipes', anchorX: 64, elongated: true},
      roadsideMachine: {width: 54, height: 60, roadside: true, scenery: 'vent', anchorX: 64, elongated: true},
      cargoDock: {width: 54, height: 64, roadside: true, scenery: 'loading', anchorX: 64, elongated: true},
      serviceBoom: {width: 54, height: 38, roadside: true, scenery: 'utility', anchorX: 64, elongated: true},
      sideRail: {width: 54, height: 54, roadside: true, scenery: 'pipes', anchorX: 64, elongated: true},
      sideWall: {width: 54, height: 54, roadside: true, scenery: 'loading', anchorX: 64, elongated: true},
      divider: {width: 64, height: 30, hitX: 42, hitY: 29, footprint: [[0, 0, 30, 13]]},
      container: {width: 56, height: 70, hitX: 38, hitY: 46, footprint: [[0, 0, 26, 30]]},
      machinery: {width: 60, height: 58, hitX: 40, hitY: 41, footprint: [[-9, 0, 19, 25], [19, 10, 9, 15]]},
      barrier: {texture: 'cargo_hazard', width: 62, height: 50, hitX: 40, hitY: 40, footprint: [[0, 0, 28, 24]]},
      bollard: {width: 34, height: 62, hitX: 26, hitY: 46, footprint: [[0, 0, 14, 30]]},
      gate: {width: 68, height: 34, hitX: 42, hitY: 32, footprint: [[0, 0, 30, 16]]},
      // Street Sweeper: a lane-wide truck driving up its lane; excluded from the static row envelope.
      sweeper: {
        texture: 'hazard_sweeper', height: 112,
        collisionInsetPx: 6,
      },
      forklift: {
        texture: 'hazard_forklift', widthLanes: 1, height: 68,
        collisionInsetPx: 5,
      },
    },
  },
  physics: {
    steering: {
      maxLateralSpeedPxPerSecond: 351,
      maxLateralAccelerationPxPerSecondSquared: 1440,
      brakingDistanceFactor: 2,
      fullLoadPenalty: 0.44,
      minimumResponse: 0.52,
      laneChangeSimulationHz: 480,
      laneChangeMaximumSeconds: 5,
    },
    magnet: {pullSpeedPxPerSecond: 120, reachAboveShipPx: 140, reachBelowShipPx: 40    },
    collision: {
      cargoHalfHeightPx: 40,
      closeCall: {minimumGapPx: 5, maximumGapPx: 20, bonusStepPercent: 5, maximumBonusPercent: 50},
      hitInvulnerabilitySeconds: 1.15,
      shieldInvulnerabilitySeconds: 0.6,
      crashResultDelayMs: 750,
    },
    blueprint: {
      // Road Blueprint budget per sector position (difficulty step); the final entry is Overdrive.
      spawnBudgetsBySectorStep: [0, 0, 1, 1, 0],
      pickupAmount: 1,
      spawnChance: 0.4,
      unlockMilestone: 'level1,sector3',
    },
  },
  presentation: {
    cosmeticPriceCoins: {'white-blue': 750, 'black-red': 750, 'yellow-blue': 750},
    trimChoices: ['white-blue', 'black-red', 'yellow-blue'],
    defaultOwnedTrim: 'default',
  },
};

balance.routes.level1.sectorStartsMeters = [0, ...balance.routes.level1.sectorEndsMeters.slice(0, -1)];
balance.routes.level1.finishDistanceMeters = ROUTE_TOPOLOGY.level1.finishDistance;
balance.routes.level2.sectorStartsMeters = [0, ...balance.routes.level2.sectorEndsMeters.slice(0, -1)];
balance.routes.level2.finishDistanceMeters = ROUTE_TOPOLOGY.level2.finishDistance;
balance.routes.level3.sectorStartsMeters = [0, ...balance.routes.level3.sectorEndsMeters.slice(0, -1)];
balance.routes.level3.finishDistanceMeters = ROUTE_TOPOLOGY.level3.finishDistance;
balance.routes.level4.sectorStartsMeters = [0, ...balance.routes.level4.sectorEndsMeters.slice(0, -1)];
balance.routes.level4.finishDistanceMeters = ROUTE_TOPOLOGY.level4.finishDistance;
balance.routes.track.laneSpacingPx =
  balance.routes.track.laneCentersPx[1] - balance.routes.track.laneCentersPx[0];
balance.routes.track.routeValidation.loadedCapacity = balance.cargoProgression.capacityByRank.at(-1);
balance.routes.track.routeValidation.minX =
  balance.routes.geometry.roadLeftPx + balance.routes.track.routeValidation.edgeMarginPx;
balance.routes.track.routeValidation.maxX =
  balance.routes.geometry.roadRightPx - balance.routes.track.routeValidation.edgeMarginPx;

export const GAME_BALANCE = deepFreeze(balance);
