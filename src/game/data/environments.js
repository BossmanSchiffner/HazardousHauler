import {depotPaletteStep} from '../core/depots.js';

export const ROAD_SURFACE_PRESETS = Object.freeze({
  industrial: Object.freeze({roadTexture: 'industrial_road', subRoadTexture: 'subroad_industrial', blendMode: 'MULTIPLY', overlayAlpha: 0.14}),
  dustlands: Object.freeze({roadTexture: 'dustlands_road', subRoadTexture: 'subroad_dustlands', blendMode: 'ADD', overlayAlpha: 0.12}),
  neon: Object.freeze({roadTexture: 'neon_road', subRoadTexture: 'subroad_neon', blendMode: 'MULTIPLY', overlayAlpha: 0.14}),
  foundry: Object.freeze({roadTexture: 'reactor_road', subRoadTexture: 'subroad_foundry', blendMode: 'MULTIPLY', overlayAlpha: 0.14}),
});

export const SECTOR_LIGHTING = Object.freeze([
  Object.freeze({name: 'DAWN TRANSIT', tint: 0xe8d0b0, headlights: false}),
  Object.freeze({name: 'MID-DAY TRANSIT', tint: 0xffffff, headlights: false}),
  Object.freeze({name: 'DUSK TRANSIT', tint: 0x8c6b9e, headlights: true}),
  Object.freeze({name: 'NIGHT SHIFT', tint: 0x46516a, headlights: true}),
]);
export const LEVEL_SECTOR_LIGHTING = Object.freeze({
  level1: Object.freeze([SECTOR_LIGHTING[0], SECTOR_LIGHTING[0], SECTOR_LIGHTING[1], SECTOR_LIGHTING[1]]),
  level2: Object.freeze([SECTOR_LIGHTING[0], SECTOR_LIGHTING[1], SECTOR_LIGHTING[1], SECTOR_LIGHTING[2]]),
});
export const OVERDRIVE_LIGHTING = Object.freeze({name: 'HIGH NOON', tint: 0xffffff, headlights: false});
export const ENVIRONMENT_VISUALS = Object.freeze({
  subRoadSpeed: 0.7, ambientBlendSeconds: 1.8,
  headlightLength: 220, headlightWidth: 84, headlightAlpha: 0.35,
  streetlightSpacingMeters: 80, streetlightRadius: 140, streetlightAlpha: 0.38,
  streetlightTint: 0xffe090, decalSpacingMeters: 45,
  barrierNightScale: 1.3, barrierNightIdleAlpha: 0.3,
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
    ['divider', 'barrier', 'signalCabinet', 'rockSlab', 'loadingPlatform', 'pipeAssembly', 'roadsideMachine', 'cargoDock', 'serviceBoom'],
    [0xffffff, 0xe0edf4, 0xf2e4d1, 0xd5e4dc]),
  dustlands: environment('dustlands_road', ['rocks', 'wreckage', 'exposed-conduits'],
    ['divider', 'rockSlab', 'dustConduit', 'wreckPlatform'],
    [0xffffff, 0xf3e4cb, 0xe5d4c1, 0xe9dfce]),
  neon: environment('neon_road', ['service-facades', 'signal-signs', 'energy-conduits'],
    ['divider', 'signalCabinet', 'neonConduit', 'signGantry'],
    [0xffffff, 0xdde8ff, 0xefdbf8, 0xd5edf2]),
  reactor: environment('reactor_road', ['containment-walls', 'cooling-conduits', 'reactor-panels'],
    ['divider', 'rockSlab', 'reactorPipe', 'containment'],
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
