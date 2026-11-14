import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveHazardCollision, advanceNearMiss, cargoPickupHits} from '../src/game/core/collision.js';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';
import {hazardGeometry, hazardHits} from '../src/game/core/hazards.js';
import {createRunEconomy, awardCloseCall, bankingQuote, continuousQuote, bankCargo, settleRun,
  passContinuousDepot} from '../src/game/core/depotEconomy.js';
import {defaultProfile} from '../src/game/core/save.js';

const sample = overrides => resolveHazardCollision({
  invulnerableSeconds: 0,
  shieldCharges: 0,
  hull: 3,
  hullDamage: 1,
  cargoItems: [
    {kind: 'coin', mass: 1, slots: 1, value: 5},
    {kind: 'coinStack', mass: 1, slots: 1, value: 20},
  ],
  cargoLossFraction: 0.15,
  baseInvulnerabilitySeconds: 0.65,
  impactPulseSeconds: 0,
  shieldInvulnerabilitySeconds: 0.8,
  ...overrides,
});

test('collision: immune contacts and shielded contacts do not trigger Impact Pulse or cargo loss', () => {
  const immune = sample({invulnerableSeconds: 0.1, shieldCharges: 3, impactPulseSeconds: 0.8});
  assert.equal(immune.kind, 'immune');
  assert.equal(immune.hull, 3);
  assert.equal(immune.lostValue, 0);
  assert.equal(immune.shieldCharges, 3);

  const shielded = sample({shieldCharges: 3, impactPulseSeconds: 0.8});
  assert.equal(shielded.kind, 'shielded');
  assert.equal(shielded.invulnerabilitySeconds, 0.8);
  assert.equal(shielded.lostValue, 0);
  assert.equal(shielded.shieldCharges, 2);
  assert.equal(shielded.hull, 3);
  assert.equal(shielded.clearObstacles, undefined);
});

test('collision: each shield charge absorbs one hit before hull and cargo damage, including a fatal-strength hit', () => {
  let charges = 3;
  for (const expected of [2, 1, 0]) {
    const result = sample({shieldCharges: charges, hull: 1, hullDamage: 3});
    assert.equal(result.kind, 'shielded');
    assert.equal(result.shieldCharges, expected);
    assert.equal(result.hull, 1);
    assert.equal(result.lostValue, 0);
    assert.equal(result.cargoItems.length, 2);
    assert.equal(result.fatal, undefined);
    charges = result.shieldCharges;
  }
  const exhausted = sample({shieldCharges: charges});
  assert.equal(exhausted.kind, 'damaged');
  assert.equal(exhausted.hull, 2);
  assert.equal(exhausted.shieldCharges, 0);
  assert.ok(exhausted.lostValue > 0);
});

test('collision: a damaging hit applies cargo loss and no-damage failure before clearing obstacles and immunity', () => {
  const result = sample({impactPulseSeconds: 0.5, cargoMitigation: 0.2});
  assert.equal(result.kind, 'damaged');
  assert.equal(result.hull, 2);
  assert.equal(result.damagingHit, true);
  assert.equal(result.clearObstacles, true);
  assert.equal(result.invulnerabilitySeconds, 1.15);
  assert.equal(result.fatal, false);
  assert.equal(result.lostValue, 4);
});

test('collision: fatal hits still request a clear but remain terminal', () => {
  const result = sample({hull: 1, impactPulseSeconds: 0.2});
  assert.equal(result.clearObstacles, true);
  assert.equal(result.fatal, true);
  assert.equal(result.hull, 0);
});

test('collision rejects invalid numerical state', () => {
  assert.throws(() => sample({impactPulseSeconds: -1}), /Invalid hazard collision/);
  for (const shieldCharges of [-1, 1.5, NaN, Infinity]) {
    assert.throws(() => sample({shieldCharges}), /Invalid hazard collision/);
  }
});

test('collision body width reduces the widened cab by exactly 5% without changing height or artwork-derived geometry', () => {
  assert.equal(GAME_BALANCE.hazards.playerHalfWidthPx, 12 * 1.1 * 0.95);
  assert.ok(Math.abs(GAME_BALANCE.hazards.playerHalfWidthPx * 2 - 25.08) < 1e-12);
  assert.equal(GAME_BALANCE.hazards.playerHalfHeightPx, 16);
  for (const kind of ['divider', 'barrier', 'rockSlab', 'signalCabinet', 'sweeper']) {
    const geometry = hazardGeometry({kind});
    const right = Math.max(...geometry.footprint.map(part => part.x + part.halfWidth));
    assert.equal(hazardHits({kind}, 0, 0, right + 12.53, 0), true, kind);
    assert.equal(hazardHits({kind}, 0, 0, right + 12.55, 0), false, kind);
    assert.equal(geometry.hitX,
      Math.max(...geometry.footprint.map(part => Math.abs(part.x) + part.halfWidth)) + 12 * 1.1 * 0.95);
  }
});

test('collision cargo collection expands both axes by 20% without expanding Blueprint or Magnet settings', () => {
  assert.equal(GAME_BALANCE.cargo.pickupTriggerScale, 1.2);
  assert.equal(GAME_BALANCE.cargo.pickupCollisionRadiusPx, 30);
  assert.equal(GAME_BALANCE.physics.collision.cargoHalfHeightPx, 40);
  assert.equal(cargoPickupHits(35.9, 47.9, 0, 0), true);
  assert.equal(cargoPickupHits(36, 0, 0, 0), false);
  assert.equal(cargoPickupHits(0, 48, 0, 0), false);
});

test('nearmiss collision tracking requires a complete clean pass, 15-25px gap and one award per body at all rates', () => {
  const hazard = {kind: 'barrier'};
  const right = hazardGeometry(hazard).hitX;
  for (const hz of [30, 60, 120]) for (const gap of [0, 14.9, 15, 20, 25, 25.1, 40]) {
    let state, awards = 0, y = -100;
    while (y < 100) {
      const nextY = y + 680 / hz;
      state = advanceNearMiss(state, hazard, {x: right + gap, y}, {x: right + gap, y: nextY});
      if (state.award) awards++;
      y = nextY;
    }
    assert.equal(awards, gap >= 15 && gap <= 25 ? 1 : 0, `${hz}Hz gap ${gap}`);
    assert.equal(advanceNearMiss(state, hazard, {x: right + gap, y}, {x: right + gap, y: y + 200}).award, false);
  }
  let state = advanceNearMiss(null, hazard, {x: 0, y: -50}, {x: 0, y: 0});
  state = advanceNearMiss(state, hazard, {x: 0, y: 0}, {x: right + 20, y: 100});
  assert.ok(state.contacted);
  assert.equal(state.award, false, 'a collision/immune overlap is never a close call');
  assert.equal(advanceNearMiss(null, hazard, {x: right + 20, y: -100}, {x: right + 20, y: 100}).award, true,
    'a high-speed frame crossing the entire window still resolves exactly one pass');
  assert.throws(() => advanceNearMiss(null, hazard, {x: NaN, y: 0}, {x: 0, y: 10}), /trajectory/);
});

test('nearmiss cargo bonus adds five points capped at 50%, banks atomically and does not compound Depot or clean-run rewards', () => {
  const items = [{kind: 'coinStack', mass: 1, slots: 1, value: 100}];
  let run = createRunEconomy({runId: 'close-call-test', levelId: 'level1', fullStart: true});
  assert.equal(awardCloseCall(run, []).awarded, false);
  for (let index = 1; index <= 15; index++) {
    const award = awardCloseCall(run, items);
    assert.equal(award.awarded, index <= 10);
    run = award.run;
    assert.equal(run.closeCallBonusPercent, Math.min(50, index * 5));
  }
  const quote = bankingQuote(items, {...run, consecutiveSkips: 1});
  const depotOnly = bankingQuote(items, {...run, closeCallBonusPercent: 0, consecutiveSkips: 1});
  assert.equal(quote.payout, depotOnly.payout + 50);
  assert.equal(quote.noDamageBonus, depotOnly.noDamageBonus);
  const profile = defaultProfile();
  const bank = bankCargo(profile, run, items);
  assert.equal(profile.coins, 0, 'quote/candidate creation does not mutate a live profile');
  assert.equal(run.closeCallBonusPercent, 50, 'failed persistence can retain the original bonus and hold');
  assert.equal(bank.profile.coins, 150);
  assert.equal(bank.run.closeCallBonusPercent, 0);
  const damagedHold = sample({cargoItems: items, cargoLossFraction: 0}).cargoItems;
  assert.equal(bankingQuote(damagedHold, run).closeCallBonus, 0, 'bonus pays current surviving hold only');
  const wreck = settleRun(profile, run, items, 100, false);
  const plainWreck = settleRun(profile, {...run, closeCallBonusPercent: 0}, items, 100, false);
  assert.equal(wreck.profile.coins, plainWreck.profile.coins, 'Normal wreck pays no close-call bonus');
});

test('nearmiss Endless cash-out adds a capped hold bonus while a wreck forfeits the hold', () => {
  const items = [{kind: 'coinStack', mass: 1, slots: 1, value: 100}];
  const profile = defaultProfile();
  profile.levelProgress.level1.completed = true;
  let run = createRunEconomy({runId: 'close-call-endless', mode: 'continuous'});
  for (let index = 0; index < 12; index++) {
    run = passContinuousDepot(awardCloseCall(run, items).run);
  }
  const quote = continuousQuote(items, run);
  assert.equal(quote.percent, 100, 'Depot cap unchanged');
  assert.equal(quote.closeCallPercent, 50);
  assert.equal(quote.payout, 250);
  const cashed = settleRun(profile, run, items, 12000, true);
  assert.equal(cashed.profile.coins, 250);
  const wreck = settleRun(profile, run, items, 12000, false);
  assert.equal(wreck.profile.coins, 0);
  assert.equal(wreck.cargoLost, 100);
  assert.equal(wreck.quote.bonus, 0);
  assert.equal(settleRun(cashed.profile, run, items, 12000, true).duplicate, true);
});
