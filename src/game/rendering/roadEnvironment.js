import {ENVIRONMENT_VISUALS as V, NEON_READABILITY, SECTOR_LIGHTING, LEVEL_SECTOR_LIGHTING, OVERDRIVE_LIGHTING,
  headlightFalloff, streetlightFalloff} from '../data/environments.js';
import {METERS_PER_PIXEL} from '../core/economy.js';
import {ROAD_LEFT, ROAD_RIGHT} from '../data/route.js';
import {DEPOT_RULES, depotWorldY, depotDockingStart} from '../core/depots.js';
import {hullPoint} from './industrial.js';
import {routeImage, routeTile, releaseRouteVisual} from './routeVisualPool.js';

const channels = color => [color >> 16, (color >> 8) & 255, color & 255];

export function lightingForSector(sector, distance, finishDistance, mode = 'normal', levelId = 'level1') {
  if (!['normal', 'continuous'].includes(mode)) throw new Error(`Unknown lighting mode ${mode}`);
  if (mode === 'continuous') {
    if (sector.themeId === 'neon') return LEVEL_SECTOR_LIGHTING.level4[1];
    return sector.number === 3 ? SECTOR_LIGHTING[2] : SECTOR_LIGHTING[1];
  }
  if (distance >= finishDistance) return OVERDRIVE_LIGHTING;
  const lighting = LEVEL_SECTOR_LIGHTING[levelId]?.[sector.number - 1];
  if (!lighting) throw new Error(`Unavailable lighting for ${levelId}, Sector ${sector.number}`);
  return lighting;
}

function headlightInfluence(x, y, beam) {
  const cos = beam.cos ?? Math.cos(beam.rotation), sin = beam.sin ?? Math.sin(beam.rotation);
  const dx = x - beam.x, dy = y - beam.y;
  const forward = -(dy * cos - dx * sin);
  return headlightFalloff(forward, dx * cos + dy * sin);
}

function lightAtPoint(x, y, beams, lamps) {
  let light = 0;
  for (const beam of beams) light = Math.max(light, headlightInfluence(x, y, beam));
  for (const lamp of lamps) {
    light = Math.max(light, streetlightFalloff(Math.hypot(x - lamp.x, y - lamp.y)));
  }
  return light;
}

export function ambientAtPoint(color, x, y, beams, lamps) {
  const light = lightAtPoint(x, y, beams, lamps);
  return color.map(channel => Math.round(channel + (255 - channel) * light));
}

export function createRoadEnvironment(scene, road, width, height) {
  // A small, linearly filtered multiplicative light mask works in both Canvas and WebGL.
  const key = `ambient_${scene.sys.settings.key}`;
  const texture = scene.textures.createCanvas(key, Math.ceil((width + V.sideFillPx * 2) / 4),
    Math.ceil((height + 64) / 4));
  texture.setFilter(0); // Phaser LINEAR; keep the upscaled light mask smooth in pixel-art mode.
  const context = texture.getContext();
  const pixels = context.createImageData(texture.width, texture.height);
  const ambient = scene.add.image(width / 2, height / 2, key)
    .setDisplaySize(width + V.sideFillPx * 2, height + 64).setBlendMode('MULTIPLY').setDepth(16).setVisible(false);
  const renderer = scene.sys.game.renderer;
  if (renderer.currentContext && renderer.blendModes[ambient.blendMode] !== 'multiply') {
    // Phaser can cache source-over before its asynchronous Canvas blend probe completes.
    const canvasContext = renderer.currentContext;
    const previousOperation = canvasContext.globalCompositeOperation;
    canvasContext.globalCompositeOperation = 'multiply';
    const supported = canvasContext.globalCompositeOperation === 'multiply';
    canvasContext.globalCompositeOperation = previousOperation;
    if (!supported) throw new Error('Road lighting requires Canvas multiply blending.');
    renderer.blendModes[ambient.blendMode] = 'multiply';
  }
  const beams = [-1, 1].map(() => scene.add.image(0, 0, 'truck_headlight_cone')
    .setOrigin(0.5, 1).setDisplaySize(V.headlightWidth, V.headlightLength)
    .setBlendMode('ADD').setAlpha(V.headlightAlpha).setDepth(9).setVisible(false));
  const lampCount = 2 * (Math.ceil((height + V.streetlightRadius * 2) * METERS_PER_PIXEL /
    V.streetlightSpacingMeters) + 1);
  const lamps = Array.from({length: lampCount}, () => ({
    pole: scene.add.image(0, 0, 'streetlight_pole').setDepth(3.5).setVisible(false),
    pool: scene.add.image(0, 0, 'streetlight_pool').setBlendMode('ADD')
      .setAlpha(V.streetlightAlpha).setDepth(2).setVisible(false),
  }));
  const skids = Array(4).fill(null);
  const glints = routeTile(scene, width / 2, height / 2, width, height, 'road_dawn_glints')
    .setDepth(0.1).setVisible(false);
  const streaks = scene.add.graphics().setDepth(17).setVisible(false);
  const dockingChevrons = scene.add.graphics().setDepth(0.3).setVisible(false);
  const backfire = scene.add.particles(0, 0, 'particle-dot', {
    emitting: false, lifespan: 220, maxAliveParticles: 12,
    speedX: {min: -45, max: 45}, speedY: {min: 80, max: 180},
    scale: {start: 1.5, end: 0}, alpha: {start: 0.9, end: 0},
    tint: [0xff963c, 0xffc160], blendMode: 'ADD',
  }).setDepth(7.8);
  return {road, width, height, texture, context, pixels, ambient, beams, lamps, skids, glints,
    sideFillPx: V.sideFillPx,
    streaks, dockingChevrons, backfire, color: [255, 255, 255], from: [255, 255, 255], target: [255, 255, 255],
    blendElapsed: V.ambientBlendSeconds, lighting: OVERDRIVE_LIGHTING, visible: false,
    zoom: {factor: 1}, streakRemaining: 0, depotMarks: []};
}

export function setRoadLighting(view, lighting, immediate = false) {
  view.lighting = lighting;
  view.from = [...view.color];
  view.target = channels(lighting.tint);
  view.blendElapsed = immediate ? V.ambientBlendSeconds : 0;
  if (immediate) view.color = [...view.target];
}

export function stopRoadBurst(view, scene) {
  scene.tweens.killTweensOf(view.zoom);
  view.zoom.factor = 1;
  view.streakRemaining = 0;
  view.streaks.clear().setVisible(false);
  view.backfire.killAll();
}

export function setRoadEnvironmentVisible(view, visible, scene) {
  view.visible = visible;
  view.ambient.setVisible(visible);
  if (!visible) {
    stopRoadBurst(view, scene);
    view.skids.forEach((node, index) => {
      releaseRouteVisual(scene, node);
      view.skids[index] = null;
    });
    [...view.beams, view.glints, view.dockingChevrons,
      ...view.lamps.flatMap(lamp => [lamp.pole, lamp.pool])].forEach(node => node.setVisible(false));
  }
}

function syncDecal(slots, index, scene, x, y, height, visible) {
  if (!visible) {
    releaseRouteVisual(scene, slots[index]);
    slots[index] = null;
    return;
  }
  const node = slots[index] ?? routeImage(scene, x, y, 'road_decal_skid');
  slots[index] = node;
  node.setPosition(x, y).setDisplaySize(48, height).setAlpha(0.15).setDepth(0.2).setVisible(true);
}

export function startRoadBurst(view, scene, exhaust) {
  stopRoadBurst(view, scene);
  view.streakRemaining = V.streakSeconds;
  const update = () => scene.syncResponsiveCamera();
  scene.tweens.add({targets: view.zoom, factor: V.burstZoom, duration: V.burstOutMs,
    ease: 'Sine.easeInOut', onUpdate: update, onComplete: () => {
      if (view.visible) scene.tweens.add({targets: view.zoom, factor: 1, duration: V.burstReturnMs,
        ease: 'Sine.easeInOut', onUpdate: update});
    }});
  if (exhaust) {
    exhaust.emitter.explode(5, exhaust.anchor.x, exhaust.anchor.y);
    view.backfire.explode(8, exhaust.anchor.x, exhaust.anchor.y);
  }
}

function rememberDepotDecals(view, depot, scene) {
  if (!depot || !Number.isFinite(depot.distance) || view.depotMarks.some(mark => mark.distance === depot.distance)) return;
  view.depotMarks.push({distance: depot.distance, side: depot.side,
    brakingStart: depotDockingStart(depot, scene.levelId ?? 'level1', scene.runMode ?? 'normal')});
  if (view.depotMarks.length > 2) view.depotMarks.shift();
}

function syncStreaks(view, scene, dt) {
  view.streakRemaining = Math.max(0, view.streakRemaining - dt);
  const graphic = view.streaks.clear().setVisible(view.streakRemaining > 0);
  if (!view.streakRemaining) return;
  const camera = scene.cameras.main;
  const left = camera.midPoint.x - camera.width / camera.zoom / 2;
  const right = camera.midPoint.x + camera.width / camera.zoom / 2;
  const top = camera.midPoint.y - camera.height / camera.zoom / 2;
  const bottom = top + camera.height / camera.zoom;
  const margin = (right - left) * V.streakMargin;
  const bands = [[left, Math.min(ROAD_LEFT - 2, left + margin)],
    [Math.max(ROAD_RIGHT + 2, right - margin), right]];
  graphic.lineStyle(2, 0xdbeaf5, view.streakRemaining / V.streakSeconds);
  for (const [from, to] of bands) {
    if (to <= from) continue;
    for (let i = 0; i < 8; i++) {
      const x = from + (to - from) * (i + 0.5) / 8;
      const y = top + (bottom - top) * ((i * 0.137 + view.streakRemaining * 3) % 1);
      graphic.lineBetween(x, y, x, Math.min(bottom, y + 80));
    }
  }
}

export function updateRoadEnvironment(view, scene, ship, distance, scrollPx, dt, nextDepot) {
  view.road.subRoad.tilePositionY -= scrollPx * (view.road.subRoad.scrollRatio ?? V.subRoadSpeed);
  view.glints.tilePositionY -= scrollPx;
  if (!view.visible) return;
  const remaining = nextDepot?.distance - distance;
  const docking = view.dockingChevrons.clear().setVisible(scene.phase === 'running' &&
    Number.isFinite(remaining) && remaining >= 0 && remaining <= DEPOT_RULES.noticeMeters);
  if (docking.visible) {
    const laneWidth = (ROAD_RIGHT - ROAD_LEFT) / 4;
    docking.lineStyle(4, 0x54f0a2, 0.85);
    const x = nextDepot.side === 'left' ? ROAD_LEFT + laneWidth / 2 : ROAD_RIGHT - laneWidth / 2;
    const siteY = depotWorldY(nextDepot, distance);
    for (let y = -40 + (distance / METERS_PER_PIXEL) % 80; y <= view.height + 40; y += 80) {
      if (y - 3 < siteY) continue;
      docking.lineBetween(x - 15, y + 10, x, y - 3);
      docking.lineBetween(x, y - 3, x + 15, y + 10);
    }
  }
  view.blendElapsed = Math.min(V.ambientBlendSeconds, view.blendElapsed + dt);
  const progress = view.blendElapsed / V.ambientBlendSeconds;
  const blend = progress * progress * (3 - 2 * progress);
  view.color = view.from.map((color, i) => color + (view.target[i] - color) * blend);
  const night = view.lighting.headlights;
  const lights = [];
  view.beams.forEach((beam, i) => {
    const point = hullPoint(ship, (i ? 1 : -1) * 14 * ship.scaleX, -32.5 * ship.scaleY);
    beam.setPosition(point.x, point.y).setRotation(ship.rotation ?? 0)
      .setVisible(night && ['running', 'docking', 'depot'].includes(scene.phase));
    if (beam.visible) lights.push({x: point.x, y: point.y, rotation: ship.rotation ?? 0,
      cos: Math.cos(ship.rotation ?? 0), sin: Math.sin(ship.rotation ?? 0)});
  });
  const pools = [];
  const first = Math.floor((distance + (ship.y - view.height - V.streetlightRadius) *
    METERS_PER_PIXEL) / V.streetlightSpacingMeters);
  view.lamps.forEach((lamp, i) => {
    const mark = (first + Math.floor(i / 2)) * V.streetlightSpacingMeters;
    const y = ship.y - (mark - distance) / METERS_PER_PIXEL;
    const right = i % 2 === 1;
    const visible = night && mark >= 0 && y >= -V.streetlightRadius && y <= view.height + V.streetlightRadius;
    lamp.pole.setPosition(right ? view.width - 18 : 18, y - 35).setFlipX(!right).setVisible(visible);
    lamp.pool.setPosition(right ? ROAD_RIGHT - 42 : ROAD_LEFT + 42, y).setVisible(visible);
    if (visible) pools.push({x: lamp.pool.x, y});
  });
  rememberDepotDecals(view, nextDepot, scene);
  view.skids.forEach((_node, i) => {
    const depot = view.depotMarks[Math.floor(i / 2)];
    const segmentHeight = depot ? (depot.distance - depot.brakingStart) / METERS_PER_PIXEL / 2 : 0;
    const y = depot ? depotWorldY(depot, distance) + (i % 2 + 0.5) * segmentHeight : -1000;
    syncDecal(view.skids, i, scene, depot?.side === 'left' ? ROAD_LEFT + 32 : ROAD_RIGHT - 32, y,
      segmentHeight, segmentHeight > 0 && y + segmentHeight / 2 >= 0 &&
        y - segmentHeight / 2 <= view.height);
  });
  view.glints.setVisible(view.lighting === SECTOR_LIGHTING[0]);
  // White mask regions restore original world saturation inside lights, including obstacles and pickups.
  const maskColor = view.color.join(',');
  const neon = scene.currentSector?.themeId === 'neon' ||
    (scene.levelId === 'level4' && scene.runMode !== 'continuous');
  if (night || maskColor !== view.lastMaskColor || neon !== view.lastNeonReadability) {
    const pixels = view.pixels.data;
    for (let y = 0; y < view.texture.height; y++) for (let x = 0; x < view.texture.width; x++) {
      const worldX = -view.sideFillPx + (x + 0.5) * (view.width + view.sideFillPx * 2) / view.texture.width;
      const worldY = -32 + (y + 0.5) * (view.height + 64) / view.texture.height;
      const light = lightAtPoint(worldX, worldY, lights, pools);
      const index = (y * view.texture.width + x) * 4;
      const onRoad = neon && worldX >= ROAD_LEFT && worldX <= ROAD_RIGHT;
      const ambientFloor = onRoad && Math.min(worldX - ROAD_LEFT, ROAD_RIGHT - worldX) <=
        NEON_READABILITY.edgeWidthPx ? NEON_READABILITY.edgeAmbient : NEON_READABILITY.roadAmbient;
      // Off-stage scenery fades toward the backdrop so the mirrored side fill frames the road quietly.
      const outside = Math.max(0, -worldX, worldX - view.width) / view.sideFillPx;
      const fade = 1 - (1 - V.sideFillOuterLight) * Math.min(1, outside);
      for (let channel = 0; channel < 3; channel++) {
        const ambient = onRoad ? Math.max(view.color[channel], ambientFloor[channel]) : view.color[channel];
        pixels[index + channel] = Math.round((ambient + (255 - ambient) * light) * fade);
      }
      pixels[index + 3] = 255;
    }
    view.context.putImageData(view.pixels, 0, 0);
    view.texture.refresh();
    view.lastMaskColor = maskColor;
    view.lastNeonReadability = neon;
  }
  syncStreaks(view, scene, dt);
}

export function destroyRoadEnvironment(view, scene) {
  stopRoadBurst(view, scene);
  view.skids.forEach((node, index) => {
    releaseRouteVisual(scene, node);
    view.skids[index] = null;
  });
  releaseRouteVisual(scene, view.glints);
  [view.ambient, ...view.beams, view.streaks,
    view.dockingChevrons, view.backfire,
    ...view.lamps.flatMap(lamp => [lamp.pole, lamp.pool])].forEach(node => node.destroy());
  scene.textures.remove(view.texture.key);
}
