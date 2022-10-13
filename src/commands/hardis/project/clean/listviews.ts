/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as glob from "glob-promise";
import * as path from "path";
import { uxLog } from "../../../../common/utils";
import { parseXmlFile, writeXmlFile } from "../../../../common/utils/xmlUtils";
import { getConfig, setConfig } from "../../../../config";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class CleanListViews extends SfdxCommand {
  public static title = "Replace Mine by Everything in ListViews";

  public static description = "Replace Mine by Everything in ListView, and log the replacements in sfdx-hardis.yml";

  public static examples = ["$ sfdx hardis:project:clean:listviews"];

  protected static flagsConfig = {
    folder: flags.string({
      char: "f",
      default: "force-app",
      description: "Root folder",
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

  protected folder: string;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    this.folder = this.flags.folder || "./force-app";
    this.debugMode = this.flags.debug || false;

    // Delete standard files when necessary
    uxLog(this, c.cyan(`Replacing 'Mine' by 'Everything' in ListViews for deployments to pass`));
    /* jscpd:ignore-end */
    const rootFolder = path.resolve(this.folder);
    const findManagedPattern = rootFolder + `/**/*.listView-meta.xml`;
    const matchingListViews = await glob(findManagedPattern, { cwd: process.cwd() });
    let counter = 0;
    const config = await getConfig("project");
    let listViewsMine = config.listViewsToSetToMine || [];
    for (const listViewfile of matchingListViews) {
      const listViewXml = await parseXmlFile(listViewfile);
      if (listViewXml.ListView?.filterScope[0] === "Mine") {
        listViewXml.ListView.filterScope[0] = "Everything";
        uxLog(this, c.grey(`replaced Mine by Everything in ListView ${listViewXml}`));
        await writeXmlFile(listViewfile, listViewXml);
        listViewsMine.push(path.relative(process.cwd(), listViewfile).replace(/\\/g, "/"));
        counter++;
      }
    }
    listViewsMine = [...new Set(listViewsMine)]; // Make unique
    await setConfig("project", { listViewsToSetToMine: listViewsMine });

    // Summary
    const msg = `Replaced ${c.green(c.bold(counter))} Mine by Everything in ListViews`;
    uxLog(this, c.cyan(msg));
    // Return an object to be displayed with --json
    return { outputString: msg };
  }
}
