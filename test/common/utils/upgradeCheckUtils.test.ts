/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  fetchLatestPackageVersion,
  isUpgradeAvailable,
  isUpgradeCheckDisabled,
  shouldCheckForUpgrade,
  UPGRADE_CHECK_INTERVAL_MS,
} from '../../../src/common/utils/upgradeCheckUtils.js';
import { setFetchForTests } from '../../../src/common/utils/httpUtils.js';

describe('shouldCheckForUpgrade()', () => {
  const now = 1_700_000_000_000;

  it('returns true when never checked', () => {
    expect(shouldCheckForUpgrade(null, now)).to.be.true;
    expect(shouldCheckForUpgrade(undefined, now)).to.be.true;
  });

  it('returns true when the interval has elapsed', () => {
    expect(shouldCheckForUpgrade(now - UPGRADE_CHECK_INTERVAL_MS, now)).to.be.true;
    expect(shouldCheckForUpgrade(now - UPGRADE_CHECK_INTERVAL_MS - 1, now)).to.be.true;
  });

  it('returns false within the interval', () => {
    expect(shouldCheckForUpgrade(now - UPGRADE_CHECK_INTERVAL_MS + 1000, now)).to.be.false;
    expect(shouldCheckForUpgrade(now, now)).to.be.false;
  });

  it('returns true on a corrupted timestamp', () => {
    expect(shouldCheckForUpgrade('bad' as any, now)).to.be.true;
  });
});

describe('isUpgradeAvailable()', () => {
  it('returns true when latest is greater', () => {
    expect(isUpgradeAvailable('7.23.0', '7.24.0')).to.be.true;
    expect(isUpgradeAvailable('7.23.0', '8.0.0')).to.be.true;
  });

  it('returns false when equal or older', () => {
    expect(isUpgradeAvailable('7.23.0', '7.23.0')).to.be.false;
    expect(isUpgradeAvailable('7.23.0', '7.22.9')).to.be.false;
  });

  it('returns false on invalid input', () => {
    expect(isUpgradeAvailable(null, '7.23.0')).to.be.false;
    expect(isUpgradeAvailable('7.23.0', null)).to.be.false;
    expect(isUpgradeAvailable('not-a-version', '7.23.0')).to.be.false;
    expect(isUpgradeAvailable('7.23.0', 'not-a-version')).to.be.false;
  });
});

describe('fetchLatestPackageVersion()', () => {
  afterEach(() => {
    setFetchForTests(null);
  });

  it('returns the version field of the registry payload', async () => {
    setFetchForTests(async () => new Response(JSON.stringify({ version: '9.9.9' }), { status: 200 }));
    expect(await fetchLatestPackageVersion('sfdx-hardis')).to.equal('9.9.9');
  });

  it('returns null on HTTP error', async () => {
    setFetchForTests(async () => new Response('not found', { status: 404 }));
    expect(await fetchLatestPackageVersion('sfdx-hardis')).to.be.null;
  });

  it('returns null on network failure', async () => {
    setFetchForTests(async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(await fetchLatestPackageVersion('sfdx-hardis')).to.be.null;
  });

  it('returns null on unexpected payload', async () => {
    setFetchForTests(async () => new Response(JSON.stringify({ foo: 'bar' }), { status: 200 }));
    expect(await fetchLatestPackageVersion('sfdx-hardis')).to.be.null;
  });
});

describe('isUpgradeCheckDisabled()', () => {
  it('is disabled in CI', () => {
    expect(isUpgradeCheckDisabled({ CI: 'true' } as any)).to.be.true;
    expect(isUpgradeCheckDisabled({ CI: '1' } as any)).to.be.true;
  });

  it('is disabled when NO_UPDATE_NOTIFIER is set', () => {
    expect(isUpgradeCheckDisabled({ NO_UPDATE_NOTIFIER: '1' } as any)).to.be.true;
    expect(isUpgradeCheckDisabled({ NO_UPDATE_NOTIFIER: 'true' } as any)).to.be.true;
  });

  it('is enabled on a developer machine', () => {
    expect(isUpgradeCheckDisabled({} as any)).to.be.false;
    expect(isUpgradeCheckDisabled({ CI: 'false' } as any)).to.be.false;
    expect(isUpgradeCheckDisabled({ NO_UPDATE_NOTIFIER: 'false' } as any)).to.be.false;
  });
});
