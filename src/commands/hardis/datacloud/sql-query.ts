import { Messages } from "@salesforce/core";
import { Flags, requiredOrgFlagWithDeprecations, SfCommand } from "@salesforce/sf-plugins-core";
import { AnyJson } from "@salesforce/ts-types";
import { dataCloudSqlQuery, listAvailableDataCloudQueries, loadDataCloudQueryFromFile, saveDataCloudQueryToFile } from "../../../common/utils/dataCloudUtils.js";
import { generateCsvFile, generateReportPath } from "../../../common/utils/filesUtils.js";
import { uxLog } from "../../../common/utils/index.js";
import { prompts } from "../../../common/utils/prompts.js";
import c from "chalk";

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DataCloudSqlQuery extends SfCommand<any> {
  public static title = 'Execute a SQL query on Data Cloud';

  public static description = `
## Command Behavior

Key functionalities:

<details markdown="1">
<summary>Technical explanations</summary>
</details>
`;

  public static examples = [
    '$ sf hardis:datacloud:sql-query',
    '$ sf hardis:datacloud:sql-query -q "SELECT ssot__Name__c, ssot__CreatedDate__c FROM ssot__Account__dlm LIMIT 10"',
    '$ sf hardis:datacloud:sql-query -q test'
  ];

  /* jscpd:ignore-start */

  public static flags: any = {
    query: Flags.string({
      char: 'q',
      description: 'Data Cloud query string',
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
    'target-org': requiredOrgFlagWithDeprecations,
  };

  public static requiresProject = false;

  protected debugMode = false;
  protected queryString = '';
  protected outputFile;
  protected outputFilesRes: any = {};
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DataCloudSqlQuery);
    this.queryString = flags.query;
    this.outputFile = flags.outputfile || null;
    this.debugMode = flags.debug || false;
    const conn = flags['target-org'].getConnection();
    if (this.queryString === 'test') {
      this.queryString = `
SELECT
  ssot__Name__c,
  ssot__CreatedDate__c
FROM
  ssot__Account__dlm
ORDER BY
  ssot__CreatedDate__c DESC
LIMIT 5000;
      `;
    }

    if (this.queryString === '' || this.queryString == null) {
      const availableQueries = await listAvailableDataCloudQueries();
      if (availableQueries.length > 0) {
        const queryChoicePromptRes = await prompts({
          type: 'select',
          message: 'Please select a predefined Data Cloud SQL query or choose "Custom Query" to enter your own:',
          description: 'Available predefined queries',
          choices: [...availableQueries.map(q => ({ title: q, value: q })), { title: 'Custom Query', value: 'custom' }],
        });
        if (queryChoicePromptRes.value !== 'custom') {
          this.queryString = await loadDataCloudQueryFromFile(queryChoicePromptRes.value);
        }
      }
    }
    if (this.queryString === '' || this.queryString == null) {
      const customQueryPromptRes = await prompts({
        type: 'text',
        message: 'Please enter your Data Cloud SQL query:',
        description: 'Custom Data Cloud SQL query',
      });
      this.queryString = customQueryPromptRes.value;
      // Prompt user if he wants to save the query
      const saveQueryPromptRes = await prompts({
        type: 'confirm',
        message: 'Do you want to save this query for future use?',
        description: 'Save Data Cloud SQL query in local files',
        initial: false,
      });
      if (saveQueryPromptRes.value) {
        const saveQueryNamePromptRes = await prompts({
          type: 'text',
          message: 'Enter a name for the saved query:',
          description: 'Name of the Data Cloud SQL query to save',
        });
        if (saveQueryNamePromptRes.value) {
          await saveDataCloudQueryToFile(saveQueryNamePromptRes.value.trim(), this.queryString);
        }
      }
    }

    uxLog("action", this, c.cyan('Executing Data Cloud SQL query...'));

    const result = await dataCloudSqlQuery(this.queryString, conn, {});
    this.logJson(result);

    // Output results (except records)
    const resultCopy = { ...result };
    resultCopy.records = [{ removedFromDisplay: true }];
    uxLog("other", this, JSON.stringify(resultCopy, null, 2));

    // Generate output CSV file
    this.outputFile = await generateReportPath('datacloud-sql-query', this.outputFile);
    this.outputFilesRes = await generateCsvFile(result.records, this.outputFile, { fileTitle: 'DataCloud Sql Query Results' });

    return { sqlResult: JSON.parse(JSON.stringify(result)) };
  }
}

