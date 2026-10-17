import { SfError } from '@salesforce/core';
import { TestManagementProviderRoot, ProviderRef } from './testManagementProviderRoot.js';
import { NormalizedTestCase, idempotencyKey } from '../utils/testNotebookUtils.js';
import { httpGet, httpPost, httpPatch, HttpError } from '../utils/httpUtils.js';
import { getEnvVar } from '../../config/index.js';
import { t, tEn } from '../utils/i18n.js';
import { ServiceNowProvider } from '../ticketProvider/serviceNowProvider.js';

const T_TEST = 'sn_test_management_test';
const T_VERSION = 'sn_test_management_test_version';
const T_STEP = 'sn_test_management_step';
const PLUGIN = 'com.snc.test_management.2.0';
/** ServiceNow orders steps by hundreds, leaving room to insert one by hand later. */
const STEP_ORDER_INCREMENT = 100;

/**
 * ServiceNow Test Management 2.0 adapter.
 *
 * Creating a test is three chained inserts, there being no composite payload:
 *   sn_test_management_test -> sn_test_management_test_version -> sn_test_management_step
 *
 * Not to be confused with `ticketProvider/serviceNowProvider.ts`, which reads tickets. Both read
 * the same variables, so a project configures ServiceNow once.
 */
export class ServiceNowTestProvider extends TestManagementProviderRoot {
  public static readonly providerKey = 'servicenow';
  public static readonly providerLabel = 'ServiceNow';

  protected instanceUrl: string;
  protected user: string;
  protected password: string;

  public constructor() {
    super();
    this.instanceUrl = ServiceNowProvider.getInstanceUrl();
    this.user = getEnvVar('SERVICENOW_USERNAME') || '';
    this.password = getEnvVar('SERVICENOW_PASSWORD') || '';
    this.isActive = Boolean(this.instanceUrl && this.user && this.password);
  }

  public getLabel(): string {
    return ServiceNowTestProvider.providerLabel;
  }

  public getRequiredEnvVars(): string[] {
    return ['SERVICENOW_URL', 'SERVICENOW_USERNAME', 'SERVICENOW_PASSWORD'];
  }

  /**
   * Test Management 2.0 has no portable correlation field on `sn_test_management_test`, so the
   * idempotency key prefixes `short_description`. See the known limitations of the upsert command.
   */
  public static buildShortDescription(testCase: NormalizedTestCase): string {
    return `[${idempotencyKey(testCase.id)}] ${testCase.title}`;
  }

  /** Fields of the test record. The priority is only sent when the notebook has that column. */
  public static buildTestBody(testCase: NormalizedTestCase): Record<string, any> {
    const body: Record<string, any> = {
      short_description: ServiceNowTestProvider.buildShortDescription(testCase),
      description: TestManagementProviderRoot.buildPlainDescription(testCase),
    };
    if (testCase.priority !== undefined) {
      body.priority = testCase.priority;
    }
    return body;
  }

  /**
   * Text of a step record. Test Management 2.0 has no expected result column on
   * `sn_test_management_step`, and the Table API silently ignores an unknown field, so the
   * expected result is written in the step text rather than lost.
   */
  public static buildStepText(action: string, expected: string): string {
    return expected ? `${action}\n${tEn('testCaseExpectedResult')} ${expected}` : action;
  }

  public async checkPrerequisites(): Promise<void> {
    if (!this.instanceUrl || !this.user || !this.password) {
      throw new SfError(t('testCasesProviderMissingSettings', { label: this.getLabel(), settings: this.getRequiredEnvVars().join(', ') }));
    }
    let response;
    try {
      response = await httpGet(`${this.instanceUrl}/api/now/table/${T_TEST}`, {
        ...this.authConfig(),
        params: { sysparm_limit: 1 },
      });
    } catch (e) {
      const status = (e as HttpError)?.status;
      if (status === 403 || status === 404) {
        throw new SfError(t('testCasesServiceNowPluginInactive', { table: T_TEST, status, plugin: PLUGIN }));
      }
      throw new SfError(t('testCasesServiceNowProbeFailed', { table: T_TEST, message: TestManagementProviderRoot.describeHttpError(e) }));
    }
    // A hibernating developer instance answers every call with a 200 HTML page
    if (!Array.isArray(response.data?.result)) {
      throw new SfError(t('testCasesServiceNowUnexpectedAnswer', { url: this.instanceUrl }));
    }
  }

  public async findByKey(key: string): Promise<ProviderRef | null> {
    let response;
    try {
      response = await httpGet(`${this.instanceUrl}/api/now/table/${T_TEST}`, {
        ...this.authConfig(),
        params: {
          // The key only holds [A-Za-z0-9_.#:-] (see deriveTicketAndKind): no `^` can reach the query
          sysparm_query: `short_descriptionSTARTSWITH[${key}]`,
          sysparm_fields: 'sys_id,short_description',
          sysparm_limit: 20,
        },
      });
    } catch (e) {
      throw new SfError(t('testCasesServiceNowCallFailed', { action: 'search', message: TestManagementProviderRoot.describeHttpError(e) }));
    }
    const hit = (response.data?.result ?? []).find((record: any) => String(record?.short_description ?? '').startsWith(`[${key}]`));
    return hit ? { id: String(hit.sys_id), url: this.recordUrl(String(hit.sys_id)) } : null;
  }

  public async create(testCase: NormalizedTestCase): Promise<ProviderRef> {
    const body = ServiceNowTestProvider.buildTestBody(testCase);
    const test = await this.insert(T_TEST, { priority: 2, ...body });
    const ref = { id: String(test.sys_id), url: this.recordUrl(String(test.sys_id)) };
    // A rerun only updates an existing test: a version or a step that failed here is never added
    // later, so the error names the test record to fix or delete
    try {
      const version = await this.insert(T_VERSION, { test: test.sys_id, version: 1 });
      let order = STEP_ORDER_INCREMENT;
      for (const step of testCase.steps || []) {
        await this.insert(T_STEP, {
          test_version: version.sys_id,
          order,
          step: ServiceNowTestProvider.buildStepText(step.action, step.expected),
        });
        order += STEP_ORDER_INCREMENT;
      }
    } catch (e) {
      throw new SfError(t('testCasesServiceNowPartialCreate', { url: ref.url, message: (e as Error).message }));
    }
    return ref;
  }

  /**
   * Updates the test record only. The steps of the existing version are left alone: replacing them
   * would delete rows a tester may already have run.
   */
  public async update(ref: ProviderRef, testCase: NormalizedTestCase): Promise<ProviderRef> {
    try {
      await httpPatch(`${this.instanceUrl}/api/now/table/${T_TEST}/${ref.id}`, ServiceNowTestProvider.buildTestBody(testCase), this.authConfig());
    } catch (e) {
      throw new SfError(t('testCasesServiceNowCallFailed', { action: `update ${ref.id}`, message: TestManagementProviderRoot.describeHttpError(e) }));
    }
    return { id: ref.id, url: this.recordUrl(ref.id) };
  }

  /**
   * Test Management 2.0 has no generic relation from a test to any ticket: the carrier ticket
   * travels in the idempotency key that prefixes `short_description`.
   */
  public async linkToStory(): Promise<void> {
    return;
  }

  private authConfig() {
    return { auth: { username: this.user, password: this.password }, timeout: 60000 };
  }

  private recordUrl(sysId: string): string {
    return `${this.instanceUrl}/${T_TEST}.do?sys_id=${sysId}`;
  }

  /** Insert a record, and refuse an answer that is not a Table API record. */
  private async insert(table: string, body: Record<string, any>): Promise<Record<string, any>> {
    let response;
    try {
      response = await httpPost(`${this.instanceUrl}/api/now/table/${table}`, body, this.authConfig());
    } catch (e) {
      throw new SfError(t('testCasesServiceNowCallFailed', { action: `insert into ${table}`, message: TestManagementProviderRoot.describeHttpError(e) }));
    }
    const record = response.data?.result;
    if (!record?.sys_id) {
      throw new SfError(t('testCasesServiceNowNoSysId', { table }));
    }
    return record;
  }
}
