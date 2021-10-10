import { uxLog } from ".";
import * as c from "chalk";
import { Connection } from "jsforce";
import { SfdxError } from "@salesforce/core";
import ora = require("ora");

// Perform simple SOQL query (max results: 10000)
export function soqlQuery(soqlQuery: string, conn: Connection): Promise<any> {
  uxLog(this, c.grey("SOQL REST: " + c.italic(soqlQuery.length > 500 ? soqlQuery.substr(0, 500) + "..." : soqlQuery)));
  return conn.query(soqlQuery);
}

let spinnerQ ;
// Same than soqlQuery but using bulk. Do not use if there will be too many results for javascript to handle in memory
export async function bulkQuery(soqlQuery: string, conn: Connection): Promise<any> {
  uxLog(this, c.grey("SOQL BULK: " + c.italic(soqlQuery.length > 500 ? soqlQuery.substr(0, 500) + "..." : soqlQuery)));
  const records = [];
  return new Promise((resolve, reject) => {
    spinnerQ = ora({ text: `Bulk query...`, spinner: "moon" }).start();
    const job = conn.bulk.query(soqlQuery);
    job
      .on("record", async (record) => {
        records.push(record);
      })
      .on("error", (err) => {
        spinnerQ.succeed(`Bulk query failed.`);
        uxLog(this, c.red("Bulk query error:" + err));
        reject(err);
        throw new SfdxError(c.red("Bulk query error:" + err));
      })
      .on("end", () => {
        spinnerQ.succeed(`Bulk query completed.`);
        resolve({ records: records, totalSize: records.length });
      });
  });
}

let spinner ;
// Same than soqlQuery but using bulk. Do not use if there will be too many results for javascript to handle in memory
export async function bulkUpdate(objectName: string, action: string, records: Array<any>, conn: Connection): Promise<any> {
  uxLog(this, c.grey(`SOQL BULK on object ${c.bold(objectName)} with action ${c.bold(action)} (${c.bold(records.length)} records)`));
  return new Promise((resolve, reject) => {
    const job = conn.bulk.createJob(objectName, action);
    const batch = job.createBatch();
    batch.execute(records);
    batch.on("queue", async (batchInfo) => {
      uxLog(this, c.grey("Bulk API job batch has been queued"));
      uxLog(this,c.grey(JSON.stringify(batchInfo,null,2)));
      spinner = ora({ text: `Bulk Load on ${objectName} (${action})`, spinner: "moon" }).start();
      batch.poll(3 * 1000, 120 * 1000);
    })
    batch.on("error", (batchInfo) => {
      spinner.fail(`Bulk Load on ${objectName} (${action}) failed.`);
      uxLog(this, c.red("Bulk query error:" + batchInfo));
      reject(batchInfo);
      throw new SfdxError(c.red("Bulk query error:" + batchInfo));
    })
    batch.on("response", (results) => {
      spinner.succeed(`Bulk Load on ${objectName} (${action}) completed.`);
      resolve({
        results: results,
        totalSize: results.length,
        successRecordsNb: results.filter(result => result.success).length,
        errorRecordsNb: results.filter(result => !result.success).length
      });
    });
  });
}
