/* jscpd:ignore-start */
import * as azdev from 'azure-devops-node-api';
import { IWorkItemTrackingApi } from 'azure-devops-node-api/WorkItemTrackingApi.js';
import { JsonPatchDocument } from 'azure-devops-node-api/interfaces/common/VSSInterfaces.js';
import { SfError } from '@salesforce/core';
import { TestManagementProviderRoot, ProviderRef } from './testManagementProviderRoot.js';
import { azureDevopsStepsXml } from './azureDevopsStepsXml.js';
import { NormalizedTestCase, idempotencyKey } from '../utils/testNotebookTypes.js';
import { getEnvVar } from '../../config/index.js';
import { t } from '../utils/i18n.js';
/* jscpd:ignore-end */

/** Area, iteration and assignee a created test case inherits from the story it tests. */
export interface CarrierContext {
  areaPath: string | null;
  iterationPath: string | null;
  assignedTo: string | null;
}

const WORK_ITEM_TYPE = 'Test Case';

// `System.Description` renders as raw HTML, unlike `Microsoft.VSTS.TCM.Steps` (an HTML escaped
// string, see azureDevopsStepsXml.ts). Before this conversion existed, the notebook text was
// interpolated verbatim and the backticks and `**` of the markdown showed up as literal
// characters in Azure DevOps, observed on a live push of ten cases.
const BR_RE = /<br\s*\/?>/gi;
// A control character sentinel, so it can never collide with real notebook content.
const BR_PLACEHOLDER = '\u0000BR\u0000';
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const MD_CODE_RE = /`([^`]+)`/g;
const MD_BOLD_RE = /\*\*([^*]+)\*\*/g;

function _htmlEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Escaping runs FIRST, so nothing in the notebook can break out of the surrounding HTML or an
 * `href="..."` attribute. Only THEN are the constructs the notebook is known to use turned
 * into real tags, built from already escaped text. Reversing the two opens an HTML injection.
 */
function _richText(text: unknown): string {
  const protectedBreaks = String(text ?? '').replace(BR_RE, BR_PLACEHOLDER);
  const html = _htmlEscape(protectedBreaks)
    .replace(MD_LINK_RE, '<a href="$2">$1</a>')
    .replace(MD_CODE_RE, '<code>$1</code>')
    .replace(MD_BOLD_RE, '<b>$1</b>');
  return html.split(BR_PLACEHOLDER).join('<br>');
}

/** System.Description: preconditions, then the case level expected result, then the query. */
function _description(testCase: NormalizedTestCase): string {
  const parts: string[] = [];
  if (testCase.preconditions) {
    parts.push(`<div><b>${t('testCasePreconditions')}</b> ${_richText(testCase.preconditions)}</div>`);
  }
  if (testCase.expected) {
    parts.push(`<div><b>${t('testCaseOverallExpectedResult')}</b> ${_richText(testCase.expected)}</div>`);
  }
  // The advisory query is omitted cleanly when the cell is empty. Escaped but NOT markdown
  // converted: a SOQL query is code, not prose, and stays inside <pre>.
  if (testCase.soql) {
    parts.push(`<div><b>${t('testCaseSoqlQuery')}</b> <pre>${_htmlEscape(testCase.soql)}</pre></div>`);
  }
  return parts.join('');
}

function _tags(testCase: NormalizedTestCase): string {
  return [idempotencyKey(testCase.id, testCase.ticket), testCase.module ? `MODULE:${testCase.module}` : null]
    .filter(Boolean)
    .join('; ');
}

/**
 * Numeric work item id embedded in a ticket key: `PROJ-123` -> `123`, `AB-14545` -> `14545`.
 *
 * The LAST run of digits wins, not everything after the first non-digit. A ticket key may hold
 * several groups of digits (`DSI-2026-14545`, where 2026 is the year and 14545 the work item),
 * and stripping only the leading letters would yield "2026-14545", which is not a number at
 * all. The single place that knows this mapping, reused by the carrier resolution and by the
 * story link.
 */
function _storyIdFromTicketKey(ticketKey: string): string {
  const digitGroups = String(ticketKey ?? '').match(/\d+/g);
  return digitGroups ? digitGroups[digitGroups.length - 1] : '';
}

/** Fails with an actionable reason rather than letting `Number(...)` produce NaN. */
function _requireStoryId(ticketKey: string): string {
  const storyId = _storyIdFromTicketKey(ticketKey);
  if (!storyId) {
    throw new SfError(
      `Azure DevOps: no work item number could be read from the ticket key ${JSON.stringify(ticketKey)}. ` +
        'A test case must carry the number of the work item it tests, as in PROJ-123-F01 or 14545-F01. ' +
        'Use --ticket-number to set it explicitly.'
    );
  }
  return storyId;
}

/**
 * Azure DevOps Test Case adapter.
 *
 * Scope is locked to ISOLATED test cases: no Test Plan, no Test Suite. Attaching a case to a
 * plan stays a human action.
 */
export class AzureDevopsTestProvider extends TestManagementProviderRoot {
  protected serverUrl: string | null;
  protected teamProject: string | null;
  protected token: string | null;
  private witApi: IWorkItemTrackingApi | null = null;
  private apiFactory?: () => Promise<IWorkItemTrackingApi>;
  /**
   * In-process cache of the resolved carrier context, so a multi-case push reads its story
   * work item ONCE and not once per case: a real push of ten cases must not fire ten
   * identical GETs. A push runs as its own CLI process, so the cache starts empty every time.
   */
  private carrierCache = new Map<string, CarrierContext>();

  /**
   * `apiFactory` is injectable so the adapter is unit testable: `azure-devops-node-api` is not
   * fetch based, so `setFetchForTests` cannot reach it the way it reaches the ServiceNow and
   * Xray adapters. Tests pass a stub; production leaves it undefined and the SDK client is
   * built from the environment.
   */
  public constructor(apiFactory?: () => Promise<IWorkItemTrackingApi>) {
    super();
    this.apiFactory = apiFactory;
    this.serverUrl = getEnvVar('SYSTEM_COLLECTIONURI');
    this.teamProject = getEnvVar('SYSTEM_TEAMPROJECT');
    // Exactly the priority of azureBoardsProvider and the azureDevops git provider, and nothing
    // more. AZURE_DEVOPS_EXT_PAT (the `az` CLI name) is read nowhere else in src/, so honouring
    // it here alone would make test case push work on a machine where deployment notifications
    // stay silent. Azure detection stays uniform across all three features.
    this.token = getEnvVar('CI_SFDX_HARDIS_AZURE_TOKEN') || getEnvVar('SYSTEM_ACCESSTOKEN');
    this.isActive = Boolean((this.serverUrl && this.teamProject && this.token) || apiFactory);
  }

  public getLabel(): string {
    return 'azure-devops';
  }

  public getRequiredEnvVars(): string[] {
    return ['SYSTEM_COLLECTIONURI', 'SYSTEM_TEAMPROJECT', 'CI_SFDX_HARDIS_AZURE_TOKEN (or SYSTEM_ACCESSTOKEN)'];
  }

  /**
   * @param carrier context inherited from the carrier work item. Omitted or with a null field:
   *   the corresponding Azure DevOps field is left out of the patch entirely, not sent empty.
   *   That is what keeps an unassigned carrier from ever inventing an assignee.
   */
  public static buildPatch(testCase: NormalizedTestCase, carrier: CarrierContext | null): any[] {
    const patch: any[] = [
      { op: 'add', path: '/fields/System.Title', value: testCase.title },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: testCase.priority },
      { op: 'add', path: '/fields/Microsoft.VSTS.TCM.Steps', value: azureDevopsStepsXml(testCase.steps) },
      { op: 'add', path: '/fields/System.Description', value: _description(testCase) },
      { op: 'add', path: '/fields/System.Tags', value: _tags(testCase) },
    ];
    // A missing System.AreaPath is exactly what makes Azure DevOps reject the very first item
    // with 403 TF237111. Inherited from the carrier, never configured and never guessed.
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

  public async checkPrerequisites(): Promise<void> {
    if (!this.serverUrl) {
      throw new SfError('Azure DevOps: SYSTEM_COLLECTIONURI is not set (ex: https://dev.azure.com/mycompany).');
    }
    if (!this.teamProject) {
      throw new SfError('Azure DevOps: SYSTEM_TEAMPROJECT is not set.');
    }
    if (!this.token) {
      throw new SfError('Azure DevOps: neither CI_SFDX_HARDIS_AZURE_TOKEN nor SYSTEM_ACCESSTOKEN is set.');
    }
    try {
      await (await this.api()).getFields(this.teamProject);
    } catch (e) {
      throw new SfError(
        `Azure DevOps: probe failed on ${this.serverUrl} project ${this.teamProject} - ${(e as Error).message}. ` +
          'Check the PAT scopes (Work Items read and write).'
      );
    }
  }

  public async findByKey(key: string): Promise<ProviderRef | null> {
    const wiql = {
      query:
        `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = '${WORK_ITEM_TYPE}' ` +
        `AND [System.Tags] CONTAINS '${String(key).replace(/'/g, "''")}'`,
    };
    const api = await this.api();
    const result = await api.queryByWiql(wiql, { project: this.teamProject } as any);
    const hits = result?.workItems ?? [];
    // `CONTAINS` on `System.Tags` matches whole tags, not substrings. Measured against a live
    // instance: a strict prefix of an existing tag returns nothing, so the query alone is
    // already exact and `TESTKIT:T:F1` does NOT match the tag of case `F10`.
    //
    // Each hit is still re-checked against its own `System.Tags` before being accepted. That
    // whole-tag behavior is specific to the Tags field and differs from `CONTAINS` on a text
    // field, it is not something the WIQL reference states, and accepting the wrong work item
    // here would update it and then create the right case as a duplicate. The check is free:
    // the work item has to be read anyway to build the reference.
    for (const hit of hits) {
      if (!hit.id) {
        continue;
      }
      const workItem = await api.getWorkItem(Number(hit.id), ['System.Tags']);
      const tags = String(workItem?.fields?.['System.Tags'] ?? '')
        .split(';')
        .map((tag) => tag.trim());
      if (tags.includes(key)) {
        return { id: String(workItem.id), url: this.htmlUrlOf(workItem) };
      }
    }
    return null;
  }

  public async create(testCase: NormalizedTestCase): Promise<ProviderRef> {
    const carrier = await this.fetchCarrier(_requireStoryId(testCase.ticket));
    const patch = AzureDevopsTestProvider.buildPatch(testCase, carrier);
    const api = await this.api();
    const workItem = await api.createWorkItem(
      {},
      patch as JsonPatchDocument,
      this.teamProject as string,
      WORK_ITEM_TYPE
    );
    return { id: String(workItem.id), url: this.htmlUrlOf(workItem) };
  }

  public async update(ref: ProviderRef, testCase: NormalizedTestCase): Promise<ProviderRef> {
    const carrier = await this.fetchCarrier(_requireStoryId(testCase.ticket));
    // Kept as `add` and not rewritten to `replace`: on a work item field, Azure DevOps treats
    // `add` as an upsert, whereas `replace` on a field the item never carried is rejected. That
    // happens whenever the carrier was unassigned at create time and has an assignee now, and
    // it would fail the same case on every run.
    const patch = AzureDevopsTestProvider.buildPatch(testCase, carrier);
    const api = await this.api();
    const workItem = await api.updateWorkItem(
      {},
      patch as JsonPatchDocument,
      Number(ref.id),
      this.teamProject as string
    );
    return { id: ref.id, url: this.htmlUrlOf(workItem) || ref.url };
  }

  /** Relation Tests -> US: TestedBy-Reverse points from the test case to the story. */
  public async linkToStory(ref: ProviderRef, storyId: string): Promise<void> {
    const carrierId = _requireStoryId(storyId);
    const patch = [
      {
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'Microsoft.VSTS.Common.TestedBy-Reverse',
          url: `${String(this.serverUrl).replace(/\/+$/, '')}/_apis/wit/workItems/${carrierId}`,
        },
      },
    ];
    const api = await this.api();
    await api.updateWorkItem({}, patch as JsonPatchDocument, Number(ref.id), this.teamProject as string);
  }

  /**
   * Read the carrier work item (the story the cases are linked to) and extract the three
   * fields a test case must inherit from it. Area, iteration AND assignee follow the story
   * owner, never a config value and never the API caller's own identity, so the assignee stays
   * correct however the push is run and by whom.
   *
   * Explicit fallback: an unassigned carrier leaves the test cases unassigned too. Inventing a
   * recipient would reproduce the very 403 this inheritance exists to avoid.
   *
   * A carrier that cannot be read fails the push up front, rather than letting every case 403
   * one by one the way the missing area path did.
   */
  private async fetchCarrier(storyId: string): Promise<CarrierContext | null> {
    if (!storyId) {
      return null;
    }
    const cached = this.carrierCache.get(storyId);
    if (cached) {
      return cached;
    }
    let fields: Record<string, any>;
    try {
      const workItem = await (await this.api()).getWorkItem(Number(storyId));
      fields = workItem?.fields ?? {};
    } catch (e) {
      throw new SfError(
        `Azure DevOps: could not read carrier work item #${storyId} (${(e as Error).message}) to inherit its ` +
          'area, iteration and assignee. Push refused before writing anything: creating test cases without ' +
          'an area would 403 one by one.'
      );
    }
    const carrier: CarrierContext = {
      areaPath: fields['System.AreaPath'] || null,
      iterationPath: fields['System.IterationPath'] || null,
      // AssignedTo is an identity object on the API payload; only the unique name (UPN) is a
      // usable patch value. Absent entirely on an unassigned carrier, never defaulted.
      assignedTo: fields['System.AssignedTo']?.uniqueName || null,
    };
    this.carrierCache.set(storyId, carrier);
    return carrier;
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
      `${String(this.serverUrl).replace(/\/+$/, '')}/${encodeURIComponent(
        String(this.teamProject)
      )}/_workitems/edit/${workItem?.id}`
    );
  }
}
