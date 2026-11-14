import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {BUILD_ID} from '../src/game/data/build.js';
import {defaultProfile, normalizeProfile} from '../src/game/core/save.js';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';
import {ROAD_LEFT, ROAD_RIGHT, SHIP_Y, SPAWN_Y} from '../src/game/data/route.js';
import {
  loadoutStats, addMilestones, milestonesForDistance, depotMilestoneId, milestoneUnlocksUpgrades, cargoCapacityStatus, reinforcedCargoStatus,
  MODULE_DEFS, moduleStatus, formatStat,
  CARGO_CAPACITY_ID, moduleLevelCap, nextSlotOffer, upgradeCargoCapacity, upgradeReinforcedCargo, equipModule, unequipModule,
  buyModule, upgradeModule, unlockNextSlot, MAX_MODULE_LEVEL,
} from '../src/game/core/modules.js';
import {IMPLEMENTED_LEVELS, sectorAtDistance} from '../src/game/core/sectors.js';
import {CHUNK_REGISTRIES, prepareTrackChunk, CARGO_COLLISION_DISTANCE_PX, createTrackStream, depotResumeFirstDistance, hazardsBeforeDepot} from '../src/game/core/trackGenerator.js';
import {createRouteStream, ROUTE_STREAM_LATE_ROW_MS, warmRouteStreamWorkers} from '../src/game/core/routeStream.js';
import {MAX_TRACK_SPEED, BP_TO_COINS, METERS_PER_PIXEL, continuousStageAtDistance, routeFinishDistance, routeSpeedAtDistance, routeTimeAtDistance, crashReward, SINGLE_COIN_PAYOUT, SLOT_MAX, steeringMultiplier, upgradeCost} from '../src/game/core/economy.js';
import {adjustDeveloperCoins, isDeveloperRun, markDeveloperRun} from '../src/game/core/developerRuns.js';
import {DebugManager, DEBUG_FAST_MULTIPLIER} from '../src/game/core/DebugManager.js';
import {awardBlueprint, createBlueprintRun, releaseDeferredBlueprints, blueprintEligible} from '../src/game/core/blueprints.js';
import {addModuleIcon, colorText, hazardTexture, MODULE_CAPTIONS, garageUpgradeBenefit, PALETTE, vehicleTint,
  preloadStandardHauler, STANDARD_HAULER_ART, preloadObstacleArt, OBSTACLE_ART,
  preloadSwiftRunner, SWIFT_RUNNER_ART,
  preloadArmouredTransport, ARMOURED_TRANSPORT_ART,
  GARAGE_DISPLAY_ART, preloadGarageDisplayArt,
  GARAGE_UPGRADE_ART, preloadGarageUpgradeArt,
  preloadCollectibleArt, COLLECTIBLE_ART, syncBlueprintVisuals, syncCargoPickupVisuals, syncHaulerEffects,
  cargoPickupTexture, cargoPickupGlowTexture, CARGO_PICKUP_GLOW_OFFSET_Y,
  SPRITE_ART_SCALE, scaleSpriteArt,
  DEPOT_ART, preloadDepotArt, createBarrierLights, syncBarrierLights, stopHaulerExhaust,
  vehicleTexture, vehicleTrimName, addGoldPreviewSparkles,
  createSilhouetteShadow, syncSilhouetteShadow, createDepotFacility, depotFacilityHeight, SHADOW_TINT,
  createGuardrailStructure, syncGuardrailSparks, syncGuardrailBeacon, addHudBacking, GUARDRAIL_ART,
  playImpactSparks} from '../src/game/rendering/industrial.js';
import {balance} from '../src/game/data/balance.js';
import {ENVIRONMENT_VISUALS, HAZARD_READABILITY, NEON_SHOULDER_SIGNS, resolveVisualTheme, SECTOR_LIGHTING, OVERDRIVE_LIGHTING} from '../src/game/data/environments.js';
import {lightingForSector, setRoadLighting, setRoadEnvironmentVisible, startRoadBurst,
  stopRoadBurst, updateRoadEnvironment} from '../src/game/rendering/roadEnvironment.js';
import {cargoOffer, cargoTotals, collectCargo, damageCargo, createCargoTrail} from '../src/game/core/cargo.js';
import {HAZARDS, HAZARD_ROW_ENVELOPE_PX, guardrailContact, guardrailLayout, hazardDefinition, hazardGeometry, hazardHits, hazardX, hazardScrollScale, isGuardrail, LANE_CENTERS, movingHazardOffset, canonicalMotionAge} from '../src/game/core/hazards.js';
import {resolveHazardCollision, advanceNearMiss, cargoPickupHits} from '../src/game/core/collision.js';
import {DEPOT_RULES, nextDepotAfter, depotEntryAllowed, depotDockingStart, depotMotionStep, depotWorldY} from '../src/game/core/depots.js';
import Rectangle from 'phaser/src/geom/rectangle/index.js';
import {routeImage, releaseRouteVisual} from '../src/game/rendering/routeVisualPool.js';
import {advanceSteering, KEYBOARD_BRAKE_SECONDS} from '../src/game/core/steering.js';
import {
  bankCargo, bankingQuote, createRunEconomy, DEPOT_ECONOMY, continuousQuote, passContinuousDepot, purchaseRepair,
  repairOffer, riskBonusPercent, runEconomySummary, settleRun, skipDepot, awardCloseCall, closeCallBonusPercent,
} from '../src/game/core/depotEconomy.js';
import {checkpointDistance, isLevelUnlocked, isRunStartAvailable, recordSectorProgress} from '../src/game/core/progression.js';
import {HINTS, hintForEvent, markHintSeen} from '../src/game/core/onboarding.js';
import {createRunContext, HELP_SECTIONS, resultTip} from '../src/game/core/playerGuidance.js';
import {adaptiveCardMetrics, advanceMenuScroll, managementLayout, measureMenuContent, MENU_SPACING, peekingCardMetrics, responsiveViewport, squareGridMetrics, upgradeTileContentMetrics} from '../src/game/core/menuLayout.js';
import {vehicleStatus, selectVehicle, purchaseVehicle, buyVehicleTrim, selectVehicleTrim} from '../src/game/core/vehicles.js';
import {IMPLEMENTED_VEHICLE_IDS, VEHICLES} from '../src/game/data/catalog.js';

// Exercise the actual scene lifecycle without requiring Phaser's browser renderer in Node.
let savedProfile;
let storageAvailable = true;
let startupWarning = null;
// Lifetime tests count one image per structure; tests opt into real shadow/Depot art via these hooks.
const lightweightVisual = (y = 0) => ({y, setPosition() { return this; }, setVisible() { return this; },
  destroy() { this.destroyed = true; }});
const lightweightGuardrail = (scene, hazard, x, y) => scene.add.image(x, y, 'chicane_mid')
  .setDepth(5).setFlipX(hazard.lane === 3);
const visualHooks = {
  createSilhouetteShadow: () => lightweightVisual(),
  syncSilhouetteShadow: shadow => shadow,
  createDepotFacility: (scene, depot, y) => ({container: lightweightVisual(y), depot}),
  createGuardrailStructure: lightweightGuardrail,
};
function useRealVisuals() {
  Object.assign(visualHooks, {createSilhouetteShadow, syncSilhouetteShadow, createDepotFacility,
    createGuardrailStructure});
  return () => Object.assign(visualHooks, {
    createSilhouetteShadow: () => lightweightVisual(),
    syncSilhouetteShadow: shadow => shadow,
    createDepotFacility: (scene, depot, y) => ({container: lightweightVisual(y), depot}),
    createGuardrailStructure: lightweightGuardrail,
  });
}
const source = readFileSync(new URL('../src/game/scenes/RoutePrototypeScene.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '').replace('export class RoutePrototypeScene', 'class RoutePrototypeScene');
const {Scene, styles} = vm.runInNewContext(`${source}\n({Scene: RoutePrototypeScene, styles: TOAST_STYLES})`, {
  // These logic fixtures replace the display owner; strict Phaser Group allocation is tested in rendering.
  Phaser: {Scene: class { constructor() {
    this.routeVisualPool = {
      image: (...args) => this.add.image(...args),
      container: (...args) => this.add.container(...args),
      tile: (...args) => this.add.tileSprite(...args),
      release: node => node.destroy(),
    };
  } }, Geom: {Rectangle}, BlendModes: {ADD: 1}, Math: {Clamp: (value, min, max) => Math.max(min, Math.min(max, value))}},
  routeImage, releaseRouteVisual,
  balance, depotWorldY, depotFacilityHeight, ENVIRONMENT_VISUALS, HAZARD_READABILITY, fitRoadToView() {},
  lightingForSector, setRoadLighting, setRoadEnvironmentVisible, startRoadBurst,
  stopRoadBurst, updateRoadEnvironment,
  createSilhouetteShadow: (...args) => visualHooks.createSilhouetteShadow(...args),
  syncSilhouetteShadow: (...args) => visualHooks.syncSilhouetteShadow(...args),
  createDepotFacility: (...args) => visualHooks.createDepotFacility(...args),
  createGuardrailStructure: (...args) => visualHooks.createGuardrailStructure(...args),
  isGuardrail, guardrailContact, syncGuardrailSparks, syncGuardrailBeacon, addHudBacking,
  BUILD_ID, routeFinishDistance, movingHazardOffset, canonicalMotionAge, hazardScrollScale, continuousStageAtDistance, SLOT_MAX, steeringMultiplier,
  adjustDeveloperCoins, isDeveloperRun, markDeveloperRun, DebugManager,
  GAME_BALANCE, MAX_TRACK_SPEED, IMPLEMENTED_VEHICLE_IDS, VEHICLES,
  vehicleStatus, selectVehicle, purchaseVehicle, buyVehicleTrim, selectVehicleTrim,
  adaptiveCardMetrics, advanceMenuScroll, managementLayout, measureMenuContent, MENU_SPACING, peekingCardMetrics, responsiveViewport, squareGridMetrics, upgradeTileContentMetrics,
  createRunContext, HELP_SECTIONS, resultTip,
  bankCargo, bankingQuote, createRunEconomy, DEPOT_ECONOMY, continuousQuote, passContinuousDepot,
  awardCloseCall, closeCallBonusPercent, playImpactSparks, advanceNearMiss, cargoPickupHits,
  purchaseRepair,
  repairOffer, riskBonusPercent, runEconomySummary, settleRun, skipDepot, HINTS, markHintSeen,
  checkpointDistance, isLevelUnlocked, isRunStartAvailable, recordSectorProgress, IMPLEMENTED_LEVELS,
  depotMilestoneId, milestoneUnlocksUpgrades,
  ROAD_LEFT, ROAD_RIGHT, crypto: webcrypto, loadoutStats, sectorAtDistance,
  cargoCapacityStatus, reinforcedCargoStatus, moduleStatus, formatStat, MODULE_CAPTIONS, garageUpgradeBenefit,
  CARGO_CAPACITY_ID, moduleLevelCap, nextSlotOffer, upgradeCargoCapacity, upgradeReinforcedCargo, equipModule, unequipModule, addModuleIcon,
  buyModule, upgradeModule, unlockNextSlot, upgradeCost,
  createTrackStream, createRouteStream, ROUTE_STREAM_LATE_ROW_MS, warmRouteStreamWorkers, createBlueprintRun, depotResumeFirstDistance, routeSpeedAtDistance, syncSectorRoad() {},
  PALETTE, colorText, hazardTexture, vehicleTint, preloadStandardHauler, preloadObstacleArt,
  preloadSwiftRunner, preloadArmouredTransport, preloadGarageDisplayArt, GARAGE_UPGRADE_ART, preloadGarageUpgradeArt,
  preloadCollectibleArt, syncBlueprintVisuals, syncCargoPickupVisuals, syncHaulerEffects,
  cargoPickupTexture, cargoPickupGlowTexture, CARGO_PICKUP_GLOW_OFFSET_Y,
  SPRITE_ART_SCALE, scaleSpriteArt,
  preloadDepotArt, preloadNeonVisuals() {}, NEON_SHOULDER_SIGNS, resolveVisualTheme, createBarrierLights, syncBarrierLights, stopHaulerExhaust,
  vehicleTexture, vehicleTrimName, addGoldPreviewSparkles,
  cargoOffer, cargoTotals, collectCargo, damageCargo, createCargoTrail, advanceSteering, KEYBOARD_BRAKE_SECONDS,
  HAZARD_ROW_ENVELOPE_PX, hazardDefinition, hazardGeometry, hazardHits, hazardX, LANE_CENTERS,
  resolveHazardCollision, SHIP_Y, SPAWN_Y,
  hazardsBeforeDepot, CARGO_COLLISION_DISTANCE_PX, awardBlueprint, SINGLE_COIN_PAYOUT, BP_TO_COINS,
  DEPOT_RULES, nextDepotAfter, depotEntryAllowed, depotDockingStart, depotMotionStep, METERS_PER_PIXEL, syncDepotEntrance() {},
  DEPOT_APPROACH_HINT_M: DEPOT_RULES.noticeMeters, addMilestones, milestonesForDistance, releaseDeferredBlueprints,
  crashReward, blueprintEligible,
  runMusicUrl: 'BG_Music.mp3', endlessMusicUrl: 'Sunny_Coastal_Run.mp3', logoUrl: 'GameLogo.svg',
  saveProfile(profile) { if (storageAvailable) savedProfile = profile; return storageAvailable; },
  loadProfile(onWarning) {
    if (startupWarning) onWarning(startupWarning);
    return defaultProfile();
  },
  RunFeedback: class {},
  RouteVisualPool: class { destroy() {} },
  createIndustrialTextures() {},
  destroyRoadEnvironment() {},
  HINTS, hintForEvent, markHintSeen,
  addHaulerPreview() { return []; },
  addSteelControl(scene, x, y, width, height, fill, accent) {
    const control = {x, y, width, height, fill, accent,
      setInteractive() { return this; }, setAlpha() { return this; },
      setFillStyle(fill, alpha = 1) { this.fill = fill; this.fillAlpha = alpha; return this; },
      on(event, handler) { this[event] = handler; return this; }};
    scene.button = control;
    return control;
  },
});

test('startup save recovery warning uses the error toast only after world and menu initialization', () => {
  const scene = new Scene();
  const order = [];
  scene.buildWorld = () => order.push('world');
  scene.createTransientTextPool = () => {};
  scene.handleViewportResize = () => {};
  scene.initializeUrlDebug = () => order.push('menu');
  scene.showToast = (message, style) => order.push({message, style});
  scene.events = {once() {}};
  scene.scale = {on() {}, gameSize: {width: 390, height: 844}};
  scene.add = {graphics: () => ({
    setScrollFactor() { return this; }, setDepth() { return this; }, clear() { return this; },
    fillStyle() { return this; }, fillRect() { return this; }, lineStyle() { return this; },
    lineBetween() { return this; }, strokeRect() { return this; },
  })};
  scene.input = {on() {}, keyboard: {addKeys: () => ({})}};
  startupWarning = 'Original saved progress preserved; saving is blocked.';
  try {
    scene.create();
    assert.deepEqual(order, ['world', 'menu', {message: startupWarning, style: 'error'}]);
    assert.equal(scene.profile.coins, 0);
  } finally {
    startupWarning = null;
  }
});

test('cargo feedback distinguishes crate value from the net gain when replacing cheaper cargo', () => {
  const scene = new Scene();
  scene.ship = {x: 195, y: 684};
  scene.hud = {cargo: {}};
  scene.time = {now: 1000};
  scene.feedback = {cargoPickup() {}};
  scene.coinBurst = {explode() {}};
  scene.pulse = () => {};
  const values = [];
  const messages = [];
  scene.floatCurrency = (value, y, color, size, suffix) => values.push(`${value}${suffix}`);
  scene.floatText = (x, y, message) => messages.push(message);
  scene.playPickupFeedback({kind: 'coinStack', value: 10, sprite: {x: 159, y: 684}},
    {gain: 5, replaced: true});
  assert.deepEqual(values, ['10 CARGO']);
  assert.deepEqual(messages, ['HOLD +5']);
});

test('ordinary startup opens the main menu directly and classifies the first input', () => {
  for (const [inputType, trigger] of [['touch', 'pointerdown'], ['mouse', 'pointerdown'], ['keyboard', 'keydown']]) {
    const scene = new Scene();
    const listeners = new Map();
    scene.buildWorld = () => {};
    scene.createTransientTextPool = () => {};
    scene.handleViewportResize = () => {};
    scene.beginMenuScroll = () => {};
    scene.beginSteering = () => {};
    scene.moveMenuScroll = () => {};
    scene.moveSteering = () => {};
    scene.handlePointerUp = () => {};
    scene.endMenuScroll = () => {};
    scene.scale = {on() {}, off() {}, gameSize: {width: 390, height: 844}};
    scene.add = {graphics: () => ({
      setScrollFactor() { return this; }, setDepth() { return this; }, clear() { return this; },
      fillStyle() { return this; }, fillRect() { return this; }, lineStyle() { return this; },
      lineBetween() { return this; }, strokeRect() { return this; },
    })};
    scene.events = {once() {}};
    scene.input = {
      on(name, handler) { listeners.set(name, handler); },
      keyboard: {
        addKeys: () => ({}),
        on(name, handler) { listeners.set(name, handler); },
        off() {},
      },
    };
    let menuOpens = 0;
    scene.showMenu = () => { menuOpens++; scene.phase = 'menu'; };
    scene.create();
    assert.equal(menuOpens, 1);
    assert.equal(scene.phase, 'menu');
    if (trigger === 'pointerdown') listeners.get(trigger)({wasTouch: inputType === 'touch'});
    else listeners.get(trigger)({preventDefault() {}});
    assert.equal(scene.initialInputType, inputType);
  }
});

test('Rookie Trial keeps guidance before 250 m and an easy pickup route through 500 m', () => {
  const scene = new Scene();
  const stream = scene.createRookieTrialStream(0);
  const rows = [];
  for (let index = 0; index < 60; index++) {
    const row = stream.nextRow(0);
    if (!row) break;
    rows.push(row);
  }
  const at = distance => rows.find(row => row.plannedDistance === distance);
  assert.equal(at(75).pickups[0].lane, 1);
  assert.equal(at(75).pickups[0].value, 15);
  assert.equal(at(150).tutorialBlueprint, true);
  assert.deepEqual([50, 100, 200, 225].filter(distance => distance <= 250), [50, 100, 200, 225]);
  assert.deepEqual([300, 360, 420, 470].map(distance => at(distance).hazards.length), [1, 1, 1, 1]);
  assert.deepEqual([280, 390, 450].map(distance => at(distance).pickups[0].value), [10, 10, 10]);
  assert.ok(rows.filter(row => row.plannedDistance > 250).every(row => row.hazards.length <= 1));
  assert.ok(at(500));
  assert.ok(rows.every(row => row.emitted && row.family === 'rookie_trial'));
  assert.equal(rows.some(row => row.hazards.some(hazard => hazard.movement)), false);
});

test('Rookie Trial prompts stay five seconds apart and trigger at 50, 200, and 225 m', () => {
  const scene = new Scene();
  scene.tutorialRun = true;
  scene.phase = 'running';
  scene.tutorialCheckpointIndex = 1;
  scene.tutorialPopupElapsed = 4.99;
  const shown = [];
  scene.showTutorialCheckpoint = index => shown.push(index);
  scene.distance = 50;
  assert.equal(scene.checkTutorialCheckpoint(), false);
  assert.deepEqual(shown, []);
  scene.tutorialPopupElapsed = 5;
  for (const [index, distance] of [50, 200, 225].entries()) {
    scene.distance = distance;
    assert.equal(scene.checkTutorialCheckpoint(), true);
    assert.equal(scene.distance, distance);
    scene.tutorialCheckpointIndex++;
    scene.tutorialPopupElapsed = 5;
  }
  assert.deepEqual(shown, [1, 2, 3]);
});

test('Rookie Trial credits rewards once and completes after auto-equipping Precision Steering', () => {
  const scene = new Scene();
  scene.profile = defaultProfile();
  scene.cargoValue = 15;
  scene.cargoItems = [{}];
  let savedProfile;
  let writes = 0;
  scene.persistProfile = profile => { savedProfile = profile; writes++; return true; };
  scene.syncCargoTotals = () => { scene.cargoItems = []; scene.cargoValue = 0; };
  scene.showUpgradeDetail = (kind, id) => { scene.focusedUpgrade = [kind, id]; };
  scene.completeRookieTrial();
  assert.equal(savedProfile.coins, 165);
  assert.equal(savedProfile.blueprints, 1);
  assert.equal(savedProfile.rookieTrialRewardsCredited, true);
  assert.deepEqual(scene.focusedUpgrade, ['module', 'hand_precision']);
  assert.equal(scene.tutorialPayout.coins, 165);
  assert.equal(scene.tutorialPayout.blueprints, 1);

  scene.completeRookieTrial();
  assert.equal(writes, 1);
  assert.equal(scene.tutorialPayout.coins, 0);
  assert.equal(scene.tutorialPayout.blueprints, 0);

  const purchase = buyModule(savedProfile, 'hand_precision', 'standard');
  assert.equal(purchase.ok, true);
  assert.ok(purchase.profile.shipStates.standard.equippedModuleIds.includes('hand_precision'));
  scene.tutorialGarageFocus = true;
  scene.showMenu = () => { scene.phase = 'menu'; };
  scene.applyShop(purchase, 'hand_precision', 'Precision Steering bought and equipped.');
  assert.equal(savedProfile.tutorialCompleted, true);
  assert.equal(savedProfile.ownedModules.hand_precision, 1);
  assert.equal(savedProfile.coins, 15);
  assert.equal(scene.phase, 'menu');
});

test('Rookie Trial reward save failure leaves the profile unchanged and can be retried', () => {
  const scene = new Scene();
  scene.profile = defaultProfile();
  scene.cargoValue = 15;
  const originalProfile = scene.profile;
  let retrySave;
  scene.persistProfile = () => false;
  scene.panel = () => {};
  scene.addButton = (label, y, onClick) => { retrySave = onClick; };
  scene.completeRookieTrial();
  assert.equal(scene.profile, originalProfile);
  assert.equal(scene.phase, 'tutorialRewardSaveError');

  let savedProfile;
  scene.persistProfile = profile => { savedProfile = profile; return true; };
  scene.syncCargoTotals = () => { scene.cargoItems = []; scene.cargoValue = 0; };
  scene.showUpgradeDetail = () => {};
  retrySave();
  assert.equal(savedProfile.coins, 165);
  assert.equal(savedProfile.blueprints, 1);
  assert.equal(savedProfile.rookieTrialRewardsCredited, true);
});

test('Normal finish clears hazards at 10 m and never emits obstacles past the finish', () => {
  for (const levelId of ['level1', 'level2']) {
    const scene = depotScene();
    scene.levelId = levelId;
    scene.runMode = 'normal';
    scene.objects = [{type: 'hazard'}, {type: 'cargo'}, {type: 'blueprint'}];
    const removed = [];
    scene.removeObjectAt = index => { removed.push(scene.objects[index].type); scene.objects.splice(index, 1); };
    const finish = GAME_BALANCE.routes[levelId].finishDistanceMeters;
    scene.distance = finish - 10.001;
    scene.clearObstaclesAtFinish();
    assert.deepEqual(removed, [], levelId);
    scene.distance += 0.002;
    scene.clearObstaclesAtFinish();
    assert.deepEqual(removed, ['hazard'], levelId);
    assert.deepEqual(scene.objects.map(object => object.type), ['cargo', 'blueprint'], levelId);
    assert.equal(scene.hazardRowAllowedAtFinish(finish - 9), false, levelId);
    assert.equal(scene.hazardRowAllowedAtFinish(finish + 1), false, levelId);
    scene.distance = finish - 11;
    assert.equal(scene.hazardRowAllowedAtFinish(finish - 11), true, levelId);
    scene.runMode = 'continuous';
    assert.equal(scene.hazardRowAllowedAtFinish(Infinity), true, 'Continuous Run has no finish boundary');
  }
});

test('side obstacle entrance eases in without moving or changing its collision object', () => {
  const scene = new Scene();
  const tweens = [];
  scene.tweens = {add: tween => tweens.push(tween)};
  const sprite = {alpha: 1, setAlpha(value) { this.alpha = value; return this; }};
  scene.fadeInSideObstacle(sprite);
  assert.equal(sprite.alpha, 0);
  assert.equal(tweens.length, 1);
  assert.equal(tweens[0].targets, sprite);
  assert.equal(tweens[0].alpha, 1);
  assert.equal(tweens[0].duration, 220);
  assert.equal(tweens[0].ease, 'Sine.easeOut');
});

test('hint persistence commits seen state and display only after saving, and permits retry after failure', () => {
  const scene = new Scene();
  const initial = defaultProfile();
  scene.profile = initial;
  scene.toast = {visible: false};
  scene.hintQueue = [];
  const shown = [];
  scene.showToast = (message, style) => shown.push({message, style});
  const persist = scene.persistProfile.bind(scene);
  let writes = 0;
  scene.persistProfile = profile => { writes++; return persist(profile); };
  const id = hintForEvent(initial.seenHints, 'runStart');
  assert.ok(id);
  storageAvailable = false;
  savedProfile = null;
  try {
    scene.triggerHint('runStart');
    assert.equal(scene.profile, initial);
    assert.equal(savedProfile, null);
    assert.deepEqual(scene.hintQueue, []);
    assert.equal(shown[0].style, 'error');
    scene.toast.visible = true;
    scene.toastPriority = styles.error.priority;
    for (let frame = 0; frame < 60; frame++) scene.triggerHint('runStart');
    assert.equal(writes, 1, 'a failed Depot hint does not retry synchronous storage every frame');
    assert.equal(shown.length, 1);
    scene.toast.visible = false;
    storageAvailable = true;
    scene.triggerHint('runStart');
    assert.ok(scene.profile.seenHints.includes(id));
    assert.equal(savedProfile, scene.profile);
    assert.deepEqual(initial.seenHints, []);
    assert.equal(shown[1].message, HINTS[id]);
    assert.equal(shown[1].style, 'hint');
    assert.equal(writes, 2);
    scene.triggerHint('runStart');
    assert.equal(shown.length, 2, 'saved hints do not repeat');
  } finally {
    storageAvailable = true;
  }
});

test('persisted hints retain the existing queued-toast behavior', () => {
  const scene = new Scene();
  scene.profile = defaultProfile();
  scene.toast = {visible: true};
  scene.toastPriority = styles.error.priority;
  scene.hintQueue = [];
  scene.showToast = () => assert.fail('a hint must queue behind a higher priority toast');
  const id = hintForEvent(scene.profile.seenHints, 'runStart');
  scene.triggerHint('runStart');
  assert.ok(scene.profile.seenHints.includes(id));
  assert.equal(scene.hintQueue.length, 1);
  assert.equal(scene.hintQueue[0], id);
});

function depotScene() {
  const scene = new Scene();
  const cachedTextures = new Set([...Object.values(HAZARDS).map(hazard => hazard.texture),
    ...GUARDRAIL_ART.map(art => art.key), 'divider_dustlands', 'divider_neon',
    'divider_reactor', 'divider_overdrive']);
  scene.textures = {exists: key => cachedTextures.has(key)};
  scene.sound = {mute: false, setMute(value) { this.mute = value; }};
  scene.ship = {x: 195, y: 684, setScale() {}, setTexture() {}, setTint() {}, clearTint() {}};
  scene.shieldRing = {setPosition() { return this; }, setVisible(value) { this.visible = value; return this; }};
  scene.profile = defaultProfile();
  scene.roadSurface = {tilePositionY: 0};
  scene.lines = [];
  scene.dustSurface = {};
  scene.objects = [];
  scene._scratchPlayerRect = new Rectangle();
  scene._scratchDepotRect = new Rectangle();
  scene._scratchIntersectionRect = new Rectangle();
  scene.time = {now: 0};
  scene.overlayObjects = [];
  scene.uiRows = [];
  scene.uiCurrency = [];
  scene.add = {
    image(x, y, key) {
      return {
        x, y, key, width: 390, height: 190, displayHeight: 190,
        setDepth() { return this; },
        setScale(scale) { this.displayHeight = this.height * scale; return this; },
      };
    },
  };
  scene.addCard = () => {};
  scene.addStatRow = (label, value, y, options) => scene.uiRows.push({label, value, y, ...options});
  scene.addCurrency = (value, x, y, options) => {
    scene.uiCurrency.push({value, x, y, ...options});
    return {width: 50, displayWidth: 50, setAlpha() {}, setPosition() {}, setY() {}, destroy() {}};
  };
  scene.acquireTransientText = (x, y, text) => ({
    x, y, text,
    setPosition(nextX, nextY) { this.x = nextX; this.y = nextY; return this; },
    setVisible(value) { this.visible = value; return this; },
    setAlpha(value) { this.alpha = value; return this; },
    destroy() {},
  });
  scene.releaseTransientText = node => node?.destroy?.();
  for (const method of ['clearOverlay', 'setWorldVisible', 'refreshHud', 'triggerHint', 'showToast',
    'syncHaulerVisuals', 'panel', 'hideToast', 'addButton', 'createMenuScroll', 'finishMenuScroll']) {
    scene[method] = () => {};
  }
  scene.addLabel = () => ({
    height: 16,
    setOrigin() { return this; },
    setAlign() { return this; },
    setY() { return this; },
    setLineSpacing() { return this; },
  });
  scene.addCardText = (message, left, y, width, size, color) =>
    scene.addLabel(message, left + width / 2, y, size, color, width);
  scene.startRun();
  scene.runEconomy.fullStart = false;
  return scene;
}

function loadCargo(scene, value) {
  scene.cargoItems = [{kind: 'coinStack', value, mass: 1, slots: 1}];
  scene.syncCargoTotals();
}

function finishDocking(scene) {
  for (let frame = 0; frame < 31 && scene.phase === 'docking'; frame++) scene.updateStep(0, 50);
  assert.equal(scene.phase, 'depot');
}

test('transient text pool prewarms labels and reuses released entries', () => {
  const scene = new Scene();
  let created = 0;
  const displayObject = (x = 0, y = 0, text = '') => ({
    x, y, text, width: text.length * 8,
    setOrigin() { return this; },
    setDepth() { return this; },
    setVisible(value) { this.visible = value; return this; },
    setText(value) { this.text = value; this.width = value.length * 8; return this; },
    setFontSize() { return this; },
    setColor() { return this; },
    setAlpha(value) { this.alpha = value; return this; },
    setPosition(nextX, nextY) { this.x = nextX; this.y = nextY; return this; },
    setDisplaySize() { return this; },
    destroy() { throw new Error('pooled labels must not be destroyed'); },
  });
  scene.add = {
    text(x, y, text) { created++; return displayObject(x, y, text); },
    image(x, y) { return displayObject(x, y); },
    container(x, y) {
      const container = displayObject(x, y);
      container.setDepth = () => container;
      return container;
    },
  };
  scene.tweens = {killTweensOf() {}};
  scene.createTransientTextPool();
  assert.equal(created, 32);
  const first = scene.acquireTransientText(20, 30, 'PICKUP', '#ffffff', 18);
  scene.releaseTransientText(first);
  const reused = scene.acquireTransientText(40, 50, 'BANKED', '#ffdf7c', 14, true);
  assert.equal(reused, first);
  assert.equal(reused.visible, true);
  assert.equal(reused.alpha, 1);
  assert.equal(created, 32);
});

test('URL debug boots the exact implemented level and sector without recording progress', () => {
  for (const levelId of ['level1', 'level2']) for (const sectorNumber of [1, 2, 3, 4]) {
    const scene = depotScene();
    const profile = scene.profile;
    const before = JSON.stringify(profile);
    savedProfile = null;
    scene.initializeUrlDebug(`?level=${levelId.slice(-1)}&sector=${sectorNumber}`);
    assert.equal(scene.phase, 'running');
    assert.equal(scene.levelId, levelId);
    assert.equal(scene.distance, IMPLEMENTED_LEVELS[levelId][sectorNumber - 1].startsAt);
    assert.equal(scene.startDistance, scene.distance);
    assert.equal(scene.currentSector.number, sectorNumber);
    assert.equal(scene.runEconomy.developerRun, true);
    assert.equal(scene.debugManager.timeScale, 1);
    assert.equal(savedProfile, null);
    assert.equal(JSON.stringify(profile), before);
    assert.notEqual(scene.profile, profile);
    assert.equal(routeSpeedAtDistance(scene.distance, levelId),
      routeSpeedAtDistance(scene.startDistance, scene.runEconomy.levelId));
  }
});

test('URL debug temporary Garage purchases and hints cannot save to the real profile', () => {
  const scene = depotScene();
  const realProfile = scene.profile;
  const before = JSON.stringify(realProfile);
  scene.showGarage = () => {};
  scene.showModuleDetail = () => {};
  savedProfile = null;
  scene.initializeUrlDebug('?unlockAll=true');
  assert.equal(scene.profile.coins, 99999);
  assert.equal(scene.profile.shipStates.swift.unlockedSlotCount, SLOT_MAX);
  const result = upgradeModule(scene.profile, 'hand_precision');
  assert.equal(result.ok, true);
  scene.applyShop(result, 'hand_precision', 'Upgraded');
  assert.ok(scene.profile.coins < 99999);
  assert.equal(savedProfile, null);
  assert.equal(JSON.stringify(realProfile), before);
  assert.equal(scene.persistProfile(scene.profile), true);
  assert.equal(savedProfile, null);
  const normal = depotScene();
  normal.debugManager = new DebugManager('');
  storageAvailable = false;
  try {
    assert.equal(normal.persistProfile(normal.profile), false, 'normal save errors remain visible');
    assert.equal(scene.persistProfile(scene.profile), true, 'explicit ephemeral mode does not require storage');
  } finally { storageAvailable = true; }
  normal.persistProfile(realProfile);
  assert.equal(savedProfile, realProfile);
});

test('URL and menu God Mode contacts preserve Hull, shields and cargo while firing real impact feedback', () => {
  for (const source of ['url', 'menu']) for (const hull of [1, 3]) for (const shieldCharges of [0, 3]) {
    const scene = depotScene();
    scene.debugManager = new DebugManager(source === 'url' ? '?god=true' : '');
    if (source === 'menu') scene.developerGodMode = true;
    scene.ship.setAlpha = () => {};
    scene.lines = [];
    scene.spawnTimer = 10;
    scene.holdFullCooldown = 0;
    scene.hull = hull;
    scene.shieldCharges = shieldCharges;
    loadCargo(scene, 100);
    const cargo = scene.cargoItems;
    const feedback = [];
    scene.debris = {explode: (...args) => feedback.push(['particles', ...args])};
    scene.cameras = {main: {shake: () => feedback.push(['shake']), flash: () => feedback.push(['flash'])}};
    scene.hud = {hull: {}};
    scene.pulse = () => {};
    scene.floatText = (_x, _y, message) => feedback.push(['text', message]);
    for (const method of ['updateRadar', 'updateDepot', 'updateDepotFacilities', 'recordMilestones']) {
      scene[method] = () => {};
    }
    const sprite = {x: scene.ship.x, y: scene.ship.y,
      destroy() { this.destroyed = true; }};
    scene.objects = [{type: 'hazard', kind: 'divider', sprite}];
    scene.update(0, 0);
    assert.equal(scene.hull, hull);
    assert.equal(scene.shieldCharges, shieldCharges);
    assert.equal(scene.cargoItems, cargo);
    assert.equal(scene.runEconomy.damagingHits, 0);
    assert.equal(scene.phase, 'running');
    assert.equal(scene.objects.length, 0);
    assert.equal(sprite.destroyed, true);
    assert.equal(feedback.filter(entry => entry[0] === 'particles').length, 1);
    assert.ok(feedback.some(entry => entry[1] === 'GOD • HIT BLOCKED'));
    assert.ok(!feedback.some(entry => entry[1] === '-1 HULL' || entry[1] === 'HULL DESTROYED'));
    scene.beginCrash();
    assert.equal(scene.phase, 'running');
  }
});

test('URL debug bot owns only flagged steering and bypasses Depot activation hands-free', () => {
  const scene = depotScene();
  const original = scene.ship.x;
  scene.debugManager = new DebugManager('?bot=true');
  scene.steeringKeys = {A: {isDown: true}};
  scene.objects = [{type: 'hazard', kind: 'divider',
    sprite: {x: original, y: scene.ship.y - 200}}];
  assert.equal(scene.updateSteeringInput(), false);
  assert.notEqual(scene.shipTargetX, original);
  assert.equal(scene.ship.x, original, 'the bot sets a target and never teleports');
  scene.ship.x = scene.nextDepot.side === 'left' ? LANE_CENTERS[0] : LANE_CENTERS[3];
  scene.distance = scene.nextDepotDistance;
  scene.updateDepot();
  assert.equal(scene.phase, 'running');
  scene.distance += DEPOT_RULES.triggerHalfMeters + 0.1;
  scene.updateDepot();
  assert.equal(scene.runEconomy.depotsSkipped, 1);
  scene.debugManager = new DebugManager('');
  scene.updateSteeringInput();
  assert.equal(scene.shipTargetX, ROAD_LEFT + 30, 'unflagged keyboard behavior is untouched');
});

test('URL debug fast scales the existing simulation in bounded steps and leaves menus/normal updates unchanged', () => {
  const scene = depotScene();
  scene.debugManager = new DebugManager('?fast=true');
  const updates = [];
  scene.updateStep = (_time, delta) => updates.push(delta);
  scene.update(0, 1000 / 60);
  assert.ok(updates.every(delta => delta <= 50));
  assert.ok(Math.abs(updates.reduce((sum, delta) => sum + delta, 0) -
    DEBUG_FAST_MULTIPLIER * 1000 / 60) < 1e-9);
  updates.length = 0;
  scene.phase = 'garage';
  scene.update(0, 16);
  assert.deepEqual(updates, [16]);
  updates.length = 0;
  scene.phase = 'running';
  scene.debugManager = new DebugManager('');
  scene.update(0, 16);
  assert.deepEqual(updates, [16]);
});

test('URL debug fast advances road, distance and canonical moving hazards by the same simulation clock', () => {
  const prepare = search => {
    const scene = depotScene();
    scene.debugManager = new DebugManager(search);
    scene.startRun('developer', 'level2', 'normal', {sectorNumber: 3, vehicleId: 'standard'});
    scene.ship.setAlpha = () => {};
    scene.lines = [];
    scene.spawnTimer = 10;
    scene.roadSurface.tilePositionY = 0;
    for (const method of ['updateRadar', 'updateDepot', 'updateDepotFacilities']) scene[method] = () => {};
    scene.objects = [{type: 'hazard', kind: 'sweeper', lane: 1, plannedDistance: scene.distance,
      movement: {minOffsetPx: 0, maxOffsetPx: 150, speedPxPerSecond: 76, direction: 1, phase: 0},
      sprite: {x: LANE_CENTERS[1], y: 200, setX(x) { this.x = x; return this; }}}];
    return scene;
  };
  const normal = prepare('');
  const fast = prepare('?fast=true');
  const before = fast.distance;
  const speed = routeSpeedAtDistance(before, 'level2');
  normal.update(0, 35);
  fast.update(0, 10);
  assert.equal(fast.distance, normal.distance);
  assert.ok(Math.abs(fast.distance - before - speed * METERS_PER_PIXEL * 0.035) < 1e-9);
  assert.equal(fast.roadSurface.tilePositionY, normal.roadSurface.tilePositionY);
  assert.equal(fast.objects[0].sprite.y, normal.objects[0].sprite.y);
  assert.equal(fast.objects[0].sprite.x, normal.objects[0].sprite.x);
  assert.equal(fast.objects[0].motionAge, normal.objects[0].motionAge);
});

test('URL debug actual frame loop reaches both exact finish distances within 60 seconds at approved fast speed', () => {
  for (const levelId of ['level1', 'level2']) {
    const scene = depotScene();
    scene.debugManager = new DebugManager('?god=true&bot=true&fast=true');
    scene.startRun('developer', levelId, 'normal', {sectorNumber: 1, vehicleId: 'standard'});
    scene.ship.setAlpha = () => {};
    scene.lines = [];
    scene.spawnTimer = Infinity;
    scene.roadSurface.tilePositionY = 0;
    scene.renderRunResult = () => {};
    let frames = 0;
    const sectors = new Set([scene.currentSector.number]);
    savedProfile = null;
    while (scene.phase === 'running' && frames < 3600) {
      scene.update(frames * 1000 / 60, 1000 / 60);
      sectors.add(scene.currentSector.number);
      frames++;
    }
    assert.equal(scene.phase, 'result');
    assert.equal(scene.distance, routeFinishDistance(levelId));
    assert.deepEqual([...sectors], [1, 2, 3, 4]);
    assert.ok(frames / 60 < 60, `${levelId} finish took ${frames / 60} seconds`);
    assert.equal(savedProfile, null);
    assert.equal(scene.runResult.net, 0);
  }
});

test('Neon shoulder signs are pooled, collision-free, deterministic and pulse without per-sign tweens', () => {
  const run = levelId => {
    const scene = depotScene();
    const created = [];
    const image = scene.add.image;
    scene.add.image = (...args) => {
      const node = Object.assign(image(...args), {
        setAlpha(alpha) { this.alpha = alpha; return this; },
        destroy() { this.destroyed = true; },
      });
      created.push(node);
      return node;
    };
    scene.tweens = {add: () => assert.fail('signs must not allocate tweens'), killTweensOf() {}};
    scene.shoulderSigns = [];
    scene.startRun('developer', levelId, 'normal', {sectorNumber: 1, vehicleId: 'standard'});
    const start = scene.distance;
    const log = [];
    for (let frame = 0; frame < 1200; frame++) {
      scene.time.now = frame * 1000 / 60;
      scene.distance = start + frame * 0.6;
      scene.updateShoulderSigns(10);
      for (const sign of scene.shoulderSigns) {
        assert.ok(sign.alpha >= NEON_SHOULDER_SIGNS.alphaMin - 1e-9 && sign.alpha <= NEON_SHOULDER_SIGNS.alphaMax + 1e-9);
      }
      assert.ok(scene.shoulderSigns.length <= 4, 'sign pool budget');
    }
    for (const node of created) log.push(`${node.key}@${node.x}`);
    assert.ok(!scene.objects.length, 'signs never enter the collision object list');
    const live = [...scene.shoulderSigns];
    scene.removeObjects();
    assert.equal(scene.shoulderSigns.length, 0);
    assert.ok(live.every(node => node.destroyed), 'signs are released back to the pool on reset');
    return log;
  };
  const neon = run('level4');
  assert.ok(neon.length >= 4, `${neon.length} signs over 720 m`);
  assert.ok(neon.some(entry => entry === `neon_sign_kanji@${NEON_SHOULDER_SIGNS.left.x}`));
  assert.ok(neon.some(entry => entry === `neon_sign_apex@${NEON_SHOULDER_SIGNS.right.x}`));
  assert.deepEqual(run('level1'), [], 'signs are Neon-only');
});

test('URL debug bot traverses all four Level 2 sectors on the returning-mover regression seed without God Mode', () => {
  const scene = depotScene();
  scene.debugManager = new DebugManager('?bot=true&fast=true');
  scene.startRun('developer', 'level2', 'normal', {sectorNumber: 1, vehicleId: 'standard'});
  // Owner rule: routes are only certified geometrically open, so even a fully upgraded bot may take hits.
  // Collisions stay live (no God Mode); a deep hull pool lets the frame loop prove full traversal.
  scene.stats = loadoutStats({cargoCapacityRank: 0, ownedModules: {hand_precision: MAX_MODULE_LEVEL},
    shipStates: {standard: {equippedModuleIds: ['hand_precision']}}}, 'standard');
  scene.maxHull = scene.hull = 1000;
  scene.trackStream = createTrackStream(3118819693, 'level2', 'normal');
  scene.ship.setAlpha = () => {};
  scene.lines = [];
  scene.roadSurface.tilePositionY = 0;
  scene.renderRunResult = () => {};
  scene.playPickupFeedback = () => {};
  scene.playHitFeedback = () => {};
  scene.floatText = () => {};
  scene.beginCrash = () => { scene.phase = 'crashing'; };
  const image = (x, y) => ({x, y,
    setDepth() { return this; }, setFlipX() { return this; }, setOrigin() { return this; },
    setTint() { return this; },
    setDisplaySize() { return this; }, setAlpha() { return this; }, setScale() { return this; },
    setBlendMode() { return this; }, setRotation() { return this; }, destroy() {},
    setX(x) { this.x = x; return this; }, setY(y) { this.y = y; return this; },
    setPosition(x, y) { Object.assign(this, {x, y}); return this; },
  });
  scene.add = {image};
  scene.addCurrency = (_value, x, y) => image(x, y);
  const sectors = new Set([1]);
  for (let frame = 0; frame < 3600 && scene.phase === 'running'; frame++) {
    scene.update(frame * 1000 / 60, 1000 / 60);
    sectors.add(scene.currentSector.number);
  }
  assert.equal(scene.phase, 'result', `bot stopped at ${scene.distance} m with Hull ${scene.hull}`);
  assert.equal(scene.distance, routeFinishDistance('level2'));
  assert.ok(scene.hull > 0);
  assert.deepEqual([...sectors], [1, 2, 3, 4]);
});

test('depot shield starts full, never regenerates on-road, refills at Normal arrival or Endless stopped Skip', () => {
  for (const mode of ['normal', 'continuous']) for (const rank of [0, 1, 2, 3]) {
    const scene = depotScene();
    scene.profile.ownedModules.def_shield = rank;
    scene.profile.shipStates.standard.equippedModuleIds = rank ? ['def_shield'] : [];
    scene.profile.levelProgress.level1.completed = true;
    scene.startRun('beginning', 'level1', mode);
    assert.equal(scene.stats.shieldCapacity, rank);
    assert.equal(scene.shieldCharges, rank);
    loadCargo(scene, 55);
    scene.shieldCharges = 0;
    for (let i = 0; i < 120; i++) scene.updateShield(60);
    assert.equal(scene.shieldCharges, 0, 'elapsed time never regenerates charges');
    assert.equal(scene.shieldRing.visible, false);
    const before = JSON.stringify(scene.profile);
    const cargo = scene.cargoItems;
    const hull = scene.hull;
    scene.ship.x = scene.shipTargetX = 195;
    scene.distance = scene.nextDepotDistance + DEPOT_RULES.triggerHalfMeters + 0.1;
    scene.updateDepot();
    assert.equal(scene.phase, 'running');
    assert.equal(scene.shieldCharges, 0, 'physical bypass does not recharge');
    scene.shieldCharges = rank > 0 ? rank - 1 : 0;
    scene.distance = scene.nextDepotDistance;
    scene.ship.x = scene.shipTargetX = scene.nextDepot.side === 'left' ? LANE_CENTERS[0] : LANE_CENTERS[3];
    scene.updateDepot();
    assert.equal(scene.phase, 'docking');
    finishDocking(scene);
    const arrivalCharges = mode === 'normal' ? rank : rank > 0 ? rank - 1 : 0;
    assert.equal(scene.shieldCharges, arrivalCharges);
    assert.equal(scene.shieldRing.visible, arrivalCharges > 0);
    assert.equal(scene.depotVisit.banked, false);
    assert.equal(scene.cargoItems, cargo);
    assert.equal(scene.hull, hull);
    assert.equal(scene.profile.coins, JSON.parse(before).coins, 'stopping alone never banks');
    assert.equal(scene.runEconomy.bankingEvents, 0);
    if (mode === 'continuous') assert.equal(JSON.stringify(scene.profile), before);
    else assert.equal(scene.profile.levelProgress.level1.sector3CheckpointUnlocked, true,
      'Normal arrival still persists checkpoint progress independently of banking');
    scene.shieldCharges = 0;
    scene.showDepot();
    assert.equal(scene.shieldCharges, 0, 're-render/repeated activation within one visit cannot recharge again');
    scene.resumeAfterDepot();
    assert.equal(scene.phase, 'running');
    assert.equal(scene.shieldCharges, mode === 'continuous' ? rank : 0,
      'only Endless Skip restores charges on resume; Normal does not repeatedly recharge');
    if (mode === 'continuous') assert.equal(scene.cargoItems, cargo);
    scene.shieldCharges = 0;
    scene.renderDepot();
    assert.equal(scene.shieldCharges, 0, 'rendering an inactive Depot is not a recharge trigger');
  }
});

test('shield absorption feedback preserves the remaining charges and refreshes HUD/ring immediately', () => {
  const scene = depotScene();
  scene.stats.shieldCapacity = 3;
  scene.shieldCharges = 2;
  scene.debris = {explode() {}};
  scene.cameras = {main: {shake() {}}};
  scene.haulerEffects = {grind: {anchor: {}, emitter: {
    explode(count) { scene.sparkCount = count; },
  }}};
  scene.floatText = () => {};
  scene.refreshHud = () => { scene.hudCharges = scene.shieldCharges; };
  scene.absorbWithShield(100, 200, 0.6);
  assert.equal(scene.sparkCount, 18);
  assert.equal(scene.shieldCharges, 2, 'only the shared collision owner consumes the charge');
  assert.equal(scene.hudCharges, 2);
  assert.equal(scene.shieldRing.visible, true);
  assert.equal(scene.invulnerable, 0.6);
  scene.shieldCharges = 0;
  scene.absorbWithShield(100, 200, 0.6);
  assert.equal(scene.hudCharges, 0);
  assert.equal(scene.shieldRing.visible, false);
});

test('scene preloads the approved Standard, Swift, Armoured and object sprites before creating the existing world', () => {
  const scene = new Scene();
  const loads = [], audio = [];
  scene.textures = {exists: () => false};
  scene.load = {image: (...args) => loads.push(args), audio: (...args) => audio.push(args)};
  scene.preload();
  assert.deepEqual(audio, [['cargo_run_music', 'BG_Music.mp3'],
    ['cargo_endless_music', 'Sunny_Coastal_Run.mp3']]);
  assert.deepEqual(loads, [['hazardous_haul_logo', 'GameLogo.svg'],
    [STANDARD_HAULER_ART.sourceKey, STANDARD_HAULER_ART.url],
    [SWIFT_RUNNER_ART.sourceKey, SWIFT_RUNNER_ART.url],
    [ARMOURED_TRANSPORT_ART.sourceKey, ARMOURED_TRANSPORT_ART.url],
    ...GARAGE_DISPLAY_ART.map(art => [art.key, art.url]),
    ...GARAGE_UPGRADE_ART.map(art => [art.key, art.url]),
    ...OBSTACLE_ART.map(art => [art.sourceKey, art.url]),
    ...GUARDRAIL_ART.map(art => [art.key, art.url]),
    ...COLLECTIBLE_ART.map(art => [art.sourceKey, art.url]),
    [DEPOT_ART.sourceKey, DEPOT_ART.url]]);
});

test('Standard finish selection uses saved trim IDs without whole-ship tint or profile changes', () => {
  const scene = new Scene();
  scene.profile = defaultProfile();
  scene.profile.shipStates.standard.ownedColorIds = ['default', 'white-blue', 'black-red', 'yellow-blue', 'gold'];
  scene.ship = {
    setTexture(key) { this.key = key; return this; },
    setTint(tint) { this.tint = tint; return this; },
    clearTint() { this.tint = null; return this; },
    setScale(scale) { this.scale = scale; return this; },
  };
  for (const id of ['default', 'white-blue', 'black-red', 'yellow-blue', 'gold']) {
    scene.profile.shipStates.standard.equippedColorId = id;
    const before = JSON.stringify(scene.profile);
    scene.syncShipAppearance('standard');
    assert.equal(scene.ship.key, id === 'default' ? 'cargo_ship' : `cargo_ship_${id}`);
    assert.equal(scene.ship.tint, null);
    assert.equal(scene.ship.scale, 1 * SPRITE_ART_SCALE * 1.05);
    assert.equal(JSON.stringify(scene.profile), before);
    assert.equal(normalizeProfile(scene.profile).shipStates.standard.equippedColorId, id);
  }
  scene.profile.shipStates.swift = {...scene.profile.shipStates.standard, equippedColorId: 'default'};
  scene.syncShipAppearance('swift');
  assert.equal(scene.ship.key, 'cargo_ship_swift');
  assert.equal(scene.ship.tint, null);
  assert.equal(scene.ship.scale, 0.92 * SPRITE_ART_SCALE * 1.05);
});

test('Swift sprite selection keeps saved trim ownership, scale and loadouts across every finish', () => {
  const scene = new Scene();
  scene.profile = defaultProfile();
  scene.profile.ownedVehicleIds.push('swift');
  scene.profile.shipStates.swift = {...scene.profile.shipStates.standard,
    unlockedSlotCount: 3, equippedModuleIds: ['hand_precision'],
    ownedColorIds: ['default', 'white-blue', 'black-red', 'yellow-blue']};
  scene.ship = {
    setTexture(key) { this.key = key; return this; },
    setTint(tint) { this.tint = tint; return this; },
    clearTint() { this.tint = null; return this; },
    setScale(scale) { this.scale = scale; return this; },
  };
  for (const id of scene.profile.shipStates.swift.ownedColorIds) {
    scene.profile.shipStates.swift.equippedColorId = id;
    const before = JSON.stringify(scene.profile);
    scene.syncShipAppearance('swift');
    assert.equal(scene.ship.key, 'cargo_ship_swift');
    assert.equal(scene.ship.scale, 0.92 * SPRITE_ART_SCALE * 1.05);
    assert.equal(scene.ship.tint, vehicleTint('swift', id));
    assert.equal(normalizeProfile(scene.profile).shipStates.swift.equippedColorId, id);
    assert.equal(JSON.stringify(scene.profile), before);
    assert.deepEqual(scene.profile.shipStates.swift.equippedModuleIds, ['hand_precision']);
  }
  scene.syncShipAppearance('standard');
  assert.equal(scene.ship.key, 'cargo_ship');
  assert.equal(scene.ship.scale, 1 * SPRITE_ART_SCALE * 1.05);
  assert.equal(scene.ship.tint, null, 'switching chassis clears the paid Swift tint');
});

test('run seed is inspectable and reproduces the active gameplay stream', () => {
  const scene = depotScene();
  assert.ok(Number.isInteger(scene.runSeed) && scene.runSeed >= 0);
  const replay = createTrackStream(scene.runSeed, scene.levelId, scene.runMode);
  assert.deepEqual(scene.trackStream.nextRow(scene.distance), replay.nextRow(scene.distance));
});

test('prepared checkpoint route streams are handed to the run and stale ones are released', () => {
  const scene = depotScene();
  scene.distance = GAME_BALANCE.routes.level1.sectorStartsMeters[2];
  scene.recordMilestones();
  const start = checkpointDistance('level1');
  scene.prepareRunStream('level1', 'normal', start);
  scene.prepareRunStream('level1', 'normal', start);
  scene.prepareRunStream('level2', 'normal', checkpointDistance('level2'));
  assert.equal(scene.preparedRunStreams.size, 2);
  const prepared = scene.preparedRunStreams.get(`level1:normal:${start}`);
  let released = 0;
  scene.preparedRunStreams.get(`level2:normal:${checkpointDistance('level2')}`).stream.destroy = () => { released += 1; };
  scene.startRun('checkpoint', 'level1');
  assert.equal(scene.trackStream, prepared.stream);
  assert.equal(scene.runSeed, prepared.seed);
  assert.equal(released, 1);
  assert.equal(scene.preparedRunStreams.size, 0);
  const replay = createTrackStream(prepared.seed, 'level1', 'normal');
  assert.deepEqual(scene.trackStream.nextRow(scene.distance), replay.nextRow(scene.distance));
});

test('route distance prediction follows run motion including the Depot launch ramp', () => {
  const scene = depotScene();
  const seconds = GAME_BALANCE.routes.spawning.initialRowDelaySeconds;
  const cruise = scene.predictRouteDistance(200, seconds, {levelId: 'level1', mode: 'normal'});
  const speed = Math.min(routeSpeedAtDistance(200, 'level1', 'normal'), MAX_TRACK_SPEED);
  const endSpeed = Math.min(routeSpeedAtDistance(cruise, 'level1', 'normal'), MAX_TRACK_SPEED);
  assert.ok(cruise >= 200 + seconds * speed * METERS_PER_PIXEL - 1e-9);
  assert.ok(cruise <= 200 + seconds * endSpeed * METERS_PER_PIXEL + 1e-9);
  const launch = scene.predictRouteDistance(200, seconds,
    {launchSeconds: DEPOT_RULES.launchSeconds, levelId: 'level1', mode: 'normal'});
  assert.ok(launch > 200 && launch < cruise, 'the launch ramp starts below cruising speed');
});

test('long continuous spawning releases actual scene objects and keeps the active set bounded', t => {
  const scene = depotScene();
  scene.profile.levelProgress.level1.completed = true;
  scene.startRun('beginning', 'level1', 'continuous');
  scene.ship.y = 10000;
  scene.ship.setAlpha = () => scene.ship;
  scene.lines = [];
  scene.roadSurface.tilePositionY = 0;
  scene.shieldRing = {setPosition() { return this; }, setVisible() { return this; }};
  scene.syncFinishLine = () => {};
  scene.refreshDeveloperReadout = () => {};
  let created = 0, destroyed = 0, peak = 0;
  const object = (x, y) => {
    created++;
    return {x, y,
      setDepth() { return this; }, setFlipX() { return this; }, setOrigin() { return this; },
      setTint() { return this; }, setScale() { return this; },
      setDisplaySize() { return this; }, setAlpha() { return this; },
      setBlendMode() { return this; }, setRotation() { return this; },
      setX(x) { this.x = x; return this; }, setY(y) { this.y = y; return this; },
      setPosition(x, y) { this.x = x; this.y = y; return this; },
      destroy() { destroyed++; },
    };
  };
  scene.add = {image: object};
  scene.addCurrency = (value, x, y) => object(x, y);
  const started = performance.now();
  for (let frame = 0; frame < 18000; frame++) {
    scene.update(frame * 1000 / 30, 1000 / 30);
    peak = Math.max(peak, scene.objects.length);
  }
  const elapsed = performance.now() - started;
  const maximumRows = Math.ceil((GAME_BALANCE.routes.geometry.logicalHeightPx + 60 - SPAWN_Y) /
    GAME_BALANCE.routes.track.minRowSpacingPx) + 1;
  assert.ok(scene.distance > 20000, 'exercise sustained final-stage Overdrive, not only startup');
  assert.ok(peak <= maximumRows * 5, `${peak} objects exceeds the visible row/instance bound`);
  assert.ok(created > 100 && destroyed > 100);
  scene.removeObjects();
  assert.equal(scene.objects.length, 0);
  assert.equal(created, destroyed, 'sprites and attached value text are released exactly once');
  t.diagnostic(`Desktop model smoke: 18000 scene updates, peak ${peak} active objects, ${elapsed.toFixed(1)} ms; not mobile performance.`);
});

test('frame-quantized spawning preserves source and continuation world positions', () => {
  visualHooks.createGuardrailStructure = createGuardrailStructure;
  try {
  for (const [levelId, mode] of [['level1', 'normal'], ['level2', 'normal'], ['level1', 'continuous']]) {
    const scene = depotScene();
    scene.profile.levelProgress[levelId].unlocked = true;
    scene.profile.levelProgress[levelId].completed = true;
    scene.startRun('beginning', levelId, mode);
    scene.trackStream = createTrackStream(153, levelId, mode);
    scene.ship.y = 10000;
    scene.ship.setAlpha = () => scene.ship;
    scene.lines = [];
    scene.roadSurface.tilePositionY = 0;
    scene.shieldRing = {setPosition() { return this; }, setVisible() { return this; }};
    scene.syncFinishLine = () => {};
    scene.refreshDeveloperReadout = () => {};
    const object = (x, y) => ({
      x, y,
      setDepth() { return this; }, setFlipX() { return this; }, setOrigin() { return this; },
      setDisplaySize(width, height) { this.displayWidth = width; this.displayHeight = height; return this; },
      setSize(width, height) { this.width = width; this.height = height; return this; },
      setAlpha() { return this; }, setX(x) { this.x = x; return this; },
      setBlendMode() { return this; }, setRotation() { return this; }, setTint() { return this; },
      setY(y) { this.y = y; return this; },
      setPosition(x, y) { this.x = x; this.y = y; return this; },
      destroy() {},
    });
    scene.add = {image: object, text: object,
      container: (x, y, children) => ({...object(x, y), children})};
    scene.addCurrency = (value, x, y) => object(x, y);
    const sources = new Map();
    const stream = scene.trackStream;
    let references = 0, rendered = 0;
    scene.trackStream = {...stream, nextRow(distance, context) {
      const row = stream.nextRow(distance, context);
      assert.ok(Number.isFinite(row.plannedDistance), 'publish the certified row coordinate');
      for (const hazard of row.hazards.filter(hazard => hazard.sideObstacle)) {
        const center = row.plannedDistance - hazard.offsetY * METERS_PER_PIXEL;
        if (!hazard.continuation) sources.set(hazard.sideObstacleId, center);
        else {
          references++;
          assert.ok(sources.has(hazard.sideObstacleId));
          assert.ok(Math.abs(center - sources.get(hazard.sideObstacleId)) < 1e-8,
            `${levelId}/${mode}: canonical continuation changed world position`);
        }
      }
      return row;
    }};
    const end = scene.distance + (mode === 'continuous' ? 2400 : 2000);
    const frameMilliseconds = [1000 / 30, 1000 / 60, 1000 / 120];
    let time = 0;
    for (let frame = 0; scene.distance < end && frame < 15000; frame++) {
      const delta = frameMilliseconds[frame % frameMilliseconds.length];
      time += delta;
      scene.update(time, delta);
      for (const item of scene.objects.filter(item => item.lengthPx)) {
        rendered++;
        assert.ok(sources.has(item.sideObstacleId), 'render the existing source identity, not a new body');
        const actualCenter = scene.distance - (item.sprite.y - SPAWN_Y) * METERS_PER_PIXEL;
        assert.ok(Math.abs(actualCenter - sources.get(item.sideObstacleId)) < 1e-8,
          `${levelId}/${mode}: frame timing displaced the physical collider from its certified reference`);
        assert.ok(Math.abs(item.sprite.guardrailParts.reduce((sum, part) => sum + part.displayHeight, 0) -
          hazardGeometry(item).height) < 1e-8, 'the drawn guardrail spans exactly its collider');
      }
    }
    assert.ok(scene.distance >= end && (levelId === 'level2' || references > 0) && rendered > 0,
      'exercise real continuing bodies across complete intervals and the Overdrive stage boundary');
    scene.removeObjects();
  }
  } finally {
    visualHooks.createGuardrailStructure = lightweightGuardrail;
  }
});

test('main menu exposes the mobile release build ID without changing saved progress', () => {
  const scene = depotScene();
  const before = JSON.stringify(scene.profile);
  const labels = [];
  scene.addLabel = (text, x, y, size) => { labels.push({text, x, y, size}); };
  scene.showMenu();
  const label = labels.find(item => item.text === `Build ${BUILD_ID}`);
  assert.ok(label);
  assert.equal(label.x, 195);
  assert.equal(label.y, (scene.menuHeight ?? 844) - 40,
    'build label stays below the four actions and above the bottom border');
  assert.equal(JSON.stringify(scene.profile), before, 'build presentation never touches progression');
});

test('main menu uses a blue Blueprint sprite tally below Coins and shows only the Endless record', () => {
  const scene = depotScene();
  scene.profile.coins = 1234;
  scene.profile.blueprints = 12;
  scene.profile.endlessBestDistance = 4321;
  scene.profile.levelProgress.level1.bestDistance = 90000;
  const before = JSON.stringify(scene.profile);
  const labels = [];
  scene.addLabel = (text, x, y) => { labels.push({text, x, y}); };
  scene.showMenu();
  const coins = scene.uiCurrency.find(item => item.value === 1234);
  const blueprints = scene.uiCurrency.find(item => item.iconKey === 'cargo_blueprint');
  assert.equal(blueprints.value, 12);
  assert.equal(blueprints.x, coins.x);
  assert.equal(blueprints.align, 'left');
  assert.equal(coins.align, 'left');
  assert.ok(blueprints.y > coins.y);
  assert.equal(blueprints.color, '#74b9ff');
  assert.ok(labels.some(item => item.text === 'ENDLESS BEST\n4,321 m'));
  assert.ok(!labels.some(item => /BLUEPRINT|90,000|LEVEL 1 BEST/.test(item.text)));
  assert.equal(JSON.stringify(scene.profile), before);
});

test('Normal Run tiles name Industrial Zone and Dustlands', () => {
  const scene = depotScene();
  const labels = [];
  scene.addLabel = text => { labels.push(text); };
  scene.showLevelSelect();
  assert.ok(labels.includes('LEVEL 1: INDUSTRIAL ZONE'));
  assert.ok(labels.includes('LEVEL 2: DUSTLANDS'));
});

test('menu footer actions keep frame padding and separate touch targets at phone sizes', () => {
  for (const [width, height] of [[320, 568], [390, 844], [420, 844], [430, 932]]) {
    const scene = new Scene();
    scene.menuHeight = responsiveViewport(width, height, 390).worldHeight;
    const buttons = [];
    scene.addButton = (label, y, action, options) => buttons.push({label, y, action, ...options});
    for (const count of [2, 3]) {
      buttons.length = 0;
      const actions = Array.from({length: count}, (_, index) => ({label: `ACTION ${index}`, onClick() {}}));
      scene.addFooterActions(actions);
      for (const [index, button] of buttons.entries()) {
        assert.ok(button.x - button.width / 2 >= 32);
        assert.ok(button.x + button.width / 2 <= 358);
        assert.ok(button.y + button.height / 2 <= scene.menuHeight - 32);
        assert.ok(button.height * width / 390 >= 44);
        assert.equal(button.action, actions[index].onClick);
        if (index) {
          const previous = buttons[index - 1];
          assert.ok(button.x - button.width / 2 - (previous.x + previous.width / 2) >= 12 - 1e-9);
        }
      }
    }
  }
});

test('run menu level cards pad wrapped headings and paired start tabs independently of the fixed footer at viewport sizes', () => {
  for (const completed of [false, true]) for (const [width, height] of
    [[320, 568], [360, 800], [390, 844], [420, 844], [844, 390], [1920, 1080]]) {
    const scene = depotScene();
    for (const progress of Object.values(scene.profile.levelProgress)) {
      progress.completed = completed;
      progress.bestDistance = 999999999999999;
    }
    scene.menuHeight = responsiveViewport(width, height, 390).worldHeight;
    scene.setScreenRenderer = () => {};
    const before = JSON.stringify(scene.profile);
    const cards = [], rows = [];
    let viewport, scrolling = false, footer;
    scene.addCard = (top, height) => cards.push({top, bottom: top + height});
    scene.createMenuScroll = (_key, top, bottom) => { viewport = {top, bottom}; scrolling = true; };
    scene.finishMenuScroll = () => { scrolling = false; };
    scene.addButton = (text, y, action, options = {}) => {
      const height = options.height ?? 54;
      const row = {text, x: options.x ?? 195, top: y - height / 2,
        bottom: y + height / 2, width: options.width ?? 326, button: true};
      if (scrolling) rows.push(row);
      else footer = row;
    };
    scene.addLabel = (text, x, y, size, color, width) => {
      const lines = Math.ceil(text.length / Math.floor(width / (size * 0.6)));
      const row = {text, top: y, height: lines * size * 1.2, width,
        bottom: y + lines * size * 1.2,
        setLineSpacing(gap) {
          this.height += (lines - 1) * gap;
          this.bottom = this.top + this.height;
          return this;
        }};
      rows.push(row);
      return row;
    };
    scene.addCardText = (text, left, y, width, size, color, {maxHeight}) => {
      const row = scene.addLabel(text, left + width / 2, y, size, color, width);
      row.height = Math.min(row.height, maxHeight);
      row.top = y - row.height / 2;
      row.bottom = y + row.height / 2;
      return row;
    };
    scene.showLevelSelect();
    assert.equal(cards.length, 5);
    assert.equal(viewport.top, cards[0].top);
    assert.ok(footer.top - viewport.bottom >= 16);
    assert.ok(viewport.bottom > viewport.top);
    if (viewport.bottom - viewport.top >= cards[0].bottom - cards[0].top) {
      assert.ok(cards[0].bottom <= viewport.bottom);
    }
    assert.ok(cards.at(-1).bottom > viewport.bottom, 'future entries remain scrollable, not under the footer');
    const tabs = rows.filter(row => row.text === 'SECTOR 1' || row.text === 'CHECKPOINT\nSECTOR 3');
    assert.equal(tabs.length, IMPLEMENTED_LEVELS.level1.length * 2,
      'only implemented levels have start tabs');
    for (let index = 0; index < tabs.length; index += 2) {
      const left = tabs[index], right = tabs[index + 1], card = cards[index / 2];
      assert.equal(left.top, right.top);
      assert.ok(left.top >= card.top + 48);
      assert.ok(left.bottom <= card.bottom - 48);
      assert.ok(left.x - left.width / 2 >= 32 + 16);
      assert.ok(right.x + right.width / 2 <= 358 - 16);
      assert.equal(right.x - right.width / 2 - (left.x + left.width / 2), 12);
      assert.ok((left.bottom - left.top) * width / 390 >= 44);
      const labels = rows.filter(row => !row.button && row.top >= card.top && row.top < card.bottom);
      assert.equal(labels.length, 3);
      const [heading, record, checkpoint] = labels;
      assert.ok(heading.top >= card.top + MENU_SPACING.padding);
      assert.ok(left.top - heading.bottom >= MENU_SPACING.gap,
        `${width}x${height}: wrapped completion heading clears the buttons`);
      assert.ok(record.top - left.bottom >= MENU_SPACING.gap);
      assert.ok(checkpoint.top - record.bottom >= MENU_SPACING.gap);
      assert.ok(card.bottom - checkpoint.bottom >= MENU_SPACING.padding);
    }
    for (let index = 1; index < cards.length; index++) assert.equal(cards[index].top - cards[index - 1].bottom, 12);
    assert.equal(JSON.stringify(scene.profile), before);
  }
});

test('run menu home shows four actions without overlap at phone sizes and keeps Endless locked until Level 1 completion', () => {
  for (const [width, height] of [[320, 568], [360, 800], [390, 844], [420, 844]]) {
    const scene = depotScene();
    scene.menuHeight = responsiveViewport(width, height, 390).worldHeight;
    const buttons = [], labels = [];
    scene.addButton = (label, y, action, options = {}) => buttons.push({label, y, action, ...options});
    scene.addLabel = (text, x, y) => { labels.push({text, x, y}); };
    scene.add = {image(x, y, key) { return {x, y, key, width: 295, height: 172,
      setDepth() { return this; }, setScale(scale) { this.scale = scale; return this; }}; }};
    const before = JSON.stringify(scene.profile);
    scene.showMenu();
    const logo = scene.overlayObjects.find(object => object.key === 'hazardous_haul_logo');
    assert.ok(logo);
    const logoWidth = logo.width * logo.scale;
    const logoHeight = logo.height * logo.scale;
    assert.ok(logoWidth <= 326 && logoHeight <= 190,
      'the logo uses its own inset area without the truck-on-road preview');
    assert.ok(logo.x - logoWidth / 2 >= MENU_SPACING.edge &&
      logo.x + logoWidth / 2 <= 390 - MENU_SPACING.edge, 'the logo stays inside the panel gutters');
    assert.ok(Math.abs(logoWidth / logoHeight - 295.2749606054797 / 171.80280306739786) < 0.02,
      'the logo keeps its supplied aspect ratio');
    assert.deepEqual(buttons.map(button => button.label), ['NORMAL RUN', 'ENDLESS RUN', 'GARAGE & UPGRADES', 'HOW-TO']);
    assert.equal(buttons[1].disabled, true);
    assert.match(buttons[1].subtitle, /Complete Level 1/);
    for (let index = 1; index < buttons.length; index++) {
      assert.ok(buttons[index].y - buttons[index].height / 2 >=
        buttons[index - 1].y + buttons[index - 1].height / 2 + 8);
    }
    const instruction = labels.find(label => label.text.includes('steer'));
    assert.ok(instruction.y >= buttons.at(-1).y + buttons.at(-1).height / 2 + 12);
    assert.equal(JSON.stringify(scene.profile), before);
    let destination;
    scene.showLevelSelect = () => { destination = 'levels'; };
    buttons[0].action();
    assert.equal(destination, 'levels');
    scene.profile.levelProgress.level1.completed = true;
    buttons.length = 0;
    scene.showMenu();
    assert.equal(buttons[1].disabled, false);
    scene.showContinuousConfirm = () => { destination = 'endless-rules'; };
    buttons[1].action();
    assert.equal(destination, 'endless-rules');
  }
});

test('menu scrolling builds a separate touch scroller and preserves grouped tile visibility', () => {
  const scene = new Scene();
  const makeContainer = () => ({
    list: [], y: 0, depth: 32,
    setDepth(depth) { this.depth = depth; return this; },
    setY(y) { this.y = y; return this; },
    setVisible(visible) { this.visible = visible; return this; },
    add(object) { this.list.push(object); return this; },
  });
  scene.add = {
    container: makeContainer,
    zone: () => ({
      setDepth() { return this; },
      setInteractive() { return this; },
      on() { return this; },
    }),
  };
  scene.overlayObjects = [];
  scene.menuScrollPositions = {};
  const measuredContent = {menuScrollBounds: {top: 264, bottom: 1000}, setVisible() {}};
  let fixedButtons = 0;
  scene.addButton = () => { fixedButtons++; };

  scene.createMenuScroll('garage:upgrades', 264, 732);
  scene.menuScrollContainer.add(measuredContent);
  scene.finishMenuScroll();
  assert.equal(scene.menuScrollMax, 268);
  assert.equal(fixedButtons, 0, 'scrolling does not add dedicated controls or consume footer space');

  const tile = {setVisible() {}};
  scene.activeMenuContent = scene.menuScrollContainer;
  scene.withMenuScrollItem(850, 60, () => scene.trackOverlayObject(tile));
  scene.activeMenuContent = null;
  const group = scene.menuScrollContainer.list.find(child => child !== measuredContent);
  assert.equal(group.list[0], tile);
  scene.updateMenuScrollVisibility();
  assert.equal(group.visible, false, 'off-screen tile and its children are hidden as one item');

  scene.scrollMenuBy(150);
  assert.equal(scene.menuScrollOffset, -150);
  assert.equal(scene.menuScrollPositions['garage:upgrades'], -150);
  assert.equal(group.visible, true, 'scrolling reveals the complete tile group');

  const pointer = {id: 1, x: 195, y: 500, isDown: true};
  scene.beginMenuScroll(pointer);
  scene.moveMenuScroll({...pointer, y: 450});
  scene.endMenuScroll(pointer);
  assert.equal(scene.menuScrollOffset, -200);
  assert.equal(scene.menuScrollPositions['garage:upgrades'], -200);
});

test('dragging a garage tile scrolls content without activating the tile or fixed navigation', () => {
  const scene = new Scene();
  const makeContainer = () => ({
    list: [], y: 0, depth: 32,
    setDepth(depth) { this.depth = depth; return this; },
    setY(y) { this.y = y; return this; },
    setVisible(visible) { this.visible = visible; return this; },
    add(object) { this.list.push(object); return this; },
  });
  scene.add = {
    container: makeContainer,
    zone: () => ({setDepth() { return this; }, setInteractive() { return this; }, on() { return this; }}),
  };
  scene.overlayObjects = [];
  scene.menuScrollPositions = {};
  const measuredContent = {menuScrollBounds: {top: 360, bottom: 1000}, setVisible() {}};
  let fixedButtons = 0;
  scene.addButton = () => { fixedButtons++; };
  scene.createMenuScroll('garage:garage', 360, 770);
  scene.menuScrollContainer.add(measuredContent);
  scene.finishMenuScroll();

  const handlers = {};
  const tile = {
    on(event, handler) { (handlers[event] ??= []).push(handler); return this; },
    setInteractive() { return this; },
    setVisible() { return this; },
    setAlpha() { return this; },
  };
  scene.activeMenuContent = scene.menuScrollContainer;
  scene.trackOverlayObject(tile);
  scene.bindTilePress(tile, () => { throw new Error('scroll drag activated a tile'); });
  scene.activeMenuContent = null;

  const event = {stopPropagation() {}};
  const start = {id: 1, x: 195, y: 500, isDown: true, getDistance: () => 0};
  handlers.pointerdown.forEach(handler => handler(start, 0, 0, event));
  const moved = {...start, y: 430, getDistance: () => 70};
  scene.moveMenuScroll(moved);
  handlers.pointermove.forEach(handler => handler(moved));
  handlers.pointerup.forEach(handler => handler(moved, 0, 0, event));

  assert.equal(scene.menuScrollOffset, -70);
  assert.equal(scene.menuScrollPositions['garage:garage'], -70);
  assert.equal(fixedButtons, 0, 'natural drag uses no dedicated scroll controls');
});

test('menu momentum respects pointer ownership, stale releases, wheel input and the viewport edges', () => {
  const scene = new Scene();
  scene.phase = 'garage';
  scene.time = {now: 100};
  scene.menuScrollContainer = {setY(y) { this.y = y; }};
  scene.menuScrollTop = 238;
  scene.menuScrollBottom = 600;
  scene.menuScrollMax = 700;
  scene.menuScrollOffset = -100;
  scene.menuScrollKey = 'garage:upgrades';
  scene.menuScrollPositions = {};
  scene.updateMenuScrollVisibility = () => {};
  const start = {id: 1, x: 150, y: 450, isDown: true};
  scene.beginMenuScroll(start);
  scene.time.now = 150;
  scene.beginMenuScroll({...start, id: 2});
  assert.equal(scene.menuScrollGesture.id, 1, 'a second finger cannot replace a drag');
  scene.moveMenuScroll({...start, y: 380});
  assert.equal(scene.menuScrollOffset, -170);
  scene.endMenuScroll({...start, isDown: false});
  assert.equal(scene.menuScrollVelocity, -1400);
  scene.update(150, 16);
  assert.ok(scene.menuScrollOffset < -170);
  assert.equal(scene.menuScrollPositions[scene.menuScrollKey], scene.menuScrollOffset);

  scene.beginMenuScroll(start);
  assert.equal(scene.menuScrollVelocity, 0);
  assert.equal(scene.menuScrollDraggedPointerId, 1, 'touching to stop momentum must not open a tile');
  scene.endMenuScroll({...start, isDown: false});
  scene.beginMenuScroll(start);
  scene.time.now = 200;
  scene.moveMenuScroll({...start, y: 420});
  scene.time.now = 400;
  scene.endMenuScroll({...start, isDown: false});
  assert.equal(scene.menuScrollVelocity, 0, 'holding still before release must not fling');
  scene.menuScrollVelocity = 900;
  scene.scrollMenuBy(-10);
  assert.equal(scene.menuScrollVelocity, 0);
  scene.menuScrollOffset = -699;
  scene.menuScrollVelocity = -1200;
  scene.update(416, 16);
  assert.equal(scene.menuScrollOffset, -700);
  assert.equal(scene.menuScrollVelocity, 0);
});

test('partially clipped menu cards render smoothly but cannot intercept header or footer taps', () => {
  const scene = new Scene();
  scene.menuScrollTop = 238;
  scene.menuScrollBottom = 600;
  scene.menuScrollOffset = -100;
  scene.menuScrollMax = 700;
  scene.menuScrollMask = {};
  const card = {menuScrollBounds: {top: 300, bottom: 467}, setVisible(value) { this.visible = value; }};
  scene.menuScrollContainer = {list: [card], y: -100};
  scene.updateMenuScrollVisibility();
  assert.equal(card.visible, true, 'partially visible cards remain drawn through the mask');
  const control = {
    displayOriginX: 80, displayOriginY: 83.5,
    input: {hitAreaCallback: () => true},
    getWorldTransformMatrix: () => ({transformPoint: (x, y) => ({x: x + 110, y: y + 280})}),
  };
  scene.clipMenuControl(control, true);
  assert.equal(control.input.hitAreaCallback({}, 80, 10, control), false);
  assert.equal(control.input.hitAreaCallback({}, 80, 100, control), true);
  assert.equal(scene.menuControlContainsPointer({x: 100, y: 650}, true), false);
  assert.equal(scene.menuControlContainsPointer({x: 100, y: 650}, false), true);
});

test('tapping to stop a coasting upgrade list cannot activate its tile', () => {
  const scene = new Scene();
  scene.menuScrollTop = 238;
  scene.menuScrollBottom = 600;
  scene.menuScrollOffset = -200;
  scene.menuScrollVelocity = -900;
  scene.menuScrollContainer = {};
  scene.activeMenuContent = scene.menuScrollContainer;
  const handlers = {};
  let actions = 0;
  const tile = {
    setInteractive() { return this; }, setAlpha() { return this; },
    on(name, handler) { handlers[name] = handler; return this; },
  };
  scene.bindTilePress(tile, () => actions++);
  const pointer = {id: 1, x: 150, y: 400, getDistance: () => 0};
  const event = {stopPropagation() {}};
  handlers.pointerdown(pointer, 0, 0, event);
  scene.endMenuScroll({...pointer, isDown: false});
  handlers.pointerup(pointer, 0, 0, event);
  assert.equal(actions, 0);
  assert.equal(scene.menuScrollVelocity, 0);
  handlers.pointerdown(pointer, 0, 0, event);
  handlers.pointerup(pointer, 0, 0, event);
  assert.equal(actions, 1, 'a subsequent deliberate tap still opens the details');
});

test('Garage owns ship and cosmetic management and is the only home management entry', () => {
  const scene = depotScene();
  const buttons = [];
  scene.clearOverlay = () => {};
  scene.setWorldVisible = () => {};
  scene.removeObjects = () => {};
  scene.panel = () => {};
  scene.add = {image(x, y, key) { return {x, y, key, width: 295, height: 172,
    setDepth() { return this; }, setScale(scale) { this.scale = scale; return this; }}; }};
  scene.addCurrency = () => {};
  scene.addLabel = () => ({setInteractive() { return this; }, on() { return this; }});
  scene.addButton = (label, y, action, options = {}) => buttons.push({label, y, action, ...options});
  scene.showGarage = (...args) => { scene.openedGarage = args; };

  scene.showMenu();
  const managementEntries = buttons.filter(button =>
    button.label.includes('GARAGE') || button.label.includes('SHIPS'));
  assert.deepEqual(managementEntries.map(button => button.label), ['GARAGE & UPGRADES']);
  assert.ok(buttons.every(button => button.height * 320 / 390 >= 44),
    'home actions remain finger-sized on the short 320 px viewport');
  managementEntries[0].action();
  assert.deepEqual(scene.openedGarage, ['', false, 'upgrades']);

  scene.showShips();
  assert.deepEqual(scene.openedGarage, ['', false, 'garage']);
});

test('Garage upgrade summaries distinguish full prices from shortfalls and preserve real lock requirements', () => {
  const scene = new Scene();
  scene.profile = {...defaultProfile(), coins: 40};
  const before = JSON.stringify(scene.profile);
  const capacity = scene.upgradeTileModel({kind: 'capacity'}, 'standard');
  assert.equal(capacity.state, '150 COINS\nNEED 110 MORE');
  assert.equal(capacity.tier, 1);
  assert.equal(capacity.name, 'Cargo Capacity');
  const shield = scene.upgradeTileModel({kind: 'module', id: 'def_shield'}, 'standard');
  assert.equal(shield.requirement, 'Complete L2 · S3');
  const rack = scene.upgradeTileModel({kind: 'module', id: 'cargo_light'}, 'standard');
  assert.equal(rack.locked, true);
  assert.equal(rack.requirement, 'Complete L1 · S3');
  const future = scene.upgradeTileModel({kind: 'module', id: 'util_impact_pulse'}, 'standard');
  assert.equal(future.requirement, 'Reach L4 · S3');
  assert.equal(future.future, false, 'implemented Level 4 unlocks no longer use a future-level warning');
  const magnet = scene.upgradeTileModel({kind: 'module', id: 'coll_magnet'}, 'standard');
  assert.equal(magnet.locked, true);
  assert.equal(magnet.requirement, 'Reach L3 · S1');
  assert.equal(JSON.stringify(scene.profile), before);
});

test('Garage unlock tile labels and availability follow every live GameBalance module requirement', () => {
  const scene = new Scene();
  for (const [id, tuning] of Object.entries(GAME_BALANCE.upgrades.modules)) {
    if (!tuning.unlock) continue;
    const {levelId, sector, event} = tuning.unlock;
    scene.profile = defaultProfile();
    const locked = scene.upgradeTileModel({kind: 'module', id}, 'standard');
    assert.equal(locked.locked, true, id);
    assert.equal(locked.requirement,
      `${event === 'reach' ? 'Reach' : 'Complete'} L${levelId.slice(5)} · S${sector}`, id);
    const progress = scene.profile.levelProgress[levelId];
    progress[event === 'reach' ? 'reachedSectors' : 'completedSectors'] = [sector];
    const unlocked = scene.upgradeTileModel({kind: 'module', id}, 'standard');
    assert.equal(unlocked.locked, false, id);
    assert.equal(unlocked.requirement, null, id);
  }
});

test('Garage upgrade grid preserves unlock ordering, existing reinforcement and detail routes', () => {
  const expectedOrder = [
    'capacity', 'hand_precision', 'coll_magnet', 'cargo_light',
    'def_plating', 'util_insurance', 'def_shield', 'util_impact_pulse',
  ];
  for (const variant of ['new', 'slot-offer', 'swift', 'full', 'tier2']) {
    const scene = depotScene();
    scene.profile.coins = 2000;
    if (variant === 'slot-offer') scene.profile.milestones = ['level1,sector2'];
    if (variant === 'swift') {
      scene.profile.selectedVehicleId = 'swift';
      scene.profile.ownedVehicleIds.push('swift');
      scene.profile.shipStates.swift = {
        ...scene.profile.shipStates.standard, unlockedSlotCount: 3, equippedModuleIds: ['hand_precision'],
      };
    }
    if (['full', 'tier2'].includes(variant)) {
      scene.profile.cargoCapacityRank = variant === 'tier2' ? 8 : 2;
      scene.profile.reinforcedCargoRank = variant === 'tier2' ? 3 : 0;
      scene.profile.shipStates.standard.unlockedSlotCount = 6;
      scene.profile.shipStates.standard.equippedModuleIds = [
        CARGO_CAPACITY_ID, 'hand_precision', 'coll_magnet', 'cargo_light', 'def_shield', 'util_impact_pulse',
      ];
      for (const id of scene.profile.shipStates.standard.equippedModuleIds) {
        if (id !== CARGO_CAPACITY_ID) scene.profile.ownedModules[id] = 3;
      }
    }
    const before = JSON.stringify(scene.profile);
    const labels = [], buttons = [], tiles = [], images = [], presses = new Map();
    scene.withMenuScrollItem = (_y, _height, render) => render();
    scene.addGarageSocketBay = (_id, top) => top + 180;
    scene.bindTilePress = (tile, action) => presses.set(tile, action);
    scene.trackOverlayObject = object => {
      scene.overlayObjects.push(object);
      return object;
    };
    scene.addButton = (label, y, action, options) => buttons.push({label, y, action, ...options});
    const image = (x, y, texture) => {
      const object = {x, y, texture, width: 160, height: 200,
        setScale(scale) { this.displayWidth = this.width * scale; this.displayHeight = this.height * scale; return this; },
        setTint() { return this; },
        setDisplaySize(width, height) { this.width = width; this.height = height; return this; },
        setDepth() { return this; }, setAlpha() { return this; }};
      images.push(object);
      return object;
    };
    scene.add = {
      image, rectangle: image,
      text(x, y, text, style) {
        const label = {x, y, text, style, width: text.length * 6, height: 24,
          setScale() { return this; },
          setOrigin() { return this; }, setDepth() { return this; }};
        labels.push(label);
        return label;
      },
    };
    scene.addLabel = (text, x, y) => {
      const label = {text, x, y, height: 14, displayHeight: 14};
      labels.push(label);
      return label;
    };
    const addGridTile = scene.addUpgradeGridTile.bind(scene);
    scene.addUpgradeGridTile = (item, x, y, size, chassisId) => {
      tiles.push({item, x, y, size});
      return addGridTile(item, x, y, size, chassisId);
    };

    scene.showGarage('', false, 'upgrades');

    assert.deepEqual(tiles.map(tile => tile.item.id), expectedOrder, variant);
    assert.equal(images.filter(image => typeof image.texture === 'string' &&
      image.texture.startsWith('garage_upgrade_')).length, 8);
    assert.equal(new Set(tiles.map(tile => tile.x)).size, 2);
    let detail;
    scene.showUpgradeDetail = (...args) => { detail = args; };
    const firstGrid = scene.overlayObjects.find(object =>
      object.x === tiles[0].x && object.y === tiles[0].y && object.width === tiles[0].size);
    presses.get(firstGrid)();
    assert.deepEqual(detail, [variant === 'tier2' ? 'reinforcement' : 'capacity', 'capacity']);
    let returnedHome = false;
    scene.showMenu = () => { returnedHome = true; };
    buttons.find(button => button.label === 'BACK TO MENU').action();
    assert.ok(returnedHome);
    assert.equal(JSON.stringify(scene.profile), before);
  }
});

test('equipment progress saves exact sector boundaries and retries failed persistence without granting early unlocks', () => {
  const scene = depotScene();
  scene.distance = GAME_BALANCE.routes.level1.sectorEndsMeters[1];
  scene.recordMilestones();
  assert.deepEqual(Array.from(scene.profile.levelProgress.level1.completedSectors), [1, 2]);
  assert.equal(moduleStatus(scene.profile, 'cargo_light').unlocked, false);
  const before = scene.profile;
  try {
    storageAvailable = false;
    scene.distance = GAME_BALANCE.routes.level1.sectorEndsMeters[2];
    scene.recordMilestones();
    assert.equal(scene.profile, before);
    assert.equal(moduleStatus(scene.profile, 'cargo_light').unlocked, false);
  } finally { storageAvailable = true; }
  scene.recordMilestones();
  assert.equal(moduleStatus(scene.profile, 'cargo_light').unlocked, true);
  assert.equal(savedProfile, scene.profile);
  const saved = scene.profile;
  scene.recordMilestones();
  assert.equal(scene.profile, saved);
});

test('equipment Level 2 start records reach separately from access and Level 2 completion evidence', () => {
  const scene = depotScene();
  scene.profile = {...scene.profile, levelProgress: {
    ...scene.profile.levelProgress,
    level1: {...scene.profile.levelProgress.level1, completed: true},
    level2: {...scene.profile.levelProgress.level2, unlocked: true},
  }};
  assert.equal(moduleStatus(scene.profile, 'util_insurance').unlocked, false);
  scene.startRun('beginning', 'level2');
  assert.equal(scene.distance, 0);
  assert.equal(moduleStatus(scene.profile, 'util_insurance').unlocked, true);
  assert.equal(savedProfile, scene.profile);
  const shieldGate = GAME_BALANCE.routes.level2.sectorEndsMeters[2];
  scene.distance = shieldGate - 1;
  scene.recordMilestones();
  assert.equal(moduleStatus(scene.profile, 'def_shield').unlocked, false);
  scene.distance = shieldGate;
  scene.recordMilestones();
  assert.equal(moduleStatus(scene.profile, 'def_shield').unlocked, true);
  assert.equal(moduleStatus(scene.profile, 'cargo_light').unlocked, false,
    'Level 2 distance cannot complete a Level 1 equipment sector');
  const saved = scene.profile;
  scene.runMode = 'continuous';
  scene.distance = 8000;
  scene.recordMilestones();
  assert.equal(scene.profile, saved);
  scene.runMode = 'normal';
  scene.runEconomy = markDeveloperRun(scene.runEconomy);
  scene.recordMilestones();
  assert.equal(scene.profile, saved);
});

test('Garage equipment details explain complete gates, future gates and slot-based capacity without changing a profile', () => {
  const scene = new Scene();
  scene.profile = {...defaultProfile(), coins: 1000};
  scene.overlayObjects = [];
  scene.setWorldVisible = () => {};
  scene.panel = () => {};
  scene.addCurrency = () => {};
  scene.createMenuScroll = () => {};
  scene.finishMenuScroll = () => {};
  scene.trackOverlayObject = object => object;
  const labels = [];
  const buttons = [];
  scene.addLabel = text => {
    labels.push(text);
    return {height: 30, setOrigin() { return this; }, setAlign() { return this; }};
  };
  scene.addButton = (label, y, action, options = {}) => buttons.push({label, y, action, ...options});
  scene.add = {image: () => ({width: 162, height: 195, setScale() { return this; },
    setDisplaySize() { return this; }, setDepth() { return this; }})};
  const source = JSON.stringify(scene.profile);
  scene.showUpgradeDetail('module', 'cargo_light');
  assert.ok(labels.some(text => text.includes(`Complete Level 1, Sector 3 (${
    GAME_BALANCE.routes.level1.sectorEndsMeters[2].toLocaleString('en-US')} m)`)));
  assert.ok(!buttons.some(button => button.label === 'BUY UPGRADE'));
  labels.length = 0;
  scene.showUpgradeDetail('module', 'util_impact_pulse');
  assert.ok(labels.some(text => text.includes('Reach Level 4, Sector 3 (1,500 m).')));
  assert.equal(JSON.stringify(scene.profile), source);
  scene.profile = upgradeCargoCapacity(scene.profile).profile;
  labels.length = 0;
  buttons.length = 0;
  scene.showModuleDetail(CARGO_CAPACITY_ID);
  assert.ok(labels.includes('EQUIPMENT • USES ONE SLOT'));
  assert.ok(labels.includes('Unequipped: 11 cargo. Equipped: 13 cargo.'));
  assert.ok(!labels.some(text => text.includes('ALWAYS ACTIVE')));
  const unequip = buttons.find(button => button.label === 'UNEQUIP');
  assert.ok(unequip);
  assert.ok(unequip.height * 320 / 390 >= 44);
  scene.applyShop = (result, id) => {
    assert.equal(id, CARGO_CAPACITY_ID);
    assert.equal(result.ok, true);
    scene.profile = result.profile;
  };
  unequip.action();
  assert.equal(loadoutStats(scene.profile).capacity, 11);
  assert.equal(scene.profile.cargoCapacityRank, 1);
});

test('equipment shop save failures leave capacity ranks, slots and wallet unchanged', () => {
  const scene = new Scene();
  scene.profile = {...defaultProfile(), coins: 1000};
  const source = scene.profile;
  let detail;
  scene.showUpgradeDetail = (...args) => { detail = args; };
  try {
    storageAvailable = false;
    scene.applyShop(upgradeCargoCapacity(source), CARGO_CAPACITY_ID, 'Bought');
    assert.equal(scene.profile, source);
    assert.equal(detail[0], 'capacity');
    assert.match(detail[2], /could not be saved/);
    assert.equal(detail[3], true);
  } finally { storageAvailable = true; }
});

test('cargo tier transition, purchases and equip actions share one saved equipment slot', () => {
  const scene = depotScene();
  scene.profile.coins = 10000;
  scene.profile.cargoCapacityRank = 7;
  scene.profile.shipStates.standard.equippedModuleIds.push(CARGO_CAPACITY_ID);
  scene.trackOverlayObject = object => object;
  scene.add = {image: () => ({width: 162, height: 195, setScale() { return this; },
    setDisplaySize() { return this; }, setDepth() { return this; }})};
  const labels = [], buttons = [];
  let title, subtitle;
  scene.panel = () => {};
  let previousWasTitle = false;
  scene.addLabel = (text, x, y, size, color) => {
    if (previousWasTitle && size === 12 && color === '#b8c9d8') subtitle = text;
    previousWasTitle = size === 22 && color === '#a0f4ff';
    if (previousWasTitle) title = text;
    labels.push(text);
    return {text, x, y, height: 24};
  };
  scene.addButton = (label, y, action, options = {}) => buttons.push({label, y, action, ...options});
  const action = label => buttons.findLast(button => button.label === label).action;
  const before = scene.profile;
  assert.equal(scene.upgradeTileModel({kind: 'capacity'}, 'standard').tier, 1);
  scene.showUpgradeDetail('reinforcement');
  assert.equal(title, 'CARGO CAPACITY', 'unearned Tier 2 cannot open as a separate detail');
  scene.showUpgradePurchaseConfirm('capacity', 'standard');
  try {
    storageAvailable = false;
    action('CONFIRM  1050 COINS')();
    assert.equal(scene.profile, before);
    assert.equal(title, 'CARGO CAPACITY');
    assert.ok(labels.some(label => /could not be saved/.test(label)));
  } finally { storageAvailable = true; }
  scene.showUpgradePurchaseConfirm('capacity', 'standard');
  action('CONFIRM  1050 COINS')();
  assert.equal(scene.profile.cargoCapacityRank, 8);
  assert.equal(scene.profile.reinforcedCargoRank, 0);
  assert.equal(scene.profile.coins, 8950);
  assert.equal(savedProfile, scene.profile);
  assert.equal(title, 'REINFORCED CARGO HOLD');
  assert.equal(subtitle, 'Level 0/4  •  Cargo');
  const tier2 = scene.upgradeTileModel({kind: 'capacity'}, 'standard');
  assert.equal(tier2.name, 'Reinforced Cargo Hold');
  assert.equal(tier2.tier, 2);
  assert.equal(tier2.kind, 'reinforcement');
  assert.equal(tier2.rank, 'Lv 0/4');
  assert.match(tier2.benefit, /32 cargo/);
  assert.deepEqual(scene.profile.shipStates.standard.equippedModuleIds,
    before.shipStates.standard.equippedModuleIds, 'tier transition preserves the existing loadout');
  assert.ok(labels.some(text => text.includes('Carry 32 cargo and lose less cargo value when hit.')));
  const firstTier2 = scene.profile;
  scene.showUpgradePurchaseConfirm('reinforcement', 'standard');
  assert.ok(labels.some(text => text.includes('Keep 32 cargo slots.')));
  try {
    storageAvailable = false;
    action('CONFIRM  200 COINS')();
    assert.equal(scene.profile, firstTier2);
    assert.equal(title, 'REINFORCED CARGO HOLD');
    assert.ok(labels.some(label => /could not be saved/.test(label)));
  } finally { storageAvailable = true; }
  scene.showUpgradePurchaseConfirm('reinforcement', 'standard');
  action('CONFIRM  200 COINS')();
  assert.equal(scene.profile.reinforcedCargoRank, 1);
  assert.equal(scene.profile.coins, 8750);
  assert.equal(loadoutStats(scene.profile).capacity, 32);
  assert.equal(loadoutStats(scene.profile).cargoMitigation, 0.15);
  const unequip = buttons.findLast(button => button.label === 'UNEQUIP');
  assert.ok(unequip.height * 320 / 390 >= 44);
  unequip.action();
  assert.equal(scene.profile.cargoCapacityRank, 8);
  assert.equal(scene.profile.reinforcedCargoRank, 1);
  assert.equal(loadoutStats(scene.profile).capacity, 11);
  assert.equal(loadoutStats(scene.profile).cargoMitigation, 0);
  assert.equal(title, 'REINFORCED CARGO HOLD', 'unequipping does not demote the purchased tier');
  action('EQUIP')();
  assert.equal(loadoutStats(scene.profile).capacity, 32);
  assert.equal(loadoutStats(scene.profile).cargoMitigation, 0.15);
  assert.deepEqual(Array.from(scene.profile.shipStates.standard.equippedModuleIds),
    before.shipStates.standard.equippedModuleIds);
  scene.profile.selectedVehicleId = 'swift';
  scene.profile.shipStates.swift = {unlockedSlotCount: 3, equippedModuleIds: []};
  scene.shopChassisId = 'swift';
  scene.showModuleDetail(CARGO_CAPACITY_ID);
  assert.equal(scene.upgradeTileModel({kind: 'capacity'}, 'swift').benefit, '28 cargo\n−15% hit loss');
  action('EQUIP')();
  assert.equal(loadoutStats(scene.profile, 'swift').capacity, 28);
  assert.equal(loadoutStats(scene.profile, 'swift').cargoMitigation, 0.15);
  assert.equal(scene.profile.shipStates.swift.equippedModuleIds.length, 1);
  scene.showUpgradePurchaseConfirm('reinforcement', 'swift');
  assert.ok(labels.some(text => text.includes('Keep 28 cargo slots.')));
});

test('Garage Reinforced Cargo Hold uses level vocabulary for all four purchased levels', () => {
  const scene = depotScene();
  scene.profile.cargoCapacityRank = 8;
  scene.profile.coins = 10000;
  scene.trackOverlayObject = object => object;
  scene.add = {image: () => ({width: 162, height: 195, setScale() { return this; },
    setDisplaySize() { return this; }, setDepth() { return this; }})};
  const labels = [], buttons = [];
  scene.addLabel = text => { labels.push(text); return {height: 24}; };
  scene.addButton = label => buttons.push(label);
  for (let level = 0; level <= 4; level++) {
    scene.profile.reinforcedCargoRank = level;
    const before = JSON.stringify(scene.profile);
    const tile = scene.upgradeTileModel({kind: 'capacity'}, 'standard');
    assert.equal(tile.rank, `Lv ${level}/4`);
    labels.length = 0;
    buttons.length = 0;
    scene.showModuleDetail(CARGO_CAPACITY_ID);
    assert.ok(labels.some(text => text.includes(`Level ${level}/4`)));
    assert.ok(!labels.some(text => /Tier 2 rank|Maximum rank/.test(text)));
    if (level < 4) assert.ok(buttons.includes(`UPGRADE TO LV ${level + 1}`));
    else assert.ok(labels.includes('Maximum level reached.'));
    assert.equal(JSON.stringify(scene.profile), before);
  }
});

function shipMenuScene(profile) {
  const scene = new Scene();
  const buttons = [], labels = [], cards = [];
  scene.profile = profile;
  scene.overlayObjects = [];
  scene.setWorldVisible = () => {};
  scene.panel = (title, subtitle) => { scene.heading = {title, subtitle}; };
  scene.createMenuScroll = (key, top, bottom) => {
    scene.menuScrollKey = key;
    scene.menuScrollTop = top;
    scene.menuScrollBottom = bottom;
  };
  scene.finishMenuScroll = () => {};
  scene.addCurrency = () => {};
  scene.addFooterButton = (label, onClick, options) => { scene.footerButton = {label, onClick, options}; };
  scene.addFooterActions = actions => { scene.footerActions = actions; };
  scene.addMenuTile = () => {};
  scene.bindTilePress = (card, action) => { card.openPreview = action; };
  scene.withMenuScrollItem = (y, height, render) => {
    const first = scene.overlayObjects.length;
    render();
    cards.push({y, height, objects: scene.overlayObjects.slice(first)});
  };
  scene.addButton = (label, y, action, options) => {
    const button = {label, y, action, ...options};
    buttons.push(button);
    return button;
  };
  scene.add = {
    graphics: () => ({lines: [], setDepth() { return this; }, lineStyle() { return this; },
      strokeRoundedRect(...args) { this.outline = args; return this; },
      strokeLineShape(line) { this.lines.push(line); return this; }}),
    image: (x, y, key) => ({
      x, y, key, width: 162, height: 195,
      setDepth() { return this; }, setScale(scale) { this.displayWidth = this.width * scale; this.displayHeight = this.height * scale; return this; },
      setTint() { return this; }, setAlpha() { return this; }, setDisplaySize() { return this; },
    }),
    rectangle: (x, y, width, height, color) => ({x, y, width, height, color,
      setOrigin() { return this; }, setDepth() { return this; }}),
    text(x, y, text, style) {
      const label = {x, y, text, style, width: Math.max(...text.split('\n').map(line => line.length * 7)),
        height: Math.ceil(Number.parseFloat(style.fontSize) * 1.2) * text.split('\n').length,
        get displayHeight() { return this.height * (this.scale ?? 1); },
        setScale(scale) { this.scale = scale; return this; },
        setOrigin(x, y = x) { this.originX = x; this.originY = y; return this; },
        setDepth() { return this; }, setLineSpacing() { return this; },
        setY(y) { this.y = y; return this; }};
      labels.push(label);
      return label;
    },
  };
  return {scene, buttons, labels, cards};
}

test('Garage mobile card lists reveal 30 to 40 percent of card three with tight gaps and fixed footer clearance', () => {
  for (const [width, height] of [[320, 568], [360, 800], [390, 844], [420, 844]]) {
    for (const fullSlots of [false, true]) for (const tab of ['garage', 'upgrades']) {
      const profile = defaultProfile();
      if (fullSlots) profile.shipStates.standard.unlockedSlotCount = 6;
      const before = JSON.stringify(profile);
      const {scene, cards, buttons, labels} = shipMenuScene(profile);
      scene.menuHeight = responsiveViewport(width, height, 390).worldHeight;
      scene.showGarage('', false, tab);
      const tabs = buttons.filter(button => ['TRUCKS', 'UPGRADES'].includes(button.label));
      assert.equal(tabs.length, 2);
      assert.ok(tabs.every(button => button.x - button.width / 2 >= MENU_SPACING.edge &&
        button.x + button.width / 2 <= 390 - MENU_SPACING.edge), `${width}x${height}/${tab}: tab gutters`);
      assert.ok(tabs.every(button => button.y - button.height / 2 >= 92 + 6),
        `${width}x${height}/${tab}: tabs clear the header banner`);
      const sectionHeader = labels.find(label => label.text.startsWith(tab === 'garage' ? 'STANDARD' : 'MODULES'));
      assert.ok(sectionHeader.y > tabs[0].y + tabs[0].height / 2 + 8,
        `${width}x${height}/${tab}: section header clears the tabs`);
      assert.ok(scene.overlayObjects.some(object => object.x === 300 && object.y === 56 &&
        object.width === 100 && object.height === 34), `${width}x${height}/${tab}: wallet stays inside its inset`);
      const tiles = cards.filter(card => card.height > 100);
      const peekIndex = tiles.findIndex(tile => tile.y + tile.height / 2 > scene.menuScrollBottom + 1e-9);
      assert.ok(peekIndex >= 1, `${width}x${height}/${tab}/${fullSlots}: at least one full card row`);
      const third = tiles[peekIndex];
      const visible = scene.menuScrollBottom - (third.y - third.height / 2);
      const minimumHeight = tab === 'garage' ? 196 : 180;
      if (third.height <= minimumHeight + 1e-9) {
        assert.ok(visible / third.height <= 0.4,
          `${width}x${height}/${tab}/${fullSlots}: readable minimum-height cards keep rows whole`);
      } else {
        assert.ok(visible / third.height >= 0.3 - 1e-9 && visible / third.height <= 0.4,
          `${width}x${height}/${tab}/${fullSlots}: ${visible / third.height}`);
      }
      const nextRow = tiles[tab === 'garage' ? 1 : 2];
      assert.ok(Math.abs(nextRow.y - tiles[0].y - tiles[0].height - 12) < 1e-9);
      assert.equal(scene.footerButton.label, 'BACK TO MENU');
      if (tab === 'upgrades') {
        const header = scene.overlayObjects.find(object => object.text?.startsWith('MODULES'));
        const socket = cards.find(card => card.height === 50);
        assert.equal(socket.y - 25, header.y + header.displayHeight + 24);
      }
      assert.equal(JSON.stringify(scene.profile), before);
    }
  }
});

test('Garage card headers fit unbroken single-line text inside their explicit padded width', () => {
  const {scene, labels} = shipMenuScene(defaultProfile());
  const header = scene.addCardText('LONG UNBROKEN HEADER STATUS', 44, 100, 133, 13, '#ffffff', {singleLine: true});
  assert.equal(header.style.wordWrap.width, 133);
  assert.deepEqual(Array.from(header.style.wordWrap.callback('A B')), ['A B']);
  assert.equal(header.style.align, 'center');
  assert.equal(header.x, 44 + 133 / 2);
  assert.equal(header.originX, 0.5);
  assert.ok(header.scale < 1);
  assert.ok(header.width * header.scale <= 133);
  assert.equal(labels.length, 1);
});

test('Garage socket accumulator translates sockets, unlock button and grid with the measured header height', () => {
  const layouts = [];
  for (const tallerHeader of [false, true]) {
    const {scene, buttons, cards} = shipMenuScene(defaultProfile());
    const addText = scene.add.text;
    scene.add.text = (...args) => {
      const text = addText(...args);
      if (tallerHeader && text.text.startsWith('MODULES')) {
        text.height = 40;
        text.setScale(0.75);
      }
      return text;
    };
    scene.showGarage('', false, 'upgrades');
    const header = scene.overlayObjects.find(object => object.text?.startsWith('MODULES'));
    const socketTop = cards.find(card => card.height === 50).y - 25;
    assert.equal(socketTop, header.y + header.displayHeight + 24);
    layouts.push({
      headerHeight: header.displayHeight,
      socketTop,
      unlockY: buttons.find(button => button.label.startsWith('UNLOCK SLOT')).y,
      gridTop: cards.find(card => card.height > 100).y -
        cards.find(card => card.height > 100).height / 2,
    });
  }
  const difference = layouts[1].headerHeight - layouts[0].headerHeight;
  for (const key of ['socketTop', 'unlockY', 'gridTop']) {
    assert.equal(layouts[1][key] - layouts[0][key], difference, key);
  }
});

test('Garage upgrade details and confirmations use matching supplied sprites with scaled scroll bounds', () => {
  const profile = defaultProfile();
  profile.coins = 10000;
  profile.level1Completed = true;
  for (const def of MODULE_DEFS) profile.ownedModules[def.id] = 1;
  const {scene, labels} = shipMenuScene(profile);
  scene.panel = (title, subtitle) => {
    scene.overlayObjects = [];
    scene.heading = {title, subtitle};
  };
  const before = JSON.stringify(profile);
  for (const art of GARAGE_UPGRADE_ART) {
    const kind = art.id === CARGO_CAPACITY_ID ? 'capacity' : 'module';
    for (const confirm of [false, true]) {
      labels.length = 0;
      if (confirm) scene.showUpgradePurchaseConfirm(kind, 'standard', art.id);
      else scene.showUpgradeDetail(kind, art.id);
      const icons = scene.overlayObjects.filter(object => object.key?.startsWith('garage_upgrade_'));
      assert.equal(icons.length, 1);
      const icon = icons[0];
      assert.equal(icon.key, art.key);
      assert.equal(Math.max(icon.displayWidth, icon.displayHeight), 72);
      assert.equal(icon.menuScrollBounds.top, icon.y - 36);
      assert.equal(icon.menuScrollBounds.bottom, icon.y + 36);
      assert.equal(scene.heading.title, 'UPGRADES');
      assert.ok(labels.some(label => label.y === 108));
      assert.equal(JSON.stringify(scene.profile), before, 'previewing a purchase never writes progress');
    }
  }
  scene.profile.cargoCapacityRank = 8;
  scene.showUpgradeDetail('reinforcement');
  assert.equal(scene.overlayObjects.find(object => object.key?.startsWith('garage_upgrade_')).key,
    GARAGE_UPGRADE_ART.find(art => art.id === CARGO_CAPACITY_ID).key,
    'reinforced hold shares the approved Cargo Capacity art, not an unrelated module sprite');
});

test('Garage Upgrades header and socket bay preserve all six per-ship equipped, empty and locked states', () => {
  for (const vehicleId of ['standard', 'swift']) for (const count of [2, 6]) {
    const profile = defaultProfile();
    profile.selectedVehicleId = vehicleId;
    if (vehicleId === 'swift') profile.ownedVehicleIds.push(vehicleId);
    const ids = [CARGO_CAPACITY_ID, 'hand_precision', 'coll_magnet', 'cargo_light', 'def_plating', 'def_shield'];
    profile.cargoCapacityRank = 1;
    profile.shipStates[vehicleId] = {...profile.shipStates.standard,
      unlockedSlotCount: count, equippedModuleIds: count === 6 ? ids : ['hand_precision']};
    ids.forEach(id => { if (id !== CARGO_CAPACITY_ID) profile.ownedModules[id] = 1; });
    const before = JSON.stringify(profile);
    const {scene, buttons, cards, labels} = shipMenuScene(profile);
    scene.addUpgradeGridTile = () => {};
    scene.showGarage('', false, 'upgrades');
    assert.equal(scene.heading.title, 'UPGRADES');
    assert.equal(scene.menuScrollKey, 'garage:upgrades');
    const tabs = buttons.filter(button => ['TRUCKS', 'UPGRADES'].includes(button.label));
    assert.equal(tabs.length, 2);
    assert.equal(new Set(tabs.map(button => button.y)).size, 1, 'garage tabs share one row');
    const header = labels.find(label => label.text.startsWith('MODULES'));
    assert.ok(tabs.every(button => button.y - button.height / 2 >= 98 &&
      button.y + button.height / 2 + 8 <= header.y),
    'tabs remain below the header banner and clear the measured section heading');
    const sockets = cards.filter(card => card.height === 50);
    assert.equal(sockets.length, 6);
    assert.equal(new Set(sockets.map(card => card.y)).size, 1);
    sockets.forEach((socket, index) => {
      const box = socket.objects[0];
      assert.ok(box.x - 25 >= MENU_SPACING.edge && box.x + 25 <= 390 - MENU_SPACING.edge);
      const id = profile.shipStates[vehicleId].equippedModuleIds[index];
      if (id) {
        const icon = socket.objects.find(object => object.key?.startsWith('garage_upgrade_'));
        assert.equal(icon.key, GARAGE_UPGRADE_ART.find(art => art.id === id).key);
        assert.equal(Math.max(icon.displayWidth, icon.displayHeight), 36);
        assert.ok(socket.objects.some(object => object.outline), 'equipped socket has cyan outline glow');
        let opened;
        scene.showModuleDetail = id => { opened = id; };
        box.openPreview();
        assert.equal(opened, id);
      } else if (index < count) {
        assert.ok(socket.objects.some(object => object.lines?.length === 20), 'empty socket has dashed cyan edges');
        assert.equal(box.fillAlpha, 0.5);
        assert.equal(box.openPreview, undefined);
      } else {
        assert.ok(socket.objects.some(object => object.key === 'garage_lock'));
        assert.equal(box.openPreview, undefined);
      }
    });
    const offer = nextSlotOffer(profile, vehicleId);
    const unlock = buttons.find(button => button.label.startsWith('UNLOCK SLOT'));
    assert.equal(Boolean(unlock), Boolean(offer));
    if (offer) {
      assert.equal(unlock.label, `UNLOCK SLOT ${offer.slot}  •  ${offer.cost} COINS`);
      assert.equal(unlock.fill, PALETTE.cyan);
      assert.equal(unlock.disabled, !offer.canBuy);
      assert.ok(unlock.y - 27 > sockets[0].y + 25);
    }
    assert.equal(JSON.stringify(scene.profile), before, 'display does not modify slots or equipment');
  }
});

test('Garage socket unlock button uses the existing milestone, affordability and confirmation owner', () => {
  for (const coins of [0, 2000]) {
    const profile = defaultProfile();
    profile.coins = coins;
    profile.milestones = ['level1,sector2'];
    const {scene, buttons} = shipMenuScene(profile);
    scene.addUpgradeGridTile = () => {};
    scene.showGarage('', false, 'upgrades');
    const offer = nextSlotOffer(profile, 'standard');
    const button = buttons.find(button => button.label.startsWith('UNLOCK SLOT'));
    assert.equal(button.disabled, !offer.canBuy);
    let confirm;
    scene.showUpgradePurchaseConfirm = (...args) => { confirm = args; };
    if (!button.disabled) {
      button.action();
      assert.deepEqual(confirm, ['slot', 'standard']);
    }
    assert.deepEqual(scene.profile, profile);
  }
});

test('Garage upgrade cards bind supplied art and display exact ranks, bonuses and action states in two columns', () => {
  for (const variant of ['fresh', 'equipped', 'max', 'poor']) {
    const profile = defaultProfile();
    profile.coins = variant === 'poor' ? 0 : 10000;
    profile.milestones = ['level1,sector2', 'level1,sector3', 'level1,sector4'];
    if (variant === 'equipped' || variant === 'max') {
      const rank = variant === 'max' ? 5 : 1;
      profile.ownedModules = {...profile.ownedModules, coll_magnet: rank, def_shield: variant === 'max' ? 3 : 1};
      profile.shipStates.standard = {...profile.shipStates.standard, unlockedSlotCount: 6,
        equippedModuleIds: ['hand_precision', 'coll_magnet', 'def_shield']};
      profile.ownedModules.hand_precision = rank;
    }
    const before = JSON.stringify(profile);
    const {scene, buttons, labels, cards} = shipMenuScene(profile);
    scene.showGarage('', false, 'upgrades');
    const upgrades = cards.filter(card => card.objects.some(object => object.key?.startsWith('garage_upgrade_')) && card.height > 50);
    assert.equal(upgrades.length, 8);
    assert.equal(new Set(upgrades.map(card => card.objects[0].x)).size, 2);
    upgrades.forEach((card, index) => {
      const box = card.objects[0];
      const icon = card.objects.find(object => object.key?.startsWith('garage_upgrade_'));
      const content = upgradeTileContentMetrics(box.width, box.height);
      const id = ['cargo_expanded', 'hand_precision', 'coll_magnet', 'cargo_light',
        'def_plating', 'util_insurance', 'def_shield', 'util_impact_pulse'][index];
      assert.equal(icon.key, GARAGE_UPGRADE_ART.find(art => art.id === id).key);
      assert.equal(Math.max(icon.displayWidth, icon.displayHeight), content.iconSize);
      assert.ok(card.objects.indexOf(icon) > 0, 'art is painted after its backing');
      const action = buttons.find(button => button.x === box.x &&
        button.y > card.y - card.height / 2 && button.y < card.y + card.height / 2);
      assert.equal(action.width, box.width - content.paddingX * 2);
      assert.equal(action.height, content.buttonHeight);
      if (id === 'hand_precision') {
        const owned = variant === 'equipped' || variant === 'max';
        const price = GAME_BALANCE.upgrades.modules.hand_precision.price;
        assert.equal(action.label, variant === 'max' ? 'MAX LEVEL' : owned ? 'EQUIPPED' : `${price} COINS`);
        assert.equal(action.disabled, owned || variant === 'poor');
        if (owned) {
          assert.equal(action.fill, variant === 'max' ? PALETTE.steelDark : PALETTE.cyan);
          const rank = variant === 'max' ? 5 : 1;
          const benefit = Math.round(GAME_BALANCE.upgrades.modules.hand_precision.values[rank - 1] * 100);
          assert.ok(card.objects.some(object => object.text === `+${benefit}% STEERING`));
        }
      }
      if (id === 'cargo_expanded') {
        assert.ok(card.objects.some(object => object.text === 'T1  •  Rank 0/8'));
        assert.ok(card.objects.some(object => object.text === '+2 CARGO SLOTS\nNEXT RANK'));
        assert.equal(action.label, `${cargoCapacityStatus(profile).cost} COINS`);
        assert.equal(action.disabled, variant === 'poor');
      }
      if (id === 'def_shield') {
        assert.ok(card.objects.some(object => object.text === `T1  •  Lv ${variant === 'max' ? 3 : variant === 'equipped' ? 1 : 0}/3`));
        assert.ok(card.objects.some(object => object.text === `${variant === 'max' ? 3 : 1} SHIELD CHARGE${variant === 'max' ? 'S' : ''}`));
        assert.equal(action.label, variant === 'max' ? 'MAX LEVEL' : variant === 'equipped' ? 'EQUIPPED' : 'LOCKED');
      }
      let detail;
      scene.showUpgradeDetail = (...args) => { detail = args; };
      box.openPreview();
      assert.equal(detail[0], id === 'cargo_expanded' ? 'capacity' : 'module');
      if (id !== 'cargo_expanded') assert.equal(detail[1], id);
    });
    assert.ok(labels.every(label => !/undefined|NaN/.test(label.text)));
    assert.equal(JSON.stringify(scene.profile), before);
  }
});

test('Garage upgrade card purchase confirms exact existing price, preserves save failures and updates equipped sockets', () => {
  const profile = defaultProfile();
  profile.coins = 2000;
  profile.levelProgress.level3 = {...profile.levelProgress.level3, reachedSectors: [1]};
  const {scene, buttons, cards} = shipMenuScene(profile);
  scene.showGarage('', false, 'upgrades');
  const price = moduleStatus(profile, 'coll_magnet').def.price;
  const magnet = cards.find(card => card.objects.some(object => object.text === 'MAGNETIC COLLECTOR'));
  const purchase = buttons.find(button => button.x === magnet.objects[0].x &&
    button.y > magnet.y - magnet.height / 2 && button.y < magnet.y + magnet.height / 2);
  const before = JSON.stringify(profile);
  purchase.action();
  assert.equal(scene.phase, 'upgradePurchaseConfirm');
  assert.equal(JSON.stringify(scene.profile), before);
  scene.footerActions[1].onClick();
  assert.equal(scene.phase, 'upgradeDetail', 'cancel returns without spending');
  assert.equal(JSON.stringify(scene.profile), before);
  scene.showUpgradePurchaseConfirm('module', 'standard', 'coll_magnet');
  const confirm = scene.footerActions[0].onClick;
  try {
    storageAvailable = false;
    confirm();
    assert.equal(JSON.stringify(scene.profile), before);
    storageAvailable = true;
    confirm();
    assert.equal(scene.profile.coins, profile.coins - price);
    assert.equal(scene.profile.ownedModules.coll_magnet, 1);
    assert.ok(scene.profile.shipStates.standard.equippedModuleIds.includes('coll_magnet'));
    assert.equal(savedProfile.coins, scene.profile.coins);
    cards.length = 0;
    scene.showGarage('', false, 'upgrades');
    const sockets = cards.filter(card => card.height === 50);
    assert.equal(sockets.filter(card => card.objects.some(object =>
      object.key === 'garage_upgrade_magnet')).length, 1);
    scene.showModuleDetail('coll_magnet');
    buttons.findLast(button => button.label === 'UNEQUIP').action();
    cards.length = 0;
    scene.showGarage('', false, 'upgrades');
    assert.ok(!cards.filter(card => card.height === 50).some(card => card.objects.some(object =>
      object.key === 'garage_upgrade_magnet')), 'unequip frees the socket without deleting ownership');
    assert.equal(scene.profile.ownedModules.coll_magnet, 1);
    assert.equal(scene.profile.coins, profile.coins - price);
    scene.showModuleDetail('coll_magnet');
    buttons.findLast(button => button.label === 'EQUIP').action();
    assert.ok(scene.profile.shipStates.standard.equippedModuleIds.includes('coll_magnet'));
  } finally {
    storageAvailable = true;
  }
});

test('Garage Trucks and Upgrades switches retain one active renderer and the existing pinned footer without saving', () => {
  const profile = defaultProfile();
  const {scene, buttons} = shipMenuScene(profile);
  const before = JSON.stringify(profile);
  for (let i = 0; i < 5; i++) {
    scene.showGarage('', false, 'upgrades');
    const renderer = scene.screenRenderer;
    buttons.findLast(button => button.label === 'UPGRADES').action();
    assert.equal(scene.screenRenderer, renderer, 'reselecting the active tab cannot duplicate its render');
    buttons.findLast(button => button.label === 'TRUCKS').action();
    assert.equal(scene.garageTab, 'garage');
    assert.equal(scene.heading.title, 'GARAGE');
    assert.equal(scene.menuScrollKey, 'garage:garage');
    buttons.findLast(button => button.label === 'UPGRADES').action();
    assert.equal(scene.garageTab, 'upgrades');
    assert.equal(scene.heading.title, 'UPGRADES');
    scene.screenRenderer();
    assert.equal(scene.menuScrollKey, 'garage:upgrades');
    assert.equal(scene.footerButton.label, 'BACK TO MENU');
    assert.equal(scene.footerButton.options.height, 54);
  }
  let menu = false;
  scene.showMenu = () => { menu = true; };
  scene.footerButton.onClick();
  assert.equal(menu, true);
  assert.equal(JSON.stringify(scene.profile), before);
});

test('Garage overlay cleanup destroys the old scrolling container and resets clipped input before the next tab', () => {
  const scene = new Scene();
  const destroyed = [], killed = [];
  const child = {name: 'socket'};
  const content = {list: [child], destroy(children) { destroyed.push(['content', children]); },
    clearMask() { destroyed.push(['mask']); }};
  const button = {destroy() { destroyed.push(['footer']); }};
  scene.tweens = {killTweensOf(object) { killed.push(object); }};
  scene.overlayObjects = [content, button];
  scene.menuScrollContainer = content;
  scene.menuScrollMask = {};
  scene.menuScrollMaskGraphics = {destroy() { destroyed.push(['mask graphics']); }};
  scene.menuScrollGesture = {id: 1};
  scene.menuScrollVelocity = 500;
  scene.menuScrollDraggedPointerId = 1;
  scene.activeMenuContent = content;
  scene.clearOverlay();
  assert.deepEqual(destroyed, [['content', true], ['footer'], ['mask'], ['mask graphics']]);
  assert.deepEqual(killed, [content, child, button]);
  assert.equal(scene.menuScrollContainer, null);
  assert.equal(scene.menuScrollMask, null);
  assert.equal(scene.menuScrollGesture, null);
  assert.equal(scene.menuScrollVelocity, 0);
  assert.equal(scene.menuScrollDraggedPointerId, null);
  assert.equal(scene.activeMenuContent, null);
  assert.equal(scene.overlayObjects.length, 0);
});

test('Garage truck concept cards retain preview/equip/unlock gates and only Apex as Coming Soon', () => {
  for (const variant of ['selected', 'owned', 'swift-selected', 'level-locked', 'shortfall', 'purchasable']) {
    const profile = defaultProfile();
    if (['owned', 'swift-selected'].includes(variant)) {
      profile.ownedVehicleIds.push('swift');
      profile.shipStates.swift = structuredClone(profile.shipStates.standard);
      profile.shipStates.swift.unlockedSlotCount = 3;
    }
    if (variant === 'swift-selected') profile.selectedVehicleId = 'swift';
    profile.levelProgress.level2.unlocked = variant !== 'level-locked';
    profile.blueprints = variant === 'shortfall' ? 1 : GAME_BALANCE.vehicles.swift.blueprintCost;
    const before = JSON.stringify(profile);
    const {scene, buttons, cards, labels} = shipMenuScene(profile);
    scene.showGarage('', false, 'garage');
    assert.equal(cards.length, 4, variant);
    assert.equal(scene.heading.title, 'GARAGE');
    assert.equal(buttons[0].label, 'TRUCKS');
    assert.equal(buttons[1].label, 'UPGRADES');
    const actions = buttons.filter(button => ['PREVIEW', 'EQUIP', 'EQUIPPED'].includes(button.label));
    assert.equal(JSON.stringify(scene.profile), before, 'browsing has no persistence effects');
    for (const [index, id] of IMPLEMENTED_VEHICLE_IDS.entries()) {
      const status = vehicleStatus(profile, id);
      const card = cards[index];
      const preview = buttons.find(button => button.label === 'PREVIEW' &&
        button.y >= card.y - card.height / 2 && button.y <= card.y + card.height / 2);
      const equip = buttons.find(button => button.width === 176 &&
        button.y >= card.y - card.height / 2 && button.y <= card.y + card.height / 2);
      assert.equal(preview.label, 'PREVIEW');
      assert.ok(!preview.disabled, 'even locked ships can be previewed');
      assert.equal(equip.label, status.owned ? status.selected ? 'EQUIPPED' : 'EQUIP'
        : status.levelUnlocked ? `UNLOCK  •  ${status.cost} BP` : 'BEAT LEVEL 1 TO UNLOCK');
      assert.equal(equip.disabled, status.selected || (!status.owned && !status.canPurchase));
      assert.equal(equip.disabledAlpha, 1, 'equipped/locked action states remain high contrast');
      assert.ok(preview.height * 320 / 390 >= 44 && equip.height * 320 / 390 >= 44,
        'both controls retain a 44px touch height at 320px width');
      assert.equal(equip.y, preview.y, 'actions share one row to leave a next-card peek');
      assert.ok(equip.x - equip.width / 2 - (preview.x + preview.width / 2) >= MENU_SPACING.gap);
      const sectionHeader = labels.find(label =>
        label.text.startsWith(profile.selectedVehicleId.toUpperCase()));
      const contentTop = Math.max(184, sectionHeader.y + sectionHeader.height + 8);
      assert.equal(card.height, adaptiveCardMetrics(contentTop + 4,
        scene.menuMetrics().contentBottom, 196).height);
      const display = card.objects.find(object => object.key === `garage_${id}_display`);
      assert.equal(card.objects[0].height, card.height, 'container insertion order paints backing before bars and lock overlays');
      if (!status.owned) assert.ok(card.objects.findIndex(object => object.key === 'garage_lock') >
        card.objects.indexOf(display), 'lock is painted over the vehicle, not beneath the card');
      assert.ok(display.x > 390 / 2);
      assert.ok(Math.abs(Math.max(display.displayWidth, display.displayHeight) - 90) < 1e-9);
      for (const button of [preview, equip]) {
        assert.ok(button.y + button.height / 2 <= card.y + card.height / 2 - MENU_SPACING.padding + 1e-9);
        assert.ok((button.x ?? 195) - button.width / 2 >= MENU_SPACING.edge + MENU_SPACING.padding);
        assert.ok((button.x ?? 195) + button.width / 2 <= 390 - MENU_SPACING.edge - MENU_SPACING.padding);
      }
      assert.ok(card.objects.filter(object => object.text).every(label =>
        label.y <= preview.y - preview.height / 2 - MENU_SPACING.gap),
      'text is above, not under, the actions');
      let opened;
      scene.showVehicleDetail = vehicleId => { opened = vehicleId; };
      preview.action();
      assert.equal(opened, id);
      card.objects[0].openPreview();
      assert.equal(opened, id, 'clicking the truck card opens the same preview without equipping');
      assert.equal(JSON.stringify(scene.profile), before, 'Preview cannot equip or purchase');
      let change;
      scene.applyVehicleChange = result => { change = result; };
      if (!equip.disabled && status.owned) {
        equip.action();
        assert.equal(change.ok, true);
        assert.equal(change.profile.selectedVehicleId, id);
        assert.equal(change.profile.coins, profile.coins);
        assert.equal(change.profile.blueprints, profile.blueprints);
        assert.deepEqual(change.profile.shipStates, profile.shipStates);
      }
    }
    assert.equal(actions.filter(button => button.label === 'PREVIEW').length, 3);
    const coming = buttons.filter(button => button.label === 'Coming Soon');
    assert.equal(coming.length, 1);
    assert.ok(cards.slice(3).every(card => !card.objects[0].openPreview));
    assert.ok(coming.every(button => button.disabled), 'planned vehicles cannot equip, purchase or unlock');
    assert.equal(JSON.stringify(scene.profile), before);
  }
});

test('Garage ship details are read-only and preserve equip, unlock and confirmed purchase paths', () => {
  for (const variant of ['selected', 'owned', 'level-locked', 'shortfall', 'purchasable']) {
    const profile = defaultProfile();
    const id = variant === 'selected' ? 'standard' : 'swift';
    if (variant === 'owned') {
      profile.ownedVehicleIds.push(id);
      profile.shipStates.swift = structuredClone(profile.shipStates.standard);
      profile.shipStates.swift.unlockedSlotCount = 3;
    }
    profile.levelProgress.level2.unlocked = variant !== 'level-locked';
    profile.blueprints = variant === 'shortfall' ? 1 : GAME_BALANCE.vehicles.swift.blueprintCost;
    const before = JSON.stringify(profile);
    const {scene, labels} = shipMenuScene(profile);
    scene.showVehicleDetail(id);
    const status = vehicleStatus(profile, id);
    const stats = loadoutStats(profile, id);
    assert.equal(scene.phase, 'vehicleDetail');
    assert.equal(scene.menuScrollKey, `vehicle-detail:${id}`);
    assert.equal(scene.heading.title, 'GARAGE');
    assert.ok(labels.some(label => label.text === status.vehicle.name.toUpperCase().replace(' ', '\n')));
    assert.ok(labels.some(label => label.text === status.vehicle.ability));
    assert.ok(labels.some(label => label.text === `${stats.capacity} cargo  •  ${stats.hull} Hull  •  ${stats.shieldCapacity} Shield`));
    const primary = scene.footerActions[0];
    assert.equal(primary.options.disabled, status.owned ? status.selected : !status.canPurchase);
    assert.equal(primary.label, status.owned ? status.selected ? 'EQUIPPED' : 'EQUIP'
      : status.canPurchase ? `BUY  ${status.cost} BP` : 'LOCKED');
    if (variant === 'level-locked') {
      assert.ok(labels.some(label => label.text === status.lockReason));
    } else if (variant === 'shortfall') {
      assert.ok(labels.some(label => label.text === `Need ${status.cost - profile.blueprints} more Blueprints.`));
    }
    assert.equal(JSON.stringify(scene.profile), before);
    scene.screenRenderer();
    assert.equal(scene.menuScrollKey, `vehicle-detail:${id}`, 'resize retains the previewed ship');
    assert.equal(JSON.stringify(scene.profile), before);
    if (variant === 'owned') {
      scene.showVehicleDetail = (vehicleId, message, isError) => { scene.feedback = {vehicleId, message, isError}; };
      try {
        storageAvailable = false;
        primary.onClick();
        assert.equal(JSON.stringify(scene.profile), before, 'failed saves cannot apply the selection');
        assert.equal(scene.feedback.isError, true);
        storageAvailable = true;
        primary.onClick();
        assert.equal(scene.profile.selectedVehicleId, id);
        assert.equal(savedProfile.selectedVehicleId, id);
        assert.equal(scene.feedback.isError, false);
        assert.equal(scene.feedback.vehicleId, id, 'equip feedback stays in the opened truck menu');
        assert.deepEqual(scene.profile.shipStates, profile.shipStates);
      } finally {
        storageAvailable = true;
      }
    } else if (variant === 'purchasable') {
      let confirmation;
      scene.showVehiclePurchaseConfirm = vehicleId => { confirmation = vehicleId; };
      primary.onClick();
      assert.equal(confirmation, id);
      assert.equal(JSON.stringify(scene.profile), before, 'Buy opens confirmation before any charge');
    }
    let returned;
    scene.showGarage = (...args) => { returned = args; };
    scene.footerActions[1].onClick();
    assert.deepEqual(returned, ['', false, 'garage']);
  }
});

test('Garage cosmetic cards put long requirements and price states on separate full-width rows', () => {
  const scene = new Scene();
  const labels = [];
  scene.withMenuScrollItem = (_y, _height, render) => render();
  scene.trackOverlayObject = object => object;
  scene.bindTilePress = () => {};
  scene.addLabel = (text, x, y, size, color, width) => {
    const label = {text, x, y, size, width, height: text.includes('GOLD') ? 32 : 28,
      originX: 0.5, originY: 0,
      setOrigin(x, y = x) { this.originX = x; this.originY = y; return this; },
      setScale(scale) { this.scale = scale; return this; },
      setY(y) { this.y = y; return this; },
      setLineSpacing() { return this; }};
    labels.push(label);
    return label;
  };
  scene.addMenuTile('GOLD STANDARD ACHIEVEMENT',
    'Level 1 from Sector 1 in Standard Hauler • no damage', 'LOCKED',
    400, () => {}, {height: 148});
  assert.deepEqual(labels.map(label => label.width), [294, 294, 294]);
  assert.deepEqual(labels.map(label => label.size), [14, 12, 12]);
  assert.ok(labels.every(label => label.x === 195 && label.originX === 0.5),
    'title, description and state share the card center');
  assert.ok(labels[1].y >= labels[0].y + labels[0].height + 8);
  assert.ok(labels[2].y >= labels[1].y + labels[1].height + 8,
    'wrapped descriptions and states have a real gap');
  assert.equal(labels[2].originY, 0, 'all lines share the measured centered stack');
  assert.equal((labels[0].y + labels[2].y + labels[2].height) / 2, 400);
});

test('colors live only in the opened truck preview, with default selection and Standard-only achievement Gold', () => {
  for (const goldOwned of [false, true]) {
    const profile = defaultProfile();
    profile.coins = 1000;
    profile.ownedVehicleIds.push('swift');
    profile.shipStates.swift = structuredClone(profile.shipStates.standard);
    profile.shipStates.swift.ownedColorIds.push('white-blue');
    profile.shipStates.swift.equippedColorId = 'white-blue';
    if (goldOwned) profile.shipStates.standard.ownedColorIds.push('gold');
    const before = JSON.stringify(profile);
    const {scene, buttons, labels, cards} = shipMenuScene(profile);
    scene.showGarage('', false, 'garage');
    assert.equal(cards.length, 4, 'Garage contains trucks only, not a second color list');
    assert.ok(!labels.some(label => /COLORS|COSMETICS|GOLD STANDARD/.test(label.text)));
    for (const id of ['standard', 'swift']) {
      buttons.length = labels.length = cards.length = 0;
      scene.showVehicleDetail(id);
      assert.equal(scene.shopChassisId, id, 'preview ownership follows the clicked truck, not the equipped truck');
      assert.equal(scene.profile.selectedVehicleId, 'standard', 'opening Swift does not equip it');
      assert.equal(cards.length, id === 'standard' ? 6 : 5, 'hero plus only this truck colors');
      assert.ok(labels.some(label => label.text === 'DEFAULT COLOR'));
      assert.ok(labels.some(label => label.text === 'COLORS  /  SELECT OR BUY'));
      assert.ok(labels.every(label => !/undefined|NaN/.test(label.text)));
      const gold = labels.find(label => label.text === 'GOLD / WHITE');
      assert.equal(Boolean(gold), id === 'standard');
      if (id === 'standard') {
        assert.ok(labels.some(label => label.text === 'ACHIEVEMENT COLOR  /  NOT FOR SALE'));
        assert.equal(buttons.at(-1).label, goldOwned ? 'EQUIP COLOR' : 'ACHIEVEMENT LOCKED');
        assert.equal(buttons.at(-1).disabled, !goldOwned);
      }
      const colorButtons = buttons.filter(button => /COLOR|EQUIPPED|OWN TRUCK|ACHIEVEMENT/.test(button.label));
      assert.ok(colorButtons.every(button => button.width === 294 && button.height === 54));
      assert.ok(cards.every(card => card.objects[0].height === card.height));
      assert.equal(JSON.stringify(scene.profile), before, 'rendering never purchases/equips or grants Gold');
    }
  }
  const {scene, buttons, labels} = shipMenuScene(defaultProfile());
  scene.showVehicleDetail('swift');
  assert.ok(buttons.every(button => button.label === 'OWN TRUCK FIRST' && button.disabled));
  assert.ok(labels.every(label => !/undefined|NaN/.test(label.text)));
  assert.throws(() => scene.showTrimPurchaseConfirm('standard', 'gold'), /Invalid purchasable trim/);
  const poor = defaultProfile();
  poor.coins = 0;
  const menu = shipMenuScene(poor);
  menu.scene.showVehicleDetail('standard');
  const purchases = menu.buttons.filter(button => button.label.startsWith('BUY COLOR'));
  assert.equal(purchases.length, GAME_BALANCE.presentation.trimChoices.length);
  assert.ok(purchases.every(button => button.disabled));
  assert.equal(menu.labels.filter(label => label.text.includes('/  NEED ')).length,
    GAME_BALANCE.presentation.trimChoices.length);
  menu.scene.showTrimPurchaseConfirm('standard', 'white-blue');
  assert.equal(menu.scene.phase, 'vehicleDetail', 'unaffordable color cannot open a purchasable confirmation');
  assert.equal(menu.scene.menuScrollKey, 'vehicle-detail:standard');
  assert.ok(menu.labels.some(label => label.text === 'This color is no longer available to purchase.' &&
    label.style.color === '#ff9aa6'));
  assert.deepEqual(menu.scene.profile, poor);
});

test('truck preview resize and truck-purchase Back preserve the viewed chassis without changing selection', () => {
  const profile = defaultProfile();
  profile.levelProgress.level2.unlocked = true;
  profile.blueprints = vehicleStatus(profile, 'swift').cost;
  const {scene} = shipMenuScene(profile);
  const before = JSON.stringify(profile);
  scene.showVehicleDetail('swift', 'Preview message');
  scene.screenRenderer();
  assert.equal(scene.menuScrollKey, 'vehicle-detail:swift');
  assert.equal(scene.shopChassisId, 'swift');
  scene.footerActions[0].onClick();
  assert.equal(scene.phase, 'vehiclePurchaseConfirm');
  scene.footerActions[1].onClick();
  assert.equal(scene.menuScrollKey, 'vehicle-detail:swift');
  assert.equal(scene.profile.selectedVehicleId, 'standard');
  assert.equal(JSON.stringify(scene.profile), before);
});

test('per-truck color confirmation, cancellation, save failure, purchase and equip return to the same truck', () => {
  const profile = defaultProfile();
  profile.coins = 1000;
  profile.ownedVehicleIds.push('swift');
  profile.shipStates.swift = structuredClone(profile.shipStates.standard);
  const {scene, buttons} = shipMenuScene(profile);
  const price = GAME_BALANCE.presentation.cosmeticPriceCoins['white-blue'];
  const before = JSON.stringify(profile);
  scene.showVehicleDetail('swift');
  buttons.find(button => button.label === `BUY COLOR  •  ${price} COINS`).action();
  assert.equal(scene.phase, 'trimPurchaseConfirm');
  assert.equal(JSON.stringify(scene.profile), before, 'selecting an unowned color only opens confirmation');
  scene.footerActions[1].onClick();
  assert.equal(scene.phase, 'vehicleDetail');
  assert.equal(scene.menuScrollKey, 'vehicle-detail:swift');
  scene.showTrimPurchaseConfirm('swift', 'white-blue');
  const confirm = scene.footerActions[0].onClick;
  scene.showVehicleDetail = (id, message, isError) => { scene.feedback = {id, message, isError}; };
  try {
    storageAvailable = false;
    confirm();
    assert.equal(JSON.stringify(scene.profile), before);
    assert.equal(scene.feedback.id, 'swift');
    assert.equal(scene.feedback.isError, true);
    storageAvailable = true;
    confirm();
    assert.equal(scene.profile.coins, profile.coins - price);
    assert.ok(scene.profile.shipStates.swift.ownedColorIds.includes('white-blue'));
    assert.deepEqual(scene.profile.shipStates.standard, profile.shipStates.standard);
    assert.equal(scene.profile.shipStates.swift.equippedColorId, 'default', 'purchase does not auto-equip');
    assert.equal(scene.profile.selectedVehicleId, 'standard');
    assert.equal(scene.feedback.id, 'swift');
    assert.equal(scene.feedback.isError, false);
    const afterPurchase = JSON.stringify(scene.profile);
    confirm();
    assert.equal(JSON.stringify(scene.profile), afterPurchase, 'repeat confirmation cannot charge again');
    assert.equal(scene.feedback.isError, true);

    buttons.length = 0;
    Scene.prototype.showVehicleDetail.call(scene, 'swift');
    const equip = buttons.find(button => button.label === 'EQUIP COLOR');
    storageAvailable = false;
    equip.action();
    assert.equal(JSON.stringify(scene.profile), afterPurchase, 'failed equip cannot apply color');
    storageAvailable = true;
    equip.action();
    assert.equal(scene.profile.shipStates.swift.equippedColorId, 'white-blue');
    assert.equal(scene.profile.selectedVehicleId, 'standard');
    assert.equal(scene.profile.coins, profile.coins - price);
    assert.equal(savedProfile.shipStates.swift.equippedColorId, 'white-blue');
    buttons.length = 0;
    Scene.prototype.showVehicleDetail.call(scene, 'swift');
    buttons[0].action();
    assert.equal(scene.profile.shipStates.swift.equippedColorId, 'default', 'included default can be reselected');
    assert.equal(scene.feedback.id, 'swift');
  } finally {
    storageAvailable = true;
  }
});

test('menu descriptions and image-card columns stay centered within their padded bounds without changing saves', () => {
  const scene = new Scene();
  scene.profile = {...defaultProfile(), coins: 1000};
  scene.profile.levelProgress.level1.completed = true;
  scene.overlayObjects = [];
  scene.setWorldVisible = () => {};
  scene.panel = () => {};
  scene.createMenuScroll = () => {};
  scene.finishMenuScroll = () => {};
  scene.addFooterActions = () => {};
  scene.addCurrency = () => {};
  scene.withMenuScrollItem = (_y, _height, render) => render();
  scene.bindTilePress = () => {};
  const labels = [];
  const image = () => ({
    width: 160, height: 200,
    setScale() { return this; }, setTint() { return this; },
    setDisplaySize() { return this; }, setDepth() { return this; }, setAlpha() { return this; },
  });
  scene.add = {
    image,
    rectangle: image,
    text(x, y, text, style) {
      const label = {x, y, text, style, width: text.length * 6, height: 24,
        setScale() { return this; },
        setOrigin(x, y = x) { this.originX = x; this.originY = y; return this; },
        setDepth() { return this; }, setLineSpacing() { return this; },
        setY(y) { this.y = y; return this; },
      };
      labels.push(label);
      return label;
    },
  };
  const before = JSON.stringify(scene.profile);
  for (const render of [
    () => scene.showHowToPlay(),
    () => scene.showContinuousConfirm(),
    () => scene.showUpgradeDetail('capacity'),
    () => scene.showUpgradeDetail('module', 'cargo_light'),
    () => scene.showUpgradePurchaseConfirm('capacity', 'standard'),
    () => scene.showTrimPurchaseConfirm('standard', 'black-red'),
  ]) {
    labels.length = 0;
    render();
    assert.ok(labels.length > 0);
    for (const label of labels) {
      assert.equal(label.x, 195, label.text);
      assert.equal(label.originX, 0.5, label.text);
      assert.equal(label.style.align, 'center', label.text);
    }
  }
  for (const item of [{kind: 'capacity'}, {kind: 'module', id: 'def_shield'}]) {
    scene.addButton = () => {};
    labels.length = 0;
    scene.addUpgradeGridTile(item, 109, 400, 166, 'standard');
    assert.equal(labels.length, 4);
    const {paddingX} = upgradeTileContentMetrics(166, 366);
    assert.ok(labels.every(label =>
      label.x === 109 && label.originX === 0.5 &&
      label.style.align === 'center' && label.style.wordWrap.width === 166 - paddingX * 2));
  }
  assert.equal(JSON.stringify(scene.profile), before);
});

test('upgrade tiles leave internal padding around wrapped names, benefits and locked states', () => {
  const scene = new Scene();
  scene.profile = defaultProfile();
  scene.withMenuScrollItem = (_y, _height, render) => render();
  scene.trackOverlayObject = object => object;
  scene.bindTilePress = () => {};
  scene.addButton = () => {};
  const labels = [];
  const object = (x, y) => ({
    x, y, width: 160, height: 200,
    setScale(scale) { this.scale = scale; return this; }, setTint() { return this; },
    setDisplaySize() { return this; }, setDepth() { return this; }, setAlpha() { return this; },
    setOrigin(x, y = x) { this.originX = x; this.originY = y; return this; },
  });
  scene.add = {
    image: object, rectangle: object,
    text(x, y, text, style) {
      const size = Number.parseFloat(style.fontSize);
      const width = style.wordWrap?.width ?? 157;
      const lines = style.wordWrap.callback ? style.wordWrap.callback(text) : text.split('\n').flatMap(line => {
        const wrapped = [''];
        for (const word of line.split(' ')) {
          const current = wrapped.at(-1);
          if (current && `${current} ${word}`.length * size * 0.6 > width) wrapped.push(word);
          else wrapped[wrapped.length - 1] = current ? `${current} ${word}` : word;
        }
        return wrapped;
      });
      const label = {...object(x, y), text, height: lines.length * size * 1.2,
        width: Math.max(...lines.map(line => line.length * size * 0.6))};
      labels.push(label);
      return label;
    },
  };
  for (const capacityRank of [0, 8]) {
    scene.profile.cargoCapacityRank = capacityRank;
    for (const item of [
      {kind: 'capacity'}, ...Object.keys(scene.profile.ownedModules).map(id => ({kind: 'module', id})),
      {kind: 'module', id: 'coll_magnet'}, {kind: 'module', id: 'cargo_light'},
      {kind: 'module', id: 'def_plating'}, {kind: 'module', id: 'util_insurance'},
      {kind: 'module', id: 'def_shield'}, {kind: 'module', id: 'util_impact_pulse'},
    ]) {
      labels.length = 0;
      const height = 231;
      scene.addUpgradeGridTile(item, 110.5, 400, 157, 'standard', height);
      const tile = {x: 110.5, y: 400, width: 157, height};
      const content = upgradeTileContentMetrics(tile.width, tile.height);
      assert.equal(labels[0].originX, 0.5);
      assert.equal(labels[0].originY, 0.5);
      assert.equal(labels[0].y, tile.y - tile.height / 2 + content.titleY,
        'title is vertically centered within its padded card row');
      let previousBottom;
      for (const label of labels) {
        const displayHeight = label.height * label.scale;
        const top = label.y - displayHeight * label.originY;
        const bottom = top + displayHeight;
        assert.ok(top >= tile.y - tile.height / 2 + content.paddingY - 1e-8,
          `${label.text}: top=${top}, padding=${tile.y - tile.height / 2 + content.paddingY}`);
        assert.ok(bottom <= tile.y + tile.height / 2 - content.paddingY + 1e-8, label.text);
        assert.ok(label.width * label.scale <= tile.width - content.paddingX * 2 + 1e-8, label.text);
        assert.equal(label.x, tile.x, 'text shares the upgrade image and container center line');
        if (previousBottom) assert.ok(top >= previousBottom + content.gap - 1e-8, label.text);
        previousBottom = bottom;
      }
    }
  }
});

test('popup stat rows center labels and values in separate bounded columns', () => {
  const scene = new Scene();
  const columns = [];
  scene.addLabel = (text, x, y, size, color, width) => {
    const node = {text, x, y, width, height: 20,
      setOrigin(origin) { this.originX = origin; this.originY = origin; return this; }};
    columns.push(node);
    return node;
  };
  scene.addCurrency = (value, x, y, options) => {
    columns.push({value, x, ...options});
    return {height: 18};
  };
  assert.equal(scene.addStatRow('Accumulated Bonus', '+40%', 292).height, 20);
  assert.deepEqual(columns.map(({x, width}) => [x, width]), [[134, 172], [291, 100]]);
  assert.ok(columns.every(column => column.y === 292 && column.originX === 0.5 && column.originY === 0.5));
  columns.length = 0;
  scene.addStatRow('Bank now', 1234567, 358, {coin: true});
  assert.equal(columns[1].x, 291);
  assert.equal(columns[1].maxWidth, 100);
  assert.equal(columns[1].align, undefined, 'currency uses its default centered group alignment');
});

test('menu button title and subtitle blocks are centered together; coin-image labels keep a centered joint group', () => {
  const {scene, labels} = shipMenuScene(defaultProfile());
  scene.addButton = Scene.prototype.addButton;
  scene.addButton('ENDLESS RUN', 400, () => {}, {width: 294, height: 54,
    subtitle: 'Cash out at a Depot or keep driving'});
  const [title, subtitle] = labels;
  assert.ok(labels.every(text => text.x === 195 && text.originX === 0.5 && text.style.align === 'center'));
  const top = title.y - title.displayHeight / 2;
  const bottom = subtitle.y + subtitle.displayHeight / 2;
  assert.ok(Math.abs((top + bottom) / 2 - 400) < 1e-9);
  assert.ok(top >= 400 - 27 && bottom <= 400 + 27, 'both lines fit inside the button');
  assert.ok(Math.abs(subtitle.y - subtitle.displayHeight / 2 -
    (title.y + title.displayHeight / 2) - 4) < 1e-9);

  labels.length = 0;
  let price;
  scene.addCurrency = (coins, x, y) => {
    price = {coins, x, y, displayWidth: 54};
    return price;
  };
  scene.addButton('REPAIR', 500, () => {}, {coins: 50});
  const label = labels[0];
  const groupLeft = label.x - label.width / 2;
  const groupRight = price.x + price.displayWidth / 2;
  assert.equal((groupLeft + groupRight) / 2, 195);
  assert.equal(price.y, label.y);
  assert.equal(price.coins, 50);
});

test('menu labels and button copy stay inside measured width and height bounds', () => {
  const {scene, labels} = shipMenuScene(defaultProfile());
  scene.addLabel = Scene.prototype.addLabel;
  const note = scene.addLabel('A deliberately long maintenance notice that cannot escape its measured text width.',
    195, 220, 14, '#ffffff', 92);
  assert.ok(note.width * note.scale <= 92 + 1e-9);

  scene.addButton = Scene.prototype.addButton;
  scene.addButton('END RUN\nINCLUDING\nUNBANKED\nBONUSES\nAND CARGO\nVALUE', 400, () => {},
    {width: 174, height: 48, size: 16});
  const buttonText = labels.at(-1);
  assert.ok(buttonText.width * buttonText.scale <= 174 - MENU_SPACING.padding * 2 + 1e-9);
  assert.ok(buttonText.displayHeight <= 48 - 12 + 1e-9,
    'long confirmation labels are scaled to the control height using measured text bounds');
});

test('menu tiles vertically center complete title description and state stacks within their container', () => {
  const {scene, labels} = shipMenuScene(defaultProfile());
  scene.addMenuTile = Scene.prototype.addMenuTile;
  scene.addMenuTile('TITLE', 'Description', 'LOCKED', 400, () => {}, {width: 294, height: 66});
  assert.equal(labels.length, 3);
  const top = labels[0].y;
  const bottom = labels[2].y + labels[2].displayHeight;
  assert.ok(Math.abs((top + bottom) / 2 - 400) < 1e-9);
  assert.ok(top >= 400 - 33 + 16 && bottom <= 400 + 33 - 16);
  assert.ok(labels.every(text => text.x === 195 && text.originX === 0.5 && text.style.align === 'center'));
  for (let index = 1; index < labels.length; index++) {
    assert.ok(labels[index].y >= labels[index - 1].y + labels[index - 1].displayHeight);
  }
});

test('Garage truck cards center text and stat bars in their columns while preserving side-by-side previews and saves', () => {
  const profile = defaultProfile();
  const before = JSON.stringify(profile);
  const {scene, labels, cards} = shipMenuScene(profile);
  scene.showGarage('', false, 'garage');
  for (const card of cards.filter(card => card.height > 100)) {
    const text = card.objects.filter(object => object.text);
    assert.ok(text.length > 0);
    assert.ok(text.every(label => label.x === 121 && label.originX === 0.5 && label.style.align === 'center'));
    const preview = card.objects.find(object => object.key?.startsWith('garage_') && object.key.endsWith('_display'));
    assert.equal(preview.x, 273);
    for (const bar of card.objects.filter(object => object.height === 7 && object.width === 122)) {
      assert.equal(bar.x + bar.width / 2, 121);
    }
  }
  labels.length = 0;
  scene.showVehicleDetail('standard');
  const detail = cards.findLast(card => card.height === 278);
  for (const text of detail.objects.filter(object => object.text && object.style.wordWrap.width === 146)) {
    assert.equal(text.x, 121);
    assert.equal(text.originX, 0.5);
  }
  scene.addTruckColorCard('standard', 'default', 500);
  const color = cards.at(-1);
  assert.ok(color.objects.some(object => object.text === 'DEFAULT COLOR' && object.x === 236));
  assert.equal(JSON.stringify(profile), before);
});

test('run menu Endless entry keeps one readable rules screen and returns to the main menu', () => {
  const scene = depotScene();
  scene.add = {image(x, y, key) { return {x, y, key, width: 295, height: 172,
    setDepth() { return this; }, setScale(scale) { this.scale = scale; return this; }}; }};
  scene.profile.levelProgress.level1.completed = true;
  const buttons = [];
  const labels = [];
  scene.addButton = (label, y, action, options = {}) => buttons.push({label, y, action, ...options});
  scene.addLabel = text => {
    labels.push(text);
    return {setOrigin() { return this; }, setAlign() { return this; }, setLineSpacing() { return this; }};
  };
  scene.showMenu();
  buttons.find(button => button.label === 'ENDLESS RUN').action();
  assert.equal(scene.phase, 'continuousConfirm');
  const explanation = labels.find(text => text.includes('Cargo is worth much more.'));
  assert.ok(explanation);
  assert.ok(explanation.includes('\n\n'), 'Endless rules are separated into readable paragraphs');
  assert.ok(!explanation.includes('\\n'), 'literal escape sequences are not shown to players');
  assert.ok(explanation.includes('You cannot bank and continue.'));
  assert.ok(explanation.includes('Every Depot you pass adds a cargo bonus.'));
  assert.ok(explanation.includes('The farther you go, the harder it gets.'));
  assert.ok(explanation.endsWith('How much will you risk?'));
  assert.ok(!/\d|px\/s|Industrial|Dustlands|Gridway/.test(explanation),
    'the entry screen describes the stakes, not technical tuning or the route schedule');
  assert.equal(explanation.split('\n\n').length, 5);
  assert.ok(buttons.some(button => button.label === 'BACK'));
  let selection;
  scene.startRun = (...args) => { selection = args; };
  buttons.find(button => button.label === 'START ENDLESS').action();
  assert.deepEqual(selection, ['beginning', 'level1', 'continuous']);
  buttons.find(button => button.label === 'BACK').action();
  assert.equal(scene.phase, 'menu');
});

test('run menu level start tabs show implemented levels in order with per-level gates', () => {
  for (const level2Unlocked of [false, true]) for (const level1Checkpoint of [false, true])
    for (const level2Checkpoint of [false, true]) for (const level3Unlocked of [false, true])
      for (const level3Checkpoint of [false, true]) for (const level4Unlocked of [false, true])
        for (const level4Checkpoint of [false, true]) {
      const scene = depotScene();
      scene.profile.levelProgress.level2.unlocked = level2Unlocked;
      scene.profile.levelProgress.level1.sector3CheckpointUnlocked = level1Checkpoint;
      scene.profile.levelProgress.level2.sector3CheckpointUnlocked = level2Checkpoint;
      scene.profile.levelProgress.level3.unlocked = level3Unlocked;
      scene.profile.levelProgress.level3.sector3CheckpointUnlocked = level3Checkpoint;
      scene.profile.completedLevels = level4Unlocked ? ['level3'] : [];
      if (level4Checkpoint) scene.profile.milestones.push('level4,sector3');
      const buttons = [], labels = [], starts = [];
      scene.addButton = (label, y, action, options = {}) => buttons.push({label, y, action, ...options});
      scene.addLabel = text => { labels.push(text); return {height: 20}; };
      scene.startRun = (...args) => starts.push(args);
      const before = JSON.stringify(scene.profile);
      scene.showLevelSelect();
      assert.equal(scene.phase, 'levelSelect');
      assert.ok(!buttons.some(button => /OVERDRIVE|CONTINUOUS|ENDLESS|NORMAL RUN/.test(button.label)));
      const tabs = buttons.filter(button => button.label !== 'RETURN TO MENU');
      assert.equal(tabs.length, 8);
      assert.equal(tabs[0].disabled, false);
      assert.equal(tabs[1].disabled, !level1Checkpoint);
      assert.equal(tabs[2].disabled, !level2Unlocked);
      assert.equal(tabs[3].disabled, !(level2Unlocked && level2Checkpoint));
      assert.equal(tabs[4].disabled, !level3Unlocked);
      assert.equal(tabs[5].disabled, !(level3Unlocked && level3Checkpoint));
      assert.equal(tabs[6].disabled, !level4Unlocked);
      assert.equal(tabs[7].disabled, !(level4Unlocked && level4Checkpoint));
      for (let index = 0; index < tabs.length; index++) {
        const tab = tabs[index];
        if (tab.disabled) {
          assert.equal(tab.fill, PALETTE.steelDark, 'locked starts use grey steel');
          continue;
        }
        tab.action();
        assert.deepEqual(starts.at(-1), [index % 2 ? 'checkpoint' : 'beginning',
          index < 2 ? 'level1' : index < 4 ? 'level2' : index < 6 ? 'level3' : 'level4', 'normal']);
      }
      assert.ok(labels.includes('Level 3: Reactor Zone'));
      assert.ok(labels.includes('Level 4: Neon Gridway'));
      assert.deepEqual(labels.filter(label => /^LEVEL [3-5]$/.test(label)), ['LEVEL 5']);
      assert.equal(labels.filter(label => label === 'COMING SOON').length, 1);
      assert.equal(labels.includes('Complete Level 3 to unlock Level 4.'), !level4Unlocked);
      assert.equal(JSON.stringify(scene.profile), before);
      assert.equal(typeof scene.showModeSelect, 'undefined');
      assert.equal(typeof scene.showNormalStartSelect, 'undefined');
      assert.equal(typeof scene.showNormalRunConfirm, 'undefined');
    }
});

test('run menu results return Normal Run to level cards and Endless Run to its single rules screen', () => {
  for (const mode of ['normal', 'continuous']) {
    const scene = depotScene();
    scene.profile.levelProgress.level1.completed = true;
    scene.startRun('beginning', 'level1', mode);
    const buttons = [];
    scene.addButton = (label, y, action) => buttons.push({label, action});
    scene.finishRun(false);
    let destination;
    scene.showLevelSelect = () => { destination = 'levels'; };
    scene.showContinuousConfirm = () => { destination = 'endless-rules'; };
    buttons.find(button => button.label === 'RUN AGAIN').action();
    assert.equal(destination, mode === 'normal' ? 'levels' : 'endless-rules');
  }
});

test('run music selects the preloaded track for Normal and Endless', () => {
  for (const mode of ['normal', 'continuous']) {
    const scene = depotScene();
    scene.profile.levelProgress.level1.completed = true;
    const normal = {id: 'normal'}, endless = {id: 'endless'};
    scene.cache = {audio: {get: key => ({
      cargo_run_music: normal, cargo_endless_music: endless,
    })[key]}};
    const calls = [];
    scene.feedback = {startRunMusic: (...args) => calls.push(args), resetRun() {}};
    scene.startRun('beginning', 'level1', mode);
    assert.deepEqual(calls, [[true, mode === 'continuous' ? endless : normal]]);
  }
});

test('route init continuous cycles four stages, raises speed each 1000 m and places Depots each 2000 m', () => {
  const scene = depotScene();
  scene.profile.levelProgress.level1.completed = true;
  const profileBefore = JSON.stringify(scene.profile);
  scene.startRun('beginning', 'level1', 'continuous');
  assert.equal(scene.distance, 0);
  assert.equal(scene.startDistance, 0);
  assert.equal(scene.runEconomy.mode, 'continuous');
  assert.equal(scene.runEconomy.fullStart, false);
  assert.equal(scene.currentSector, sectorAtDistance(0, 'level1', 'continuous'));
  assert.equal(scene.currentSector.challengeProfileId, 'industrial');
  const lighting = lightingForSector(scene.currentSector, 0, 4000, 'continuous');
  assert.equal(lighting.name, 'MID-DAY TRANSIT');
  assert.equal(lighting.headlights, false);
  assert.equal(scene.nextDepotDistance, 2000);
  for (let milestone = 0; milestone <= 20; milestone++) {
    const at = milestone * 1000;
    assert.equal(routeSpeedAtDistance(at, 'level1', 'continuous'), Math.min(620, 460 + milestone * 20));
    assert.equal(nextDepotAfter(at, DEPOT_RULES, 'level1', 'continuous').distance,
      (Math.floor(at / 2000) + 1) * 2000);
    if (at) assert.equal(routeSpeedAtDistance(at - 0.001, 'level1', 'continuous'),
      Math.min(620, 460 + Math.floor((at - 0.001) / 1000) * 20));
  }
  assert.ok(Math.abs(routeTimeAtDistance(1500, 'level1', 'continuous') -
    (1000 / (460 * METERS_PER_PIXEL) + 500 / (480 * METERS_PER_PIXEL))) < 1e-8);
  assert.equal(lightingForSector(sectorAtDistance(4000, 'level1', 'continuous'), 4000, 0, 'continuous').name,
    'DUSK TRANSIT');
  assert.equal(lightingForSector(sectorAtDistance(6000, 'level1', 'continuous'), 6000, 0, 'continuous').name,
    'DUSK TRANSIT');
  scene.distance = 12000;
  scene.recordMilestones();
  assert.equal(JSON.stringify(scene.profile), profileBefore);
  assert.throws(() => routeSpeedAtDistance(0, 'level1', 'overdrive'), /Unknown route mode/);
  assert.throws(() => routeTimeAtDistance(0, 'level2', 'continuous'), /global/);
});

test('continuous cash-out ends the run and failed wallet writes preserve the hold for one safe retry', () => {
  const scene = depotScene();
  scene.profile.levelProgress.level1.completed = true;
  scene.startRun('beginning', 'level1', 'continuous');
  loadCargo(scene, 103);
  scene.distance = scene.nextDepotDistance;
  scene.showDepot();
  const buttons = [];
  scene.addButton = (label, y, action) => buttons.push({label, action});
  scene.renderContinuousDepot();
  assert.ok(buttons.some(button => button.label === 'CASH OUT & END RUN'));
  assert.ok(!buttons.some(button => /BANK.*CONTINUE|REPAIR/i.test(button.label)));
  const wallet = scene.profile.coins;
  const cargo = scene.cargoItems;
  storageAvailable = false;
  try {
    scene.finishRun(true);
    assert.equal(scene.phase, 'depot');
    assert.equal(scene.profile.coins, wallet);
    assert.equal(scene.cargoItems, cargo);
    assert.equal(scene.runResult, null);
  } finally { storageAvailable = true; }
  scene.finishRun(true);
  assert.equal(scene.phase, 'result');
  assert.equal(scene.profile.coins, wallet + 103);
  assert.equal(scene.cargoItems.length, 0);
  scene.finishRun(true);
  assert.equal(scene.profile.coins, wallet + 103);
});

test('continuous crash failed wallet writes preserve the run and never pay unbanked cargo', () => {
  const scene = depotScene();
  scene.profile.levelProgress.level1.completed = true;
  scene.startRun('beginning', 'level1', 'continuous');
  loadCargo(scene, 103);
  scene.runEconomy = passContinuousDepot(scene.runEconomy);
  const wallet = scene.profile.coins;
  const cargo = scene.cargoItems;
  storageAvailable = false;
  try {
    scene.finishRun(false);
    assert.equal(scene.phase, 'crashing');
    assert.equal(scene.profile.coins, wallet);
    assert.equal(scene.cargoItems, cargo);
  } finally { storageAvailable = true; }
  scene.finishRun(false);
  assert.equal(scene.phase, 'result');
  assert.equal(scene.profile.coins, wallet);
  assert.equal(scene.runResult.bonusCoins, 0);
  assert.equal(scene.runResult.distanceCoins, 0);
  scene.finishRun(false);
  assert.equal(scene.profile.coins, wallet);
});

test('passing a bay never pauses, banks, recenters or grants the first-bank milestone', () => {
  const scene = depotScene();
  const firstDepot = scene.nextDepotDistance;
  scene.distance = firstDepot;
  loadCargo(scene, 55);
  scene.recordMilestones();
  scene.updateDepot();
  assert.equal(scene.phase, 'running');
  scene.ship.x = scene.shipTargetX = 110;
  scene.updateDepot();
  assert.equal(scene.phase, 'running', 'driving outside the green entrance bypasses the Depot');
  const trackStream = scene.trackStream;
  scene.spawnTimer = 0.17;
  scene.distance = firstDepot + DEPOT_RULES.triggerHalfMeters + 1;
  scene.updateDepot();
  assert.equal(scene.phase, 'running');
  assert.equal(scene.ship.x, 110);
  assert.equal(scene.cargoValue, 55);
  assert.equal(scene.profile.coins, 0);
  assert.ok(!scene.profile.milestones.includes('level1,depot1'));
  assert.equal(scene.nextDepotDistance, GAME_BALANCE.routes.level1.sectorStartsMeters[2]);
  assert.equal(scene.trackStream, trackStream, 'bypass preserves the emitted stream');
  assert.equal(scene.spawnTimer, 0.17);
  scene.finishRun(false);
  assert.ok(!normalizeProfile(savedProfile).milestones.includes('level1,depot1'), 'a later crash/best-distance save is not a bank');
});

test('continuous physical bypass and stopped Pass Depot award the same capped bonus exactly once', () => {
  for (const levelId of ['level1']) {
    const bypass = depotScene();
    const stopped = depotScene();
    for (const scene of [bypass, stopped]) {
      scene.profile.levelProgress[levelId].unlocked = true;
      scene.profile.levelProgress[levelId].completed = true;
      scene.startRun('beginning', levelId, 'continuous');
      loadCargo(scene, 100);
      scene.showToast = message => { scene.lastBonusToast = message; };
      scene.profile.seenHints = Object.keys(HINTS);
    }
    const profileBefore = JSON.stringify(bypass.profile);
    const items = bypass.cargoItems;
    const stream = bypass.trackStream;
    const spawnTimer = bypass.spawnTimer;
    for (let count = 1; count <= 12; count++) {
      const depotDistance = bypass.nextDepotDistance;
      bypass.ship.x = bypass.shipTargetX = 195;
      bypass.distance = depotDistance - 0.01;
      bypass.updateDepot();
      assert.equal(bypass.runEconomy.continuousPassedDepots, count - 1, 'not yet across the threshold');
      bypass.distance += 0.01;
      bypass.updateDepot();
      bypass.updateDepot();
      assert.equal(bypass.phase, 'running');
      assert.equal(bypass.runEconomy.continuousPassedDepots, count);
      assert.equal(bypass.runEconomy.depotsReached, count);
      assert.equal(bypass.runEconomy.depotsSkipped, count);
      assert.equal(bypass.runEconomy.consecutiveSkips, 0, 'not Normal-mode risk accounting');
      assert.equal(bypass.ship.x, 195, 'bypass never recenters the vehicle');
      assert.equal(bypass.trackStream, stream);
      assert.equal(bypass.spawnTimer, spawnTimer);
      assert.equal(bypass.cargoItems, items);
      assert.ok(bypass.nextDepotDistance > depotDistance);

      stopped.distance = stopped.nextDepotDistance;
      stopped.showDepot();
      assert.equal(stopped.runEconomy.continuousPassedDepots, count - 1, 'stopping alone gives no bonus');
      stopped.resumeAfterDepot();
      stopped.resumeAfterDepot();
      stopped.updateDepot();
      assert.equal(stopped.runEconomy.continuousPassedDepots, count);
      assert.equal(stopped.runEconomy.depotsSkipped, count);
      assert.equal(stopped.runEconomy.depotsReached, count);
      assert.deepEqual(continuousQuote(bypass.cargoItems, bypass.runEconomy),
        continuousQuote(stopped.cargoItems, stopped.runEconomy));
      assert.equal(continuousQuote(bypass.cargoItems, bypass.runEconomy).percent, Math.min(100, count * 10));
      assert.equal(bypass.lastBonusToast, `DEPOT PASSED\nCargo bonus: +${Math.min(100, count * 10)}% (max 100%).`);
      assert.equal(stopped.lastBonusToast, bypass.lastBonusToast);
    }
    assert.equal(JSON.stringify(bypass.profile), profileBefore, 'no wallet, milestone or save writes on bypass');
    assert.equal(continuousQuote(bypass.cargoItems, bypass.runEconomy).payout, 200);
  }
});

test('only the indicated Depot bay registers with at least 50 percent cab overlap, without a full-side steering target', () => {
  for (const [distance, x] of GAME_BALANCE.routes.level1.sectorEndsMeters.slice(0, 2)
    .map((distance, i) => [distance, i === 0 ? 97 : 293])) {
    const scene = depotScene();
    scene.nextDepot = nextDepotAfter(distance - 1);
    scene.nextDepotDistance = distance;
    scene.distance = distance;
    scene.ship.x = x;
    scene.shipTargetX = 195;
    scene.updateDepot();
    assert.equal(scene.phase, 'docking');
    finishDocking(scene);
    assert.equal(scene.depotCount, 1);
    assert.equal(scene.profile.coins, 0);
    const bypass = depotScene();
    bypass.nextDepot = scene.nextDepot;
    bypass.nextDepotDistance = distance;
    bypass.distance = distance;
    bypass.ship.x = 390 - x;
    bypass.updateDepot();
    assert.equal(bypass.phase, 'running', 'opposite outer lane is now an express bypass');
    const partial = depotScene();
    partial.nextDepot = scene.nextDepot;
    partial.nextDepotDistance = distance;
    partial.distance = distance;
    partial.ship.x = x + (x < 195 ? 0.001 : -0.001);
    partial.updateDepot();
    assert.equal(partial.phase, 'running', 'less than half the cab inside the canopy cannot dock');
  }
});

test('developer sector launches bypass access without changing checkpoint or reward progression', () => {
  const scene = depotScene();
  scene.startRun('developer', 'level2', 'normal', {
    sectorNumber: 4, vehicleId: 'standard',
  });
  assert.equal(scene.developerRun, true);
  assert.equal(scene.runEconomy.developerRun, true);
  assert.equal(scene.startDistance, GAME_BALANCE.routes.level2.sectorStartsMeters[3]);
  scene.distance = GAME_BALANCE.routes.level2.sectorStartsMeters[3] + 20;
  scene.recordMilestones();
  assert.equal(scene.profile.levelProgress.level2.sector3CheckpointUnlocked, false);
});

test('developer level choices scroll above a separate fixed Back button at phone sizes', () => {
  for (const [width, height] of [[320, 480], [320, 568], [360, 640], [390, 844]]) {
    const scene = depotScene();
    scene.menuHeight = responsiveViewport(width, height, 390).worldHeight;
    scene.setScreenRenderer = () => {};
    const buttons = [];
    let scrollViewport;
    scene.createMenuScroll = (_key, top, bottom) => { scrollViewport = {top, bottom}; };
    scene.addButton = (label, y, action, options = {}) =>
      buttons.push({label, y, action, height: options.height ?? 54});

    scene.showDeveloperLevelSelect();

    const levelButtons = buttons.filter(button => button.label !== 'BACK');
    const back = buttons.find(button => button.label === 'BACK');
    assert.equal(levelButtons.length, GAME_BALANCE.progression.levelIds.length);
    assert.ok(back);
    for (const button of levelButtons) {
      assert.ok(button.y + button.height / 2 <= scrollViewport.bottom + 66,
        `${width}x${height}: each level remains reachable within the scroller`);
      assert.ok(button.y + button.height / 2 < back.y - back.height / 2,
        `${width}x${height}: ${button.label} does not overlap Back`);
    }
    assert.ok(back.y + back.height / 2 <= scene.menuHeight - 32);
    assert.ok(back.y - back.height / 2 - scrollViewport.bottom >= MENU_SPACING.padding - 1e-9);
    assert.equal(typeof buttons.find(button => button.label.includes('Level 4'))?.action, 'function');
  }
});

test('seven taps on the build label within five seconds reveal the hidden developer menu', () => {
  const scene = depotScene();
  let menuOpened = 0;
  scene.showDeveloperMenu = () => { menuOpened += 1; };
  scene.time = {now: 0};
  for (let tap = 0; tap < 7; tap++) {
    scene.time.now = tap * 700;
    scene.registerDeveloperTap();
  }
  assert.equal(menuOpened, 1);
  assert.equal(scene.developerTapCount, 0);
});

test('developer God Mode toggles without saving and marks protected runs ineligible for rewards or records', () => {
  const scene = depotScene();
  scene.debugManager = new DebugManager('');
  const before = JSON.stringify(scene.profile);
  const buttons = [];
  scene.addButton = (label, y, action, options) => buttons.push({label, y, action, ...options});
  scene.showDeveloperMenu();
  buttons.find(button => button.label === 'GOD MODE: OFF').action();
  assert.equal(scene.godMode, true);
  assert.equal(JSON.stringify(scene.profile), before);
  scene.startRun();
  assert.equal(isDeveloperRun(scene.runEconomy), true);
  const result = settleRun(scene.profile, scene.runEconomy, [], 99999, false);
  assert.equal(JSON.stringify(result.profile), before);
  scene.showDeveloperMenu();
  buttons.filter(button => button.label === 'GOD MODE: ON').at(-1).action();
  assert.equal(scene.godMode, false);
  scene.startRun();
  assert.equal(isDeveloperRun(scene.runEconomy), false);
});

test('developer Coin adjustment requires confirmation and leaves the profile unchanged on save failure', () => {
  const scene = depotScene();
  const buttons = [];
  scene.addButton = (label, _y, action) => buttons.push({label, action});
  scene.confirmDeveloperCoinAdjustment(100);
  assert.equal(scene.profile.coins, 0);
  buttons.find(button => button.label === 'CONFIRM CHANGE').action();
  assert.equal(scene.profile.coins, 100);
  assert.equal(savedProfile.coins, 100);

  storageAvailable = false;
  buttons.length = 0;
  scene.addButton = (label, _y, action) => buttons.push({label, action});
  scene.confirmDeveloperCoinAdjustment(-50);
  buttons.find(button => button.label === 'CONFIRM CHANGE').action();
  assert.equal(scene.profile.coins, 100);
  storageAvailable = true;
});

test('Sector 2 crossing saves the Sector 3 checkpoint and checkpoint starts reset run resources', () => {
  const scene = depotScene();
  scene.distance = GAME_BALANCE.routes.level1.sectorStartsMeters[2];
  scene.recordMilestones();
  assert.equal(scene.profile.levelProgress.level1.sector3CheckpointUnlocked, true);
  assert.ok(savedProfile.milestones.includes('level1,sector3'));
  const buttons = [];
  const labels = [];
  scene.addButton = (label, y, action, options = {}) => buttons.push({label, action, ...options  });

  test('Level 2 stays locked until Level 1 completion and owns its separate Sector 3 checkpoint', () => {
    const scene = depotScene();
    scene.startRun('beginning', 'level2');
    assert.equal(scene.runEconomy.levelId, 'level1', 'a locked Level 2 request cannot switch the active run');

    scene.profile = {
      ...scene.profile,
      levelProgress: {
        ...scene.profile.levelProgress,
        level1: {...scene.profile.levelProgress.level1, completed: true},
        level2: {...scene.profile.levelProgress.level2, unlocked: true},
      },
    };
    scene.startRun('beginning', 'level2');
    assert.equal(scene.runEconomy.levelId, 'level2');
    assert.equal(scene.currentSector.id, 'level2-sector1');
    assert.equal(scene.currentSector.themeId, 'dustlands');
    assert.equal(scene.startDistance, 0);

    scene.distance = GAME_BALANCE.routes.level2.sectorStartsMeters[2];
    scene.recordMilestones();
    assert.equal(scene.profile.levelProgress.level2.sector3CheckpointUnlocked, true);
    assert.equal(scene.profile.levelProgress.level1.sector3CheckpointUnlocked, false);
    scene.startRun('checkpoint', 'level2');
    assert.equal(scene.startDistance, GAME_BALANCE.routes.level2.sectorStartsMeters[2]);
    assert.equal(scene.runEconomy.levelId, 'level2');
    assert.equal(scene.runEconomy.fullStart, false);
  });
  scene.addLabel = label => {
    labels.push(label);
    return {height: 20, setOrigin() { return this; }, setAlign() { return this; },
      setY() { return this; },
      setLineSpacing() { return this; }};
  };
  scene.showLevelSelect();
  assert.ok(labels.some(label => label.includes('Complete Level 1 to unlock Level 2.')));
  assert.equal(buttons.find(button => button.label === 'CHECKPOINT\nSECTOR 3').disabled, false);
  buttons.find(button => button.label === 'CHECKPOINT\nSECTOR 3').action();
  assert.equal(scene.distance, GAME_BALANCE.routes.level1.sectorStartsMeters[2]);
  assert.equal(scene.currentSector.number, 3);
  assert.equal(scene.nextDepotDistance,
    nextDepotAfter(GAME_BALANCE.routes.level1.sectorStartsMeters[2], DEPOT_RULES, 'level1', 'normal').distance);
  assert.equal(scene.nextDepotDistance, GAME_BALANCE.routes.level1.sectorEndsMeters[2],
    'checkpoint start uses the next actual per-level Normal Depot');
  assert.equal(scene.hull, scene.maxHull);
  assert.equal(scene.cargoValue, 0);
  assert.equal(scene.runEconomy.consecutiveSkips, 0);
  assert.equal(scene.runEconomy.depotsReached, 0);
  assert.equal(scene.runEconomy.fullStart, false);
  assert.equal(scene.runEconomy.checkpointStart, true);
});

test('reaching the finite Level 1 finish pays rewards, unlocks Phase 3 content and does not pay twice', () => {
  const scene = depotScene();
  scene.runEconomy.fullStart = true;
  scene.distance = routeFinishDistance('level1');
  scene.runEconomy.depotsReached = 2;
  scene.runEconomy.consecutiveSkips = 1;
  loadCargo(scene, 20);
  scene.finishRun(true, true);
  assert.equal(scene.phase, 'result');
  assert.equal(scene.runResult.recordCoins, 250);
  assert.equal(scene.runResult.completionCoins, 500);
  assert.equal(scene.runResult.noDamageCoins, 12);
  assert.equal(scene.profile.levelProgress.level1.completed, true);
  assert.equal(scene.profile.levelProgress.level2.unlocked, true);
  assert.equal(scene.profile.coins, 786);
  scene.finishRun(true, true);
  assert.equal(scene.profile.coins, 786);
  assert.equal(scene.profile.totalRuns, 1);
});

test('Bank & Finish before the finish line cannot complete Level 1 or unlock Level 2', () => {
  const scene = depotScene();
  scene.distance = 450;
  scene.showDepot();
  scene.finishRun(true);
  assert.equal(scene.profile.levelProgress.level1.completed, false);
  assert.equal(scene.profile.levelProgress.level2.unlocked, false);
});

test('depot entering and continuing does not unlock; first explicit cargo bank pays and unlocks exactly once', () => {
  const scene = depotScene();
  scene.distance = scene.nextDepotDistance;
  scene.ship.x = scene.shipTargetX = 73;
  scene.updateDepot();
  finishDocking(scene);
  assert.equal(scene.depotCount, 1);
  scene.showDepot();
  assert.equal(scene.depotCount, 1);
  assert.ok(!scene.profile.milestones.includes('level1,depot1'));
  scene.resumeAfterDepot();
  assert.equal(scene.phase, 'running');
  assert.equal(scene.ship.x, 195);
  assert.ok(!scene.profile.milestones.includes('level1,depot1'));
  scene.distance = scene.nextDepotDistance;
  scene.ship.x = scene.shipTargetX = 317;
  loadCargo(scene, 55);
  scene.updateDepot();
  finishDocking(scene);
  scene.finishRun(true);
  assert.equal(scene.phase, 'result');
  assert.equal(scene.profile.coins, 99, 'stopped Skip retains risk; clean two-Depot bonus remains eligible');
  assert.ok(scene.profile.milestones.includes('level1,depot1'));
  assert.ok(savedProfile.milestones.includes('level1,depot1'));
  scene.finishRun(true);
  assert.equal(scene.profile.coins, 99);
  assert.equal(scene.profile.totalRuns, 1);
});

test('depot steering starts braking before the canopy but opens maintenance only underneath it', () => {
  const scene = depotScene();
  scene.ship.x = scene.shipTargetX = 73;
  const start = depotDockingStart(scene.nextDepot, scene.levelId, scene.runMode);
  for (const before of [75, 25, 10, 0.01]) {
    scene.distance = start - before;
    scene.updateDepot();
    assert.equal(scene.phase, 'running', `premature braking ${before} m before the braking line`);
    assert.equal(scene.depotCount, 0);
  }
  scene.distance = start;
  scene.updateDepot();
  assert.equal(scene.phase, 'docking');
  assert.equal(scene.depotCount, 0, 'no menu, bank or shield service before the stop completes');
  finishDocking(scene);
  assert.equal(scene.distance, scene.nextDepotDistance);
  assert.equal(depotWorldY(scene.nextDepot, scene.distance), scene.ship.y);
  assert.equal(scene.depotCount, 1);
});

test('depot canopy arrival persists each level checkpoint before banking and reports progress save failure', () => {
  for (const levelId of ['level1', 'level2']) for (const writable of [true, false]) {
    const scene = depotScene();
    scene.profile.levelProgress.level2.unlocked = true;
    scene.startRun('beginning', levelId, 'normal');
    const gate = checkpointDistance(levelId);
    scene.nextDepot = nextDepotAfter(gate - 1, DEPOT_RULES, levelId);
    scene.nextDepotDistance = gate;
    scene.distance = depotDockingStart(scene.nextDepot, levelId);
    scene.ship.x = scene.shipTargetX = scene.nextDepot.side === 'left' ? 73 : 317;
    const profileBefore = JSON.stringify(scene.profile);
    let warning = '';
    scene.showToast = message => { warning = message; };
    savedProfile = null;
    storageAvailable = writable;
    try {
      scene.updateDepot();
      finishDocking(scene);
      assert.equal(scene.distance, gate);
      assert.equal(scene.depotVisit.banked, false);
      assert.equal(scene.runEconomy.bankingEvents, 0);
      assert.equal(scene.profile.levelProgress[levelId].sector3CheckpointUnlocked, writable);
      if (writable) {
        assert.equal(savedProfile.levelProgress[levelId].sector3CheckpointUnlocked, true);
        assert.equal(scene.profile.coins, 0);
      } else {
        assert.equal(JSON.stringify(scene.profile), profileBefore);
        assert.equal(savedProfile, null);
        assert.match(warning, /Progress could not be saved/);
      }
    } finally {
      storageAvailable = true;
    }
  }
});

test('a failed Bank save leaves the bay open without granting coins or the milestone; retry is safe', () => {
  const scene = depotScene();
  scene.distance = scene.nextDepotDistance;
  scene.ship.x = scene.shipTargetX = 73;
  loadCargo(scene, 25);
  let error;
  scene.showToast = message => { error = message; };
  storageAvailable = false;
  try {
    scene.updateDepot();
    finishDocking(scene);
    scene.bankAtDepot();
    assert.equal(scene.phase, 'depot');
    assert.equal(scene.profile.coins, 0);
    assert.equal(scene.profile.totalRuns, 0);
    assert.ok(!scene.profile.milestones.includes('level1,depot1'));
    assert.match(error, /could not be banked/);
  } finally {
    storageAvailable = true;
  }
  scene.bankAtDepot();
  scene.finishRun(true);
  assert.equal(scene.profile.coins, 25);
  assert.ok(savedProfile.milestones.includes('level1,depot1'));
});

test('save errors take priority over onboarding and transition notices', () => {
  assert.ok(styles.error.priority > styles.hint.priority);
  assert.ok(styles.error.priority > styles.warning.priority);
});

test('clearing a route destroys roadside mounting bases along with hazards', () => {
  const scene = new Scene();
  const destroyed = [];
  scene.objects = [{sprite: {destroy: () => destroyed.push('hazard')},
    roadsideBase: {destroy: () => destroyed.push('base')}}];
  scene.removeObjects();
  assert.equal(destroyed.join(','), 'hazard,base');
  assert.equal(scene.objects.length, 0);
});

test('removing one route object destroys its attachments without removing its neighbours', () => {
  const scene = new Scene();
  const destroyed = [];
  const before = {sprite: {destroy: () => destroyed.push('before')}};
  const after = {sprite: {destroy: () => destroyed.push('after')}};
  scene.objects = [
    before,
    {
      sprite: {destroy: () => destroyed.push('sprite')},
      roadsideBase: {destroy: () => destroyed.push('base')},
      cautionLights: [0, 1].map(index => ({destroy: () => destroyed.push(`light${index}`)})),
      valueText: {destroy: () => destroyed.push('label')},
    },
    after,
  ];
  scene.removeObjectAt(1);
  assert.deepEqual(destroyed, ['sprite', 'light0', 'light1', 'base', 'label']);
  assert.deepEqual(scene.objects, [before, after]);
  scene.removeObjects();
  assert.equal(scene.objects.length, 0);
  assert.deepEqual(destroyed, ['sprite', 'light0', 'light1', 'base', 'label', 'after', 'before']);
});

test('Impact Pulse removes only obstacles intersecting the visible road, without touching pickups', () => {
  const scene = depotScene();
  const destroyed = [];
  const item = (type, kind, y) => ({type, kind, sprite: {
    y, destroy() { destroyed.push(`${type}:${kind}`); },
  }});
  const visible = item('hazard', 'divider', 300);
  const offscreen = item('hazard', 'divider', -100);
  const cargo = item('cargo', 'coin', 300);
  const blueprint = item('blueprint', 'blueprint', 300);
  scene.objects = [visible, offscreen, cargo, blueprint];
  scene.clearVisibleObstacles();
  assert.deepEqual(destroyed, ['hazard:divider']);
  assert.deepEqual(scene.objects, [offscreen, cargo, blueprint]);
});

test('scene cargo trailers use occupied load and actual chassis capacity without changing cargo totals', () => {
  const scene = new Scene();
  const node = () => ({
    setPosition(x, y) { Object.assign(this, {x, y}); return this; },
    setVisible(visible) { this.visible = visible; return this; },
    setDisplaySize() { return this; }, setScale() { return this; }, setAlpha() { return this; },
    setRotation(rotation) { this.rotation = rotation; return this; },
  });
  scene.ship = {...node(), x: 195, y: SHIP_Y, visible: true, scaleX: 1, scaleY: 1, alpha: 1};
  scene.haulerEffects = {rack: node()};
  scene.cargoIndicators = Array.from({length: 4}, node);
  scene.phase = 'running';
  scene.time = {now: 100};
  for (const capacity of [4, 7, 11, 20]) {
    scene.stats = {capacity};
    for (const load of [0, 1, capacity]) {
      scene.cargoWeight = load;
      scene.cargoSlots = load;
      scene.syncHaulerVisuals();
      assert.equal(scene.cargoIndicators.filter(t => t.visible).length, load === 0 ? 0 : load === capacity ? 4 : 1);
      assert.equal(scene.cargoWeight, load);
      assert.equal(scene.cargoSlots, load);
    }
    scene.cargoWeight = 0;
    scene.cargoSlots = capacity;
    scene.syncHaulerVisuals();
    assert.equal(scene.cargoIndicators.filter(t => t.visible).length, 4, 'slot-full also reads as full');
    scene.phase = 'garage';
    scene.syncHaulerVisuals();
    assert.ok(scene.cargoIndicators.every(t => !t.visible));
    scene.phase = 'running';
  }
});

test('blueprint spawn attaches one glow, preserves reward geometry and leaves Apex conversion unchanged', () => {
  for (const converted of [false, true]) {
    const scene = depotScene();
    scene.time = {now: 1800};
    scene.profile.milestones.push('level1,sector3');
    if (converted) scene.profile.ownedVehicleIds.push('apex');
    const reward = {id: 'visual-blueprint', lane: 2, amount: 1};
    scene.blueprintRun = {authorize: () => reward};
    const row = {hazards: [], intermediates: [], pickups: [], spacingPx: 250, safeLanes: [2]};
    scene.trackStream = {nextRow: () => row};
    const created = [], destroyed = [];
    scene.add = {
      image(x, y, key) {
        const node = {x, y, key, setDepth() { return this; },
          setBlendMode(mode) { this.blend = mode; return this; },
          setRotation(rotation) { this.rotation = rotation; return this; },
          setPosition(x, y) { Object.assign(this, {x, y}); return this; },
          setAlpha(alpha) { this.alpha = alpha; return this; },
          destroy() { destroyed.push(key); }};
        created.push(node);
        return node;
      },
      text(x, y, text) {
        return {x, y, text, setOrigin() { return this; }, setDepth() { return this; },
          destroy() { destroyed.push('label'); }};
      },
    };
    const before = JSON.stringify({row, profile: scene.profile});
    scene.spawnTrackRow();
    assert.equal(scene.objects.length, 1);
    const item = scene.objects[0];
    assert.equal(item.type, 'blueprint');
    assert.equal(item.reward, reward);
    assert.equal(item.sprite.x, LANE_CENTERS[2]);
    assert.equal(item.sprite.y, SPAWN_Y);
    assert.equal(item.sprite.key, converted ? 'cargo_coinStack' : 'cargo_blueprint');
    assert.equal(item.sprite.scaleX, SPRITE_ART_SCALE * (0.95 * 0.95));
    assert.equal(item.sprite.scaleY, SPRITE_ART_SCALE * (0.95 * 0.95));
    assert.equal(created.length, converted ? 1 : 2);
    if (converted) assert.equal(item.blueprintGlow, null);
    else {
      assert.equal(item.blueprintGlow.key, 'cargo_blueprint_glow');
      assert.equal(item.blueprintGlow.scaleX, 1.1);
      assert.equal(item.blueprintGlow.scaleY, 1.1);
      assert.equal(item.blueprintGlow.blend, 'ADD');
      assert.equal(item.blueprintGlow.x, item.sprite.x);
      assert.equal(item.blueprintGlow.y, item.sprite.y);
      assert.equal(item.sprite.rotation, 1);
      assert.equal(item.valueText.y, SPAWN_Y + 32 * SPRITE_ART_SCALE);
    }
    assert.equal(JSON.stringify({row, profile: scene.profile}), before);
    scene.removeObjects();
    assert.equal(scene.objects.length, 0);
    assert.equal(destroyed.filter(key => key === 'cargo_blueprint_glow').length, converted ? 0 : 1);
  }
});

test('spawning preserves shared lane coordinates, Alpha/Beta tags and cargo-only values', () => {
  const scene = depotScene();
  const row = {
    hazards: [{kind: 'loadingPlatform', lane: 3, offsetY: 0, placement: 'alpha'}],
    intermediates: [{kind: 'divider', lane: 1, offsetY: -100, placement: 'beta'},
      {kind: 'wreckage', lane: 0, offsetX: -6, offsetY: -187.5, placement: 'beta', filler: true}],
    pickups: [{kind: 'coin', lane: 0, mass: 1, slots: 1, value: 5}],
    spacingPx: 250,
  };
  scene.trackStream = {nextRow: () => row};
  scene.add = {
    image(x, y, texture) {
      return {x, y, texture, setDepth() { return this; }, setFlipX(value) { this.flipped = value; return this; },
        setTint(tint) { this.tint = tint; return this; },
        setPosition(x, y) { Object.assign(this, {x, y}); return this; },
        setAlpha(alpha) { this.alpha = alpha; return this; },
        setBlendMode(mode) { this.blend = mode; return this; },
        setRotation(rotation) { this.rotation = rotation; return this; },
        setOrigin(x, y) { this.originX = x; this.originY = y; return this; }};
    },
    text() { return {setOrigin() { return this; }, setDepth() { return this; }}; },
  };
  assert.equal(scene.spawnTrackRow(), 250);
  assert.equal(scene.objects.length, 4);
  const [alpha, beta, filler, cargo] = scene.objects;
  assert.equal(alpha.placement, 'alpha');
  assert.equal(alpha.sprite.flipped, true);
  assert.equal(alpha.roadsideBase, undefined, 'modular tile shadows live inside the atomic guardrail');
  assert.equal(alpha.sprite.x, hazardX(row.hazards[0]));
  assert.equal(beta.placement, 'beta');
  assert.equal(beta.kind, 'divider');
  assert.equal(beta.sprite.x, LANE_CENTERS[1]);
  assert.equal(filler.type, 'hazard', 'small fillers remain real crash-capable hazards, not scenery or cargo');
  assert.equal(filler.kind, 'wreckage');
  assert.equal(filler.placement, 'beta');
  assert.equal(filler.sprite.x, LANE_CENTERS[0] - 6);
  assert.equal(filler.sprite.texture, hazardTexture('wreckage', sectorAtDistance(scene.distance)));
  assert.equal(filler.sprite.y, SPAWN_Y - 187.5);
  for (const hazard of [alpha, beta, filler]) {
    assert.ok(!('mass' in hazard));
    assert.ok(!('value' in hazard));
  }
  assert.equal(cargo.sprite.x, LANE_CENTERS[0]);
  assert.equal(cargo.value, 5);
  assert.equal(cargo.mass, 1);
  assert.equal(cargo.slots, 1);
  for (const [kind, value, texture] of [['coin', 5, 'cargo_pickup_small'],
    ['coinStack', 5, 'cargo_pickup_small'], ['freight', 5, 'cargo_pickup_small'],
    ['coinStack', 10, 'cargo_pickup_med'], ['freight', 20, 'cargo_pickup_lg'],
    ['coinStack', 25, 'cargo_pickup_xl'], ['freight', 30, 'cargo_pickup_xl']]) {
    row.pickups = [{kind, lane: 0, mass: kind === 'freight' ? 2 : 1, slots: 1, value}];
    scene.spawnTrackRow();
    const spawned = scene.objects.at(-1);
    assert.equal(spawned.sprite.texture, texture, `${kind} ${value}c reads by payout size`);
    assert.equal(spawned.pickupGlow.texture, 'cargo_pickup_glow_green');
    assert.equal(spawned.pickupSparkle.texture, 'cargo_pickup_sparkle');
    assert.equal(spawned.kind, kind, 'presentation must not change cargo rules');
    assert.equal(spawned.mass, row.pickups[0].mass);
    assert.equal(spawned.value, value);
  }
});

test('a row the background planner delivers late spawns as clear road instead of popping in near the truck', () => {
  const scene = depotScene();
  scene.add = {
    image(x, y, texture) {
      return {x, y, texture, setDepth() { return this; }, setFlipX() { return this; }, setTint() { return this; },
        setPosition(x, y) { Object.assign(this, {x, y}); return this; }, setAlpha() { return this; },
        setBlendMode() { return this; }, setRotation() { return this; }, setOrigin() { return this; }};
    },
    text() { return {setOrigin() { return this; }, setDepth() { return this; }}; },
  };
  const plannedDistance = 1800;
  const row = {plannedDistance, emitted: true, spacingPx: 250,
    hazards: [{kind: 'divider', lane: 1, offsetY: 0, placement: 'alpha'}], intermediates: [],
    pickups: [{kind: 'coin', lane: 0, mass: 1, slots: 1, value: 5}]};
  scene.trackStream = {nextRow: () => row};
  const toleranceMeters = routeSpeedAtDistance(plannedDistance, scene.levelId, scene.runMode) *
    METERS_PER_PIXEL * ROUTE_STREAM_LATE_ROW_MS / 1000;
  scene.lateRouteRows = 0;
  scene.objects = [];
  scene.distance = plannedDistance + toleranceMeters * 0.9;
  scene.spawnTrackRow();
  assert.deepEqual(scene.objects.map(item => item.type), ['hazard', 'cargo'], 'a row within tolerance is unchanged');
  assert.equal(scene.lateRouteRows, 0);
  scene.objects = [];
  scene.distance = plannedDistance + toleranceMeters * 1.1;
  assert.equal(scene.spawnTrackRow(), 250);
  assert.deepEqual(scene.objects.map(item => item.type), ['cargo'], 'late hazards are withheld; pickups remain');
  assert.equal(scene.lateRouteRows, 1);
  assert.equal(scene.nextTrackRowDistance, plannedDistance + 250 * METERS_PER_PIXEL, 'route cadence is unchanged');
});

test('approved container variants and short edge pipes retain one unchanged gameplay object per obstacle', () => {
  const scene = depotScene();
  const hazards = [
    ...[0, 1, 2, 3].map(lane => ({kind: 'container', lane, offsetY: -120, placement: 'alpha'})),
    ...[0, 3].map(lane => ({kind: 'pipeAssembly', lane, offsetY: 0, placement: 'alpha'})),
  ];
  const row = {hazards, intermediates: [], pickups: [], spacingPx: 250, emitted: true};
  const before = JSON.stringify({row, profile: scene.profile});
  const destroyed = [];
  scene.trackStream = {nextRow: () => row};
  scene.add = {image(x, y, texture) {
    return {x, y, texture, setDepth() { return this; },
      setBlendMode() { return this; }, setPosition() { return this; }, setAlpha() { return this; },
      setFlipX(value) { this.flipped = value; return this; },
      setOrigin(x, y) { this.originX = x; this.originY = y; return this; },
      setDisplaySize() { throw new Error('Short pipe artwork must not stretch like a wall'); },
      destroy() { destroyed.push(texture); }};
  }};
  scene.spawnTrackRow();
  assert.equal(scene.objects.length, 6);
  for (const [index, item] of scene.objects.entries()) {
    assert.equal(item.kind, hazards[index].kind);
    assert.equal(item.sprite.x, hazardX(hazards[index]));
    assert.equal(item.sprite.y, SPAWN_Y + hazards[index].offsetY);
    assert.equal(item.sprite.texture, hazardTexture(item.kind, sectorAtDistance(0), item.lane));
    assert.equal(item.roadsideBase, isGuardrail(item) ? undefined : null);
    assert.equal(item.lengthPx, undefined);
    if (!isGuardrail(item)) assert.equal(item.cautionLights.length, 1, 'every obstacle carries one amber beacon');
  }
  const lightCount = scene.objects.reduce((sum, item) => sum + (item.cautionLights?.length ?? 0), 0);
  assert.equal(scene.objects[4].sprite.flipped, false);
  assert.equal(scene.objects[5].sprite.flipped, true);
  assert.equal(JSON.stringify({row, profile: scene.profile}), before);
  scene.removeObjects();
  assert.equal(destroyed.length, hazards.length + lightCount, 'each obstacle and its beacon are released');
});

test('Level 4 hazards retain warning lights but spawn no surrounding glow', () => {
  const scene = depotScene();
  scene.levelId = 'level4';
  const row = {
    hazards: [{kind: 'barrier', lane: 0, offsetY: 0, placement: 'alpha'}],
    intermediates: [], pickups: [], spacingPx: 250, emitted: true,
    energyOrbs: [{kind: 'energy_orb', initialX: 195, distanceMeters: 100, direction: 1}],
  };
  const textures = [];
  scene.trackStream = {nextRow: () => row};
  scene.add = {image(x, y, texture) {
    textures.push(texture);
    return {x, y, texture, setDepth() { return this; }, setBlendMode() { return this; },
      setPosition() { return this; }, setAlpha() { return this; }, destroy() {}};
  }};
  scene.spawnTrackRow();
  const barrier = scene.objects.find(item => item.kind === 'barrier');
  const orb = scene.objects.find(item => item.kind === 'energy_orb');
  assert.equal(barrier.cautionLights.length, 2);
  assert.equal(barrier.neonHalo, undefined);
  assert.equal(orb.orbGlow, null);
  assert.ok(!textures.some(texture => texture.startsWith('glow_hazard_ring') || texture === 'glow_orb_radial'));
});

test('approved Barrier, Rockslab and Signal Cabinet keep their spawn geometry, depth and shared cleanup', () => {
  const scene = depotScene();
  const hazards = ['barrier', 'rockSlab', 'signalCabinet']
    .map((kind, lane) => ({kind, lane, offsetY: lane * -70, placement: 'alpha'}));
  const row = {hazards, intermediates: [], pickups: [], spacingPx: 250, emitted: true};
  const before = JSON.stringify({row, profile: scene.profile, geometry: HAZARDS});
  const destroyed = [];
  scene.trackStream = {nextRow: () => row};
  scene.add = {image(x, y, texture) {
    return {x, y, texture, setDepth(value) { this.depth = value; return this; },
      setBlendMode(mode) { this.blendMode = mode; return this; },
      setPosition(x, y) { Object.assign(this, {x, y}); return this; },
      setAlpha(alpha) { this.alpha = alpha; return this; },
      setDisplaySize() { throw new Error('Standalone obstacles retain native frames'); },
      destroy() { destroyed.push(texture); }};
  }};
  scene.spawnTrackRow();
  assert.equal(scene.objects.length, 3);
  for (const [index, item] of scene.objects.entries()) {
    assert.equal(item.kind, hazards[index].kind);
    assert.equal(item.sprite.texture, HAZARDS[item.kind].texture);
    assert.equal(item.sprite.x, LANE_CENTERS[index]);
    assert.equal(item.sprite.y, SPAWN_Y + hazards[index].offsetY);
    assert.equal(item.sprite.depth, HAZARD_READABILITY.depth);
    assert.equal(item.sprite.scaleX, 1.1);
    assert.equal(item.sprite.scaleY, 1.1);
    assert.equal(item.roadsideBase, null);
    assert.equal(item.cautionLights?.length ?? 0, item.kind === 'barrier' ? 2 : 1);
    if (item.cautionLights) assert.ok(item.cautionLights.every(light => light.texture === 'barrier_caution_light'));
    assert.equal(item.lengthPx, undefined);
  }
  assert.equal(JSON.stringify({row, profile: scene.profile, geometry: HAZARDS}), before);
  scene.removeObjects();
  assert.equal(scene.objects.length, 0);
  assert.deepEqual(destroyed, ['hazard_signalCabinet', 'barrier_caution_light', 'hazard_rockSlab',
    'barrier_caution_light', 'cargo_hazard', 'barrier_caution_light', 'barrier_caution_light']);
});

test('approved Barrier replaces generated concrete divider visuals across sectors without changing spawn data', () => {
  for (const [levelId, sectors] of Object.entries(IMPLEMENTED_LEVELS)) for (const sector of sectors) {
    const scene = depotScene();
    scene.levelId = levelId;
    const distance = sector.startsAt;
    scene.distance = distance;
    scene.roadEnvironment = {lighting: lightingForSector(sectorAtDistance(distance, scene.levelId),
      distance, routeFinishDistance(scene.levelId), scene.runMode, scene.levelId)};
    const night = scene.roadEnvironment.lighting.headlights;
    const row = {hazards: [0, 1, 2, 3].map(lane => ({kind: 'divider', lane, offsetY: -30, placement: 'alpha'})),
      intermediates: [], pickups: [], spacingPx: 250, emitted: true};
    const before = JSON.stringify({row, profile: scene.profile, geometry: HAZARDS.divider});
    scene.trackStream = {nextRow: () => row};
    const destroyed = [];
    scene.add = {image(x, y, texture) {
      return {x, y, texture, setDepth(value) { this.depth = value; return this; },
        setBlendMode(mode) { this.blendMode = mode; return this; },
        setPosition(x, y) { Object.assign(this, {x, y}); return this; },
        setAlpha(alpha) { this.alpha = alpha; return this; },
        destroy() { destroyed.push(texture); }};
    }};
    scene.spawnTrackRow();
    assert.equal(scene.objects.length, 4);
    for (const [lane, item] of scene.objects.entries()) {
      assert.equal(item.kind, 'divider');
      assert.equal(item.cautionLights.length, 2);
      assert.ok(item.cautionLights.every(light => light.texture === 'barrier_caution_light'));
      assert.ok(item.cautionLights.every(light => light.depth > item.sprite.depth &&
        light.blendMode === (night ? 'ADD' : 'NORMAL') &&
        Math.abs(light.scaleX - 1.1 * (night ? ENVIRONMENT_VISUALS.barrierNightScale : 1)) < 1e-9),
      'scene spawn uses the active dusk/night lighting and leaves daylight/Overdrive unchanged');
      assert.equal(item.sprite.texture, hazardTexture('divider', sectorAtDistance(distance, levelId), lane));
      assert.equal(item.sprite.scaleX, 1.1);
      assert.equal(item.sprite.scaleY, 1.1);
      assert.equal(item.sprite.x, LANE_CENTERS[lane]);
      assert.equal(item.sprite.y, SPAWN_Y - 30);
      assert.equal(item.sprite.depth, HAZARD_READABILITY.depth);
      assert.equal(item.roadsideBase, null);
    }
    assert.equal(JSON.stringify({row, profile: scene.profile, geometry: HAZARDS.divider}), before);
    scene.removeObjects();
    assert.equal(destroyed.length, 12);
  }
});

test('Street Sweeper follows the existing canonical motion and shared cleanup without changing saves', () => {
  const scene = depotScene();
  const movement = {minOffsetPx: 0, maxOffsetPx: 146, speedPxPerSecond: 76, direction: 1, phase: 11};
  const row = {hazards: [{kind: 'sweeper', lane: 0, offsetY: 0, placement: 'alpha', movement}],
    intermediates: [], pickups: [], spacingPx: 250, emitted: true, plannedDistance: 0};
  const before = JSON.stringify({row, profile: scene.profile, geometry: HAZARDS.sweeper});
  const destroyed = [];
  scene.trackStream = {nextRow: () => row};
  scene.add = {image(x, y, texture) {
    return {x, y, texture, setDepth(value) { this.depth = value; return this; },
      setPosition(x, y) { Object.assign(this, {x, y}); return this; },
      setAlpha(alpha) { this.alpha = alpha; return this; },
      setBlendMode(mode) { this.blendMode = mode; return this; },
      setX(value) { this.x = value; return this; },
      setDisplaySize() { throw new Error('Sweeper retains its native frame'); },
      destroy() { destroyed.push(texture); }};
  }};
  scene.spawnTrackRow();
  assert.equal(scene.objects.length, 1);
  const item = scene.objects[0];
  assert.equal(item.sprite.texture, HAZARDS.sweeper.texture);
  assert.equal(item.sprite.scaleX, 1.1);
  assert.equal(item.sprite.scaleY, 1.1);
  assert.equal(item.sprite.depth, HAZARD_READABILITY.depth);
  assert.equal(item.sprite.x, LANE_CENTERS[0] + movingHazardOffset(movement, 0));
  assert.equal(item.sprite.y, SPAWN_Y);
  assert.equal(item.movement, movement);
  assert.equal(item.roadsideBase, null);
  const beaconMidX = () => (item.cautionLights[0].x + item.cautionLights[1].x) / 2;
  assert.equal(item.cautionLights.length, 2, 'the lane-wide Sweeper carries a paired beacon set');
  assert.ok(item.cautionLights.every(light => light.texture === 'barrier_caution_light'));
  assert.ok(Math.abs(beaconMidX() - item.sprite.x) < 1e-9);
  scene.ship.y = 10000;
  scene.ship.setAlpha = () => {};
  scene.lines = [];
  scene.time = {now: 0};
  scene.developerSandbox = true;
  for (const method of ['updateShield', 'recordMilestones', 'updateRadar', 'updateDepot']) {
    scene[method] = () => {};
  }
  scene.update(50, 50);
  const age = canonicalMotionAge(0, scene.distance, scene.levelId, scene.runMode);
  assert.equal(item.motionAge, age);
  assert.equal(item.movementOffsetPx, movingHazardOffset(movement, age));
  assert.equal(item.sprite.x, LANE_CENTERS[0] + item.movementOffsetPx);
  assert.ok(item.sprite.x > LANE_CENTERS[0] + 11);
  assert.ok(item.sprite.y > SPAWN_Y);
  assert.ok(Math.abs(beaconMidX() - item.sprite.x) < 1e-9, 'beacons follow canonical horizontal motion');
  assert.ok(item.cautionLights.every(light =>
    light.y === item.sprite.y - HAZARDS.sweeper.height * 0.18 * item.sprite.scaleY));
  assert.equal(JSON.stringify({row, profile: scene.profile, geometry: HAZARDS.sweeper}), before);
  scene.removeObjects();
  assert.equal(scene.objects.length, 0);
  assert.deepEqual(destroyed, [HAZARDS.sweeper.texture, 'barrier_caution_light', 'barrier_caution_light']);
});

test('scene cargo pickup spawning and updates preserve slight low-light dimming and full-hold rejection', () => {
  for (const lighting of [...SECTOR_LIGHTING, OVERDRIVE_LIGHTING]) {
    const scene = depotScene();
    const profile = JSON.stringify(scene.profile);
    scene.roadEnvironment = {lighting};
    const node = (x, y, texture) => ({x, y, texture,
      setDepth(depth) { this.depth = depth; return this; },
      setTint(tint) { this.tint = tint; return this; },
      setAlpha(alpha) { this.alpha = alpha; return this; },
      setPosition(x, y) { Object.assign(this, {x, y}); return this; },
      setRotation(rotation) { this.rotation = rotation; return this; },
      setBlendMode() { return this; }, destroy() { this.destroyed = true; },
    });

    scene.add = {image: node};
    scene.addCurrency = () => { throw new Error('Road cargo must not create coin/value labels'); };
    scene.trackStream = {nextRow: () => ({
      hazards: [], intermediates: [], pickups: [{lane: 1, value: 5, mass: 1, slots: 1, kind: 'coin'}],
      spacingPx: 250, emitted: true,
    })};
    scene.spawnTrackRow();
    const item = scene.objects[0];
    assert.equal(item.sprite.tint, lighting.headlights ? 0xe6e6e6 : 0xffffff);
    assert.equal(item.sprite.depth, lighting.headlights ? 16.2 : 5);
    assert.equal(item.valueText, undefined);
    const pose = {tint: item.sprite.tint, depth: item.sprite.depth,
      glow: item.pickupGlow.alpha, texture: item.sprite.texture};
    scene.developerSandbox = true;
    scene.runEconomy = markDeveloperRun(scene.runEconomy);
    scene.spawnSandboxCargo({kind: 'coin', value: 5, mass: 1, slots: 1});
    const sandbox = scene.objects[1];
    assert.equal(sandbox.valueText, undefined);
    assert.deepEqual({tint: sandbox.sprite.tint, depth: sandbox.sprite.depth,
      glow: sandbox.pickupGlow.alpha, texture: sandbox.sprite.texture}, pose,
    'normal and sandbox pickup artwork/glow remain identical');
    // The rendering unit tests cover the complete road environment; this fixture exercises scene wiring.
    scene.roadEnvironment = {lighting, visible: false, glints: {tilePositionY: 0},
      road: {subRoad: {tilePositionY: 0}}};
    scene.developerSandbox = true;
    scene.ship.setAlpha = () => {};
    scene.lines = [];
    scene.cargoItems = Array.from({length: scene.stats.capacity}, () =>
      ({kind: 'coin', value: 100, mass: 1, slots: 1}));
    scene.syncCargoTotals();
    scene.updateStep(0, 0);
    assert.equal(item.sprite.alpha, 0.35);
    assert.ok(Math.abs(item.pickupGlow.alpha - 0.55 * (lighting.headlights ? 0.9 : 1) * 0.35) < 1e-9);
    assert.equal(JSON.stringify(scene.profile), profile);
    scene.removeObjects();
    assert.ok(item.sprite.destroyed && item.pickupGlow.destroyed && item.pickupSparkle.destroyed &&
      sandbox.sprite.destroyed && sandbox.pickupGlow.destroyed && sandbox.pickupSparkle.destroyed);
  }
});

test('all road collectible bodies shrink another five percent while under-pickup layers keep their original size', () => {
  assert.equal(balance.RUN_TRUCK_VISUAL_SCALE, 1.05);
  assert.equal(balance.COLLECTIBLE_VISUAL_SCALE, 0.95 * 0.95);
  const scene = depotScene();
  const node = (x, y, texture) => ({x, y, texture,
    setDepth() { return this; }, setTint() { return this; }, setBlendMode() { return this; },
    setAlpha() { return this; }, setRotation() { return this; },
    setPosition(x, y) { Object.assign(this, {x, y}); return this; },
    destroy() {},
  });
  scene.add = {image: node};
  const visuals = [5, 10, 20, 25, 30].map(value => scene.addCargoPickupVisual(159, 200, value));
  assert.deepEqual(visuals.map(view => view.sprite.texture),
    ['cargo_pickup_small', 'cargo_pickup_med', 'cargo_pickup_lg', 'cargo_pickup_xl', 'cargo_pickup_xl']);
  for (const {sprite, pickupGlow} of visuals) {
    assert.equal(sprite.scaleX, SPRITE_ART_SCALE * (0.95 * 0.95));
    assert.equal(sprite.scaleY, SPRITE_ART_SCALE * (0.95 * 0.95));
    assert.equal(pickupGlow.scaleX, SPRITE_ART_SCALE);
    assert.equal(pickupGlow.scaleY, SPRITE_ART_SCALE);
    assert.equal(pickupGlow.x, sprite.x);
    assert.equal(pickupGlow.y, sprite.y + CARGO_PICKUP_GLOW_OFFSET_Y * SPRITE_ART_SCALE);
    for (const night of [false, true, false]) {
      for (let time = 0; time <= 1000; time += 100) {
        syncCargoPickupVisuals(sprite, pickupGlow, time, night);
        assert.equal(sprite.scaleX, SPRITE_ART_SCALE * (0.95 * 0.95), 'updates do not compound scaling');
        assert.equal(pickupGlow.scaleX, SPRITE_ART_SCALE, 'under-pickup layer is never downscaled');
      }
    }
  }
  assert.equal(CARGO_COLLISION_DISTANCE_PX, GAME_BALANCE.cargo.pickupCollisionRadiusPx);
});

test('Apex Blueprint spawns use the converted coin presentation without changing the wallet', () => {
  const scene = depotScene();
  scene.distance = 4000;
  scene.nextDepotDistance = 4650;
  scene.profile.milestones = ['level1,sector3'];
  scene.profile.ownedVehicleIds = ['standard', 'apex'];
  const before = JSON.stringify(scene.profile);
  const reward = {id: 'apex-spawn:neon', amount: 2, lane: 2};
  scene.trackStream = {nextRow: () => ({
    hazards: [], intermediates: [], pickups: [], safeLanes: [1, 2], spacingPx: 250,
  })};
  scene.blueprintRun = {authorize: () => reward};
  scene.add = {image(x, y, texture) {
    return {x, y, texture, setDepth() { return this; }};
  }};

  assert.equal(scene.spawnTrackRow(), 250);
  assert.equal(scene.objects.length, 1);
  const item = scene.objects[0];
  assert.equal(item.type, 'blueprint');
  assert.equal(item.sprite.texture, 'cargo_coinStack');
  assert.equal(item.sprite.x, LANE_CENTERS[reward.lane]);
  assert.equal(item.sprite.y, SPAWN_Y);
  assert.equal(item.reward, reward);
  assert.equal(item.valueText.text, `+${reward.amount * BP_TO_COINS} banked`,
    'the converted label comes from the pooled transient text, not a new currency object');
  assert.equal(item.valueText.x, item.sprite.x);
  assert.equal(JSON.stringify(scene.profile), before);
});

test('each selected scenery obstacle spawns as one collision object with mirrored roots and no decorative collision proxy', () => {
  // Elongated guardrails are atomic multi-tile structures with their own spawn test.
  for (const [kind, definition] of Object.entries(HAZARDS).filter(([, h]) => h.scenery && !h.elongated)) {
    const scene = depotScene();
    scene.trackStream = {nextRow: () => ({
      hazards: [0, 3].map(lane => ({kind, lane, offsetY: 0, placement: 'alpha'})),
      intermediates: [], pickups: [], spacingPx: 250,
    })};
    const destroyed = [];
    scene.add = {image(x, y, texture) {
      return {x, y, texture, setDepth() { return this; },
        setFlipX(value) { this.flipped = value; return this; },
        setOrigin(x, y) { this.originX = x; this.originY = y; return this; },
        destroy() { destroyed.push(texture); }};
    }};
    scene.spawnTrackRow();
    assert.equal(scene.objects.length, 2);
    for (const [index, item] of scene.objects.entries()) {
      assert.equal(item.type, 'hazard');
      assert.equal(item.kind, kind);
      assert.equal(item.roadsideBase, null);
      const origin = definition.scenery.anchorX / definition.scenery.width;
      assert.equal(item.sprite.originX, index === 0 ? origin : 1 - origin);
      assert.equal(item.sprite.flipped, index === 1);
      assert.equal(item.sprite.y, SPAWN_Y);
    }
    scene.removeObjects();
    assert.equal(destroyed.length, 2, 'hit/despawn/Continue cleanup has only one image per structure');
  }
});

test('legacy Service Boom routes through a single-lane modular guardrail with shared cleanup', () => {
  const scene = depotScene();
  const row = {hazards: [0, 3].map(lane => ({kind: 'serviceBoom', lane, offsetY: -30, placement: 'alpha'})),
    intermediates: [], pickups: [], spacingPx: 250, emitted: true};
  const before = JSON.stringify({row, profile: scene.profile, geometry: HAZARDS.serviceBoom});
  const destroyed = [];
  scene.trackStream = {nextRow: () => row};
  scene.add = {image(x, y, texture) {
    return {x, y, texture, setDepth(value) { this.depth = value; return this; },
      setFlipX(value) { this.flipped = value; return this; },
      setOrigin(x, y) { this.originX = x; this.originY = y; return this; },
      setDisplaySize() { throw new Error('Service Boom retains its native short frame'); },
      destroy() { destroyed.push(texture); }};
  }};
  scene.spawnTrackRow();
  assert.equal(scene.objects.length, 2);
  for (const [index, item] of scene.objects.entries()) {
    assert.equal(item.sprite.texture, 'chicane_mid');
    assert.equal(item.sprite.x, hazardX(row.hazards[index]));
    assert.equal(item.sprite.y, SPAWN_Y - 30);
    assert.equal(item.sprite.depth, 5);
    assert.equal(item.sprite.flipped, index === 1);
    assert.equal(item.roadsideBase, undefined, 'the atomic guardrail owns its tile shadows');
    assert.equal(item.lengthPx, undefined);
  }
  assert.equal(JSON.stringify({row, profile: scene.profile, geometry: HAZARDS.serviceBoom}), before);
  scene.removeObjects();
  assert.equal(scene.objects.length, 0);
  assert.deepEqual(destroyed, ['chicane_mid', 'chicane_mid']);
});

test('long scenery spawns once as one atomic guardrail and never respawns on continuation rows', () => {
  const restore = useRealVisuals();
  try {
    const scene = depotScene();
    scene.nextDepotDistance = 2000;
    const rows = prepareTrackChunk(CHUNK_REGISTRIES.industrial.find(c => c.family === 'roadside-weave'), 0, () => 1).rows;
    const structureRows = rows.slice(1, 4).map(row => ({...row,
      hazards: row.hazards.filter(h => h.spanRows), intermediates: [], pickups: []}));
    scene.trackStream = {nextRow: () => structureRows.shift()};
    const images = [], containers = [];
    scene.add = {image: fullImageFactory(images), container: containerFactory(containers)};
    scene.spawnTrackRow();
    const item = scene.objects[0];
    assert.ok(isGuardrail(item));
    assert.equal(containers.length, 1);
    assert.equal(item.sprite, containers[0]);
    assert.equal(item.shadow, undefined, 'tile shadows live inside the structure');
    const parts = item.sprite.guardrailParts;
    assert.deepEqual([parts[0].key, parts.at(-1).key], ['chicane_exit', 'chicane_entry']);
    assert.equal(images.length, parts.length * 2 + 1, 'one shadow per tile and one entry beacon');
    scene.spawnTrackRow();
    scene.spawnTrackRow();
    assert.equal(scene.objects.length, 1, 'no extra blocks or gap between rows');
    scene.removeObjects();
    assert.equal(containers[0].destroyed, 1, 'the whole structure is released atomically');
    assert.equal(item.cautionLights[0].destroyed, 1, 'entry beacon is released exactly once');
  } finally {
    restore();
  }
});

for (const outcome of ['cargo', 'blueprint', 'blueprint-offscreen', 'hazard', 'long-hazard', 'shield', 'fatal', 'offscreen', 'barrier-offscreen']) {
  test(`the update loop cleans up ${outcome} objects through the shared removal path`, () => {
    const scene = depotScene();
    const destroyed = [];
    scene.ship.setAlpha = () => {};
    scene.lines = [];
    scene.spawnTimer = 10;
    scene.holdFullCooldown = 0;
    scene.shieldCharges = outcome === 'shield' ? 2 : 0;
    scene.hull = outcome === 'fatal' ? 1 : 3;
    scene.profile.milestones = ['level1,sector3'];
    scene.time = {now: 1800};
    for (const method of ['updateShield', 'recordMilestones', 'updateRadar', 'updateDepot',
      'playPickupFeedback', 'playHitFeedback', 'absorbWithShield', 'floatText']) scene[method] = () => {};
    scene.beginCrash = () => { scene.phase = 'crashing'; };
    const hazard = ['hazard', 'long-hazard', 'shield', 'fatal', 'barrier-offscreen'].includes(outcome);
    const attachment = name => ({
      destroy: () => destroyed.push(name),
      setY() {},
      setPosition(x, y) { Object.assign(this, {x, y}); return this; },
      setAlpha() {},
      setRotation() {},
      setDepth() { return this; },
      setBlendMode() { return this; },
    });
    const cautionLights = hazard && outcome !== 'long-hazard'
      ? [attachment('light0'), attachment('light1')] : null;
    scene.objects = [{
      type: hazard ? 'hazard' : outcome.startsWith('blueprint') ? 'blueprint' : 'cargo',
      kind: outcome === 'long-hazard' ? 'sideRail' : hazard ? 'divider' : 'coin',
      lengthPx: outcome === 'long-hazard' ? 450 : undefined,
      mass: 1, slots: 1, value: 5,
      reward: {id: `cleanup-${outcome}`, amount: 1},
      sprite: {...attachment('sprite'), x: scene.ship.x,
        scaleX: 1.1, scaleY: 1.1,
        // A guardrail only kills head-on: its lip sits just above the bumper and sweeps past it this frame.
        y: outcome.includes('offscreen') ? 1000
          : outcome === 'long-hazard' ? SHIP_Y - GAME_BALANCE.hazards.playerHalfHeightPx - 0.5 - (450 / 2 - 2)
            : SHIP_Y},
      lane: outcome === 'long-hazard' ? 0 : undefined,
      roadsideBase: attachment('base'),
      cautionLights,
      blueprintGlow: outcome.startsWith('blueprint') ? attachment('glow') : null,
      valueText: attachment('label'),
    }];
    scene.update(0, outcome === 'long-hazard' ? 1000 / 60 : 0);
    assert.equal(scene.objects.length, 0);
    assert.deepEqual(destroyed, outcome.startsWith('blueprint')
      ? ['sprite', 'base', 'glow', 'label'] : cautionLights
        ? ['sprite', 'light0', 'light1', 'base', 'label'] : ['sprite', 'base', 'label']);
    if (cautionLights) assert.ok(cautionLights.every(light => Number.isFinite(light.x) && Number.isFinite(light.y)));
    assert.equal(scene.phase, outcome === 'fatal' ? 'crashing' : 'running');
    if (outcome === 'cargo') assert.equal(scene.cargoValue, 5);
    if (outcome === 'blueprint') assert.equal(scene.profile.blueprints, 1);
    if (outcome === 'hazard' || outcome === 'long-hazard') assert.equal(scene.hull, 2);
    if (outcome === 'shield') {
      assert.equal(scene.hull, 3);
      assert.equal(scene.shieldCharges, 1, 'shared collision consumes exactly one charge before hit feedback');
      assert.equal(scene.runEconomy.damagingHits, 0);
    }
  });
}

function guardrailRun({kind = 'sideWall', lane = 0, lengthPx = 1000, shipX, targetX = shipX, y}) {
  const scene = depotScene();
  scene.ship.setAlpha = () => {};
  scene.ship.x = shipX;
  scene.shipTargetX = targetX;
  scene.shipVelocityX = 0;
  scene.lines = [];
  scene.spawnTimer = 10;
  scene.nextTrackRowDistance = null;
  scene.holdFullCooldown = 0;
  scene.hull = 3;
  scene.time = {now: 1800};
  const hits = [];
  for (const method of ['updateShield', 'recordMilestones', 'updateRadar', 'updateDepot', 'updateDepotFacilities',
    'playPickupFeedback', 'absorbWithShield', 'floatText']) scene[method] = () => {};
  scene.playHitFeedback = (...args) => hits.push(args);
  scene.beginCrash = () => { scene.phase = 'crashing'; };
  scene.haulerEffects = {grind: {emitter: {emitting: false}, anchor: {}}};
  const destroyed = [];
  const hazard = {type: 'hazard', kind, lane, lengthPx, sprite: {x: hazardX({kind, lane}), y,
    setY() {}, destroy() { destroyed.push('structure'); }}};
  scene.objects = [hazard];
  const frame = () => scene.update(0, 1000 / 60);
  return {scene, hazard, hits, destroyed, frame, grind: scene.haulerEffects.grind};
}
// Guardrail centre y whose leading lip sits `gap` px above the cab's front bumper.
const lipAbove = (lengthPx, gap = 0.5) =>
  SHIP_Y - GAME_BALANCE.hazards.playerHalfHeightPx - gap - (lengthPx / 2 - 2);

function attachFeedbackSpy(scene) {
  const calls = [];
  scene.feedback = Object.fromEntries(['steer', 'cargoPickup', 'impact', 'playMetalScrape', 'depot', 'airBrake', 'uiClick',
    'resetRun', 'resetSteering'].map(method => [method, (...args) => calls.push({method, args})]));
  return calls;
}

function enableRealFeedback(scene) {
  scene.playPickupFeedback = Scene.prototype.playPickupFeedback;
  scene.playHitFeedback = Scene.prototype.playHitFeedback;
  scene.absorbWithShield = Scene.prototype.absorbWithShield;
  scene.coinBurst = scene.debris = {explode() {}};
  scene.haulerEffects.grind.emitter.explode = () => {};
  scene.cameras = {main: {shake() {}, flash() {}}};
  scene.hud = {cargo: {}, hull: {}};
  scene.pulse = scene.floatText = scene.floatCurrency = () => {};
}

test('audio feedback separates Hull/shield impacts from harmless wall-grind scrapes', () => {
  for (const contact of ['hull', 'shield', 'immune', 'god', 'grind']) {
    const run = guardrailRun({shipX: contact === 'grind' ? 215 : LANE_CENTERS[0],
      targetX: LANE_CENTERS[0], y: contact === 'grind' ? SHIP_Y : lipAbove(1000)});
    const {scene} = run;
    enableRealFeedback(scene);
    const calls = attachFeedbackSpy(scene);
    if (contact === 'shield') scene.shieldCharges = 1;
    if (contact === 'immune') scene.invulnerable = 0.8;
    if (contact === 'god') scene.debugManager = new DebugManager('?god=true');
    for (let frame = 0; frame < (contact === 'grind' ? 30 : 1); frame++) run.frame();
    assert.equal(calls.filter(call => call.method === 'impact').length,
      contact === 'hull' || contact === 'shield' ? 1 : 0, contact);
    const scrapes = calls.filter(call => call.method === 'playMetalScrape').length;
    if (contact === 'grind') assert.ok(scrapes > 0);
    else assert.equal(scrapes, 0, contact);
    if (contact === 'shield') {
      assert.equal(scene.shieldCharges, 0);
      assert.equal(calls.find(call => call.method === 'impact').args[0].damaging, false);
    }
    if (contact === 'hull') assert.equal(scene.hull, 2);
  }
});

test('audio cargo feedback only accompanies accepted crates, not a full hold, distant cargo or Blueprint collection', () => {
  for (const outcome of ['accepted', 'full', 'distant', 'blueprint']) {
    const {scene} = guardrailRun({shipX: LANE_CENTERS[1], y: 1200});
    scene.profile.milestones.push(GAME_BALANCE.physics.blueprint.unlockMilestone);
    enableRealFeedback(scene);
    const calls = attachFeedbackSpy(scene);
    if (outcome === 'full') {
      scene.cargoItems = [{kind: 'coinStack', value: 100, mass: scene.stats.capacity, slots: scene.stats.capacity}];
      scene.syncCargoTotals();
    }
    scene.objects = [{
      type: outcome === 'blueprint' ? 'blueprint' : 'cargo', kind: 'coin',
      mass: 1, slots: 1, value: 5, reward: {id: 'audio-bp', amount: 1},
      sprite: {x: scene.ship.x, y: outcome === 'distant' ? 100 : SHIP_Y,
        setAlpha() {}, destroy() {}},
    }];
    scene.update(0, 0);
    assert.equal(calls.filter(call => call.method === 'cargoPickup').length,
      outcome === 'accepted' ? 1 : 0, outcome);
    if (outcome === 'accepted') assert.deepEqual(calls.find(call => call.method === 'cargoPickup').args, [1.8]);
  }
});

test('audio feedback fires one brake and arrival without engine noise, not bypass, repaint or repair; new runs reset feedback', () => {
  const scene = depotScene();
  scene.runMode = scene.runEconomy.mode = 'continuous';
  const calls = attachFeedbackSpy(scene);
  scene.ship.x = LANE_CENTERS[0];
  scene.distance = depotDockingStart(scene.nextDepot, scene.levelId, scene.runMode);
  scene.updateDepot();
  assert.equal(scene.phase, 'docking');
  assert.equal(calls.filter(call => call.method === 'airBrake').length, 1);
  scene.beginDocking();
  assert.equal(calls.filter(call => call.method === 'airBrake').length, 1, 'no repeated brake on stale callback');
  assert.equal(calls.filter(call => call.method === 'depot').length, 0, 'not on braking entry');
  scene.updateStep(0, 50);
  assert.ok(scene.depotMotion.elapsed > 0, 'docking motion still advances without engine audio');
  finishDocking(scene);
  assert.equal(calls.filter(call => call.method === 'depot').length, 1);
  scene.showDepot();
  scene.renderDepot();
  assert.equal(calls.filter(call => call.method === 'depot').length, 1);
  scene.resumeAfterDepot();
  assert.equal(calls.filter(call => call.method === 'resetSteering').length, 1);
  scene.startRun();
  assert.equal(calls.filter(call => call.method === 'resetRun').length, 1);
  const bypass = depotScene();
  bypass.runMode = bypass.runEconomy.mode = 'continuous';
  const bypassCalls = attachFeedbackSpy(bypass);
  bypass.distance = bypass.nextDepotDistance;
  bypass.ship.x = LANE_CENTERS[1];
  bypass.updateDepot();
  assert.equal(bypass.phase, 'running');
  assert.equal(bypassCalls.filter(call => call.method === 'depot').length, 0);
  assert.equal(bypassCalls.filter(call => call.method === 'airBrake').length, 0);
});

test('nearmiss bonus resets on Hull, fatal and shield collisions in both modes, but not immune overlaps or wall grinding', () => {
  for (const mode of ['normal', 'continuous']) {
    for (const contact of ['hull', 'shield', 'fatal', 'immune']) {
      const {scene, frame} = guardrailRun({shipX: LANE_CENTERS[0], y: lipAbove(1000)});
      scene.runMode = scene.runEconomy.mode = mode;
      loadCargo(scene, 100);
      scene.runEconomy.closeCallBonusPercent = 35;
      scene.runEconomy.consecutiveSkips = 2;
      scene.runEconomy.continuousPassedDepots = 3;
      if (contact === 'shield') scene.shieldCharges = 1;
      if (contact === 'fatal') scene.hull = 1;
      if (contact === 'immune') scene.invulnerable = 0.8;
      frame();
      assert.equal(scene.runEconomy.closeCallBonusPercent, contact === 'immune' ? 35 : 0, `${mode}/${contact}`);
      assert.equal(scene.runEconomy.consecutiveSkips, 2, 'Depot bonus is not the near-miss bonus');
      assert.equal(scene.runEconomy.continuousPassedDepots, 3);
      if (contact === 'shield') {
        assert.equal(scene.shieldCharges, 0);
        assert.equal(scene.cargoValue, 100);
        assert.equal(scene.hull, 3);
      }
    }
    const grind = guardrailRun({shipX: 215, targetX: LANE_CENTERS[0], y: SHIP_Y});
    grind.scene.runMode = grind.scene.runEconomy.mode = mode;
    loadCargo(grind.scene, 100);
    grind.scene.runEconomy.closeCallBonusPercent = 35;
    for (let frame = 0; frame < 60; frame++) grind.frame();
    assert.equal(grind.scene.runEconomy.closeCallBonusPercent, 35, 'harmless flank scrape preserves the bonus');
    assert.equal(grind.scene.hull, 3);
  }
});

test('nearmiss collision reset wins over same-frame clean passes in either processing order; later clean passes can earn again', () => {
  for (const hitFirst of [true, false]) for (const shield of [false, true]) {
    const {scene, hazard: hit, frame} = guardrailRun({shipX: LANE_CENTERS[0], y: lipAbove(1000)});
    loadCargo(scene, 100);
    scene.shieldCharges = shield ? 1 : 0;
    scene.runEconomy.closeCallBonusPercent = 35;
    const close = {type: 'hazard', kind: 'barrier', lane: 1, sprite: {
      x: scene.ship.x + hazardGeometry({kind: 'barrier'}).hitX + 20,
      y: SHIP_Y + hazardGeometry({kind: 'barrier'}).hitY - 1,
      destroy() {},
    }};
    scene.objects = hitFirst ? [close, hit] : [hit, close];
    frame();
    assert.equal(close.nearMiss.award, true, 'the other obstacle really passes cleanly in this frame');
    assert.equal(scene.runEconomy.closeCallBonusPercent, 0);
    loadCargo(scene, 100);
    scene.awardNearMiss();
    assert.equal(scene.runEconomy.closeCallBonusPercent, 5, 'a later clean pass starts a new unbanked bonus');
  }
});

test('nearmiss collision reset never removes already banked Coins or secured run accounting', () => {
  const {scene, frame} = guardrailRun({shipX: LANE_CENTERS[0], y: lipAbove(1000)});
  loadCargo(scene, 100);
  scene.runEconomy.closeCallBonusPercent = 50;
  const bank = bankCargo(scene.profile, scene.runEconomy, scene.cargoItems);
  scene.profile = bank.profile;
  scene.runEconomy = bank.run;
  loadCargo(scene, 100);
  scene.runEconomy.closeCallBonusPercent = 20;
  frame();
  assert.equal(scene.runEconomy.closeCallBonusPercent, 0);
  assert.equal(scene.profile.coins, 150);
  assert.equal(scene.runEconomy.cargoCoins, 100);
  assert.equal(scene.runEconomy.bonusCoins, 50);
});

test('short and default guardrails stay alive until their full minimum-length tail leaves the screen', () => {
  const cutoff = GAME_BALANCE.routes.geometry.logicalHeightPx + 60;
  for (const lengthPx of [undefined, 160]) {
    const run = guardrailRun({kind: 'sideRail', lengthPx: 160, shipX: LANE_CENTERS[1], y: 1000});
    run.hazard.lengthPx = lengthPx;
    run.hazard.sprite.y = cutoff + hazardGeometry(run.hazard).height / 2 - 1;
    run.scene.update(0, 0);
    assert.equal(run.scene.objects.length, 1, 'do not cull using the obsolete raw short length');
    assert.deepEqual(run.destroyed, []);
    run.hazard.sprite.y += 2;
    run.scene.update(0, 0);
    assert.equal(run.scene.objects.length, 0);
    assert.deepEqual(run.destroyed, ['structure']);
  }
});

test('a guardrail lip hit head-on by the cab costs one hull point through the standard crash path', () => {
  const run = guardrailRun({shipX: LANE_CENTERS[0], y: lipAbove(1000)});
  run.frame();
  assert.equal(run.scene.hull, 2);
  assert.equal(run.hits.length, 1, 'hit VFX and camera shake play once');
  assert.deepEqual(run.destroyed, ['structure']);
  assert.equal(run.scene.objects.length, 0);
  assert.equal(run.scene.runEconomy.damagingHits, 1);
  const fatal = guardrailRun({kind: 'sideRail', shipX: LANE_CENTERS[0], y: lipAbove(1000)});
  fatal.scene.hull = 1;
  fatal.frame();
  assert.equal(fatal.scene.phase, 'crashing', 'a fatal lip impact uses the standard crash recovery');
});

test('steering into a guardrail flank clamps the cab without damage and grinds sparks at the contact', () => {
  const half = HAZARDS.sideWall.width / 2 - 2;
  const wall = hazardX({kind: 'sideWall', lane: 0}) + half;
  const run = guardrailRun({shipX: 215, targetX: LANE_CENTERS[0], y: SHIP_Y});
  run.scene.shieldCharges = 3;
  let touched = false;
  for (let i = 0; i < 30; i++) {
    run.frame();
    assert.ok(run.scene.ship.x >= wall + GAME_BALANCE.hazards.playerHalfWidthPx - 1e-9, 'cab never enters the wall');
    if (run.grind.emitter.emitting) {
      touched = true;
      assert.deepEqual([run.grind.anchor.x, run.grind.anchor.y, run.grind.anchor.side], [wall, SHIP_Y, 1]);
      assert.ok(run.scene.shipVelocityX >= 0, 'lateral velocity into the wall is cancelled');
      assert.ok(run.scene.ship.x >= wall + GAME_BALANCE.hazards.playerHalfWidthPx + 1.5 - 1e-9,
        'active grind adds a small bounded repulsion into the clear corridor');
    }
  }
  assert.ok(touched, 'sparks show while steering against the wall');
  assert.equal(run.scene.hull, 3, 'zero hull damage');
  assert.equal(run.scene.shieldCharges, 3, 'a non-damaging wall grind does not consume shields');
  assert.equal(run.scene.objects.length, 1, 'the guardrail is never destroyed by a scrape');
  assert.equal(run.hits.length, 0);
  for (let i = 0; i < 10; i++) {
    run.frame();
    assert.equal(run.grind.emitter.emitting, true, 'held grinding stays continuous despite minor repulsion');
  }
  run.scene.shipTargetX = 300;
  for (let i = 0; i < 20; i++) run.frame();
  assert.equal(run.grind.emitter.emitting, false, 'sparks stop once the player steers away');

  const right = guardrailRun({lane: 3, shipX: 175, targetX: LANE_CENTERS[3], y: SHIP_Y});
  const rightWall = hazardX({kind: 'sideWall', lane: 3}) - half;
  for (let i = 0; i < 30; i++) {
    right.frame();
    assert.ok(right.scene.ship.x <= rightWall - GAME_BALANCE.hazards.playerHalfWidthPx + 1e-9);
  }
  assert.equal(right.grind.anchor.side, -1, 'right-shoulder walls mirror the clamp and sparks');
  assert.equal(right.scene.hull, 3);
});

test('a cab straddling the entry ramp is deflected to the open lane, not damaged', () => {
  const lip = HAZARDS.sideWall.width / 2 - 2 - GAME_BALANCE.hazards.guardrail.rampLateralPx;
  const x = hazardX({kind: 'sideWall', lane: 0}) + lip + GAME_BALANCE.hazards.playerHalfWidthPx + 4;
  const run = guardrailRun({shipX: x, y: lipAbove(1000)});
  for (let i = 0; i < 90; i++) run.frame();
  assert.equal(run.scene.hull, 3);
  assert.equal(run.scene.objects.length, 1);
  assert.ok(run.scene.ship.x > x + 15, 'the ramp pushed the cab clear of the blocked lane');
});

test('an invulnerable cab ghosts through the lip and is hit if it is still inside when protection ends', () => {
  const run = guardrailRun({shipX: LANE_CENTERS[0], y: lipAbove(1000)});
  run.scene.invulnerable = 0.06;
  run.frame();
  assert.equal(run.scene.hull, 3);
  assert.equal(run.scene.objects.length, 1);
  assert.equal(run.scene.ship.x, LANE_CENTERS[0], 'a ghosting cab is not teleported out of the blocked lane');
  for (let i = 0; i < 10 && run.scene.objects.length; i++) run.frame();
  assert.equal(run.scene.hull, 2);
  assert.equal(run.scene.objects.length, 0);
});

test('trailing cargo is cosmetic: a guardrail alongside only the trailers never collides', () => {
  const back = SHIP_Y + GAME_BALANCE.hazards.playerHalfHeightPx + 1;
  const run = guardrailRun({shipX: LANE_CENTERS[0], y: back + 1000 / 2 - 2});
  run.scene.cargoIndicators = [0, 1, 2, 3].map(i => ({x: LANE_CENTERS[0], y: SHIP_Y + 46 + i * 29}));
  for (let i = 0; i < 10; i++) run.frame();
  assert.equal(run.scene.hull, 3);
  assert.equal(run.scene.ship.x, LANE_CENTERS[0]);
  assert.equal(run.scene.objects.length, 1);
  assert.equal(run.grind.emitter.emitting, false);
  assert.ok(isGuardrail(run.hazard) && !isGuardrail('divider'));
  assert.equal(guardrailContact(run.hazard, run.hazard.sprite.x, run.hazard.sprite.y, LANE_CENTERS[0], SHIP_Y), null);
});

test('menu buttons consume pointer events before starting or resuming driving', () => {
  const scene = new Scene();
  scene.overlayObjects = [];
  scene.add = {text: () => ({width: 120, height: 18, displayHeight: 18,
    setOrigin() { return this; }, setDepth() { return this; }, setScale() { return this; }})};
  let stopped = false;
  let acted = false;
  scene.addButton('START A RUN', 458, () => {
    assert.ok(stopped, 'otherwise the same pointer event can become a steering command');
    acted = true;
  });
  const pointer = {id: 1, x: 300, y: 458, getDistance: () => 0};
  scene.button.pointerdown(pointer, 0, 0, {stopPropagation() { stopped = true; }});
  assert.ok(!acted, 'actions must wait for a deliberate release');
  scene.button.pointerup(pointer, 0, 0, {stopPropagation() { stopped = true; }});
  assert.ok(acted);
});

test('audio UI click plays once after valid button action, never for drags, pointer cancellation or repeated releases', () => {
  const scene = new Scene();
  scene.overlayObjects = [];
  scene.add = {text: () => ({width: 120, height: 18, displayHeight: 18,
    setOrigin() { return this; }, setDepth() { return this; }, setScale() { return this; }})};
  const event = {stopPropagation() {}};
  let actions = 0;
  const calls = attachFeedbackSpy(scene);
  scene.addButton('REPAIR', 420, () => {
    assert.equal(calls.filter(call => call.method === 'uiClick').length, 0, 'sound follows action/reset');
    actions++;
  });
  const pointer = {id: 1, x: 195, y: 420, getDistance: () => 0};
  const control = scene.button;
  control.pointerdown(pointer, 0, 0, event);
  control.pointermove({...pointer, x: 225});
  control.pointerup(pointer, 0, 0, event);
  assert.equal(actions, 0, 'dragging away and back is not a tap');
  control.pointerdown(pointer, 0, 0, event);
  control.pointerout();
  control.pointerup(pointer, 0, 0, event);
  assert.equal(actions, 0);
  control.pointerdown(pointer, 0, 0, event);
  control.pointerup({...pointer, id: 2}, 0, 0, event);
  assert.equal(actions, 0, 'different fingers cannot complete the purchase');
  control.pointerdown(pointer, 0, 0, event);
  control.pointerup(pointer, 0, 0, event);
  control.pointerup(pointer, 0, 0, event);
  assert.equal(actions, 1);
  assert.equal(calls.filter(call => call.method === 'uiClick').length, 1);
});

test('audio UI tile clicks fire only for a valid tap, not an aborted, dragged or foreign-pointer release', () => {
  const scene = new Scene();
  const calls = attachFeedbackSpy(scene);
  scene.menuControlContainsPointer = () => true;
  scene.clipMenuControl = () => {};
  const handlers = {};
  const tile = {setInteractive() { return this; }, setAlpha() { return this; },
    on(name, action) { handlers[name] = action; return this; }};
  let actions = 0;
  scene.bindTilePress(tile, () => actions++);
  const pointer = {id: 1, x: 195, y: 400, getDistance: () => 0};
  const event = {stopPropagation() {}};
  const down = () => handlers.pointerdown(pointer, 0, 0, event);
  const up = p => handlers.pointerup(p, 0, 0, event);
  down();
  handlers.pointermove({...pointer, y: 430});
  up(pointer);
  down();
  handlers.pointerout();
  up(pointer);
  down();
  up({...pointer, id: 2});
  assert.equal(actions, 0);
  assert.equal(calls.length, 0);
  down();
  up(pointer);
  up(pointer);
  assert.equal(actions, 1);
  assert.equal(calls.filter(call => call.method === 'uiClick').length, 1);
});

test('Depot button gestures cannot steer on resume without a fresh road pointerdown', () => {
  const scene = depotScene();
  scene.sys = {game: {device: {input: {touch: true}}}};
  scene.distance = 450;
  scene.showDepot();
  scene.steeringPointerId = 1;
  scene.resumeAfterDepot();
  scene.moveSteering({id: 1, x: 317, y: 584, isDown: true});
  assert.equal(scene.shipTargetX, 195);
  scene.beginSteering({id: 1, x: 305, y: 60});
  scene.moveSteering({id: 1, x: 317, y: 584, isDown: true});
  assert.equal(scene.shipTargetX, 195, 'HUD touches are not gameplay gestures');
  scene.beginSteering({id: 2, x: 305, y: 600});
  scene.moveSteering({id: 2, x: 300, y: 600, isDown: true});
  assert.equal(scene.shipTargetX, 300);
});

test('touch release pauses an active run while mouse release does not', () => {
  const scene = depotScene();
  scene.endMenuScroll = () => {};
  let pauses = 0;
  scene.pauseRun = () => { pauses++; scene.phase = 'paused'; };
  scene.phase = 'running';
  scene.steeringPointerId = 1;
  scene.handlePointerUp({id: 1, wasTouch: false});
  assert.equal(scene.phase, 'running');
  assert.equal(pauses, 0);
  scene.handlePointerUp({id: 1, wasTouch: true});
  assert.equal(scene.phase, 'paused');
  assert.equal(pauses, 1);
  scene.phase = 'menu';
  scene.handlePointerUp({id: 2, wasTouch: true});
  assert.equal(pauses, 1, 'touches in menus do not pause a run');
});

function pauseLabel(text = '', y = 0, size = 24) {
  return {text, y, height: size * 1.25, displayHeight: size * 1.25, scaleX: 1,
    setDepth() { return this; }, setOrigin() { return this; },
    setScale(value) { this.scaleX = value; this.displayHeight = this.height * value; return this; },
    setText(value) { this.text = value; return this; }};
}

test('Space pauses, then resumes only after a frozen three-second countdown', () => {
  const scene = depotScene();
  const feedback = [];
  scene.feedback = {
    suspend: (reason, options) => {
      assert.notEqual(options?.music, false, 'manual pause must suspend music too');
      feedback.push(['suspend', reason]);
    },
    resume: reason => feedback.push(['resume', reason]),
  };
  scene.hudContainer = {visible: true, setVisible(value) { this.visible = value; }};
  scene.showPauseOverlay = (title, dimAlpha, panelHeight) => {
    scene.panelTitle = title;
    scene.pauseDimAlpha = dimAlpha;
    scene.pausePanelHeight = panelHeight;
    return pauseLabel(title, 422 - panelHeight / 2 + 18);
  };
  scene.addButton = (label, y, action) => { if (label === 'RESUME RUN') scene.resumeAction = action; };
  scene.addLabel = (text, _x, y, size) => pauseLabel(text, y, size);
  const startDistance = scene.distance;

  scene.handlePauseKey();
  assert.equal(scene.phase, 'paused');
  assert.equal(scene.panelTitle, 'PAUSED');
  assert.equal(scene.pauseDimAlpha, 0.2);
  assert.equal(scene.pausePanelHeight, 272);
  assert.equal(scene.hudContainer.visible, true, 'the HUD stays visible beneath the dimmer');
  assert.deepEqual(feedback, [['suspend', 'manualPause']]);
  scene.updateStep(0, 1000);
  assert.equal(scene.distance, startDistance, 'paused updates do not advance the run');
  scene.handlePauseKey({repeat: true});
  assert.equal(scene.phase, 'paused', 'key repeat does not start the countdown');

  scene.handlePauseKey();
  assert.equal(scene.phase, 'resumeCountdown');
  assert.equal(scene.panelTitle, 'GET READY');
  assert.equal(scene.pauseDimAlpha, 0.2);
  assert.equal(scene.pauseCountdownText.text, '3');
  const digit = scene.pauseCountdownText;
  assert.ok(digit.y - digit.displayHeight / 2 >= 422 - 85 + 18 + 30, 'the digit sits below the title');
  assert.ok(digit.y + digit.displayHeight / 2 <= 422 + 85 - MENU_SPACING.padding, 'the digit stays inside the tile');
  for (let frame = 0; frame < 20; frame++) scene.updateStep(0, 50);
  assert.equal(scene.pauseCountdownText.text, '2');
  for (let frame = 0; frame < 20; frame++) scene.updateStep(0, 50);
  assert.equal(scene.pauseCountdownText.text, '1');
  for (let frame = 0; frame < 19; frame++) scene.updateStep(0, 50);
  assert.equal(scene.phase, 'resumeCountdown');
  assert.equal(scene.distance, startDistance, 'countdown updates do not advance the run');
  scene.updateStep(0, 50);
  assert.equal(scene.phase, 'running');
  assert.equal(scene.hudContainer.visible, true);
  assert.deepEqual(feedback, [['suspend', 'manualPause'], ['resume', 'manualPause']]);
  assert.equal(scene.distance, startDistance);
});

test('pause sound toggle changes the shared mute setting without resuming or overlapping controls', () => {
  const scene = depotScene();
  const buttons = [];
  let resumes = 0, panelHeight;
  scene.feedback = {suspend() {}, resume() { resumes++; }};
  scene.showPauseOverlay = (_title, _alpha, height) => { buttons.length = 0; panelHeight = height; return pauseLabel(); };
  scene.addButton = (label, y, action, options) => buttons.push({label, y, action, ...options});
  scene.addLabel = text => pauseLabel(text);
  // Phaser WebAudio schedules the gain change, so its mute getter stays stale immediately after setMute.
  const muteRequests = [];
  scene.sound = {mute: false, setMute(value) { muteRequests.push(value); return this; }};
  let fades = 0;
  scene.fadeOverlayIn = () => { fades++; };
  const distance = scene.distance;
  scene.pauseRun();
  assert.deepEqual(buttons.map(button => button.label), ['RESUME RUN', 'SOUND: ON', 'END RUN']);
  buttons[1].action();
  assert.deepEqual(muteRequests, [true]);
  assert.equal(buttons[1].label, 'SOUND: OFF', 'the label updates live despite the stale getter');
  assert.equal(fades, 1, 'toggling rebuilds the menu without replaying the fade');
  assert.equal(scene.phase, 'paused');
  assert.equal(scene.distance, distance);
  assert.equal(resumes, 0);
  for (let index = 0; index < buttons.length; index++) {
    const button = buttons[index];
    assert.ok(button.y - button.height / 2 >= 422 - panelHeight / 2 + MENU_SPACING.padding);
    assert.ok(button.y + button.height / 2 <= 422 + panelHeight / 2 - MENU_SPACING.padding);
    if (index) {
      const previous = buttons[index - 1];
      assert.ok(button.y - button.height / 2 - (previous.y + previous.height / 2) >= MENU_SPACING.gap);
    }
  }
  buttons[1].action();
  assert.deepEqual(muteRequests, [true, false]);
  assert.equal(buttons[1].label, 'SOUND: ON');
  buttons[0].action();
  assert.equal(scene.phase, 'resumeCountdown');
  assert.equal(resumes, 0, 'music remains paused throughout the countdown');
});

test('pause overlays keep gameplay camera framing on resize instead of restoring a stale menu', () => {
  const scene = new Scene();
  let rerenders = 0;
  scene.phase = 'pauseEndConfirm';
  scene.screenRenderer = () => { rerenders++; };
  scene.scale = {width: 320, height: 568};
  scene.cameras = {main: {setZoom(value) { this.zoom = value; }, setScroll(x, y) {
    this.scrollX = x;
    this.scrollY = y;
  }}};
  scene.hudContainer = {setScale() { return this; }, setPosition() { return this; }};
  scene.hudBacking = {setDisplaySize() { return this; }};
  scene.syncViewportBackdrop = () => {};
  scene.syncRoadBleed = () => {};
  scene.handleViewportResize({width: 320, height: 568});
  assert.equal(scene.cameras.main.zoom, Math.min(320 / 390, 568 / 844));
  assert.equal(rerenders, 0, 'pause is not a management screen and cannot repaint the prior menu');
  assert.equal(scene.menuHeight, responsiveViewport(320, 568, 390).worldHeight);
});

test('mobile re-pause is blocked for exactly two seconds after the resume fade completes', () => {
  const scene = depotScene();
  scene.endMenuScroll = () => {};
  scene.showPauseOverlay = () => pauseLabel();
  scene.addLabel = () => pauseLabel();
  let finishFade;
  scene.fadeOverlayOut = complete => { finishFade = complete; };
  const touch = {id: 1, wasTouch: true};
  scene.handlePointerUp(touch);
  assert.equal(scene.phase, 'paused', 'the first touch release can pause immediately');
  scene.beginResumeCountdown();
  scene.time.now = 3000;
  for (let frame = 0; frame < 60; frame++) scene.updateStep(0, 50);
  assert.equal(scene.phase, 'resumeTransition');
  scene.time.now = 3200;
  finishFade();
  assert.equal(scene.phase, 'running');
  scene.handlePointerUp(touch);
  assert.equal(scene.phase, 'running', 'releasing Resume cannot immediately pause again');
  scene.time.now = 5199.999;
  scene.handlePointerUp(touch);
  assert.equal(scene.phase, 'running', 'the entire two-second interval is protected');
  scene.time.now = 5200;
  scene.handlePointerUp(touch);
  assert.equal(scene.phase, 'paused', 'touch pause works again at the exact boundary');
  scene.beginResumeCountdown();
  for (let frame = 0; frame < 60; frame++) scene.updateStep(0, 50);
  scene.time.now = 8200;
  finishFade();
  scene.handlePointerUp(touch);
  assert.equal(scene.phase, 'running', 'each resume starts a new cooldown');
  scene.handlePauseKey();
  assert.equal(scene.phase, 'paused', 'Space is never blocked by the mobile cooldown');
});

test('a fresh run clears the previous mobile re-pause cooldown', () => {
  const scene = depotScene();
  scene.touchPauseBlockedUntil = 2000;
  scene.startRun('beginning', 'level1', 'normal');
  scene.endMenuScroll = () => {};
  scene.showPauseMenu = () => {};
  scene.handlePointerUp({id: 1, wasTouch: true});
  assert.equal(scene.phase, 'paused');
});

test('pause End Run confirmation shows secured and unbanked Normal amounts and waits for confirmation', () => {
  const scene = depotScene();
  scene.profile.coins = 250;
  scene.runEconomy.cargoCoins = 80;
  scene.runEconomy.bonusCoins = 10;
  scene.runEconomy.noDamageBonusPending = 5;
  scene.cargoItems = [{kind: 'coinStack', value: 30, mass: 1, slots: 1}];
  const actions = [];
  const labels = [];
  const currency = [];
  let confirmationHeight;
  let footerY;
  scene.add = {rectangle() { return {setStrokeStyle() { return this; }, setDepth() { return this; }}; }};
  scene.feedback = {suspend() {}};
  scene.showPauseOverlay = (title, _dim, height) => {
    scene.overlayTitle = title;
    confirmationHeight = height;
  };
  scene.addFooterActions = (entries, options) => {
    actions.splice(0, actions.length, ...entries);
    footerY = options.y;
  };
  scene.addButton = (label, y, onClick) => actions.push({label, onClick});
  scene.addCard = () => {};
  scene.addLabel = (text, _x, y, size, _color, width) => {
    const lines = Math.ceil(text.length * size * 0.56 / width);
    const height = lines * size * 1.2 + Math.max(0, lines - 1) * 7;
    labels.push({text, y, height, size, width, lines});
    return {height, displayHeight: height, setDepth() { return this; }};
  };
  scene.addCurrency = value => { currency.push(value); return {}; };
  let settlementArgs = null;
  scene.finishRun = (...args) => { settlementArgs = args; };

  scene.phase = 'running';
  scene.pauseRun();
  assert.deepEqual(actions.map(action => action.label), ['RESUME RUN', 'SOUND: ON', 'END RUN']);
  actions.find(action => action.label === 'END RUN').onClick();
  assert.equal(scene.phase, 'pauseEndConfirm');
  assert.equal(scene.overlayTitle, 'END RUN?');
  assert.deepEqual(currency, [90, 30]);
  assert.equal(scene.profile.coins, 250, 'the existing wallet remains safe');
  assert.ok(labels.some(label => label.text.includes('LOSE 35 COINS')),
    'normal confirmation includes cargo and unbanked bonuses at risk');
  const warning = labels.find(label => label.text.includes('LOSE 35 COINS'));
  const footerTop = footerY - 27;
  assert.ok(warning.y + warning.height + 8 <= footerTop,
    'the complete measured loss warning clears the fixed confirmation buttons');
  assert.equal(confirmationHeight, 384, 'the confirmation panel contains its measured warning and actions');
  assert.deepEqual(actions.map(action => action.label), ['BACK TO PAUSE', 'END RUN']);
  actions[0].onClick();
  assert.equal(scene.phase, 'paused', 'cancel returns to the pause menu without settling');
  assert.equal(settlementArgs, null);
  scene.showPauseEndRunConfirmation();
  actions[1].onClick();
  assert.deepEqual(settlementArgs, [false, false, true]);

  scene.phase = 'paused';
  scene.cargoItems = [{kind: 'coinStack', value: Number.MAX_SAFE_INTEGER, mass: 1, slots: 1}];
  labels.length = 0;
  scene.showPauseEndRunConfirmation();
  const formattedLongTotal = String(
    bankingQuote(scene.cargoItems, scene.runEconomy).payout + scene.runEconomy.noDamageBonusPending);
  const longWarning = labels.find(label => label.text.startsWith('END NOW: LOSE') &&
    label.text.includes(formattedLongTotal));
  assert.ok(longWarning && longWarning.size >= 14 && longWarning.lines > 1,
    'long loss totals retain readable text size and wrap to measured lines');
  assert.ok(longWarning.y + longWarning.height + 8 <= footerY - 27,
    'the wrapped total remains above the pause confirmation controls');
});

test('pause End Run confirmation warns that all Endless cargo and bonuses are lost', () => {
  const scene = depotScene();
  scene.runMode = 'continuous';
  scene.runEconomy.mode = 'continuous';
  scene.runEconomy.continuousPassedDepots = 2;
  scene.runEconomy.closeCallBonusPercent = 5;
  scene.cargoItems = [{kind: 'coinStack', value: 100, mass: 1, slots: 1}];
  const labels = [];
  const currency = [];
  scene.add = {rectangle() { return {setStrokeStyle() { return this; }, setDepth() { return this; }}; }};
  scene.showPauseOverlay = title => { scene.overlayTitle = title; };
  scene.addFooterActions = () => {};
  scene.addCard = () => {};
  scene.addLabel = text => { labels.push(text); return {height: 16, setDepth() { return this; }}; };
  scene.addCurrency = value => { currency.push(value); return {}; };
  scene.phase = 'paused';
  scene.showPauseEndRunConfirmation();
  assert.deepEqual(currency, [0, 100]);
  assert.ok(labels.some(label => label.includes('LOSE 125 COINS') &&
    label.includes('CASH OUT AT A DEPOT TO EARN')));
});

test('telemetry blocks pointer steering only inside its 78px screen-pinned band', () => {
  const scene = depotScene();
  for (const width of [320, 390, 1280]) {
    scene.scale = {width};
    scene.centerShip();
    const bottom = 78 * Math.min(width / 390, 1.12);
    scene.beginSteering({id: 1, x: 270, y: bottom});
    assert.equal(scene.shipTargetX, 195, 'the bottom HUD edge is protected');
    scene.beginSteering({id: 1, x: 270, y: bottom + 1});
    assert.equal(scene.shipTargetX, 270, 'road input is available immediately below telemetry');
  }
});

test('desktop hover steering uses world X and road bounds without a mouse button; touch retains gesture ownership', () => {
  const scene = depotScene();
  scene.sys = {game: {device: {input: {touch: false}}}};
  scene.moveSteering({id: 0, x: 500, y: 600, worldX: 270, isDown: false, wasTouch: false});
  assert.equal(scene.shipTargetX, 270, 'world-space target, not browser pixel coordinate');
  assert.equal(scene.steeringInputMode, 'pointer');
  scene.moveSteering({id: 0, x: 500, y: 600, worldX: 999, isDown: false});
  assert.equal(scene.shipTargetX, ROAD_RIGHT - 30);
  scene.moveSteering({id: 0, x: 0, y: 600, worldX: -999, isDown: false});
  assert.equal(scene.shipTargetX, ROAD_LEFT + 30);
  scene.phase = 'depot';
  scene.moveSteering({id: 0, x: 270, y: 600, worldX: 270, isDown: false});
  assert.equal(scene.shipTargetX, ROAD_LEFT + 30, 'hover cannot steer during Depot or menus');
  scene.phase = 'running';
  scene.centerShip();
  scene.sys.game.device.input.touch = true;
  const touch = {id: 1, x: 270, y: 600, isDown: true, wasTouch: true};
  scene.moveSteering(touch);
  assert.equal(scene.shipTargetX, 195, 'touch still requires a fresh down');
  scene.beginSteering(touch);
  scene.moveSteering({...touch, id: 2, x: 100});
  assert.equal(scene.shipTargetX, 270, 'second finger cannot hijack steering');
  scene.moveSteering({...touch, x: 250});
  assert.equal(scene.shipTargetX, 250);
  scene.moveSteering({...touch, x: 100, isDown: false});
  assert.equal(scene.shipTargetX, 250, 'released touch cannot move the target');
});

test('A/D and arrows steer continuously; loaded keyboard release stops within 60 ms and mouse can take over', () => {
  const {scene} = guardrailRun({shipX: 195, y: -10000});
  scene.objects = [];
  scene.cargoWeight = scene.stats.capacity;
  scene.steeringKeys = Object.fromEntries(['A', 'D', 'LEFT', 'RIGHT'].map(key => [key, {isDown: false}]));
  const visualFrames = [];
  scene.syncHaulerVisuals = (dt, scroll) => visualFrames.push({dt, scroll});
  for (const key of ['A', 'LEFT', 'D', 'RIGHT']) {
    scene.centerShip();
    scene.steeringKeys[key].isDown = true;
    for (let frame = 0; frame < 10; frame++) scene.update(frame, 1000 / 120);
    const side = ['A', 'LEFT'].includes(key) ? -1 : 1;
    assert.ok((scene.ship.x - 195) * side > 0);
    assert.ok(scene.shipVelocityX * side > 0);
    const keyboardTarget = scene.shipTargetX;
    scene.moveSteering({id: 0, x: 280, worldX: 280, y: 600, isDown: false});
    scene.beginSteering({id: 0, x: 280, y: 600, isDown: true});
    assert.equal(scene.shipTargetX, keyboardTarget, 'mouse events cannot hijack held keyboard input');
    assert.equal(scene.steeringInputMode, 'keyboard', 'even immediately before key release');
    scene.steeringKeys[key].isDown = false;
    let elapsed = 0;
    while (elapsed < 0.06) {
      const dt = Math.min(1 / 120, 0.06 - elapsed);
      scene.update(0, dt * 1000);
      elapsed += dt;
    }
    assert.ok(Math.abs(scene.shipVelocityX) < 1e-9);
    const stoppedX = scene.ship.x;
    for (let frame = 0; frame < 12; frame++) scene.update(frame, 1000 / 60);
    assert.equal(scene.ship.x, stoppedX, 'mass cannot pull the truck back towards a stale target');
  }
  scene.steeringKeys.A.isDown = scene.steeringKeys.D.isDown = true;
  assert.equal(scene.updateSteeringInput(), true, 'opposing keys brake rather than choosing an arbitrary direction');
  scene.steeringKeys.A.isDown = scene.steeringKeys.D.isDown = false;
  scene.moveSteering({id: 0, x: 285, worldX: 285, y: 600, isDown: false});
  scene.update(0, 1000 / 60);
  assert.equal(scene.steeringInputMode, 'pointer');
  assert.equal(scene.shipTargetX, 285);
  assert.ok(scene.shipVelocityX > 0);
  assert.ok(visualFrames.filter(frame => frame.dt > 0).every(frame => frame.scroll > 0),
    'sway and diesel smoke receive real frame time and road scroll');
});

test('Bank & Continue secures cargo, resets weight and risk, and permits a same-Depot repair', () => {
  const scene = depotScene();
  scene.distance = 450;
  scene.hull = 1;
  loadCargo(scene, 55);
  scene.runEconomy = skipDepot(scene.runEconomy);
  scene.showDepot();
  scene.bankAtDepot();
  assert.equal(scene.phase, 'depot', 'player chose to stay for optional repair');
  assert.equal(scene.profile.coins, 66);
  assert.equal(scene.runEconomy.bonusCoins, 11);
  assert.equal(scene.runEconomy.consecutiveSkips, 0);
  assert.equal(scene.cargoValue, 0);
  assert.equal(scene.cargoWeight, 0);
  assert.equal(scene.cargoSlots, 0);
  assert.equal(scene.hull, 1, 'banking does not repair');
  assert.equal(scene.distance, 450);
  assert.equal(scene.profile.totalRuns, 0);
  scene.bankAtDepot();
  assert.equal(scene.profile.coins, 66);
  assert.equal(scene.runEconomy.bankingEvents, 1);
  scene.repairAtDepot();
  assert.equal(scene.profile.coins, 36);
  assert.equal(scene.hull, 2);
  assert.equal(scene.maxHull, GAME_BALANCE.vehicles.standard.baseStats.hull);
  scene.repairAtDepot();
  assert.equal(scene.profile.coins, 36);
  assert.equal(scene.hull, 2);
  scene.renderDepot();
  scene.showDepot();
  assert.ok(scene.depotVisit.repaired, 'rerender/repeated entry cannot reset the repair limit');
  scene.resumeAfterDepot();
  assert.equal(scene.runEconomy.consecutiveSkips, 0, 'Resume after banking is not Push On');
  assert.equal(scene.distance, 450);
  loadCargo(scene, 25);
  scene.finishRun(false);
  assert.equal(scene.profile.coins, 50, 'secured 66 minus repair30 plus crash distance14');
  assert.equal(scene.runResult.cargoCoins, 55);
  assert.equal(scene.runResult.bonusCoins, 11);
  assert.equal(scene.runResult.distanceCoins, 14);
  assert.equal(scene.runResult.net, 50);
  assert.equal(scene.cargoValue, 0);
  scene.finishRun(false);
  scene.showMenu = () => { scene.phase = 'menu'; };
  scene.showMenu();
  scene.finishRun(false);
  assert.equal(scene.profile.coins, 50, 'results/menu cannot replay a settlement');
  const reloaded = normalizeProfile(savedProfile);
  assert.equal(reloaded.coins, 50);
  assert.equal(reloaded.totalRuns, 1);
});

test('center bypass accrues risk once per facility without banking or changing the cargo', () => {
  const scene = depotScene();
  scene.distance = scene.nextDepotDistance;
  loadCargo(scene, 55);
  const items = scene.cargoItems;
  scene.ship.x = scene.shipTargetX = 195;
  scene.updateDepot();
  scene.updateDepot();
  assert.equal(scene.runEconomy.consecutiveSkips, 1);
  assert.equal(scene.cargoItems, items);
  assert.equal(scene.cargoWeight, 1);
  assert.equal(scene.profile.coins, 0);
  scene.distance = scene.nextDepotDistance + DEPOT_RULES.triggerHalfMeters + 1;
  scene.updateDepot();
  scene.updateDepot();
  assert.equal(scene.runEconomy.consecutiveSkips, 2);
  assert.equal(scene.runEconomy.depotsReached, 2);
  assert.equal(scene.runEconomy.depotsSkipped, 2);
});

test('pickup pulses return to the enlarged chassis art scale instead of shrinking ships or accumulating scale', () => {
  const scene = new Scene();
  scene.ship = {setScale(value) { this.scale = value; return this; }};
  const text = {setScale(value) { this.scale = value; return this; }};
  const tweens = [];
  scene.tweens = {killTweensOf() {}, add(options) { tweens.push(options); }};
  for (const [vehicleId, multiplier] of [['standard', 1], ['swift', 0.92]]) {
    const baseline = multiplier * SPRITE_ART_SCALE * balance.RUN_TRUCK_VISUAL_SCALE;
    scene.vehicleId = vehicleId;
    scene.shipBaseScale = baseline;
    for (let index = 0; index < 3; index++) {
      scene.pulse(scene.ship, 1.18);
      assert.equal(scene.ship.scale, baseline);
      assert.equal(tweens.at(-1).scale, baseline * 1.18);
      assert.equal(tweens.at(-1).yoyo, true);
    }
  }
  scene.pulse(text, 1.08);
  assert.equal(text.scale, 1);
  assert.equal(tweens.at(-1).scale, 1.08, 'text feedback is not enlarged with sprite art');
});

test('failed bank and repair writes leave wallet, cargo, eligibility and run accounting untouched', () => {
  const scene = depotScene();
  scene.profile.coins = 100;
  scene.hull = 1;
  scene.distance = 450;
  loadCargo(scene, 55);
  storageAvailable = false;
  try {
    scene.showDepot();
    const before = JSON.stringify({profile: scene.profile, run: scene.runEconomy, items: scene.cargoItems});
    scene.bankAtDepot();
    scene.repairAtDepot();
    assert.equal(JSON.stringify({profile: scene.profile, run: scene.runEconomy, items: scene.cargoItems}), before);
    assert.equal(scene.hull, 1);
    assert.ok(!scene.depotVisit.repaired && !scene.depotVisit.banked);
  } finally {
    storageAvailable = true;
  }
  scene.bankAtDepot();
  scene.repairAtDepot();
  scene.finishRun(true);
  scene.finishRun(true);
  assert.equal(scene.profile.coins, 125);
  assert.equal(scene.profile.totalRuns, 1);
  assert.equal(scene.runResult.net, 25);
  assert.equal(scene.runResult.cargoCoins, 55);
  assert.equal(scene.runResult.distanceCoins, 0);
});

test('crash settlement retries without success-shaped earnings or duplicate payment', () => {
  const scene = depotScene();
  scene.profile.coins = 80;
  scene.distance = 450;
  loadCargo(scene, 55);
  scene.runEconomy.consecutiveSkips = 3;
  storageAvailable = false;
  try {
    scene.finishRun(false);
    assert.equal(scene.phase, 'crashing');
    assert.equal(scene.profile.coins, 80);
    assert.equal(scene.profile.totalRuns, 0);
    assert.equal(scene.runResult, null);
  } finally {
    storageAvailable = true;
  }
  scene.finishRun(false);
  scene.finishRun(false);
  assert.equal(scene.profile.coins, 94);
  assert.equal(scene.runResult.bonusCoins, 0);
  assert.equal(scene.runResult.cargoCoins, 0);
  assert.equal(scene.runResult.distanceCoins, 14);
});

test('depot Bank & Continue leaves only disabled Banked, Resume Run and Repair Hull, hides HUD until resume', () => {
  const scene = depotScene();
  scene.profile.seenHints = ['depotEconomy'];
  scene.distance = 450;
  scene.hull = 1;
  loadCargo(scene, 55);
  const buttons = [];
  const labels = [];
  scene.hudContainer = {visible: true, setVisible(value) { this.visible = value; return this; }};
  scene.panel = () => { buttons.length = 0; };
  scene.addButton = (label, y, action, options = {}) => buttons.push({label, y, action, ...options});
  scene.addLabel = (label, x, y) => {
    labels.push({label, x, y});
    return {height: 16, setOrigin() { return this; }, setAlign() { return this; },
      setLineSpacing() { return this; }};
  };
  scene.showDepot();
  assert.ok(buttons.find(b => b.label.startsWith('REPAIR')).disabled, 'unbanked cargo cannot pay repairs');
  assert.ok(buttons.some(b => b.label === 'BANK & CONTINUE' && !b.disabled));
  assert.ok(buttons.some(b => b.label === 'BANK & END RUN'));
  const staleEnd = buttons.find(b => b.label === 'BANK & END RUN').action;
  assert.equal(scene.hudContainer.visible, false);
  assert.ok(buttons.every(b => b.height >= 48 && b.y - b.height / 2 > 460 && b.y + b.height / 2 < 760));
  const distance = scene.distance;
  scene.update(0, 1000);
  assert.equal(scene.distance, distance, 'Depot UI pauses movement and hazards');
  buttons.find(b => b.label === 'BANK & CONTINUE').action();
  assert.deepEqual(buttons.map(b => b.label), ['REPAIR +1 HULL', 'CARGO SECURED', 'RESUME RUN']);
  assert.equal(buttons.find(b => b.label === 'CARGO SECURED').disabled, true);
  assert.equal(scene.hudContainer.visible, false, 'banking does not reveal the HUD');
  staleEnd();
  assert.deepEqual(buttons.map(b => b.label), ['REPAIR +1 HULL', 'CARGO SECURED', 'RESUME RUN'],
    'a stale end callback cannot restore the removed terminal option');
  assert.ok(!buttons.findLast(b => b.label.startsWith('REPAIR')).disabled);
  assert.ok(buttons.some(b => b.label === 'RESUME RUN'));
  assert.ok(scene.uiRows.some(l => l.label === 'Wallet' && l.value === 55 && l.coin));
  buttons.findLast(b => b.label.startsWith('REPAIR')).action();
  assert.ok(buttons.findLast(b => b.label.startsWith('REPAIR')).disabled);
  assert.ok(scene.uiRows.some(l => l.label === 'Wallet' && l.value === 25 && l.coin));
  assert.equal(scene.hull, 2);
  assert.equal(scene.profile.totalRuns, 0);
  assert.equal(scene.hudContainer.visible, false, 'repair does not reveal the HUD');
  buttons.findLast(b => b.label === 'RESUME RUN').action();
  assert.equal(scene.phase, 'running');
  assert.equal(scene.hudContainer.visible, true);
  assert.equal(scene.profile.coins, 25);
});

test('a later Depot keeps the run repair unavailable after Continue with a clear disabled reason', () => {
  const scene = depotScene();
  scene.profile.coins = 100;
  scene.profile.seenHints = ['depotEconomy'];
  scene.distance = 450;
  scene.hull = 1;
  const buttons = [];
  const labels = [];
  scene.panel = () => {};
  scene.addButton = (label, y, action, options = {}) => buttons.push({label, action, ...options});
  scene.addLabel = label => {
    labels.push(label);
    return {height: 16, displayHeight: 16, setLineSpacing() { return this; }};
  };
  scene.showDepot();
  scene.repairAtDepot();
  assert.equal(scene.runEconomy.repairPurchases, 1);
  scene.bankAtDepot();
  scene.resumeAfterDepot();
  assert.equal(scene.phase, 'running');
  const balance = scene.profile.coins;

  scene.phase = 'depot';
  scene.distance = 950;
  scene.nextDepotDistance = 1000;
  scene.depotVisit = {distance: 1000, repaired: false, banked: false, bankFailed: false, secured: 0};
  scene.renderDepot();
  const repairButton = buttons.findLast(button => button.label === 'REPAIR +1 HULL');
  assert.equal(repairButton.disabled, true);
  assert.ok(labels.includes('One repair used this run'));
  repairButton.action();
  assert.equal(scene.profile.coins, balance);
  assert.equal(scene.runEconomy.repairPurchases, 1);
});

test('narrow-viewport Depot keeps measured repair guidance, actions and footer copy inside the visible route', () => {
  const scene = depotScene();
  scene.profile.coins = 100;
  scene.profile.seenHints = ['depotEconomy'];
  scene.runEconomy.repairPurchases = 1;
  scene.distance = 450;
  scene.hull = 1;
  scene.scale = {width: 320, height: 568};
  const zoom = Math.min(320 / 390, 568 / 844);
  const buttons = [];
  const labels = [];
  scene.addButton = (text, y, action, options = {}) =>
    buttons.push({text, y, action, height: options.height ?? 54, width: options.width ?? 326,
      x: options.x ?? 195, disabled: options.disabled});
  scene.addLabel = (text, x, y, size, _color, width = 360) => {
    const availableWidth = Math.max(1, Math.min(width, 2 * Math.min(x - 32, 390 - 32 - x)));
    const lines = Math.max(1, Math.ceil(text.length * size * 0.6 / availableWidth));
    const node = {text, x, y, height: lines * size * 1.2, displayHeight: lines * size * 1.2};
    node.setLineSpacing = gap => {
      node.height += Math.max(0, lines - 1) * gap;
      node.displayHeight = node.height;
      return node;
    };
    labels.push(node);
    return node;
  };
  scene.showDepot();

  const repair = buttons.find(button => button.text === 'REPAIR +1 HULL');
  const bank = buttons.find(button => button.text === 'BANK & CONTINUE');
  const reason = labels.find(label => label.text === 'One repair used this run');
  assert.equal(repair.disabled, true);
  assert.ok(reason.y >= repair.y + repair.height / 2);
  assert.ok(reason.y + reason.height <= bank.y - bank.height / 2);
  assert.ok(buttons.every(button => button.y + button.height / 2 <= 844));
  assert.ok(labels.every(label => label.y + label.height <= 844));
  assert.ok(labels.at(-1).y * zoom + labels.at(-1).height * zoom <= 568,
    'the final hint stays inside the 320 x 568 physical viewport');
  assert.ok(buttons.every(button =>
    (button.x - 195 - button.width / 2) * zoom + 160 >= 0 &&
    (button.x - 195 + button.width / 2) * zoom + 160 <= 320));
});

test('depot manual banking resets capped risk even for an empty hold and replaces Push On with Resume', () => {
  const scene = depotScene();
  scene.profile.seenHints = ['depotEconomy'];
  scene.distance = 3450;
  scene.runEconomy.consecutiveSkips = 3;
  const buttons = [];
  scene.addButton = (label, y, action, options = {}) => buttons.push({label, y, action, ...options});
  scene.showDepot();
  assert.equal(scene.runEconomy.consecutiveSkips, 3);
  assert.ok(buttons.some(button => button.label === 'PUSH ON  •  BONUS CAPPED'));
  scene.bankAtDepot();
  assert.equal(scene.runEconomy.consecutiveSkips, 0);
  assert.ok(buttons.some(button => button.label === 'RESUME RUN'));
  assert.ok(!buttons.some(button => button.label.includes('+20%')));
});

test('depot Bank & End Run remains available before banking, confirms, keeps HUD hidden and retries terminal save safely', () => {
  const scene = depotScene();
  scene.profile.seenHints = ['depotEconomy'];
  scene.hudContainer = {visible: true, setVisible(value) { this.visible = value; return this; }};
  loadCargo(scene, 100);
  const buttons = [];
  scene.panel = () => { buttons.length = 0; };
  scene.addButton = (label, y, action, options = {}) => buttons.push({label, action, ...options});
  scene.showDepot();
  assert.equal(scene.profile.coins, 0);
  buttons.find(button => button.label === 'BANK & END RUN').action();
  assert.equal(scene.phase, 'depot');
  assert.equal(scene.hudContainer.visible, false);
  const end = buttons.find(button => button.label === 'CONFIRM BANK & END RUN').action;
  storageAvailable = false;
  try {
    end();
    assert.equal(scene.phase, 'depot');
    assert.equal(scene.profile.coins, 0);
    assert.equal(scene.cargoValue, 100);
    assert.equal(scene.hudContainer.visible, false);
  } finally { storageAvailable = true; }
  end();
  end();
  assert.equal(scene.phase, 'result');
  assert.equal(scene.profile.coins, 100);
  assert.equal(scene.profile.totalRuns, 1);
});

test('compact telemetry HUD keeps three bounded columns and stays screen-pinned through resize and zoom bursts', () => {
  const scene = depotScene();
  const node = (x, y, width = 0, height = 0) => ({x, y, width, height, scaleX: 1, scaleY: 1,
    setOrigin() { return this; }, setDepth(depth) { this.depth = depth; return this; },
    setScrollFactor(value) { this.scrollFactor = value; return this; },
    setVisible(value) { this.visible = value; return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    setScale(x, y = x) { this.scaleX = x; this.scaleY = y; return this; },
    setDisplaySize(w, h) { this.width = w; this.height = h; return this; },
    setFillStyle() { return this; }, setColor() { return this; },
    setText(value) { this.text = value; this.width = value.length * this.size * 0.6; return this; }});
  scene.add = {
    text: (x, y, label, style) => {
      const text = node(x, y);
      text.size = parseInt(style.fontSize);
      text.height = text.size * 1.2;
      return text.setText(label);
    },
    rectangle: (x, y, width, height) => node(x, y, width, height),
    image: (x, y) => node(x, y),
    graphics: () => ({rects: [], hexes: [], clear() { this.rects = []; this.hexes = []; return this; },
      setVisible(value) { this.visible = value; return this; },
      fillStyle(color) { this.color = color; return this; },
      fillPoints(points) { this.hexes.push({points, color: this.color}); return this; },
      lineStyle() { return this; }, strokePoints() { return this; },
      fillRect(...args) { this.rects.push(args); return this; }}),
    container: (x, y, children) => Object.assign(node(x, y), {children}),
  };
  scene.buildHud();
  scene.refreshHud = Scene.prototype.refreshHud;
  scene.distance = 375;
  loadCargo(scene, 9999999);
  scene.hull = 2;
  scene.stats.shieldCapacity = 3;
  scene.shieldCharges = 2;
  scene.refreshHud();
  assert.equal(scene.hudContainer.depth, 100);
  assert.equal(scene.hudContainer.scrollFactor, 0);
  assert.equal(scene.hudBacking.height, 78);
  assert.equal(scene.hud.hullPips.rects.length, scene.maxHull);
  assert.equal(scene.hud.shield.text, 'SHIELD 2/3');
  assert.equal(scene.hud.shieldPips.hexes.length, 3);
  assert.deepEqual(scene.hud.shieldPips.hexes.map(hex => hex.color),
    [PALETTE.cyan, PALETTE.cyan, PALETTE.steelDark]);
  const hullEnd = Math.max(...scene.hud.hullPips.rects.map(([x, , width]) => x + width));
  for (const hex of scene.hud.shieldPips.hexes) {
    assert.equal(hex.points.length, 6);
    assert.ok(hex.points.every(point => point.x > hullEnd && point.x < 360 &&
      point.y >= 18 && point.y <= 28), 'hex pips stay beside the hull bar inside the right column');
  }
  scene.shieldCharges = 0;
  scene.refreshHud();
  assert.ok(scene.hud.shieldPips.hexes.every(hex => hex.color === PALETTE.steelDark));
  assert.equal(scene.hud.shield.text, 'SHIELD 0/3', 'empty shield shows capacity, not a countdown');
  for (const [key, width] of [['distanceLabel',114], ['distance',116], ['depot',116], ['cargo',91],
    ['bonus',140], ['closeCallBonus',140]]) {
    const text = scene.hud[key];
    assert.ok(text.width * text.scaleX <= width + 1e-9);
    assert.ok(text.y + text.height <= 78);
  }
  assert.equal(scene.hud.bonus.x, scene.hud.distance.x);
  assert.equal(scene.hud.closeCallBonus.x, scene.hud.distance.x);
  assert.notEqual(scene.hud.bonus.y, scene.hud.closeCallBonus.y);
  assert.equal(scene.hud.bonus.size * scene.hud.bonus.scaleX, 10, '25% larger without shrinking it back');
  assert.equal(scene.hud.closeCallBonus.size * scene.hud.closeCallBonus.scaleX, 10);
  assert.ok(scene.hud.bonus.y + scene.hud.bonus.height <= scene.hud.closeCallBonus.y);
  assert.equal(Object.hasOwn(scene.hud, 'handling'), false);
  for (const [width, height] of [[390,844], [320,690], [1280,720]]) {
    scene.scale = {width, height};
    scene.viewportWorldWidth = width;
    scene.viewportWorldHeight = height;
    scene.cameras = {main: {setZoom(value) { this.zoom = value; },
      setScroll(x,y) { this.scrollX=x; this.scrollY=y; }}};
    for (const factor of [1, 0.94]) {
      scene.roadEnvironment = {zoom: {factor}};
      scene.syncResponsiveCamera();
      const zoom = scene.cameras.main.zoom;
      assert.ok(Math.abs((scene.hudContainer.y - height / 2) * zoom + height / 2) < 1e-9);
      assert.ok(Math.abs(scene.hudContainer.scaleX * zoom - Math.min(width / 390,1.12)) < 1e-9);
    }
  }
});

test('run side areas stay plain and repeated shoulder scenery stays hidden after resize', () => {
  const scene = depotScene();
  const draws = [];
  scene.viewportBackdrop = {
    clear() { draws.length = 0; return this; },
    fillStyle(color) { draws.push(['color', color]); return this; },
    fillRect(...rect) { draws.push(['rect', ...rect]); return this; },
  };
  scene.phase = 'running';
  for (const [width, height] of [[390, 844], [1280, 720]]) {
    scene.scale = {width, height};
    scene.syncViewportBackdrop();
    assert.deepEqual(draws, [['color', 0x080c14], ['rect', 0, 0, width, height]]);
  }
  scene.roadSurface = {};
  scene.roadFlanks = Array.from({length: 4}, () => ({
    visible: true, setVisible(value) { this.visible = value; return this; },
  }));
  scene.subRoad = {setSize(width, height) { this.width = width; this.height = height; }};
  const zoom = Math.min(1280 / 390, 720 / 844, 1.12) * ENVIRONMENT_VISUALS.burstZoom;
  scene.roadBleed = {
    x: Math.max(8, Math.ceil((1280 / zoom - 390) / 2) + 8),
    y: Math.max(0, Math.ceil((720 / zoom - 844) / 2) + 8),
  };
  scene.syncRoadBleed(1280, 720);
  assert.ok(scene.roadFlanks.every(flank => !flank.visible));
  assert.equal(scene.subRoad.width, 390, 'sub-road texture cannot spill into side areas');
});

test('active HUD separates value, load, hull and centered bonus lines, including bypass updates and cap', () => {
  const scene = depotScene();
  const text = () => ({text: '', width: 30, setText(value) { this.text = value; return this; },
    setVisible(value) { this.visible = value; return this; },
    setColor() { return this; }, setScale() { return this; }});
  scene.hud = Object.fromEntries(['distanceLabel', 'distance', 'cargo', 'load', 'hull', 'bonus',
    'closeCallBonus', 'shield', 'depot']
    .map(key => [key, text()]));
  scene.hud.loadBar = {setScale(value) { this.scaleX = value; return this; }, setFillStyle() { return this; }};
  scene.hud.progressBar = {setScale(value) { this.scaleX = value; return this; }};
  scene.hud.hullPips = {clear() { return this; }, fillStyle() { return this; }, fillRect() { return this; }};
  scene.hud.shieldPips = {clear() { return this; }, setVisible() { return this; }};
  scene.refreshHud = Scene.prototype.refreshHud;
  loadCargo(scene, 45);
  scene.hull = 2;
  scene.distance = 375;
  scene.refreshHud();
  assert.equal(scene.hud.distanceLabel.text, 'LEVEL 1 • SECTOR 1/4');
  assert.equal(scene.hud.distance.text, '375 m');
  assert.equal(scene.hud.cargo.text, '45');
  assert.equal(scene.hud.load.text, `LOAD 1/${scene.stats.capacity}`);
  assert.equal(scene.hud.hull.text, `HULL 2/${scene.maxHull}`);
  assert.equal(scene.hud.bonus.text, 'DEPOT PASS BONUS +0%');
  assert.equal(scene.hud.closeCallBonus.text, 'CLOSE CALL BONUS +0%');
  assert.equal(scene.hud.depot.visible, false, 'no Depot indicator outside 60m');
  for (const side of ['left', 'right']) for (const remaining of [60.001, 60, 30, 0, -0.001]) {
    scene.nextDepot = {...scene.nextDepot, side};
    scene.distance = scene.nextDepotDistance - remaining;
    scene.refreshHud();
    assert.equal(scene.hud.depot.visible, remaining >= 0 && remaining <= 60);
    assert.match(scene.hud.depot.text, side === 'left' ? /DEPOT </ : /DEPOT >/);
  }
  scene.distance = 375;
  scene.refreshHud();
  assert.equal(scene.hud.progressBar.scaleX, 0.75);
  assert.ok(Math.abs(scene.hud.loadBar.scaleX - 1 / scene.stats.capacity) < 1e-9);
  const notices = [];
  scene.showToast = message => notices.push(message);
  for (const percent of [20, 40, 60, 60]) {
    scene.distance = scene.nextDepotDistance + DEPOT_RULES.triggerHalfMeters + 0.1;
    scene.updateDepot();
    assert.equal(scene.hud.bonus.text, `DEPOT PASS BONUS +${percent}%`);
    assert.match(notices.at(-1), new RegExp(`Current bonus: \\+${percent}%`));
  }
  scene.runEconomy.closeCallBonusPercent = 15;
  scene.refreshHud();
  assert.equal(scene.hud.closeCallBonus.text, 'CLOSE CALL BONUS +15%');
  assert.match(notices.at(-1), /AT MAXIMUM/);
  assert.equal(scene.cargoValue, 45, 'UI guidance must not secure, lose or change cargo');
});

test('Depot cards quote actual cargo plus bonus, and show the secured amount after banking', () => {
  const scene = depotScene();
  scene.profile.seenHints = ['depotEconomy'];
  loadCargo(scene, 45);
  scene.runEconomy = skipDepot(scene.runEconomy);
  scene.showDepot();
  assert.ok(scene.uiRows.some(row => row.label === 'Cargo Value' && row.value === 45 && row.coin));
  assert.ok(scene.uiRows.some(row => row.label === 'Bank now' && row.value === 54 && row.coin));
  scene.bankAtDepot();
  assert.equal(scene.depotVisit.secured, 54);
  assert.ok(scene.uiRows.some(row => row.label === 'Cargo secured' && row.value === 54 && row.coin));
  assert.equal(scene.runEconomy.consecutiveSkips, 0);
  assert.equal(scene.profile.coins, 54);
});

test('results cards reconcile actual rewards, cargo losses, wallet and one contextual tip', () => {
  const scene = depotScene();
  const labels = [];
  scene.addLabel = message => {
    labels.push(message);
    return {height: 16, setOrigin() { return this; }, setAlign() { return this; },
      setLineSpacing() { return this; }};
  };
  scene.distance = 565;
  loadCargo(scene, 20);
  scene.runContext.crashLoadRatio = 1;
  scene.runContext.cargoLostToHits = 10;
  scene.finishRun(false);
  const reward = crashReward(565);
  assert.equal(scene.runResult.cargoLost, 30, 'loss includes hit jettison plus cargo left at crash, without double counting');
  for (const [label, value] of [['Distance reward', reward], ['Net gain', reward], ['Wallet', reward], ['Lost unbanked cargo', 30]]) {
    assert.ok(scene.uiRows.some(row => row.label === label && row.value === value && row.coin), label);
  }
  assert.ok(scene.uiCurrency.some(row => row.value === reward));
  assert.equal(labels.filter(label => label.startsWith('Tip:')).length, 1);
  assert.ok(labels.some(label => label.includes('Upgrade your steering')), 'heavy-load crash shows the steering tip');
});

test('long result totals remain intact and scroll clear of fixed actions at a narrow viewport', () => {
  const scene = depotScene();
  scene.menuHeight = responsiveViewport(320, 568, 390).worldHeight;
  scene.levelId = 'level1';
  scene.runMode = 'normal';
  scene.checkpointStart = false;
  const longTotal = Number.MAX_SAFE_INTEGER;
  scene.profile.coins = longTotal;
  scene.profile.levelProgress.level1.bestDistance = 123456789;
  scene.runResult = {
    net: longTotal, cargoCoins: longTotal,
    bonusCoins: 123456789012345, noDamageCoins: 987654321, recordCoins: 876543210,
    completionCoins: 765432109, distanceCoins: 654321098, otherCoins: 543210987,
    repairCosts: 432109876, secured: longTotal, gross: longTotal,
    cargoLost: 123456789, bankingEvents: 2, repairPurchases: 1, reason: 'Hull destroyed',
  };
  const layout = managementLayout(scene.menuHeight);
  const content = [];
  const currencies = [];
  let viewport;
  let contentBottom = 0;
  let scrollMax = 0;
  let footerY = 0;
  scene.setScreenRenderer = () => {};
  scene.setWorldVisible = () => {};
  scene.syncHaulerVisuals = () => {};
  scene.panel = () => {};
  scene.menuMetrics = () => layout;
  scene.createMenuScroll = (_key, top, bottom) => { viewport = {top, bottom}; };
  scene.finishMenuScroll = () => {
    contentBottom = measureMenuContent(content);
    scrollMax = Math.max(0, contentBottom - viewport.bottom);
  };
  scene.addLabel = (text, x, y, size = 17, _color, width = 360) => {
    const availableWidth = Math.max(1,
      Math.min(width, 2 * Math.min(x - 32, 390 - 32 - x)));
    const lines = text.split('\n').reduce((total, line) =>
      total + Math.max(1, Math.ceil(line.length * size * 0.6 / availableWidth)), 0);
    const node = {text, x, y, width: availableWidth, height: lines * size * 1.2,
      displayHeight: lines * size * 1.2, originY: 0};
    node.setOrigin = (_x, originY = _x) => { node.originY = originY; return node; };
    node.setLineSpacing = gap => {
      node.height = lines * size * 1.2 + Math.max(0, lines - 1) * gap;
      node.displayHeight = node.height;
      return node;
    };
    content.push(node);
    return node;
  };
  scene.addCurrency = (value, x, y, {size = 18, maxWidth = 150} = {}) => {
    const iconSize = size + 2;
    const width = iconSize + 6 + String(value).length * size * 0.6;
    const scale = Math.min(1, maxWidth / width);
    const node = {value, x, y, width, height: iconSize, displayWidth: width * scale,
      displayHeight: iconSize * scale, originY: 0.5, maxWidth, scale, size};
    currencies.push(node);
    content.push(node);
    return node;
  };
  scene.addStatRow = Scene.prototype.addStatRow;
  scene.addFooterActions = (_actions, options = {}) => {
    footerY = options.y ?? layout.footerY;
  };

  scene.renderRunResult(false, false);

  const fullRunTotal = currencies.find(currency => currency.value === scene.runResult.net);
  assert.ok(fullRunTotal);
  assert.ok(fullRunTotal.displayWidth <= 280);
  assert.equal(String(fullRunTotal.value), '9007199254740991',
    'currency scales to fit without truncating the total');
  const longBreakdownAmount = currencies.find(currency =>
    currency.value === longTotal && currency.size === 18);
  assert.ok(longBreakdownAmount);
  assert.equal(longBreakdownAmount.maxWidth, 280);
  assert.equal(longBreakdownAmount.scale, 1, 'long breakdown totals keep the readable font size');
  const firstBreakdownLabel = content.find(item => item.text === 'Cargo banked');
  assert.ok(longBreakdownAmount.y - longBreakdownAmount.displayHeight / 2 >=
    firstBreakdownLabel.y + firstBreakdownLabel.height,
  'a wrapped long amount occupies its own measured line below the label');
  assert.equal(String(longBreakdownAmount.value), '9007199254740991');
  assert.ok(contentBottom > viewport.bottom, 'the complete result breakdown extends into scrollable content');
  assert.equal(scrollMax, contentBottom - viewport.bottom);
  assert.ok(contentBottom - scrollMax <= viewport.bottom + 1e-9,
    'the last measured result line can scroll above, not under, the fixed footer');
  assert.ok(footerY - layout.footerHeight / 2 >= layout.contentBottom + 16);
  assert.ok(footerY + layout.footerHeight / 2 <= scene.menuHeight - 32);
});

test('negative run net is shown honestly instead of a positive earnings heading', () => {
  const scene = depotScene();
  const labels = [];
  scene.addLabel = message => {
    labels.push(message);
    return {height: 16, setOrigin() { return this; }, setAlign() { return this; },
      setLineSpacing() { return this; }};
  };
  scene.runEconomy.repairCosts = 30;
  scene.runEconomy.repairPurchases = 1;
  scene.finishRun(false);
  assert.ok(labels.includes('NET CHANGE'));
  assert.ok(!labels.includes('YOU EARNED'));
  assert.ok(scene.uiCurrency.some(value => value.value === -25));
  assert.ok(scene.uiRows.some(row => row.label === 'Net gain' && row.value === -25));
});

test('currency presentation uses the existing coin image, preserves signed values and bounds wide amounts', () => {
  const scene = new Scene();
  scene.overlayObjects = [];
  const node = properties => ({...properties, setOrigin() { return this; },
    setDisplaySize(width, height) { this.width = width; this.height = height; return this; },
    setDepth(depth) { this.depth = depth; return this; },
    setSize(width, height) { this.width = width; this.height = height; return this; },
    setScale(scale) { this.scale = scale; return this; }});
  scene.add = {
    text(x, y, text) { return node({x, y, text, width: text.length * 10}); },
    image(x, y, texture) { return node({x, y, texture}); },
    container(x, y, list) { return node({x, y, list}); },
  };
  const amount = scene.addCurrency(-54, 346, 224, {align: 'right', size: 18});
  assert.equal(amount.list[0].texture, 'cargo_coin');
  assert.equal(amount.list[1].text, '-54');
  assert.equal(amount.depth, 34);
  assert.equal(amount.list[1].x + amount.list[1].width, 0, 'right edge stays at the amount column');
  const wide = scene.addCurrency(123456789012345, 346, 224, {maxWidth: 120});
  assert.ok(wide.width * wide.scale <= 120);
  assert.equal(wide.list[1].text, '123456789012345', 'never truncate or change the value');
});

test('Show Tips Next Run preserves progression and only resets preferences after a successful save', () => {
  const scene = depotScene();
  scene.profile.seenHints = ['steer', 'cargo'];
  const before = JSON.stringify(scene.profile);
  const buttons = [];
  scene.addLabel = () => ({height: 16, setOrigin() { return this; }, setAlign() { return this; },
    setLineSpacing() { return this; }});
  scene.addButton = (label, y, action) => buttons.push({label, action});
  scene.showHowToPlay();
  const reset = buttons.find(button => button.label === 'SHOW TIPS NEXT RUN').action;
  storageAvailable = false;
  try {
    reset();
    assert.equal(JSON.stringify(scene.profile), before);
  } finally {
    storageAvailable = true;
  }
  reset();
  assert.deepEqual(Array.from(scene.profile.seenHints), []);
  assert.equal(scene.profile.coins, JSON.parse(before).coins);
  assert.deepEqual(scene.profile.ownedModules, JSON.parse(before).ownedModules);
});

test('the new Depot explanation is dismissible and does not repeat after a saved dismissal', () => {
  const scene = depotScene();
  const buttons = [];
  scene.addButton = (label, y, action) => buttons.push({label, y, action});
  scene.showDepot();
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].label, 'GOT IT');
  buttons[0].action();
  assert.ok(scene.profile.seenHints.includes('depotEconomy'));
  assert.ok(savedProfile.seenHints.includes('depotEconomy'));
  buttons.length = 0;
  scene.renderDepot();
  assert.ok(!buttons.some(b => b.label === 'GOT IT'));
});

test('five fresh starts and repeated Depot Continue recenter actual ship, target, inertia and attachments', () => {
  const scene = new Scene();
  scene.ship = {x: 310, y: 684, setScale() {}, setTexture() {}, setTint() {}, clearTint() {}};
  scene.shieldRing = {setPosition(x) { this.x = x; return this; }, setVisible() { return this; }};
  scene.profile = defaultProfile();
  scene.profile.levelProgress.level1.completed = true;
  scene.roadSurface = {};
  scene.dustSurface = {};
  for (const name of ['clearOverlay', 'removeObjects', 'setWorldVisible', 'refreshHud', 'triggerHint', 'showToast']) scene[name] = () => {};
  scene.syncHaulerVisuals = () => { scene.rackX = scene.ship.x; };
  for (let run = 0; run < 5; run++) {
    scene.ship.x = 310;
    scene.shipTargetX = 310;
    scene.shipVelocityX = 120;
    scene.startRun('beginning', 'level1', run === 4 ? 'continuous' : 'normal');
    const budget = scene.blueprintRun;
    assert.equal(scene.ship.x, (ROAD_LEFT + ROAD_RIGHT) / 2);
    assert.equal(scene.shipTargetX, scene.ship.x);
    assert.equal(scene.shipVelocityX, 0);
    assert.equal(scene.rackX, scene.ship.x);
    for (let depot = 0; depot < (scene.runMode === 'continuous' ? 5 : IMPLEMENTED_LEVELS.level1.length - 1); depot++) {
      scene.phase = 'depot';
      scene.depotVisit = {banked: true};
      scene.distance = scene.nextDepotDistance;
      scene.ship.x = depot % 2 ? 73 : 317;
      scene.shipTargetX = 317;
      scene.shipVelocityX = -140;
      scene.resumeAfterDepot();
      const nextDistance = scene.nextDepotDistance;
      assert.equal(scene.ship.x, 195);
      assert.equal(scene.shipTargetX, 195);
      assert.equal(scene.shipVelocityX, 0);
      assert.equal(scene.rackX, 195);
      assert.equal(scene.shieldRing.x, 195);
      assert.equal(scene.blueprintRun, budget, 'Continue must not reset Blueprint attempts');
      assert.equal(scene.profile.coins, 0);
      // Metre-based resume: the first row is pre-placed so it reaches the truck DEPOT_RULES.resumeMeters on.
      assert.equal(scene.resumeSpawnDistance, scene.distance);
      assert.equal(scene.nextTrackRowDistance, depotResumeFirstDistance(scene.distance));
      scene.resumeAfterDepot();
      assert.equal(scene.nextDepotDistance, nextDistance, 'double-tap does not resume twice');
    }
    if (scene.runMode === 'normal') assert.equal(scene.nextDepotDistance, Infinity);
  }
});

function fullImageFactory(created) {
  return (x, y, key, frame) => {
    const node = {x, y, key, texture: {key}, frame: {name: frame ?? '__BASE'}, depth: 0, alpha: 1,
      scaleX: 1, scaleY: 1, visible: true, destroyed: 0,
      setDepth(value) { this.depth = value; return this; },
      setFlipX(value) { this.flipX = value; return this; },
      setFlip(flipX, flipY) { Object.assign(this, {flipX, flipY}); return this; },
      setOrigin(x, y = x) { Object.assign(this, {originX: x, originY: y}); return this; },
      setDisplaySize(width, height) { Object.assign(this, {scaleX: width / 40, scaleY: height / 40}); return this; },
      setAlpha(value) { this.alpha = value; return this; },
      setX(value) { this.x = value; return this; }, setY(value) { this.y = value; return this; },
      setPosition(x, y) { Object.assign(this, {x, y}); return this; },
      setRotation(value) { this.rotation = value; return this; },
      setScale(x, y = x) { Object.assign(this, {scaleX: x, scaleY: y}); return this; },
      setTint(value) { this.tint = value; return this; },
      setTexture(key, frame) { Object.assign(this, {texture: {key}, frame: {name: frame}}); return this; },
      setVisible(value) { this.visible = value; return this; },
      setBlendMode(value) { this.blendMode = value; return this; },
      destroy() { this.destroyed++; }};
    created.push(node);
    return node;
  };
}

function containerFactory(created) {
  return (x, y, children) => {
    const node = {x, y, children, destroyed: 0,
      setDepth(value) { this.depth = value; return this; },
      setSize(width, height) { Object.assign(this, {width, height}); return this; },
      destroy() { this.destroyed++; }};
    created.push(node);
    return node;
  };
}

test('Depot art scrolls in world space from above the screen, stays aligned with its trigger and is released once', () => {
  const restore = useRealVisuals();
  try {
    const scene = depotScene();
    const images = [], containers = [];
    scene.add = {image: fullImageFactory(images), container: containerFactory(containers)};
    const depot = scene.nextDepot;
    const height = depotFacilityHeight();
    const screenHeight = GAME_BALANCE.routes.geometry.logicalHeightPx;
    scene.distance = depot.distance - (SHIP_Y + height + 50) * METERS_PER_PIXEL;
    scene.updateDepotFacilities(0);
    assert.equal(containers.length, 0, 'no Depot is created while it is still above the off-screen line');
    const step = 12;
    let facility = null, lastY = null;
    for (let frame = 0; frame < 2000; frame++) {
      scene.distance += step * METERS_PER_PIXEL;
      scene.updateDepotFacilities(step);
      if (!facility && containers.length) {
        facility = containers[0];
        assert.ok(facility.y >= -height && facility.y < -height + step + 1e-9, 'spawns just beyond the top edge');
        assert.ok(facility.depth < 5, 'below road objects');
        const glow = facility.children[1];
        assert.equal(glow.key, 'depot_canopy_glow');
        assert.equal(glow.blendMode, 1, 'Phaser.BlendModes.ADD canopy light is locked inside the container');
      }
      if (facility && !facility.destroyed) {
        assert.ok(Math.abs(facility.y - depotWorldY(depot, scene.distance)) < 1e-6,
          'art scrolls exactly with the road and the unchanged Depot trigger');
        lastY = facility.y;
      }
      if (facility?.destroyed) break;
      if (scene.nextDepot === depot && scene.distance > depot.distance + DEPOT_RULES.triggerHalfMeters) {
        scene.advanceDepot();
      }
    }
    assert.ok(facility, 'the Depot entered the screen');
    assert.equal(facility.destroyed, 1, 'released exactly once');
    assert.ok(lastY <= screenHeight + height && lastY + step > screenHeight + height,
      'removed only once it is fully below the screen');
    assert.equal(scene.depotFacilities.length, 0);
    assert.equal(containers.length, 1, 'a passed Depot is never recreated');

    scene.distance = scene.nextDepot.distance - SHIP_Y * METERS_PER_PIXEL;
    scene.updateDepotFacilities(0);
    assert.equal(containers.length, 2);
    scene.startRun();
    assert.equal(containers[1].destroyed, 1, 'starting a run clears leftover Depot art');
  } finally {
    restore();
  }
});

test('hazards cast pinned silhouette shadows that are released with their obstacle', () => {
  const restore = useRealVisuals();
  try {
    const scene = depotScene();
    const images = [];
    scene.add = {image: fullImageFactory(images), container: containerFactory([])};
    scene.ship.setAlpha = () => scene.ship;
    scene.ship.angle = 0;
    scene.lines = [];
    scene.roadSurface.tilePositionY = 0;
    scene.shieldRing = {setPosition() { return this; }, setVisible() { return this; }};
    scene.syncFinishLine = () => {};
    scene.refreshDeveloperReadout = () => {};
    scene.blueprintRun = {authorize: () => null};
    const hazards = [{kind: 'rockSlab', lane: 1, offsetY: 0, placement: 'alpha'},
      {kind: 'signalCabinet', lane: 2, offsetY: -70, placement: 'alpha'}];
    scene.trackStream = {nextRow: () => ({hazards, intermediates: [], pickups: [], spacingPx: 250, emitted: true})};
    scene.spawnTrackRow();
    assert.equal(scene.objects.length, 2);
    for (const item of scene.objects) {
      assert.equal(item.shadow.texture.key, item.sprite.texture.key, 'same texture as the obstacle');
      assert.equal(item.shadow.tint, SHADOW_TINT);
      assert.equal(item.shadow.depth, item.sprite.depth - 0.05, 'one layer below the obstacle');
      assert.ok(Math.abs(item.shadow.alpha - balance.SHADOW_ALPHA) < 1e-9);
    }
    const base = scene.shipBaseScale ?? SPRITE_ART_SCALE;
    scene.shipTargetX = ROAD_RIGHT;
    for (let frame = 0; frame < 3; frame++) scene.update(frame * 16, 16);
    for (const item of scene.objects) {
      assert.deepEqual([item.shadow.x, item.shadow.y],
        [item.sprite.x + balance.SHADOW_OFFSET_X, item.sprite.y + balance.SHADOW_OFFSET_Y],
        'shadow stays pinned while the obstacle scrolls');
    }
    assert.ok(scene.ship.angle > 0, 'steering right leans clockwise into the turn');
    assert.equal(scene.ship.scaleX, base, 'suspension does not squash chassis width');
    const shadows = scene.objects.map(item => item.shadow);
    scene.removeObjects();
    assert.ok(shadows.every(shadow => shadow.destroyed === 1), 'every shadow is released exactly once');
  } finally {
    restore();
  }
});

test('truck suspension leans at most 3.5 degrees without squashing or moving its collision position', () => {
  const scene = new Scene();
  scene.profile = defaultProfile();
  scene.ship = {x: 240, y: SHIP_Y, angle: 0,
    setScale(scale) { this.scaleX = scale; this.scaleY = scale; return this; },
    setTexture() { return this; }, setTint() { return this; }, clearTint() { return this; }};
  scene.shieldRing = {setPosition() { return this; }};
  scene.syncHaulerVisuals = () => {};
  scene.syncShipAppearance('standard');
  const base = SPRITE_ART_SCALE * balance.RUN_TRUCK_VISUAL_SCALE;
  assert.equal(scene.ship.scaleX, base);
  const dt = 1 / 60;
  scene.applyTruckRoll(1, dt);
  const firstStep = 1 - Math.exp(-balance.TRUCK_ROLL_LERP_SPEED * dt);
  assert.ok(Math.abs(scene.ship.angle - firstStep * 3.5) < 1e-9, 'suspension eases in');
  for (let frame = 0; frame < 240; frame++) scene.applyTruckRoll(1, dt);
  assert.ok(Math.abs(scene.ship.angle - 3.5) < 1e-6);
  assert.equal(scene.ship.scaleX, base);
  assert.equal(scene.ship.scaleY, base);
  for (let frame = 0; frame < 240; frame++) scene.applyTruckRoll(-1, dt);
  assert.ok(Math.abs(scene.ship.angle + 3.5) < 1e-6, 'leans left for left turns');
  for (let frame = 0; frame < 240; frame++) scene.applyTruckRoll(0, dt);
  assert.ok(Math.abs(scene.ship.angle) < 1e-6 && Math.abs(scene.ship.scaleX - base) < 1e-6, 'idle settles level');
  assert.equal(scene.ship.x, 240, 'roll never moves the collision position');
  scene.applyTruckRoll(1, 1);
  scene.centerShip();
  assert.deepEqual([scene.ship.angle, scene.ship.scaleX, scene.ship.scaleY], [0, base, base]);
  scene.profile.shipStates.swift = {...scene.profile.shipStates.standard};
  scene.syncShipAppearance('swift');
  assert.deepEqual([scene.ship.angle, scene.ship.scaleX],
    [0, 0.92 * SPRITE_ART_SCALE * balance.RUN_TRUCK_VISUAL_SCALE]);
});
