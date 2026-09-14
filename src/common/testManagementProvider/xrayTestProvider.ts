import { SfError } from '@salesforce/core';
import { TestManagementProviderRoot, ProviderRef } from './testManagementProviderRoot.js';
import { NormalizedTestCase, idempotencyKey } from '../utils/testNotebookUtils.js';
import { httpGet, httpPost, httpPut } from '../utils/httpUtils.js';
import { getEnvVar } from '../../config/index.js';
import { t } from '../utils/i18n.js';

const REGION_BASE: Record<string, string> = {
  us: 'https://us.xray.cloud.getxray.app',
  eu: 'https://eu.xray.cloud.getxray.app',
  au: 'https://au.xray.cloud.getxray.app',
};
const DEFAULT_BASE = 'https://xray.cloud.getxray.app';
const PRIORITY_NAME: Record<number, string> = { 1: 'Highest', 2: 'High', 3: 'Medium' };
/** A host that never answers fails the case instead of hanging it. */
const HTTP_TIMEOUT_MS = 60000;

/** One mutation creates the Jira issue and its steps. */
const CREATE_TEST_MUTATION = `
mutation CreateTest($testType: UpdateTestTypeInput!, $steps: [CreateStepInput!], $jira: JSON!) {
  createTest(testType: $testType, steps: $steps, jira: $jira) {
    test { issueId jira(fields: ["key"]) }
    warnings
  }
}`.trim();

/** Region to API root. An unknown region falls back to the global endpoint. */
export function xrayBaseUrlFor(region: string | null): string {
  return REGION_BASE[String(region ?? '').toLowerCase()] || DEFAULT_BASE;
}

/** A value inside a JQL double quoted string. */
function _jqlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function _moduleLabel(testCase: NormalizedTestCase): string {
  return testCase.module ? `MODULE:${testCase.module.replace(/\s+/g, '_')}` : '';
}

/**
 * Jira / Xray Cloud adapter. Creation goes through Xray GraphQL with the Xray token; search,
 * update and story link go through Jira REST with the Jira credentials.
 */
export class XrayTestProvider extends TestManagementProviderRoot {
  public static readonly providerKey = 'xray';
  public static readonly providerLabel = 'Xray Cloud';

  protected clientId: string | null;
  protected clientSecret: string | null;
  protected region: string | null;
  protected jiraHost: string;
  protected projectKey: string | null;
  protected jiraEmail: string | null;
  protected jiraToken: string | null;
  private jwt: string | null = null;

  /** `config` is the sfdx-hardis configuration, where `jiraHost` may be set instead of JIRA_HOST. */
  public constructor(config: any = {}) {
    super();
    this.clientId = getEnvVar('XRAY_CLIENT_ID');
    this.clientSecret = getEnvVar('XRAY_CLIENT_SECRET');
    this.region = getEnvVar('XRAY_REGION');
    // Same variables and host normalization as jiraProvider.ts, so Jira is configured once
    const rawHost = String(getEnvVar('JIRA_HOST') || config?.jiraHost || '').trim();
    this.jiraHost = rawHost ? (rawHost.startsWith('http') ? rawHost : `https://${rawHost}`).replace(/\/+$/, '') : '';
    this.projectKey = getEnvVar('JIRA_PROJECT_KEY');
    this.jiraEmail = getEnvVar('JIRA_EMAIL');
    this.jiraToken = getEnvVar('JIRA_TOKEN');
    this.isActive = this.missingSettings().length === 0;
  }

  public getLabel(): string {
    return XrayTestProvider.providerLabel;
  }

  public getRequiredEnvVars(): string[] {
    return ['XRAY_CLIENT_ID', 'XRAY_CLIENT_SECRET', 'JIRA_HOST (or jiraHost config)', 'JIRA_PROJECT_KEY', 'JIRA_EMAIL', 'JIRA_TOKEN', 'XRAY_REGION (optional)'];
  }

  /** Labels a new test gets: the idempotency key and the module. */
  public static buildLabels(testCase: NormalizedTestCase): string[] {
    return [idempotencyKey(testCase.id), _moduleLabel(testCase)].filter(Boolean);
  }

  public static buildVariables(testCase: NormalizedTestCase, projectKey: string): any {
    return {
      testType: { name: 'Manual' },
      steps: (testCase.steps || []).map((step) => ({ action: step.action, result: step.expected })),
      jira: {
        fields: {
          summary: testCase.title,
          description: TestManagementProviderRoot.buildPlainDescription(testCase),
          project: { key: projectKey },
          priority: { name: PRIORITY_NAME[testCase.priority ?? 2] },
          labels: XrayTestProvider.buildLabels(testCase),
        },
      },
    };
  }

  /**
   * Body of the Jira update. Labels are added, never replaced, so labels set by hand stay; the
   * priority is only sent when the notebook has that column. REST API v2 is used because v3 only
   * accepts an Atlassian Document Format description.
   */
  public static buildUpdateBody(testCase: NormalizedTestCase): any {
    const fields: Record<string, any> = {
      summary: testCase.title,
      description: TestManagementProviderRoot.buildPlainDescription(testCase),
    };
    if (testCase.priority !== undefined) {
      fields.priority = { name: PRIORITY_NAME[testCase.priority] };
    }
    return { fields, update: { labels: XrayTestProvider.buildLabels(testCase).map((label) => ({ add: label })) } };
  }

  public async checkPrerequisites(): Promise<void> {
    const missing = this.missingSettings();
    if (missing.length > 0) {
      throw new SfError(t('testCasesProviderMissingSettings', { label: this.getLabel(), settings: missing.join(', ') }));
    }
    await this.authenticate();
  }

  public async findByKey(key: string): Promise<ProviderRef | null> {
    let response;
    try {
      response = await httpGet(`${this.jiraHost}/rest/api/3/search/jql`, {
        params: { jql: `project = ${_jqlString(String(this.projectKey))} AND labels = ${_jqlString(key)}`, maxResults: 20, fields: 'labels' },
        headers: this.jiraHeaders(),
        timeout: HTTP_TIMEOUT_MS,
      });
    } catch (e) {
      throw new SfError(t('testCasesJiraCallFailed', { action: 'search', message: TestManagementProviderRoot.describeHttpError(e) }));
    }
    // Each hit is checked against its own labels: accepting the wrong issue would update it
    const issue = (response.data?.issues ?? []).find((hit: any) => (hit?.fields?.labels ?? []).includes(key));
    return issue ? { id: String(issue.key), url: `${this.jiraHost}/browse/${issue.key}` } : null;
  }

  public async create(testCase: NormalizedTestCase): Promise<ProviderRef> {
    const data = await this.graphql({
      query: CREATE_TEST_MUTATION,
      variables: XrayTestProvider.buildVariables(testCase, String(this.projectKey)),
    });
    const test = data?.createTest?.test;
    if (!test) {
      throw new SfError(t('testCasesXrayNoTestPayload'));
    }
    const key = test.jira?.key ?? test.issueId;
    return { id: String(key), url: `${this.jiraHost}/browse/${key}` };
  }

  /**
   * Updates the Jira fields of an existing test. The steps are not updated: they live on the Xray
   * side, and the mutation that writes them is `createTest`, with no update counterpart.
   */
  public async update(ref: ProviderRef, testCase: NormalizedTestCase): Promise<ProviderRef> {
    try {
      await httpPut(`${this.jiraHost}/rest/api/2/issue/${ref.id}`, XrayTestProvider.buildUpdateBody(testCase), {
        headers: this.jiraHeaders(),
        timeout: HTTP_TIMEOUT_MS,
      });
    } catch (e) {
      throw new SfError(t('testCasesJiraCallFailed', { action: `update ${ref.id}`, message: TestManagementProviderRoot.describeHttpError(e) }));
    }
    return { id: ref.id, url: `${this.jiraHost}/browse/${ref.id}` };
  }

  /** Link through Jira REST (link type "Test"), not through Xray. */
  public async linkToStory(ref: ProviderRef, storyId: string): Promise<void> {
    try {
      await httpPost(
        `${this.jiraHost}/rest/api/3/issueLink`,
        { type: { name: 'Test' }, inwardIssue: { key: ref.id }, outwardIssue: { key: String(storyId) } },
        { headers: this.jiraHeaders(), timeout: HTTP_TIMEOUT_MS }
      );
    } catch (e) {
      throw new SfError(t('testCasesJiraCallFailed', { action: `link ${ref.id} to ${storyId}`, message: TestManagementProviderRoot.describeHttpError(e) }));
    }
  }

  private missingSettings(): string[] {
    const settings: Array<[string, unknown]> = [
      ['XRAY_CLIENT_ID', this.clientId],
      ['XRAY_CLIENT_SECRET', this.clientSecret],
      ['JIRA_HOST', this.jiraHost],
      ['JIRA_PROJECT_KEY', this.projectKey],
      ['JIRA_EMAIL', this.jiraEmail],
      ['JIRA_TOKEN', this.jiraToken],
    ];
    return settings.filter(([, value]) => !value).map(([name]) => name);
  }

  private jiraHeaders(): Record<string, string> {
    return {
      Authorization: 'Basic ' + Buffer.from(`${this.jiraEmail}:${this.jiraToken}`, 'utf8').toString('base64'),
      'Content-Type': 'application/json',
    };
  }

  /** Xray token, requested once per run: it stays valid for 24 hours. */
  private async authenticate(): Promise<string> {
    if (this.jwt) {
      return this.jwt;
    }
    let response;
    try {
      response = await httpPost(
        `${xrayBaseUrlFor(this.region)}/api/v2/authenticate`,
        { client_id: this.clientId, client_secret: this.clientSecret },
        { headers: { 'Content-Type': 'application/json' }, timeout: HTTP_TIMEOUT_MS }
      );
    } catch (e) {
      throw new SfError(t('testCasesXrayAuthFailed', { message: TestManagementProviderRoot.describeHttpError(e) }));
    }
    // The raw JWT comes as a quoted JSON string, parsed or not depending on the content type
    const token = typeof response.data === 'string' ? response.data.trim().replace(/^"|"$/g, '') : '';
    if (!token) {
      throw new SfError(t('testCasesXrayAuthFailed', { message: 'empty token' }));
    }
    this.jwt = token;
    return token;
  }

  private async graphql(body: any): Promise<any> {
    const jwt = await this.authenticate();
    let response;
    try {
      response = await httpPost(`${xrayBaseUrlFor(this.region)}/api/v2/graphql`, body, {
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        timeout: HTTP_TIMEOUT_MS,
      });
    } catch (e) {
      throw new SfError(t('testCasesXrayGraphqlError', { message: TestManagementProviderRoot.describeHttpError(e) }));
    }
    // GraphQL answers 200 with an errors array
    const errors = response.data?.errors;
    if (errors && errors.length > 0) {
      throw new SfError(t('testCasesXrayGraphqlError', { message: errors.map((error: any) => error.message).join('; ') }));
    }
    return response.data?.data;
  }
}
