/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from 'fs-extra';
import * as glob from "glob-promise";
import * as path from "path";
import * as Papa from "papaparse";
import * as sortArray from "sort-array";
import { getCurrentGitBranch, isCI, uxLog } from "../../../common/utils";
//import * as fs from "fs-extra";
import { parseXmlFile, writeXmlFile } from "../../../common/utils/xmlUtils";
import { getConfig, getReportDirectory } from "../../../config";
import { NotifProvider } from "../../../common/notifProvider";
import { GitProvider } from "../../../common/gitProvider";
import { WebSocketClient } from "../../../common/websocketClient";
import { prompts } from "../../../common/utils/prompts";
// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class Access extends SfdxCommand {
  public static title = "check permission access";

  public static description = "Check if elements(apex class and field) are at least in one permission set";

  public static examples = [
    "$ sfdx hardis:lint:access",
    '$ sfdx hardis:lint:access -e "ApexClass:ClassA, CustomField:Account.CustomField"',
    '$ sfdx hardis:lint:access -i "PermissionSet:permissionSetA, Profile"',
  ];

  protected static flagsConfig = {
    elementsignored: flags.string({
      char: "e",
      default: "",
      description: "Ignore specific elements separated by commas",
    }),
    ignorerights: flags.string({
      char: "i",
      default: "",
      description: "Ignore permission sets or profiles",
    }),
    folder: flags.string({
      char: "f",
      default: "force-app",
      description: "Root folder",
    }),
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
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  protected folder: string;
  protected missingElements: any[] = [];
  protected missingElementsMap: any = {};
  protected outputFile;

  protected static sourceElements = [
    {
      regex: `/**/*.cls`,
      type: "ApexClass",
      xmlField: "apexClass",
      xmlChildren: "classAccesses",
      xmlAccessField: "enabled",
      ignore: {
        all: false,
        elements: [],
      },
    },
    {
      regex: `/**/objects/**/fields/*__c.field-meta.xml`,
      type: "CustomField",
      xmlField: "field",
      xmlChildren: "fieldPermissions",
      xmlAccessField: "readable",
      ignore: {
        all: false,
        elements: [],
      },
    },
  ];

  private permissionSet = {
    regex: `/**/permissionsets/*.permissionset-meta.xml`,
    type: "Permission sets",
    name: "PermissionSet",
    isIgnoredAll: false,
    elementsIgnored: [],
  };

  private profiles = {
    regex: `/**/profiles/*.profile-meta.xml`,
    type: "Profiles",
    name: "Profile",
    isIgnoredAll: false,
    elementsIgnored: [],
  };

  private static messages = {
    header: "Check if elements(apex class and field) are at least in one permission set",
    allElementsHaveRights: "All elements are included in at least one Permission set or Profile",
    someElementsDontHaveRights: "Some elements are not included in at least one Permission set or Profile",
  };

  private hasElementsWithNoRights = false;

  private hasToDisplayJsonOnly = false;

  public async run(): Promise<AnyJson> {
    const config = await getConfig("user");
    this.folder = this.flags.folder || "./force-app";
    this.hasToDisplayJsonOnly = process.argv.includes("--json");

    this.ignoreSourceElementsIfDefined();
    this.ignoreRightElementsIfDefined(config);

    uxLog(this, c.green(Access.messages.header));
    /* jscpd:ignore-end */
    const rootFolder = path.resolve(this.folder);

    const elementsToCheckByType = { apexClass: [], field: [] };

    /* ELEMENTS TO CHECK */
    for (const sourceElement of Access.sourceElements) {
      //if the type(apex class, field) is ignored we pass to the next type
      if (sourceElement.ignore.all) {
        continue;
      }

      const findManagedPattern = rootFolder + sourceElement["regex"];
      const matchedElements = await glob(findManagedPattern, { cwd: process.cwd() });

      switch (sourceElement.type) {
        case "CustomField":
          elementsToCheckByType.field = await this.retrieveElementToCheck(matchedElements, sourceElement.xmlField, sourceElement.ignore.elements);
          break;

        case "ApexClass":
          elementsToCheckByType.apexClass = await this.retrieveElementToCheck(matchedElements, sourceElement.xmlField, sourceElement.ignore.elements);
          break;

        default:
          break;
      }
    }

    const remainingElements = await this.listElementIfNotInProfileOrPermission(rootFolder, elementsToCheckByType);
    // Write report
    await this.writeOutputFile();
    // Send notification
    await this.manageNotification();
    // Prompt user if he/she wants to update a Permission set with missing elements
    await this.handleFixIssues();
    // Handle output status & exitCode
    const statusCode = this.hasElementsWithNoRights ? 1 : 0;
    if ((this.argv || []).includes("audittrail")) {
      process.exitCode = statusCode;
    }
    return { statusCode: statusCode, outputString: remainingElements };
  }

  private ignoreSourceElementsIfDefined() {
    const ignoreElements = this.flags.elementsignored;

    for (const ignoredElement of ignoreElements.split(",")) {
      const elementTrimmed = ignoredElement.trim();

      //check if all elements of a type are ignored
      if (elementTrimmed === "ApexClass") {
        Access.sourceElements[0].ignore.all = true;
      } else if (elementTrimmed === "CustomField") {
        Access.sourceElements[1].ignore.all = true;
      }
      //check individual elements (ex : ApexClass:ClassB)
      else if (elementTrimmed.startsWith("ApexClass")) {
        Access.sourceElements[0].ignore.elements.push(elementTrimmed.substring(elementTrimmed.indexOf(":") + 1).trim());
      } else if (elementTrimmed.startsWith("CustomField")) {
        Access.sourceElements[1].ignore.elements.push(elementTrimmed.substring(elementTrimmed.indexOf(":") + 1).trim());
      }
    }
  }

  private ignoreRightElementsIfDefined(projectConfig) {
    const ignoreElements = this.flags.ignorerights ? this.flags.ignorerights : projectConfig.linterIgnoreRightMetadataFile;
    if (!ignoreElements) {
      return;
    }

    for (const ignoredElement of ignoreElements.split(",")) {
      const elementTrimmed = ignoredElement.trim();

      if (elementTrimmed === this.profiles.name) {
        this.profiles.isIgnoredAll = true;
      } else if (elementTrimmed.startsWith(this.profiles.name)) {
        this.profiles.elementsIgnored.push(elementTrimmed.substring(elementTrimmed.indexOf(":") + 1).trim());
      }
      if (elementTrimmed === this.permissionSet.name) {
        this.permissionSet.isIgnoredAll = true;
      } else if (elementTrimmed.startsWith(this.permissionSet.name)) {
        this.permissionSet.elementsIgnored.push(elementTrimmed.substring(elementTrimmed.indexOf(":") + 1).trim());
      }
    }
  }

  private formatElementNameFromPath(path, type): string {
    if (type === "field") {
      const fieldRoute = path.substring(path.indexOf("objects/"));
      const objectField = fieldRoute
        .substring(fieldRoute.indexOf("/") + 1)
        .replace("/fields/", ".")
        .replace(".field-meta.xml", "");
      return objectField;
    } else if (type === "apexClass") {
      return path.substring(path.indexOf("classes/")).replace("classes/", "").replace(".cls", "").split("/").pop();
    }

    return "";
  }

  private async retrieveElementToCheck(elements, xmlField, excludedElements): Promise<Array<string>> {
    let fieldsToSearch = [];

    for (const element of elements) {
      // Exclude mandatory fields
      if (element.endsWith(".field-meta.xml")) {
        const fieldXml = await parseXmlFile(element);
        // Mater detail
        if (fieldXml?.CustomField?.type && fieldXml?.CustomField?.type[0] === "MasterDetail") {
          continue;
        }
        // Required
        if (fieldXml?.CustomField?.required && fieldXml?.CustomField?.required[0] === "true") {
          continue;
        }
      }

      const el = this.formatElementNameFromPath(element, xmlField);
      //only check elements not ignored
      if (!excludedElements.includes(el)) {
        fieldsToSearch.push(el);

        const otherElementsToCheck = this.ruleBasedCheckForFields(el);
        if (otherElementsToCheck.length > 0) {
          fieldsToSearch = fieldsToSearch.concat(otherElementsToCheck);
        }
      }
    }

    return fieldsToSearch;
  }

  private ruleBasedCheckForFields(el: string): Array<string> {
    const otherElementsToCheck = [];

    // Activity is the parent object of Task and Event: check also rights to avoid false positives
    if (el.startsWith("Activity.")) {
      const field = el.split(".")[1];
      otherElementsToCheck.push("Task." + field);
      otherElementsToCheck.push("Event." + field);
    }

    return otherElementsToCheck;
  }

  private async listElementIfNotInProfileOrPermission(rootFolder, elementsToCheckByType) {
    const profilesFiles = await glob(rootFolder + this.profiles["regex"], { cwd: process.cwd() });
    let remainingElements = elementsToCheckByType;

    //CHECK PROFILES FIRST
    if (!this.profiles.isIgnoredAll) {
      remainingElements = await this.retrieveElementsWithoutRights(this.profiles.name, profilesFiles, elementsToCheckByType);
    }
    if (this.hasRemainingElementsToCheck(remainingElements) && !this.permissionSet.isIgnoredAll) {
      const permissionSetFiles = await glob(rootFolder + this.permissionSet["regex"], { cwd: process.cwd() });
      remainingElements = await this.retrieveElementsWithoutRights(this.permissionSet.name, permissionSetFiles, remainingElements);
    }

    if (!this.hasRemainingElementsToCheck(remainingElements)) {
      uxLog(this, c.green(Access.messages.allElementsHaveRights));
      return Access.messages.allElementsHaveRights;
    } else {
      //list remaining elements after checking on profiles and permissions sets
      this.missingElementsMap = Object.assign({}, remainingElements);
      this.missingElements = [];
      for (const missingType of Object.keys(this.missingElementsMap)) {
        for (const missingItem of this.missingElementsMap[missingType]) {
          this.missingElements.push({ type: missingType, element: missingItem });
        }
      }
      remainingElements = this.constructLogAndDisplayTable(remainingElements);
    }

    return this.hasToDisplayJsonOnly ? remainingElements : "";
  }

  private formatPathPermissionSetOrProfile(typeFile, path) {
    if (typeFile == this.profiles.name) {
      return path.substring(path.indexOf("profiles/")).replace("profiles/", "").replace(".profile-meta.xml", "");
    } else if (typeFile == this.permissionSet.name) {
      return path.substring(path.indexOf("permissionsets/")).replace("permissionsets/", "").replace(".permissionset-meta.xml", "");
    }
    return "";
  }

  private async retrieveElementsWithoutRights(typeFile, files, elementsToCheckByType) {
    const remainingElements = elementsToCheckByType;

    if (typeFile == this.profiles.name) {
      files = files.filter((e) => !this.profiles.elementsIgnored.includes(this.formatPathPermissionSetOrProfile(typeFile, e)));
    } else if (typeFile === this.permissionSet.name) {
      files = files.filter((e) => !this.permissionSet.elementsIgnored.includes(this.formatPathPermissionSetOrProfile(typeFile, e)));
    }

    for (const file of files) {
      const fileXml = await parseXmlFile(file);

      //checking all elements in the current type
      for (const currentType of Access.sourceElements) {
        //checking if current type is at least once in the current profile or permission set
        if (!(currentType.xmlChildren in fileXml[typeFile]) || fileXml[typeFile][currentType.xmlChildren].length == 0) {
          continue;
        }

        for (const permission of fileXml[typeFile][currentType.xmlChildren]) {
          //only readable(for fields) or enabled(apex class) rights are relevant
          if (
            permission &&
            permission[currentType.xmlAccessField][0] == "true" &&
            elementsToCheckByType[currentType.xmlField].includes(permission[currentType.xmlField][0])
          ) {
            remainingElements[currentType.xmlField] = remainingElements[currentType.xmlField].filter(
              (e) => e !== permission[currentType.xmlField][0],
            );
          }
        }
      }
      //if no remaining elements to check then we stop iterating permissionset or profile files
      if (!this.hasRemainingElementsToCheck(remainingElements)) {
        break;
      }
    }

    return remainingElements;
  }

  private hasRemainingElementsToCheck(remainingElements): boolean {
    return Object.keys(remainingElements).some((elementType) => remainingElements[elementType].length > 0);
  }

  private constructLogAndDisplayTable(remainingElements) {
    const remainingElementsTable = [];
    let counterTable = 0;

    for (const currentType of Access.sourceElements) {
      for (const e of remainingElements[currentType.xmlField]) {
        if (!remainingElementsTable[counterTable]) {
          remainingElementsTable[counterTable] = {};
        }

        remainingElementsTable[counterTable]["Type"] = currentType.type;
        remainingElementsTable[counterTable]["Element"] = e;
        counterTable++;
        this.hasElementsWithNoRights = true;
      }
    }

    //we create an object to have a custom header in the table
    if (!this.hasToDisplayJsonOnly) {
      uxLog(this, c.red(Access.messages.someElementsDontHaveRights));
      console.table(remainingElementsTable);
    }

    return remainingElements;
  }

  private async writeOutputFile() {
    if (this.missingElements.length === 0) {
      return;
    }
    // Build output CSV file name
    if (this.outputFile == null) {
      // Default file in system temp directory if --outputfile not provided
      const reportDir = await getReportDirectory();
      const branchName = process.env.CI_COMMIT_REF_NAME || (await getCurrentGitBranch({ formatted: true })) || "Missing CI_COMMIT_REF_NAME variable";
      this.outputFile = path.join(reportDir, "lint-access-" + branchName.split("/").pop() + ".csv");
    } else {
      // Ensure directories to provided --outputfile are existing
      await fs.ensureDir(path.dirname(this.outputFile));
    }

    // Generate output CSV file
    try {
      const csvText = Papa.unparse(this.missingElements);
      await fs.writeFile(this.outputFile, csvText, "utf8");
      uxLog(this, c.italic(c.cyan(`Please see detailed log in ${c.bold(this.outputFile)}`)));
      // Trigger command to open CSV file in VsCode extension
      WebSocketClient.requestOpenFile(this.outputFile);
    } catch (e) {
      uxLog(this, c.yellow("Error while generating CSV log file:\n" + e.message + "\n" + e.stack));
      this.outputFile = null;
    }
  }

  private async manageNotification() {
    // Manage notifications
    if (this.missingElements.length > 0) {
      let notifDetailText = ``;
      for (const missingType of Object.keys(this.missingElementsMap)) {
        notifDetailText += `* ${missingType}\n`
        for (const missingItem of this.missingElementsMap[missingType]) {
          notifDetailText += `  * ${missingItem}\n`
        }
      }
      notifDetailText += "_See details in job artifacts_";
      const branchName = process.env.CI_COMMIT_REF_NAME || (await getCurrentGitBranch({ formatted: true })) || "Missing CI_COMMIT_REF_NAME variable";
      const notifButtons = [];
      const jobUrl = await GitProvider.getJobUrl();
      if (jobUrl) {
        notifButtons.push({ text: "View Job", url: jobUrl });
      }
      NotifProvider.postNotifications({
        text: `${this.missingElements.length} custom elements have no access defined in any Profile or Permission set in ${branchName}`,
        attachments: [{ text: notifDetailText }],
        buttons: notifButtons,
        severity: "warning",
      });
    }
  }

  private async handleFixIssues() {
    if (!isCI && this.missingElements.length > 0 && this.argv.includes("--websocket")) {
      const promptUpdate = await prompts({
        type: "confirm",
        message: c.cyanBright("Do you want to add the missing accesses in permission sets ?"),
      });
      if (promptUpdate.value === true) {
        const availablePermissionSets = await this.listLocalPermissionSets();
        const promptsElementsPs = await prompts([
          {
            type: "multiselect",
            name: "elements",
            message: "Please select the elements you want to add in Permission Set(s)",
            choices: this.missingElements.map(elt => { return { title: `${elt.type}: ${elt.element}`, value: elt } })
          },
          {
            type: "multiselect",
            name: "permissionSets",
            message: "Please select the permission sets you want to update with selected elements",
            choices: availablePermissionSets.map(elt => { return { title: elt.name, value: elt.filePath } })
          },
          {
            type: "select",
            name: "access",
            message: "Please select the accesses to set for the custom fields",
            choices: [
              { title: "Readable", value: "readable" },
              { title: "Readable & Editable", value: "editable" }
            ]
          },
        ]);
        // Update Permission sets
        if (promptsElementsPs.elements.length > 0 && promptsElementsPs.permissionSets.length > 0) {
          await this.updatePermissionSets(
            promptsElementsPs.permissionSets,
            promptsElementsPs.elements,
            promptsElementsPs.access === "editable" ? { readable: true, editable: true } : { readable: true, editable: false });
        }
      }
    }
    else if (this.missingElements.length > 0) {
      uxLog(this, c.yellow("Please add missing access on permission set(s)"));
      uxLog(this, c.yellow("You can do it by running VsCode SFDX Hardis command Audit -> Detect missing permissions"));
    }
  }

  private async listLocalPermissionSets() {
    const globPatternPS = process.cwd() + `/**/*.permissionset-meta.xml`;
    const psFiles = await glob(globPatternPS);
    const psList = [];
    for (const ps of psFiles) {
      psList.push({ name: path.basename(ps).replace('.permissionset-meta.xml', ''), filePath: ps });
    }
    return psList;
  }

  private async updatePermissionSets(permissionSetFiles, elements, fieldProperties) {
    for (const permissionSetFile of permissionSetFiles) {
      const psFileXml = await parseXmlFile(permissionSetFile);
      for (const element of elements) {
        // Apex class access
        if (element.type === 'apexClass') {
          const className = element.element.split("/").pop();
          let classAccesses = psFileXml.PermissionSet?.classAccesses || [];
          let updated = false;
          classAccesses = classAccesses.map(item => {
            if (item.apexClass[0] === className) {
              item.enabled = [true];
              updated = true;
            }
            return item;
          });
          if (updated === false) {
            classAccesses.push({
              apexClass: [className],
              enabled: [true],
            })
          }
          psFileXml.PermissionSet.classAccesses = sortArray(classAccesses, {
            by: ["apexClass"],
            order: ["asc"],
          });
        }
        // Custom field permission
        else if (element.type === 'field') {
          let fieldPermissions = psFileXml.PermissionSet?.fieldPermissions || [];
          let updated = false;
          fieldPermissions = fieldPermissions.map(item => {
            if (item.field[0] === element.element) {
              item.readable = [fieldProperties.readable];
              item.editable = [fieldProperties.editable];
              updated = true;
            }
            return item;
          });
          if (updated === false) {
            fieldPermissions.push({
              field: [element.element],
              readable: [fieldProperties.readable],
              editable: [fieldProperties.editable]
            })
          }
          psFileXml.PermissionSet.fieldPermissions = sortArray(fieldPermissions, {
            by: ["field"],
            order: ["asc"],
          });
        }
      }
      await writeXmlFile(permissionSetFile, psFileXml);
    }
    throw new SfdxError(c.red("Your permission sets has been updated: please CHECK THE UPDATES then commit and push !"));
  }
}

