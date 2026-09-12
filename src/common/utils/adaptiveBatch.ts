/*
 * Parallel calls to a git provider or a ticketing provider, in adaptive batches.
 *
 * Each provider has its own ladder of batch sizes (GitHub allows 100 concurrent requests, a
 * ServiceNow node serves a handful). A batch of the first size leaves at once. When one of its
 * calls is throttled (429, a rate limit 403, a 5xx, a dropped connection), the throttled items are
 * read again in smaller batches, after the delay the provider asked for in Retry-After, and the
 * smaller size is kept for the rest of the run. Any other error (a ticket that does not exist, a
 * permission refused) is final for that item and never shrinks the batch. The order of the results
 * follows the order of the items.
 */

export type ProviderBatchProfileName = 'github' | 'gitlab' | 'azure' | 'bitbucket' | 'jiraCloud' | 'jiraServer' | 'serviceNow' | 'default';

/** The ladders of batch sizes, per provider, largest first */
export const PROVIDER_BATCH_PROFILES: Record<ProviderBatchProfileName, readonly number[]> = {
  // Sized on what the provider serves concurrently, not on its quota: the quota is spent either way,
  // a throttling only means the smaller sizes below are tried, after the pause the provider asks for.
  // 100 concurrent requests allowed
  github: [80, 40, 20, 10, 5, 1],
  // No concurrency cap
  gitlab: [80, 40, 20, 10, 5, 1],
  // No concurrency cap; a burst is throttled with a Retry-After when the budget runs out
  azure: [50, 20, 10, 5, 1],
  // No concurrency cap; an hourly quota
  bitbucket: [50, 20, 10, 5, 1],
  // A dynamic per user budget, answered with 429 and Retry-After
  jiraCloud: [20, 10, 5, 1],
  // No limit by default, a token bucket when the admin enables one
  jiraServer: [40, 20, 10, 5, 1],
  // Bounded by the REST semaphores of the node (a few per node): more only queues
  serviceNow: [8, 4, 2, 1],
  default: [20, 10, 5, 1],
};

/** The ladder of a git provider, from its label ("sfdx-hardis GitHub connector") or its instance */
export function gitProviderBatchSizes(provider: string | { getLabel(): string } | null | undefined): readonly number[] {
  const label = (typeof provider === 'string' ? provider : provider?.getLabel?.() || '').toLowerCase();
  if (label.includes('github')) {
    return PROVIDER_BATCH_PROFILES.github;
  }
  if (label.includes('gitlab')) {
    return PROVIDER_BATCH_PROFILES.gitlab;
  }
  if (label.includes('azure')) {
    return PROVIDER_BATCH_PROFILES.azure;
  }
  if (label.includes('bitbucket')) {
    return PROVIDER_BATCH_PROFILES.bitbucket;
  }
  return PROVIDER_BATCH_PROFILES.default;
}

// ---- Errors ----

const THROTTLING_MESSAGE = /rate limit|too many requests|throttl|retry later|retry after|request was blocked|TF400733|ECONNRESET|ETIMEDOUT|ECONNABORTED|socket hang up/i;
const THROTTLING_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_SOCKET']);

function anyOf(error: any, keys: string[]): any {
  for (const key of keys) {
    const value = key.split('.').reduce((current, part) => (current === null || current === undefined ? undefined : current[part]), error);
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

/** The HTTP status carried by an error of octokit, gitbeaker, azure-devops-node-api, the Bitbucket client or httpUtils */
export function httpStatusOf(error: unknown): number | null {
  const status = anyOf(error, ['status', 'statusCode', 'response.status', 'response.statusCode', 'cause.status', 'cause.response.status', 'cause.statusCode']);
  const number = typeof status === 'string' ? parseInt(status, 10) : status;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

/**
 * True when the provider pushed back (rate limit, throttling, a server or network failure that a
 * smaller batch and a pause can fix). A 404, a 401 or a 403 that is not a rate limit is the answer
 * of the provider, not a throttling: it never shrinks the batch.
 */
export function isThrottlingError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  const status = httpStatusOf(error);
  const message = String((error as any)?.message || (error as any)?.cause?.message || (error as any)?.cause?.description || '');
  if (status === 429 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  if (status === 403) {
    return /rate limit|secondary|abuse|throttl/i.test(message);
  }
  if (status !== null && status >= 400 && status < 500) {
    return false;
  }
  const code = String((error as any)?.code || (error as any)?.cause?.code || '');
  return THROTTLING_CODES.has(code) || THROTTLING_MESSAGE.test(message);
}

function headerOf(headers: any, name: string): string | null {
  if (!headers) {
    return null;
  }
  const entries: Array<[string, unknown]> = typeof headers.get === 'function' && typeof headers.keys === 'function'
    ? [...headers.keys()].map((key: string) => [key, headers.get(key)])
    : Object.keys(headers).map((key) => [key, headers[key]]);
  for (const [key, raw] of entries) {
    if (String(key).toLowerCase() === name) {
      const value = Array.isArray(raw) ? raw[0] : raw;
      return value === null || value === undefined ? null : String(value);
    }
  }
  return null;
}

/** The delay the provider asked for (Retry-After, RateLimit-Reset, X-RateLimit-Reset), in milliseconds, or null */
export function retryAfterMs(error: unknown): number | null {
  const headers = anyOf(error, ['response.headers', 'headers', 'cause.response.headers', 'cause.headers']);
  const retryAfter = headerOf(headers, 'retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000);
    }
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) {
      return Math.max(0, date - Date.now());
    }
  }
  for (const name of ['ratelimit-reset', 'x-ratelimit-reset']) {
    const reset = headerOf(headers, name);
    if (reset && Number.isFinite(Number(reset))) {
      const value = Number(reset);
      // An epoch (GitHub) or a number of seconds (GitLab)
      return Math.max(0, value > 1_000_000_000 ? value * 1000 - Date.now() : value * 1000);
    }
  }
  return null;
}

// ---- Batches ----

export interface AdaptiveBatchOptions<T, R> {
  /** The ladder of batch sizes, largest first (default PROVIDER_BATCH_PROFILES.default) */
  sizes?: readonly number[];
  /** Whether an error is a throttling that a smaller batch and a pause can fix (default isThrottlingError) */
  shouldBackoff?: (error: unknown) => boolean;
  /** The delay to wait before the next batch after a throttling, in ms (default retryAfterMs, capped by maxWaitMs) */
  retryAfter?: (error: unknown) => number | null;
  /** Longest pause honored from a Retry-After (default 60 seconds) */
  maxWaitMs?: number;
  /** Called when a batch was throttled and the next size is tried, with the pause taken */
  onBackoff?: (nextSize: number, error: unknown, waitMs: number) => void;
  /** Settled variant only: called when an item fails for good */
  onError?: (error: unknown, item: T, index: number) => void;
  /** Called after each item settled (fulfilled, or failed for good) */
  onProgress?: (done: number, total: number) => void;
  /** Stop after the batch holding the first result for which it is true; the items after are left undefined */
  stopWhen?: (result: R, item: T, index: number) => boolean;
  /** Pause function, replaceable in tests */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_WAIT_MS = 60_000;

async function runAdaptiveBatches<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  options: AdaptiveBatchOptions<T, R>,
  settled: boolean,
): Promise<Array<R | undefined>> {
  const sizes = options.sizes && options.sizes.length > 0 ? options.sizes : PROVIDER_BATCH_PROFILES.default;
  const shouldBackoff = options.shouldBackoff || isThrottlingError;
  const retryAfter = options.retryAfter || retryAfterMs;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const sleep = options.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const results = new Array<R | undefined>(items.length);
  const queue = items.map((_, index) => index);
  // At the smallest size a throttled item gets one more try after the pause the provider asked for
  const lastChanceGiven = new Set<number>();
  let sizeIndex = 0;
  let done = 0;
  let stopped = false;
  while (queue.length > 0 && !stopped) {
    const batch = queue.splice(0, Math.max(1, Math.floor(sizes[sizeIndex])));
    const outcomes = await Promise.allSettled(batch.map((index) => mapper(items[index], index)));
    const retry: number[] = [];
    let throttling: unknown = null;
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
        continue;
      }
      const throttled = shouldBackoff(outcome.reason);
      const canRetry = throttled && (sizeIndex < sizes.length - 1 || !lastChanceGiven.has(index));
      if (canRetry) {
        if (sizeIndex >= sizes.length - 1) {
          lastChanceGiven.add(index);
        }
        retry.push(index);
        throttling = throttling ?? outcome.reason;
      } else if (settled) {
        options.onError?.(outcome.reason, items[index], index);
        done++;
        options.onProgress?.(done, items.length);
      } else {
        throw outcome.reason;
      }
    }
    if (retry.length > 0) {
      if (sizeIndex < sizes.length - 1) {
        sizeIndex++;
      }
      const waitMs = Math.min(Math.max(0, retryAfter(throttling) ?? 0), maxWaitMs);
      options.onBackoff?.(sizes[sizeIndex], throttling, waitMs);
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      queue.unshift(...retry);
    }
  }
  return results;
}

/**
 * Map the items through the provider call in adaptive batches. An item that fails for good (not a
 * throttling, or still throttled at the smallest size) rejects the whole call, like Promise.all.
 * Items not reached because of `stopWhen` are left undefined.
 */
export async function mapInAdaptiveBatches<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  options: AdaptiveBatchOptions<T, R> = {},
): Promise<Array<R | undefined>> {
  return runAdaptiveBatches(items, mapper, options, false);
}

/**
 * Same, but an item that fails for good yields undefined and is reported through `onError`: one
 * ticket or one branch the provider refuses must not lose the others.
 */
export async function mapInAdaptiveBatchesSettled<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  options: AdaptiveBatchOptions<T, R> = {},
): Promise<Array<R | undefined>> {
  return runAdaptiveBatches(items, mapper, options, true);
}
