import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceCargoTrail, createCargoTrail, cargoOffer, cargoPickupForRoll, cargoTotals, collectCargo, damageCargo} from '../src/game/core/cargo.js';
import {createTrackGenerator, createTrackStream, pickupClearOfDepots, pickupContactDistance} from '../src/game/core/trackGenerator.js';
import {DEPOT_RULES} from '../src/game/core/depots.js';
import {GAME_BALANCE} from '../src/game/data/gameBalance.js';
import {steeringMultiplier, METERS_PER_PIXEL} from '../src/game/core/economy.js';
import {IMPLEMENTED_LEVELS, IMPLEMENTED_SECTORS} from '../src/game/core/sectors.js';
import {SECTOR_CARGO} from '../src/game/data/catalog.js';
import {difficultyStepAtDistance} from '../src/game/core/sectors.js';
import {sampleRoute} from '../scripts/route-audit.mjs';
import {balance} from '../src/game/data/balance.js';

const coin = value => ({kind: 'coin', mass: 1, slots: 1, value});
const freight = value => ({kind: 'freight', mass: 2, slots: 1, value});

test('Endless cargo is always worth 25 before 6000m and 30 thereafter, including repeat cycles', () => {
  for (const distance of [0, 1999, 2000, 4000, 5999.999, 6000, 7999, 8000, 16000, 50000]) {
    for (const roll of [0, 0.1, 0.5, 0.999999]) {
      const pickup = cargoPickupForRoll(distance, roll, 'level1', 'continuous');
      assert.equal(pickup.value, distance >= 6000 ? 30 : 25);
      assert.equal(pickup.slots, 1);
      assert.ok(['coinStack', 'freight'].includes(pickup.kind));
    }
  }
});

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
  assert.deepEqual(cargoPickupForRoll(IMPLEMENTED_SECTORS[1].startsAt + 100, 0.5), {...coin(10), kind: 'coinStack'});
  assert.deepEqual(cargoPickupForRoll(FINISH, 0), freight(25), 'Normal past the finish keeps the final sector tiers');
  for (const [index, {distance, mode}] of STEP_SAMPLES.slice(1).entries()) {
    const maximum = [10, 20, 25][index];
    assert.deepEqual(cargoPickupForRoll(distance, 0, 'level1', mode), freight(maximum));
    // Level 2 has its own sector boundaries; sample the same sector position there.
    assert.deepEqual(cargoPickupForRoll(IMPLEMENTED_LEVELS.level2[index + 1].startsAt, 0, 'level2', mode),
      freight(maximum), 'cargo tiers follow sector position, not the Dustlands theme');
    const lightest = SECTOR_CARGO[STEP_SAMPLES[index + 1].step].filter(tier => tier.weight > 0).at(-1).value;
    assert.equal(cargoPickupForRoll(distance, 0.999, 'level1', mode).value, lightest,
      'top of the full pickup roll selects the lightest weighted tier');
    assert.deepEqual(cargoPickupForRoll(distance, 0.5, 'level1', mode), {...coin(maximum), kind: 'coinStack'});
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
      if (pickup.mass === 1) lightTiers.add(pickup.value);
      if (pickup.kind === 'freight') heavy++;
    }
    assert.equal(stacks, sector.step === 0 ? 2000 : 10000 - (counts.get(5) ?? 0));
    assert.equal(heavy, sector.step === 0 ? 0 : 400);
    for (const tier of table) {
      const expected = 10000 * tier.weight;
      assert.ok(Math.abs((counts.get(tier.value) ?? 0) - expected) <= 1, `${sector.id}/${tier.value}`);
      if (tier.weight > 0) assert.ok(lightTiers.has(tier.value), 'every weighted tier also appears as a mass-1 stack');
    }
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
  const rows = [];
  let distance = IMPLEMENTED_SECTORS[1].startsAt;
  while (distance < FINISH) {
    const row = stream.nextRow(distance);
    if (!row) break;
    rows.push(row);
    distance = row.plannedDistance + row.spacingPx * METERS_PER_PIXEL;
  }
  const freightGenerator = createTrackGenerator(42);
  freightGenerator.nextCargoPickup = distance => cargoPickupForRoll(distance, 0);
  assert.equal(freightGenerator.nextRowPickups([0, 3], IMPLEMENTED_SECTORS[1].startsAt)[0].kind, 'freight');
  for (const row of rows) assert.ok(row.pickups.every(pickup => row.safeLanes.includes(pickup.lane)));
  assert.ok(steeringMultiplier(11, 11) < steeringMultiplier(1, 11), 'full hold still slows handling');
});

test('a full Sector 1 hold upgrades through later-sector cargo without increasing mass', () => {
  let items = Array.from({length: 11}, () => cargoPickupForRoll(0, 0.5));
  assert.deepEqual(cargoTotals(items), {mass: 11, slots: 11, value: 55});
  let previousValue = 5;
  for (const [index, sector] of IMPLEMENTED_SECTORS.slice(1).entries()) {
    const distance = sector.startsAt;
    const value = [10, 20, 25][index];
    for (let index = 0; index < 11; index++) {
      const result = collectCargo(items, cargoPickupForRoll(distance, 0.5), 11);
      assert.equal(result.accepted, true);
      assert.equal(result.replaced, true);
      items = result.items;
      assert.deepEqual(cargoTotals(items), {mass: 11, slots: 11,
        value: (10 - index) * previousValue + (index + 1) * value});
    }
    assert.equal(cargoTotals(items).value, 11 * value);
    previousValue = value;
  }
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

test('premium cargo follows certified decision waypoints or alternates opposite road edges', () => {
  for (const seed of [1, 153, 2330762723]) {
    const rows = sampleRoute(seed, FINISH, false, 'level1', 'normal');
    const premiums = rows.flatMap(row => row.pickups.filter(pickup => pickup.value > 5)
      .map(pickup => ({row, pickup})));
    assert.ok(premiums.length >= Math.ceil(FINISH * 6 / 4000),
      `${seed}: premium cargo was starved by placement restrictions`);
    assert.ok(rows.some(row => row.motifId === 'cargo_crossroad' || row.motifId === 'baseline_sweep' ||
      row.motifId?.startsWith('road_sweep_')));
    for (const [index, {row, pickup}] of premiums.entries()) {
      if (Number.isInteger(row.riskCargoLane)) assert.equal(pickup.lane, row.riskCargoLane);
      else {
        assert.ok([0, 3].includes(pickup.lane));
        if (index && !Number.isInteger(premiums[index - 1].row.riskCargoLane))
          assert.equal(Math.abs(pickup.lane - premiums[index - 1].pickup.lane), 3);
      }
      const table = SECTOR_CARGO[difficultyStepAtDistance(row.plannedDistance)];
      assert.ok(table.some(tier => tier.value === pickup.value && tier.weight > 0));
      assert.ok(row.certificates.every(proof => proof.completed && proof.clearance >= 6));
      assert.ok(row.certificates.every(proof =>
        proof.exits.some(exit => exit.lanes[row.phase + 1] === pickup.lane)));
    }
  }
});

test('every sector offers the minimum pickups and none appear inside Depot approach or exit windows', () => {
  const minimum = GAME_BALANCE.cargo.minPickupsPerSector;
  for (const levelId of Object.keys(IMPLEMENTED_LEVELS)) for (const enterDepots of [false, true]) {
    const finish = GAME_BALANCE.routes[levelId].finishDistanceMeters;
    const depots = IMPLEMENTED_LEVELS[levelId].slice(1).map(sector => sector.startsAt);
    const counts = IMPLEMENTED_LEVELS[levelId].map(() => 0);
    for (const row of sampleRoute(7, finish, enterDepots, levelId, 'normal')) {
      for (const pickup of row.pickups) {
        const contact = pickupContactDistance(row.plannedDistance);
        if (contact >= finish) continue;
        assert.ok(pickupClearOfDepots(contact, levelId, 'normal'), `${levelId} pickup at ${contact} m`);
        assert.ok(depots.every(depot => contact <= depot - DEPOT_RULES.approachMeters ||
          contact >= depot + DEPOT_RULES.exitMeters), `${levelId} pickup inside a Depot zone at ${contact} m`);
        counts[IMPLEMENTED_LEVELS[levelId].findLastIndex(sector => sector.startsAt <= contact)] += pickup.slots;
      }
    }
    assert.ok(counts.every(count => count >= minimum),
      `${levelId} (${enterDepots ? 'docking' : 'passing'}) pickups per sector: ${counts}`);
  }
});

test('decision cargo has independent safe and cargo branches that survive the common rejoin', () => {
  const rows = sampleRoute(1, FINISH, false, 'level1', 'normal');
  const decisions = rows.filter(row => row.decisionBranch);
  assert.ok(decisions.length >= 4, 'optional decisions must recur, not appear only once');
  for (const row of decisions) {
    const segment = rows.filter(candidate => candidate.chunkId === row.chunkId);
    const cargo = row.pickups[0];
    assert.equal(cargo.lane, row.riskCargoLane);
    for (const proof of row.certificates) {
      assert.ok(proof.completed && proof.clearance >= 6);
      const safeLane = cargo.lane === 0 ? 3 : 0;
      const safe = proof.exits.filter(exit => exit.lanes[row.phase + 1] === safeLane);
      const risky = proof.exits.filter(exit => exit.lanes[row.phase + 1] === cargo.lane);
      assert.ok(safe.length && risky.length, 'both routes must survive Beta augmentation');
      assert.ok(safe.some(bypass => risky.some(branch => branch.lane === bypass.lane)),
        'safe and cargo routes must independently reach a common exit');
    }
    for (const source of segment) for (const lane of [0, 1, 2, 3]) {
      assert.ok(source.intermediates.filter(hazard => hazard.lane === lane).length <= 2,
        'decision corridors must not acquire a three-Beta wall');
    }
  }
});

test('premium cargo offers an optional outer commitment without adding rolls or changing rewards', () => {
  let upgrades = 0, saferSingles = 0;
  for (const distance of IMPLEMENTED_SECTORS.slice(1).map(sector => sector.startsAt))
    for (const lanes of [[0, 1], [2, 3]]) {
    const risky = createTrackGenerator(153), control = createTrackGenerator(153);
    for (let row = 0; row < 2000; row++) {
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
