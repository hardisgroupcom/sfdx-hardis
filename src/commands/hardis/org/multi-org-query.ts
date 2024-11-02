/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { AuthInfo, Connection, Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from "chalk";
import { makeSureOrgIsConnected, promptOrgList } from '../../../common/utils/orgUtils.js';
import { isCI, uxLog } from '../../../common/utils/index.js';
import { bulkQuery } from '../../../common/utils/apiUtils.js';
import { generateCsvFile, generateReportPath } from '../../../common/utils/filesUtils.js';
import { prompts } from '../../../common/utils/prompts.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class MultiOrgQuery extends SfCommand<any> {
  public static title = 'Multiple Orgs SOQL Query';

  public static description = `Executes a SOQL query in multiple orgs and generate a single report from it
  
You can send a custom query using --query, or use one of the predefined queries using --query-template.

If you use the command from a CI/CD job, you must previously authenticate to the usernames present in --target-orgs.

[![Use in VsCode SFDX Hardis !](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/multi-org-query-demo.gif)](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)
`;

  public static examples = [
    '$ sf hardis:org:multi-org-query',
    '$ sf hardis:org:multi-org-query --query "SELECT Id,Username FROM User"',
    '$ sf hardis:org:multi-org-query --query "SELECT Id,Username FROM User" --target-orgs nico@cloudity.com nico@cloudity.com.preprod nico@cloudity.com.uat',
    '$ sf hardis:org:multi-org-query --query-template active-users --target-orgs nico@cloudity.com nico@cloudity.com.preprod nico@cloudity.com.uat',
  ];

  public static flags: any = {
    query: Flags.string({
      char: 'q',
      description: 'SOQL Query to run on multiple orgs',
      exclusive: ["query-template"]
    }),
    "query-template": Flags.string({
      char: "t",
      description: "Use one of predefined SOQL Query templates",
      options: [
        "active-users",
        "all-users"
      ],
      exclusive: ["query"]
    }),
    "target-orgs": Flags.string({
      char: "x",
      description: "List of org usernames or aliases.",
      multiple: true
    }),
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path and name of output report file. Must end with .csv',
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
  };

  protected allQueryTemplates: any = {
    "active-users": {
      label: "Active users",
      query: `SELECT Id, LastLoginDate, User.LastName, User.Firstname, Profile.UserLicense.Name, Profile.Name, Username, Profile.UserLicense.LicenseDefinitionKey, IsActive, CreatedDate FROM User WHERE IsActive = true ORDER BY Username ASC`,
    },
    "all-users": {
      label: "All users (including inactive)",
      query: `SELECT Id, LastLoginDate, User.LastName, User.Firstname, Profile.UserLicense.Name, Profile.Name, Username, Profile.UserLicense.LicenseDefinitionKey, IsActive, CreatedDate FROM User ORDER BY Username ASC`,
    }
  };
  protected query: string;
  protected queryTemplate: string;
  protected targetOrgsIds: string[] = [];
  protected targetOrgs: any[] = []
  protected outputFile;
  protected debugMode = false;
  protected allRecords: any[] = [];
  protected successOrgs: any[] = [];
  protected errorOrgs: any[] = [];

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(MultiOrgQuery);
    this.query = flags.query || null;
    this.queryTemplate = flags["query-template"] || null;
    this.targetOrgsIds = flags["target-orgs"] || [];
    this.outputFile = flags.outputfile || null;
    this.debugMode = flags.debug || false;

    // Prompt query if not specified as input argument
    await this.defineSoqlQuery();

    // List org if not sent as input parameter
    await this.manageSelectOrgs();

    // Perform the request on orgs
    await this.performQueries();

    // Display results
    this.displayResults();

    // Generate output CSV & XLS
    this.outputFile = await generateReportPath('multi-org-query', this.outputFile);
    const outputFilesRes = await generateCsvFile(this.allRecords, this.outputFile);

    return {
      allRecords: this.allRecords,
      successOrgs: this.successOrgs,
      errorOrgs: this.errorOrgs,
      csvLogFile: this.outputFile,
      xlsxLogFile: outputFilesRes.xlsxFile,
    };
  }

  private displayResults() {
    if (this.successOrgs.length > 0) {
      uxLog(this, c.green(`Successfully performed query on ${this.successOrgs.length} orgs`));
      for (const org of this.successOrgs) {
        uxLog(this, c.grey(`-  ${org.instanceUrl}`));
      }
    }
    if (this.errorOrgs.length > 0) {
      uxLog(this, c.green(`Error while performing query on ${this.errorOrgs.length} orgs`));
      for (const org of this.successOrgs) {
        uxLog(this, c.grey(`-  ${org.instanceUrl}: ${org?.error?.message}`));
      }
    }
  }

  private async performQueries() {
    for (const orgId of this.targetOrgsIds) {
      const matchOrgs = this.targetOrgs.filter(org => (org.username === orgId || org.alias === orgId) && org.accessToken);
      if (matchOrgs.length === 0) {
        uxLog(this, c.yellow(`Skipped ${orgId}: Unable to find authentication. Run "sf org login web" to authenticate.`));
        continue;
      }
      const accessToken = matchOrgs[0].accessToken;
      const username = matchOrgs[0].username;
      const instanceUrl = matchOrgs[0].instanceUrl;
      const loginUrl = matchOrgs[0].loginUrl || instanceUrl;
      uxLog(this, c.cyan(`Performing query on ${c.bold(orgId)}...`));
      try {
        const authInfo = await AuthInfo.create({
          username: username
        });
        const connectionConfig: any = {
          loginUrl: loginUrl,
          instanceUrl: instanceUrl,
          accessToken: accessToken
        };
        const conn = await Connection.create({ authInfo: authInfo, connectionOptions: connectionConfig });
        const bulkQueryRes = await bulkQuery(this.query, conn, 5);
        // Add org info to results
        const records = bulkQueryRes.records.map(record => {
          record.orgInstanceUrl = matchOrgs[0].instanceUrl;
          record.orgAlias = matchOrgs[0].alias || "";
          record.orgUser = matchOrgs[0].username || "";
          return record;
        });
        this.allRecords.push(...records);
        this.successOrgs.push({ orgId: orgId, instanceUrl: instanceUrl, username: username })
      } catch (e: any) {
        uxLog(this, c.red(`Error while querying ${orgId}: ${e.message}`));
        this.errorOrgs.push({ org: orgId, error: e })
      }

    }
  }

  private async manageSelectOrgs() {
    if (this.targetOrgsIds.length === 0) {
      this.targetOrgs = await promptOrgList();
      this.targetOrgsIds = this.targetOrgs.map(org => org.alias || org.username);
    }

    // Check orgs are connected
    for (const orgId of this.targetOrgsIds) {
      const matchOrgs = this.targetOrgs.filter(org => (org.username === orgId || org.alias === orgId) && org.accessToken && org.connectedStatus === 'Connected');
      if (matchOrgs.length === 0) {
        const orgRes = await makeSureOrgIsConnected(orgId);
        this.targetOrgs.push(orgRes);
      }
    }
  }

  private async defineSoqlQuery() {
    // Template is sent as input
    if (this.queryTemplate) {
      this.query = this.allQueryTemplates[this.queryTemplate].query;
    }
    if (this.query == null && !isCI) {
      const baseQueryPromptRes = await prompts({
        type: "select",
        message: "Please select a predefined query, or custom SOQL option",
        choices: [
          ...Object.keys(this.allQueryTemplates).map(templateId => {
            return {
              title: this.allQueryTemplates[templateId].label,
              description: this.allQueryTemplates[templateId].query,
              value: this.allQueryTemplates[templateId].query
            }
          }),
          {
            title: "Custom SOQL Query",
            description: "Enter a custom SOQL query to run",
            value: "custom"
          }
        ]
      });
      if (baseQueryPromptRes.value === "custom") {
        const queryPromptRes = await prompts({
          type: 'text',
          message: 'Please input the SOQL Query to run in multiple orgs',
        });
        this.query = queryPromptRes.value;
      }
      else {
        this.query = baseQueryPromptRes.value;
      }
    }
  }
}
