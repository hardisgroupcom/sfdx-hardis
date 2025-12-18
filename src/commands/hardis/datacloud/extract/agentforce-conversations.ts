import { Connection, Messages, SfError } from "@salesforce/core";
import { Flags, requiredOrgFlagWithDeprecations, SfCommand } from "@salesforce/sf-plugins-core";
import { AnyJson } from "@salesforce/ts-types";
import { dataCloudSqlQuery } from "../../../../common/utils/dataCloudUtils.js";
import { uxLog } from "../../../../common/utils/index.js";
import { generateCsvFile, generateReportPath } from "../../../../common/utils/filesUtils.js";
import c from "chalk";

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DataCloudExtractAgentforceConversations extends SfCommand<any> {
  public static title = 'Extract Agentforce Conversations Data from Data Cloud';

  public static description = `
## Command Behavior

Key functionalities:

<details markdown="1">
<summary>Technical explanations</summary>
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

    uxLog("action", this, c.cyan("Querying Agentforce conversations..."));
    const rawResult = await dataCloudSqlQuery(this.queryString, conn, {});
    const sessionIds = extractSessionIds(rawResult.records);
    uxLog("action", this, c.cyan("Fetching conversation transcripts..."));
    const transcriptsBySession = await fetchConversationTranscripts(sessionIds, conn);
    uxLog("action", this, c.cyan("Building export records..."));
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

interface AgentforceQueryFilters {
  dateFrom?: string;
  dateTo?: string;
}

interface DateFilterOptionsInput {
  dateFromInput?: string;
  dateToInput?: string;
  lastNDaysInput?: number;
}

const DEFAULT_CONVERSATION_TIME_FILTER_DAYS = 365;
const DEFAULT_EXCLUDED_CONVERSATION_IDS = [
  '8981bfeb-d3e8-4085-b515-d26e54fdff88',
  'df15617e-5a56-46b4-aed6-22c81efb4ccd',
];
const DEFAULT_EXCLUDED_SESSION_IDS = [
  '019a6d20-ba17-7b97-a658-b01176754b78',
  '019a6e05-fa89-7a0d-9b1e-46290e13c3e2',
  '019b1365-3f29-7347-866d-16a9355aa32b',
];

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

  const filteredRecords: ConversationCsvRecord[] = [];
  const seenConversationIds = new Set<string>();

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

    if (seenConversationIds.has(conversationId)) {
      return;
    }
    seenConversationIds.add(conversationId);

    filteredRecords.push({
      "User": userName,
      "DateTime": conversationDate,
      "Conversation transcript": conversation,
      "Feedback": feedbackValue,
      "Feedback message": feedbackMessage,
      "ConversationId": conversationId,
      "ConversationUrl": conversationUrl,
    });
  });

  return filteredRecords;
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
    return sanitizeUnicodeString(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return sanitizeUnicodeString(String(value));
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
  try {
    const url = new URL(baseUrl);
    url.searchParams.set('c__id', conversationId);
    url.searchParams.set('c__type', '2');
    url.searchParams.set('c__sessionId', sessionId);
    url.searchParams.set('c__timeFilter', String(timeFilterDays > 0 ? timeFilterDays : DEFAULT_CONVERSATION_TIME_FILTER_DAYS));
    if (agentApiName) {
      url.searchParams.set('c__agentApiName', agentApiName);
    }
    return url.toString();
  } catch {
    return '';
  }
}

function resolveConversationLinkDomain(instanceUrl?: string): string | null {
  if (!instanceUrl) {
    return null;
  }
  try {
    const parsed = new URL(instanceUrl);
    let host = parsed.hostname;
    if (host.endsWith('.my.salesforce.com')) {
      host = host.replace('.my.salesforce.com', '.lightning.force.com');
    } else if (host.endsWith('.salesforce.com') && !host.includes('.lightning.')) {
      host = host.replace('.salesforce.com', '.lightning.force.com');
    }
    const potentialDomain = `${parsed.protocol}//${host}`;
    return normalizeLightningDomain(potentialDomain) || normalizeLightningDomain(parsed.origin);
  } catch {
    return null;
  }
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
    const sessionId = sanitizePlaceholderValue(stringValue(normalized["sessionid"] ?? normalized["ssot__aiagentsessionid__c"]));
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
  const chunks = chunkArray(uniqueIds, 50);

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
      const sessionId = sanitizePlaceholderValue(stringValue(normalized["sessionid"] ?? normalized["ssot__aiagentsessionid__c"]));
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

function resolveDateFilterOptions(inputs: DateFilterOptionsInput): AgentforceQueryFilters {
  const { dateFromInput, dateToInput, lastNDaysInput } = inputs;
  const parsedFrom = parseDateInput(dateFromInput, '--date-from');
  const parsedTo = parseDateInput(dateToInput, '--date-to');

  let effectiveFrom = parsedFrom;
  let effectiveTo = parsedTo;

  if (lastNDaysInput !== undefined && lastNDaysInput !== null) {
    if (!Number.isFinite(lastNDaysInput) || lastNDaysInput <= 0) {
      throw new SfError('--last-n-days must be a positive integer');
    }
    const now = new Date();
    const relativeFrom = new Date(now);
    relativeFrom.setUTCDate(relativeFrom.getUTCDate() - lastNDaysInput);
    effectiveFrom = chooseLaterDate(effectiveFrom, relativeFrom);
    effectiveTo = chooseEarlierDate(effectiveTo, now);
  }

  if (effectiveFrom && effectiveTo && effectiveFrom.getTime() > effectiveTo.getTime()) {
    throw new SfError('Date filters are inconsistent: start date is after end date');
  }

  const filters: AgentforceQueryFilters = {};
  if (effectiveFrom) {
    filters.dateFrom = effectiveFrom.toISOString();
  }
  if (effectiveTo) {
    filters.dateTo = effectiveTo.toISOString();
  }
  return filters;
}

function parseDateInput(value: string | undefined, flagName: string): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new SfError(`Invalid ${flagName} value. Use ISO-8601 format, e.g. 2024-08-01T00:00:00Z`);
  }
  return parsed;
}

function chooseLaterDate(first: Date | null, second: Date | null): Date | null {
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }
  return first.getTime() >= second.getTime() ? first : second;
}

function chooseEarlierDate(first: Date | null, second: Date | null): Date | null {
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }
  return first.getTime() <= second.getTime() ? first : second;
}

function buildDateFilterClause(filters: AgentforceQueryFilters): string {
  const clauses: string[] = [];
  if (filters.dateFrom) {
    clauses.push(` AND ggn.timestamp__c >= TIMESTAMP '${escapeSqlLiteral(filters.dateFrom)}'`);
  }
  if (filters.dateTo) {
    clauses.push(` AND ggn.timestamp__c <= TIMESTAMP '${escapeSqlLiteral(filters.dateTo)}'`);
  }
  return clauses.join('');
}

function buildExcludedConversationFilter(): string {
  const excludedConversationIds = resolveExcludedConversationIds();
  if (!excludedConversationIds.length) {
    return '';
  }
  return ` AND gar.generationGroupId__c NOT IN (${excludedConversationIds.map((id) => `'${id}'`).join(', ')})`;
}

function buildExcludedSessionFilter(): string {
  const excludedSessionIds = resolveExcludedSessionIds();
  if (!excludedSessionIds.length) {
    return '';
  }
  return `
WHERE (sess.sessionId IS NULL OR sess.sessionId NOT IN (${excludedSessionIds.map((id) => `'${id}'`).join(', ')}))`;
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function resolveExcludedConversationIds(): string[] {
  const envValue = process.env.AGENTFORCE_FEEDBACK_EXCLUDED_CONV_IDS;
  if (envValue) {
    return envValue.split(',').map((id) => id.trim()).filter((id) => id);
  }
  return [...DEFAULT_EXCLUDED_CONVERSATION_IDS];
}

function resolveExcludedSessionIds(): string[] {
  const envValue = process.env.AGENTFORCE_EXCLUDED_SESSION_IDS;
  if (envValue) {
    return envValue.split(',').map((id) => id.trim()).filter((id) => id);
  }
  return [...DEFAULT_EXCLUDED_SESSION_IDS];
}

const PLACEHOLDER_VALUES = new Set(['NOT_SET', 'UNKNOWN', 'UNDEFINED', 'NULL', 'NONE', 'N/A']);

function sanitizePlaceholderValue(value: string): string {
  const trimmed = value ? value.trim() : '';
  if (!trimmed) {
    return '';
  }
  if (PLACEHOLDER_VALUES.has(trimmed.toUpperCase())) {
    return '';
  }
  return trimmed;
}

function pickFirstMeaningfulValue(values: string[]): string {
  for (const value of values) {
    const cleaned = sanitizePlaceholderValue(value);
    if (cleaned) {
      return cleaned;
    }
  }
  return '';
}

function extractSpeakerSegment(transcript: string, speaker: 'USER' | 'AGENT'): string {
  if (!transcript) {
    return '';
  }
  const prefix = `${speaker}:`;
  const segments = transcript.split(/\n---\n/);
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (trimmed.toUpperCase().startsWith(prefix)) {
      return sanitizePlaceholderValue(trimmed.slice(prefix.length).trim());
    }
  }
  return '';
}

function sanitizeUnicodeString(input: string): string {
  if (!input) {
    return '';
  }
  let needsCleanup = false;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdfff) {
      needsCleanup = true;
      break;
    }
  }
  if (!needsCleanup) {
    return input;
  }

  const buffer: number[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        buffer.push(code, next);
        i += 1;
        continue;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      continue;
    }
    buffer.push(code);
  }

  if (!buffer.length) {
    return '';
  }
  let result = '';
  const CHUNK_SIZE = 60000;
  for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
    result += String.fromCharCode(...buffer.slice(i, i + CHUNK_SIZE));
  }
  return result;
}

