const profile = (hazardFamilies, fillerHazardFamilies = []) => Object.freeze({
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
