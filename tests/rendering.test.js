import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {
  addDepotDetails, addHudBacking, addIndustrialPanel, buildIndustrialRoad, createIndustrialTextures, PALETTE,
  addSteelControl, ROADSIDE_KINDS, ROADSIDE_LAYOUT, ROADSIDE_INFILL_LAYOUT, syncHaulerEffects, TEXTURE_SIZES,
  MODULE_CAPTIONS, garageUpgradeBenefit, addHaulerPreview,
  preloadStandardHauler, STANDARD_HAULER_ART, preloadObstacleArt, OBSTACLE_ART,
  preloadSwiftRunner, SWIFT_RUNNER_ART, createHaulerEffects, stopHaulerExhaust, playImpactSparks,
  STANDARD_HAULER_TRIMS, recolorStandardHauler, vehicleTexture, vehicleTrimName, addGoldPreviewSparkles,
  COLLECTIBLE_ART, preloadCollectibleArt, syncBlueprintVisuals, syncCargoPickupVisuals,
  cargoPickupTexture, cargoPickupGlowTexture, CARGO_PICKUP_GLOW_OFFSET_Y, recolorLargeCargoPickup,
  SPRITE_ART_SCALE, scaleSpriteArt, addModuleIcon,
  DEPOT_ART, preloadDepotArt, createBarrierLights, syncBarrierLights, createNeonHalo, syncNeonHalo,
  syncSectorRoad, syncDepotEntrance, createDepotEntrance, hazardTexture, vehicleTint, bakeNeonRoadTexture,
  createDepotFacility, depotFacilityHeight, createSilhouetteShadow, syncSilhouetteShadow, SHADOW_TINT,
  GUARDRAIL_ART, createGuardrailStructure, syncGuardrailSparks, syncGuardrailBeacon,
  GARAGE_DISPLAY_ART, preloadGarageDisplayArt,
  GARAGE_UPGRADE_ART, preloadGarageUpgradeArt, NEON_ART, NEON_THEME_ASSETS, preloadNeonVisuals,
} from '../src/game/rendering/industrial.js';
import {balance} from '../src/game/data/balance.js';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';
import {createRunEconomy, awardCloseCall, closeCallBonusPercent} from '../src/game/core/depotEconomy.js';
import {EventEmitter} from 'node:events';
import {RunFeedback} from '../src/game/rendering/runFeedback.js';
import {RouteVisualPool, ROUTE_VISUAL_CAPACITY, routeImage, releaseRouteVisual} from '../src/game/rendering/routeVisualPool.js';

function installVisualPool(scene, capacity = {images: 64, containers: 8, tiles: 4}) {
  const image = scene.add.image;
  scene.add.image = (...args) => Object.assign(image(...args), {
    active: true, displayList: {}, parentContainer: null, destroyed: 0,
    setActive(active) { this.active = active; return this; },
    clearTint() { this.tint = 0xffffff; return this; },
    destroy() { this.destroyed++; this.active = false; },
  });
  scene.sys ??= {};
  scene.sys.displayList = {add(node) { node.displayList = this; }};
  const container = scene.add.container;
  scene.add.container = (...args) => Object.assign(container(...args), {
    active: true, destroyed: 0, list: [],
    setActive(active) { this.active = active; return this; },
    add(children) {
      this.list.push(...children);
      children.forEach(child => { child.parentContainer = this; child.displayList = null; });
      return this;
    },
    removeAll() {
      this.list.forEach(child => { child.parentContainer = null; });
      this.list.length = 0;
    },
    destroy() { this.destroyed++; this.active = false; },
  });
  scene.add.tileSprite ??= (x, y, width, height, key) =>
    scene.add.image(x, y, key).setSize(width, height);
  scene.add.group = ({maxSize}) => {
    const children = [];
    return {
      scene, maxSize, gets: 0, kills: 0,
      get(x, y, key, frame) {
        this.gets++;
        const node = this.getFirstDead();
        if (!node) throw new Error('test Group must never create a Sprite');
        node.x = x; node.y = y;
        return node;
      },
      getFirstDead: () => children.find(node => !node.active),
      getChildren: () => children,
      contains: node => children.includes(node),
      add(node) { children.push(node); },
      killAndHide(node) { this.kills++; node.setActive(false).setVisible(false); },
      destroy(destroyChildren) {
        if (!this.scene) return;
        if (destroyChildren) children.forEach(node => node.destroy());
        this.scene = undefined;
      },
    };
  };
  scene.routeVisualPool = new RouteVisualPool(scene, capacity);
  return scene.routeVisualPool;
}

test('route visual pool preallocates on scene load, reuses killed images through Group get and clears stale state', () => {
  const {scene, created} = effectsScene();
  scene.tweens = {killTweensOf() {}};
  const pool = installVisualPool(scene, {images: 1, containers: 0, tiles: 0});
  const first = routeImage(scene, 10, 20, 'hazard_divider');
  first.setAlpha(0.35).setRotation(1).setFlip(true, true).setOrigin(0.1, 0.9)
    .setTint(0x123456).setBlendMode('ADD').setDepth(16).setScale(3);
  releaseRouteVisual(scene, first);
  assert.equal(first.active, false);
  assert.equal(first.visible, false);
  assert.equal(first.destroyed, 0);
  for (let cycle = 0; cycle < 1000; cycle++) {
    const next = routeImage(scene, 86, -35, 'road_decal_skid');
    assert.equal(next, first);
    assert.equal(next.texture.key, 'road_decal_skid');
    assert.equal(next.active, true);
    assert.equal(next.visible, true);
    assert.equal(next.alpha, 1);
    assert.equal(next.rotation, 0);
    assert.equal(next.scaleX, 1);
    assert.equal(next.flipX, false);
    assert.equal(next.originX, 0.5);
    assert.equal(next.tint, 0xffffff);
    assert.equal(next.blendMode, 'NORMAL');
    releaseRouteVisual(scene, next);
  }
  assert.equal(created.length, 1);
  assert.equal(pool.images.gets, 1001);
  assert.equal(pool.images.kills, 1002, 'includes preallocation release');
  pool.destroy();
  pool.destroy();
  assert.equal(first.destroyed, 1, 'destroy only at final scene teardown');
});

test('route visual pool tolerates Phaser UpdateList destroying groups before scene shutdown cleanup', () => {
  const {scene} = effectsScene();
  scene.tweens = {killTweensOf() {}};
  const pool = installVisualPool(scene);
  const node = pool.image(86, -35, 'hazard_divider');
  for (const group of [pool.images, pool.containers, pool.tiles]) {
    group.destroy(true);
    group.getChildren = () => { throw new Error('Phaser destroyed this group already'); };
  }
  assert.doesNotThrow(() => releaseRouteVisual(scene, node));
  assert.doesNotThrow(() => pool.destroy());
  assert.equal(node.destroyed, 1);
});

test('route visual pool cold capacity is fully preallocated, never grows and fails explicitly instead of dropping hazards', () => {
  const {scene, created} = effectsScene();
  scene.tweens = {killTweensOf() {}};
  const pool = installVisualPool(scene, ROUTE_VISUAL_CAPACITY);
  const groups = [pool.images, pool.containers, pool.tiles];
  const limits = Object.values(ROUTE_VISUAL_CAPACITY);
  assert.deepEqual(groups.map(group => group.getChildren().length), limits);
  assert.deepEqual(groups.map(group => group.maxSize), limits);
  assert.ok(created.every(node => !node.active && !node.visible), 'every cold slot starts killed and hidden');
  const count = created.length;
  for (const method of ['image', 'container', 'tileSprite']) {
    scene.add[method] = () => { throw new Error(`active gameplay allocated ${method}`); };
  }
  scene.phase = 'running';
  for (let cycle = 0; cycle < 2; cycle++) {
    const images = Array.from({length: limits[0]}, (_, i) => pool.image(i, -35, 'hazard_divider'));
    const containers = Array.from({length: limits[1]}, () => pool.container(0, -35, []));
    const tiles = Array.from({length: limits[2]}, () => pool.tile(195, 422, 390, 844, 'industrial_road'));
    assert.throws(() => pool.image(0, 0, 'hazard_divider'), /image pool exhausted/);
    assert.throws(() => pool.container(0, 0, []), /container pool exhausted/);
    assert.throws(() => pool.tile(0, 0, 390, 844, 'industrial_road'), /tile pool exhausted/);
    assert.equal(created.length, count);
    [...containers, ...images, ...tiles].forEach(node => pool.release(node));
  }
  assert.equal(created.length, count, 'not even the first cold peak creates objects');
  assert.ok(created.every(node => node.destroyed === 0), 'recycling does not destroy');
  assert.throws(() => new RouteVisualPool(scene), /preallocated on scene load/);
  pool.destroy();
  assert.ok(created.every(node => node.destroyed === 1));
});

test('route visual pool is mandatory during gameplay and texture baking cannot run or fall back lazily', () => {
  const source = readFileSync(new URL('../src/game/core/trackGenerator.js', import.meta.url), 'utf8');
  assert.ok(!/Phaser|generateTexture|scene\.add/.test(source), 'generator stays descriptor-only');
  const mock = drawingScene();
  createIndustrialTextures(mock.scene);
  const size = mock.textures.size;
  mock.scene.textures.remove('chicane_mid');
  for (const phase of ['running', 'docking', 'depot', 'crashing', 'finishing']) {
    mock.scene.phase = phase;
    assert.throws(() => routeImage(mock.scene, 0, 0, 'hazard_divider'), /must be preallocated/);
    assert.throws(() => createIndustrialTextures(mock.scene), /baked before gameplay/);
    assert.equal(hazardTexture('rockSlab', 'dustlands', 0, mock.scene), 'hazard_rockSlab');
    assert.throws(() => hazardTexture('sideRail', 'industrial', 0, mock.scene), /baked before gameplay/);
    assert.equal(mock.textures.size, size, 'no late canvas or generated texture');
  }
});

test('route visual pool serves cold long guardrails, hazards, shadows, cargo, Depots and decals without allocation', () => {
  const {scene, created, textures} = effectsScene();
  scene.tweens = {killTweensOf() {}};
  const pool = installVisualPool(scene, ROUTE_VISUAL_CAPACITY);
  GUARDRAIL_ART.forEach(art => textures.add(art.key));
  const count = created.length;
  scene.phase = 'running';
  for (const method of ['image', 'container', 'tileSprite', 'sprite']) {
    scene.add[method] = () => { throw new Error(`cold runtime ${method} allocation`); };
  }
  for (let cycle = 0; cycle < 10; cycle++) {
    const nodes = [];
    for (let i = 0; i < 12; i++) {
      const hazard = {kind: i % 2 ? 'sideRail' : 'sideWall', lane: i % 2 ? 3 : 0, lengthPx: 3777};
      const wall = createGuardrailStructure(scene, hazard, hazardX(hazard), -35 + i * 90);
      nodes.push(wall, wall.guardrailBeacon);
      const body = pool.image(159, i * 80, 'hazard_forklift');
      nodes.push(body, createSilhouetteShadow(scene, body),
        ...createBarrierLights(scene, body, 'forklift', 0));
      nodes.push(pool.image(232, i * 80, 'cargo_pickup_xl'),
        pool.image(232, i * 80, 'cargo_pickup_glow_gold'));
    }
    for (const side of ['left', 'right']) {
      nodes.push(createDepotFacility(scene, {distance: 500, side}, 100).container);
    }
    for (let i = 0; i < 4; i++) nodes.push(pool.image(75, i * 100, 'road_decal_skid'));
    const tile = pool.tile(195, 422, 390, 844, 'industrial_road');
    nodes.forEach(node => pool.release(node));
    pool.release(tile);
    assert.equal(created.length, count);
    assert.ok(created.every(node => !node.active && !node.visible && node.destroyed === 0));
  }
  pool.destroy();
});

test('route visual pool releases compound children atomically, safely reuses container children and owns persistent road tiles', () => {
  const {scene, created} = effectsScene();
  scene.tweens = {killTweensOf() {}};
  const image = scene.add.image;
  scene.add.container = (x, y) => Object.assign(image(x, y, 'container'), {
    setActive(active) { this.active = active; return this; },
    list: [], add(children) {
      this.list.push(...children);
      children.forEach(child => { child.parentContainer = this; child.displayList = null; });
      return this;
    },
    removeAll() {
      this.list.forEach(child => { child.parentContainer = null; });
      this.list.length = 0;
    },
    destroy() { this.destroyed = (this.destroyed ?? 0) + 1; },
  });
  scene.add.tileSprite = (x, y, width, height, key) => Object.assign(scene.add.image(x, y, key), {
    setSize(width, height) { Object.assign(this, {width, height}); return this; },
  });
  const pool = installVisualPool(scene);
  const parts = [pool.image(0, 0, 'chicane_entry'), pool.image(0, -60, 'chicane_mid')];
  const container = pool.container(86, -35, parts);
  container.guardrailParts = parts;
  container.guardrailBeacon = pool.image(0, 0, 'barrier_caution_light');
  const beacon = container.guardrailBeacon;
  releaseRouteVisual(scene, container);
  releaseRouteVisual(scene, beacon);
  assert.equal(container.list.length, 0);
  assert.equal(container.guardrailParts, null);
  assert.equal(container.guardrailBeacon, null);
  assert.ok(parts.every(part => !part.active && !part.visible));
  const count = created.length;
  const next = pool.image(86, -35, 'rockSlab');
  assert.equal(next, parts[0]);
  assert.equal(next.parentContainer, null);
  assert.equal(next.displayList, scene.sys.displayList);
  assert.equal(pool.container(0, 0, [next]), container);
  assert.equal(created.length, count);
  const tile = pool.tile(195, 422, 390, 844, 'industrial_road');
  tile.tilePositionY = 500;
  releaseRouteVisual(scene, tile);
  assert.equal(pool.tile(195, 422, 454, 908, 'subroad_dustlands'), tile);
  assert.equal(tile.tilePositionY, 0);
  assert.equal(tile.width, 454);
  pool.destroy();
  assert.ok(created.every(node => node.destroyed === 1), 'no double-destroy of container children');
});

test('desktop scaling fills the viewport with RESIZE and no CSS canvas stretching', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
    .replace(/^import.*;\r?\n/gm, '').replace(/^if \(import\.meta\.env\.DEV\).*$/m, '');
  let config;
  vm.runInNewContext(source, {
    Phaser: {AUTO: 'AUTO', Scale: {RESIZE: 'RESIZE', CENTER_BOTH: 'CENTER_BOTH'},
      Game: class { constructor(value) { config = value; } }},
    RoutePrototypeScene: class {},
  });
  assert.equal(config.width, 390);
  assert.equal(config.height, 844);
  assert.equal(config.scale.mode, 'RESIZE');
  assert.equal(config.scale.autoCenter, 'CENTER_BOTH');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const canvasRule = css.match(/#game canvas\s*\{([^}]+)\}/)[1];
  assert.ok(!/(?:^|;)\s*(?:width|height)\s*:\s*100%/.test(canvasRule), 'Phaser controls the aspect-correct display size');
});

function audioFeedbackFixture({supported = true, state = 'running', vibrate = () => true} = {}) {
  const nodes = [], vibrations = [], warnings = [];
  const param = () => ({
    value: 0, events: [],
    setValueAtTime(...args) { this.events.push(['set', ...args]); },
    linearRampToValueAtTime(...args) { this.events.push(['linear', ...args]); },
    exponentialRampToValueAtTime(...args) { this.events.push(['exponential', ...args]); },
    setTargetAtTime(...args) { this.events.push(['target', ...args]); },
    cancelScheduledValues(...args) { this.events.push(['cancel', ...args]); },
  });
  const node = kind => {
    const result = {kind, gain: param(), frequency: param(), Q: param(), disconnected: 0, stops: [],
      connect(destination) { this.destination = destination; },
      disconnect() { this.disconnected++; },
      start(time) { this.startTime = time; },
      stop(time) { this.stops.push(time); },
    };
    nodes.push(result);
    return result;
  };
  const context = {
    state, currentTime: 10, sampleRate: 48000, resumes: 0, buffers: [],
    resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); },
    createGain: () => node('gain'),
    createOscillator: () => node('oscillator'),
    createBufferSource: () => node('bufferSource'),
    createBiquadFilter: () => node('filter'),
    createDynamicsCompressor: () => Object.assign(node('compressor'), {
      threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
    }),
    createBuffer(channels, length, sampleRate) {
      const buffer = {channels, length, sampleRate, getChannelData: () => new Float32Array(length)};
      this.buffers.push(buffer);
      return buffer;
    },
    close() { throw new Error('Phaser owns the shared context; feedback must never close it'); },
  };
  const dom = () => {
    const emitter = new EventEmitter();
    emitter.addEventListener = (name, action, capture) => {
      assert.equal(capture, true, 'unlock must precede controls that stop pointer propagation');
      emitter.on(name, action);
    };
    emitter.removeEventListener = (name, action, capture) => {
      assert.equal(capture, true);
      emitter.off(name, action);
    };
    return emitter;
  };
  const document = dom(), canvas = dom(), events = new EventEmitter(), gameEvents = new EventEmitter();
  canvas.ownerDocument = document;
  const destination = {};
  const scene = {events, game: {canvas, events: gameEvents}, sound: supported ? {context, destination} : {}};
  const feedback = new RunFeedback(scene, {navigator: vibrate === null ? {} : {
    vibrate(pattern) { vibrations.push(pattern); return vibrate(pattern); },
  }, report: (...args) => warnings.push(args)});
  return {feedback, context, nodes, vibrations, warnings, canvas, document, events, gameEvents, destination};
}

test('audio feedback waits for pointer or keyboard interaction, resumes mobile context and never replays locked effects', async () => {
  for (const input of ['pointer', 'keyboard']) {
    const f = audioFeedbackFixture({state: 'suspended'});
    f.feedback.cargoPickup(1);
    f.feedback.impact();
    f.feedback.depot();
    assert.equal(f.nodes.length, 0);
    assert.equal(f.vibrations.length, 0);
    (input === 'pointer' ? f.canvas : f.document).emit(input === 'pointer' ? 'pointerdown' : 'keydown');
    const pending = f.feedback.unlocking;
    await pending;
    assert.equal(f.context.resumes, 1);
    assert.equal(f.feedback.ready, true);
    assert.equal(f.feedback.voices.size, 0, 'old pickup/hit/depot sounds are never queued');
    assert.equal(f.feedback.master.destination, f.feedback.compressor);
    assert.equal(f.feedback.compressor.destination, f.destination, 'respect Phaser master mute/volume');
    assert.equal(f.nodes.filter(node => node.kind === 'oscillator').length, 0, 'unlock starts no engine loop');
    const count = f.nodes.length;
    f.canvas.emit('pointerdown');
    assert.equal(f.nodes.length, count, 'one effects output graph per scene lifetime');
    f.feedback.destroy();
  }
});

test('Normal-run music waits for interaction and uses the prior SFX level while SFX rise by 50 percent', async () => {
  const f = audioFeedbackFixture({state: 'suspended'});
  const buffer = {id: 'background-music'};
  f.feedback.setMusicBuffer(buffer);
  f.feedback.startRunMusic(true);
  assert.equal(f.nodes.length, 0, 'music cannot allocate or play before the first gesture');
  f.document.emit('keydown');
  await f.feedback.unlocking;
  assert.equal(f.feedback.master.gain.value, 0.525);
  assert.equal(f.feedback.musicSource.buffer, buffer);
  assert.equal(f.feedback.musicSource.loop, true);
  assert.deepEqual(f.feedback.musicGain.gain.events[0], ['set', 0.35, f.context.currentTime]);
  f.feedback.suspend('manualPause');
  assert.deepEqual(f.feedback.musicGain.gain.events.at(-1), ['set', 0, f.context.currentTime]);
  f.feedback.resume('manualPause');
  assert.deepEqual(f.feedback.musicGain.gain.events.at(-1),
    ['target', 0.35, f.context.currentTime, 0.03]);
  const musicEventsBeforeOverlay = f.feedback.musicGain.gain.events.length;
  f.feedback.suspend('tutorialCheckpoint', {music: false});
  assert.equal(f.feedback.musicGain.gain.events.length, musicEventsBeforeOverlay,
    'tutorial overlays mute effects without interrupting background music');
  f.feedback.resume('tutorialCheckpoint');
  const source = f.feedback.musicSource;
  const gain = f.feedback.musicGain;
  f.feedback.stopRunMusic();
  assert.equal(source.stops.length, 1);
  assert.equal(source.disconnected, 1);
  assert.equal(gain.disconnected, 1);
  f.feedback.startRunMusic(false);
  assert.equal(f.feedback.musicSource, null, 'non-Normal runs do not retain music');
  f.feedback.destroy();
});

test('audio unlock failures are reported once, remain retryable and cannot resurrect a shutdown scene', async () => {
  const f = audioFeedbackFixture({state: 'suspended'});
  const error = new Error('mobile audio denied');
  f.context.resume = () => Promise.reject(error);
  f.feedback.unlock();
  await f.feedback.unlocking;
  f.feedback.unlock();
  await f.feedback.unlocking;
  assert.equal(f.warnings.length, 1);
  assert.equal(f.warnings[0][1], error);
  assert.equal(f.feedback.ready, false);
  let resolve;
  f.context.resume = () => new Promise(done => { resolve = () => { f.context.state = 'running'; done(); }; });
  f.feedback.unlock();
  const pending = f.feedback.unlocking;
  f.feedback.destroy();
  resolve();
  await pending;
  assert.equal(f.nodes.length, 0);
  assert.equal(f.feedback.destroyed, true);
  const retry = audioFeedbackFixture({state: 'suspended'});
  retry.feedback.unlock();
  await retry.feedback.unlocking;
  assert.equal(retry.feedback.ready, true);
  retry.feedback.destroy();
});

test('audio engine noise is removed, with no continuous source on unlock, reset or resume', () => {
  const f = audioFeedbackFixture();
  f.feedback.unlock();
  const count = f.nodes.length;
  assert.deepEqual(f.nodes.map(node => node.kind), ['gain', 'compressor']);
  for (let run = 0; run < 3; run++) {
    f.feedback.resetRun(195);
    f.feedback.suspend('pause');
    f.feedback.resume('pause');
    f.feedback.unlock();
  }
  assert.equal(f.nodes.length, count, 'no sound source or engine graph created by lifecycle events');
  f.feedback.cargoPickup(1);
  assert.equal(f.feedback.voices.size, 5, 'the pickup chime is finite and event-triggered');
  assert.ok([...f.feedback.voices].every(voice => voice.source.stops.length === 1), 'each source has a finite stop');
  f.feedback.resetRun(195);
  assert.equal(f.feedback.voices.size, 0);
  const sceneSource = readFileSync(new URL('../src/game/scenes/RoutePrototypeScene.js', import.meta.url), 'utf8');
  assert.ok(!sceneSource.includes('setEngine('), 'driving, docking and launch no longer drive engine audio');
  f.feedback.destroy();
  assert.ok(f.nodes.every(node => node.disconnected === 1));
});

test('audio mix retains crashes, air brakes and UI clicks foreground gain and compresses burst peaks', () => {
  const f = audioFeedbackFixture();
  f.feedback.unlock();
  assert.equal(f.feedback.compressor.threshold.value, -12);
  assert.equal(f.feedback.compressor.ratio.value, 4);
  assert.equal(f.feedback.compressor.attack.value, 0.003);
  const peaks = () => [...f.feedback.voices].map(voice =>
    voice.gain.gain.events.find(event => event[0] === 'linear')[1]);
  f.feedback.impact();
  assert.deepEqual(peaks(), [0.4, 0.4]);
  f.feedback.clearVoices();
  f.feedback.airBrake();
  assert.deepEqual(peaks(), [0.28, 0.16]);
  const brake = f.feedback.voices.values().next().value;
  assert.equal(brake.filter.type, 'highpass');
  assert.equal(brake.source.stops[0], f.context.currentTime + 0.32);
  f.feedback.clearVoices();
  f.feedback.uiClick();
  assert.deepEqual(peaks(), [0.22]);
  const click = f.feedback.voices.values().next().value;
  assert.equal(click.source.frequency.events[0][1], 1400);
  assert.equal(click.source.frequency.events[1][1], 650);
  assert.equal(click.source.stops[0], f.context.currentTime + 0.045);
  f.feedback.suspend('pause');
  const count = f.nodes.length;
  f.feedback.airBrake();
  f.feedback.uiClick();
  assert.equal(f.nodes.length, count, 'suspended effects cannot allocate');
  f.feedback.resume('pause');
  assert.equal(f.feedback.ready, true);
  f.feedback.destroy();
  assert.ok(f.nodes.every(node => node.disconnected === 1));
});

test('each accepted cargo plays the five-note pickup chime through finite managed voices', () => {
  const f = audioFeedbackFixture();
  f.feedback.unlock();
  f.feedback.cargoPickup(1);
  const notes = [...f.feedback.voices].map(voice => voice.source);
  assert.deepEqual(notes.map(note => note.frequency.events[0][1]), [261.63, 293.66, 329.63, 392, 523.25]);
  assert.deepEqual(notes.map(note => note.startTime), [10, 10.08, 10.16, 10.24, 10.32]);
  const expectedStops = [10.3, 10.38, 10.46, 10.54, 10.62];
  assert.ok(notes.every((note, index) => Math.abs(note.stops[0] - expectedStops[index]) < 1e-9));
  assert.deepEqual(f.vibrations, [30]);
  f.feedback.resetRun(195);
  assert.equal(f.feedback.voices.size, 0);
  f.feedback.destroy();
});

test('sound feedback synthesizes hard crashes, throttled scrapes and Depot whoosh with bounded cleanup', () => {
  const f = audioFeedbackFixture();
  f.feedback.unlock();
  f.feedback.impact();
  const [crunch, debris] = [...f.feedback.voices];
  assert.equal(crunch.source.type, 'triangle');
  assert.equal(crunch.source.frequency.events[0][1], 120);
  assert.equal(crunch.source.frequency.events[1][1], 30);
  assert.equal(debris.filter.type, 'lowpass');
  assert.equal(debris.filter.frequency.events[0][1], 800);
  assert.equal(debris.filter.frequency.events[1][1], 100);
  assert.equal(debris.source.buffer, f.feedback.noise);
  f.feedback.clearVoices();
  f.feedback.playMetalScrape();
  const scrape = f.feedback.voices.values().next().value;
  assert.equal(scrape.source.type, 'sawtooth');
  assert.equal(scrape.filter.type, 'bandpass');
  assert.equal(scrape.filter.Q.events[0][1], 5);
  const nodesAfterScrape = f.nodes.length;
  f.feedback.playMetalScrape();
  assert.equal(f.nodes.length, nodesAfterScrape, 'held wall contact is rate-limited');
  f.feedback.clearVoices();
  f.feedback.energyOrbNearMiss();
  const hum = f.feedback.voices.values().next().value;
  assert.equal(hum.source.type, 'sine');
  assert.equal(hum.filter.type, 'bandpass');
  assert.equal(hum.filter.Q.events[0][1], 7);
  assert.equal(hum.source.stops[0], 10.34);
  f.feedback.clearVoices();
  f.feedback.depot();
  const [whoosh, first, second] = [...f.feedback.voices];
  assert.equal(whoosh.filter.type, 'bandpass');
  assert.equal(whoosh.source.buffer, f.feedback.noise);
  assert.equal(whoosh.source.startTime, 10);
  assert.equal(whoosh.source.stops[0], 10.6);
  assert.equal(whoosh.filter.frequency.events[0][1], 200);
  assert.equal(whoosh.filter.frequency.events[1][1], 2500);
  assert.equal(whoosh.filter.frequency.events[2][1], 300);
  assert.equal(first.source.startTime, 10.42);
  assert.equal(second.source.startTime, 10.6);
  assert.deepEqual(f.vibrations, [[30, 20, 30], 200]);
  for (let index = 0; index < 100; index++) f.feedback.impact();
  assert.equal(f.feedback.voices.size, 12, 'active sound voices are capped under burst load');
  assert.equal(f.context.buffers.length, 1, 'one reusable noise buffer, no per-hit samples');
  const voice = f.feedback.voices.values().next().value;
  voice.source.onended();
  assert.equal(f.feedback.voices.size, 11);
  assert.equal(voice.source.disconnected, 1);
  assert.equal(voice.gain.disconnected, 1);
  f.feedback.destroy();
  assert.equal(f.feedback.voices.size, 0);
  assert.ok(f.nodes.every(node => node.disconnected === 1), 'each node disconnected exactly once');
});

test('haptic feedback triggers one 15ms tick per lane crossing, skips unsupported browsers and reports blocked APIs', () => {
  const f = audioFeedbackFixture({supported: false});
  f.feedback.unlock();
  f.feedback.resetRun(86);
  for (const x of [86, 100, 110]) f.feedback.steer(x);
  assert.deepEqual(f.vibrations, []);
  f.feedback.steer(159);
  f.feedback.steer(159);
  f.feedback.steer(232);
  f.feedback.steer(305);
  assert.deepEqual(f.vibrations, [15, 15, 15]);
  f.feedback.resetSteering(195);
  assert.equal(f.vibrations.length, 3, 'Depot centering/new runs are not lane changes');
  f.feedback.destroy();
  const unsupported = audioFeedbackFixture({supported: false, vibrate: null});
  unsupported.feedback.unlock();
  unsupported.feedback.cargoPickup(1);
  unsupported.feedback.impact();
  unsupported.feedback.depot();
  unsupported.feedback.destroy();
  assert.equal(unsupported.nodes.length, 0);
  assert.equal(unsupported.warnings.length, 0, 'absence of optional APIs is an intentional fallback');
  for (const vibrate of [() => false, () => { throw Object.assign(new Error('blocked'), {name: 'SecurityError'}); }]) {
    const blocked = audioFeedbackFixture({vibrate});
    blocked.feedback.unlock();
    blocked.feedback.impact();
    blocked.feedback.impact();
    assert.equal(blocked.warnings.length, 1);
    blocked.feedback.destroy();
  }
  const unexpected = audioFeedbackFixture({vibrate: () => { throw new TypeError('programming error'); }});
  unexpected.feedback.unlock();
  assert.throws(() => unexpected.feedback.impact(), /programming error/);
  unexpected.feedback.navigator = {};
  unexpected.feedback.destroy();
});

test('audio and haptic feedback suspend on blur, hidden or scene pause; cleanup removes every listener and stops sources once', () => {
  const f = audioFeedbackFixture();
  f.canvas.emit('pointerdown');
  f.feedback.impact();
  f.events.emit('pause');
  f.gameEvents.emit('hidden');
  f.gameEvents.emit('blur');
  assert.equal(f.feedback.voices.size, 0);
  assert.equal(f.feedback.master.gain.events.at(-1)[1], 0);
  assert.equal(f.vibrations.at(-1), 0);
  const count = f.nodes.length, vibrations = f.vibrations.length;
  f.feedback.cargoPickup(10);
  assert.equal(f.nodes.length, count);
  assert.equal(f.vibrations.length, vibrations);
  f.events.emit('resume');
  f.gameEvents.emit('visible');
  assert.equal(f.feedback.ready, false, 'focus is still absent');
  f.gameEvents.emit('focus');
  assert.equal(f.feedback.ready, true);
  assert.equal(f.feedback.voices.size, 0, 'suspended effects do not replay');
  f.events.emit('shutdown');
  f.feedback.destroy();
  assert.ok(f.nodes.filter(node => node.kind === 'oscillator' || node.kind === 'bufferSource')
    .every(node => node.stops.length === 2), 'finite effects are stopped once more when canceled');
  assert.equal(f.feedback.master.disconnected, 1);
  assert.equal(f.feedback.compressor.disconnected, 1);
  for (const emitter of [f.events, f.gameEvents, f.canvas, f.document]) assert.equal(emitter.eventNames().length, 0);
  f.canvas.emit('pointerdown');
  f.gameEvents.emit('focus');
  f.feedback.cargoPickup(11);
  assert.equal(f.nodes.length, count);
});

test('collision impact sparks are directional and pooled; low-Hull smoke activates at exactly one third and stops off track', () => {
  const {scene, created} = effectsScene();
  const effects = createHaulerEffects(scene);
  const count = created.length;
  const ship = {x: 195, y: 684, visible: true, scaleX: 1.155, scaleY: 1.155, alpha: 1,
    texture: {key: 'cargo_ship'}};
  const angles = [];
  effects.grind.emitter.explode = (quantity, x, y) => {
    assert.equal(quantity, 18);
    assert.ok(Math.abs(x - ship.x) <= GAME_BALANCE.hazards.playerHalfWidthPx + 1e-9);
    assert.ok(Math.abs(y - ship.y) <= GAME_BALANCE.hazards.playerHalfHeightPx);
    angles.push(effects.grind.emitter.config.angle.onEmit());
  };
  playImpactSparks(effects, ship, 300, 684);
  playImpactSparks(effects, ship, 90, 684);
  assert.ok(angles[0] >= 145 && angles[0] <= 215);
  assert.ok(angles[1] >= -35 && angles[1] <= 35);
  assert.equal(effects.grind.anchor.impactAngle, undefined, 'wall grind direction is restored');
  const smoke = effects.damageSmoke.emitter;
  assert.equal(smoke.config.tint, 0x20242a);
  assert.ok(smoke.config.maxAliveParticles <= 12);
  for (const hull of [6, 3, 2.01, 2, 1, 0]) {
    syncHaulerEffects(effects, ship, [], 0, 12, 'running', 0, 1 / 60, 680, {hull, maxHull: 6});
    assert.equal(smoke.emitting, hull > 0 && hull <= 2, `Hull ${hull}`);
    assert.equal(effects.damageSmoke.anchor.scrollSpeed, 680);
  }
  for (const phase of ['depot', 'menu', 'crashing', 'result']) {
    syncHaulerEffects(effects, ship, [], 0, 12, phase, 0, 1 / 60, 680, {hull: 1, maxHull: 6});
    assert.equal(smoke.emitting, false, phase);
  }
  stopHaulerExhaust(effects);
  assert.equal(smoke.killed, 1);
  assert.equal(created.length, count, 'no per-frame or per-impact effects are allocated');
});

test('chassis steering returns from +/-3.5 degrees over exactly 120ms; actual scene collision feedback and nearmiss alert use required timing', () => {
  const source = readFileSync(new URL('../src/game/scenes/RoutePrototypeScene.js', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\r?\n/gm, '').replace('export class RoutePrototypeScene', 'class RoutePrototypeScene');
  const Scene = vm.runInNewContext(`${source}\nRoutePrototypeScene;`, {
    Phaser: {Scene: class {}}, GAME_BALANCE, balance, SPRITE_ART_SCALE, PALETTE,
    awardCloseCall, closeCallBonusPercent, playImpactSparks,
  });
  const cab = {ship: {scaleX: 1.155, scaleY: 1.155, x: 195, y: 684}, shipBaseScale: 1.155};
  for (const hz of [30, 60, 120]) for (const direction of [-1, 1]) {
    Scene.prototype.applyTruckRoll.call(cab, direction);
    assert.equal(cab.ship.angle, direction * 3.5);
    const dt = 1 / hz;
    for (let elapsed = dt; elapsed < 0.12; elapsed += dt) {
      Scene.prototype.applyTruckRoll.call(cab, 0, dt);
      const expected = direction * 3.5 * (1 - Math.min(elapsed, 0.12) / 0.12) ** 3;
      assert.ok(Math.abs(cab.ship.angle - expected) < 1e-9);
    }
    Scene.prototype.applyTruckRoll.call(cab, 0, dt);
    assert.equal(cab.ship.angle, 0);
    assert.equal(cab.ship.scaleX, 1.155);
  }
  const {scene} = effectsScene();
  const effects = createHaulerEffects(scene);
  effects.grind.emitter.explode = () => {};
  const shakes = [], alerts = [], animations = [];
  const live = {...cab, haulerEffects: effects, hud: {hull: {}},
    debris: {explode() {}}, cameras: {main: {shake(...args) { shakes.push(args); }, flash() {}}},
    pulse() {}, tweens: {add(config) { animations.push(config); }},
    floatText(...args) { alerts.push(args); }, updateShield() {}, refreshHud() {}};
  Scene.prototype.playHitFeedback.call(live, 300, 684, 0, false);
  assert.deepEqual(shakes.at(-1), [100, 0.012]);
  Scene.prototype.absorbWithShield.call(live, 300, 684, 0.6);
  assert.deepEqual(shakes.at(-1), [100, 0.012]);
  Scene.prototype.playHitFeedback.call(live, 300, 684, 0, true);
  assert.deepEqual(shakes.at(-1), [380, 0.02], 'fatal collision feedback is preserved');
  live.runEconomy = createRunEconomy();
  live.cargoItems = [{value: 100, mass: 1, slots: 1}];
  Scene.prototype.awardNearMiss.call(live);
  assert.equal(live.runEconomy.closeCallBonusPercent, 5);
  const alert = alerts.at(-1);
  assert.equal(alert[2], '+5% CLOSE CALL!');
  assert.equal(alert[5], 30);
  assert.equal(alert[6], 400);
  const textNode = {setOrigin() { return this; }, setDepth() { return this; }};
  live.acquireTransientText = () => textNode;
  live.add = {text: () => textNode};
  live.textStyle = Scene.prototype.textStyle;
  Scene.prototype.floatText.call(live, 195, 600, alert[2], '#ffe6a1', 18, alert[5], alert[6]);
  assert.equal(animations.at(-1).y, 570);
  assert.equal(animations.at(-1).duration, 400);
});
import {CHALLENGE_PROFILES} from '../src/game/data/challengeProfiles.js';
import {MODULE_DEFS, formatStat} from '../src/game/core/modules.js';
import {ENVIRONMENTS, resolveVisualTheme, roadTint, ROAD_SURFACE_PRESETS, SECTOR_LIGHTING,
  LEVEL_LIGHTING_PRESETS, LEVEL_SECTOR_LIGHTING, THEMES, OVERDRIVE_LIGHTING, ENVIRONMENT_VISUALS, HAZARD_LIGHTS}
  from '../src/game/data/environments.js';
import {ambientAtPoint, createRoadEnvironment, destroyRoadEnvironment, lightingForSector,
  setRoadEnvironmentVisible, setRoadLighting, startRoadBurst, updateRoadEnvironment} from '../src/game/rendering/roadEnvironment.js';
import {IMPLEMENTED_LEVELS, IMPLEMENTED_SECTORS} from '../src/game/core/sectors.js';
import {DEPOT_ENTRANCE_GEOMETRY, DEPOT_RULES, depotWorldY, depotEntryAllowed} from '../src/game/core/depots.js';
import {CHUNK_REGISTRIES, LEVEL2_CHUNK_REGISTRIES, createTrackGenerator} from '../src/game/core/trackGenerator.js';
import {HAZARDS, guardrailContact, guardrailLayout, hazardGeometry, hazardHits, hazardX, LANE_CENTERS} from '../src/game/core/hazards.js';
import {METERS_PER_PIXEL} from '../src/game/core/economy.js';
import {ROAD_LEFT, ROAD_RIGHT} from '../src/game/data/route.js';

const COLLECTIBLE_SOURCES = Object.freeze({
  blueprint: {svg: 'Blueprint_Sprite.svg', size: [1792, 2400]},
  trailer: {svg: 'Cargo_sprite.svg', size: [1792, 2400]},
  pickup_small: {svg: 'SmallCargoPickup_Sprite.svg', size: [229, 256]},
  pickup_med: {svg: 'MedCargoPickup_Sprite.svg', size: [229, 245]},
  pickup_lg: {svg: 'LgCargoPickup_Sprite.svg', size: [214, 248]},
  pickup_xl: {svg: 'XLCargoPickup_Sprite.svg', size: [242, 269]},
});

test('Garage upgrade assets preserve all eight embedded PNGs and register cached explicit images', () => {
  const sources = ['CargoCap_Upgrade_Sprite.svg', 'PrecisionSteering_Upgrade_Sprite.svg',
    'Magnet_Upgrade_Sprite.svg', 'LWRack_Upgrade_Sprite.svg', 'Plating_Upgrade_Sprite.svg',
    'CargoInsurance_Upgrade_Sprite.svg', 'ImpactPulse_Upgrade_Sprite.svg', 'RechargeShield_Upgrade_Sprite.svg'];
  const cached = new Set(), loads = [];
  const scene = {textures: {exists: key => cached.has(key)},
    load: {image(key, url) { loads.push([key, url]); cached.add(key); }}};
  preloadGarageUpgradeArt(scene);
  preloadGarageUpgradeArt(scene);
  assert.equal(loads.length, 8);
  assert.equal(new Set(GARAGE_UPGRADE_ART.map(art => art.id)).size, 8);
  for (const [index, art] of GARAGE_UPGRADE_ART.entries()) {
    const svg = readFileSync(new URL(`../../art-direction/${sources[index]}`, import.meta.url), 'utf8');
    const encoded = svg.match(/(?:xlink:)?href="data:image\/png;base64,([^"]+)"/)[1];
    const png = readFileSync(new URL(art.url));
    assert.deepEqual(png, Buffer.from(encoded, 'base64'));
    assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0, 'native dimensions are explicit');
  }
});

test('modular tiles and retained legacy obstacle bake keys all have explicit finite texture dimensions', () => {
  for (const key of new Set([...GUARDRAIL_ART.map(art => art.key),
    ...OBSTACLE_ART.flatMap(art => art.textures)])) {
    assert.ok(TEXTURE_SIZES[key]?.every(value => Number.isFinite(value) && value > 0), key);
  }
  const {scene, textures} = drawingScene();
  createIndustrialTextures(scene);
  for (const key of OBSTACLE_ART.flatMap(art => art.textures)) {
    assert.deepEqual([textures.get(key).width, textures.get(key).height], TEXTURE_SIZES[key]);
  }
});

function drawingScene({sourceLoaded = true, swiftLoaded = true, depotLoaded = true} = {}) {
  const textures = new Map();
  const sources = new Map(OBSTACLE_ART.map((art, index) => {
    const [width, height] = [[278, 428], [290, 405],
      [289, 414], [335, 414], [1650, 652], [1792, 2400], [1792, 2400], [1676, 839],
      [508, 866], [1792, 2400]][index];
    return [art.sourceKey, {width, height, key: art.sourceKey}];
  }));
  for (const art of COLLECTIBLE_ART) {
    const [width, height] = COLLECTIBLE_SOURCES[art.id].size;
    sources.set(art.sourceKey, {width, height});
  }
  if (depotLoaded) sources.set(DEPOT_ART.sourceKey, {width: 896, height: 1200});
  for (const [index, art] of GUARDRAIL_ART.entries()) {
    const [width, height] = [[353, 289], [233, 461], [335, 321]][index];
    sources.set(art.key, {width, height, key: art.key});
  }
  if (sourceLoaded) sources.set(STANDARD_HAULER_ART.sourceKey, {width: 2048, height: 2048});
  if (swiftLoaded) sources.set(SWIFT_RUNNER_ART.sourceKey, {width: 2048, height: 2048});
  for (const [index, art] of NEON_ART.entries()) {
    const [width, height] = [[478, 856], [430, 430], [96, 188], [96, 188]][index];
    sources.set(art.sourceKey, {width, height, key: art.sourceKey});
  }
  const canvasTexture = (key, width, height, commands = []) => {
    const context = {};
    for (const method of ['drawImage', 'save', 'restore', 'translate', 'rotate',
      'clearRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill']) {
      context[method] = (...args) => commands.push([method, ...args]);
    }
    context.getImageData = () => ({data: new Uint8ClampedArray(width * height * 4)});
    context.createImageData = () => ({data: new Uint8ClampedArray(width * height * 4)});
    context.putImageData = (...args) => commands.push(['putImageData', ...args]);
    const texture = {width, height, commands, context, refreshed: false,
      setFilter(filter) { this.filter = filter; },
      getSourceImage: () => ({width, height, key}),
      getContext: () => context, refresh() { this.refreshed = true; }};
    assert.ok(!textures.has(key));
    textures.set(key, texture);
    return texture;
  };
  let commands = [];
  let destroyed = false;
  const graphics = {};
  for (const method of [
    'fillStyle', 'fillPoints', 'fillRect', 'fillCircle', 'lineStyle', 'strokeCircle',
    'fillEllipse', 'strokeEllipse', 'fillTriangle', 'strokeTriangle', 'lineBetween',
    'save', 'restore', 'scaleCanvas', 'translateCanvas', 'setDepth',
  ]) {
    graphics[method] = (...args) => {
      commands.push([method, ...args]);
      return graphics;
    };
  }
  graphics.generateTexture = (key, width, height) => {
    canvasTexture(key, width, height, commands);
  };
  graphics.clear = () => { commands = []; };
  graphics.destroy = () => { destroyed = true; };
  return {
    scene: {add: {graphics: () => graphics}, textures: {
      exists: key => sources.has(key) || textures.has(key),
      get(key) {
        if (sources.has(key)) return {getSourceImage: () => sources.get(key)};
        assert.ok(textures.has(key), key);
        return textures.get(key);
      },
      remove(key) {
        assert.ok(sources.has(key), key);
        sources.delete(key);
      },
      createCanvas: canvasTexture,
    }},
    textures,
    getCommands: () => commands,
    isDestroyed: () => destroyed,
  };
}

test('industrial rendering preserves all gameplay texture dimensions and releases drawing graphics', () => {
  const mock = drawingScene();
  createIndustrialTextures(mock.scene);
  const expected = {
    cargo_ship: [54, 65], cargo_ship_swift: [54, 65], cargo_coin: [42, 42], cargo_coinStack: [42, 42],
    cargo_hazard: [62, 50], cargo_stack: [32, 30], cargo_spark: [8, 8], module_util_impact_pulse: [40, 40],
  };
  for (const [key, [width, height]] of Object.entries(expected)) {
    const texture = mock.textures.get(key);
    assert.equal(texture.width, width);
    assert.equal(texture.height, height);
    assert.ok(texture.commands.length > 0);
  }
  assert.ok([...mock.textures.keys()].every(key => TEXTURE_SIZES[key]), 'all generated frames have declared dimensions');
  assert.ok(mock.isDestroyed());
  const original = mock.textures.get('cargo_ship');
  createIndustrialTextures(mock.scene);
  assert.equal(mock.textures.get('cargo_ship'), original, 'Scene restarts reuse baked textures');
  assert.notDeepEqual(mock.textures.get('cargo_ship_swift').commands, original.commands);
  assert.equal(vehicleTint('standard', 'default'), null);
  assert.equal(vehicleTint('swift', 'default'), null, 'approved Swift default uses its original materials');
  assert.equal(vehicleTint('standard', 'gold'), null, 'Standard uses painted materials, never a global tint');
});

test('Standard Hauler uses the exact approved standalone raster with alpha, not concept extraction', () => {
  const svg = readFileSync(new URL('../../art-direction/Standard_Hauler_Sprite.svg', import.meta.url), 'utf8');
  const embedded = svg.match(/data:image\/png;base64,([A-Za-z0-9+/=\s]+)/);
  assert.ok(embedded, 'approved SVG contains a standalone raster');
  const image = readFileSync(new URL(STANDARD_HAULER_ART.url));
  assert.deepEqual(image, Buffer.from(embedded[1], 'base64'), 'no cropping, recoloring or background removal');
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(image.readUInt32BE(16), 2048);
  assert.equal(image.readUInt32BE(20), 2048);
  assert.equal(image[25], 6, 'RGBA PNG');
});

test('approved Hauler preload, transparent fitting and cache reuse preserve native frames', () => {
  const mock = drawingScene();
  const loads = [];
  mock.scene.load = {image: (...args) => loads.push(args)};
  preloadStandardHauler(mock.scene);
  assert.equal(loads.length, 0, 'already-loaded source is reused');
  createIndustrialTextures(mock.scene);
  for (const [key, resolution] of [['cargo_ship', 1], ['cargo_preview', 3]]) {
    const texture = mock.textures.get(key);
    assert.ok(texture.refreshed);
    assert.equal(texture.context.imageSmoothingQuality, 'high');
    const [, source, x, y, width, height] = texture.commands[0];
    assert.ok(Math.abs(width / source.width - height / source.height) < 1e-12,
      'uniform scale preserves approved proportions');
    const {bounds} = STANDARD_HAULER_ART;
    const scale = height / source.height;
    assert.ok(Math.abs(y + bounds.y * scale - resolution) < 1e-10);
    assert.ok(Math.abs(y + (bounds.y + bounds.height) * scale - (texture.height - resolution)) < 1e-10);
    assert.ok(x + bounds.x * scale > 0 && x + (bounds.x + bounds.width) * scale < texture.width);
  }
  assert.equal(mock.scene.textures.exists(STANDARD_HAULER_ART.sourceKey), false,
    'full-size source texture is released after both native textures are baked');
  preloadStandardHauler(mock.scene);
  createIndustrialTextures(mock.scene);
  assert.equal(loads.length, 0, 'scene restart neither reloads nor rebakes');
  const missing = drawingScene({sourceLoaded: false});
  missing.scene.load = mock.scene.load;
  preloadStandardHauler(missing.scene);
  assert.deepEqual(loads, [[STANDARD_HAULER_ART.sourceKey, STANDARD_HAULER_ART.url]]);
  assert.throws(() => createIndustrialTextures(missing.scene), /Approved Standard Hauler sprite failed to load/);
});

test('Swift Runner uses the exact approved standalone raster, with no crop or recoloring', () => {
  const svg = readFileSync(new URL('../../art-direction/SwiftRunner_Sprite.svg', import.meta.url), 'utf8');
  const embedded = svg.match(/data:image\/png;base64,([A-Za-z0-9+/=\s]+)/);
  assert.ok(embedded);
  const image = readFileSync(new URL(SWIFT_RUNNER_ART.url));
  assert.deepEqual(image, Buffer.from(embedded[1], 'base64'));
  assert.equal(image.readUInt32BE(16), 2048);
  assert.equal(image.readUInt32BE(20), 2048);
  assert.equal(image[25], 6, 'RGBA PNG');
});

test('Swift preload and shared baking preserve transparent native and preview bounds and release the source', () => {
  const mock = drawingScene();
  const loads = [];
  mock.scene.load = {image: (...args) => loads.push(args)};
  preloadSwiftRunner(mock.scene);
  assert.equal(loads.length, 0, 'already-loaded source is reused');
  createIndustrialTextures(mock.scene);
  const originals = [];
  for (const [key, resolution] of [['cargo_ship_swift', 1], ['cargo_preview_swift', 3]]) {
    const texture = mock.textures.get(key);
    originals.push(texture);
    assert.deepEqual([texture.width, texture.height], [54 * resolution, 65 * resolution]);
    assert.ok(texture.refreshed);
    assert.equal(texture.context.imageSmoothingQuality, 'high');
    assert.equal(texture.commands.length, 1, 'source is drawn whole and never painted over');
    const [method, source, x, y, width, height] = texture.commands[0];
    assert.equal(method, 'drawImage');
    assert.equal(texture.commands[0].length, 6, 'full-source form of drawImage, not a crop');
    const scale = width / source.width;
    const {bounds} = SWIFT_RUNNER_ART;
    assert.ok(Math.abs(scale - height / source.height) < 1e-12);
    assert.ok(Math.abs(y + bounds.y * scale - resolution) < 1e-10);
    assert.ok(Math.abs(y + (bounds.y + bounds.height) * scale - (texture.height - resolution)) < 1e-10);
    assert.ok(x + bounds.x * scale > 0 && x + (bounds.x + bounds.width) * scale < texture.width);
    assert.ok(Math.abs(x + (bounds.x + bounds.width / 2) * scale - texture.width / 2) < 1e-10);
  }
  assert.ok(!mock.scene.textures.exists(SWIFT_RUNNER_ART.sourceKey));
  preloadSwiftRunner(mock.scene);
  createIndustrialTextures(mock.scene);
  assert.equal(loads.length, 0);
  assert.deepEqual(['cargo_ship_swift', 'cargo_preview_swift'].map(key => mock.textures.get(key)), originals);
  const missing = drawingScene({swiftLoaded: false});
  missing.scene.load = mock.scene.load;
  preloadSwiftRunner(missing.scene);
  assert.deepEqual(loads, [[SWIFT_RUNNER_ART.sourceKey, SWIFT_RUNNER_ART.url]]);
  assert.throws(() => createIndustrialTextures(missing.scene), /Approved Swift Runner sprite failed to load/);
  assert.equal(missing.textures.size, 0, 'missing Swift cannot silently substitute procedural art');
});

test('Swift artwork uses the existing trim IDs and tint colors without tinting its approved default', () => {
  for (const [id, tint] of [['default', null], ['white-blue', 0x80bfff], ['black-red', 0xe07070],
    ['yellow-blue', 0xf4d45e], ['gold', 0xf6cb46]]) {
    assert.equal(vehicleTint('swift', id), tint);
    assert.equal(vehicleTexture('swift', id), 'cargo_ship_swift');
    assert.equal(vehicleTexture('swift', id, true), 'cargo_preview_swift');
    assert.equal(vehicleTrimName('swift', id), id === 'default' ? 'STANDARD' : id.replace('-', ' / ').toUpperCase());
  }
});

test('Standard paint replaces amber and grey separately while preserving glass, cyan, outlines and alpha', () => {
  const width = 54, height = 65;
  const pixelAt = (pixels, x, y) => [...pixels.slice((y * width + x) * 4, (y * width + x + 1) * 4)];
  for (const id of Object.keys(STANDARD_HAULER_TRIMS)) {
    const pixels = new Uint8ClampedArray(width * height * 4);
    const samples = [
      [15, 30, [215, 171, 33, 180]], [27, 35, [90, 94, 96, 255]],
      [27, 17, [60, 67, 70, 255]], [8, 30, [48, 225, 228, 245]],
      [9, 30, [15, 17, 18, 255]], [10, 30, [200, 150, 25, 0]],
    ];
    samples.forEach(([x, y, rgba]) => pixels.set(rgba, (y * width + x) * 4));
    recolorStandardHauler(pixels, width, id);
    const rails = pixelAt(pixels, 15, 30), body = pixelAt(pixels, 27, 35);
    assert.equal(rails[3], 180);
    assert.equal(body[3], 255);
    for (const [x, y, rgba] of samples.slice(2)) assert.deepEqual(pixelAt(pixels, x, y), rgba, id);
    if (id === 'white-blue') {
      assert.ok(rails[2] > rails[0] * 2 && rails[2] > rails[1]);
      assert.ok(Math.min(...body.slice(0, 3)) > 190);
    } else if (id === 'black-red') {
      assert.ok(rails[0] > rails[1] * 2 && rails[0] > rails[2] * 2);
      assert.ok(Math.max(...body.slice(0, 3)) < 60);
    } else if (id === 'yellow-blue') {
      assert.ok(rails[0] > rails[2] * 3 && rails[1] > rails[2] * 3);
      assert.ok(body[1] > body[0] * 1.5 && body[1] > body[2] * 1.4);
    } else {
      assert.ok(rails[0] > rails[1] && rails[1] > rails[2] * 2);
      assert.ok(Math.min(...body.slice(0, 3)) > 190);
    }
    assert.equal(vehicleTexture('standard', id), `cargo_ship_${id}`);
    assert.equal(vehicleTexture('standard', id, true), `cargo_preview_${id}`);
    assert.equal(vehicleTint('standard', id), null);
    assert.equal(vehicleTexture('swift', id), 'cargo_ship_swift');
  }
  assert.equal(vehicleTrimName('standard', 'yellow-blue'), 'YELLOW / GREEN',
    'legacy save ID and purchase stay intact while Standard presentation changes');
  assert.equal(vehicleTrimName('swift', 'yellow-blue'), 'YELLOW / BLUE');
  assert.equal(vehicleTrimName('standard', 'gold'), 'GOLD / WHITE');
});

test('all Standard finishes are cached at matching native and preview dimensions', () => {
  const mock = drawingScene();
  createIndustrialTextures(mock.scene);
  for (const id of Object.keys(STANDARD_HAULER_TRIMS)) for (const preview of [false, true]) {
    const texture = mock.textures.get(vehicleTexture('standard', id, preview));
    assert.deepEqual([texture.width, texture.height], preview ? [162, 195] : [54, 65]);
    assert.equal(texture.commands.filter(([method]) => method === 'putImageData').length, 1);
    assert.equal(texture.commands.filter(([method]) => method === 'drawImage').length, 1);
  }
  assert.ok(!mock.textures.get('cargo_ship').commands.some(([method]) => method === 'putImageData'));
});

test('all obstacle rasters are exact approved standalone RGBA exports', () => {
  const names = ['Vent_Obstacle_Sprite.svg', 'Vent2_Obstacle_Sprite.svg', 'Pipe_Sprite1.svg', 'Pipe_Sprite2.svg',
    'Barrier_Sprite.svg', 'RockSlab_Sprite.svg', 'SignalCabinet_Sprite.svg',
    'Sweeper_Forklift_Sprite.svg', 'ServiceBoom_Sprite.svg'];
  for (const [index, art] of OBSTACLE_ART.entries()) {
    const svg = readFileSync(new URL(`../../art-direction/${names[index]}`, import.meta.url), 'utf8');
    const embedded = svg.match(/data:image\/png;base64,([A-Za-z0-9+/=\s]+)/);
    assert.ok(embedded, names[index]);
    const image = readFileSync(new URL(art.url));
    assert.deepEqual(image, Buffer.from(embedded[1], 'base64'), names[index]);
    assert.equal(image[25], 6, 'preserve source RGBA, no cropping or reencoding');
  }
});

test('obstacle preload substitutes missing art explicitly and releases sources after one cached bake', t => {
  const warning = t.mock.method(console, 'warn', () => {});
  const mock = drawingScene();
  const loads = [];
  mock.scene.load = {image: (...args) => loads.push(args)};
  preloadObstacleArt(mock.scene);
  assert.equal(loads.length, 0);
  const art = OBSTACLE_ART.find(art => art.id === 'pipes2');
  mock.scene.textures.remove(art.sourceKey);
  preloadObstacleArt(mock.scene);
  assert.deepEqual(loads, [[art.sourceKey, art.url]]);
  createIndustrialTextures(mock.scene);
  assert.ok(warning.mock.calls.some(call => call.arguments[0].includes('hazard_pipeAssembly')));
  assert.equal(mock.textures.get('hazard_pipeAssembly').commands[0][1].key, 'hazard_divider');

  const ready = drawingScene();
  ready.scene.load = mock.scene.load;
  createIndustrialTextures(ready.scene);
  const originals = [...ready.textures];
  assert.ok(OBSTACLE_ART.every(art => !ready.scene.textures.exists(art.sourceKey)));
  loads.length = 0;
  preloadObstacleArt(ready.scene);
  createIndustrialTextures(ready.scene);
  assert.equal(loads.length, 0);
  assert.deepEqual([...ready.textures], originals, 'restarts reuse textures, not source images');
});

test('approved obstacle art fits native frames without stretching or changing hazard geometry', () => {
  const mock = drawingScene();
  const geometry = JSON.stringify(HAZARDS);
  createIndustrialTextures(mock.scene);
  for (const key of ['hazard_pipeAssembly', 'hazard_roadsideMachine']) {
    const texture = mock.textures.get(key);
    const kind = key === 'hazard_pipeAssembly' ? 'pipeAssembly' : 'roadsideMachine';
    const spec = HAZARDS[kind];
    const top = spec.scenery ? (spec.scenery.height - spec.height) / 2 + 2 : 5;
    const bottom = texture.height - top;
    const left = spec.scenery ? Math.max(0, spec.scenery.anchorX - spec.width / 2 + 2) : 2;
    const right = spec.scenery ? spec.scenery.anchorX + spec.width / 2 - 2 : 54;
    let cx, cy, angle;
    for (const [method, ...args] of texture.commands) {
      if (method === 'translate') [cx, cy] = args;
      if (method === 'rotate') [angle] = args;
      if (method !== 'drawImage') continue;
      const [image, x, y, width, height] = args;
      assert.equal(args.length, 5, 'full sprite, never crop a composite');
      assert.ok(Math.abs(width / image.width - height / image.height) < 1e-12);
      assert.equal(x, -width / 2);
      assert.equal(y, -height / 2);
      const halfWidth = angle ? height / 2 : width / 2;
      const halfHeight = angle ? width / 2 : height / 2;
      assert.ok(cx - halfWidth >= left - 1e-9 && cx + halfWidth <= right + 1e-9, key);
      assert.ok(cy - halfHeight >= top - 1e-9 && cy + halfHeight <= bottom + 1e-9, key);
    }
    assert.equal(texture.commands.filter(([method]) => method === 'drawImage').length,
      kind === 'pipeAssembly' ? 2 : 3);
    assert.ok(texture.refreshed);
  }
  assert.equal(JSON.stringify(HAZARDS), geometry);
  assert.equal(HAZARDS.pipeAssembly.elongated, true, 'legacy roadside look redirects to modular guardrails');
  for (const sector of Object.values(IMPLEMENTED_LEVELS).flat()) {
    assert.deepEqual([0, 1, 2, 3].map(lane => hazardTexture('barrier', sector, lane)),
      Array(4).fill('cargo_hazard'));
    assert.equal(hazardTexture('sideWall', sector, 3), hazardTexture('sideWall', sector, 0));
  }
});

test('unsprited obstacles have no baked procedural textures and never reuse cargo pickup art', () => {
  const mock = drawingScene();
  createIndustrialTextures(mock.scene);
  for (const kind of ['container', 'machinery', 'wreckage', 'energySpine', 'coolingDrum',
    'reactorShield', 'bollard', 'gate']) {
    assert.ok(!mock.textures.has(HAZARDS[kind].texture), `${kind} is not baked`);
    for (const environment of Object.values(ENVIRONMENTS)) {
      assert.ok(!environment.hazardFamilies.includes(kind));
    }
    for (const profile of Object.values(CHALLENGE_PROFILES)) {
      assert.ok(!profile.fillerHazardFamilies.includes(kind));
      assert.ok(!profile.betaHazardFamilies.includes(kind));
    }
  }
  assert.ok(!OBSTACLE_ART.some(art => art.textures.some(key => key.startsWith('hazard_container'))));
  assert.ok(!OBSTACLE_ART.some(art => /cargo-pickup/.test(art.url)));
  assert.ok(!mock.textures.has('hazard_container_amber') && !mock.textures.has('hazard_container_core'));
});

test('road cargo pickups map payout to Small, Med, Lg and XL art with blue or gold glows', () => {
  assert.deepEqual([5, 10, 20, 25, 30].map(cargoPickupTexture), [
    'cargo_pickup_small', 'cargo_pickup_med', 'cargo_pickup_lg', 'cargo_pickup_xl', 'cargo_pickup_xl']);
  assert.deepEqual([5, 10, 20, 25, 30].map(cargoPickupGlowTexture), [
    'cargo_pickup_glow_blue', 'cargo_pickup_glow_blue', 'cargo_pickup_glow_blue',
    'cargo_pickup_glow_gold', 'cargo_pickup_glow_gold']);
  const mock = drawingScene();
  createIndustrialTextures(mock.scene);
  const fills = key => mock.textures.get(key).commands
    .filter(([method]) => method === 'fillStyle').map(([, color, alpha]) => [color, alpha]);
  for (const key of ['cargo_pickup_glow_blue', 'cargo_pickup_glow_gold']) {
    assert.deepEqual(TEXTURE_SIZES[key], [64, 64]);
    assert.ok(fills(key).length > 3 && fills(key).every(([, alpha]) => alpha <= 0.15), 'soft layered glow');
  }
  assert.ok(fills('cargo_pickup_glow_gold').every(([color]) => color === PALETTE.gold));
  assert.ok(fills('cargo_pickup_glow_blue').every(([color]) => color !== PALETTE.gold));
  const sprite = {...visualNode(), x: 73, y: 310};
  const glow = visualNode();
  syncBlueprintVisuals(sprite, glow, 900, CARGO_PICKUP_GLOW_OFFSET_Y);
  assert.equal(glow.x, sprite.x);
  assert.equal(glow.y, sprite.y + CARGO_PICKUP_GLOW_OFFSET_Y, 'drop shadow sits under the pickup');
  assert.ok(sprite.rotation > 0, 'same spin as Blueprint pickups');
});

test('Barrier, Rockslab and Signal Cabinet fit their existing solid bodies with whole approved artwork', () => {
  const mock = drawingScene();
  const geometry = JSON.stringify(HAZARDS);
  createIndustrialTextures(mock.scene);
  const barrierBody = hazardGeometry('barrier').footprint[0];
  const expected = [
    ['barrier', 'cargo_hazard', [62, 50], [0, 0, 1650, 652], 0,
      [31 + barrierBody.x - barrierBody.halfWidth, 25 + barrierBody.y - barrierBody.halfHeight,
        barrierBody.halfWidth * 2, barrierBody.halfHeight * 2]],
    ['rockSlab', 'hazard_rockSlab', [60, 46], [204, 201, 1413, 2037],
      Math.PI / 2, [2, 3, 56, 40]],
    ['signalCabinet', 'hazard_signalCabinet', [40, 58], [156, 154, 1484, 2091],
      0, [2, 2, 36, 54]],
  ];
  for (const [kind, key, size, bounds, rotation, mount] of expected) {
    const art = OBSTACLE_ART.find(art => art.kind === kind);
    const texture = mock.textures.get(key);
    assert.deepEqual([texture.width, texture.height], size);
    assert.deepEqual(Object.values(art.bounds), bounds);
    assert.equal(art.rotation ?? 0, rotation);
    const draws = texture.commands.filter(([method]) => method === 'drawImage');
    assert.equal(draws.length, 1, key);
    const [, image, x, y, width, height] = draws[0];
    assert.equal(draws[0].length, 6, 'whole source, no cropping');
    const scale = width / image.width;
    assert.ok(Math.abs(scale - height / image.height) < 1e-12, 'uniform scale');
    const [bx, by, bw, bh] = bounds;
    assert.ok(Math.abs(x + (bx + bw / 2) * scale) < 1e-12, 'visible bounds centered');
    assert.ok(Math.abs(y + (by + bh / 2) * scale) < 1e-12);
    const visibleWidth = (rotation ? bh : bw) * scale;
    const visibleHeight = (rotation ? bw : bh) * scale;
    assert.ok(visibleWidth <= mount[2] + 1e-9 && visibleHeight <= mount[3] + 1e-9);
    assert.ok(Math.abs(visibleWidth - mount[2]) < 1e-9, `${kind}: ${visibleWidth} vs mount ${mount}`);
    assert.ok(texture.commands.some(([method, angle]) => method === 'rotate' && angle === rotation));
    assert.ok(texture.refreshed);
    for (const sector of Object.values(IMPLEMENTED_LEVELS).flat()) {
      for (let lane = 0; lane < 4; lane++) assert.equal(hazardTexture(kind, sector, lane), key);
    }
  }
  assert.equal(JSON.stringify(HAZARDS), geometry);
});

test('all imported obstacles bake only the approved artwork on transparent canvases, without grey boxes', () => {
  const mock = drawingScene();
  createIndustrialTextures(mock.scene);
  const allowed = new Set(['save', 'translate', 'rotate', 'drawImage', 'restore']);
  for (const key of new Set(OBSTACLE_ART.flatMap(art => art.textures))) {
    const texture = mock.textures.get(key);
    assert.ok(texture.commands.length > 0, key);
    assert.ok(texture.commands.every(([method]) => allowed.has(method)),
      `${key}: no generated plate, housing, background fill or old illustration`);
    const expectedSources = OBSTACLE_ART.filter(art => art.textures.includes(key)).map(art => art.sourceKey);
    const draws = texture.commands.filter(([method]) => method === 'drawImage');
    assert.ok(draws.every(([, source]) => expectedSources.includes(source.key)), key);
    assert.ok(expectedSources.every(source => draws.some(([, image]) => image.key === source)), key);
  }
});

test('Barrier replaces concrete dividers in every sector while retaining each existing texture key and footprint', () => {
  const mock = drawingScene();
  const geometry = JSON.stringify(HAZARDS.divider);
  createIndustrialTextures(mock.scene);
  const expectedKeys = ['hazard_divider', 'divider_dustlands', 'divider_neon', 'divider_reactor', 'divider_overdrive'];
  const art = OBSTACLE_ART.find(art => art.id === 'barrier');
  for (const key of expectedKeys) {
    assert.ok(art.textures.includes(key));
    const texture = mock.textures.get(key);
    assert.deepEqual([texture.width, texture.height], [64, 30]);
    const [, image, x, y, width, height] = texture.commands.find(([method]) => method === 'drawImage');
    assert.equal(image.key, 'obstacle_source_barrier');
    assert.ok(Math.abs(width - 60) < 1e-12);
    assert.ok(height <= 26);
    assert.ok(Math.abs(width / image.width - height / image.height) < 1e-12);
    assert.equal(x, -width / 2);
    assert.equal(y, -height / 2);
    assert.ok(texture.commands.some(([method, cx, cy]) => method === 'translate' && cx === 32 && cy === 15));
  }
  for (const sector of Object.values(IMPLEMENTED_LEVELS).flat()) {
    for (let lane = 0; lane < 4; lane++) assert.ok(expectedKeys.includes(hazardTexture('divider', sector, lane)));
  }
  assert.equal(JSON.stringify(HAZARDS.divider), geometry);
  const [dividerBody] = hazardGeometry('divider').footprint;
  const dividerEdge = dividerBody.halfWidth + GAME_BALANCE.hazards.playerHalfWidthPx;
  assert.equal(hazardHits('divider', 159, 0, 159 + dividerEdge - 0.01, 0), true);
  assert.equal(hazardHits('divider', 159, 0, 159 + dividerEdge + 0.01, 0), false,
    'the solid footprint plus the truck half-width, not the legacy hitX, is the contact edge');
});

test('each obstacle source has explicit sprite fallback or a fatal error when the fallback itself is missing', t => {
  const warning = t.mock.method(console, 'warn', () => {});
  for (const art of OBSTACLE_ART.filter(art => art.kind)) {
    const mock = drawingScene();
    const loads = [];
    mock.scene.load = {image: (...args) => loads.push(args)};
    mock.scene.textures.remove(art.sourceKey);
    preloadObstacleArt(mock.scene);
    assert.deepEqual(loads, [[art.sourceKey, art.url]]);
    if (art.id === 'barrier') {
      assert.throws(() => createIndustrialTextures(mock.scene), /no certified obstacle fallback available/);
      assert.equal(mock.textures.size, 0);
    } else {
      const before = warning.mock.calls.length;
      createIndustrialTextures(mock.scene);
      assert.ok(warning.mock.calls.length > before);
      for (const key of art.textures) {
        assert.equal(mock.textures.get(key).commands[0][1].key, 'hazard_divider');
      }
    }
  }
});

test('approved Sweeper forklift stays horizontal inside its unchanged one-lane frame', () => {
  const mock = drawingScene();
  const geometry = JSON.stringify(HAZARDS.sweeper);
  createIndustrialTextures(mock.scene);
  const texture = mock.textures.get('hazard_forklift');
  assert.deepEqual([texture.width, texture.height], [73, 68]);
  const draws = texture.commands.filter(([method]) => method === 'drawImage');
  assert.equal(draws.length, 1);
  assert.equal(draws[0].length, 6, 'whole source, no cropping');
  const [, image, x, y, width, height] = draws[0];
  assert.equal(image.key, 'obstacle_source_sweeper');
  assert.deepEqual([image.width, image.height], [1676, 839]);
  assert.ok(Math.abs(width - 63) < 1e-12, 'inset solid body retains its existing width');
  assert.ok(Math.abs(width / image.width - height / image.height) < 1e-12);
  assert.equal(x, -width / 2);
  assert.equal(y, -height / 2);
  assert.ok(texture.commands.some(([method, angle]) => method === 'rotate' && angle === 0));
  assert.ok(texture.commands.some(([method, cx, cy]) =>
    method === 'translate' && cx === 36.5 && cy === 34));
  assert.ok(height < 58);
  assert.ok(texture.refreshed);
  assert.equal(JSON.stringify(HAZARDS.sweeper), geometry);
  for (const sector of Object.values(IMPLEMENTED_LEVELS).flat()) {
    for (let lane = 0; lane < 4; lane++) assert.equal(hazardTexture('sweeper', sector, lane), 'hazard_forklift');
  }
});

test('approved Service Boom fits the existing roadside body and preserves its anchor without a backing plate', () => {
  const mock = drawingScene();
  const geometry = JSON.stringify(HAZARDS.serviceBoom);
  createIndustrialTextures(mock.scene);
  const texture = mock.textures.get('hazard_serviceBoom');
  assert.deepEqual([texture.width, texture.height], TEXTURE_SIZES.hazard_serviceBoom);
  const draws = texture.commands.filter(([method]) => method === 'drawImage');
  assert.equal(draws.length, 1);
  assert.equal(draws[0].length, 6, 'whole source, never crop the supplied machine');
  const [, image, x, y, width, height] = draws[0];
  assert.equal(image.key, 'obstacle_source_serviceBoom');
  assert.deepEqual([image.width, image.height], [1792, 2400]);
  const scale = width / image.width;
  assert.ok(Math.abs(scale - height / image.height) < 1e-12, 'preserve approved proportions');
  assert.ok(Math.abs(x + (329 + 1136 / 2) * scale) < 1e-12);
  assert.ok(Math.abs(y + (125 + 2136 / 2) * scale) < 1e-12);
  assert.ok(Math.abs(scale - Math.min((HAZARDS.serviceBoom.width - 4) / 2136,
    (HAZARDS.serviceBoom.height - 4) / 1136)) < 1e-12, 'fit both single-lane axes without stretching');
  assert.ok(2136 * scale <= HAZARDS.serviceBoom.width - 4, 'visible length stays inside the single-lane projection');
  assert.ok(texture.commands.some(([method, angle]) => method === 'rotate' && angle === Math.PI / 2),
    'base faces the left roadside and the arm points into the road before right-edge mirroring');
  assert.ok(texture.commands.some(([method, cx, cy]) => method === 'translate' &&
    cx === HAZARDS.serviceBoom.scenery.anchorX && cy === HAZARDS.serviceBoom.scenery.height / 2),
    'use the scenery anchor, not half the physical body width');
  assert.ok(!texture.commands.some(([method]) => method === 'fillRect' || method === 'fillPoints'),
    'only supplied artwork, no procedural carrier or roadside housing');
  assert.ok(texture.refreshed);
  assert.equal(JSON.stringify(HAZARDS.serviceBoom), geometry);
  assert.equal(HAZARDS.serviceBoom.elongated, true, 'gameplay uses modular tiles, retaining a sized legacy bake key');
  for (const sector of Object.values(IMPLEMENTED_LEVELS).flat()) {
    for (const lane of [0, 3]) assert.equal(hazardTexture('serviceBoom', sector, lane), 'chicane_mid');
  }
});

test('cargo capacity uses a dedicated amber steel crate sprite without changing cargo rarities', () => {
  const mock = drawingScene();
  createIndustrialTextures(mock.scene);
  const stack = mock.textures.get('cargo_stack');
  const freight = mock.textures.get('cargo_freight');
  assert.deepEqual([stack.width, stack.height], [32, 30]);
  assert.notDeepEqual(stack.commands, freight.commands);
  assert.ok(stack.commands.some(([method, color]) => method === 'fillStyle' && color === PALETTE.steelDark));
  assert.ok(stack.commands.some(([method, color]) => method === 'fillStyle' && color === PALETTE.gold));
  assert.ok(stack.commands.some(([method, color]) => method === 'fillStyle' && color === PALETTE.cyan));
  assert.ok(stack.commands.some(([method]) => method === 'fillPoints'), 'beveled frame has a distinct crate silhouette');
});

test('Depot menu panel paints an opaque backdrop across the active camera viewport', () => {
  const mock = drawingScene();
  const viewport = {x: -18, y: -44, width: 426, height: 888};
  addIndustrialPanel(mock.scene, 390, 568, viewport);
  assert.ok(mock.getCommands().some(([method, x, y, width, height]) =>
    method === 'fillRect' && x <= viewport.x && y <= viewport.y &&
    x + width >= viewport.x + viewport.width &&
    y + height >= viewport.y + viewport.height));
});

test('menu panels omit the decorative bottom underline that crossed footer controls', () => {
  for (const height of [692.25, 783.714, 844, 940]) {
    const mock = drawingScene();
    addIndustrialPanel(mock.scene, 390, height);
    assert.ok(!mock.getCommands().some(([method, x, y, width, thickness]) =>
      method === 'fillRect' && x === 40 && y === height - 82 && width === 310 && thickness === 2));
  }
});

test('approved blueprint, cargo trailer and cargo pickups use exact standalone rasters with bounded uniform fitting', () => {
  const mock = drawingScene();
  for (const art of COLLECTIBLE_ART) {
    const {svg: svgName, size: [width, height]} = COLLECTIBLE_SOURCES[art.id];
    const svg = readFileSync(new URL(`../../art-direction/${svgName}`, import.meta.url), 'utf8');
    const embedded = svg.match(/data:image\/png;base64,([A-Za-z0-9+/=\s]+)/);
    assert.ok(embedded, svgName);
    const image = readFileSync(new URL(art.url));
    assert.deepEqual(image, Buffer.from(embedded[1], 'base64'), svgName);
    assert.equal(image.readUInt32BE(16), width);
    assert.equal(image.readUInt32BE(20), height);
    assert.equal(image[25], 6);
  }
  createIndustrialTextures(mock.scene);
  for (const art of COLLECTIBLE_ART) {
    const texture = mock.textures.get(art.key);
    assert.deepEqual([texture.width, texture.height], TEXTURE_SIZES[art.key]);
    assert.ok(texture.refreshed);
    assert.ok(!mock.scene.textures.exists(art.sourceKey), 'large source images are released');
    const [, source, x, y, width, height] = texture.commands.find(([method]) => method === 'drawImage');
    const scale = width / source.width;
    assert.ok(Math.abs(scale - height / source.height) < 1e-12);
    assert.equal(texture.commands.find(([method]) => method === 'rotate')[1], art.rotation);
    assert.ok(Math.abs(x + (art.bounds.x + art.bounds.width / 2) * scale) < 1e-12);
    assert.ok(Math.abs(y + (art.bounds.y + art.bounds.height / 2) * scale) < 1e-12);
    const visibleWidth = (art.rotation ? art.bounds.height : art.bounds.width) * scale;
    const visibleHeight = (art.rotation ? art.bounds.width : art.bounds.height) * scale;
    assert.ok(visibleWidth <= texture.width - 2 && visibleHeight <= texture.height - 2 + 1e-10);
    assert.equal(texture.commands.filter(([method]) => method === 'putImageData').length,
      art.id === 'pickup_lg' ? 1 : 0, 'only the large cargo core is recolored');
  }
  const loads = [];
  mock.scene.load = {image: (...args) => loads.push(args)};
  preloadCollectibleArt(mock.scene);
  const original = mock.textures.get('cargo_blueprint');
  createIndustrialTextures(mock.scene);
  assert.equal(loads.length, 0);
  assert.equal(mock.textures.get('cargo_blueprint'), original);
});

test('large cargo center turns orange without changing its neutral shell, transparency or Blueprint source', () => {
  const pixels = new Uint8ClampedArray([
    25, 205, 214, 255, 170, 230, 238, 150,
    45, 52, 55, 255, 12, 12, 12, 80, 0, 220, 255, 0,
  ]);
  recolorLargeCargoPickup(pixels);
  assert.deepEqual([...pixels], [
    214, 108, 40, 255, 238, 198, 175, 150,
    45, 52, 55, 255, 12, 12, 12, 80, 0, 220, 255, 0,
  ]);
});

test('collectible sources preload only missing frames and fail explicitly before any partial bake', () => {
  const mock = drawingScene();
  const missing = COLLECTIBLE_ART[0];
  mock.scene.textures.remove(missing.sourceKey);
  const loads = [];
  mock.scene.load = {image: (...args) => loads.push(args)};
  preloadCollectibleArt(mock.scene);
  assert.deepEqual(loads, [[missing.sourceKey, missing.url]]);
  assert.throws(() => createIndustrialTextures(mock.scene), /Approved collectible sprite failed to load: blueprint/);
  assert.equal(mock.textures.size, 0, 'no partial texture set on source failure');
});

test('blueprint spin and subtle glow follow scrolling position without moving its pickup center', () => {
  const sprite = {...visualNode(), x: 73, y: 310};
  const glow = visualNode();
  const positions = [];
  for (let time = 0; time <= 24000; time += 250) {
    syncBlueprintVisuals(sprite, glow, time);
    assert.equal(sprite.x, 73);
    assert.equal(sprite.y, 310);
    assert.equal(glow.x, sprite.x);
    assert.equal(glow.y, sprite.y);
    assert.ok(sprite.rotation >= 0 && sprite.rotation < Math.PI * 2);
    assert.ok(glow.alpha >= 0.45 && glow.alpha <= 0.65);
    positions.push(sprite.rotation);
  }
  assert.ok(Math.max(...positions) - Math.min(...positions) > 6, 'makes a full turn');
  sprite.y = 510;
  syncBlueprintVisuals(sprite, glow, 30000);
  assert.equal(glow.y, 510);
});

test('Industrial hazard families have independent approved sprite silhouettes without procedural boxes', () => {
  const mock = drawingScene();
  createIndustrialTextures(mock.scene);
  const keys = ['hazard_divider', 'cargo_hazard', 'hazard_rockSlab'];
  const signatures = keys.map(key => JSON.stringify(mock.textures.get(key).commands));
  assert.equal(new Set(signatures).size, keys.length);
  assert.equal(mock.textures.has('hazard_pylon'), false, 'removed pylon art is not baked');
  assert.equal(TEXTURE_SIZES.hazard_pylon, undefined);
  for (const key of keys) {
    const commands = mock.textures.get(key).commands;
    assert.ok(!commands.some(([method]) => method === 'scaleCanvas'), 'native geometry, not stretched barricades');
    assert.ok(!commands.some(([method, color]) => method === 'fillStyle' &&
      [PALETTE.hazard, PALETTE.hazardLight, PALETTE.hazardDark].includes(color)), 'not the old orange/red treatment');
  }
});

test('dividers retain their native texture bounds and approved barrier artwork', () => {
  const mock = drawingScene();
  createIndustrialTextures(mock.scene);
  const divider = mock.textures.get('hazard_divider');
  assert.deepEqual([divider.width, divider.height], [64, 30]);
  assert.ok(divider.commands.some(([method, image]) =>
    method === 'drawImage' && image.key === 'obstacle_source_barrier'),
  'approved striped Barrier replaces the old procedural concrete face');
});

test('roadside mounting base stays completely outside the road and uses shared roadside steel', () => {
  const mock = drawingScene();
  createIndustrialTextures(mock.scene);
  const base = mock.textures.get('industrial_hazard_base');
  assert.deepEqual([base.width, base.height], [43, 116]);
  assert.ok(base.commands.some(([method, color]) => method === 'fillStyle' && color === PALETTE.steelDark));
  assert.ok(base.commands.some(([method, color]) => method === 'fillStyle' && color === PALETTE.safetyYellow));
  assert.equal(21.5 + base.width / 2, 43, 'left base stops at road edge');
  assert.equal(368.5 - base.width / 2, 347, 'right base stops at road edge');
});

test('approved Depot artwork is the exact standalone RGBA export and bakes once without a backing plate', () => {
  const svg = readFileSync(new URL('../../art-direction/Depot_Sprite.svg', import.meta.url), 'utf8');
  const image = readFileSync(new URL(DEPOT_ART.url));
  assert.deepEqual(image, Buffer.from(svg.match(/data:image\/png;base64,([A-Za-z0-9+/=\s]+)/)[1], 'base64'));
  assert.deepEqual([image.readUInt32BE(16), image.readUInt32BE(20), image[25]], [896, 1200, 6]);
  const loads = [];
  const loader = {textures: {exists: () => false}, load: {image: (...args) => loads.push(args)}};
  preloadDepotArt(loader);
  assert.deepEqual(loads, [[DEPOT_ART.sourceKey, DEPOT_ART.url]]);
  for (const cached of [DEPOT_ART.key, DEPOT_ART.sourceKey]) {
    loader.textures.exists = key => key === cached;
    preloadDepotArt(loader);
    assert.equal(loads.length, 1, 'source and baked cache both prevent a duplicate load');
  }
  const missing = drawingScene({depotLoaded: false});
  assert.throws(() => createIndustrialTextures(missing.scene), /Approved Depot sprite failed to load/);
  assert.equal(missing.textures.size, 0, 'missing art fails before partial generation');
  const mock = drawingScene();
  createIndustrialTextures(mock.scene);
  const texture = mock.textures.get(DEPOT_ART.key);
  assert.ok(texture.commands.every(([method]) => ['translate', 'rotate', 'drawImage'].includes(method)));
  const draw = texture.commands.find(([method]) => method === 'drawImage');
  assert.equal(draw.length, 6, 'draw the whole source image, never a cropped source rectangle');
  assert.ok(Math.abs(draw[4] / 896 - draw[5] / 1200) < 1e-12, 'preserve approved proportions');
  assert.equal(mock.scene.textures.exists(DEPOT_ART.sourceKey), false, 'release the full-size source');
  createIndustrialTextures(mock.scene);
  assert.equal(mock.textures.get(DEPOT_ART.key), texture);
});

test('Depot bay art aligns with the unchanged entrance on both roadsides while green spill remains below vehicles', () => {
  const mock = drawingScene();
  createIndustrialTextures(mock.scene);
  const draw = mock.textures.get(DEPOT_ART.key).commands.find(([method]) => method === 'drawImage');
  const scale = draw[4] / 896;
  const localX = draw[2] + DEPOT_ART.bay.roadX * scale;
  const localY = draw[3] + DEPOT_ART.bay.centerY * scale;
  const images = [], containers = [];
  const scene = {add: {
    image(x, y, key) {
      const node = {...visualNode(), x, y, key,
        setDepth(depth) { this.depth = depth; return this; },
        setBlendMode(mode) { this.blendMode = mode; return this; },
        setFlipX(flipX) { this.flipX = flipX; return this; }};
      images.push(node);
      return node;
    },
    container(x, y, children) {
      const node = {x, y, children, setDepth(depth) { this.depth = depth; return this; }};
      containers.push(node);
      return node;
    },
  }};
  const geometry = JSON.stringify(DEPOT_ENTRANCE_GEOMETRY);
  for (const side of ['left', 'right']) {
    const depot = {distance: 1000, side};
    const facility = createDepotFacility(scene, depot, depotWorldY(depot, 999), 'ADD');
    const {container, body, glow} = facility;
    assert.deepEqual(container.children, [body, glow], 'the canopy light is locked inside the Depot container');
    assert.equal(body.scaleX, 1.1);
    assert.equal(glow.blendMode, 'ADD');
    assert.ok(container.depth < 5, 'spill lights the bay but stays below road objects');
    const edgeX = container.x + body.x + localX * body.scaleX * (body.flipX ? -1 : 1);
    const mouthRight = DEPOT_ENTRANCE_GEOMETRY.mouthLeft + DEPOT_ENTRANCE_GEOMETRY.mouthWidth;
    assert.ok(Math.abs(edgeX - (side === 'left' ? mouthRight : 390 - mouthRight)) < 1e-9);
    assert.ok(Math.abs(container.y + body.y + localY * body.scaleY - depotWorldY(depot, 999)) < 1e-9);
    assert.equal(glow.y, 0, 'glow is centred on the bay');
    assert.equal(glow.x, side === 'left' ? 56 : 334);
    assert.equal(body.flipX, side === 'left', 'the source bay faces left; mirror it on the left roadside');
    assert.equal(glow.flipX, side === 'right');
    assert.ok(side === 'left' ? body.x < 30 : body.x > 360, 'machinery stays roadside');
    assert.ok(depotEntryAllowed(depot, 1000, side === 'left' ? 86 : 304));
  }
  assert.equal(JSON.stringify(DEPOT_ENTRANCE_GEOMETRY), geometry);
  assert.equal(images.length, 4, 'one approved sprite and one cached spill light per Depot, nothing else');
  assert.equal(containers.length, 2);
  assert.ok(Math.abs(depotFacilityHeight() - 196 * 1.1) < 1e-9);
});

test('Barrier and Sweeper caution lights share amber double flashes and follow art without geometry or tweens', () => {
  const images = [];
  const scene = {add: {image(x, y, key) {
    const node = {...visualNode(), x, y, key, setDepth(depth) { this.depth = depth; return this; },
      setBlendMode(mode) { this.blendMode = mode; return this; }};
    images.push(node);
    return node;
  }}};
  for (const kind of ['divider', 'barrier', 'sweeper', 'forklift', 'boomLift']) {
    const single = kind === 'forklift' || kind === 'boomLift';
    const initialCount = images.length;
    const sprite = {x: 86, y: 300, scaleX: 1.1, scaleY: 1.1};
    const lights = createBarrierLights(scene, sprite, kind, 0);
    assert.equal(lights.length, single ? 1 : 2);
    assert.ok(lights.every(light => light.key === 'barrier_caution_light' && light.depth === 6 && light.scaleX === 1.1));
    assert.deepEqual(lights.map(light => light.alpha), single ? [1] : [1, 0.18]);
    syncBarrierLights(lights, sprite, kind, 100);
    assert.deepEqual(lights.map(light => light.alpha), lights.map(() => 0.18));
    syncBarrierLights(lights, sprite, kind, 180);
    assert.deepEqual(lights.map(light => light.alpha), single ? [1] : [1, 0.18]);
    sprite.x += 20;
    sprite.y += 80;
    syncBarrierLights(lights, sprite, kind, 500);
    assert.deepEqual(lights.map(light => light.alpha), single ? [0.18] : [0.18, 1]);
    if (single) assert.equal(lights[0].x, sprite.x);
    else {
      assert.ok(lights[0].x < sprite.x && lights[1].x > sprite.x);
      assert.ok(Math.abs((lights[0].x + lights[1].x) / 2 - sprite.x) < 1e-9);
    }
    assert.ok(lights.every(light => light.y === sprite.y - HAZARDS[kind].height * 0.18 * 1.1));
    for (let time = 0; time <= 10000; time += 50) syncBarrierLights(lights, sprite, kind, time);
    assert.equal(images.length, initialCount + lights.length, 'synchronization never allocates more lights');
    assert.ok(lights.every(light => light.scaleX === 1.1), 'no compounded scaling');
    syncBarrierLights(lights, sprite, kind, 0, true);
    assert.deepEqual(lights.map(light => light.alpha),
      single ? [1] : [1, ENVIRONMENT_VISUALS.barrierNightIdleAlpha]);
    assert.ok(lights.every(light => light.scaleX === 1.1 * ENVIRONMENT_VISUALS.barrierNightScale &&
      light.scaleY === light.scaleX && light.blendMode === 'ADD' && light.depth > 16 && light.depth < 18),
    'night strobes are larger, additive and not darkened by the world mask or above the HUD');
    syncBarrierLights(lights, sprite, kind, 100, true);
    assert.deepEqual(lights.map(light => light.alpha), lights.map(() => 0.3),
      'same double-flash timing with a brighter idle glow');
    for (let time = 0; time <= 10000; time += 50) syncBarrierLights(lights, sprite, kind, time, true);
    assert.ok(lights.every(light => light.scaleX === 1.1 * ENVIRONMENT_VISUALS.barrierNightScale),
      'night scaling does not accumulate');
    syncBarrierLights(lights, sprite, kind, 500);
    assert.deepEqual(lights.map(light => light.alpha), single ? [0.18] : [0.18, 1]);
    assert.ok(lights.every(light => light.scaleX === 1.1 && light.blendMode === 'NORMAL' && light.depth === 6),
      'daylight/Overdrive restores the original appearance');
    assert.equal(images.length, initialCount + lights.length, 'night enhancement reuses the same lights');
  }
});

test('every other obstacle carries one slow amber beacon and Neon halos pulse without allocating', () => {
  const images = [];
  const node = (x, y, key) => {
    const image = {...visualNode(), x, y, key, setDepth(depth) { this.depth = depth; return this; },
      setBlendMode(mode) { this.blendMode = mode; return this; },
      setTint(tint) { this.tint = tint; return this; },
      setDisplaySize(width, height) { this.displayWidth = width; this.displayHeight = height; return this; }};
    images.push(image);
    return image;
  };
  const scene = {add: {image: node}};
  for (const kind of ['rockSlab', 'signalCabinet', 'vent', 'ventGrille', 'neonConduit']) {
    const sprite = {x: 120, y: 260, scaleX: 1.1, scaleY: 1.1};
    const lights = createBarrierLights(scene, sprite, kind, 0);
    assert.equal(lights.length, 1, kind);
    assert.equal(lights[0].alpha, HAZARD_LIGHTS.beaconIdleAlpha);
    syncBarrierLights(lights, sprite, kind, HAZARD_LIGHTS.beaconPeriodMs / 2);
    assert.equal(lights[0].alpha, 1, 'beacon peaks mid-period');
    syncBarrierLights(lights, sprite, kind, HAZARD_LIGHTS.beaconPeriodMs / 4, true);
    assert.ok(lights[0].alpha > HAZARD_LIGHTS.beaconIdleAlpha && lights[0].alpha < 1);
    assert.ok(lights[0].depth > 16 && lights[0].blendMode === 'ADD');
  }
  const count = images.length;
  const sprite = {x: 100, y: 300, originX: 0.25, originY: 0.5, displayWidth: 80, displayHeight: 60};
  const halo = createNeonHalo(scene, sprite, 1, 0, true);
  assert.equal(halo.key, HAZARD_LIGHTS.neonHalo.key);
  assert.equal(halo.tint, HAZARD_LIGHTS.neonHalo.tints[1]);
  assert.equal(halo.blendMode, 'ADD');
  assert.equal(halo.x, 120, 'centred on the visual art, not the anchor');
  assert.equal(halo.displayWidth, 80 + HAZARD_LIGHTS.neonHalo.padPx);
  assert.equal(halo.depth, HAZARD_LIGHTS.neonHalo.nightDepth);
  const alphas = new Set();
  for (let time = 0; time <= 4000; time += 100) {
    syncNeonHalo(halo, sprite, time, true);
    alphas.add(halo.alpha);
    assert.ok(halo.alpha >= HAZARD_LIGHTS.neonHalo.alphaMin - 1e-9 && halo.alpha <= HAZARD_LIGHTS.neonHalo.alphaMax + 1e-9);
  }
  assert.ok(alphas.size > 5, 'halo pulses');
  syncNeonHalo(halo, sprite, 0, false);
  assert.equal(halo.depth, HAZARD_LIGHTS.neonHalo.dayDepth);
  assert.equal(images.length, count + 1, 'halo sync never allocates');
});

test('Dusk and Night cargo pickups and embedded shadows dim only slightly and preserve rejection cues', () => {
  const sprite = {...visualNode(), setDepth(depth) { this.depth = depth; return this; },
    setTint(tint) { this.tint = tint; return this; }};
  const glow = {...visualNode(), setDepth(depth) { this.depth = depth; return this; }};
  for (const lighting of [...SECTOR_LIGHTING, OVERDRIVE_LIGHTING]) {
    for (const accepted of [true, false]) {
      for (let repeat = 0; repeat < 3; repeat++) {
        syncCargoPickupVisuals(sprite, glow, 180, lighting.headlights, accepted);
        assert.equal(sprite.tint, lighting.headlights ? 0xe6e6e6 : 0xffffff);
        assert.equal(sprite.alpha, accepted ? 1 : 0.35);
        const pulse = 0.55 + Math.sin(180 / 650) * 0.1;
        assert.ok(Math.abs(glow.alpha - pulse * (lighting.headlights ? 0.9 : 1) *
          (accepted ? 1 : 0.35)) < 1e-9, 'brightness does not accumulate');
        assert.equal(glow.y, sprite.y + CARGO_PICKUP_GLOW_OFFSET_Y * SPRITE_ART_SCALE);
        assert.equal(sprite.depth, lighting.headlights ? 16.2 : 5);
        assert.equal(glow.depth, lighting.headlights ? 16.15 : 4.5);
        if (lighting.headlights) {
          assert.ok((sprite.tint & 255) / 255 >= 0.9 && (sprite.tint & 255) / 255 < 1);
          assert.ok(glow.depth > 16 && glow.depth < sprite.depth && sprite.depth < 18);
        }
      }
    }
  }
});

test('the depot notice is green, side-specific, visible only within 60m and hidden outside driving', () => {
  const mock = drawingScene();
  createIndustrialTextures(mock.scene);
  const entrance = mock.textures.get('depot_entrance');
  assert.deepEqual([entrance.width, entrance.height], [152, 196]);
  assert.equal(entrance.commands.filter(([method]) => method === 'drawImage').length, 1);
  const glow = mock.textures.get('depot_canopy_glow');
  assert.ok(glow.commands.some(([method, color]) => method === 'fillStyle' && color === PALETTE.depot));
  assert.ok(!glow.commands.some(([method, color]) => method === 'fillStyle' &&
    [PALETTE.hazard, PALETTE.hazardLight, PALETTE.gold].includes(color)));
  const view = {label: {...visualNode(), setText(value) { this.text = value; return this; },
    setFontSize(value) { this.fontSize = value; return this; },
    setBackgroundColor(value) { this.backgroundColor = value; return this; }}};
  for (const side of ['left', 'right']) {
    const depot = {distance: 450, side};
    syncDepotEntrance(view, depot, 389.999, 'running');
    assert.ok(!view.label.visible, 'no warning before 60 m');
    syncDepotEntrance(view, depot, 390, 'running');
    assert.ok(view.label.visible, 'initial notice at exactly 60 m');
    assert.equal(view.label.text, `DEPOT 60 m\n${side === 'left' ? '<<<' : '>>>'} DOCK`);
    assert.equal(view.label.fontSize, 18);
    assert.equal(view.label.backgroundColor, 'rgba(33, 78, 59, 0.25)');
    for (const [remaining, alpha] of [[60, 0.25], [40, 0.5], [20, 0.75], [0, 1]]) {
      syncDepotEntrance(view, depot, depot.distance - remaining, 'running');
      const actual = Number(view.label.backgroundColor.match(/, ([\d.]+)\)$/)[1]);
      assert.ok(Math.abs(actual - alpha) < 1e-9, `background fills continuously at ${remaining} m`);
    }
    assert.equal(view.label.x, side === 'left' ? 12 : 188);
    assert.match(view.label.text, side === 'left' ? /<<</ : />>>/);
    assert.equal(view.label.y, 120, 'notice stays below the HUD and above near-field steering');
    syncDepotEntrance(view, depot, 426.2, 'running');
    assert.match(view.label.text, /DEPOT 24 m\n/, 'live distance rounds up');
    assert.ok(!/\bBAY\b/.test(view.label.text));
    for (const phase of ['menu', 'garage', 'docking', 'depot', 'crashing', 'result']) {
      syncDepotEntrance(view, depot, 450, phase);
      assert.ok(!view.label.visible);
    }
    syncDepotEntrance(view, depot, 450.001, 'running');
    assert.ok(!view.label.visible);
  }
  syncDepotEntrance(view, {distance: Infinity, side: 'left'}, 4000, 'running');
  assert.equal(view.label.visible, false);
});

test('depot notice is high contrast, side-contained and non-interactive in the upper gameplay band', () => {
  const texts = [];
  const scene = {add: {
    image: () => ({setDepth() { return this; }, setVisible() { return this; },
      setBlendMode() { return this; }}),
    text(x, y, text, style) {
      const node = {x, y, text, style,
        setOrigin(x, y) { this.origin = [x, y]; return this; },
        setDepth(depth) { this.depth = depth; return this; },
        setVisible() { return this; }};
      texts.push(node);
      return node;
    },
  }};
  createDepotEntrance(scene);
  const label = texts[0];
  assert.deepEqual(label.origin, [0, 0]);
  assert.equal(label.style.color, '#f1f8ff');
  assert.equal(label.style.fontStyle, 'bold');
  assert.ok(label.y > 106 + 8 && label.y + label.style.fixedHeight <= 180);
  for (const x of [12, 188]) assert.ok(x >= 0 && x + label.style.fixedWidth <= 390);
  assert.ok(label.y + label.style.fixedHeight < 684 - 16, 'never covers the ship');
  assert.equal(label.depth, 20);
  assert.ok(!label.setInteractive, 'notice must not intercept steering');
});

test('visual theme lookup preserves shipped textures and falls back without changing gameplay', () => {
  const mock = drawingScene();
  createIndustrialTextures(mock.scene);
  for (const [levelId, sectors] of Object.entries(IMPLEMENTED_LEVELS)) for (const sector of sectors) {
    const current = resolveVisualTheme(sector);
    assert.equal(current.id, sector.themeId, 'every sector in a level shares its theme art');
    assert.equal(current.roadTexture, ENVIRONMENTS[sector.themeId].roadTexture);
    assert.equal(sector.themeId, levelId === 'level2' ? 'dustlands'
      : levelId === 'level4' ? 'neon' : 'industrial');
    assert.ok(mock.textures.has(current.roadTexture));
    for (const visualThemeId of [undefined, 'unavailable-art', 'toString']) {
      const missing = {...sector, visualThemeId};
      assert.equal(resolveVisualTheme(missing), current);
      assert.equal(roadTint(missing, sector.startsAt, levelId),
        roadTint(sector, sector.startsAt, levelId));
      const activeKinds = new Set(Object.values(ENVIRONMENTS).flatMap(environment => environment.hazardFamilies));
      for (const kind of activeKinds) {
        assert.equal(hazardTexture(kind, missing), hazardTexture(kind, sector));
        assert.ok(mock.scene.textures.exists(hazardTexture(kind, missing)), `${sector.id}/${kind}`);
      }
    }
    const changed = {...sector, visualThemeId: 'neon'};
    assert.equal(resolveVisualTheme(changed).roadTexture, 'road_neon_hex');
    assert.equal(hazardTexture('sideWall', changed), 'chicane_mid', 'guardrails use one approved chicane set');
    assert.equal(hazardTexture('divider', changed), 'divider_neon');
    assert.equal(changed.difficultyStep, sector.difficultyStep);
  }
  assert.equal(resolveVisualTheme({id: 'unknown', visualThemeId: 'unknown'}).id, 'industrial');
});

test('visual theme changes and fallback leave seeded encounters and collision geometry identical', () => {
  for (const [levelId, sectors] of Object.entries(IMPLEMENTED_LEVELS)) for (const mode of levelId === 'level1' ? ['normal', 'continuous'] : ['normal']) {
    const control = createTrackGenerator(153, levelId, mode);
    const themed = createTrackGenerator(153, levelId, mode);
    let distance = mode === 'continuous' ? 6000 : 9;
    for (let index = 0; index < 32; index++) {
      const sector = mode === 'continuous' ? IMPLEMENTED_LEVELS.level1[1]
        : sectors.findLast(item => distance >= item.startsAt);
      const changed = {...sector, visualThemeId: index % 2 ? 'neon' : 'unavailable-art'};
      const expected = control.nextChunk(distance);
      resolveVisualTheme(changed);
      roadTint(changed, distance, levelId, mode);
      const actual = themed.nextChunk(distance);
      assert.deepEqual(actual, expected, `${levelId}/${mode}/${index}`);
      for (const row of actual.rows) {
        for (const hazard of row.hazards) {
          const before = hazardGeometry(hazard);
          hazardTexture(hazard.kind, changed);
          assert.deepEqual(hazardGeometry(hazard), before);
        }
        control.recordSpawn(row, true, distance);
        themed.recordSpawn(row, true, distance);
        distance += row.spacingPx * METERS_PER_PIXEL;
      }
    }
  }
});

test('all environment blends use two surfaces, retain scroll phase and reset correctly on retry', () => {
  const surface = key => ({
    displayTexture: {key}, texture: {key: 'generated-tile-buffer'}, tilePositionY: -567, changes: 0,
    setTexture(key) { this.displayTexture.key = key; this.changes++; return this; },
    setAlpha(alpha) { this.alpha = alpha; return this; },
    setTint(tint) { this.tint = tint; return this; },
  });
  const base = surface('industrial_road');
  const incoming = surface('dustlands_road');
  for (const [index, sector] of IMPLEMENTED_SECTORS.slice(1).entries()) {
    const boundary = sector.startsAt;
    const previous = IMPLEMENTED_SECTORS[index].themeId;
    const next = sector.themeId;
    for (const [offset, alpha] of [[0, 0], [15, 0.5], [30, 0], [300, 0]]) {
      syncSectorRoad(base, incoming, boundary + offset);
      assert.equal(incoming.alpha, alpha);
      assert.equal(base.displayTexture.key, `${offset >= 30 ? next : previous}_road`);
      assert.equal(incoming.displayTexture.key, `${next}_road`);
      assert.equal(incoming.tilePositionY, base.tilePositionY);
      const changes = base.changes + incoming.changes;
      syncSectorRoad(base, incoming, boundary + offset);
      assert.equal(base.changes + incoming.changes, changes, 'do not reset TileSprite textures every frame');
    }
  }
  syncSectorRoad(base, incoming, 0);
  assert.equal(base.displayTexture.key, 'industrial_road');
  assert.equal(incoming.alpha, 0);
  assert.equal(base.tint, 0xffffff, 'retry restores opening palette');
  for (const sector of IMPLEMENTED_SECTORS) {
    assert.equal(ENVIRONMENTS[sector.themeId].roadsideIdentity.length > 0, true);
    assert.ok(ENVIRONMENTS[sector.themeId].hazardFamilies.length > 0);
    assert.equal(roadTint(sector, sector.startsAt), ENVIRONMENTS[sector.themeId].roadTints[0]);
  }
  syncSectorRoad(base, incoming, 449.999);
  assert.equal(base.tint, 0xffffff);
  syncSectorRoad(base, incoming, 450);
  assert.equal(base.tint, ENVIRONMENTS.industrial.roadTints[0], 'no mid-section Depot palette change');
  assert.equal(base.displayTexture.key, 'industrial_road');
  const nextBoundary = IMPLEMENTED_SECTORS[1].startsAt;
  syncSectorRoad(base, incoming, nextBoundary);
  assert.equal(base.tint, roadTint(IMPLEMENTED_SECTORS[0], nextBoundary - 0.001),
    'outgoing sector retains its current palette during the blend');
  assert.equal(incoming.tint, roadTint(IMPLEMENTED_SECTORS[1], nextBoundary),
    'incoming sector begins with its own palette');
  const continuousDepot = GAME_BALANCE.routes.continuous.depotIntervalMeters;
  syncSectorRoad(base, incoming, continuousDepot - 0.001, 'level1', 'continuous');
  const beforeDepot = base.tint;
  syncSectorRoad(base, incoming, continuousDepot, 'level1', 'continuous');
  assert.equal(base.displayTexture.key, 'industrial_road', 'Continuous uses the Industrial look');
  assert.equal(base.tint, beforeDepot, 'Continuous preserves Mid-Day styling across milestone Depots');
  assert.equal(base.tint, ENVIRONMENTS.industrial.roadTints[1]);
});

test('all sector themes have distinct native art and themed filler assets with integrated collision geometry', () => {
  const mock = drawingScene();
  createIndustrialTextures(mock.scene);
  const roots = [];
  for (const sectors of Object.values(IMPLEMENTED_LEVELS)) for (const sector of sectors) {
    assert.ok(CHUNK_REGISTRIES[sector.themeId], `${sector.id} uses a themed registry`);
  }
  for (const themeId of Object.keys(CHUNK_REGISTRIES)) {
    const sector = {id: themeId, themeId, visualThemeId: themeId};
    const environment = ENVIRONMENTS[sector.id];
    const profile = CHALLENGE_PROFILES[sector.id];
    const fillerArt = [];
    for (const kind of profile.fillerHazardFamilies) {
      assert.ok(environment.hazardFamilies.includes(kind));
      assert.ok(profile.betaHazardFamilies.includes(kind));
      assert.ok(!HAZARDS[kind].roadside && !HAZARDS[kind].scenery,
        'playable-space fillers must not repurpose passive roadside scenery');
      const texture = mock.textures.get(hazardTexture(kind, sector));
      assert.ok(texture?.commands.length > 0, `${sector.id}/${kind}`);
      assert.deepEqual([texture.width, texture.height], [HAZARDS[kind].width, HAZARDS[kind].height]);
      fillerArt.push(JSON.stringify(texture.commands));
    }
    assert.equal(new Set(fillerArt).size, profile.fillerHazardFamilies.length);
    const kinds = new Set(CHUNK_REGISTRIES[sector.id].flatMap(c => c.rows.flatMap(r => r.hazards.map(h => h.kind))));
    assert.ok([...kinds].every(kind => environment.hazardFamilies.includes(kind)));
    const intrusions = [...kinds].filter(kind => HAZARDS[kind].roadside);
    assert.ok(intrusions.length >= 2, sector.id);
    for (const kind of kinds) {
      if (HAZARDS[kind].elongated) {
        assert.equal(hazardTexture(kind, sector.id), 'chicane_mid');
        assert.ok(mock.scene.textures.exists('chicane_mid'), `${sector.id}/${kind}`);
        continue;
      }
      const texture = mock.textures.get(hazardTexture(kind, sector.id));
      assert.ok(texture?.commands.length > 0, `${sector.id}/${kind}`);
      const visual = HAZARDS[kind].scenery ?? HAZARDS[kind];
      assert.deepEqual([texture.width, texture.height], [visual.width, visual.height]);
    }
    for (const kind of intrusions) for (const lane of [0, 3]) {
      const x = hazardX({kind, lane});
      assert.ok(hazardHits(kind, x, 684, lane === 0 ? x + HAZARDS[kind].width / 2 - 15
        : x - HAZARDS[kind].width / 2 + 15, 684));
    }
    const divider = mock.textures.get(hazardTexture('divider', sector.id));
    assert.deepEqual([divider.width, divider.height], [64, 30]);
    assert.ok(!divider.commands.some(([method]) => method === 'scaleCanvas'));
    roots.push(JSON.stringify(mock.textures.get(`base_${sector.id}`).commands));
    assert.ok(mock.textures.get(DEPOT_ART.key).commands.length > 0, 'all sectors reuse the approved standalone Depot');
    assert.ok(DEPOT_RULES.announcementMeters > DEPOT_RULES.entranceRevealMeters);
  }
  assert.equal(new Set(roots).size, 5);
});

test('roadside obstacles preserve projection size and procedural housing only where no standalone art is supplied', () => {
  const mock = drawingScene();
  createIndustrialTextures(mock.scene);
  for (const [kind, spec] of Object.entries(HAZARDS).filter(([, h]) => h.scenery && !h.elongated)) {
    const {scenery, width, height, footprint} = spec;
    assert.ok(ROADSIDE_KINDS.includes(scenery.kind), 'reuse a roadside scenery family');
    const texture = mock.textures.get(spec.texture);
    assert.deepEqual([texture.width, texture.height], [scenery.width, scenery.height]);
    assert.equal(footprint[0].halfWidth, width / 2 - 2);
    assert.equal(footprint[0].halfHeight, height / 2 - 2);
    if (OBSTACLE_ART.some(art => art.textures.includes(spec.texture))) {
      assert.ok(texture.commands.some(([method]) => method === 'drawImage'));
      assert.ok(!texture.commands.some(([method]) => method === 'fillRect' || method === 'fillPoints'),
        'standalone artwork is never backed by a generated box or housing');
      continue;
    }
    const top = (scenery.height - height) / 2;
    assert.ok(texture.commands.some(([method, x, y]) =>
      method === 'translateCanvas' && x === scenery.anchorX - width / 2 && y === top), kind);
    assert.ok(texture.commands.some(([method, color]) =>
      method === 'fillStyle' && color === PALETTE.safetyYellow), 'active projection has hazard markings');
    assert.ok(texture.commands.some(([method, points]) => method === 'fillPoints' &&
      points.some(p => p.x === 1 && p.y === 8)), 'baked housing reuses roadsideDetail outline');
    assert.ok(texture.commands.some(([method, x, y, w]) =>
      method === 'fillRect' && x === 20 && y === top + 6 && w === 29),
    'feeder rails physically join housing to the roadway collar');
    assert.ok(!texture.commands.some(([method]) => method === 'scaleCanvas'), 'no stretched image assets');
  }
});

test('garage display sprites preserve exact approved embedded RGBA artwork and preload once', () => {
  const names = {standard: 'StandardHauler_Display_Sprite.svg', swift: 'SwiftRunner_Display_Sprite.svg'};
  const loads = [];
  const textures = new Set();
  const scene = {textures: {exists: key => textures.has(key)},
    load: {image: (key, url) => { loads.push([key, url]); textures.add(key); }}};
  preloadGarageDisplayArt(scene);
  preloadGarageDisplayArt(scene);
  assert.equal(loads.length, 2);
  for (const art of GARAGE_DISPLAY_ART) {
    const svg = readFileSync(new URL(`../../art-direction/${names[art.id]}`, import.meta.url), 'utf8');
    const embedded = svg.match(/data:image\/png;base64,([A-Za-z0-9+/=\s]+)/);
    assert.ok(embedded);
    const png = readFileSync(new URL(art.url));
    assert.deepEqual(png, Buffer.from(embedded[1], 'base64'));
    assert.equal(png[25], 6);
    assert.ok(loads.some(([key, url]) => key === art.key && url === art.url));
  }
});

test('chicane guardrail rasters are the exact approved standalone RGBA exports', () => {
  for (const art of GUARDRAIL_ART) {
    const svg = readFileSync(new URL(`../../art-direction/chicane_${art.part}.svg`, import.meta.url), 'utf8');
    const embedded = svg.match(/data:image\/png;base64,([A-Za-z0-9+/=\s]+)/);
    assert.ok(embedded, art.key);
    const image = readFileSync(new URL(art.url));
    assert.deepEqual(image, Buffer.from(embedded[1], 'base64'), art.key);
    assert.equal(image[25], 6, 'preserve source RGBA, no cropping or reencoding');
  }
  const loads = [];
  preloadObstacleArt({textures: {exists: () => false}, load: {image: (key, url) => loads.push([key, url])}});
  for (const art of GUARDRAIL_ART) assert.ok(loads.some(([key, url]) => key === art.key && url === art.url));
});

test('guardrails assemble entry, tiling mids and exit at exact collision geometry on both shoulders', () => {
  for (const kind of ['sideRail', 'sideWall']) for (const lengthPx of [160, 930, 2451, 3777]) for (const lane of [0, 3]) {
    const {scene, textures} = effectsScene();
    GUARDRAIL_ART.forEach(art => textures.add(art.key));
    const hazard = {kind, lengthPx, lane};
    const x = hazardX(hazard);
    const structure = createGuardrailStructure(scene, hazard, x, 400);
    const layout = guardrailLayout(hazard);
    const side = lane === 0 ? 1 : -1;
    assert.equal(structure.type, 'container');
    assert.deepEqual([structure.x, structure.y, structure.depth], [x, 400, 5]);
    assert.deepEqual([structure.width, structure.height], [layout.width, layout.length]);
    const parts = structure.guardrailParts;
    assert.deepEqual(parts.map(part => part.key), ['chicane_exit',
      ...Array(layout.midCount).fill('chicane_mid'), 'chicane_entry'], 'exit far, mids, entry facing traffic');
    assert.ok(layout.midCount >= 1);
    assert.ok(layout.midLength >= layout.width * GAME_BALANCE.hazards.guardrail.midLengthPerWidth - 1e-9);
    let top = -layout.length / 2;
    for (const part of parts) {
      assert.ok(Math.abs(part.y - part.height / 2 - top) < 1e-9, 'tiles abut with no gaps or overlap');
      top += part.height;
      assert.equal(part.width, HAZARDS[kind].scenery.width, 'no sprite-art upscale on gameplay geometry');
      assert.ok(Number.isFinite(part.displayWidth) && Number.isFinite(part.displayHeight));
      assert.equal(part.flipX, part.key === 'chicane_entry' ? lane === 0 : lane === 3,
        'entry orientations are swapped between curbs without changing mids or exit caps');
      const inner = x + part.x + side * part.width / 2;
      assert.ok(Math.abs(inner - (x + side * HAZARDS[kind].width / 2)) < 1e-9, 'art inner edge meets the wall');
    }
    assert.ok(Math.abs(top - layout.length / 2) < 1e-9, 'structure spans the full collision length');
    const shadows = structure.children.slice(0, parts.length);
    assert.deepEqual(structure.children.slice(parts.length), parts, 'all shadows render beneath all tiles');
    shadows.forEach((shadow, i) => {
      assert.equal(shadow.key, parts[i].key);
      assert.equal(shadow.flipX, parts[i].flipX, 'entry shadow mirrors the corrected wedge');
      assert.equal(shadow.tint, SHADOW_TINT);
      assert.equal(shadow.alpha, balance.SHADOW_ALPHA);
      assert.deepEqual([shadow.x - parts[i].x, shadow.y - parts[i].y],
        [balance.SHADOW_OFFSET_X, balance.SHADOW_OFFSET_Y]);
    });
    const beacon = structure.guardrailBeacon;
    const entry = parts.at(-1);
    for (const [time, alpha] of [[0, 0.3], [300, 1], [600, 0.3]]) {
      syncGuardrailBeacon(structure, time, true);
      assert.equal(beacon.alpha, alpha);
      assert.deepEqual([beacon.x, beacon.y], [structure.x + entry.x, structure.y + entry.y]);
      assert.equal(beacon.blendMode, 'ADD');
      assert.equal(beacon.depth, 16.1);
    }
    structure.y += 50;
    syncGuardrailBeacon(structure, 900, false);
    assert.equal(beacon.y, structure.y + entry.y, 'entry beacon remains world-pinned while scrolling');
    assert.equal(beacon.depth, 6);
  }
});

test('guardrail grind sparks are pooled, follow the contact point and stop with the hauler effects', () => {
  const {scene, created} = effectsScene();
  const effects = createHaulerEffects(scene);
  const {emitter, anchor} = effects.grind;
  assert.equal(emitter.key, 'particle-dot');
  assert.equal(emitter.config.blendMode, 'ADD');
  assert.equal(emitter.emitting, false);
  assert.equal(emitter.follow, anchor);
  const count = created.length;
  const hazard = {kind: 'sideWall', lengthPx: 1000, lane: 0};
  const scrape = guardrailContact(hazard, 64, 684, 100, 684, 0);
  assert.equal(scrape.kind, 'flank');
  syncGuardrailSparks(effects, scrape);
  assert.equal(emitter.emitting, true);
  assert.deepEqual([anchor.x, anchor.y, anchor.side], [scrape.contactX, scrape.contactY, 1]);
  assert.deepEqual(emitter.config.lifespan, {min: 100, max: 150});
  assert.deepEqual(emitter.config.speed, {min: 220, max: 340});
  assert.deepEqual(emitter.config.tint, [0xffffff, 0xffd700, 0xff8c00]);
  assert.equal(emitter.depth, 16.2, 'sparks stay bright above the night ambient mask');
  const leftAngle = emitter.config.angle.onEmit();
  assert.ok(leftAngle >= 50 && leftAngle <= 130);
  syncGuardrailSparks(effects, guardrailContact({...hazard, lane: 3}, 326, 684, 290, 684, 0));
  const rightAngle = emitter.config.angle.onEmit();
  assert.ok(rightAngle >= 230 && rightAngle <= 310);
  syncGuardrailSparks(effects, null);
  assert.equal(emitter.emitting, false);
  syncGuardrailSparks(effects, scrape);
  stopHaulerExhaust(effects);
  assert.equal(emitter.emitting, false);
  assert.equal(emitter.killed, 1);
  syncGuardrailSparks(undefined, scrape);
  assert.equal(created.length, count, 'spark emitter is reused, never allocated per contact');
});

test('five road themes stay distinct without pickup/hazard colors; new roadside art stays inside the tile', () => {
  const mock = drawingScene();
  createIndustrialTextures(mock.scene);
  const drawings = new Set();
  for (const id of ['industrial', 'dustlands', 'neon', 'reactor', 'overdrive']) {
    const texture = mock.textures.get(`${id}_road`);
    assert.deepEqual([texture.width, texture.height], [390, 1248]);
    drawings.add(JSON.stringify(texture.commands));
    assert.ok(!texture.commands.some(([method, color]) =>
      method === 'fillStyle' && [PALETTE.gold, PALETTE.hazard, PALETTE.depot].includes(color)));
    if (id === 'industrial' || id === 'dustlands') continue;
    for (const [method, ...args] of texture.commands) {
      if (method === 'fillRect') {
        const [x, y, width, height] = args;
        assert.ok(x >= 0 && x + width <= 390 && y >= 0 && y + height <= 1248, id);
      } else if (method === 'fillPoints') {
        assert.ok(args[0].every(({x, y}) => x >= 0 && x <= 390 && y >= 0 && y <= 1248), id);
      }
    }
  }
  assert.equal(drawings.size, 5);
});

test('Garage upgrade copy stays readable and preserves exact bonuses and protection limits', () => {
  for (const def of MODULE_DEFS) for (const value of def.benefit.values) {
    const stat = def.benefit.stat;
    const text = garageUpgradeBenefit(stat, value);
    const original = formatStat(stat, value);
    if (stat === 'handling') assert.equal(text, original);
    else if (stat === 'magnet') assert.equal(text, original.replace('Collection range:', 'Cargo reach:'));
    else if (stat === 'hull') assert.equal(text, original.replace('hull', 'health'));
    else if (stat === 'loadRelief') assert.equal(text, `${Math.round(value * 100)}% less cargo slowdown`);
    else if (stat === 'impactPulseSeconds') assert.equal(text, `+${value.toFixed(2)} s safety after a hit`);
    else if (stat === 'shieldCapacity') assert.equal(text, `${value} shield ${value === 1 ? 'charge' : 'charges'}`);
    else if (stat === 'insurance') assert.equal(text, original.replace('less percentage hit loss', 'less cargo value lost'));
  }
  assert.match(MODULE_CAPTIONS.def_shield, /Each charge blocks one hit/);
  assert.match(MODULE_CAPTIONS.def_shield, /Stop at a Depot to refill. Driving past does not refill it/);
  assert.match(MODULE_CAPTIONS.util_insurance, /Dropped cargo is not protected/);
  assert.match(MODULE_CAPTIONS.util_impact_pulse, /damaging hit.*road obstacles on screen/);
  assert.throws(() => garageUpgradeBenefit('unknown', 1), /Unknown stat/);
});

test('exactly seven implemented modules have distinct baked icons', () => {
  const mock = drawingScene();
  createIndustrialTextures(mock.scene);
  assert.deepEqual(Object.keys(MODULE_CAPTIONS).sort(), MODULE_DEFS.map(d => d.id).sort());
  const drawings = new Set();
  for (const id of Object.keys(MODULE_CAPTIONS)) {
    const icon = mock.textures.get(`module_${id}`);
    assert.deepEqual([icon.width, icon.height], [40, 40]);
    assert.ok(icon.commands.length > 2);
    drawings.add(JSON.stringify(icon.commands));
  }
  assert.equal(drawings.size, 7);
});

test('locked module text meets normal-text contrast against its subdued fill', () => {
  const luminance = color => {
    const rgb = [color >> 16, (color >> 8) & 255, color & 255]
      .map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  for (const text of [PALETTE.lockedText, PALETTE.secondaryText, PALETTE.goldLight]) {
    assert.ok((luminance(text) + 0.05) / (luminance(PALETTE.lockedFill) + 0.05) >= 4.5);
  }
});

test('menu preview uses high-resolution drawing at a uniform scale without animation', () => {
  const image = {
    setScale(scale) { this.scale = scale; return this; },
    setDepth() { return this; },
  };
  const scene = {add: {
    polygon() { return {setStrokeStyle() { return this; }, setDepth() { return this; }}; },
    image(x, y, key) { Object.assign(image, {x, y, key}); return image; },
  }};
  addHaulerPreview(scene, 195, 320, 1.45);
  assert.equal(image.key, 'cargo_preview');
  assert.equal(image.scale, 1.45 / 3 * SPRITE_ART_SCALE);
  assert.deepEqual(TEXTURE_SIZES.cargo_preview, [162, 195]);
});

test('coins and stacks have different silhouettes; cargo, hazards and depot keep separate color semantics', () => {
  const mock = drawingScene();
  createIndustrialTextures(mock.scene);
  const commands = key => mock.textures.get(key).commands;
  assert.ok(commands('cargo_coin').some(([method]) => method === 'fillCircle'));
  assert.equal(commands('cargo_coinStack').filter(([method]) => method === 'fillEllipse').length, 9);
  assert.ok(commands('cargo_stack').some(([method, color]) => method === 'fillStyle' && color === PALETTE.gold));
  assert.deepEqual(commands('cargo_ship').map(([method]) => method), ['drawImage'],
    'approved empty hull is used directly, with no collected cargo painted into it');
  assert.ok(commands('cargo_hazard').some(([method, source]) =>
    method === 'drawImage' && source.key === 'obstacle_source_barrier'),
  'approved amber-striped Barrier replaces the old procedural red hazard');
  assert.ok(commands('industrial_depot').some(([method, color]) => method === 'fillStyle' && color === PALETTE.depot));
});

test('roadside motifs are varied, entirely outside the road, and do not cross the tile seam', () => {
  assert.deepEqual([...new Set(ROADSIDE_LAYOUT.map(d => d.kind))].sort(), [...ROADSIDE_KINDS].sort());
  for (const d of ROADSIDE_LAYOUT) {
    assert.ok(d.x + d.width <= 37 || d.x >= 353);
    assert.ok(d.y > 0 && d.y + d.height < TEXTURE_SIZES.industrial_road[1]);
  }
  assert.notDeepEqual(ROADSIDE_LAYOUT.filter(d => d.x < 37).map(d => d.kind),
    ROADSIDE_LAYOUT.filter(d => d.x > 353).map(d => d.kind));
});

test('Industrial benchmark bakes deterministic asphalt and mechanical detail without runtime scenery', () => {
  const first = drawingScene();
  const second = drawingScene();
  createIndustrialTextures(first.scene);
  createIndustrialTextures(second.scene);
  const commands = first.textures.get('industrial_road').commands;
  assert.deepEqual(commands, second.textures.get('industrial_road').commands);
  assert.ok(commands.length < 4000, 'bounded one-time texture bake, not per-frame drawing');
  const fans = commands.filter(([method]) => method === 'strokeCircle');
  assert.ok(fans.length >= 10, 'reusable vent and utility machinery');
  for (const [, x, y, radius] of fans) {
    assert.ok(x - radius >= 0 && x + radius <= 37 || x - radius >= 353 && x + radius <= 390,
      'decorative fans remain wholly beyond the drivable road');
    assert.ok(y - radius > 0 && y + radius < TEXTURE_SIZES.industrial_road[1]);
  }
  for (const x of [ROAD_LEFT, ROAD_RIGHT]) {
    assert.ok(commands.some(([method, px, y, width, height]) =>
      method === 'fillRect' && px === x - 1 && y === 0 && width === 2 && height === 1248),
    'continuous road border uses actual gameplay edges');
  }
  assert.ok(commands.filter(([method, , alpha]) =>
    method === 'fillStyle' && alpha === 0.045).length === 720, 'subtle fixed surface grain');
  assert.ok([...first.textures.keys()].every(key => TEXTURE_SIZES[key]), 'no undeclared runtime art catalogue');
});

test('road wear bakes deterministic hairline cracks, worn asphalt seams and tiny shoulder rubble into both opaque base roads', () => {
  const first = drawingScene(), second = drawingScene();
  createIndustrialTextures(first.scene);
  createIndustrialTextures(second.scene);
  for (const key of ['industrial_road', 'dustlands_road']) {
    const commands = first.textures.get(key).commands;
    assert.deepEqual(commands, second.textures.get(key).commands, 'no gameplay RNG or per-frame detail');
    assert.ok(commands.some(([method, x, y, x2, y2]) =>
      method === 'lineBetween' && x === 192 && y === 60 && x2 === 199 && y2 === 83), 'branching crack');
    assert.ok(commands.some(([method, x, y, x2, y2]) =>
      method === 'lineBetween' && x === 53 && y === 131 && x2 === 337 && y2 === 134), 'worn seam');
    let style, chips = 0;
    for (const [method, ...args] of commands) {
      if (method === 'fillStyle') style = args;
      if (method === 'fillRect' && style?.[1] === 0.18 &&
          args[2] >= 1 && args[2] <= 3 && args[3] === 2) {
        assert.ok(args[0] < ROAD_LEFT + 25 || args[0] > ROAD_RIGHT - 25,
          'tiny rubble stays near shoulders, never a lane-sized obstacle');
        chips++;
      }
    }
    assert.equal(chips, 40);
    assert.ok(!commands.some(([method]) => method === 'clearRect'), 'road remains solid');
  }
});

test('roadside infill reuses baked motifs outside lanes without new textures or runtime objects', () => {
  const mock = drawingScene();
  createIndustrialTextures(mock.scene);
  assert.ok([...mock.textures.keys()].every(key => TEXTURE_SIZES[key]), 'no undeclared runtime art catalogue');
  assert.ok(mock.isDestroyed(), 'the only temporary drawing object is released');
  for (const key of ['industrial_road', 'level2_road', 'neon_road', 'reactor_road', 'overdrive_road']) {
    const texture = mock.textures.get(key);
    assert.deepEqual([texture.width, texture.height], TEXTURE_SIZES[key]);
    for (const detail of ROADSIDE_INFILL_LAYOUT) {
      assert.ok(ROADSIDE_KINDS.includes(detail.kind));
      assert.ok(detail.x + detail.width <= 37 || detail.x >= 353, 'do not obscure lanes or hazard silhouettes');
      assert.ok(detail.y > 0 && detail.y + detail.height < texture.height);
      assert.ok(texture.commands.some(([method, x, y]) =>
        method === 'translateCanvas' && x === detail.x && y === detail.y), `${key}: missing infill`);
      const neighbours = key === 'industrial_road' ? ROADSIDE_LAYOUT
        : Array.from({length: 8}, (_, index) => [
          {x: 1, y: 12 + index * 156, width: 32, height: 114},
          {x: 356, y: 36 + index * 156, width: 32, height: 114},
        ]).flat();
      assert.ok(neighbours.every(other => detail.x >= other.x + other.width ||
        detail.x + detail.width <= other.x || detail.y >= other.y + other.height ||
        detail.y + detail.height <= other.y), 'fill selected gaps, not existing housings');
    }
    const original = texture;
    createIndustrialTextures(mock.scene);
    assert.equal(mock.textures.get(key), original, 'scene restarts do not accumulate decor');
  }
});

function visualNode() {
  return {
    visible: false,
    setRotation(rotation) { this.rotation = rotation; return this; },
    setPosition(x, y) { Object.assign(this, {x, y}); return this; },
    setVisible(visible) { this.visible = visible; return this; },
    setDisplaySize(width, height) { Object.assign(this, {width, height, displayWidth: width, displayHeight: height}); return this; },
    setSize(width, height) { Object.assign(this, {width, height}); return this; },
    setScale(scaleX, scaleY) { Object.assign(this, {scaleX, scaleY}); return this; },
    setAlpha(alpha) { this.alpha = alpha; return this; },
  };
}

test('cargo trailers grow by load quarters, cap at four for every capacity and connect behind the hull', () => {
  const effects = {rack: visualNode()};
  const boxes = Array.from({length: 4}, visualNode);
  const ship = {x: 230, y: 684, visible: true, scaleX: 1, scaleY: 1, alpha: 1};
  for (const capacity of [4, 7, 8, 11, 12, 16, 20]) {
    for (const load of [0, 1, capacity / 4, capacity / 2, capacity * 0.75, capacity, capacity + 2]) {
      syncHaulerEffects(effects, ship, boxes, load, capacity, 'running', 100);
      const count = Math.min(4, Math.ceil(load / capacity * 4));
      assert.equal(boxes.filter(b => b.visible).length, count);
      assert.equal(effects.rack.visible, load > 0);
      if (count) {
        assert.equal(effects.rack.x, ship.x);
        assert.ok(effects.rack.y <= ship.y + 65 / 2, 'Coupling overlaps rear of hull');
        assert.ok(effects.rack.y + effects.rack.height >= boxes[0].y - 14 * boxes[0].scaleY,
          'short coupling overlaps the first trailer drawbar');
        assert.ok(boxes.slice(0, count).every(b => b.x === ship.x));
        for (let i = 1; i < count; i++) {
          assert.ok(boxes[i].y - 18 < boxes[i - 1].y + 18, 'each drawbar overlaps its preceding trailer');
          assert.equal(boxes[i].y - boxes[i - 1].y, 29);
        }
        assert.ok(boxes[count - 1].y + 18 * SPRITE_ART_SCALE < 844, 'four enlarged trailers remain on the gameplay canvas');
        assert.ok(boxes.every(box => box.scaleX === SPRITE_ART_SCALE && box.scaleY === SPRITE_ART_SCALE));
      }
    }
  }
  ship.x = 90;
  syncHaulerEffects(effects, ship, boxes, 7, 12, 'depot', 250);
  assert.equal(effects.rack.x, 90);
  assert.ok(boxes.every(b => b.x === 90));
});

test('art scales exactly ten percent without changing coordinates, native frames or accumulating on sync', () => {
  assert.equal(SPRITE_ART_SCALE, 1.1);
  const sprite = {x: 86, y: 450, width: 64, height: 30, originX: 0.5, originY: 0.5};
  for (let index = 0; index < 5; index++) {
    assert.equal(scaleSpriteArt(sprite), sprite);
    assert.equal(sprite.scaleX, 1.1);
    assert.equal(sprite.scaleY, 1.1);
  }
  assert.deepEqual([sprite.x, sprite.y, sprite.width, sprite.height, sprite.originX, sprite.originY],
    [86, 450, 64, 30, 0.5, 0.5]);
  scaleSpriteArt(sprite, 0.92);
  assert.equal(sprite.scaleX, 0.92 * 1.1);
  assert.equal(sprite.scaleY, 0.92 * 1.1);
  const mock = drawingScene();
  createIndustrialTextures(mock.scene);
  assert.deepEqual([mock.textures.get('hazard_divider').width, mock.textures.get('hazard_divider').height], [64, 30]);
  const icon = {setDisplaySize(width, height) { Object.assign(this, {width, height}); return this; },
    setDepth() { return this; }};
  addModuleIcon({add: {image: () => icon}}, 'hand_precision', 100, 200, 40);
  assert.deepEqual([icon.width, icon.height], [44, 44]);
});

test('diesel exhaust follows each truck stack at the approved art scale', () => {
  const {scene} = effectsScene();
  const effects = createHaulerEffects(scene);
  const boxes = Array.from({length: 4}, visualNode);
  const ship = {x: 195, y: 684, visible: true, scaleX: 1.18, scaleY: 1.18, alpha: 0.58,
    texture: {key: 'cargo_ship'}};
  for (const [key, art] of [['cargo_ship', STANDARD_HAULER_ART], ['cargo_ship_swift', SWIFT_RUNNER_ART]]) {
    ship.texture.key = key;
    syncHaulerEffects(effects, ship, boxes, 7, 12, 'running', 100);
    const scale = 63 / art.bounds.height;
    const {anchor, emitter} = effects.exhaust;
    assert.ok(Math.abs(anchor.x - ship.x -
      (art.exhaustStack.x - art.bounds.x - art.bounds.width / 2) * scale * ship.scaleX) < 1e-9);
    assert.ok(Math.abs(anchor.y - ship.y -
      (art.exhaustStack.y - art.bounds.y - art.bounds.height / 2) * scale * ship.scaleY) < 1e-9);
    assert.equal(emitter.alpha, ship.alpha);
  }
  assert.equal(effects.rack.y, ship.y + 24 * ship.scaleY);
  assert.deepEqual(boxes.filter(b => b.visible).map(b => b.y), [730, 759, 788]);
});

function effectsScene() {
  const created = [];
  const textures = new Set();
  const graphics = [];
  const decorate = node => Object.assign(node, {
    setOrigin(x, y = x) { Object.assign(this, {originX: x, originY: y}); return this; },
    setDepth(depth) { this.depth = depth; return this; },
    setTint(tint) { this.tint = tint; return this; },
    setBlendMode(blendMode) { this.blendMode = blendMode; return this; },
    setFlip(flipX, flipY) { Object.assign(this, {flipX, flipY}); return this; },
    setFlipX(flipX) { this.flipX = flipX; return this; },
    setTexture(key, frame = '__BASE') {
      this.textureSets = (this.textureSets ?? 0) + 1;
      Object.assign(this, {key, texture: {key}, frame: {name: frame}});
      return this;
    },
  });
  const scene = {
    textures: {exists: key => textures.has(key)},
    make: {graphics(config) {
      const calls = [];
      const g = {config, calls, destroyed: false,
        fillStyle(color, alpha) { calls.push(['fillStyle', color, alpha]); },
        fillCircle(x, y, r) { calls.push(['fillCircle', x, y, r]); },
        generateTexture(key, width, height) { textures.add(key); calls.push(['generateTexture', key, width, height]); },
        destroy() { this.destroyed = true; }};
      graphics.push(g);
      return g;
    }},
    add: {
      image(x, y, key) {
        const node = decorate({...visualNode(), x, y, key, texture: {key}, frame: {name: '__BASE'}});
        created.push(node);
        return node;
      },
      ellipse(x, y, width, height, color, fillAlpha) {
        const node = decorate({...visualNode(), x, y, width, height, color, fillAlpha, type: 'ellipse'});
        created.push(node);
        return node;
      },
      particles(x, y, key, config) {
        const node = decorate({...visualNode(), x, y, key, config, type: 'particles',
          emitting: config.emitting, killed: 0,
          startFollow(target) { this.follow = target; return this; },
          killAll() { this.killed++; return this; }});
        created.push(node);
        return node;
      },
      container(x, y, children) {
        const node = decorate({...visualNode(), x, y, children, type: 'container'});
        created.push(node);
        return node;
      },
    },
  };
  return {scene, created, textures, graphics};
}

function roadEnvironmentFixture() {
  const fixture = effectsScene();
  const {scene, created} = fixture;
  const image = scene.add.image;
  scene.add.image = (...args) => Object.assign(image(...args), {
    setBlendMode(blendMode) { this.blendMode = blendMode; return this; },
    setOrigin(x, y) { this.originX = x; this.originY = y; return this; },
    destroy() { this.destroyed = true; },
  });
  scene.sys = {settings: {key: 'environment-test'}};
  const texture = {key: 'ambient_environment-test'};
  scene.textures.createCanvas = (key, width, height) => {
    Object.assign(texture, {key, width, height,
      setFilter(filter) { this.filter = filter; },
      getContext: () => ({
        createImageData: () => ({data: new Uint8ClampedArray(width * height * 4)}),
        putImageData() {},
      }), refresh() { this.refreshes = (this.refreshes ?? 0) + 1; }});
    return texture;
  };
  scene.textures.remove = key => { texture.removed = key; };
  scene.add.tileSprite = (x, y, width, height, key) => {
    const node = scene.add.image(x, y, key);
    node.tilePositionY = 0;
    return node.setDisplaySize(width, height);
  };
  scene.add.graphics = () => {
    const node = scene.add.image(0, 0, 'graphics');
    node.lines = [];
    node.clear = () => { node.lines = []; return node; };
    node.lineStyle = (width, color, alpha) => { Object.assign(node, {lineWidth: width, color, alpha}); return node; };
    node.lineBetween = (...line) => { node.lines.push(line); return node; };
    return node;
  };
  const particles = scene.add.particles;
  scene.add.particles = (...args) => {
    const node = particles(...args);
    node.explode = (...burst) => { node.burst = burst; };
    node.destroy = () => { node.destroyed = true; };
    return node;
  };
  const tweens = [];
  scene.tweens = {add: tween => tweens.push(tween), killTweensOf: target => { scene.killedTweenTarget = target; }};
  scene.cameras = {main: {midPoint: {x: 195, y: 422}, width: 390, height: 844, zoom: 1}};
  scene.syncResponsiveCamera = () => {};
  installVisualPool(scene);
  scene.phase = 'running';
  const road = {subRoad: scene.add.tileSprite(195, 422, 390, 844, 'subroad_industrial')};
  const view = createRoadEnvironment(scene, road, 390, 844);
  const ship = {x: 195, y: 684, scaleX: 1.1, scaleY: 1.1, rotation: 0, visible: true};
  return {...fixture, view, ship, texture, tweens, count: created.length};
}

test('Neon road and sign art preloads from the approved Art Direction rasters, once per key', () => {
  const loaded = [];
  const scene = {textures: {exists: () => false}, load: {image: (key, url) => loaded.push([key, url])}};
  preloadNeonVisuals(scene);
  assert.deepEqual(NEON_ART.map(art => art.key), Object.values(NEON_THEME_ASSETS));
  assert.deepEqual(loaded.map(([key]) => key), NEON_ART.map(art => art.sourceKey));
  for (const [, url] of loaded) {
    assert.ok(/neon-(road-base|overlay-hex|sign-apex|sign-kanji)\.webp$/.test(url), url);
    assert.ok(readFileSync(new URL(url)).length > 0, url);
  }
  const baked = {textures: {exists: () => true}, load: {image: () => assert.fail('baked art reloaded')}};
  preloadNeonVisuals(baked);
});

test('layered road textures are solid, with additive Dustlands dust and multiply Industrial grunge, never cutouts', () => {
  const mock = drawingScene();
  createIndustrialTextures(mock.scene);
  const neonRoad = mock.textures.get('road_neon_base');
  assert.deepEqual([neonRoad.width, neonRoad.height], TEXTURE_SIZES.road_neon_base);
  assert.equal(neonRoad.width, 390);
  const [roadDraw, ...seamDraws] = neonRoad.commands.filter(([method]) => method === 'drawImage');
  assert.equal(roadDraw[1].key, 'neon_source_road_neon_base');
  // Curb-to-curb art span lands on the gameplay road edges.
  const [, , roadX, , drawnWidth] = roadDraw;
  assert.ok(Math.abs(roadX + drawnWidth * 100 / 572 - ROAD_LEFT) < 0.01);
  assert.ok(Math.abs(roadX + drawnWidth * 464 / 572 - ROAD_RIGHT) < 0.01);
  assert.ok(drawnWidth * 1024 / 572 >= neonRoad.height + seamDraws.length, 'seam band comes from real art rows');
  assert.equal(seamDraws.length, 72, 'vertical wrap is crossfaded into a seamless tile');
  const hex = mock.textures.get('overlay_neon_hex');
  assert.deepEqual([hex.width, hex.height], TEXTURE_SIZES.overlay_neon_hex);
  assert.ok(hex.commands.some(([method, image]) => method === 'drawImage' && image.key === 'neon_source_overlay_neon_hex'));
  assert.ok(hex.commands.some(([method]) => method === 'putImageData'), 'grate alpha is keyed from frame luminance');
  for (const key of ['neon_sign_apex', 'neon_sign_kanji']) {
    assert.deepEqual([mock.textures.get(key).width, mock.textures.get(key).height], TEXTURE_SIZES[key]);
  }
  for (const art of NEON_ART) assert.ok(!mock.scene.textures.exists(art.sourceKey), 'Neon sources are released');
  assert.deepEqual(TEXTURE_SIZES.hazard_energy_orb, [64, 64]);
  assert.deepEqual(TEXTURE_SIZES.glow_orb_radial, [128, 128]);
  assert.deepEqual([mock.textures.get('hazard_energy_orb').width,
    mock.textures.get('hazard_energy_orb').height], [64, 64]);
  assert.deepEqual([mock.textures.get('glow_orb_radial').width,
    mock.textures.get('glow_orb_radial').height], [128, 128]);
  assert.throws(() => {
    mock.scene.phase = 'running';
    bakeNeonRoadTexture(mock.scene);
  }, /baked before gameplay/);
  const signatures = new Map();
  for (const [id, preset] of Object.entries(ROAD_SURFACE_PRESETS)) {
    const texture = mock.textures.get(preset.subRoadTexture);
    assert.deepEqual([texture.width, texture.height], id === 'neon' ? TEXTURE_SIZES.overlay_neon_hex : [390, 1248]);
    if (id !== 'neon') signatures.set(id, JSON.stringify(texture.commands));
    const road = mock.textures.get(preset.roadTexture);
    assert.ok(road.commands.some(([method, ...args]) => {
      if (id !== 'neon') return method === 'fillRect' && args.join() === `0,0,390,${road.height}`;
      const [, x, y, width, height] = args;
      return method === 'drawImage' && x <= 0 && y === 0 && x + width >= 390 && height >= road.height;
    }), id);
    assert.ok(!road.commands.some(([method]) => ['clearRect', 'fill'].includes(method)), 'no alpha carving');
    assert.equal(preset.blendMode, {dustlands: 'ADD', neon: 'NORMAL'}[id] ?? 'MULTIPLY');
    assert.ok(preset.overlayAlpha > 0 && preset.overlayAlpha < (id === 'neon' ? 0.9 : 0.2));
  }
  assert.notEqual(signatures.get('industrial'), signatures.get('dustlands'));
  assert.ok(!mock.textures.has('road_decal_oil'));
  assert.ok(!mock.textures.has('road_decal_crack'));
  assert.ok(!mock.textures.has('road_decal_rut'));
  const skid = mock.textures.get('road_decal_skid');
  assert.equal(skid.commands.filter(([method]) => method === 'fillRect').length, 2);
  assert.ok(!skid.commands.some(([method]) => method.includes('Ellipse') || method.includes('Circle')));
  assert.deepEqual(Object.keys(IMPLEMENTED_LEVELS), ['level1', 'level2', 'level3', 'level4']);
  assert.equal(ROAD_SURFACE_PRESETS.neon.roadTexture, THEMES.neon.roadKey);
  assert.equal(ROAD_SURFACE_PRESETS.neon.subRoadTexture, THEMES.neon.overlayKey);
  assert.equal(ROAD_SURFACE_PRESETS.neon.blendMode, THEMES.neon.overlayBlend);
  assert.equal(ROAD_SURFACE_PRESETS.neon.overlayAlpha, THEMES.neon.overlayAlpha);
  assert.equal(ROAD_SURFACE_PRESETS.neon.overlayScrollRatio, 1, 'hex grate is glued to the roadbed');
  assert.deepEqual(THEMES.neon.ambientTint, {dusk: 0x8a70a8, night: 0x56487e});
  assert.equal(THEMES.neon.headlightIntensity, 1.3);
  assert.equal(THEMES.neon.hazardGlowIntensity, 1.4);
});

test('sector lighting follows each live level boundary and continuous uses Mid-Day independently', () => {
  assert.deepEqual(LEVEL_LIGHTING_PRESETS.level4, ['dusk', 'dusk', 'night', 'night']);
  for (const [levelId, sectors] of Object.entries(IMPLEMENTED_LEVELS)) {
    const finish = sectors.at(-1).endsAt;
    for (const [index, sector] of sectors.entries()) {
      const expected = LEVEL_SECTOR_LIGHTING[levelId][index];
      assert.equal(LEVEL_SECTOR_LIGHTING[levelId][index], expected);
      assert.equal(lightingForSector(sector, sector.startsAt, finish, 'normal', levelId), expected);
      assert.equal(lightingForSector(sector, sector.endsAt - 0.01, finish, 'normal', levelId), expected);
      assert.equal(lightingForSector(sector, sector.startsAt, finish, 'continuous', levelId), SECTOR_LIGHTING[1]);
      if (!['level3', 'level4'].includes(levelId)) assert.notEqual(expected, SECTOR_LIGHTING[3]);
    }
    assert.equal(lightingForSector(sectors.at(-1), finish, finish, 'normal', levelId), OVERDRIVE_LIGHTING, levelId);
  }
  assert.deepEqual(SECTOR_LIGHTING.map(light => light.tint), [0xe8d0b0, 0xffffff, 0x8c6b9e, 0x6a7590]);
  assert.deepEqual(SECTOR_LIGHTING.map(light => light.headlights), [false, false, true, true]);
  assert.deepEqual(LEVEL_SECTOR_LIGHTING.level4.map(light => light.tint),
    [0x8a70a8, 0x8a70a8, 0x56487e, 0x56487e]);
  assert.throws(() => lightingForSector({number: 1}, 0, 5000, 'normal', 'level5'), /Unavailable lighting/);
});

test('headlight and sodium pools restore full world colour inside lights, not only an additive glow', () => {
  const night = [70, 81, 106];
  const beam = {x: 195, y: 650, rotation: 0};
  assert.deepEqual(ambientAtPoint(night, 195, 540, [beam], []), [255, 255, 255]);
  assert.deepEqual(ambientAtPoint(night, 43, 400, [beam], []), night);
  assert.deepEqual(ambientAtPoint(night, 300, 500, [], [{x: 300, y: 500}]), [255, 255, 255]);
});

test('headlights and sodium pools bake continuous soft alpha matching their world illumination', () => {
  const {scene, textures} = drawingScene();
  createIndustrialTextures(scene);
  const night = [70, 81, 106];
  for (const key of ['truck_headlight_cone', 'streetlight_pool']) {
    const texture = textures.get(key);
    const uploads = texture.commands.filter(([method]) => method === 'putImageData');
    assert.equal(uploads.length, 1, 'bake once, not layered triangles or circles');
    assert.equal(texture.filter, 0, 'linear filtering preserves smooth edges');
    assert.equal(texture.refreshed, true);
    const data = uploads[0][1].data;
    const alphaAt = (x, y) => data[(y * texture.width + x) * 4 + 3];
    const centerX = Math.floor(texture.width / 2);
    assert.equal(alphaAt(centerX, 0), 0, 'no hard edge at the far end');
    assert.equal(alphaAt(0, Math.floor(texture.height / 2)), 0, 'outer edge is transparent');
    const fade = Array.from({length: 80}, (_, y) => alphaAt(centerX, y));
    assert.ok(new Set(fade).size > 55, 'many gradual alpha levels instead of twelve visible bands');
    assert.ok(fade.every((value, index) => !index || value >= fade[index - 1]));
    assert.ok(fade.every((value, index) => !index || value - fade[index - 1] <= 5),
      'no abrupt longitudinal or radial fade steps');
    const x = centerX, y = 100;
    const lit = key === 'truck_headlight_cone'
      ? ambientAtPoint(night, x + 0.5, y + 0.5, [{x: texture.width / 2, y: texture.height, rotation: 0}], [])
      : ambientAtPoint(night, x + 0.5, y + 0.5, [], [{x: texture.width / 2, y: texture.height / 2}]);
    const expected = Math.round((lit[0] - night[0]) / (255 - night[0]) * 255);
    assert.ok(Math.abs(alphaAt(x, y) - expected) <= 1, 'glow and multiplicative light use the same falloff');
  }
  const lamp = [{x: 0, y: 0}];
  const outerLight = ambientAtPoint(night, 120, 0, [], lamp);
  assert.ok(outerLight.every((value, index) => value > night[index] && value < 255),
    'expanded pool softly illuminates beyond the former 110px radius');
  assert.deepEqual(ambientAtPoint(night, ENVIRONMENT_VISUALS.streetlightRadius, 0, [], lamp), night);
  const original = textures.get('truck_headlight_cone');
  createIndustrialTextures(scene);
  assert.equal(textures.get('truck_headlight_cone'), original, 'restart reuses the baked light');
});

test('depot docking chevrons cover only the Depot-side outer lane in the last 60m, hide off-track and clean up without allocation', () => {
  const {scene, view, ship, created, count} = roadEnvironmentFixture();
  setRoadEnvironmentVisible(view, true, scene);
  for (const gate of [500, 1000, 1500, 2000, 3000, 10000]) for (const side of ['left', 'right']) {
    const depot = {distance: gate, side};
    updateRoadEnvironment(view, scene, ship, gate - 60.01, 0, 0, depot);
    assert.equal(view.dockingChevrons.visible, false);
    for (const remaining of [60, 30, 0]) {
      updateRoadEnvironment(view, scene, ship, gate - remaining, 0, 0, depot);
      assert.equal(view.dockingChevrons.visible, true);
      assert.equal(view.dockingChevrons.color, 0x54f0a2);
      const xs = view.dockingChevrons.lines.flatMap(([x1, , x2]) => [x1, x2]);
      assert.ok(xs.length > 0);
      assert.ok(xs.every(x => side === 'left' ? x >= ROAD_LEFT && x < 119 : x > 271 && x <= ROAD_RIGHT),
        'no green decals in the opposite outer lane or either express center lane');
      assert.ok(view.dockingChevrons.depth < 5);
      const ys = view.dockingChevrons.lines.flatMap(([, y1, , y2]) => [y1, y2]);
      assert.ok(ys.every(y => y >= depotWorldY(depot, gate - remaining)),
        'every chevron ends on the approach side of the Depot site');
    }
    updateRoadEnvironment(view, scene, ship, gate + 0.01, 0, 0, depot);
    assert.equal(view.dockingChevrons.visible, false);
    for (const phase of ['docking', 'depot', 'menu', 'result']) {
      scene.phase = phase;
      updateRoadEnvironment(view, scene, ship, gate - 30, 0, 0, depot);
      assert.equal(view.dockingChevrons.visible, false);
    }
    scene.phase = 'running';
  }
  updateRoadEnvironment(view, scene, ship, 350, 0, 0, {distance: Infinity});
  assert.equal(view.dockingChevrons.visible, false);
  assert.equal(created.length, count);
  setRoadEnvironmentVisible(view, false, scene);
  assert.equal(view.dockingChevrons.visible, false);
  destroyRoadEnvironment(view, scene);
  assert.equal(view.dockingChevrons.destroyed, 1);
  scene.routeVisualPool.destroy();
});

test('environment layers scroll at exact parallax speeds and lamps/decals remain bounded and behind the cab', () => {
  const {scene, view, ship, created, count} = roadEnvironmentFixture();
  setRoadEnvironmentVisible(view, true, scene);
  setRoadLighting(view, SECTOR_LIGHTING[2], true);
  updateRoadEnvironment(view, scene, ship, 1600, 20, 0.02, {distance: 1500, side: 'left'});
  assert.equal(view.road.subRoad.tilePositionY, -14);
  assert.equal(view.glints.tilePositionY, -20);
  const activeLamp = view.lamps.find(lamp => lamp.pool.visible);
  const oldY = activeLamp.pool.y;
  updateRoadEnvironment(view, scene, ship, 1600 + 10 * METERS_PER_PIXEL, 10, 0.02, {distance: 1500, side: 'left'});
  assert.ok(Math.abs(activeLamp.pool.y - oldY - 10) < 1e-8, 'lights scroll at 1x road speed');
  assert.equal(view.ambient.blendMode, 'MULTIPLY');
  assert.equal(view.texture.filter, 0);
  assert.ok(view.ambient.depth < 18, 'HUD text and backing are not night-darkened');
  assert.ok(view.skids.filter(Boolean).every(decal => decal.depth > -0.5 && decal.depth < 3 &&
    decal.alpha < 0.2 && decal.texture.key === 'road_decal_skid'));
  assert.ok(view.lamps.every(lamp => lamp.pole.depth < 8 && lamp.pool.depth < 8));
  assert.ok(view.beams.every(beam => beam.visible && beam.alpha === 0.35 &&
    beam.width === 84 && beam.height === 220 && beam.blendMode === 'ADD'));
  ship.x = 100; ship.rotation = 0.07;
  updateRoadEnvironment(view, scene, ship, 1601, 5, 0.02, {distance: 1500, side: 'left'});
  assert.ok(view.beams.every(beam => beam.rotation === ship.rotation && Math.abs(beam.x - ship.x) < 20));
  for (let i = 0; i < 100; i++) {
    setRoadLighting(view, OVERDRIVE_LIGHTING, true);
    updateRoadEnvironment(view, scene, ship, 5000 + i * 80, 5, 0.02, {distance: 7000 + i * 80, side: 'right'});
  }
  const warmed = created.length;
  for (let i = 0; i < 100; i++) {
    updateRoadEnvironment(view, scene, ship, 13000 + i * 80, 5, 0.02, {distance: 15000 + i * 80, side: 'right'});
  }
  assert.ok(warmed >= count, 'the pool may grow to its live high-water mark');
  assert.equal(created.length, warmed, 'no new decal GameObjects after pool warm-up');
  assert.ok(view.lamps.every(lamp => !lamp.pool.visible));
  assert.ok(view.beams.every(beam => !beam.visible));
  assert.ok(view.depotMarks.length <= 2);
});

test('road skid decals exist only inside indicated-side longitudinal Depot braking zones and reuse the fixed pool', () => {
  for (const [levelId, runMode, gate] of [['level1', 'normal', 500], ['level2', 'normal', 1500],
    ['level1', 'continuous', 10000]]) for (const side of ['left', 'right']) {
    const {scene, view, ship, created, count} = roadEnvironmentFixture();
    Object.assign(scene, {levelId, runMode});
    setRoadEnvironmentVisible(view, true, scene);
    updateRoadEnvironment(view, scene, ship, gate - 90, 0, 0, {distance: gate, side});
    assert.ok(view.skids.every(node => node === null), 'no scattered road-wide marks away from braking zones');
    assert.equal(view.decals, undefined, 'the all-lane decal emitter is removed, not hidden');
    for (let frame = 0; frame < 20; frame++) {
      updateRoadEnvironment(view, scene, ship, gate - 10, 0, 0, {distance: gate, side});
      const active = view.skids.filter(Boolean);
      assert.equal(active.length, 2);
      const mark = view.depotMarks[0];
      const siteY = depotWorldY(mark, gate - 10);
      const startY = depotWorldY({distance: mark.brakingStart}, gate - 10);
      for (const node of active) {
        assert.equal(node.texture.key, 'road_decal_skid');
        assert.ok(node.alpha < 0.2);
        assert.equal(node.x, side === 'left' ? ROAD_LEFT + 32 : ROAD_RIGHT - 32);
        assert.ok(node.y - node.height / 2 >= siteY - 1e-8, 'no skid past the canopy');
        assert.ok(node.y + node.height / 2 <= startY + 1e-8, 'no skid before braking begins');
      }
      updateRoadEnvironment(view, scene, ship, gate + 60, 0, 0, {distance: Infinity});
      assert.ok(view.skids.every(node => node === null));
    }
    assert.equal(created.length, count, 'strict fixed-pool reuse while marks enter and leave view');
    destroyRoadEnvironment(view, scene);
    scene.routeVisualPool.destroy();
  }
});

test('sector transition lasts 1.8 seconds with smooth ambient and camera easing and bounded streaks', () => {
  const {scene, view, ship, texture, tweens, created} = roadEnvironmentFixture();
  setRoadEnvironmentVisible(view, true, scene);
  setRoadLighting(view, SECTOR_LIGHTING[1], true);
  setRoadLighting(view, SECTOR_LIGHTING[3]);
  updateRoadEnvironment(view, scene, ship, 3000, 0, 0.45);
  assert.deepEqual(view.color, [231.71875, 233.4375, 237.65625], 'smoothstep eases into the new ambient colour');
  updateRoadEnvironment(view, scene, ship, 3000, 0, 0.45);
  assert.deepEqual(view.color, [180.5, 186, 199.5]);
  updateRoadEnvironment(view, scene, ship, 3000, 0, 0.9);
  assert.deepEqual(view.color, [106, 117, 144]);
  const exhaust = {anchor: {x: 190, y: 670}, emitter: {explode(...args) { this.burst = args; }}};
  startRoadBurst(view, scene, exhaust);
  assert.deepEqual([tweens[0].factor, tweens[0].duration, tweens[0].ease], [0.94, 300, 'Sine.easeInOut']);
  tweens[0].onComplete();
  assert.deepEqual([tweens[1].factor, tweens[1].duration, tweens[1].ease], [1, 1500, 'Sine.easeInOut']);
  const seconds = (tweens[0].duration + tweens[1].duration) / 1000;
  assert.ok(seconds >= 1.5 && seconds <= 2, 'the full transition matches the owner duration range');
  assert.equal(seconds, ENVIRONMENT_VISUALS.ambientBlendSeconds);
  assert.equal(seconds, ENVIRONMENT_VISUALS.streakSeconds);
  assert.deepEqual(exhaust.emitter.burst, [5, 190, 670]);
  assert.deepEqual(view.backfire.burst, [8, 190, 670]);
  updateRoadEnvironment(view, scene, ship, 3000, 0, 0.1);
  assert.ok(view.streaks.lines.length > 0);
  for (const [x] of view.streaks.lines) {
    assert.ok(x < ROAD_LEFT || x > ROAD_RIGHT);
    assert.ok(x < 390 * 0.15 || x > 390 * 0.85, 'protect the inner 70% of the view');
  }
  updateRoadEnvironment(view, scene, ship, 3000, 0, 1.4);
  assert.equal(view.streaks.visible, true, 'transition remains visible after 1.5 seconds');
  assert.ok(view.streakRemaining > 0 && view.streakRemaining <= 0.31);
  updateRoadEnvironment(view, scene, ship, 3000, 0, 0.31);
  assert.equal(view.streaks.visible, false);
  setRoadEnvironmentVisible(view, false, scene);
  assert.equal(view.zoom.factor, 1);
  assert.ok([...view.beams, ...view.skids].every(node => !node?.visible));
  destroyRoadEnvironment(view, scene);
  scene.routeVisualPool.destroy();
  assert.equal(texture.removed, 'ambient_environment-test');
  assert.ok(created.filter(node => node !== view.road.subRoad).every(node => node.destroyed));
});

test('truck contact shadow is a grounded navy silhouette mirroring frame, transform, alpha and phase', () => {
  const {scene} = effectsScene();
  const effects = createHaulerEffects(scene);
  const {shadow} = effects;
  assert.equal(shadow.type, undefined, 'shadow is a sprite, not an ellipse');
  assert.equal(shadow.key, 'cargo_ship');
  assert.deepEqual([shadow.originX, shadow.originY], [0.5, 0.5]);
  assert.equal(shadow.tint, 0x050a12);
  assert.equal(shadow.alpha, 0.55);
  assert.equal(shadow.scaleX, 1);
  const ship = {x: 120, y: 684, visible: true, scaleX: 1.21, scaleY: 1.21, alpha: 0.58, depth: 8,
    originX: 0.5, originY: 0.5, rotation: 0, flipX: false, flipY: false,
    texture: {key: 'cargo_ship'}, frame: {name: '__BASE'}};
  syncHaulerEffects(effects, ship, [], 0, 12, 'running', 100);
  assert.equal(shadow.visible, true);
  assert.equal(shadow.textureSets, undefined, 'unchanged frame is not re-applied every tick');
  assert.deepEqual([shadow.x, shadow.y], [120, 684], 'contact shadow has no floating offset');
  assert.ok(Math.abs(shadow.scaleX - 1.21) < 1e-9 && Math.abs(shadow.scaleY - 1.21) < 1e-9);
  assert.ok(Math.abs(shadow.alpha - 0.58 * 0.55) < 1e-9);
  assert.equal(shadow.tint, SHADOW_TINT);
  assert.ok(shadow.depth < ship.depth && shadow.depth > 7.6,
    'directly beneath the hull, above every other hauler attachment');

  Object.assign(ship, {x: 90, rotation: 0.3, flipX: true, flipY: true, originX: 0.4, originY: 0.6, alpha: 1,
    texture: {key: 'cargo_ship_swift'}, frame: {name: 'bank-left'}});
  syncHaulerEffects(effects, ship, [], 0, 12, 'depot', 120);
  assert.equal(shadow.visible, true);
  assert.deepEqual([shadow.texture.key, shadow.frame.name], ['cargo_ship_swift', 'bank-left']);
  assert.deepEqual([shadow.rotation, shadow.flipX, shadow.flipY, shadow.originX, shadow.originY],
    [0.3, true, true, 0.4, 0.6]);
  assert.deepEqual([shadow.x, shadow.y], [90, 684], 'contact stays underneath the chassis while tilted');
  assert.equal(shadow.tint, SHADOW_TINT, 'hull trim tint is never copied onto the shadow');
  for (const phase of ['menu', 'garage', 'crashing', 'result']) {
    syncHaulerEffects(effects, ship, [], 0, 12, phase, 140);
    assert.equal(shadow.visible, false, phase);
  }
  ship.visible = false;
  syncHaulerEffects(effects, ship, [], 0, 12, 'running', 160);
  assert.equal(shadow.visible, false);
});

test('docked cargo crates cast silhouette shadows that follow load, visibility and depth', () => {
  const {scene} = effectsScene();
  const effects = createHaulerEffects(scene);
  assert.equal(effects.cargoShadows.length, 4);
  const crates = Array.from({length: 4}, () => ({...visualNode(), depth: 7, alpha: 1,
    texture: {key: 'cargo_trailer'}, frame: {name: '__BASE'}}));
  const ship = {x: 150, y: 684, visible: true, scaleX: 1.1, scaleY: 1.1, alpha: 1, depth: 8, rotation: 0,
    texture: {key: 'cargo_ship'}, frame: {name: '__BASE'}};
  syncHaulerEffects(effects, ship, crates, 6, 12, 'running', 0);
  effects.cargoShadows.forEach((shadow, i) => {
    assert.equal(shadow.key, 'cargo_trailer');
    assert.equal(shadow.tint, SHADOW_TINT);
    assert.equal(shadow.visible, i < 2, 'only loaded crates cast shadows');
    assert.deepEqual([shadow.x, shadow.y], [crates[i].x, crates[i].y + 2]);
    assert.ok(Math.abs(shadow.alpha - 0.5) < 1e-9);
    assert.ok(shadow.depth < crates[i].depth && shadow.depth > 6.5, 'beneath its crate, above the rack');
    assert.deepEqual([shadow.scaleX, shadow.scaleY], [crates[i].scaleX, crates[i].scaleY]);
  });

  syncHaulerEffects(effects, ship, crates, 12, 12, 'menu', 0);
  assert.ok(effects.cargoShadows.every(shadow => !shadow.visible));
});

test('every candidate and active hazard pool resolves exclusively to cached dedicated obstacle sprites', () => {
  const {scene, textures} = drawingScene();
  createIndustrialTextures(scene);
  const spriteKeys = new Set([...OBSTACLE_ART.flatMap(art => art.textures), ...GUARDRAIL_ART.map(art => art.key)]);
  for (const art of OBSTACLE_ART) {
    const png = readFileSync(new URL(art.url));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0);
  }
  for (const [themeId, environment] of Object.entries(ENVIRONMENTS)) {
    const kinds = new Set(environment.hazardFamilies);
    for (const registry of [CHUNK_REGISTRIES, LEVEL2_CHUNK_REGISTRIES]) {
      for (const chunk of registry[themeId]) for (const row of chunk.rows) {
        for (const hazard of [...row.hazards, ...(row.intermediates ?? [])]) kinds.add(hazard.kind);
      }
    }
    for (const kind of kinds) {
      const key = hazardTexture(kind, themeId, 0, scene);
      assert.ok(spriteKeys.has(key), `${themeId}/${kind} is a dedicated sprite, not a generated placeholder`);
      assert.ok(scene.textures.exists(key));
      if (!HAZARDS[kind].elongated) {
        assert.ok(textures.get(key).commands.some(([method]) => method === 'drawImage'));
        assert.ok(textures.get(key).commands.every(([method]) =>
          ['save', 'translate', 'rotate', 'drawImage', 'restore'].includes(method)));
      }
    }
  }
});

test('missing cached obstacle or guardrail textures warn once and substitute real barrier pixels without geometry changes', t => {
  const warning = t.mock.method(console, 'warn', () => {});
  const {scene, textures} = drawingScene();
  scene.textures.remove('chicane_mid');
  const geometry = JSON.stringify(HAZARDS);
  createIndustrialTextures(scene);
  assert.equal(textures.get('chicane_mid').commands[0][1].key, 'hazard_divider');
  assert.ok(warning.mock.calls.some(call => call.arguments[0].includes('chicane_mid')));
  const before = warning.mock.calls.length;
  for (let attempt = 0; attempt < 2; attempt++) {
    textures.delete('hazard_rockSlab');
    assert.equal(hazardTexture('rockSlab', 'dustlands', 0, scene), 'hazard_rockSlab');
    const fallback = textures.get('hazard_rockSlab');
    assert.deepEqual([fallback.width, fallback.height], [60, 46]);
    assert.equal(fallback.commands[0][1].key, 'hazard_divider');
  }
  assert.equal(warning.mock.calls.length, before + 1, 'repeated misses do not flood the console');
  assert.equal(JSON.stringify(HAZARDS), geometry);
});

test('hazard silhouette shadows copy art transform, use the shared tint and stay pinned while scrolling', () => {
  const {scene} = effectsScene();
  const sprite = {...visualNode(), x: 86, y: 120, depth: 5, alpha: 1, scaleX: 1.1, scaleY: 2.2,
    originX: 0.3, originY: 0.5, flipX: true, flipY: false, rotation: 0,
    texture: {key: 'hazard_barrier'}, frame: {name: '__BASE'}};
  const shadow = syncSilhouetteShadow(createSilhouetteShadow(scene, sprite), sprite, true);
  assert.equal(shadow.key, 'hazard_barrier');
  assert.equal(shadow.tint, SHADOW_TINT);
  assert.equal(shadow.depth, 4.95, 'one layer below the hazard and above the pickup glow layer');
  assert.deepEqual([shadow.originX, shadow.flipX, shadow.scaleX, shadow.scaleY], [0.3, true, 1.1, 2.2]);
  for (const y of [180, 400, 900]) {
    sprite.y = y;
    syncSilhouetteShadow(shadow, sprite, true);
    assert.deepEqual([shadow.x, shadow.y], [86 + balance.SHADOW_OFFSET_X, y + balance.SHADOW_OFFSET_Y]);
  }
  assert.equal(shadow.textureSets, undefined, 'unchanged texture is not re-applied each frame');
});

test('exhaust stack follows suspension roll while cargo remains unrotated', () => {
  const {scene} = effectsScene();
  const effects = createHaulerEffects(scene);
  const crates = Array.from({length: 4}, visualNode);
  const ship = {x: 195, y: 684, visible: true, scaleX: 1.1, scaleY: 1.1, alpha: 1, depth: 8, rotation: 0,
    texture: {key: 'cargo_ship'}, frame: {name: '__BASE'}};
  syncHaulerEffects(effects, ship, crates, 12, 12, 'running', 0);
  const dx = effects.exhaust.anchor.x - ship.x, dy = effects.exhaust.anchor.y - ship.y;
  ship.rotation = 0.2;
  syncHaulerEffects(effects, ship, crates, 12, 12, 'running', 0);
  assert.ok(Math.abs(effects.exhaust.anchor.x - ship.x - (dx * Math.cos(0.2) - dy * Math.sin(0.2))) < 1e-9);
  assert.ok(Math.abs(effects.exhaust.anchor.y - ship.y - (dx * Math.sin(0.2) + dy * Math.cos(0.2))) < 1e-9);
  assert.ok(crates.every((crate, i) => crate.x === ship.x && crate.y === ship.y + 46 + i * 29));
});

test('particle-dot is a 4x4 soft white texture generated once with an off-display graphics object', () => {
  const {scene, graphics, textures} = effectsScene();
  createHaulerEffects(scene);
  createHaulerEffects(scene);
  assert.equal(graphics.length, 1, 'texture survives scene restarts without regeneration');
  const [g] = graphics;
  assert.equal(g.config.add, false);
  assert.ok(g.destroyed);
  assert.ok(textures.has('particle-dot'));
  assert.deepEqual(g.calls.at(-1), ['generateTexture', 'particle-dot', 4, 4]);
  const fills = g.calls.filter(([op]) => op === 'fillStyle');
  assert.ok(fills.every(([, color]) => color === 0xffffff));
  assert.ok(fills.length > 1 && fills[0][2] < fills.at(-1)[2], 'alpha rises toward the centre');
  assert.ok(g.calls.filter(([op]) => op === 'fillCircle').every(([, x, y, r]) => x === 2 && y === 2 && r <= 2));
});

test('one pooled diesel emitter makes expanding charcoal puffs that drift with road scroll only while running', () => {
  const {scene, created} = effectsScene();
  const effects = createHaulerEffects(scene);
  const {emitter, anchor} = effects.exhaust;
  assert.equal(created.filter(node => node.type === 'particles').length, 4,
    'normal diesel, low-Hull smoke, grind/impact sparks and orb sparks');
  assert.equal(effects.thrust, undefined, 'no flame images remain');
  assert.equal(TEXTURE_SIZES.cargo_thrust, undefined);
  assert.equal(emitter.key, 'particle-dot');
  assert.equal(emitter.config.blendMode, 'NORMAL');
  assert.ok(emitter.config.tint.every(color => Math.max(color >> 16, (color >> 8) & 255, color & 255) <= 0x60));
  assert.ok(emitter.config.maxAliveParticles <= 12);
  assert.equal(emitter.follow, anchor);
  assert.equal(emitter.emitting, false);
  assert.ok(emitter.depth > 7 && emitter.depth < 8);
  const count = created.length;
  const boxes = Array.from({length: 4}, visualNode);
  const ship = {x: 195, y: 684, visible: true, scaleX: 1.1, scaleY: 1.1, alpha: 0.58,
    texture: {key: 'cargo_ship'}};
  for (let time = 0; time < 600; time += 20) {
    syncHaulerEffects(effects, ship, boxes, 4, 12, 'running', time, 1 / 60, 500);
    assert.equal(emitter.emitting, true);
    assert.equal(anchor.scale, ship.scaleX);
    assert.equal(emitter.alpha, 0.58);
    assert.equal(emitter.config.speedY.onEmit(), 540);
  }
  const scale = emitter.config.scale;
  assert.ok(Math.abs(scale.onEmit() - 1.2 * ship.scaleX) < 1e-9);
  assert.ok(Math.abs(scale.onUpdate(null, 'scale', 0.5) - 2.6 * ship.scaleX) < 1e-9);
  assert.ok(scale.onUpdate(null, 'scale', 1) > scale.onEmit(), 'puffs expand rather than shrink like thrusters');
  ship.texture.key = 'cargo_ship_swift';
  syncHaulerEffects(effects, ship, boxes, 4, 12, 'running', 700);
  assert.equal(emitter.emitting, true);
  for (const phase of ['depot', 'menu', 'garage', 'vehicleDetail', 'crashing', 'result']) {
    syncHaulerEffects(effects, ship, boxes, 4, 12, phase, 800);
    assert.equal(emitter.emitting, false, phase);
  }
  syncHaulerEffects(effects, ship, boxes, 4, 12, 'running', 900);
  stopHaulerExhaust(effects);
  assert.ok(!emitter.emitting && emitter.killed === 1);
  assert.equal(created.length, count, 'emitters are pooled, never allocated per frame');
});

test('cargo follows an articulated history chain, matches rotated shadows and hitches, then resets without extra objects', () => {
  const {scene, created} = effectsScene();
  const effects = createHaulerEffects(scene);
  const count = created.length;
  const ship = {x: 195, y: 684, visible: true, scaleX: 0.92, scaleY: 0.92, alpha: 1,
    texture: {key: 'cargo_ship_swift'}};
  const boxes = Array.from({length: 4}, visualNode);
  syncHaulerEffects(effects, ship, boxes, 7, 7, 'running', 0);
  let snaked = false;
  for (let frame = 1; frame <= 240; frame++) {
    ship.x = 195 + 100 * Math.sin(frame / 20);
    syncHaulerEffects(effects, ship, boxes, 7, 7, 'running', frame * 1000 / 60, 1 / 60);
    if (new Set(boxes.map(box => Math.round(box.x))).size === 4) snaked = true;
    boxes.forEach((box, i) => {
      assert.deepEqual([effects.cargoShadows[i].x, effects.cargoShadows[i].y, effects.cargoShadows[i].rotation],
        [box.x, box.y + 2, box.rotation]);
      assert.equal(effects.cargoShadows[i].alpha, 0.5);
      assert.equal(effects.cargoShadows[i].tint, SHADOW_TINT);
      assert.ok(Math.abs(box.x - ship.x) <= 18 + 1e-9);
      assert.ok(Math.abs(box.rotation - (ship.rotation ?? 0)) <= 8 * Math.PI / 180 + 1e-9);
    });
    assert.ok(effects.hitches.every(hitch => hitch.visible && Number.isFinite(hitch.rotation)));
  }
  assert.ok(snaked);
  assert.equal(effects.cargoTrail.history.length, 120);
  const positions = boxes.map(box => [box.x, box.y, box.rotation]);
  syncHaulerEffects(effects, ship, boxes, 7, 7, 'running', 50);
  assert.deepEqual(boxes.map(box => [box.x, box.y, box.rotation]), positions, 'refresh does not integrate twice');
  ship.x = 90;
  syncHaulerEffects(effects, ship, boxes, 7, 7, 'menu', 2500);
  assert.ok(boxes.every(box => box.x === 90 && !box.visible), 'hidden/restarted trucks reset cargo lag');
  assert.ok(effects.hitches.every(hitch => !hitch.visible));
  assert.equal(created.length, count);
});

test('gold sparkles remain bounded, follow the ship and disappear outside visible gameplay', () => {
  const effects = {rack: visualNode(),
    sparkles: [visualNode(), visualNode(), visualNode()]};
  const ship = {x: 195, y: 684, scaleX: 1, scaleY: 1, alpha: 1, visible: true,
    texture: {key: 'cargo_ship_gold'}};
  let maximum = 0;
  for (let time = 0; time < 3000; time += 40) {
    syncHaulerEffects(effects, ship, [], 0, 12, 'running', time);
    for (const sparkle of effects.sparkles) {
      assert.equal(sparkle.visible, true);
      assert.ok(sparkle.alpha >= 0 && sparkle.alpha <= 0.85);
      assert.ok(sparkle.scaleX >= 0.18 && sparkle.scaleX <= 0.5);
      assert.ok(Math.abs(sparkle.x - ship.x) <= 16 && Math.abs(sparkle.y - ship.y) <= 23);
      maximum = Math.max(maximum, sparkle.alpha);
    }
  }
  assert.ok(maximum > 0.8);
  for (const phase of ['menu', 'garage', 'help', 'crashing', 'result']) {
    syncHaulerEffects(effects, ship, [], 0, 12, phase, 0);
    assert.ok(effects.sparkles.every(sparkle => !sparkle.visible));
  }
  ship.texture.key = 'cargo_ship_white-blue';
  syncHaulerEffects(effects, ship, [], 0, 12, 'running', 0);
  assert.ok(effects.sparkles.every(sparkle => !sparkle.visible));
});

test('gold preview twinkles clean up their own tweens when scrolling menus are rebuilt', () => {
  const tweens = [], destroyed = [], nodes = [];
  const scene = {add: {image(x, y, key) {
    const node = {...visualNode(), x, y, key,
      setDepth(depth) { this.depth = depth; return this; },
      once(event, handler) { assert.equal(event, 'destroy'); this.onDestroy = handler; return this; }};
    nodes.push(node);
    return node;
  }}, tweens: {add: tween => tweens.push(tween), killTweensOf: node => destroyed.push(node)}};
  const ship = {x: 195, y: 300, scaleX: 0.3, depth: 34};
  assert.deepEqual(addGoldPreviewSparkles(scene, ship, 'standard', 'default'), []);
  const gold = addGoldPreviewSparkles(scene, ship, 'standard', 'gold');
  assert.equal(gold.length, 3);
  assert.equal(tweens.length, 3);
  assert.ok(tweens.every(tween => tween.repeat === -1 && tween.yoyo));
  assert.ok(nodes.every(node => node.depth === 35));
  gold.forEach(node => node.onDestroy());
  assert.deepEqual(destroyed, gold);
});

test('sector road uses aligned tiled surfaces and lane-center-derived stripe positions with unchanged spacing', () => {
  const surfaces = [];
  const rectangles = [];
  const scene = {add: {
    tileSprite: (...args) => {
      const surface = {args, setDepth(depth) { this.depth = depth; return this; }, setFlipX() { return this; },
        setBlendMode(mode) { this.blendMode = mode; return this; }, setAlpha() { return this; }};
      surfaces.push(surface);
      return surface;
    },
    rectangle: (...args) => { rectangles.push(args); return args; },
  }};
  const road = buildIndustrialRoad(scene, {width: 390, height: 844, stripeGap: 78, stripesPerColumn: 12});
  assert.equal(surfaces.length, 7);
  assert.equal(road.flanks.length, 4);
  assert.deepEqual(road.flanks.map(flank => flank.args[0]), [-21.5, 411.5, -21.5, 411.5]);
  assert.equal(road.subRoad.depth, 0.05);
  assert.equal(road.subRoad.blendMode, 'MULTIPLY');
  assert.deepEqual(road.subRoad.args, [195, 422, 454, 908, 'subroad_industrial']);
  assert.deepEqual(road.surface.args, [195, 422, 390, 844, 'industrial_road']);
  assert.equal(road.surface.depth, -1);
  assert.equal(road.lines.length, 36);
  assert.deepEqual(rectangles[0], [(LANE_CENTERS[0] + LANE_CENTERS[1]) / 2,
    -25, 2, 35, PALETTE.steelLight, 0.5]);
  assert.equal(rectangles[1][1], 53);
  assert.equal(rectangles[12][0], (LANE_CENTERS[1] + LANE_CENTERS[2]) / 2);
  assert.equal(rectangles[24][0], (LANE_CENTERS[2] + LANE_CENTERS[3]) / 2);
});

test('HUD backing and Depot decoration stay below text and leave a clear warning gap', () => {
  const node = (...args) => ({args, setDepth(depth) { this.depth = depth; return this; }});
  const scene = {add: {rectangle: node, image: node}};
  const backing = addHudBacking(scene, 390);
  assert.deepEqual(backing.args, [195, 35, 390, 70, 0x0c111a, 0.88]);
  assert.ok(35 + 70 / 2 < 120, 'HUD backing must end above the Depot notice');
  const depot = addDepotDetails(scene, 195, 237);
  assert.deepEqual(depot.args, [195, 237, 'industrial_depot']);
  assert.equal(depot.depth, 32);
});

test('angular controls use local positive coordinates so Phaser aligns visuals and hit areas', () => {
  const scene = {add: {polygon(x, y, points, fill) {
    return {
      x, y, points, fill,
      setStrokeStyle() { return this; },
      setDepth(depth) { this.depth = depth; return this; },
    };
  }}};
  const button = addSteelControl(scene, 195, 458, 315, 59);
  const xs = button.points.filter((_, i) => i % 2 === 0);
  const ys = button.points.filter((_, i) => i % 2 === 1);
  assert.equal(Math.min(...xs), 0);
  assert.equal(Math.max(...xs), 315);
  assert.equal(Math.min(...ys), 0);
  assert.equal(Math.max(...ys), 59);
  assert.equal(button.x, 195);
  assert.equal(button.y, 458);
  assert.equal(button.depth, 34);
});
