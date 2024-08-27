/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import c from "chalk";
import * as fs from "fs-extra";
import { glob } from "glob";
import * as path from "path";
import { uxLog } from "../../../common/utils/index.js";
import { prompts } from "../../../common/utils/prompts.js";
import { WebSocketClient } from "../../../common/websocketClient.js";
import { appendPackageXmlFilesContent } from "../../../common/utils/xmlUtils.js";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class MergePackageXml extends SfCommand<any> {
  public static title = "Merge package.xml files";

  public static description = "Select and merge package.xml files";

  public static examples = [
    "$ sf hardis:package:mergexml",
    "$ sf hardis:package:mergexml --folder packages --pattern /**/*.xml --result myMergedPackage.xml",
    '$ sf hardis:package:mergexml --packagexmls "config/mypackage1.xml,config/mypackage2.xml,config/mypackage3.xml" --result myMergedPackage.xml',
  ];

  protected static flagsConfig = {
    folder: Flags.string({
      char: "f",
      default: "manifest",
      description: "Root folder",
    }),
    packagexmls: Flags.string({
      char: "p",
      description: "Comma separated list of package.xml files to merge. Will be prompted to user if not provided",
    }),
    pattern: Flags.string({
      char: "x",
      default: "/**/*package*.xml",
      description: "Name criteria to list package.xml files",
    }),
    result: Flags.string({
      char: "r",
      description: "Result package.xml file name",
    }),
    websocket: Flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: Flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static requiresDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  protected folder: string;
  protected pattern: string;
  protected packageXmlFiles: any[] = [];
  protected resultFileName: string;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    this.folder = flags.folder || "./manifest";
    this.pattern = flags.pattern || "/**/*package*.xml";
    this.packageXmlFiles = flags.packagexmls ? flags.packagexmls.split(",") : [];
    this.resultFileName = flags.result || path.join(this.folder, "package-merge.xml");
    await fs.ensureDir(path.dirname(this.resultFileName));
    this.debugMode = flags.debug || false;
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
    await appendPackageXmlFilesContent(this.packageXmlFiles, this.resultFileName);

    // Summary
    const msg = `Merged ${c.green(c.bold(this.packageXmlFiles.length))} files into ${c.green(this.resultFileName)}`;
    uxLog(this, c.cyan(msg));

    // Trigger command to open files config file in VsCode extension
    WebSocketClient.requestOpenFile(this.resultFileName);

    // Return an object to be displayed with --json
    return { outputString: msg };
  }
}
