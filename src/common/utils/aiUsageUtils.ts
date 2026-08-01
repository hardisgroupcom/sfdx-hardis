import { Connection } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import {
  DataCloudQueryColumnMetadata,
  dataCloudSqlQuery,
  getDataCloudAvailability,
} from "./dataCloudUtils.js";
import { escapeSqlLiteral, AgentforceQueryFilters } from "./agentforceQueryUtils.js";

// Agentforce and Data 360 consumption live in Data 360 data model objects, not in SOQL.
// Their exact names and columns ship with a paid Agentforce / Data 360 SKU and are not present on
// orgs without it, so nothing here is hardcoded: table names are matched against the live DMO
// listing (with a regex fallback so a Salesforce rename does not silently break the command) and
// columns are read from the metadata the query API returns.

export const CANDIDATE_AI_USAGE_MODELS = [
  "ssot__AiAgentGenerativeAiUsage__dlm",
  "AiAgentGenerativeAiUsage__dlm",
  "ssot__GenerativeAiUsage__dlm",
];

export const CANDIDATE_DATA_CREDIT_MODELS = [
  "ssot__TenantEnrichedUsageEvent__dlm",
  "TenantEnrichedUsageEvent__dlm",
];

const AI_USAGE_MODEL_PATTERN = /(generativeaiusage|aiagentusage|aiagentgenerativeai)/i;
const DATA_CREDIT_MODEL_PATTERN = /tenantenrichedusageevent/i;

// Column role detection. Ordered from most to least specific: the first pattern that matches a
// column name wins, so "creditsConsumed" is preferred over a bare "amount".
const COLUMN_PATTERNS: { role: AiUsageColumnRole; patterns: RegExp[] }[] = [
  { role: "credits", patterns: [/credit/i, /consumedunits?/i, /usageamount/i, /\bamount\b/i] },
  { role: "agent", patterns: [/agentname/i, /agentlabel/i, /\bagent/i, /botname/i] },
  { role: "action", patterns: [/actionname/i, /\baction/i, /functionname/i, /capability/i] },
  { role: "metered", patterns: [/metered/i, /billable/i, /chargeable/i] },
  { role: "usageType", patterns: [/usagetype/i, /servicetype/i, /resourcetype/i, /featurename/i] },
  { role: "timestamp", patterns: [/timestamp/i, /usagedate/i, /eventdate/i, /createddate/i] },
];

export type AiUsageColumnRole = "credits" | "agent" | "action" | "metered" | "usageType" | "timestamp";

export type AiUsageColumnMapping = Partial<Record<AiUsageColumnRole, string>>;

export interface AiUsageModelInfo {
  model: string;
  columns: DataCloudQueryColumnMetadata[];
  mapping: AiUsageColumnMapping;
}

// Index signature: rows are serialized straight to CSV, logElements and command output.
export interface AiUsageRow {
  [key: string]: any;
  agent: string;
  action: string;
  usageType: string;
  metered: string;
  credits: number | null;
  events: number | null;
}

export interface AiUsageResult {
  // False when Data Cloud is absent, or present without any consumption model provisioned.
  available: boolean;
  reason?: string;
  aiModel?: string;
  dataCreditModel?: string;
  // True when the credits column could not be identified and rows are returned unaggregated.
  degraded: boolean;
  aiRows: AiUsageRow[];
  dataCreditRows: Record<string, AnyJson>[];
}

export function findModelName(
  objectNames: string[],
  candidates: string[],
  fallbackPattern: RegExp,
): string | null {
  for (const candidate of candidates) {
    const match = objectNames.find((name) => name.toLowerCase() === candidate.toLowerCase());
    if (match) {
      return match;
    }
  }
  return objectNames.find((name) => fallbackPattern.test(name)) ?? null;
}

export function mapUsageColumns(columns: DataCloudQueryColumnMetadata[]): AiUsageColumnMapping {
  const mapping: AiUsageColumnMapping = {};
  for (const { role, patterns } of COLUMN_PATTERNS) {
    const match = columns.find(
      (column) => patterns.some((pattern) => pattern.test(column.name)) && !isRoleTaken(mapping, column.name),
    );
    if (match) {
      mapping[role] = match.name;
    }
  }
  return mapping;
}

function isRoleTaken(mapping: AiUsageColumnMapping, columnName: string): boolean {
  return Object.values(mapping).includes(columnName);
}

// Reads one row purely to obtain column metadata. The query API returns the schema even when the
// table is empty, so this works on a provisioned but unused org.
export async function describeUsageModel(conn: Connection, model: string): Promise<AiUsageModelInfo> {
  const result = await dataCloudSqlQuery(`SELECT * FROM ${model} LIMIT 1`, conn);
  return { model, columns: result.metadata, mapping: mapUsageColumns(result.metadata) };
}

export function buildDateClause(
  filters: AgentforceQueryFilters,
  timestampColumn: string | undefined,
): string {
  if (!timestampColumn) {
    return "";
  }
  const clauses: string[] = [];
  if (filters.dateFrom) {
    clauses.push(` AND ${timestampColumn} >= TIMESTAMP '${escapeSqlLiteral(filters.dateFrom)}'`);
  }
  if (filters.dateTo) {
    clauses.push(` AND ${timestampColumn} <= TIMESTAMP '${escapeSqlLiteral(filters.dateTo)}'`);
  }
  return clauses.join("");
}

// Aggregates by whichever dimension columns were discovered. When no credits column can be
// identified the caller falls back to a raw row dump instead of guessing an aggregation.
export function buildAiUsageQuery(
  info: AiUsageModelInfo,
  filters: AgentforceQueryFilters,
  rowLimit = 500,
): string | null {
  const { mapping, model } = info;
  if (!mapping.credits) {
    return null;
  }
  const dimensions: { alias: string; column: string }[] = [];
  for (const role of ["agent", "action", "usageType", "metered"] as AiUsageColumnRole[]) {
    if (mapping[role]) {
      dimensions.push({ alias: role, column: mapping[role] as string });
    }
  }
  const selectParts = dimensions.map((dim) => `${dim.column} AS ${dim.alias}`);
  selectParts.push(`SUM(${mapping.credits}) AS credits`);
  selectParts.push(`COUNT(1) AS events`);

  const whereClause = `WHERE 1 = 1${buildDateClause(filters, mapping.timestamp)}`;
  const groupByClause = dimensions.length ? ` GROUP BY ${dimensions.map((dim) => dim.column).join(", ")}` : "";
  return (
    `SELECT ${selectParts.join(", ")} FROM ${model} ${whereClause}${groupByClause} ` +
    `ORDER BY credits DESC LIMIT ${rowLimit}`
  );
}

function pick(record: Record<string, AnyJson>, key: string): string {
  const value = record[key] ?? record[key.toLowerCase()];
  return value === null || value === undefined ? "" : String(value);
}

function pickNumber(record: Record<string, AnyJson>, key: string): number | null {
  const value = record[key] ?? record[key.toLowerCase()];
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toAiUsageRow(record: Record<string, AnyJson>): AiUsageRow {
  return {
    agent: pick(record, "agent"),
    action: pick(record, "action"),
    usageType: pick(record, "usageType"),
    metered: pick(record, "metered"),
    credits: pickNumber(record, "credits"),
    events: pickNumber(record, "events"),
  };
}

export async function collectAiUsage(
  conn: Connection,
  filters: AgentforceQueryFilters,
  rowLimit = 500,
): Promise<AiUsageResult> {
  const availability = await getDataCloudAvailability(conn);
  if (!availability.available) {
    return { available: false, reason: availability.reason, degraded: false, aiRows: [], dataCreditRows: [] };
  }

  const aiModel = findModelName(availability.objectNames, CANDIDATE_AI_USAGE_MODELS, AI_USAGE_MODEL_PATTERN);
  const dataCreditModel = findModelName(
    availability.objectNames,
    CANDIDATE_DATA_CREDIT_MODELS,
    DATA_CREDIT_MODEL_PATTERN,
  );

  if (!aiModel && !dataCreditModel) {
    return {
      available: false,
      reason:
        "Data Cloud is enabled but no Agentforce or Data 360 consumption model is provisioned on this org",
      degraded: false,
      aiRows: [],
      dataCreditRows: [],
    };
  }

  const result: AiUsageResult = {
    available: true,
    aiModel: aiModel ?? undefined,
    dataCreditModel: dataCreditModel ?? undefined,
    degraded: false,
    aiRows: [],
    dataCreditRows: [],
  };

  if (aiModel) {
    const info = await describeUsageModel(conn, aiModel);
    const query = buildAiUsageQuery(info, filters, rowLimit);
    if (query) {
      const queryResult = await dataCloudSqlQuery(query, conn, { rowLimit });
      result.aiRows = queryResult.records.map((record) => toAiUsageRow(record));
    } else {
      // No credits column recognized: return raw rows rather than inventing an aggregation.
      result.degraded = true;
      const rawQuery = `SELECT * FROM ${aiModel} LIMIT ${rowLimit}`;
      const queryResult = await dataCloudSqlQuery(rawQuery, conn, { rowLimit });
      result.dataCreditRows.push(...queryResult.records);
    }
  }

  if (dataCreditModel) {
    const info = await describeUsageModel(conn, dataCreditModel);
    const query = buildAiUsageQuery(info, filters, rowLimit);
    const effectiveQuery = query ?? `SELECT * FROM ${dataCreditModel} LIMIT ${rowLimit}`;
    const queryResult = await dataCloudSqlQuery(effectiveQuery, conn, { rowLimit });
    result.dataCreditRows.push(...queryResult.records);
  }

  return result;
}

function isMetered(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "metered" || normalized === "yes";
}

export function buildAiUsageMetrics(result: AiUsageResult): any {
  let creditsTotal = 0;
  let creditsMetered = 0;
  let creditsUnmetered = 0;
  let actions = 0;

  for (const row of result.aiRows) {
    const credits = row.credits ?? 0;
    creditsTotal += credits;
    if (row.metered && isMetered(row.metered)) {
      creditsMetered += credits;
    } else if (row.metered) {
      creditsUnmetered += credits;
    }
    actions += row.events ?? 0;
  }

  let dataCloudCredits = 0;
  for (const row of result.dataCreditRows) {
    const credits = pickNumber(row, "credits");
    if (credits !== null) {
      dataCloudCredits += credits;
    }
  }

  return {
    AiUsageCreditsTotal: round2(creditsTotal),
    AiUsageCreditsMetered: round2(creditsMetered),
    AiUsageCreditsUnmetered: round2(creditsUnmetered),
    AiUsageActions: actions,
    DataCloudCreditsTotal: round2(dataCloudCredits),
  };
}

function round2(value: number): number {
  return parseFloat(value.toFixed(2));
}

export function formatAiUsageLine(row: AiUsageRow): string {
  const label = [row.agent, row.action].filter(Boolean).join(" / ") || row.usageType || "Unknown";
  return `- ${label}: **${row.credits ?? 0}** credits (${row.events ?? 0} events)`;
}
