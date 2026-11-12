import {GAME_BALANCE} from '../data/gameBalance.js';
import {IMPLEMENTED_LEVELS} from './sectors.js';

const levelIds = GAME_BALANCE.progression.levelIds;

export function equipmentRequirementStatus(profile, requirement) {
  if (!requirement) return {met: true, future: false, summary: 'Available from the start',
    description: 'Available from the start.'};
  const {levelId, sector, event} = requirement;
  if (!/^level[1-9]\d*$/.test(levelId) || !Number.isInteger(sector) || sector < 1 ||
      !['reach', 'complete'].includes(event)) throw new Error('Invalid equipment unlock requirement');
  const level = Number(levelId.slice(5));
  const verb = event === 'reach' ? 'Reach' : 'Complete';
  const summary = `${verb} L${level} · S${sector}`;
  const sectors = IMPLEMENTED_LEVELS[levelId];
  if (!sectors) return {met: false, future: true, summary: `${summary}\nNot available yet`,
    description: `${verb} Level ${level}, Sector ${sector}. Level ${level} is not available yet.`};
  const target = sectors.find(candidate => candidate.number === sector);
  if (!target) throw new Error(`Unknown equipment unlock sector: ${levelId}, ${sector}`);
  const progress = profile.levelProgress?.[levelId];
  const evidence = event === 'reach' ? progress?.reachedSectors : progress?.completedSectors;
  const initialSector = event === 'reach' && levelId === 'level1' && sector === 1;
  const boundary = event === 'reach' ? target.startsAt : target.endsAt;
  return {
    met: initialSector || evidence?.includes(sector) === true,
    future: false, summary,
    description: `${verb} Level ${level}, Sector ${sector} (${boundary.toLocaleString('en-US')} m).` +
      (initialSector ? ' Available from the start.' : ''),
  };
}

/** Records only sectors actually entered or fully traversed in this normal run segment. */
export function recordSectorProgress(profile, levelId, distance, startDistance = 0) {
  const sectors = IMPLEMENTED_LEVELS[levelId];
  if (!sectors || !profile.levelProgress?.[levelId] || !Number.isFinite(distance) ||
      !Number.isFinite(startDistance) || startDistance < 0 || distance < startDistance) {
    throw new Error('Invalid sector progress');
  }
  const progress = profile.levelProgress[levelId];
  const reached = new Set(progress.reachedSectors ?? []);
  const completed = new Set(progress.completedSectors ?? []);
  for (const sector of sectors) {
    if (startDistance <= sector.startsAt && distance >= sector.startsAt) reached.add(sector.number);
    if (startDistance <= sector.startsAt && distance >= sector.endsAt) completed.add(sector.number);
  }
  const reachedSectors = sectors.filter(sector => reached.has(sector.number)).map(sector => sector.number);
  const completedSectors = sectors.filter(sector => completed.has(sector.number)).map(sector => sector.number);
  if (reachedSectors.join() === (progress.reachedSectors ?? []).join() &&
      completedSectors.join() === (progress.completedSectors ?? []).join()) return profile;
  return {...profile, levelProgress: {...profile.levelProgress,
    [levelId]: {...progress, reachedSectors, completedSectors}}};
}

/** The checkpoint is the start of `checkpointSector`, i.e. the end of the sector before it. */
export function checkpointDistance(levelId) {
  const sectors = IMPLEMENTED_LEVELS[levelId];
  if (!sectors) throw new Error(`Unknown level ${levelId}`);
  return sectors[GAME_BALANCE.progression.checkpointSector - 1].startsAt;
}

export function isLevelUnlocked(profile, levelId) {
  if (levelId === 'level4') return profile.completedLevels?.includes('level3') === true;
  return levelIds.includes(levelId) && (
    levelId === GAME_BALANCE.progression.firstPlayableLevel ||
    profile.levelProgress?.[levelId]?.unlocked === true ||
    profile.levelProgress?.[levelId]?.completed === true
  );
}

export function isCheckpointUnlocked(profile, levelId) {
  return isLevelUnlocked(profile, levelId) && (levelId === 'level4'
    ? profile.milestones?.includes('level4,sector3') === true
    : profile.levelProgress?.[levelId]?.sector3CheckpointUnlocked === true);
}

export function isRunStartAvailable(profile, levelId, start = 'beginning', mode = 'normal') {
  if (!isLevelUnlocked(profile, levelId)) return false;
  if (mode === 'continuous') return levelId === 'level1' && start === 'beginning' &&
    profile.levelProgress?.level1?.completed === true;
  if (mode !== 'normal') return false;
  return start === 'beginning' || (start === 'checkpoint' && isCheckpointUnlocked(profile, levelId));
}
