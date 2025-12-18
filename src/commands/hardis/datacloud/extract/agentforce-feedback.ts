import { Messages } from "@salesforce/core";
import { Flags, requiredOrgFlagWithDeprecations, SfCommand } from "@salesforce/sf-plugins-core";
import { AnyJson } from "@salesforce/ts-types";
import c from "chalk";
import { dataCloudSqlQuery } from "../../../../common/utils/dataCloudUtils.js";
import { uxLog } from "../../../../common/utils/index.js";
import { generateCsvFile, generateReportPath } from "../../../../common/utils/filesUtils.js";
import { NotifProvider } from "../../../../common/notifProvider/index.js";
import { setConnectionVariables } from "../../../../common/utils/orgUtils.js";
import {
  AgentforceQueryFilters,
  buildConversation,
  buildConversationUrl,
  buildDateFilterClause,
  buildExcludedSessionFilter,
  extractSessionIds,
  fetchConversationTranscripts,
  normalizeKeys,
  resolveConversationLinkDomain,
  resolveDateFilterOptions,
  resolveExcludedConversationIds,
  stringValue,
} from "../../../../common/utils/agentforceQueryUtils.js";

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

  /* jscpd:ignore-start */

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
    'conversation-time-filter': Flags.integer({
      description: 'Time filter (days) appended to the Lightning analytics URL when generating conversation links',
      default: 30,
    }),
    'date-from': Flags.string({
      description: 'Optional ISO-8601 timestamp (UTC) to include conversations starting from this date',
    }),
    'date-to': Flags.string({
      description: 'Optional ISO-8601 timestamp (UTC) to include conversations up to this date',
    }),
    'last-n-days': Flags.integer({
      description: 'Optional rolling window (days) to include only the most recent conversations',
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
    const timeFilterFlag = flags['conversation-time-filter'];
    const timeFilterDays = Number.isFinite(timeFilterFlag) && timeFilterFlag > 0 ? timeFilterFlag : 30;
    const conversationLinkDomain = resolveConversationLinkDomain(conn.instanceUrl);
    const dateFilterOptions = resolveDateFilterOptions({
      dateFromInput: flags['date-from'],
      dateToInput: flags['date-to'],
      lastNDaysInput: flags['last-n-days'],
    });

    this.queryString = buildMainQuery(dateFilterOptions).trim();

    uxLog("action", this, c.cyan("Querying Feedbacks table..."));
    const rawResult = await dataCloudSqlQuery(this.queryString, conn, {});
    const sessionIds = extractSessionIds(rawResult.records);
    uxLog("action", this, c.cyan("Fetching full conversations transcripts..."));
    const transcriptsBySession = await fetchConversationTranscripts(sessionIds, conn, { chunkSize: 25 });
    uxLog("action", this, c.cyan("Aggregating and filtering data..."))
    const exportRecords = buildAgentforceFeedbackRecords(rawResult.records, {
      conversationLinkDomain,
      timeFilterDays,
      transcriptsBySession,
    });
    const result = { ...rawResult, records: exportRecords, returnedRows: exportRecords.length };

    const { records: _records, ...resultCopy } = result;
    void _records;
    uxLog("other", this, JSON.stringify(resultCopy, null, 2));

    this.outputFile = await generateReportPath('datacloud-agentforce-feedback', this.outputFile);
    this.outputFilesRes = await generateCsvFile(exportRecords, this.outputFile, {
      fileTitle: 'DataCloud Agentforce Feedback',
      columnsCustomStyles: {
        'Full conversation': { width: 60, wrap: true, maxHeight: 50 },
        'Feedback type': { width: 10 },
        'Feedback message': { width: 30, wrap: true },
        'ConversationId': { width: 35 },
        'Conversation URL': { width: 80, hyperlinkFromValue: true },
      },
    });
    const feedbackStats = computeFeedbackStats(exportRecords);
    const notifSeverity = feedbackStats.badCount > 0 ? 'warning' : 'log';
    const notifText = buildNotificationText(feedbackStats, dateFilterOptions);
    const attachedFiles = collectFeedbackReportFiles(this.outputFilesRes);
    uxLog("action", this, c.cyan(notifText));

    await setConnectionVariables(conn);
    await NotifProvider.postNotifications({
      type: 'AGENTFORCE_FEEDBACK',
      text: notifText,
      buttons: [],
      attachments: [],
      severity: notifSeverity,
      attachedFiles,
      logElements: [],
      data: { metric: feedbackStats.badCount, totalFeedback: feedbackStats.totalCount },
      metrics: {
        agentforceFeedbackGood: feedbackStats.goodCount,
        agentforceFeedbackBad: feedbackStats.badCount,
      },
      alwaysSend: true,
    });

    return {
      sqlResult: JSON.parse(JSON.stringify(result)),
      feedbacksGood: feedbackStats.goodCount,
      feedbacksBad: feedbackStats.badCount,
      csvLogFile: this.outputFile,
      xlsxLogFile: this.outputFilesRes?.xlsxFile,
    };
  }
}

interface ConversationLinkOptions {
  conversationLinkDomain: string | null;
  timeFilterDays: number;
}

interface AgentforceRecordOptions extends ConversationLinkOptions {
  transcriptsBySession: Map<string, string>;
}

interface AgentforceCsvRecord {
  "User": string;
  "ConversationDate": string;
  "Feedback type": string;
  "Feedback message": string;
  "Full conversation": string;
  "ConversationId": string;
  "Conversation URL": string;
}

function buildAgentforceFeedbackRecords(records: AnyJson[] | undefined, options: AgentforceRecordOptions) {
  const safeRecords = Array.isArray(records) ? records : [];
  const safeOptions: AgentforceRecordOptions = options || {
    conversationLinkDomain: null,
    timeFilterDays: 30,
    transcriptsBySession: new Map<string, string>(),
  };
  const dedupMap = new Map<string, { record: AgentforceCsvRecord; conversationDate: string }>();
  safeRecords.forEach((record) => {
    const normalized = normalizeKeys(record as Record<string, AnyJson>);
    const userName = stringValue(normalized["username"] ?? normalized["userid"]);
    const conversationDate = stringValue(normalized["conversationdate"] ?? normalized["timestamp__c"]);
    const feedbackValue = stringValue(normalized["feedbacksentiment"] ?? normalized["feedback__c"]);
    const feedbackMessage = stringValue(normalized["feedbackmessage"] ?? normalized["feedbacktext__c"]);
    const userUtterance = stringValue(normalized["userutterance"] ?? normalized["tagvalue__c"]);
    const agentResponse = stringValue(normalized["agentresponse"] ?? normalized["responsetext"]);
    const conversationId = stringValue(normalized["conversationid"] ?? normalized["generationgroupid__c"]);
    const sessionId = stringValue(normalized["sessionid"] ?? normalized["ssot__aiagentsessionid__c"]);
    const agentApiName = stringValue(normalized["agentapiname"] ?? normalized["ssot__aiagentapiname__c"]);
    const transcript = safeOptions.transcriptsBySession.get(sessionId) || '';
    const conversation = transcript || buildConversation(userUtterance, agentResponse);
    const conversationUrl = buildConversationUrl({
      domain: safeOptions.conversationLinkDomain,
      conversationId,
      sessionId,
      agentApiName,
      timeFilterDays: safeOptions.timeFilterDays,
    });

    const exportRecord: AgentforceCsvRecord = {
      "User": userName,
      "ConversationDate": conversationDate,
      "Feedback type": feedbackValue,
      "Feedback message": feedbackMessage,
      "Full conversation": conversation,
      "ConversationId": conversationId,
      "Conversation URL": conversationUrl,
    };
    const dedupKey = conversationId || `${userName}::${conversationDate}::${feedbackMessage}`;
    const existing = dedupMap.get(dedupKey);
    if (!existing || isNewer(conversationDate, existing.conversationDate)) {
      dedupMap.set(dedupKey, { record: exportRecord, conversationDate });
    }
  });

  return Array.from(dedupMap.values()).map((entry) => entry.record);
}

function isNewer(candidateDate: string, existingDate: string): boolean {
  if (!candidateDate) {
    return false;
  }
  if (!existingDate) {
    return true;
  }
  const candidateTime = Date.parse(candidateDate);
  const existingTime = Date.parse(existingDate);
  if (Number.isNaN(candidateTime)) {
    return false;
  }
  if (Number.isNaN(existingTime)) {
    return true;
  }
  return candidateTime >= existingTime;
}

function buildMainQuery(filters: AgentforceQueryFilters = {}) {
  const excludedConversationIds = resolveExcludedConversationIds();
  const excludedConversationFilter = excludedConversationIds.length
    ? ` AND gar.generationGroupId__c NOT IN (${excludedConversationIds.map((id) => `'${id}'`).join(', ')})`
    : '';
  const excludedSessionClause = buildExcludedSessionFilter();
  const dateFilterClause = buildDateFilterClause(filters);

  const AGENTFORCE_FEEDBACK_QUERY = `
WITH feedback_cte AS (
  SELECT
    COALESCE(usr.ssot__username__c, gar.userId__c) AS userName,
    ggn.timestamp__c AS conversationDate,
    gaf.feedback__c AS feedbackSentiment,
    gfd.feedbackText__c AS feedbackMessage,
    gat.tagValue__c AS userUtterance,
    ggn.responseText__c AS agentResponse,
    gar.generationGroupId__c AS conversationId,
    gar.gatewayRequestId__c AS gatewayRequestId
  FROM GenAIGeneration__dlm ggn
  JOIN GenAIGatewayResponse__dlm grs ON ggn.generationResponseId__c = grs.generationResponseId__c
  JOIN GenAIGatewayRequest__dlm gar ON grs.generationRequestId__c = gar.gatewayRequestId__c
  JOIN GenAIGatewayRequestTag__dlm gat ON gar.gatewayRequestId__c = gat.parent__c AND gat.tag__c = 'user_utterance'
  LEFT JOIN GenAIFeedback__dlm gaf ON gar.generationGroupId__c = gaf.generationGroupId__c
  LEFT JOIN GenAIFeedbackDetail__dlm gfd ON gaf.feedbackId__c = gfd.parent__c
  LEFT JOIN ssot__User__dlm usr ON usr.ssot__Id__c = gar.userId__c
  WHERE gaf.feedback__c IN ('GOOD','BAD')${excludedConversationFilter}${dateFilterClause}
), session_lookup AS (
  SELECT
    ais.ssot__GenAiGatewayRequestId__c AS gatewayRequestId,
    ai.ssot__AiAgentSessionId__c AS sessionId,
    ROW_NUMBER() OVER (
      PARTITION BY ais.ssot__GenAiGatewayRequestId__c
      ORDER BY ais.ssot__StartTimestamp__c DESC
    ) AS rowNum
  FROM ssot__AiAgentInteractionStep__dlm ais
  JOIN ssot__AiAgentInteraction__dlm ai ON ai.ssot__Id__c = ais.ssot__AiAgentInteractionId__c
), session_agent_info AS (
  SELECT
    part.ssot__AiAgentSessionId__c AS sessionId,
    MAX(part.ssot__AiAgentApiName__c) AS agentApiName
  FROM ssot__AiAgentSessionParticipant__dlm part
  WHERE part.ssot__AiAgentApiName__c IS NOT NULL
  GROUP BY part.ssot__AiAgentSessionId__c
)
SELECT
  fb.userName,
  fb.conversationDate,
  fb.feedbackSentiment,
  fb.feedbackMessage,
  fb.userUtterance,
  fb.agentResponse,
  fb.conversationId,
  fb.gatewayRequestId,
  sess.sessionId,
  agent.agentApiName AS agentApiName
FROM feedback_cte fb
LEFT JOIN (SELECT gatewayRequestId, sessionId FROM session_lookup WHERE rowNum = 1) sess ON sess.gatewayRequestId = fb.gatewayRequestId
LEFT JOIN session_agent_info agent ON agent.sessionId = sess.sessionId
${excludedSessionClause}
ORDER BY fb.conversationDate DESC
;
`;

  return AGENTFORCE_FEEDBACK_QUERY;
}

interface FeedbackStats {
  totalCount: number;
  goodCount: number;
  badCount: number;
}

function computeFeedbackStats(records: AgentforceCsvRecord[]): FeedbackStats {
  let goodCount = 0;
  let badCount = 0;
  records.forEach((record) => {
    const normalizedType = normalizeFeedbackType(record["Feedback type"]);
    if (normalizedType === 'GOOD') {
      goodCount += 1;
    } else if (normalizedType === 'BAD') {
      badCount += 1;
    }
  });
  return { totalCount: records.length, goodCount, badCount };
}

function buildNotificationText(stats: FeedbackStats, filters: AgentforceQueryFilters): string {
  const lines = [`Agentforce feedback summary: ${stats.goodCount} GOOD / ${stats.badCount} BAD (total ${stats.totalCount}).`];
  const windowDescription = describeFeedbackDateRange(filters);
  if (windowDescription) {
    lines.push(windowDescription);
  }
  return lines.join('\n');
}

function describeFeedbackDateRange(filters: AgentforceQueryFilters): string | null {
  if (!filters.dateFrom && !filters.dateTo) {
    return null;
  }
  if (filters.dateFrom && filters.dateTo) {
    return `Window: ${filters.dateFrom} → ${filters.dateTo}`;
  }
  if (filters.dateFrom) {
    return `Window starting ${filters.dateFrom}`;
  }
  return `Window until ${filters.dateTo}`;
}

function normalizeFeedbackType(value: string): string {
  return (value || '').trim().toUpperCase();
}

function collectFeedbackReportFiles(outputFilesRes: any): string[] {
  const files: string[] = [];
  if (outputFilesRes?.xlsxFile) {
    files.push(outputFilesRes.xlsxFile);
  }
  return files;
}

