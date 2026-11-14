import {GAME_BALANCE} from '../data/gameBalance.js';
import {IMPLEMENTED_VEHICLE_IDS, VEHICLES} from '../data/catalog.js';

const fail = reason => ({ok: false, reason});

export function vehicleStatus(profile, vehicleId) {
  const vehicle = VEHICLES.find(candidate => candidate.id === vehicleId);
  if (!vehicle || !IMPLEMENTED_VEHICLE_IDS.includes(vehicleId)) throw new Error(`Unsupported vehicle ${vehicleId}`);
  const owned = profile.ownedVehicleIds.includes(vehicleId);
  const levelUnlocked = vehicleId !== 'swift' || profile.levelProgress?.level2?.unlocked === true;
  return {
    vehicle, owned, selected: profile.selectedVehicleId === vehicleId,
    levelUnlocked, cost: vehicle.bpCost,
    canPurchase: !owned && levelUnlocked && profile.blueprints >= vehicle.bpCost,
    lockReason: !levelUnlocked ? 'Finish Level 1 to unlock the Swift Runner.' : null,
  };
}

export function purchaseVehicle(profile, vehicleId) {
  const status = vehicleStatus(profile, vehicleId);
  if (status.owned) return fail('Already owned');
  if (!status.levelUnlocked) return fail(status.lockReason);
  if (profile.blueprints < status.cost) return fail('Not enough Blueprints');
  const slots = GAME_BALANCE.vehicles[vehicleId].baseEquipmentSlots;
  return {ok: true, profile: {
    ...profile,
    blueprints: profile.blueprints - status.cost,
    ownedVehicleIds: [...profile.ownedVehicleIds, vehicleId],
    shipStates: {
      ...profile.shipStates,
      [vehicleId]: {
        unlockedSlotCount: slots,
        equippedModuleIds: [],
        ownedColorIds: [GAME_BALANCE.presentation.defaultOwnedTrim],
        equippedColorId: GAME_BALANCE.presentation.defaultOwnedTrim,
      },
    },
  }};
}

export function selectVehicle(profile, vehicleId) {
  const status = vehicleStatus(profile, vehicleId);
  if (!status.owned) return fail('Purchase this vehicle first');
  return {ok: true, profile: {...profile, selectedVehicleId: vehicleId}};
}

export function buyVehicleTrim(profile, vehicleId, trimId) {
  if (!IMPLEMENTED_VEHICLE_IDS.includes(vehicleId) || !GAME_BALANCE.presentation.trimChoices.includes(trimId)) {
    throw new Error('Invalid vehicle trim purchase');
  }
  const state = profile.shipStates[vehicleId];
  if (!profile.ownedVehicleIds.includes(vehicleId) || !state) return fail('Own this vehicle first');
  if (state.ownedColorIds.includes(trimId)) return fail('Trim already owned');
  const cost = GAME_BALANCE.presentation.cosmeticPriceCoins[trimId];
  if (profile.coins < cost) return fail('Not enough Coins');
  return {ok: true, profile: {...profile, coins: profile.coins - cost,
    shipStates: {...profile.shipStates, [vehicleId]: {
      ...state, ownedColorIds: [...state.ownedColorIds, trimId],
    }}}};
}

export function selectVehicleTrim(profile, vehicleId, trimId) {
  const state = profile.shipStates[vehicleId];
  if (!profile.ownedVehicleIds.includes(vehicleId) || !state) return fail('Own this vehicle first');
  if (!state.ownedColorIds.includes(trimId)) return fail('Purchase or unlock this trim first');
  return {ok: true, profile: {...profile, shipStates: {...profile.shipStates,
    [vehicleId]: {...state, equippedColorId: trimId}}}};
}
