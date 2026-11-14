import Phaser from 'phaser';
import runMusicUrl from '@art-direction/BG_Music.mp3?url';
import endlessMusicUrl from '@art-direction/Sunny_Coastal_Run.mp3?url';
import logoUrl from '@art-direction/GameLogo.svg?url';
import {BUILD_ID} from '../data/build.js';
import {loadProfile, saveProfile} from '../core/save.js';
import {DEPOT_APPROACH_HINT_M, HINTS, hintForEvent, markHintSeen} from '../core/onboarding.js';
import {createRunContext, HELP_SECTIONS, resultTip} from '../core/playerGuidance.js';
import {
  BP_TO_COINS, METERS_PER_PIXEL, continuousStageAtDistance, routeFinishDistance, SLOT_MAX,
  routeSpeedAtDistance, MAX_TRACK_SPEED, SINGLE_COIN_PAYOUT, steeringMultiplier,
  upgradeCost,
} from '../core/economy.js';
import {
  bankCargo, bankingQuote, createRunEconomy, DEPOT_ECONOMY, continuousQuote, passContinuousDepot,
  purchaseRepair, repairOffer, riskBonusPercent, runEconomySummary,
  settleRun, skipDepot, awardCloseCall, closeCallBonusPercent,
} from '../core/depotEconomy.js';
import {checkpointDistance, isLevelUnlocked, isRunStartAvailable, recordSectorProgress} from '../core/progression.js';
import {adjustDeveloperCoins, isDeveloperRun, markDeveloperRun} from '../core/developerRuns.js';
import {DebugManager} from '../core/DebugManager.js';
import {awardBlueprint, blueprintEligible, createBlueprintRun, releaseDeferredBlueprints} from '../core/blueprints.js';
import {
  addMilestones,
  buyModule,
  cargoCapacityStatus,
  CARGO_CAPACITY_ID,
  equipModule,
  formatStat,
  loadoutStats,
  depotMilestoneId,
  milestonesForDistance,
  milestoneUnlocksUpgrades,
  moduleLevelCap,
  moduleStatus,
  nextSlotOffer,
  reinforcedCargoStatus,
  unequipModule,
  unlockNextSlot,
  upgradeCargoCapacity,
  upgradeModule,
  upgradeReinforcedCargo,
} from '../core/modules.js';
import {advanceSteering, KEYBOARD_BRAKE_SECONDS} from '../core/steering.js';
import {advanceMagnet} from '../core/magnet.js';
import {
  buyVehicleTrim, purchaseVehicle, selectVehicle, selectVehicleTrim, vehicleStatus,
} from '../core/vehicles.js';
import {cargoOffer, cargoTotals, collectCargo, createCargoTrail} from '../core/cargo.js';
import {
  HAZARD_ROW_ENVELOPE_PX, guardrailContact, hazardDefinition, hazardGeometry, hazardHits, hazardX,
  isGuardrail, LANE_CENTERS, movingHazardOffset, canonicalMotionAge, hazardScrollScale,
} from '../core/hazards.js';
import {resolveHazardCollision, advanceNearMiss, cargoPickupHits} from '../core/collision.js';
import {
  addHaulerPreview,
  addHudBacking,
  addIndustrialPanel,
  addModuleIcon,
  addSteelControl,
  buildIndustrialRoad,
  fitRoadToView,
  colorText,
  createDepotEntrance,
  createDepotFacility,
  createGuardrailStructure,
  depotFacilityHeight,
  createSilhouetteShadow,
  syncSilhouetteShadow,
  createBarrierLights,
  createHaulerEffects,
  playImpactSparks,
  playEnergyOrbSparks,
  createIndustrialTextures,
  stopHaulerExhaust,
  preloadStandardHauler,
  preloadSwiftRunner,
  preloadArmouredTransport,
  preloadGarageDisplayArt,
  preloadGarageUpgradeArt,
  GARAGE_UPGRADE_ART,
  preloadObstacleArt,
  preloadCollectibleArt,
  preloadDepotArt,
  MODULE_CAPTIONS,
  garageUpgradeBenefit,
  PALETTE,
  SPRITE_ART_SCALE,
  scaleSpriteArt,
  syncDepotEntrance,
  syncBarrierLights,
  syncCargoPickupVisuals,
  syncGuardrailBeacon,
  syncGuardrailSparks,
  syncHaulerEffects,
  syncBlueprintVisuals,
  cargoPickupTexture,
  cargoPickupGlowTexture,
  vehicleTint,
  vehicleTexture,
  vehicleTrimName,
  addGoldPreviewSparkles,
  syncSectorRoad,
  hazardTexture,
  preloadNeonVisuals,
} from '../rendering/industrial.js';
import {ROAD_LEFT, ROAD_RIGHT, SHIP_Y, SPAWN_Y} from '../data/route.js';
import {IMPLEMENTED_LEVELS, sectorAtDistance} from '../core/sectors.js';
import {ENVIRONMENT_VISUALS, HAZARD_READABILITY, NEON_SHOULDER_SIGNS, resolveVisualTheme} from '../data/environments.js';
import {
  createRoadEnvironment, destroyRoadEnvironment, lightingForSector, setRoadLighting,
  setRoadEnvironmentVisible, startRoadBurst, stopRoadBurst, updateRoadEnvironment,
} from '../rendering/roadEnvironment.js';
import {adaptiveCardMetrics, advanceMenuScroll, managementLayout, measureMenuContent, MENU_SPACING, peekingCardMetrics, responsiveViewport, squareGridMetrics, upgradeTileContentMetrics} from '../core/menuLayout.js';
import {DEPOT_RULES, nextDepotAfter, depotEntryAllowed, depotDockingStart, depotMotionStep, depotWorldY} from '../core/depots.js';
import {GAME_BALANCE} from '../data/gameBalance.js';
import {balance} from '../data/balance.js';
import {RunFeedback} from '../rendering/runFeedback.js';
import {RouteVisualPool, routeImage, releaseRouteVisual} from '../rendering/routeVisualPool.js';
import {IMPLEMENTED_VEHICLE_IDS, VEHICLES} from '../data/catalog.js';
import {
  CARGO_COLLISION_DISTANCE_PX,
  depotResumeFirstDistance,
  hazardsBeforeDepot,
} from '../core/trackGenerator.js';
import {createRouteStream, ROUTE_STREAM_LATE_ROW_MS, warmRouteStreamWorkers} from '../core/routeStream.js';

const VERTICAL_HIT_PX = GAME_BALANCE.physics.collision.cargoHalfHeightPx;
const levelDisplayName = levelId => ({
  level1: 'LEVEL 1',
  level2: 'LEVEL 2',
  level3: 'Level 3: Reactor Zone',
  level4: 'Level 4: Neon Gridway',
}[levelId] ?? levelId.toUpperCase());
const W = GAME_BALANCE.routes.geometry.logicalWidthPx;
const H = GAME_BALANCE.routes.geometry.logicalHeightPx;
const STRIPE_GAP = 78;
const TRUCK_CARD_MIN_HEIGHT = 196;
const STRIPES_PER_COLUMN = 12;
const HOLD_FULL_TEXT = 'Load limit reached. Better cargo can replace cheaper cargo if it fits.\n' +
  'Bank at a Depot to secure its value.';
const TOAST_STYLES = {
  warning: {fill: 0x2a1d0c, stroke: 0xf2ad3f, color: '#ffe1a0', duration: 2600, priority: 1},
  error: {fill: 0x2a1d0c, stroke: 0xf2ad3f, color: '#ffe1a0', duration: 3600, priority: 3},
  hint: {fill: 0x0c2230, stroke: 0x66ccd2, color: '#d2f8ff', duration: 3600, priority: 2},
};
const CRASH_RESULT_DELAY_MS = GAME_BALANCE.physics.collision.crashResultDelayMs;
const GAMEPLAY_VIEW_PHASES = new Set([
  'running', 'docking', 'depot', 'crashing', 'paused', 'pauseEndConfirm',
  'finishing', 'resumeCountdown', 'resumeTransition', 'tutorialPaused',
  'tutorialTransition', 'tutorialRewardSaveError',
]);
const BASE_HAZARD_COIN_LOSS = GAME_BALANCE.cargo.hitValueLossFraction;
const WALL_GRIND_REPULSION_PX = 1.5;
const FAMILY_LABELS = {
  engine: 'Engine',
  cargo: 'Cargo',
  defence: 'Defence',
  collection: 'Collection',
  handling: 'Handling',
  utility: 'Utility',
};
const UPGRADE_GRID_ORDER = Object.freeze([
  Object.freeze({kind: 'capacity', id: 'capacity'}),
  Object.freeze({kind: 'module', id: 'hand_precision'}),
  Object.freeze({kind: 'module', id: 'coll_magnet'}),
  Object.freeze({kind: 'module', id: 'cargo_light'}),
  Object.freeze({kind: 'module', id: 'def_plating'}),
  Object.freeze({kind: 'module', id: 'util_insurance'}),
  Object.freeze({kind: 'module', id: 'def_shield'}),
  Object.freeze({kind: 'module', id: 'util_impact_pulse'}),
]);
export class RoutePrototypeScene extends Phaser.Scene {
  constructor() {
    super({key: 'RoutePrototypeScene'});
  }

  preload() {
    this.load.audio('cargo_run_music', runMusicUrl);
    this.load.audio('cargo_endless_music', endlessMusicUrl);
    this.load.image('hazardous_haul_logo', logoUrl);
    preloadStandardHauler(this);
    preloadSwiftRunner(this);
    preloadArmouredTransport(this);
    preloadGarageDisplayArt(this);
    preloadGarageUpgradeArt(this);
    preloadObstacleArt(this);
    preloadCollectibleArt(this);
    preloadDepotArt(this);
    preloadNeonVisuals(this);
  }

  create() {
    let saveWarning = null;
    this.profile = loadProfile(message => { saveWarning = message; });
    this.stats = loadoutStats(this.profile, this.profile.selectedVehicleId);
    this.phase = 'menu';
    this.feedback = new RunFeedback(this);
    this.feedback.setMusicBuffer?.(this.cache?.audio?.get?.('cargo_run_music'));
    this.overlayObjects = [];
    this.objects = [];
    this.shoulderSigns = [];
    this.depotFacilities = [];
    this.cargoIndicators = [];
    createIndustrialTextures(this);
    this.routeVisualPool = new RouteVisualPool(this);
    warmRouteStreamWorkers();
    this.buildWorld();
    this.viewportBackdrop = this.add.graphics().setScrollFactor(0).setDepth(-1000);
    this.syncViewportBackdrop();
    this.createTransientTextPool();
    this._scratchPlayerRect = new Phaser.Geom.Rectangle();
    this._scratchDepotRect = new Phaser.Geom.Rectangle();
    this._scratchIntersectionRect = new Phaser.Geom.Rectangle();
    this.events.once('shutdown', () => {
      this.trackStream?.destroy?.();
      this.trackStream = null;
      this.takeRunStream(null, null, null);
      destroyRoadEnvironment(this.roadEnvironment, this);
      this.removeObjects();
      this.removeDepotFacilities();
      this.routeVisualPool.destroy();
    });
    this.handleViewportResize = this.handleViewportResize.bind(this);
    this.scale.on('resize', this.handleViewportResize);
    this.events.once('shutdown', () => this.scale.off('resize', this.handleViewportResize));
    this.handleViewportResize(this.scale.gameSize);

    this.input.on('pointerdown', pointer => {
      if (!this.initialInputType) this.initialInputType = pointer.wasTouch ? 'touch' : 'mouse';
      this.beginMenuScroll(pointer);
      this.beginSteering(pointer);
    });
    this.input.on('pointermove', pointer => {
      this.moveMenuScroll(pointer);
      this.moveSteering(pointer);
    });
    this.input.on('pointerup', pointer => {
      this.handlePointerUp(pointer);
    });
    this.input.on('gameout', pointer => {
      this.endMenuScroll(pointer);
      this.steeringPointerId = null;
    });
    this.input.on('wheel', (pointer, _objects, _deltaX, deltaY) => {
      const point = this.menuPointerPoint(pointer);
      if (this.menuScrollContainer && point.y >= this.menuScrollTop &&
          point.y <= this.menuScrollBottom) this.scrollMenuBy(deltaY);
    });
    this.steeringKeys = this.input.keyboard?.addKeys('A,D,LEFT,RIGHT');
    const initialKeyHandler = () => {
      if (!this.initialInputType) this.initialInputType = 'keyboard';
    };
    this.input.keyboard?.on?.('keydown', initialKeyHandler);
    this.events.once('shutdown', () => this.input.keyboard?.off?.('keydown', initialKeyHandler));
    const pauseKeyHandler = event => this.handlePauseKey(event);
    this.input.keyboard?.on?.('keydown-SPACE', pauseKeyHandler);
    this.events.once('shutdown', () => this.input.keyboard?.off?.('keydown-SPACE', pauseKeyHandler));
    this.initializeUrlDebug(globalThis.location?.search ?? '');
    if (saveWarning) this.showToast(saveWarning, 'error');
  }

  initializeUrlDebug(search) {
    try {
      this.debugManager = new DebugManager(search);
    } catch (error) {
      console.error('Invalid URL debug configuration', error);
      this.showMenu();
      this.showToast(error.message, 'error');
      return;
    }
    this.profile = this.debugManager.profileForSession(this.profile);
    this.stats = loadoutStats(this.profile, this.profile.selectedVehicleId);
    const {flags} = this.debugManager;
    if (flags.warp || flags.bot || flags.god || flags.fast) {
      this.startRun('developer', flags.warp?.levelId ?? 'level1', 'normal', {
        sectorNumber: flags.warp?.sectorNumber ?? 1, vehicleId: this.profile.selectedVehicleId,
      });
    } else if (flags.unlockAll) this.showGarage('', false, 'upgrades');
    else this.showMenu();
  }

  beginRookieTrial(inputType = this.initialInputType) {
    this.startRun('beginning', 'level1', 'normal', null, {tutorial: true});
    if (!this.tutorialRun) return;
    this.initialInputType = inputType;
    this.tutorialCheckpointIndex = 0;
    this.tutorialBlueprintsCollected = 0;
    this.tutorialSpeed = 0;
    this.showTutorialCheckpoint(0);
  }

  createRookieTrialStream(firstDistance = 0) {
    const distances = [...Array.from({length: 51}, (_, index) => index * 10), 75]
      .filter(distance => distance >= firstDistance)
      .sort((a, b) => a - b)
      .filter((distance, index, values) => index === 0 || distance !== values[index - 1]);
    const hazardLanes = new Map([[300, 0], [360, 3], [420, 1], [470, 2]]);
    const pickups = new Map([[75, [1, 15]], [280, [1, 10]], [390, [2, 10]], [450, [3, 10]]]);
    let index = 0;
    return {
      nextRow: () => {
        if (index >= distances.length) return null;
        const plannedDistance = distances[index];
        const nextDistance = distances[index + 1] ?? plannedDistance + 10;
        index++;
        const hazardLane = hazardLanes.get(plannedDistance);
        const lanes = hazardLane === undefined ? [] : [hazardLane];
        const hazards = lanes.map(lane => ({kind: 'divider', lane, offsetX: 0, offsetY: 0,
          placement: 'alpha', sideObstacle: false}));
        const safeLanes = [0, 1, 2, 3].filter(lane => !lanes.includes(lane));
        return {plannedDistance, spacingPx: (nextDistance - plannedDistance) / METERS_PER_PIXEL,
          hazards, intermediates: [], hazardLanes: lanes, safeLanes, cargoLanes: safeLanes,
          safePickupLanes: safeLanes,
          pickups: pickups.has(plannedDistance)
            ? [{lane: pickups.get(plannedDistance)[0], kind: 'coin',
              value: pickups.get(plannedDistance)[1], mass: 1, slots: 1}] : [],
          tutorialBlueprint: Math.abs(plannedDistance - 150) < 1e-6,
          emitted: true, lifetime: {clearedAtDistance: null}, family: 'rookie_trial',
          encounterId: `rookie-trial:${plannedDistance}`, phase: 0, sequenceLength: 1};
      },
      prepareDepotReset() {},
      resetAfterDepot() {},
      destroy() {},
    };
  }

  showTutorialCheckpoint(index) {
    const checkpoints = [
      {title: '// COMMENCING TRANSIT: ROOKIE TRIAL //',
        body: 'Steer left and right across active highway lanes.\n\nPC: Mouse, A / D, or Arrow Keys\nTouch: drag horizontally',
        action: '[ SPACEBAR / CLICK TO ROLL ]'},
      {title: '// CARGO + BLUEPRINT DETECTED //',
        body: 'Drive over the crate at 75 m to secure cargo. Collect the Blueprint at 150 m to unlock advanced rigs in the Garage. Cargo and Blueprints are kept when you reach the Depot.',
        action: '[ COLLECT & CONTINUE ]'},
      {title: '// HAZARD ADVISORY: CARGO INERTIA //',
        body: 'Mass is real: trailing cargo weighs down your steering rack. Heavy loads turn sluggishly and swing wide. Anticipate turns early.\n\nPro Tip: Precision Steering restores sharp control under load.',
        action: '[ ACKNOWLEDGE & NAVIGATE ]'},
      {title: '// DEPOT LOCATED //',
        body: 'Pull right into the green Depot bay to secure your payload. This is the only way to keep the value you hauled.',
        action: '[ PULL RIGHT TO SECURE PAYLOAD ]'},
    ];
    const checkpoint = checkpoints[index];
    if (!checkpoint) return;
    this.tutorialCheckpointIndex = index;
    this.tutorialPopupElapsed = 0;
    this.phase = 'tutorialPaused';
    this.feedback?.suspend('tutorialCheckpoint', {music: false});
    this.clearOverlay();
    this.overlayObjects.push(this.add.rectangle(W / 2, H / 2, W, H, 0x07121d, 0.2).setDepth(110));
    const title = this.addLabel(checkpoint.title, W / 2, 0, 14, colorText(PALETTE.goldLight), 292);
    title.setDepth(113);
    const body = this.addLabel(checkpoint.body, W / 2, 0, 14, '#f1f8ff', 292).setLineSpacing(4);
    body.setDepth(113);
    const buttonHeight = 52;
    const panelHeight = Math.ceil(18 + title.height + 12 + body.height + 16 + buttonHeight + 18);
    const top = H / 2 - panelHeight / 2;
    title.setY(top + 18);
    body.setY(title.y + title.height + 12);
    this.overlayObjects.push(addSteelControl(this, W / 2, H / 2, 326, panelHeight,
      PALETTE.edge, PALETTE.gold, 111).setAlpha(0.75));
    this.addButton(checkpoint.action, body.y + body.height + 16 + buttonHeight / 2,
      () => this.resumeTutorialCheckpoint(),
      {width: 286, height: buttonHeight, size: 13, fill: PALETTE.cyan,
        color: '#06151d', depth: 114});
    this.fadeOverlayIn();
  }

  resumeTutorialCheckpoint() {
    if (!this.tutorialRun || this.phase !== 'tutorialPaused') return;
    this.phase = 'tutorialTransition';
    this.fadeOverlayOut(() => {
      this.tutorialCheckpointIndex += 1;
      this.phase = 'running';
      this.hudContainer?.setVisible(true);
      this.feedback?.resume('tutorialCheckpoint');
    });
  }

  checkTutorialCheckpoint() {
    if (!this.tutorialRun || this.phase !== 'running') return false;
    const triggerDistances = [50, 200, 225];
    const trigger = triggerDistances[this.tutorialCheckpointIndex - 1];
    if (trigger === undefined || this.distance < trigger || this.tutorialPopupElapsed < 5) return false;
    this.showTutorialCheckpoint(this.tutorialCheckpointIndex);
    return true;
  }

  persistProfile(profile) {
    return this.debugManager ? this.debugManager.persist(profile, saveProfile) : saveProfile(profile);
  }

  handleViewportResize(gameSize) {
    if (!gameSize || !Number.isFinite(gameSize.width) || !Number.isFinite(gameSize.height)) return;
    const viewport = responsiveViewport(gameSize.width, gameSize.height, W);
    this.viewportScale = viewport.zoom;
    this.viewportWorldWidth = viewport.worldWidth;
    this.viewportWorldHeight = viewport.worldHeight;
    this.menuHeight = viewport.worldHeight;
    this.syncResponsiveCamera();
    if (this.screenRenderer && !this.resizingMenu && !GAMEPLAY_VIEW_PHASES.has(this.phase)) {
      this.resizingMenu = true;
      try {
        this.screenRenderer();
      } finally {
        this.resizingMenu = false;
      }
    }
  }

  syncResponsiveCamera() {
    if (!this.cameras?.main || !Number.isFinite(this.viewportWorldWidth) ||
        !Number.isFinite(this.viewportWorldHeight)) return;
    const screenWidth = this.scale.width;
    const screenHeight = this.scale.height;
    const gameplay = GAMEPLAY_VIEW_PHASES.has(this.phase);
    const zoom = gameplay ? Math.min(screenWidth / W, screenHeight / H, 1.12) *
      (this.roadEnvironment?.zoom.factor ?? 1) : this.viewportScale;
    const viewHeight = screenHeight / zoom;
    const worldCenterY = gameplay ? H / 2 : viewHeight / 2;
    this.cameras.main.setZoom(zoom);
    this.cameras.main.setScroll(W / 2 - screenWidth / 2, worldCenterY - screenHeight / 2);
    if (this.hudContainer) {
      const hudScale = Math.min(screenWidth / W, 1.12);
      // Cancel camera zoom/origin so telemetry stays screen-pinned even during sector bursts.
      this.hudContainer.setScale(hudScale / zoom).setPosition(
        screenWidth / 2 * (1 - 1 / zoom) + (screenWidth - W * hudScale) / (2 * zoom),
        screenHeight / 2 * (1 - 1 / zoom));
      this.hudBacking.setDisplaySize(screenWidth / hudScale, 78);
    }
    this.syncViewportBackdrop();
    this.syncRoadBleed(screenWidth, screenHeight);
  }

  /** Preserve the complete portrait course; unused screen width stays plain rather than tiling scenery. */
  syncRoadBleed(screenWidth, screenHeight) {
    if (!this.roadSurface || !this.roadFlanks?.length) return;
    this.roadFlanks.forEach(flank => flank.setVisible(false));
    this.subRoad?.setSize(W, H + 64);
    const zoom = Math.min(screenWidth / W, screenHeight / H, 1.12) * ENVIRONMENT_VISUALS.burstZoom;
    const bleedX = Math.max(8, Math.ceil((screenWidth / zoom - W) / 2) + 8);
    const bleedY = Math.max(0, Math.ceil((screenHeight / zoom - H) / 2) + 8);
    if (this.roadBleed?.x === bleedX && this.roadBleed?.y === bleedY) return;
    this.roadBleed = {x: bleedX, y: bleedY};
    fitRoadToView([this.roadSurface, this.dustSurface], this.roadFlanks, W, H, bleedX, bleedY);
  }

  syncViewportBackdrop() {
    const graphics = this.viewportBackdrop;
    const width = this.scale?.width;
    const height = this.scale?.height;
    const gameplay = ['running', 'docking', 'depot', 'crashing'].includes(this.phase);
    if (!graphics || !Number.isFinite(width) || !Number.isFinite(height) ||
        (this.viewportBackdropSize?.width === width && this.viewportBackdropSize?.height === height &&
          this.viewportBackdropSize?.gameplay === gameplay)) return;
    this.viewportBackdropSize = {width, height, gameplay};
    if (gameplay) {
      graphics.clear().fillStyle(0x080c14, 1).fillRect(0, 0, width, height);
      return;
    }
    const stageWidth = Math.min(width, W * Math.min(width / W, height / H, 1.12));
    const stageLeft = (width - stageWidth) / 2;
    const stageRight = stageLeft + stageWidth;
    graphics.clear().fillStyle(0x101923, 1).fillRect(0, 0, width, height);
    graphics.fillStyle(0x151f2a, 0.72);
    for (let x = 0; x < width; x += 96) {
      if (x + 1 > stageLeft && x < stageRight) continue;
      graphics.fillRect(x, 0, 1, height);
      if (x + 34 < stageLeft || x > stageRight) {
        graphics.lineStyle(1, 0x273643, 0.45).lineBetween(x + 12, 0, x + 12, height);
        for (let y = 44; y < height; y += 132) {
          graphics.strokeRect(x + 22, y, 22, 38);
        }
      }
    }
    graphics.lineStyle(2, 0x273643, 0.8)
      .lineBetween(stageLeft, 0, stageLeft, height)
      .lineBetween(stageRight, 0, stageRight, height);
  }

  menuMetrics() {
    return managementLayout(this.menuHeight ?? H);
  }

  setScreenRenderer(renderer) {
    this.screenRenderer = renderer;
  }

  buildWorld() {
    const road = buildIndustrialRoad(this, {
      width: W,
      height: H,
      stripeGap: STRIPE_GAP,
      stripesPerColumn: STRIPES_PER_COLUMN,
    });
    this.roadSurface = road.surface;
    this.dustSurface = road.dust;
    this.roadFlanks = road.flanks ?? [];
    this.subRoad = road.subRoad;
    this.lines = road.lines;
    const finishGraphic = this.add.graphics();
    const finishLeft = ROAD_LEFT - W / 2;
    for (let tile = 0; tile < 16; tile++) {
      finishGraphic.fillStyle(tile % 2 ? 0xf1f8ff : 0x142331, 1);
      finishGraphic.fillRect(finishLeft + tile * 19, -9, 19, 9);
      finishGraphic.fillStyle(tile % 2 ? 0x142331 : 0xf1f8ff, 1);
      finishGraphic.fillRect(finishLeft + tile * 19, 0, 19, 9);
    }
    this.finishLabel = this.add.text(0, -29, 'LEVEL 1 FINISH', this.textStyle(11, '#f1f8ff'))
      .setOrigin(0.5);
    this.finishLine = this.add.container(W / 2, 0, [finishGraphic, this.finishLabel])
      .setDepth(4).setVisible(false);
    this.depotEntrance = createDepotEntrance(this);
    this.ship = this.add.image(W / 2, SHIP_Y, 'cargo_ship').setDepth(8);
    this.haulerEffects = createHaulerEffects(this);
    this.roadEnvironment = createRoadEnvironment(this, road, W, H);
    this.shieldRing = this.add.circle(W / 2, SHIP_Y, 42)
      .setStrokeStyle(3, PALETTE.cyanLight, 0.85).setFillStyle(PALETTE.cyanLight, 0.08)
      .setDepth(8.5).setVisible(false);
    for (let i = 0; i < 4; i++) {
      const crate = this.add.image(W / 2, SHIP_Y + 46 + i * 29, 'cargo_trailer').setDepth(7).setVisible(false);
      this.cargoIndicators.push(crate);
    }
    this.buildHud();
    // Keep notices below the ship so they cannot hide upcoming hazards or block steering.
    this.toastBack = this.add.rectangle(0, 0, 350, 46, 0x2a1d0c, 0.82);
    this.toastText = this.add.text(0, 0, '', {...this.textStyle(11, '#ffe1a0'), lineSpacing: 3}).setOrigin(0.5);
    this.toast = this.add.container(W / 2, 805, [this.toastBack, this.toastText]).setDepth(21).setAlpha(0).setVisible(false);
    this.toastPriority = 0;
    this.hintQueue = [];
    this.holdFullCooldown = 0;

    const burst = {lifespan: 480, scale: {start: 1.1, end: 0}, alpha: {start: 1, end: 0}, emitting: false};
    this.coinBurst = this.add.particles(0, 0, 'cargo_spark', {
      ...burst, speed: {min: 70, max: 210}, tint: [PALETTE.gold, PALETTE.goldLight, PALETTE.goldDark], blendMode: 'ADD',
    }).setDepth(9);
    this.debris = this.add.particles(0, 0, 'cargo_spark', {
      ...burst, lifespan: 620, speed: {min: 120, max: 330}, gravityY: 420, tint: [PALETTE.hazard, PALETTE.hazardLight, PALETTE.steelLight],
    }).setDepth(9);
    this.setWorldVisible(false);
  }

  textStyle(fontSize = 17, color = '#f1f8ff') {
    return {fontFamily: 'Arial, sans-serif', fontSize: `${fontSize}px`, color, align: 'center'};
  }

  createTransientTextPool() {
    this.transientTextPool = [];
    this.transientTextEntries = new WeakMap();
    for (let index = 0; index < 32; index++) {
      const text = this.add.text(0, 0, '', {
        ...this.textStyle(18),
        fontStyle: 'bold',
        stroke: '#08101f',
        strokeThickness: 4,
      }).setOrigin(0.5).setDepth(22);
      const icon = this.add.image(0, 0, 'cargo_coin').setVisible(false);
      const container = this.add.container(0, 0, [icon, text]).setDepth(22).setVisible(false);
      const entry = {container, text, icon, active: false, persistent: false, lastUsed: 0};
      this.transientTextPool.push(entry);
      this.transientTextEntries.set(container, entry);
    }
    this.transientTextUseCount = 0;
  }

  acquireTransientText(x, y, message, color, size, currency = false, persistent = false, depth = 22) {
    let entry = null;
    for (const candidate of this.transientTextPool) {
      if (!candidate.active) {
        entry = candidate;
        break;
      }
      if (!candidate.persistent && (!entry || candidate.lastUsed < entry.lastUsed)) entry = candidate;
    }
    if (!entry || (entry.active && entry.persistent)) {
      throw new Error('Transient text pool is exhausted by persistent labels');
    }
    if (entry.active) this.releaseTransientText(entry.container);
    entry.active = true;
    entry.persistent = persistent;
    entry.lastUsed = ++this.transientTextUseCount;
    entry.text.setText(message).setFontSize(size).setColor(color).setAlpha(1);
    entry.icon.setVisible(currency);
    if (currency) {
      const iconSize = (size + 2) * SPRITE_ART_SCALE;
      const width = iconSize + 6 + entry.text.width;
      const left = -width / 2;
      entry.text.setOrigin(0, 0.5).setPosition(left + iconSize + 6, 0);
      entry.icon.setPosition(left + iconSize / 2, 0).setDisplaySize(iconSize, iconSize);
    } else {
      entry.text.setOrigin(0.5).setPosition(0, 0);
    }
    entry.container.setPosition(x, y).setDepth(depth).setAlpha(1).setVisible(true);
    return entry.container;
  }

  releaseTransientText(node) {
    const entry = this.transientTextEntries?.get(node);
    if (!entry) {
      node?.destroy?.();
      return;
    }
    this.tweens?.killTweensOf(node);
    entry.active = false;
    entry.persistent = false;
    node.setAlpha(1).setVisible(false);
  }

  buildHud() {
    this.hudBacking = addHudBacking(this, W);
    const text = (label, x, y, size = 10, color = '#8ab4f8', centered = false) =>
      this.add.text(x, y, label, {...this.textStyle(size, color), fontFamily: 'monospace',
        fontStyle: size === 22 ? 'bold' : 'normal'}).setOrigin(centered ? 0.5 : 0, 0);
    const line = (x, y, width, color) =>
      this.add.rectangle(x, y, width, 4, color).setOrigin(0, 0.5);
    this.hud = {
      distanceLabel: text('LEVEL 1 • SECTOR 1/4', 8, 6, 9),
      progressTrack: line(8, 27, 90, PALETTE.steelDark),
      progressBar: line(8, 27, 90, 0x00f0ff),
      cargoLabel: text('CARGO VALUE', 8, 33, 8),
      cargoIcon: this.add.image(17, 54, 'cargo_coin').setDisplaySize(18, 18),
      cargo: text('', 31, 44, 16, colorText(PALETTE.goldLight)),
      distance: text('', 195, 4, 22, '#ffffff', true),
      depot: text('', 195, 31, 9, '#7ba0c0', true),
      shield: text('', 195, 43, 9, '#7fe3ff', true),
      hull: text('', 269, 6, 10, '#00e5ff'),
      hullPips: this.add.graphics(),
      shieldPips: this.add.graphics(),
      load: text('', 269, 31),
      loadTrack: line(269, 46, 90, PALETTE.steelDark),
      loadBar: line(269, 46, 90, PALETTE.cyan),
      bonus: text('', 195, 54, 10, '#00f0ff', true),
      closeCallBonus: text('', 195, 66, 10, '#ffe6a1', true),
    };
    const dividers = [130, 260].map(x => this.add.rectangle(x, 39, 1, 62, PALETTE.steel, 0.4));
    this.hudContainer = this.add.container(0, 0, [this.hudBacking, ...dividers, ...Object.values(this.hud)])
      .setDepth(100).setScrollFactor(0).setVisible(false);
  }

  setWorldVisible(visible) {
    if (this.roadEnvironment) setRoadEnvironmentVisible(this.roadEnvironment, visible, this);
    this.roadFlanks?.forEach(flank => flank.setVisible(false));
    this.syncResponsiveCamera();
    if (!visible && this.depotEntrance) {
      syncDepotEntrance(this.depotEntrance, this.nextDepot, this.distance, 'menu', this.levelId ?? 'level1');
    }
    if (!visible) this.removeDepotFacilities();
    this.hudContainer.setVisible(visible);
    this.finishLine?.setVisible(visible && this.phase === 'running');
    this.ship.setVisible(visible);
    this.shieldRing.setVisible(false);
    this.cargoIndicators.forEach(o => o.setVisible(false));
    this.syncHaulerVisuals();
    Object.values(this.hud).forEach(o => o.setVisible(visible));
    this.hideToast();
  }

  syncHaulerVisuals(dt = 0, scrollSpeed = 0) {
    syncHaulerEffects(this.haulerEffects, this.ship, this.cargoIndicators,
      Math.max(this.cargoWeight ?? 0, this.cargoSlots ?? 0), this.stats.capacity, this.phase, this.time.now, dt, scrollSpeed,
      {hull: this.hull, maxHull: this.maxHull});
  }

  syncShipAppearance(vehicleId = this.profile.selectedVehicleId) {
    const trimId = this.profile.shipStates[vehicleId].equippedColorId;
    const tint = vehicleTint(vehicleId, trimId);
    this.ship.setTexture(vehicleTexture(vehicleId, trimId));
    if (tint) this.ship.setTint(tint);
    else this.ship.clearTint();
    this.shipBaseScale = (vehicleId === 'swift' ? 0.92 : 1) * SPRITE_ART_SCALE * balance.RUN_TRUCK_VISUAL_SCALE;
    this.ship.setScale(this.shipBaseScale);
    this.truckRoll = 0;
    this.truckRollReturn = null;
    this.ship.angle = 0;
  }

  showToast(message, styleId) {
    const style = TOAST_STYLES[styleId];
    if (this.toast.visible && this.toastPriority > style.priority) return false;
    this.toastPriority = style.priority;
    this.toastBack.setFillStyle(style.fill, 0.82).setStrokeStyle(1, style.stroke, 0.7);
    this.toastText.setText(message).setColor(style.color).setFontSize(styleId === 'hint' ? 13 : 11);
    this.toastBack.setSize(350, this.toastText.height + 18);
    this.tweens.killTweensOf(this.toast);
    this.toast.setVisible(true).setAlpha(0);
    this.tweens.chain({
      targets: this.toast,
      tweens: [
        {alpha: 1, duration: 200},
        {alpha: 1, duration: style.duration},
        {
          alpha: 0,
          duration: 400,
          onComplete: () => {
            this.toast.setVisible(false);
            this.toastPriority = 0;
            const next = this.hintQueue.shift();
            if (next && this.phase === 'running') this.showToast(HINTS[next], 'hint');
          },
        },
      ],
    });
    return true;
  }

  hideToast() {
    if (!this.toast) return;
    this.tweens.killTweensOf(this.toast);
    this.toast.setVisible(false).setAlpha(0);
    this.toastPriority = 0;
    this.hintQueue = [];
    this.holdFullCooldown = 0;
  }

  showHoldFullNotice() {
    if (this.holdFullCooldown > 0) return;
    if (this.showToast(HOLD_FULL_TEXT, 'warning')) this.holdFullCooldown = 6;
  }

  triggerHint(event) {
    if (this.hintSaveFailed && this.toast.visible && this.toastPriority >= TOAST_STYLES.error.priority) return;
    const id = hintForEvent(this.profile.seenHints, event);
    if (!id) return;
    const profile = {...this.profile, seenHints: markHintSeen(this.profile.seenHints, id)};
    if (!this.persistProfile(profile)) {
      this.hintSaveFailed = true;
      this.showToast('Tip preference could not be saved. Check browser storage and retry.', 'error');
      return;
    }
    this.hintSaveFailed = false;
    this.profile = profile;
    if (this.toast.visible && this.toastPriority >= TOAST_STYLES.hint.priority) this.hintQueue.push(id);
    else this.showToast(HINTS[id], 'hint');
  }

  floatText(x, y, message, color, size = 18, rise = 56, duration = 750) {
    const node = this.acquireTransientText(x, y, message, color, size);
    this.tweens.add({targets: node, y: y - rise, alpha: 0, duration, ease: 'Cubic.easeOut',
      onComplete: () => this.releaseTransientText(node)});
  }

  floatCurrency(value, y, color, size, suffix = '') {
    const node = this.acquireTransientText(this.ship.x, y, `${value}${suffix}`, color, size, true);
    this.tweens.add({targets: node, y: y - 56, alpha: 0, duration: 750,
      ease: 'Cubic.easeOut', onComplete: () => this.releaseTransientText(node)});
  }

  pulse(target, scale = 1.15, duration = 90) {
    this.tweens.killTweensOf(target);
    const baseScale = target === this.ship
      ? this.shipBaseScale : 1;
    target.setScale(baseScale);
    this.tweens.add({targets: target, scale: baseScale * scale, duration, yoyo: true, ease: 'Quad.easeOut'});
  }

  playPickupFeedback(item, {gain = item.value, replaced = false} = {}) {
    this.feedback?.cargoPickup(this.time.now / 1000);
    if (this.tutorialRun) this.floatText(this.ship.x, this.ship.y - 72,
      'CARGO ATTACHED // +15% MASS INERTIA', '#f2c474', 11);
    const isStack = item.kind === 'coinStack';
    this.coinBurst.explode(isStack ? 22 : 9, item.sprite.x, item.sprite.y);
    this.floatCurrency(`${item.value}`, this.ship.y - 48, '#ffe6a1', isStack ? 24 : 18, ' CARGO');
    if (replaced) this.floatText(this.ship.x, this.ship.y - 24, `HOLD +${gain}`, '#6fe6bc', 11);
    this.pulse(this.ship, isStack ? 1.18 : 1.1);
    this.pulse(this.hud.cargo, 1.08, 110);
  }

  playHitFeedback(x, y, coinsLost, fatal, godHit = false) {
    if (!godHit) this.feedback?.impact();
    this.debris.explode(fatal ? 40 : 18, x, y);
    this.cameras.main.shake(fatal ? 380 : 100, fatal ? 0.02 : 0.012);
    if (!godHit) playImpactSparks(this.haulerEffects, this.ship, x, y);
    this.cameras.main.flash(fatal ? 260 : 160, 220, 50, 70);
    this.pulse(this.hud.hull, 1.25, 120);
    this.floatText(this.ship.x, this.ship.y - 52,
      godHit ? 'GOD • HIT BLOCKED' : fatal ? 'HULL DESTROYED' : '-1 HULL',
      godHit ? '#7fe3ff' : '#ff8f9c', 18);
    if (coinsLost > 0) this.floatCurrency(-coinsLost, this.ship.y - 24, '#ffc0a0', 14);
  }

  clearOverlay() {
    this.overlayObjects.forEach(obj => {
      this.tweens?.killTweensOf(obj);
      obj.list?.forEach(child => this.tweens?.killTweensOf(child));
      obj.destroy?.(obj === this.menuScrollContainer);
    });
    this.menuScrollContainer?.clearMask?.(true);
    this.menuScrollMaskGraphics?.destroy?.();
    this.overlayObjects = [];
    this.pauseDimmer = null;
    this.menuScrollContainer = null;
    this.menuScrollMask = null;
    this.menuScrollMaskGraphics = null;
    this.menuScrollViewport = null;
    this.menuScrollGesture = null;
    this.menuScrollVelocity = 0;
    this.menuScrollTrack = null;
    this.menuScrollThumb = null;
    this.activeMenuContent = null;
    this.menuScrollDraggedPointerId = null;
    this.homePreviewObjects = null;
    this.homePreviewMaskGraphics?.destroy?.();
    this.homePreviewMaskGraphics = null;
    this.titleNeonPulse = null;
    this.titleExhaustFlares = null;
    this.titleAnimationTime = 0;
    this.titleEffectScale = 1;
  }

  fadeOverlayIn() {
    if (!this.tweens?.add) return;
    for (const object of this.overlayObjects) {
      const targetAlpha = object.alpha ?? 1;
      object.setAlpha?.(0);
      this.tweens.add({targets: object, alpha: targetAlpha, duration: 180, ease: 'Quad.easeOut'});
    }
  }

  fadeOverlayOut(onComplete) {
    if (!this.tweens?.add || !this.overlayObjects.length) {
      this.clearOverlay();
      onComplete?.();
      return;
    }
    const targets = [...this.overlayObjects];
    this.tweens.add({targets, alpha: 0, duration: 150, ease: 'Quad.easeIn',
      onComplete: () => {
        if (targets.some(target => this.overlayObjects.includes(target))) this.clearOverlay();
        onComplete?.();
      }});
  }

  trackOverlayObject(object) {
    if (this.activeMenuContent) {
      this.activeMenuContent.add(object);
      object.on?.('pointerdown', pointer => this.beginMenuScroll(pointer));
      object.on?.('pointerup', pointer => this.endMenuScroll(pointer));
    } else this.overlayObjects.push(object);
    return object;
  }

  withMenuScrollItem(y, height, render) {
    if (!this.activeMenuContent) return render();
    const parent = this.activeMenuContent;
    const item = this.add.container(0, 0).setDepth(parent.depth);
    item.menuScrollBounds = {top: y - height / 2, bottom: y + height / 2};
    parent.add(item);
    this.activeMenuContent = item;
    try {
      return render();
    } finally {
      this.activeMenuContent = parent;
    }
  }

  createMenuScroll(key, top = 246, bottom = this.menuMetrics().contentBottom) {
    const content = this.add.container(0, 0).setDepth(32);
    this.menuScrollKey = key;
    this.menuScrollContainer = content;
    this.menuScrollMask = null;
    this.menuScrollTop = top;
    this.menuScrollBottom = bottom;
    this.menuScrollMax = 0;
    this.menuScrollVelocity = 0;
    this.menuScrollOffset = this.menuScrollPositions?.[key] ?? 0;
    this.menuScrollContainer.setY(this.menuScrollOffset);
    if (this.make?.graphics) {
      const maskGraphics = this.make.graphics({x: 0, y: 0, add: false});
      maskGraphics.fillStyle(0xffffff).fillRect(0, top, W, bottom - top);
      this.menuScrollMaskGraphics = maskGraphics;
      this.menuScrollMask = maskGraphics.createGeometryMask();
      content.setMask(this.menuScrollMask);
    }
    this.menuScrollViewport = {top, bottom};
    const scrollZone = this.add.zone(W / 2, (top + bottom) / 2, W, bottom - top)
      .setDepth(31).setInteractive();
    scrollZone.on('pointerdown', pointer => this.beginMenuScroll(pointer));
    scrollZone.on('pointermove', pointer => this.moveMenuScroll(pointer));
    scrollZone.on('pointerup', pointer => this.endMenuScroll(pointer));
    this.overlayObjects.push(content, scrollZone);
    if (this.add.rectangle) {
      this.menuScrollTrack = this.add.rectangle(W - 26, (top + bottom) / 2, 3, bottom - top,
        PALETTE.steel, 0.25).setDepth(37);
      this.menuScrollThumb = this.add.rectangle(W - 26, top, 3, 32, PALETTE.cyanLight, 0.8)
        .setOrigin(0.5, 0).setDepth(38);
      this.overlayObjects.push(this.menuScrollTrack, this.menuScrollThumb);
    }
    this.activeMenuContent = content;
  }

  finishMenuScroll() {
    if (!this.menuScrollContainer) return;
    const contentBottom = measureMenuContent(this.menuScrollContainer.list);
    this.menuScrollMax = Math.max(0, contentBottom - this.menuScrollBottom);
    this.menuScrollOffset = Phaser.Math.Clamp(this.menuScrollOffset, -this.menuScrollMax, 0);
    this.menuScrollContainer.setY(this.menuScrollOffset);
    this.menuScrollPositions ??= {};
    this.menuScrollPositions[this.menuScrollKey] = this.menuScrollOffset;
    this.activeMenuContent = null;
    this.updateMenuScrollVisibility();
  }

  beginMenuScroll(pointer) {
    if (this.menuScrollGesture) return;
    const point = this.menuPointerPoint(pointer);
    if (!this.menuScrollContainer || point.y < this.menuScrollTop || point.y > this.menuScrollBottom) return;
    const coasting = Math.abs(this.menuScrollVelocity ?? 0) > 0;
    this.menuScrollVelocity = 0;
    this.menuScrollDraggedPointerId = coasting ? pointer.id : null;
    this.menuScrollGesture = {
      id: pointer.id, x: point.x, y: point.y, offset: this.menuScrollOffset, moved: false,
      lastY: point.y, lastTime: this.time?.now ?? 0, velocity: 0,
    };
  }

  menuPointerPoint(pointer) {
    return this.cameras?.main?.getWorldPoint
      ? this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      : pointer;
  }

  moveMenuScroll(pointer) {
    const gesture = this.menuScrollGesture;
    if (!gesture || gesture.id !== pointer.id || !pointer.isDown) return;
    const point = this.menuPointerPoint(pointer);
    const deltaY = point.y - gesture.y;
    if (!gesture.moved && Math.hypot(point.x - gesture.x, deltaY) * (this.viewportScale ?? 1) < 10) return;
    gesture.moved = true;
    this.menuScrollDraggedPointerId = pointer.id;
    this.menuScrollOffset = Phaser.Math.Clamp(gesture.offset + deltaY, -this.menuScrollMax, 0);
    const now = this.time?.now ?? 0;
    const elapsed = now - gesture.lastTime;
    if (elapsed > 0) {
      gesture.velocity = Phaser.Math.Clamp((point.y - gesture.lastY) * 1000 / elapsed, -1800, 1800);
      gesture.lastY = point.y;
      gesture.lastTime = now;
    }
    this.menuScrollContainer.setY(this.menuScrollOffset);
    this.updateMenuScrollVisibility();
  }

  endMenuScroll(pointer) {
    if (!this.menuScrollGesture || (pointer && this.menuScrollGesture.id !== pointer.id)) return;
    if (this.menuScrollGesture.moved) {
      this.menuScrollPositions[this.menuScrollKey] = this.menuScrollOffset;
      this.menuScrollVelocity = pointer?.isDown === false &&
        (this.time?.now ?? 0) - this.menuScrollGesture.lastTime < 80
        ? this.menuScrollGesture.velocity : 0;
    }
    this.menuScrollGesture = null;
  }

  scrollMenuBy(deltaY) {
    if (!this.menuScrollContainer || !Number.isFinite(deltaY)) return;
    if (this.menuScrollGesture) {
      this.menuScrollDraggedPointerId = this.menuScrollGesture.id;
      this.menuScrollGesture = null;
    }
    this.menuScrollVelocity = 0;
    const worldDelta = deltaY / (this.viewportScale ?? 1);
    this.menuScrollOffset = Phaser.Math.Clamp(this.menuScrollOffset - worldDelta, -this.menuScrollMax, 0);
    this.menuScrollContainer.setY(this.menuScrollOffset);
    this.menuScrollPositions[this.menuScrollKey] = this.menuScrollOffset;
    this.updateMenuScrollVisibility();
  }

  updateMenuScrollVisibility() {
    if (!this.menuScrollContainer) return;
    const clipped = Boolean(this.menuScrollMask);
    this.menuScrollContainer.list.forEach(child => {
      if (child.menuScrollBounds) {
        const top = this.menuScrollContainer.y + child.menuScrollBounds.top;
        const bottom = this.menuScrollContainer.y + child.menuScrollBounds.bottom;
        child.setVisible(clipped ? bottom > this.menuScrollTop && top < this.menuScrollBottom
          : top >= this.menuScrollTop - 0.5 && bottom <= this.menuScrollBottom + 0.5);
        return;
      }
      const height = child.displayHeight ?? child.height ?? 0;
      const origin = child.displayOriginY ?? height * (child.originY ?? 0.5);
      const top = this.menuScrollContainer.y + child.y - origin;
      const bottom = top + height;
      child.setVisible(clipped ? bottom > this.menuScrollTop && top < this.menuScrollBottom
        : top >= this.menuScrollTop - 0.5 && bottom <= this.menuScrollBottom + 0.5);
    });
    const height = this.menuScrollBottom - this.menuScrollTop;
    const thumbHeight = Math.max(28, height * height / (height + this.menuScrollMax));
    this.menuScrollTrack?.setVisible(this.menuScrollMax > 0);
    this.menuScrollThumb?.setVisible(this.menuScrollMax > 0)
      .setDisplaySize(3, thumbHeight)
      .setY(this.menuScrollTop + (height - thumbHeight) *
        (this.menuScrollMax ? -this.menuScrollOffset / this.menuScrollMax : 0));
  }

  menuControlContainsPointer(pointer, scrollable) {
    if (!scrollable) return true;
    const point = this.menuPointerPoint(pointer);
    return Boolean(this.menuScrollContainer) && point.y >= this.menuScrollTop && point.y <= this.menuScrollBottom;
  }

  clipMenuControl(control, scrollable) {
    if (!scrollable || !control.input) return;
    const hitTest = control.input.hitAreaCallback;
    control.input.hitAreaCallback = (area, x, y, object) => {
      if (!hitTest(area, x, y, object)) return false;
      const point = object.getWorldTransformMatrix().transformPoint(
        x - object.displayOriginX, y - object.displayOriginY);
      return point.y >= this.menuScrollTop && point.y <= this.menuScrollBottom;
    };
  }

  addMenuTile(title, description, state, y, action, options = {}) {
    const width = options.width ?? W - MENU_SPACING.edge * 2;
    const height = options.height ?? 66;
    const x = options.x ?? W / 2;
    const fill = options.fill ?? PALETTE.steelDark;
    return this.withMenuScrollItem(y, height, () => {
      const tile = addSteelControl(this, x, y, width, height, fill,
        options.accent ?? PALETTE.cyan, 33);
      this.trackOverlayObject(tile);
      const titleText = this.addLabel(title, x, y, 14,
        options.titleColor ?? '#f1f8ff', width - MENU_SPACING.padding * 2).setLineSpacing(2);
      const descriptionText = this.addLabel(description, x, y, 12,
        '#b8c9d8', width - MENU_SPACING.padding * 2).setLineSpacing(2);
      const labels = [titleText, descriptionText];
      if (state) {
        labels.push(this.addLabel(state, x, y, 12,
          options.stateColor ?? '#6fe6bc', width - MENU_SPACING.padding * 2).setLineSpacing(2));
      }
      const gap = 8;
      const contentHeight = labels.reduce((total, text) => total + text.height, 0) + gap * (labels.length - 1);
      const scale = Math.min(1, (height - MENU_SPACING.padding * 2) / contentHeight);
      let textTop = y - contentHeight * scale / 2;
      for (const text of labels) {
        text.setScale(scale).setY(textTop);
        textTop += (text.height + gap) * scale;
      }
      if (options.disabled) tile.setAlpha(0.55);
      else this.bindTilePress(tile, action);
      return tile;
    });
  }

  bindTilePress(tile, action) {
    let press = null;
    const scrollable = Boolean(this.activeMenuContent);
    tile.setInteractive({useHandCursor: true})
      .on('pointerdown', (pointer, _localX, _localY, event) => {
        event.stopPropagation();
        if (!this.menuControlContainsPointer(pointer, scrollable) ||
            (this.menuScrollGesture && this.menuScrollGesture.id !== pointer.id)) return;
        if (scrollable) this.beginMenuScroll(pointer);
        press = {id: pointer.id, x: pointer.x, y: pointer.y};
        tile.setAlpha(0.75);
      })
      .on('pointermove', pointer => {
        if (press && Math.hypot(pointer.x - press.x, pointer.y - press.y) > 10) {
          press = null;
          tile.setAlpha(1);
        }
      })
      .on('pointerup', (pointer, _localX, _localY, event) => {
        event.stopPropagation();
        const valid = press?.id === pointer.id && pointer.getDistance() <= 10 &&
          this.menuScrollDraggedPointerId !== pointer.id &&
          this.menuControlContainsPointer(pointer, scrollable);
        press = null;
        tile.setAlpha(1);
        if (valid) {
          action();
          this.feedback?.uiClick();
        }
      })
      .on('pointerout', () => { press = null; tile.setAlpha(1); });
    this.clipMenuControl(tile, scrollable);
  }

  panel(title, subtitle = '', {coverViewport = false, compactHeader = false} = {}) {
    this.clearOverlay();
    stopHaulerExhaust(this.haulerEffects);
    this.cameras?.main?.setBackgroundColor(coverViewport
      ? colorText(PALETTE.background) : 0x0a1222);
    const viewport = coverViewport ? this.cameraViewportBounds() : null;
    const panelHeight = viewport
      ? Math.max(H, this.menuHeight ?? H, viewport.y + viewport.height)
      : this.menuHeight ?? H;
    const back = addIndustrialPanel(this, W, panelHeight, viewport);
    this.overlayObjects.push(back);
    const vehicleId = this.shopChassisId ?? this.profile?.selectedVehicleId ?? 'standard';
    const trimId = this.profile?.shipStates?.[vehicleId]?.equippedColorId ?? 'default';
    const vehicleName = VEHICLES.find(vehicle => vehicle.id === vehicleId).name.toUpperCase();
    const trimName = vehicleTrimName(vehicleId, trimId);
    if (!compactHeader) this.addLabel(`HAZARDOUS HAUL  /  ${vehicleName}  /  ${trimName}`,
      W / 2, 64, 10, colorText(PALETTE.steelLight), W - MENU_SPACING.edge * 2).setOrigin(0.5);
    const titleY = compactHeader ? 48 : 116;
    // Compact headers share the banner with the 250-350 px wallet badge; center the title in the free span.
    const compactTitleX = (70 + 250 - MENU_SPACING.gap) / 2;
    const titleText = title ? this.addLabel(title, compactHeader ? compactTitleX : W / 2, titleY,
      compactHeader ? 20 : title.length > 18 ? 24 : 28,
      colorText(PALETTE.cyanLight), compactHeader ? 250 - MENU_SPACING.gap - 70 : 340) : null;
    if (compactHeader && titleText?.width > 250 - MENU_SPACING.gap - 70) {
      titleText.setScale?.((250 - MENU_SPACING.gap - 70) / titleText.width);
    }
    if (subtitle) {
      const titleHeight = titleText.displayHeight ?? titleText.height ?? (compactHeader ? 24 : 34);
      const subtitleY = Math.max(169, titleY + titleHeight + 16);
      this.addLabel(subtitle, W / 2, subtitleY, 14, '#a9bacb', W - MENU_SPACING.edge * 2);
    }
  }

  cameraViewportBounds() {
    const camera = this.cameras?.main;
    const view = camera?.worldView;
    if (view && [view.x, view.y, view.width, view.height].every(Number.isFinite) &&
        view.width > 0 && view.height > 0) {
      return {x: view.x, y: view.y, width: view.width, height: view.height};
    }
    const zoom = camera?.zoom || 1;
    return {
      x: camera?.scrollX ?? 0,
      y: camera?.scrollY ?? 0,
      width: (camera?.width ?? this.scale?.width ?? W) / zoom,
      height: (camera?.height ?? this.scale?.height ?? H) / zoom,
    };
  }

  addLabel(message, x, y, size = 17, color = '#ffffff', width = 360) {
    const availableWidth = Math.max(1, Math.min(width,
      2 * Math.min(x - MENU_SPACING.edge, W - MENU_SPACING.edge - x)));
    const txt = this.add.text(x, y, message, {...this.textStyle(size, color),
      wordWrap: {width: availableWidth}, lineSpacing: 7})
      .setOrigin(0.5, 0).setDepth(33);
    if (txt.width > availableWidth) txt.setScale(Math.min(1, availableWidth / txt.width));
    this.trackOverlayObject(txt);
    return txt;
  }

  addCardText(message, left, y, width, size, color, {singleLine = false, maxHeight = Infinity, bold = false} = {}) {
    const text = this.add.text(left + width / 2, y, message, {
      ...this.textStyle(size, color), lineSpacing: 2,
      fontStyle: bold ? 'bold' : 'normal',
      wordWrap: {width, ...(singleLine ? {callback: value => [value.replace(/\n/g, ' ')]} : {})},
    }).setOrigin(0.5).setDepth(35);
    text.setScale(Math.min(1, width / text.width, maxHeight / text.height));
    return this.trackOverlayObject(text);
  }

  addCurrency(value, x, y, {size = 18, color = '#ffdf7c', align = 'center', depth = 34,
    overlay = true, suffix = '', maxWidth = 150, iconKey = 'cargo_coin'} = {}) {
    const iconSize = (size + 2) * SPRITE_ART_SCALE;
    const amount = this.add.text(0, 0, `${value}${suffix}`, this.textStyle(size, color)).setOrigin(0, 0.5);
    const width = iconSize + 6 + amount.width;
    const left = align === 'right' ? -width : align === 'left' ? 0 : -width / 2;
    const icon = this.add.image(left + iconSize / 2, 0, iconKey).setDisplaySize(iconSize, iconSize);
    amount.x = left + iconSize + 6;
    const node = this.add.container(x, y, [icon, amount]).setSize(width, iconSize).setDepth(depth);
    if (width > maxWidth) node.setScale(maxWidth / width);
    if (overlay) this.trackOverlayObject(node);
    return node;
  }

  addCard(top, height, accent = PALETTE.steel) {
    const card = addSteelControl(this, W / 2, top + height / 2, 326, height,
      PALETTE.edge, accent, 31);
    this.trackOverlayObject(card);
  }

  addStatRow(label, value, y, {coin = false, color = '#f1f8ff', size = 17} = {}) {
    const labelText = this.addLabel(label, 134, y, 15, '#b8c9d8', 172).setOrigin(0.5);
    const valueText = coin
      ? this.addCurrency(value, 291, y, {size, color, maxWidth: 100})
      : this.addLabel(`${value}`, 291, y, size, color, 100).setOrigin(0.5);
    return {height: Math.max(labelText.height ?? 0, valueText.height ?? size + 2)};
  }

  addButton(label, y, action, options = {}) {
    const width = options.width ?? W - MENU_SPACING.edge * 2;
    const fill = options.fill ?? PALETTE.cockpit;
    const height = options.height ?? 54;
    const x = options.x ?? W / 2;
    const controlDepth = options.depth ?? 34;
    const control = addSteelControl(this, x, y, width, height, fill, PALETTE.cyan, controlDepth);
    const contentWidth = width - MENU_SPACING.padding * 2;
    const txt = this.add.text(x, y, label, {
      ...this.textStyle(options.size ?? 18, options.color ?? '#f1f8ff'),
      wordWrap: {width: contentWidth},
    }).setOrigin(0.5).setDepth(controlDepth + 1);
    this.trackOverlayObject(control);
    this.trackOverlayObject(txt);
    let subtitle = null;
    if (options.subtitle) {
      subtitle = this.addCardText(options.subtitle, x - width / 2 + MENU_SPACING.padding, y,
        contentWidth, 10, options.color ?? '#f1f8ff', {singleLine: true});
    }
    const gap = subtitle ? 4 : 0;
    const maxTextHeight = height - 12;
    const titleHeightLimit = Math.max(1, maxTextHeight - (subtitle?.displayHeight ?? 0) - gap);
    const textScale = Math.min(1, contentWidth / Math.max(1, txt.width),
      titleHeightLimit / Math.max(1, txt.height));
    txt.setScale(textScale);
    if (subtitle) {
      const subtitleHeight = subtitle.displayHeight;
      const titleHeight = txt.displayHeight;
      const groupHeight = titleHeight + gap + subtitleHeight;
      txt.y = y - groupHeight / 2 + titleHeight / 2;
      subtitle.y = y + groupHeight / 2 - subtitleHeight / 2;
    }
    if (options.coins !== undefined) {
      const displayedTextWidth = txt.width * textScale;
      const price = this.addCurrency(options.coins, x + (displayedTextWidth + 10) / 2, txt.y,
        {size: options.size ?? 18, depth: controlDepth + 1, maxWidth: 95});
      txt.x -= (price.displayWidth + 10) / 2;
      if (options.disabled) price.setAlpha(0.5);
    }
    if (options.disabled) {
      control.setAlpha(options.disabledAlpha ?? 0.4);
      txt.setAlpha(options.disabledAlpha ?? 0.5);
      return control;
    }
    control.setInteractive({useHandCursor: true});
    const scrollable = Boolean(this.activeMenuContent);
    this.clipMenuControl(control, scrollable);
    let pressed = null;
    control.on('pointerdown', (pointer, _localX, _localY, event) => {
      event.stopPropagation();
      if (!this.menuControlContainsPointer(pointer, scrollable) ||
          (this.menuScrollGesture && this.menuScrollGesture.id !== pointer.id)) return;
      if (scrollable) this.beginMenuScroll(pointer);
      else {
        this.menuScrollVelocity = 0;
        this.menuScrollDraggedPointerId = null;
      }
      this.steeringPointerId = null;
      pressed = {id: pointer.id, x: pointer.x, y: pointer.y};
      control.setAlpha(0.75);
    });
    control.on('pointermove', pointer => {
      if (pressed && Math.hypot(pointer.x - pressed.x, pointer.y - pressed.y) > 10) {
        pressed = null;
        control.setAlpha(1);
      }
    });
    control.on('pointerup', (pointer, _localX, _localY, event) => {
      event.stopPropagation();
      const valid = pressed?.id === pointer.id && this.menuScrollDraggedPointerId !== pointer.id &&
        Math.hypot(pointer.x - pressed.x, pointer.y - pressed.y) <= 10 &&
        pointer.getDistance() <= 10 && this.menuControlContainsPointer(pointer, scrollable);
      pressed = null;
      control.setAlpha(1);
      if (valid) {
        action();
        this.feedback?.uiClick();
      }
    });
    control.on('pointerover', () => control.setAlpha(0.82));
    control.on('pointerout', () => { pressed = null; control.setAlpha(1); });
    return control;
  }

  addFooterButton(label, action, options = {}) {
    return this.addButton(label, this.menuMetrics().footerY, action,
      {height: this.menuMetrics().footerHeight - 8, ...options});
  }

  addFooterActions(actions, {y = this.menuMetrics().footerY, span = W - MENU_SPACING.edge * 2,
    ...options} = {}) {
    const left = (W - span) / 2;
    const width = (span - MENU_SPACING.gap * (actions.length - 1)) / actions.length;
    actions.forEach((action, index) => this.addButton(action.label, y, action.onClick, {
      x: left + width / 2 + index * (width + MENU_SPACING.gap),
      width,
      height: this.menuMetrics().footerHeight,
      size: 13,
      fill: index === 0 ? PALETTE.cockpit : PALETTE.steelDark,
      ...options,
      ...action.options,
    }));
  }

  showMenu() {
    this.feedback?.stopRunMusic?.();
    this.depotMotion = null;
    this.depotLaunchElapsed = null;
    this.phase = 'menu';
    this.setScreenRenderer(() => this.showMenu());
    this.setWorldVisible(false);
    this.removeObjects();
    this.panel('');
    const height = this.menuHeight ?? H;
    const actionsY = height - 300;
    const logoTop = 118;
    const logoMaxHeight = Math.min(190, Math.max(100, actionsY - 268));
    const logo = this.add.image(W / 2, logoTop + logoMaxHeight / 2, 'hazardous_haul_logo').setDepth(32);
    logo.setScale(Math.min((W - MENU_SPACING.edge * 2) / logo.width, logoMaxHeight / logo.height));
    this.trackOverlayObject(logo);
    const summaryY = logoTop + logo.displayHeight + 28;
    const tallyX = MENU_SPACING.edge + 16;
    this.addCurrency(this.profile.coins, tallyX, summaryY, {size: 14, align: 'left', maxWidth: 120});
    this.addCurrency(this.profile.blueprints, tallyX, summaryY + 30,
      {size: 14, color: '#74b9ff', iconKey: 'cargo_blueprint', align: 'left', maxWidth: 120});
    this.addLabel(`ENDLESS BEST\n${this.profile.endlessBestDistance.toLocaleString('en-US')} m`,
      278, summaryY, 12, '#b8c9d8', 202);
    this.addButton('NORMAL RUN', actionsY, () => this.showLevelSelect(), {height: 54});
    const endlessReady = isRunStartAvailable(this.profile, 'level1', 'beginning', 'continuous');
    this.addButton('ENDLESS RUN', actionsY + 62, () => this.showContinuousConfirm(),
      {fill: PALETTE.magenta, height: 54, disabled: !endlessReady,
        subtitle: endlessReady ? 'Cash out at a Depot or keep driving' : 'Complete Level 1 to unlock'});
    this.addButton('GARAGE & UPGRADES', actionsY + 124,
      () => this.showGarage('', false, 'upgrades'),
      {fill: PALETTE.steelDark, height: 54, size: 18});
    this.addButton('HOW-TO', actionsY + 186,
      () => this.showHowToPlay(), {fill: PALETTE.edge, height: 54, size: 17});
    const controlsHint = this.initialInputType === 'touch'
      ? 'Touch and drag to steer.' : 'Mouse, A/D or arrows to steer.';
    this.addLabel(controlsHint, W / 2, height - 72, 11, '#b4c5d4', 340);
    const buildY = height - 40;
    const buildLabel = this.addLabel(`Build ${BUILD_ID}`, W / 2, buildY, 8, '#71879a');
    if (buildLabel?.setInteractive) {
      buildLabel.setInteractive({useHandCursor: false});
      buildLabel.on('pointerup', (_pointer, _localX, _localY, event) => {
        event.stopPropagation();
        this.registerDeveloperTap();
      });
    }
  }

  registerDeveloperTap() {
    const now = this.time.now;
    if (now - (this.developerTapStartedAt ?? now) > 5000) {
      this.developerTapStartedAt = now;
      this.developerTapCount = 0;
    }
    this.developerTapCount = (this.developerTapCount ?? 0) + 1;
    if (this.developerTapCount >= 7) {
      this.developerTapCount = 0;
      this.developerTapStartedAt = 0;
      this.showDeveloperMenu();
    }
  }

  showDeveloperMenu() {
    this.phase = 'developerMenu';
    this.setScreenRenderer(() => this.showDeveloperMenu());
    this.setWorldVisible(false);
    this.panel('DEVELOPER TOOLS', 'Hidden owner tools • changes are not access-controlled.');
    const layout = this.menuMetrics();
    this.createMenuScroll('developer-tools', layout.contentTop, layout.contentBottom);
    this.addLabel(`Wallet: ${this.profile.coins} Coins`, W / 2, layout.contentTop + 8, 18, '#ffdf7c');
    this.addButton('ADJUST COINS', layout.contentTop + 84, () => this.showDeveloperWallet(), {size: 17});
    this.addButton('DIRECT LEVEL / SECTOR LAUNCH', layout.contentTop + 154,
      () => this.showDeveloperLevelSelect(), {size: 15});
    this.addButton('STEERING SANDBOX', layout.contentTop + 224,
      () => this.showDeveloperSandboxSetup(), {size: 17, fill: PALETTE.steelDark});
    this.addButton(`GOD MODE: ${this.godMode ? 'ON' : 'OFF'}`, layout.contentTop + 294, () => {
      this.developerGodMode = !this.godMode;
      this.showDeveloperMenu();
    }, {size: 17, fill: this.godMode ? PALETTE.cockpit : PALETTE.steelDark,
      subtitle: 'No damage. No rewards or records.'});
    this.finishMenuScroll();
    this.addFooterButton('CLOSE', () => this.showMenu(), {fill: PALETTE.steelDark});
  }

  get godMode() {
    return this.developerGodMode ?? this.debugManager?.flags.god ?? false;
  }

  showDeveloperWallet(direction = null) {
    this.phase = 'developerWallet';
    this.setScreenRenderer(() => this.showDeveloperWallet(direction));
    this.panel('DEVELOPER WALLET', 'Permanent wallet changes require confirmation.');
    this.addLabel(`Current balance: ${this.profile.coins} Coins`, W / 2, 224, 17, '#ffdf7c');
    if (!direction) {
      this.addButton('ADD COINS', 306, () => this.showDeveloperWallet('add'), {size: 17});
      this.addButton('REMOVE COINS', 378, () => this.showDeveloperWallet('remove'),
        {size: 17, fill: PALETTE.steelDark});
      this.addButton('BACK', 470, () => this.showDeveloperMenu(), {fill: PALETTE.steelDark});
      return;
    }
    const sign = direction === 'add' ? 1 : -1;
    this.addLabel(`${direction === 'add' ? 'Add' : 'Remove'} how many Coins?`,
      W / 2, 266, 16, '#dfeaf3');
    [100, 500, 1000].forEach((amount, index) => this.addButton(
      `${direction === 'add' ? 'ADD' : 'REMOVE'} ${amount}`, 326 + index * 62,
      () => this.confirmDeveloperCoinAdjustment(sign * amount),
      {size: 14, fill: direction === 'add' ? PALETTE.cockpit : PALETTE.steelDark, height: 48},
    ));
    this.addButton('BACK', 530, () => this.showDeveloperWallet(), {fill: PALETTE.steelDark});
  }

  confirmDeveloperCoinAdjustment(signedAmount) {
    this.setScreenRenderer(() => this.confirmDeveloperCoinAdjustment(signedAmount));
    const nextProfile = adjustDeveloperCoins(this.profile, signedAmount);
    this.phase = 'developerWalletConfirm';
    this.pendingDeveloperProfile = nextProfile;
    this.panel('CONFIRM COIN CHANGE', 'This permanently changes your saved wallet.');
    this.addLabel(`Current: ${this.profile.coins} Coins\nResult: ${nextProfile.coins} Coins`,
      W / 2, 264, 20, '#ffdf7c');
    this.addButton('CONFIRM CHANGE', 390, () => {
      if (!this.persistProfile(this.pendingDeveloperProfile)) {
        this.showToast('Coin adjustment could not be saved. Check browser storage.', 'error');
        return;
      }
      this.profile = this.pendingDeveloperProfile;
      this.pendingDeveloperProfile = null;
      this.showDeveloperMenu();
    }, {size: 15});
    this.addButton('CANCEL', 462, () => {
      this.pendingDeveloperProfile = null;
      this.showDeveloperWallet();
    }, {fill: PALETTE.steelDark});
  }

  showDeveloperLevelSelect() {
    this.phase = 'developerLevelSelect';
    this.setScreenRenderer(() => this.showDeveloperLevelSelect());
    this.panel('DIRECT RUN', 'Choose a level. Developer runs never unlock progression.');
    const layout = this.menuMetrics();
    this.createMenuScroll('developer-levels', layout.contentTop, layout.contentBottom);
    GAME_BALANCE.progression.levelIds.forEach((levelId, index) => this.addButton(
      levelDisplayName(levelId), layout.contentTop + 28 + index * 66,
      () => this.showDeveloperSectorSelect(levelId), {fill: index ? PALETTE.magenta : PALETTE.cockpit},
    ));
    this.finishMenuScroll();
    this.addFooterButton('BACK', () => this.showDeveloperMenu(), {fill: PALETTE.steelDark});
  }

  showDeveloperSectorSelect(levelId) {
    this.devSelectedLevel = levelId;
    this.phase = 'developerSectorSelect';
    this.setScreenRenderer(() => this.showDeveloperSectorSelect(levelId));
    this.panel('DIRECT SECTOR', `${levelDisplayName(levelId)} • no records or rewards`);
    const layout = this.menuMetrics();
    this.createMenuScroll(`developer-sectors:${levelId}`, layout.contentTop, layout.contentBottom);
    for (let sectorNumber = 1; sectorNumber <= IMPLEMENTED_LEVELS[levelId].length; sectorNumber++) {
      const startsAt = GAME_BALANCE.routes[levelId].sectorStartsMeters[sectorNumber - 1];
      this.addButton(`START AT SECTOR ${sectorNumber}  •  ${startsAt.toLocaleString('en-US')} m`,
        layout.contentTop + 27 + (sectorNumber - 1) * (54 + MENU_SPACING.gap),
        () => this.startRun('developer', levelId, 'normal', {
          sectorNumber, vehicleId: this.profile.selectedVehicleId,
        }), {size: 14});
    }
    this.finishMenuScroll();
    this.addFooterButton('BACK', () => this.showDeveloperLevelSelect(), {fill: PALETTE.steelDark});
  }

  showDeveloperSandboxSetup(vehicleId = this.profile.selectedVehicleId) {
    const availableVehicles = this.profile.ownedVehicleIds;
    const selectedVehicleId = availableVehicles.includes(vehicleId) ? vehicleId : availableVehicles[0];
    this.phase = 'developerSandboxSetup';
    this.setScreenRenderer(() => this.showDeveloperSandboxSetup(vehicleId));
    this.devSandboxVehicleId = selectedVehicleId;
    this.panel('STEERING SANDBOX', 'Choose an owned ship and use its saved loadout.');
    availableVehicles.forEach((id, index) => this.addButton(
      id === selectedVehicleId ? `${id.toUpperCase()}  •  SELECTED` : id.toUpperCase(),
      258 + index * 64, () => this.showDeveloperSandboxSetup(id),
      {size: 15, disabled: id === selectedVehicleId},
    ));
    const stats = loadoutStats(this.profile, selectedVehicleId);
    this.addLabel(`${Math.round(stats.capacity)} cargo capacity • current saved equipment loadout`,
      W / 2, 404, 13, '#b8c9d8', 320);
    this.addButton('START OBSTACLE-FREE SANDBOX', 490,
      () => this.startRun('developer', 'level1', 'normal', {
        sectorNumber: 1, vehicleId: this.devSandboxVehicleId, sandbox: true,
      }), {size: 14});
    this.addButton('BACK', 566, () => this.showDeveloperMenu(), {fill: PALETTE.steelDark});
  }

  showLevelSelect() {
    this.phase = 'levelSelect';
    this.setScreenRenderer(() => this.showLevelSelect());
    this.setWorldVisible(false);
    this.panel('NORMAL RUN', 'Choose a level, then tap where to start.');
    const layout = this.menuMetrics();
    const cardTop = 206;
    const padding = MENU_SPACING.padding;
    const gap = MENU_SPACING.gap;
    const textLeft = MENU_SPACING.edge + padding;
    const textWidth = W - textLeft * 2;
    const headingHeight = 44, buttonHeight = 60, recordHeight = 32, checkpointHeight = 26;
    const cardHeight = padding * 2 + headingHeight + buttonHeight + recordHeight + checkpointHeight + gap * 3;
    this.createMenuScroll('level-select', cardTop, layout.contentBottom);
    let y = cardTop;
    const playableLevels = Object.keys(IMPLEMENTED_LEVELS)
      .sort((left, right) => Number(left.slice(5)) - Number(right.slice(5)));
    const comingSoonLevels = ['level5'];
    for (const levelId of playableLevels) {
      const progress = this.profile.levelProgress[levelId];
      const available = isLevelUnlocked(this.profile, levelId);
      const checkpointReady = isRunStartAvailable(this.profile, levelId, 'checkpoint', 'normal');
      if (checkpointReady) this.prepareRunStream(levelId, 'normal', checkpointDistance(levelId));
      this.withMenuScrollItem(y + cardHeight / 2, cardHeight, () => {
        this.addCard(y, cardHeight, available ? PALETTE.cyan : PALETTE.steel);
        const title = {level1: 'LEVEL 1: INDUSTRIAL ZONE', level2: 'LEVEL 2: DUSTLANDS'}[levelId]
          ?? levelDisplayName(levelId);
        this.addCardText(`${title}${progress.completed ? '  •  COMPLETE' : ''}`,
          textLeft, y + padding + headingHeight / 2, textWidth, 17,
          available ? '#a0f4ff' : '#b8c9d8', {maxHeight: headingHeight});
        const buttonsY = y + padding + headingHeight + gap + buttonHeight / 2;
        this.addButton('SECTOR 1', buttonsY, () => this.startRun('beginning', levelId, 'normal'), {
          x: 118.5, width: 141, height: buttonHeight, size: 14,
          fill: available ? PALETTE.cockpit : PALETTE.steelDark, disabled: !available,
        });
        this.addButton('CHECKPOINT\nSECTOR 3', buttonsY, () => this.startRun('checkpoint', levelId, 'normal'), {
          x: 271.5, width: 141, height: buttonHeight, size: 12,
          fill: checkpointReady ? PALETTE.cockpit : PALETTE.steelDark, disabled: !checkpointReady,
        });
        const recordY = buttonsY + buttonHeight / 2 + gap + recordHeight / 2;
        this.addCardText(available
          ? `${routeFinishDistance(levelId).toLocaleString('en-US')} m  •  Best ${progress.bestDistance.toLocaleString('en-US')} m`
          : `Complete Level ${Number(levelId.slice(5)) - 1} to unlock Level ${Number(levelId.slice(5))}.`,
        textLeft, recordY, textWidth, 12, available ? '#b8c9d8' : '#f2c474', {maxHeight: recordHeight});
        this.addCardText(checkpointReady ? 'Sector 3 start ready. Full health, empty cargo.'
          : 'Checkpoint locked: reach Sector 3 in this level.',
        textLeft, recordY + recordHeight / 2 + gap + checkpointHeight / 2, textWidth, 10,
        checkpointReady ? '#6fe6bc' : '#b8c9d8', {maxHeight: checkpointHeight});
      });
      y += cardHeight + MENU_SPACING.gap;
    }
    for (const levelId of comingSoonLevels) {
      const number = Number(levelId.slice(5));
      this.withMenuScrollItem(y + 42, 84, () => {
        this.addCard(y, 84, PALETTE.steel);
        this.addLabel(`LEVEL ${number}`, W / 2, y + 14, 17, '#b8c9d8', 294);
        this.addLabel('COMING SOON', W / 2, y + 48, 12, '#8ca0b2', 294);
      });
      y += 84 + MENU_SPACING.gap;
    }
    this.finishMenuScroll();
    this.addFooterButton('RETURN TO MENU', () => this.showMenu(),
      {fill: PALETTE.steelDark, height: 42, size: 14});
  }

  showContinuousConfirm() {
    if (!isRunStartAvailable(this.profile, 'level1', 'beginning', 'continuous')) {
      this.showMenu();
      return;
    }
    this.phase = 'continuousConfirm';
    this.setScreenRenderer(() => this.showContinuousConfirm());
    this.setWorldVisible(false);
    this.panel('ENDLESS RUN', 'Drive until you cash out or wreck.');
    const layout = this.menuMetrics();
    this.createMenuScroll('continuous-confirm', layout.contentTop, layout.contentBottom);
    const explanation = [
      'Cargo is worth much more.',
      'Cash out at a Depot to end your run. You cannot bank and continue.',
      'Every Depot you pass adds a cargo bonus.',
      'The farther you go, the harder it gets.',
      'How much will you risk?',
    ].join('\n\n');
    this.addLabel(explanation, W / 2, layout.contentTop + 10, 14, '#dfeaf3', 334)
      .setLineSpacing(3);
    this.finishMenuScroll();
    this.addFooterActions([
      {label: 'START ENDLESS', onClick: () => this.startRun('beginning', 'level1', 'continuous'),
        options: {fill: PALETTE.magenta}},
      {label: 'BACK', onClick: () => this.showMenu()},
    ]);
  }

  showHowToPlay() {
    this.phase = 'help';
    this.setScreenRenderer(() => this.showHowToPlay());
    this.setWorldVisible(false);
    this.panel('HOW TO PLAY', 'Steer. Collect. Choose when to bank.');
    const layout = this.menuMetrics();
    this.createMenuScroll('help', layout.contentTop, layout.contentBottom);
    let y = layout.contentTop + 8;
    for (const [heading, body] of HELP_SECTIONS) {
      this.addLabel(heading, W / 2, y, 12, '#a0f4ff', 302);
      const text = this.addLabel(body, W / 2, y + 18, 14, '#dfeaf3', 302)
        .setLineSpacing(3);
      y += 18 + text.height + 11;
    }
    this.finishMenuScroll();
    this.addFooterActions([{label: 'SHOW TIPS NEXT RUN', onClick: () => {
      const profile = {...this.profile, seenHints: []};
      if (!this.persistProfile(profile)) {
        this.showToast('Tip preference could not be saved. Check browser storage and retry.', 'error');
        return;
      }
      this.profile = profile;
      this.showMenu();
    }, options: {fill: 0x276f78}}, {label: 'BACK', onClick: () => this.showMenu()}]);
  }

  upgradeTileModel(item, chassisId) {
    if (item.kind === 'capacity') {
      const status = cargoCapacityStatus(this.profile, chassisId);
      if (status.atMax) return this.upgradeTileModel({kind: 'reinforcement'}, chassisId);
      return {
        name: 'Cargo Capacity', icon: 'cargo_stack',
        tier: 1,
        rank: `Rank ${status.rank}/${status.maxRank}`,
        benefit: `${status.capacity + (GAME_BALANCE.vehicles[chassisId].cargoCapacityOffset ?? 0)} cargo when equipped`,
        state: status.equipped ? 'EQUIPPED' : status.owned ? 'OWNED · NOT EQUIPPED' : !status.canAfford
          ? `${status.cost} COINS\nNEED ${Math.max(0, status.cost - this.profile.coins)} MORE` : `${status.cost} COINS`,
        locked: false, maxed: status.atMax, model: status,
      };
    }
    if (item.kind === 'reinforcement') {
      const status = reinforcedCargoStatus(this.profile, chassisId);
      const capacity = cargoCapacityStatus(this.profile, chassisId);
      return {
        kind: 'reinforcement', name: 'Reinforced Cargo Hold', icon: 'cargo_stack',
        tier: 2,
        rank: `Lv ${status.rank}/${status.maxRank}`,
        benefit: `${capacity.capacity + (GAME_BALANCE.vehicles[chassisId].cargoCapacityOffset ?? 0)} cargo\n−${Math.round(status.mitigation * 100)}% hit loss`,
        state: !status.unlocked ? `LOCKED · CAPACITY ${capacity.maxRank}`
          : status.atMax && status.equipped ? 'MAX LVL · EQUIPPED' : status.atMax ? 'MAX LEVEL'
          : status.equipped ? 'EQUIPPED' : 'OWNED · NOT EQUIPPED',
        locked: !status.unlocked, maxed: status.atMax,
        requirement: `Reach capacity rank ${capacity.maxRank}`,
        model: status,
      };
    }
    const status = moduleStatus(this.profile, item.id, chassisId);
    const maxRank = status.def.benefit.values.length;
    const requirement = !status.unlocked ? status.requirement.summary : status.capped
      ? `Reach L1 · S${moduleLevelCap(this.profile.milestones)}` : null;
    const benefit = status.level
      ? formatStat(status.def.benefit.stat, status.def.benefit.values[status.level - 1])
      : MODULE_CAPTIONS[item.id];
    return {
      name: status.def.name, icon: item.id, tier: status.def.tier,
      rank: `Lv ${status.level}/${maxRank}`,
      benefit,
      state: !status.unlocked ? 'LOCKED' : status.capped ? 'LOCKED · LEVEL CAP'
        : status.atMax && status.equipped ? 'MAX LVL · EQUIPPED'
          : status.atMax ? 'MAX LEVEL' : status.equipped ? 'EQUIPPED' : status.owned ? 'OWNED'
          : this.profile.coins < status.def.price
            ? `${status.def.price} COINS\nNEED ${status.def.price - this.profile.coins} MORE`
            : `${status.def.price} COINS`,
      locked: !status.unlocked || status.capped, maxed: status.atMax,
      requirement, future: !status.unlocked && status.requirement.future, model: status,
    };
  }

  addUpgradeGridTile(item, x, y, size, chassisId, height = size + 200) {
    return this.withMenuScrollItem(y, height, () => {
      const view = this.upgradeTileModel(item, chassisId);
      const status = view.model;
      const equipped = status.equipped;
      const kind = view.kind ?? item.kind;
      const id = item.kind === 'module' ? item.id : CARGO_CAPACITY_ID;
      const content = upgradeTileContentMetrics(size, height);
      const openDetail = () => this.showUpgradeDetail(kind, item.id);
      const tile = addSteelControl(this, x, y, size, height,
        equipped ? 0x12313b : PALETTE.steelDark, equipped ? PALETTE.cyan : PALETTE.steel, 33);
      this.trackOverlayObject(tile);
      this.bindTilePress(tile, openDetail);
      const top = tile.y - tile.height / 2;
      const label = (text, centerY, textHeight, fontSize, color, options = {}) =>
        this.addCardText(text, x - size / 2 + content.paddingX, top + centerY,
          size - content.paddingX * 2, fontSize, color, {...options, maxHeight: textHeight});
      this.addCardText(kind === 'reinforcement' ? 'REINFORCED\nCARGO HOLD' : view.name.toUpperCase(),
        x - size / 2 + content.paddingX, top + content.titleY, size - content.paddingX * 2,
        13 * content.scale, '#f1f8ff', {bold: true, maxHeight: content.titleHeight});
      label(`T${view.tier}  •  ${view.rank}`, content.rankY, 12 * content.scale,
        11 * content.scale, '#8ab4f8', {singleLine: true});
      const icon = this.addGarageUpgradeIcon(id, x, top + content.iconY, content.iconSize);
      if (view.locked) {
        icon.setTint(0x8795a4).setAlpha(0.65);
        this.trackOverlayObject(this.add.image(x + content.iconSize * 0.32, top + content.iconY + content.iconSize * 0.32, 'garage_lock')
          .setDisplaySize(16 * content.scale, 19 * content.scale).setDepth(35));
      }
      const price = kind === 'module'
        ? status.owned ? status.upgradeCost : status.def.price : status.cost;
      let benefit;
      if (kind === 'capacity') {
        const increase = status.nextCapacity - status.capacity;
        benefit = `+${increase} CARGO SLOTS\nNEXT RANK`;
      } else if (kind === 'reinforcement') {
        benefit = `${Math.round(status.mitigation * 100)}% LESS\nCARGO VALUE LOST`;
      } else {
        const value = status.def.benefit.values[Math.max(0, status.level - 1)];
        benefit = garageUpgradeBenefit(status.def.benefit.stat, value).toUpperCase();
      }
      label(benefit, content.benefitY, content.benefitHeight,
        11 * content.scale, '#00f0ff', {bold: true});
      const note = view.locked ? kind === 'module'
        ? status.capped ? view.requirement : status.requirement.summary
        : view.requirement
        : kind === 'capacity' ? `${status.capacity + (GAME_BALANCE.vehicles[chassisId].cargoCapacityOffset ?? 0)} SLOTS WHEN EQUIPPED`
        : equipped ? 'TAP TO MANAGE' : status.owned ? 'OWNED • TAP TO EQUIP' : 'LEVEL 1 BENEFIT';
      label(note, content.noteY, content.noteHeight, 10 * content.scale,
        view.locked ? '#f2c474' : '#b8c9d8', {singleLine: true});
      const action = view.maxed ? 'MAX LEVEL' : view.locked ? 'LOCKED'
        : equipped ? 'EQUIPPED' : `${price} COINS`;
      const canBuy = !view.maxed && !view.locked && !equipped &&
        Number.isFinite(price) && this.profile.coins >= price;
      this.addButton(action, top + content.buttonY,
        () => this.showUpgradePurchaseConfirm(kind, chassisId, kind === 'module' ? id : undefined),
        {x, width: size - content.paddingX * 2, height: content.buttonHeight, size: 12 * content.scale,
          fill: equipped && !view.maxed ? PALETTE.cyan : view.maxed ? PALETTE.steelDark : 0x9a6827,
          color: equipped && !view.maxed ? '#06151d' : '#ffffff',
          disabled: !canBuy, disabledAlpha: equipped && !view.maxed ? 1 : 0.65});
    });
  }

  showGarage(message = '', isError = false, tab = this.garageTab ?? 'upgrades') {
    this.phase = 'garage';
    this.setScreenRenderer(() => this.showGarage(message, isError, tab));
    this.setWorldVisible(false);
    this.garageTab = tab;
    this.panel(tab === 'upgrades' ? 'UPGRADES' : 'GARAGE', '', {compactHeader: true});
    const p = this.profile;
    const vehicleId = p.selectedVehicleId;
    this.shopChassisId = vehicleId;
    const stats = loadoutStats(p, vehicleId);
    const layout = this.menuMetrics();
    const tabWidth = (W - MENU_SPACING.edge * 2 - MENU_SPACING.gap) / 2;
    const tabLeftX = MENU_SPACING.edge + tabWidth / 2;
    const tabRightX = tabLeftX + tabWidth + MENU_SPACING.gap;
    this.addButton('TRUCKS', 126, () => {
      if (tab !== 'garage') this.showGarage('', false, 'garage');
    }, {x: tabLeftX, width: tabWidth, height: 54, size: 14,
      fill: tab === 'garage' ? PALETTE.cockpit : PALETTE.steelDark});
    this.addButton('UPGRADES', 126, () => {
      if (tab !== 'upgrades') this.showGarage('', false, 'upgrades');
    }, {x: tabRightX, width: tabWidth, height: 54, size: 13,
      fill: tab === 'upgrades' ? PALETTE.cockpit : PALETTE.steelDark});
    this.addGarageWallet();
    const sectionHeader = this.addLabel(tab === 'garage'
      ? `${vehicleId.toUpperCase()}  •  ${stats.capacity} CARGO  •  ${p.blueprints} BLUEPRINTS`
      : `MODULES  •  RANK LIMIT ${moduleLevelCap(p.milestones)}  •  TAP SOCKETS`,
    W / 2, 168, 10, '#b8c9d8', 342);
    if (tab === 'garage') {
      const contentTop = Math.max(184,
        168 + (sectionHeader.displayHeight ?? sectionHeader.height ?? 12) + 8);
      this.createMenuScroll('garage:garage', contentTop, layout.contentBottom);
      let y = contentTop + 4;
      if (message) {
        const notice = this.addLabel(message, W / 2, y, 11,
          isError ? '#ff9aa6' : '#6fe6bc', 340);
        y += (notice?.displayHeight ?? notice?.height ?? 12) + MENU_SPACING.gap;
      }
      const cards = adaptiveCardMetrics(y, layout.contentBottom, TRUCK_CARD_MIN_HEIGHT);
      // Center the fixed 112 px info block in the space above the bottom button row.
      const infoShift = Math.max(0, (cards.height - MENU_SPACING.padding - 54 - 10 - 112) / 2);
      for (const {id, name} of VEHICLES) {
        if (!IMPLEMENTED_VEHICLE_IDS.includes(id)) {
          const height = cards.height;
          const cardTop = y;
          this.withMenuScrollItem(y + height / 2, height, () => {
            const card = addSteelControl(this, W / 2, cardTop + height / 2, W - MENU_SPACING.edge * 2, height,
              PALETTE.lockedFill, PALETTE.steel, 33);
            this.trackOverlayObject(card);
            const y = cardTop + infoShift;
            const preview = this.add.image(273, y + 64, 'garage_standard_display')
              .setTint(0x66717c).setAlpha(0.45).setDepth(34);
            preview.setScale(Math.min(90 / preview.width, 90 / preview.height));
            preview.menuScrollBounds = {top: y + 19, bottom: y + 109};
            this.trackOverlayObject(preview);
            this.trackOverlayObject(this.add.image(273, y + 64, 'garage_lock')
              .setDisplaySize(32, 36).setDepth(35));
            this.addCardText(name.toUpperCase().replace(' ', '\n'), 48, y + 32, 146,
              17, '#b0bac6', {maxHeight: 40});
            this.addCardText('PLANNED TRUCK\nStats coming soon', 48, y + 83, 146,
              11, '#8996a6', {maxHeight: 34});
            this.addButton('Coming Soon', cardTop + height - MENU_SPACING.padding - 27, () => {},
              {width: 294, height: 54, size: 16, disabled: true, fill: PALETTE.lockedFill});
          });
          y += cards.stride;
          continue;
        }
        const status = vehicleStatus(p, id);
        const shipStats = loadoutStats(p, id);
        const purchaseReady = !status.owned && status.canPurchase;
        const height = cards.height;
        const cardTop = y;
        this.withMenuScrollItem(y + height / 2, height, () => {
          const card = addSteelControl(this, W / 2, cardTop + height / 2, W - MENU_SPACING.edge * 2, height,
            status.selected ? 0x12313b : PALETTE.steelDark,
            status.selected ? PALETTE.cyan : PALETTE.steel, 33);
          this.trackOverlayObject(card);
          const y = cardTop + infoShift;
          const preview = this.add.image(273, y + 64, `garage_${id}_display`)
            .setDepth(34);
          preview.setScale(Math.min(90 / preview.width, 90 / preview.height));
          preview.menuScrollBounds = {top: y + 19, bottom: y + 109};
          this.trackOverlayObject(preview);
          if (!status.owned) {
            preview.setTint(0x66717c).setAlpha(0.65);
            this.trackOverlayObject(this.add.image(273, y + 64, 'garage_lock')
              .setDisplaySize(32, 36).setDepth(35));
          }
          this.addCardText(name.toUpperCase().replace(' ', '\n'), 48, y + 32, 146,
            17, status.owned ? '#f8df8f' : '#b0bac6', {maxHeight: 40});
          for (const [text, offset] of [[`CARGO ${shipStats.capacity}`, 66],
            [`STEERING ${Math.round(shipStats.vehicleSteeringMultiplier * 100)}%`, 90]]) {
            this.addCardText(text, 48, y + offset, 146, 11, '#b8d9e8', {singleLine: true});
          }
          for (const [barY, ratio] of [[y + 78, shipStats.capacity / GAME_BALANCE.cargoProgression.capacityByRank.at(-1)],
            [y + 102, shipStats.vehicleSteeringMultiplier / GAME_BALANCE.vehicles.swift.steeringMultiplier]]) {
            this.trackOverlayObject(this.add.rectangle(60, barY, 122, 7, PALETTE.steelDark)
              .setOrigin(0, 0.5).setDepth(35));
            this.trackOverlayObject(this.add.rectangle(60, barY, 122 * Math.min(1, ratio), 7, PALETTE.cyan)
              .setOrigin(0, 0.5).setDepth(35));
          }
          this.bindTilePress(card, () => this.showVehicleDetail(id));
          const buttonY = cardTop + height - MENU_SPACING.padding - 27;
          this.addButton('PREVIEW', buttonY, () => this.showVehicleDetail(id),
            {x: 95, width: 94, height: 54, size: 12, fill: PALETTE.steelDark});
          const action = status.owned ? status.selected ? 'EQUIPPED' : 'EQUIP'
            : !status.levelUnlocked ? 'BEAT LEVEL 1 TO UNLOCK'
            : `UNLOCK  •  ${status.cost} BP`;
          this.addButton(action, buttonY, () => status.owned
            ? this.applyVehicleChange(selectVehicle(this.profile, id), 'Truck equipped.')
            : this.showVehiclePurchaseConfirm(id),
            {x: 242, width: 176, height: 54, size: 11,
              disabled: status.selected || (!status.owned && !purchaseReady),
              disabledAlpha: 1, fill: status.owned ? PALETTE.cyan : 0x9a6827,
              color: status.owned ? '#06151d' : '#ffffff'});
        });
        y += cards.stride;
      }
      this.finishMenuScroll();
    } else {
      let y = sectionHeader.y;
      y += sectionHeader.displayHeight + 24;
      this.createMenuScroll('garage:upgrades', y, layout.contentBottom);
      if (message) {
        const notice = this.addLabel(message, W / 2, y, 11,
          isError ? '#ff9aa6' : '#6fe6bc', 340);
        y += (notice?.displayHeight ?? notice?.height ?? 12) + MENU_SPACING.gap;
      }
      y = this.addGarageSocketBay(vehicleId, y, true);
      const separator = this.add.rectangle(W / 2, y, W - 44, 1, PALETTE.steel, 0.7).setDepth(33);
      this.trackOverlayObject(separator);
      const grid = squareGridMetrics(W, {padding: MENU_SPACING.edge, gap: MENU_SPACING.gap, columns: 2});
      const gridTop = y + 8;
      const cards = peekingCardMetrics(gridTop, layout.contentBottom, 1, 0.3);
      const tileHeight = Math.max(180, cards.height);
      const firstTileY = gridTop + tileHeight / 2;
      UPGRADE_GRID_ORDER.forEach((item, index) => {
        const column = index % grid.columns;
        const row = Math.floor(index / grid.columns);
        const x = grid.padding + grid.tileSize / 2 + column * grid.rowStride;
        this.addUpgradeGridTile(item, x, firstTileY + row * (tileHeight + cards.gap), grid.tileSize, vehicleId, tileHeight);
      });
      this.finishMenuScroll();
    }
    this.addFooterButton('BACK TO MENU', () => this.showMenu(),
      {fill: PALETTE.steelDark, height: 54, size: 14});
  }

  showShips(message = '', isError = false) {
    this.showGarage(message, isError, 'garage');
  }

  addGarageUpgradeIcon(id, x, y, size) {
    const art = GARAGE_UPGRADE_ART.find(candidate => candidate.id === id);
    if (!art) throw new Error(`Missing Garage upgrade art: ${id}`);
    const icon = this.add.image(x, y, art.key).setDepth(34);
    icon.setScale(Math.min(size / icon.width, size / icon.height));
    icon.menuScrollBounds = {top: y - size / 2, bottom: y + size / 2};
    return this.trackOverlayObject(icon);
  }

  addGarageSocketBay(vehicleId, top, compact = false) {
    const state = this.profile.shipStates[vehicleId];
    let rowTop = top;
    if (!compact) {
      this.addLabel('EQUIPPED MODULES', W / 2, top, 11, '#a0f4ff', 342);
      const hint = this.addLabel('Tap an equipped socket to manage it.',
        W / 2, top + 18, 11, '#9aafc0', 342);
      rowTop = hint.y + hint.height + 14;
    }
    const size = 50;
    const gap = 4;
    const rowWidth = size * SLOT_MAX + gap * (SLOT_MAX - 1);
    const centerY = rowTop + size / 2;
    for (let i = 0; i < SLOT_MAX; i++) {
      const x = (W - rowWidth) / 2 + size / 2 + i * (size + gap);
      const open = i < state.unlockedSlotCount;
      const id = open ? state.equippedModuleIds[i] : null;
      this.withMenuScrollItem(centerY, size, () => {
        const box = addSteelControl(this, x, centerY, size, size,
          id ? 0x12313b : open ? PALETTE.steelDark : PALETTE.edge,
          id ? PALETTE.cyan : PALETTE.steel, 33).setFillStyle(
          id ? 0x12313b : open ? PALETTE.steelDark : PALETTE.edge, open && !id ? 0.5 : 1);
        this.trackOverlayObject(box);
        if (id || open) {
          const glow = this.add.graphics().setDepth(34);
          glow.lineStyle(id ? 3 : 1, PALETTE.cyan, id ? 0.35 : 0.55);
          if (id) glow.strokeRoundedRect(x - 22, centerY - 22, 44, 44, 5);
          else for (let offset = -19; offset < 19; offset += 9) {
            glow.strokeLineShape({x1: x + offset, y1: centerY - 21, x2: x + offset + 5, y2: centerY - 21});
            glow.strokeLineShape({x1: x + offset, y1: centerY + 21, x2: x + offset + 5, y2: centerY + 21});
            glow.strokeLineShape({x1: x - 21, y1: centerY + offset, x2: x - 21, y2: centerY + offset + 5});
            glow.strokeLineShape({x1: x + 21, y1: centerY + offset, x2: x + 21, y2: centerY + offset + 5});
          }
          this.trackOverlayObject(glow);
        }
        if (id) {
          this.addGarageUpgradeIcon(id, x, centerY, 36);
          this.bindTilePress(box, () => this.showModuleDetail(id));
        } else if (!open) {
          this.trackOverlayObject(this.add.image(x, centerY, 'garage_lock')
            .setDisplaySize(17, 20).setAlpha(0.65).setDepth(34));
        }
      });
    }
    let bottom = centerY + size / 2 + (compact ? 6 : 16);
    const offer = nextSlotOffer(this.profile, vehicleId);
    if (offer) {
      const reason = !offer.canBuy ? offer.reached
        ? `Need ${Math.max(0, offer.cost - this.profile.coins)} more Coins.` : offer.requirement : null;
      this.withMenuScrollItem(bottom + 27, 54, () => {
        this.addButton(`UNLOCK SLOT ${offer.slot}  •  ${offer.cost} COINS`, bottom + 27,
          () => this.showUpgradePurchaseConfirm('slot', vehicleId),
          {width: 326, height: 54, size: 13, fill: PALETTE.cyan, color: '#06151d',
            disabled: !offer.canBuy, disabledAlpha: 0.55,
            ...(compact && reason ? {subtitle: reason} : {})});
      });
      bottom += compact ? 60 : 66;
      if (reason && !compact) {
        const notice = this.addLabel(reason, W / 2, bottom, 11, '#b8c9d8', 326);
        bottom += notice.height + 14;
      }
    }
    return bottom;
  }

  addGarageWallet() {
    this.trackOverlayObject(addSteelControl(this, 300, 56, 100, 34, PALETTE.steelDark, PALETTE.steel, 33));
    this.addCurrency(this.profile.coins, 300, 56, {size: 16, maxWidth: 80});
  }

  addUpgradeHeader(title, subtitle) {
    this.panel('UPGRADES', '', {compactHeader: true});
    this.addGarageWallet();
    const headingY = 108;
    const heading = this.addLabel(title.toUpperCase(), W / 2, headingY, 22, '#a0f4ff', 294);
    const noteY = headingY + heading.height + 12;
    const note = this.addLabel(subtitle, W / 2, noteY, 12, '#b8c9d8', 294);
    return noteY + note.height + 18;
  }

  showVehicleDetail(vehicleId, message = '', isError = false) {
    const p = this.profile;
    const status = vehicleStatus(p, vehicleId);
    const state = p.shipStates[vehicleId];
    const stats = loadoutStats(p, vehicleId);
    const slots = state?.unlockedSlotCount ?? GAME_BALANCE.vehicles[vehicleId].baseEquipmentSlots;
    this.phase = 'vehicleDetail';
    this.shopChassisId = vehicleId;
    this.setScreenRenderer(() => this.showVehicleDetail(vehicleId, message, isError));
    this.setWorldVisible(false);
    this.panel('GARAGE', '', {compactHeader: true});
    this.addGarageWallet();
    this.addLabel('TRUCK PREVIEW  /  COLORS', W / 2, 108, 12, '#a0f4ff', 342);
    const layout = this.menuMetrics();
    this.createMenuScroll(`vehicle-detail:${vehicleId}`, 140, layout.contentBottom);
    let y = 148;
    if (message) {
      const notice = this.addLabel(message, W / 2, y, 12, isError ? '#ff9aa6' : '#6fe6bc', 326);
      y += notice.height + MENU_SPACING.gap;
    }
    this.withMenuScrollItem(y + 139, 278, () => {
      const card = addSteelControl(this, W / 2, y + 139, 326, 278,
        status.owned ? 0x12313b : PALETTE.steelDark, PALETTE.cyan, 33);
      this.trackOverlayObject(card);
      const display = this.add.image(273, y + 104, `garage_${vehicleId}_display`).setDepth(34);
      display.setScale(Math.min(140 / display.width, 140 / display.height));
      this.trackOverlayObject(display);
      this.addCardText(status.vehicle.name.toUpperCase().replace(' ', '\n'), 48, y + 38, 146,
        19, '#f8df8f', {maxHeight: 48});
      for (const [text, offset] of [[`CARGO ${stats.capacity}`, 74],
        [`STEERING ${Math.round(stats.vehicleSteeringMultiplier * 100)}%`, 112]]) {
        this.addCardText(text, 48, y + offset + 6, 146, 11, '#b8d9e8', {singleLine: true});
      }
      for (const [barY, ratio] of [[y + 96, stats.capacity / GAME_BALANCE.cargoProgression.capacityByRank.at(-1)],
        [y + 136, stats.vehicleSteeringMultiplier / GAME_BALANCE.vehicles.swift.steeringMultiplier]]) {
        this.trackOverlayObject(this.add.rectangle(60, barY, 122, 7, PALETTE.steelDark)
          .setOrigin(0, 0.5).setDepth(35));
        this.trackOverlayObject(this.add.rectangle(60, barY, 122 * Math.min(1, ratio), 7, PALETTE.cyan)
          .setOrigin(0, 0.5).setDepth(35));
      }
      this.addLabel(`${stats.capacity} cargo  •  ${stats.hull} Hull  •  ${stats.shieldCapacity} Shield`,
        W / 2, y + 186, 12, '#dfeaf3', 294);
      this.addLabel(`${slots} equipment slots  •  ${state?.equippedModuleIds.length ?? 0} installed`,
        W / 2, y + 211, 11, '#b8c9d8', 294);
      this.addLabel(status.owned ? 'CURRENT EQUIPMENT' : 'STARTING STATS',
        W / 2, y + 236, 10, '#a0f4ff', 294);
    });
    y += 290;
    const addDetailText = (text, size = 14, color = '#dfeaf3') => {
      const label = this.addLabel(text, W / 2, y, size, color,
        W - (MENU_SPACING.edge + MENU_SPACING.padding) * 2);
      y += label.height + MENU_SPACING.gap;
    };
    addDetailText(status.owned ? status.selected ? 'EQUIPPED' : 'OWNED'
      : status.canPurchase ? 'AVAILABLE TO PURCHASE' : 'LOCKED', 13,
    status.owned || status.canPurchase ? '#6fe6bc' : '#f2c474');
    addDetailText(status.vehicle.ability, 12, '#b8c9d8');
    if (status.owned) {
      addDetailText('Each truck keeps its own upgrades and colors.', 12, '#b8c9d8');
    } else {
      addDetailText(`${status.cost} Blueprints  •  ${p.blueprints} available`, 14, '#f2c474');
      if (!status.canPurchase) {
        addDetailText(status.lockReason ?? `Need ${status.cost - p.blueprints} more Blueprints.`, 13, '#f2c474');
      }
      addDetailText('Own this truck before buying or equipping its colors.', 12, '#b8c9d8');
    }
    addDetailText('COLORS  /  SELECT OR BUY', 12, '#a0f4ff');
    const trims = ['default', ...GAME_BALANCE.presentation.trimChoices,
      ...(vehicleId === 'standard' ? [GAME_BALANCE.rewards.level1NoDamageGold.colorId] : [])];
    for (const trimId of trims) {
      this.addTruckColorCard(vehicleId, trimId, y);
      y += 200 + MENU_SPACING.gap;
    }
    this.finishMenuScroll();
    this.addFooterActions([
      {label: status.owned ? status.selected ? 'EQUIPPED' : 'EQUIP'
        : status.canPurchase ? `BUY  ${status.cost} BP` : 'LOCKED',
      onClick: () => status.owned
        ? this.applyVehicleChange(selectVehicle(this.profile, vehicleId), 'Truck equipped.', vehicleId)
        : this.showVehiclePurchaseConfirm(vehicleId),
      options: {disabled: status.owned ? status.selected : !status.canPurchase, disabledAlpha: 1,
        fill: status.owned ? PALETTE.cyan : 0x9a6827, color: status.owned ? '#06151d' : '#ffffff'}},
      {label: 'BACK TO TRUCKS', onClick: () => this.showGarage('', false, 'garage'),
        options: {fill: PALETTE.steelDark}},
    ]);
  }

  addTruckColorCard(vehicleId, trimId, top) {
    const status = vehicleStatus(this.profile, vehicleId);
    const state = this.profile.shipStates[vehicleId];
    const gold = trimId === GAME_BALANCE.rewards.level1NoDamageGold.colorId;
    const owned = status.owned && Boolean(state?.ownedColorIds.includes(trimId));
    const equipped = owned && state.equippedColorId === trimId;
    const price = GAME_BALANCE.presentation.cosmeticPriceCoins[trimId];
    const canBuy = status.owned && !owned &&
      GAME_BALANCE.presentation.trimChoices.includes(trimId) && this.profile.coins >= price;
    this.withMenuScrollItem(top + 100, 200, () => {
      this.trackOverlayObject(addSteelControl(this, W / 2, top + 100, 326, 200,
        equipped ? 0x12313b : PALETTE.steelDark, gold ? PALETTE.gold : PALETTE.cyan, 33));
      addHaulerPreview(this, 91, top + 71, 0.9, vehicleId, trimId)
        .forEach(object => this.trackOverlayObject(object));
      const name = trimId === 'default' ? 'DEFAULT COLOR' : vehicleTrimName(vehicleId, trimId);
      this.addCardText(name, 146, top + 30, 180, 14,
        gold ? '#f8df8f' : '#f1f8ff', {maxHeight: 28});
      const description = gold
        ? 'Level 1 from Sector 1 in Standard Hauler • no damage'
        : owned ? 'Owned for this truck' : 'Per-truck cosmetic only';
      this.addLabel(description, 236, top + 52, 11, '#b8c9d8', 180).setLineSpacing(2);
      this.addLabel(gold ? 'ACHIEVEMENT COLOR  /  NOT FOR SALE' : trimId === 'default' ? 'INCLUDED WITH TRUCK' : owned ? 'OWNED'
        : `${price} COINS${canBuy ? '' : status.owned ? `  /  NEED ${price - this.profile.coins} MORE` : ''}`,
      W / 2, top + 115, 10, gold ? '#f8df8f' : '#f2c474', 294);
      const action = equipped ? 'EQUIPPED' : owned ? 'EQUIP COLOR'
        : !status.owned ? 'OWN TRUCK FIRST' : gold ? 'ACHIEVEMENT LOCKED' : `BUY COLOR  •  ${price} COINS`;
      this.addButton(action, top + 157, () => owned
        ? this.applyVehicleChange(selectVehicleTrim(this.profile, vehicleId, trimId), 'Color equipped.', vehicleId)
        : this.showTrimPurchaseConfirm(vehicleId, trimId),
      {width: 294, height: 54, size: 13, disabled: equipped || (!owned && !canBuy),
        disabledAlpha: equipped ? 1 : 0.65, fill: owned ? PALETTE.cyan : 0x9a6827,
        color: owned ? '#06151d' : '#ffffff'});
    });
  }

  showVehiclePurchaseConfirm(vehicleId) {
    const status = vehicleStatus(this.profile, vehicleId);
    if (!status.canPurchase) {
      this.showVehicleDetail(vehicleId,
        status.lockReason ?? `Need ${status.cost - this.profile.blueprints} more Blueprints.`, true);
      return;
    }
    const name = status.vehicle.name.toUpperCase();
    this.phase = 'vehiclePurchaseConfirm';
    this.setScreenRenderer(() => this.showVehiclePurchaseConfirm(vehicleId));
    this.setWorldVisible(false);
    this.panel(`CONFIRM ${name}`, 'Review the permanent Blueprint purchase.');
    const layout = this.menuMetrics();
    this.createMenuScroll(`vehicle-confirm:${vehicleId}`, layout.contentTop, layout.contentBottom);
    const centering = Math.max(0, (layout.contentBottom - layout.contentTop - 118) / 2);
    this.addLabel(`${status.cost} Blueprints  •  ${this.profile.blueprints} available`,
      W / 2, layout.contentTop + centering + 16, 14, '#f2c474', 330);
    this.addLabel('Purchase unlocks this ship for future runs. Existing ownership and loadouts stay unchanged.',
      W / 2, layout.contentTop + centering + 54, 13, '#dfeaf3', 334);
    this.finishMenuScroll();
    this.addFooterActions([
      {label: `CONFIRM  ${status.cost} BP`,
        onClick: () => this.applyVehicleChange(purchaseVehicle(this.profile, vehicleId), 'Truck purchased.', vehicleId)},
      {label: 'BACK', onClick: () => this.showVehicleDetail(vehicleId)},
    ]);
  }

  showTrimPurchaseConfirm(vehicleId, trimId) {
    if (!GAME_BALANCE.presentation.trimChoices.includes(trimId)) throw new Error(`Invalid purchasable trim ${trimId}`);
    const status = vehicleStatus(this.profile, vehicleId);
    const price = GAME_BALANCE.presentation.cosmeticPriceCoins[trimId];
    if (!status.owned || this.profile.coins < price ||
        this.profile.shipStates[vehicleId].ownedColorIds.includes(trimId)) {
      this.showVehicleDetail(vehicleId, 'This color is no longer available to purchase.', true);
      return;
    }
    this.phase = 'trimPurchaseConfirm';
    this.setScreenRenderer(() => this.showTrimPurchaseConfirm(vehicleId, trimId));
    this.setWorldVisible(false);
    this.panel('GARAGE', '', {compactHeader: true});
    this.addGarageWallet();
    this.addLabel('CONFIRM COLOR PURCHASE', W / 2, 108, 12, '#a0f4ff', 342);
    const layout = this.menuMetrics();
    this.createMenuScroll(`trim-confirm:${vehicleId}:${trimId}`, layout.contentTop, layout.contentBottom);
    const centering = Math.max(0, (layout.contentBottom - layout.contentTop - 170) / 2);
    this.trackOverlayObject(addSteelControl(this, W / 2, layout.contentTop + centering + 86,
      326, 184, PALETTE.steelDark, PALETTE.cyan, 33));
    addHaulerPreview(this, W / 2, layout.contentTop + centering + 40, 0.8, vehicleId, trimId)
      .forEach(object => this.trackOverlayObject(object));
    this.addLabel(vehicleTrimName(vehicleId, trimId), W / 2, layout.contentTop + centering + 88,
      14, '#dfeaf3', 320);
    this.addLabel(`Price: ${price} Coins  •  Wallet after: ${this.profile.coins - price} Coins`,
      W / 2, layout.contentTop + centering + 120, 12, '#f2c474', 330);
    this.finishMenuScroll();
    this.addFooterActions([
      {label: `CONFIRM  ${price} COINS`, onClick: () => this.applyVehicleChange(
        buyVehicleTrim(this.profile, vehicleId, trimId), 'Color purchased. Select it to equip.', vehicleId)},
      {label: 'BACK', onClick: () => this.showVehicleDetail(vehicleId)},
    ]);
  }

  showUpgradePurchaseConfirm(kind, vehicleId = this.profile.selectedVehicleId, moduleId = null) {
    let title;
    let description;
    let price;
    let apply;
    let returnToDetail = null;
    let confirmModuleId = null;
    let canAfford = true;
    let successMessage;
    let iconId = null;
    if (kind === 'capacity') {
      const status = cargoCapacityStatus(this.profile);
      if (status.atMax) return this.showUpgradeDetail('capacity', 'capacity');
      title = 'CARGO CAPACITY';
      const offset = GAME_BALANCE.vehicles[vehicleId].cargoCapacityOffset ?? 0;
      description = `${status.capacity + offset} → ${status.nextCapacity + offset} cargo when equipped`;
      price = status.cost;
      canAfford = status.canAfford;
      iconId = CARGO_CAPACITY_ID;
      confirmModuleId = CARGO_CAPACITY_ID;
      apply = () => upgradeCargoCapacity(this.profile, vehicleId);
      successMessage = after => {
        const cargo = cargoCapacityStatus(after, vehicleId);
        const name = cargo.atMax ? 'Tier 2 Reinforced Cargo Hold' : 'Cargo Capacity';
        return cargo.equipped ? `${name} upgraded and equipped.`
          : `${name} upgraded. Equip it in a free slot to use the bonuses.`;
      };
      returnToDetail = () => this.showUpgradeDetail('capacity', 'capacity');
    } else if (kind === 'reinforcement') {
      const status = reinforcedCargoStatus(this.profile, vehicleId);
      if (!status.unlocked || status.atMax) return this.showUpgradeDetail('reinforcement', 'reinforcement');
      title = 'REINFORCED CARGO HOLD';
      const capacity = cargoCapacityStatus(this.profile, vehicleId);
      const offset = GAME_BALANCE.vehicles[vehicleId].cargoCapacityOffset ?? 0;
      description = `Lose ${Math.round(status.nextMitigation * 100)}% less cargo value when hit.\nKeep ${capacity.capacity + offset} cargo slots. Equip it in one slot to use both bonuses.`;
      price = status.cost;
      canAfford = status.canAfford;
      iconId = CARGO_CAPACITY_ID;
      confirmModuleId = CARGO_CAPACITY_ID;
      apply = () => upgradeReinforcedCargo(this.profile);
      returnToDetail = () => this.showUpgradeDetail('reinforcement', 'reinforcement');
      successMessage = after => reinforcedCargoStatus(after, vehicleId).equipped
        ? 'Reinforced Cargo Hold upgraded. Capacity and protection are equipped in one slot.'
        : 'Reinforced Cargo Hold upgraded. Equip it to use capacity and protection together.';
    } else if (kind === 'module') {
      if (!moduleId) throw new Error('Module confirmation requires a module ID');
      const status = moduleStatus(this.profile, moduleId, vehicleId);
      if (!status.unlocked || status.atMax || status.capped) {
        return this.showUpgradeDetail('module', moduleId);
      }
      confirmModuleId = moduleId;
      iconId = moduleId;
      const maxRank = status.def.benefit.values.length;
      title = status.owned ? `UPGRADE ${status.def.name}` : `BUY ${status.def.name}`;
      description = status.owned
        ? `Level ${status.level} → ${status.level + 1} of ${maxRank}`
        : `Buy Level 1 of ${maxRank}`;
      description += `\n${garageUpgradeBenefit(status.def.benefit.stat,
        status.def.benefit.values[status.owned ? status.level : 0])}`;
      price = status.owned ? status.upgradeCost : status.def.price;
      canAfford = this.profile.coins >= price;
      apply = () => status.owned
        ? upgradeModule(this.profile, moduleId)
        : buyModule(this.profile, moduleId, vehicleId);
      returnToDetail = () => this.showUpgradeDetail('module', moduleId);
      successMessage = status.owned ? `Upgraded ${status.def.name}.`
        : after => after.shipStates[vehicleId].equippedModuleIds.includes(moduleId)
          ? `${status.def.name} bought and equipped!`
          : `${status.def.name} bought. Slots are full; equip it in an open slot.`;
    } else if (kind === 'slot') {
      const offer = nextSlotOffer(this.profile, vehicleId);
      if (!offer?.reached) return this.showGarage('', false, this.garageTab);
      title = `EQUIPMENT SLOT ${offer.slot}`;
      description = `Equip one more upgrade on ${VEHICLES.find(vehicle => vehicle.id === vehicleId).name}.`;
      price = offer.cost;
      canAfford = offer.canBuy;
      apply = () => unlockNextSlot(this.profile, vehicleId);
      returnToDetail = () => this.showGarage('', false, this.garageTab);
    } else throw new Error(`Unknown upgrade confirmation: ${kind}`);

    this.phase = 'upgradePurchaseConfirm';
    this.setScreenRenderer(() => this.showUpgradePurchaseConfirm(kind, vehicleId, moduleId));
    this.setWorldVisible(false);
    const contentTop = this.addUpgradeHeader(title, 'CHECK YOUR PURCHASE');
    const layout = this.menuMetrics();
    this.createMenuScroll(`confirm:${kind}:${moduleId ?? vehicleId}`, contentTop, layout.contentBottom);
    let y = contentTop + 44;
    if (iconId) {
      this.addGarageUpgradeIcon(iconId, W / 2, y, 72);
    }
    y += iconId ? 50 : 12;
    const descriptionLabel = this.addLabel(description, W / 2, y, 13, '#b8c9d8', 340);
    y += descriptionLabel.height + 16;
    this.addLabel(`Price  ${price} Coins`, W / 2, y, 14, '#f2c474', 340);
    y += 24;
    this.addLabel(canAfford ? `Coins left: ${this.profile.coins - price}` : 'Not enough Coins yet.',
      W / 2, y, 12, '#b8c9d8', 340);
    if (!canAfford) {
      y += 24;
      this.addLabel(`You need ${price - this.profile.coins} more Coins.`,
        W / 2, y, 11, '#f2c474', 340);
    }
    this.finishMenuScroll();
    this.addFooterActions([
      {label: `CONFIRM  ${price} COINS`,
        onClick: () => this.applyShop(apply(), confirmModuleId,
          successMessage ?? `${title} purchased.`),
        options: {fill: PALETTE.cockpit, disabled: !canAfford}},
      {label: 'BACK', onClick: returnToDetail},
    ], {height: 54});
  }

  applyVehicleChange(result, successMessage = 'Vehicle update saved.', detailVehicleId = null) {
    const showResult = (message, isError) => detailVehicleId
      ? this.showVehicleDetail(detailVehicleId, message, isError) : this.showShips(message, isError);
    if (result.ok && !this.persistProfile(result.profile)) {
      showResult('Could not save the change. No progress was applied; check storage and retry.', true);
      return;
    }
    if (result.ok) this.profile = result.profile;
    showResult(result.ok ? successMessage : result.reason, !result.ok);
  }

  showModuleDetail(id, message = '', isError = false) {
    this.showUpgradeDetail(id === CARGO_CAPACITY_ID ? 'capacity' : 'module', id, message, isError);
  }

  showUpgradeDetail(kind, id, message = '', isError = false) {
    const p = this.profile;
    const chassisId = this.shopChassisId ?? p.selectedVehicleId;
    const cargo = cargoCapacityStatus(p, chassisId);
    if (kind === 'capacity' || kind === 'reinforcement') {
      kind = cargo.atMax ? 'reinforcement' : 'capacity';
      id = kind;
    }
    const module = kind === 'module' ? moduleStatus(p, id, chassisId) : null;
    const capacity = kind === 'capacity' ? cargo : null;
    const reinforcement = kind === 'reinforcement' ? reinforcedCargoStatus(p, chassisId) : null;
    if (!module && !capacity && !reinforcement) throw new Error(`Unknown upgrade detail: ${kind}/${id}`);
    const detailTitle = module?.def.name ?? (capacity ? 'Cargo Capacity' : 'Reinforced Cargo Hold');
    this.phase = 'upgradeDetail';
    this.setScreenRenderer(() => this.showUpgradeDetail(kind, id, message, isError));
    this.setWorldVisible(false);
    const contentTop = this.addUpgradeHeader(detailTitle,
      module ? `Level ${module.level}/${module.def.benefit.values.length}  •  ${FAMILY_LABELS[module.def.family]}`
        : capacity ? `Rank ${capacity.rank}/${capacity.maxRank}  •  Cargo`
          : `Level ${reinforcement.rank}/${reinforcement.maxRank}  •  Cargo`);
    const layout = this.menuMetrics();
    this.createMenuScroll(`upgrade-detail:${kind}:${id}`, contentTop, layout.contentBottom);
    let y = contentTop + 8;
    this.addGarageUpgradeIcon(module?.def.id ?? CARGO_CAPACITY_ID, W / 2, y + 36, 72);
    y += 86;
    if (this.tutorialGarageFocus && id === 'hand_precision') {
      const payout = this.addLabel('ROOKIE TRIAL CLEAR  •  +0 COINS  •  +0 BP',
        W / 2, y, 13, '#f8df8f', 340);
      this.tweens.addCounter({from: 0, to: this.tutorialPayout?.coins ?? 0, duration: 900,
        ease: 'Cubic.easeOut', onUpdate: tween => payout.setText(
          `ROOKIE TRIAL CLEAR  •  +${Math.floor(tween.getValue())} COINS  •  +${this.tutorialPayout?.blueprints ?? 0} BP`)});
      y += payout.height + 10;
      const guidance = this.addLabel('Buy Rank 1 below. It will equip automatically.',
        W / 2, y, 12, '#6fe6bc', 340);
      y += guidance.height + 12;
    }
    const addDetailText = (text, size = 14, color = '#dfeaf3') => {
      const label = this.addLabel(text, W / 2, y, size, color, W - (MENU_SPACING.edge + MENU_SPACING.padding) * 2);
      y += label.height + 12;
    };
    if (module) {
      const {def} = module;
      const maxRank = def.benefit.values.length;
      addDetailText(MODULE_CAPTIONS[id], 14);
      addDetailText(module.unlocked ? 'AVAILABLE' : 'HOW TO UNLOCK', 12, '#a0f4ff');
      addDetailText(module.requirement.description, 14,
        module.unlocked ? '#c2d0dc' : '#f2c474');
      if (module.grandfathered) {
        addDetailText('You already own this upgrade and can still use it.', 12, '#6fe6bc');
      }
      if (module.owned) addDetailText(`Now: ${garageUpgradeBenefit(def.benefit.stat, def.benefit.values[module.level - 1])}`, 14, '#a0f4ff');
      if (!module.atMax) {
        addDetailText(`${module.owned ? 'Next' : 'Level 1'}: ${garageUpgradeBenefit(def.benefit.stat,
          def.benefit.values[module.owned ? module.level : 0])}`, 14, '#a0f4ff');
      }
      addDetailText(`Max: ${garageUpgradeBenefit(def.benefit.stat, def.benefit.values[maxRank - 1])}`, 13, '#b8c9d8');
      if (def.drawback) addDetailText(`Also: ${garageUpgradeBenefit(def.drawback.stat, def.drawback.value)}`, 13, '#f2c474');
      if (!module.unlocked) {
        if (!module.owned) addDetailText(`Purchase price after unlocking: ${def.price} Coins`, 12, '#b8c9d8');
      } else if (module.capped) {
        addDetailText(`Next level unlock: ${module.capReason}`, 12, '#f2c474');
        addDetailText(`Upgrade price after unlocking: ${upgradeCost(def.upgradeBase, module.level)} Coins`,
          12, '#b8c9d8');
      }
      else if (!module.owned) addDetailText(`Purchase price: ${def.price} Coins`, 12, '#f2c474');
      else if (!module.atMax) addDetailText(`Upgrade price: ${module.upgradeCost} Coins`, 12, '#f2c474');
      if (module.unlocked && !module.capped && !module.atMax) {
        const price = module.owned ? module.upgradeCost : def.price;
        if (p.coins < price) addDetailText(`You need ${price - p.coins} more Coins.`, 11, '#f2c474');
      }
      if (message) addDetailText(message, 11, isError ? '#ff9aa6' : '#6fe6bc');
      if (!module.unlocked || module.capped) {
        addDetailText('Meet the goal above to buy the next level.', 13, '#b8c9d8');
      } else if (module.atMax) {
        addDetailText('Maximum rank reached.', 12, '#6fe6bc');
      } else {
        const owned = module.owned;
        const price = owned ? module.upgradeCost : def.price;
        const canAfford = p.coins >= price;
        const label = owned ? `UPGRADE TO LV ${module.level + 1}` : 'BUY UPGRADE';
        this.withMenuScrollItem(y + 27, 54, () => this.addButton(label,
          y + 27, () => this.showUpgradePurchaseConfirm('module', chassisId, id),
          {width: 326, height: 54, size: 13,
            fill: canAfford ? PALETTE.cockpit : PALETTE.steelDark, disabled: !canAfford}));
        y += 68;
      }
    } else if (capacity) {
      const baseline = GAME_BALANCE.cargoProgression.capacityByRank[0] +
        (GAME_BALANCE.vehicles[chassisId].cargoCapacityOffset ?? 0);
      const bonus = capacity.capacity - GAME_BALANCE.cargoProgression.capacityByRank[0];
      if (message) addDetailText(message, 12, isError ? '#ff9aa6' : '#6fe6bc');
      addDetailText('EQUIPMENT • USES ONE SLOT');
      addDetailText('Carry more cargo. Equip this upgrade to use the extra space.');
      addDetailText(`Unequipped: ${baseline} cargo. Equipped: ${baseline + bonus} cargo.`, 13);
      addDetailText('Bought ranks work on any truck when equipped.', 13);
      addDetailText(`Reach rank ${capacity.maxRank} to unlock cargo protection. No extra equipment slot needed.`, 13, '#80db99');
      if (capacity.atMax) addDetailText('Maximum capacity reached.', 12, '#6fe6bc');
      else {
        addDetailText(`Next rank when equipped: ${baseline + capacity.nextCapacity -
          GAME_BALANCE.cargoProgression.capacityByRank[0]} cargo. Cost: ${capacity.cost} Coins.`, 12, '#f2c474');
        if (!capacity.canAfford) {
          addDetailText(`You need ${capacity.cost - p.coins} more Coins.`, 11, '#f2c474');
        }
        this.withMenuScrollItem(y + 27, 54, () => this.addButton('UPGRADE CAPACITY',
          y + 27, () => this.showUpgradePurchaseConfirm('capacity', chassisId),
          {width: 326, height: 54, size: 13, disabled: !capacity.canAfford}));
        y += 68;
      }
    } else {
      if (message) addDetailText(message, 12, isError ? '#ff9aa6' : '#6fe6bc');
      const offset = GAME_BALANCE.vehicles[chassisId].cargoCapacityOffset ?? 0;
      addDetailText('TIER 2 EQUIPMENT • USES ONE SLOT', 13, '#80db99');
      addDetailText(`Carry ${cargo.capacity + offset} cargo and lose less cargo value when hit.`);
      addDetailText('Equip this upgrade for both bonuses. Removing it turns both off.');
      addDetailText(`Unequipped: ${GAME_BALANCE.cargoProgression.capacityByRank[0] + offset} cargo and no hold protection.`, 12, '#b8c9d8');
      addDetailText(`Now: ${garageUpgradeBenefit('insurance', reinforcement.mitigation)}.`, 14, '#00f0ff');
      if (!reinforcement.atMax) {
        addDetailText(`Next: ${garageUpgradeBenefit('insurance', reinforcement.nextMitigation)}.`, 12);
        addDetailText(`Upgrade price: ${reinforcement.cost} Coins.`, 12, '#b8c9d8');
      }
      if (reinforcement.atMax) {
        addDetailText('Maximum level reached.', 12, '#6fe6bc');
      } else {
        if (!reinforcement.canAfford) {
          addDetailText(`You need ${reinforcement.cost - p.coins} more Coins.`, 11, '#f2c474');
        }
        this.withMenuScrollItem(y + 27, 54, () => this.addButton(`UPGRADE TO LV ${reinforcement.rank + 1}`,
          y + 27, () => this.showUpgradePurchaseConfirm('reinforcement', chassisId),
          {width: 326, height: 54, size: 13, disabled: !reinforcement.canAfford}));
        y += 68;
      }
    }
    const equipment = module ?? capacity ?? reinforcement;
    if (equipment) {
      const equipmentId = module ? id : CARGO_CAPACITY_ID;
      const state = p.shipStates[chassisId];
      const openSlots = state.unlockedSlotCount - state.equippedModuleIds.length;
      addDetailText(equipment.equipped ? 'EQUIPPED • READY FOR YOUR NEXT RUN' : equipment.owned ? 'OWNED • EQUIP TO USE' : 'BUY IT, THEN EQUIP TO USE', 12, '#a0f4ff');
      addDetailText(`Upgrade slots: ${state.equippedModuleIds.length}/${state.unlockedSlotCount} used • ${openSlots} free`,
        12, '#b8c9d8');
      if (equipment.owned) {
        const canEquip = equipment.equipped || openSlots > 0;
        if (!canEquip) addDetailText('All equipment slots are full. Unequip equipment to free one.', 12, '#f2c474');
        this.withMenuScrollItem(y + 27, 54, () => this.addButton(equipment.equipped ? 'UNEQUIP' : 'EQUIP',
          y + 27, () => this.applyShop(equipment.equipped
            ? unequipModule(this.profile, equipmentId, chassisId)
            : equipModule(this.profile, equipmentId, chassisId), equipmentId,
          equipment.equipped ? 'Unequipped. Slot is free.' : 'Equipped for the next run.'),
          {width: 326, height: 54, size: 14, fill: equipment.equipped ? 0x5a4a34 : 0x276f78,
            disabled: !canEquip}));
      }
    }
    this.finishMenuScroll();
    this.addFooterButton('BACK TO UPGRADES',
      () => this.showGarage('', false, 'upgrades'), {fill: PALETTE.steelDark, height: 54, size: 13});
  }

  applyShop(result, moduleId, successMessage) {
    if (result.ok) {
      const finishingTutorial = this.tutorialGarageFocus && moduleId === 'hand_precision';
      const profile = finishingTutorial ? {...result.profile, tutorialCompleted: true} : result.profile;
      if (!this.persistProfile(profile)) {
        const message = 'Purchase could not be saved. No Coins charged; check storage and retry.';
        if (moduleId) this.showModuleDetail(moduleId, message, true);
        else this.showGarage(message, true);
        return;
      }
      this.profile = profile;
      if (finishingTutorial) {
        this.tutorialGarageFocus = false;
        this.showMenu();
        return;
      }
    }
    const message = !result.ok ? result.reason
      : typeof successMessage === 'function' ? successMessage(result.profile) : successMessage;
    if (moduleId) this.showModuleDetail(moduleId, message, !result.ok);
    else this.showGarage(message, !result.ok);
  }

  keyboardSteeringDirection() {
    const keys = this.steeringKeys;
    const left = Boolean(keys?.A?.isDown || keys?.LEFT?.isDown);
    const right = Boolean(keys?.D?.isDown || keys?.RIGHT?.isDown);
    return left || right ? Number(right) - Number(left) : null;
  }

  updateSteeringInput() {
    if (this.debugManager?.flags.bot) {
      this.shipTargetX = this.debugManager.botTarget(this);
      this.steeringInputMode = 'bot';
      return false;
    }
    const direction = this.keyboardSteeringDirection();
    if (direction !== null) {
      this.steeringInputMode = 'keyboard';
      if (direction !== 0) {
        this.keyboardBrakeRemaining = KEYBOARD_BRAKE_SECONDS;
        this.shipTargetX = direction < 0 ? ROAD_LEFT + 30 : ROAD_RIGHT - 30;
        return false;
      }
    }
    const braking = this.steeringInputMode === 'keyboard';
    if (braking) this.shipTargetX = this.ship.x;
    else this.keyboardBrakeRemaining = KEYBOARD_BRAKE_SECONDS;
    return braking;
  }

  beginSteering(pointer) {
    const point = this.menuPointerPoint(pointer);
    const hudHeight = 78 * Math.min((this.scale?.width ?? W) / W, 1.12);
    if (this.debugManager?.flags.bot || this.phase !== 'running' || pointer.y <= hudHeight ||
        this.keyboardSteeringDirection() !== null) return;
    this.steeringPointerId = pointer.id;
    this.steeringInputMode = 'pointer';
    this.shipTargetX = Phaser.Math.Clamp(point.x, ROAD_LEFT + 30, ROAD_RIGHT - 30);
  }

  handlePointerUp(pointer) {
    this.endMenuScroll(pointer);
    this.steeringPointerId = null;
    if (pointer.wasTouch && this.phase === 'running' &&
        this.time.now >= (this.touchPauseBlockedUntil ?? 0)) this.pauseRun();
  }

  handlePauseKey(event) {
    if (event?.repeat) return;
    if (this.phase === 'tutorialPaused') {
      this.resumeTutorialCheckpoint();
      return;
    }
    if (this.phase === 'running') this.pauseRun();
    else if (this.phase === 'paused') this.beginResumeCountdown();
  }

  showPauseOverlay(title, dimAlpha, panelHeight = 0) {
    this.clearOverlay();
    this.pauseDimmer = this.add.rectangle(W / 2, H / 2, W, H, 0x07121d, dimAlpha)
      .setDepth(101).setScrollFactor(0);
    this.overlayObjects.push(this.pauseDimmer);
    if (panelHeight > 0) {
      this.overlayObjects.push(addSteelControl(this, W / 2, H / 2, 326, panelHeight,
        PALETTE.edge, PALETTE.cyan, 110).setAlpha(0.75));
    }
    const titleY = panelHeight > 0 ? H / 2 - panelHeight / 2 + 18 : H / 2 - 136;
    return this.addLabel(title, W / 2, titleY, 24, colorText(PALETTE.cyanLight), W - 48).setDepth(112);
  }

  pauseRun() {
    if (this.phase !== 'running') return;
    this.phase = 'paused';
    this.steeringPointerId = null;
    this.keyboardBrakeRemaining = 0;
    this.feedback?.suspend('manualPause');
    this.showPauseMenu();
  }

  showPauseMenu(fade = true) {
    this.phase = 'paused';
    this.showPauseOverlay('PAUSED', 0.2, 272);
    this.addButton('RESUME RUN', H / 2 - 44, () => this.beginResumeCountdown(),
      {width: 286, height: 48, size: 13, fill: PALETTE.steelDark, depth: 112});
    // Phaser's WebAudio mute getter reads a gain that setMute schedules asynchronously, so keep our own state.
    this.soundMuted ??= Boolean(this.sound.mute);
    this.addButton(`SOUND: ${this.soundMuted ? 'OFF' : 'ON'}`, H / 2 + 16, () => {
      this.soundMuted = !this.soundMuted;
      this.sound.setMute(this.soundMuted);
      this.showPauseMenu(false);
    }, {width: 286, height: 48, size: 13, fill: PALETTE.steelDark, depth: 112});
    this.addButton('END RUN', H / 2 + 76, () => this.showPauseEndRunConfirmation(),
      {width: 286, height: 48, size: 13, fill: PALETTE.hazardDark, depth: 112});
    if (fade) this.fadeOverlayIn();
  }

  showPauseEndRunConfirmation() {
    if (this.phase !== 'paused') return;
    this.phase = 'pauseEndConfirm';
    const panelHeight = 384;
    const top = H / 2 - panelHeight / 2;
    this.showPauseOverlay('END RUN?', 0.18, panelHeight);
    const hold = cargoTotals(this.cargoItems).value;
    const secured = this.runEconomy.cargoCoins + this.runEconomy.bonusCoins;
    const continuous = this.runMode === 'continuous';
    const risk = continuous
      ? hold + continuousQuote(this.cargoItems, this.runEconomy).bonus
      : bankingQuote(this.cargoItems, this.runEconomy).payout + this.runEconomy.noDamageBonusPending;

    const confirmationPlate = this.add.rectangle(W / 2, top + 180, 302, 228, PALETTE.edge, 0.75)
      .setStrokeStyle(1, PALETTE.hazard, 0.9).setDepth(110);
    this.overlayObjects.push(confirmationPlate);
    this.addLabel('BANKED THIS RUN  /  SAFE', W / 2, top + 90, 13, '#6fe6bc', 280).setDepth(112);
    this.addCurrency(secured, W / 2, top + 122, {size: 23, color: '#6fe6bc', maxWidth: 250, depth: 113});
    this.addLabel(`WALLET REMAINS ${this.profile.coins} COINS`, W / 2, top + 150, 11, '#b8c9d8', 280).setDepth(112);
    this.addLabel('UNBANKED CARGO', W / 2, top + 184, 13, '#f2c474', 280).setDepth(112);
    this.addCurrency(hold, W / 2, top + 216, {size: 23, color: '#f2c474', maxWidth: 250, depth: 113});
    this.addLabel(continuous
      ? `END NOW: LOSE ${risk} COINS  •  CASH OUT AT A DEPOT TO EARN`
      : `END NOW: LOSE ${risk} COINS INCLUDING BONUSES`,
    W / 2, top + 250, 14, '#ff9aa6', 280).setDepth(112);
    this.addFooterActions([
      {label: 'BACK TO PAUSE', onClick: () => this.showPauseMenu(),
        options: {fill: PALETTE.steelDark}},
      {label: 'END RUN', onClick: () => this.finishRun(false, false, true),
        options: {fill: PALETTE.hazardDark}},
    ], {depth: 112, y: top + panelHeight - 38, span: 290});
    this.fadeOverlayIn();
  }

  beginResumeCountdown() {
    if (this.phase !== 'paused') return;
    this.phase = 'resumeCountdown';
    this.resumeCountdownElapsed = 0;
    const panelHeight = 170;
    const title = this.showPauseOverlay('GET READY', 0.2, panelHeight);
    // Center the digit in the panel space below the title so it never spills past the tile.
    const top = title.y + title.displayHeight + MENU_SPACING.gap / 2;
    const bottom = H / 2 + panelHeight / 2 - MENU_SPACING.padding;
    const countdown = this.addLabel('3', W / 2, (top + bottom) / 2, 76,
      colorText(PALETTE.cyanLight), 160).setOrigin(0.5).setDepth(112);
    countdown.setScale(Math.min(countdown.scaleX, (bottom - top) / Math.max(1, countdown.height)));
    this.pauseCountdownText = countdown;
    this.fadeOverlayIn();
  }

  moveSteering(pointer) {
    if (this.debugManager?.flags.bot || this.phase !== 'running' || this.keyboardSteeringDirection() !== null) return;
    const mouse = !pointer.wasTouch && !this.sys?.game?.device?.input?.touch;
    if (!mouse && !(pointer.isDown && this.steeringPointerId === pointer.id)) return;
    const point = this.menuPointerPoint(pointer);
    if (mouse && pointer.y <= 78 * Math.min((this.scale?.width ?? W) / W, 1.12)) return;
    this.steeringInputMode = 'pointer';
    this.shipTargetX = Phaser.Math.Clamp(mouse && Number.isFinite(pointer.worldX) ? pointer.worldX : point.x,
      ROAD_LEFT + 30, ROAD_RIGHT - 30);
  }

  newRunSeed() {
    return (Date.now() ^ Math.imul(this.profile.totalRuns + 1, 0x9e3779b9)) >>> 0;
  }

  /** Slow-to-plan starts begin route planning while their button is on screen, so driving never waits. */
  prepareRunStream(levelId, mode, startDistance) {
    this.preparedRunStreams ??= new Map();
    const key = `${levelId}:${mode}:${startDistance}`;
    if (this.preparedRunStreams.has(key)) return;
    const seed = this.newRunSeed();
    const firstDistance = this.predictRouteDistance(startDistance,
      GAME_BALANCE.routes.spawning.initialRowDelaySeconds, {levelId, mode});
    this.preparedRunStreams.set(key, {seed,
      stream: createRouteStream(seed, levelId, mode, {startDistance, firstDistance})});
  }

  takeRunStream(levelId, mode, startDistance) {
    const prepared = this.preparedRunStreams?.get(`${levelId}:${mode}:${startDistance}`) ?? null;
    for (const entry of this.preparedRunStreams?.values() ?? []) {
      if (entry !== prepared) entry.stream.destroy?.();
    }
    this.preparedRunStreams?.clear();
    return prepared;
  }

  startRun(start = 'beginning', levelId = 'level1', mode = 'normal', developerOptions = null,
    {tutorial = false} = {}) {
    if ((this.debugManager?.active || this.godMode) && developerOptions === null) {
      developerOptions = {sectorNumber: start === 'checkpoint' ? 3 : 1,
        vehicleId: this.profile.selectedVehicleId};
    }
    const developerRun = developerOptions !== null;
    if (developerRun && (!GAME_BALANCE.progression.levelIds.includes(levelId) ||
        !Number.isInteger(developerOptions.sectorNumber) || developerOptions.sectorNumber < 1 ||
        developerOptions.sectorNumber > IMPLEMENTED_LEVELS[levelId].length ||
        !this.profile.ownedVehicleIds.includes(developerOptions.vehicleId))) {
      throw new Error('Invalid developer run selection');
    }
    const checkpointStart = start === 'checkpoint';
    const levelProgress = this.profile.levelProgress[levelId];
    if (!developerRun && !isRunStartAvailable(this.profile, levelId, start, mode)) {
      if (!isLevelUnlocked(this.profile, levelId)) {
        this.showToast(`Finish Level 1 to unlock ${levelDisplayName(levelId)}.`, 'warning');
      } else if (checkpointStart) {
        this.showToast(`Reach Sector 3 in ${levelDisplayName(levelId)} before using this start.`, 'warning');
      } else {
        this.showToast('This run start is unavailable.', 'warning');
      }
      return;
    }
    this.clearOverlay();
    this.removeObjects();
    this.removeDepotFacilities();
    this.phase = 'running';
    this.resumeCountdownElapsed = null;
    this.pauseCountdownText = null;
    this.touchPauseBlockedUntil = 0;
    this.levelId = levelId;
    this.runMode = mode;
    this.feedback?.startRunMusic?.(true,
      this.cache?.audio?.get?.(mode === 'continuous' ? 'cargo_endless_music' : 'cargo_run_music'));
    this.developerRun = developerRun;
    this.tutorialRun = tutorial;
    this.tutorialSpeed = 0;
    this.tutorialBlueprintsCollected = 0;
    this.developerSandbox = developerOptions?.sandbox === true;
    this.vehicleId = developerOptions?.vehicleId ?? this.profile.selectedVehicleId;
    this.startDistance = developerRun
      ? GAME_BALANCE.routes[levelId].sectorStartsMeters[developerOptions.sectorNumber - 1]
      : mode === 'continuous'
      ? 0
      : checkpointStart ? checkpointDistance(levelId) : 0;
    this.distance = this.startDistance;
    this.checkpointStart = !developerRun && checkpointStart;
    this.finishNoticeShown = false;
    this.finishObstaclesCleared = false;
    this.depotCount = 0;
    const runId = crypto.getRandomValues(new Uint32Array(4)).join('-');
    const runMetadata = {
      runId,
      levelId,
      mode,
      vehicleId: this.vehicleId,
      startDistance: this.startDistance,
      fullStart: mode === 'normal' && !checkpointStart && !tutorial,
      checkpointStart: mode === 'normal' && checkpointStart,
      recordAtStart: levelProgress.bestDistance,
      checkpointRecordAtStart: levelProgress.checkpointBestDistance,
    };
    this.runEconomy = createRunEconomy(developerRun ? markDeveloperRun(runMetadata) : runMetadata);
    this.runContext = createRunContext();
    this.depotVisit = null;
    this.depotMotion = null;
    this.depotLaunchElapsed = null;
    this.runResult = null;
    this.steeringPointerId = null;
    this.nextDepot = tutorial
      ? {distance: 500, transition: true, side: 'right'}
      : nextDepotAfter(this.distance, DEPOT_RULES, levelId, mode);
    this.nextDepotDistance = this.nextDepot.distance;
    this.protectedUntilDistance = 0;
    this.cargoItems = [];
    this.syncCargoTotals();
    this.sandboxSpawnLane = 0;
    this.devReadout = null;
    this.centerShip();
    this.feedback?.resetRun(this.ship.x);
    this.debugManager?.resetBot(this.ship.x);
    const prepared = tutorial ? null : this.takeRunStream(levelId, mode, this.distance);
    const seed = prepared?.seed ?? this.newRunSeed();
    this.runSeed = seed;
    this.shoulderSignIndex = 0;
    this.nextShoulderSignDistance = this.distance + NEON_SHOULDER_SIGNS.firstMeters;
    this.trackStream?.destroy?.();
    const firstRowDelay = GAME_BALANCE.routes.spawning.initialRowDelaySeconds;
    this.trackStream = tutorial ? this.createRookieTrialStream(this.distance)
      : prepared?.stream ?? createRouteStream(seed, levelId, mode, {startDistance: this.distance,
        firstDistance: this.predictRouteDistance(this.distance, firstRowDelay)});
    this.lateRouteRows = 0;
    this.resumeSpawnDistance = null;
    this.blueprintRun = createBlueprintRun(seed, runId);
    this.currentSector = sectorAtDistance(this.distance, levelId, mode);
    syncSectorRoad(this.roadSurface, this.dustSurface, this.distance, levelId, mode, this.subRoad);
    if (this.roadEnvironment) {
      stopRoadBurst(this.roadEnvironment, this);
      this.roadEnvironment.depotMarks = [];
      setRoadLighting(this.roadEnvironment,
        lightingForSector(this.currentSector, this.distance, routeFinishDistance(levelId), mode, levelId), true);
    }
    this.spawnTimer = firstRowDelay;
    this.nextTrackRowDistance = null;
    this.invulnerable = 0;
    this.stats = loadoutStats(this.profile, this.vehicleId);
    this.maxHull = this.stats.hull;
    this.hull = this.maxHull;
    this.shieldCharges = this.stats.shieldCapacity;
    this.runMilestones = [];
    if (!tutorial) this.recordMilestones();
    this.setWorldVisible(true);
    this.syncShipAppearance(this.vehicleId);
    this.finishLabel?.setText(`${levelDisplayName(levelId)} FINISH`);
    this.refreshHud();
    this.syncFinishLine();
    this.syncHaulerVisuals();
    if (this.roadEnvironment) updateRoadEnvironment(this.roadEnvironment, this, this.ship,
      this.distance, 0, 0, this.visibleDepot());
    if (this.developerRun) this.showDeveloperRunControls();
    else if (!tutorial) this.triggerHint('runStart');
  }

  showDeveloperRunControls() {
    if (this.debugManager?.active) {
      const flags = this.debugManager.flags;
      const modes = [this.godMode ? 'GOD' : '', flags.bot ? 'BOT' : '',
        flags.fast ? `${this.debugManager.timeScale}x` : ''].filter(Boolean).join(' / ');
      this.addLabel(`URL DEBUG ${modes} • TEMPORARY PROGRESS`, W / 2, 94, 10, '#f8df8f', 340);
      this.addButton('EXIT INSPECTION', H - 42, () => this.showMenu(),
        {width: 180, height: 38, size: 11, fill: PALETTE.steelDark});
      return;
    }
    this.addCard(198, this.developerSandbox ? 228 : 76, PALETTE.magenta);
    this.addButton(this.developerSandbox ? 'EXIT SANDBOX' : 'EXIT DEVELOPER RUN', 224,
      () => this.showDeveloperMenu(), {size: 12, height: 38, fill: PALETTE.steelDark});
    if (!this.developerSandbox) return;
    const cargoTools = [
      ['COIN • 1 LOAD', {kind: 'coin', mass: 1, slots: 1, value: SINGLE_COIN_PAYOUT}],
      ['STACK • 2 LOAD', {kind: 'coinStack', mass: 2, slots: 2, value: 10}],
      ['FREIGHT • 4 LOAD', {kind: 'freight', mass: 4, slots: 4, value: 20}],
    ];
    cargoTools.forEach(([label, pickup], index) => this.addButton(
      label, 276, () => this.spawnSandboxCargo(pickup),
      {size: 9, height: 38, width: 104, x: 73 + index * 122, fill: PALETTE.steelDark},
    ));
    [['EMPTY LOAD', 0], ['HALF LOAD', 0.5], ['FULL LOAD', 1]].forEach(([label, ratio], index) =>
      this.addButton(label, 326, () => this.setSandboxLoad(ratio),
        {size: 10, height: 38, width: 104, x: 73 + index * 122, fill: PALETTE.cockpit}));
    this.addButton('RESTART SANDBOX', 376, () => this.startRun('developer', this.levelId, 'normal', {
      sectorNumber: 1, vehicleId: this.vehicleId, sandbox: true,
    }), {size: 11, height: 38, fill: PALETTE.steelDark});
    this.devReadout = this.addLabel('', W / 2, 406, 11, '#dfeaf3', 322);
    this.refreshDeveloperReadout();
  }

  spawnSandboxCargo(pickup) {
    if (!this.developerSandbox || !this.runEconomy || !isDeveloperRun(this.runEconomy)) return;
    const lanes = [0, 1, 2, 3];
    const lane = lanes[(this.sandboxSpawnLane ?? 0) % lanes.length];
    this.sandboxSpawnLane = (this.sandboxSpawnLane ?? 0) + 1;
    const x = LANE_CENTERS[lane];
    const {sprite, pickupGlow, pickupSparkle} = this.addCargoPickupVisual(x, SPAWN_Y, pickup.value);
    this.objects.push({sprite, pickupGlow, pickupSparkle, type: 'cargo', ...pickup});
  }

  addCargoPickupVisual(x, y, value) {
    const sprite = scaleSpriteArt(routeImage(this, x, y, cargoPickupTexture(value)),
      balance.COLLECTIBLE_VISUAL_SCALE).setDepth(5);
    const pickupGlow = scaleSpriteArt(routeImage(this, x, y, cargoPickupGlowTexture(value)))
      .setDepth(4.5).setBlendMode('ADD');
    const pickupSparkle = scaleSpriteArt(routeImage(this, x, y, 'cargo_pickup_sparkle'))
      .setBlendMode('ADD');
    syncCargoPickupVisuals(sprite, pickupGlow, this.time.now,
      this.roadEnvironment?.lighting.headlights ?? false, true, pickupSparkle);
    return {sprite, pickupGlow, pickupSparkle};
  }

  setSandboxLoad(ratio) {
    if (!this.developerSandbox || ![0, 0.5, 1].includes(ratio)) return;
    const count = Math.floor(this.stats.capacity * ratio);
    this.cargoItems = Array.from({length: count}, () => ({
      kind: 'coinStack', mass: 1, slots: 1, value: 0,
    }));
    this.syncCargoTotals();
    this.refreshHud();
    this.refreshDeveloperReadout();
    this.syncHaulerVisuals();
  }

  refreshDeveloperReadout() {
    if (!this.devReadout || typeof this.devReadout.setText !== 'function' || !this.stats) return;
    const response = steeringMultiplier(this.cargoWeight, this.stats.capacity,
      this.stats.handling, this.stats.loadRelief, this.stats.vehicleSteeringMultiplier);
    this.devReadout.setText(`LOAD ${this.cargoWeight} / ${this.stats.capacity}  •  STEERING ${Math.round(response * 100)}%`);
  }

  syncFinishLine() {
    if (!this.finishLine) return;
    if (this.phase !== 'running' || this.runMode === 'continuous' || this.developerSandbox) {
      this.finishLine.setVisible(false);
      return;
    }
    const finishDistance = this.tutorialRun ? 500 : routeFinishDistance(this.levelId);
    const y = SHIP_Y - (finishDistance - this.distance) / METERS_PER_PIXEL;
    this.finishLine.setPosition(W / 2, y)
      .setVisible(y >= -50 && y <= H + 50);
  }

  centerShip() {
    this.ship.x = (ROAD_LEFT + ROAD_RIGHT) / 2;
    this.shipTargetX = this.ship.x;
    this.shipVelocityX = 0;
    this.steeringInputMode = 'pointer';
    this.keyboardBrakeRemaining = KEYBOARD_BRAKE_SECONDS;
    if (this.haulerEffects) {
      this.haulerEffects.cargoTrail = createCargoTrail(this.ship);
    }
    this.applyTruckRoll(0);
    this.shieldRing.setPosition(this.ship.x, this.ship.y);
    this.syncHaulerVisuals();
  }

  /** Suspension lean is cosmetic; the cab collider never rotates or squashes. */
  applyTruckRoll(target, dt = 0) {
    const baseScale = this.shipBaseScale ?? this.ship.scaleY ?? SPRITE_ART_SCALE;
    if (dt === 0) {
      this.truckRoll = target;
      this.truckRollReturn = null;
    } else if (target === 0) {
      // Frame-normalized easing avoids pickup pulse tweens cancelling the cab's return.
      this.truckRollReturn ??= {from: this.truckRoll ?? 0, elapsed: 0};
      this.truckRollReturn.elapsed = Math.min(balance.TRUCK_ROLL_RETURN_SECONDS, this.truckRollReturn.elapsed + dt);
      if (this.truckRollReturn.elapsed >= balance.TRUCK_ROLL_RETURN_SECONDS) {
        this.truckRoll = 0;
      } else {
        this.truckRoll = this.truckRollReturn.from *
          (1 - this.truckRollReturn.elapsed / balance.TRUCK_ROLL_RETURN_SECONDS) ** 3;
      }
    } else {
      this.truckRollReturn = null;
      this.truckRoll = (this.truckRoll ?? 0) +
        (target - (this.truckRoll ?? 0)) * (1 - Math.exp(-balance.TRUCK_ROLL_LERP_SPEED * dt));
    }
    this.ship.angle = this.truckRoll * balance.TRUCK_ROLL_MAX_ANGLE;
    this.ship.scaleX = baseScale;
    this.ship.scaleY = baseScale;
  }

  syncCargoTotals() {
    const total = cargoTotals(this.cargoItems);
    this.cargoWeight = total.mass;
    this.cargoValue = total.value;
    this.cargoSlots = total.slots;
  }

  removeObjects() {
    for (let i = this.objects.length - 1; i >= 0; i--) this.removeObjectAt(i);
    const signs = this.shoulderSigns;
    if (signs) {
      while (signs.length) releaseRouteVisual(this, signs.pop());
    }
  }

  removeObjectAt(index) {
    const item = this.objects[index];
    releaseRouteVisual(this, item.sprite);
    releaseRouteVisual(this, item.shadow);
    item.cautionLights?.forEach(light => releaseRouteVisual(this, light));
    releaseRouteVisual(this, item.roadsideBase);
    releaseRouteVisual(this, item.blueprintGlow);
    releaseRouteVisual(this, item.pickupGlow);
    releaseRouteVisual(this, item.pickupSparkle);
    releaseRouteVisual(this, item.orbGlow);
    if (item.ventAir) for (const puff of item.ventAir) releaseRouteVisual(this, puff);
    this.releaseTransientText(item.valueText);
    this.objects.splice(index, 1);
  }

  spawnTrackRow(frameScroll = 0) {
    const row = this.trackStream.nextRow(this.distance, {
      nextDepotDistance: this.nextDepotDistance, protectedUntilDistance: this.protectedUntilDistance,
    });
    // A background row that is not ready yet is retried next frame; its planned distance keeps placement exact.
    if (!row) return 0;
    const plannedDistance = row.plannedDistance ?? this.distance;
    this.nextTrackRowDistance = plannedDistance + row.spacingPx * METERS_PER_PIXEL;
    // update() already advanced distance; newborns join its object-scroll loop below.
    const spawnY = SPAWN_Y + (this.distance - plannedDistance) / METERS_PER_PIXEL - frameScroll;
    // A row the planner delivered late would appear inside the reaction window, so it becomes clear road.
    // Rows pre-placed behind a Depot exit are measured from that exit, not from their planned distance.
    const late = this.distance - Math.max(plannedDistance, this.resumeSpawnDistance ?? -Infinity) >
      routeSpeedAtDistance(plannedDistance, this.levelId,
      this.runMode) * METERS_PER_PIXEL * ROUTE_STREAM_LATE_ROW_MS / 1000;
    if (late) this.lateRouteRows = (this.lateRouteRows ?? 0) + 1;
    const emitted = !late && (row.emitted ?? hazardsBeforeDepot(row, plannedDistance, this.nextDepotDistance,
      this.protectedUntilDistance, this.levelId, this.runMode));
    const hazards = emitted && this.hazardRowAllowedAtFinish(plannedDistance)
      ? [...row.hazards, ...row.intermediates, ...(row.sweepers ?? [])] : [];
    for (const hazard of hazards.filter(h => !h.continuation)) {
      const definition = hazardDefinition(hazard.kind);
      const sector = sectorAtDistance(plannedDistance, this.levelId, this.runMode);
      const motionAge = hazard.movement
        ? canonicalMotionAge(plannedDistance, this.distance, this.levelId, this.runMode) : 0;
      const movementOffsetPx = hazard.movement ? movingHazardOffset(hazard.movement, motionAge) : 0;
      const hazardSpawnY = SPAWN_Y + hazard.offsetY +
        ((this.distance - plannedDistance) / METERS_PER_PIXEL - frameScroll) * hazardScrollScale(hazard);
      const record = {type: 'hazard', kind: hazard.kind,
        lengthPx: hazard.lengthPx, placement: hazard.placement, lane: hazard.lane,
        sideObstacleId: hazard.sideObstacleId, spanRows: hazard.spanRows, spanPhase: hazard.spanPhase,
        plannedDistance, offsetY: hazard.offsetY,
        offsetX: hazard.offsetX ?? 0, movement: hazard.movement, movementOffsetPx, motionAge};
      if (isGuardrail(hazard)) {
        // Shadows are baked per tile inside the structure container.
        const sprite = createGuardrailStructure(this, hazard,
          hazardX({...hazard, movementOffsetPx}), spawnY + hazard.offsetY);
        if (hazard.sideObstacleId) this.fadeInSideObstacle(sprite);
        if (sprite.guardrailBeacon) syncGuardrailBeacon(sprite, this.time.now,
          this.roadEnvironment?.lighting.headlights ?? false);
        this.objects.push({...record, sprite,
          cautionLights: sprite.guardrailBeacon ? [sprite.guardrailBeacon] : null});
        continue;
      }
      const sprite = routeImage(this, hazardX({...hazard, movementOffsetPx}),
        hazardSpawnY, hazardTexture(hazard.kind, sector, hazard.lane, this)).setDepth(HAZARD_READABILITY.depth);
      scaleSpriteArt(sprite);
      if (definition.roadside) {
        const right = hazard.lane === 3;
        sprite.setFlipX(right);
        if (definition.scenery) {
          const origin = definition.scenery.anchorX / definition.scenery.width;
          sprite.setOrigin(right ? 1 - origin : origin, 0.5);
        }
      }
      const roadsideBase = definition.roadside && !definition.scenery
        ? scaleSpriteArt(routeImage(this, hazard.lane === 0 ? 21.5 : 368.5, sprite.y,
          `base_${resolveVisualTheme(sector).hazardThemeId}`))
          .setFlipX(hazard.lane === 3).setDepth(5.5)
        : null;
      const night = this.roadEnvironment?.lighting.headlights ?? false;
      const cautionLights = createBarrierLights(this, sprite, hazard.kind,
        hazard.kind === 'forklift' ? motionAge * 1000 : this.time.now, night);
      const shadow = syncSilhouetteShadow(createSilhouetteShadow(this, sprite), sprite, true);
      // Vents exhale two pooled wisps that drift off the grille and fade, out of phase.
      const ventAir = hazard.kind === 'vent' || hazard.kind === 'ventGrille'
        ? [0, 1].map(() => routeImage(this, sprite.x, sprite.y, 'vent_air_puff')
          .setDepth(HAZARD_READABILITY.depth + 0.02).setAlpha(0))
        : null;
      this.objects.push({...record, sprite, shadow, roadsideBase, cautionLights, ventAir,
        ventPhase: ventAir ? (plannedDistance * 0.37 + hazard.lane * 0.29) % 1 : 0});
    }
    for (const orb of emitted ? row.energyOrbs ?? [] : []) {
      const sprite = routeImage(this, orb.initialX,
        SPAWN_Y + (this.distance - orb.distanceMeters) / METERS_PER_PIXEL - frameScroll,
        'hazard_energy_orb').setDepth(HAZARD_READABILITY.depth);
      const orbGlow = sectorAtDistance(orb.distanceMeters, this.levelId, this.runMode).themeId === 'neon' ? null
        : routeImage(this, sprite.x, sprite.y, 'glow_orb_radial')
          .setDepth(7.5).setBlendMode('ADD').setAlpha(0.55);
      this.objects.push({type: 'hazard', kind: 'energy_orb', ...orb, sprite, orbGlow,
        plannedDistance: orb.distanceMeters, nearMissPlayed: false});
    }
    for (const pickup of row.pickups) {
      const x = LANE_CENTERS[pickup.lane] + (pickup.offsetX ?? 0);
      const {sprite, pickupGlow, pickupSparkle} = this.addCargoPickupVisual(x, spawnY, pickup.value);
      this.objects.push({
        sprite, pickupGlow, pickupSparkle, type: 'cargo', kind: pickup.kind,
        mass: pickup.mass, slots: pickup.slots, value: pickup.value,
      });
    }
    // Authorize only emitted rows, never queued rows or chunk construction.
    const blueprint = this.tutorialRun
      ? row.tutorialBlueprint ? {id: `${this.runEconomy.runId}:rookie-blueprint`, lane: 2, amount: 1} : null
      : !isDeveloperRun(this.runEconomy) && blueprintEligible(this.profile)
        ? this.blueprintRun.authorize(plannedDistance, row.safeLanes,
          row.pickups.map(pickup => pickup.lane), this.levelId, this.runMode) : null;
    if (blueprint) {
      const converted = this.profile.ownedVehicleIds.includes('apex');
      const sprite = scaleSpriteArt(routeImage(this, LANE_CENTERS[blueprint.lane], spawnY,
        converted ? 'cargo_coinStack' : 'cargo_blueprint'), balance.COLLECTIBLE_VISUAL_SCALE).setDepth(5);
      const blueprintGlow = converted ? null
        : scaleSpriteArt(routeImage(this, sprite.x, sprite.y, 'cargo_blueprint_glow'))
          .setDepth(4.5).setBlendMode('ADD');
      const valueText = this.acquireTransientText(sprite.x,
        spawnY + (converted ? 26 : 32) * SPRITE_ART_SCALE,
        converted ? `+${blueprint.amount * BP_TO_COINS} banked` : `+${blueprint.amount} BP`,
        converted ? '#ffdf7c' : colorText(PALETTE.cyanLight), 11, converted, true, 6);
      if (blueprintGlow) syncBlueprintVisuals(sprite, blueprintGlow, this.time.now);
      this.objects.push({sprite, valueText, blueprintGlow, type: 'blueprint', reward: blueprint});
    }
    return row.spacingPx;
  }

  fadeInSideObstacle(sprite) {
    if (!this.tweens?.add || !sprite?.setAlpha) return;
    sprite.setAlpha(0);
    this.tweens.add({targets: sprite, alpha: 1, duration: 220, ease: 'Sine.easeOut'});
  }

  hazardRowAllowedAtFinish(plannedDistance) {
    if (this.runMode === 'continuous') return true;
    const clearStart = routeFinishDistance(this.levelId) - GAME_BALANCE.routes.finishClearanceMeters;
    return this.distance < clearStart && plannedDistance < clearStart;
  }

  clearObstaclesAtFinish() {
    if (this.runMode === 'continuous' || this.finishObstaclesCleared) return;
    const clearStart = routeFinishDistance(this.levelId) - GAME_BALANCE.routes.finishClearanceMeters;
    if (this.distance < clearStart) return;
    this.finishObstaclesCleared = true;
    for (let index = this.objects.length - 1; index >= 0; index--) {
      if (this.objects[index].type === 'hazard') this.removeObjectAt(index);
    }
    syncGuardrailSparks(this.haulerEffects, null);
  }

  refreshHud() {
    this.hudContainer?.setVisible(this.phase === 'running' || this.phase === 'docking');
    this.hud.distanceLabel.setText(this.developerSandbox
      ? `${levelDisplayName(this.levelId)} • STEERING SANDBOX`
      : this.runMode === 'continuous'
      ? `ENDLESS RUN • ${Math.floor(this.distance)} m`
      : `${levelDisplayName(this.levelId)} • SECTOR ${this.currentSector.number}/${IMPLEMENTED_LEVELS[this.levelId].length}`);
    this.hud.distance.setText(`${Math.floor(this.distance)} m`);
    const sector = this.currentSector;
    const endless = this.runMode === 'continuous';
    const stageStart = endless
      ? continuousStageAtDistance(this.distance) * GAME_BALANCE.routes.continuous.depotIntervalMeters
      : sector.startsAt;
    const stageEnd = this.runMode === 'continuous'
      ? stageStart + GAME_BALANCE.routes.continuous.depotIntervalMeters : sector.endsAt;
    this.hud.progressBar.setScale(Math.max(0, Math.min(1,
      (this.distance - stageStart) / (stageEnd - stageStart))), 1);
    const full = this.cargoWeight >= this.stats.capacity || this.cargoSlots >= this.stats.capacity;
    this.hud.cargo.setText(`${this.cargoValue}`);
    this.hud.load.setText(`LOAD ${this.cargoWeight}/${this.stats.capacity}`).setColor(full ? '#ffdf7c' : '#8ab4f8');
    this.hud.loadBar.setScale(Math.min(1, this.cargoWeight / this.stats.capacity), 1)
      .setFillStyle(full ? PALETTE.gold : PALETTE.cyan);
    this.hud.hull.setText(`HULL ${Math.max(0, this.hull)}/${this.maxHull}`);
    const pips = this.hud.hullPips.clear();
    const hullBarWidth = this.stats.shieldCapacity > 0 ? 54 : 90;
    const pipWidth = Math.min(20, hullBarWidth / this.maxHull - 3);
    for (let i = 0; i < this.maxHull; i++) {
      pips.fillStyle(i < this.hull ? 0x00e5ff : PALETTE.steelDark)
        .fillRect(269 + i * (pipWidth + 3), 21, pipWidth, 4);
    }
    const shields = this.hud.shieldPips.clear().setVisible(this.stats.shieldCapacity > 0);
    for (let i = 0; i < this.stats.shieldCapacity; i++) {
      const x = 334 + i * 10;
      const points = [{x, y: 18}, {x: x + 4, y: 20.5}, {x: x + 4, y: 25.5},
        {x, y: 28}, {x: x - 4, y: 25.5}, {x: x - 4, y: 20.5}];
      shields.fillStyle(i < this.shieldCharges ? PALETTE.cyan : PALETTE.steelDark)
        .fillPoints(points, true).lineStyle(1, PALETTE.cyan, i < this.shieldCharges ? 1 : 0.4)
        .strokePoints(points, true);
    }
    this.hud.bonus.setText(`DEPOT PASS BONUS +${this.runMode === 'continuous'
      ? continuousQuote(this.cargoItems, this.runEconomy).percent
      : riskBonusPercent(this.runEconomy)}%`);
    this.hud.closeCallBonus.setText(`CLOSE CALL BONUS +${closeCallBonusPercent(this.runEconomy)}%`);
    this.hud.shield.setText(this.stats.shieldCapacity > 0
      ? `SHIELD ${this.shieldCharges}/${this.stats.shieldCapacity}` : '');
    if (this.developerSandbox) {
      this.hud.depot.setVisible(true);
      this.hud.depot.setText('NO DEPOTS').setColor(colorText(PALETTE.steelLight));
    } else if (!Number.isFinite(this.nextDepotDistance)) {
      this.hud.depot.setVisible(true);
      this.hud.depot.setText(`FINISH ${Math.max(0, Math.ceil(routeFinishDistance(this.levelId) - this.distance))} m`)
        .setColor(colorText(PALETTE.depot));
    } else {
      const toDepot = Math.max(0, Math.ceil(this.nextDepotDistance - this.distance));
      this.hud.depot.setVisible(this.nextDepotDistance - this.distance >= 0 &&
        this.nextDepotDistance - this.distance <= DEPOT_RULES.noticeMeters);
      this.hud.depot.setText(`DEPOT ${this.nextDepot.side === 'left' ? '<' : '>'} ${toDepot} m`)
        .setColor('#7ba0c0');
    }
    for (const [key, width] of [['distanceLabel', 114], ['distance', 116], ['depot', 116],
      ['shield', 116], ['cargo', 91], ['hull', 113], ['load', 113], ['bonus', 140], ['closeCallBonus', 140]]) {
      const node = this.hud[key];
      node.setScale(Math.min(1, width / Math.max(1, node.width)));
    }
  }

  update(_time, delta) {
    const factor = this.phase === 'running' ? this.debugManager?.timeScale ?? 1 : 1;
    if (factor === 1) return this.updateStep(_time, delta);
    const seconds = Math.min(delta / 1000, 0.05) * factor;
    const steps = Math.max(1, Math.ceil(seconds / 0.05));
    for (let i = 0; i < steps && this.phase === 'running'; i++) {
      this.updateStep(_time, seconds * 1000 / steps);
    }
  }

  updateStep(_time, delta) {
    if (this.phase === 'resumeTransition') return;
    if (this.phase === 'resumeCountdown') {
      this.resumeCountdownElapsed = Math.min(3, this.resumeCountdownElapsed + Math.min(delta / 1000, 0.05));
      this.pauseCountdownText?.setText(`${Math.ceil(3 - this.resumeCountdownElapsed)}`);
      if (this.resumeCountdownElapsed >= 3 - 1e-9) {
        this.phase = 'resumeTransition';
        this.fadeOverlayOut(() => {
          this.pauseCountdownText = null;
          this.phase = 'running';
          this.touchPauseBlockedUntil = this.time.now + 2000;
          this.hudContainer?.setVisible(true);
          this.feedback?.resume('manualPause');
        });
      }
      return;
    }
    if (this.menuScrollContainer && !this.menuScrollGesture && this.menuScrollVelocity) {
      const next = advanceMenuScroll(this.menuScrollOffset, this.menuScrollVelocity,
        this.menuScrollMax, Math.min(delta / 1000, 0.05));
      this.menuScrollOffset = next.offset;
      this.menuScrollVelocity = next.velocity;
      this.menuScrollContainer.setY(next.offset);
      this.menuScrollPositions[this.menuScrollKey] = next.offset;
      this.updateMenuScrollVisibility();
    }
    if (this.phase === 'docking') {
      this.updateDocking(Math.min(delta / 1000, 0.05));
      return;
    }
    if (this.phase !== 'running') {
      syncGuardrailSparks(this.haulerEffects, null);
      if (this.haulerEffects?.damageSmoke) this.haulerEffects.damageSmoke.emitter.emitting = false;
      return;
    }
    const dt = Math.min(delta / 1000, 0.05); // suspend/resume spike guard
    if (this.tutorialRun) this.tutorialPopupElapsed = (this.tutorialPopupElapsed ?? 0) + dt;
    const continuousSpeedInterval = GAME_BALANCE.routes.continuous.speedStepIntervalMeters;
    const priorContinuousSpeedStep = this.runMode === 'continuous'
      ? Math.floor(this.distance / continuousSpeedInterval) : 0;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.holdFullCooldown = Math.max(0, this.holdFullCooldown - dt);
    const priorDistance = this.distance;
    const priorDepotX = this.ship.x;
    let scroll;
    if (this.tutorialRun) {
      this.tutorialSpeed = Math.min(240, this.tutorialSpeed + dt * 240);
      scroll = this.tutorialSpeed;
    } else scroll = Math.min(routeSpeedAtDistance(this.distance, this.levelId, this.runMode), MAX_TRACK_SPEED);
    if (this.depotLaunchElapsed != null) {
      const step = depotMotionStep(this.depotLaunchElapsed, dt, DEPOT_RULES.launchSeconds, true);
      this.depotLaunchElapsed = step.complete ? null : step.elapsed;
      scroll *= dt > 0 ? step.travelSeconds / dt : 0;
    }
    this.distance += dt * scroll * METERS_PER_PIXEL;
    this.scrollRoad(scroll * dt);
    if (this.checkTutorialCheckpoint()) return;
    const finishDistance = this.tutorialRun ? 500 : routeFinishDistance(this.levelId);
    this.clearObstaclesAtFinish();
    const remainingToFinish = finishDistance - this.distance;
    if (this.runMode !== 'continuous' && !this.finishNoticeShown && remainingToFinish <= 150) {
      this.finishNoticeShown = true;
      this.showToast(`${levelDisplayName(this.levelId)} FINISH AHEAD\nKeep driving to complete the level.`, 'hint');
    }
    if (!this.tutorialRun && this.runMode !== 'continuous' && !this.developerSandbox &&
      this.distance >= finishDistance) {
      this.distance = finishDistance;
      this.syncFinishLine();
      this.finishRun(true, true);
      return;
    }
    this.syncFinishLine();
    if (this.runMode === 'continuous' &&
        Math.floor(this.distance / continuousSpeedInterval) > priorContinuousSpeedStep) {
      this.showToast(`ENDLESS RUN\nSpeed ${routeSpeedAtDistance(this.distance, this.levelId, this.runMode)} px/s (max ${GAME_BALANCE.routes.continuous.maximumSpeedPxPerSecond}).`, 'hint');
    }
    const sector = sectorAtDistance(this.distance, this.levelId, this.runMode);
    if (sector.id !== this.currentSector.id) {
      this.currentSector = sector;
      const message = sector.number === IMPLEMENTED_LEVELS[this.levelId].length && this.runMode !== 'continuous'
        ? `Final sector. Reach the finish line at ${finishDistance.toLocaleString('en-US')} m.`
        : 'Cargo, hull and equipment carry on with you.';
      const lighting = lightingForSector(sector, this.distance, finishDistance, this.runMode, this.levelId);
      if (this.roadEnvironment) {
        setRoadLighting(this.roadEnvironment, lighting);
        startRoadBurst(this.roadEnvironment, this, this.haulerEffects.exhaust);
      }
      this.showToast(this.runMode === 'continuous'
        ? `ENDLESS RUN // ${sector.name}\n${sector.number === 2 ? 'Horizontal Forklifts'
          : sector.number === 3 ? 'Street Sweepers + Forklifts'
            : sector.number === 4 ? 'Neon Energy Orbs' : 'Static hazards'}`
        : `>> SECTOR ${sector.number}: ${lighting.name} // SPEED ESCALATED\n${message}`, 'hint');
    }
    const priorShip = {x: this.ship.x, y: this.ship.y};
    const digitalBrake = this.updateSteeringInput();
    this.shipTargetX = Phaser.Math.Clamp(this.shipTargetX, ROAD_LEFT + 30, ROAD_RIGHT - 30);
    const movement = advanceSteering({
      x: this.ship.x,
      velocity: this.shipVelocityX,
      targetX: this.shipTargetX,
      dt,
      minX: ROAD_LEFT + 30,
      maxX: ROAD_RIGHT - 30,
      load: this.cargoWeight,
      capacity: this.stats.capacity,
      handling: this.stats.handling,
      loadRelief: this.stats.loadRelief,
      vehicleMultiplier: this.stats.vehicleSteeringMultiplier,
      digitalBrake,
      brakeTimeRemaining: this.keyboardBrakeRemaining,
    });
    this.ship.x = movement.x;
    this.feedback?.steer(this.ship.x);
    this.shipVelocityX = movement.velocity;
    if (digitalBrake) this.keyboardBrakeRemaining = movement.brakeTimeRemaining;
    this.applyTruckRoll(Phaser.Math.Clamp(
      movement.velocity / GAME_BALANCE.physics.steering.maxLateralSpeedPxPerSecond, -1, 1), dt);
    this.ship.setAlpha(this.invulnerable > 0 ? 0.58 : 1);
    this.updateShield();
    this.recordMilestones();

    if (!this.developerSandbox) {
      if (this.nextTrackRowDistance == null) this.spawnTimer -= dt;
      if (this.nextTrackRowDistance == null ? this.spawnTimer <= 0
        : this.distance >= this.nextTrackRowDistance) {
        const spacingPx = this.spawnTrackRow(scroll * dt);
        this.spawnTimer = spacingPx > 0 ? spacingPx / scroll : 0;
      }
    }
    const capacity = this.stats.capacity;
    if (this.cargoWeight >= capacity || this.cargoSlots >= capacity) this.runContext.fullLoadSeconds += dt;
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const item = this.objects[i];
      if (item.type === 'hazard') item.priorNearMissPosition = {
        x: item.sprite.x - priorShip.x, y: item.sprite.y - priorShip.y,
      };
      item.sprite.y += scroll * dt * hazardScrollScale(item);
      if (item.movement) {
        item.motionAge = canonicalMotionAge(item.plannedDistance, this.distance, this.levelId, this.runMode);
        item.movementOffsetPx = movingHazardOffset(item.movement, item.motionAge);
        item.sprite.setX(hazardX(item));
      } else if (item.kind === 'energy_orb') {
        const nextX = item.sprite.x + item.direction * item.sweepSpeed * (delta / 1000);
        if (nextX >= 315) {
          item.sprite.setX(315);
          item.direction = -1;
        } else if (nextX <= 75) {
          item.sprite.setX(75);
          item.direction = 1;
        } else {
          item.sprite.setX(nextX);
        }
        item.orbGlow?.setPosition(item.sprite.x, item.sprite.y);
        // Unstable charge: the corona spins while the bloom flickers.
        const flicker = Math.sin(this.time.now * 0.019) + 0.5 * Math.sin(this.time.now * 0.047);
        item.sprite.rotation += dt * 2.4;
        item.orbGlow?.setScale(1 + 0.1 * flicker).setAlpha(0.5 + 0.12 * flicker);
      }
      item.roadsideBase?.setY(item.sprite.y);
      if (item.ventAir) {
        for (let puffIndex = 0; puffIndex < item.ventAir.length; puffIndex++) {
          const age = (this.time.now * 0.0007 + item.ventPhase + puffIndex * 0.5) % 1;
          item.ventAir[puffIndex].setPosition(
            item.sprite.x + Math.sin((age + puffIndex) * Math.PI * 2) * 3,
            item.sprite.y - 6 - age * 20)
            .setScale(0.55 + 0.75 * age).setAlpha(0.42 * Math.sin(age * Math.PI));
        }
      }
      if (item.shadow) syncSilhouetteShadow(item.shadow, item.sprite, true);
      if (item.cautionLights) {
        const night = this.roadEnvironment?.lighting.headlights ?? false;
        if (isGuardrail(item)) syncGuardrailBeacon(item.sprite, this.time.now, night);
        else if (item.cautionLights) syncBarrierLights(item.cautionLights, item.sprite, item.kind,
          item.kind === 'forklift' ? item.motionAge * 1000 : this.time.now, night);
      }
      if (item.blueprintGlow) syncBlueprintVisuals(item.sprite, item.blueprintGlow, this.time.now);
      const offer = item.type === 'cargo' ? cargoOffer(this.cargoItems, item, capacity) : null;
      if (offer?.accepted) this.applyMagnet(item, dt);
      if (item.pickupGlow) syncCargoPickupVisuals(item.sprite, item.pickupGlow, this.time.now,
        this.roadEnvironment?.lighting.headlights ?? false, offer.accepted, item.pickupSparkle);
      if (item.valueText) item.valueText.setPosition(item.sprite.x,
        item.sprite.y + (item.blueprintGlow ? 32 : 26) * SPRITE_ART_SCALE);
      if (item.type === 'cargo') {
        // Dim pickups the hold can't take so players can see why they aren't scoring.
        item.sprite.setAlpha(offer.accepted ? 1 : 0.35);
        item.valueText?.setAlpha(offer.accepted ? 1 : 0.35);
      }
    }
    this.resolveGuardrails(scroll * dt);
    const collisionObjects = [...this.objects].reverse();
    let closeCallHit = false;
    for (const item of collisionObjects) {
      const i = this.objects.indexOf(item);
      if (i < 0) continue;
      const guardrail = item.type === 'hazard' && isGuardrail(item);
      if (item.type === 'hazard') {
        item.nearMiss = advanceNearMiss(item.nearMiss, item, item.priorNearMissPosition,
          {x: item.sprite.x - this.ship.x, y: item.sprite.y - this.ship.y});
        if (item.guardrailHit || item.guardrailGhost) item.nearMiss.contacted = true;
        if (item.nearMiss.award && !item.nearMiss.contacted && !closeCallHit) this.awardNearMiss();
      }
      const hits = guardrail ? item.guardrailHit
        : item.type === 'hazard'
          ? hazardHits(item, item.sprite.x, item.sprite.y, this.ship.x, this.ship.y)
          : item.type === 'cargo' ? cargoPickupHits(item.sprite.x, item.sprite.y, this.ship.x, this.ship.y)
            : Math.abs(item.sprite.x - this.ship.x) < CARGO_COLLISION_DISTANCE_PX &&
              Math.abs(item.sprite.y - this.ship.y) < VERTICAL_HIT_PX;
      if (item.kind === 'energy_orb' && !hits && !item.nearMissPlayed &&
          item.nearMiss.resolved && item.nearMiss.minimumGap > 0 && item.nearMiss.minimumGap <= 40) {
        item.nearMissPlayed = true;
        this.feedback?.energyOrbNearMiss();
      }
      if (hits && item.type === 'blueprint') {
        if (this.tutorialRun) {
          this.tutorialBlueprintsCollected = 1;
          this.floatText(this.ship.x, this.ship.y - 52, '+1 BP', colorText(PALETTE.cyanLight), 14);
          this.removeObjectAt(i);
          continue;
        }
        const award = awardBlueprint(this.profile, item.reward, {road: true});
        if (award.profile !== this.profile && !this.persistProfile(award.profile)) {
          this.showToast('Blueprint could not be saved. Check browser storage.', 'error');
          continue;
        }
        this.profile = award.profile;
        this.runEconomy.otherCoins += award.coins;
        if (award.blueprints || award.coins) {
          if (award.coins) this.floatCurrency(`+${award.coins}`, this.ship.y - 52,
            colorText(PALETTE.cyanLight), 14, ' banked');
          else this.floatText(this.ship.x, this.ship.y - 52, `+${award.blueprints} Blueprint saved`,
            colorText(PALETTE.cyanLight), 14);
        }
        this.removeObjectAt(i);
      } else if (hits && item.type === 'cargo') {
        const collected = collectCargo(this.cargoItems, item, capacity);
        if (collected.accepted) {
          this.cargoItems = collected.items;
          this.syncCargoTotals();
          this.refreshDeveloperReadout();
          this.playPickupFeedback(item, {gain: collected.gain, replaced: collected.replaced});
          if (collected.replaced) this.showToast('Cargo upgraded. Your Cargo Value increased.', 'warning');
          if (!this.developerRun) this.triggerHint(item.kind === 'coin' ? 'coinPickup' : 'stackPickup');
          this.removeObjectAt(i);
        } else {
          // An equal, worse or infeasible offer remains on the road.
          this.showHoldFullNotice();
        }
      } else if (hits && item.type === 'hazard') {
        const {x, y} = item.sprite;
        if (this.godMode) {
          if (this.invulnerable <= 0) {
            this.removeObjectAt(i);
            this.invulnerable = GAME_BALANCE.physics.collision.hitInvulnerabilitySeconds;
            this.playHitFeedback(x, y, 0, false, true);
          }
          continue;
        }
        if (item.kind === 'energy_orb') {
          if (this.invulnerable > 0) continue;
          closeCallHit = true;
          this.runEconomy.closeCallBonusPercent = 0;
          this.removeObjectAt(i);
          playEnergyOrbSparks(this.haulerEffects, x, y);
          if (this.shieldCharges > 0) {
            this.shieldCharges--;
            this.absorbWithShield(x, y, GAME_BALANCE.physics.collision.shieldInvulnerabilitySeconds);
            continue;
          }
          const previousHull = this.hull;
          this.hull = Math.max(1, this.hull - GAME_BALANCE.hazards.hullDamagePerHit);
          this.runContext.damagingHits++;
          this.invulnerable = GAME_BALANCE.physics.collision.hitInvulnerabilitySeconds;
          this.feedback?.impact({damaging: this.hull < previousHull});
          this.cameras.main.shake(100, 0.012);
          this.pulse(this.hud.hull, 1.15, 120);
          this.floatText(this.ship.x, this.ship.y - 52, 'PLASMA HIT • NONFATAL', '#7ffaff', 16);
          continue;
        }
        const collision = resolveHazardCollision({
          invulnerableSeconds: this.invulnerable,
          shieldCharges: this.shieldCharges,
          hull: this.hull,
          hullDamage: GAME_BALANCE.hazards.hullDamagePerHit,
          cargoItems: this.cargoItems,
          cargoLossFraction: BASE_HAZARD_COIN_LOSS * (1 - this.stats.insurance),
          cargoMitigation: this.stats.cargoMitigation,
          baseInvulnerabilitySeconds: GAME_BALANCE.physics.collision.hitInvulnerabilitySeconds,
          impactPulseSeconds: this.stats.impactPulseSeconds,
          shieldInvulnerabilitySeconds: GAME_BALANCE.physics.collision.shieldInvulnerabilitySeconds,
        });
        if (collision.kind === 'immune') {
          // Invulnerable cabs ghost through the lip; the hit lands if they still overlap afterwards.
          if (guardrail) item.guardrailGhost = true;
          continue;
        }
        closeCallHit = true;
        this.runEconomy.closeCallBonusPercent = 0;
        this.removeObjectAt(i);
        this.shieldCharges = collision.shieldCharges;
        if (collision.kind === 'shielded') {
          this.absorbWithShield(x, y, collision.invulnerabilitySeconds);
          continue;
        }
        const loadBeforeHit = this.cargoWeight / capacity;
        this.hull = collision.hull;
        this.runEconomy.damagingHits += 1;
        this.runContext.cargoLostToHits += collision.lostValue;
        this.cargoItems = collision.cargoItems;
        this.syncCargoTotals();
        this.refreshDeveloperReadout();
        this.invulnerable = collision.invulnerabilitySeconds;
        if (collision.clearObstacles) {
          this.clearVisibleObstacles();
          this.showToast('IMPACT PULSE • VISIBLE OBSTACLES CLEARED', 'hint');
        }
        this.playHitFeedback(x, y, collision.lostValue, collision.fatal);
        if (collision.fatal) {
          this.runContext.crashLoadRatio = loadBeforeHit;
          this.beginCrash();
          return;
        }
        this.triggerHint('hazardHit');
      } else if (item.sprite.y - (guardrail ? hazardGeometry(item).height : (item.lengthPx ?? 0)) / 2 > H + 60) {
        this.removeObjectAt(i);
      }
    }
    this.syncHaulerVisuals(dt, scroll);
    if (this.roadEnvironment) updateRoadEnvironment(this.roadEnvironment, this, this.ship,
      this.distance, scroll * dt, dt, this.visibleDepot());
    this.refreshHud();
    // Direct-sector developer runs keep real Depots; only the obstacle-free Steering Sandbox has none.
    if (!this.developerSandbox) {
      this.updateDepotFacilities(scroll * dt);
      this.updateDepot(priorDistance, priorDepotX);
    }
    this.refreshDeveloperReadout();
  }

  /** The Steering Sandbox advertises no Depots, so it never shows approach chevrons either. */
  visibleDepot() {
    return this.developerSandbox ? null : this.nextDepot;
  }

  /** Depot art lives in world space: it enters above the screen and scrolls with the road. */
  updateDepotFacilities(scrollPx) {
    this.depotFacilities ??= [];
    const height = depotFacilityHeight();
    for (let i = this.depotFacilities.length - 1; i >= 0; i--) {
      const facility = this.depotFacilities[i];
      facility.container.y += scrollPx;
      if (facility.container.y > H + height) {
        releaseRouteVisual(this, facility.container);
        this.depotFacilities.splice(i, 1);
      }
    }
    const depot = this.nextDepot;
    if (!Number.isFinite(depot?.distance) ||
        this.depotFacilities.some(facility => facility.depot.distance === depot.distance)) return;
    // Spawn at the exact world position once it crosses -height, so art and trigger never drift apart.
    const y = depotWorldY(depot, this.distance);
    if (y >= -height) {
      this.depotFacilities.push(createDepotFacility(this, depot, y, Phaser.BlendModes.ADD));
    }
  }

  removeDepotFacilities() {
    this.depotFacilities?.forEach(facility => releaseRouteVisual(this, facility.container));
    if (this.depotFacilities) this.depotFacilities.length = 0;
  }

  /**
   * Lead-cab guardrail pass: a head-on lip impact is flagged for the standard hazard path; any flank
   * contact is a solid, non-damaging wall that clamps the cab and grinds sparks while steered into.
   * Trailers and crates are cosmetic and never tested.
   */
  resolveGuardrails(scrollPx) {
    let scrape = null;
    for (const item of this.objects) {
      if (item.type !== 'hazard' || !isGuardrail(item)) continue;
      let contact = guardrailContact(item, item.sprite.x, item.sprite.y, this.ship.x, this.ship.y, scrollPx);
      if (!contact && item.grindSide) {
        // Keep a held grind continuous across its tiny repulsion gap; never promote a probe to a lip hit.
        const probe = guardrailContact(item, item.sprite.x, item.sprite.y,
          this.ship.x - item.grindSide * (WALL_GRIND_REPULSION_PX + 1e-9), this.ship.y, scrollPx);
        if (probe?.kind === 'flank') contact = probe;
      }
      if (!contact) {
        item.guardrailHit = item.guardrailGhost = false;
        item.grindSide = 0;
        continue;
      }
      item.guardrailHit = item.guardrailGhost || contact.kind === 'headOn';
      if (item.guardrailHit) {
        item.grindSide = 0;
        continue;
      }
      const pushing = contact.side * this.shipVelocityX < 0 ||
        contact.side * (this.shipTargetX - contact.clampX) < -0.5;
      this.ship.x = Phaser.Math.Clamp(contact.clampX + (pushing ? contact.side * WALL_GRIND_REPULSION_PX : 0),
        ROAD_LEFT + 30, ROAD_RIGHT - 30);
      if (contact.side * this.shipVelocityX < 0) this.shipVelocityX = 0;
      item.grindSide = pushing ? contact.side : 0;
      if (pushing) scrape = contact;
    }
    if (scrape) this.feedback?.playMetalScrape();
    syncGuardrailSparks(this.haulerEffects, scrape);
  }

  clearVisibleObstacles() {
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const item = this.objects[i];
      if (item.type !== 'hazard') continue;
      const halfHeight = hazardGeometry(item).height / 2;
      if (item.sprite.y + halfHeight < 0 || item.sprite.y - halfHeight > H) continue;
      this.removeObjectAt(i);
    }
  }

  scrollRoad(scrollPx) {
    this.roadSurface.tilePositionY -= scrollPx;
    syncSectorRoad(this.roadSurface, this.dustSurface, this.distance, this.levelId, this.runMode, this.subRoad);
    for (const stripe of this.lines) {
      stripe.y += scrollPx;
      if (stripe.y > H + 40) stripe.y -= STRIPES_PER_COLUMN * STRIPE_GAP;
    }
    this.updateShoulderSigns(scrollPx);
  }

  /** Pooled Neon blade signs ride the road scroll; the hum is a shared time-based pulse, not per-sign tweens. */
  updateShoulderSigns(scrollPx) {
    const signs = this.shoulderSigns;
    if (!signs) return;
    const config = NEON_SHOULDER_SIGNS;
    const wave = 0.5 - 0.5 * Math.cos((this.time?.now ?? 0) * Math.PI / config.pulseMs);
    const alpha = config.alphaMin + (config.alphaMax - config.alphaMin) * wave;
    for (let i = signs.length - 1; i >= 0; i--) {
      const sign = signs[i];
      sign.y += scrollPx;
      if (sign.y - sign.displayHeight / 2 > H + (this.roadBleed?.y ?? 0) + 60) {
        releaseRouteVisual(this, sign);
        signs[i] = signs[signs.length - 1];
        signs.pop();
      } else {
        sign.setAlpha(alpha);
      }
    }
    if (!Number.isFinite(this.nextShoulderSignDistance) || this.distance < this.nextShoulderSignDistance) return;
    const index = this.shoulderSignIndex++;
    this.nextShoulderSignDistance += config.spacingMeters;
    if (resolveVisualTheme(sectorAtDistance(this.distance, this.levelId, this.runMode)).id !== 'neon') return;
    const side = ((index + (this.runSeed ?? 0)) & 1) ? config.right : config.left;
    const sign = routeImage(this, side.x, 0, side.key)
      .setScale(config.displayScale).setDepth(config.depth).setAlpha(alpha);
    sign.y = -(this.roadBleed?.y ?? 0) - sign.displayHeight / 2;
    signs.push(sign);
  }

  beginDocking() {
    if (this.phase !== 'running') return;
    const stopDistance = Math.max(this.distance, this.nextDepotDistance);
    this.depotMotion = {elapsed: 0, stopDistance,
      speed: (stopDistance - this.distance) / (DEPOT_RULES.dockingSeconds / 2 * METERS_PER_PIXEL)};
    if (this.trackStream?.prepareDepotReset) {
      // Spawning is paused while docked, so the reset branch can be planned during braking.
      this.trackStream.prepareDepotReset(stopDistance, depotResumeFirstDistance(stopDistance));
    }
    this.depotLaunchElapsed = null;
    this.phase = 'docking';
    this.feedback?.airBrake();
    this.steeringPointerId = null;
    this.shipTargetX = this.ship.x;
    this.shipVelocityX = 0;
    this.hideToast();
    this.syncFinishLine();
    syncGuardrailSparks(this.haulerEffects, null);
    syncDepotEntrance(this.depotEntrance, this.nextDepot, this.distance, this.phase, this.levelId);
  }

  updateDocking(dt) {
    const motion = this.depotMotion;
    const step = depotMotionStep(motion.elapsed, dt, DEPOT_RULES.dockingSeconds);
    motion.elapsed = step.elapsed;
    const scrollPx = motion.speed * step.travelSeconds;
    this.distance += scrollPx * METERS_PER_PIXEL;
    if (step.complete) this.distance = motion.stopDistance;
    this.scrollRoad(scrollPx);
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const item = this.objects[i];
      for (const node of [item.sprite, item.shadow, item.roadsideBase, item.pickupGlow, item.pickupSparkle,
        item.blueprintGlow, item.valueText, ...(item.cautionLights ?? []), ...(item.ventAir ?? [])]) {
        if (node) node.y += scrollPx * hazardScrollScale(item);
      }
      const height = item.type === 'hazard' ? hazardGeometry(item).height : item.lengthPx ?? 0;
      if (item.sprite.y - height / 2 > H + 60) this.removeObjectAt(i);
    }
    this.applyTruckRoll(0, dt);
    this.updateShield();
    this.syncHaulerVisuals(dt, motion.speed * step.speedFraction);
    if (this.roadEnvironment) updateRoadEnvironment(this.roadEnvironment, this, this.ship,
      this.distance, scrollPx, dt, this.visibleDepot());
    this.updateDepotFacilities(scrollPx);
    this.refreshHud();
    if (step.complete) {
      this.depotMotion = null;
      this.showDepot();
    }
  }

  updateDepot(priorDistance = this.distance, priorShipX = this.ship.x) {
    if (this.phase !== 'running') return;
    syncDepotEntrance(this.depotEntrance, this.nextDepot, this.distance, this.phase, this.levelId);
    if (this.nextDepotDistance - this.distance <= DEPOT_APPROACH_HINT_M) this.triggerHint('depotApproach');
    const entryDistance = this.tutorialRun
      ? this.nextDepotDistance - 240 * DEPOT_RULES.dockingSeconds / 2 * METERS_PER_PIXEL
      : depotDockingStart(this.nextDepot, this.levelId, this.runMode);
    if (this.distance < entryDistance || !Number.isFinite(entryDistance)) return;
    const fraction = this.distance > priorDistance && priorDistance < entryDistance
      ? Math.max(0, Math.min(1, (entryDistance - priorDistance) / (this.distance - priorDistance))) : 1;
    const crossingX = priorShipX + (this.ship.x - priorShipX) * fraction;
    if (!this.debugManager?.flags.bot &&
        depotEntryAllowed({...this.nextDepot, distance: entryDistance}, this.distance, crossingX,
          Math.min(priorDistance, entryDistance), (player, bay) => {
            this._scratchPlayerRect.setTo(player.x, player.y, player.width, player.height);
            this._scratchDepotRect.setTo(bay.x, bay.y, bay.width, bay.height);
            const left = Math.max(this._scratchPlayerRect.x, this._scratchDepotRect.x);
            const top = Math.max(this._scratchPlayerRect.y, this._scratchDepotRect.y);
            const right = Math.min(this._scratchPlayerRect.right, this._scratchDepotRect.right);
            const bottom = Math.min(this._scratchPlayerRect.bottom, this._scratchDepotRect.bottom);
            return this._scratchIntersectionRect.setTo(left, top,
              Math.max(0, right - left), Math.max(0, bottom - top));
          })) {
      this.ship.x = crossingX;
      this.beginDocking();
    } else if (this.distance >= this.nextDepotDistance) {
      this.runEconomy = this.runMode === 'continuous'
        ? passContinuousDepot(this.runEconomy) : skipDepot(this.runEconomy);
      this.runEconomy.depotsReached += 1;
      this.advanceDepot();
      this.announceBonus();
    }
  }

  announceBonus() {
    this.refreshHud();
    if (this.runMode === 'continuous') {
      const bonus = continuousQuote(this.cargoItems, this.runEconomy).percent;
      this.showToast(`DEPOT PASSED\nCargo bonus: +${bonus}% (max 100%).`, 'hint');
      return;
    }
    const bonus = riskBonusPercent(this.runEconomy);
    const bonusCapPercent = Math.round(DEPOT_ECONOMY.riskCap * 100);
    this.showToast(`${bonus === bonusCapPercent ? 'BONUS AT MAXIMUM' : 'BONUS INCREASED'}\nCurrent bonus: +${bonus}%`, 'hint');
  }

  advanceDepot() {
    this.protectedUntilDistance = this.nextDepotDistance + DEPOT_RULES.exitMeters;
    this.nextDepot = nextDepotAfter(this.nextDepotDistance, DEPOT_RULES, this.levelId, this.runMode);
    this.nextDepotDistance = this.nextDepot.distance;
  }

  protectDepotExit() {
    this.advanceDepot();
    const firstDistance = depotResumeFirstDistance(this.distance);
    this.trackStream.resetAfterDepot(this.distance, {firstDistance});
    // The first rows are placed already on the road (the Depot overlay hid them) and arrive DEPOT_RESUME_METERS on.
    this.resumeSpawnDistance = this.distance;
    this.nextTrackRowDistance = firstDistance;
    this.spawnTimer = 0;
  }

  /** Distance after `seconds` of the run loop's own motion, so background planning knows each first row. */
  predictRouteDistance(distance, seconds,
    {launchSeconds = null, levelId = this.levelId, mode = this.runMode} = {}) {
    const step = 1 / 240;
    let launch = launchSeconds === null ? null : 0;
    for (let elapsed = 0; elapsed < seconds;) {
      const dt = Math.min(step, seconds - elapsed);
      let scroll = Math.min(routeSpeedAtDistance(distance, levelId, mode), MAX_TRACK_SPEED);
      if (launch !== null) {
        const motion = depotMotionStep(launch, dt, launchSeconds, true);
        launch = motion.complete ? null : motion.elapsed;
        scroll *= dt > 0 ? motion.travelSeconds / dt : 0;
      }
      distance += dt * scroll * METERS_PER_PIXEL;
      elapsed += dt;
    }
    return distance;
  }

  /** Brief beat so the player sees the final hit before the result screen. */
  beginCrash() {
    if (this.godMode) return;
    this.phase = 'crashing';
    syncDepotEntrance(this.depotEntrance, this.nextDepot, this.distance, this.phase, this.levelId);
    this.refreshHud();
    this.hideToast();
    this.ship.setVisible(false);
    this.shieldRing.setVisible(false);
    this.cargoIndicators.forEach(o => o.setVisible(false));
    this.syncHaulerVisuals();
    this.time.delayedCall(CRASH_RESULT_DELAY_MS, () => this.finishRun(false));
  }

  updateShield() {
    this.shieldRing.setPosition(this.ship.x, this.ship.y).setVisible(this.shieldCharges > 0);
  }

  absorbWithShield(x, y, invulnerabilitySeconds) {
    this.feedback?.impact({damaging: false});
    this.invulnerable = invulnerabilitySeconds;
    this.updateShield();
    this.refreshHud();
    this.debris.explode(14, x, y);
    this.cameras.main.shake(100, 0.012);
    playImpactSparks(this.haulerEffects, this.ship, x, y);
    this.floatText(this.ship.x, this.ship.y - 52, 'SHIELD ABSORBED', '#7fe3ff', 16);
  }

  awardNearMiss() {
    const award = awardCloseCall(this.runEconomy, this.cargoItems);
    if (!award.awarded) return;
    this.runEconomy = award.run;
    this.floatText(this.ship.x, this.ship.y - 52,
      `+${GAME_BALANCE.physics.collision.closeCall.bonusStepPercent}% CLOSE CALL!`, '#ffe6a1', 18,
      30, 400);
  }

  applyMagnet(item, dt) {
    if (this.stats.magnet <= 0) return;
    const position = advanceMagnet({
      x: item.sprite.x, y: item.sprite.y,
      targetX: this.ship.x, targetY: this.ship.y,
      range: this.stats.magnet + CARGO_COLLISION_DISTANCE_PX, dt,
    });
    item.sprite.setPosition(position.x, position.y);
  }

  recordMilestones() {
    if (isDeveloperRun(this.runEconomy) || this.tutorialRun) return;
    if (this.runMode === 'continuous') return;
    const reached = milestonesForDistance(this.distance, this.levelId);
    const alreadyTraversed = this.checkpointStart
      ? new Set(milestonesForDistance(this.startDistance, this.levelId)) : new Set();
    const sectorProgress = recordSectorProgress(this.profile, this.levelId, this.distance, this.startDistance);
    const {profile, added} = addMilestones(sectorProgress, reached.filter(id => !alreadyTraversed.has(id)));
    const levelProgress = profile.levelProgress[this.levelId];
    const checkpointUnlocked = !levelProgress.sector3CheckpointUnlocked &&
      this.distance >= checkpointDistance(this.levelId);
    const withCheckpoint = checkpointUnlocked ? {
      ...profile,
      levelProgress: {
        ...profile.levelProgress,
        [this.levelId]: {...levelProgress, sector3CheckpointUnlocked: true},
      },
    } : profile;
    const released = releaseDeferredBlueprints(withCheckpoint);
    if (!added.length && !checkpointUnlocked && released === this.profile) return;
    if (!this.persistProfile(released)) {
      this.showToast('Progress could not be saved. Check browser storage.', 'error');
      return;
    }
    this.profile = released;
    this.runEconomy.otherCoins += released.coins - withCheckpoint.coins;
    this.runMilestones.push(...added);
  }

  showDepot() {
    if (this.phase !== 'running' && this.phase !== 'docking') return;
    this.depotMotion = null;
    this.phase = 'depot';
    this.feedback?.depot();
    this.currentSector = sectorAtDistance(this.distance, this.levelId, this.runMode);
    this.syncFinishLine();
    this.depotCount += 1;
    this.runEconomy.depotsReached += 1;
    this.depotVisit = {distance: this.nextDepotDistance, repaired: false, banked: false, bankFailed: false, secured: 0};
    if (this.runMode !== 'continuous') this.shieldCharges = this.stats.shieldCapacity;
    this.updateShield();
    this.refreshHud();
    this.hudContainer?.setVisible(false);
    if (this.hull < this.maxHull) this.runContext.damagedDepot = true;
    this.steeringPointerId = null;
    syncDepotEntrance(this.depotEntrance, this.nextDepot, this.distance, this.phase, this.levelId);
    this.syncHaulerVisuals();
    this.hideToast();
    this.cameras?.main?.flash?.(200, 0, 255, 255, 0.4);
    if (this.tutorialRun) {
      this.completeRookieTrial();
      return;
    }
    if (this.runMode === 'continuous') this.renderContinuousDepot();
    else this.renderDepot();
    this.recordMilestones();
  }

  completeRookieTrial() {
    const cargoCoins = this.cargoValue;
    const shouldCreditRewards = !this.profile.rookieTrialRewardsCredited;
    if (shouldCreditRewards) {
      const rewardedProfile = {...this.profile,
        coins: this.profile.coins + cargoCoins + 150,
        blueprints: this.profile.blueprints + 1,
        rookieTrialRewardsCredited: true};
      if (!this.persistProfile(rewardedProfile)) {
        this.phase = 'tutorialRewardSaveError';
        this.panel('ROOKIE TRIAL CLEAR', 'The reward could not be saved. Your cargo is still safe.');
        this.addButton('RETRY SAVE', H / 2 + 72, () => this.completeRookieTrial(),
          {width: 260, height: 54, size: 14, fill: PALETTE.cockpit});
        return;
      }
      this.profile = rewardedProfile;
    }
    this.tutorialPayout = {coins: shouldCreditRewards ? cargoCoins + 150 : 0,
      blueprints: shouldCreditRewards ? 1 : 0};
    this.cargoItems = [];
    this.syncCargoTotals();
    this.tutorialGarageFocus = true;
    this.shopChassisId = this.profile.selectedVehicleId;
    this.showUpgradeDetail('module', 'hand_precision');
  }

  renderContinuousDepot(message = '') {
    if (this.phase !== 'depot' || this.runMode !== 'continuous') return;
    const quote = continuousQuote(this.cargoItems, this.runEconomy);
    const wallet = this.profile.coins;
    this.panel('ENDLESS DEPOT', `${Math.floor(this.distance)} m • End run or skip`,
      {coverViewport: true});
    const layout = this.menuMetrics();
    this.createMenuScroll('continuous-depot', layout.contentTop, layout.contentBottom);
    let y = layout.contentTop + 24;
    for (const [label, value] of [['Cargo hold', quote.cargo], ['Depot bonus', `+${quote.percent}%`],
      ...(quote.closeCallPercent ? [['Close-call bonus', `+${quote.closeCallPercent}%`]] : []),
      ['Cash-out Coins', quote.payout], ['Wallet (safe)', wallet]]) {
      this.addStatRow(label, value, y, {coin: typeof value === 'number', color: '#ffdf7c'});
      y += 42;
    }
    const increment = Math.round(GAME_BALANCE.rewards.continuous.skipBonusPerDepot * 100);
    const explanation = this.addLabel(message || `Cash out ends the run and pays ${quote.payout} Coins. No banking while continuing.\nSkip restores equipped shields and adds ${increment} bonus points (max 100%).\n\nA crash loses all cargo. Only a Depot cash-out earns Coins.`,
      W / 2, y + 12, 14, '#dfeaf3', 310).setLineSpacing(4);
    y += explanation.height + 30;
    this.addButton('CASH OUT & END RUN', y, () => this.finishRun(true),
      {height: 56, size: 17, fill: PALETTE.depotDark});
    this.finishMenuScroll();
    this.addFooterButton('SKIP', () => this.resumeAfterDepot(),
      {height: 48, size: 16, fill: 0x815d34});
  }

  renderDepot(message = '') {
    if (this.phase !== 'depot' || this.runMode === 'continuous') return;
    if (!this.profile.seenHints.includes('depotEconomy')) {
      this.panel('CARGO DEPOT', 'New Depot choices', {coverViewport: true});
      this.addLabel(HINTS.depotEconomy, W / 2, 245, 18, '#dfeaf3', 315).setLineSpacing(12);
      this.addButton('GOT IT', 650, () => {
        const profile = {...this.profile, seenHints: markHintSeen(this.profile.seenHints, 'depotEconomy')};
        if (!this.persistProfile(profile)) {
          this.showToast('Tip preference could not be saved. Check browser storage and retry.', 'error');
          return;
        }
        this.profile = profile;
        this.renderDepot();
      });
      return;
    }
    const quote = bankingQuote(this.cargoItems, this.runEconomy);
    const offer = repairOffer(this.profile, this.runEconomy, this.depotVisit, this.hull, this.maxHull, this.distance);
    this.panel('CARGO DEPOT', `${this.currentSector.name}  •  ${Math.floor(this.distance)} m`,
      {coverViewport: true});
    this.addCard(202, 112);
    this.addStatRow('Cargo Value', quote.cargo, 224, {coin: true, color: '#ffdf7c'});
    this.addStatRow('Load', `${this.cargoWeight} / ${this.stats.capacity}`, 258);
    this.addStatRow('Hold Bonuses', `DEPOT +${quote.percent}% / CLOSE +${quote.closeCallPercent}%`, 292,
      {color: '#ffdf7c', size: 12});
    this.addCard(326, 62, PALETTE.depot);
    this.addStatRow(this.depotVisit.banked ? 'Cargo secured' : 'Bank now',
      this.depotVisit.banked ? this.depotVisit.secured : quote.payout, 358,
      {coin: true, size: 26, color: '#6fe6bc'});
    this.addCard(400, 66);
    this.addStatRow('Wallet', this.profile.coins, 420, {coin: true, color: '#ffdf7c'});
    this.addStatRow('Hull', `${this.hull} / ${this.maxHull}`, 450, {color: '#79dbe4'});
    this.addButton('REPAIR +1 HULL', 502, () => this.repairAtDepot(),
      {coins: offer.cost, height: 52, size: 16, fill: PALETTE.steelDark,
        disabled: this.depotVisit.bankFailed || !offer.enabled});
    const repairReason = offer.reason.startsWith('Need ') ? 'Not enough wallet Coins' : offer.reason;
    this.addLabel(repairReason || `Restore 1 Hull, up to ${this.maxHull}. One repair per run.`,
      W / 2, 536, 14, '#b2c8d4', 310);
    this.addButton(this.depotVisit.banked ? 'CARGO SECURED'
      : this.depotVisit.bankFailed ? 'RETRY BANKING' : 'BANK & CONTINUE', 594, () => this.bankAtDepot(),
      {height: 52, fill: PALETTE.depotDark, disabled: this.depotVisit.banked});
    this.addButton(this.depotVisit.banked ? 'RESUME RUN'
      : quote.percent < DEPOT_ECONOMY.riskCapPercent ? 'SKIP FOR +20%' : 'PUSH ON  •  BONUS CAPPED',
      660, () => this.resumeAfterDepot(),
      {height: 52, size: 16, fill: 0x815d34, disabled: this.depotVisit.bankFailed});
    if (!this.depotVisit.banked) this.addButton('BANK & END RUN', 726, () => this.confirmBankFinish(),
      {height: 52, size: 17, fill: PALETTE.steelDark, disabled: this.depotVisit.bankFailed});
    const depotMessage = this.addLabel(message || (this.depotVisit.banked
      ? 'Cargo secured. Repair if needed, then resume.'
      : this.depotVisit.bankFailed ? 'Banking failed. Retry to secure cargo before leaving.'
        : 'Bank to secure cargo, or skip to build your bonus.'),
    W / 2, 768, 13, '#6fe6bc', 310).setLineSpacing(4);
    if (!message && !this.profile.milestones.includes(depotMilestoneId('level1'))) {
      this.addLabel('Your first bank unlocks new Garage upgrades.', W / 2,
        768 + (depotMessage.displayHeight ?? depotMessage.height ?? 0) + 8,
        10, '#b2c8d4', 310);
    }
  }

  bankAtDepot(render = true) {
    if (this.phase !== 'depot' || this.runMode === 'continuous' ||
        this.depotVisit.banked) return false;
    const bank = bankCargo(this.profile, this.runEconomy, this.cargoItems);
    if (!this.persistProfile(bank.profile)) {
      this.depotVisit.bankFailed = true;
      if (render) this.renderDepot('Saving failed. Cargo is still in your hold. Retry banking before leaving.');
      this.showToast('Cargo could not be banked. Check browser storage and retry banking.', 'error');
      return false;
    }
    this.profile = bank.profile;
    this.runEconomy = bank.run;
    this.cargoItems = bank.items;
    this.runMilestones.push(...bank.added);
    this.depotVisit.banked = true;
    this.depotVisit.bankFailed = false;
    this.depotVisit.secured = bank.quote.payout;
    this.syncCargoTotals();
    this.refreshHud();
    this.syncHaulerVisuals();
    if (render) this.renderDepot('Cargo secured. Bonus reset to +0%.\nRepair if needed, then resume.');
    return true;
  }

  repairAtDepot() {
    if (this.phase !== 'depot' || this.runMode === 'continuous') return;
    if (this.depotVisit.bankFailed) {
      this.showToast('Retry banking before using maintenance services.', 'error');
      return;
    }
    const repair = purchaseRepair(this.profile, this.runEconomy, this.depotVisit, this.hull, this.maxHull, this.distance);
    if (!repair.ok) {
      this.showToast(repair.reason, 'warning');
      return;
    }
    if (!this.persistProfile(repair.profile)) {
      this.showToast('Repair could not be saved. No Coins charged. Check storage and retry.', 'error');
      return;
    }
    this.profile = repair.profile;
    this.runEconomy = repair.run;
    this.depotVisit = repair.visit;
    this.hull = repair.hull;
    this.refreshHud();
    this.renderDepot('Hull repaired by 1. One repair is allowed per normal run.');
  }

  confirmBankFinish() {
    if (this.phase !== 'depot' || this.runMode === 'continuous') return;
    if (this.depotVisit.banked) return;
    if (this.depotVisit.bankFailed) {
      this.showToast('Retry banking before ending the run.', 'error');
      return;
    }
    const quote = bankingQuote(this.cargoItems, this.runEconomy);
    const cleanRunEligible = this.runEconomy.depotsReached >=
      GAME_BALANCE.rewards.noDamageCargo.eligibleAfterPassedDepots && this.runEconomy.damagingHits === 0;
    const cleanRunPayout = cleanRunEligible
      ? this.runEconomy.noDamageBonusPending + quote.noDamageBonus : 0;
    this.panel('FINISH THIS RUN?', `Your run will end at ${Math.floor(this.distance)} m`,
      {coverViewport: true});
    this.addCard(224, cleanRunEligible ? 102 : 72, PALETTE.depot);
    this.addStatRow('Bank now', quote.payout, 250, {coin: true, size: 22, color: '#6fe6bc'});
    if (cleanRunEligible) {
      this.addStatRow('Clean-run cargo bonus', cleanRunPayout, 280, {coin: true, size: 16, color: '#6fe6bc'});
    }
    this.addLabel('Already secured Coins stay safe.\nNo-damage bonus requires 2 Depots and zero hits.',
      W / 2, 344, 15, '#bfd0e0', 310);
    this.addButton('CONFIRM BANK & END RUN', 490, () => this.finishRun(true), {size: 16, fill: PALETTE.depotDark});
    this.addButton('BACK TO DEPOT', 590, () => this.renderDepot(), {fill: PALETTE.steelDark});
  }

  getRunEconomyDebug() {
    if (!this.runEconomy) return null;
    return this.runResult ?? runEconomySummary(this.runEconomy, this.distance, this.phase);
  }

  /** Continue from a Depot onto a clear road, with a short buffer before new rows can arrive. */
  resumeAfterDepot() {
    if (this.phase !== 'depot') return;
    if (this.runMode !== 'continuous' && this.depotVisit.bankFailed) {
      this.showToast('Cargo has not been saved. Retry banking before resuming.', 'error');
      return;
    }
    if (this.runMode === 'continuous') this.shieldCharges = this.stats.shieldCapacity;
    const pushed = !this.depotVisit?.banked;
    if (pushed) this.runEconomy = this.runMode === 'continuous'
      ? passContinuousDepot(this.runEconomy) : skipDepot(this.runEconomy);
    this.steeringPointerId = null;
    this.clearOverlay();
    this.removeObjects();
    this.protectDepotExit();
    syncSectorRoad(this.roadSurface, this.dustSurface, this.distance, this.levelId, this.runMode, this.subRoad);
    this.centerShip();
    this.feedback?.resetSteering(this.ship.x);
    this.phase = 'running';
    this.hudContainer?.setVisible(true);
    this.depotLaunchElapsed = 0;
    this.invulnerable = DEPOT_RULES.launchSeconds;
    this.ship.setAlpha?.(0.58);
    this.updateShield();
    this.cameras?.main?.setBackgroundColor(0x0a1222);
    this.syncHaulerVisuals();
    if (this.roadEnvironment) {
      setRoadLighting(this.roadEnvironment, lightingForSector(sectorAtDistance(this.distance, this.levelId, this.runMode),
        this.distance, routeFinishDistance(this.levelId), this.runMode, this.levelId));
      startRoadBurst(this.roadEnvironment, this, this.haulerEffects.exhaust);
    }
    if (pushed) this.announceBonus();
    else {
      this.refreshHud();
      this.showToast('Cargo secured. Your bonus is reset to +0%.', 'hint');
    }
  }

  finishRun(banked, completed = false, voluntaryEnd = false) {
    if (this.phase === 'result') return; // guard against double settlement
    if (banked && this.phase !== 'depot' && !completed) return;
    if (completed && this.phase !== 'running' && this.phase !== 'finishing') return;
    if (!banked && this.phase !== 'running' && this.phase !== 'crashing' &&
        !(voluntaryEnd && this.phase === 'pauseEndConfirm')) return;
    this.voluntaryRunEnd = voluntaryEnd;
    this.feedback?.stopRunMusic?.();
    const settlement = settleRun(this.profile, this.runEconomy, this.cargoItems, this.distance, banked, completed);
    if (settlement.duplicate) {
      this.phase = 'result';
      this.panel('RUN ALREADY SETTLED', 'This run has already been paid. No additional reward was applied.');
      this.addFooterButton('MAIN MENU', () => this.showMenu(), {fill: PALETTE.steelDark, height: 48});
      return;
    }
    if (!this.persistProfile(settlement.profile)) {
      if (completed) {
        this.phase = 'finishing';
        this.panel('SAVE FAILED', 'Level completion is paused. No completion rewards were applied.');
        this.addLabel('Check browser storage, then retry. Your run and cargo are still available.',
          W / 2, 280, 17, '#bfd0e0', 320);
        this.addButton('RETRY COMPLETION SAVE', 530, () => this.finishRun(true, true), {size: 16});
        this.showToast('Level completion could not be saved. Please retry.', 'error');
      } else if (banked && this.runMode === 'continuous') {
        this.renderContinuousDepot('Saving failed. Your run and cargo remain available; retry End Run.');
        this.showToast('Endless cash-out could not be saved. Please retry.', 'error');
      } else if (banked) this.showToast('Cargo could not be banked. Check browser storage and retry Bank.', 'error');
      else {
        this.phase = 'crashing';
        this.panel('SAVE FAILED', 'Your run is paused. No result reward has been applied.');
        this.addLabel('Check browser storage, then retry saving.\nPreviously banked Coins remain secure.',
          W / 2, 280, 17, '#bfd0e0', 320);
        this.addButton('RETRY SAVING RESULTS', 530, () => this.finishRun(false, false, voluntaryEnd), {size: 16});
        this.showToast('Run results could not be saved. Please retry.', 'error');
      }
      return;
    }
    this.profile = settlement.profile;
    this.runEconomy = settlement.run;
    this.runResult = {...settlement.summary, cargoLost: settlement.cargoLost + this.runContext.cargoLostToHits};
    this.runMilestones.push(...settlement.added);
    this.cargoItems = [];
    this.syncCargoTotals();
    this.steeringPointerId = null;
    this.phase = 'result';
    this.syncFinishLine();
    syncDepotEntrance(this.depotEntrance, this.nextDepot, this.distance, this.phase, this.levelId);
    this.removeObjects();
    this.removeDepotFacilities();
    this.renderRunResult(completed, banked, settlement.goldUnlocked);
  }

  renderRunResult(completed, banked, goldUnlocked = false) {
    this.phase = 'result';
    this.setScreenRenderer(() => this.renderRunResult(completed, banked, goldUnlocked));
    this.setWorldVisible(false);
    const levelName = levelDisplayName(this.levelId);
    this.panel(this.runMode === 'continuous'
      ? banked ? 'ENDLESS CASHED OUT' : this.voluntaryRunEnd ? 'ENDLESS RUN ENDED' : 'ENDLESS WRECK'
      : completed ? `${levelName} COMPLETE` : banked ? 'RUN COMPLETE'
        : this.voluntaryRunEnd ? 'RUN ENDED' : 'VEHICLE DISABLED',
    `${this.runMode === 'continuous'
      ? banked ? 'Cashed out at' : this.voluntaryRunEnd ? 'Ended at' : 'Hull destroyed after'
      : completed ? `Finished ${levelName} at` : banked || this.voluntaryRunEnd ? 'Run ended at' : 'Hull destroyed after'} ${Math.floor(this.distance)} m`);
    this.syncHaulerVisuals();
    const result = this.runResult;
    const layout = this.menuMetrics();
    this.createMenuScroll(`result:${this.levelId}:${this.runMode}`, layout.contentTop, layout.contentBottom);
    let y = layout.contentTop + 12;
    this.addLabel(result.net < 0 ? 'NET CHANGE' : 'YOU EARNED',
      W / 2, y, 11, '#b8c9d8');
    y += 34;
    this.addCurrency(result.net, W / 2, y, {
      size: 25, color: result.net < 0 ? '#ff9aa6' : '#6fe6bc', maxWidth: 280,
    });
    y += 42;
    const rows = this.runMode === 'continuous'
      ? [...(banked
        ? [['Cargo cashed out', result.cargoCoins], ['Cargo bonus', result.bonusCoins]]
        : [['Forfeited cargo', result.cargoLost]]),
        ['Net gain', result.net], ['Wallet (safe)', this.profile.coins]]
      : [
        ['Cargo banked', result.cargoCoins], ['Hold bonuses', result.bonusCoins],
        ['No-damage bonus', result.noDamageCoins], ['Level record award', result.recordCoins],
        ['Level completion award', result.completionCoins], ['Distance reward', result.distanceCoins],
        ...(result.otherCoins ? [['Other rewards', result.otherCoins]] : []),
        ['Repairs spent', result.repairCosts], ['Net gain', result.net], ['Wallet', this.profile.coins],
      ];
    this.addLabel('RUN BREAKDOWN', W / 2, y, 11, '#a0f4ff', 342);
    y += 24;
    rows.forEach(([label, value]) => {
        if (typeof value === 'number' && String(Math.abs(value)).length >= 9) {
          const labelY = y + 8;
          const labelText = this.addLabel(label, W / 2, labelY, 12, '#b8c9d8', 342);
          const labelHeight = labelText.displayHeight ?? labelText.height ?? 14;
          const amountY = labelY + labelHeight + 20;
          const amount = this.addCurrency(value, W / 2, amountY, {
            size: 18, color: label === 'Net gain' && value < 0 ? '#ff9aa6' : '#ffdf7c',
            maxWidth: 280,
          });
          y = amountY + (amount.displayHeight ?? amount.height ?? 20) / 2 + 8;
          return;
        }
      const row = this.addStatRow(label, value, y + 10, {
        coin: true, size: 14,
        color: label === 'Net gain' && value < 0 ? '#ff9aa6' : '#ffdf7c',
      });
      y += (row?.height ?? 18) + 6;
    });
    const progress = this.profile.levelProgress[this.levelId];
    if (this.runMode === 'normal') {
      const record = this.addStatRow(`${levelName} full-start record`,
        `${progress.bestDistance} m`, y + 10, {size: 12});
      y += (record?.height ?? 18) + 6;
    }
    if (this.checkpointStart) {
      const checkpoint = this.addStatRow('Checkpoint record',
        `${progress.checkpointBestDistance} m`, y + 10, {size: 12});
      y += (checkpoint?.height ?? 18) + 6;
    }
    if (result.cargoLost > 0) {
      const lost = this.addStatRow('Lost unbanked cargo', result.cargoLost, y + 10,
        {coin: true, size: 12, color: '#ff9aa6'});
      y += (lost?.height ?? 18) + 6;
    }
    const discoveries = [
      ...(this.runMilestones.some(milestoneUnlocksUpgrades) ? ['New Garage upgrades unlocked'] : []),
      ...(this.profile.blueprints ? [`Blueprints saved: ${this.profile.blueprints}`] : []),
      ...(goldUnlocked ? ['Achievement unlocked: Gold Standard Hauler'] : []),
    ];
    if (discoveries.length) {
      const discovered = this.addLabel(discoveries.join('  •  '), W / 2, y, 10, '#6fe6bc', 342);
      y += discovered.height + 12;
    }
    const tip = this.addLabel(resultTip(this.runContext, result, this.profile.totalRuns),
      W / 2, y, 12, '#dfeaf3', 342)
      .setLineSpacing(3);
    y += tip.height + 12;
    this.finishMenuScroll();
    if (completed) {
      this.addFooterActions([
        {label: 'NEXT OPTIONS', onClick: () => this.showLevelSelect()},
        {label: 'GARAGE', onClick: () => this.showGarage(), options: {fill: PALETTE.steelDark}},
        {label: 'MAIN MENU', onClick: () => this.showMenu(), options: {fill: PALETTE.steelDark}},
      ]);
    } else {
      this.addFooterActions([
        {label: 'GARAGE', onClick: () => this.showGarage(), options: {fill: PALETTE.steelDark}},
        {label: 'RUN AGAIN', onClick: () => this.runMode === 'continuous'
          ? this.showContinuousConfirm() : this.showLevelSelect()},
        {label: 'MAIN MENU', onClick: () => this.showMenu(), options: {fill: PALETTE.steelDark}},
      ]);
    }
  }
}
