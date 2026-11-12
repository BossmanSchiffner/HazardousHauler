/**
 * Cosmetic presentation tunables only. Nothing here may affect collision, steering, scoring or saves.
 * Obstacle shadows retain the overhead-light spec. Truck contact shadows, suspension and
 * trailer articulation remains cosmetic and cannot move the cab.
 */
export const balance = Object.freeze({
  RUN_TRUCK_VISUAL_SCALE: 1.05,
  COLLECTIBLE_VISUAL_SCALE: 0.95 * 0.95,
  SHADOW_ALPHA: 0.35,
  SHADOW_OFFSET_X: 0,
  SHADOW_OFFSET_Y: 8,
  // Degrees at full lateral speed; positive tilts clockwise into a rightward turn.
  TRUCK_SHADOW_ALPHA: 0.55,
  TRUCK_ROLL_MAX_ANGLE: 3.5,
  TRUCK_ROLL_RETURN_SECONDS: 0.12,
  // Exponential approach rate per second towards the target roll.
  TRUCK_ROLL_LERP_SPEED: 10,
  TRUCK_TRAILER_SPRING: 0.25,
  TRUCK_TRAILER_DELAY_FRAMES: 5,
  TRUCK_TRAILER_MAX_ANGLE: 8,
  TRUCK_TRAILER_MAX_OFFSET_X: 18,
  TRUCK_TRAILER_ROTATION_TRACKING: 0.25,
  TRUCK_TRAILER_SHADOW_OFFSET_Y: 2,
  TRUCK_TRAILER_SHADOW_ALPHA: 0.5,
});

export default balance;
