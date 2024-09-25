/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import columnify from 'columnify';
import { execSfdxJson, extractRegexMatches, isCI, uxLog } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { bulkDelete, bulkDeleteTooling, bulkQuery } from '../../../../common/utils/apiUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgPurgeFlow extends SfCommand<any> {
  public static title = 'Purge Flow versions';

  public static description = messages.getMessage('orgPurgeFlow');

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
      uxLog(this, c.yellow(outputString));
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
      });

      if (confirmDelete.value === false) {
        uxLog(this, c.magenta('Action cancelled by user'));
        return { outputString: 'Action cancelled by user' };
      }
    }

    // Perform deletion
    const conn = flags['target-org'].getConnection();
    await this.processDeleteFlowVersions(conn, true);

    const summary =
      this.deletedRecords.length > 0
        ? `[sfdx-hardis] Deleted the following list of record(s):\n${columnify(this.deletedRecords)}`
        : '[sfdx-hardis] No record(s) to delete';
    uxLog(this, c.green(summary));
    // Return an object to be displayed with --json
    return { orgId: flags['target-org'].getOrgId(), outputString: summary };
  }

  private async processDeleteFlowVersions(conn: any, tryDeleteInterviews: boolean) {
    const recordsIds = this.flowRecords.map((record) => record.Id);
    const deleteResults = await bulkDeleteTooling('Flow', recordsIds, conn);
    for (const deleteRes of deleteResults.results) {
      if (deleteRes.success) {
        this.deletedRecords.push(deleteRes);
      } else {
        uxLog(this, c.red(`[sfdx-hardis] Unable to perform deletion request: ${JSON.stringify(deleteRes)}`));
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
      const errMsg = `[sfdx-hardis] There have been errors while deleting ${
        this.deletedErrors.length
      } record(s): \n${JSON.stringify(this.deletedErrors)}`;
      if (this.allowPurgeFailure) {
        uxLog(this, c.yellow(errMsg));
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
      });
      if (confirmDelete.value === false) {
        uxLog(this, c.magenta('Action cancelled by user'));
        return { outputString: 'Action cancelled by user' };
      }
    }
    // Delete flow interviews
    const deleteInterviewResults = await bulkDelete('FlowInterview', flowInterviewsIds, conn);
    this.deletedRecords.push(deleteInterviewResults?.successfulResults || []);
    this.deletedErrors = deleteInterviewResults?.failedResults || [];
    // Try to delete flow versions again
    uxLog(this, c.cyan(`Trying again to delete flow versions after deleting flow interviews...`));
    this.flowRecords = [...new Set(this.flowRecords)]; // Make list unique
    await this.processDeleteFlowVersions(conn, false);
  }

  private formatFlowRecords() {
    this.flowRecords = this.flowRecordsRaw.map((record: any) => {
      return {
        Id: record.Id,
        MasterLabel: record.MasterLabel,
        VersionNumber: record.VersionNumber,
        DefinitionDevName: record.Definition.DeveloperName,
        Status: record.Status,
        Description: record.Description,
      };
    });
    uxLog(
      this,
      `[sfdx-hardis] Found ${c.bold(this.flowRecords.length)} records:\n${c.yellow(columnify(this.flowRecords))}`
    );
  }

  private async listFlowVersionsToDelete(manageableConstraint: string) {
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
          choices: flowNamesChoice,
        },
        {
          type: 'multiselect',
          name: 'status',
          message: 'Please select the status(es) you want to delete',
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
    uxLog(
      this,
      c.yellow(`Flow interviews to be deleted would be the following:\n${columnify(flowsInterviewsToDelete)}`)
    );
  }
}
