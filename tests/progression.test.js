import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultProfile, normalizeProfile} from '../src/game/core/save.js';
import {
  isCheckpointUnlocked, isLevelUnlocked, isRunStartAvailable,
  equipmentRequirementStatus, recordSectorProgress,
} from '../src/game/core/progression.js';
import {createRunEconomy, normalRunRewardPreview, settleRun} from '../src/game/core/depotEconomy.js';
import {markDeveloperRun} from '../src/game/core/developerRuns.js';
import {moduleStatus, buyModule, equipModule, loadoutStats} from '../src/game/core/modules.js';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';
import {MILESTONES} from '../src/game/core/modules.js';

const ROUTES = GAME_BALANCE.routes;
const L1 = ROUTES.level1;
const L2 = ROUTES.level2;
const MODULES = GAME_BALANCE.upgrades.modules;
const unlockDistance = ({levelId, sector, event}) => event === 'complete'
  ? ROUTES[levelId].sectorEndsMeters[sector - 1]
  : ROUTES[levelId].sectorStartsMeters[sector - 1];

test('approved route boundaries give Level 1 a 2000 m finish and Level 2 a 3000 m finish', () => {
  assert.deepEqual(L1.sectorStartsMeters, [0, 500, 1000, 1500]);
  assert.deepEqual(L1.sectorEndsMeters, [500, 1000, 1500, 2000]);
  assert.deepEqual(L2.sectorStartsMeters, [0, 500, 1000, 2000]);
  assert.deepEqual(L2.sectorEndsMeters, [500, 1000, 2000, 3000]);
  assert.equal(L1.finishDistanceMeters, 2000);
  assert.equal(L2.finishDistanceMeters, 3000);
});

test('equipment gates use the specified Level, Sector and event at exact route boundaries', () => {
  const initial = defaultProfile();
  for (const [id, levelId, sector, event] of [
    ['cargo_light', 'level1', 3, 'complete'],
    ['def_plating', 'level1', 4, 'complete'],
    ['def_shield', 'level2', 3, 'complete'],
    ['util_insurance', 'level2', 1, 'reach'],
  ]) {
    const threshold = unlockDistance({levelId, sector, event});
    const status = moduleStatus(initial, id);
    assert.deepEqual(status.def.unlock, {levelId, sector, event});
    assert.equal(status.unlocked, false);
    if (threshold > 0) {
      const before = recordSectorProgress(initial, levelId, threshold - 0.001);
      assert.equal(moduleStatus(before, id).unlocked, false, `${id} must not unlock before its boundary`);
    }
    const reached = recordSectorProgress(initial, levelId, threshold);
    assert.equal(moduleStatus(reached, id).unlocked, true, id);
    const otherLevel = levelId === 'level1' ? 'level2' : 'level1';
    assert.equal(moduleStatus(recordSectorProgress(initial,
      otherLevel, Math.max(threshold, ROUTES[otherLevel].finishDistanceMeters)), id).unlocked, false,
    'the other level cannot supply evidence');
    assert.match(status.lockReason, new RegExp(`${event === 'reach' ? 'Reach' : 'Complete'} Level ${levelId.slice(5)}, Sector ${sector}`));
  }
  const magnet = moduleStatus(initial, 'coll_magnet');
  assert.equal(magnet.unlocked, true);
  assert.match(magnet.requirement.description, /Reach Level 1, Sector 1 \(0 m\).*Available from the start/);
  assert.equal(buyModule({...initial, coins: MODULES.coll_magnet.price}, 'coll_magnet').ok, true);
  assert.equal(buyModule({...initial, coins: MODULES.coll_magnet.price - 1}, 'coll_magnet').ok, false);
});

test('sector entry and completion persist separately, including checkpoint segment boundaries', () => {
  const initial = defaultProfile();
  const entry = recordSectorProgress(initial, 'level1', L1.sectorStartsMeters[3] - 1);
  assert.deepEqual(entry.levelProgress.level1.reachedSectors, [1, 2, 3]);
  assert.deepEqual(entry.levelProgress.level1.completedSectors, [1, 2]);
  assert.equal(moduleStatus(entry, 'cargo_light').unlocked, false);
  const checkpoint = recordSectorProgress(initial, 'level2', L2.sectorStartsMeters[3], L2.sectorStartsMeters[2]);
  assert.deepEqual(checkpoint.levelProgress.level2.reachedSectors, [3, 4]);
  assert.deepEqual(checkpoint.levelProgress.level2.completedSectors, [3]);
  assert.equal(moduleStatus(checkpoint, 'def_shield').unlocked, true);
  assert.deepEqual(initial.levelProgress.level2.completedSectors, []);
  assert.equal(recordSectorProgress(checkpoint, 'level2', L2.sectorStartsMeters[3], L2.sectorStartsMeters[2]), checkpoint,
    'unchanged evidence avoids repeated persistence writes');
});

test('Level 4 equipment gate stays closed without creating Level progress; owned gear remains usable', () => {
  let profile = recordSectorProgress(defaultProfile(), 'level1', L1.finishDistanceMeters);
  profile = recordSectorProgress(profile, 'level2', L2.finishDistanceMeters);
  const future = moduleStatus(profile, 'util_impact_pulse');
  assert.deepEqual(future.def.unlock, {levelId: 'level4', sector: 3, event: 'reach'});
  assert.equal(future.unlocked, false);
  assert.match(future.lockReason, /Reach Level 4, Sector 3/);
  assert.equal(buyModule({...profile, coins: 10000}, 'util_impact_pulse').ok, false);
  assert.equal(profile.levelProgress.level4.unlocked, false);
  profile = {...defaultProfile(), ownedModules: {...defaultProfile().ownedModules, util_impact_pulse: 2}};
  const retained = moduleStatus(profile, 'util_impact_pulse');
  assert.equal(retained.unlocked, true);
  assert.equal(retained.grandfathered, true);
  const equipped = equipModule(profile, 'util_impact_pulse');
  assert.equal(equipped.ok, true);
  assert.equal(loadoutStats(equipped.profile).impactPulseSeconds, MODULES.util_impact_pulse.values[1]);
  assert.throws(() => equipmentRequirementStatus(profile, {levelId: 'level2', sector: 3, event: 'enter'}));
});

test('normal settlement persists completion at the finish without letting continuous or developer runs earn gates', () => {
  const initial = defaultProfile();
  const beforeFinish = settleRun(initial, createRunEconomy({fullStart: true}), [], L1.finishDistanceMeters - 1, false).profile;
  assert.equal(moduleStatus(beforeFinish, 'def_plating').unlocked, false);
  const finished = settleRun(initial, createRunEconomy({fullStart: true}), [], L1.finishDistanceMeters, true, true).profile;
  assert.equal(moduleStatus(finished, 'def_plating').unlocked, true);
  assert.deepEqual(finished.levelProgress.level1.completedSectors, [1, 2, 3, 4]);
  assert.deepEqual(finished.completedLevels, ['level1']);
  assert.equal(finished.levelProgress.level2.unlocked, true);
  assert.equal(moduleStatus(finished, 'util_insurance').unlocked, false);
  const checkpoint = settleRun(initial,
    createRunEconomy({checkpointStart: true, startDistance: L1.sectorStartsMeters[2]}), [], L1.sectorStartsMeters[3], false).profile;
  assert.deepEqual(checkpoint.levelProgress.level1.completedSectors, [3]);
  assert.equal(moduleStatus(checkpoint, 'cargo_light').unlocked, true);
  const developer = settleRun(initial, createRunEconomy(markDeveloperRun({fullStart: true})),
    [], L1.finishDistanceMeters, true, true);
  assert.equal(developer.profile, initial);
  const inconsistentOld = {...initial, levelProgress: {
    ...initial.levelProgress, level1: {...initial.levelProgress.level1, completed: true},
  }};
  const continuous = settleRun(inconsistentOld,
    createRunEconomy({mode: 'continuous', startDistance: 0}), [], 9000, true).profile;
  assert.deepEqual(continuous.levelProgress.level1.completedSectors, []);
});

test('Level access and Sector 3 checkpoint eligibility are independent per level', () => {
  const profile = defaultProfile();
  profile.levelProgress.level1.sector3CheckpointUnlocked = true;
  assert.equal(isCheckpointUnlocked(profile, 'level1'), true);
  assert.equal(isCheckpointUnlocked(profile, 'level2'), false);
  assert.equal(isRunStartAvailable(profile, 'level2', 'beginning'), false);

  profile.levelProgress.level1.completed = true;
  profile.levelProgress.level2.unlocked = true;
  assert.equal(isLevelUnlocked(profile, 'level2'), true);
  assert.equal(isCheckpointUnlocked(profile, 'level2'), false);
  assert.equal(isRunStartAvailable(profile, 'level2', 'beginning'), true);
  assert.equal(isRunStartAvailable(profile, 'level2', 'checkpoint'), false);
  profile.levelProgress.level2.sector3CheckpointUnlocked = true;
  assert.equal(isRunStartAvailable(profile, 'level2', 'checkpoint'), true);
});

test('Level 4 access requires Level 3 completion and its checkpoint requires the Sector 3 milestone', () => {
  const profile = defaultProfile();
  assert.deepEqual(profile.completedLevels, []);
  assert.ok(MILESTONES.includes('level4'));
  assert.ok(MILESTONES.includes('level4,sector3'));
  assert.ok(MILESTONES.includes('level4,sector4'));
  assert.equal(isLevelUnlocked(profile, 'level4'), false);
  assert.equal(isRunStartAvailable(profile, 'level4', 'beginning'), false);

  profile.completedLevels = ['level3'];
  assert.equal(isLevelUnlocked(profile, 'level4'), true);
  assert.equal(isRunStartAvailable(profile, 'level4', 'beginning'), true);
  assert.equal(isCheckpointUnlocked(profile, 'level4'), false);
  assert.equal(isRunStartAvailable(profile, 'level4', 'checkpoint'), false);
  assert.deepEqual(normalizeProfile({...profile, completedLevels: ['level3', 'invalid']}).completedLevels,
    ['level3']);

  profile.milestones.push('level4,sector3');
  assert.equal(isCheckpointUnlocked(profile, 'level4'), true);
  assert.equal(isRunStartAvailable(profile, 'level4', 'checkpoint'), true);
});

test('campaign completion unlocks the next implemented level in sequence', () => {
  const initial = defaultProfile();
  const level2Start = {...initial, completedLevels: ['level1'], levelProgress: {
    ...initial.levelProgress,
    level2: {...initial.levelProgress.level2, unlocked: true},
  }};
  const level2Finish = settleRun(level2Start, createRunEconomy({
    levelId: 'level2', fullStart: true,
  }), [], ROUTES.level2.finishDistanceMeters, true, true).profile;
  assert.equal(isRunStartAvailable(level2Finish, 'level3', 'beginning'), true);

  const level3Finish = settleRun(level2Finish, createRunEconomy({
    levelId: 'level3', fullStart: true,
  }), [], ROUTES.level3.finishDistanceMeters, true, true).profile;
  assert.equal(isLevelUnlocked(level3Finish, 'level4'), true);
  assert.equal(isRunStartAvailable(level3Finish, 'level4', 'beginning'), true);
});

test('continuous unlock is global after Level 1 and never a per-level Overdrive start', () => {
  const profile = defaultProfile();
  assert.equal(isRunStartAvailable(profile, 'level1', 'beginning', 'continuous'), false);
  profile.levelProgress.level1.completed = true;
  assert.equal(isRunStartAvailable(profile, 'level1', 'beginning', 'continuous'), true);
  assert.equal(isRunStartAvailable(profile, 'level1', 'checkpoint', 'continuous'), false);
  assert.equal(isRunStartAvailable(profile, 'level1', 'beginning', 'overdrive'), false);
  assert.equal(isRunStartAvailable(profile, 'level1', 'checkpoint', 'overdrive'), false);
  assert.equal(isRunStartAvailable(profile, 'level2', 'beginning', 'overdrive'), false);
  profile.levelProgress.level2.unlocked = true;
  profile.levelProgress.level2.completed = true;
  assert.equal(isRunStartAvailable(profile, 'level2', 'beginning', 'continuous'), false);
  assert.equal(isRunStartAvailable(profile, 'level2', 'beginning', 'overdrive'), false);
});

test('normal reward previews match completion payout and full-start record eligibility', () => {
  const profile = defaultProfile();
  const firstFullRun = normalRunRewardPreview(profile, 'level1', 'beginning');
  const firstCheckpoint = normalRunRewardPreview(profile, 'level1', 'checkpoint');
  const {firstCoins, repeatCoins} = GAME_BALANCE.rewards.levelCompletion;
  assert.equal(firstFullRun.completionCoins, firstCoins);
  assert.equal(firstFullRun.firstCompletion, true);
  assert.equal(firstFullRun.fullStartRecordEligible, true);
  assert.equal(firstFullRun.level1NoDamageGold.implemented, true);
  assert.equal(firstFullRun.level1NoDamageGold.eligibleStart, true);
  assert.equal(firstFullRun.level1NoDamageGold.alreadyEarned, false);
  assert.equal(firstCheckpoint.completionCoins, firstCoins);
  assert.equal(firstCheckpoint.fullStartRecordEligible, false);
  assert.equal(firstCheckpoint.level1NoDamageGold.eligibleStart, false);
  assert.equal(normalRunRewardPreview({...profile, selectedVehicleId: 'swift'}, 'level1', 'beginning')
    .level1NoDamageGold.eligibleStart, false);
  profile.levelProgress.level1.completed = true;
  const repeat = normalRunRewardPreview(profile, 'level1', 'beginning');
  assert.equal(repeat.completionCoins, repeatCoins);
  assert.equal(repeat.firstCompletion, false);
});
