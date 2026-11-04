/**
 * First-run tips. Pure rules only: the scene reports gameplay events, this module decides
 * which tip (if any) to show, and the seen list is stored in the player profile.
 */
import {DEPOT_RULES} from './depots.js';
import {DEPOT_ECONOMY} from './depotEconomy.js';

export const HINTS = Object.freeze({
  steer: 'Drag left or right to steer.\nAvoid obstacles on the road.',
  cargo: 'Cargo has value and adds Load.\nA fuller load makes steering slower.',
  stack: 'Better cargo appears farther into the run.\nIt can replace cheaper cargo if it fits.',
  hazard: 'Hits damage Hull and can lose cargo.\nAt zero Hull, the run ends.',
  depot: 'Green markers show the Depot side within 60 m.\nLine up with that bay to stop; other lanes bypass.',
  depotEconomy: 'Normal stops refill equipped shields.\nBank & Continue secures cargo; then repair or resume.\nBank & End Run secures cargo and ends the run.\n\n' +
    `Passing outside the indicated bay keeps cargo at risk and adds +${DEPOT_ECONOMY.riskStepPercent}% bonus, up to +${DEPOT_ECONOMY.riskCapPercent}%.\n\n` +
    `Repairs restore ${DEPOT_ECONOMY.repairHullRestored} Hull and cost wallet Coins.`,
});

export const HINT_IDS = Object.freeze(Object.keys(HINTS));

/** Event -> tip that event can trigger. */
const EVENT_HINT = Object.freeze({
  runStart: 'steer',
  coinPickup: 'cargo',
  stackPickup: 'stack',
  hazardHit: 'hazard',
  depotApproach: 'depot',
});

/** Distance before a Depot at which the approach tip is shown. */
export const DEPOT_APPROACH_HINT_M = DEPOT_RULES.noticeMeters;

/** Returns the tip id to show for `event`, or null when it was already seen or the event is unknown. */
export function hintForEvent(seenHints, event) {
  const id = EVENT_HINT[event];
  if (!id || seenHints.includes(id)) return null;
  return id;
}

/** Returns a new seen list with `id` recorded. */
export function markHintSeen(seenHints, id) {
  if (!HINT_IDS.includes(id) || seenHints.includes(id)) return seenHints;
  return [...seenHints, id];
}

/**
 * Sanitises a stored seen-tips list. Saves made before tips existed have no list; players who
 * already completed runs skip the tips, brand-new players see them.
 */
export function normalizeSeenHints(stored, totalRuns) {
  if (!Array.isArray(stored)) return totalRuns > 0 ? [...HINT_IDS] : [];
  return HINT_IDS.filter(id => stored.includes(id));
}
