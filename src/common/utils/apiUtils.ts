import { uxLog } from './index.js';
import c from 'chalk';
import { Connection } from '@salesforce/core';
import ora, { Ora } from 'ora';
import { IngestJobV2Results, IngestOperation, JobInfoV2 } from 'jsforce/lib/api/bulk2.js';
import { Schema } from 'jsforce';

// Perform simple SOQL query (max results: 10000)
export function soqlQuery(soqlQuery: string, conn: Connection): Promise<any> {
  uxLog(
    this,
    c.grey(
      'SOQL REST: ' +
      c.italic(soqlQuery.length > 500 ? soqlQuery.substr(0, 500) + '...' : soqlQuery) +
      ' on ' +
      conn.instanceUrl
    )
  );
  return Promise.resolve(conn.query(soqlQuery));
}

// Perform simple SOQL query with Tooling API
export function soqlQueryTooling(soqlQuery: string, conn: Connection): Promise<any> {
  uxLog(
    this,
    c.grey(
      'SOQL REST Tooling: ' +
      c.italic(soqlQuery.length > 500 ? soqlQuery.substr(0, 500) + '...' : soqlQuery) +
      ' on ' +
      conn.instanceUrl
    )
  );
  return Promise.resolve(conn.tooling.query(soqlQuery));
}

let spinnerQ;
const maxRetry = Number(process.env.BULK_QUERY_RETRY || 5);
// Same than soqlQuery but using bulk. Do not use if there will be too many results for javascript to handle in memory
export async function bulkQuery(soqlQuery: string, conn: Connection, retries = 3): Promise<any> {
  uxLog(this, c.grey('SOQL BULK: ' + c.italic(soqlQuery.length > 500 ? soqlQuery.substr(0, 500) + '...' : soqlQuery)));
  conn.bulk.pollInterval = 5000; // 5 sec
  conn.bulk.pollTimeout = 60000; // 60 sec
  // Start query
  try {
    spinnerQ = ora({ text: `[BulkApiV2] Bulk query...`, spinner: 'moon' }).start();
    const recordStream = await conn.bulk2.query(soqlQuery);
    recordStream.on('error', (err) => {
      uxLog(this, c.yellow('Bulk query error: ' + err));
      globalThis.sfdxHardisFatalError = true;
    });
    // Wait for all results
    const records = await recordStream.toArray();
    spinnerQ.succeed(`Bulk query completed with ${records.length} results.`);
    return { records: records };
  } catch (e) {
    spinnerQ.fail(`Bulk query error.`);
    // Try again if the reason is a timeout and max number of retries is not reached yet
    if ((e + '').includes('ETIMEDOUT') && retries < maxRetry) {
      uxLog(this, c.yellow('Bulk query retry attempt #' + retries + 1));
      return await bulkQuery(soqlQuery, conn, retries + 1);
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

let spinner: Ora;
// Same than soqlQuery but using bulk. Do not use if there will be too many results for javascript to handle in memory
export async function bulkUpdate(
  objectName: string,
  action: IngestOperation,
  records: Array<any>,
  conn: Connection
): Promise<IngestJobV2Results<Schema>> {
  uxLog(
    this,
    c.grey(
      `SOQL BULK on object ${c.bold(objectName)} with action ${c.bold(action)} (${c.bold(records.length)} records)`
    )
  );
  conn.bulk2.pollInterval = 5000; // 5 sec
  conn.bulk2.pollTimeout = 60000; // 60 sec
  // Initialize Job
  spinner = ora({ text: `[BulkApiV2] Bulk Load on ${objectName} (${action})`, spinner: 'moon' }).start();
  const job = conn.bulk2.createJob({
    operation: action,
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
  job.on('inProgress', (jobInfo: JobInfoV2) => {
    spinner.text = `[BulkApiV2] Processed: ${jobInfo.numberRecordsProcessed}. Failed: ${jobInfo.numberRecordsFailed}`;
  });
  job.on('failed', (e) => {
    spinner.fail(`[BulkApiV2] Error: ${e.message}`);
  });
  await job.poll();
  const res = await job.getAllResults();
  spinner.succeed(`Bulk Load on ${objectName} (${action}) completed.`);
  return res;
}

export async function bulkDeleteTooling(
  objectName: string,
  recordsFull: { Id: string }[],
  conn: Connection
): Promise<any> {
  const records = recordsFull.map((record) => record.Id);
  const deleteJobResults = await conn.tooling.del(objectName, records, { allOrNone: false });
  return deleteJobResults;
}
