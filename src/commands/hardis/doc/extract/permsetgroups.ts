/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import { glob } from "glob";
import * as path from "path";
import * as toc from "markdown-toc";
import { uxLog } from "../../../../common/utils";
import { parseXmlFile } from "../../../../common/utils/xmlUtils";
import { getReportDirectory } from "../../../../config";
import { WebSocketClient } from "../../../../common/websocketClient";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DocGenerate extends SfdxCommand {
  public static title = "Generate project documentation";

  public static description = `Generate markdown files with project documentation`;

  public static examples = ["$ sf hardis:doc:extract:permsetgroups"];

  protected static flagsConfig = {
    outputfile: flags.string({
      char: "o",
      description: "Force the path and name of output report file. Must end with .csv",
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
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static requiresDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  protected outputFile;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    this.outputFile = this.flags.outputfile || null;
    this.debugMode = this.flags.debug || false;

    // Delete standard files when necessary
    uxLog(this, c.cyan(`Generating CSV and Markdown with Permission Set Groups and their related Permission Sets`));
    /* jscpd:ignore-end */

    const psgList = [];
    const globPatternPSG = process.cwd() + `/**/*.permissionsetgroup-meta.xml`;
    const psgFiles = await glob(globPatternPSG);
    uxLog(this, c.grey(`Found ${psgFiles.length} permission set groups`));
    for (const psgFile of psgFiles) {
      const psgName = psgFile.replace(/\\/g, "/").split("/").pop().replace(".permissionsetgroup-meta.xml", "");
      const psg = await parseXmlFile(psgFile);
      const psgItem = {
        name: psgName,
        label: psg.PermissionSetGroup.label,
        description: psg.PermissionSetGroup.description,
        permissionSetsNames: psg.PermissionSetGroup.permissionSets,
      };
      psgList.push(psgItem);
    }

    // Build CSV
    const csvLines = [];
    const header = ["Permission set group", "Permission sets"];
    csvLines.push(header);
    for (const psg of psgList) {
      const psgLine = [psg.name];
      psgLine.push(`"${psg.permissionSetsNames.join(",")}"`);
      csvLines.push(psgLine);
    }

    // Build output CSV file
    if (this.outputFile == null) {
      // Default file in system temp directory if --outputfile not provided
      const reportDir = await getReportDirectory();
      this.outputFile = path.join(reportDir, "permission-set-groups.csv");
    } else {
      // Ensure directories to provided --outputfile are existing
      await fs.ensureDir(path.dirname(this.outputFile));
    }
    try {
      const csvText = csvLines.map((e) => e.join(",")).join("\n");
      await fs.writeFile(this.outputFile, csvText, "utf8");
      uxLog(this, c.cyan(`Permission set groups CSV file generated in ${c.bold(c.green(this.outputFile))}`));
      // Trigger command to open CSV file in VsCode extension
      WebSocketClient.requestOpenFile(this.outputFile);
    } catch (e) {
      uxLog(this, c.yellow("Error while generating CSV log file:\n" + (e as Error).message + "\n" + e.stack));
      this.outputFile = null;
    }

    // Build markdown file
    const mdPsg = ["# Permission set groups", "", "<!-- toc -->", "<!-- tocstop -->"];
    for (const psg of psgList) {
      mdPsg.push(...[`## ${psg.name}`, "", psg.label, "", psg.description, ""]);
      for (const psName of psg.permissionSetsNames) {
        mdPsg.push(`  - ${psName} `);
      }
      mdPsg.push("");
    }
    const docFile = "docs/permission-set-groups.md";
    await fs.ensureDir("docs");
    let mdPsgText = mdPsg.join("\n");
    mdPsgText = toc.insert(mdPsgText);
    await fs.writeFile(docFile, mdPsgText, "utf8");
    uxLog(this, c.cyan(`Permission set groups Markdown file generated in ${c.bold(c.green(docFile))}`));
    // Trigger command to open CSV file in VsCode extension
    WebSocketClient.requestOpenFile(docFile);

    // Return an object to be displayed with --json
    return { outputString: "Permission set groups Documentation generated" };
  }
}
