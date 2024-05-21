/* jscpd:ignore-start */
import { flags, SfdxCommand, } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import * as columnify from "columnify";
import { execSfdxJson, isCI, uxLog, execCommand } from "../../../../common/utils";
import { bulkDeleteTooling } from "../../../../common/utils/apiUtils";
import { prompts } from "../../../../common/utils/prompts";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class OrgPurgeFlow extends SfdxCommand {
  public static title = "Purge Flow versions";

  public static description = messages.getMessage("orgPurgeFlow");

  public static examples = [
    `$ sfdx hardis:org:purge:flow --no-prompt`,
    `$ sfdx hardis:org:purge:flow --targetusername nicolas.vuillamy@gmail.com
  Found 1 records:
  ID                 MASTERLABEL VERSIONNUMBER DESCRIPTION  STATUS
  30109000000kX7uAAE TestFlow    2             test flowwww Obsolete
  Are you sure you want to delete this list of records (y/n)?: y
  Successfully deleted record: 30109000000kX7uAAE.
  Deleted the following list of records:
  ID                 MASTERLABEL VERSIONNUMBER DESCRIPTION  STATUS
  30109000000kX7uAAE TestFlow    2             test flowwww Obsolete
  `,
    `$ sfdx hardis:org:purge:flow --targetusername nicolas.vuillamy@gmail.com --status "Obsolete,Draft,InvalidDraft --name TestFlow"
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
    prompt: flags.boolean({
      char: "z",
      default: true,
      allowNo: true,
      description: messages.getMessage("prompt"),
    }),
    name: flags.string({
      char: "n",
      description: messages.getMessage("nameFilter"),
    }),
    status: flags.string({
      char: "s",
      description: messages.getMessage("statusFilter"),
    }),
    allowpurgefailure: flags.boolean({
      char: "f",
      default: true,
      allowNo: true,
      description: messages.getMessage("allowPurgeFailure"),
    }),
    instanceurl: flags.string({
      char: "r",
      default: "https://login.salesforce.com",
      description: messages.getMessage("instanceUrl"),
    }),
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  // protected static requiresDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

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
      // Query all flows
      const allFlowQueryCommand =
        "sfdx force:data:soql:query " +
        ` -q "SELECT Id,MasterLabel,VersionNumber,ManageableState FROM Flow WHERE ${manageableConstraint} ORDER BY MasterLabel"` +
        ` --targetusername ${username}` +
        " -t";
      const allFlowQueryRes = await execSfdxJson(allFlowQueryCommand, this, {
        output: false,
        debug: debugMode,
        fail: true,
      });
      const flowRecordsRaw = allFlowQueryRes?.result?.records || allFlowQueryRes.records || [];
      const flowNamesUnique = [...new Set(flowRecordsRaw.map((flowRecord) => flowRecord.MasterLabel))];
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
      throw new SfdxError("You can not delete active records");
    }

    // Build query with name filter if sent
    let query = `SELECT Id,MasterLabel,VersionNumber,Status,Description FROM Flow WHERE ${manageableConstraint} AND Status IN ('${statusFilter.join(
      "','",
    )}')`;
    if (nameFilter && nameFilter != "all") {
      query += ` AND MasterLabel LIKE '${nameFilter}%'`;
    }
    query += " ORDER BY MasterLabel,VersionNumber";


    ///
    ///
    ///

    // Build apex logs query
    const tempDir = "./tmp";
    await fs.ensureDir(tempDir);
    // const flowsToDeleteCsv = path.join(tempDir, "FlowsToDelete_" + Math.random() + ".csv");
    // const flowQueryCommandCSV = `sfdx force:data:soql:query -q "${query}" --targetusername ${username} -r "csv" > "${flowsToDeleteCsv}" -t`;
    // const flowQueryCommandOriginal = `sfdx force:data:soql:query -q "${query}" --targetusername ${username} -t`;
    const flowQueryCommand = `sfdx force:data:soql:query -q "SELECT Id,MasterLabel,VersionNumber,Status,Description FROM Flow WHERE MasterLabel LIKE 'PURGE FLOW V%'" --targetusername ${username} -t`;
    console.log(flowQueryCommand);

    const flowQueryRes = await execSfdxJson(flowQueryCommand, this, {
      output: false,
      debug: debugMode,
      fail: true,
    });
    const recordsRaw = flowQueryRes?.result?.records || flowQueryRes.records || [];
    console.log(recordsRaw);
    // return {};
    // Execute the SOQL query command
  //   const queryResult = await execCommand(flowQueryCommand, this, {
  //     output: false,
  //     debug: debugMode,
  //     fail: true,
  // });

    // Extract the result data

    
    const extractFile = flowQueryRes.stdout.toString();

    // Count the number of flows
    // const flowsCount = extractFile.split("\n").filter((line) => line.length > 0).length;

    // If there are flows, create the CSV file
    if (flowQueryRes.records.length > 0) {
        const flowsToDeleteCsv = path.join(tempDir, "FlowsToDelete_" + Math.random() + ".csv");
        await fs.writeFile(flowsToDeleteCsv, extractFile);
        console.log(`CSV file created at: ${flowsToDeleteCsv}`);
    } else {
        console.log(`No flows found for deletion.`);
    }

    return {};
    
    await execCommand(flowQueryCommand, this, {
      output: false,
      debug: debugMode,
      fail: true,
    });
 
    // const extractFile = (await fs.readFile(flowsToDeleteCsv, "utf8")).toString();
    // const flowsCount = extractFile.split("\n").filter((line) => line.length > 0).length;
    
    if (flowsCount === 0) {
      uxLog(this, c.cyan(`There are no Flows to delete in org ${c.green(this.org.getUsername())}`));
      return {};
    }
    
    // Check empty result
    if (flowsCount === 0) {
      const outputString = `[sfdx-hardis] No matching Flow records found with query ${query}`;
      uxLog(this, c.yellow(outputString));
      return { deleted: [], outputString };
    }

    // Simplify results format & display them
    // const records = recordsRaw.map((record: any) => {
    //   return {
    //     Id: record.Id,
    //     MasterLabel: record.MasterLabel,
    //     VersionNumber: record.VersionNumber,
    //     Description: record.Description,
    //     Status: record.Status,
    //   };
    // });
    uxLog(this, `[sfdx-hardis] Found ${c.bold(flowsCount)} records:\n${c.yellow(columnify(extractFile))}`);

    // Confirm deletion
    if (prompt) {
      const confirmDelete = await prompts({
        type: "confirm",
        name: "value",
        message: c.cyanBright(`Do you confirm you want to delete these ${flowsCount} flow versions ?`),
      });
      if (confirmDelete === false) {
        return { outputString: "Action cancelled by user" };
      }
    }
    return {};
    // Perform deletion
    const deleted = [];
    const deleteErrors = [];
    // for (const record of records) {
    //   const deleteCommand =
    //     "sfdx force:data:record:delete" + " --sobjecttype Flow" + ` --sobjectid ${record.Id}` + ` --targetusername ${username}` + " -t";
    //   const deleteRes = await execSfdxJson(deleteCommand, this, {
    //     fail: false,
    //     output: false,
    //     debug: debugMode,
    //   });
    //   if (!(deleteRes.status === 0)) {
    //     this.ux.error(c.red(`[sfdx-hardis] Unable to perform deletion request: ${JSON.stringify(deleteRes)}`));
    //     deleteErrors.push(deleteRes);
    //   }
    //   deleted.push(record);
    // }

    ///
    ///
    ///

    if (deleteErrors.length > 0) {
      const errMsg = `[sfdx-hardis] There are been errors while deleting ${deleteErrors.length} records: \n${JSON.stringify(deleteErrors)}`;
      if (allowPurgeFailure) {
        uxLog(this, c.yellow(errMsg));
      } else {
        throw new SfdxError(c.yellow(`There are been errors while deleting ${deleteErrors.length} records: \n${JSON.stringify(deleteErrors)}`));
      }
    }

    const summary =
      deleted.length > 0 ? `[sfdx-hardis] Deleted the following list of records:\n${columnify(deleted)}` : "[sfdx-hardis] No record to delete";
    uxLog(this, c.green(summary));
    // Return an object to be displayed with --json
    return { orgId: this.org.getOrgId(), outputString: summary };
  }
}
