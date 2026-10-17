import { SfError } from '@salesforce/core';
import { TestManagementProviderRoot, ProviderRef } from './testManagementProviderRoot.js';
import { NormalizedTestCase, idempotencyKey } from '../utils/testNotebookUtils.js';
import { httpGet, httpPost, httpPut } from '../utils/httpUtils.js';
import { getEnvVar } from '../../config/index.js';
import { t } from '../utils/i18n.js';
import { JiraProvider } from '../ticketProvider/jiraProvider.js';

const REGION_BASE: Record<string, string> = {
  us: 'https://us.xray.cloud.getxray.app',
  eu: 'https://eu.xray.cloud.getxray.app',
  au: 'https://au.xray.cloud.getxray.app',
};
const DEFAULT_BASE = 'https://xray.cloud.getxray.app';
const PRIORITY_NAME: Record<number, string> = { 1: 'Highest', 2: 'High', 3: 'Medium' };
/** A host that never answers fails the case instead of hanging it. */
const HTTP_TIMEOUT_MS = 60000;
const MODULE_LABEL_PREFIX = 'MODULE:';

/** One mutation creates the Jira issue and its steps. */
const CREATE_TEST_MUTATION = `
mutation CreateTest($testType: UpdateTestTypeInput!, $steps: [CreateStepInput!], $jira: JSON!) {
  createTest(testType: $testType, steps: $steps, jira: $jira) {
    test { issueId jira(fields: ["key"]) }
    warnings
  }
}`.trim();

/** What an update reads from the Jira issue before writing it. */
export interface XrayExistingIssue {
  description?: string;
  labels?: string[];
}

/** Region to API root. An unknown region falls back to the global endpoint. */
export function xrayBaseUrlFor(region: string | null): string {
  return REGION_BASE[String(region ?? '').toLowerCase()] || DEFAULT_BASE;
}

/**
 * Jira / Xray Cloud adapter. Creation goes through Xray GraphQL with the Xray token; search,
 * update and story link go through Jira REST with the credentials of the Jira ticket provider.
 */
export class XrayTestProvider extends TestManagementProviderRoot {
  public static readonly providerKey = 'xray';
  public static readonly providerLabel = 'Xray Cloud';

  protected clientId: string | null;
  protected clientSecret: string | null;
  protected region: string | null;
  /** Host of the browse links. REST calls go to `jiraRest().baseUrl`, the API gateway for client credentials. */
  protected jiraHost: string;
  protected projectKey: string | null;
  protected jiraConfigured: boolean;
  private jira: JiraProvider;
  private jwt: string | null = null;
  private jiraAccess: { baseUrl: string; headers: Record<string, string> } | null = null;

  /** `config` is the sfdx-hardis configuration, where `jiraHost` may be set instead of JIRA_HOST. */
  public constructor(config: any = {}) {
    super();
    this.clientId = getEnvVar('XRAY_CLIENT_ID');
    this.clientSecret = getEnvVar('XRAY_CLIENT_SECRET');
    this.region = getEnvVar('XRAY_REGION');
    // Same variables, host normalization and credentials as the Jira ticket provider, so Jira is configured once
    this.jiraHost = JiraProvider.normalizeHost(getEnvVar('JIRA_HOST') || config?.jiraHost);
    this.projectKey = getEnvVar('JIRA_PROJECT_KEY');
    this.jira = new JiraProvider(config ?? {});
    this.jiraConfigured = JiraProvider.isAvailable(config ?? {});
    this.isActive = this.missingSettings().length === 0;
  }

  public getLabel(): string {
    return XrayTestProvider.providerLabel;
  }

  public getRequiredEnvVars(): string[] {
    return [
      'XRAY_CLIENT_ID',
      'XRAY_CLIENT_SECRET',
      'JIRA_HOST (or jiraHost config)',
      'JIRA_PROJECT_KEY',
      'JIRA_EMAIL + JIRA_TOKEN (or JIRA_CLIENT_ID + JIRA_CLIENT_SECRET, or JIRA_PAT)',
      'XRAY_REGION (optional)',
    ];
  }

  /** Labels a new test gets: the idempotency key and the module. */
  public static buildLabels(testCase: NormalizedTestCase): string[] {
    return [idempotencyKey(testCase.id), _moduleLabel(testCase.module)].filter(Boolean);
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
   * Body of the Jira update. Labels are added, never replaced, so labels set by hand stay, except
   * the MODULE label of a module the notebook renamed. The description keeps the blocks of the
   * fields the notebook has no column for, and the priority is only sent when the notebook has
   * that column. REST API v2 is used because v3 only accepts an Atlassian Document Format description.
   */
  public static buildUpdateBody(testCase: NormalizedTestCase, existing: XrayExistingIssue = {}): any {
    const fields: Record<string, any> = {
      summary: testCase.title,
      description: TestManagementProviderRoot.buildPlainDescription(testCase, existing.description ?? ''),
    };
    if (testCase.priority !== undefined) {
      fields.priority = { name: PRIORITY_NAME[testCase.priority] };
    }
    const labels: Array<Record<string, string>> = XrayTestProvider.buildLabels(testCase).map((label) => ({ add: label }));
    if (testCase.module !== undefined) {
      const current = _moduleLabel(testCase.module);
      for (const label of existing.labels ?? []) {
        if (label.startsWith(MODULE_LABEL_PREFIX) && label !== current) {
          labels.push({ remove: label });
        }
      }
    }
    return { fields, update: { labels } };
  }

  /** Authenticate on Xray, then read the Jira project, so wrong Jira credentials refuse the run before any write. */
  public async checkPrerequisites(): Promise<void> {
    const missing = this.missingSettings();
    if (missing.length > 0) {
      throw new SfError(t('testCasesProviderMissingSettings', { label: this.getLabel(), settings: missing.join(', ') }));
    }
    await this.authenticate();
    await this.jiraGet(`/rest/api/2/project/${encodeURIComponent(String(this.projectKey))}`, { fields: 'key' }, `read project ${this.projectKey}`);
  }

  /** Read every carrier ticket up front, so a missing one refuses the run before any test is created. */
  public async prepare(cases: NormalizedTestCase[]): Promise<void> {
    for (const ticket of new Set(cases.map((testCase) => testCase.ticket))) {
      await this.jiraGet(`/rest/api/2/issue/${encodeURIComponent(ticket)}`, { fields: 'summary' }, `read carrier ticket ${ticket}`);
    }
  }

  public async findByKey(key: string): Promise<ProviderRef | null> {
    const data = await this.jiraGet(
      '/rest/api/3/search/jql',
      { jql: `project = ${_jqlString(String(this.projectKey))} AND labels = ${_jqlString(key)}`, maxResults: 20, fields: 'labels' },
      'search'
    );
    // Each hit is checked against its own labels: accepting the wrong issue would update it
    const issue = (data?.issues ?? []).find((hit: any) => (hit?.fields?.labels ?? []).includes(key));
    return issue ? { id: String(issue.key), url: this.browseUrl(String(issue.key)) } : null;
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
    return { id: String(key), url: this.browseUrl(String(key)) };
  }

  /**
   * Updates the Jira fields of an existing test, read first so the description blocks and the
   * labels the notebook does not own are kept. The steps are not updated: they live on the Xray
   * side, and the mutation that writes them is `createTest`, with no update counterpart.
   */
  public async update(ref: ProviderRef, testCase: NormalizedTestCase): Promise<ProviderRef> {
    const current = await this.jiraGet(`/rest/api/2/issue/${encodeURIComponent(ref.id)}`, { fields: 'description,labels' }, `read ${ref.id}`);
    const existing: XrayExistingIssue = {
      description: typeof current?.fields?.description === 'string' ? current.fields.description : '',
      labels: Array.isArray(current?.fields?.labels) ? current.fields.labels : [],
    };
    const access = await this.jiraRest();
    try {
      await httpPut(`${access.baseUrl}/rest/api/2/issue/${encodeURIComponent(ref.id)}`, XrayTestProvider.buildUpdateBody(testCase, existing), {
        headers: access.headers,
        timeout: HTTP_TIMEOUT_MS,
      });
    } catch (e) {
      throw new SfError(t('testCasesJiraCallFailed', { action: `update ${ref.id}`, message: TestManagementProviderRoot.describeHttpError(e) }));
    }
    return { id: ref.id, url: this.browseUrl(ref.id) };
  }

  /** Link through Jira REST (link type "Test"), not through Xray. */
  public async linkToStory(ref: ProviderRef, storyId: string): Promise<void> {
    const access = await this.jiraRest();
    try {
      await httpPost(
        `${access.baseUrl}/rest/api/3/issueLink`,
        { type: { name: 'Test' }, inwardIssue: { key: ref.id }, outwardIssue: { key: String(storyId) } },
        { headers: access.headers, timeout: HTTP_TIMEOUT_MS }
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
      ['JIRA_EMAIL + JIRA_TOKEN (or JIRA_CLIENT_ID + JIRA_CLIENT_SECRET, or JIRA_PAT)', this.jiraConfigured],
    ];
    return settings.filter(([, value]) => !value).map(([name]) => name);
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

  /** GET on Jira REST, any failure named with `action`. */
  private async jiraGet(pathname: string, params: Record<string, any>, action: string): Promise<any> {
    const access = await this.jiraRest();
    try {
      const response = await httpGet(`${access.baseUrl}${pathname}`, { params, headers: access.headers, timeout: HTTP_TIMEOUT_MS });
      return response.data;
    } catch (e) {
      throw new SfError(t('testCasesJiraCallFailed', { action, message: TestManagementProviderRoot.describeHttpError(e) }));
    }
  }

  /** Base URL and headers of the Jira credentials, resolved once per run. */
  private async jiraRest(): Promise<{ baseUrl: string; headers: Record<string, string> }> {
    if (!this.jiraAccess) {
      let access: Awaited<ReturnType<JiraProvider['getRestAccess']>>;
      try {
        access = await this.jira.getRestAccess();
      } catch (e) {
        throw new SfError(t('testCasesJiraCallFailed', { action: 'authenticate', message: TestManagementProviderRoot.describeHttpError(e) }));
      }
      if (!access) {
        throw new SfError(t('testCasesProviderMissingSettings', { label: this.getLabel(), settings: this.missingSettings().join(', ') }));
      }
      this.jiraAccess = { baseUrl: access.baseUrl.replace(/\/+$/, ''), headers: { ...access.headers, 'Content-Type': 'application/json' } };
    }
    return this.jiraAccess;
  }

  private browseUrl(key: string): string {
    return `${this.jiraHost}/browse/${key}`;
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

/** A value inside a JQL double quoted string. */
function _jqlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Spaces become underscores: a Jira label cannot hold a space. */
function _moduleLabel(module: string | undefined): string {
  return module ? `${MODULE_LABEL_PREFIX}${module.replace(/\s+/g, '_')}` : '';
}
