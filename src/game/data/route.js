import {GAME_BALANCE} from './gameBalance.js';

export const ROAD_LEFT = GAME_BALANCE.routes.geometry.roadLeftPx;
export const ROAD_RIGHT = GAME_BALANCE.routes.geometry.roadRightPx;
export const PLAYABLE_ROAD_WIDTH = ROAD_RIGHT - ROAD_LEFT;
export const PICKUP_RADIUS_PX = GAME_BALANCE.cargo.pickupCollisionRadiusPx;
export const SHIP_Y = GAME_BALANCE.routes.geometry.shipYpx;
export const SPAWN_Y = GAME_BALANCE.routes.geometry.spawnYpx;
export const HAZARD_TRAVEL_PX = SHIP_Y - SPAWN_Y;
