/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Logger, LoggerLevel, Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { uxLog } from "../../../../common/utils/index.js";
import { parseXmlFile } from "../../../../common/utils/xmlUtils.js";
import { getConfig } from "../../../../config/index.js";
import { glob } from "glob";
import { basename } from "path";
import c from "chalk";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
function getCommonPermissionPatterns(rootTagName: "Profile" | "PermissionSet") {
  return [`${rootTagName}.fieldPermissions.field`, `${rootTagName}.objectPermissions.object`, `${rootTagName}.classAccesses.apexClass`];
}

export default class Find extends SfCommand<any> {
  protected static metadataDuplicateFindKeys = {
    layout: ["Layout.layoutSections.layoutColumns.layoutItems.field", "Layout.quickActionListItems.quickActionName"],
    profile: getCommonPermissionPatterns("Profile"),
    labels: ["CustomLabels.labels.fullName"],
    permissionset: getCommonPermissionPatterns("PermissionSet"),
  };

  public static title = "XML duplicate values finder";
  public static description = `find duplicate values in XML file(s).
  Find duplicate values in XML file(s). Keys to be checked can be configured in \`config/sfdx-hardis.yml\` using property metadataDuplicateFindKeys.

Default config :
metadataDuplicateFindKeys :
${Find.metadataDuplicateFindKeys}
`;

  public static examples = [
    `
<?xml version="1.0" encoding="UTF-8"?>
<Layout xmlns="http://soap.sforce.com/2006/04/metadata">
  <layoutSections>
      ...
      <layoutColumns>
          <layoutItems>
              <behavior>Required</behavior>
              <field>Name</field>
          </layoutItems>
          <layoutItems>
              <behavior>Required</behavior>
              <field>Name</field>
          </layoutItems>
      </layoutColumns>
    </layoutSections>
</Layout>
`,
    `
$ sf hardis:project:metadata:findduplicates --file layout.layout-meta.xml
[sfdx-hardis] Duplicate values in layout.layout-meta.xml
  - Key    : Layout.layoutSections.layoutColumns.layoutItems.field
  - Values : Name
`,
    `
$ sf hardis:project.metadata:findduplicates -f "force-app/main/default/**/*.xml"
[sfdx-hardis] hardis:project:metadata:findduplicates execution time 0:00:00.397
[sfdx-hardis] Duplicate values in layout1.layout-meta.xml
  - Key    : Layout.layoutSections.layoutColumns.layoutItems.field
  - Values : CreatedById

[sfdx-hardis] Duplicate values in layout2.layout-meta.xml
  - Key    : Layout.layoutSections.layoutColumns.layoutItems.field
  - Values : LastModifiedById, Name
`,
  ];

  protected configInfo: any;
  protected logLevel: LoggerLevel;

  public static flags = {
    files: flags.array({
      char: "f",
      description: "XML metadata files path",
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

  public async run(): Promise<AnyJson> {
    uxLog(this, c.cyan(`Start finding duplicate values in XML metadata files.`));
    await this.initConfig();
    const filesWithDuplicates = await this.findDuplicates();
    uxLog(this, c.cyan(`Done finding duplicate values in XML metadata files.`));
    if (filesWithDuplicates.length > 0) {
      process.exitCode = 1;
    }
    return filesWithDuplicates;
  }

  async initConfig() {
    this.configInfo = await getConfig("user");
    if (this.configInfo.metadataDuplicateFindKeys) {
      Find.metadataDuplicateFindKeys = this.configInfo.metadataDuplicateFindKeys;
    }
    // Gets the root SF CLI logger level
    this.logLevel = (await Logger.root()).getLevel();
  }

  async findDuplicates() {
    // Collect input parameters
    const inputFiles: any[] = [];

    if (flags.files) {
      const files = await glob("./" + flags.files, { cwd: process.cwd() });
      inputFiles.push(...files);
    }

    const foundFilesWithDuplicates: any[] = [];
    for (const inputFile of inputFiles) {
      // Extract given metadata type based on filename using type-meta.xml
      // For example PersonAccount.layout-meta.xml returns layout and Admin.profile-meta.xml returns profile
      const filenameRegex = /\w*\.(\w*)-meta.xml/;
      const type = inputFile.match(filenameRegex)[1];

      // Check if given metadata type has unicity rules
      const uniqueKeys = Find.metadataDuplicateFindKeys[type];
      if (!uniqueKeys) {
        if (this.logLevel === LoggerLevel.DEBUG) {
          uxLog(this, c.gray(`No unicity rule found for metadata type ${type} (processing ${inputFile})`));
        }
        continue;
      }

      // Read metadata file
      const file = await parseXmlFile(inputFile);
      uniqueKeys.forEach((key) => {
        // Traverse the file down to the key based on the fragments separated by . (dots), abort if not found
        const allProps = key.split(".");
        const valuesFound = this.traverseDown(file, allProps[0], allProps, []);

        // https://stackoverflow.com/a/840808
        const duplicates = valuesFound.filter((e, i, a) => a.indexOf(e) !== i);
        if (duplicates.length) {
          foundFilesWithDuplicates.push({
            file: inputFile,
            key,
            duplicates,
          });
          uxLog(
            this,
            c.red(`Duplicate values in ${basename(inputFile)}
  - Key    : ${key}
  - Values : ${duplicates.join(", ")}
`),
          );
        }
      });
    }
    return foundFilesWithDuplicates;
  }

  /**
   *  Traverse down a XML tree, allProps containing all the properties to be traversed, currentProp being updated as we
   * descend.
   */
  traverseDown(parent: Record<string, unknown> | Array<any>, currentProp: string, allProps: Array<string>, results: Array<string>) {
    const nextProp = allProps[allProps.indexOf(currentProp) + 1];

    // If we're at the end of property path (A.B.C -> parent = A.B, currentProp = C, nextProp = undefined) we add the
    // value contained in A.B.C
    if (nextProp === undefined) {
      results.push(parent[currentProp][0]);
    }
    // If A.B is an array, we'll traverse A.B.C1, A.B.C2, etc...
    if (Array.isArray(parent[currentProp])) {
      parent[currentProp].forEach((childProp) => {
        this.traverseDown(childProp, nextProp, allProps, results);
      });
    }
    // If A.B is an object, we simply set it as the new "parent"
    else if (parent[currentProp]) {
      this.traverseDown(parent[currentProp], nextProp, allProps, results);
    }
    return results;
  }
}
