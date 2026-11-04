import {GAME_BALANCE} from '../data/gameBalance.js';
import {MODULE_DEFS, MILESTONES} from './modules.js';
import {SLOT_MAX, METERS_PER_PIXEL, routeSpeedAtDistance, routeTimeAtDistance} from './economy.js';
import {IMPLEMENTED_LEVELS} from './sectors.js';
import {normalizeProfile} from './save.js';
import {canonicalMotionAge, hazardGeometry, hazardHits, hazardX, hazardScrollScale, LANE_CENTERS, movingHazardOffset} from './hazards.js';
import {advanceSteering} from './steering.js';
import {ROAD_LEFT, ROAD_RIGHT} from '../data/route.js';

export const DEBUG_FAST_MULTIPLIER = 3.5;
export const BOT_LOOKAHEAD_PX = 350;

export function parseDebugFlags(search = '') {
  const params = new URLSearchParams(search);
  const flags = {};
  for (const key of ['god', 'bot', 'unlockAll', 'fast', 'level', 'sector']) {
    if (params.getAll(key).length > 1) throw new Error(`Duplicate debug parameter: ${key}`);
  }
  for (const key of ['god', 'bot', 'unlockAll', 'fast']) {
    const value = params.get(key);
    if (value !== null && value !== 'true' && value !== 'false') {
      throw new Error(`Debug parameter ${key} must be true or false`);
    }
    flags[key] = value === 'true';
  }
  let warp = null;
  if (params.has('level') || params.has('sector')) {
    const level = params.get('level');
    const sector = params.get('sector');
    if (!/^[1-9]\d*$/.test(level ?? '') || !/^[1-9]\d*$/.test(sector ?? '')) {
      throw new Error('Debug warp requires integer level and sector parameters');
    }
    const levelId = `level${level}`;
    const sectorNumber = Number(sector);
    if (!IMPLEMENTED_LEVELS[levelId]?.some(candidate => candidate.number === sectorNumber)) {
      throw new Error(`Debug warp is unavailable: Level ${level}, Sector ${sector}`);
    }
    warp = Object.freeze({levelId, sectorNumber});
  }
  return Object.freeze({...flags, warp,
    active: flags.god || flags.bot || flags.unlockAll || flags.fast || warp !== null});
}

function createDebugProfile(profile, unlockAll) {
  const next = structuredClone(profile);
  if (!unlockAll) return next;
  next.coins = 99_999;
  next.ownedVehicleIds = ['standard', 'swift'];
  next.milestones = [...MILESTONES];
  for (const [levelId, sectors] of Object.entries(IMPLEMENTED_LEVELS)) {
    next.levelProgress[levelId] = {...next.levelProgress[levelId], unlocked: true,
      completed: true, sector3CheckpointUnlocked: true,
      reachedSectors: sectors.map(sector => sector.number),
      completedSectors: sectors.map(sector => sector.number)};
  }
  for (const def of MODULE_DEFS) next.ownedModules[def.id] = Math.max(1, next.ownedModules[def.id] ?? 0);
  for (const id of next.ownedVehicleIds) {
    next.shipStates[id] = {...next.shipStates[id], unlockedSlotCount: SLOT_MAX,
      ownedColorIds: [GAME_BALANCE.presentation.defaultOwnedTrim, ...GAME_BALANCE.presentation.trimChoices,
        ...(id === 'standard' ? [GAME_BALANCE.rewards.level1NoDamageGold.colorId] : [])]};
  }
  return normalizeProfile(next);
}

const nearestLane = x => LANE_CENTERS.reduce((best, center, lane) =>
  Math.abs(center - x) < Math.abs(LANE_CENTERS[best] - x) ? lane : best, 0);

export class DebugManager {
  constructor(search = '') {
    this.flags = parseDebugFlags(search);
    this.botLane = null;
  }

  get active() { return this.flags.active; }
  get timeScale() { return this.flags.fast ? DEBUG_FAST_MULTIPLIER : 1; }

  profileForSession(profile) {
    return this.active ? createDebugProfile(profile, this.flags.unlockAll) : profile;
  }

  persist(profile, save) {
    if (this.active) return true; // Explicit URL sessions commit only to their in-memory profile.
    return save(profile);
  }

  resetBot(shipX) {
    this.botLane = nearestLane(shipX);
  }

  botTarget({ship, objects, distance, levelId, runMode, shipVelocityX, cargoWeight, stats, keyboardBrakeRemaining}) {
    const lane = nearestLane(ship.x);
    const hazards = objects.filter(item => {
      if (item.type !== 'hazard') return false;
      const geometry = hazardGeometry(item);
      return item.sprite.y + geometry.hitY >= ship.y - BOT_LOOKAHEAD_PX &&
        item.sprite.y - geometry.hitY <= ship.y;
    });
    if (this.botLane === null) this.botLane = lane;
    if (!hazards.length) return LANE_CENTERS[this.botLane];
    // Check the whole turn/contact window with the live movement and collision owners.
    const candidates = LANE_CENTERS.map((targetX, candidate) => {
      let x = ship.x, velocity = shipVelocityX, travelled = 0, futureDistance = distance, elapsed = 0;
      const dt = 1 / 60;
      while (travelled < BOT_LOOKAHEAD_PX) {
        const scroll = routeSpeedAtDistance(futureDistance, levelId, runMode);
        const step = Math.min(dt, (BOT_LOOKAHEAD_PX - travelled) / scroll);
        const movement = advanceSteering({x, velocity, targetX, dt: step,
          minX: ROAD_LEFT + 30, maxX: ROAD_RIGHT - 30,
          load: cargoWeight, capacity: stats.capacity, handling: stats.handling,
          loadRelief: stats.loadRelief, vehicleMultiplier: stats.vehicleSteeringMultiplier,
          digitalBrake: false, brakeTimeRemaining: keyboardBrakeRemaining});
        x = movement.x;
        velocity = movement.velocity;
        travelled += scroll * step;
        futureDistance += scroll * step * METERS_PER_PIXEL;
        elapsed += step;
        if (hazards.some(item => {
          const age = Number.isFinite(item.plannedDistance)
            ? canonicalMotionAge(item.plannedDistance, futureDistance, levelId, runMode)
            : (item.motionAge ?? 0) + elapsed;
          const hazardPositionX = item.movement
            ? hazardX({...item, movementOffsetPx: movingHazardOffset(item.movement, age)}) : item.sprite.x;
          return hazardHits(item, hazardPositionX, item.sprite.y + travelled * hazardScrollScale(item), x, ship.y);
        })) return {lane: candidate, clearance: travelled};
      }
      return {lane: candidate, clearance: BOT_LOOKAHEAD_PX};
    });
    const retained = candidates[this.botLane];
    if (retained.clearance === BOT_LOOKAHEAD_PX) return LANE_CENTERS[this.botLane];
    candidates.sort((a, b) => b.clearance - a.clearance ||
      Math.abs(a.lane - lane) - Math.abs(b.lane - lane) ||
      Math.abs(a.lane - 1.5) - Math.abs(b.lane - 1.5));
    this.botLane = candidates[0].lane;
    return LANE_CENTERS[this.botLane];
  }

  inspectionSeconds(levelId) {
    const end = GAME_BALANCE.routes[levelId].sectorEndsMeters.at(-1);
    return routeTimeAtDistance(end, levelId) / this.timeScale;
  }
}
