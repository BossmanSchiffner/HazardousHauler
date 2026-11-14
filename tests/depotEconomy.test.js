import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bankCargo, bankingQuote, createRunEconomy, DEPOT_ECONOMY, continuousQuote, passContinuousDepot,
  purchaseRepair, repairOffer, repairPrice, riskBonusPercent, runEconomySummary, settleRun, skipDepot,
} from '../src/game/core/depotEconomy.js';
import {defaultProfile, normalizeProfile, SCHEMA_VERSION} from '../src/game/core/save.js';
import {collectCargo, cargoTotals} from '../src/game/core/cargo.js';
import {routeFinishDistance, steeringMultiplier} from '../src/game/core/economy.js';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';

const coin = value => ({kind: 'coin', value, mass: 1, slots: 1});
const LEVEL_FINISH_DISTANCE = routeFinishDistance('level1');
const L1 = GAME_BALANCE.routes.level1;
const L2 = GAME_BALANCE.routes.level2;
const REWARDS = GAME_BALANCE.rewards;
const CONTINUOUS = REWARDS.continuous;
const {normalSkipBonusStep, normalSkipBonusCap, repair: REPAIR} = GAME_BALANCE.routes.depot;
const {firstCoins: FIRST_COMPLETION, repeatCoins: REPEAT_COMPLETION} = REWARDS.levelCompletion;
const SECTOR1_VISIT = L1.sectorStartsMeters[1] - 50;
const percentOf = fraction => Math.round(fraction * 100);
const skipPercent = skips => percentOf(Math.min(normalSkipBonusCap, skips * normalSkipBonusStep));
const skipBonus = (cargo, skips) => Math.floor(cargo * skipPercent(skips) / 100);
const noDamageBonus = (cargo, skips) => Math.floor(cargo * (1 + skipPercent(skips) / 100) *
  REWARDS.noDamageCargo.multiplier) - (cargo + skipBonus(cargo, skips));
const repairBase = sector => REPAIR.baseCoins + REPAIR.sectorStepCoins * (sector - 1);
const crashCoins = distance => Math.min(REWARDS.crash.maxCoins,
  REWARDS.crash.baseCoins + REWARDS.crash.stepCoins * Math.floor(distance / REWARDS.crash.stepDistanceMeters));

test('approved crash consolation cap is 50 Coins', () => {
  assert.equal(REWARDS.crash.maxCoins, 50);
});

test('risk grows 0/20/40/60 percent, caps, and pays only the current hold once', () => {
  let run = createRunEconomy();
  for (let skips = 0; skips < 6; skips++) {
    const percent = skipPercent(skips);
    assert.equal(riskBonusPercent(run), percent);
    assert.deepEqual(bankingQuote([coin(55)], run), {
      cargo: 55, percent, bonus: skipBonus(55, skips),
      closeCallPercent: 0, closeCallBonus: 0,
      payout: 55 + skipBonus(55, skips),
      noDamageBonus: noDamageBonus(55, skips),
    });
    run = skipDepot(run);
  }
  assert.equal(skipPercent(6), percentOf(normalSkipBonusCap), 'risk bonus is capped');
  const profile = {...defaultProfile(), coins: 100};
  const bank = bankCargo(profile, run, [coin(55)]);
  const cappedPayout = 55 + skipBonus(55, 6);
  assert.equal(bank.profile.coins, profile.coins + cappedPayout);
  assert.equal(bank.run.consecutiveSkips, 0);
  assert.equal(bank.run.bankingEvents, 1);
  assert.ok(bank.profile.milestones.includes('level1,depot1'));
  assert.deepEqual(bank.items, []);
  assert.equal(cargoTotals(bank.items).mass, 0);
  assert.ok(steeringMultiplier(0, 11) > steeringMultiplier(11, 11));
  const duplicate = bankCargo(bank.profile, bank.run, bank.items);
  assert.equal(duplicate.profile.coins, bank.profile.coins);
  assert.equal(duplicate.run.bankingEvents, 1);
  assert.equal(profile.coins, 100, 'candidate does not mutate its source profile');
});

test('banking rounds fractional bonus Coins down; cargo replacement counts only final ledger value', () => {
  const items = [coin(5), coin(5)];
  const replacement = collectCargo(items, coin(20), 2);
  assert.ok(replacement.accepted && replacement.replaced);
  assert.equal(bankingQuote(replacement.items, skipDepot(createRunEconomy())).payout, 30);
  assert.equal(bankingQuote([coin(7)], skipDepot(createRunEconomy())).payout, 8);
});

test('repair costs follow configured sector and run scaling, not permanent upgrade prices', () => {
  const run = createRunEconomy();
  const priorRepairs = 2;
  for (const [levelId, route] of [['level1', L1], ['level2', L2]]) {
    const [, sector2, sector3, sector4] = route.sectorStartsMeters;
    for (const [distance, base] of [[sector2 - 1, repairBase(1)], [sector2, repairBase(2)], [sector3, repairBase(3)],
      [sector4, repairBase(4)], [route.finishDistanceMeters - 1, repairBase(4)]]) {
      const levelRun = {...run, levelId};
      assert.equal(repairPrice(distance, levelRun), base, `${levelId} ${distance} m uses its own sector boundaries`);
      assert.equal(repairPrice(distance, {...levelRun, repairPurchases: priorRepairs}),
        base + priorRepairs * REPAIR.priorRunRepairStepCoins);
    }
  }
  const continuous = createRunEconomy({mode: 'continuous'});
  assert.equal(repairOffer(defaultProfile(), continuous, {repaired: false}, 1, 3, L1.sectorStartsMeters[2]).enabled, false);
  assert.equal(purchaseRepair(defaultProfile(), continuous, {repaired: false}, 1, 3, L1.sectorStartsMeters[2]).ok, false);
  assert.equal(DEPOT_ECONOMY.repairRunStep, REPAIR.priorRunRepairStepCoins);
});

test('repairs restore one current hull and are limited to one purchase per normal run', () => {
  const profile = {...defaultProfile(), coins: 100};
  const before = JSON.stringify(profile);
  const run = createRunEconomy();
  const visit = {distance: SECTOR1_VISIT, repaired: false};
  const repair = purchaseRepair(profile, run, visit, 1, 3, SECTOR1_VISIT);
  assert.ok(repair.ok);
  assert.equal(repair.hull, 1 + REPAIR.hullRestored);
  assert.equal(repair.profile.coins, profile.coins - repairBase(1));
  assert.equal(repair.run.repairCosts, repairBase(1));
  assert.equal(repair.run.repairPurchases, 1);
  assert.deepEqual(repair.profile.ownedModules, profile.ownedModules);
  assert.equal(JSON.stringify(profile), before);
  assert.equal(visit.repaired, false);
  assert.ok(!purchaseRepair(repair.profile, repair.run, repair.visit, repair.hull, 3, SECTOR1_VISIT).ok);
  const laterVisit = {distance: L1.sectorStartsMeters[2], repaired: false};
  const exhausted = purchaseRepair(repair.profile, repair.run, laterVisit, 1, 3, laterVisit.distance);
  assert.equal(exhausted.ok, false, 'a new Depot does not restore the run repair allowance');
  assert.match(exhausted.reason, /one repair used this run/i);
  assert.equal(repairOffer(repair.profile, repair.run, laterVisit, 1, 3, laterVisit.distance).enabled, false);
  assert.ok(!repairOffer(profile, run, visit, 3, 3, SECTOR1_VISIT).enabled);
  assert.ok(!repairOffer({...profile, coins: repairBase(1) - 1}, run, visit, 1, 3, SECTOR1_VISIT).enabled);
  const exact = purchaseRepair({...profile, coins: repairBase(1)}, createRunEconomy(), visit, 2, 3, SECTOR1_VISIT);
  assert.equal(exact.profile.coins, 0);
  assert.equal(exact.hull, 3);
  assert.equal(createRunEconomy().repairPurchases, 0, 'a fresh run has a fresh repair allowance');
});

test('bank-repair-finish and bank-repair-crash settle only outstanding rewards', () => {
  const profile = {...defaultProfile(), coins: 10};
  const bank = bankCargo(profile, skipDepot(createRunEconomy()), [coin(55)]);
  const repair = purchaseRepair(bank.profile, bank.run, {repaired: false}, 1, 3, SECTOR1_VISIT);
  assert.ok(repair.ok, 'newly banked Coins fund this repair');
  const payout = 55 + skipBonus(55, 1);
  const finished = settleRun(repair.profile, repair.run, [], SECTOR1_VISIT, true);
  assert.equal(finished.profile.coins, profile.coins + payout - repairBase(1));
  assert.equal(finished.summary.net, payout - repairBase(1));
  assert.equal(finished.summary.gross, payout);
  assert.equal(finished.summary.distanceCoins, 0);
  assert.equal(finished.summary.repairCosts, repairBase(1));
  const crashDistance = L1.sectorStartsMeters[1] + 100;
  const crashed = settleRun(repair.profile, repair.run, [coin(100)], crashDistance, false);
  assert.equal(crashed.profile.coins, profile.coins + payout - repairBase(1) + crashCoins(crashDistance));
  assert.equal(crashed.summary.distanceCoins, crashCoins(crashDistance));
  assert.equal(crashed.summary.cargoCoins, 55);
  assert.equal(crashed.summary.bonusCoins, skipBonus(55, 1));
  assert.equal(crashed.cargoLost, 100);
  assert.equal(crashed.summary.net, payout + crashCoins(crashDistance) - repairBase(1));
});

test('crashes never multiply cargo, distance or unrelated awards; net may be negative', () => {
  const run = {...createRunEconomy(), consecutiveSkips: 100, otherCoins: 35, repairCosts: 90};
  const result = settleRun({...defaultProfile(), coins: 200}, run, [coin(1000)], LEVEL_FINISH_DISTANCE, false);
  const expectedCrashCoins = crashCoins(LEVEL_FINISH_DISTANCE);
  assert.equal(result.profile.coins, 200 + expectedCrashCoins);
  assert.equal(result.summary.bonusCoins, 0);
  assert.equal(result.summary.gross, run.otherCoins + expectedCrashCoins);
  assert.equal(result.summary.net, run.otherCoins + expectedCrashCoins - run.repairCosts);
  assert.ok(result.summary.net < 0, 'net may be negative');
  assert.equal(runEconomySummary(run, SECTOR1_VISIT, 'running').net, run.otherCoins - run.repairCosts);
});

test('wallet transactions reload on existing schema without replayable run/cargo state', () => {
  const old = {...defaultProfile(), coins: 90, bestDistance: 1047, totalRuns: 1};
  const bank = bankCargo(old, createRunEconomy(), [coin(55)]);
  const reload = normalizeProfile(JSON.parse(JSON.stringify(bank.profile)));
  assert.equal(reload.schemaVersion, SCHEMA_VERSION);
  assert.equal(reload.coins, old.coins + 55);
  assert.equal(reload.bestDistance, old.bestDistance);
  assert.equal(reload.totalRuns, 1, 'mid-run banking is not a completed run');
  assert.equal(reload.runEconomy, undefined);
  assert.equal(reload.cargoItems, undefined);
  assert.equal(bankCargo(reload, createRunEconomy(), []).profile.coins, reload.coins);
});

test('multiple banking events and a later finish reconcile gross, net and initial wallet', () => {
  const initial = {...defaultProfile(), coins: 100};
  const first = bankCargo(initial, skipDepot(createRunEconomy()), [coin(55)]);
  const repair = purchaseRepair(first.profile, first.run, {repaired: false}, 1, 3, SECTOR1_VISIT);
  const next = bankCargo(repair.profile, skipDepot(repair.run), [coin(100)]);
  const secondRepair = purchaseRepair(next.profile, next.run, {repaired: false}, 1, 3, L1.sectorStartsMeters[2]);
  assert.equal(secondRepair.ok, false, 'banking and continuing preserves the one-repair run allowance');
  const final = settleRun(next.profile, next.run, [coin(20)], LEVEL_FINISH_DISTANCE, true);
  const bonusCoins = skipBonus(55, 1) + skipBonus(100, 1);
  const repairCosts = repairBase(1);
  assert.equal(final.run.bankingEvents, 3);
  assert.equal(final.run.cargoCoins, 55 + 100 + 20);
  assert.equal(final.run.bonusCoins, bonusCoins);
  assert.equal(final.run.repairCosts, repairCosts);
  assert.equal(final.profile.coins, initial.coins + final.summary.net);
  assert.equal(final.summary.net, 55 + 100 + 20 + bonusCoins - repairCosts);
  assert.equal(final.profile.totalRuns, 1);
});

test('normal finish rewards one eligible full-start record and level completion exactly once', () => {
  const profile = defaultProfile();
  const run = createRunEconomy({runId: 'level1-first-finish', fullStart: true, recordAtStart: 0});
  const first = settleRun(profile, run, [coin(20)], LEVEL_FINISH_DISTANCE, true, true);
  assert.equal(first.run.recordCoins, REWARDS.levelRecord.sectors4to5);
  assert.equal(first.run.completionCoins, FIRST_COMPLETION);
  assert.equal(first.run.noDamageCoins, 0, 'no-damage requires two passed Depots');
  assert.equal(first.profile.coins, 20 + REWARDS.levelRecord.sectors4to5 + FIRST_COMPLETION);
  assert.equal(first.profile.levelProgress.level1.completed, true);
  assert.equal(first.profile.levelProgress.level2.unlocked, true);
  assert.equal(first.profile.totalRuns, 1);
  const duplicate = settleRun(first.profile, run, [coin(20)], LEVEL_FINISH_DISTANCE, true, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.profile.coins, first.profile.coins);
  assert.equal(duplicate.profile.totalRuns, 1);

  const repeat = settleRun(first.profile,
    createRunEconomy({runId: 'level1-repeat-finish', fullStart: true, recordAtStart: LEVEL_FINISH_DISTANCE}),
    [], LEVEL_FINISH_DISTANCE, true, true);
  assert.equal(repeat.run.recordCoins, 0, 'equal scores are not new records');
  assert.equal(repeat.run.completionCoins, REPEAT_COMPLETION);
  assert.equal(repeat.profile.coins, first.profile.coins + REPEAT_COMPLETION);
});

test('Gold Standard is awarded only for a clean Sector 1 start in Standard Hauler', () => {
  const clean = settleRun(defaultProfile(), createRunEconomy({
    runId: 'gold-standard-clean', levelId: 'level1', mode: 'normal', vehicleId: 'standard',
    startDistance: 0, fullStart: true, damagingHits: 0,
  }), [], LEVEL_FINISH_DISTANCE, true, true);
  assert.equal(clean.goldUnlocked, true);
  assert.ok(clean.profile.shipStates.standard.ownedColorIds.includes('gold'));
  assert.equal(settleRun(clean.profile, createRunEconomy({
    runId: 'gold-standard-repeat', vehicleId: 'standard', fullStart: true,
  }), [], LEVEL_FINISH_DISTANCE, true, true).goldUnlocked, false);

  const base = defaultProfile();
  const level2Unlocked = {...base, ownedVehicleIds: ['standard', 'swift'],
    levelProgress: {...base.levelProgress, level1: {...base.levelProgress.level1, completed: true},
      level2: {...base.levelProgress.level2, unlocked: true}},
    shipStates: {...base.shipStates, swift: {unlockedSlotCount: 3, equippedModuleIds: [],
      ownedColorIds: ['default'], equippedColorId: 'default'}}};
  const ineligible = [
    {runId: 'gold-damaged', vehicleId: 'standard', fullStart: true, damagingHits: 1},
    {runId: 'gold-checkpoint', vehicleId: 'standard', fullStart: false, checkpointStart: true, startDistance: L1.sectorStartsMeters[2]},
    {runId: 'gold-swift', vehicleId: 'swift', fullStart: true},
    {runId: 'gold-level2', vehicleId: 'standard', levelId: 'level2', fullStart: true},
  ];
  for (const [index, run] of ineligible.entries()) {
    const profile = run.vehicleId === 'swift' || run.levelId === 'level2' ? level2Unlocked : base;
    const finished = settleRun(profile, createRunEconomy({...run, runId: run.runId}),
      [], routeFinishDistance(run.levelId ?? 'level1'), true, true);
    assert.equal(finished.goldUnlocked, false, run.runId);
    assert.equal(finished.profile.shipStates.standard.ownedColorIds.includes('gold'), false);
  }
});

test('Level 2 completion, records and repeat awards are independent from Level 1', () => {
  const base = defaultProfile();
  const profile = {
    ...base,
    coins: 80,
    levelProgress: {
      ...base.levelProgress,
      level1: {...base.levelProgress.level1, completed: true, bestDistance: LEVEL_FINISH_DISTANCE},
      level2: {...base.levelProgress.level2, unlocked: true},
    },
  };
  const first = settleRun(profile,
    createRunEconomy({runId: 'level2-first-finish', levelId: 'level2', fullStart: true, recordAtStart: 0}),
    [], routeFinishDistance('level2'), true, true);
  assert.equal(first.run.recordCoins, REWARDS.levelRecord.sectors4to5);
  assert.equal(first.run.completionCoins, FIRST_COMPLETION);
  assert.equal(first.profile.coins, profile.coins + REWARDS.levelRecord.sectors4to5 + FIRST_COMPLETION);
  assert.equal(first.profile.levelProgress.level1.bestDistance, LEVEL_FINISH_DISTANCE);
  assert.equal(first.profile.levelProgress.level1.completed, true);
  assert.equal(first.profile.levelProgress.level2.bestDistance, routeFinishDistance('level2'));
  assert.equal(first.profile.levelProgress.level2.completed, true);

  const repeat = settleRun(first.profile,
    createRunEconomy({runId: 'level2-repeat-finish', levelId: 'level2', fullStart: true,
      recordAtStart: routeFinishDistance('level2')}),
    [], routeFinishDistance('level2'), true, true);
  assert.equal(repeat.run.recordCoins, 0);
  assert.equal(repeat.run.completionCoins, REPEAT_COMPLETION);
  assert.equal(repeat.profile.coins, first.profile.coins + REPEAT_COMPLETION);
  assert.throws(() => settleRun(base,
    createRunEconomy({runId: 'locked-level2', levelId: 'level2'}), [], routeFinishDistance('level2'), true, true),
  /Level 2 is locked/);
});

test('continuous Depot banking cashes out current hold once without campaign rewards or retired records', () => {
  const base = defaultProfile();
  const profile = {...base, coins: 90, levelProgress: {
    ...base.levelProgress,
    level1: {...base.levelProgress.level1, completed: true, bestDistance: 8000},
  }};
  let run = createRunEconomy({runId: 'overdrive-exit', levelId: 'level1', mode: 'continuous'});
  run = passContinuousDepot(passContinuousDepot(run));
  const percent = percentOf(2 * CONTINUOUS.skipBonusPerDepot);
  const bonus = Math.floor(55 * percent / 100);
  assert.deepEqual(continuousQuote([coin(55)], run),
    {cargo: 55, percent, bonus, payout: 55 + bonus, closeCallPercent: 0, closeCallBonus: 0});
  const exit = settleRun(profile, run, [coin(55)], 9000, true);
  assert.equal(exit.profile.coins, profile.coins + 55 + bonus);
  assert.equal(exit.profile.endlessBestDistance, 9000);
  assert.equal(exit.run.cargoCoins, 55);
  assert.equal(exit.run.bonusCoins, bonus);
  assert.equal(exit.run.recordCoins, 0);
  assert.equal(exit.run.completionCoins, 0);
  assert.equal(exit.run.distanceCoins, 0);
  assert.deepEqual(exit.profile.levelProgress, profile.levelProgress);
  assert.deepEqual(exit.profile.milestones, profile.milestones);
  assert.equal(exit.run.noDamageCoins, 0);
  assert.equal(exit.profile.levelProgress.level1.bestDistance, 8000);
  assert.equal(exit.profile.levelProgress.level1.completed, true);
  assert.equal(settleRun(exit.profile, run, [coin(55)], 9000, true).duplicate, true);
});

test('continuous crashes forfeit all held cargo and pay no bonus', () => {
  const base = defaultProfile();
  const profile = {...base, coins: 321, levelProgress: {
    ...base.levelProgress,
    level1: {...base.levelProgress.level1, completed: true, bestDistance: LEVEL_FINISH_DISTANCE},
  }};
  const run = passContinuousDepot(createRunEconomy({
    runId: 'continuous-crash', levelId: 'level1', mode: 'continuous',
  }));
  const crash = settleRun(profile, run, [coin(100)], 8400, false);
  assert.equal(crash.profile.coins, profile.coins);
  assert.equal(crash.profile.endlessBestDistance, 8400);
  assert.equal(crash.summary.gross, 0);
  assert.equal(crash.summary.cargoCoins, 0);
  assert.equal(crash.summary.bonusCoins, 0);
  assert.equal(crash.summary.distanceCoins, 0);
  assert.equal(crash.cargoLost, 100);
  assert.deepEqual(crash.profile.levelProgress, profile.levelProgress);
  assert.equal(settleRun(crash.profile, run, [coin(100)], 8400, false).duplicate, true);
  const rounded = settleRun(profile, {...run, runId: 'rounded-retention',
    cargoCoins: 1000, otherCoins: 500}, [coin(103)], 8400, false);
  assert.equal(rounded.profile.coins, profile.coins, 'crashes never cash out the remaining hold');
  assert.equal(rounded.summary.gross, 0);
});

test('Endless records keep the farthest crash or cash-out and ignore Normal and developer runs', () => {
  const base = defaultProfile();
  const profile = {...base, bestDistance: 90000, endlessBestDistance: 1500,
    levelProgress: {...base.levelProgress, level1: {...base.levelProgress.level1, completed: true}}};
  const run = createRunEconomy({runId: 'endless-record', mode: 'continuous'});
  const shorter = settleRun(profile, run, [], 1400, false);
  assert.equal(shorter.profile.endlessBestDistance, 1500);
  const longer = settleRun(profile, run, [], 2500.9, true);
  assert.equal(longer.profile.endlessBestDistance, 2500);
  const campaign = settleRun(longer.profile, createRunEconomy({runId: 'normal-record', fullStart: true}),
    [], 3000, false);
  assert.equal(campaign.profile.endlessBestDistance, 2500);
  assert.equal(campaign.profile.bestDistance, 90000, 'legacy campaign aggregate is no longer recorded');
  const developer = settleRun(profile, {...run, developerRun: true}, [], 99999, false);
  assert.equal(developer.profile.endlessBestDistance, 1500);
});

test('continuous passed-depot bonus is additive and capped at 100 percent, not compounded', () => {
  let run = createRunEconomy({mode: 'continuous'});
  const continuousPercent = count => percentOf(Math.min(CONTINUOUS.maximumBonus, count * CONTINUOUS.skipBonusPerDepot));
  for (let count = 0; count <= 15; count++) {
    const quote = continuousQuote([coin(100)], run);
    assert.equal(quote.percent, continuousPercent(count));
    assert.equal(quote.payout, 100 + continuousPercent(count));
    run = passContinuousDepot(run);
  }
  assert.equal(continuousPercent(15), percentOf(CONTINUOUS.maximumBonus), 'bonus reaches its cap');
  assert.throws(() => settleRun(defaultProfile(), run, [], L1.sectorStartsMeters[2], true), /locked/);
  const unlocked = defaultProfile();
  unlocked.levelProgress.level1.completed = true;
  assert.throws(() => settleRun(unlocked, run, [], LEVEL_FINISH_DISTANCE, true, true), /cannot complete/);
  assert.throws(() => bankCargo(unlocked, run, [coin(100)]), /terminal cash-out/);
  assert.equal(purchaseRepair(unlocked, run, {repaired: false}, 1, 3, L1.sectorStartsMeters[2]).ok, false);
});

test('checkpoint scores exclude skipped distance and never earn the paid full-start record award', () => {
  const profile = {
    ...defaultProfile(),
    bestDistance: 5000,
    levelProgress: {
      ...defaultProfile().levelProgress,
      level1: {...defaultProfile().levelProgress.level1, sector3CheckpointUnlocked: true, bestDistance: 5000},
    },
  };
  const run = createRunEconomy({
    runId: 'level1-checkpoint', startDistance: 2500, checkpointStart: true,
    checkpointRecordAtStart: 0, fullStart: false,
  });
  const result = settleRun(profile, run, [], 3500, false);
  assert.equal(result.run.recordCoins, 0);
  assert.equal(result.profile.levelProgress.level1.bestDistance, 5000);
  assert.equal(result.profile.levelProgress.level1.checkpointBestDistance, 1000);
  assert.equal(result.profile.bestDistance, 5000, 'checkpoint distance does not inflate global progress');
});

test('full-start record awards are based on the furthest sector and require a strictly better score', () => {
  const [, sector2, , sector4] = L1.sectorStartsMeters;
  const record = REWARDS.levelRecord;
  for (const [distance, reward] of [[sector2 - 1, record.sector1], [sector2, record.sectors2to3],
    [sector4 - 1, record.sectors2to3], [sector4, record.sectors4to5]]) {
    const run = createRunEconomy({runId: `record-${distance}`, fullStart: true, recordAtStart: 0});
    const result = settleRun(defaultProfile(), run, [], distance, false);
    assert.equal(result.run.recordCoins, reward, `${distance} m`);
    assert.equal(result.run.completionCoins, 0);
  }
  const equal = settleRun(defaultProfile(),
    createRunEconomy({runId: 'equal-record', fullStart: true, recordAtStart: LEVEL_FINISH_DISTANCE}),
    [], LEVEL_FINISH_DISTANCE, false);
  assert.equal(equal.run.recordCoins, 0);
});

test('no-damage cargo bonus waits for a clean run end after two Depots and uses the specified floor formula', () => {
  const cleanRun = {...createRunEconomy({runId: 'clean-no-damage'}), depotsReached: 2, consecutiveSkips: 1};
  const interim = bankCargo(defaultProfile(), cleanRun, [coin(13)]);
  const interimPayout = 13 + skipBonus(13, 1);
  assert.equal(interim.quote.payout, interimPayout);
  assert.equal(interim.quote.noDamageBonus, noDamageBonus(13, 1));
  assert.equal(interim.run.noDamageBonusPending, noDamageBonus(13, 1));
  assert.equal(interim.profile.coins, interimPayout, 'intermediate banking does not pay before the run stays damage-free');

  const final = settleRun(interim.profile, interim.run, [coin(13)], LEVEL_FINISH_DISTANCE, true);
  const finalNoDamage = noDamageBonus(13, 1) + Math.floor(13 * REWARDS.noDamageCargo.multiplier) - 13;
  assert.equal(final.run.noDamageCoins, finalNoDamage);
  assert.equal(final.profile.coins, interimPayout + 13 + finalNoDamage);
  const damaged = settleRun(defaultProfile(), {...cleanRun, runId: 'damaged-no-damage', damagingHits: 1},
    [coin(13)], LEVEL_FINISH_DISTANCE, true);
  assert.equal(damaged.run.noDamageCoins, 0);
});
