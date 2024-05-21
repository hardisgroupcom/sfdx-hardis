import { SfdxCommand } from "@salesforce/command";
// import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";

import * as c from "chalk";
import { isCI, uxLog } from "../../../../common/utils";
// import { bulkQuery } from "../../../../common/utils/apiUtils";
import { bulkDeleteTooling } from "../../../../common/utils/apiUtils";
// import { generateCsvFile, generateReportPath } from "../../../../common/utils/filesUtils";
// import { NotifProvider, NotifSeverity } from "../../../../common/notifProvider";
// import { getNotificationButtons, getOrgMarkdown } from "../../../../common/utils/notifUtils";
// import { prompts } from "../../../../common/utils/prompts";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
// const messages = Messages.loadMessages("sfdx-hardis", "org");


export default class OrgPurgeFlowDeletion extends SfdxCommand {


  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static requiresDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;
  
  protected debugMode = false;
  protected flowOut = [];

  public async run(): Promise<AnyJson> {
    // const conn = this.org.getConnection();

    // Uses latest API version
    const conn = this.org.getConnection();
    uxLog(this, c.cyan(`Org connected to ${conn.instanceUrl} ...`));

    // const connection = await Connection.create({
    //   authInfo: await AuthInfo.create({ username: 'meric.asaner@salesforce-projects.com' })
    // });
    // const a = await connection.query('SELECT Name from Account');
    // console.log(a);
    
    console.log("hello");
    
    await this.queryFlow(conn);
    // this.flowOut = await this.queryFlow(conn);
    console.log(this.flowOut);
    

    // Return an object to be displayed with --json
    return {
      status: 0,
      summary: 0,
      unusedUsers: 0,
      csvLogFile: 0,
      xlsxLogFile: 0,
    };
  }

  private async queryFlow(conn: any) {
    uxLog(this, c.cyan(`Extracting Flow Test...`));
    const deletedFlowResult = await bulkDeleteTooling(
      `
    SELECT Id
    FROM Flow`,
      conn,
    );
    // return flowQueery.records;
  }
}