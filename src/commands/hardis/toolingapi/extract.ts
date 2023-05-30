/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson, JsonArray } from "@salesforce/ts-types";
import * as c from "chalk";
import { generateReports, uxLog } from "../../../common/utils";
import ora = require("ora");

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class OrgPurgeFlow extends SfdxCommand {
  public static title = "Purge Apex Logs";

  public static description = "Purge apex logs in selected org";

  public static examples = [
    `$ sfdx hardis:toolingapi:extract`,
    `$ sfdx hardis:toolingapi:extract --type customfields --output csv`,
    `$ sfdx hardis:toolingapi:extract --output xls`,
  ];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)

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
    uxLog(this, c.cyan("Tooling API Request extract, thanks to Fabrice & Doria :)"));

    const conn = this.org.getConnection();
    const fields = [
      "EntityDefinition.DeveloperName",
      "DeveloperName",
      //"Label",
      "Description",
      "CreatedBy.Name",
      "CreatedDate",
      "LastModifiedBy.Name",
      "LastModifiedDate",
    ];
    const request = "SELECT  " + fields.join(",") + " FROM CustomField ORDER BY EntityDefinition.DeveloperName,DeveloperName"; //ORDER BY EntityDefinition.DeveloperName, DeveloperName";

    uxLog(this, `[sfdx-hardis][tooling] ${c.bold(c.bgWhite(c.grey(request)))}`);
    const spinner = ora({ text: request, spinner: "moon" }).start();
    let toolingResult = { records: [] };
    try {
      toolingResult = await conn.tooling.autoFetchQuery(request);
      spinner.succeed(request);
    } catch (e) {
      spinner.fail(e.message);
      throw e;
    }
    const results = toolingResult.records;

    // Generate output files
    const columns = fields.map((field) => {
      return { key: field, header: field };
    });
    const reportFiles = await generateReports(results, columns, this);

    // Return an object to be displayed with --json
    return { reportFiles: reportFiles, result: results as JsonArray, numberResults: results.length };
  }
}
