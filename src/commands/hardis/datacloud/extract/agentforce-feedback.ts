import { Messages } from "@salesforce/core";
import { Flags, requiredOrgFlagWithDeprecations, SfCommand } from "@salesforce/sf-plugins-core";
import { AnyJson } from "@salesforce/ts-types";
import { dataCloudSqlQuery } from "../../../../common/utils/dataCloudUtils.js";
import { uxLog } from "../../../../common/utils/index.js";
import { generateCsvFile, generateReportPath } from "../../../../common/utils/filesUtils.js";

const AGENTFORCE_FEEDBACK_QUERY = `
SELECT
  COALESCE(usr.ssot__username__c, gar.userId__c) AS userName,
  ggn.timestamp__c AS conversationDate,
  gaf.feedback__c AS feedbackSentiment,
  gfd.feedbackText__c AS feedbackMessage,
  gat.tagValue__c AS userUtterance,
  ggn.responseText__c AS agentResponse
FROM GenAIGeneration__dlm ggn
JOIN GenAIGatewayResponse__dlm grs ON ggn.generationResponseId__c = grs.generationResponseId__c
JOIN GenAIGatewayRequest__dlm gar ON grs.generationRequestId__c = gar.gatewayRequestId__c
JOIN GenAIGatewayRequestTag__dlm gat ON gar.gatewayRequestId__c = gat.parent__c AND gat.tag__c = 'user_utterance'
LEFT JOIN GenAIFeedback__dlm gaf ON gar.generationGroupId__c = gaf.generationGroupId__c
LEFT JOIN GenAIFeedbackDetail__dlm gfd ON gaf.feedbackId__c = gfd.parent__c
LEFT JOIN ssot__User__dlm usr ON usr.ssot__Id__c = gar.userId__c
WHERE gaf.feedback__c IN ('GOOD','BAD')
ORDER BY ggn.timestamp__c DESC
LIMIT 500;
`;

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

  public static examples = [
    '$ sf hardis:datacloud:extract:agentforce-feedback',
    '$ sf hardis:datacloud:extract:agentforce-feedback --target-org myorg@example.com',
    '$ sf hardis:datacloud:extract:agentforce-feedback --outputfile ./reports/agentforce-feedback.csv'
  ];

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
    const { flags } = await this.parse(DataCloudExtractAgentforceFeedback);
    this.outputFile = flags.outputfile || null;
    this.debugMode = flags.debug || false;
    const conn = flags['target-org'].getConnection();

    this.queryString = AGENTFORCE_FEEDBACK_QUERY.trim();

    const rawResult = await dataCloudSqlQuery(this.queryString, conn, {});
    const exportRecords = buildAgentforceFeedbackRecords(rawResult.records);
    const result = { ...rawResult, records: exportRecords, returnedRows: exportRecords.length };

    const { records: _records, ...resultCopy } = result;
    void _records;
    uxLog("other", this, JSON.stringify(resultCopy, null, 2));

    this.outputFile = await generateReportPath('datacloud-agentforce-feedback', this.outputFile);
    this.outputFilesRes = await generateCsvFile(exportRecords, this.outputFile, { fileTitle: 'DataCloud Agentforce Feedback' });

    return { sqlResult: JSON.parse(JSON.stringify(result)) };
  }
}

function buildAgentforceFeedbackRecords(records: AnyJson[] | undefined) {
  const safeRecords = Array.isArray(records) ? records : [];
  return safeRecords.map((record) => {
    const normalized = normalizeKeys(record as Record<string, AnyJson>);
    const userName = stringValue(normalized["username"] ?? normalized["userid"]);
    const conversationDate = stringValue(normalized["conversationdate"] ?? normalized["timestamp__c"]);
    const feedbackValue = stringValue(normalized["feedbacksentiment"] ?? normalized["feedback__c"]);
    const feedbackMessage = stringValue(normalized["feedbackmessage"] ?? normalized["feedbacktext__c"]);
    const userUtterance = stringValue(normalized["userutterance"] ?? normalized["tagvalue__c"]);
    const agentResponse = stringValue(normalized["agentresponse"] ?? normalized["responsetext"]);
    const conversation = buildConversation(userUtterance, agentResponse);

    return {
      "User": userName,
      "ConversationDate": conversationDate,
      "Feedback GOOD/BAD": feedbackValue,
      "Message containing GOOD/BAD": feedbackMessage,
      "Full conversation": conversation,
    };
  });
}

function normalizeKeys(record: Record<string, AnyJson>): Record<string, AnyJson> {
  return Object.entries(record).reduce<Record<string, AnyJson>>((acc, [key, value]) => {
    acc[key.toLowerCase()] = value;
    return acc;
  }, {});
}

function stringValue(value: AnyJson): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function buildConversation(userUtterance: string, agentResponse: string): string {
  const parts: string[] = [];
  if (userUtterance) {
    parts.push(`USER: ${userUtterance}`);
  }
  if (agentResponse) {
    parts.push(`AGENT: ${agentResponse}`);
  }
  return parts.join('\n---\n');
}

