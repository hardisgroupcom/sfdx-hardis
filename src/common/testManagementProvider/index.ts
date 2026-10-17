import { SfError } from '@salesforce/core';
import { TestManagementProviderRoot } from './testManagementProviderRoot.js';
import { AzureDevopsTestProvider } from './azureDevopsTestProvider.js';
import { ServiceNowTestProvider } from './serviceNowTestProvider.js';
import { XrayTestProvider } from './xrayTestProvider.js';
import { AzureBoardsProvider } from '../ticketProvider/azureBoardsProvider.js';
import { NormalizedTestCase, idempotencyKey } from '../utils/testNotebookUtils.js';
import { t } from '../utils/i18n.js';
import { WebSocketClient } from '../websocketClient.js';

/**
 * Providers able to upsert test cases. A separate list from `allTicketProviders`, which drives
 * what is collected on every Pull Request. `key` is what --provider and the `testCasesProvider`
 * configuration match on.
 */
export const allTestManagementProviders: Array<{
  key: string;
  label: string;
  build: (config: any) => TestManagementProviderRoot;
}> = [
  { key: AzureDevopsTestProvider.providerKey, label: AzureDevopsTestProvider.providerLabel, build: () => new AzureDevopsTestProvider() },
  { key: ServiceNowTestProvider.providerKey, label: ServiceNowTestProvider.providerLabel, build: () => new ServiceNowTestProvider() },
  { key: XrayTestProvider.providerKey, label: XrayTestProvider.providerLabel, build: (config) => new XrayTestProvider(config) },
];

export const TEST_MANAGEMENT_PROVIDER_KEYS = allTestManagementProviders.map((descriptor) => descriptor.key);

/** Build every provider, Azure DevOps organization and project being read from the git remote when unset. */
export async function buildTestManagementProviders(config: any): Promise<Array<{ key: string; provider: TestManagementProviderRoot }>> {
  await AzureBoardsProvider.autoDetectFromGitRemote();
  return allTestManagementProviders.map((descriptor) => ({ key: descriptor.key, provider: descriptor.build(config) }));
}

/** Human readable list of what would have to be set for each provider. */
export function describeRequiredSettings(providers: Array<{ key: string; provider: TestManagementProviderRoot }>): string {
  return providers
    .map(({ key, provider }) => `  - ${provider.getLabel()} (${key}): ${provider.getRequiredEnvVars().join(', ')}`)
    .join('\n');
}

/** Return the provider of `key`, refusing an unknown key or a provider whose settings are missing. */
export function selectTestManagementProvider(
  providers: Array<{ key: string; provider: TestManagementProviderRoot }>,
  key: string
): TestManagementProviderRoot {
  const match = providers.find((descriptor) => descriptor.key === key.toLowerCase());
  if (!match) {
    throw new SfError(t('testCasesUnknownProvider', { provider: key, providers: TEST_MANAGEMENT_PROVIDER_KEYS.join(', ') }));
  }
  if (!match.provider.isActive) {
    throw new SfError(t('testCasesProviderNotConfigured', { label: match.provider.getLabel() }) + '\n' + describeRequiredSettings([match]));
  }
  return match.provider;
}

export interface PushRow {
  provider: string;
  caseId: string;
  action: 'created' | 'updated' | 'failed' | 'would create' | 'would update';
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

function _failAll(provider: TestManagementProviderRoot, cases: NormalizedTestCase[], error: Error): PushReport {
  const rows: PushRow[] = cases.map((testCase) => ({
    provider: provider.getLabel(),
    caseId: testCase.id,
    action: 'failed',
    error: error.message,
  }));
  return {
    rows,
    created: 0,
    updated: 0,
    failed: cases.length,
    exitCode: 1,
    message: t('testCasesProviderUnusable', { label: provider.getLabel(), message: error.message }),
  };
}

/**
 * Upsert every case to one provider, best effort per case: one case failing does not stop the
 * others. The probe and `prepare` run first, dry run included, so a missing project or carrier
 * refuses the run before anything is written.
 */
export async function pushCases(
  provider: TestManagementProviderRoot,
  cases: NormalizedTestCase[],
  options: { dryRun?: boolean } = {}
): Promise<PushReport> {
  const label = provider.getLabel();
  try {
    await provider.checkPrerequisites();
    await provider.prepare(cases);
  } catch (e) {
    return _failAll(provider, cases, e as Error);
  }

  const rows: PushRow[] = [];
  let created = 0;
  let updated = 0;
  let failed = 0;
  if (cases.length > 1) {
    WebSocketClient.sendProgressStartMessage(t('pushingTestCases', { count: cases.length }), cases.length);
  }
  try {
    for (const [index, testCase] of cases.entries()) {
      try {
        const existing = await provider.findByKey(idempotencyKey(testCase.id));
        if (options.dryRun) {
          rows.push({ provider: label, caseId: testCase.id, action: existing ? 'would update' : 'would create', trackerId: existing?.id, url: existing?.url });
        } else if (existing) {
          const ref = await provider.update(existing, testCase);
          updated++;
          rows.push({ provider: label, caseId: testCase.id, action: 'updated', trackerId: ref.id, url: ref.url });
        } else {
          const ref = await provider.create(testCase);
          // The case exists from here on, and the next run updates it without linking it again:
          // a link failure is reported with the tracker id, so the link can be added by hand
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
              error: t('testCasesCreatedNotLinked', { ticket: testCase.ticket, message: linkError.message }),
            });
          } else {
            created++;
            rows.push({ provider: label, caseId: testCase.id, action: 'created', trackerId: ref.id, url: ref.url });
          }
        }
      } catch (e) {
        failed++;
        rows.push({ provider: label, caseId: testCase.id, action: 'failed', error: (e as Error).message });
      }
      if (cases.length > 1) {
        WebSocketClient.sendProgressStepMessage(index + 1, cases.length);
      }
    }
  } finally {
    if (cases.length > 1) {
      WebSocketClient.sendProgressEndMessage(cases.length);
    }
  }

  const exitCode: 0 | 2 = failed === 0 ? 0 : 2;
  const message = options.dryRun
    ? t('testCasesDryRunSummary', {
      count: cases.length,
      provider: label,
      create: rows.filter((row) => row.action === 'would create').length,
      update: rows.filter((row) => row.action === 'would update').length,
      failed,
    })
    : t('testCasesUpsertSummary', { created, updated, failed });
  return { rows, created, updated, failed, exitCode, message };
}
