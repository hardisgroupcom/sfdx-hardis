/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as child from "child_process";
import * as fs from "fs-extra";
import * as path from "path";
import * as util from "util";
const exec = util.promisify(child.exec);

import { MetadataUtils } from "../../../../../common/metadata-utils";
import { uxLog } from "../../../../../common/utils";
import { WebSocketClient } from "../../../../../common/websocketClient";
import { setConfig } from "../../../../../config";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class DxSources extends SfdxCommand {
  public static title = "Retrieve sfdx sources from org";

  public static description = messages.getMessage("retrieveDx");

  public static examples = ["$ sf hardis:org:retrieve:sources:dx"];

  protected static flagsConfig = {
    folder: flags.string({
      char: "f",
      default: ".",
      description: messages.getMessage("folder"),
    }),
    tempfolder: flags.string({
      char: "t",
      default: "./tmp",
      description: messages.getMessage("tempFolder"),
    }),
    keepmetadatatypes: flags.string({
      char: "k",
      description: "Comma separated list of metadatas types that will be the only ones to be retrieved",
    }),
    filteredmetadatas: flags.string({
      char: "m",
      description: messages.getMessage("filteredMetadatas"),
    }),
    shape: flags.boolean({
      char: "o",
      default: false,
      description: messages.getMessage("createOrgShape"),
    }),
    instanceurl: flags.string({
      char: "r",
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
    const folder = path.resolve(this.flags.folder || ".");
    const tempFolder = path.resolve(this.flags.tempfolder || "./tmp");
    const keepMetadataTypes = this.flags.keepmetadatatypes ? this.flags.keepmetadatatypes.split(",") : [];
    const filteredMetadatas = this.flags.filteredmetadatas ? this.flags.filteredmetadatas.split(",") : MetadataUtils.listMetadatasNotManagedBySfdx();
    const shapeFlag = this.flags.shape || false;
    const debug = this.flags.debug || false;

    // Create working temp folders and define it as cwd
    const prevCwd = process.cwd();
    await fs.ensureDir(tempFolder);
    await fs.emptyDir(tempFolder);
    process.chdir(tempFolder);
    const metadataFolder = path.join(tempFolder, "mdapipkg");
    await fs.ensureDir(metadataFolder);
    await fs.emptyDir(metadataFolder);
    const sfdxFolder = path.join(tempFolder, "sfdx-project");
    await fs.ensureDir(sfdxFolder);
    await fs.emptyDir(sfdxFolder);

    // Retrieve metadatas
    const retrieveOptions: any = { filterManagedItems: true, removeStandard: false };
    if (keepMetadataTypes) {
      retrieveOptions.keepMetadataTypes = keepMetadataTypes;
    }
    const packageXml = path.resolve(path.join(tempFolder, "package.xml"));
    await MetadataUtils.retrieveMetadatas(packageXml, metadataFolder, true, filteredMetadatas, retrieveOptions, this, debug);

    // Create sfdx project
    if (fs.readdirSync(sfdxFolder).length === 0) {
      uxLog(this, c.cyan("Creating SFDX project..."));
      const projectCreateCommand = 'sf project generate --name "sfdx-project"';
      uxLog(this, `[command] ${c.bold(c.grey(projectCreateCommand))}`);
      const createProjectRes = await exec(projectCreateCommand, { maxBuffer: 1024 * 2000 });
      if (debug) {
        uxLog(this, createProjectRes.stdout + createProjectRes.stderr);
      }
    }

    // Converting metadatas to sfdx
    uxLog(this, c.cyan(`Converting metadatas into SFDX sources in ${c.green(sfdxFolder)}...`));
    process.chdir(sfdxFolder);
    const mdapiConvertCommand = `sf project convert mdapi --root-dir ${path.join(metadataFolder, "unpackaged")} ${debug ? "--verbose" : ""}`;
    uxLog(this, `[command] ${c.bold(c.grey(mdapiConvertCommand))}`);
    try {
      const convertRes = await exec(mdapiConvertCommand, {
        maxBuffer: 10000 * 10000,
      });
      if (debug) {
        uxLog(this, convertRes.stdout + convertRes.stderr);
      }
    } catch (e) {
      throw new SfError(JSON.stringify(e, null, 2));
    }

    // Move sfdx sources in main folder
    uxLog(this, `[sfdx-hardis] Moving temp files to main folder ${c.green(path.resolve(folder))}...`);
    process.chdir(prevCwd);
    // Do not replace files if already defined
    const filesToNotReplace = [".gitignore", ".forceignore", "sfdx-project.json", "README.md"];
    for (const fileToNotReplace of filesToNotReplace) {
      if (fs.existsSync(path.join(path.resolve(folder), fileToNotReplace)) && fs.existsSync(path.join(sfdxFolder, fileToNotReplace))) {
        await fs.remove(path.join(sfdxFolder, fileToNotReplace));
      }
    }
    // Copy files
    await fs.copy(sfdxFolder, path.resolve(folder));

    // Manage org shape if requested
    if (shapeFlag === true) {
      // Copy package.xml
      const packageXmlInConfig = path.resolve(folder) + "/manifest/package.xml"; // '/config/package.xml';
      if (!fs.existsSync(packageXmlInConfig)) {
        await fs.ensureDir(path.dirname(packageXmlInConfig));
        uxLog(this, `[sfdx-hardis] Copying package.xml manifest ${c.green(packageXmlInConfig)}...`);
        await fs.copy(packageXml, packageXmlInConfig);
      }
      // Store list of installed packages
      const installedPackages = await MetadataUtils.listInstalledPackages(null, this);
      await setConfig("project", {
        installedPackages,
      });
    }

    // Remove temporary files
    uxLog(this, `Remove temporary folder ${tempFolder} ...`);
    try {
      await fs.rm(tempFolder, { recursive: true });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      uxLog(this, c.yellow(`Unable to remove folder ${tempFolder}, please delete it manually`));
    }

    // Trigger commands refresh on VsCode WebSocket Client
    WebSocketClient.sendMessage({ event: "refreshCommands" });

    // Set bac initial cwd
    const message = `[sfdx-hardis] Successfully retrieved sfdx project in ${folder}`;
    uxLog(this, c.green(message));
    return { orgId: this.org.getOrgId(), outputString: message };
  }
}
