// Helpers for the sfdx-hardis upgrade check performed by the init hook.
// Kept free of heavy imports: the hook runs at CLI startup.
import semver from 'semver';
import { proxyFetch } from './httpUtils.js';

export const UPGRADE_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 6; // check every 6 hours
export const UPGRADE_CHECK_FETCH_TIMEOUT_MS = 3000;

// Single definition lives in the dependency-free envUtils leaf module
export { isUpgradeCheckDisabled } from './envUtils.js';

// True when the last check is old enough (or never happened) to check again
export function shouldCheckForUpgrade(lastCheckTs: number | null | undefined, nowTs: number, intervalMs: number = UPGRADE_CHECK_INTERVAL_MS): boolean {
  if (!lastCheckTs || typeof lastCheckTs !== 'number') {
    return true;
  }
  return nowTs - lastCheckTs >= intervalMs;
}

// True when latest is a valid semver strictly greater than current
export function isUpgradeAvailable(current: string | null | undefined, latest: string | null | undefined): boolean {
  if (!current || !latest || !semver.valid(current) || !semver.valid(latest)) {
    return false;
  }
  return semver.gt(latest, current);
}

// Fetch the latest published version of a package on the npm registry.
// Returns null on any error (network, timeout, unexpected payload): the upgrade
// check must never break or slow down CLI startup.
export async function fetchLatestPackageVersion(packageName: string, timeoutMs: number = UPGRADE_CHECK_FETCH_TIMEOUT_MS): Promise<string | null> {
  try {
    const response = await proxyFetch(`https://registry.npmjs.org/${packageName}/latest`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return null;
    }
    const packageData: any = await response.json();
    return typeof packageData?.version === 'string' ? packageData.version : null;
  } catch {
    return null;
  }
}
