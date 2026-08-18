/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { execSfdxJson, isCI, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { bulkDelete, bulkDeleteTooling, bulkQuery } from '../../../../common/utils/apiUtils.js';
import { dedupeFlowInterviewIds, extractBlockingFlowInterviewIds, FLOW_INTERVIEW_BLOCK_MARKER, queryFlowInterviewIdsForFlows } from '../../../../common/utils/flowDeletionUtils.js';
import { generateCsvFile, generateReportPath, uxLogTableWithReport } from '../../../../common/utils/filesUtils.js';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgPurgeFlow extends SfCommand<any> {
  public static title = 'Purge Flow versions';

  public static description = `
**Purges old or unwanted Flow versions from a Salesforce org, with an option to delete related Flow Interviews.**

This command helps maintain a clean and performant Salesforce org by removing obsolete Flow versions. Over time, multiple versions of Flows can accumulate, consuming storage and potentially impacting performance. This tool provides a controlled way to clean up these versions.

Key functionalities:

- **Targeted Flow Selection:** Allows you to filter Flow versions to delete by name (\`--name\`) and status (\`--status\`, e.g., \`Obsolete\`, \`Draft\`, \`Inactive\`).
- **Flow Interview Deletion:** If a Flow version cannot be deleted due to active Flow Interviews, the \`--delete-flow-interviews\` flag (or interactive prompt) allows you to delete these interviews first, then retry the Flow version deletion.
- **Confirmation Prompt:** In interactive mode, it prompts for confirmation before proceeding with the deletion of Flow versions and Flow Interviews.
- **Partial Success Handling:** The \`--allowpurgefailure\` flag (default \`true\`) allows the command to continue even if some deletions fail, reporting the errors.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SOQL Queries (Tooling API):** It queries the \`Flow\` object (using the Tooling API) to list Flow versions based on the provided filters (name, status, manageable state).
- **Bulk Deletion (Tooling API):** It uses \`bulkDeleteTooling\` to perform mass deletions of Flow versions. If deletion fails due to active interviews, it extracts the interview IDs.
- **Flow Interview Management:** If \`delete-flow-interviews\` is enabled, it queries \`FlowInterview\` objects, performs bulk deletion of the identified interviews using \`bulkDelete\`, and then retries the Flow version deletion.
- **Interactive Prompts:** Uses the \`prompts\` library to interact with the user for selecting Flows, statuses, and confirming deletion actions.
- **Error Reporting:** Logs detailed error messages for failed deletions, including the specific reasons.
- **Command-Line Execution:** Uses \`execSfdxJson\` to execute Salesforce CLI commands for querying Flow data.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:purge:flow --agent --target-org myorg@example.com
\`\`\`

In agent mode:

- All interactive prompts and confirmations are skipped.
- If \`--status\` is not provided, defaults to \`Obsolete\`.
- If \`--name\` is not provided, all matching Flows are targeted.
- Flow version and Flow Interview deletions proceed without confirmation.
`;

  public static examples = [
    `$ sf hardis:org:purge:flow`,
    `$ sf hardis:org:purge:flow --target-org nicolas.vuillamy@gmail.com --no-prompt --delete-flow-interviews`,
    `$ sf hardis:org:purge:flow --target-org nicolas.vuillamy@gmail.com --status "Obsolete,Draft,InvalidDraft" --name TestFlow`,
    '$ sf hardis:org:purge:flow --agent',
  ];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    // flag with a value (-n, --name=VALUE)
    prompt: Flags.boolean({
      char: 'z',
      default: true,
      allowNo: true,
      description: messages.getMessage('prompt'),
    }),
    name: Flags.string({
      char: 'n',
      description: messages.getMessage('nameFilter'),
    }),
    status: Flags.string({
      char: 's',
      description: messages.getMessage('statusFilter'),
    }),
    'delete-flow-interviews': Flags.boolean({
      char: 'w',
      default: false,
      description: `If the presence of Flow interviews prevent to delete flows versions, delete them before retrying to delete flow versions`,
    }),
    allowpurgefailure: Flags.boolean({
      char: 'f',
      default: true,
      allowNo: true,
      description: messages.getMessage('allowPurgeFailure'),
    }),
    instanceurl: Flags.string({
      char: 'r',
      default: 'https://login.salesforce.com',
      description: messages.getMessage('instanceUrl'),
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  protected debugMode = false;
  protected statusFilter: string[] = [];
  protected nameFilter: string | null = null;
  protected username: string;
  protected promptUser = true;
  protected deleteFlowInterviews: boolean;
  protected allowPurgeFailure: boolean;
  protected flowRecordsRaw: any[];
  protected flowRecords: any[];
  protected flowVersionDetailsById: Record<string, any> = {};
  protected flowInterviewDetailsById: Record<string, any> = {};
  protected deletedRecords: any[] = [];
  protected deletedErrors: any[] = [];
  protected outputFilesToDelete: any = {};
  protected outputFilesDeleted: any = {};
  protected conn: any;
  protected agentMode = false;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgPurgeFlow);
    this.agentMode = flags.agent === true;
    this.promptUser = flags.prompt === false ? false : true;
    this.nameFilter = flags.name || null;
    this.allowPurgeFailure = flags.allowpurgefailure === false ? false : true;
    this.deleteFlowInterviews = flags['delete-flow-interviews'] || false;
    this.debugMode = flags.debug || false;
    this.username = flags['target-org'].getUsername();

    // List flows to delete, prompt user if not in CI and not send as arguments
    const manageableConstraint = await this.getFlowsScope(flags);

    // Check we don't delete active Flows
    if (this.statusFilter.includes('Active')) {
      throw new SfError('You can not delete active records');
    }

    // Build query with name filter if sent
    await this.listFlowVersionsToDelete(manageableConstraint);

    // Check empty result
    if (this.flowRecordsRaw.length === 0) {
      const outputString = `[sfdx-hardis] No matching Flow records found`;
      uxLog("warning", this, c.yellow(outputString));
      return { deleted: [], outputString };
    }

    // Simplify results format & display them
    this.formatFlowRecords();

    // Generate CSV report of flows to delete
    await this.generateFlowsToDeleteReport();

    // Confirm deletion
    if (this.promptUser && !isCI && !this.agentMode) {
      const confirmDelete = await prompts({
        type: 'confirm',
        name: 'value',
        message: c.cyanBright(t('doYouConfirmYouWantToDelete2', { flowRecords: this.flowRecords.length })),
        description: t('deleteFlowVersionsDescription'),
      });

      if (confirmDelete.value === false) {
        uxLog("action", this, c.cyan(t('actionCancelledByUser')));
        return { outputString: 'Action cancelled by user.' };
      }
    }

    // Perform deletion
    const conn = flags['target-org'].getConnection();
    this.conn = conn;
    await this.processDeleteFlowVersions(conn, true);

    const deletedRecordsFlat = this.deletedRecords.flat();
    const summary =
      deletedRecordsFlat.length > 0
        ? t('deletedRecordsSummary', { count: deletedRecordsFlat.length })
        : t('noRecordsToDelete');
    uxLog("action", this, c.cyan(summary));
    if (deletedRecordsFlat.length > 0) {
      const enrichedDeletedRecords = deletedRecordsFlat.map((r: any) => {
        const id = String(r.Id ?? r.id ?? '');
        const idKey = id.substring(0, 15);
        const interviewDetail = this.flowInterviewDetailsById[idKey];
        const flowDetail = this.flowVersionDetailsById[idKey] ?? {};
        return {
          'Type': interviewDetail ? 'Flow Interview' : 'Flow Version',
          'Id': id,
          'API Name': interviewDetail ? interviewDetail.Name ?? '' : flowDetail.DefinitionDevName ?? '',
          'Version': interviewDetail ? '' : flowDetail.VersionNumber ?? '',
          'Label': interviewDetail ? interviewDetail.InterviewLabel ?? '' : flowDetail.MasterLabel ?? '',
          'Status': interviewDetail ? interviewDetail.InterviewStatus ?? '' : flowDetail.Status ?? '',
          'Deletion Status': r.success ? 'Deleted' : 'Error',
          'Error': r.error ?? (Array.isArray(r.errors) ? r.errors.map((err: any) => err?.message).filter(Boolean).join('; ') : ''),
        };
      });
      uxLogTable(this, enrichedDeletedRecords);
      const deletionReportPath = await generateReportPath('org-purge-flow-deleted', '');
      this.outputFilesDeleted = await generateCsvFile(enrichedDeletedRecords, deletionReportPath, {
        fileTitle: t('flowVersionsDeletionResultsReportTitle'),
      });
    }

    // Return an object to be displayed with --json
    return {
      orgId: flags['target-org'].getOrgId(),
      outputString: summary,
      csvLogFile: this.outputFilesToDelete?.csvFile,
      xlsxLogFile: this.outputFilesToDelete?.xlsxFile,
    };
  }

  private async processDeleteFlowVersions(conn: any, tryDeleteInterviews: boolean) {
    uxLog("action", this, c.cyan(t('deletingFlowVersions')));
    const recordsIds = this.flowRecords.map((record) => record.Id);
    const deleteResults = await bulkDeleteTooling('Flow', recordsIds, conn);
    for (const deleteRes of deleteResults.results) {
      if (deleteRes.success) {
        this.deletedRecords.push(deleteRes);
      } else {
        uxLog("error", this, c.red(`[sfdx-hardis] Unable to perform deletion request: ${JSON.stringify(deleteRes)}`));
        this.deletedErrors.push(deleteRes);
      }
    }
    if (
      this.deletedErrors.length > 0 &&
      (this.deleteFlowInterviews === true || (!isCI && !this.agentMode)) &&
      tryDeleteInterviews === true
    ) {
      await this.manageDeleteFlowInterviews(conn);
    }

    if (this.deletedErrors.length > 0) {
      const errMsg = `[sfdx-hardis] There have been errors while deleting ${this.deletedErrors.length
        } record(s): \n${JSON.stringify(this.deletedErrors)}`;
      if (this.allowPurgeFailure) {
        uxLog("warning", this, c.yellow(errMsg));
      } else {
        throw new SfError(
          c.yellow(
            `There have been errors while deleting ${this.deletedErrors.length} record(s): \n${JSON.stringify(
              this.deletedErrors
            )}`
          )
        );
      }
    }
  }

  private async manageDeleteFlowInterviews(conn: any) {
    // Resolve the exact Flow versions whose deletion failed BECAUSE of Flow Interviews, before
    // this.flowRecords is reset below. Other failures (access, references) stay out: deleting
    // interviews cannot unblock them and the deletion is irreversible. Querying by Flow name alone
    // would also delete interviews on versions that are not being purged.
    const interviewBlockedErrors = this.deletedErrors.filter((deletedError: any) =>
      JSON.stringify(deletedError).includes(FLOW_INTERVIEW_BLOCK_MARKER)
    );
    const failedVersionIds = new Set(
      interviewBlockedErrors.map((deletedError: any) => deletedError.Id ?? deletedError.id).filter(Boolean)
    );
    const blockedVersionIdsByFlow: Record<string, string[]> = {};
    for (const record of this.flowRecords) {
      if (!failedVersionIds.has(record.Id) || !record.DefinitionDevName) {
        continue;
      }
      blockedVersionIdsByFlow[record.DefinitionDevName] =
        blockedVersionIdsByFlow[record.DefinitionDevName] || [];
      blockedVersionIdsByFlow[record.DefinitionDevName].push(record.Id);
    }
    const blockedFlowNames = Object.keys(blockedVersionIdsByFlow);
    // Gather every interview on the blocked versions, plus the ones named in each deletion error as a
    // fallback when the exhaustive query is unavailable. Both sources go through
    // dedupeFlowInterviewIds, as they do not agree on the 15/18-char Id form.
    const flowInterviewsIds: string[] = await queryFlowInterviewIdsForFlows(blockedFlowNames, conn, this, {
      versionIdsByFlow: blockedVersionIdsByFlow,
      failOnError: false,
    });
    this.flowRecords = [];
    for (const deletedError of this.deletedErrors) {
      this.flowRecords.push({ Id: deletedError.Id ?? deletedError.id });
      flowInterviewsIds.push(...(await extractBlockingFlowInterviewIds(JSON.stringify(deletedError))));
    }
    const flowInterviewsIdsList = dedupeFlowInterviewIds(flowInterviewsIds);
    if (flowInterviewsIdsList.length === 0) {
      return;
    }
    // Display flows & Prompt user if not in CI
    await this.displayFlowInterviewToDelete(flowInterviewsIdsList, conn);
    if (!isCI && !this.agentMode && this.promptUser === true) {
      const confirmDelete = await prompts({
        type: 'confirm',
        name: 'value',
        message: c.cyanBright(t('doYouConfirmYouWantToDelete', { flowInterviewsIds: flowInterviewsIdsList.length })),
        description: t('deleteFlowInterviewsDescription'),
      });
      if (confirmDelete.value === false) {
        uxLog("action", this, c.cyan(t('actionCancelledByUser')));
        return { outputString: 'Action cancelled by user.' };
      }
    }
    // Delete flow interviews
    const deleteInterviewResults = await bulkDelete('FlowInterview', flowInterviewsIdsList, conn);
    // Bulk API v2 results use sf__Id and have no success flag: normalize them to the same shape as
    // Tooling API results, else they show up as errors in the final deletion table.
    this.deletedRecords.push(
      ...(deleteInterviewResults?.successfulResults || []).map((interviewRes: any) => ({
        Id: interviewRes.sf__Id ?? interviewRes.Id ?? interviewRes.id ?? '',
        success: true,
        errors: [],
      }))
    );
    this.deletedErrors = deleteInterviewResults?.failedResults || [];
    // Try to delete flow versions again
    uxLog("action", this, c.cyan(t('retryDeleteFlowVersionsAfterInterviews')));
    this.flowRecords = [...new Set(this.flowRecords)]; // Make list unique
    await this.processDeleteFlowVersions(conn, false);
  }

  private formatFlowRecords() {
    this.flowRecords = this.flowRecordsRaw.map((record: any) => ({
      Id: record.Id,
      MasterLabel: record.MasterLabel,
      VersionNumber: record.VersionNumber,
      DefinitionDevName: record.Definition.DeveloperName,
      Status: record.Status,
      Description: record.Description,
    }));
    for (const record of this.flowRecords) {
      this.flowVersionDetailsById[String(record.Id).substring(0, 15)] = record;
    }

    if (this.flowRecords.length === 0) {
      uxLog("warning", this, c.yellow(t('noFlowVersionsFoundToDelete')));
      return;
    }

    uxLog("action", this, c.cyan(t('foundFlowVersionsToDelete', { count: this.flowRecords.length })));
    uxLogTable(this, this.flowRecords.map((flow: any) => ({
      'API Name': flow.DefinitionDevName,
      'Version': flow.VersionNumber,
      'Label': flow.MasterLabel,
      'Status': flow.Status,
      'Description': flow.Description ?? '',
    })));
  }

  private async generateFlowsToDeleteReport(): Promise<void> {
    if (this.flowRecords.length === 0) {
      return;
    }
    const reportPath = await generateReportPath('org-purge-flow-to-delete', '');
    this.outputFilesToDelete = await generateCsvFile(this.flowRecords, reportPath, {
      fileTitle: t('flowVersionsToDeleteReportTitle'),
    });
  }

  private async listFlowVersionsToDelete(manageableConstraint: string) {
    uxLog("action", this, c.cyan(t('queryingFlowVersionsToDelete')));
    let query = `SELECT Id,MasterLabel,VersionNumber,Status,Description,Definition.DeveloperName FROM Flow WHERE ${manageableConstraint} AND Status IN ('${this.statusFilter.join(
      "','"
    )}')`;
    if (this.nameFilter && this.nameFilter != 'all') {
      query += ` AND Definition.DeveloperName = '${this.nameFilter}'`;
    }
    query += ' ORDER BY Definition.DeveloperName,VersionNumber';

    const flowQueryCommand =
      'sf data query ' + ` --query "${query}"` + ` --target-org ${this.username}` + ' --use-tooling-api';
    const flowQueryRes = await execSfdxJson(flowQueryCommand, this, {
      output: false,
      debug: this.debugMode,
      fail: true,
    });
    this.flowRecordsRaw = flowQueryRes?.result?.records || flowQueryRes.records || [];
  }

  private async getFlowsScope(flags) {
    const manageableConstraint = "ManageableState IN ('deprecatedEditable','installedEditable','unmanaged')";
    if (flags.status) {
      // Input parameter used
      this.statusFilter = flags.status.split(',');
    } else if (isCI || this.agentMode || this.promptUser === false) {
      // Obsolete by default for CI and agent mode
      this.statusFilter = ['Obsolete'];
    } else {
      // Query all flows definitions
      uxLog("action", this, c.cyan(t('queryingAllFlowDefinitionsToSelectFrom')));
      const allFlowQueryCommand =
        'sf data query ' +
        ` --query "SELECT Id,DeveloperName,MasterLabel,ManageableState FROM FlowDefinition WHERE ${manageableConstraint} ORDER BY DeveloperName"` +
        ` --target-org ${this.username}` +
        ' --use-tooling-api';
      const allFlowQueryRes = await execSfdxJson(allFlowQueryCommand, this, {
        output: false,
        debug: this.debugMode,
        fail: true,
      });
      const flowRecordsRaw = allFlowQueryRes?.result?.records || allFlowQueryRes.records || [];
      const flowNamesUnique = [...new Set(flowRecordsRaw.map((flowRecord) => flowRecord.DeveloperName))];
      const flowNamesChoice = flowNamesUnique.map((flowName) => {
        return { title: flowName, value: flowName };
      });
      flowNamesChoice.unshift({ title: t('allFlows'), value: 'all' });

      // Manually select status
      const selectStatus = await prompts([
        {
          type: 'select',
          name: 'name',
          message: t('pleaseSelectTheFlowYouWantTo2'),
          description: t('chooseASpecificFlowToCleanOrSelectAll'),
          placeholder: t('selectAFlow'),
          choices: flowNamesChoice,
        },
        {
          type: 'multiselect',
          name: 'status',
          message: t('pleaseSelectTheStatusEsYouWant'),
          description: 'Choose which flow version statuses should be deleted',
          initial: ['Draft', 'Inactive', 'Obsolete'],
          choices: [
            { title: `Draft`, value: 'Draft' },
            { title: `Inactive`, value: 'Inactive' },
            { title: `Obsolete`, value: 'Obsolete' },
          ],
        },
      ]);
      this.nameFilter = selectStatus.name;
      this.statusFilter = selectStatus.status;
    }
    return manageableConstraint;
  }

  private async displayFlowInterviewToDelete(flowVInterviewIds: string[], conn: any) {
    const query =
      'SELECT Id,Name,InterviewLabel,InterviewStatus,CreatedBy.Username,CreatedDate,LastModifiedDate ' +
      `FROM FlowInterview WHERE Id IN ('${flowVInterviewIds.join("','")}')` +
      ' ORDER BY Name';
    const flowsInterviewsToDelete = (await bulkQuery(query, conn)).records;
    if (flowsInterviewsToDelete.length === 0) {
      uxLog("warning", this, c.yellow(t('noFlowInterviewsFoundToDelete')));
      return;
    }
    // Only chance to capture these details: once the interviews are deleted they can not be queried again.
    for (const flowInterview of flowsInterviewsToDelete) {
      if (flowInterview?.Id) {
        this.flowInterviewDetailsById[String(flowInterview.Id).substring(0, 15)] = flowInterview;
      }
    }
    // Display Flow Interviews to delete using uxLogTable
    uxLog("action", this, c.cyan(t('foundFlowInterviewsToDeleteCount', { count: flowsInterviewsToDelete.length })));
    await uxLogTableWithReport(
      this,
      flowsInterviewsToDelete.map((flow: any) => ({
        'Name': flow.Name,
        'Label': flow.InterviewLabel,
        'Status': flow.InterviewStatus,
        'Created By': flow.CreatedBy?.Username ?? '',
      })),
      ['Name', 'Label', 'Status', 'Created By'],
      { fileNamePrefix: 'flow-interviews-to-delete', fileTitle: 'Flow Interviews to delete' }
    );
  }

}
