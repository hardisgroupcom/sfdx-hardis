import { PipelineContext } from './pipelineContextUtils.js';
import { t } from './i18n.js';

/**
 * Resolution of ${{ ... }} references in deployment action fields.
 *
 * Two namespaces are understood:
 * - ${{ actions.<actionId>.outputs.<name> }}: an output produced by an earlier action of the run
 * - ${{ pipeline.<name> }}: a pipeline variable (see PipelineContext)
 *
 * Anything else is LEFT UNTOUCHED. Interpolation applies to every field of every action type,
 * including the `command` of plain command actions, so a project already carrying a literal
 * "${{ SOMETHING }}" in a command (a template consumed by the command itself, say) must keep
 * working with no escape and no migration. The price is that a typo in a namespace name passes
 * through silently instead of failing.
 */

const INTERPOLATION_REGEX = /\$\{\{\s*([^}]*?)\s*\}\}/g;
const ACTIONS_REFERENCE_REGEX = /^actions\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_]+)$/;
const PIPELINE_REFERENCE_REGEX = /^pipeline\.([A-Za-z0-9_]+)$/;

/** Outputs produced so far in the run, keyed by action id. */
export type ActionOutputsRegistry = Map<string, Record<string, any>>;

/**
 * Why an action produced no outputs, so an unresolved reference can say what happened instead of
 * just "not found". Keyed by action id, filled as the run progresses.
 */
export type ActionSkipReasons = Map<string, string>;

export class ActionInterpolationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ActionInterpolationError';
  }
}

export interface InterpolationScope {
  outputs: ActionOutputsRegistry;
  skipReasons: ActionSkipReasons;
  pipeline: PipelineContext;
}

/**
 * Resolve every known reference of a single string.
 * Throws ActionInterpolationError when a reference targets a known namespace but cannot be
 * resolved: the consuming action must fail rather than run with a hole in its arguments.
 */
export function interpolateString(value: string, scope: InterpolationScope): string {
  if (typeof value !== 'string' || !value.includes('${{')) {
    return value;
  }
  return value.replace(INTERPOLATION_REGEX, (wholeMatch, rawReference) => {
    const reference = String(rawReference).trim();

    const actionsMatch = ACTIONS_REFERENCE_REGEX.exec(reference);
    if (actionsMatch) {
      return resolveActionOutput(actionsMatch[1], actionsMatch[2], scope);
    }

    const pipelineMatch = PIPELINE_REFERENCE_REGEX.exec(reference);
    if (pipelineMatch) {
      const variableName = pipelineMatch[1];
      const pipelineValue = (scope.pipeline as any)?.[variableName];
      if (pipelineValue === undefined) {
        throw new ActionInterpolationError(
          t('actionInterpolationUnknownPipelineVariable', {
            reference: wholeMatch,
            name: variableName,
            names: Object.keys(scope.pipeline || {}).join(', '),
          })
        );
      }
      return String(pipelineValue);
    }

    // Unknown namespace: not ours, leave it exactly as it was written
    return wholeMatch;
  });
}

function resolveActionOutput(actionId: string, outputName: string, scope: InterpolationScope): string {
  const actionOutputs = scope.outputs.get(actionId);
  if (!actionOutputs) {
    const skipReason = scope.skipReasons.get(actionId);
    throw new ActionInterpolationError(
      skipReason
        ? t('actionInterpolationProducerProducedNothing', { actionId, reason: skipReason })
        : t('actionInterpolationUnknownAction', { actionId })
    );
  }
  if (actionOutputs[outputName] === undefined) {
    throw new ActionInterpolationError(
      t('actionInterpolationUnknownOutput', {
        actionId,
        name: outputName,
        names: Object.keys(actionOutputs).join(', ') || '-',
      })
    );
  }
  return stringifyOutputValue(actionOutputs[outputName]);
}

/**
 * An output value reaches a command line or an env var, so it must become a string.
 * Objects and arrays are JSON-encoded rather than rendered as "[object Object]".
 */
function stringifyOutputValue(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Resolve the references of every interpolatable field of an action, in place.
 *
 * Interpolated fields: `command`, `customUsername` and every value of `parameters` (nested
 * objects and arrays included, so a list parameter such as packageXmlItems works too).
 * Deliberately NOT interpolated: `id`, `type`, `when`, `context` and the branch filters, which
 * select and route the action and are read before any output exists.
 */
export function interpolateActionFields(
  action: { command?: string; customUsername?: string; parameters?: Record<string, any> },
  scope: InterpolationScope
): void {
  if (action.command) {
    action.command = interpolateString(action.command, scope);
  }
  if (action.customUsername) {
    action.customUsername = interpolateString(action.customUsername, scope);
  }
  if (action.parameters) {
    action.parameters = interpolateValue(action.parameters, scope);
  }
}

function interpolateValue(value: any, scope: InterpolationScope): any {
  if (typeof value === 'string') {
    return interpolateString(value, scope);
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateValue(item, scope));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, any> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      result[key] = interpolateValue(entryValue, scope);
    }
    return result;
  }
  return value;
}
