/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../../common/utils/index.js';
import { soqlQuery } from '../../../../common/utils/apiUtils.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { NotifProvider } from '../../../../common/notifProvider/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('plugin-template-sf-external', 'org');

export default class DiagnoseUnusedUsers extends SfCommand<any> {
  public static title = 'List licenses subscribed and used in a Salesforce org';

  public static description = `Mostly used for monitoring (Grafana) but you can also use it manually :)`;

  public static examples = ['$ sf hardis:org:diagnose:licenses'];

  //Comment default values to test the prompts
  public static flags = {
    outputfile: Flags.string({
      char: 'o',
      description: 'Force the path and name of output report file. Must end with .csv',
    }),
    usedonly: Flags.boolean({
      char: 'u',
      default: false,
      description: 'Filter to have only used licenses',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  protected usedOnly = false;
  protected debugMode = false;
  protected outputFile;
  protected outputFilesRes: any = {};
  protected licenses: any = [];
  protected statusCode = 0;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DiagnoseUnusedUsers);
    this.usedOnly = flags.usedonly || false;
    this.debugMode = flags.debug || false;
    this.outputFile = flags.outputfile || null;

    // Retrieve the list of users who haven't logged in for a while
    const conn = flags['target-org'].getConnection();
    uxLog(this, c.cyan(`Extracting Licenses from ${conn.instanceUrl} ...` + this.usedOnly ? '(used only)' : ''));

    const licensesByKey = {};
    const usedLicenses: any[] = [];

    // Query User Licenses
    const userLicenseQuery =
      `Select MasterLabel, Name, TotalLicenses, UsedLicenses ` +
      `FROM UserLicense ` +
      `WHERE Status='Active' AND TotalLicenses > 0 ` +
      `ORDER BY MasterLabel`;
    const userLicenseQueryRes = await soqlQuery(userLicenseQuery, conn);
    const userLicenses = userLicenseQueryRes.records.map((userLicense) => {
      const userLicenseInfo = Object.assign({}, userLicense);
      delete userLicenseInfo.Id;
      delete userLicenseInfo.attributes;
      userLicenseInfo.type = 'UserLicense';
      licensesByKey[userLicenseInfo.MasterLabel] = userLicenseInfo.TotalLicenses;
      if (userLicenseInfo.UsedLicenses > 0) {
        usedLicenses.push(userLicenseInfo.MasterLabel);
      }
      return userLicenseInfo;
    });
    this.licenses.push(...userLicenses);

    // Query Permission Set Licenses
    let pslQuery =
      `SELECT MasterLabel, PermissionSetLicenseKey, TotalLicenses, UsedLicenses ` +
      `FROM PermissionSetLicense ` +
      `WHERE Status='Active' AND TotalLicenses > 0 `;
    if (this.usedOnly) {
      pslQuery += `AND UsedLicenses > 0 `;
    }
    pslQuery += `ORDER BY MasterLabel`;
    const pslQueryRes = await soqlQuery(pslQuery, conn);
    const pslLicenses = pslQueryRes.records.map((psl) => {
      const pslInfo = Object.assign({}, psl);
      pslInfo.Name = pslInfo.PermissionSetLicenseKey;
      delete pslInfo.Id;
      delete pslInfo.attributes;
      delete pslInfo.PermissionSetLicenseKey;
      pslInfo.type = 'PermissionSetLicense';
      licensesByKey[pslInfo.MasterLabel] = pslInfo.TotalLicenses;
      if (pslInfo.UsedLicenses > 0) {
        usedLicenses.push(pslInfo.MasterLabel);
      }
      return pslInfo;
    });
    this.licenses.push(...pslLicenses);

    usedLicenses.sort();
    console.table(this.licenses);
    uxLog(this, c.cyan('Used licenses: ' + usedLicenses.join(', ')));

    // Generate output CSV file
    this.outputFile = await generateReportPath('licenses', this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.licenses, this.outputFile);

    globalThis.jsForceConn = flags['target-org']?.getConnection(); // Required for some notifications providers like Email
    NotifProvider.postNotifications({
      type: 'LICENSES',
      text: '',
      severity: 'log',
      attachedFiles: this.outputFilesRes.xlsxFile ? [this.outputFilesRes.xlsxFile] : [],
      logElements: this.licenses,
      data: {
        activeLicenses: Object.keys(licensesByKey).sort(),
        usedLicenses: usedLicenses,
        licenses: licensesByKey,
      },
      metrics: {},
    });

    // Return an object to be displayed with --json
    return {
      status: 0,
      licenses: this.licenses,
      csvLogFile: this.outputFile,
      xlsxLogFile: this.outputFilesRes.xlsxFile,
    };
  }
}
