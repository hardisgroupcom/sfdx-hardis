/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { execSfdxJson, extractRegexMatches, isCI, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { bulkDelete, bulkDeleteTooling, bulkQuery } from '../../../../common/utils/apiUtils.js';

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
`;

  public static examples = [
    `$ sf hardis:org:purge:flow`,
    `$ sf hardis:org:purge:flow --target-org nicolas.vuillamy@gmail.com --no-prompt --delete-flow-interviews`,
    `$ sf hardis:org:purge:flow --target-org nicolas.vuillamy@gmail.com --status "Obsolete,Draft,InvalidDraft" --name TestFlow`,
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
  protected deletedRecords: any[] = [];
  protected deletedErrors: any[] = [];
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgPurgeFlow);
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

    // Confirm deletion
    if (this.promptUser) {
      const confirmDelete = await prompts({
        type: 'confirm',
        name: 'value',
        message: c.cyanBright(`Do you confirm you want to delete these ${this.flowRecords.length} flow versions ?`),
        description: 'Permanently delete the selected flow versions from the Salesforce org',
      });

      if (confirmDelete.value === false) {
        uxLog("error", this, c.red('Action cancelled by user.'));
        return { outputString: 'Action cancelled by user.' };
      }
    }

    // Perform deletion
    const conn = flags['target-org'].getConnection();
    await this.processDeleteFlowVersions(conn, true);

    const summary =
      this.deletedRecords.length > 0
        ? `Deleted the following list of record(s)`
        : 'No record(s) to delete';
    uxLog("action", this, c.cyan(summary));
    if (this.deletedRecords.length > 0) {
      uxLogTable(this, this.deletedRecords);
    }
    // Return an object to be displayed with --json
    return { orgId: flags['target-org'].getOrgId(), outputString: summary };
  }

  private async processDeleteFlowVersions(conn: any, tryDeleteInterviews: boolean) {
    uxLog("action", this, c.cyan(`Deleting Flow versions...`));
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
      (this.deleteFlowInterviews === true || !isCI) &&
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
    // Gather flow interviews that prevent deleting flow versions
    const flowInterviewsIds: string[] = [];
    this.flowRecords = [];
    const extractInterviewsRegex = /Flow Interview - ([a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})/gm;
    for (const deletedError of this.deletedErrors) {
      this.flowRecords.push({ Id: deletedError.Id });
      const errorflowInterviewIds = await extractRegexMatches(extractInterviewsRegex, deletedError.error);
      flowInterviewsIds.push(...[...new Set(errorflowInterviewIds)]); // make interview Ids unique
    }
    if (flowInterviewsIds.length === 0) {
      return;
    }
    // Display flows & Prompt user if not in CI
    await this.displayFlowInterviewToDelete(flowInterviewsIds, conn);
    if (!isCI && this.promptUser === true) {
      const confirmDelete = await prompts({
        type: 'confirm',
        name: 'value',
        message: c.cyanBright(`Do you confirm you want to delete ${flowInterviewsIds.length} Flow Interviews ?`),
        description: 'Permanently delete the selected flow interview records from the Salesforce org',
      });
      if (confirmDelete.value === false) {
        uxLog("error", this, c.red('Action cancelled by user.'));
        return { outputString: 'Action cancelled by user.' };
      }
    }
    // Delete flow interviews
    const deleteInterviewResults = await bulkDelete('FlowInterview', flowInterviewsIds, conn);
    this.deletedRecords.push(deleteInterviewResults?.successfulResults || []);
    this.deletedErrors = deleteInterviewResults?.failedResults || [];
    // Try to delete flow versions again
    uxLog("action", this, c.cyan(`Trying again to delete flow versions after deleting flow interviews...`));
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

    if (this.flowRecords.length === 0) {
      uxLog("warning", this, c.yellow('No Flow versions found to delete.'));
      return;
    }

    const flowList = this.flowRecords
      .map(
        (flow) =>
          `- ${c.bold(flow.DefinitionDevName)} v${c.green(flow.VersionNumber)} (${c.yellow(flow.Status)})${flow.Description ? ` - ${c.gray(flow.Description)}` : ''}`
      )
      .join('\n');

    uxLog(
      "action",
      this,
      c.cyan(
        `Found ${this.flowRecords.length} Flow version(s) to delete:\n${flowList}`
      )
    );
  }

  private async listFlowVersionsToDelete(manageableConstraint: string) {
    uxLog("action", this, c.cyan('Querying Flow versions to delete...'));
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
    } else if (isCI || this.promptUser === false) {
      // Obsolete by default for CI
      this.statusFilter = ['Obsolete'];
    } else {
      // Query all flows definitions
      uxLog("action", this, c.cyan('Querying all Flow definitions to select from...'));
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
      flowNamesChoice.unshift({ title: 'All flows', value: 'all' });

      // Manually select status
      const selectStatus = await prompts([
        {
          type: 'select',
          name: 'name',
          message: 'Please select the flow you want to clean',
          description: 'Choose a specific flow to clean or select all flows',
          placeholder: 'Select a flow',
          choices: flowNamesChoice,
        },
        {
          type: 'multiselect',
          name: 'status',
          message: 'Please select the status(es) you want to delete',
          description: 'Choose which flow version statuses should be deleted',
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
      'SELECT Name,InterviewLabel,InterviewStatus,CreatedBy.Username,CreatedDate,LastModifiedDate ' +
      `FROM FlowInterview WHERE Id IN ('${flowVInterviewIds.join("','")}')` +
      ' ORDER BY Name';
    const flowsInterviewsToDelete = (await bulkQuery(query, conn)).records;
    if (flowsInterviewsToDelete.length === 0) {
      uxLog("warning", this, c.yellow('No Flow Interviews found to delete.'));
      return;
    }
    // Display Flow Interviews to delete
    const flowList = flowsInterviewsToDelete
      .map(
        (flow) =>
          `- ${c.bold(flow.Name)} (${c.green(flow.InterviewLabel)}) - ${c.yellow(flow.InterviewStatus)}`
      )
      .join('\n');
    uxLog("action", this, c.cyan(`Found ${flowsInterviewsToDelete.length} Flow Interviews to delete:\n${flowList}`));
  }
}
