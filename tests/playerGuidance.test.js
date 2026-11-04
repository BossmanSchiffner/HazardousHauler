import test from 'node:test';
import assert from 'node:assert/strict';
import {createRunContext, HELP_SECTIONS, resultTip} from '../src/game/core/playerGuidance.js';
import {HINTS} from '../src/game/core/onboarding.js';

const result = (extra = {}) => ({reason: 'Hull destroyed', distance: 565, secured: 0,
  bankingEvents: 0, repairPurchases: 0, cargoLost: 0, ...extra});

test('contextual results tips select real load, capacity, loss and damaged-Depot situations', () => {
  assert.match(resultTip({...createRunContext(), crashLoadRatio: 1}, result(), 1), /Upgrade your steering/);
  assert.match(resultTip({...createRunContext(), fullLoadSeconds: 9}, result(), 1), /Cargo Capacity/);
  assert.match(resultTip(createRunContext(), result({cargoLost: 30}), 1), /Bank at Depots/);
  assert.match(resultTip({...createRunContext(), damagedDepot: true}, result(), 1), /repair at a Depot/);
  assert.ok(!/repair/.test(resultTip({...createRunContext(), damagedDepot: true}, result({repairPurchases: 1}), 1)));
});

test('successful results offer bounded risk advice, rotate eligible tips and do not mutate context', () => {
  const context = {...createRunContext(), fullLoadSeconds: 10};
  const summary = result({reason: 'Bank & Finish', distance: 450, secured: 45, bankingEvents: 1});
  const before = JSON.stringify([context, summary]);
  const tips = [1, 2, 3].map(n => resultTip(context, summary, n));
  assert.equal(new Set(tips).size, 3);
  assert.match(tips[1], /puts your Cargo at greater risk/);
  assert.match(tips[2], /one Depot farther/);
  assert.equal(resultTip(context, summary, 4), tips[0]);
  assert.equal(JSON.stringify([context, summary]), before);
  assert.ok(tips.every(tip => tip.length <= 115));
});

test('empty/new contexts get useful nonfinancial guidance without inventing a cause', () => {
  assert.match(resultTip(createRunContext(), result(), 1), /Steer early/);
  assert.deepEqual(createRunContext(), {fullLoadSeconds: 0, crashLoadRatio: 0, cargoLostToHits: 0, damagedDepot: false});
});

test('plain-language help explains the seven essentials using current Depot behavior', () => {
  assert.equal(HELP_SECTIONS.length, 7);
  const copy = HELP_SECTIONS.map(section => section.join(' ')).join('\n');
  for (const phrase of ['Bank & Continue', 'Bank & End Run', 'Skip restores shields', 'indicated bay',
    'Other lanes bypass', '+20%', '+60%', 'Steering', 'Cargo Capacity']) {
    assert.ok(copy.includes(phrase), phrase);
  }
  assert.ok(!/Push On|Bypass|all 3 hull|\d+C\b/.test(copy));
  assert.doesNotMatch(copy, /Either outer lane/);
});

test('player-facing controls describe touch dragging without desktop input instructions', () => {
  const copy = [...HELP_SECTIONS.map(section => section.join(' ')), ...Object.values(HINTS)].join('\n');
  assert.match(copy, /Drag left or right to steer/);
  assert.match(copy, /Drag vertically to scroll menus/);
  assert.doesNotMatch(copy, /mouse|wheel|keyboard|arrow keys|click|hover/i);
});
