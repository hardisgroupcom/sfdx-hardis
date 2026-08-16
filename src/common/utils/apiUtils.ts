import { uxLog } from './index.js';
import c from 'chalk';
import { Connection } from '@salesforce/core';
import ora, { Ora } from 'ora';
import { WebSocketClient } from '../websocketClient.js';
import { generateCsvFile, generateReportPath } from './filesUtils.js';
import { parseSoqlAndReapplyLimit } from './workaroundUtils.js';
import { t } from './i18n.js';

// Constants for record limits
const MAX_CHUNKS = Number(process.env.SOQL_MAX_BATCHES ?? 50);
const CHUNK_SIZE = Number(process.env.SOQL_CHUNK_SIZE ?? 200);
const MAX_RECORDS = MAX_CHUNKS * CHUNK_SIZE;

// True when Salesforce rejected the query because the sObject does not exist on this org, which
// is how an edition that never provisions the object answers. Monitoring runs across whole
// fleets, so callers are expected to skip quietly rather than fail the job. Anything else (a
// permission problem, a transient outage) must keep propagating.
export function isUnsupportedSObjectError(error: unknown, sObjectName: string): boolean {
  const message = String((error as { message?: string })?.message ?? error).toLowerCase();
  return (
    message.includes('invalid_type') ||
    message.includes('is not supported') ||
    message.includes(`sobject type '${sObjectName.toLowerCase()}'`)
  );
}

// Perform simple SOQL query (max results: 10000)
export async function soqlQuery(soqlQuery: string, conn: Connection): Promise<any> {
  uxLog(
    "log",
    this,
    c.grey(
      '[SOQL Query] ' +
      c.italic(soqlQuery.length > 500 ? soqlQuery.substr(0, 500) + '...' : soqlQuery)
    )
  );
  // First query
  const res = await conn.query(soqlQuery);
  let pageRes = Object.assign({}, res);
  let batchCount = 1;

  // Get all page results
  while (pageRes.done === false && pageRes.nextRecordsUrl && batchCount < MAX_CHUNKS) {
    uxLog("log", this, c.grey(t('fetchingBatch', { batchCount: batchCount + 1, MAX_CHUNKS })));
    pageRes = await conn.queryMore(pageRes.nextRecordsUrl);
    res.records.push(...pageRes.records);
    batchCount++;
  }
  if (!pageRes.done) {
    uxLog("warning", this, c.yellow(t('warningQueryLimitOfRecordsReachedSome', { MAX_RECORDS })));
    uxLog("warning", this, c.yellow(`Consider using bulkQuery for larger datasets.`));
  }
  if (batchCount > 1) {
    uxLog("log", this, c.grey(`[SOQL Query] Retrieved ${res.records.length} records in ${batchCount} chunks(s)`));
  }
  else {
    uxLog("log", this, c.grey(`[SOQL Query] Retrieved ${res.records.length} records`));
  }
  return res;
}

// Perform simple SOQL query with Tooling API
// Uses Sforce-Query-Options: batchSize=2000 to avoid default 100-record limit (Tooling API can return fewer by default)
export async function soqlQueryTooling(soqlQuery: string, conn: Connection): Promise<any> {
  uxLog(
    "log",
    this,
    c.grey(
      '[SOQL Query Tooling] ' +
      c.italic(soqlQuery.length > 500 ? soqlQuery.substr(0, 500) + '...' : soqlQuery)
    )
  );
  const apiVersion = `v${conn.getApiVersion() || '65.0'}`;
  const queryPath = `/services/data/${apiVersion}/tooling/query/?q=${encodeURIComponent(soqlQuery)}`;
  const headers: Record<string, string> = {
    'Sforce-Query-Options': 'batchSize=2000',
  };
  const res = await conn.request<{ records: any[]; done: boolean; nextRecordsUrl?: string }>({
    method: 'GET',
    url: queryPath,
    headers,
  });
  const result = { records: res.records || [], done: res.done, nextRecordsUrl: res.nextRecordsUrl };
  let batchCount = 1;
  while (result.done === false && result.nextRecordsUrl) {
    const nextPath = result.nextRecordsUrl.startsWith('/') ? result.nextRecordsUrl : `/${result.nextRecordsUrl}`;
    const pageRes = await conn.request<{ records: any[]; done: boolean; nextRecordsUrl?: string }>({
      method: 'GET',
      url: nextPath,
      headers,
    });
    result.records.push(...(pageRes.records || []));
    result.done = pageRes.done;
    result.nextRecordsUrl = pageRes.nextRecordsUrl;
    batchCount++;
  }
  if (batchCount > 1) {
    uxLog("log", this, c.grey(`[SOQL Query Tooling] Retrieved ${result.records.length} records in ${batchCount} chunks(s)`));
  } else {
    uxLog("log", this, c.grey(`[SOQL Query Tooling] Retrieved ${result.records.length} records`));
  }
  return result;
}

let spinnerQ;
const maxRetry = Number(process.env.BULK_QUERY_RETRY || 5);
// Same than soqlQuery but using bulk. Do not use if there will be too many results for javascript to handle in memory
export async function bulkQuery(soqlQuery: string, conn: Connection, retries = 3): Promise<any> {
  const queryLabel = soqlQuery.length > 500 ? soqlQuery.substr(0, 500) + '...' : soqlQuery;
  uxLog("log", this, c.grey('[BulkApiV2] ' + c.italic(queryLabel)));
  conn.bulk2.pollInterval = process.env.BULKAPIV2_POLL_INTERVAL ? Number(process.env.BULKAPIV2_POLL_INTERVAL) : 5000; // 5 sec
  conn.bulk2.pollTimeout = process.env.BULKAPIV2_POLL_TIMEOUT ? Number(process.env.BULKAPIV2_POLL_TIMEOUT) : 60000; // 60 sec
  // Start query
  try {
    spinnerQ = ora({ text: `[BulkApiV2] Bulk Query: ${queryLabel}`, spinner: 'moon' }).start();
    const recordStream = await conn.bulk2.query(soqlQuery);
    recordStream.on('error', (err) => {
      uxLog("warning", this, c.yellow(t('bulkQueryError') + err));
      uxLog("log", this, c.grey(t('fullQueryWas', { query: soqlQuery })));
      globalThis.sfdxHardisFatalError = true;
    });
    // Wait for all results
    const records = await recordStream.toArray();
    spinnerQ.succeed(`[BulkApiV2] Bulk Query completed with ${records.length} results.`);
    if (WebSocketClient.isAliveWithLwcUI()) {
      uxLog("log", this, c.grey(`[BulkApiV2] Bulk Query completed with ${records.length} results.`));
    }
    return { records: records };
  } catch (e: any) {
    spinnerQ.fail(`[BulkApiV2] Bulk query error: ${e.message}`);
    // Try again if the reason is a timeout and max number of retries is not reached yet
    const eStr = e + '';
    if ((eStr.includes('ETIMEDOUT') || eStr.includes('Polling timed out')) && retries < maxRetry) {
      uxLog("warning", this, c.yellow('[BulkApiV2] Bulk Query retry attempt #' + retries + 1));
      uxLog("log", this, c.grey(`You can change Bulk API v2 Settings with env variables:
- BULKAPIV2_POLL_TIMEOUT (current: ${conn.bulk2.pollTimeout} ms)
- BULKAPIV2_POLL_INTERVAL (current: ${conn.bulk2.pollInterval} ms)
- BULK_QUERY_RETRY (current: ${maxRetry} max retries)`));
      return await bulkQuery(soqlQuery, conn, retries + 1);
    } else {
      throw e;
    }
  }
}

// When you might have more than 1000 elements in a IN condition, you need to split the request into several requests
// Think to use {{IN}} in soqlQuery
export async function bulkQueryChunksIn(
  soqlQuery: string,
  conn: Connection,
  inElements: string[],
  batchSize = 1000,
  retries = 3
): Promise<any> {
  const results = { records: [] as any[] };
  for (let i = 0; i < inElements.length; i += batchSize) {
    const inElementsChunk = inElements.slice(i, i + batchSize);
    const replacementString = "'" + inElementsChunk.join("','") + "'";
    const soqlQueryWithInConstraint = soqlQuery.replace('{{IN}}', replacementString);
    const chunkResults = await bulkQuery(soqlQueryWithInConstraint, conn, retries);
    results.records.push(...chunkResults.records);
  }
  return results;
}

// New method to bulk query records by chunks of 10000
export async function bulkQueryByChunks(
  soqlQuery: string,
  conn: Connection,
  batchSize = 100000,
  retries = 3
): Promise<any> {
  const results = { records: [] as any[] };
  let lastRecordId = null;
  let hasMoreRecords = true;
  while (hasMoreRecords) {
    let soqlQueryWithLimit = `${soqlQuery} ORDER BY Id`;
    if (lastRecordId) {
      // Check if query already has a WHERE clause to use AND instead of WHERE
      const hasWhere = soqlQuery.toUpperCase().includes(' WHERE ');
      const connector = hasWhere ? 'AND' : 'WHERE';
      soqlQueryWithLimit = `${soqlQuery} ${connector} Id > '${lastRecordId}' ORDER BY Id`;
    }
    soqlQueryWithLimit = await parseSoqlAndReapplyLimit(soqlQueryWithLimit, batchSize, this);
    const chunkResults = await bulkQuery(soqlQueryWithLimit, conn, retries);
    results.records.push(...chunkResults.records);
    if (chunkResults.records.length > 0) {
      lastRecordId = chunkResults.records[chunkResults.records.length - 1].Id;
    }
    hasMoreRecords = chunkResults.records.length === batchSize;
  }

  return results;
}

let spinner: Ora;
// Same than soqlQuery but using bulk. Do not use if there will be too many results for javascript to handle in memory
export async function bulkUpdate(
  objectName: string,
  action: string,
  records: Array<any>,
  conn: Connection
): Promise<any> {
  uxLog(
    "log",
    this,
    c.grey(
      `[BulkApiV2] Bulk ${c.bold(action.toUpperCase())} on ${c.bold(records.length)} records of object ${c.bold(objectName)}`
    )
  );
  conn.bulk2.pollInterval = process.env.BULKAPIV2_POLL_INTERVAL ? Number(process.env.BULKAPIV2_POLL_INTERVAL) : 5000; // 5 sec
  conn.bulk2.pollTimeout = process.env.BULKAPIV2_POLL_TIMEOUT ? Number(process.env.BULKAPIV2_POLL_TIMEOUT) : 60000; // 60 sec
  // Initialize Job
  spinner = ora({ text: `[BulkApiV2] Bulk ${c.bold(action.toUpperCase())} on ${c.bold(records.length)} records of object ${c.bold(objectName)}`, spinner: 'moon' }).start();
  const job = conn.bulk2.createJob({
    operation: action as any,
    object: objectName,
  });
  job.on('open', () => {
    spinner.text = `[BulkApiV2] Load Job ${job.id} successfully created.`;
  });
  // Upload job data
  await job.open();
  await job.uploadData(records);
  await job.close();
  // Monitor job execution
  job.on('inProgress', (jobInfo: any) => {
    spinner.text = `[BulkApiV2] Processed: ${jobInfo.numberRecordsProcessed}. Failed: ${jobInfo.numberRecordsFailed}`;
  });
  job.on('failed', (e) => {
    spinner.fail(`[BulkApiV2] Error: ${e.message}`);
  });
  await job.poll();
  const res = await job.getAllResults();
  spinner.succeed(`[BulkApiV2] Bulk ${action.toUpperCase()} on ${objectName} completed.`);
  uxLog("log", this, c.grey(`[BulkApiV2] Bulk ${action.toUpperCase()} on ${objectName} completed.
- Success: ${res.successfulResults.length} records
- Failed: ${res.failedResults.length} records
- Unprocessed: ${res.unprocessedRecords.length} records`));
  // Empty outputFile so generateReportPath builds a real path (report dir, branch, date, .csv);
  // passing the name as outputFile would be taken as an explicit path and bypass all of that.
  const outputFile = await generateReportPath(`bulk-${objectName}-${action}`, '', { withDate: true });
  if (res.failedResults.length > 0) {
    uxLog("warning", this, c.yellow(`[BulkApiV2] Some records failed to ${action}. Check the results for details.`));
  }
  await generateCsvFile(res.successfulResults, outputFile.replace('.csv', '-successful.csv'),
    {
      fileTitle: `${objectName} - ${action} - Successful`,
      noExcel: true
    });
  await generateCsvFile(res.failedResults, outputFile.replace('.csv', '-failed.csv'), {
    fileTitle: `${objectName} - ${action} - Failed`,
    noExcel: true
  });
  // Return results
  return res;
}

export async function bulkDelete(
  objectName: string,
  recordIds: string[],
  conn: Connection
): Promise<any> {
  const records = recordIds.map(recordId => { return { Id: recordId } });
  return await bulkUpdate(objectName, "delete", records, conn);
}

// Tooling API composite requests accept at most 25 subrequests.
const TOOLING_COMPOSITE_CHUNK_SIZE = 25;

// Delete records via the Tooling API. jsforce conn.tooling.destroy(type, ids[]) can NOT be used here:
// https://github.com/jsforce/jsforce/issues/1815.
// Batch unitary DELETE subrequests through the Tooling composite endpoint,
// Fall back to one-by-one deletes also through Tooling API instead of sf CLI for speed..
export async function bulkDeleteTooling(
  objectName: string,
  recordsIds: string[],
  conn: Connection
): Promise<{ results: any[] }> {
  uxLog("log", this, c.grey('[ToolingApi] ' + t('toolingApiDeletingRecords', { count: recordsIds.length, objectName: objectName, ids: JSON.stringify(recordsIds) })));
  const basePath = `/services/data/v${conn.getApiVersion()}/tooling`;
  const totalChunks = Math.ceil(recordsIds.length / TOOLING_COMPOSITE_CHUNK_SIZE);
  const results: any[] = [];
  for (let i = 0; i < recordsIds.length; i += TOOLING_COMPOSITE_CHUNK_SIZE) {
    const chunkIds = recordsIds.slice(i, i + TOOLING_COMPOSITE_CHUNK_SIZE);
    if (totalChunks > 1) {
      const currentChunk = Math.floor(i / TOOLING_COMPOSITE_CHUNK_SIZE) + 1;
      uxLog("log", this, c.grey('[ToolingApi] ' + t('toolingApiCompositeChunk', { current: currentChunk, total: totalChunks, count: chunkIds.length })));
    }
    try {
      const recordIdByReferenceId = new Map(chunkIds.map((recordId, pos) => [`ref${pos}`, recordId]));
      const compositeRequest = chunkIds.map((recordId, pos) => ({
        method: 'DELETE',
        url: `${basePath}/sobjects/${objectName}/${recordId}`,
        referenceId: `ref${pos}`,
      }));
      const compositeRes: any = await conn.requestPost(`${basePath}/composite`, { allOrNone: false, compositeRequest });
      for (const subResponse of compositeRes?.compositeResponse || []) {
        const recordId = recordIdByReferenceId.get(subResponse?.referenceId) || '';
        if (subResponse?.httpStatusCode >= 200 && subResponse?.httpStatusCode < 300) {
          results.push({ Id: recordId, success: true, errors: [] });
        } else {
          const errors = (Array.isArray(subResponse?.body) ? subResponse.body : [subResponse?.body])
            .filter(Boolean)
            .map((err: any) => ({ statusCode: err?.errorCode ?? String(subResponse?.httpStatusCode), message: err?.message ?? JSON.stringify(err) }));
          results.push({ Id: recordId, success: false, errors });
        }
      }
    } catch (e: any) {
      uxLog("warning", this, c.yellow('[ToolingApi] ' + t('toolingApiCompositeFallback', { error: e.message })));
      results.push(...(await deleteToolingRecordsOneByOne(objectName, chunkIds, conn)));
    }
  }
  return { results };
}

// Unitary Tooling API deletes: single-id conn.tooling.destroy targets /tooling/sobjects/<type>/<id>
async function deleteToolingRecordsOneByOne(
  objectName: string,
  recordsIds: string[],
  conn: Connection
): Promise<any[]> {
  const results: any[] = [];
  WebSocketClient.sendProgressStartMessage(t('deletingRecordsOnObject', { count: recordsIds.length, objectName: objectName }), recordsIds.length);
  let step = 0;
  for (const recordId of recordsIds) {
    step++;
    try {
      await conn.tooling.destroy(objectName, recordId);
      results.push({ Id: recordId, success: true, errors: [] });
    } catch (e: any) {
      results.push({ Id: recordId, success: false, errors: [{ statusCode: e.errorCode ?? e.name, message: e.message }] });
    }
    WebSocketClient.sendProgressStepMessage(step, recordsIds.length);
  }
  WebSocketClient.sendProgressEndMessage(recordsIds.length);
  return results;
}
