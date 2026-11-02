import {IMPLEMENTED_LEVELS, sectorAtDistance} from '../core/sectors.js';
import {guardrailLayout, HAZARDS, LANE_CENTERS} from '../core/hazards.js';
import {advanceCargoTrail, createCargoTrail} from '../core/cargo.js';
import {formatStat} from '../core/modules.js';
import {ENVIRONMENTS, resolveVisualTheme, roadTint, ROAD_SURFACE_PRESETS,
  ENVIRONMENT_VISUALS, headlightFalloff, streetlightFalloff} from '../data/environments.js';
import {DEPOT_ENTRANCE_GEOMETRY, DEPOT_RULES} from '../core/depots.js';
import {ROAD_LEFT, ROAD_RIGHT} from '../data/route.js';
import {balance} from '../data/balance.js';
import {GAME_BALANCE} from '../data/gameBalance.js';
import {routeImage, routeContainer, routeTile} from './routeVisualPool.js';

/** Route environments and approved sprite art; no gameplay or save state. */
export const PALETTE = Object.freeze({
  background: 0x171e28, road: 0x2b333e, seam: 0x242c36,
  steelDark: 0x343f4c, steel: 0x65717e, steelLight: 0xa8b1bb, edge: 0x101822,
  lane: 0x89939b, warning: 0xb68b39,
  cyan: 0x28cfee, cyanLight: 0xa0f4ff, cockpit: 0x167b9b,
  gold: 0xe9b541, goldLight: 0xffdf7c, goldDark: 0x936325,
  hazard: 0xd94b30, hazardLight: 0xff9550, hazardDark: 0x762b25,
  concrete: 0xa4a69c, concreteShade: 0x70776f, safetyYellow: 0xd5b24c,
  containerBlue: 0x47728c, containerLight: 0x7fabc0, rust: 0xa65f3d, rustLight: 0xd38a58,
  depot: 0x69da80, depotDark: 0x214e3b, white: 0xf1f8ff,
  lockedFill: 0x252e39, lockedText: 0xd2d9e0, secondaryText: 0xbac6d2,
  sand: 0x8c704e, rock: 0x695640, rockLight: 0xa0845b, desertRoad: 0x333438,
  neonGround: 0x171c35, neonRoad: 0x262b43, magenta: 0x9a5eb5,
  reactorGround: 0x172922, reactorRoad: 0x2a3333, conduit: 0x599c65,
  overdriveGround: 0x211e30, overdriveRoad: 0x302e3c,
});

export const colorText = color => `#${color.toString(16).padStart(6, '0')}`;

export const SPRITE_ART_SCALE = 1.1;

export function scaleSpriteArt(sprite, scaleX = 1, scaleY = scaleX) {
  sprite.scaleX = scaleX * SPRITE_ART_SCALE;
  sprite.scaleY = scaleY * SPRITE_ART_SCALE;
  return sprite;
}

const SECTOR_MATERIALS = Object.freeze({
  industrial: {body: PALETTE.steelDark, accent: PALETTE.safetyYellow},
  dustlands: {body: PALETTE.rock, accent: PALETTE.rockLight},
  neon: {body: PALETTE.neonGround, accent: PALETTE.cyan},
  reactor: {body: PALETTE.steelDark, accent: PALETTE.conduit},
  overdrive: {body: PALETTE.overdriveGround, accent: PALETTE.magenta},
});

export const STANDARD_HAULER_TRIMS = Object.freeze({
  'white-blue': Object.freeze({name: 'BLUE / WHITE', rails: 0x308eeb, body: 0xeef3f6}),
  'black-red': Object.freeze({name: 'RED / BLACK', rails: 0xe64248, body: 0x30343c}),
  'yellow-blue': Object.freeze({name: 'YELLOW / GREEN', rails: 0xf3cb36, body: 0x579b63}),
  gold: Object.freeze({name: 'GOLD / WHITE', rails: 0xf6c84b, body: 0xf6f3e7}),
});

export function hazardTexture(kind, sector, lane = 0, scene) {
  const hazard = HAZARDS[kind];
  if (!hazard) throw new Error(`Unknown hazard ${kind}`);
  const theme = resolveVisualTheme(typeof sector === 'string'
    ? {id: sector, visualThemeId: sector} : sector);
  // Guardrails are assembled from the approved chicane tiles; the mid tile is their representative.
  const key = hazard.elongated ? 'chicane_mid'
    : kind === 'divider' && theme.hazardThemeId !== 'industrial'
      ? `divider_${theme.hazardThemeId}` : hazard.texture;
  return scene ? obstacleTexture(scene, key) : key;
}

const warnedObstacleTextures = new WeakMap();
function obstacleTexture(scene, key) {
  if (scene.textures.exists(key)) return key;
  if (!scene.textures.exists('hazard_divider')) {
    throw new Error(`Missing obstacle texture ${key}; certified barrier fallback is unavailable`);
  }
  const size = TEXTURE_SIZES[key];
  if (!size) throw new Error(`No certified obstacle texture dimensions for ${key}`);
  let warned = warnedObstacleTextures.get(scene.textures);
  if (!warned) warnedObstacleTextures.set(scene.textures, warned = new Set());
  if (!warned.has(key)) {
    console.warn(`Missing obstacle texture ${key}; substituting the certified standard barrier sprite.`);
    warned.add(key);
  }
  const texture = scene.textures.createCanvas(key, ...size);
  texture.getContext().drawImage(scene.textures.get('hazard_divider').getSourceImage(), 0, 0, ...size);
  texture.refresh();
  return key;
}

// Keep legacy bake keys sized even when gameplay redirects their objects to modular tiles.
export const TEXTURE_SIZES = Object.freeze({
  cargo_ship: Object.freeze([54, 65]),
  cargo_ship_swift: Object.freeze([54, 65]),
  cargo_coin: Object.freeze([42, 42]),
  cargo_coinStack: Object.freeze([42, 42]),
  cargo_freight: Object.freeze([42, 42]),
  cargo_blueprint: Object.freeze([42, 42]),
  cargo_blueprint_glow: Object.freeze([64, 64]),
  cargo_pickup_small: Object.freeze([42, 42]),
  cargo_pickup_med: Object.freeze([42, 42]),
  cargo_pickup_lg: Object.freeze([42, 42]),
  cargo_pickup_xl: Object.freeze([42, 42]),
  cargo_pickup_glow_blue: Object.freeze([64, 64]),
  cargo_pickup_glow_gold: Object.freeze([64, 64]),
  cargo_trailer: Object.freeze([32, 36]),
  industrial_hazard_base: Object.freeze([43, 116]),
  ...Object.fromEntries(Object.values(HAZARDS)
    .map(h => [h.texture, Object.freeze([h.scenery?.width ?? h.width, h.scenery?.height ?? h.height])])),
  chicane_entry: Object.freeze([353, 289]),
  chicane_mid: Object.freeze([233, 461]),
  chicane_exit: Object.freeze([335, 321]),
  ...Object.fromEntries(Object.keys(SECTOR_MATERIALS).flatMap(id => [
    [`base_${id}`, Object.freeze([43, 116])],
    ...(id === 'industrial' ? [] : [[`divider_${id}`, Object.freeze([64, 30])]]),
  ])),
  cargo_stack: Object.freeze([32, 30]),
  cargo_spark: Object.freeze([8, 8]),
  module_util_impact_pulse: Object.freeze([40, 40]),
  industrial_road: Object.freeze([390, 1248]),
  level2_road: Object.freeze([390, 1248]),
  dustlands_road: Object.freeze([390, 1248]),
  neon_road: Object.freeze([390, 1248]),
  reactor_road: Object.freeze([390, 1248]),
  overdrive_road: Object.freeze([390, 1248]),
  ...Object.fromEntries(Object.values(ROAD_SURFACE_PRESETS).map(preset =>
    [preset.subRoadTexture, Object.freeze([390, 1248])])),
  road_decal_skid: Object.freeze([48, 64]),
  road_dawn_glints: Object.freeze([390, 312]),
  truck_headlight_cone: Object.freeze([ENVIRONMENT_VISUALS.headlightWidth, ENVIRONMENT_VISUALS.headlightLength]),
  streetlight_pool: Object.freeze([ENVIRONMENT_VISUALS.streetlightRadius * 2, ENVIRONMENT_VISUALS.streetlightRadius * 2]),
  streetlight_pole: Object.freeze([32, 90]),
  industrial_depot: Object.freeze([300, 40]),
  depot_entrance: Object.freeze([152, 196]),
  depot_canopy_glow: Object.freeze([DEPOT_ENTRANCE_GEOMETRY.width, DEPOT_ENTRANCE_GEOMETRY.height]),
  barrier_caution_light: Object.freeze([12, 12]),
  cargo_rack: Object.freeze([32, 96]),
  garage_lock: Object.freeze([32, 36]),
  cargo_preview: Object.freeze([162, 195]),
  cargo_preview_swift: Object.freeze([162, 195]),
  ...Object.fromEntries(Object.keys(STANDARD_HAULER_TRIMS).flatMap(id => [
    [`cargo_ship_${id}`, Object.freeze([54, 65])],
    [`cargo_preview_${id}`, Object.freeze([162, 195])],
  ])),
  hauler_gold_sparkle: Object.freeze([12, 12]),
  ...Object.fromEntries([
    'hand_precision', 'cargo_light', 'def_plating',
    'coll_magnet', 'util_impact_pulse', 'def_shield', 'util_insurance',
  ].map(id => [`module_${id}`, Object.freeze([40, 40])])),
});

export const STANDARD_HAULER_ART = Object.freeze({
  name: 'Standard Hauler',
  sourceKey: 'standard_hauler_source',
  url: new URL('../assets/sprites/standard-hauler.png', import.meta.url).href,
  bounds: Object.freeze({x: 548, y: 145, width: 953, height: 1724}),
  windshield: Object.freeze({x: 790, y: 495, width: 470, height: 125}),
  exhaustStack: Object.freeze({x: 1245, y: 974}),
});

export const SWIFT_RUNNER_ART = Object.freeze({
  name: 'Swift Runner',
  sourceKey: 'swift_runner_source',
  url: new URL('../assets/sprites/swift-runner.png', import.meta.url).href,
  bounds: Object.freeze({x: 555, y: 85, width: 938, height: 1845}),
  exhaustStack: Object.freeze({x: 1350, y: 885}),
});
const SWIFT_RUNNER_FRAMES = Object.freeze(['cargo_ship_swift', 'cargo_preview_swift']);

export const GARAGE_DISPLAY_ART = Object.freeze([
  Object.freeze({id: 'standard', key: 'garage_standard_display',
    url: new URL('../assets/sprites/standard-hauler-display.png', import.meta.url).href}),
  Object.freeze({id: 'swift', key: 'garage_swift_display',
    url: new URL('../assets/sprites/swift-runner-display.png', import.meta.url).href}),
]);

export function preloadGarageDisplayArt(scene) {
  for (const art of GARAGE_DISPLAY_ART) {
    if (!scene.textures.exists(art.key)) scene.load.image(art.key, art.url);
  }
}

export const GARAGE_UPGRADE_ART = Object.freeze([
  Object.freeze({id: 'cargo_expanded', key: 'garage_upgrade_cargo',
    url: new URL('../assets/sprites/cargo-capacity-upgrade.png', import.meta.url).href}),
  Object.freeze({id: 'hand_precision', key: 'garage_upgrade_steering',
    url: new URL('../assets/sprites/precision-steering-upgrade.png', import.meta.url).href}),
  Object.freeze({id: 'coll_magnet', key: 'garage_upgrade_magnet',
    url: new URL('../assets/sprites/magnetic-collector-upgrade.png', import.meta.url).href}),
  Object.freeze({id: 'cargo_light', key: 'garage_upgrade_rack',
    url: new URL('../assets/sprites/lightweight-rack-upgrade.png', import.meta.url).href}),
  Object.freeze({id: 'def_plating', key: 'garage_upgrade_plating',
    url: new URL('../assets/sprites/reinforced-plating-upgrade.png', import.meta.url).href}),
  Object.freeze({id: 'util_insurance', key: 'garage_upgrade_insurance',
    url: new URL('../assets/sprites/cargo-insurance-upgrade.png', import.meta.url).href}),
  Object.freeze({id: 'util_impact_pulse', key: 'garage_upgrade_pulse',
    url: new URL('../assets/sprites/impact-pulse-upgrade.png', import.meta.url).href}),
  Object.freeze({id: 'def_shield', key: 'garage_upgrade_shield',
    url: new URL('../assets/sprites/depot-shield-upgrade.png', import.meta.url).href}),
]);

export function preloadGarageUpgradeArt(scene) {
  for (const art of GARAGE_UPGRADE_ART) {
    if (!scene.textures.exists(art.key)) scene.load.image(art.key, art.url);
  }
}

export const COLLECTIBLE_ART = Object.freeze([
  {id: 'blueprint', key: 'cargo_blueprint',
    url: new URL('../assets/sprites/blueprint.png', import.meta.url).href,
    bounds: {x: 234, y: 236, width: 1476, height: 1925}, rotation: -Math.PI / 2},
  {id: 'trailer', key: 'cargo_trailer',
    url: new URL('../assets/sprites/cargo-trailer.png', import.meta.url).href,
    bounds: {x: 252, y: 99, width: 1288, height: 2202}, rotation: 0},
  {id: 'pickup_small', key: 'cargo_pickup_small',
    url: new URL('../assets/sprites/cargo-pickup-small.png', import.meta.url).href,
    bounds: {x: 0, y: 0, width: 229, height: 256}, rotation: 0},
  {id: 'pickup_med', key: 'cargo_pickup_med',
    url: new URL('../assets/sprites/cargo-pickup-med.png', import.meta.url).href,
    bounds: {x: 0, y: 0, width: 229, height: 245}, rotation: 0},
  {id: 'pickup_lg', key: 'cargo_pickup_lg',
    url: new URL('../assets/sprites/cargo-pickup-lg.png', import.meta.url).href,
    bounds: {x: 0, y: 0, width: 214, height: 248}, rotation: 0},
  {id: 'pickup_xl', key: 'cargo_pickup_xl',
    url: new URL('../assets/sprites/cargo-pickup-xl.png', import.meta.url).href,
    bounds: {x: 0, y: 0, width: 242, height: 269}, rotation: 0},
].map(art => Object.freeze({...art, bounds: Object.freeze(art.bounds),
  sourceKey: `collectible_source_${art.id}`})));

// Road cargo art follows payout size, not pickup kind: 5 Small, 10 Med, 20 Lg, larger XL.
export function cargoPickupTexture(value) {
  if (value <= 5) return 'cargo_pickup_small';
  if (value <= 10) return 'cargo_pickup_med';
  if (value <= 20) return 'cargo_pickup_lg';
  return 'cargo_pickup_xl';
}

export function cargoPickupGlowTexture(value) {
  return cargoPickupTexture(value) === 'cargo_pickup_xl'
    ? 'cargo_pickup_glow_gold' : 'cargo_pickup_glow_blue';
}

export const CARGO_PICKUP_GLOW_OFFSET_Y = 8;

export function preloadCollectibleArt(scene) {
  for (const art of COLLECTIBLE_ART) {
    if (!scene.textures.exists(art.key) && !scene.textures.exists(art.sourceKey)) {
      scene.load.image(art.sourceKey, art.url);
    }
  }
}

export const DEPOT_ART = Object.freeze({
  id: 'depot', key: 'depot_entrance', sourceKey: 'depot_source',
  url: new URL('../assets/sprites/depot.png', import.meta.url).href,
  bounds: Object.freeze({x: 41, y: 61, width: 815, height: 1060}),
  bay: Object.freeze({roadX: 62, centerY: 596.5}),
  rotation: 0,
});

export function preloadDepotArt(scene) {
  if (!scene.textures.exists(DEPOT_ART.key) && !scene.textures.exists(DEPOT_ART.sourceKey)) {
    scene.load.image(DEPOT_ART.sourceKey, DEPOT_ART.url);
  }
}

function standaloneArtScale(art) {
  const [width, height] = TEXTURE_SIZES[art.key];
  return art.rotation
    ? Math.min((width - 4) / art.bounds.height, (height - 4) / art.bounds.width)
    : Math.min((width - 2) / art.bounds.width, (height - 2) / art.bounds.height);
}

function createStandaloneTextures(scene) {
  for (const art of [...COLLECTIBLE_ART, DEPOT_ART]) {
    if (scene.textures.exists(art.key)) continue;
    const image = scene.textures.get(art.sourceKey).getSourceImage();
    const [width, height] = TEXTURE_SIZES[art.key];
    const {bounds} = art;
    const scale = standaloneArtScale(art);
    const texture = scene.textures.createCanvas(art.key, width, height);
    const context = texture.getContext();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.translate(width / 2, height / 2);
    context.rotate(art.rotation);
    context.drawImage(image, -(bounds.x + bounds.width / 2) * scale,
      -(bounds.y + bounds.height / 2) * scale, image.width * scale, image.height * scale);
    if (art.id === 'pickup_lg') {
      const pixels = context.getImageData(0, 0, width, height);
      recolorLargeCargoPickup(pixels.data);
      context.putImageData(pixels, 0, 0);
    }
    texture.refresh();
    scene.textures.remove(art.sourceKey);
  }
}

export function recolorLargeCargoPickup(pixels) {
  for (let index = 0; index < pixels.length; index += 4) {
    const [red, green, blue, alpha] = pixels.subarray(index, index + 4);
    if (!alpha || green - red <= 12 || blue - red <= 12) continue;
    pixels[index] = Math.max(green, blue);
    pixels[index + 1] = red + (green - red) * 0.46;
    pixels[index + 2] = red + (blue - red) * 0.08;
  }
}

export function preloadStandardHauler(scene) {
  if (standardHaulerFrames().some(key => !scene.textures.exists(key)) &&
      !scene.textures.exists(STANDARD_HAULER_ART.sourceKey)) {
    scene.load.image(STANDARD_HAULER_ART.sourceKey, STANDARD_HAULER_ART.url);
  }
}

export function preloadSwiftRunner(scene) {
  if (SWIFT_RUNNER_FRAMES.some(key => !scene.textures.exists(key)) &&
      !scene.textures.exists(SWIFT_RUNNER_ART.sourceKey)) {
    scene.load.image(SWIFT_RUNNER_ART.sourceKey, SWIFT_RUNNER_ART.url);
  }
}

function standardHaulerFrames() {
  return ['cargo_ship', 'cargo_preview', ...Object.keys(STANDARD_HAULER_TRIMS)
    .flatMap(id => [`cargo_ship_${id}`, `cargo_preview_${id}`])];
}

function vehicleArtPlacement(art = STANDARD_HAULER_ART) {
  const {bounds} = art;
  const [width, height] = TEXTURE_SIZES.cargo_ship;
  const scale = Math.min((width - 2) / bounds.width, (height - 2) / bounds.height);
  return {
    scale,
    x: (width - bounds.width * scale) / 2 - bounds.x * scale,
    y: (height - bounds.height * scale) / 2 - bounds.y * scale,
  };
}

function createVehicleTextures(scene, art, keys) {
  if (keys.every(key => scene.textures.exists(key))) return;
  if (!scene.textures.exists(art.sourceKey)) {
    throw new Error(`Approved ${art.name} sprite failed to load; cannot create vehicle artwork.`);
  }
  const image = scene.textures.get(art.sourceKey).getSourceImage();
  const placement = vehicleArtPlacement(art);
  for (const key of keys) {
    if (scene.textures.exists(key)) continue;
    const [width, height] = TEXTURE_SIZES[key];
    const resolution = width / TEXTURE_SIZES.cargo_ship[0];
    const texture = scene.textures.createCanvas(key, width, height);
    const context = texture.getContext();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, placement.x * resolution, placement.y * resolution,
      image.width * placement.scale * resolution, image.height * placement.scale * resolution);
    const trimId = art === STANDARD_HAULER_ART &&
      Object.keys(STANDARD_HAULER_TRIMS).find(id => key.endsWith(`_${id}`));
    if (trimId) {
      const pixels = context.getImageData(0, 0, width, height);
      recolorStandardHauler(pixels.data, width, trimId);
      context.putImageData(pixels, 0, 0);
    }
    texture.refresh();
  }
  scene.textures.remove(art.sourceKey);
}

export function recolorStandardHauler(pixels, width, trimId) {
  const trim = STANDARD_HAULER_TRIMS[trimId];
  if (!trim) throw new Error(`Unknown Standard Hauler paint: ${trimId}`);
  const placement = vehicleArtPlacement();
  const resolution = width / TEXTURE_SIZES.cargo_ship[0];
  for (let index = 0; index < pixels.length; index += 4) {
    if (!pixels[index + 3]) continue;
    const r = pixels[index], g = pixels[index + 1], b = pixels[index + 2];
    const high = Math.max(r, g, b), low = Math.min(r, g, b);
    const x = ((index / 4 % width + 0.5) / resolution - placement.x) / placement.scale;
    const y = ((Math.floor(index / 4 / width) + 0.5) / resolution - placement.y) / placement.scale;
    // Keep the windshield, cyan lamps, dark outlines and mechanical recesses unpainted.
    const glass = STANDARD_HAULER_ART.windshield;
    const canopy = x > glass.x && x < glass.x + glass.width && y > glass.y && y < glass.y + glass.height;
    const rails = r > g * 1.12 && g > b * 1.25 && high - low > 35;
    const body = !canopy && high > 36 && high - low < high * 0.24;
    if (!rails && !body) continue;
    const color = rails ? trim.rails : trim.body;
    const shade = rails ? high / 235 : Math.min(1, (high + 100) / 230);
    const blend = rails ? 1 : Math.min(1, (high - 36) / 20);
    for (let channel = 0; channel < 3; channel++) {
      const target = Math.min(255, ((color >> (16 - channel * 8)) & 255) * shade);
      pixels[index + channel] = Math.round(pixels[index + channel] * (1 - blend) + target * blend);
    }
  }
}

export const OBSTACLE_ART = Object.freeze([
  {id: 'fan', url: new URL('../assets/sprites/obstacle-fan.png', import.meta.url).href,
    textures: ['hazard_roadsideMachine']},
  {id: 'grille', url: new URL('../assets/sprites/obstacle-grille.png', import.meta.url).href,
    textures: ['hazard_roadsideMachine']},
  {id: 'pipes1', url: new URL('../assets/sprites/obstacle-pipes-1.png', import.meta.url).href,
    textures: ['hazard_pipeAssembly']},
  {id: 'pipes2', url: new URL('../assets/sprites/obstacle-pipes-2.png', import.meta.url).href,
    textures: ['hazard_pipeAssembly']},
  {id: 'barrier', url: new URL('../assets/sprites/barrier.png', import.meta.url).href,
    textures: ['cargo_hazard', 'hazard_divider',
      ...Object.keys(SECTOR_MATERIALS).filter(id => id !== 'industrial').map(id => `divider_${id}`)],
    kind: 'barrier',
    bounds: {x: 0, y: 0, width: 1650, height: 652}},
  {id: 'rockSlab', url: new URL('../assets/sprites/rock-slab.png', import.meta.url).href,
    textures: ['hazard_rockSlab'], kind: 'rockSlab',
    bounds: {x: 204, y: 201, width: 1413, height: 2037}, rotation: Math.PI / 2},
  {id: 'signalCabinet', url: new URL('../assets/sprites/signal-cabinet.png', import.meta.url).href,
    textures: ['hazard_signalCabinet'], kind: 'signalCabinet',
    bounds: {x: 156, y: 154, width: 1484, height: 2091}},
  {id: 'sweeper', url: new URL('../assets/sprites/sweeper-forklift.png', import.meta.url).href,
    textures: ['hazard_forklift'], kind: 'sweeper',
    bounds: {x: 0, y: 0, width: 1676, height: 839}},
  {id: 'serviceBoom', url: new URL('../assets/sprites/service-boom.png', import.meta.url).href,
    textures: ['hazard_serviceBoom'], kind: 'serviceBoom',
    bounds: {x: 329, y: 125, width: 1136, height: 2136}, rotation: Math.PI / 2},
].map(art => Object.freeze({...art, sourceKey: `obstacle_source_${art.id}`,
  ...(art.bounds ? {bounds: Object.freeze(art.bounds)} : {}),
  textures: Object.freeze(art.textures)})));

export const GUARDRAIL_ART = Object.freeze([
  {part: 'entry', url: new URL('../assets/sprites/chicane-entry.png', import.meta.url).href},
  {part: 'mid', url: new URL('../assets/sprites/chicane-mid.png', import.meta.url).href},
  {part: 'exit', url: new URL('../assets/sprites/chicane-exit.png', import.meta.url).href},
].map(art => Object.freeze({...art, key: `chicane_${art.part}`})));

export function preloadObstacleArt(scene) {
  for (const art of OBSTACLE_ART) {
    if (art.textures.some(key => !scene.textures.exists(key)) && !scene.textures.exists(art.sourceKey)) {
      scene.load.image(art.sourceKey, art.url);
    }
  }
  for (const art of GUARDRAIL_ART) {
    if (!scene.textures.exists(art.key)) scene.load.image(art.key, art.url);
  }
}

function drawObstacleArt(scene, key) {
  const sources = OBSTACLE_ART.filter(art => art.textures.includes(key));
  if (!sources.length) return;
  if (sources.some(art => !scene.textures.exists(art.sourceKey))) {
    obstacleTexture(scene, key);
    return;
  }
  const texture = scene.textures.createCanvas(key, ...TEXTURE_SIZES[key]);
  const context = texture.getContext();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  const draw = (art, x, y, width, height, rotation = 0) => {
    const image = scene.textures.get(art.sourceKey).getSourceImage();
    const bounds = art.bounds ?? {x: 0, y: 0, width: image.width, height: image.height};
    const scale = rotation
      ? Math.min(width / bounds.height, height / bounds.width)
      : Math.min(width / bounds.width, height / bounds.height);
    context.save();
    context.translate(x + width / 2, y + height / 2);
    context.rotate(rotation);
    context.drawImage(image, -(bounds.x + bounds.width / 2) * scale,
      -(bounds.y + bounds.height / 2) * scale,
      image.width * scale, image.height * scale);
    context.restore();
  };
  if (sources[0].kind) {
    const kind = sources[0].id === 'barrier' && key !== 'cargo_hazard' ? 'divider' : sources[0].kind;
    const {width, height, footprint, scenery} = HAZARDS[kind];
    const body = footprint?.[0];
    const centerX = scenery?.anchorX ?? width / 2;
    const centerY = (scenery?.height ?? height) / 2;
    draw(sources[0], body ? centerX + body.x - body.halfWidth : 1,
      body ? centerY + body.y - body.halfHeight : 1,
      body ? body.halfWidth * 2 : width - 2,
      body ? body.halfHeight * 2 : height - 2, sources[0].rotation);
  } else {
    const kind = key === 'hazard_pipeAssembly' ? 'pipeAssembly' : 'roadsideMachine';
    const {width, height, scenery} = HAZARDS[kind];
    const left = scenery.anchorX - width / 2;
    const top = (scenery.height - height) / 2;
    const parts = kind === 'pipeAssembly' ? sources : [sources[0], sources[1], sources[0]];
    const partWidth = (width - 4) / parts.length;
    for (const [index, art] of parts.entries()) {
      draw(art, left + 2 + index * partWidth, top + 2, partWidth, height - 4,
        kind === 'pipeAssembly' ? Math.PI / 2 : 0);
    }
  }
  texture.refresh();
}

export const MODULE_CAPTIONS = Object.freeze({
  hand_precision: 'Turn faster, even with a full load.',
  cargo_light: 'Cargo slows your steering less.',
  def_plating: 'Take more hits before your truck breaks.',
  coll_magnet: 'Pull nearby cargo toward your truck.',
  util_impact_pulse: 'After a damaging hit, clear road obstacles on screen and stay safe a little longer.',
  def_shield: 'Each charge blocks one hit. Stop at a Depot to refill. Driving past does not refill it.',
  util_insurance: 'Lose less cargo value when hit. Dropped cargo is not protected.',
});

export function garageUpgradeBenefit(stat, value) {
  const text = formatStat(stat, value);
  switch (stat) {
    case 'hull': return text.replace('hull', 'health');
    case 'loadRelief': return `${Math.round(value * 100)}% less cargo slowdown`;
    case 'magnet': return text.replace('Collection range:', 'Cargo reach:');
    case 'impactPulseSeconds': return text.replace('obstacle-clear immunity', 'safety after a hit');
    case 'shieldCapacity': return `${value} shield ${value === 1 ? 'charge' : 'charges'}`;
    case 'insurance': return text.replace('less percentage hit loss', 'less cargo value lost');
    default: return text;
  }
}

function drawModuleIcon(g, id) {
  const p = PALETTE;
  if (id === 'hand_precision') {
    g.fillStyle(p.cyan).fillRect(17, 9, 6, 22).fillRect(9, 17, 22, 6);
    polygon(g, p.cyanLight, [[20, 3], [13, 11], [27, 11]]);
    polygon(g, p.cyanLight, [[3, 20], [11, 13], [11, 27]]);
    polygon(g, p.cyanLight, [[37, 20], [29, 13], [29, 27]]);
    polygon(g, p.cyanLight, [[20, 37], [13, 29], [27, 29]]);
  } else if (id === 'cargo_light') {
    g.fillStyle(p.steelLight).fillRect(6, 6, 4, 28).fillRect(30, 6, 4, 28)
      .fillRect(6, 6, 28, 4).fillRect(6, 30, 28, 4);
    g.lineStyle(2, p.cyan).lineBetween(10, 10, 30, 30).lineBetween(30, 10, 10, 30);
  } else if (id === 'def_plating') {
    plate(g, 5, 5, 30, 30, p.steelLight, 7);
    plate(g, 10, 10, 20, 20, p.steel, 4);
    g.fillStyle(p.cyan).fillRect(13, 18, 14, 4);
  } else if (id === 'coll_magnet') {
    plate(g, 7, 5, 26, 30, p.cyan, 6);
    g.fillStyle(p.background).fillRect(15, 3, 10, 21);
    g.fillStyle(p.steelLight).fillRect(7, 5, 8, 8).fillRect(25, 5, 8, 8);
  } else if (id === 'util_impact_pulse') {
    g.lineStyle(3, p.cyanLight).strokeCircle(20, 20, 15).strokeCircle(20, 20, 8);
    polygon(g, p.hazardLight, [[20, 2], [24, 16], [38, 20], [24, 24], [20, 38], [16, 24], [2, 20], [16, 16]]);
    g.fillStyle(p.background).fillCircle(20, 20, 5);
  } else if (id === 'def_shield') {
    polygon(g, p.cyan, [[20, 3], [34, 9], [32, 25], [20, 37], [8, 25], [6, 9]]);
    polygon(g, p.cockpit, [[20, 8], [29, 12], [27, 23], [20, 30], [13, 23], [11, 12]]);
    g.fillStyle(p.cyanLight).fillRect(18, 12, 4, 12);
  } else if (id === 'util_insurance') {
    crate(g, 4, 9, 25, 24);
    polygon(g, p.cyan, [[28, 15], [37, 19], [35, 30], [28, 37], [21, 30], [19, 19]]);
    g.lineStyle(2, p.edge).lineBetween(24, 25, 27, 29).lineBetween(27, 29, 33, 22);
  }
}

function polygon(g, color, points) {
  g.fillStyle(color, 1);
  g.fillPoints(points.map(([x, y]) => ({x, y})), true);
}

function plate(g, x, y, width, height, color, cut = 3) {
  polygon(g, color, [
    [x + cut, y], [x + width - cut, y], [x + width, y + cut],
    [x + width, y + height - cut], [x + width - cut, y + height],
    [x + cut, y + height], [x, y + height - cut], [x, y + cut],
  ]);
}

function crate(g, x, y, width, height) {
  plate(g, x, y, width, height, PALETTE.edge, 2);
  plate(g, x + 2, y + 2, width - 4, height - 4, PALETTE.goldDark, 1);
  g.fillStyle(PALETTE.gold).fillRect(x + 3, y + 3, width - 6, height - 7);
  g.fillStyle(PALETTE.goldLight).fillRect(x + 3, y + 3, width - 6, 2);
  g.fillStyle(PALETTE.goldDark).fillRect(x + width / 2 - 1, y + 5, 2, height - 9);
  for (const cornerX of [x + 1, x + width - 4]) {
    g.fillStyle(PALETTE.steelDark).fillRect(cornerX, y + 3, 3, 3).fillRect(cornerX, y + height - 6, 3, 3);
  }
}

function drawCargoCapacityCrate(g) {
  const x = 2;
  const y = 2;
  const width = 28;
  const height = 26;
  plate(g, x, y, width, height, PALETTE.edge, 4);
  plate(g, x + 2, y + 2, width - 4, height - 4, PALETTE.steelDark, 3);
  plate(g, x + 4, y + 4, width - 8, height - 8, PALETTE.goldDark, 2);
  g.fillStyle(PALETTE.gold).fillRect(x + 6, y + 6, width - 12, height - 12);
  g.fillStyle(PALETTE.goldLight).fillRect(x + 6, y + 6, width - 12, 2);
  g.fillStyle(PALETTE.goldDark).fillRect(x + 13, y + 8, 2, height - 16);
  g.fillStyle(PALETTE.steel).fillRect(x + 3, y + 9, 3, height - 18)
    .fillRect(x + width - 6, y + 9, 3, height - 18);
  g.fillStyle(PALETTE.steelDark).fillRect(x + 12, y + height - 9, 8, 5);
  g.fillStyle(PALETTE.cyan).fillRect(x + 15, y + height - 8, 2, 2);
  for (const [boltX, boltY] of [
    [x + 4, y + 4], [x + width - 4, y + 4],
    [x + 4, y + height - 4], [x + width - 4, y + height - 4],
  ]) {
    g.fillStyle(PALETTE.steelLight).fillCircle(boltX, boltY, 1);
  }
}

function drawPickupGlow(g, color) {
  for (let radius = 31; radius >= 7; radius -= 4) {
    g.fillStyle(color, 0.12).fillEllipse(32, 34, radius * 2, radius * 1.3);
  }
}

function drawCoin(g) {
  g.fillStyle(PALETTE.edge).fillCircle(21, 23, 18);
  g.fillStyle(PALETTE.goldDark).fillCircle(21, 21, 17);
  g.fillStyle(PALETTE.gold).fillCircle(21, 20, 15);
  g.lineStyle(2, PALETTE.goldLight).strokeCircle(21, 20, 13);
  g.lineStyle(2, PALETTE.goldDark).strokeCircle(21, 20, 9);
  g.fillStyle(PALETTE.goldLight).fillRect(19, 14, 4, 12);
}

function drawCoinStack(g) {
  for (const y of [32, 25, 18]) {
    g.fillStyle(PALETTE.edge).fillEllipse(21, y + 2, 36, 13);
    g.fillStyle(PALETTE.goldDark).fillEllipse(21, y, 34, 13);
    g.fillStyle(PALETTE.gold).fillEllipse(21, y - 3, 34, 12);
    g.lineStyle(2, PALETTE.goldLight).strokeEllipse(21, y - 3, 31, 10);
  }
  g.lineStyle(2, PALETTE.goldDark).strokeEllipse(21, 15, 21, 6);
}

function drawHazardBase(g, sector = 'industrial') {
  if (sector !== 'industrial') {
    drawSectorRoadside(g, 1, 1, sector, 0);
    g.fillStyle(PALETTE.edge).fillRect(28, 24, 15, 68);
    g.fillStyle(SECTOR_MATERIALS[sector].accent).fillRect(31, 28, 12, 6).fillRect(31, 82, 12, 6);
    return;
  }
  roadsideDetail(g, {x: 1, y: 1, width: 32, height: 114, kind: 'loading'});
  plate(g, 4, 15, 29, 86, PALETTE.edge, 3);
  g.fillStyle(PALETTE.steelDark).fillRect(6, 17, 25, 82);
  for (const y of [23, 85]) {
    g.fillStyle(PALETTE.edge).fillRect(12, y, 31, 9);
    g.fillStyle(PALETTE.steel).fillRect(14, y + 2, 29, 5);
    g.fillStyle(PALETTE.steelLight).fillRect(22, y + 2, 3, 5);
  }
  g.fillStyle(PALETTE.steel).fillRect(29, 31, 14, 54);
  g.fillStyle(PALETTE.edge).fillRect(31, 34, 12, 48);
  g.fillStyle(PALETTE.safetyYellow).fillRect(34, 39, 4, 7).fillRect(34, 70, 4, 7);
}

export const ROADSIDE_KINDS = ENVIRONMENTS.industrial.roadsideIdentity;
export const ROADSIDE_LAYOUT = Object.freeze([
  [1, 12, 'vent'], [3, 166, 'pipes'], [0, 340, 'loading'], [2, 544, 'utility'],
  [1, 702, 'pipes'], [0, 868, 'vent'], [2, 1044, 'loading'],
  [355, 38, 'utility'], [357, 214, 'loading'], [355, 422, 'vent'],
  [356, 582, 'pipes'], [355, 766, 'utility'], [357, 932, 'loading'], [355, 1120, 'vent'],
].map(([x, y, kind]) => Object.freeze({x, y, kind, width: 32, height: 108})));

export const ROADSIDE_INFILL_LAYOUT = Object.freeze([
  [12, 136, 'vent'], [20, 294, 'utility'], [8, 450, 'loading'],
  [365, 160, 'pipes'], [373, 1090, 'vent'],
].map(([x, y, kind]) => Object.freeze({x, y, kind, width: 8, height: 27})));

function roadsideDetail(g, {x, y, width, height, kind}) {
  plate(g, x, y, width, height, PALETTE.edge, 4);
  plate(g, x + 2, y + 2, width - 4, height - 4, PALETTE.steelDark, 3);
  g.fillStyle(PALETTE.steel).fillRect(x + 5, y + 4, width - 10, 2);
  if (kind === 'vent') {
    for (let i = 0; i < 8; i++) g.fillStyle(PALETTE.edge).fillRect(x + 6, y + 14 + i * 9, 20, 4);
  } else if (kind === 'pipes') {
    for (const dx of [8, 21]) {
      g.fillStyle(PALETTE.edge).fillRect(x + dx - 2, y + 9, 7, 90);
      g.fillStyle(PALETTE.steel).fillRect(x + dx, y + 9, 2, 90);
      for (const dy of [25, 74]) g.fillStyle(PALETTE.steelDark).fillRect(x + dx - 3, y + dy, 9, 5);
    }
  } else if (kind === 'utility') {
    plate(g, x + 5, y + 15, 22, 54, PALETTE.background, 2);
    g.fillStyle(PALETTE.steel).fillRect(x + 9, y + 23, 14, 2).fillRect(x + 9, y + 30, 14, 2);
    g.fillStyle(PALETTE.lane).fillRect(x + 22, y + 46, 2, 8);
  } else {
    for (let i = 0; i < 6; i++) g.fillStyle(PALETTE.background).fillRect(x + 5, y + 14 + i * 11, 22, 8);
    g.fillStyle(PALETTE.steel).fillRect(x + 5, y + 84, 22, 3);
    g.fillStyle(PALETTE.warning).fillRect(x + 7, y + 93, 3, 6).fillRect(x + 22, y + 93, 3, 6);
  }
}

function drawRoadsideInfill(g) {
  for (const detail of ROADSIDE_INFILL_LAYOUT) {
    g.save();
    g.translateCanvas(detail.x, detail.y);
    g.scaleCanvas(0.25, 0.25);
    roadsideDetail(g, {x: 0, y: 0, width: 32, height: 108, kind: detail.kind});
    g.restore();
  }
}

function drawIndustrialFan(g, x, y, radius) {
  const p = PALETTE;
  g.fillStyle(p.edge).fillCircle(x, y, radius);
  g.lineStyle(1, p.steel).strokeCircle(x, y, radius - 1);
  g.fillStyle(p.steelDark).fillCircle(x, y, radius - 3);
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    polygon(g, p.steel, [
      [x + dx * 2, y + dy * 2],
      [x + dx * (radius - 3) - dy * 3, y + dy * (radius - 3) + dx * 3],
      [x + dx * 3 - dy * 5, y + dy * 3 + dx * 5],
    ]);
  }
  g.fillStyle(p.edge).fillCircle(x, y, 3);
  g.fillStyle(p.steelLight).fillCircle(x - 0.5, y - 0.5, 1);
  g.lineStyle(1, p.edge, 0.65)
    .lineBetween(x - radius + 2, y - 3, x + radius - 2, y - 3)
    .lineBetween(x - radius + 2, y + 3, x + radius - 2, y + 3);
}

function drawIndustrialRoadside(g, detail) {
  const p = PALETTE;
  const {x, y, kind} = detail;
  roadsideDetail(g, detail);
  g.lineStyle(1, p.steelLight, 0.45)
    .lineBetween(x + 4, y + 3, x + 27, y + 3)
    .lineBetween(x + 3, y + 6, x + 3, y + 99);
  g.fillStyle(p.edge).fillRect(x + 28, y + 9, 2, 88);
  for (const dx of [5, 26]) for (const dy of [9, 99]) {
    g.fillStyle(p.edge).fillCircle(x + dx, y + dy, 1.5);
    g.fillStyle(p.steelLight, 0.6).fillRect(x + dx - 0.5, y + dy - 1, 1, 1);
  }
  if (kind === 'vent') {
    g.fillStyle(p.background).fillRect(x + 5, y + 13, 22, 79);
    drawIndustrialFan(g, x + 16, y + 29, 11);
    drawIndustrialFan(g, x + 16, y + 66, 11);
    for (let dy = 83; dy < 94; dy += 4) {
      g.fillStyle(p.steel).fillRect(x + 7, y + dy, 18, 1);
    }
    g.fillStyle(p.warning).fillRect(x + 8, y + 46, 16, 3);
  } else if (kind === 'pipes') {
    for (const dx of [8, 21]) {
      g.fillStyle(p.steel).fillRect(x + dx - 1, y + 11, 5, 84);
      g.fillStyle(p.steelLight, 0.7).fillRect(x + dx, y + 11, 1, 84);
      for (const dy of [23, 71]) {
        g.fillStyle(p.edge).fillRect(x + dx - 3, y + dy, 9, 5);
        g.fillStyle(p.steel).fillRect(x + dx - 2, y + dy, 7, 1);
      }
    }
    plate(g, x + 9, y + 46, 14, 14, p.edge, 2);
    g.lineStyle(2, p.warning).strokeCircle(x + 16, y + 53, 4);
    g.lineStyle(1, p.steelLight).lineBetween(x + 12, y + 53, x + 20, y + 53);
  } else if (kind === 'utility') {
    g.fillStyle(p.steel).fillRect(x + 7, y + 17, 18, 20);
    g.fillStyle(p.edge).fillRect(x + 9, y + 19, 14, 14);
    g.fillStyle(p.cockpit).fillRect(x + 11, y + 22, 10, 7);
    g.fillStyle(p.cyanLight, 0.6).fillRect(x + 11, y + 22, 5, 1);
    g.fillStyle(p.warning).fillRect(x + 9, y + 41, 5, 2);
    for (let dy = 53; dy < 68; dy += 4) {
      g.fillStyle(p.steel).fillRect(x + 9, y + dy, 11, 1);
    }
    drawIndustrialFan(g, x + 16, y + 85, 9);
  } else {
    for (let dy = 17; dy < 78; dy += 11) {
      g.fillStyle(p.steel).fillRect(x + 6, y + dy, 20, 2);
      g.fillStyle(p.edge).fillRect(x + 6, y + dy + 3, 20, 4);
    }
    g.fillStyle(p.edge).fillRect(x + 5, y + 83, 22, 8);
    for (let dx = 6; dx < 24; dx += 6) {
      polygon(g, p.warning, [[x + dx, y + 84], [x + dx + 4, y + 84],
        [x + dx + 1, y + 90], [x + dx - 3, y + 90]]);
    }
  }
}

function drawIndustrialServiceGap(g, x, top, bottom) {
  if (bottom - top < 24) return;
  const p = PALETTE;
  const mid = (top + bottom) / 2;
  const points = [[x + 9, top + 5], [x + 9, mid - 6], [x + 23, mid + 6], [x + 23, bottom - 5]];
  for (const [width, color] of [[7, p.edge], [4, p.steel], [1, p.steelLight]]) {
    g.lineStyle(width, color, width === 1 ? 0.6 : 1);
    for (let i = 1; i < points.length; i++) {
      g.lineBetween(...points[i - 1], ...points[i]);
    }
  }
  plate(g, x + 7, mid - 8, 18, 16, p.edge, 3);
  plate(g, x + 9, mid - 6, 14, 12, p.warning, 2);
  g.fillStyle(p.steelDark).fillRect(x + 12, mid - 4, 8, 8);
  g.fillStyle(p.steelLight, 0.6).fillRect(x + 12, mid - 4, 8, 1);
  g.fillStyle(p.edge).fillCircle(x + 11, mid, 1).fillCircle(x + 21, mid, 1);
}

function drawRoad(g) {
  const p = PALETTE;
  const height = TEXTURE_SIZES.industrial_road[1];
  g.fillStyle(p.background).fillRect(0, 0, 390, height);
  g.fillStyle(0x2d3946).fillRect(37, 0, 316, height);
  for (const x of LANE_CENTERS) {
    g.fillStyle(0x41505e, 0.12).fillRect(x - 26, 0, 52, height);
    for (const dx of [-17, 17]) {
      g.fillStyle(p.edge, 0.09).fillRect(x + dx - 3, 0, 6, height);
    }
  }
  // Fixed arithmetic grain is baked once and never consumes gameplay randomness.
  for (let i = 0; i < 720; i++) {
    const x = 50 + (i * 97 % 289);
    const y = 4 + (i * 173 % (height - 8));
    g.fillStyle(i % 3 ? p.steelLight : p.edge, 0.045)
      .fillRect(x, y, i % 4 === 0 ? 2 : 1, 1);
  }
  for (let y = 0; y < height; y += 312) {
    g.fillStyle(p.steel, 0.035).fillRect(49, y + 1, 292, 154);
    g.lineStyle(1, p.edge, 0.42).lineBetween(49, y + 1, 341, y + 1);
    g.lineStyle(1, p.steelLight, 0.08).lineBetween(49, y + 2, 341, y + 2);
    for (const x of [57, 327]) {
      g.lineStyle(1, p.edge, 0.32)
        .lineBetween(x, y + 42, x + 3, y + 91)
        .lineBetween(x + 3, y + 91, x - 1, y + 120);
      g.lineStyle(1, p.steelLight, 0.12).lineBetween(x + 6, y + 183, x + 6, y + 250);
    }
    for (const x of [49, 329]) {
      g.fillStyle(p.edge, 0.18);
      g.fillPoints([{x, y: y + 28}, {x: x + 7, y: y + 34}, {x: x + 4, y: y + 48},
        {x: x + 11, y: y + 55}, {x: x + 6, y: y + 71}, {x, y: y + 80}], true);
    }
  }
  for (const x of [0, 353]) {
    g.fillStyle(p.edge).fillRect(x, 0, 37, height);
    g.fillStyle(p.steelDark).fillRect(x + 3, 0, 31, height);
    for (const dx of [1, 34]) {
      g.fillStyle(p.edge).fillRect(x + dx, 0, 2, height);
      g.fillStyle(p.steel, 0.5).fillRect(x + dx, 0, 1, height);
    }
    for (let y = 0; y < height; y += 78) {
      g.lineStyle(1, p.edge).lineBetween(x + 3, y, x + 33, y);
      g.fillStyle(p.steel, 0.5).fillRect(x + 4, y + 34, 28, 2);
    }
  }
  for (const x of [1, 355]) {
    const modules = ROADSIDE_LAYOUT.filter(detail => Math.abs(detail.x - x) < 4);
    let top = 0;
    for (const detail of modules) {
      drawIndustrialServiceGap(g, x, top, detail.y);
      top = detail.y + detail.height;
    }
    drawIndustrialServiceGap(g, x, top, height);
  }
  ROADSIDE_LAYOUT.forEach(detail => drawIndustrialRoadside(g, detail));
  drawRoadsideInfill(g);
  for (const x of [ROAD_LEFT, ROAD_RIGHT]) {
    g.fillStyle(p.edge).fillRect(x - 5, 0, 10, height);
    g.fillStyle(p.steelLight, 0.72).fillRect(x - 1, 0, 2, height);
    const outside = x === ROAD_LEFT ? x - 5 : x + 3;
    g.fillStyle(p.warning, 0.8).fillRect(outside, 0, 2, height);
    for (let y = 0; y < height; y += 156) {
      for (let stripe = 0; stripe < 4; stripe++) {
        const sy = y + 18 + stripe * 9;
        polygon(g, p.warning, [[x - 4, sy + 4], [x + 4, sy], [x + 4, sy + 3], [x - 4, sy + 7]]);
      }
      for (let dy = 80; dy < 118; dy += 6) {
        g.fillStyle(p.steel, 0.6).fillRect(outside - 1, y + dy, 4, 2);
      }
      g.fillStyle(p.edge).fillRect(outside - 1, y + 131, 4, 12);
      g.fillStyle(p.cockpit).fillRect(outside, y + 133, 2, 8);
      g.fillStyle(p.cyanLight, 0.6).fillRect(outside, y + 133, 1, 6);
    }
  }
}

function drawRack(g) {
  g.fillStyle(PALETTE.edge).fillRect(12, 0, 8, 96);
  g.fillStyle(PALETTE.steel).fillRect(14, 0, 4, 96);
}

function drawSubRoad(g, preset) {
  const dust = preset.blendMode === 'ADD';
  g.fillStyle(dust ? 0x000000 : 0xffffff).fillRect(0, 0, 390, 1248);
  for (let y = 0; y < 1248; y += 78) {
    for (let i = 0; i < 24; i++) {
      g.fillStyle(dust ? 0xb9a080 : 0x667078, dust ? 0.22 : 0.18)
        .fillRect((i * 71 + y) % 390, y + i * 13 % 74, dust ? 28 : 2, dust ? 3 : 18);
    }
  }
}

function drawRoadDecal(g) {
  for (const x of [12, 32]) g.fillStyle(0x050a12).fillRect(x, 0, 4, 64);
}

function drawDustlands(g) {
  const height = TEXTURE_SIZES.dustlands_road[1];
  g.fillStyle(PALETTE.sand).fillRect(0, 0, 390, height);
  g.fillStyle(PALETTE.desertRoad).fillRect(37, 0, 316, height);
  for (const x of [43, 347]) {
    g.fillStyle(PALETTE.edge).fillRect(x - 4, 0, 8, height);
    g.fillStyle(PALETTE.rockLight).fillRect(x - 1, 0, 2, height);
  }
  for (let i = 0; i < 9; i++) {
    const y = 22 + i * 136;
    for (const x of [1, 356]) {
      const offset = x === 1 ? 0 : 35;
      plate(g, x, y + offset, 32, 55, PALETTE.rock, 9);
      polygon(g, PALETTE.rockLight, [[x + 9, y + offset], [x + 25, y + offset], [x + 17, y + offset + 21]]);
      if (i % 2 === 0) {
        plate(g, x + 3, y + offset + 67, 26, 34, PALETTE.steelDark, 4);
        g.fillStyle(PALETTE.steel).fillRect(x + 7, y + offset + 72, 16, 2);
        polygon(g, PALETTE.sand, [[x, y + offset + 86], [x + 32, y + offset + 95], [x + 32, y + offset + 105], [x, y + offset + 105]]);
      }
    }
  }
  for (let y = 0; y < height; y += 156) {
    g.lineStyle(1, PALETTE.seam).lineBetween(47, y + 1, 343, y + 1);
    g.fillStyle(PALETTE.warning).fillRect(48, y + 46, 2, 14).fillRect(340, y + 96, 2, 14);
  }
}

function drawDepot(g) {
  plate(g, 0, 0, 300, 40, PALETTE.edge, 6);
  plate(g, 2, 2, 296, 35, PALETTE.steelDark, 5);
  g.fillStyle(PALETTE.depotDark).fillRect(18, 9, 264, 20);
  g.fillStyle(PALETTE.depot).fillRect(22, 11, 104, 4).fillRect(174, 11, 104, 4);
  for (const x of [8, 284]) {
    g.fillStyle(PALETTE.depot).fillRect(x, 8, 8, 23);
  }
  plate(g, 133, 3, 34, 32, PALETTE.edge, 6);
  plate(g, 139, 8, 22, 22, PALETTE.depot, 5);
  plate(g, 144, 13, 12, 12, PALETTE.depotDark, 2);
}

function drawSectorRoadside(g, x, y, sector, index) {
  const theme = sector === 'overdrive' ? (index % 2 ? 'neon' : 'reactor') : sector;
  const {body, accent} = SECTOR_MATERIALS[theme];
  if (theme === 'dustlands') {
    polygon(g, PALETTE.rock, [[x, y + 19], [x + 9, y + 2], [x + 27, y + 8],
      [x + 32, y + 46], [x + 25, y + 64], [x, y + 58]]);
    polygon(g, PALETTE.rockLight, [[x + 9, y + 2], [x + 27, y + 8], [x + 17, y + 33]]);
    plate(g, x + 2, y + 68, 29, 42, PALETTE.edge, 4);
    g.fillStyle(PALETTE.rust).fillRect(x + 5, y + 71, 23, 28);
    g.lineStyle(3, PALETTE.steel).lineBetween(x + 7, y + 78, x + 26, y + 91);
    polygon(g, PALETTE.sand, [[x + 2, y + 99], [x + 31, y + 91], [x + 31, y + 110], [x + 2, y + 110]]);
  } else if (theme === 'neon') {
    plate(g, x, y, 32, 114, PALETTE.edge, 3);
    plate(g, x + 3, y + 3, 26, 108, body, 2);
    g.fillStyle(PALETTE.steel).fillRect(x + 5, y + 8, 22, 3).fillRect(x + 5, y + 96, 22, 5);
    g.fillStyle(index % 2 ? PALETTE.magenta : accent).fillRect(x + 4, y + 14, 3, 73);
    for (let dy = 21; dy < 80; dy += 23) {
      polygon(g, accent, [[x + 12, y + dy], [x + 23, y + dy + 6], [x + 12, y + dy + 12]]);
    }
  } else {
    plate(g, x, y, 32, 114, PALETTE.edge, 7);
    for (const dy of [4, 34, 64]) {
      plate(g, x + 2, y + dy, 28, 27, PALETTE.steelDark, 4);
      g.fillStyle(PALETTE.steel).fillRect(x + 6, y + dy + 4, 20, 3);
    }
    g.fillStyle(PALETTE.edge).fillCircle(x + 16, y + 50, 11);
    g.lineStyle(3, accent).strokeCircle(x + 16, y + 50, 7);
    for (const dx of [5, 25]) g.fillStyle(accent).fillRect(x + dx, y + 77, 2, 30);
    g.fillStyle(PALETTE.safetyYellow).fillRect(x + 10, y + 7, 12, 4);
  }
}

function drawAdvancedRoad(g, sector) {
  const neon = sector === 'neon';
  const reactor = sector === 'reactor';
  const ground = neon ? PALETTE.neonGround : reactor ? PALETTE.reactorGround : PALETTE.overdriveGround;
  const road = neon ? PALETTE.neonRoad : reactor ? PALETTE.reactorRoad : PALETTE.overdriveRoad;
  const height = TEXTURE_SIZES[`${sector}_road`][1];
  g.fillStyle(ground).fillRect(0, 0, 390, height);
  g.fillStyle(road).fillRect(37, 0, 316, height);
  for (const x of [43, 347]) {
    g.fillStyle(PALETTE.edge).fillRect(x - 4, 0, 8, height);
    g.fillStyle(PALETTE.steel).fillRect(x - 1, 0, 2, height);
  }
  for (let i = 0; i < 8; i++) {
    const y = 12 + i * 156;
    for (const x of [1, 356]) {
      const offset = x === 1 ? 0 : 24;
      drawSectorRoadside(g, x, y + offset, sector, i);
    }
    g.lineStyle(1, PALETTE.seam).lineBetween(47, y + 1, 343, y + 1);
    if (!neon) {
      g.fillStyle(PALETTE.warning).fillRect(48, y + 30, 2, 14).fillRect(340, y + 90, 2, 14);
    }
  }
  drawRoadsideInfill(g);
}

function createLightTextures(scene) {
  for (const key of ['truck_headlight_cone', 'streetlight_pool']) {
    if (scene.textures.exists(key)) continue;
    const [width, height] = TEXTURE_SIZES[key];
    const texture = scene.textures.createCanvas(key, width, height);
    const context = texture.getContext();
    const pixels = context.createImageData(width, height);
    const headlight = key === 'truck_headlight_cone';
    const color = headlight ? 0xfff3cf : ENVIRONMENT_VISUALS.streetlightTint;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const intensity = headlight ? headlightFalloff(height - y - 0.5, x + 0.5 - width / 2)
        : streetlightFalloff(Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2));
      const index = (y * width + x) * 4;
      pixels.data[index] = color >> 16;
      pixels.data[index + 1] = (color >> 8) & 255;
      pixels.data[index + 2] = color & 255;
      pixels.data[index + 3] = Math.round(intensity * 255);
    }
    context.putImageData(pixels, 0, 0);
    texture.setFilter(0);
    texture.refresh();
  }
}

export function createIndustrialTextures(scene) {
  for (const art of [...COLLECTIBLE_ART, DEPOT_ART]) {
    if (!scene.textures.exists(art.key) && !scene.textures.exists(art.sourceKey)) {
      throw new Error(`Approved ${art === DEPOT_ART ? 'Depot' : 'collectible'} sprite failed to load: ${art.id}`);
    }
  }
  const barrier = OBSTACLE_ART.find(art => art.id === 'barrier');
  if (!scene.textures.exists('hazard_divider') && !scene.textures.exists(barrier.sourceKey)) {
    throw new Error('Approved standard barrier sprite failed to load; no certified obstacle fallback available');
  }
  createVehicleTextures(scene, SWIFT_RUNNER_ART, SWIFT_RUNNER_FRAMES);
  createVehicleTextures(scene, STANDARD_HAULER_ART, standardHaulerFrames());
  createStandaloneTextures(scene);
  createLightTextures(scene);
  if (!scene.textures.exists('hazard_divider')) drawObstacleArt(scene, 'hazard_divider');
  for (const key of new Set(OBSTACLE_ART.flatMap(art => art.textures))) {
    if (!scene.textures.exists(key)) drawObstacleArt(scene, key);
  }
  for (const art of GUARDRAIL_ART) obstacleTexture(scene, art.key);
  const g = scene.add.graphics();
  const drawings = {
    ...Object.fromEntries(Object.values(ROAD_SURFACE_PRESETS).map(preset =>
      [preset.subRoadTexture, graphics => drawSubRoad(graphics, preset)])),
    road_decal_skid: drawRoadDecal,
    road_dawn_glints: graphics => {
      for (let y = 40; y < 312; y += 78) {
        graphics.fillStyle(0xffe6ae, 0.07).fillRect(49, y, 292, 2);
      }
    },
    streetlight_pole: graphics => {
      graphics.fillStyle(0x080f18).fillRect(12, 12, 6, 76);
      graphics.fillStyle(0x68717b).fillRect(14, 16, 2, 68);
      graphics.fillStyle(0x282f36).fillRect(12, 8, 20, 6);
      graphics.fillStyle(0xffe090).fillRect(23, 10, 8, 3);
    },
    cargo_coin: drawCoin,
    cargo_coinStack: drawCoinStack,
    cargo_freight: graphics => {
      crate(graphics, 3, 6, 36, 30);
      graphics.fillStyle(PALETTE.steelDark).fillRect(10, 8, 4, 26).fillRect(28, 8, 4, 26);
      graphics.fillStyle(PALETTE.goldLight).fillRect(17, 13, 8, 12);
    },
    cargo_blueprint_glow: graphics => {
      for (let radius = 30; radius >= 6; radius -= 4) {
        graphics.fillStyle(PALETTE.cyan, 0.035).fillCircle(32, 32, radius);
      }
    },
    cargo_pickup_glow_blue: graphics => drawPickupGlow(graphics, 0x2f8dff),
    cargo_pickup_glow_gold: graphics => drawPickupGlow(graphics, PALETTE.gold),
    industrial_hazard_base: drawHazardBase,
    ...Object.fromEntries(Object.keys(SECTOR_MATERIALS).flatMap(id => [
      [`base_${id}`, graphics => drawHazardBase(graphics, id)],
    ])),
    cargo_stack: drawCargoCapacityCrate,
    cargo_spark: graphics => graphics.fillStyle(PALETTE.white).fillCircle(4, 4, 4),
    hauler_gold_sparkle: graphics => {
      polygon(graphics, PALETTE.goldLight, [[6, 0], [7, 4], [12, 6], [7, 7],
        [6, 12], [4, 7], [0, 6], [4, 4]]);
      graphics.fillStyle(PALETTE.white).fillRect(5, 5, 2, 2);
    },
    industrial_road: drawRoad,
    level2_road: graphics => {
      drawAdvancedRoad(graphics, 'overdrive');
      graphics.lineStyle(2, PALETTE.cyan, 0.28);
      for (const y of [180, 420, 660, 900, 1140]) graphics.lineBetween(52, y, 338, y + 26);
      graphics.fillStyle(PALETTE.cyan, 0.28)
        .fillRect(53, 112, 4, 42).fillRect(333, 890, 4, 42);
    },
    dustlands_road: drawDustlands,
    neon_road: graphics => drawAdvancedRoad(graphics, 'neon'),
    reactor_road: graphics => drawAdvancedRoad(graphics, 'reactor'),
    overdrive_road: graphics => drawAdvancedRoad(graphics, 'overdrive'),
    industrial_depot: drawDepot,
    depot_canopy_glow: graphics => {
      for (let i = 0; i < 8; i++) {
        graphics.fillStyle(PALETTE.depot, 0.035).fillEllipse(83, 90, 68 - i * 7, 136 - i * 13);
      }
    },
    barrier_caution_light: graphics => {
      for (let radius = 5; radius >= 2; radius--) {
        graphics.fillStyle(0xff9b35, 0.1).fillCircle(6, 6, radius);
      }
      graphics.fillStyle(0xffa32f).fillCircle(6, 6, 1.8);
      graphics.fillStyle(0xffdc92).fillCircle(6, 5.5, 0.8);
    },
    cargo_rack: drawRack,
    garage_lock: graphics => {
      graphics.lineStyle(4, 0xbac6d2).strokeCircle(16, 10, 8);
      graphics.fillStyle(0xbac6d2).fillRect(4, 12, 24, 23);
      graphics.fillStyle(0x0c111a).fillCircle(16, 22, 3).fillRect(14, 22, 4, 8);
    },
    ...Object.fromEntries(Object.keys(MODULE_CAPTIONS).map(id => [`module_${id}`, graphics => drawModuleIcon(graphics, id)])),
  };
  for (const [key, draw] of Object.entries(drawings)) {
    if (scene.textures.exists(key)) continue;
    draw(g);
    g.generateTexture(key, ...TEXTURE_SIZES[key]);
    g.clear();
  }
  g.destroy();
  for (const art of OBSTACLE_ART) {
    if (scene.textures.exists(art.sourceKey)) scene.textures.remove(art.sourceKey);
  }
}

export function buildIndustrialRoad(scene, {width, height, stripeGap, stripesPerColumn}) {
  const preset = ROAD_SURFACE_PRESETS.industrial;
  const subRoad = routeTile(scene, width / 2, height / 2, width + 64, height + 64,
    preset.subRoadTexture).setDepth(0.05).setBlendMode(preset.blendMode).setAlpha(preset.overlayAlpha);
  const surface = routeTile(scene, width / 2, height / 2, width, height, 'industrial_road').setDepth(-1);
  const dust = routeTile(scene, width / 2, height / 2, width, height, 'dustlands_road').setDepth(-0.5).setAlpha(0);
  const lines = [];
  for (let lane = 1; lane < LANE_CENTERS.length; lane++) {
    const x = (LANE_CENTERS[lane - 1] + LANE_CENTERS[lane]) / 2;
    for (let i = 0; i < stripesPerColumn; i++) {
      lines.push(scene.add.rectangle(x, -25 + i * stripeGap, 2, 35, PALETTE.steelLight, 0.5));
    }
  }
  return {surface, dust, lines, subRoad};
}

export function syncSectorRoad(base, incoming, distance, levelId = 'level1', mode = 'normal', subRoad = null) {
  const sectors = IMPLEMENTED_LEVELS[levelId];
  const sector = sectorAtDistance(distance, levelId, mode);
  const index = sectors.indexOf(sector);
  const alpha = mode === 'continuous' ? 1 : index === 0 ? 0 : Math.min(1, (distance - sector.startsAt) / 30);
  const previous = sectors[Math.max(0, index - 1)];
  const baseSector = alpha === 1 ? sector : previous;
  const baseKey = resolveVisualTheme(baseSector).roadTexture;
  const incomingKey = resolveVisualTheme(sector).roadTexture;
  if (base.displayTexture.key !== baseKey) base.setTexture(baseKey);
  if (incoming.displayTexture.key !== incomingKey) incoming.setTexture(incomingKey);
  incoming.tilePositionY = base.tilePositionY;
  incoming.setAlpha(alpha === 1 ? 0 : alpha);
  const baseDistance = baseSector === sector ? distance : sector.startsAt - 0.001;
  base.setTint(roadTint(baseSector, baseDistance, levelId, mode));
  incoming.setTint(roadTint(sector, distance, levelId, mode));
  if (subRoad) {
    const preset = resolveVisualTheme(sector).surfacePreset;
    const key = preset.subRoadTexture;
    if (subRoad.displayTexture.key !== key) subRoad.setTexture(key);
    subRoad.setBlendMode(preset.blendMode).setAlpha(preset.overlayAlpha);
  }
}

export function addDepotDetails(scene, x, y) {
  return scene.add.image(x, y, 'industrial_depot').setDepth(32);
}

/** Screen height of the scaled Depot art; facilities spawn and despawn one full height off-screen. */
export function depotFacilityHeight() {
  return TEXTURE_SIZES[DEPOT_ART.key][1] * SPRITE_ART_SCALE;
}

/**
 * World-space Depot: a container whose origin is the bay centre (depotWorldY), so scrolling it by
 * the road speed keeps the art aligned with the unchanged gameplay trigger.
 */
export function createDepotFacility(scene, depot, y, blendMode = 'ADD') {
  const left = depot.side === 'left';
  const {bounds, bay} = DEPOT_ART;
  const scale = standaloneArtScale(DEPOT_ART) * SPRITE_ART_SCALE;
  const edgeOffset = (bay.roadX - bounds.x - bounds.width / 2) * scale;
  const centerOffset = (bay.centerY - bounds.y - bounds.height / 2) * scale;
  const mouthRight = DEPOT_ENTRANCE_GEOMETRY.mouthLeft + DEPOT_ENTRANCE_GEOMETRY.mouthWidth;
  const leftX = mouthRight + edgeOffset;
  const body = scaleSpriteArt(routeImage(scene, left ? leftX : ROAD_LEFT + ROAD_RIGHT - leftX, -centerOffset,
    DEPOT_ART.key)).setFlipX(left);
  const glow = routeImage(scene, left ? 56 : 334, 0, 'depot_canopy_glow').setFlipX(!left).setBlendMode(blendMode);
  const container = routeContainer(scene, 0, y, [body, glow]).setDepth(3);
  return {container, body, glow, depot};
}

export function createDepotEntrance(scene) {
  return {
    // Reserve the upper notice band, away from the ship and near-field driving decisions.
    label: scene.add.text(12, 120, '', {
      fontFamily: 'Arial, sans-serif', fontSize: '18px', fontStyle: 'bold',
      color: colorText(PALETTE.white), align: 'center',
      backgroundColor: colorText(PALETTE.depotDark), padding: {x: 8, y: 6},
      fixedWidth: 190, fixedHeight: 60, lineSpacing: 3,
    }).setOrigin(0, 0).setDepth(20).setVisible(false),
  };
}

export function syncDepotEntrance(view, depot, distance, phase) {
  const visible = phase === 'running' && Number.isFinite(depot.distance) &&
    depot.distance - distance <= DEPOT_RULES.noticeMeters && distance <= depot.distance;
  view.label.setVisible(visible);
  if (!visible) return;
  const prominent = depot.distance - distance <= DEPOT_RULES.announcementMeters;
  const remaining = Math.max(0, Math.ceil(depot.distance - distance));
  const approach = Math.min(1, Math.max(0, 1 - (depot.distance - distance) / DEPOT_RULES.noticeMeters));
  const backgroundAlpha = 0.25 + approach * 0.75;
  const green = PALETTE.depotDark;
  const left = depot.side === 'left';
  view.label.setPosition(left ? 12 : 188, 120)
    .setFontSize(prominent ? 18 : 15)
    .setBackgroundColor(`rgba(${green >> 16}, ${(green >> 8) & 255}, ${green & 255}, ${backgroundAlpha})`)
    .setText(`DEPOT ${remaining} m\n${left ? '<<<' : '>>>'} DOCK`);
}

export function createBarrierLights(scene, sprite, kind, time, night = false) {
  const lights = (['forklift', 'sweeper'].includes(kind) ? [0] : [-1, 1]).map(() =>
    scaleSpriteArt(routeImage(scene, sprite.x, sprite.y, 'barrier_caution_light')).setDepth(6));
  syncBarrierLights(lights, sprite, kind, time, night);
  return lights;
}

export function syncBarrierLights(lights, sprite, kind, time, night = false) {
  const {width, height} = HAZARDS[kind];
  lights.forEach((light, index) => {
    const phase = (time + index * 500) % 1000;
    const lit = phase < 90 || (phase >= 180 && phase < 270);
    scaleSpriteArt(light, night ? ENVIRONMENT_VISUALS.barrierNightScale : 1);
    // Night strobes sit just above the ambient mask so their warning flashes aren't darkened.
    light.setDepth(night ? 16.1 : 6).setBlendMode(night ? 'ADD' : 'NORMAL')
      .setPosition(sprite.x + (['forklift', 'sweeper'].includes(kind) ? 0 : index ? 1 : -1) *
        (width / 2 - 5) * sprite.scaleX,
        sprite.y - height * 0.18 * sprite.scaleY)
      .setAlpha(lit ? 1 : night ? ENVIRONMENT_VISUALS.barrierNightIdleAlpha : 0.18);
  });
}

export function addHudBacking(scene, width) {
  return scene.add.rectangle(width / 2, 35, width, 70, 0x0c111a, 0.88);
}

/**
 * One atomic guardrail: exit cap (far end), N tiling mids, entry wedge facing oncoming traffic.
 * Tiles are drawn at exact collision geometry (no sprite-art upscale) so the lip and wall line up
 * with gameplay. Entry art has the opposite handedness from the mid and exit tiles.
 */
export function createGuardrailStructure(scene, hazard, x, y) {
  const {width, length, entry, exit, midCount, midLength, side, anchorX} = guardrailLayout(hazard);
  const tileX = side * (width / 2 - anchorX);
  const tiles = [{key: 'chicane_exit', top: -length / 2, height: exit}];
  for (let i = 0; i < midCount; i++) {
    tiles.push({key: 'chicane_mid', top: -length / 2 + exit + i * midLength, height: midLength});
  }
  tiles.push({key: 'chicane_entry', top: length / 2 - entry, height: entry});
  const image = (key, tx, ty, height) => routeImage(scene, tx, ty, obstacleTexture(scene, key))
    .setDisplaySize(width, height).setFlipX(key === 'chicane_entry' ? side > 0 : side < 0);
  // Every shadow sits beneath every tile so a cap's shadow never darkens its neighbour.
  const shadows = tiles.map(tile => image(tile.key, tileX + balance.SHADOW_OFFSET_X,
    tile.top + tile.height / 2 + balance.SHADOW_OFFSET_Y, tile.height)
    .setTint(SHADOW_TINT).setAlpha(balance.SHADOW_ALPHA));
  const parts = tiles.map(tile => image(tile.key, tileX, tile.top + tile.height / 2, tile.height));
  const container = routeContainer(scene, x, y, [...shadows, ...parts]).setDepth(5);
  container.setSize(width, length);
  container.guardrailParts = parts;
  container.guardrailBeacon = scaleSpriteArt(routeImage(scene, 0, 0, 'barrier_caution_light'));
  syncGuardrailBeacon(container, 0);
  return container;
}

export function syncGuardrailBeacon(structure, time, night = false) {
  const entry = structure.guardrailParts.at(-1);
  const phase = (time % 600) / 300;
  const alpha = 0.3 + 0.7 * (phase <= 1 ? phase : 2 - phase);
  scaleSpriteArt(structure.guardrailBeacon, night ? ENVIRONMENT_VISUALS.barrierNightScale : 1)
    .setPosition(structure.x + entry.x, structure.y + entry.y)
    .setAlpha(alpha).setBlendMode('ADD').setDepth(night ? 16.1 : 6);
}

export const SHADOW_TINT = 0x050a12;
// One stacking step beneath the caster, above every lower layer.
const SHADOW_DEPTH_BELOW = 0.05;
const TRUCK_CONTACT_SHADOW = Object.freeze({offsetX: 0, offsetY: 0, alpha: balance.TRUCK_SHADOW_ALPHA});
const TRAILER_CONTACT_SHADOW = Object.freeze({offsetX: 0,
  offsetY: balance.TRUCK_TRAILER_SHADOW_OFFSET_Y, alpha: balance.TRUCK_TRAILER_SHADOW_ALPHA});
const PARTICLE_DOT_KEY = 'particle-dot';

export function createSilhouetteShadow(scene, source) {
  return routeImage(scene, source.x ?? 0, source.y ?? 0, source.texture?.key, source.frame?.name)
    .setTint(SHADOW_TINT).setVisible(false);
}

/** Pins a silhouette shadow to its caster; the offset stays screen-down because the light is overhead. */
export function syncSilhouetteShadow(shadow, source, visible = source.visible !== false, scale = 1, {
  offsetX = balance.SHADOW_OFFSET_X, offsetY = balance.SHADOW_OFFSET_Y, alpha = balance.SHADOW_ALPHA,
} = {}) {
  const key = source.texture?.key;
  const frame = source.frame?.name;
  if (key && (shadow.texture?.key !== key || shadow.frame?.name !== frame)) shadow.setTexture(key, frame);
  return shadow.setPosition(source.x + offsetX, source.y + offsetY)
    .setOrigin(source.originX ?? 0.5, source.originY ?? 0.5)
    .setRotation(source.rotation ?? 0)
    .setFlip(Boolean(source.flipX), Boolean(source.flipY))
    .setScale(source.scaleX * scale, source.scaleY * scale)
    .setAlpha((source.alpha ?? 1) * alpha)
    .setDepth((source.depth ?? 0) - SHADOW_DEPTH_BELOW)
    .setVisible(visible);
}

function ensureParticleDotTexture(scene) {
  if (scene.textures.exists(PARTICLE_DOT_KEY)) return PARTICLE_DOT_KEY;
  const dot = scene.make.graphics({x: 0, y: 0, add: false});
  // Concentric layers fake a soft falloff inside the tiny 4x4 frame.
  [[2, 0.3], [1.5, 0.6], [0.9, 1]].forEach(([radius, alpha]) => {
    dot.fillStyle(0xffffff, alpha);
    dot.fillCircle(2, 2, radius);
  });
  dot.generateTexture(PARTICLE_DOT_KEY, 4, 4);
  dot.destroy();
  return PARTICLE_DOT_KEY;
}

function createExhaustEmitter(scene, tint = [0x34383c, 0x45494e, 0x555a60]) {
  const anchor = {x: 0, y: 0, scale: 1, scrollSpeed: 0};
  const size = (start, end) => ({
    onEmit: () => anchor.scale * start,
    onUpdate: (particle, key, t) => anchor.scale * (start + (end - start) * t),
  });
  const emitter = scene.add.particles(0, 0, PARTICLE_DOT_KEY, {
    lifespan: {min: 400, max: 650}, frequency: 70, quantity: 1, maxAliveParticles: 12,
    speedX: {min: -12, max: 12}, speedY: {onEmit: () => anchor.scrollSpeed + 40},
    scale: size(1.2, 4), alpha: {start: 0.5, end: 0},
    tint, blendMode: 'NORMAL', emitting: false,
  }).setDepth(7.6);
  emitter.startFollow(anchor);
  return {emitter, anchor};
}

function createGrindEmitter(scene) {
  const anchor = {x: 0, y: 0, side: 1};
  const emitter = scene.add.particles(0, 0, PARTICLE_DOT_KEY, {
    lifespan: {min: 100, max: 150}, frequency: 24, quantity: 2, maxAliveParticles: 28,
    speed: {min: 220, max: 340},
    angle: {onEmit: () => anchor.impactAngle === undefined
      ? (anchor.side > 0 ? 50 : 230) + Math.random() * 80
      : anchor.impactAngle - 35 + Math.random() * 70},
    scale: {start: 1, end: 0}, alpha: {start: 1, end: 0},
    tint: [0xffffff, 0xffd700, 0xff8c00], blendMode: 'ADD', emitting: false,
  }).setDepth(16.2);
  emitter.startFollow(anchor);
  return {emitter, anchor};
}

export function playImpactSparks(effects, ship, x, y) {
  const {emitter, anchor} = effects.grind;
  anchor.impactAngle = Math.atan2(ship.y - y, ship.x - x) * 180 / Math.PI;
  const contactX = ship.x + Math.max(-GAME_BALANCE.hazards.playerHalfWidthPx,
    Math.min(GAME_BALANCE.hazards.playerHalfWidthPx, x - ship.x));
  const contactY = ship.y + Math.max(-GAME_BALANCE.hazards.playerHalfHeightPx,
    Math.min(GAME_BALANCE.hazards.playerHalfHeightPx, y - ship.y));
  emitter.explode(18, contactX, contactY);
  delete anchor.impactAngle;
}

/** `scrape` is a flank contact from guardrailContact while the cab steers into the wall, else null. */
export function syncGuardrailSparks(effects, scrape) {
  const grind = effects?.grind;
  if (!grind) return;
  if (scrape) Object.assign(grind.anchor, {x: scrape.contactX, y: scrape.contactY, side: scrape.side});
  grind.emitter.emitting = Boolean(scrape);
}

export function createHaulerEffects(scene) {
  const shadow = createSilhouetteShadow(scene, {texture: {key: 'cargo_ship'}})
    .setOrigin(0.5, 0.5).setAlpha(balance.TRUCK_SHADOW_ALPHA).setScale(1)
    .setDepth(8 - SHADOW_DEPTH_BELOW);
  const cargoShadows = [0, 1, 2, 3].map(() =>
    createSilhouetteShadow(scene, {texture: {key: 'cargo_trailer'}}).setDepth(7 - SHADOW_DEPTH_BELOW));
  const rack = scene.add.image(0, 0, 'cargo_rack').setOrigin(0.5, 0).setTint(SHADOW_TINT).setDepth(6.5).setVisible(false);
  const hitches = [0, 1, 2].map(() => scene.add.image(0, 0, 'cargo_rack')
    .setOrigin(0.5, 0).setTint(SHADOW_TINT).setDepth(6.5).setVisible(false));
  ensureParticleDotTexture(scene);
  const exhaust = createExhaustEmitter(scene);
  const damageSmoke = createExhaustEmitter(scene, 0x20242a);
  const grind = createGrindEmitter(scene);
  const sparkles = [0, 1, 2].map(() => scene.add.image(0, 0, 'hauler_gold_sparkle')
    .setDepth(8).setVisible(false));
  return {shadow, cargoShadows, rack, hitches, exhaust, damageSmoke, grind, sparkles};
}

export function stopHaulerExhaust(effects) {
  [effects.exhaust, effects.damageSmoke, effects.grind].filter(Boolean).forEach(({emitter}) => {
    emitter.emitting = false;
    emitter.killAll?.();
  });
}

export function syncBlueprintVisuals(sprite, glow, time, glowOffsetY = 0) {
  sprite.setRotation((time / 1800) % (Math.PI * 2));
  glow.setPosition(sprite.x, sprite.y + glowOffsetY).setAlpha(0.55 + Math.sin(time / 650) * 0.1);
}

export function syncCargoPickupVisuals(sprite, glow, time, night = false, accepted = true) {
  syncBlueprintVisuals(sprite, glow, time, CARGO_PICKUP_GLOW_OFFSET_Y * SPRITE_ART_SCALE);
  // The supplied pickup raster includes its drop shadow; avoid the heavy road mask for both.
  sprite.setDepth(night ? 16.2 : 5).setTint(night ? ENVIRONMENT_VISUALS.cargoNightTint : 0xffffff)
    .setAlpha(accepted ? 1 : 0.35);
  glow.setDepth(night ? 16.15 : 4.5)
    .setAlpha(glow.alpha * (night ? ENVIRONMENT_VISUALS.cargoNightGlowScale : 1) * (accepted ? 1 : 0.35));
}

/** Chassis-local offset rotated with suspension roll. */
export function hullPoint(ship, x, y) {
  const rotation = ship.rotation ?? 0;
  if (!rotation) return {x: ship.x + x, y: ship.y + y};
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  return {x: ship.x + x * cos - y * sin, y: ship.y + x * sin + y * cos};
}

export function syncHaulerEffects(effects, ship, indicators, load, capacity, phase, time, dt = 0, scrollSpeed = 0,
  {hull, maxHull} = {}) {
  const moving = phase === 'running' || phase === 'docking';
  const visible = ship.visible && (moving || phase === 'depot');
  if (effects.shadow) syncSilhouetteShadow(effects.shadow, ship, visible, 1, TRUCK_CONTACT_SHADOW);
  if (!effects.cargoTrail || !visible || !moving) effects.cargoTrail = createCargoTrail(ship);
  const segments = visible && moving
    ? advanceCargoTrail(effects.cargoTrail, ship, dt, load / capacity) : effects.cargoTrail.segments;
  const count =  Math.min(4, indicators.length, Math.ceil(Math.max(0, load) / capacity * 4));
  indicators.forEach((box, i) => {
    const segment = segments[i];
    scaleSpriteArt(box).setPosition(segment.x, segment.y).setRotation(segment.angle)
      .setVisible(visible && i < count);
    const shadow = effects.cargoShadows?.[i];
    if (shadow) syncSilhouetteShadow(shadow, box, visible && i < count, 1, TRAILER_CONTACT_SHADOW);
  });
  [effects.rack, ...(effects.hitches ?? [])].forEach((hitch, i) => {
    const parent = i ? indicators[i - 1] : ship;
    const child = indicators[i];
    if (!child) {
      hitch.setVisible(false);
      return;
    }
    const from = hullPoint(parent, 0, (i ? 12 : 24) * (parent.scaleY ?? 1));
    const to = hullPoint(child, 0, -14 * child.scaleY);
    hitch.setPosition(from.x, from.y)
      .setDisplaySize(6, Math.max(2, Math.hypot(to.x - from.x, to.y - from.y)))
      .setRotation(Math.atan2(to.y - from.y, to.x - from.x) - Math.PI / 2)
      .setVisible(visible && i < count);
  });
  const swift = ship.texture?.key === 'cargo_ship_swift';
  const art = swift ? SWIFT_RUNNER_ART : STANDARD_HAULER_ART;
  const placement = vehicleArtPlacement(art);
  if (effects.exhaust) {
    const x = placement.x + art.exhaustStack.x * placement.scale - 27;
    const y = placement.y + art.exhaustStack.y * placement.scale - 32.5;
    const outlet = hullPoint(ship, x * ship.scaleX, y * ship.scaleY);
    Object.assign(effects.exhaust.anchor, {x: outlet.x, y: outlet.y, scale: ship.scaleX, scrollSpeed});
    effects.exhaust.emitter.setAlpha(ship.alpha);
    effects.exhaust.emitter.emitting = ship.visible && moving;
  }
  if (effects.damageSmoke) {
    const tail = hullPoint(ship, 0, 25 * ship.scaleY);
    Object.assign(effects.damageSmoke.anchor, {x: tail.x, y: tail.y, scale: ship.scaleX, scrollSpeed});
    effects.damageSmoke.emitter.setAlpha(ship.alpha);
    effects.damageSmoke.emitter.emitting = ship.visible && moving && hull > 0 && hull <= maxHull / 3;
  }
  effects.sparkles?.forEach((sparkle, index) => {
    const [x, y] = [[-16, -12], [16, 8], [-15, 23]][index];
    const glint = Math.max(0, Math.sin(time / 450 + index * 2.1)) ** 6;
    const point = hullPoint(ship, x * ship.scaleX, y * ship.scaleY);
    sparkle.setPosition(point.x, point.y)
      .setScale(ship.scaleX * (0.18 + glint * 0.32))
      .setAlpha(ship.alpha * glint * 0.85)
      .setVisible(visible && ship.texture?.key === 'cargo_ship_gold');
  });
}

export function addSteelControl(scene, x, y, width, height, fill = PALETTE.steelDark, accent = PALETTE.steel, depth = 34) {
  const cut = Math.min(8, height / 5);
  return scene.add.polygon(x, y, [
    cut, 0, width - cut, 0, width, cut,
    width, height - cut, width - cut, height, cut, height,
    0, height - cut, 0, cut,
  ], fill).setStrokeStyle(1, accent, 0.85).setDepth(depth);
}

export function addIndustrialPanel(scene, width, height, viewport = null) {
  const g = scene.add.graphics().setDepth(30);
  if (viewport) {
    const margin = 64;
    const left = Math.min(0, viewport.x) - margin;
    const top = Math.min(0, viewport.y) - margin;
    const right = Math.max(width, viewport.x + viewport.width) + margin;
    const bottom = Math.max(height, viewport.y + viewport.height) + margin;
    g.fillStyle(PALETTE.background).fillRect(
      left, top, right - left, bottom - top);
  }
  g.fillStyle(PALETTE.background).fillRect(0, 0, width, height);
  plate(g, 12, 18, width - 24, height - 36, PALETTE.edge, 14);
  plate(g, 16, 22, width - 32, height - 44, PALETTE.steelDark, 12);
  plate(g, 18, 24, width - 36, height - 48, PALETTE.background, 11);
  g.fillStyle(PALETTE.steelDark).fillRect(24, 38, width - 48, 54);
  g.fillStyle(PALETTE.cyan).fillRect(28, 42, 3, 44).fillRect(width - 31, 42, 3, 44);
  g.fillStyle(PALETTE.steel).fillRect(40, 58, 30, 2).fillRect(width - 70, 58, 30, 2);
  return g;
}

export function vehicleTint(vehicleId = 'standard', colorId = 'default') {
  if (vehicleId === 'standard') return null;
  const tints = {
    'white-blue': 0x80bfff,
    'black-red': 0xe07070,
    'yellow-blue': 0xf4d45e,
    gold: 0xf6cb46,
  };
  return tints[colorId] ?? null;
}

export function vehicleTexture(vehicleId = 'standard', colorId = 'default', preview = false) {
  const key = preview ? 'cargo_preview' : 'cargo_ship';
  return vehicleId === 'swift' ? `${key}_swift`
    : Object.hasOwn(STANDARD_HAULER_TRIMS, colorId) ? `${key}_${colorId}` : key;
}

export function vehicleTrimName(vehicleId, colorId = 'default') {
  if (vehicleId === 'standard' && Object.hasOwn(STANDARD_HAULER_TRIMS, colorId)) {
    return STANDARD_HAULER_TRIMS[colorId].name;
  }
  return colorId === 'default' ? 'STANDARD' : colorId.replace('-', ' / ').toUpperCase();
}

export function addGoldPreviewSparkles(scene, ship, vehicleId, colorId) {
  if (vehicleId !== 'standard' || colorId !== 'gold') return [];
  return [[-16, -12], [16, 8], [-15, 23]].map(([x, y], index) => {
    const scale = ship.scaleX * 3;
    const sparkle = scene.add.image(ship.x + x * scale, ship.y + y * scale, 'hauler_gold_sparkle')
      .setScale(scale * 0.4).setDepth(ship.depth + 1).setAlpha(0.1);
    scene.tweens?.add({targets: sparkle, alpha: 0.9, scaleX: scale * 0.65, scaleY: scale * 0.65,
      duration: 650, delay: index * 600, hold: 60, repeatDelay: 1600, yoyo: true, repeat: -1});
    sparkle.once('destroy', () => scene.tweens?.killTweensOf(sparkle));
    return sparkle;
  });
}

export function addHaulerPreview(scene, x, y, scale = 1, vehicleId = 'standard', colorId = 'default') {
  const base = addSteelControl(scene, x, y, 74 * scale, 78 * scale, PALETTE.edge, PALETTE.steelDark, 31);
  const texture = vehicleTexture(vehicleId, colorId, true);
  const ship = scene.add.image(x, y, texture).setScale(scale / 3 * SPRITE_ART_SCALE).setDepth(32);
  const tint = vehicleTint(vehicleId, colorId);
  if (tint) ship.setTint(tint);
  return [base, ship, ...addGoldPreviewSparkles(scene, ship, vehicleId, colorId)];
}

export function addModuleIcon(scene, id, x, y, size = 32) {
  if (!Object.hasOwn(MODULE_CAPTIONS, id)) throw new Error(`No icon for module ${id}`);
  return scene.add.image(x, y, `module_${id}`)
    .setDisplaySize(size * SPRITE_ART_SCALE, size * SPRITE_ART_SCALE).setDepth(34);
}
