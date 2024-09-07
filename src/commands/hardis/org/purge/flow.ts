/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import columnify from 'columnify';
import { execSfdxJson, isCI, uxLog } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { bulkDeleteTooling } from '../../../../common/utils/apiUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgPurgeFlow extends SfCommand<any> {
  public static title = 'Purge Flow versions';

  public static description = messages.getMessage('orgPurgeFlow');

  public static examples = [
    `$ sf hardis:org:purge:flow --no-prompt`,
    `$ sf hardis:org:purge:flow --target-org nicolas.vuillamy@gmail.com
  Found 1 records:
  ID                 MASTERLABEL VERSIONNUMBER DESCRIPTION  STATUS
  30109000000kX7uAAE TestFlow    2             test flowwww Obsolete
  Are you sure you want to delete this list of records (y/n)?: y
  Successfully deleted record: 30109000000kX7uAAE.
  Deleted the following list of records:
  ID                 MASTERLABEL VERSIONNUMBER DESCRIPTION  STATUS
  30109000000kX7uAAE TestFlow    2             test flowwww Obsolete
  `,
    `$ sf hardis:org:purge:flow --target-org nicolas.vuillamy@gmail.com --status "Obsolete,Draft,InvalidDraft --name TestFlow"
  Found 4 records:
  ID                 MASTERLABEL VERSIONNUMBER DESCRIPTION  STATUS
  30109000000kX7uAAE TestFlow    2             test flowwww Obsolete
  30109000000kX8EAAU TestFlow    6             test flowwww InvalidDraft
  30109000000kX8AAAU TestFlow    5             test flowwww InvalidDraft
  30109000000kX89AAE TestFlow    4             test flowwww Draft
  Are you sure you want to delete this list of records (y/n)?: n
  No record deleted
  `,
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
    "delete-flow-interviews": Flags.boolean({
      char: 'f',
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

  protected statusFilter: string[] = [];
  protected nameFilter: string | null = null;
  protected username: string;
  protected flowRecordsRaw: any[];
  protected flowRecords: any[];
  protected deletedRecords: any[] = [];
  protected deletedErrors: any[] = [];
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgPurgeFlow);
    const prompt = flags.prompt === false ? false : true;
    this.nameFilter = flags.name || null;
    const allowPurgeFailure = flags.allowpurgefailure === false ? false : true;
    // const deleteFlowInterviews = flags["delete-flow-interviews"] || false;
    const debugMode = flags.debug || false;
    this.username = flags['target-org'].getUsername();

    // List flows to delete, prompt user if not in CI and not send as arguments
    const manageableConstraint = await this.getFlowsScope(flags, debugMode);

    // Check we don't delete active Flows
    if (this.statusFilter.includes('Active')) {
      throw new SfError('You can not delete active records');
    }

    // Build query with name filter if sent
    await this.listFlowVersionsToDelete(manageableConstraint, debugMode);

    // Check empty result
    if (this.flowRecordsRaw.length === 0) {
      const outputString = `[sfdx-hardis] No matching Flow records found`;
      uxLog(this, c.yellow(outputString));
      return { deleted: [], outputString };
    }

    // Simplify results format & display them
    this.formatFlowRecords();

    // Confirm deletion
    if (prompt) {
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
    await this.processDelete(conn, allowPurgeFailure);

    const summary =
      this.deletedRecords.length > 0
        ? `[sfdx-hardis] Deleted the following list of record(s):\n${columnify(this.deletedRecords)}`
        : '[sfdx-hardis] No record(s) to delete';
    uxLog(this, c.green(summary));
    // Return an object to be displayed with --json
    return { orgId: flags['target-org'].getOrgId(), outputString: summary };
  }

  private async processDelete(conn: any, allowPurgeFailure: boolean) {
    const deleteResults = await bulkDeleteTooling('Flow', this.flowRecords, conn);
    for (const deleteRes of deleteResults.results) {
      if (deleteRes.success) {
        this.deletedRecords.push(deleteRes);
      } else {
        uxLog(this, c.red(`[sfdx-hardis] Unable to perform deletion request: ${JSON.stringify(deleteRes)}`));
        this.deletedErrors.push(deleteRes);
      }
    }
    if (this.deletedErrors.length > 0) {
      const errMsg = `[sfdx-hardis] There have been errors while deleting ${this.deletedErrors.length} record(s): \n${JSON.stringify(this.deletedErrors)}`;
      if (allowPurgeFailure) {
        uxLog(this, c.yellow(errMsg));
      } else {
        throw new SfError(
          c.yellow(
            `There have been errors while deleting ${this.deletedErrors.length} record(s): \n${JSON.stringify(this.deletedErrors)}`
          )
        );
      }
    }
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
    uxLog(this, `[sfdx-hardis] Found ${c.bold(this.flowRecords.length)} records:\n${c.yellow(columnify(this.flowRecords))}`);
  }

  private async listFlowVersionsToDelete(manageableConstraint: string, debugMode: any) {
    let query = `SELECT Id,MasterLabel,VersionNumber,Status,Description,Definition.DeveloperName FROM Flow WHERE ${manageableConstraint} AND Status IN ('${this.statusFilter.join(
      "','"
    )}')`;
    if (this.nameFilter && this.nameFilter != 'all') {
      query += ` AND Definition.DeveloperName = '${this.nameFilter}'`;
    }
    query += ' ORDER BY Definition.DeveloperName,VersionNumber';

    const flowQueryCommand = 'sf data query ' + ` --query "${query}"` + ` --target-org ${this.username}` + ' --use-tooling-api';
    const flowQueryRes = await execSfdxJson(flowQueryCommand, this, {
      output: false,
      debug: debugMode,
      fail: true,
    });
    this.flowRecordsRaw = flowQueryRes?.result?.records || flowQueryRes.records || [];
  }

  private async getFlowsScope(flags, debugMode: any) {
    const manageableConstraint = "ManageableState IN ('deprecatedEditable','installedEditable','unmanaged')";
    if (flags.status) {
      // Input parameter used
      this.statusFilter = flags.status.split(',');
    } else if (isCI) {
      // Obsolete by default for CI
      this.statusFilter = ['Obsolete'];
    } else {
      // Query all flows definitions
      const allFlowQueryCommand = 'sf data query ' +
        ` --query "SELECT Id,DeveloperName,MasterLabel,ManageableState FROM FlowDefinition WHERE ${manageableConstraint} ORDER BY DeveloperName"` +
        ` --target-org ${this.username}` +
        ' --use-tooling-api';
      const allFlowQueryRes = await execSfdxJson(allFlowQueryCommand, this, {
        output: false,
        debug: debugMode,
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
}
