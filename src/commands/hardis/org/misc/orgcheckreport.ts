/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import { uxLog } from "../../../../common/utils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class OrgCheckReport extends SfdxCommand {
  public static title = "Import Mega-Linter Report";

  public static description = "Imports Mega-Linter report into an org where OrgCheck is installed";

  public static examples = ["$ sfdx hardis:org:misc:orgcheckreport"];

  protected static flagsConfig = {
    reportfile: flags.string({
      char: "r",
      description: "Path to the sfdmu workspace folder",
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
  protected static requiresUsername = true;

  protected reportFile = true;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.reportFile = this.flags.reportfile || null;

    const report = JSON.parse(fs.readFileSync("./config/project-scratch-def.json"));
    const codeQualityReport = report.CodeQualityReport__c;
    /* example:
    {
      "GitBranch__c": "developpement",
      "OrgId__c": "df454555454",
      "OrgLabel__c": "Dev Test Nico",
      "Origin__c": "Mega-Linter",
      "Status__c": "Success"
    }; */

    let codeQualityLinterReports = report.CodeQualityReportLinter__c;
    /* example: [
      {
        "Descriptor__c": "SALESFORCE",
        "ElapsedTimeMs__c": 2345,
        "ErrorsNumber__c": 34,
        "FixedNumber__c": 23,
        "LintedFilesNumber__c": 456,
        "Linter__c": "sfdx-scanner-apex",
        "LinterDocUrl__c": "https://nvuillam.github.io/mega-linter/descriptors/markdown_markdownlint/",
        "LinterOutputText__c": "Blahhhhh\nbli\nblou\n" ,
        "Status__c": "Success"
      },
      {
        "Descriptor__c": "SALESFORCE",
        "ElapsedTimeMs__c": 3567,
        "ErrorsNumber__c": 32,
        "FixedNumber__c": 21,
        "LintedFilesNumber__c": 456,
        "Linter__c": "sfdx-scanner-lwc",
        "LinterDocUrl__c": "https://nvuillam.github.io/mega-linter/descriptors/markdown_markdownlint/",
        "LinterOutputText__c": "Blahhhhh\nbli\nblouuuuuuu\n" ,
        "Status__c": "Warning"
      }
    ]; */

    const conn = this.org.getConnection();

    // Insert Code Quality Report record
    const createReportResult: any = await conn.sobject("CodeQualityReport__c").create(codeQualityReport);
    if (createReportResult.success !== true) {
      throw new SfdxError(c.red("Error while inserting CodeQualityReport__c records\n" + JSON.stringify(createReportResult, null, 2)));
    }
    const createdReportId = createReportResult.id;

    // Update Code Quality Linter Reports with Id of master detail
    codeQualityLinterReports = codeQualityLinterReports.map((linterReport: any) => {
      linterReport.CodeQualityReport__c = createdReportId;
      return linterReport;
    });

    // Insert Code  Quality Report Linter records
    const createReportLinterResult: any = await conn.sobject("CodeQualityReportLinter__c").create(codeQualityLinterReports);
    if (!(Array.isArray(createReportLinterResult) && createReportLinterResult.filter(insertRes => insertRes.success !== true).length === 0)) {
      throw new SfdxError(c.red("Error while inserting CodeQualityReportLinter__c records\n" + JSON.stringify(createReportLinterResult, null, 2)));
    }

    // Output message
    const message = `Successfully imported mega-linter report into remote org ${c.green(this.org.getUsername())}`;
    uxLog(this, c.cyan(message));
    return { outputString: message };
  }
}
