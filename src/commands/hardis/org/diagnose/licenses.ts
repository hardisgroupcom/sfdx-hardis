/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { sortCrossPlatform, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { soqlQuery } from '../../../../common/utils/apiUtils.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { NotifProvider } from '../../../../common/notifProvider/index.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DiagnoseUnusedUsers extends SfCommand<any> {
  public static title = 'List licenses subscribed and used in a Salesforce org';

  public static description = `
**Lists and analyzes User Licenses and Permission Set Licenses subscribed and used in a Salesforce org.**

This command provides a comprehensive overview of your Salesforce license consumption. It's particularly useful for:

- **License Management:** Understanding which licenses are active, how many are available, and how many are being used.
- **Cost Optimization:** Identifying unused or underutilized licenses that could be reallocated or decommissioned.
- **Compliance:** Ensuring that your organization is compliant with Salesforce licensing agreements.
- **Monitoring:** Tracking license usage trends over time.

Key functionalities:

- **User License Details:** Retrieves information about standard and custom User Licenses, including \`MasterLabel\`, \`Name\`, \`TotalLicenses\`, and \`UsedLicenses\`.
- **Permission Set License Details:** Retrieves information about Permission Set Licenses, including \`MasterLabel\`, \`PermissionSetLicenseKey\`, \`TotalLicenses\`, and \`UsedLicenses\`.
- **Used Licenses Filter:** The \`--usedonly\` flag allows you to filter the report to show only licenses that have at least one \`UsedLicenses\` count greater than zero.
- **CSV Report Generation:** Generates a CSV file containing all the retrieved license information, suitable for detailed analysis.
- **Notifications:** Sends notifications to configured channels (e.g., Grafana, Slack, MS Teams) with a summary of license usage, including lists of active and used licenses.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Salesforce SOQL Queries:** It executes SOQL queries against the \`UserLicense\` and \`PermissionSetLicense\` objects in Salesforce to retrieve license data.
- **Data Transformation:** It processes the query results, reformatting the data to be more readable and consistent for reporting purposes (e.g., removing \`Id\` and \`attributes\`, renaming \`PermissionSetLicenseKey\` to \`Name\`).
- **Data Aggregation:** It aggregates license information, creating a \`licensesByKey\` object for quick lookups and a \`usedLicenses\` array for a concise list of actively used licenses.
- **Report Generation:** It uses \`generateCsvFile\` to create the CSV report of license data.
- **Notification Integration:** It integrates with the \`NotifProvider\` to send notifications, including attachments of the generated CSV report and metrics for monitoring dashboards.
- **User Feedback:** Provides clear messages to the user about the license extraction process and the used licenses.
</details>
`;

  public static examples = ['$ sf hardis:org:diagnose:licenses'];

  //Comment default values to test the prompts
  public static flags: any = {
    outputfile: Flags.string({
      char: 'f',
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
    uxLog("action", this, c.cyan(`Extracting Licenses from ${conn.instanceUrl} ...` + this.usedOnly ? '(used only)' : ''));

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

    sortCrossPlatform(usedLicenses);
    uxLog("action", this, c.cyan('Used licenses: ' + usedLicenses.join(', ')));
    uxLogTable(this, this.licenses);


    // Generate output CSV file
    this.outputFile = await generateReportPath('licenses', this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.licenses, this.outputFile, { fileTitle: 'Unused Licenses' });

    await setConnectionVariables(flags['target-org']?.getConnection());// Required for some notifications providers like Email
    await NotifProvider.postNotifications({
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
