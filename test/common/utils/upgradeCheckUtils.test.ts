/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  fetchLatestPackageVersion,
  isUpgradeAvailable,
  shouldCheckForUpgrade,
  UPGRADE_CHECK_INTERVAL_MS,
} from '../../../src/common/utils/upgradeCheckUtils.js';

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
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns the version field of the registry payload', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ version: '9.9.9' }), { status: 200 })) as any;
    expect(await fetchLatestPackageVersion('sfdx-hardis')).to.equal('9.9.9');
  });

  it('returns null on HTTP error', async () => {
    globalThis.fetch = (async () => new Response('not found', { status: 404 })) as any;
    expect(await fetchLatestPackageVersion('sfdx-hardis')).to.be.null;
  });

  it('returns null on network failure', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as any;
    expect(await fetchLatestPackageVersion('sfdx-hardis')).to.be.null;
  });

  it('returns null on unexpected payload', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ foo: 'bar' }), { status: 200 })) as any;
    expect(await fetchLatestPackageVersion('sfdx-hardis')).to.be.null;
  });
});
