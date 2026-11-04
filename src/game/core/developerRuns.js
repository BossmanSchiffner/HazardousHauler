const DEVELOPER_RUN = 'developerRun';

export function isDeveloperRun(run) {
  return run?.[DEVELOPER_RUN] === true;
}

export function markDeveloperRun(metadata) {
  return {...metadata, [DEVELOPER_RUN]: true};
}

export function adjustDeveloperCoins(profile, signedAmount) {
  if (!Number.isSafeInteger(signedAmount) || signedAmount === 0) {
    throw new Error('Developer Coin adjustment must be a non-zero safe integer');
  }
  return {...profile, coins: Math.max(0, profile.coins + signedAmount)};
}
