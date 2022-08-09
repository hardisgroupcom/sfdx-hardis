/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { uxLog } from "../../../../common/utils";
import { parseXmlFile } from "../../../../common/utils/xmlUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.

export default class Find extends SfdxCommand {
  public static title = "XML duplicate values finder";

  public static description = "Finds duplicate values in XML file(s)";

  public static examples = ["$ sfdx hardis:manifest:duplicate:find --file 'path/to/metadata.xml' "];

  protected static flagsConfig = {
    file: flags.string({
      char: "f",
      description: "XML metadata file path",
    })
  };

  // Comment this out if your command does not require an org username
  //protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  // protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  //protected static requiresProject = true;

  protected static uniqueKeys = {
    layout: ["Layout.layoutSections.layoutColumns.layoutItems.field", "Layout.quickActionListItems.quickActionName"],
    profile: ["Profile.fieldPermissions.field"],
  };

  public async run(): Promise<AnyJson> {
    this.findDuplicates();
    return;
  }

  async findDuplicates() {
    // Collect input parameters
    const inputFile = this.flags.file;

    // Extract given metadata type based on filename using type-meta.xml
    // For example PersonAccount.layout-meta.xml returns layout and Admin.profile-meta.xml returns profile
    const filenameRegex = /\w*\.(\w*)-meta.xml/;
    const type = inputFile.match(filenameRegex)[1];

    // Check if given metadata type has unicity rules
    const uniqueKeys = Find.uniqueKeys[type];
    if (!uniqueKeys) {
      uxLog(this, `No unicity rule found for metadata type ${type}`);
      return;
    }

    // Read manifest file
    const file = await parseXmlFile(inputFile);
    uniqueKeys.forEach((key) => {
      // Traverse the file down to the key based on the fragments separated by . (dots), abort if not found
      const allProps = key.split(".");
      const valuesFound = this.traverseDown(file, allProps[0], allProps, []);

      // https://stackoverflow.com/a/840808
      const duplicates = valuesFound.filter((e, i, a) => a.indexOf(e) !== i);
      if (duplicates.length) {
        uxLog(this, `Duplicate value found for key ${key} : ${duplicates}`);
      }
    });
  }

  /**
   *  Traverse down a XML tree, allProps containing all the properties to be traversed, currentProp being updated as we
   * descend. 
   */
  traverseDown(parent: Object | Array<any>, currentProp: string, allProps: Array<string>, results: Array<string>) {
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
