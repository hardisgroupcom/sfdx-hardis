/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import c from "chalk";
import * as columnify from "columnify";
import { execSfdxJson, isCI, uxLog } from "../../../../common/utils";
import { prompts } from "../../../../common/utils/prompts";
import { bulkDeleteTooling } from "../../../../common/utils/apiUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class OrgPurgeFlow extends SfCommand<any> {
  public static title = "Purge Flow versions";

  public static description = messages.getMessage("orgPurgeFlow");

  public static examples = [
    `$ sf hardis:org:purge:flow --no-prompt`,
    `$ sf hardis:org:purge:flow --targetusername nicolas.vuillamy@gmail.com
  Found 1 records:
  ID                 MASTERLABEL VERSIONNUMBER DESCRIPTION  STATUS
  30109000000kX7uAAE TestFlow    2             test flowwww Obsolete
  Are you sure you want to delete this list of records (y/n)?: y
  Successfully deleted record: 30109000000kX7uAAE.
  Deleted the following list of records:
  ID                 MASTERLABEL VERSIONNUMBER DESCRIPTION  STATUS
  30109000000kX7uAAE TestFlow    2             test flowwww Obsolete
  `,
    `$ sf hardis:org:purge:flow --targetusername nicolas.vuillamy@gmail.com --status "Obsolete,Draft,InvalidDraft --name TestFlow"
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

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    prompt: Flags.boolean({
      char: "z",
      default: true,
      allowNo: true,
      description: messages.getMessage("prompt"),
    }),
    name: Flags.string({
      char: "n",
      description: messages.getMessage("nameFilter"),
    }),
    status: Flags.string({
      char: "s",
      description: messages.getMessage("statusFilter"),
    }),
    allowpurgefailure: Flags.boolean({
      char: "f",
      default: true,
      allowNo: true,
      description: messages.getMessage("allowPurgeFailure"),
    }),
    instanceurl: Flags.string({
      char: "r",
      default: "https://login.salesforce.com",
      description: messages.getMessage("instanceUrl"),
    }),
    debug: Flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: Flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: Flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  // protected static requiresDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const prompt = this.flags.prompt === false ? false : true;
    let nameFilter = this.flags.name || null;
    const allowPurgeFailure = this.flags.allowpurgefailure === false ? false : true;
    const debugMode = this.flags.debug || false;
    const username = this.org.getUsername();

    let statusFilter;
    const manageableConstraint = "ManageableState IN ('deprecatedEditable','installedEditable','unmanaged')";
    if (this.flags.status) {
      // Input parameter used
      statusFilter = this.flags.status.split(",");
    } else if (isCI) {
      // Obsolete by default for CI
      statusFilter = ["Obsolete"];
    } else {
      // Query all flows definitions
      const allFlowQueryCommand =
        "sf data query " +
        ` --query "SELECT Id,DeveloperName,MasterLabel,ManageableState FROM FlowDefinition WHERE ${manageableConstraint} ORDER BY DeveloperName"` +
        ` --target-org ${username}` +
        " --use-tooling-api";
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
      flowNamesChoice.unshift({ title: "All flows", value: "all" });

      // Manually select status
      const selectStatus = await prompts([
        {
          type: "select",
          name: "name",
          message: "Please select the flow you want to clean",
          choices: flowNamesChoice,
        },
        {
          type: "multiselect",
          name: "status",
          message: "Please select the status(es) you want to delete",
          choices: [
            { title: `Draft`, value: "Draft" },
            { title: `Inactive`, value: "Inactive" },
            { title: `Obsolete`, value: "Obsolete" },
          ],
        },
      ]);
      nameFilter = selectStatus.name;
      statusFilter = selectStatus.status;
    }

    // Check we don't delete active Flows
    if (statusFilter.includes("Active")) {
      throw new SfError("You can not delete active records");
    }

    // Build query with name filter if sent
    let query = `SELECT Id,MasterLabel,VersionNumber,Status,Description,Definition.DeveloperName FROM Flow WHERE ${manageableConstraint} AND Status IN ('${statusFilter.join(
      "','",
    )}')`;
    if (nameFilter && nameFilter != "all") {
      query += ` AND Definition.DeveloperName = '${nameFilter}'`;
    }
    query += " ORDER BY Definition.DeveloperName,VersionNumber";

    const flowQueryCommand = "sf data query " + ` --query "${query}"` + ` --target-org ${username}` + " --use-tooling-api";
    const flowQueryRes = await execSfdxJson(flowQueryCommand, this, {
      output: false,
      debug: debugMode,
      fail: true,
    });
    const recordsRaw = flowQueryRes?.result?.records || flowQueryRes.records || [];

    // Check empty result
    if (recordsRaw.length === 0) {
      const outputString = `[sfdx-hardis] No matching Flow records found with query ${query}`;
      uxLog(this, c.yellow(outputString));
      return { deleted: [], outputString };
    }

    // Simplify results format & display them
    const records = recordsRaw.map((record: any) => {
      return {
        Id: record.Id,
        MasterLabel: record.MasterLabel,
        VersionNumber: record.VersionNumber,
        DefinitionDevName: record.Definition.DeveloperName,
        Status: record.Status,
        Description: record.Description,
      };
    });

    uxLog(this, `[sfdx-hardis] Found ${c.bold(records.length)} records:\n${c.yellow(columnify(records))}`);

    // Confirm deletion
    if (prompt) {
      const confirmDelete = await prompts({
        type: "confirm",
        name: "value",
        message: c.cyanBright(`Do you confirm you want to delete these ${records.length} flow versions ?`),
      });

      if (confirmDelete.value === false) {
        uxLog(this, c.magenta("Action cancelled by user"));
        return { outputString: "Action cancelled by user" };
      }
    }

    // Perform deletion
    const deleted: any[] = [];
    const deleteErrors: any[] = [];
    const conn = this.org.getConnection();
    const deleteResults = await bulkDeleteTooling("Flow", records, conn);
    for (const deleteRes of deleteResults.results) {
      if (deleteRes.success) {
        deleted.push(deleteRes);
      } else {
        this.ux.error(c.red(`[sfdx-hardis] Unable to perform deletion request: ${JSON.stringify(deleteRes)}`));
        deleteErrors.push(deleteRes);
      }
    }
    if (deleteErrors.length > 0) {
      const errMsg = `[sfdx-hardis] There have been errors while deleting ${deleteErrors.length} record(s): \n${JSON.stringify(deleteErrors)}`;
      if (allowPurgeFailure) {
        uxLog(this, c.yellow(errMsg));
      } else {
        throw new SfError(c.yellow(`There have been errors while deleting ${deleteErrors.length} record(s): \n${JSON.stringify(deleteErrors)}`));
      }
    }

    const summary =
      deleted.length > 0 ? `[sfdx-hardis] Deleted the following list of record(s):\n${columnify(deleted)}` : "[sfdx-hardis] No record(s) to delete";
    uxLog(this, c.green(summary));
    // Return an object to be displayed with --json
    return { orgId: this.org.getOrgId(), outputString: summary };
  }
}
