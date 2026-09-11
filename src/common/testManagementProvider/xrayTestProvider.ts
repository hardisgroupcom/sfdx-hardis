import { SfError } from '@salesforce/core';
import { TestManagementProviderRoot, ProviderRef } from './testManagementProviderRoot.js';
import { NormalizedTestCase, idempotencyKey } from '../utils/testNotebookTypes.js';
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

/**
 * One mutation creates the Jira issue AND its steps atomically, which is why Xray was
 * preferred over Zephyr Scale (three to four calls, including a numeric id resolution).
 */
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

/**
 * The Jira `description` is sent as a plain string: no ADF conversion is done, which is a
 * pre-existing limitation. A `[label](url)` markdown link would show up as literal bracket
 * and paren characters, so it is reduced to a bare URL, the honest output for a field that
 * is not markdown aware here.
 */
function _linksToPlainText(text: unknown): string {
  return String(text ?? '').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$2');
}

function _description(testCase: NormalizedTestCase): string {
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
  return lines.join('\n');
}

/**
 * Jira / Xray Cloud adapter.
 *
 * Creation goes through Xray GraphQL; linking to the story goes through Jira REST, with the
 * Jira credentials and not the Xray JWT. The two systems have separate authentication and
 * conflating them is the classic mistake here.
 */
export class XrayTestProvider extends TestManagementProviderRoot {
  protected clientId: string | null;
  protected clientSecret: string | null;
  protected region: string | null;
  protected jiraBaseUrl: string | null;
  protected projectKey: string | null;
  protected jiraEmail: string | null;
  protected jiraToken: string | null;

  public constructor() {
    super();
    this.clientId = getEnvVar('XRAY_CLIENT_ID');
    this.clientSecret = getEnvVar('XRAY_CLIENT_SECRET');
    this.region = getEnvVar('XRAY_REGION');
    // JIRA_HOST / JIRA_EMAIL / JIRA_TOKEN are the names jiraProvider.ts already reads for Jira
    // basic auth. Reusing them means a user configures their Jira credentials once, instead of
    // once per feature under two different names for the same secret.
    this.jiraBaseUrl = getEnvVar('JIRA_HOST');
    this.projectKey = getEnvVar('JIRA_PROJECT_KEY');
    this.jiraEmail = getEnvVar('JIRA_EMAIL');
    this.jiraToken = getEnvVar('JIRA_TOKEN');
    this.isActive = Boolean(
      this.clientId && this.clientSecret && this.jiraBaseUrl && this.projectKey && this.jiraEmail && this.jiraToken
    );
  }

  public getLabel(): string {
    return 'xray';
  }

  public getRequiredEnvVars(): string[] {
    return [
      'XRAY_CLIENT_ID',
      'XRAY_CLIENT_SECRET',
      'JIRA_HOST',
      'JIRA_PROJECT_KEY',
      'JIRA_EMAIL',
      'JIRA_TOKEN',
      'XRAY_REGION (optional)',
    ];
  }

  public static buildVariables(testCase: NormalizedTestCase, projectKey: string): any {
    const labels = [idempotencyKey(testCase.id, testCase.ticket)];
    if (testCase.module) {
      labels.push(`MODULE:${testCase.module.replace(/\s+/g, '_')}`);
    }
    return {
      testType: { name: 'Manual' },
      // The `data` field of a step is deliberately left unset: nothing in a notebook produces
      // it, and inventing a value would be a fabrication.
      steps: (testCase.steps || []).map((step) => ({ action: step.action, result: step.expected })),
      jira: {
        fields: {
          summary: testCase.title,
          description: _description(testCase),
          project: { key: projectKey },
          priority: { name: PRIORITY_NAME[testCase.priority] || PRIORITY_NAME[2] },
          labels,
        },
      },
    };
  }

  public async checkPrerequisites(): Promise<void> {
    const missing = this.getRequiredEnvVars()
      .filter((name) => !name.includes('optional'))
      .filter((name) => !getEnvVar(name));
    if (missing.length > 0) {
      throw new SfError(`Xray: missing environment variable(s) ${missing.join(', ')}.`);
    }
    await this.authenticate();
  }

  public async findByKey(key: string): Promise<ProviderRef | null> {
    const jql = `project = "${this.projectKey}" AND labels = "${key}"`;
    const response = await httpGet(`${this.jiraBase()}/rest/api/3/search/jql`, {
      params: { jql, maxResults: 1, fields: 'key' },
      headers: this.jiraHeaders(),
    });
    const issues = response.data?.issues ?? [];
    if (issues.length === 0) {
      return null;
    }
    return { id: String(issues[0].key), url: `${this.jiraBase()}/browse/${issues[0].key}` };
  }

  public async create(testCase: NormalizedTestCase): Promise<ProviderRef> {
    const jwt = await this.authenticate();
    const data = await this.graphql(jwt, {
      query: CREATE_TEST_MUTATION,
      variables: XrayTestProvider.buildVariables(testCase, String(this.projectKey)),
    });
    const test = data?.createTest?.test;
    if (!test) {
      throw new SfError('Xray: createTest returned no test payload.');
    }
    const key = test.jira?.key;
    return { id: String(key ?? test.issueId), url: `${this.jiraBase()}/browse/${key}` };
  }

  /**
   * Updates the Jira fields of an existing test.
   *
   * Sends everything Jira owns: summary, description, priority and labels. An earlier version
   * sent only the summary and the labels, which silently discarded a corrected description or
   * priority while still reporting the case as updated.
   *
   * **The steps are not updated**, and cannot be from here: they live on the Xray side, and
   * the GraphQL mutation that writes them is `createTest`, not an update. A corrected step
   * list therefore needs the test to be recreated. This is documented as a known limitation
   * of the command rather than hidden behind a success message.
   */
  public async update(ref: ProviderRef, testCase: NormalizedTestCase): Promise<ProviderRef> {
    const fields = XrayTestProvider.buildVariables(testCase, String(this.projectKey)).jira.fields;
    await httpPut(
      `${this.jiraBase()}/rest/api/3/issue/${ref.id}`,
      {
        fields: {
          summary: fields.summary,
          description: fields.description,
          priority: fields.priority,
          labels: fields.labels,
        },
      },
      { headers: this.jiraHeaders() }
    );
    return { id: ref.id, url: `${this.jiraBase()}/browse/${ref.id}` };
  }

  /** Link through Jira REST (link type "Test"), not through Xray. */
  public async linkToStory(ref: ProviderRef, storyId: string): Promise<void> {
    await httpPost(
      `${this.jiraBase()}/rest/api/3/issueLink`,
      {
        type: { name: 'Test' },
        inwardIssue: { key: ref.id },
        outwardIssue: { key: String(storyId) },
      },
      { headers: this.jiraHeaders() }
    );
  }

  private jiraBase(): string {
    return String(this.jiraBaseUrl ?? '').replace(/\/+$/, '');
  }

  private jiraHeaders(): Record<string, string> {
    return {
      Authorization:
        'Basic ' + Buffer.from(`${this.jiraEmail}:${this.jiraToken}`, 'utf8').toString('base64'),
      'Content-Type': 'application/json',
    };
  }

  private async authenticate(): Promise<string> {
    try {
      const response = await httpPost(
        `${xrayBaseUrlFor(this.region)}/api/v2/authenticate`,
        { client_id: this.clientId, client_secret: this.clientSecret },
        { headers: { 'Content-Type': 'application/json' } }
      );
      // The endpoint returns the raw JWT as a quoted JSON string. Two shapes reach us: a
      // `application/json` response is parsed and yields the bare token, while a `text/plain`
      // one arrives as the literal `"eyJ..."`, quotes included. Stripping them on the string
      // branch covers both, where stripping on the object branch covered neither.
      const raw = typeof response.data === 'string' ? response.data : String(response.data ?? '');
      return raw.trim().replace(/^"|"$/g, '');
    } catch (e) {
      throw new SfError(
        `Xray: authentication failed (${(e as Error).message}). Check XRAY_CLIENT_ID and XRAY_CLIENT_SECRET.`
      );
    }
  }

  private async graphql(jwt: string, body: any): Promise<any> {
    const response = await httpPost(`${xrayBaseUrlFor(this.region)}/api/v2/graphql`, body, {
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    });
    // GraphQL answers 200 with an errors array, so a failure is not an HTTP failure here.
    const errors = response.data?.errors;
    if (errors && errors.length > 0) {
      throw new SfError(`Xray: GraphQL error - ${errors.map((error: any) => error.message).join('; ')}`);
    }
    return response.data?.data;
  }
}
