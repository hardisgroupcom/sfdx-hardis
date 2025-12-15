import { Connection, SfError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { uxLog } from "./index.js";

const QUERY_CONNECT_PATH = "ssot/query-sql";
const DEFAULT_DATASPACE = "default";
const DEFAULT_WORKLOAD_NAME = "sfdx-hardis-cli";
const DEFAULT_ROW_LIMIT = 2000;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_POLL_TIMEOUT_MS = 120000;
const DEFAULT_OMIT_SCHEMA = false;

const SUCCESS_STATUSES = new Set(["finished", "resultsproduced"]);
const RUNNING_STATUSES = new Set(["running", "queued"]);
const FAILURE_STATUSES = new Set(["failed", "canceled", "cancelled", "error"]);

export interface DataCloudQueryColumnMetadata {
  name: string;
  type: string;
  nullable?: boolean;
}

export interface DataCloudQueryStatus {
  chunkCount: number;
  completionStatus: string;
  queryId: string;
  rowCount?: number;
  expirationTime?: string;
  progress?: number;
}

export interface DataCloudSqlQueryOptions {
  dataspace?: string;
  workloadName?: string;
  rowLimit?: number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  waitTimeMs?: number;
  omitSchema?: boolean;
}

export type DataCloudRecord = Record<string, AnyJson>;

export interface DataCloudSqlQueryResult<RecordType = DataCloudRecord> {
  queryId: string;
  metadata: DataCloudQueryColumnMetadata[];
  status: DataCloudQueryStatus;
  records: RecordType[];
  rawData: AnyJson[][];
  returnedRows: number;
  hasMoreRows: boolean;
}

interface QueryConnectResponse {
  returnedRows?: number;
  status?: {
    chunkCount?: number;
    completionStatus?: string;
    queryId?: string;
    rowCount?: number;
    expirationTime?: string;
    progress?: number;
  };
  metadata?: DataCloudQueryColumnMetadata[];
  data?: AnyJson[][];
}
interface QueryConnectStatusResponse {
  chunkCount?: number;
  completionStatus?: string;
  queryId?: string;
  rowCount?: number;
  expirationTime?: string;
  progress?: number;
}

interface QueryConnectRowsResponse {
  returnedRows?: number;
  metadata?: DataCloudQueryColumnMetadata[];
  data?: AnyJson[][];
}

export async function dataCloudSqlQuery(
  query: string,
  conn: Connection,
  options?: DataCloudSqlQueryOptions,
): Promise<DataCloudSqlQueryResult> {
  if (!query || !query.trim()) {
    throw new SfError("The Data Cloud SQL query must be a non-empty string.");
  }

  const settings = resolveOptions(options);

  try {
    const initialChunk = await submitInitialQuery(query.trim(), conn, settings);
    if (!initialChunk.metadata.length) {
      throw new SfError(`Data Cloud SQL query did not return column metadata.\n${JSON.stringify(initialChunk)}`);
    }
    if (!initialChunk.status.queryId) {
      throw new SfError(`Data Cloud SQL query did not return a queryId needed for pagination.\n${JSON.stringify(initialChunk)}`);
    }

    let metadata = initialChunk.metadata;
    const records: DataCloudRecord[] = [...initialChunk.records];
    const rawData: AnyJson[][] = [...initialChunk.rawData];
    let status = initialChunk.status;

    if (initialChunk.hasMoreRows || isRunningStatus(status.completionStatus)) {
      status = await waitForQueryCompletion(conn, status, settings);
      const pagination = await fetchRemainingRows(
        conn,
        status.queryId,
        metadata,
        records.length,
        status.rowCount,
        settings,
      );

      if (!metadata.length && pagination.metadata.length) {
        metadata = pagination.metadata;
      }

      records.push(...pagination.records);
      rawData.push(...pagination.rawData);
    }

    return {
      queryId: status.queryId,
      metadata,
      status: {
        ...status,
        rowCount: status.rowCount ?? records.length,
      },
      records,
      rawData,
      returnedRows: records.length,
      hasMoreRows: false,
    };
  } catch (error) {
    throw wrapQueryError(error);
  }
}

async function submitInitialQuery(
  query: string,
  conn: Connection,
  options: RequiredQueryOptions,
): Promise<DataCloudSqlQueryResult> {
  const endpoint = buildQueryConnectUrl(conn, options);
  uxLog("log", this, `[DataCloudSqlQuery] Submitting initial query to ${endpoint}:\n${query}`);
  const response = await conn.request<QueryConnectResponse>({
    method: "POST",
    url: endpoint,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sql: query }),
  });

  return normalizeQueryResponse(response);
}

async function waitForQueryCompletion(
  conn: Connection,
  status: DataCloudQueryStatus,
  options: RequiredQueryOptions,
): Promise<DataCloudQueryStatus> {
  const deadline = Date.now() + options.pollTimeoutMs;
  let currentStatus = status;

  while (isRunningStatus(currentStatus.completionStatus)) {
    if (Date.now() > deadline) {
      throw new SfError(
        `Timed out after ${options.pollTimeoutMs}ms while waiting for Data Cloud query ${currentStatus.queryId} to finish.`,
      );
    }

    const waitTimeMs = Math.min(options.waitTimeMs, Math.max(0, deadline - Date.now()));
    currentStatus = await fetchQueryStatus(conn, currentStatus.queryId, options, waitTimeMs);

    if (isFailureStatus(currentStatus.completionStatus)) {
      throw new SfError(`Data Cloud SQL query ${currentStatus.queryId} failed with status ${currentStatus.completionStatus}.`);
    }

    if (isRunningStatus(currentStatus.completionStatus) && options.pollIntervalMs > 0) {
      await delay(options.pollIntervalMs);
    }
  }

  if (!isSuccessStatus(currentStatus.completionStatus)) {
    throw new SfError(`Unexpected Data Cloud SQL query status: ${currentStatus.completionStatus || "Unknown"}.`);
  }

  return currentStatus;
}

async function fetchRemainingRows(
  conn: Connection,
  queryId: string,
  metadata: DataCloudQueryColumnMetadata[],
  alreadyFetched: number,
  totalRows: number | undefined,
  options: RequiredQueryOptions,
): Promise<{ records: DataCloudRecord[]; rawData: AnyJson[][]; metadata: DataCloudQueryColumnMetadata[] }> {
  const rowLimit = Math.max(1, options.rowLimit);
  const records: DataCloudRecord[] = [];
  const rawData: AnyJson[][] = [];
  let offset = alreadyFetched;
  let remaining = typeof totalRows === "number" ? Math.max(totalRows - alreadyFetched, 0) : undefined;

  while (remaining === undefined || remaining > 0) {
    const response = await fetchRowsPage(conn, queryId, options, offset, rowLimit);
    const rows = response.data ?? [];

    if (response.metadata && !metadata.length) {
      metadata = response.metadata;
    }

    if (!rows.length) {
      break;
    }

    rawData.push(...rows);
    records.push(...rows.map((row) => mapRowToRecord(row, metadata)));

    offset += rows.length;
    if (remaining !== undefined) {
      remaining -= rows.length;
    }

    if (rows.length < rowLimit) {
      break;
    }
  }

  return { records, rawData, metadata };
}

async function fetchQueryStatus(
  conn: Connection,
  queryId: string,
  options: RequiredQueryOptions,
  waitTimeMs: number,
): Promise<DataCloudQueryStatus> {
  const url = buildQueryConnectUrl(conn, options, [queryId], {
    waitTimeMs: waitTimeMs > 0 ? waitTimeMs : undefined,
  });

  const response = await conn.request<QueryConnectStatusResponse>({
    method: "GET",
    url,
  });

  return normalizeStatusResponse(response, queryId);
}

async function fetchRowsPage(
  conn: Connection,
  queryId: string,
  options: RequiredQueryOptions,
  offset: number,
  rowLimit: number,
): Promise<QueryConnectRowsResponse> {
  const url = buildQueryConnectUrl(conn, options, [queryId, "rows"], {
    rowLimit,
    offset,
    omitSchema: options.omitSchema,
  });

  return conn.request<QueryConnectRowsResponse>({
    method: "GET",
    url,
  });
}

function normalizeQueryResponse(response: QueryConnectResponse): DataCloudSqlQueryResult {
  if (typeof response !== "object" || response === null) {
    throw new SfError("Invalid response format received from Data Cloud SQL query.\n" + JSON.stringify(response, null, 2));
  }
  const metadata = response.metadata ?? [];
  const dataRows = response.data ?? [];
  const records = metadata.length ? dataRows.map((row) => mapRowToRecord(row, metadata)) : [];
  const status = normalizeStatusResponse(response.status ?? {}, "");

  return {
    queryId: status.queryId,
    metadata,
    status,
    records,
    rawData: dataRows,
    returnedRows: response.returnedRows ?? records.length,
    hasMoreRows: hasMoreRowsPending(status, records.length),
  };
}

function normalizeStatusResponse(status: QueryConnectStatusResponse, fallbackQueryId: string): DataCloudQueryStatus {
  return {
    chunkCount: status.chunkCount ?? 0,
    completionStatus: status.completionStatus ?? "Unknown",
    queryId: status.queryId ?? fallbackQueryId,
    rowCount: status.rowCount,
    expirationTime: status.expirationTime,
    progress: status.progress,
  };
}

function mapRowToRecord(row: AnyJson[], metadata: DataCloudQueryColumnMetadata[]): DataCloudRecord {
  if (!metadata.length) {
    throw new SfError("Cannot map Data Cloud rows without column metadata.");
  }

  return metadata.reduce<DataCloudRecord>((acc, column, index) => {
    acc[column.name] = row[index] ?? null;
    return acc;
  }, {});
}

function hasMoreRowsPending(status: DataCloudQueryStatus, fetchedRows: number): boolean {
  if (typeof status.rowCount === "number") {
    return status.rowCount > fetchedRows;
  }

  const state = status.completionStatus?.toLowerCase();
  return state === "running" || state === "resultsproduced";
}

function buildQueryConnectUrl(
  conn: Connection,
  options: RequiredQueryOptions,
  pathSegments: string[] = [],
  queryParams: Record<string, string | number | boolean | undefined> = {},
): string {
  const base = conn.baseUrl().replace(/\/$/, "");
  const baseSegments = QUERY_CONNECT_PATH.split("/");
  const path = [...baseSegments, ...pathSegments]
    .filter((segment) => segment && segment.length)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  const params: Record<string, string | number | boolean | undefined> = {
    dataspace: options.dataspace,
    workloadName: options.workloadName,
    ...queryParams,
  };

  const queryString = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");

  return queryString ? `${base}/${path}?${queryString}` : `${base}/${path}`;
}

function resolveOptions(options?: DataCloudSqlQueryOptions): RequiredQueryOptions {
  return {
    dataspace: options?.dataspace || DEFAULT_DATASPACE,
    workloadName: options?.workloadName || DEFAULT_WORKLOAD_NAME,
    rowLimit: options?.rowLimit || DEFAULT_ROW_LIMIT,
    pollIntervalMs: options?.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS,
    pollTimeoutMs: options?.pollTimeoutMs || DEFAULT_POLL_TIMEOUT_MS,
    waitTimeMs: options?.waitTimeMs || DEFAULT_POLL_INTERVAL_MS,
    omitSchema: options?.omitSchema ?? DEFAULT_OMIT_SCHEMA,
  };
}

interface RequiredQueryOptions {
  dataspace: string;
  workloadName: string;
  rowLimit: number;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  waitTimeMs: number;
  omitSchema: boolean;
}

function isRunningStatus(status: string): boolean {
  return RUNNING_STATUSES.has(status?.toLowerCase());
}

function isSuccessStatus(status: string): boolean {
  return SUCCESS_STATUSES.has(status?.toLowerCase());
}

function isFailureStatus(status: string): boolean {
  return FAILURE_STATUSES.has(status?.toLowerCase());
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function wrapQueryError(error: unknown): SfError {
  if (isSfRequestError(error)) {
    const details = [error.message];
    const bodyMessage = (error.body as { message?: string; error_description?: string } | undefined)?.message;
    const bodyDescription = (error.body as { error_description?: string } | undefined)?.error_description;
    if (bodyMessage) {
      details.push(bodyMessage);
    }
    if (bodyDescription && bodyDescription !== bodyMessage) {
      details.push(bodyDescription);
    }
    if (error.statusCode) {
      details.push(`(status ${error.statusCode})`);
    }
    return new SfError(`Data Cloud SQL query failed: ${details.filter(Boolean).join(" ")}`.trim());
  }

  return error instanceof SfError ? error : new SfError("Unknown error while executing Data Cloud SQL query.");
}

function isSfRequestError(error: unknown): error is SfError & {
  statusCode?: number;
  body?: { message?: string; error_description?: string };
} {
  return Boolean(error && typeof error === "object" && "message" in error);
}