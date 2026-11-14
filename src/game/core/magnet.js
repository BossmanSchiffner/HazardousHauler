import {GAME_BALANCE} from '../data/gameBalance.js';

const {pullSpeedPxPerSecond: PULL_SPEED_PX_PER_SECOND, reachAboveShipPx: REACH_ABOVE_SHIP_PX,
  reachBelowShipPx: REACH_BELOW_SHIP_PX} = GAME_BALANCE.physics.magnet;

/** Pull a pickup along the direct line to the ship without overshooting it. */
export function advanceMagnet({x, y, targetX, targetY, range, dt}) {
  if (![x, y, targetX, targetY, range, dt].every(Number.isFinite) || range < 0 || dt < 0) {
    throw new Error('Invalid magnet state');
  }
  const dx = targetX - x;
  const dy = targetY - y;
  if (range === 0 || Math.abs(dx) >= range || dy > REACH_ABOVE_SHIP_PX || dy < -REACH_BELOW_SHIP_PX) {
    return {x, y};
  }
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return {x, y};
  const fraction = Math.min(1, PULL_SPEED_PX_PER_SECOND * dt / distance);
  return {x: x + dx * fraction, y: y + dy * fraction};
}
