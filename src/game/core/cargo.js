import {difficultyStepAtDistance} from './sectors.js';
import {COIN_STACK_CHANCE, SINGLE_COIN_PAYOUT} from './economy.js';
import {SECTOR_CARGO} from '../data/catalog.js';
import {GAME_BALANCE} from '../data/gameBalance.js';
import {balance} from '../data/balance.js';

export function createCargoTrail(cab) {
  return {
    history: [{x: cab.x, y: cab.y, angle: cab.rotation ?? 0, time: 0}],
    elapsed: 0, maxFrames: 120,
    segments: Array.from({length: 4}, (_, i) => ({x: cab.x, y: cab.y + 46 + i * 29, angle: 0})),
  };
}

/** Time-sampled, bounded drawbar chain; all positions are cosmetic, never collision bodies. */
export function advanceCargoTrail(trail, cab, dt, loadRatio) {
  if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(loadRatio) || loadRatio < 0) {
    throw new Error('Invalid cargo trail step');
  }
  if (!dt) return trail.segments;
  trail.elapsed += dt;
  trail.history.unshift({x: cab.x, y: cab.y, angle: cab.rotation ?? 0, time: trail.elapsed});
  if (trail.history.length > trail.maxFrames) trail.history.pop();
  const spring = 1 - (1 - balance.TRUCK_TRAILER_SPRING) ** (dt * 60 / (1 + Math.min(1, loadRatio)));
  const rotationTracking = 1 - (1 - balance.TRUCK_TRAILER_ROTATION_TRACKING) ** (dt * 60);
  const cabAngle = cab.rotation ?? 0;
  const maxAngle = balance.TRUCK_TRAILER_MAX_ANGLE * Math.PI / 180;
  const minAngle = Math.max(-maxAngle, cabAngle - maxAngle);
  const maxTrailerAngle = Math.min(maxAngle, cabAngle + maxAngle);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let parent = cab;
  trail.segments.forEach((segment, i) => {
    const sampleTime = trail.elapsed - (i + 1) * balance.TRUCK_TRAILER_DELAY_FRAMES / 60;
    let newer = trail.history[0], older = trail.history.at(-1);
    for (const point of trail.history) {
      older = point;
      if (point.time <= sampleTime) break;
      newer = point;
    }
    const fraction = newer.time === older.time ? 0
      : Math.max(0, Math.min(1, (sampleTime - older.time) / (newer.time - older.time)));
    const targetX = older.x + (newer.x - older.x) * fraction;
    const spacing = i ? 29 : 46;
    const x = segment.x + (targetX - segment.x) * spring;
    const minX = Math.max(cab.x - balance.TRUCK_TRAILER_MAX_OFFSET_X,
      parent.x - spacing * Math.sin(maxTrailerAngle));
    const maxX = Math.min(cab.x + balance.TRUCK_TRAILER_MAX_OFFSET_X,
      parent.x - spacing * Math.sin(minAngle));
    segment.x = clamp(x, minX, maxX);
    const dx = segment.x - parent.x;
    segment.y = parent.y + Math.sqrt(spacing * spacing - dx * dx);
    const targetAngle = Math.atan2(parent.y - segment.y, parent.x - segment.x) + Math.PI / 2;
    const difference = Math.atan2(Math.sin(targetAngle - segment.angle), Math.cos(targetAngle - segment.angle));
    segment.angle = clamp(segment.angle + difference * rotationTracking,
      minAngle, maxTrailerAngle);
    parent = segment;
  });
  return trail.segments;
}

const FREIGHT_CHANCE = GAME_BALANCE.cargo.freightChance;

/** One existing pickup roll chooses its tier and shape; all rewards remain cargo at risk. */
export function cargoPickupForRoll(distance, roll, levelId = 'level1', mode = 'normal') {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new Error('Invalid cargo roll');
  const step = difficultyStepAtDistance(distance, levelId, mode);
  let tierRoll = roll;
  const table = SECTOR_CARGO[step];
  const tier = table.find(({weight}) => {
    tierRoll -= weight;
    return tierRoll < 0;
  }) ?? table.at(-1);
  const continuous = GAME_BALANCE.routes.continuous;
  const value = mode === 'continuous'
    ? distance >= continuous.lateCargoDistanceMeters ? continuous.lateCargoValue : continuous.cargoValue
    : tier.value;
  const heavy = step > 0 && roll < FREIGHT_CHANCE;
  const stack = value > SINGLE_COIN_PAYOUT || roll < COIN_STACK_CHANCE;
  return {
    kind: heavy ? 'freight' : stack ? 'coinStack' : 'coin',
    mass: heavy ? GAME_BALANCE.cargo.freightMass : GAME_BALANCE.cargo.singleCoinMass,
    slots: GAME_BALANCE.cargo.pickupSlots,
    value,
  };
}

export function cargoTotals(items) {
  return items.reduce((total, item) => ({
    mass: total.mass + item.mass, slots: total.slots + item.slots, value: total.value + item.value,
  }), {mass: 0, slots: 0, value: 0});
}

function validateItem(item) {
  if (!item || typeof item.kind !== 'string' || !Number.isInteger(item.mass) || item.mass < 1 ||
      !Number.isInteger(item.slots) || item.slots < 1 || !Number.isInteger(item.value) || item.value < 0) {
    throw new Error('Invalid cargo item');
  }
}

/** Baseline sorting replaces exactly one item, never combining or repacking multiple items. */
export function cargoOffer(items, pickup, capacity) {
  validateItem(pickup);
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Invalid cargo capacity');
  const total = cargoTotals(items);
  if (total.mass + pickup.mass <= capacity && total.slots + pickup.slots <= capacity) return {accepted: true, index: -1};
  let index = -1;
  for (let i = 0; i < items.length; i++) {
    const held = items[i];
    if (pickup.value <= held.value || total.mass - held.mass + pickup.mass > capacity ||
        total.slots - held.slots + pickup.slots > capacity) continue;
    if (index === -1 || held.value < items[index].value ||
        (held.value === items[index].value && held.mass > items[index].mass)) index = i;
  }
  return {accepted: index !== -1, index};
}

export function collectCargo(items, pickup, capacity) {
  const offer = cargoOffer(items, pickup, capacity);
  if (!offer.accepted) return {items, accepted: false, replaced: false, gain: 0};
  const stored = {kind: pickup.kind, mass: pickup.mass, slots: pickup.slots, value: pickup.value};
  const next = [...items];
  const removed = offer.index === -1 ? null : next[offer.index];
  if (removed) next[offer.index] = stored;
  else next.push(stored);
  return {items: next, accepted: true, replaced: Boolean(removed), gain: stored.value - (removed?.value ?? 0)};
}

/** Approved Slice 2 rule: jettison the least valuable item, with insured percentage as minimum loss. */
export function damageCargo(items, lossFraction, mitigation = 0) {
  if (!Number.isFinite(lossFraction) || lossFraction < 0 || lossFraction > 1 ||
      !Number.isFinite(mitigation) || mitigation < 0 || mitigation >= 1) {
    throw new Error('Invalid cargo loss');
  }
  if (!items.length) return {items, lostValue: 0};
  const before = cargoTotals(items).value;
  if (mitigation > 0) {
    const lowestFirst = items.map((item, index) => ({item: {...item}, index}))
      .sort((a, b) => a.item.value - b.item.value || a.index - b.index);
    const baselineLoss = Math.max(lowestFirst[0].item.value, Math.ceil(before * lossFraction - 1e-9));
    let remainingLoss = Math.max(1, Math.ceil(baselineLoss * (1 - mitigation) - 1e-9));
    for (const entry of lowestFirst) {
      const deducted = Math.min(entry.item.value, remainingLoss);
      entry.item.value -= deducted;
      remainingLoss -= deducted;
      if (!remainingLoss) break;
    }
    const next = lowestFirst.filter(({item}) => item.value > 0)
      .sort((a, b) => a.index - b.index).map(({item}) => item);
    return {items: next, lostValue: before - cargoTotals(next).value};
  }
  let index = 0;
  for (let i = 1; i < items.length; i++) if (items[i].value < items[index].value) index = i;
  const next = items.filter((_, i) => i !== index).map(item => ({...item}));
  let remainingLoss = Math.max(0, Math.ceil(before * lossFraction - 1e-9) - items[index].value);
  for (const item of next) {
    const deducted = Math.min(item.value, remainingLoss);
    item.value -= deducted;
    remainingLoss -= deducted;
    if (!remainingLoss) break;
  }
  return {items: next, lostValue: before - cargoTotals(next).value};
}
