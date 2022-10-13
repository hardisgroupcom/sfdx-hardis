/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import { execCommand, uxLog } from "../../../../common/utils";
import { prompts } from "../../../../common/utils/prompts";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class OrgPurgeFlow extends SfdxCommand {
  public static title = "Purge Apex Logs";

  public static description = "Purge apex logs in selected org";

  public static examples = [`$ sfdx hardis:org:purge:apexlog`, `$ sfdx hardis:org:purge:apexlog --targetusername nicolas.vuillamy@gmail.com`];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    prompt: flags.boolean({
      char: "z",
      default: true,
      allowNo: true,
      description: messages.getMessage("prompt"),
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
    const debugMode = this.flags.debug || false;

    // Build apex logs query
    const tempDir = "./tmp";
    await fs.ensureDir(tempDir);
    const apexLogsToDeleteCsv = path.join(tempDir, "ApexLogsToDelete_" + Math.random() + ".csv");
    const queryCommand = `sfdx force:data:soql:query -q "SELECT Id FROM ApexLog" -r "csv" > "${apexLogsToDeleteCsv}"`;
    await execCommand(queryCommand, this, {
      output: true,
      debug: debugMode,
      fail: true,
    });

    const extractFile = (await fs.readFile(apexLogsToDeleteCsv, "utf8")).toString();
    const apexLogsNumber = extractFile.split("\n").filter((line) => line.length > 0).length;

    if (apexLogsNumber === 0) {
      uxLog(this, c.cyan(`There are no Apex Logs to delete in org ${c.green(this.org.getUsername())}`));
      return {};
    }

    // Prompt confirmation
    if (prompt) {
      const confirmRes = await prompts({
        type: "confirm",
        name: "value",
        message: `Do you want to delete ${c.bold(apexLogsNumber)} Apex Logs of org ${c.green(this.org.getUsername())} ?`,
      });
      if (confirmRes.value === false) {
        return {};
      }
    }

    // Perform delete
    const deleteCommand = `sfdx force:data:bulk:delete -s ApexLog -f ${apexLogsToDeleteCsv}`;
    await execCommand(deleteCommand, this, {
      output: true,
      debug: debugMode,
      fail: true,
    });

    uxLog(this, c.green(`Successfully deleted ${c.bold(apexLogsNumber)} Apex Logs in org ${c.bold(this.org.getUsername())}`));

    // Return an object to be displayed with --json
    return { orgId: this.org.getOrgId() };
  }
}
