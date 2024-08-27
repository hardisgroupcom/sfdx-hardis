/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import { execCommand, uxLog } from "../../../../common/utils/index.js";
import { prompts } from "../../../../common/utils/prompts.js";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class OrgPurgeFlow extends SfCommand<any> {
  public static title = "Purge Apex Logs";

  public static description = "Purge apex logs in selected org";

  public static examples = [`$ sf hardis:org:purge:apexlog`, `$ sf hardis:org:purge:apexlog --targetusername nicolas.vuillamy@gmail.com`];

  // public static args = [{name: 'file'}];

  public static flags = {
    // flag with a value (-n, --name=VALUE)
    prompt: Flags.boolean({
      char: "z",
      default: true,
      allowNo: true,
      description: messages.getMessage("prompt"),
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
    'target-org': requiredOrgFlagWithDeprecations,
  };




  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const prompt = flags.prompt === false ? false : true;
    const debugMode = flags.debug || false;

    // Build apex logs query
    const tempDir = "./tmp";
    await fs.ensureDir(tempDir);
    const apexLogsToDeleteCsv = path.join(tempDir, "ApexLogsToDelete_" + Math.random() + ".csv");
    const queryCommand = `sf data query --query "SELECT Id FROM ApexLog LIMIT 50000" -t -r "csv" > "${apexLogsToDeleteCsv}"`;
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
    const deleteCommand = `sf data delete bulk --sobject ApexLog --file ${apexLogsToDeleteCsv}`;
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
