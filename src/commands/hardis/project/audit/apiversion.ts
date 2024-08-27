/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import { glob } from "glob";
import * as sortArray from "sort-array";
import { catchMatches, generateReports, uxLog } from "../../../../common/utils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class CallInCallOut extends SfdxCommand {
  public static title = "Audit Metadatas API Version";

  public static description = messages.getMessage("auditApiVersion");

  public static examples = ["$ sf hardis:project:audit:apiversion"];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    minimumapiversion: flags.number({
      char: "m",
      default: 20.0,
      description: messages.getMessage("minimumApiVersion"),
    }),
    failiferror: flags.boolean({
      char: "f",
      default: false,
      description: messages.getMessage("failIfError"),
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
  // protected static requiresDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  /* jscpd:ignore-end */

  protected matchResults: any[] = [];

  public async run(): Promise<AnyJson> {
    this.debug = this.flags.debug || false;
    const minimumApiVersion = this.flags.minimumapiversion || false;
    const failIfError = this.flags.failiferror || false;

    const pattern = "**/*.xml";
    const catchers = [
      {
        type: "apiVersion",
        subType: "",
        regex: /<apiVersion>(.*?)<\/apiVersion>/gims,
        detail: [{ name: "apiVersion", regex: /<apiVersion>(.*?)<\/apiVersion>/gims }],
      },
    ];
    const xmlFiles = await glob(pattern);
    this.matchResults = [];
    uxLog(this, `Browsing ${xmlFiles.length} files`);
    /* jscpd:ignore-start */
    // Loop in files
    for (const file of xmlFiles) {
      const fileText = await fs.readFile(file, "utf8");
      // Loop on criteria to find matches in this file
      for (const catcher of catchers) {
        const catcherMatchResults = await catchMatches(catcher, file, fileText, this);
        this.matchResults.push(...catcherMatchResults);
      }
    }
    /* jscpd:ignore-end */

    // Format result
    const result: any[] = this.matchResults.map((item: any) => {
      return {
        type: item.type,
        fileName: item.fileName,
        nameSpace: item.fileName.includes("__") ? item.fileName.split("__")[0] : "Custom",
        apiVersion: parseFloat(item.detail["apiVersion"]),
        valid: parseFloat(item.detail["apiVersion"]) > minimumApiVersion ? "yes" : "no",
      };
    });

    // Sort array
    const resultSorted = sortArray(result, {
      by: ["type", "subType", "fileName"],
      order: ["asc", "asc", "asc"],
    });

    // Display as table
    const resultsLight = JSON.parse(JSON.stringify(resultSorted));
    console.table(
      resultsLight.map((item: any) => {
        delete item.detail;
        return item;
      }),
    );

    // Generate output files
    const columns = [
      { key: "type", header: "IN/OUT" },
      { key: "fileName", header: "Apex" },
      { key: "nameSpace", header: "Namespace" },
      { key: "apiVersion", header: "API Version" },
      { key: "valid", header: `Valid ( > ${minimumApiVersion} )` },
    ];
    const reportFiles = await generateReports(resultSorted, columns, this);

    const numberOfInvalid = result.filter((res: any) => res.valid === "no").length;
    const numberOfValid = result.length - numberOfInvalid;

    if (numberOfInvalid > 0) {
      uxLog(
        this,
        c.yellow(
          `[sfdx-hardis] WARNING: Your sources contain ${c.bold(numberOfInvalid)} metadata files with API Version lesser than ${c.bold(
            minimumApiVersion,
          )}`,
        ),
      );
      if (failIfError) {
        throw new SfError(c.red(`[sfdx-hardis][ERROR] ${c.bold(numberOfInvalid)} metadata files with wrong API version detected`));
      }
    } else {
      uxLog(
        this,
        c.green(
          `[sfdx-hardis] SUCCESS: Your sources contain ${c.bold(numberOfValid)} metadata files with API Version superior to ${c.bold(
            minimumApiVersion,
          )}`,
        ),
      );
    }

    // Return an object to be displayed with --json
    return {
      outputString: "Processed apiVersion audit",
      result: resultSorted,
      reportFiles,
    };
  }
}
