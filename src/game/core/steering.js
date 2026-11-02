import {steeringMultiplier} from './economy.js';
import {GAME_BALANCE} from '../data/gameBalance.js';

const {maxLateralSpeedPxPerSecond: MAX_LATERAL_SPEED,
  maxLateralAccelerationPxPerSecondSquared: MAX_LATERAL_ACCELERATION,
  brakingDistanceFactor: BRAKING_DISTANCE_FACTOR,
  laneChangeSimulationHz, laneChangeMaximumSeconds} = GAME_BALANCE.physics.steering;

export const KEYBOARD_BRAKE_SECONDS = 0.06;

/** Advance the hauler toward a pointer target with acceleration and braking. */
export function advanceSteering({
  x,
  velocity,
  targetX,
  dt,
  minX,
  maxX,
  load,
  capacity,
  handling = 0,
  loadRelief = 0,
  vehicleMultiplier = 1,
  digitalBrake = false,
  brakeTimeRemaining = KEYBOARD_BRAKE_SECONDS,
}) {
  if (![x, velocity, targetX, dt, minX, maxX, load, capacity, handling, loadRelief, vehicleMultiplier,
    brakeTimeRemaining].every(Number.isFinite) ||
      dt < 0 || minX > maxX || brakeTimeRemaining < 0 || brakeTimeRemaining > KEYBOARD_BRAKE_SECONDS) {
    throw new Error('Invalid steering state');
  }

  if (digitalBrake) {
    const brakingDt = Math.min(dt, brakeTimeRemaining);
    const nextVelocity = brakingDt < brakeTimeRemaining ? velocity * (1 - brakingDt / brakeTimeRemaining) : 0;
    const nextX = clamp(x + (velocity + nextVelocity) * 0.5 * brakingDt, minX, maxX);
    return {
      x: nextX,
      velocity: nextX === minX ? Math.max(0, nextVelocity)
        : nextX === maxX ? Math.min(0, nextVelocity) : nextVelocity,
      brakeTimeRemaining: Math.max(0, brakeTimeRemaining - dt),
    };
  }

  const response = steeringMultiplier(load, capacity, handling, loadRelief, vehicleMultiplier);
  const maxSpeed = MAX_LATERAL_SPEED * response;
  const acceleration = MAX_LATERAL_ACCELERATION * response;
  const error = targetX - x;
  const brakingLimitedSpeed = Math.sqrt(BRAKING_DISTANCE_FACTOR * acceleration * Math.abs(error));
  const desiredVelocity = Math.sign(error) * Math.min(maxSpeed, brakingLimitedSpeed);
  const velocityChange = clamp(desiredVelocity - velocity, -acceleration * dt, acceleration * dt);
  let nextVelocity = velocity + velocityChange;
  let nextX = x + (velocity + nextVelocity) * 0.5 * dt;

  if ((error > 0 && nextX >= targetX && nextVelocity > 0) ||
      (error < 0 && nextX <= targetX && nextVelocity < 0)) {
    nextX = targetX;
    nextVelocity = 0;
  }

  if (nextX <= minX) {
    nextX = minX;
    nextVelocity = Math.max(0, nextVelocity);
  } else if (nextX >= maxX) {
    nextX = maxX;
    nextVelocity = Math.min(0, nextVelocity);
  }

  return {x: nextX, velocity: nextVelocity};
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Seconds for a truck resting on a lane center to move `clearDistance` px
 * toward a neighbouring lane `laneSpacing` px away (zero reaction time).
 */
export function laneClearTimeSeconds({load, capacity, handling = 0, loadRelief = 0, laneSpacing, clearDistance}) {
  const dt = 1 / laneChangeSimulationHz;
  let state = {x: 0, velocity: 0};
  for (let time = 0; time < laneChangeMaximumSeconds; time += dt) {
    if (state.x >= clearDistance) return time;
    state = advanceSteering({
      ...state, targetX: laneSpacing, dt, minX: -laneSpacing, maxX: laneSpacing * 2,
      load, capacity, handling, loadRelief,
    });
  }
  throw new Error('Lane change never clears the requested distance');
}
