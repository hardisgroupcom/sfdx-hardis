import { Connection } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import {
  DataCloudQueryColumnMetadata,
  dataCloudSqlQuery,
  getDataCloudAvailability,
} from "./dataCloudUtils.js";
import { escapeSqlLiteral, AgentforceQueryFilters } from "./agentforceQueryUtils.js";
import { round2 as roundMoney } from "./usageCostUtils.js";

// Agentforce and Data 360 consumption live in Data 360 data model objects, not in SOQL.
// Their exact names and columns ship with a paid Agentforce / Data 360 SKU and are not present on
// orgs without it, so nothing here is hardcoded: table names are matched against the live DMO
// listing (with a regex fallback so a Salesforce rename does not silently break the command) and
// columns are read from the metadata the query API returns.

// Real orgs publish the model as `AiAgentGenerativeAiUsage_std__dlm`. The other spellings are
// kept because Salesforce has shipped `ssot__`-prefixed variants for related Agentforce
// DMOs, and the regex fallback below covers anything not listed here.
export const CANDIDATE_AI_USAGE_MODELS = [
  "AiAgentGenerativeAiUsage_std__dlm",
  "ssot__AiAgentGenerativeAiUsage__dlm",
  "AiAgentGenerativeAiUsage__dlm",
  "ssot__GenerativeAiUsage__dlm",
];

export const CANDIDATE_DATA_CREDIT_MODELS = [
  "TenantEnrichedUsageEvent_std__dlm",
  "ssot__TenantEnrichedUsageEvent__dlm",
  "TenantEnrichedUsageEvent__dlm",
];

const AI_USAGE_MODEL_PATTERN = /(generativeaiusage|aiagentusage|aiagentgenerativeai)/i;
const DATA_CREDIT_MODEL_PATTERN = /tenantenrichedusageevent/i;

// Column role detection. Patterns are tried in order and the FIRST PATTERN that matches any
// column wins, so specific names beat generic ones regardless of where they sit in the schema
// (e.g. `AiAgentToolName__c` is preferred over `AiAgentToolIdentifier__c` even though the
// identifier column comes first).
//
// The credits patterns matter most: on a real org the billed quantity is `UsageQuantity__c`,
// which none of the credit/amount spellings match. Missing it drops the command to its
// unaggregated fallback, so keep the quantity spellings in this list.
const COLUMN_PATTERNS: { role: AiUsageColumnRole; patterns: RegExp[] }[] = [
  {
    role: "credits",
    patterns: [/credit/i, /usagequantity/i, /consumedunits?/i, /usageamount/i, /quantity/i, /\bamount\b/i],
  },
  { role: "agent", patterns: [/agentname/i, /agentdevelopername/i, /agentlabel/i, /\bagent/i, /botname/i] },
  {
    role: "action",
    patterns: [/actionname/i, /toolname/i, /\baction/i, /functionname/i, /capability/i, /tool/i],
  },
  { role: "metered", patterns: [/ismeteredindicator/i, /metered/i, /billable/i, /chargeable/i] },
  { role: "usageType", patterns: [/usagetype/i, /servicetype/i, /resourcetype/i, /featurename/i] },
  { role: "timestamp", patterns: [/^timestamp/i, /timestamp/i, /usagedate/i, /eventdate/i, /createddate/i] },
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

// Org-wide totals, computed by a dedicated aggregate query rather than by summing the detail
// rows. The detail query is capped by `rowLimit`, so summing it would silently under-report on
// any org with more distinct agent/action combinations than the cap.
export interface AiUsageTotals {
  credits: number;
  creditsMetered: number;
  creditsUnmetered: number;
  events: number;
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
  // Authoritative totals. Undefined only when no credits column could be identified.
  aiTotals?: AiUsageTotals;
  dataCreditTotals?: AiUsageTotals;
  // Number of detail rows dropped by the row cap, so the caller can say so out loud.
  truncatedRows?: number;
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
    // Pattern priority wins over column order: walk the patterns outermost so a later, more
    // specific column still beats an earlier, vaguer one.
    for (const pattern of patterns) {
      const match = columns.find(
        (column) => pattern.test(column.name) && !isRoleTaken(mapping, column.name),
      );
      if (match) {
        mapping[role] = match.name;
        break;
      }
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

// Totals query: grouped only by the metered flag, so the result is at most a couple of rows and
// can never hit the detail row cap. This is what feeds the metrics.
export function buildAiUsageTotalsQuery(
  info: AiUsageModelInfo,
  filters: AgentforceQueryFilters,
): string | null {
  const { mapping, model } = info;
  if (!mapping.credits) {
    return null;
  }
  const selectParts: string[] = [];
  const groupParts: string[] = [];
  if (mapping.metered) {
    selectParts.push(`${mapping.metered} AS metered`);
    groupParts.push(mapping.metered);
  }
  selectParts.push(`SUM(${mapping.credits}) AS credits`);
  selectParts.push(`COUNT(1) AS events`);

  const whereClause = `WHERE 1 = 1${buildDateClause(filters, mapping.timestamp)}`;
  const groupByClause = groupParts.length ? ` GROUP BY ${groupParts.join(", ")}` : "";
  return `SELECT ${selectParts.join(", ")} FROM ${model} ${whereClause}${groupByClause}`;
}

export function accumulateTotals(records: Record<string, AnyJson>[]): AiUsageTotals {
  const totals: AiUsageTotals = { credits: 0, creditsMetered: 0, creditsUnmetered: 0, events: 0 };
  for (const record of records) {
    const credits = pickNumber(record, "credits") ?? 0;
    const events = pickNumber(record, "events") ?? 0;
    totals.credits += credits;
    totals.events += events;
    const metered = pick(record, "metered");
    if (metered && isMetered(metered)) {
      totals.creditsMetered += credits;
    } else if (metered) {
      totals.creditsUnmetered += credits;
    }
  }
  totals.credits = round2(totals.credits);
  totals.creditsMetered = round2(totals.creditsMetered);
  totals.creditsUnmetered = round2(totals.creditsUnmetered);
  return totals;
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
      // Detail rows are capped; totals must not be, so they come from their own query.
      const totalsQuery = buildAiUsageTotalsQuery(info, filters);
      if (totalsQuery) {
        const totalsResult = await dataCloudSqlQuery(totalsQuery, conn, { rowLimit: 100 });
        result.aiTotals = accumulateTotals(totalsResult.records);
      }
      if (result.aiRows.length >= rowLimit) {
        result.truncatedRows = result.aiRows.length;
      }
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
    const totalsQuery = buildAiUsageTotalsQuery(info, filters);
    if (totalsQuery) {
      const totalsResult = await dataCloudSqlQuery(totalsQuery, conn, { rowLimit: 100 });
      result.dataCreditTotals = accumulateTotals(totalsResult.records);
    }
  }

  return result;
}

function isMetered(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "metered" || normalized === "yes";
}

// Metrics read the dedicated totals queries, never the capped detail rows, so a busy org with
// more agent/action combinations than the row cap still reports its true consumption.
export function buildAiUsageMetrics(result: AiUsageResult): any {
  const metrics: any = {};
  // Emit nothing for a model that is not provisioned. A zero would read as "no credits were
  // consumed" when the truth is "this org has no Data 360 credit subscription", and the panel
  // would show a confident 0 instead of its "Requires Data 360" empty state.
  if (result.aiTotals) {
    metrics.AiUsageCreditsTotal = result.aiTotals.credits;
    metrics.AiUsageCreditsMetered = result.aiTotals.creditsMetered;
    metrics.AiUsageCreditsUnmetered = result.aiTotals.creditsUnmetered;
    metrics.AiUsageActions = result.aiTotals.events;
  }
  if (result.dataCreditTotals) {
    metrics.DataCloudCreditsTotal = result.dataCreditTotals.credits;
  }
  return metrics;
}

// Credits are the billing unit, so they round like money: half up, never through toFixed(2)
// which drops 35.985 to 35.98. Shared with the cost helpers so there is one rounding rule.
const round2 = roundMoney;

export function formatAiUsageLine(row: AiUsageRow): string {
  const label = [row.agent, row.action].filter(Boolean).join(" / ") || row.usageType || "Unknown";
  return `- ${label}: **${row.credits ?? 0}** credits (${row.events ?? 0} events)`;
}
