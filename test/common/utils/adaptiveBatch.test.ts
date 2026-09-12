/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  PROVIDER_BATCH_PROFILES,
  gitProviderBatchSizes,
  isThrottlingError,
  mapInAdaptiveBatches,
  mapInAdaptiveBatchesSettled,
  retryAfterMs,
} from '../../../src/common/utils/adaptiveBatch.js';

const throttled = (retryAfter?: string) => Object.assign(new Error('API rate limit exceeded'), { status: 429, response: { headers: retryAfter ? { 'retry-after': retryAfter } : {} } });
const notFound = () => Object.assign(new Error('Issue does not exist'), { status: 404 });

// A mapper that records how many calls are in flight at the same time; an item listed in failures
// rejects with the given error that many times before answering
function trackingMapper(failures: Map<number, { times: number; error: () => Error }> = new Map()) {
  const state = { inFlight: 0, peak: 0, calls: 0 };
  const mapper = async (value: number) => {
    state.calls++;
    state.inFlight++;
    state.peak = Math.max(state.peak, state.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 2));
    state.inFlight--;
    const failure = failures.get(value);
    if (failure && failure.times > 0) {
      failure.times--;
      throw failure.error();
    }
    return value * 2;
  };
  return { state, mapper };
}

const noSleep = { sleep: async () => undefined };

describe('adaptive batches of provider calls', () => {
  it('has one ladder per provider, and finds the one of a git provider from its label', () => {
    expect(PROVIDER_BATCH_PROFILES.github).to.deep.equal([80, 40, 20, 10, 5, 1]);
    expect(PROVIDER_BATCH_PROFILES.gitlab).to.deep.equal([80, 40, 20, 10, 5, 1]);
    expect(PROVIDER_BATCH_PROFILES.azure).to.deep.equal([50, 20, 10, 5, 1]);
    expect(PROVIDER_BATCH_PROFILES.bitbucket).to.deep.equal([50, 20, 10, 5, 1]);
    expect(PROVIDER_BATCH_PROFILES.jiraCloud).to.deep.equal([20, 10, 5, 1]);
    expect(PROVIDER_BATCH_PROFILES.jiraServer).to.deep.equal([40, 20, 10, 5, 1]);
    expect(PROVIDER_BATCH_PROFILES.serviceNow).to.deep.equal([8, 4, 2, 1]);
    expect(gitProviderBatchSizes('sfdx-hardis GitHub connector')).to.equal(PROVIDER_BATCH_PROFILES.github);
    expect(gitProviderBatchSizes({ getLabel: () => 'sfdx-hardis Azure DevOps connector' })).to.equal(PROVIDER_BATCH_PROFILES.azure);
    expect(gitProviderBatchSizes(null)).to.equal(PROVIDER_BATCH_PROFILES.default);
  });

  it('tells a throttling from the answer of the provider', () => {
    expect(isThrottlingError(throttled())).to.be.true;
    expect(isThrottlingError(Object.assign(new Error('You have exceeded a secondary rate limit'), { status: 403 }))).to.be.true;
    expect(isThrottlingError(Object.assign(new Error('Service Unavailable'), { response: { status: 503 } }))).to.be.true;
    expect(isThrottlingError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))).to.be.true;
    expect(isThrottlingError(Object.assign(new Error('TF400733: The request has been blocked'), {}))).to.be.true;
    expect(isThrottlingError(notFound())).to.be.false;
    expect(isThrottlingError(Object.assign(new Error('Forbidden'), { status: 403 }))).to.be.false;
    expect(isThrottlingError(Object.assign(new Error('Unauthorized'), { statusCode: 401 }))).to.be.false;
    expect(isThrottlingError(new Error('Cannot read properties of undefined'))).to.be.false;
    expect(retryAfterMs(throttled('3'))).to.equal(3000);
    expect(retryAfterMs(Object.assign(new Error('x'), { response: { headers: new Map([['RateLimit-Reset', '2']]) } }))).to.equal(2000);
    expect(retryAfterMs(notFound())).to.be.null;
  });

  it('reads a full batch at a time and keeps the order of the items', async () => {
    const items = Array.from({ length: 200 }, (_, index) => index);
    const { state, mapper } = trackingMapper();
    const results = await mapInAdaptiveBatches(items, mapper, { sizes: PROVIDER_BATCH_PROFILES.github, ...noSleep });
    expect(results).to.deep.equal(items.map((value) => value * 2));
    expect(state.peak).to.equal(80);
  });

  it('backs off to the smaller sizes on a throttling, waits the delay asked for, and keeps the smaller size', async () => {
    const items = Array.from({ length: 30 }, (_, index) => index);
    // Item 3 is throttled twice (at 80 and at 40), item 7 three times (down to size 10 where it passes)
    const { state, mapper } = trackingMapper(new Map([[3, { times: 2, error: () => throttled('1') }], [7, { times: 3, error: () => throttled() }]]));
    const backoffs: Array<[number, number]> = [];
    const results = await mapInAdaptiveBatches(items, mapper, {
      sizes: PROVIDER_BATCH_PROFILES.github,
      sleep: async () => undefined,
      onBackoff: (size, _error, waitMs) => backoffs.push([size, waitMs]),
    });
    expect(results).to.deep.equal(items.map((value) => value * 2));
    expect(backoffs).to.deep.equal([[40, 1000], [20, 1000], [10, 0]]);
    expect(state.peak).to.equal(30);
    // 30 first calls, then 2 retries at 40, 2 at 20, 1 at 10
    expect(state.calls).to.equal(35);
  });

  it('never shrinks the batch for an error that is not a throttling', async () => {
    const items = Array.from({ length: 12 }, (_, index) => index);
    const backoffs: number[] = [];
    const failures: number[] = [];
    const { state, mapper } = trackingMapper(new Map([[4, { times: 99, error: notFound }]]));
    const results = await mapInAdaptiveBatchesSettled(items, mapper, {
      sizes: [5, 2, 1],
      ...noSleep,
      onBackoff: (size) => backoffs.push(size),
      onError: (_error, item) => failures.push(item),
    });
    expect(results[4]).to.be.undefined;
    expect(results[5]).to.equal(10);
    expect(failures).to.deep.equal([4]);
    expect(backoffs).to.deep.equal([]);
    // 12 calls, the missing ticket was asked once
    expect(state.calls).to.equal(12);
    let rejected: Error | null = null;
    try {
      await mapInAdaptiveBatches([1, 2], trackingMapper(new Map([[2, { times: 99, error: notFound }]])).mapper, noSleep);
    } catch (error) {
      rejected = error as Error;
    }
    expect(rejected?.message).to.equal('Issue does not exist');
  });

  it('gives a throttled item one last try at the smallest size, then reports it', async () => {
    const items = [1, 2, 3];
    const failures: number[] = [];
    const { state, mapper } = trackingMapper(new Map([[2, { times: 99, error: () => throttled() }]]));
    const results = await mapInAdaptiveBatchesSettled(items, mapper, { sizes: [5, 1], ...noSleep, onError: (_error, item) => failures.push(item) });
    expect(results).to.deep.equal([2, undefined, 6]);
    expect(failures).to.deep.equal([2]);
    // 3 calls at 5, then item 2 at 1, then its last chance
    expect(state.calls).to.equal(5);
  });

  it('stops after the batch holding the first hit and reports progress', async () => {
    const items = Array.from({ length: 50 }, (_, index) => index);
    const progress: number[] = [];
    const results = await mapInAdaptiveBatches(items, async (value) => value, {
      sizes: [5, 1],
      stopWhen: (value) => value === 7,
      onProgress: (done) => progress.push(done),
    });
    expect(results.slice(0, 10)).to.deep.equal(items.slice(0, 10));
    expect(results[10]).to.be.undefined;
    expect(progress[progress.length - 1]).to.equal(10);
  });

  it('handles an empty list without calling the mapper', async () => {
    let called = false;
    const results = await mapInAdaptiveBatches([], async () => {
      called = true;
      return 1;
    });
    expect(results).to.deep.equal([]);
    expect(called).to.be.false;
  });
});
