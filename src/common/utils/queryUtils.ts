import { uxLog } from ".";
import * as c from "chalk";
import { Connection } from "jsforce";
import { SfdxError } from "@salesforce/core";

// Perform simple SOQL query (max results: 10000)
export function soqlQuery(soqlQuery: string, conn: Connection): Promise<any> {
  uxLog(this, c.grey("SOQL REST: " + c.italic(soqlQuery.length > 500 ? soqlQuery.substr(0, 500) + "..." : soqlQuery)));
  return conn.query(soqlQuery);
}

// Same than soqlQuery but using bulk. Do not use if there will be too many results for javascript to handle in memory
export async function bulkQuery(soqlQuery: string, conn: Connection): Promise<any> {
  uxLog(this, c.grey("SOQL BULK: " + c.italic(soqlQuery.length > 500 ? soqlQuery.substr(0, 500) + "..." : soqlQuery)));
  const records = [];
  return new Promise((resolve, reject) => {
    const job = conn.bulk.query(soqlQuery);
    job
      .on("record", async (record) => {
        records.push(record);
      })
      .on("error", (err) => {
        uxLog(this, c.red("Bulk query error:" + err));
        reject(err);
        throw new SfdxError(c.red("Bulk query error:" + err));
      })
      .on("end", () => {
        resolve({ records: records, totalSize: records.length });
      });
  });
}
