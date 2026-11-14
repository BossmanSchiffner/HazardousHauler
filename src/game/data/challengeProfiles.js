export const MOTIF_SLALOM = Object.freeze([0b0011, 0b1100, 0b0011]);
export const MOTIF_FUNNEL = Object.freeze([0b1001, 0b0110, 0b0110]);
export const MOTIF_DOORWAY = Object.freeze([0b0111, 0b1110, 0b0111]);
export const MOTIF_BASELINE_SWEEP = Object.freeze([0b0110, 0b1100, 0b0011]);
export const STATIC_CHICANE = Object.freeze({
  entry: Object.freeze({pinchLane: 0, dividerLane: 1}),
  exit: Object.freeze({pinchLane: 3, dividerLane: 2}),
});
export const TRACK_MOTIFS = Object.freeze([
  Object.freeze({id: 'slalom', masks: MOTIF_SLALOM}),
  Object.freeze({id: 'funnel', masks: MOTIF_FUNNEL}),
  Object.freeze({id: 'doorway', masks: MOTIF_DOORWAY}),
]);

// Level 4 Neon: the palette rotates evenly, so repeats weight Signal Cabinets just behind the dividers.
const LEVEL4_FAMILIES = Object.freeze(['barrier', 'signalCabinet', 'rockSlab', 'vent', 'ventGrille', 'boomLift']);
const LEVEL4_PALETTE = Object.freeze(['signalCabinet', 'barrier', 'vent', 'signalCabinet', 'rockSlab',
  'boomLift', 'signalCabinet', 'ventGrille']);

const profile =  (hazardFamilies, fillerHazardFamilies = [], options = {}) => Object.freeze({
  motifs: TRACK_MOTIFS,
  hazardFamilies: Object.freeze([...new Set([...hazardFamilies, ...fillerHazardFamilies,
    'sideRail', 'sideWall', ...(options.allowSweeper === false ? [] : ['sweeper'])])]),
  fillerHazardFamilies: Object.freeze(fillerHazardFamilies),
  betaHazardFamilies: Object.freeze(['divider', ...fillerHazardFamilies]),
  ...(options.obstaclePalette ? {obstaclePalette: Object.freeze([...options.obstaclePalette])} : {}),
  ...(options.allowSweeper !== undefined ? {allowSweeper: options.allowSweeper} : {}),
  ...(options.allowForklift !== undefined ? {allowForklift: options.allowForklift} : {}),
  ...(options.allowEnergyOrb !== undefined ? {allowEnergyOrb: options.allowEnergyOrb} : {}),
  ...(options.orbSpawnIntervalM ? {orbSpawnIntervalM: Object.freeze([...options.orbSpawnIntervalM])} : {}),
  ...(options.baseGapRange ? {baseGapRange: Object.freeze([...options.baseGapRange])} : {}),
  ...(options.sweeperSpawnIntervalM
    ? {sweeperSpawnIntervalM: Object.freeze([...options.sweeperSpawnIntervalM])} : {}),
});

export const CHALLENGE_PROFILES = Object.freeze({
  industrial: profile(['divider', 'barrier', 'signalCabinet', 'rockSlab', 'loadingPlatform',
    'pipeAssembly', 'roadsideMachine', 'cargoDock', 'serviceBoom'], ['barrier', 'rockSlab', 'signalCabinet', 'boomLift']),
  dustlands: profile(['divider', 'rockSlab', 'dustConduit', 'wreckPlatform'], ['rockSlab', 'boomLift'],
    {obstaclePalette: ['rockSlab', 'boomLift', 'rockSlab']}),
  dustlands_dusk: profile(['divider', 'rockSlab', 'dustConduit', 'wreckPlatform'],
    ['rockSlab', 'boomLift', 'vent', 'ventGrille'], {
      obstaclePalette: ['rockSlab', 'boomLift', 'vent', 'wreckPlatform'],
      sweeperSpawnIntervalM: [160, 240],
    }),
  neon: profile(['divider', 'signalCabinet', 'neonConduit', 'signGantry'], ['signalCabinet', 'vent', 'boomLift', 'ventGrille']),
  level4_neon_s1: profile(LEVEL4_FAMILIES, LEVEL4_FAMILIES, {
    obstaclePalette: LEVEL4_PALETTE, allowSweeper: false, allowForklift: false,
    allowEnergyOrb: true, orbSpawnIntervalM: [180, 260], baseGapRange: [170, 210],
  }),
  level4_neon_s2: profile(LEVEL4_FAMILIES, LEVEL4_FAMILIES, {
    obstaclePalette: LEVEL4_PALETTE, allowSweeper: false, allowForklift: false,
    allowEnergyOrb: true, orbSpawnIntervalM: [180, 260], baseGapRange: [150, 190],
  }),
  level4_neon_s3: profile(LEVEL4_FAMILIES, LEVEL4_FAMILIES, {
    obstaclePalette: LEVEL4_PALETTE, allowSweeper: false, allowForklift: false,
    allowEnergyOrb: true, orbSpawnIntervalM: [180, 260], baseGapRange: [140, 180],
  }),
  level4_neon_s4: profile(LEVEL4_FAMILIES, LEVEL4_FAMILIES, {
    obstaclePalette: LEVEL4_PALETTE, allowSweeper: false, allowForklift: false,
    allowEnergyOrb: true, orbSpawnIntervalM: [180, 260], baseGapRange: [130, 160],
  }),
  reactor: profile(['divider', 'rockSlab', 'reactorPipe', 'containment'],
    ['rockSlab', 'vent', 'divider', 'ventGrille', 'boomLift'], {
    sweeperSpawnIntervalM: [160, 240],
  }),
  overdrive: profile(['divider', 'rockSlab', 'signalCabinet', 'reactorPipe', 'signGantry', 'containment'],
    ['signalCabinet', 'rockSlab']),
});

export function challengeProfile(id) {
  const result = CHALLENGE_PROFILES[id];
  if (!result) throw new Error(`Unknown challenge profile ${id}`);
  return result;
}
