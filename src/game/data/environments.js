import {depotPaletteStep} from '../core/depots.js';

export const ROAD_SURFACE_PRESETS = Object.freeze({
  industrial: Object.freeze({roadTexture: 'industrial_road', subRoadTexture: 'subroad_industrial', blendMode: 'MULTIPLY', overlayAlpha: 0.14}),
  dustlands: Object.freeze({roadTexture: 'dustlands_road', subRoadTexture: 'subroad_dustlands', blendMode: 'ADD', overlayAlpha: 0.12}),
  // Keep the cached overlay available for art inspection, but do not render it during runs.
  neon: Object.freeze({roadTexture: 'road_neon_base', subRoadTexture: 'overlay_neon_hex', blendMode: 'NORMAL',
    overlayAlpha: 0, overlayScrollRatio: 1, overlayRoadAligned: true}),
  foundry: Object.freeze({roadTexture: 'reactor_road', subRoadTexture: 'subroad_foundry', blendMode: 'MULTIPLY', overlayAlpha: 0.14}),
});

export const LEVEL_LIGHTING_PRESETS = Object.freeze({
  level1: Object.freeze(['dawn', 'dawn', 'midday', 'midday']),
  level2: Object.freeze(['dawn', 'midday', 'midday', 'dusk']),
  level3: Object.freeze(['dawn', 'midday', 'dusk', 'night']),
  level4: Object.freeze(['dusk', 'dusk', 'night', 'night']),
});

export const SECTOR_LIGHTING = Object.freeze([
  Object.freeze({name: 'DAWN TRANSIT', tint: 0xe8d0b0, headlights: false}),
  Object.freeze({name: 'MID-DAY TRANSIT', tint: 0xffffff, headlights: false}),
  Object.freeze({name: 'DUSK TRANSIT', tint: 0x8c6b9e, headlights: true}),
  Object.freeze({name: 'NIGHT SHIFT', tint: 0x6a7590, headlights: true}),
]);
const LIGHTING_BY_PRESET = Object.freeze({
  dawn: SECTOR_LIGHTING[0], midday: SECTOR_LIGHTING[1],
  dusk: SECTOR_LIGHTING[2], night: SECTOR_LIGHTING[3],
});
export const THEMES = Object.freeze({
  neon: Object.freeze({
    roadKey: ROAD_SURFACE_PRESETS.neon.roadTexture,
    overlayKey: ROAD_SURFACE_PRESETS.neon.subRoadTexture,
    overlayBlend: ROAD_SURFACE_PRESETS.neon.blendMode,
    overlayAlpha: ROAD_SURFACE_PRESETS.neon.overlayAlpha,
    ambientTint: Object.freeze({dusk: 0x8a70a8, night: 0x56487e}),
    headlightIntensity: 1.3,
    hazardGlowIntensity: 1.4,
  }),
});

/** Decorative Neon blade signs on the shoulders: pooled images, no collision, deterministic cadence. */
export const NEON_SHOULDER_SIGNS = Object.freeze({
  spacingMeters: 140, firstMeters: 60, depth: 2, displayScale: 0.5,
  pulseMs: 1200, alphaMin: 0.8, alphaMax: 1,
  left: Object.freeze({key: 'neon_sign_kanji', x: 35}),
  right: Object.freeze({key: 'neon_sign_apex', x: 355}),
});

/**
 * Every obstacle carries a light: listed kinds flash amber double strobes, all others a slow amber beacon.
 * No surrounding obstacle rings or halos; the small warning beacons mark the solid artwork.
 */
export const HAZARD_LIGHTS = Object.freeze({
  strobes: Object.freeze({divider: 2, barrier: 2, forklift: 1, sweeper: 2, boomLift: 1, serviceBoom: 1}),
  beaconPeriodMs: 1400, beaconIdleAlpha: 0.3,
});

export const NEON_READABILITY = Object.freeze({
  roadAmbient: Object.freeze([150, 146, 180]),
  edgeAmbient: Object.freeze([210, 230, 245]),
  edgeWidthPx: 3,
  cargoRimKey: 'cargo_neon_rim',
});

const NEON_LIGHTING_BY_PRESET = Object.freeze({
  dusk: Object.freeze({...SECTOR_LIGHTING[2], tint: THEMES.neon.ambientTint.dusk}),
  night: Object.freeze({...SECTOR_LIGHTING[3], tint: THEMES.neon.ambientTint.night}),
});
export const LEVEL_SECTOR_LIGHTING = Object.freeze(Object.fromEntries(
  Object.entries(LEVEL_LIGHTING_PRESETS).map(([levelId, presets]) => [levelId,
    Object.freeze(presets.map(preset => levelId === 'level4'
      ? NEON_LIGHTING_BY_PRESET[preset] : LIGHTING_BY_PRESET[preset]))]),
));
export const OVERDRIVE_LIGHTING = Object.freeze({name: 'HIGH NOON', tint: 0xffffff, headlights: false});
export const ENVIRONMENT_VISUALS = Object.freeze({
  subRoadSpeed: 0.7, ambientBlendSeconds: 1.8,
  headlightLength: 220, headlightWidth: 84, headlightAlpha: 0.35,
  streetlightSpacingMeters: 80, streetlightRadius: 140, streetlightAlpha: 0.38,
  streetlightTint: 0xffe090,
  barrierNightScale: 1.8, barrierNightIdleAlpha: 0.3,
  cargoNightTint: 0xe6e6e6, cargoNightGlowScale: 0.9,
  burstZoom: 0.94, burstOutMs: 300, burstReturnMs: 1500,
  streakSeconds: 1.8, streakMargin: 0.15,
});

const smoothFade = value => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

export function headlightFalloff(forward, lateral) {
  const {headlightLength: length, headlightWidth: width} = ENVIRONMENT_VISUALS;
  if (forward < 0 || forward > length) return 0;
  const halfWidth = 6 + (width / 2 - 6) * forward / length;
  return smoothFade((halfWidth - Math.abs(lateral)) / (halfWidth * 0.65)) *
    smoothFade(forward / 18) * smoothFade((length - forward) / 80);
}

export function streetlightFalloff(distance) {
  const {streetlightRadius: radius} = ENVIRONMENT_VISUALS;
  return smoothFade((radius - distance) / (radius * 0.8));
}

const environment = (roadTexture, roadsideIdentity, hazardFamilies, roadTints) => Object.freeze({
  roadTexture, roadsideIdentity: Object.freeze(roadsideIdentity),
  hazardFamilies: Object.freeze([...new Set([...hazardFamilies,
    'sideRail', 'sideWall', 'forklift', 'sweeper'])]), roadTints: Object.freeze(roadTints),
});

/** Visual asset inventories; challenge selection lives in challengeProfiles.js. */
export const ENVIRONMENTS = Object.freeze({
  industrial: environment('industrial_road', ['vent', 'pipes', 'utility', 'loading'],
    ['divider', 'barrier', 'signalCabinet', 'rockSlab', 'loadingPlatform', 'pipeAssembly', 'roadsideMachine', 'cargoDock', 'serviceBoom', 'boomLift'],
    [0xffffff, 0xe0edf4, 0xf2e4d1, 0xd5e4dc]),
  dustlands: environment('dustlands_road', ['rocks', 'wreckage', 'exposed-conduits'],
    ['divider', 'rockSlab', 'dustConduit', 'wreckPlatform', 'boomLift'],
    [0xffffff, 0xf3e4cb, 0xe5d4c1, 0xe9dfce]),
  neon: environment(ROAD_SURFACE_PRESETS.neon.roadTexture, ['service-facades', 'signal-signs', 'energy-conduits'],
    ['divider', 'signalCabinet', 'neonConduit', 'signGantry', 'vent', 'ventGrille', 'boomLift'],
    [0xffffff, 0xdde8ff, 0xefdbf8, 0xd5edf2]),
  reactor: environment('reactor_road', ['containment-walls', 'cooling-conduits', 'reactor-panels'],
    ['divider', 'rockSlab', 'reactorPipe', 'containment', 'vent', 'ventGrille', 'boomLift'],
    [0xffffff, 0xd9eee0, 0xd5e6ec, 0xe6e5ce]),
  overdrive: environment('overdrive_road', ['containment-walls', 'signal-signs', 'energy-conduits'],
    ['divider', 'rockSlab', 'signalCabinet', 'reactorPipe', 'signGantry', 'containment'],
    [0xffffff, 0xe4d7ef, 0xd8e2ed, 0xece0dc]),
});

/** Visual themes are keyed by sector theme, so every Industrial/Dustlands sector shares that look. */
const visualThemes = new Map(Object.entries(ENVIRONMENTS).map(([themeId, environment]) => [themeId, Object.freeze({
  id: themeId,
  hazardThemeId: themeId,
  roadTexture: environment.roadTexture,
  roadTints: environment.roadTints,
  surfacePreset: ROAD_SURFACE_PRESETS[themeId === 'reactor' ? 'foundry'
    : themeId === 'overdrive' ? 'neon' : themeId],
  ...THEMES[themeId],
})]));
const warnedVisualThemes = new WeakSet();

export function resolveVisualTheme(sector) {
  const requested = visualThemes.get(sector.visualThemeId);
  if (!requested && import.meta.env?.DEV && !warnedVisualThemes.has(sector)) {
    console.warn(`Missing or unknown visual theme ${String(sector.visualThemeId)}; using current sector art.`);
    warnedVisualThemes.add(sector);
  }
  return requested ?? visualThemes.get(sector.id) ??
    visualThemes.get(sector.themeId) ?? visualThemes.get('industrial');
}

export function roadTint(sector, distance, levelId = 'level1', mode = 'normal') {
  const variants = resolveVisualTheme(sector).roadTints;
  if (mode === 'continuous') return variants[1];
  const index = depotPaletteStep(distance, sector.startsAt, levelId, mode) % variants.length;
  return variants[index];
}
