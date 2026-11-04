import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultProfile} from '../src/game/core/save.js';
import {adjustDeveloperCoins, isDeveloperRun, markDeveloperRun} from '../src/game/core/developerRuns.js';
import {createRunEconomy, settleRun} from '../src/game/core/depotEconomy.js';

test('developer Coin adjustments require a signed safe integer and never go below zero', () => {
  const profile = {...defaultProfile(), coins: 125};
  assert.equal(adjustDeveloperCoins(profile, 100).coins, 225);
  assert.equal(adjustDeveloperCoins(profile, -100).coins, 25);
  assert.equal(adjustDeveloperCoins(profile, -500).coins, 0);
  assert.throws(() => adjustDeveloperCoins(profile, 0), /non-zero safe integer/);
  assert.throws(() => adjustDeveloperCoins(profile, 1.5), /non-zero safe integer/);
});

test('developer runs are marked and settlement cannot award or unlock progression', () => {
  const profile = defaultProfile();
  const run = createRunEconomy(markDeveloperRun({
    runId: 'developer-sector-five',
    levelId: 'level1',
    startDistance: 6000,
    fullStart: true,
  }));
  assert.equal(isDeveloperRun(run), true);
  const result = settleRun(profile, run, [{kind: 'coin', mass: 1, slots: 1, value: 500}],
    8000, true, true);
  assert.equal(result.profile, profile);
  assert.equal(result.profile.coins, 0);
  assert.equal(result.profile.levelProgress.level1.completed, false);
  assert.deepEqual(result.profile.levelProgress, profile.levelProgress);
  assert.equal(result.profile.settledRunIds.length, 0);
  assert.equal(result.goldUnlocked, false);
  assert.equal(result.summary.net, 0);
});
