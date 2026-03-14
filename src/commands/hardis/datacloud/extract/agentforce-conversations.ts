import { Messages } from "@salesforce/core";
import { Flags, requiredOrgFlagWithDeprecations, SfCommand } from "@salesforce/sf-plugins-core";
import { AnyJson } from "@salesforce/ts-types";
import { dataCloudSqlQuery } from "../../../../common/utils/dataCloudUtils.js";
import { uxLog } from "../../../../common/utils/index.js";
import { generateCsvFile, generateReportPath } from "../../../../common/utils/filesUtils.js";
import { NotifProvider } from "../../../../common/notifProvider/index.js";
import { setConnectionVariables } from "../../../../common/utils/orgUtils.js";
import c from "chalk";
import {
  AgentforceQueryFilters,
  buildConversation,
  buildConversationUrl,
  buildDateFilterClause,
  buildExcludedSessionFilter,
  extractSessionIds,
  extractSpeakerSegment,
  fetchConversationTranscripts,
  normalizeKeys,
  pickFirstMeaningfulValue,
  resolveConversationLinkDomain,
  resolveDateFilterOptions,
  resolveExcludedConversationIds,
  sanitizePlaceholderValue,
  stringValue,
} from "../../../../common/utils/agentforceQueryUtils.js";
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DataCloudExtractAgentforceConversations extends SfCommand<any> {
  public static title = 'Extract Agentforce Conversations Data from Data Cloud';

  public static description = `
## Command Behavior

**Extracts Agentforce conversations data from Data Cloud and generates a detailed report.**

This command allows you to retrieve and analyze conversations between users and Agentforce agents. It fetches conversation details, including transcripts, user utterances, agent responses, and any associated feedback.

Key functionalities:

- **Data Extraction:** Queries Data Cloud for Agentforce conversation records.
- **Transcript Retrieval:** Fetches full conversation transcripts associated with the sessions.
- **Filtering:** Supports filtering by date range (from/to) or a rolling window (last N days).
- **Report Generation:** Creates a CSV and XLSX report containing:
  - User information
  - Date and time
  - Full conversation transcript
  - Feedback sentiment and message (if available)
  - Direct link to the conversation in Salesforce
- **Link Generation:** Generates clickable URLs to view the conversation in the Agentforce Analytics dashboard.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Data Cloud Query:** Executes a SQL query against Data Cloud tables (\`GenAIGeneration__dlm\`, \`GenAIGatewayRequest__dlm\`, etc.) to retrieve conversation metadata and individual turns.
- **Session Management:** Extracts session IDs from the initial query results.
- **Transcript Fetching:** Asynchronously fetches full conversation transcripts for the identified sessions in chunks to handle large volumes efficiently.
- **Data Merging:** Combines the SQL query results with the fetched transcripts, prioritizing full transcripts over individual turn data when available.
- **URL Construction:** dynamically builds deep links to the Salesforce Lightning Experience for each conversation based on the org's instance URL and conversation ID.
- **File Output:** Uses \`generateCsvFile\` to output the processed data into CSV and XLSX formats with custom column widths and formatting.
- **Exclusion Filters:** Supports excluding specific conversations or sessions via environment variables \`AGENTFORCE_FEEDBACK_EXCLUDED_CONV_IDS\` and \`AGENTFORCE_EXCLUDED_SESSION_IDS\` (comma-separated IDs).
</details>
`;

  public static examples = [
    '$ sf hardis:datacloud:extract:agentforce-conversations',
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
    const { flags } = await this.parse(DataCloudExtractAgentforceConversations);
    this.outputFile = flags.outputfile || null;
    this.debugMode = flags.debug || false;
    const conn = flags['target-org'].getConnection();

    const conversationLinkDomain = resolveConversationLinkDomain(conn.instanceUrl);
    const dateFilterOptions = resolveDateFilterOptions({
      dateFromInput: flags['date-from'],
      dateToInput: flags['date-to'],
      lastNDaysInput: flags['last-n-days'],
    });
    this.queryString = buildConversationQuery(dateFilterOptions).trim();

    uxLog("action", this, c.cyan(t('queryingAgentforceConversations')));
    const rawResult = await dataCloudSqlQuery(this.queryString, conn, {});
    const sessionIds = extractSessionIds(rawResult.records, { sanitizer: sanitizePlaceholderValue });
    uxLog("action", this, c.cyan(t('fetchingConversationTranscripts')));
    const transcriptsBySession = await fetchConversationTranscripts(sessionIds, conn, {
      chunkSize: 50,
      sanitizeSessionId: sanitizePlaceholderValue,
    });
    uxLog("action", this, c.cyan(t('buildingExportRecords')));
    const exportRecords = buildConversationRecords(rawResult.records, {
      conversationLinkDomain,
      transcriptsBySession,
      timeFilterDays: DEFAULT_CONVERSATION_TIME_FILTER_DAYS,
    });

    const result = { ...rawResult, records: exportRecords, returnedRows: exportRecords.length };
    const { records: _records, ...resultCopy } = result;
    void _records;
    uxLog("other", this, JSON.stringify(resultCopy, null, 2));

    this.outputFile = await generateReportPath('datacloud-agentforce-conversations', this.outputFile);
    this.outputFilesRes = await generateCsvFile(exportRecords, this.outputFile, {
      fileTitle: 'DataCloud Agentforce Conversations',
      columnsCustomStyles: {
        'DateTime': { width: 26 },
        'Conversation transcript': { width: 90, wrap: true, maxHeight: 50 },
        'Feedback': { width: 12 },
        'Feedback message': { width: 45, wrap: true, maxHeight: 50 },
        'ConversationId': { width: 36 },
        'ConversationUrl': { width: 80, hyperlinkFromValue: true },
      },
    });

    const conversationStats = computeConversationStats(exportRecords);
    const notifText = buildConversationNotificationText(conversationStats, dateFilterOptions);
    const attachedFiles = collectConversationReportFiles(this.outputFilesRes);
    uxLog("action", this, c.cyan(notifText));

    await setConnectionVariables(conn);
    await NotifProvider.postNotifications({
      type: 'AGENTFORCE_CONVERSATIONS',
      text: notifText,
      buttons: [],
      attachments: [],
      severity: 'log',
      attachedFiles,
      logElements: [],
      data: { metric: conversationStats.totalCount },
      metrics: {
        agentforceConversationCount: conversationStats.totalCount,
        agentforceConversationFeedbackCount: conversationStats.withFeedback,
        agentforceConversationFeedbackBad: conversationStats.feedbackBad,
        agentforceConversationFeedbackGood: conversationStats.feedbackGood,
      },
      alwaysSend: true,
    });

    return {
      result: JSON.parse(JSON.stringify(result)),
      csvLogFile: this.outputFile,
      xlsxLogFile: this.outputFilesRes?.xlsxFile,
      conversationCount: exportRecords.length
    };
  }
}

interface ConversationRecordOptions {
  conversationLinkDomain: string | null;
  transcriptsBySession: Map<string, string>;
  timeFilterDays: number;
}

interface ConversationCsvRecord {
  "User": string;
  "DateTime": string;
  "Conversation transcript": string;
  "Feedback": string;
  "Feedback message": string;
  "ConversationId": string;
  "ConversationUrl": string;
}

const DEFAULT_CONVERSATION_TIME_FILTER_DAYS = 365;

function buildConversationQuery(filters: AgentforceQueryFilters = {}): string {
  const dateFilterClause = buildDateFilterClause(filters);
  const excludedConversationClause = buildExcludedConversationFilter();
  const excludedSessionClause = buildExcludedSessionFilter();
  return `
WITH conversation_base AS (
  SELECT
    COALESCE(usr.ssot__username__c, gar.userId__c) AS userName,
    ggn.timestamp__c AS conversationDate,
    gar.generationGroupId__c AS conversationId,
    gar.gatewayRequestId__c AS gatewayRequestId,
    gat.tagValue__c AS userUtterance,
    ggn.responseText__c AS agentResponse,
    ROW_NUMBER() OVER (
      PARTITION BY gar.generationGroupId__c
      ORDER BY ggn.timestamp__c DESC,
        gar.gatewayRequestId__c DESC
    ) AS rowNum
  FROM GenAIGeneration__dlm ggn
  JOIN GenAIGatewayResponse__dlm grs ON ggn.generationResponseId__c = grs.generationResponseId__c
  JOIN GenAIGatewayRequest__dlm gar ON grs.generationRequestId__c = gar.gatewayRequestId__c
    LEFT JOIN GenAIGatewayRequestTag__dlm gat ON gar.gatewayRequestId__c = gat.parent__c AND gat.tag__c = 'user_utterance'
    LEFT JOIN ssot__User__dlm usr ON usr.ssot__Id__c = gar.userId__c
    WHERE gar.generationGroupId__c IS NOT NULL${excludedConversationClause}${dateFilterClause}
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
  ), latest_feedback AS (
    SELECT
      gaf.generationGroupId__c AS conversationId,
      gaf.feedback__c AS feedbackSentiment,
      gfd.feedbackText__c AS feedbackMessage,
      COALESCE(
        gaf.timestamp__c,
        TIMESTAMP '1900-01-01 00:00:00Z'
      ) AS feedbackTimestamp,
      ROW_NUMBER() OVER (
        PARTITION BY gaf.generationGroupId__c
        ORDER BY COALESCE(
          gaf.timestamp__c,
          TIMESTAMP '1900-01-01 00:00:00Z'
        ) DESC,
        gaf.feedbackId__c DESC
      ) AS rowNum
    FROM GenAIFeedback__dlm gaf
    LEFT JOIN GenAIFeedbackDetail__dlm gfd ON gaf.feedbackId__c = gfd.parent__c
    ), conversation_primary AS (
      SELECT *
      FROM conversation_base
      WHERE rowNum = 1
  )
SELECT
  base.userName,
  base.conversationDate,
  base.conversationId,
  base.gatewayRequestId,
  sess.sessionId,
  agent.agentApiName,
  base.userUtterance,
  base.agentResponse,
  fb.feedbackSentiment,
  fb.feedbackMessage
FROM conversation_primary base
LEFT JOIN (SELECT gatewayRequestId, sessionId FROM session_lookup WHERE rowNum = 1) sess ON sess.gatewayRequestId = base.gatewayRequestId
LEFT JOIN session_agent_info agent ON agent.sessionId = sess.sessionId
LEFT JOIN (
  SELECT conversationId, feedbackSentiment, feedbackMessage
  FROM latest_feedback
  WHERE rowNum = 1
) fb ON fb.conversationId = base.conversationId
${excludedSessionClause}
ORDER BY base.conversationDate DESC
;
`;
}

function buildConversationRecords(records: AnyJson[] | undefined, options: ConversationRecordOptions): ConversationCsvRecord[] {
  const safeRecords = Array.isArray(records) ? records : [];
  const safeOptions: ConversationRecordOptions = options || {
    conversationLinkDomain: null,
    transcriptsBySession: new Map<string, string>(),
    timeFilterDays: DEFAULT_CONVERSATION_TIME_FILTER_DAYS,
  };

  const dedupMap = new Map<string, { record: ConversationCsvRecord; conversationDate: string }>();

  safeRecords.forEach((record) => {
    const normalized = normalizeKeys(record as Record<string, AnyJson>);
    const conversationDate = stringValue(normalized["conversationdate"] ?? normalized["timestamp__c"]);
    const userName = sanitizePlaceholderValue(stringValue(normalized["username"] ?? normalized["userid"]));
    const rawSessionId = stringValue(normalized["sessionid"] ?? normalized["ssot__aiagentsessionid__c"]);
    const sessionId = sanitizePlaceholderValue(rawSessionId);
    const agentApiName = sanitizePlaceholderValue(stringValue(normalized["agentapiname"] ?? normalized["ssot__aiagentapiname__c"]));
    const conversationId = sanitizePlaceholderValue(stringValue(normalized["conversationid"] ?? normalized["generationgroupid__c"]));
    const baseUserUtterance = stringValue(normalized["userutterance"] ?? normalized["tagvalue__c"]);
    const baseAgentResponse = stringValue(normalized["agentresponse"] ?? normalized["responsetext"]);
    const feedbackValueRaw = sanitizePlaceholderValue(stringValue(normalized["feedbacksentiment"] ?? normalized["feedback__c"]));
    const feedbackValue = feedbackValueRaw ? feedbackValueRaw.toUpperCase() : '';
    const feedbackMessage = sanitizePlaceholderValue(stringValue(normalized["feedbackmessage"] ?? normalized["feedbacktext__c"]));
    const transcript = sessionId ? safeOptions.transcriptsBySession.get(sessionId) || '' : '';
    const transcriptUserUtterance = extractSpeakerSegment(transcript, 'USER');
    const transcriptAgentResponse = extractSpeakerSegment(transcript, 'AGENT');
    const resolvedUserUtterance = pickFirstMeaningfulValue([baseUserUtterance, transcriptUserUtterance]);
    const resolvedAgentResponse = pickFirstMeaningfulValue([baseAgentResponse, transcriptAgentResponse]);
    const conversation = transcript || buildConversation(resolvedUserUtterance, resolvedAgentResponse);
    const conversationUrl = buildConversationUrl({
      domain: safeOptions.conversationLinkDomain,
      conversationId,
      sessionId,
      agentApiName,
      timeFilterDays: safeOptions.timeFilterDays,
    });

    if (!conversationId || !conversationUrl) {
      return;
    }

    const exportRecord: ConversationCsvRecord = {
      "User": userName,
      "DateTime": conversationDate,
      "Conversation transcript": conversation,
      "Feedback": feedbackValue,
      "Feedback message": feedbackMessage,
      "ConversationId": conversationId,
      "ConversationUrl": conversationUrl,
    };

    const dedupKey = sessionId || conversationId || conversationUrl;
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

interface ConversationStats {
  totalCount: number;
  withFeedback: number;
  feedbackBad: number;
  feedbackGood: number;
}

function computeConversationStats(records: ConversationCsvRecord[]): ConversationStats {
  let withFeedback = 0;
  let feedbackBad = 0;
  let feedbackGood = 0;
  records.forEach((record) => {
    const feedback = (record["Feedback"] || "").trim().toUpperCase();
    if (feedback) {
      withFeedback += 1;
      if (feedback === "BAD") {
        feedbackBad += 1;
      } else if (feedback === "GOOD") {
        feedbackGood += 1;
      }
    }
  });
  return {
    totalCount: records.length,
    withFeedback,
    feedbackBad,
    feedbackGood,
  };
}

function buildConversationNotificationText(stats: ConversationStats, filters: AgentforceQueryFilters): string {
  const lines = [
    `Agentforce conversations exported: ${stats.totalCount} (with feedback: ${stats.withFeedback}, GOOD: ${stats.feedbackGood}, BAD: ${stats.feedbackBad}).`,
  ];
  if (filters.dateFrom && filters.dateTo) {
    lines.push(`Window: ${filters.dateFrom} → ${filters.dateTo}`);
  } else if (filters.dateFrom) {
    lines.push(`Window starting ${filters.dateFrom}`);
  } else if (filters.dateTo) {
    lines.push(`Window until ${filters.dateTo}`);
  }
  return lines.join('\n');
}

function collectConversationReportFiles(outputFilesRes: any): string[] {
  const files: string[] = [];
  if (outputFilesRes?.xlsxFile) {
    files.push(outputFilesRes.xlsxFile);
  }
  return files;
}

function buildExcludedConversationFilter(): string {
  const excludedConversationIds = resolveExcludedConversationIds();
  if (!excludedConversationIds.length) {
    return '';
  }
  return ` AND gar.generationGroupId__c NOT IN (${excludedConversationIds.map((id) => `'${id}'`).join(', ')})`;
}

