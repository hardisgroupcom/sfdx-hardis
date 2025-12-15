import { Connection, Messages } from "@salesforce/core";
import { Flags, requiredOrgFlagWithDeprecations, SfCommand } from "@salesforce/sf-plugins-core";
import { AnyJson } from "@salesforce/ts-types";
import { dataCloudSqlQuery } from "../../../../common/utils/dataCloudUtils.js";
import { uxLog } from "../../../../common/utils/index.js";
import { generateCsvFile, generateReportPath } from "../../../../common/utils/filesUtils.js";

const excludedConversationIds = [
  //  '26db0dae-7c84-4b45-937f-b30a79d69697',
  // '2533ccb9-f5ef-4f67-adb4-a6035f5055bf',
  '8981bfeb-d3e8-4085-b515-d26e54fdff88'
];
const excludedConversationFilter = excludedConversationIds.length
  ? ` AND gar.generationGroupId__c NOT IN (${excludedConversationIds.map((id) => `'${id}'`).join(', ')})`
  : '';

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
  WHERE gaf.feedback__c IN ('GOOD','BAD')${excludedConversationFilter}
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
ORDER BY fb.conversationDate DESC
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
    'conversation-link-domain': Flags.string({
      description: 'Lightning Experience domain used to build clickable conversation links (example: https://myorg.lightning.force.com)',
    }),
    'conversation-agent-api': Flags.string({
      description: 'Optional override for the Agent API name query parameter embedded in the conversation link',
    }),
    'conversation-time-filter': Flags.integer({
      description: 'Time filter (days) appended to the Lightning analytics URL when generating conversation links',
      default: 30,
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
    const conversationLinkDomain = flags['conversation-link-domain'] || null;
    const agentApiNameOverride = flags['conversation-agent-api'] || null;
    const timeFilterFlag = flags['conversation-time-filter'];
    const timeFilterDays = Number.isFinite(timeFilterFlag) && timeFilterFlag > 0 ? timeFilterFlag : 30;

    this.queryString = AGENTFORCE_FEEDBACK_QUERY.trim();

    const rawResult = await dataCloudSqlQuery(this.queryString, conn, {});
    const sessionIds = extractSessionIds(rawResult.records);
    const transcriptsBySession = await fetchConversationTranscripts(sessionIds, conn);
    const exportRecords = buildAgentforceFeedbackRecords(rawResult.records, {
      conversationLinkDomain,
      agentApiNameOverride,
      timeFilterDays,
      transcriptsBySession,
    });
    const result = { ...rawResult, records: exportRecords, returnedRows: exportRecords.length };

    const { records: _records, ...resultCopy } = result;
    void _records;
    uxLog("other", this, JSON.stringify(resultCopy, null, 2));

    this.outputFile = await generateReportPath('datacloud-agentforce-feedback', this.outputFile);
    this.outputFilesRes = await generateCsvFile(exportRecords, this.outputFile, { fileTitle: 'DataCloud Agentforce Feedback' });

    return { sqlResult: JSON.parse(JSON.stringify(result)) };
  }
}

interface ConversationLinkOptions {
  conversationLinkDomain: string | null;
  agentApiNameOverride: string | null;
  timeFilterDays: number;
}

interface AgentforceRecordOptions extends ConversationLinkOptions {
  transcriptsBySession: Map<string, string>;
}

interface AgentforceCsvRecord {
  "User": string;
  "ConversationDate": string;
  "Feedback GOOD/BAD": string;
  "Message containing GOOD/BAD": string;
  "Full conversation": string;
  "ConversationId": string;
  "Conversation URL": string;
}

function buildAgentforceFeedbackRecords(records: AnyJson[] | undefined, options: AgentforceRecordOptions) {
  const safeRecords = Array.isArray(records) ? records : [];
  const safeOptions: AgentforceRecordOptions = options || {
    conversationLinkDomain: null,
    agentApiNameOverride: null,
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
      agentApiName: safeOptions.agentApiNameOverride || agentApiName,
      timeFilterDays: safeOptions.timeFilterDays,
    });

    const exportRecord: AgentforceCsvRecord = {
      "User": userName,
      "ConversationDate": conversationDate,
      "Feedback GOOD/BAD": feedbackValue,
      "Message containing GOOD/BAD": feedbackMessage,
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

function buildConversationUrl(params: {
  domain: string | null;
  conversationId: string;
  sessionId: string;
  agentApiName?: string;
  timeFilterDays: number;
}): string {
  const { domain, conversationId, sessionId, agentApiName, timeFilterDays } = params;
  if (!domain || !conversationId || !sessionId) {
    return '';
  }
  const normalizedDomain = normalizeLightningDomain(domain);
  if (!normalizedDomain) {
    return '';
  }
  const baseUrl = `${normalizedDomain}/lightning/cmp/runtime_analytics_evf_aie__record`;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return '';
  }
  url.searchParams.set('c__id', conversationId);
  url.searchParams.set('c__type', '2');
  url.searchParams.set('c__sessionId', sessionId);
  url.searchParams.set('c__timeFilter', String(timeFilterDays > 0 ? timeFilterDays : 30));
  if (agentApiName) {
    url.searchParams.set('c__agentApiName', agentApiName);
  }
  return url.toString();
}

function normalizeLightningDomain(domain: string): string | null {
  const trimmed = domain.trim();
  if (!trimmed) {
    return null;
  }
  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');
  const withProtocol = /^https?:\/\//i.test(withoutTrailingSlash) ? withoutTrailingSlash : `https://${withoutTrailingSlash}`;
  try {
    const parsed = new URL(withProtocol);
    return parsed.origin;
  } catch {
    return null;
  }
}

function extractSessionIds(records: AnyJson[] | undefined): string[] {
  const safeRecords = Array.isArray(records) ? records : [];
  const sessionIdSet = new Set<string>();
  safeRecords.forEach((record) => {
    if (!record || typeof record !== 'object') {
      return;
    }
    const normalized = normalizeKeys(record as Record<string, AnyJson>);
    const sessionId = stringValue(normalized["sessionid"] ?? normalized["ssot__aiagentsessionid__c"]);
    if (sessionId) {
      sessionIdSet.add(sessionId);
    }
  });
  return Array.from(sessionIdSet);
}

async function fetchConversationTranscripts(sessionIds: string[], conn: Connection): Promise<Map<string, string>> {
  const transcripts = new Map<string, string>();
  const uniqueIds = Array.from(new Set(sessionIds.filter((id) => Boolean(id))));
  if (!uniqueIds.length) {
    return transcripts;
  }

  const transcriptBuckets = new Map<string, { speaker: string; text: string; timestamp: string }[]>();
  const chunks = chunkArray(uniqueIds, 25);

  for (const chunk of chunks) {
    if (!chunk.length) {
      continue;
    }
    const quotedIds = chunk.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
    const transcriptQuery = `
      SELECT
        ai.ssot__AiAgentSessionId__c AS sessionId,
        msg.ssot__MessageSentTimestamp__c AS messageTimestamp,
        msg.ssot__AiAgentInteractionMessageType__c AS messageType,
        msg.ssot__ContentText__c AS messageText,
        part.ssot__AiAgentSessionParticipantRole__c AS participantRole
      FROM ssot__AiAgentInteractionMessage__dlm msg
      JOIN ssot__AiAgentInteraction__dlm ai ON ai.ssot__Id__c = msg.ssot__AiAgentInteractionId__c
      LEFT JOIN ssot__AiAgentSessionParticipant__dlm part ON part.ssot__Id__c = msg.ssot__AiAgentSessionParticipantId__c
      WHERE ai.ssot__AiAgentSessionId__c IN (${quotedIds})
      ORDER BY ai.ssot__AiAgentSessionId__c, msg.ssot__MessageSentTimestamp__c
    `;

    const transcriptResult = await dataCloudSqlQuery(transcriptQuery.trim(), conn, {});
    const rows = Array.isArray(transcriptResult.records) ? transcriptResult.records : [];
    rows.forEach((row) => {
      const normalized = normalizeKeys(row as Record<string, AnyJson>);
      const sessionId = stringValue(normalized["sessionid"] ?? normalized["ssot__aiagentsessionid__c"]);
      if (!sessionId) {
        return;
      }
      const messageType = stringValue(normalized["messagetype"] ?? normalized["ssot__aiagentinteractionmessagetype__c"]);
      const messageText = stringValue(normalized["messagetext"] ?? normalized["ssot__contenttext__c"]);
      const timestamp = stringValue(normalized["messagetimestamp"] ?? normalized["ssot__messagesenttimestamp__c"]);
      const participantRole = stringValue(normalized["participantrole"] ?? normalized["ssot__aiagentsessionparticipantrole__c"]);
      const bucket = transcriptBuckets.get(sessionId) || [];
      bucket.push({
        speaker: inferSpeaker(participantRole, messageType),
        text: messageText,
        timestamp,
      });
      transcriptBuckets.set(sessionId, bucket);
    });
  }

  transcriptBuckets.forEach((messages, sessionId) => {
    const formatted = messages
      .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0))
      .map((message) => `${message.speaker}: ${message.text}`)
      .join('\n---\n');
    transcripts.set(sessionId, formatted);
  });

  return transcripts;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    return [items];
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function inferSpeaker(participantRole: string, messageType: string): 'USER' | 'AGENT' {
  const normalizedRole = (participantRole || '').trim().toUpperCase();
  if (normalizedRole.includes('AGENT') || normalizedRole === 'BOT' || normalizedRole === 'SYSTEM') {
    return 'AGENT';
  }
  if (normalizedRole) {
    return 'USER';
  }
  const normalizedType = (messageType || '').trim().toUpperCase();
  if (normalizedType.includes('USER')) {
    return 'USER';
  }
  return 'AGENT';
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

