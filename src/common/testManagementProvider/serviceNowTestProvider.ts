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
const T_TASK_LINK = 'sn_test_management_m2m_task_test';
const PLUGIN = 'com.snc.test_management.2.0';
/** ServiceNow orders steps by hundreds, leaving room to insert one by hand later. */
const STEP_ORDER_INCREMENT = 100;

/**
 * ServiceNow Test Management 2.0 adapter.
 *
 * Creating a test is chained inserts, there being no composite payload:
 *   sn_test_management_test -> sn_test_management_test_version -> sn_test_management_step,
 * then sn_test_management_m2m_task_test links the test to the record of its ticket.
 *
 * What a live instance showed: the test has no description nor priority field, and its
 * `short_description` is read-only, copied from its latest version. The title is therefore written
 * on the version too, and an update renames the latest version.
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
  /** sys_id of the task record of each carrier ticket, read once per run */
  private taskIds = new Map<string, string>();

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

  /** Read the record of every carrier ticket up front, so a missing one refuses the run before any write. */
  public async prepare(cases: NormalizedTestCase[]): Promise<void> {
    for (const ticket of new Set(cases.map((testCase) => testCase.ticket))) {
      await this.taskSysId(ticket);
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

  /** The title goes on the test and on its version, which the test copies its title from. */
  public async create(testCase: NormalizedTestCase): Promise<ProviderRef> {
    const shortDescription = ServiceNowTestProvider.buildShortDescription(testCase);
    const test = await this.insert(T_TEST, { short_description: shortDescription });
    const ref = { id: String(test.sys_id), url: this.recordUrl(String(test.sys_id)) };
    // A rerun only updates an existing test: a version or a step that failed here is never added
    // later, so the error names the test record to fix or delete
    try {
      const version = await this.insert(T_VERSION, { test: test.sys_id, version: 1, short_description: shortDescription });
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
   * Renames the latest version, the test copying its title from it: the `short_description` of the
   * test itself is read-only, and the Table API answers 200 to a change it drops. The steps are left
   * alone: replacing them would delete rows a tester may already have run.
   */
  public async update(ref: ProviderRef, testCase: NormalizedTestCase): Promise<ProviderRef> {
    const shortDescription = ServiceNowTestProvider.buildShortDescription(testCase);
    let versionId: string | undefined;
    try {
      const response = await httpGet(`${this.instanceUrl}/api/now/table/${T_VERSION}`, {
        ...this.authConfig(),
        params: { sysparm_query: `test=${ref.id}^ORDERBYDESCversion`, sysparm_fields: 'sys_id', sysparm_limit: 1 },
      });
      versionId = response.data?.result?.[0]?.sys_id;
    } catch (e) {
      throw new SfError(t('testCasesServiceNowCallFailed', { action: `read the versions of ${ref.id}`, message: TestManagementProviderRoot.describeHttpError(e) }));
    }
    if (!versionId) {
      // A test created by hand without version: give it one, holding the title
      await this.insert(T_VERSION, { test: ref.id, version: 1, short_description: shortDescription });
      return { id: ref.id, url: this.recordUrl(ref.id) };
    }
    try {
      await httpPatch(`${this.instanceUrl}/api/now/table/${T_VERSION}/${versionId}`, { short_description: shortDescription }, this.authConfig());
    } catch (e) {
      throw new SfError(t('testCasesServiceNowCallFailed', { action: `update ${ref.id}`, message: TestManagementProviderRoot.describeHttpError(e) }));
    }
    return { id: ref.id, url: this.recordUrl(ref.id) };
  }

  /** Relation test -> ticket record (any task: incident, story, change...), added once. */
  public async linkToStory(ref: ProviderRef, storyId: string): Promise<void> {
    const taskId = await this.taskSysId(storyId);
    try {
      const existing = await httpGet(`${this.instanceUrl}/api/now/table/${T_TASK_LINK}`, {
        ...this.authConfig(),
        params: { sysparm_query: `test=${ref.id}^task=${taskId}`, sysparm_fields: 'sys_id', sysparm_limit: 1 },
      });
      if ((existing.data?.result ?? []).length > 0) {
        return;
      }
    } catch (e) {
      throw new SfError(t('testCasesServiceNowCallFailed', { action: `read the links of ${ref.id}`, message: TestManagementProviderRoot.describeHttpError(e) }));
    }
    await this.insert(T_TASK_LINK, { test: ref.id, task: taskId });
  }

  private authConfig() {
    return { auth: { username: this.user, password: this.password }, timeout: 60000 };
  }

  private recordUrl(sysId: string): string {
    return `${this.instanceUrl}/${T_TEST}.do?sys_id=${sysId}`;
  }

  /** sys_id of the task record numbered `ticket`, read once per run. Throws when there is none. */
  private async taskSysId(ticket: string): Promise<string> {
    const number = String(ticket ?? '').trim().toUpperCase();
    const cached = this.taskIds.get(number);
    if (cached) {
      return cached;
    }
    let sysId: string | undefined;
    try {
      // The ticket only holds [A-Za-z0-9_.#-] (see isValidTicketKey): no `^` can reach the query
      const response = await httpGet(`${this.instanceUrl}/api/now/table/task`, {
        ...this.authConfig(),
        params: { sysparm_query: `number=${number}`, sysparm_fields: 'sys_id', sysparm_limit: 1 },
      });
      sysId = response.data?.result?.[0]?.sys_id;
    } catch (e) {
      throw new SfError(t('testCasesServiceNowCallFailed', { action: `read carrier ticket ${number}`, message: TestManagementProviderRoot.describeHttpError(e) }));
    }
    if (!sysId) {
      throw new SfError(t('testCasesServiceNowCarrierNotFound', { ticket: number }));
    }
    this.taskIds.set(number, sysId);
    return sysId;
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
