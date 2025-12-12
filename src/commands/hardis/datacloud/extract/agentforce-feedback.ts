import { Messages } from "@salesforce/core";
import { Flags, requiredOrgFlagWithDeprecations, SfCommand } from "@salesforce/sf-plugins-core";
import { AnyJson } from "@salesforce/ts-types";
import DataCloudSqlQuery from "../sql-query.js";
import { dataCloudSqlQuery } from "../../../../common/utils/dataCloudUtils.js";
import { uxLog } from "../../../../common/utils/index.js";
import { generateCsvFile, generateReportPath } from "../../../../common/utils/filesUtils.js";


Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DataCloudExtractAgentforceFeedback extends SfCommand<any> {
  public static title = 'Extract Agentforce Feedback Data from Data Cloud';

  public static description = `
## Command Behavior

Key functionalities:

<details markdown="1">
<summary>Technical explanations</summary>
</details>
`;

  public static examples = ['$ sf hardis:datacloud:sql-query -q agentforce-chat-feedback'];

  public static flags: any = {
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
    this.outputFile = flags.outputfile || null;
    this.debugMode = flags.debug || false;
    const conn = flags['target-org'].getConnection();

    this.queryString = ""

    const result = await dataCloudSqlQuery(this.queryString, conn, {});
    this.logJson(result);

    // Output results (except records)
    const resultCopy = { ...result };
    // delete resultCopy.records;
    uxLog("other", this, JSON.stringify(resultCopy, null, 2));

    // Generate output CSV file
    this.outputFile = await generateReportPath('datacloud-agentforce-feedback', this.outputFile);
    this.outputFilesRes = await generateCsvFile(result.records, this.outputFile, { fileTitle: 'DataCloud Agentforce Feedback' });

    return { sqlResult: JSON.parse(JSON.stringify(result)) };
  }
}

