import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceMagnet} from '../src/game/core/magnet.js';
import {CARGO_COLLISION_DISTANCE_PX} from '../src/game/core/trackGenerator.js';

const state = {x: 150, y: 500, targetX: 195, targetY: 684, range: 66, dt: 1 / 60};

test('magnet pulls diagonally toward the ship at a bounded speed', () => {
  const next = advanceMagnet(state);
  assert.ok(next.x > state.x && next.x < state.targetX);
  assert.ok(next.y > state.y && next.y < state.targetY);
  assert.ok(Math.abs(Math.hypot(next.x - state.x, next.y - state.y) - 420 * state.dt) < 1e-9);
  assert.ok(Math.abs((next.x - state.x) / (next.y - state.y) - 45 / 184) < 1e-9);
});

test('magnet pulls straight down when a coin is already aligned with the ship', () => {
  const next = advanceMagnet({...state, x: state.targetX});
  assert.equal(next.x, state.targetX);
  assert.ok(next.y > state.y);
});

test('magnet can recover a coin just behind the ship without overshooting', () => {
  assert.deepEqual(advanceMagnet({...state, x: 193, y: 688, dt: 0.05}), {x: 195, y: 684});
  assert.deepEqual(advanceMagnet({...state, x: 195, y: 684}), {x: 195, y: 684});
});

test('magnet leaves disabled, out-of-range and paused pickups unchanged', () => {
  for (const input of [
    {...state, range: 0}, {...state, x: 129}, {...state, x: 261},
    {...state, y: 443}, {...state, y: 725}, {...state, dt: 0},
  ]) {
    assert.deepEqual(advanceMagnet(input), {x: input.x, y: input.y});
  }
});

test('magnet collects coins and stacks at every module level at early and late route speeds without steering', () => {
  for (const speed of [250, 600]) {
    for (const range of [36, 48, 60, 72, 84]) {
      for (const kind of ['coin', 'coinStack']) {
        for (const side of [-1, 1]) {
          let position = {x: 195 + side * (range + CARGO_COLLISION_DISTANCE_PX - 1), y: 444};
          let collected = false;
          for (let frame = 0; frame < 120; frame++) {
            position = advanceMagnet({
              ...state, ...position, y: position.y + speed * state.dt,
              range: range + CARGO_COLLISION_DISTANCE_PX,
            });
            if (Math.abs(position.x - 195) < CARGO_COLLISION_DISTANCE_PX && Math.abs(position.y - 684) < 40) {
              collected = true;
              break;
            }
          }
          assert.ok(collected, `${kind}: speed ${speed}, range ${range}, side ${side}`);
        }
      }
    }
  }
});

test('magnet rejects invalid state', () => {
  for (const change of [{dt: -1}, {range: -1}, {x: NaN}, {targetY: Infinity}]) {
    assert.throws(() => advanceMagnet({...state, ...change}), /Invalid magnet state/);
  }
});
