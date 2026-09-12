/*
 * Parallel calls to a git provider or a ticketing provider, in adaptive batches.
 *
 * A batch of 20 calls leaves at once. When one of them fails (rate limit, provider hiccup), the
 * failed items are read again in batches of 10, then 5, then one by one, and the smaller size is kept
 * for the rest of the run. The order of the results follows the order of the items.
 */

/** The batch sizes tried, in order: the pattern every parallel provider call follows */
export const PROVIDER_BATCH_SIZES: readonly number[] = [20, 10, 5, 1];

export interface AdaptiveBatchOptions<T, R> {
  /** Batch sizes to try, largest first (default PROVIDER_BATCH_SIZES) */
  sizes?: readonly number[];
  /** Called when a batch failed and the next size is tried */
  onBackoff?: (nextSize: number, error: unknown) => void;
  /** Settled variant only: called when an item still fails at the smallest size */
  onError?: (error: unknown, item: T, index: number) => void;
  /** Called after each item settled (fulfilled, or failed for good) */
  onProgress?: (done: number, total: number) => void;
  /** Stop after the batch holding the first result for which it is true; the items after are left undefined */
  stopWhen?: (result: R, item: T, index: number) => boolean;
}

async function runAdaptiveBatches<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  options: AdaptiveBatchOptions<T, R>,
  settled: boolean,
): Promise<Array<R | undefined>> {
  const sizes = options.sizes && options.sizes.length > 0 ? options.sizes : PROVIDER_BATCH_SIZES;
  const results = new Array<R | undefined>(items.length);
  const queue = items.map((_, index) => index);
  let sizeIndex = 0;
  let done = 0;
  let stopped = false;
  while (queue.length > 0 && !stopped) {
    const batch = queue.splice(0, Math.max(1, Math.floor(sizes[sizeIndex])));
    const outcomes = await Promise.allSettled(batch.map((index) => mapper(items[index], index)));
    const retry: number[] = [];
    let backoffError: unknown = null;
    for (let position = 0; position < batch.length; position++) {
      const index = batch[position];
      const outcome = outcomes[position];
      if (outcome.status === 'fulfilled') {
        results[index] = outcome.value;
        done++;
        options.onProgress?.(done, items.length);
        if (!stopped && options.stopWhen?.(outcome.value, items[index], index)) {
          stopped = true;
        }
      } else if (sizeIndex < sizes.length - 1) {
        retry.push(index);
        backoffError = backoffError ?? outcome.reason;
      } else if (settled) {
        options.onError?.(outcome.reason, items[index], index);
        done++;
        options.onProgress?.(done, items.length);
      } else {
        throw outcome.reason;
      }
    }
    if (retry.length > 0) {
      sizeIndex++;
      options.onBackoff?.(sizes[sizeIndex], backoffError);
      queue.unshift(...retry);
    }
  }
  return results;
}

/**
 * Map the items through the provider call in adaptive batches. An item that still fails at the
 * smallest size rejects the whole call, like Promise.all. Items not reached because of `stopWhen`
 * are left undefined.
 */
export async function mapInAdaptiveBatches<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  options: AdaptiveBatchOptions<T, R> = {},
): Promise<Array<R | undefined>> {
  return runAdaptiveBatches(items, mapper, options, false);
}

/**
 * Same, but an item that still fails at the smallest size yields undefined and is reported through
 * `onError`: one ticket or one branch the provider refuses must not lose the others.
 */
export async function mapInAdaptiveBatchesSettled<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  options: AdaptiveBatchOptions<T, R> = {},
): Promise<Array<R | undefined>> {
  return runAdaptiveBatches(items, mapper, options, true);
}
