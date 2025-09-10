import { execSfdxJson, uxLog } from './index.js';
import c from 'chalk';
import { Connection } from '@salesforce/core';
import ora, { Ora } from 'ora';
import { WebSocketClient } from '../websocketClient.js';
import { generateCsvFile, generateReportPath } from './filesUtils.js';

// Constants for record limits
const MAX_CHUNKS = Number(process.env.SOQL_MAX_BATCHES ?? 50);
const CHUNK_SIZE = Number(process.env.SOQL_CHUNK_SIZE ?? 200);
const MAX_RECORDS = MAX_CHUNKS * CHUNK_SIZE;

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
    uxLog("log", this, c.grey(`Fetching batch ${batchCount + 1}/${MAX_CHUNKS}...`));
    pageRes = await conn.queryMore(pageRes.nextRecordsUrl);
    res.records.push(...pageRes.records);
    batchCount++;
  }
  if (!pageRes.done) {
    uxLog("warning", this, c.yellow(`Warning: Query limit of ${MAX_RECORDS} records reached. Some records were not retrieved.`));
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
export async function soqlQueryTooling(soqlQuery: string, conn: Connection): Promise<any> {
  uxLog(
    "log",
    this,
    c.grey(
      '[SOQL Query Tooling] ' +
      c.italic(soqlQuery.length > 500 ? soqlQuery.substr(0, 500) + '...' : soqlQuery)
    )
  );
  // First query
  const res = await conn.tooling.query(soqlQuery);
  let pageRes = Object.assign({}, res);
  let batchCount = 1;
  // Get all page results
  while (pageRes.done === false && pageRes.nextRecordsUrl) {
    pageRes = await conn.tooling.queryMore(pageRes.nextRecordsUrl || "");
    res.records.push(...pageRes.records);
    batchCount++;
  }
  if (batchCount > 1) {
    uxLog("log", this, c.grey(`[SOQL Query Tooling] Retrieved ${res.records.length} records in ${batchCount} chunks(s)`));
  } else {
    uxLog("log", this, c.grey(`[SOQL Query Tooling] Retrieved ${res.records.length} records`));
  }
  return res;
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
      uxLog("warning", this, c.yellow('Bulk Query error: ' + err));
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
    let soqlQueryWithLimit = `${soqlQuery} ORDER BY Id LIMIT ${batchSize}`;
    if (lastRecordId) {
      soqlQueryWithLimit = `${soqlQuery} WHERE Id > '${lastRecordId}' ORDER BY Id LIMIT ${batchSize}`;
    }
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
  conn.bulk2.pollInterval = 5000; // 5 sec
  conn.bulk2.pollTimeout = 60000; // 60 sec
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
  const outputFile = await generateReportPath('bulk', `${objectName}-${action}`, { withDate: true });
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

export async function bulkDeleteTooling(
  objectName: string,
  recordsIds: string[],
  conn: Connection
): Promise<any> {
  uxLog("log", this, c.grey(`[ToolingApi] Delete ${recordsIds.length} records on ${objectName}: ${JSON.stringify(recordsIds)}`));
  try {
    const deleteJobResults = await conn.tooling.destroy(objectName, recordsIds, { allOrNone: false });
    return deleteJobResults
  } catch (e: any) {
    uxLog("warning", this, c.yellow(`[ToolingApi] jsforce error while calling Tooling API. Fallback to to unitary delete (longer but should work !)`));
    uxLog("log", this, c.grey(e.message));
    const deleteJobResults: any = [];
    for (const record of recordsIds) {
      const deleteCommand =
        `sf data:delete:record --sobject ${objectName} --record-id ${record} --target-org ${conn.getUsername()} --use-tooling-api`;
      const deleteCommandRes = await execSfdxJson(deleteCommand, this, {
        fail: false,
        output: true
      });
      const deleteResult: any = { Id: record, success: true }
      if (!(deleteCommandRes.status === 0)) {
        deleteResult.success = false;
        deleteResult.error = JSON.stringify(deleteCommandRes);
      }
      deleteJobResults.push(deleteResult);
    }
    return { results: deleteJobResults };
  }
}
