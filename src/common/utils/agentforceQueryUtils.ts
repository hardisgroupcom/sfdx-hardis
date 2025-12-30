import { Connection, SfError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { dataCloudSqlQuery } from "./dataCloudUtils.js";

export interface AgentforceQueryFilters {
  dateFrom?: string;
  dateTo?: string;
}

export interface DateFilterOptionsInput {
  dateFromInput?: string;
  dateToInput?: string;
  lastNDaysInput?: number;
}

interface ExtractSessionOptions {
  sanitizer?: (value: string) => string;
}

interface FetchTranscriptOptions {
  chunkSize?: number;
  sanitizeSessionId?: (value: string) => string;
}

const DEFAULT_EXCLUDED_CONVERSATION_IDS = [
  "8981bfeb-d3e8-4085-b515-d26e54fdff88",
  "df15617e-5a56-46b4-aed6-22c81efb4ccd",
];

const DEFAULT_EXCLUDED_SESSION_IDS = [
  "019a6d20-ba17-7b97-a658-b01176754b78",
  "019a6e05-fa89-7a0d-9b1e-46290e13c3e2",
  "019b1365-3f29-7347-866d-16a9355aa32b",
];

const PLACEHOLDER_VALUES = new Set(["NOT_SET", "UNKNOWN", "UNDEFINED", "NULL", "NONE", "N/A"]);

export function normalizeKeys(record: Record<string, AnyJson>): Record<string, AnyJson> {
  return Object.entries(record).reduce<Record<string, AnyJson>>((acc, [key, value]) => {
    acc[key.toLowerCase()] = value;
    return acc;
  }, {});
}

export function sanitizeUnicodeString(input: string): string {
  if (!input) {
    return "";
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
    return "";
  }

  let result = "";
  const CHUNK_SIZE = 60000;
  for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
    result += String.fromCharCode(...buffer.slice(i, i + CHUNK_SIZE));
  }
  return result;
}

export function stringValue(value: AnyJson): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return sanitizeUnicodeString(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return sanitizeUnicodeString(String(value));
}

export function buildConversation(userUtterance: string, agentResponse: string): string {
  const parts: string[] = [];
  if (userUtterance) {
    parts.push(`USER: ${userUtterance}`);
  }
  if (agentResponse) {
    parts.push(`AGENT: ${agentResponse}`);
  }
  return parts.join("\n---\n");
}

export function buildConversationUrl(params: {
  domain: string | null;
  conversationId: string;
  sessionId: string;
  agentApiName?: string;
  timeFilterDays: number;
}): string {
  const { domain, conversationId, sessionId, agentApiName, timeFilterDays } = params;
  if (!domain || !conversationId || !sessionId) {
    return "";
  }
  const normalizedDomain = normalizeLightningDomain(domain);
  if (!normalizedDomain) {
    return "";
  }
  const baseUrl = `${normalizedDomain}/lightning/cmp/runtime_analytics_evf_aie__record`;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return "";
  }
  const safeTimeFilter = Number.isFinite(timeFilterDays) && timeFilterDays > 0 ? timeFilterDays : 30;
  url.searchParams.set("c__id", conversationId);
  url.searchParams.set("c__type", "2");
  url.searchParams.set("c__sessionId", sessionId);
  url.searchParams.set("c__timeFilter", String(safeTimeFilter));
  if (agentApiName) {
    url.searchParams.set("c__agentApiName", agentApiName);
  }
  return url.toString();
}

export function resolveConversationLinkDomain(instanceUrl?: string): string | null {
  if (!instanceUrl) {
    return null;
  }
  try {
    const parsed = new URL(instanceUrl);
    const { protocol } = parsed;
    let host = parsed.hostname;
    if (host.endsWith(".my.salesforce.com")) {
      host = host.replace(".my.salesforce.com", ".lightning.force.com");
    } else if (host.endsWith(".salesforce.com") && !host.includes(".lightning.")) {
      host = host.replace(".salesforce.com", ".lightning.force.com");
    }
    const potentialDomain = `${protocol}//${host}`;
    const normalized = normalizeLightningDomain(potentialDomain);
    if (normalized) {
      return normalized;
    }
    return normalizeLightningDomain(parsed.origin);
  } catch {
    return null;
  }
}

export function normalizeLightningDomain(domain: string): string | null {
  const trimmed = domain.trim();
  if (!trimmed) {
    return null;
  }
  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");
  const withProtocol = /^https?:\/\//i.test(withoutTrailingSlash) ? withoutTrailingSlash : `https://${withoutTrailingSlash}`;
  try {
    const parsed = new URL(withProtocol);
    return parsed.origin;
  } catch {
    return null;
  }
}

export function extractSessionIds(records: AnyJson[] | undefined, options?: ExtractSessionOptions): string[] {
  const safeRecords = Array.isArray(records) ? records : [];
  const sessionIdSet = new Set<string>();
  const sanitizer = options?.sanitizer;
  safeRecords.forEach((record) => {
    if (!record || typeof record !== "object") {
      return;
    }
    const normalized = normalizeKeys(record as Record<string, AnyJson>);
    const rawSessionId = stringValue(normalized["sessionid"] ?? normalized["ssot__aiagentsessionid__c"]);
    const finalSessionId = sanitizer ? sanitizer(rawSessionId) : rawSessionId;
    if (finalSessionId) {
      sessionIdSet.add(finalSessionId);
    }
  });
  return Array.from(sessionIdSet);
}

export async function fetchConversationTranscripts(
  sessionIds: string[],
  conn: Connection,
  options?: FetchTranscriptOptions
): Promise<Map<string, string>> {
  const transcripts = new Map<string, string>();
  const uniqueIds = Array.from(new Set(sessionIds.filter((id) => Boolean(id))));
  if (!uniqueIds.length) {
    return transcripts;
  }

  const chunkSize = options?.chunkSize && options.chunkSize > 0 ? options.chunkSize : 50;
  const transcriptBuckets = new Map<string, { speaker: string; text: string; timestamp: string }[]>();
  const chunks = chunkArray(uniqueIds, chunkSize);

  for (const chunk of chunks) {
    if (!chunk.length) {
      continue;
    }
    const quotedIds = chunk.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ");
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
      const rawSessionId = stringValue(normalized["sessionid"] ?? normalized["ssot__aiagentsessionid__c"]);
      const sessionId = options?.sanitizeSessionId ? options.sanitizeSessionId(rawSessionId) : rawSessionId;
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
      .join("\n---\n");
    transcripts.set(sessionId, formatted);
  });

  return transcripts;
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    return [items];
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function inferSpeaker(participantRole: string, messageType: string): "USER" | "AGENT" {
  const normalizedRole = (participantRole || "").trim().toUpperCase();
  if (normalizedRole.includes("AGENT") || normalizedRole === "BOT" || normalizedRole === "SYSTEM") {
    return "AGENT";
  }
  if (normalizedRole) {
    return "USER";
  }
  const normalizedType = (messageType || "").trim().toUpperCase();
  if (normalizedType.includes("USER")) {
    return "USER";
  }
  return "AGENT";
}

export function resolveDateFilterOptions(inputs: DateFilterOptionsInput): AgentforceQueryFilters {
  const { dateFromInput, dateToInput, lastNDaysInput } = inputs;
  const parsedFrom = parseDateInput(dateFromInput, "--date-from");
  const parsedTo = parseDateInput(dateToInput, "--date-to");

  let effectiveFrom = parsedFrom;
  let effectiveTo = parsedTo;

  if (lastNDaysInput !== undefined && lastNDaysInput !== null) {
    if (!Number.isFinite(lastNDaysInput) || lastNDaysInput <= 0) {
      throw new SfError("--last-n-days must be a positive integer");
    }
    const now = new Date();
    const relativeFrom = new Date(now);
    relativeFrom.setUTCDate(relativeFrom.getUTCDate() - lastNDaysInput);
    effectiveFrom = chooseLaterDate(effectiveFrom, relativeFrom);
    effectiveTo = chooseEarlierDate(effectiveTo, now);
  }

  if (effectiveFrom && effectiveTo && effectiveFrom.getTime() > effectiveTo.getTime()) {
    throw new SfError("Date filters are inconsistent: start date is after end date");
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

export function parseDateInput(value: string | undefined, flagName: string): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new SfError(`Invalid ${flagName} value. Use ISO-8601 format, e.g. 2024-08-01T00:00:00Z`);
  }
  return parsed;
}

export function chooseLaterDate(first: Date | null, second: Date | null): Date | null {
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }
  return first.getTime() >= second.getTime() ? first : second;
}

export function chooseEarlierDate(first: Date | null, second: Date | null): Date | null {
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }
  return first.getTime() <= second.getTime() ? first : second;
}

export function buildDateFilterClause(filters: AgentforceQueryFilters): string {
  const clauses: string[] = [];
  if (filters.dateFrom) {
    clauses.push(` AND ggn.timestamp__c >= TIMESTAMP '${escapeSqlLiteral(filters.dateFrom)}'`);
  }
  if (filters.dateTo) {
    clauses.push(` AND ggn.timestamp__c <= TIMESTAMP '${escapeSqlLiteral(filters.dateTo)}'`);
  }
  return clauses.join("");
}

export function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export function buildExcludedSessionFilter(): string {
  const excludedSessionIds = resolveExcludedSessionIds();
  if (!excludedSessionIds.length) {
    return "";
  }
  return `
WHERE (sess.sessionId IS NULL OR sess.sessionId NOT IN (${excludedSessionIds.map((id) => `'${id}'`).join(", ")}))`;
}

export function resolveExcludedConversationIds(): string[] {
  const envValue = process.env.AGENTFORCE_FEEDBACK_EXCLUDED_CONV_IDS;
  if (envValue) {
    return envValue.split(",").map((id) => id.trim()).filter((id) => id);
  }
  return [...DEFAULT_EXCLUDED_CONVERSATION_IDS];
}

export function resolveExcludedSessionIds(): string[] {
  const envValue = process.env.AGENTFORCE_EXCLUDED_SESSION_IDS;
  if (envValue) {
    return envValue.split(",").map((id) => id.trim()).filter((id) => id);
  }
  return [...DEFAULT_EXCLUDED_SESSION_IDS];
}

export function sanitizePlaceholderValue(value: string): string {
  const trimmed = value ? value.trim() : "";
  if (!trimmed) {
    return "";
  }
  if (PLACEHOLDER_VALUES.has(trimmed.toUpperCase())) {
    return "";
  }
  return trimmed;
}

export function pickFirstMeaningfulValue(values: string[]): string {
  for (const value of values) {
    const cleaned = sanitizePlaceholderValue(value);
    if (cleaned) {
      return cleaned;
    }
  }
  return "";
}

export function extractSpeakerSegment(transcript: string, speaker: "USER" | "AGENT"): string {
  if (!transcript) {
    return "";
  }
  const prefix = `${speaker}:`;
  const segments = transcript.split(/\n---\n/);
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (trimmed.toUpperCase().startsWith(prefix)) {
      return sanitizePlaceholderValue(trimmed.slice(prefix.length).trim());
    }
  }
  return "";
}

