/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as glob from "glob-promise";
import * as path from "path";
import { createTempDir, execCommand, mergeObjectPropertyLists, uxLog } from "../../../../common/utils";
import { promptOrg } from "../../../../common/utils/orgUtils";
import { parsePackageXmlFile, parseXmlFile, writeXmlFile } from "../../../../common/utils/xmlUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class OrgMissingItems extends SfdxCommand {
  public static title = "Clean SFDX items using target org definition";

  public static description = "Clean SFDX sources from items present neither in target org nor local package.xml";

  public static examples = ["$ sfdx hardis:project:clean:orgmissingitems"];

  protected static flagsConfig = {
    folder: flags.string({
      char: "f",
      default: "force-app",
      description: "Root folder",
    }),
    packagexmlfull: flags.string({
      char: "p",
      description:
        "Path to packagexml used for cleaning.\nMust contain also standard CustomObject and CustomField elements.\nIf not provided, it will be generated from a remote org",
    }),
    packagexmltargetorg: flags.string({
      char: "t",
      description: "Target org username or alias to build package.xml (sfdx must be authenticated).\nIf not provided, will be prompted to the user.",
    }),
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: flags.string({
      description: messages.getMessage("websocket"),
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;
  /* jscpd:ignore-end */
  protected folder: string;
  protected targetOrgUsernameAlias: string;
  protected packageXmlFull: string;
  protected debugMode = false;

  protected standardFields = [
    "Id",
    "Name",
    "Parent",
    "IsActive",
    "Alias",
    "Owner",
    "CreatedBy",
    "CreatedDate",
    "LastActivityDate",
    "LastModifiedBy",
    "LastModifiedDate",
    "RecordType",
  ];

  protected standardSuffixes = ["Street", "City", "State", "PostalCode", "Country", "Latitude", "Longitude", "GeocodeAccuracy"];

  public async run(): Promise<AnyJson> {
    this.folder = this.flags.folder || "./force-app";
    this.debugMode = this.flags.debug || false;
    this.targetOrgUsernameAlias = this.flags.packagexmltargetorg || null;
    this.packageXmlFull = this.flags.packagexmlfull || null;

    if (this.packageXmlFull === null) {
      // Request user to select an org if not provided
      if (this.targetOrgUsernameAlias == null) {
        const targetOrg = await promptOrg(this, { devHub: false, setDefault: false });
        this.targetOrgUsernameAlias = targetOrg.username;
      }

      const tmpDir = await createTempDir();
      // Build target org package.xml and parse it
      uxLog(this, c.cyan(`Generating full package.xml from target org...`));
      const targetOrgPackageXml = path.join(tmpDir, "packageTargetOrg.xml");
      await execCommand(`sfdx sfpowerkit:org:manifest:build -o ${targetOrgPackageXml} --targetusername ${this.targetOrgUsernameAlias}`, this, {
        fail: true,
        debug: this.debugMode,
        output: true,
      });
      this.packageXmlFull = targetOrgPackageXml;
      if (!fs.existsSync(this.packageXmlFull)) {
        throw new SfdxError(
          c.red(
            "[sfdx-hardis] Unable to generate package.xml. This is probably an auth issue or a Salesforce technical issue, please try again later"
          )
        );
      }
    }

    let packageXmlContent = await parsePackageXmlFile(this.packageXmlFull);
    // Merge with local package.xml content
    if (fs.existsSync("./manifest/package.xml")) {
      const localPackageXmlContent = await parsePackageXmlFile("./manifest/package.xml");
      packageXmlContent = mergeObjectPropertyLists(packageXmlContent, localPackageXmlContent, { sort: true });
    }
    // Build destructiveChanges
    let destructiveChangesContent = {};
    if (fs.existsSync("./manifest/destructiveChanges.xml")) {
      destructiveChangesContent = await parsePackageXmlFile("./manifest/destructiveChanges.xml");
    }
    // Build additional lists
    const packageXmlAllFields = packageXmlContent["CustomField"].map((customField) => customField.split(".")[1]);
    // const destructiveChangesAllFields = (destructiveChangesContent["CustomField"] || []).map(customField => customField.split('.')[1]);

    // Clean report types

    let counterItems = 0;
    const patternReportType = this.folder + `/**/reportTypes/*.reportType-meta.xml`;
    const matchFilesPattern = await glob(patternReportType, {
      cwd: process.cwd(),
    });
    uxLog(this, `Processing reportTypes...`);
    for (const reportTypeFile of matchFilesPattern) {
      if (this.debugMode) {
        uxLog(this, `Processing ${reportTypeFile}...`);
      }
      let changed = false;
      const reportType = await parseXmlFile(reportTypeFile);
      for (let iSection = 0; iSection < reportType.ReportType.sections.length; iSection++) {
        const section = reportType.ReportType.sections[iSection];
        const prevLen = section.columns.length;
        // Filter columns referring to fields not in package.xml of target org + local package.xml
        section.columns = section.columns.filter((column) => {
          const object = column.table[0];
          const field = column.field[0].split(".")[0];
          const objectField = `${object}.${field}`;
          if ((destructiveChangesContent["CustomObject"] || []).includes(object)) {
            return false;
          }
          const objectFound = (packageXmlContent["CustomObject"] || []).includes(object);
          const fieldFound = (packageXmlContent["CustomField"] || []).includes(objectField);
          const isStandardTechField = this.standardFields.includes(field);
          const isStandardSubField = this.standardSuffixes.filter((suffix) => field.endsWith(suffix)).length > 0;
          if (
            (objectFound && (fieldFound || isStandardTechField || isStandardSubField)) ||
            (object.includes("__r") && (isStandardTechField || isStandardSubField)) ||
            (object.includes("__r") && packageXmlAllFields.includes(field))
          ) {
            return true;
          } else {
            if (this.debugMode) {
              uxLog(this, `-- filtered ${objectField}`);
            }
            return false;
          }
        });
        if (section.columns.length !== prevLen) {
          reportType.ReportType.sections[iSection] = section;
          changed = true;
        }
      }
      // Update source file if content has been updated
      if (changed) {
        await writeXmlFile(reportTypeFile, reportType);
        uxLog(this, `Updated ${reportTypeFile}`);
        counterItems++;
      }
    }

    // Summary
    const msg = `Updated ${c.green(c.bold(counterItems))} items`;
    uxLog(this, c.cyan(msg));
    // Return an object to be displayed with --json
    return { outputString: msg };
  }
}
