import c from 'chalk';
import { TestManagementProviderRoot } from './testManagementProviderRoot.js';
import { AzureDevopsTestProvider } from './azureDevopsTestProvider.js';
import { ServiceNowTestProvider } from './serviceNowTestProvider.js';
import { XrayTestProvider } from './xrayTestProvider.js';
import { NormalizedTestCase, idempotencyKey } from '../utils/testNotebookTypes.js';
import { uxLog } from '../utils/index.js';
import { t } from '../utils/i18n.js';
import { WebSocketClient } from '../websocketClient.js';

/**
 * Providers able to push test cases, as `{ key, label, providerClass }` descriptors.
 *
 * Deliberately a separate list from `allTicketProviders`: that one drives what is collected on
 * every pull request, and adding a provider to it changes the content of existing PR comments
 * and release notes. Pushing test cases is opt-in per invocation, so a connector can land here
 * without touching the behavior of projects that already use the ticketing flows. Same
 * reasoning, and same shape, as `ticketDetailsProviders`.
 *
 * `key` is what `--provider` matches on. It is never `getLabel()`: a label is display text, it
 * gets reworded and translated, and using it as a filter identifier would break the flag the
 * day someone improves the wording.
 */
export const allTestManagementProviders: Array<{
  key: string;
  label: string;
  providerClass: new () => TestManagementProviderRoot;
}> = [
  { key: 'azure-devops', label: 'Azure DevOps', providerClass: AzureDevopsTestProvider },
  { key: 'servicenow', label: 'ServiceNow', providerClass: ServiceNowTestProvider },
  { key: 'xray', label: 'Xray Cloud', providerClass: XrayTestProvider },
];

/** Values accepted by the `--provider` flag of the push command. */
export type TestManagementProviderKey = 'azure-devops' | 'servicenow' | 'xray';

export interface PushRow {
  provider: string;
  caseId: string;
  action: 'created' | 'updated' | 'failed' | 'dry-run' | 'skipped';
  trackerId?: string;
  url?: string;
  error?: string;
}

export interface PushReport {
  rows: PushRow[];
  created: number;
  updated: number;
  failed: number;
  /** 0 all good, 2 partial, 1 nothing could be attempted. */
  exitCode: 0 | 1 | 2;
  message: string;
}

export interface PushOptions {
  dryRun?: boolean;
  /** Narrows to one provider key. When absent, every active provider is used. */
  provider?: string;
}

/**
 * Build one instance per provider and keep the active ones. A provider decides for itself,
 * from its environment variables, so this function never reads a secret.
 *
 * `provider` narrows to one descriptor key. It only ever removes providers: a provider whose
 * variables are unset stays inactive even when named explicitly, so the flag can never be a
 * way around authentication.
 */
export function getInstances(provider?: string): TestManagementProviderRoot[] {
  const instances: TestManagementProviderRoot[] = [];
  for (const descriptor of allTestManagementProviders) {
    if (provider && descriptor.key !== provider.toLowerCase()) {
      continue;
    }
    const instance = new descriptor.providerClass();
    if (!instance.isActive) {
      continue;
    }
    instances.push(instance);
  }
  return instances;
}

/** Human readable list of what would have to be set for each provider to activate. */
export function describeRequiredEnvVars(provider?: string): string {
  return allTestManagementProviders
    .filter((descriptor) => !provider || descriptor.key === provider.toLowerCase())
    .map((descriptor) => {
      const instance = new descriptor.providerClass();
      return `  - ${descriptor.label} (--provider ${descriptor.key}): ${instance.getRequiredEnvVars().join(', ')}`;
    })
    .join('\n');
}

/**
 * Push every case to every provider, best effort per case.
 *
 * Aborting on the first error was observed live on a push of ten cases where the first one
 * failed and the other nine were never attempted. A rerun creates the cases that failed before
 * being created, but it does not repair a partial create: an existing case only goes through
 * update(), so a failed story link or missing ServiceNow steps stay as they are.
 */
export async function pushCases(
  providers: TestManagementProviderRoot[],
  cases: NormalizedTestCase[],
  options: PushOptions = {}
): Promise<PushReport> {
  const rows: PushRow[] = [];
  let created = 0;
  let updated = 0;
  let failed = 0;

  if (providers.length === 0) {
    return {
      rows,
      created,
      updated,
      failed,
      exitCode: 1,
      // Naming the variables of the provider actually asked for, rather than of all three, is
      // what turns "nothing happened" into an actionable message.
      message: t('testCasesNoActiveProvider') + '\n' + describeRequiredEnvVars(options.provider),
    };
  }

  const totalSteps = providers.length * cases.length;
  let doneSteps = 0;
  let usableProviders = 0;
  if (totalSteps > 1) {
    WebSocketClient.sendProgressStartMessage(t('pushingTestCases', { count: cases.length }), totalSteps);
  }

  try {
    for (const provider of providers) {
      const label = provider.getLabel();
      // A provider whose probe fails loses only its own cases: the others still go through.
      try {
        await provider.checkPrerequisites();
      } catch (e) {
        failed += cases.length;
        for (const testCase of cases) {
          rows.push({ provider: label, caseId: testCase.id, action: 'failed', error: (e as Error).message });
        }
        // 2nd arg is the command instance; there is none here, and uxLog tolerates null.
        uxLog('warning', null, c.yellow(t('testCasesProviderUnusable', { label, message: (e as Error).message })));
        doneSteps += cases.length;
        continue;
      }
      usableProviders++;

      for (const testCase of cases) {
        const key = idempotencyKey(testCase.id, testCase.ticket);
        try {
          if (options.dryRun) {
            await provider.findByKey(key);
            rows.push({ provider: label, caseId: testCase.id, action: 'dry-run' });
          } else {
            const existing = await provider.findByKey(key);
            if (existing) {
              const ref = await provider.update(existing, testCase);
              updated++;
              rows.push({ provider: label, caseId: testCase.id, action: 'updated', trackerId: ref.id, url: ref.url });
            } else {
              const ref = await provider.create(testCase);
              // The case exists from here on, and the next run will find it and update it
              // without linking it again. A link failure is therefore reported on its own row,
              // with the tracker id, so the link can be added by hand, and the case is not
              // counted as both created and failed.
              const linkError = await provider.linkToStory(ref, testCase.ticket).then(
                () => null,
                (e: Error) => e
              );
              if (linkError) {
                failed++;
                rows.push({
                  provider: label,
                  caseId: testCase.id,
                  action: 'failed',
                  trackerId: ref.id,
                  url: ref.url,
                  error: `Created but not linked to ${testCase.ticket}: ${linkError.message}`,
                });
              } else {
                created++;
                rows.push({ provider: label, caseId: testCase.id, action: 'created', trackerId: ref.id, url: ref.url });
              }
            }
          }
        } catch (e) {
          failed++;
          rows.push({ provider: label, caseId: testCase.id, action: 'failed', error: (e as Error).message });
        }
        doneSteps++;
        if (totalSteps > 1) {
          WebSocketClient.sendProgressStepMessage(doneSteps, totalSteps);
        }
      }
    }
  } finally {
    if (totalSteps > 1) {
      WebSocketClient.sendProgressEndMessage(totalSteps);
    }
  }

  // 1 when no provider could even be probed: nothing was attempted, as the command documents.
  const exitCode: 0 | 1 | 2 = failed === 0 ? 0 : usableProviders === 0 ? 1 : 2;
  const message = options.dryRun
    ? t('testCasesDryRunSummary', { count: cases.length, providers: providers.length })
    : t('testCasesUpsertSummary', { created, updated, failed });
  return { rows, created, updated, failed, exitCode, message };
}
