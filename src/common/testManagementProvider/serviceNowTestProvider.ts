import { SfError } from '@salesforce/core';
import { TestManagementProviderRoot, ProviderRef } from './testManagementProviderRoot.js';
import { NormalizedTestCase, idempotencyKey } from '../utils/testNotebookTypes.js';
import { httpGet, httpPost, httpPatch, HttpError } from '../utils/httpUtils.js';
import { getEnvVar } from '../../config/index.js';
import { t } from '../utils/i18n.js';

const T_TEST = 'sn_test_management_test';
const T_VERSION = 'sn_test_management_test_version';
const T_STEP = 'sn_test_management_test_step';
const PLUGIN = 'com.snc.test_management.2.0';
/** ServiceNow orders steps by hundreds, leaving room to insert one by hand later. */
const STEP_ORDER_INCREMENT = 100;

/**
 * The `description` of a ServiceNow test is plain text, unlike the HTML `System.Description`
 * of Azure DevOps. A `[label](url)` markdown link would show up as literal bracket and paren
 * characters, so it is reduced to a bare URL, the honest output for a field that cannot render
 * markup.
 */
function _linksToPlainText(text: unknown): string {
  return String(text ?? '').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$2');
}

/**
 * ServiceNow Test Management 2.0 adapter.
 *
 * Creating a test is three chained inserts, there being no documented composite payload:
 *   sn_test_management_test -> sn_test_management_test_version
 *                           -> sn_test_management_test_step (one per step)
 *
 * Not to be confused with `ticketProvider/serviceNowProvider.ts`, which reads tickets
 * (incident, change_request, rm_story...). This one writes test cases. Both deliberately read
 * the same three environment variables, so a project configures ServiceNow once.
 */
export class ServiceNowTestProvider extends TestManagementProviderRoot {
  protected instanceUrl: string;
  protected user: string;
  protected password: string;

  public constructor() {
    super();
    this.instanceUrl = ServiceNowTestProvider.getInstanceUrl();
    this.user = getEnvVar('SERVICENOW_USERNAME') || '';
    this.password = getEnvVar('SERVICENOW_PASSWORD') || '';
    this.isActive = Boolean(this.instanceUrl && this.user && this.password);
  }

  /**
   * `SERVICENOW_URL` may be given as a bare instance host or as a full URL, with or without a
   * trailing slash. Same normalization as `ticketProvider/serviceNowProvider.ts`, so the two
   * connectors accept the exact same value.
   */
  private static getInstanceUrl(): string {
    const raw = getEnvVar('SERVICENOW_URL') || '';
    if (!raw) {
      return '';
    }
    const withScheme = raw.startsWith('http') ? raw : `https://${raw}`;
    return withScheme.replace(/\/+$/, '');
  }

  public getLabel(): string {
    return 'servicenow';
  }

  public getRequiredEnvVars(): string[] {
    return ['SERVICENOW_URL', 'SERVICENOW_USERNAME', 'SERVICENOW_PASSWORD'];
  }

  /**
   * Idempotency key carried as a `short_description` prefix.
   *
   * Test Management 2.0 exposes no portable correlation field on `sn_test_management_test`, so
   * the key lives in the human readable title. This is a deliberate, documented fallback: a
   * `findByKey` aimed at a field that turns out to be absent or ACL restricted does not raise,
   * it returns an empty result, and would therefore re-create every already pushed case as a
   * duplicate. See the Known limitations section of the push command.
   */
  public static buildShortDescription(testCase: NormalizedTestCase): string {
    const parts = [`[${idempotencyKey(testCase.id, testCase.ticket)}]`];
    if (testCase.module) {
      parts.push(`${testCase.module} -`);
    }
    parts.push(testCase.title);
    return parts.join(' ');
  }

  public static buildTestBody(testCase: NormalizedTestCase): Record<string, any> {
    const lines: string[] = [];
    if (testCase.preconditions) {
      lines.push(`${t('testCasePreconditions')} ${_linksToPlainText(testCase.preconditions)}`);
    }
    if (testCase.expected) {
      lines.push(`${t('testCaseOverallExpectedResult')} ${_linksToPlainText(testCase.expected)}`);
    }
    // The advisory query is omitted cleanly when the cell is empty.
    if (testCase.soql) {
      lines.push(`${t('testCaseSoqlQuery')} ${testCase.soql}`);
    }
    return {
      short_description: ServiceNowTestProvider.buildShortDescription(testCase),
      description: lines.join('\n'),
      priority: testCase.priority,
    };
  }

  public async checkPrerequisites(): Promise<void> {
    if (!this.instanceUrl) {
      throw new SfError('ServiceNow: SERVICENOW_URL is not set (ex: https://myinstance.service-now.com).');
    }
    if (!this.user || !this.password) {
      throw new SfError('ServiceNow: SERVICENOW_USERNAME and SERVICENOW_PASSWORD must both be set.');
    }
    try {
      await httpGet(`${this.instanceUrl}/api/now/table/${T_TEST}`, {
        ...this.authConfig(),
        params: { sysparm_limit: 1 },
      });
    } catch (e) {
      const status = (e as HttpError)?.status;
      if (status === 403 || status === 404) {
        // Kept word for word from the skill: it carries the license information, which is what
        // saves the reader an hour of searching.
        throw new SfError(
          `ServiceNow: table ${T_TEST} answered HTTP ${status} - the plugin ${PLUGIN} is not active ` +
            'on this instance. It is not sellable standalone: it ships with SPM / ITBM Professional. ' +
            'No test case was created.'
        );
      }
      throw new SfError(`ServiceNow: probe on ${T_TEST} failed - ${(e as Error).message}.`);
    }
  }

  public async findByKey(key: string): Promise<ProviderRef | null> {
    const response = await httpGet(`${this.instanceUrl}/api/now/table/${T_TEST}`, {
      ...this.authConfig(),
      params: { sysparm_query: `short_descriptionSTARTSWITH[${key}]`, sysparm_limit: 1 },
    });
    const hits = response.data?.result ?? [];
    if (hits.length === 0) {
      return null;
    }
    return { id: String(hits[0].sys_id), url: this.recordUrl(String(hits[0].sys_id)) };
  }

  public async create(testCase: NormalizedTestCase): Promise<ProviderRef> {
    const test = await this.insert(T_TEST, ServiceNowTestProvider.buildTestBody(testCase));
    const version = await this.insert(T_VERSION, { test: test.sys_id, version: 1 });

    let order = STEP_ORDER_INCREMENT;
    for (const step of testCase.steps || []) {
      await this.insert(T_STEP, {
        test_version: version.sys_id,
        order,
        description: step.action,
        expected_result: step.expected,
      });
      order += STEP_ORDER_INCREMENT;
    }
    return { id: String(test.sys_id), url: this.recordUrl(String(test.sys_id)) };
  }

  /**
   * Updates the test record only. The steps of the existing version are left alone: replacing
   * them would mean deleting rows a tester may already have executed against.
   */
  public async update(ref: ProviderRef, testCase: NormalizedTestCase): Promise<ProviderRef> {
    try {
      await httpPatch(
        `${this.instanceUrl}/api/now/table/${T_TEST}/${ref.id}`,
        ServiceNowTestProvider.buildTestBody(testCase),
        this.authConfig()
      );
    } catch (e) {
      throw new SfError(`ServiceNow: update of ${ref.id} failed - ${(e as Error).message}.`);
    }
    return { id: ref.id, url: this.recordUrl(ref.id) };
  }

  /**
   * ServiceNow Test Management 2.0 has no generic relation from a test to an arbitrary ticket,
   * so the carrier ticket is not linked through a relation table. It already travels in the
   * idempotency key that prefixes `short_description`, which is the trace that survives.
   */
  public async linkToStory(): Promise<void> {
    return;
  }

  private authConfig() {
    // Same shape as ticketProvider/serviceNowProvider.ts, timeout included.
    return { auth: { username: this.user, password: this.password }, timeout: 60000 };
  }

  private recordUrl(sysId: string): string {
    return `${this.instanceUrl}/${T_TEST}.do?sys_id=${sysId}`;
  }

  private async insert(table: string, body: Record<string, any>): Promise<Record<string, any>> {
    try {
      const response = await httpPost(`${this.instanceUrl}/api/now/table/${table}`, body, this.authConfig());
      return response.data?.result ?? {};
    } catch (e) {
      throw new SfError(`ServiceNow: insert into ${table} failed - ${(e as Error).message}.`);
    }
  }
}
