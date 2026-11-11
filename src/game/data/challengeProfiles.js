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

const profile = (hazardFamilies, fillerHazardFamilies = []) => Object.freeze({
  motifs: TRACK_MOTIFS,
  hazardFamilies: Object.freeze([...new Set([...hazardFamilies, ...fillerHazardFamilies,
    'sideRail', 'sideWall', 'sweeper'])]),
  fillerHazardFamilies: Object.freeze(fillerHazardFamilies),
  betaHazardFamilies: Object.freeze(['divider', ...fillerHazardFamilies]),
});

export const CHALLENGE_PROFILES = Object.freeze({
  industrial: profile(['divider', 'barrier', 'signalCabinet', 'rockSlab', 'loadingPlatform',
    'pipeAssembly', 'roadsideMachine', 'cargoDock', 'serviceBoom'], ['barrier', 'rockSlab', 'signalCabinet']),
  dustlands: profile(['divider', 'rockSlab', 'dustConduit', 'wreckPlatform'], ['rockSlab']),
  neon: profile(['divider', 'signalCabinet', 'neonConduit', 'signGantry'], ['signalCabinet']),
  reactor: profile(['divider', 'rockSlab', 'reactorPipe', 'containment'], ['rockSlab', 'divider']),
  overdrive: profile(['divider', 'rockSlab', 'signalCabinet', 'reactorPipe', 'signGantry', 'containment'],
    ['signalCabinet', 'rockSlab']),
});

export function challengeProfile(id) {
  const result = CHALLENGE_PROFILES[id];
  if (!result) throw new Error(`Unknown challenge profile ${id}`);
  return result;
}
