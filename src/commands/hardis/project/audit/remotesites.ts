/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as fs from "fs-extra";
import { glob } from "glob";
import * as psl from "psl";
import sortArray from "sort-array";
import * as url from "url";
import { catchMatches, generateReports, uxLog } from "../../../../common/utils/index.js";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class RemoteSites extends SfCommand<any> {
  public static title = "Audit Remote Sites";

  public static description = messages.getMessage("auditRemoteSites");

  public static examples = ["$ sf hardis:project:audit:remotesites"];

  // public static args = [{name: 'file'}];

  public static flags = {
    // flag with a value (-n, --name=VALUE)
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


  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  /* jscpd:ignore-end */

  protected matchResults: any[] = [];

  public async run(): Promise<AnyJson> {
    this.debug = flags.debug || false;

    const pattern = "**/*.{remoteSite-meta.xml,remoteSite}";
    const catchers = [
      {
        type: "",
        subType: "",
        regex: /<url>(.*?)<\/url>/gim,
        detail: [
          { name: "url", regex: /<url>(.*?)<\/url>/gims },
          { name: "active", regex: /<isActive>(.*?)<\/isActive>/gims },
          {
            name: "description",
            regex: /<description>(.*?)<\/description>/gimsu,
          },
        ],
      },
    ];
    const remoteSiteSettingsFiles = await glob(pattern);
    this.matchResults = [];
    uxLog(this, `Browsing ${remoteSiteSettingsFiles.length} files`);
    // Loop in files
    for (const file of remoteSiteSettingsFiles) {
      const fileText = await fs.readFile(file, "utf8");
      // Loop on criteria to find matches in this file
      for (const catcher of catchers) {
        const catcherMatchResults = await catchMatches(catcher, file, fileText, this);
        this.matchResults.push(...catcherMatchResults);
      }
    }

    // Format result
    const result: any[] = this.matchResults.map((item: any) => {
      return {
        name: item.fileName.replace(".remoteSite-meta.xml", "").replace(".remoteSite", ""),
        fileName: item.fileName,
        nameSpace: item.fileName.includes("__") ? item.fileName.split("__")[0] : "Custom",
        matches: item.matches,
        url: item.detail?.url ? item.detail.url[0] : "",
        active: item.detail?.active ? "yes" : "no",
        description: item.detail?.description ? item.detail.description[0] : "",
        protocol: item.detail.url[0].includes("https") ? "HTTPS" : "HTTP",
        domain: psl.parse(new url.URL(item.detail.url[0]).hostname).domain,
      };
    });

    // Sort array
    const resultSorted = sortArray(result, {
      by: ["protocol", "domain", "name", "active", "description"],
      order: ["asc", "asc", "asc", "desc", "asc"],
    });

    // Display as table
    const resultsLight = JSON.parse(JSON.stringify(resultSorted));
    console.table(
      resultsLight.map((item: any) => {
        delete item.fileName;
        delete item.detail;
        delete item.matches;
        return item;
      }),
    );

    // Export into csv & excel file
    const columns = [
      { key: "protocol", header: "Protocol" },
      { key: "domain", header: "Domain" },
      { key: "name", header: "Name" },
      { key: "url", header: "URL" },
      { key: "active", header: "Active" },
      { key: "description", header: "Description" },
    ];
    const reportFiles = await generateReports(resultSorted, columns, this);

    // Return an object to be displayed with --json
    return {
      outputString: "Processed callIns and callOuts audit",
      result: resultSorted,
      reportFiles,
    };
  }
}
