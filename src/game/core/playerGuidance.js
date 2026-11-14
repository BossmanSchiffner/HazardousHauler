import {DEPOT_ECONOMY} from './depotEconomy.js';
import {GAME_BALANCE} from '../data/gameBalance.js';

const noDamageBonusPercent = Math.round((GAME_BALANCE.rewards.noDamageCargo.multiplier - 1) * 100);

export const HELP_SECTIONS = Object.freeze([
  ['STEER', 'Drag left or right to steer. Drag vertically to scroll menus.'],
  ['COLLECT CARGO', 'Collect Cargo to gain more coins. Cargo in further Sections are more valuable!.'],
  ['WATCH YOUR LOAD', 'A fuller load makes steering more difficult!.'],
  ['AVOID HAZARDS', 'Hits damage Hull and drop valuable cargo! Bank your cargo before a crash takes it all!'],
  ['USE DEPOTS', 'Depot-side markers appear within 60 m. Line up with the indicated bay to stop and refill Normal shields.\nBank & Continue secures Normal cargo; then repair or resume. Bank & End Run ends safely.\nOther lanes bypass with cargo at risk for a bigger bonus; no shield recharge.\nEndless stops: End Run pays out, or Skip restores shields without banking.'],
  ['BONUS SYSTEM', `Each skip adds +${DEPOT_ECONOMY.riskStepPercent}%, up to +${DEPOT_ECONOMY.riskCapPercent}%. Near misses add +${GAME_BALANCE.physics.collision.closeCall.bonusStepPercent}% up to +${GAME_BALANCE.physics.collision.closeCall.maximumBonusPercent}%; Hull or shield hits reset the unbanked near-miss bonus. After two Depots, stay damage-free to earn +${noDamageBonusPercent}% on eligible cargo at run end.`],
  ['UPGRADE SMART', 'Spend Coins in the Garage on Steering, Cargo Capacity and other upgrades.'],
].map(Object.freeze));

export const createRunContext = () => ({
  fullLoadSeconds: 0, crashLoadRatio: 0, cargoLostToHits: 0, damagedDepot: false,
});

export function resultTip(context, result, runNumber) {
  const tips = [];
  const crashed = result.reason === 'Hull destroyed';
  if (crashed && context.crashLoadRatio >= 0.8) {
    tips.push('A heavy load slows steering. Upgrade your steering help you stay in control!');
  }
  if (context.fullLoadSeconds >= 8) {
    tips.push('Often full? Upgrade your Cargo Capacity to carry more Cargo before banking.');
  }
  if (result.cargoLost >= 20) {
    tips.push('Bank at Depots to secure cargo before a crash can wipe it out!');
  }
  if (!crashed && result.distance < 700 && result.secured < 60 && result.bankingEvents <= 1) {
    tips.push('Skipping a Depot builds your bonus, but puts your Cargo at greater risk!');
  }
  if (context.damagedDepot && result.repairPurchases === 0) {
    tips.push(`A repair at a Depot restores ${DEPOT_ECONOMY.repairHullRestored} Hull and can keep a strong run going. Use it wisely! You can only repair once per Run!`);
  }
  if (!crashed) tips.push('Try reaching one Depot farther next run to build a larger bonus!');
  if (!tips.length) tips.push('Cargo weight affects your ability to steer! Steer early and leave room to change lanes.');
  return `Tip: ${tips[Math.max(0, runNumber - 1) % tips.length]}`;
}
