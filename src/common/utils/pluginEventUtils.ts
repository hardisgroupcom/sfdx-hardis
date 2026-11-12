/**
 * Events sent by sfdx-hardis to the installed sf plugins.
 *
 * They are oclif custom events fired with config.runHook() from inside the commands: sfdx-hardis
 * declares no hook for them. oclif only loads the hook file of a plugin that lists the event under
 * oclif.hooks in its package.json, and nothing at all when no plugin does.
 *
 * Every event carries the same envelope (command, report directory, branch, Pull Request, org) and
 * its own data. The first events are sent as soon as Salesforce returns the result of a validation,
 * a deployment or an Apex test run; other events will use the same envelope.
 */
import c from 'chalk';
import * as path from 'path';
import type { Config } from '@oclif/core';
import fs from './fsUtils.js';
import { getConfig, getEnvVar, getReportDirectory } from '../../config/index.js';
import { GitProvider } from '../gitProvider/index.js';
import { getCurrentGitBranch, uxLog } from './index.js';
import { t } from './i18n.js';

// ---------------------------------------------------------------------------
// Generic envelope, shared by all the events
// ---------------------------------------------------------------------------

export type SfdxHardisEventPullRequest = {
  id: string;
  number: number | null;
  url: string | null;
  sourceBranch: string | null;
  targetBranch: string | null;
};

export type SfdxHardisEvent<TName extends string = string, TData = unknown> = {
  // Increased when a field of the envelope changes meaning or disappears, never when a field is added
  payloadVersion: 1;
  event: TName;
  // Id of the sfdx-hardis command that sent the event, for example hardis:project:deploy:smart
  commandId: string;
  reportDir: string;
  currentBranch: string | null;
  // Null when no Pull Request is found, when there is no git provider, and in a major branch check
  pullRequest: SfdxHardisEventPullRequest | null;
  // Null username when the command has no target org
  org: { username: string | null };
  // What is specific to the event
  data: TData;
};

// What the hook function of a plugin receives: the event, plus the oclif config
export type SfdxHardisEventHookOptions<TEvent extends SfdxHardisEvent = SfdxHardisEvent> = TEvent & { config: Config };

// ---------------------------------------------------------------------------
// Salesforce run events: validation, deployment, Apex tests
// ---------------------------------------------------------------------------

export type SfdxHardisRunEventName =
  | 'sfdx-hardis:validation-done'
  | 'sfdx-hardis:deployment-done'
  | 'sfdx-hardis:apex-tests-done';

export type SalesforceRunEventData = {
  checkOnly: boolean;
  // Item of the deployment plan of hardis:project:deploy:smart, null for the other commands
  deploymentLabel: string | null;
  // What Salesforce answered. unknown: the Apex test run gave no result
  status: 'success' | 'failed' | 'unknown';
  // Absolute path of apex-coverage-results.json written by sfdx-hardis, null when it does not exist:
  // the plugin reads the coverage from it
  coverageFile: string | null;
};

export type SfdxHardisRunEvent = SfdxHardisEvent<SfdxHardisRunEventName, SalesforceRunEventData>;

// Every event and its data: a new event adds a line here
export type SfdxHardisEventDataMap = {
  'sfdx-hardis:validation-done': SalesforceRunEventData;
  'sfdx-hardis:deployment-done': SalesforceRunEventData;
  'sfdx-hardis:apex-tests-done': SalesforceRunEventData;
};

export type SfdxHardisEventName = keyof SfdxHardisEventDataMap;

export type SalesforceRunEventInput = {
  event: SfdxHardisRunEventName;
  checkOnly: boolean;
  status: SalesforceRunEventData['status'];
  deploymentLabel?: string | null;
  // False when the command knows that no Apex test ran: a coverage file left by an earlier run is not sent
  coverageExpected?: boolean;
  targetUsername?: string | null;
};

const COVERAGE_RESULTS_FILE_NAME = 'apex-coverage-results.json';

/**
 * Event of hardis:project:deploy:start, validate and quick, sent right after the wrapped sf command
 * returns. The wrapped command sets process.exitCode instead of throwing.
 */
export async function emitWrappedDeployRunEvent(
  commandThis: any,
  options: { checkOnly: boolean; targetUsername: string | null }
): Promise<void> {
  await emitSalesforceRunEvent(commandThis, {
    event: getDeployRunEventName(options.checkOnly),
    checkOnly: options.checkOnly,
    status: (process.exitCode ?? 0) === 0 ? 'success' : 'failed',
    targetUsername: options.targetUsername,
  });
}

export function getDeployRunEventName(checkOnly: boolean): SfdxHardisRunEventName {
  return checkOnly ? 'sfdx-hardis:validation-done' : 'sfdx-hardis:deployment-done';
}

// Send the result of a validation, a deployment or an Apex test run to the plugins
export async function emitSalesforceRunEvent(commandThis: any, input: SalesforceRunEventInput): Promise<void> {
  await emitPluginEvent(commandThis, input.event, () => buildSalesforceRunEventData(input), {
    targetUsername: input.targetUsername,
  });
}

/**
 * Send an event to the plugins that listen to it. The data is only built when at least one plugin
 * listens. Never throws: a plugin that fails is a warning, it does not change the result of the command.
 */
export async function emitPluginEvent<TName extends SfdxHardisEventName>(
  commandThis: any,
  event: TName,
  buildData: () => Promise<SfdxHardisEventDataMap[TName]> | SfdxHardisEventDataMap[TName],
  options: { targetUsername?: string | null } = {}
): Promise<void> {
  try {
    const oclifConfig = commandThis?.config;
    if (typeof oclifConfig?.runHook !== 'function') {
      return;
    }
    const listenerCount = countEventListeners(oclifConfig, event);
    if (listenerCount === 0) {
      return;
    }
    if (await isPluginEventsDisabled()) {
      uxLog("log", commandThis, c.grey(t('pluginEventsDisabled', { event, count: listenerCount })));
      return;
    }
    const payload = await buildEventEnvelope(commandThis, event, await buildData(), options);
    // captureErrors: a plugin that calls this.error() or this.exit() is a failure of that plugin
    // only, the hooks of the other plugins still run to their end
    const hookResult: any = await oclifConfig.runHook(event, payload, undefined, true);
    for (const failure of hookResult?.failures || []) {
      logPluginFailure(commandThis, event, failure?.plugin?.name, failure?.error);
    }
    uxLog("log", commandThis, c.grey(t('pluginEventSent', { event, count: listenerCount })));
  } catch (e) {
    logPluginFailure(commandThis, event, null, e);
  }
}

export function countEventListeners(oclifConfig: any, event: string): number {
  const plugins: any[] = oclifConfig?.plugins instanceof Map ? Array.from(oclifConfig.plugins.values()) : [];
  return plugins.filter((plugin) => {
    const hooks = plugin?.hooks?.[event];
    return Array.isArray(hooks) ? hooks.length > 0 : !!hooks;
  }).length;
}

// Kill switch of the plugin events. The env var wins over the config property, so a single CI job
// can be unblocked without committing a config change
export async function isPluginEventsDisabled(): Promise<boolean> {
  const envVarValue = (getEnvVar('SFDX_HARDIS_DISABLE_PLUGIN_EVENTS') || '').toLowerCase();
  if (['true', '1'].includes(envVarValue)) {
    return true;
  }
  if (['false', '0'].includes(envVarValue)) {
    return false;
  }
  const config = await getConfig('branch');
  return config?.disablePluginEvents === true;
}

export async function buildEventEnvelope<TName extends string, TData>(
  commandThis: any,
  event: TName,
  data: TData,
  options: { targetUsername?: string | null } = {}
): Promise<SfdxHardisEvent<TName, TData>> {
  return {
    payloadVersion: 1,
    event,
    commandId: commandThis?.id || '',
    reportDir: path.resolve(await getReportDirectory()),
    currentBranch: (await getCurrentGitBranch()) || null,
    pullRequest: await findPullRequest(),
    org: { username: options.targetUsername ?? null },
    data,
  };
}

export async function buildSalesforceRunEventData(input: SalesforceRunEventInput): Promise<SalesforceRunEventData> {
  const coverageFilePath = path.join(await getReportDirectory(), COVERAGE_RESULTS_FILE_NAME);
  const coverageFile = input.coverageExpected !== false && fs.existsSync(coverageFilePath) ? path.resolve(coverageFilePath) : null;
  return {
    checkOnly: input.checkOnly,
    deploymentLabel: input.deploymentLabel ?? null,
    status: input.status,
    coverageFile,
  };
}

// Null in a major branch check: getPullRequestInfo returns no Pull Request then
async function findPullRequest(): Promise<SfdxHardisEventPullRequest | null> {
  try {
    const prInfo = await GitProvider.getPullRequestInfo({ useCache: true });
    if (!prInfo) {
      return null;
    }
    return {
      id: String(prInfo.idStr ?? prInfo.idNumber ?? ''),
      number: Number.isFinite(prInfo.idNumber) ? prInfo.idNumber : null,
      url: prInfo.webUrl || null,
      sourceBranch: prInfo.sourceBranch || null,
      targetBranch: prInfo.targetBranch || null,
    };
  } catch {
    return null;
  }
}

function logPluginFailure(commandThis: any, event: string, pluginName: string | null | undefined, error: any): void {
  uxLog("warning", commandThis, c.yellow(t('pluginEventFailed', {
    plugin: pluginName || '?',
    event,
    message: error?.message || String(error),
  })));
}
