/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as glob from "glob-promise";
import * as path from "path";
import { execCommand, uxLog } from "../../../common/utils";
import { prompts } from "../../../common/utils/prompts";
import { WebSocketClient } from "../../../common/websocketClient";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class MergePackageXml extends SfdxCommand {
  public static title = "Merge package.xml files";

  public static description = "Select and merge package.xml files";

  public static examples = [
    "$ sfdx hardis:package:mergexml",
    "$ sfdx hardis:package:mergexml --folder packages --pattern /**/*.xml --result myMergedPackage.xml",
    '$ sfdx hardis:package:mergexml --packagexmls "config/mypackage1.xml,config/mypackage2.xml,config/mypackage3.xml" --result myMergedPackage.xml',
  ];

  protected static flagsConfig = {
    folder: flags.string({
      char: "f",
      default: "manifest",
      description: "Root folder",
    }),
    packagexmls: flags.string({
      char: "p",
      description: "Comma separated list of package.xml files to merge. Will be prompted to user if not provided",
    }),
    pattern: flags.string({
      char: "x",
      default: "/**/*package*.xml",
      description: "Name criteria to list package.xml files",
    }),
    result: flags.string({
      char: "r",
      description: "Result package.xml file name",
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
  protected static requiresProject = false;

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ["sfdx-essentials"];

  protected folder: string;
  protected pattern: string;
  protected packageXmlFiles = [];
  protected resultFileName: string;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    this.folder = this.flags.folder || "./manifest";
    this.pattern = this.flags.pattern || "/**/*package*.xml";
    this.packageXmlFiles = this.flags.packagexmls ? this.flags.packagexmls.split(",") : [];
    this.resultFileName = this.flags.result || path.join(this.folder, "package-merge.xml");
    await fs.ensureDir(path.dirname(this.resultFileName));
    this.debugMode = this.flags.debug || false;
    /* jscpd:ignore-end */

    // If packagexmls are not provided, prompt user
    if (this.packageXmlFiles.length === 0) {
      const rootFolder = path.resolve(this.folder);
      const findPackageXmlPattern = rootFolder + this.pattern;
      const matchingFiles = await glob(findPackageXmlPattern, { cwd: process.cwd() });
      const filesSelectRes = await prompts({
        type: "multiselect",
        name: "files",
        message: "Please select the package.xml files you want to merge",
        choices: matchingFiles.map((file) => {
          const relativeFile = path.relative(process.cwd(), file);
          return { title: relativeFile, value: relativeFile };
        }),
      });
      this.packageXmlFiles = filesSelectRes.files;
    }

    // Process merge of package.xml files
    const appendPackageXmlCommand =
      "sfdx essentials:packagexml:append" + ` --packagexmls "${this.packageXmlFiles.join(",")}"` + ` --outputfile "${this.resultFileName}"`;
    await execCommand(appendPackageXmlCommand, this, {
      fail: true,
      debug: this.debugMode,
    });

    // Summary
    const msg = `Merged ${c.green(c.bold(this.packageXmlFiles.length))} files into ${c.green(this.resultFileName)}`;
    uxLog(this, c.cyan(msg));

    // Trigger command to open files config file in VsCode extension
    WebSocketClient.requestOpenFile(this.resultFileName);

    // Return an object to be displayed with --json
    return { outputString: msg };
  }
}
