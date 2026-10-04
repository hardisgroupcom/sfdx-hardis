/*
 * Identical deployment actions run once per run (issue #2271). When several Pull Requests of one
 * deployment carry an action that does the same thing (five stories that each publish the same
 * Experience Cloud site), the first one runs and the others are recorded as done by it.
 *
 * Two actions are identical when they have the same type, the same phase, the same custom username
 * and the same identity parameters (ActionsProvider.getIdentityParameters). Their ids, labels, Pull
 * Requests, contexts and branch filters are not compared: whether an action runs in a job is
 * decided before it is compared, and only an action that succeeded stands for the others.
 *
 * The memory of what already ran lasts one process, like the outputs registry of
 * prePostCommandUtils: one validation job, one deployment job, one sf hardis:project:action:run or
 * one backpromote. This module has no runtime import other than i18n, so the action providers and
 * prePostCommandUtils can both import it without a cycle.
 */
import type { ActionResult, ActionWhen, PrePostCommand } from '../actionsProvider/actionsProvider.js';
import { t } from './i18n.js';

/** The skippedCode of an action that an identical action of the same run did */
export const IDENTICAL_ACTION_SKIPPED_CODE = 'identical-action-already-run';

/** The action that did the work of an identical one */
export interface IdenticalActionRef {
  actionId: string;
  label: string;
  // 0 for an action of the branch or project config
  pr: number;
  prUrl?: string;
}

/** A successful run, standing for the identical actions that come after it */
export interface IdenticalActionRun {
  ref: IdenticalActionRef;
  // Raw outputs of a custom function, so a copy feeds the same ${{ actions.<id>.outputs.<name> }}
  outputs?: Record<string, any>;
  // The masked copy: the only one written to a Pull Request comment
  outputsForDisplay?: Record<string, any>;
}

/** What an action provider tells about the work of an action */
export interface ActionIdentitySource {
  getIdentityParameters(cmd: PrePostCommand): Record<string, any> | null;
}

const successfulRunsByIdentity = new Map<string, IdenticalActionRun>();

export function resetIdenticalActionRuns(): void {
  successfulRunsByIdentity.clear();
}

/**
 * The key of an action for a caller that has no provider instance (the forecast, the backpromote
 * plan, the actions stopped by a failure). An unknown type has no key and logs nothing.
 */
export async function computeActionIdentityKey(
  cmd: PrePostCommand,
  when: ActionWhen,
  options: { refusePlaceholders?: boolean } = {}
): Promise<string | null> {
  const { ActionsProvider } = await import('../actionsProvider/actionsProvider.js');
  const provider = await ActionsProvider.buildActionInstance(cmd, { quiet: true });
  if (!provider) {
    return null;
  }
  return buildIdentityKeyFromProvider(provider, cmd, when, options);
}

/**
 * The key of an action, from its provider instance, or null when it is never merged with another
 * one (manual actions). With refusePlaceholders, an action whose fields still hold a ${{ }}
 * reference has no key: its real values are only known once it is interpolated.
 */
export function buildIdentityKeyFromProvider(
  provider: ActionIdentitySource,
  cmd: PrePostCommand,
  when: ActionWhen,
  options: { refusePlaceholders?: boolean } = {}
): string | null {
  const identityParameters = provider.getIdentityParameters(cmd);
  if (!identityParameters) {
    return null;
  }
  if (options.refusePlaceholders && JSON.stringify([identityParameters, cmd.customUsername || '']).includes('${{')) {
    return null;
  }
  return buildActionIdentityKey(cmd.type, when, cmd.customUsername, identityParameters);
}

/**
 * What an action does, as one comparable string: its type, its phase, the user it runs as and its
 * identity parameters, in a stable order and without empty values.
 */
export function buildActionIdentityKey(
  type: string,
  when: ActionWhen,
  customUsername: string | undefined,
  identityParameters: Record<string, any>
): string {
  return JSON.stringify(
    canonicalizeIdentityValue({
      type: type || 'command',
      when,
      customUsername: (customUsername || '').trim(),
      parameters: identityParameters,
    })
  );
}

/** The run of this process that stands for the action of that key, null when there is none */
export function findIdenticalActionRun(identityKey: string | null): IdenticalActionRun | null {
  return identityKey ? successfulRunsByIdentity.get(identityKey) || null : null;
}

/** Remember a successful run. The first one of a key stays: it is the one that did the work. */
export function recordSuccessfulActionRun(identityKey: string | null, run: IdenticalActionRun): void {
  if (!identityKey || successfulRunsByIdentity.has(identityKey)) {
    return;
  }
  successfulRunsByIdentity.set(identityKey, run);
}

/** The result of an action that the identical action of the run already did */
export function buildIdenticalCopyResult(run: IdenticalActionRun): ActionResult {
  return {
    statusCode: 'skipped',
    skippedCode: IDENTICAL_ACTION_SKIPPED_CODE,
    skippedReason: t('actionSkippedIdenticalAction', { label: run.ref.label, source: formatIdenticalActionSource(run.ref) }),
    identicalTo: run.ref,
    outputs: run.outputs,
    outputsForDisplay: run.outputsForDisplay,
  };
}

export function isIdenticalActionCopy(cmd: Pick<PrePostCommand, 'result'>): boolean {
  return cmd.result?.skippedCode === IDENTICAL_ACTION_SKIPPED_CODE;
}

/** "#101", or the branch or project config for an action that no Pull Request carries */
export function formatIdenticalActionSource(ref: Pick<IdenticalActionRef, 'pr'>): string {
  return ref.pr > 0 ? `#${ref.pr}` : t('actionFromBranchOrProjectConfig');
}

/**
 * In run order, the first item of each key stands for the later ones: returns, for every later item
 * sharing a key, that first item. Items without a key are never grouped.
 */
export function findIdenticalCopies<T>(items: T[], keyOf: (item: T) => string | null): Map<T, T> {
  const firstByKey = new Map<string, T>();
  const copies = new Map<T, T>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) {
      continue;
    }
    const first = firstByKey.get(key);
    if (first === undefined) {
      firstByKey.set(key, item);
    } else {
      copies.set(item, first);
    }
  }
  return copies;
}

/** A repository path written by hand: forward slashes, no leading ./, no trailing / */
export function normalizeIdentityPath(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '');
}

/** Objects with sorted keys and without undefined, null or empty string values, at every level */
export function canonicalizeIdentityValue(value: any): any {
  if (Array.isArray(value)) {
    return value.map(canonicalizeIdentityValue);
  }
  if (value && typeof value === 'object') {
    const canonical: Record<string, any> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry === undefined || entry === null || entry === '') {
        continue;
      }
      canonical[key] = canonicalizeIdentityValue(entry);
    }
    return canonical;
  }
  return value;
}
