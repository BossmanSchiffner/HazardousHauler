import test from 'node:test';
import assert from 'node:assert/strict';
import {HINTS, HINT_IDS, DEPOT_APPROACH_HINT_M, hintForEvent, markHintSeen, normalizeSeenHints} from '../src/game/core/onboarding.js';
import {defaultProfile, normalizeProfile, SCHEMA_VERSION} from '../src/game/core/save.js';

test('each first-run tip triggers once, then stays quiet', () => {
  let seen = [];
  for (const event of ['runStart', 'coinPickup', 'stackPickup', 'hazardHit', 'depotApproach']) {
    const id = hintForEvent(seen, event);
    assert.ok(id, `${event} should trigger a tip on first occurrence`);
    seen = markHintSeen(seen, id);
    assert.equal(hintForEvent(seen, event), null, `${event} should not repeat`);
  }
  assert.deepEqual([...seen].sort(), HINT_IDS.filter(id => id !== 'depotEconomy').sort());
  assert.equal(hintForEvent([], 'unknownEvent'), null);
  assert.equal(markHintSeen(seen, 'steer'), seen, 'marking a seen tip is a no-op');
  assert.deepEqual(markHintSeen([], 'bogus'), [], 'unknown tip ids are ignored');
});

test('first Depot explanation starts at 60 m and describes indicated-side docking and existing choices', () => {
  assert.equal(DEPOT_APPROACH_HINT_M, 60);
  assert.match(HINTS.depot, /Depot/);
  assert.match(HINTS.depot, /that bay to stop; other lanes bypass/);
  assert.doesNotMatch(HINTS.depot, /Either outer lane/);
  assert.match(HINTS.depotEconomy, /Bank & Continue/);
  assert.match(HINTS.depotEconomy, /then repair or resume/);
  assert.match(HINTS.depotEconomy, /outside the indicated bay/);
  assert.match(HINTS.depotEconomy, /up to \+60%/);
  assert.match(HINTS.depotEconomy, /Repairs restore 1 Hull and cost wallet Coins/);
  assert.ok(!/checkpoint|ends the run/i.test(HINTS.depot));
  const seen = markHintSeen(['depot'], 'depotEconomy');
  assert.ok(seen.includes('depotEconomy'), 'new explanation can be dismissed independently of the old approach tip');
  assert.deepEqual(markHintSeen(seen, 'depotEconomy'), seen);
});

test('saves from before tips existed keep progress; veterans skip tips, new players see them', () => {
  const oldVeteranSave = {schemaVersion: 1, coins: 340, bestDistance: 812, totalRuns: 14, upgrades: {capacity: 2, handling: 3}};
  const loaded = normalizeProfile(oldVeteranSave);
  assert.equal(loaded.coins, 340);
  assert.equal(loaded.bestDistance, 812);
  assert.equal(loaded.totalRuns, 14);
  assert.equal(loaded.schemaVersion, SCHEMA_VERSION, 'old saves are migrated to the current schema');
  assert.deepEqual([...loaded.seenHints].sort(), [...HINT_IDS].sort());

  assert.deepEqual(normalizeProfile({schemaVersion: 1, totalRuns: 0}).seenHints, []);
  assert.deepEqual(normalizeSeenHints(['steer', 'bogus', 42, 'steer'], 3), ['steer']);
  assert.deepEqual(normalizeSeenHints([], 9), [], 'an explicit reset stays reset');
});

test('invalid or foreign save data falls back to a fresh profile', () => {
  assert.deepEqual(normalizeProfile(null), defaultProfile());
  assert.deepEqual(normalizeProfile({schemaVersion: 99, coins: 999}), defaultProfile());
  const tampered = normalizeProfile({schemaVersion: 1, coins: -5, bestDistance: 1.5, upgrades: {capacity: 99}});
  assert.equal(tampered.coins, 0);
  assert.equal(tampered.bestDistance, 0);
  assert.equal(tampered.cargoCapacityRank, 5, 'old maximum capacity upgrades retain their equivalent capacity');
});
