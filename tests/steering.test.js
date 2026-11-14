import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceSteering, KEYBOARD_BRAKE_SECONDS} from '../src/game/core/steering.js';
import {steeringMultiplier} from '../src/game/core/economy.js';

const state = {x: 195, velocity: 0};
const bounds = {minX: 73, maxX: 317};

function step(current, targetX, load, dt = 1 / 60) {
  return advanceSteering({
    ...current,
    targetX,
    dt,
    ...bounds,
    load,
    capacity: 10,
  });
}

test('steering accelerates smoothly and settles at the pointer target without snapping past it', () => {
  let current = {...state};
  let previousDisplacement = 0;
  let reachedTarget = false;

  for (let frame = 0; frame < 300; frame++) {
    const next = step(current, 270, 0);
    const displacement = next.x - current.x;
    assert.ok(displacement >= -1e-9, 'movement should not reverse before reaching the target');
    assert.ok(displacement <= 351 / 60, 'movement must stay under the maximum lateral speed');
    if (frame < 5) assert.ok(displacement >= previousDisplacement - 1e-9, 'initial movement should ramp up');
    if (next.x === 270) reachedTarget = true;
    current = next;
    previousDisplacement = displacement;
  }

  assert.equal(reachedTarget, true);
  assert.equal(current.x, 270);
  assert.equal(current.velocity, 0);
});

test('a loaded truck has reduced top speed and still responds continuously', () => {
  let empty = {...state};
  let loaded = {...state};

  for (let frame = 0; frame < 10; frame++) {
    empty = step(empty, 300, 0);
    loaded = step(loaded, 300, 10);
  }

  assert.ok(empty.x > loaded.x);
  assert.ok(loaded.x > state.x);
  assert.ok(loaded.velocity > 0);
});

test('shared base steering is ten percent slower without changing normalized chassis ratings', () => {
  for (const vehicleMultiplier of [1, 1.3, 0.8]) for (const load of [0, 5, 10]) {
    const response = steeringMultiplier(load, 10, 0, 0, vehicleMultiplier);
    if (load === 0) assert.equal(response, vehicleMultiplier, '100% remains the Standard reference');
    const input = {targetX: 10000, dt: 1 / 60, minX: -10000, maxX: 10000,
      load, capacity: 10, vehicleMultiplier};
    let current = advanceSteering({x: 0, velocity: 0, ...input});
    assert.ok(Math.abs(current.velocity - 1600 * 0.9 * response / 60) < 1e-9,
      'base acceleration is reduced by exactly 10% for every chassis and load');
    for (let frame = 1; frame < 120; frame++) current = advanceSteering({...current, ...input});
    assert.ok(Math.abs(current.velocity - 390 * 0.9 * response) < 1e-9,
      'base lateral top speed is reduced by exactly 10% for every chassis and load');
  }
});

test('digital release brakes to exactly zero within 60 ms regardless of cargo mass or frame rate', () => {
  assert.equal(KEYBOARD_BRAKE_SECONDS, 0.06);
  for (const load of [0, 5, 10]) for (const velocity of [-450, -120, 120, 450]) {
    for (const dt of [1 / 30, 1 / 60, 1 / 120, 0.06]) {
      let current = {...state, velocity, brakeTimeRemaining: KEYBOARD_BRAKE_SECONDS};
      let elapsed = 0;
      while (elapsed < KEYBOARD_BRAKE_SECONDS) {
        const frameDt = Math.min(dt, KEYBOARD_BRAKE_SECONDS - elapsed);
        const next = advanceSteering({...current, targetX: 300, dt: frameDt, ...bounds,
          load, capacity: 10, digitalBrake: true});
        assert.ok(Math.abs(next.velocity) <= Math.abs(current.velocity));
        assert.ok(next.velocity * velocity >= 0, 'braking never reverses into a pendulum');
        current = next;
        elapsed += frameDt;
      }
      assert.ok(Math.abs(current.velocity) < 1e-9);
      assert.ok(Math.abs(current.x - state.x - velocity * 0.03) < 1e-9, 'linear 60 ms stopping distance');
      const stopped = advanceSteering({...current, targetX: 300, dt, ...bounds,
        load, capacity: 10, digitalBrake: true});
      assert.equal(stopped.velocity, 0);
      assert.equal(stopped.x, current.x, 'the old target cannot pull the stopped cab sideways');
    }
  }
});

test('digital braking stays inside the road, handles pause frames and validates its timer', () => {
  const braking = {...state, targetX: 300, ...bounds, load: 10, capacity: 10, digitalBrake: true};
  assert.equal(advanceSteering({...braking, dt: 0, velocity: 200}).velocity, 200);
  assert.equal(advanceSteering({...braking, dt: 1, velocity: 200}).velocity, 0);
  assert.deepEqual(advanceSteering({...braking, x: 316, dt: 0.06, velocity: 200}),
    {x: 317, velocity: 0, brakeTimeRemaining: 0});
  for (const brakeTimeRemaining of [-1, 0.07, NaN]) {
    assert.throws(() => advanceSteering({...braking, dt: 0.01, brakeTimeRemaining}), /Invalid steering state/);
  }
});

test('steering remains inside road bounds and rejects invalid state', () => {
  const atEdge = advanceSteering({
    x: 316,
    velocity: 100,
    targetX: 500,
    dt: 0.05,
    minX: 73,
    maxX: 317,
    load: 0,
    capacity: 10,
  });
  assert.equal(atEdge.x, 317);
  assert.ok(atEdge.velocity <= 0);
  assert.throws(() => step({...state, x: Number.NaN}, 300, 0), /Invalid steering state/);
});
