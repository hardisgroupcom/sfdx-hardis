/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { PROVIDER_BATCH_SIZES, mapInAdaptiveBatches, mapInAdaptiveBatchesSettled } from '../../../src/common/utils/adaptiveBatch.js';

// A mapper that records how many calls are in flight at the same time
function trackingMapper(failuresLeft: Map<number, number> = new Map()) {
  const state = { inFlight: 0, peak: 0, calls: 0 };
  const mapper = async (value: number) => {
    state.calls++;
    state.inFlight++;
    state.peak = Math.max(state.peak, state.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 2));
    state.inFlight--;
    const left = failuresLeft.get(value) || 0;
    if (left > 0) {
      failuresLeft.set(value, left - 1);
      throw new Error(`too many requests for ${value}`);
    }
    return value * 2;
  };
  return { state, mapper };
}

describe('adaptive batches of provider calls', () => {
  it('reads 20 at a time and keeps the order of the items', async () => {
    const items = Array.from({ length: 45 }, (_, index) => index);
    const { state, mapper } = trackingMapper();
    const results = await mapInAdaptiveBatches(items, mapper);
    expect(results).to.deep.equal(items.map((value) => value * 2));
    expect(state.peak).to.equal(20);
    expect(PROVIDER_BATCH_SIZES).to.deep.equal([20, 10, 5, 1]);
  });

  it('backs off to 10, then 5, then one by one when a batch fails, and keeps the smaller size', async () => {
    const items = Array.from({ length: 30 }, (_, index) => index);
    // Item 3 fails twice (at 20 and at 10), item 7 fails three times (down to size 1 where it passes)
    const { state, mapper } = trackingMapper(new Map([[3, 2], [7, 3]]));
    const sizesSeen: number[] = [];
    const results = await mapInAdaptiveBatches(items, mapper, { onBackoff: (size) => sizesSeen.push(size) });
    expect(results).to.deep.equal(items.map((value) => value * 2));
    expect(sizesSeen).to.deep.equal([10, 5, 1]);
    expect(state.peak).to.equal(20);
  });

  it('rejects when an item still fails at the smallest size, and reports it in the settled variant', async () => {
    const items = [1, 2, 3];
    let rejected: Error | null = null;
    try {
      await mapInAdaptiveBatches(items, trackingMapper(new Map([[2, 10]])).mapper);
    } catch (error) {
      rejected = error as Error;
    }
    expect(rejected?.message).to.equal('too many requests for 2');
    const failures: number[] = [];
    const results = await mapInAdaptiveBatchesSettled(items, trackingMapper(new Map([[2, 10]])).mapper, { onError: (_error, item) => failures.push(item) });
    expect(results).to.deep.equal([2, undefined, 6]);
    expect(failures).to.deep.equal([2]);
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
