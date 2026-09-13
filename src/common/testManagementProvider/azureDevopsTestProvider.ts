/* jscpd:ignore-start */
import * as azdev from 'azure-devops-node-api';
import { IWorkItemTrackingApi } from 'azure-devops-node-api/WorkItemTrackingApi.js';
import { JsonPatchDocument } from 'azure-devops-node-api/interfaces/common/VSSInterfaces.js';
import { SfError } from '@salesforce/core';
import { TestManagementProviderRoot, ProviderRef } from './testManagementProviderRoot.js';
import { NormalizedTestCase, TestCaseStep, idempotencyKey } from '../utils/testNotebookUtils.js';
import { getEnvVar } from '../../config/index.js';
import { t, tEn } from '../utils/i18n.js';
/* jscpd:ignore-end */

/** Area, iteration and assignee a created test case inherits from the story it tests. */
export interface CarrierContext {
  areaPath: string | null;
  iterationPath: string | null;
  assignedTo: string | null;
}

const WORK_ITEM_TYPE = 'Test Case';

function _htmlEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _oneLine(value: unknown): string {
  return String(value ?? '')
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .trim();
}

// A control character sentinel, so it never collides with real notebook content
const BR_PLACEHOLDER = '\u0000BR\u0000';

/**
 * `System.Description` renders HTML. The text is escaped FIRST, so nothing in the notebook can
 * break out of the markup, and only then are `[label](url)`, `code` and `**bold**` turned into
 * tags. Reversing the two opens an HTML injection.
 */
function _richText(text: unknown): string {
  const protectedBreaks = String(text ?? '')
    .replace(/<br\s*\/?>/gi, BR_PLACEHOLDER)
    .replace(/\r\n|\r|\n/g, BR_PLACEHOLDER);
  return _htmlEscape(protectedBreaks)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .split(BR_PLACEHOLDER)
    .join('<br>');
}

/** System.Description, in English whatever the locale: the tracker is shared. */
function _description(testCase: NormalizedTestCase): string {
  const parts: string[] = [];
  const add = (labelKey: string, html: string): void => {
    parts.push(`<div><b>${_htmlEscape(tEn(labelKey))}</b> ${html}</div>`);
  };
  if (testCase.module) {
    add('testCaseModule', _htmlEscape(testCase.module));
  }
  if (testCase.target) {
    add('testCaseTarget', `<code>${_htmlEscape(testCase.target)}</code>`);
  }
  if (testCase.preconditions) {
    add('testCasePreconditions', _richText(testCase.preconditions));
  }
  if (testCase.expected) {
    add('testCaseOverallExpectedResult', _richText(testCase.expected));
  }
  // A SOQL query is code: escaped, not converted
  if (testCase.soql) {
    add('testCaseSoqlQuery', `<pre>${_htmlEscape(testCase.soql)}</pre>`);
  }
  return parts.join('');
}

/**
 * `Microsoft.VSTS.TCM.Steps` stores HTML as an XML escaped string: the step text is HTML escaped,
 * then the DIV/P fragment is escaped again, so `Enter <Account Name>` stays text.
 *
 * Step ids start at 2 and `last` is steps + 1, as Azure DevOps writes them. A step with an
 * expected result is a ValidateStep.
 */
export function azureDevopsStepsXml(steps: TestCaseStep[] | undefined): string {
  const list = (Array.isArray(steps) ? steps : []).filter((step) => step && (step.action || step.expected));
  if (list.length === 0) {
    return '<steps id="0" last="1"></steps>';
  }
  const wrap = (text: string): string => _htmlEscape(`<DIV><P>${_htmlEscape(text)}</P></DIV>`);
  const parts = [`<steps id="0" last="${list.length + 1}">`];
  list.forEach((step, i) => {
    const expected = _oneLine(step.expected);
    parts.push(
      `<step id="${i + 2}" type="${expected ? 'ValidateStep' : 'ActionStep'}">`,
      `<parameterizedString isformatted="true">${wrap(_oneLine(step.action))}</parameterizedString>`,
      `<parameterizedString isformatted="true">${wrap(expected)}</parameterizedString>`,
      '<description/>',
      '</step>'
    );
  });
  parts.push('</steps>');
  return parts.join('');
}

/**
 * Work item number of a ticket key: the last group of digits, so `DSI-2026-14545` gives 14545.
 * Throws when there is none rather than asking the API for item `NaN`.
 */
function _requireStoryId(ticketKey: string): number {
  const digitGroups = String(ticketKey ?? '').match(/\d+/g);
  if (!digitGroups) {
    throw new SfError(t('testCasesAzureNoWorkItemNumber', { ticket: JSON.stringify(ticketKey) }));
  }
  return Number(digitGroups[digitGroups.length - 1]);
}

/**
 * Azure DevOps Test Case adapter. Cases are created isolated: no Test Plan, no Test Suite.
 *
 * `azure-devops-node-api` resolves a 404 with `null` instead of throwing, so every read and write
 * checks its result.
 */
export class AzureDevopsTestProvider extends TestManagementProviderRoot {
  public static readonly providerKey = 'azure-devops';
  public static readonly providerLabel = 'Azure DevOps';

  protected serverUrl: string | null;
  protected teamProject: string | null;
  protected token: string | null;
  private witApi: IWorkItemTrackingApi | null = null;
  private apiFactory?: () => Promise<IWorkItemTrackingApi>;
  /** Carrier work items read once per run, not once per case. */
  private carrierCache = new Map<number, CarrierContext>();

  /** `apiFactory` lets unit tests pass a stub: the SDK is not fetch based. */
  public constructor(apiFactory?: () => Promise<IWorkItemTrackingApi>) {
    super();
    this.apiFactory = apiFactory;
    // Same variables and priority as the Azure Boards ticket provider, organization and project
    // being filled from the git remote before this constructor runs (see getTestManagementProvider)
    this.serverUrl = getEnvVar('SYSTEM_COLLECTIONURI');
    this.teamProject = getEnvVar('SYSTEM_TEAMPROJECT');
    this.token = getEnvVar('CI_SFDX_HARDIS_AZURE_TOKEN') || getEnvVar('SYSTEM_ACCESSTOKEN') || getEnvVar('AZURE_DEVOPS_EXT_PAT');
    this.isActive = Boolean((this.serverUrl && this.teamProject && this.token) || apiFactory);
  }

  public getLabel(): string {
    return AzureDevopsTestProvider.providerLabel;
  }

  public getRequiredEnvVars(): string[] {
    return [
      'SYSTEM_COLLECTIONURI (or an Azure DevOps git remote)',
      'SYSTEM_TEAMPROJECT (or an Azure DevOps git remote)',
      'CI_SFDX_HARDIS_AZURE_TOKEN (or SYSTEM_ACCESSTOKEN or AZURE_DEVOPS_EXT_PAT)',
    ];
  }

  /** Patch of a new test case, inheriting area, iteration and assignee from its carrier. */
  public static buildCreatePatch(testCase: NormalizedTestCase, carrier: CarrierContext | null): any[] {
    const patch: any[] = [
      { op: 'add', path: '/fields/System.Title', value: testCase.title },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: testCase.priority ?? 2 },
      { op: 'add', path: '/fields/Microsoft.VSTS.TCM.Steps', value: azureDevopsStepsXml(testCase.steps) },
      { op: 'add', path: '/fields/System.Description', value: _description(testCase) },
      { op: 'add', path: '/fields/System.Tags', value: AzureDevopsTestProvider.buildTags(testCase, []).join('; ') },
    ];
    // Without System.AreaPath, Azure DevOps rejects the very first item with 403 TF237111
    if (carrier?.areaPath) {
      patch.push({ op: 'add', path: '/fields/System.AreaPath', value: carrier.areaPath });
    }
    if (carrier?.iterationPath) {
      patch.push({ op: 'add', path: '/fields/System.IterationPath', value: carrier.iterationPath });
    }
    if (carrier?.assignedTo) {
      patch.push({ op: 'add', path: '/fields/System.AssignedTo', value: carrier.assignedTo });
    }
    return patch;
  }

  /**
   * Patch of an existing test case: what the notebook owns, and nothing else. Assignee, area and
   * iteration stay as the team set them, tags added by hand are kept, and the priority and steps
   * are only sent when the notebook has those columns. `add` is an upsert on a work item field.
   */
  public static buildUpdatePatch(testCase: NormalizedTestCase, existingTags: string[]): any[] {
    const patch: any[] = [
      { op: 'add', path: '/fields/System.Title', value: testCase.title },
      { op: 'add', path: '/fields/System.Description', value: _description(testCase) },
      { op: 'add', path: '/fields/System.Tags', value: AzureDevopsTestProvider.buildTags(testCase, existingTags).join('; ') },
    ];
    if (testCase.priority !== undefined) {
      patch.push({ op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: testCase.priority });
    }
    if (testCase.steps !== undefined) {
      patch.push({ op: 'add', path: '/fields/Microsoft.VSTS.TCM.Steps', value: azureDevopsStepsXml(testCase.steps) });
    }
    return patch;
  }

  /** Existing tags plus the idempotency key and the module tag, without duplicates. */
  public static buildTags(testCase: NormalizedTestCase, existingTags: string[]): string[] {
    const tags = existingTags.map((tag) => tag.trim()).filter(Boolean);
    for (const tag of [idempotencyKey(testCase.id), testCase.module ? `MODULE:${testCase.module}` : '']) {
      if (tag && !tags.includes(tag)) {
        tags.push(tag);
      }
    }
    return tags;
  }

  public async checkPrerequisites(): Promise<void> {
    if (!this.serverUrl || !this.teamProject || !this.token) {
      throw new SfError(t('testCasesProviderMissingSettings', { label: this.getLabel(), settings: this.getRequiredEnvVars().join(', ') }));
    }
    let fields: unknown;
    try {
      fields = await (await this.api()).getFields(this.teamProject);
    } catch (e) {
      throw new SfError(t('testCasesAzureProbeFailed', { url: this.serverUrl, project: this.teamProject, message: (e as Error).message }));
    }
    if (!fields) {
      throw new SfError(t('testCasesAzureProjectNotFound', { url: this.serverUrl, project: this.teamProject }));
    }
  }

  /** Read every carrier work item up front, so a missing one refuses the run before any write. */
  public async prepare(cases: NormalizedTestCase[]): Promise<void> {
    for (const ticket of new Set(cases.map((testCase) => testCase.ticket))) {
      await this.fetchCarrier(_requireStoryId(ticket));
    }
  }

  public async findByKey(key: string): Promise<ProviderRef | null> {
    const api = await this.api();
    const result = await api.queryByWiql(
      {
        query:
          `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project ` +
          `AND [System.WorkItemType] = '${WORK_ITEM_TYPE}' ` +
          `AND [System.Tags] CONTAINS '${String(key).replace(/'/g, "''")}'`,
      },
      { project: this.teamProject } as any
    );
    // Each hit is checked against its own tags: accepting the wrong work item would update it
    for (const hit of result?.workItems ?? []) {
      if (!hit.id) {
        continue;
      }
      const workItem = await api.getWorkItem(Number(hit.id), ['System.Tags']);
      if (workItem && this.tagsOf(workItem).includes(key)) {
        return { id: String(workItem.id), url: this.htmlUrlOf(workItem) };
      }
    }
    return null;
  }

  public async create(testCase: NormalizedTestCase): Promise<ProviderRef> {
    const carrier = await this.fetchCarrier(_requireStoryId(testCase.ticket));
    const api = await this.api();
    const workItem = await api.createWorkItem(
      {},
      AzureDevopsTestProvider.buildCreatePatch(testCase, carrier) as JsonPatchDocument,
      this.teamProject as string,
      WORK_ITEM_TYPE
    );
    if (!workItem?.id) {
      throw new SfError(t('testCasesAzureCreateNoResult', { project: this.teamProject }));
    }
    return { id: String(workItem.id), url: this.htmlUrlOf(workItem) };
  }

  public async update(ref: ProviderRef, testCase: NormalizedTestCase): Promise<ProviderRef> {
    const api = await this.api();
    const current = await api.getWorkItem(Number(ref.id), ['System.Tags']);
    if (!current) {
      throw new SfError(t('testCasesAzureWorkItemNotFound', { id: ref.id }));
    }
    const workItem = await api.updateWorkItem(
      {},
      AzureDevopsTestProvider.buildUpdatePatch(testCase, this.tagsOf(current)) as JsonPatchDocument,
      Number(ref.id),
      this.teamProject as string
    );
    if (!workItem) {
      throw new SfError(t('testCasesAzureWorkItemNotFound', { id: ref.id }));
    }
    return { id: ref.id, url: this.htmlUrlOf(workItem) || ref.url };
  }

  /** Relation Tests -> US: TestedBy-Reverse points from the test case to the story. */
  public async linkToStory(ref: ProviderRef, storyId: string): Promise<void> {
    const patch = [
      {
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'Microsoft.VSTS.Common.TestedBy-Reverse',
          url: `${String(this.serverUrl).replace(/\/+$/, '')}/_apis/wit/workItems/${_requireStoryId(storyId)}`,
        },
      },
    ];
    const api = await this.api();
    const workItem = await api.updateWorkItem({}, patch as JsonPatchDocument, Number(ref.id), this.teamProject as string);
    if (!workItem) {
      throw new SfError(t('testCasesAzureWorkItemNotFound', { id: ref.id }));
    }
  }

  /**
   * Area, iteration and assignee of the carrier work item. An unassigned carrier leaves the test
   * cases unassigned: no recipient is ever invented.
   */
  private async fetchCarrier(storyId: number): Promise<CarrierContext> {
    const cached = this.carrierCache.get(storyId);
    if (cached) {
      return cached;
    }
    let workItem: any;
    try {
      workItem = await (await this.api()).getWorkItem(storyId);
    } catch (e) {
      throw new SfError(t('testCasesAzureCarrierUnreadable', { id: storyId, message: (e as Error).message }));
    }
    if (!workItem?.fields) {
      throw new SfError(t('testCasesAzureCarrierNotFound', { id: storyId, project: this.teamProject }));
    }
    const carrier: CarrierContext = {
      areaPath: workItem.fields['System.AreaPath'] || null,
      iterationPath: workItem.fields['System.IterationPath'] || null,
      assignedTo: workItem.fields['System.AssignedTo']?.uniqueName || null,
    };
    this.carrierCache.set(storyId, carrier);
    return carrier;
  }

  private tagsOf(workItem: any): string[] {
    return String(workItem?.fields?.['System.Tags'] ?? '')
      .split(';')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  private async api(): Promise<IWorkItemTrackingApi> {
    if (this.apiFactory) {
      return this.apiFactory();
    }
    if (!this.witApi) {
      const authHandler = azdev.getHandlerFromToken(this.token || '');
      this.witApi = await new azdev.WebApi(this.serverUrl || '', authHandler).getWorkItemTrackingApi();
    }
    return this.witApi;
  }

  private htmlUrlOf(workItem: { id?: number; _links?: any }): string {
    return (
      workItem?._links?.html?.href ||
      `${String(this.serverUrl).replace(/\/+$/, '')}/${encodeURIComponent(String(this.teamProject))}/_workitems/edit/${workItem?.id}`
    );
  }
}
