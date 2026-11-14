import {cargoTotals} from './cargo.js';
import {crashReward, routeFinishDistance} from './economy.js';
import {addMilestones, depotMilestoneId} from './modules.js';
import {difficultyStepAtDistance, sectorAtDistance} from './sectors.js';
import {GAME_BALANCE} from '../data/gameBalance.js';
import {isDeveloperRun} from './developerRuns.js';
import {recordSectorProgress} from './progression.js';

const {depot} = GAME_BALANCE.routes;
const NO_DAMAGE_RULES = GAME_BALANCE.rewards.noDamageCargo;
const RECORD_REWARDS = GAME_BALANCE.rewards.levelRecord;
const COMPLETION_REWARDS = GAME_BALANCE.rewards.levelCompletion;
let generatedRunSequence = 0;
export const DEPOT_ECONOMY = Object.freeze({
  riskStep: depot.normalSkipBonusStep,
  riskCap: depot.normalSkipBonusCap,
  riskStepPercent: Math.round(depot.normalSkipBonusStep * 100),
  riskCapPercent: Math.round(depot.normalSkipBonusCap * 100),
  repairBase: depot.repair.baseCoins,
  repairSectorStep: depot.repair.sectorStepCoins,
  repairRunStep: depot.repair.priorRunRepairStepCoins,
  repairHullRestored: depot.repair.hullRestored,
});

export function normalRunRewardPreview(profile, levelId, start = 'beginning') {
  if (!GAME_BALANCE.progression.levelIds.includes(levelId) ||
      !['beginning', 'checkpoint'].includes(start)) {
    throw new Error('Invalid normal run reward preview request');
  }
  const level = profile.levelProgress[levelId];
  const goldRules = GAME_BALANCE.rewards.level1NoDamageGold;
  return Object.freeze({
    completionCoins: level.completed ? COMPLETION_REWARDS.repeatCoins : COMPLETION_REWARDS.firstCoins,
    firstCompletion: !level.completed,
    fullStartRecordEligible: start === 'beginning' && RECORD_REWARDS.fullStartOnly,
    noDamageCargoMultiplier: NO_DAMAGE_RULES.multiplier,
    noDamageAfterPassedDepots: NO_DAMAGE_RULES.eligibleAfterPassedDepots,
    level1NoDamageGold: Object.freeze({
      implemented: goldRules.implemented,
      eligibleStart: levelId === goldRules.levelId && start === 'beginning' &&
        goldRules.startingSector === 1 && profile.selectedVehicleId === goldRules.vehicleId,
      alreadyEarned: profile.shipStates?.[goldRules.vehicleId]?.ownedColorIds?.includes(goldRules.colorId) ?? false,
    }),
  });
}

export const createRunEconomy = (metadata = {}) => ({
  runId: metadata.runId ?? `local-run-${++generatedRunSequence}`,
  levelId: metadata.levelId ?? 'level1',
  mode: metadata.mode ?? 'normal',
  vehicleId: metadata.vehicleId ?? 'standard',
  developerRun: isDeveloperRun(metadata),
  startDistance: metadata.startDistance ?? 0,
  fullStart: metadata.fullStart ?? false,
  checkpointStart: metadata.checkpointStart ?? false,
  recordAtStart: metadata.recordAtStart ?? 0,
  checkpointRecordAtStart: metadata.checkpointRecordAtStart ?? 0,
  depotsReached: 0, depotsSkipped: 0, consecutiveSkips: 0, bankingEvents: 0,
  cargoCoins: 0, bonusCoins: 0, distanceCoins: 0, otherCoins: 0,
  recordCoins: 0, completionCoins: 0, noDamageCoins: 0, noDamageBonusPending: 0,
  continuousPassedDepots: 0,
  closeCallBonusPercent: 0,
  damagingHits: metadata.damagingHits ?? 0, repairPurchases: 0, repairCosts: 0,
});

export function riskBonusPercent(run) {
  return Math.round(Math.min(DEPOT_ECONOMY.riskCap, run.consecutiveSkips * DEPOT_ECONOMY.riskStep) * 100);
}

export function closeCallBonusPercent(run) {
  const percent = run.closeCallBonusPercent ?? 0;
  if (!Number.isInteger(percent) || percent < 0 ||
      percent > GAME_BALANCE.physics.collision.closeCall.maximumBonusPercent) {
    throw new Error('Invalid close-call bonus state');
  }
  return percent;
}

export function awardCloseCall(run, items) {
  const percent = closeCallBonusPercent(run);
  if (cargoTotals(items).value === 0 ||
      percent === GAME_BALANCE.physics.collision.closeCall.maximumBonusPercent) return {run, awarded: false};
  return {run: {...run, closeCallBonusPercent: Math.min(
    GAME_BALANCE.physics.collision.closeCall.maximumBonusPercent,
    percent + GAME_BALANCE.physics.collision.closeCall.bonusStepPercent)}, awarded: true};
}

export function bankingQuote(items, run) {
  const cargo = cargoTotals(items).value;
  const bonusFraction = Math.min(DEPOT_ECONOMY.riskCap, run.consecutiveSkips * DEPOT_ECONOMY.riskStep);
  const percent = Math.round(bonusFraction * 100);
  const closeCallPercent = closeCallBonusPercent(run);
  const closeCallBonus = Math.floor(cargo * closeCallPercent / 100);
  const depotPayout = Math.floor(cargo * (1 + bonusFraction));
  const payout = depotPayout + closeCallBonus;
  const bonus = payout - cargo;
  const multipliedPayout = Math.floor(cargo * (1 + bonusFraction) * NO_DAMAGE_RULES.multiplier);
  return {cargo, percent, bonus, payout, closeCallPercent, closeCallBonus,
    noDamageBonus: multipliedPayout - depotPayout};
}

export function skipDepot(run) {
  return {...run, depotsSkipped: run.depotsSkipped + 1, consecutiveSkips: run.consecutiveSkips + 1};
}

export function continuousQuote(items, run) {
  const cargo = cargoTotals(items).value;
  const percent = Math.round(Math.min(GAME_BALANCE.rewards.continuous.maximumBonus,
    run.continuousPassedDepots * GAME_BALANCE.rewards.continuous.skipBonusPerDepot) * 100);
  const closeCallPercent = closeCallBonusPercent(run);
  const closeCallBonus = Math.floor(cargo * closeCallPercent / 100);
  return {cargo, percent, closeCallPercent, closeCallBonus,
    bonus: Math.floor(cargo * (percent / 100)) + closeCallBonus,
    payout: Math.floor(cargo * (1 + percent / 100)) + closeCallBonus};
}

export function passContinuousDepot(run) {
  return {...run, depotsSkipped: run.depotsSkipped + 1,
    continuousPassedDepots: run.continuousPassedDepots + 1};
}

/** Candidates are applied by the scene only after their complete profile is saved. */
export function bankCargo(profile, run, items) {
  if (run.mode === 'continuous') throw new Error('Continuous cargo can only be banked by terminal cash-out');
  const quote = bankingQuote(items, run);
  // Developer runs exercise the Depot flow but never pay the wallet or record milestones.
  const developer = isDeveloperRun(run);
  const milestone = quote.cargo > 0 && !developer
    ? addMilestones(profile, [depotMilestoneId(run.levelId ?? 'level1')]) : {profile, added: []};
  return {
    profile: developer ? profile : {...milestone.profile, coins: profile.coins + quote.payout},
    run: {...run, consecutiveSkips: 0, closeCallBonusPercent: 0,
      bankingEvents: run.bankingEvents + (quote.cargo > 0 ? 1 : 0),
      cargoCoins: run.cargoCoins + quote.cargo, bonusCoins: run.bonusCoins + quote.bonus,
      noDamageBonusPending: run.noDamageBonusPending +
        (run.depotsReached >= NO_DAMAGE_RULES.eligibleAfterPassedDepots ? quote.noDamageBonus : 0)},
    items: [], added: milestone.added, quote,
  };
}

/** Repair scales with campaign difficulty and prior repair purchases. */
export function repairPrice(distance, run) {
  const step = difficultyStepAtDistance(distance, run.levelId ?? 'level1', run.mode ?? 'normal');
  return DEPOT_ECONOMY.repairBase + step * DEPOT_ECONOMY.repairSectorStep +
    run.repairPurchases * DEPOT_ECONOMY.repairRunStep;
}

export function repairOffer(profile, run, visit, hull, maxHull, distance) {
  if (run.mode === 'continuous') return {cost: 0, reason: 'Continuous Run has no repair service', enabled: false};
  const cost = isDeveloperRun(run) ? 0 : repairPrice(distance, run);
  const reason = visit.repaired ? 'Repair used at this Depot'
    : hull >= maxHull ? 'Hull already full'
    : profile.coins < cost ? `Need ${cost - profile.coins} more Coins` : '';
  return {cost, reason, enabled: !reason};
}

export function purchaseRepair(profile, run, visit, hull, maxHull, distance) {
  const offer = repairOffer(profile, run, visit, hull, maxHull, distance);
  if (!offer.enabled) return {ok: false, reason: offer.reason};
  return {ok: true, profile: {...profile, coins: profile.coins - offer.cost},
    run: {...run, repairPurchases: run.repairPurchases + 1, repairCosts: run.repairCosts + offer.cost},
    visit: {...visit, repaired: true}, hull: hull + DEPOT_ECONOMY.repairHullRestored, cost: offer.cost};
}

export function runEconomySummary(run, distance, reason) {
  const secured = run.cargoCoins + run.bonusCoins;
  const gross = secured + run.distanceCoins + run.otherCoins + run.recordCoins +
    run.completionCoins + run.noDamageCoins;
  return {...run, secured, gross, net: gross - run.repairCosts, distance: Math.floor(distance), reason};
}

export function settleRun(profile, run, items, distance, banked, completed = false) {
  if (!run.runId || !Number.isFinite(distance) || distance < 0) {
    throw new Error('Run settlement requires a run ID and valid distance');
  }
  const settledRunIds = profile.settledRunIds ?? [];
  if (settledRunIds.includes(run.runId)) {
    return {duplicate: true, profile, run, added: [], quote: {cargo: 0, bonus: 0, payout: 0},
      cargoLost: 0, summary: null};
  }
  if (isDeveloperRun(run)) {
    const settledRun = {...run, cargoCoins: 0, bonusCoins: 0, distanceCoins: 0, otherCoins: 0,
      recordCoins: 0, completionCoins: 0, noDamageCoins: 0, repairCosts: 0};
    return {
      profile,
      run: settledRun,
      added: [],
      quote: {cargo: 0, bonus: 0, payout: 0},
      cargoLost: 0,
      goldUnlocked: false,
      summary: {...runEconomySummary(settledRun, distance, 'Developer run ended'),
        secured: 0, gross: 0, net: 0},
    };
  }
  if (!GAME_BALANCE.progression.levelIds.includes(run.levelId)) {
    throw new Error(`Unknown level in run settlement: ${run.levelId}`);
  }
  if (run.levelId === 'level2' && !profile.levelProgress.level2.unlocked) {
    throw new Error('Level 2 is locked until Level 1 is complete');
  }
  if (!['normal', 'continuous'].includes(run.mode)) throw new Error(`Unknown run mode ${run.mode}`);
  if (run.mode === 'continuous') {
    if (run.levelId !== 'level1' || !profile.levelProgress.level1.completed) {
      throw new Error('Continuous Run is locked until Level 1 is complete');
    }
    if (completed) throw new Error('Continuous Run cannot complete a campaign level');
    const hold = cargoTotals(items).value;
    const retained = Math.floor(hold * GAME_BALANCE.rewards.continuous.wreckRetention);
    const quote = banked ? continuousQuote(items, run)
      : {cargo: 0, bonus: 0, payout: 0, percent: 0};
    const settledRun = {...run,
      cargoCoins: quote.cargo,
      bonusCoins: banked ? quote.bonus : 0,
      distanceCoins: 0, otherCoins: 0, recordCoins: 0, completionCoins: 0, noDamageCoins: 0,
      repairCosts: 0};
    const summary = runEconomySummary(settledRun, distance, banked ? 'Continuous cash-out' : 'Continuous cargo forfeited');
    const nextRunIds = [...settledRunIds.filter(id => id !== run.runId), run.runId];
    return {
      profile: {...profile, coins: profile.coins + quote.payout,
        totalRuns: profile.totalRuns + 1,
        settledRunIds: nextRunIds},
      run: settledRun, added: [], quote, cargoLost: banked ? 0 : hold - retained,
      summary,
    };
  }
  if (completed && distance < routeFinishDistance(run.levelId)) {
    throw new Error(`${run.levelId} cannot be completed before its finish distance`);
  }
  profile = recordSectorProgress(profile, run.levelId, distance, run.startDistance);
  const bank = banked ? bankCargo(profile, run, items)
    : {profile, run, added: [], quote: {cargo: 0, bonus: 0, payout: 0}};
  const distanceCoins = banked ? 0 : crashReward(distance);
  const noDamageCoins = banked && bank.run.depotsReached >= NO_DAMAGE_RULES.eligibleAfterPassedDepots &&
    bank.run.damagingHits === 0 ? bank.run.noDamageBonusPending : 0;
  const level = profile.levelProgress[run.levelId];
  const progressDistance = run.checkpointStart ? Math.max(0, Math.floor(distance - run.startDistance))
    : Math.floor(distance);
  const comparisonScore = Math.floor(progressDistance);
  const oldRecord = run.checkpointStart ? (run.checkpointRecordAtStart ?? level.checkpointBestDistance)
    : run.fullStart ? (run.recordAtStart ?? level.bestDistance) : Infinity;
  const newRecord = comparisonScore > oldRecord;
  const reachedSector = sectorAtDistance(distance, run.levelId).number;
  const recordCoins = run.fullStart && newRecord
    ? reachedSector === 1 ? RECORD_REWARDS.sector1
      : reachedSector <= 3 ? RECORD_REWARDS.sectors2to3 : RECORD_REWARDS.sectors4to5
    : 0;
  const completionCoins = completed
    ? level.completed ? COMPLETION_REWARDS.repeatCoins : COMPLETION_REWARDS.firstCoins
    : 0;
  const goldRule = GAME_BALANCE.rewards.level1NoDamageGold;
  const goldUnlocked = completed && goldRule.implemented && run.levelId === goldRule.levelId &&
    run.fullStart && run.startDistance === 0 && run.vehicleId === goldRule.vehicleId &&
    run.damagingHits === 0 &&
    !profile.shipStates[goldRule.vehicleId].ownedColorIds.includes(goldRule.colorId);
  const updatedLevel = {
    ...level,
    completed: level.completed || completed,
    bestDistance: run.fullStart ? Math.max(level.bestDistance, comparisonScore) : level.bestDistance,
    checkpointBestDistance: !run.checkpointStart ? level.checkpointBestDistance
      : Math.max(level.checkpointBestDistance, progressDistance),
  };
  const levelProgress = {...profile.levelProgress, [run.levelId]: updatedLevel};
  if (run.levelId === 'level1' && completed && levelProgress.level2) {
    levelProgress.level2 = {...levelProgress.level2, unlocked: true};
  }
  if (run.levelId === 'level2' && completed && levelProgress.level3) {
    levelProgress.level3 = {...levelProgress.level3, unlocked: true};
  }
  const settledRun = {
    ...bank.run,
    distanceCoins: bank.run.distanceCoins + distanceCoins,
    recordCoins: bank.run.recordCoins + recordCoins,
    completionCoins: bank.run.completionCoins + completionCoins,
    noDamageCoins: bank.run.noDamageCoins + noDamageCoins,
  };
  const nextRunIds = [...settledRunIds.filter(id => id !== run.runId), run.runId];
  const shipStates = goldUnlocked ? {
    ...bank.profile.shipStates,
    [goldRule.vehicleId]: {
      ...bank.profile.shipStates[goldRule.vehicleId],
      ownedColorIds: [...bank.profile.shipStates[goldRule.vehicleId].ownedColorIds, goldRule.colorId],
    },
  } : bank.profile.shipStates;
  return {
    profile: {...bank.profile, shipStates,
      coins: bank.profile.coins + distanceCoins + recordCoins + completionCoins + noDamageCoins,
      completedLevels: completed
        ? [...new Set([...(bank.profile.completedLevels ?? []), run.levelId])]
        : bank.profile.completedLevels ?? [],
      bestDistance: run.checkpointStart ? profile.bestDistance
        : Math.max(profile.bestDistance, Math.floor(distance)),
      totalRuns: profile.totalRuns + 1, levelProgress, settledRunIds: nextRunIds},
    run: settledRun, added: bank.added, quote: bank.quote,
    cargoLost: banked ? 0 : cargoTotals(items).value,
    goldUnlocked,
    summary: runEconomySummary(settledRun, distance, completed ? 'Level complete'
      : banked ? 'Bank & Finish' : 'Hull destroyed'),
  };
}
