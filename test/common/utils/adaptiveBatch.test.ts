/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  PROVIDER_BATCH_PROFILES,
  gitProviderBatchSizes,
  isThrottlingError,
  mapInAdaptiveBatches,
  mapInAdaptiveBatchesSettled,
  retryAfterMs,
  retryOnThrottling,
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

  it('ramps up from the start size, and stops at the batch holding the first hit', async () => {
    const items = Array.from({ length: 200 }, (_, index) => index);
    const batches: number[] = [];
    let inFlight = 0;
    const mapper = async (value: number) => {
      inFlight++;
      await new Promise((resolve) => setTimeout(resolve, 2));
      batches.push(inFlight);
      inFlight--;
      return value;
    };
    // The hit is at index 2: a first batch of 5 finds it, nothing else is read
    const early = await mapInAdaptiveBatches(items, mapper, { sizes: PROVIDER_BATCH_PROFILES.github, startSize: 5, stopWhen: (value) => value === 2 });
    expect(early.filter((value) => value !== undefined)).to.have.length(5);
    expect(Math.max(...batches)).to.equal(5);

    // No hit before index 60: 5, 10, 20 then 40 items are read, the batch doubles each time
    batches.length = 0;
    const peaks: number[] = [];
    const late = await mapInAdaptiveBatches(items, async (value: number) => {
      const result = await mapper(value);
      return result;
    }, {
      sizes: PROVIDER_BATCH_PROFILES.github,
      startSize: 5,
      stopWhen: (value) => value === 60,
      onProgress: (done) => peaks.push(done),
    });
    expect(late.filter((value) => value !== undefined)).to.have.length(75);
    expect(peaks[peaks.length - 1]).to.equal(75);
    // A throttling at the ramp keeps the size below the ladder step reached
    const { state, mapper: throttledMapper } = trackingMapper(new Map([[6, { times: 1, error: () => throttled() }]]));
    const backoffs: number[] = [];
    await mapInAdaptiveBatches(items.slice(0, 40), throttledMapper, { sizes: [80, 40, 20, 10, 5, 1], startSize: 5, ...noSleep, onBackoff: (size) => backoffs.push(size) });
    expect(backoffs).to.deep.equal([10]);
    expect(state.peak).to.be.at.most(40);
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

  it('tries one read again after a dropped connection, not after an answer of the provider', async () => {
    let calls = 0;
    const dropped = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) });
    const waits: number[] = [];
    const value = await retryOnThrottling(
      async () => {
        calls++;
        if (calls < 3) {
          throw dropped;
        }
        return 'ok';
      },
      { sleep: async (ms) => { waits.push(ms); }, onRetry: () => undefined },
    );
    expect(value).to.equal('ok');
    expect(calls).to.equal(3);
    expect(waits).to.deep.equal([1000, 2000]);
    // Still dropped at the last try: the error comes out
    calls = 0;
    let rejected: Error | null = null;
    try {
      await retryOnThrottling(async () => { calls++; throw dropped; }, { attempts: 2, ...noSleep });
    } catch (error) {
      rejected = error as Error;
    }
    expect(rejected?.message).to.equal('fetch failed');
    expect(calls).to.equal(2);
    // A missing ticket is the answer of the provider: one call
    calls = 0;
    try {
      await retryOnThrottling(async () => { calls++; throw notFound(); }, noSleep);
    } catch {
      // expected
    }
    expect(calls).to.equal(1);
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
