import {damageCargo} from './cargo.js';
import {GAME_BALANCE} from '../data/gameBalance.js';
import {hazardGeometry} from './hazards.js';

/** Swept relative motion through a body's longitudinal window; samples cannot skip a close pass. */
export function advanceNearMiss(state, hazard, previous, current) {
  if (![previous.x, previous.y, current.x, current.y].every(Number.isFinite)) {
    throw new Error('Invalid near-miss trajectory');
  }
  const geometry = hazardGeometry(hazard);
  const halfWidth = GAME_BALANCE.hazards.playerHalfWidthPx;
  const halfHeight = GAME_BALANCE.hazards.playerHalfHeightPx;
  const parts = geometry.footprint ?? [{x: 0, y: 0,
    halfWidth: geometry.hitX - halfWidth, halfHeight: geometry.hitY - halfHeight}];
  const next = {...(state ?? {minimumGap: Infinity, contacted: false, resolved: false})};
  if (next.resolved) return {...next, award: false};
  const dy = current.y - previous.y, dx = current.x - previous.x;
  for (const part of parts) {
    const limit = part.halfHeight + halfHeight;
    let from = 0, to = 1;
    if (dy === 0) {
      if (Math.abs(previous.y + part.y) > limit) continue;
    } else {
      const first = (-limit - previous.y - part.y) / dy;
      const last = (limit - previous.y - part.y) / dy;
      from = Math.max(0, Math.min(first, last));
      to = Math.min(1, Math.max(first, last));
      if (from > to) continue;
    }
    const x1 = previous.x + dx * from + part.x, x2 = previous.x + dx * to + part.x;
    const closest = x1 * x2 <= 0 ? 0 : Math.min(Math.abs(x1), Math.abs(x2));
    const gap = closest - (part.halfWidth + halfWidth);
    next.minimumGap = Math.min(next.minimumGap, gap);
    if (gap <= 0) next.contacted = true;
  }
  const passed = parts.every(part => current.y + part.y > part.halfHeight + halfHeight);
  const {minimumGapPx, maximumGapPx} = GAME_BALANCE.physics.collision.closeCall;
  next.award = passed && !next.contacted &&
    next.minimumGap >= minimumGapPx && next.minimumGap <= maximumGapPx;
  next.resolved = passed;
  return next;
}

export function cargoPickupHits(pickupX, pickupY, shipX, shipY) {
  const scale = GAME_BALANCE.cargo.pickupTriggerScale;
  return Math.abs(pickupX - shipX) < GAME_BALANCE.cargo.pickupCollisionRadiusPx * scale &&
    Math.abs(pickupY - shipY) < GAME_BALANCE.physics.collision.cargoHalfHeightPx * scale;
}

/** Resolves a single obstacle contact in the shared damage → pulse → terminal order. */
export function resolveHazardCollision({
  invulnerableSeconds, shieldCharges = 0, hull, hullDamage, cargoItems, cargoLossFraction,
  cargoMitigation = 0, baseInvulnerabilitySeconds, impactPulseSeconds = 0,
  shieldInvulnerabilitySeconds,
}) {
  if (![invulnerableSeconds, hull, hullDamage, cargoLossFraction, cargoMitigation,
    baseInvulnerabilitySeconds, impactPulseSeconds, shieldInvulnerabilitySeconds].every(Number.isFinite) ||
      invulnerableSeconds < 0 || hull < 1 || hullDamage < 1 || baseInvulnerabilitySeconds < 0 ||
      impactPulseSeconds < 0 || shieldInvulnerabilitySeconds < 0 ||
      !Number.isInteger(shieldCharges) || shieldCharges < 0) {
    throw new Error('Invalid hazard collision state');
  }
  if (invulnerableSeconds > 0) return {kind: 'immune', hull, cargoItems, shieldCharges, lostValue: 0};
  if (shieldCharges > 0) return {kind: 'shielded', hull, cargoItems, shieldCharges: shieldCharges - 1, lostValue: 0,
    invulnerabilitySeconds: shieldInvulnerabilitySeconds};

  const damagedCargo = damageCargo(cargoItems, cargoLossFraction, cargoMitigation);
  const nextHull = Math.max(0, hull - hullDamage);
  const damagingHit = true;
  const clearObstacles = impactPulseSeconds > 0;
  const nextInvulnerability = baseInvulnerabilitySeconds + impactPulseSeconds;
  const fatal = nextHull <= 0;
  return {
    kind: 'damaged', hull: nextHull, cargoItems: damagedCargo.items, shieldCharges, lostValue: damagedCargo.lostValue,
    damagingHit, clearObstacles, invulnerabilitySeconds: nextInvulnerability, fatal,
  };
}
