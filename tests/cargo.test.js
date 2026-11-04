import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceCargoTrail, createCargoTrail, cargoOffer, cargoPickupForRoll, cargoTotals, collectCargo, damageCargo} from '../src/game/core/cargo.js';
import {createTrackGenerator, createTrackStream} from '../src/game/core/trackGenerator.js';
import {steeringMultiplier} from '../src/game/core/economy.js';
import {IMPLEMENTED_LEVELS, IMPLEMENTED_SECTORS} from '../src/game/core/sectors.js';
import {SECTOR_CARGO} from '../src/game/data/catalog.js';
import {balance} from '../src/game/data/balance.js';

const coin = value => ({kind: 'coin', mass: 1, slots: 1, value});
const freight = value => ({kind: 'freight', mass: 2, slots: 1, value});

test('cargo chain: four cosmetic trailers snake with distinct rotations, fixed hitch spacing and bounded history at 30/60/120 Hz', () => {
  for (const hz of [30, 60, 120]) {
    const cab = {x: 195, y: 684, rotation: 0};
    const trail = createCargoTrail(cab);
    const history = trail.history, segments = trail.segments;
    let snaked = false;
    for (let frame = 1; frame <= hz * 8; frame++) {
      cab.x = 195 + 110 * Math.sin(frame / hz * 3);
      cab.rotation = 0.07 * Math.cos(frame / hz * 3);
      const before = {...cab};
      advanceCargoTrail(trail, cab, 1 / hz, 1);
      let parent = cab;
      for (const [i, segment] of trail.segments.entries()) {
        assert.ok(Math.abs(Math.hypot(segment.x - parent.x, segment.y - parent.y) - (i ? 29 : 46)) < 1e-9);
        assert.ok(segment.y > parent.y && Math.abs(segment.angle) < Math.PI / 2);
        assert.ok(Math.abs(segment.x - cab.x) <= 18 + 1e-9);
        assert.ok(Math.abs(segment.angle - cab.rotation) <= 8 * Math.PI / 180 + 1e-9);
        assert.ok(Math.abs(segment.angle) <= 8 * Math.PI / 180 + 1e-9);
        parent = segment;
      }
      if (new Set(trail.segments.map(s => Math.round(s.x))).size === 4 &&
          new Set(trail.segments.map(s => Math.round(s.angle * 100))).size >= 3) snaked = true;
      assert.deepEqual(cab, before, 'trail never moves the lead cab or changes physics');
      assert.ok(trail.history.length <= 120);
      assert.equal(trail.history, history);
      assert.equal(trail.segments, segments, 'state is reused');
    }
    assert.ok(snaked, `${hz} Hz has a curved, articulated trail rather than one shared follower X`);
    assert.equal(trail.history[0].angle, cab.rotation);
    const before = structuredClone(trail);
    advanceCargoTrail(trail, cab, 0, 1);
    assert.deepEqual(trail, before, 'non-frame refresh never advances history twice');
    for (let frame = 0; frame < hz * 4; frame++) advanceCargoTrail(trail, cab, 1 / hz, 1);
    assert.ok(trail.segments.every(s => Math.abs(s.x - cab.x) < 1e-6 && Math.abs(s.angle) < 1e-6));
    assert.throws(() => advanceCargoTrail(trail, cab, -1, 1), /Invalid cargo trail step/);
  }
});
test('cargo chain stays hitched during hard lane sweeps at 250 and 600 px/s without changing travel or load physics', () => {
  assert.equal(balance.TRUCK_TRAILER_MAX_OFFSET_X, 18);
  assert.equal(balance.TRUCK_TRAILER_MAX_ANGLE, 8);
  for (const speed of [250, 600]) for (const hz of [30, 60, 120]) for (const load of [0, 0.5, 1]) {
    const cab = {x: 86, y: 684, rotation: 0};
    const trail = createCargoTrail(cab);
    for (let frame = 1; frame <= hz * 4; frame++) {
      const direction = Math.floor(frame / hz) % 2 ? -1 : 1;
      cab.x = Math.max(86, Math.min(305, cab.x + direction * speed / hz));
      cab.rotation = direction * 4.5 * Math.PI / 180;
      advanceCargoTrail(trail, cab, 1 / hz, load);
      for (const segment of trail.segments) {
        assert.ok(Number.isFinite(segment.y));
        assert.ok(Math.abs(segment.x - cab.x) <= 18 + 1e-9);
        assert.ok(Math.abs(segment.angle - cab.rotation) <= 8 * Math.PI / 180 + 1e-9);
        assert.ok(Math.abs(segment.angle) <= 8 * Math.PI / 180 + 1e-9);
      }
    }
  }
});
const FINISH = IMPLEMENTED_SECTORS.at(-1).endsAt;
// Every reachable difficulty step. Per-level Overdrive is retired; Normal past the finish keeps the final sector.
const STEP_SAMPLES = IMPLEMENTED_SECTORS.map(sector =>
  ({id: sector.id, step: sector.difficultyStep, distance: sector.startsAt, mode: 'normal'}));

test('full hold swaps only one strictly lower-value feasible item and records net gain', () => {
  const items = [coin(5), coin(25), coin(5)];
  const improved = collectCargo(items, coin(35), 3);
  assert.equal(improved.accepted, true);
  assert.equal(improved.replaced, true);
  assert.equal(improved.gain, 30);
  assert.deepEqual(cargoTotals(improved.items), {mass: 3, slots: 3, value: 65});
  assert.deepEqual(items, [coin(5), coin(25), coin(5)], 'pure input');
  assert.equal(collectCargo(improved.items, coin(5), 3).items, improved.items);
  assert.equal(collectCargo([coin(25)], coin(25), 1).accepted, false);
  assert.equal(collectCargo(items, freight(85), 3).accepted, false, 'no multiple-item repacking');
  assert.equal(collectCargo([], freight(85), 1).accepted, false);
});

test('replacement searches for a feasible item, respects both slots/mass, and never improves by overfilling', () => {
  const items = [coin(5), freight(45)];
  const improved = collectCargo(items, freight(65), 3);
  assert.deepEqual(improved.items, [coin(5), freight(65)], 'cheapest item is not feasible; replace heavier one');
  assert.equal(improved.gain, 20);
  const lighter = collectCargo([freight(45)], coin(55), 2);
  assert.deepEqual(cargoTotals(lighter.items), {mass: 1, slots: 1, value: 55});
  assert.equal(cargoOffer([{...coin(5), slots: 2}], {...coin(35), slots: 3}, 2).accepted, false);
  for (let capacity = 1; capacity <= 25; capacity++) {
    let ledger = [];
    for (let i = 0; i < 500; i++) {
      const sample = STEP_SAMPLES[i % STEP_SAMPLES.length];
      const pickup = cargoPickupForRoll(sample.distance, ((i * 37) % 100) / 100, 'level1', sample.mode);
      const before = cargoTotals(ledger);
      const next = collectCargo(ledger, pickup, capacity);
      if (next.replaced) {
        assert.ok(cargoTotals(next.items).value > before.value);
        assert.equal(next.items.length, ledger.length);
      }
      ledger = next.items;
      const total = cargoTotals(ledger);
      assert.ok(total.mass <= capacity && total.slots <= capacity);
      assert.ok(ledger.every(item => item.mass > 0 && item.slots > 0 && Number.isInteger(item.value)));
    }
  }
});

test('sector-weighted tiers restrict all road cargo without changing pickup cadence', () => {
  assert.deepEqual(cargoPickupForRoll(0, 0), {...coin(5), kind: 'coinStack'});
  assert.deepEqual(cargoPickupForRoll(1799, 0.5), coin(5));
  assert.deepEqual(cargoPickupForRoll(FINISH, 0), freight(25), 'Normal past the finish keeps the final sector tiers');
  for (const [index, {distance, mode}] of STEP_SAMPLES.slice(1).entries()) {
    const maximum = [10, 20, 25][index];
    assert.deepEqual(cargoPickupForRoll(distance, 0, 'level1', mode), freight(maximum));
    // Level 2 has its own sector boundaries; sample the same sector position there.
    assert.deepEqual(cargoPickupForRoll(IMPLEMENTED_LEVELS.level2[index + 1].startsAt, 0, 'level2', mode),
      freight(maximum), 'cargo tiers follow sector position, not the Dustlands theme');
    const lightest = SECTOR_CARGO[STEP_SAMPLES[index + 1].step].filter(tier => tier.weight > 0).at(-1).value;
    assert.equal(cargoPickupForRoll(distance, 0.199, 'level1', mode).value, lightest,
      'top of the stack band selects the lightest weighted tier');
    assert.deepEqual(cargoPickupForRoll(distance, 0.9, 'level1', mode), coin(5));
  }
  for (const sector of STEP_SAMPLES) {
    const counts = new Map();
    const lightTiers = new Set();
    let stacks = 0, heavy = 0;
    const table = SECTOR_CARGO[sector.step];
    assert.ok(Math.abs(table.reduce((sum, tier) => sum + tier.weight, 0) - 1) < 1e-9);
    for (let i = 0; i < 10000; i++) {
      const pickup = cargoPickupForRoll(sector.distance, (i + 0.5) / 10000, 'level1', sector.mode);
      assert.ok(table.some(t => t.value === pickup.value), `${sector.id}/${pickup.value}`);
      counts.set(pickup.value, (counts.get(pickup.value) ?? 0) + 1);
      if (pickup.kind !== 'coin') stacks++;
      if (pickup.kind === 'coinStack') lightTiers.add(pickup.value);
      if (pickup.kind === 'freight') heavy++;
    }
    assert.equal(stacks, 2000, 'new tiers never add pickup or premium rolls');
    assert.equal(heavy, sector.step === 0 ? 0 : 400);
    for (const tier of table) {
      const expected = (tier.value === 5 ? 8000 : 0) + 2000 * tier.weight;
      assert.ok(Math.abs((counts.get(tier.value) ?? 0) - expected) <= 1, `${sector.id}/${tier.value}`);
      if (tier.weight > 0) assert.ok(lightTiers.has(tier.value), 'every weighted tier also appears as a mass-1 stack');
    }
    assert.ok(counts.get(5) >= 8000);
  }
  for (let seed = 0; seed < 100; seed++) {
    const early = createTrackGenerator(seed);
    const deep = createTrackGenerator(seed);
    for (let row = 0; row < 100; row++) {
      const a = early.nextRowPickups([1, 2], 0);
      const b = deep.nextRowPickups([1, 2], IMPLEMENTED_SECTORS[3].startsAt);
      assert.equal(a.length, b.length);
      if (a.length) assert.equal(a[0].lane, b[0].lane);
    }
  }
  const stream = createTrackStream(42);
  const rows = Array.from({length: 200}, () => stream.nextRow(5500, true));
  assert.ok(rows.some(row => row.pickups.some(pickup => pickup.kind === 'freight')));
  for (const row of rows) assert.ok(row.pickups.every(pickup => row.safeLanes.includes(pickup.lane)));
  assert.ok(steeringMultiplier(11, 11) < steeringMultiplier(1, 11), 'full hold still slows handling');
});

test('damage jettisons lowest value and applies insured minimum loss with exact integer ledger totals', () => {
  const items = [coin(5), coin(25), freight(85)];
  const damaged = damageCargo(items, 0.15);
  assert.equal(damaged.items.length, 2);
  assert.equal(damaged.lostValue, 18);
  assert.deepEqual(cargoTotals(damaged.items), {mass: 3, slots: 2, value: 97});
  const insured = damageCargo(items, 0.15 * (1 - 0.8));
  assert.equal(insured.lostValue, 5, 'insurance cannot recover physically jettisoned cargo');
  const reinforced = damageCargo(items, 0.15, 0.6);
  assert.equal(reinforced.lostValue, 8, 'reinforcement reduces total hit loss without making it zero');
  assert.ok(reinforced.items.length > 0);
  assert.equal(damageCargo([freight(85)], 0).lostValue, 85);
  assert.deepEqual(damageCargo([coin(5)], 0.15).items, []);
  assert.deepEqual(damageCargo([], 0.15).items, []);
  assert.equal(cargoTotals(items).value, 115, 'original ledger untouched');
  assert.throws(() => collectCargo([], coin(-1), 11), /Invalid/);
  assert.throws(() => damageCargo(items, NaN), /Invalid/);
});

test('premium cargo offers an optional outer commitment without adding rolls or changing rewards', () => {
  let upgrades = 0, saferSingles = 0;
  for (const distance of IMPLEMENTED_SECTORS.slice(1).map(sector => sector.startsAt))
    for (const lanes of [[0, 1], [2, 3]]) {
    const risky = createTrackGenerator(153), control = createTrackGenerator(153);
    for (let row = 0; row < 1000; row++) {
      const offers = risky.nextRowPickups(lanes, distance);
      const ordinary = control.nextRowPickups([1, 2], distance);
      assert.equal(offers.length, ordinary.length);
      if (!offers.length) continue;
      const {lane, ...cargo} = offers[0];
      const {lane: unusedLane, ...controlCargo} = ordinary[0];
      assert.deepEqual(cargo, controlCargo, 'same seeded value/mass/shape; no economy rebalance');
      if (cargo.value > 5) {
        assert.equal(lane, lanes.find(l => l === 0 || l === 3));
        const result = collectCargo(Array.from({length: 11}, () => coin(5)), cargo, 11);
        if (cargo.mass === 1) {
          assert.ok(result.replaced && result.gain > 0, 'full hold can profit by choosing the risky branch');
          upgrades++;
        }
      } else if (lane === 1 || lane === 2) saferSingles++;
    }
  }
  assert.ok(upgrades > 100 && saferSingles > 100);
});
