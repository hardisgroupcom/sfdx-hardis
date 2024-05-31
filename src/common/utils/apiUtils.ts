import { uxLog } from ".";
import * as c from "chalk";
import { Connection, SfdxError } from "@salesforce/core";
import { RestApiOptions, RecordResult } from "jsforce";
import ora = require("ora");

// Perform simple SOQL query (max results: 10000)
export function soqlQuery(soqlQuery: string, conn: Connection): Promise<any> {
  uxLog(this, c.grey("SOQL REST: " + c.italic(soqlQuery.length > 500 ? soqlQuery.substr(0, 500) + "..." : soqlQuery) + " on " + conn.instanceUrl));
  return conn.query(soqlQuery);
}

let spinnerQ;
const maxRetry = Number(process.env.BULK_QUERY_RETRY || 5);
// Same than soqlQuery but using bulk. Do not use if there will be too many results for javascript to handle in memory
export async function bulkQuery(soqlQuery: string, conn: Connection, retries = 3): Promise<any> {
  uxLog(this, c.grey("SOQL BULK: " + c.italic(soqlQuery.length > 500 ? soqlQuery.substr(0, 500) + "..." : soqlQuery)));
  conn.bulk.pollInterval = 5000; // 5 sec
  conn.bulk.pollTimeout = 60000; // 60 sec
  const records = [];
  return new Promise((resolve, reject) => {
    spinnerQ = ora({ text: `Bulk query...`, spinner: "moon" }).start();
    const job = conn.bulk.query(soqlQuery);
    job
      .on("record", async (record) => {
        records.push(record);
      })
      .on("error", async (err) => {
        spinnerQ.fail(`Bulk query error.`);
        uxLog(this, c.yellow("Bulk query error: " + err));
        // In case of timeout, retry if max retry is not reached
        if ((err + "").includes("ETIMEDOUT") && retries < maxRetry) {
          uxLog(this, c.yellow("Bulk query retry attempt #" + retries + 1));
          bulkQuery(soqlQuery, conn, retries + 1)
            .then((resRetry) => {
              resolve(resRetry);
            })
            .catch((resErr) => {
              reject(resErr);
            });
        } else {
          // If max retry attempts reached, give up
          uxLog(this, c.red("Bulk query error: max retry attempts reached, or not timeout error."));
          globalThis.sfdxHardisFatalError = true;
          reject(err);
        }
      })
      .on("end", () => {
        spinnerQ.succeed(`Bulk query completed with ${records.length} results.`);
        resolve({ records: records, totalSize: records.length });
      });
  });
}

// When you might have more than 1000 elements in a IN condition, you need to split the request into several requests
// Think to use {{IN}} in soqlQuery
export async function bulkQueryChunksIn(soqlQuery: string, conn: Connection, inElements: string[], batchSize = 1000, retries = 3): Promise<any> {
  const results = { records: [] };
  for (let i = 0; i < inElements.length; i += batchSize) {
    const inElementsChunk = inElements.slice(i, i + batchSize);
    const replacementString = "'" + inElementsChunk.join("','") + "'";
    const soqlQueryWithInConstraint = soqlQuery.replace("{{IN}}", replacementString);
    const chunkResults = await bulkQuery(soqlQueryWithInConstraint, conn, retries);
    results.records.push(...chunkResults.records);
  }
  return results;
}

let spinner;
// Same than soqlQuery but using bulk. Do not use if there will be too many results for javascript to handle in memory
export async function bulkUpdate(objectName: string, action: string, records: Array<any>, conn: Connection): Promise<any> {
  uxLog(this, c.grey(`SOQL BULK on object ${c.bold(objectName)} with action ${c.bold(action)} (${c.bold(records.length)} records)`));
  conn.bulk.pollInterval = 5000; // 5 sec
  conn.bulk.pollTimeout = 60000; // 60 sec
  return new Promise((resolve, reject) => {
    const job = conn.bulk.createJob(objectName, action);
    const batch = job.createBatch();
    batch.execute(records);
    batch.on("queue", async (batchInfo) => {
      uxLog(this, c.grey("Bulk API job batch has been queued"));
      uxLog(this, c.grey(JSON.stringify(batchInfo, null, 2)));
      spinner = ora({ text: `Bulk Load on ${objectName} (${action})`, spinner: "moon" }).start();
      batch.poll(3 * 1000, 120 * 1000);
    });
    batch.on("error", (batchInfo) => {
      job.close();
      spinner.fail(`Bulk Load on ${objectName} (${action}) failed.`);
      uxLog(this, c.red("Bulk query error:" + batchInfo));
      reject(batchInfo);
      throw new SfdxError(c.red("Bulk query error:" + batchInfo));
    });
    batch.on("response", (results) => {
      job.close();
      spinner.succeed(`Bulk Load on ${objectName} (${action}) completed.`);
      resolve({
        results: results,
        totalSize: results.length,
        successRecordsNb: results.filter((result) => result.success).length,
        errorRecordsNb: results.filter((result) => !result.success).length,
      });
    });
  });
}

export async function bulkDeleteTooling(objectName: string, records: string | string[], conn: Connection): Promise<any> {
  return new Promise((resolve, reject) => {
    uxLog(this, c.red('WE ARE DELETING THE RECORDS: ' + records));

    const options: RestApiOptions = { allOrNone: false };

    const handleCallback = (err: Error, result: RecordResult | RecordResult[]) => {
      if (err) {
        console.error('Error deleting records:', err);
        const resultObject = createResultObject(records, false, 'One or more records failed to delete.');
        // console.log('Result Object with Error:', JSON.stringify(resultObject, null, 2));
        resolve(resultObject);
      } else {
        const resultsArray = Array.isArray(result) ? result : [result];
        const anyFailure = resultsArray.some(result => !result.success);

        const resultObject = createResultObject(records, !anyFailure, anyFailure ? 'One or more records failed to delete.' : '');
        // console.log('Result Object:', JSON.stringify(resultObject, null, 2));
        resolve(resultObject);
      }
    };

    const createResultObject = (records: string | string[], success: boolean, errorMessage: string) => {
      const recordsArray = Array.isArray(records) ? records : [records];

      return {
        results: recordsArray.map(record => ({
          id: record,
          success: success,
          errors: success ? [] : [errorMessage]
        })),
        totalSize: recordsArray.length,
        successRecordsNb: success ? recordsArray.length : 0,
        errorRecordsNb: success ? 0 : recordsArray.length,
        errorDetails: success ? [] : [{ error: errorMessage }]
      };
    };

    try {
      conn.tooling.del(objectName, records, options, handleCallback);
    } catch (error) {
      console.error('Synchronous error:', error);
      const resultObject = createResultObject(records, false, 'One or more records failed to delete due to a synchronous error.');
      // console.log('Result Object with Synchronous Error:', JSON.stringify(resultObject, null, 2));
      reject(resultObject);
      throw new SfdxError(c.red("Tooling Error:" + resultObject));
    }
  });
}

// export async function bulkDeleteTooling(objectName: string, records: string | string[], conn: Connection): Promise<any> {
//   return new Promise((resolve, reject) => {
//     uxLog(this, c.red('WE ARE DELETING THE RECORDS: ' + records));

//     const options: RestApiOptions = { allOrNone: false };

//     const handleCallback = (err: Error, result: RecordResult | RecordResult[]) => {
//       if (err) {
//         console.error('Error deleting records:', err);
//         const resultObject = createResultObject(records, false, err.message);
//         console.log('Result Object with Error:', JSON.stringify(resultObject, null, 2));
//         resolve(resultObject);
//       } else {
//         const resultsArray = Array.isArray(result) ? result : [result];
//         const errorDetails = resultsArray
//           .map((element, index) => !element.success && {
//             id: 'id' in element ? element.id : records[index],
//             errors: element.errors
//           })
//           .filter(Boolean);

//         const resultObject = {
//           results: resultsArray,
//           totalSize: records.length,
//           successRecordsNb: resultsArray.filter((result: RecordResult) => result.success).length,
//           errorRecordsNb: errorDetails.length,
//           errorDetails: errorDetails as { id: string; errors: string[] }[]
//         };

//         console.log('Result Object:', JSON.stringify(resultObject, null, 2));
//         resolve(resultObject);
//       }
//     };

//     const createResultObject = (records: string | string[], success: boolean, errorMessage: string) => {
//       const recordsArray = Array.isArray(records) ? records : [records];

//       return {
//         results: recordsArray.map(record => ({
//           id: record,
//           success: success,
//           errors: [errorMessage]
//         })),
//         totalSize: recordsArray.length,
//         successRecordsNb: success ? recordsArray.length : 0,
//         errorRecordsNb: success ? 0 : recordsArray.length,
//         errorDetails: recordsArray.map(record => ({ id: record, errors: [errorMessage] }))
//       };
//     };

//     try {
//       conn.tooling.del(objectName, records, options, handleCallback);
//     } catch (error) {
//       console.error('Synchronous error:', error);
//       const resultObject = createResultObject(records, false, error.message);
//       console.log('Result Object with Synchronous Error:', JSON.stringify(resultObject, null, 2));
//       resolve(resultObject);
//     }
//   });
// }

// export async function bulkDeleteTooling(objectName: string, records: Array<any>, conn: Connection): Promise<any> {
//   let originalRecs;
//   return new Promise((resolve, reject) => {
//     // Log the records being deleted
//     uxLog(this, c.red('WE ARE DELETING THE RECORDS: ' + records));


//     // be aware that `allOrNone` option in parallel mode will not revert the other successful requests
//     // it only raises error when met at least one failed request.
//     conn.tooling.query
//     // Define the RestApiOptions with allOrNone set to false
//     const options: RestApiOptions = {
//       allOrNone: false
//     };

//     const options2: ExecuteOptions = {
//       scanAll : true
//     };

//     // Define the callback function
//     const callback = (err: Error, result: RecordResult | RecordResult[]) => {
//       console.log('All Info Below!');
      

//       console.log(err);
//       console.log(result);
      
//       if (err) {
//         // Log and handle the error without rejecting the promise
//         console.error('Error deleting records:', err);

//         // Create a custom return object indicating the error
//         const resultObject = {
//           results: records.map(record => ({
//             id: record,
//             success: false,
//             errors: [err.message]
//           })),
//           totalSize: records.length,
//           successRecordsNb: 0,
//           errorRecordsNb: records.length,
//           errorDetails: records.map(record => ({ id: record, errors: [err.message] }))
//         };

//         // Log the error details with full details
//         console.log('Result Object with Error:', JSON.stringify(resultObject, null, 2));

//         // Resolve the promise with the custom object
//         mericTest();

//         resolve(resultObject);
//       } else {
//         // Ensure result is treated as an array
//         const resultsArray = Array.isArray(result) ? result : [result];

//         // Process the results
//         const errorDetails: { id: string; errors: string[] }[] = [];
//         for (let index = 0; index < records.length; index++) {
//           const element = resultsArray[index];
//           const successInfo = element.success ? 'Success' : 'Failure';
//           const errorsInfo = 'errors' in element && element.errors.length > 0 ? `Errors: ${element.errors.join(', ')}` : 'No Errors';

//           console.log(`Element ${index + 1}: ${successInfo}, ${errorsInfo}`);

//           if (!element.success) {
//             errorDetails.push({
//               id: 'id' in element ? element.id : records[index],
//               errors: element.errors
//             });
//           }
//         }

//         // Create custom return object
//         const resultObject = {
//           results: resultsArray,
//           totalSize: records.length,
//           successRecordsNb: resultsArray.filter((result: RecordResult) => result.success).length,
//           errorRecordsNb: resultsArray.filter((result: RecordResult) => !result.success).length,
//           errorDetails: errorDetails
//         };

//         // Log the result object with full details
//         console.log('Result Object:', JSON.stringify(resultObject, null, 2));

//         // Resolve the promise with the custom object
//         mericTest();

//         resolve(resultObject);
//       }

//     };

//     const mericTest = () => {
//       console.log("mericTest function called!");
//       console.log(this.originalRecs);
      
//       // Add any additional logic you want to execute here
//     };

//     try {
//       // Perform the delete operation with the specified options and callback
//       conn.tooling.del(objectName, records, options, callback);
//     } catch (error) {
//       // Handle synchronous errors
//       console.error('Synchronous error:', error);

//       // Create a custom return object indicating the error
//       const resultObject = {
//         results: records.map(record => ({
//           id: record,
//           success: false,
//           errors: [error.message]
//         })),
//         totalSize: records.length,
//         successRecordsNb: 0,
//         errorRecordsNb: records.length,
//         errorDetails: records.map(record => ({ id: record, errors: [error.message] }))
//       };

//       // Log the error details with full details
//       console.log('Result Object with Synchronous Error:', JSON.stringify(resultObject, null, 2));

//       // Resolve the promise with the custom object
//       resolve(resultObject);
//     }
//   });
// }

// export async function bulkDeleteTooling(objectName: string, records: Array<any>, conn: Connection): Promise<any> {
//   // uxLog(this, c.grey("SOQL TOOLING: " + c.italic(soqlQuery.length > 500 ? soqlQuery.substr(0, 500) + "..." : soqlQuery)));
//   // const a = ['301J7000000GoOkIAK','301J7000000GobKIAS','301J7000000GobPIAS'];
//   uxLog(this, c.red('WE ARE DELETING THE RECORDS: ' + records)); 
//   const res2 = await conn.tooling.del(objectName, records);
//   // console.log(res2);
//   console.log(res2[0].success);
//   console.log(res2[0].errors);

//   console.log(res2);
//   //  console.log(deleteResults[0]);
//    for (let index = 0; index < records.length; index++) {
//     const element = res2[index];
//     console.log(element);
//     console.log(element.success);
//     console.log(element.errors);
//    }
// }

// export async function bulkDeleteTooling(objectName: string, records: Array<any>, conn: Connection): Promise<any> {
//   // uxLog(this, c.grey("SOQL TOOLING: " + c.italic(soqlQuery.length > 500 ? soqlQuery.substr(0, 500) + "..." : soqlQuery)));
//   // const a = ['301J7000000GoOkIAK','301J7000000GobKIAS','301J7000000GobPIAS'];
//   uxLog(this, c.red('WE ARE DELETING THE RECORDS: ' + records)); 
//   const res2 = await conn.tooling.del(objectName, records);
//   // console.log(res2);

//   for (let index = 0; index < records.length; index++) {
//     const element = res2[index];
//     const successInfo = element.success ? 'Success' : 'Failure';
//     const errorsInfo = element.errors && element.errors.length > 0 ? `Errors: ${element.errors.join(', ')}` : 'No Errors';
    
//     console.log(`Element ${index + 1}: ${successInfo}, ${errorsInfo}`);
//   }
// }

// export async function bulkDeleteTooling(objectName: string, records: Array<any>, conn: Connection): Promise<any> {
//   return new Promise((resolve, reject) => {
//     // Log the records being deleted
//     uxLog(this, c.red('WE ARE DELETING THE RECORDS: ' + records));
    
//     // Perform the delete operation
//     conn.tooling.del(objectName, records)
//       .then((res2) => {
//         // Process the results
//         for (let index = 0; index < records.length; index++) {
//           const element = res2[index];
//           const successInfo = element.success ? 'Success' : 'Failure';
//           const errorsInfo = element.errors && element.errors.length > 0 ? `Errors: ${element.errors.join(', ')}` : 'No Errors';
          
//           console.log(`Element ${index + 1}: ${successInfo}, ${errorsInfo}`);
//         }
//         // Resolve the promise with the result
//         resolve(res2);
//       })
//       .catch((error) => {
//         // Log and reject the promise on error
//         console.error('Error deleting records:', error);
//         reject(error);
//       });
//   });
// }

// export async function bulkDeleteTooling(objectName: string, records: Array<any>, conn: Connection): Promise<any> {
//   return new Promise((resolve, reject) => {
//     // Log the records being deleted
//     uxLog(this, c.red('WE ARE DELETING THE RECORDS: ' + records));
    
//     // Perform the delete operation
//     conn.tooling.del(objectName, records)
//       .then((res2) => {
//         // Process the results
//         let errorDetails = [];
//         for (let index = 0; index < records.length; index++) {
//           const element = res2[index];
//           const successInfo = element.success ? 'Success' : 'Failure';
//           const errorsInfo = element.errors && element.errors.length > 0 ? `Errors: ${element.errors.join(', ')}` : 'No Errors';
          
//           console.log(`Element ${index + 1}: ${successInfo}, ${errorsInfo}`);
          
//           if (!element.success) {
//             errorDetails.push({
//               id: element.id,
//               errors: element.errors
//             });
//           }
//         }

//         // Create custom return object
//         const resultObject = {
//           results: res2,
//           totalSize: res2.length,
//           successRecordsNb: res2.filter((result) => result.success).length,
//           errorRecordsNb: res2.filter((result) => !result.success).length,
//           errorDetails: errorDetails
//         };

//         // Resolve the promise with the custom object
//         resolve(resultObject);
//       })
//       .catch((error) => {
//         // Log and reject the promise on error
//         console.error('Error deleting records:', error);
//         reject(error);
//       });
//   });
// }
// export async function bulkDeleteTooling(objectName: string, records: Array<any>, conn: Connection): Promise<any> {
//   return new Promise((resolve, reject) => {
//     // Log the records being deleted
//     uxLog(this, c.red('WE ARE DELETING THE RECORDS: ' + records));
    
//     // Perform the delete operation
//     conn.tooling.del(objectName, records)
//       .then((res2: any) => {
//         // Ensure res2 is treated as an array
//         const resultsArray = Array.isArray(res2) ? res2 : [res2];

//         // Process the results
//         let errorDetails = [];
//         for (let index = 0; index < records.length; index++) {
//           const element = resultsArray[index];
//           const successInfo = element.success ? 'Success' : 'Failure';
//           const errorsInfo = element.errors && element.errors.length > 0 ? `Errors: ${element.errors.join(', ')}` : 'No Errors';
          
//           console.log(`Element ${index + 1}: ${successInfo}, ${errorsInfo}`);
          
//           if (!element.success) {
//             errorDetails.push({
//               id: element.id,
//               errors: element.errors
//             });
//           }
//         }

//         // Create custom return object
//         const resultObject = {
//           results: resultsArray,
//           totalSize: records.length,
//           successRecordsNb: resultsArray.filter((result: any) => result.success).length,
//           errorRecordsNb: resultsArray.filter((result: any) => !result.success).length,
//           errorDetails: errorDetails
//         };

//         // Resolve the promise with the custom object
//         resolve(resultObject);
//       })
//       .catch((error) => {
//         // Log and reject the promise on error
//         console.error('Error deleting records:', error);
//         reject(error);
//       });
//   });
// }
// export async function bulkDeleteTooling(objectName: string, records: Array<any>, conn: Connection): Promise<any> {
//   return new Promise((resolve, reject) => {
//     // Log the records being deleted
//     uxLog(this, c.red('WE ARE DELETING THE RECORDS: ' + records));
    
//     // Perform the delete operation
//     conn.tooling.del(objectName, records)
//       .then((res2: any) => {
//         // Ensure res2 is treated as an array
//         const resultsArray = Array.isArray(res2) ? res2 : [res2];

//         // Process the results
//         const errorDetails = [];
//         for (let index = 0; index < records.length; index++) {
//           const element = resultsArray[index];
//           const successInfo = element.success ? 'Success' : 'Failure';
//           const errorsInfo = element.errors && element.errors.length > 0 ? `Errors: ${element.errors.join(', ')}` : 'No Errors';
          
//           console.log(`Element ${index + 1}: ${successInfo}, ${errorsInfo}`);
          
//           if (!element.success) {
//             errorDetails.push({
//               id: element.id,
//               errors: element.errors
//             });
//           }
//         }

//         // Create custom return object
//         const resultObject = {
//           results: resultsArray,
//           totalSize: records.length,
//           successRecordsNb: resultsArray.filter((result: any) => result.success).length,
//           errorRecordsNb: resultsArray.filter((result: any) => !result.success).length,
//           errorDetails: errorDetails
//         };

//         // Resolve the promise with the custom object
//         resolve(resultObject);
//       })
//       .catch((error) => {
//         // Log and reject the promise on error
//         console.error('Error deleting records:', error);
//         reject(error);
//       });
//   });
// }
// export async function bulkDeleteToolingOld(soqlQuery: string, conn: Connection, retries = 3): Promise<any> {
//   uxLog(this, c.grey("SOQL TOOLING: " + c.italic(soqlQuery.length > 500 ? soqlQuery.substr(0, 500) + "..." : soqlQuery)));
//   // conn.bulk.pollInterval = 5000; // 5 sec
//   // conn.bulk.pollTimeout = 60000; // 60 sec
//   // conn.tooling.query


//   // const records = [];
//   // const res = await conn.tooling.executeAnonymous("System.debug('Hello World');");
//   // console.log("ExecuteAnonymousResult column: " + res.column);
//   // console.log("ExecuteAnonymousResult compiled: " + res.compiled);
//   // console.log("ExecuteAnonymousResult compileProblem: " + res.compileProblem);
//   // console.log("ExecuteAnonymousResult exceptionMessage: " + res.exceptionMessage);
//   // console.log("ExecuteAnonymousResult exceptionStackTrace: " + res.exceptionStackTrace);
//   // console.log("ExecuteAnonymousResult line: " + res.line);
//   // console.log("ExecuteAnonymousResult success: " + res.success);
//   const a = ['301J7000000GoOkIAK','301J7000000GobKIAS','301J7000000GobPIAS'];
//   const res2 = await conn.tooling.del('Flow',a);
//   // console.log(res2);
//   console.log(res2[0].SuccessResult);
//   console.log(res2[0].ErrorResult);
  

//   // return new Promise((resolve, reject) => {
//   //   spinnerQ = ora({ text: `Tooling query...`, spinner: "moon" }).start();
//   //   // const job = conn.tooling.autoFetchQuery(soqlQuery);

//   //   conn.tooling.del('Flow','aaa');
//   //   // job.then
//   //   // job
//   //   //   .on("record", async (record) => {
//   //   //     records.push(record);
//   //   //   })
//   //   //   .on("error", async (err) => {
//   //   //     spinnerQ.fail(`Bulk query error.`);
//   //   //     uxLog(this, c.yellow("Bulk query error: " + err));
//   //   //     // In case of timeout, retry if max retry is not reached
//   //   //     if ((err + "").includes("ETIMEDOUT") && retries < maxRetry) {
//   //   //       uxLog(this, c.yellow("Bulk query retry attempt #" + retries + 1));
//   //   //       bulkQuery(soqlQuery, conn, retries + 1)
//   //   //         .then((resRetry) => {
//   //   //           resolve(resRetry);
//   //   //         })
//   //   //         .catch((resErr) => {
//   //   //           reject(resErr);
//   //   //         });
//   //   //     } else {
//   //   //       // If max retry attempts reached, give up
//   //   //       uxLog(this, c.red("Bulk query error: max retry attempts reached, or not timeout error."));
//   //   //       globalThis.sfdxHardisFatalError = true;
//   //   //       reject(err);
//   //   //     }
//   //   //   })
//   //   //   .on("end", () => {
//   //   //     spinnerQ.succeed(`Bulk query completed with ${records.length} results.`);
//   //   //     resolve({ records: records, totalSize: records.length });
//   //   //   });
//   // });
// }


// export async function bulkDeleteTooling(objectName: string, records: Array<any>, conn: Connection): Promise<any> {
//   return new Promise((resolve, reject) => {
//     // Log the records being deleted
//     uxLog(this, c.red('WE ARE DELETING THE RECORDS: ' + records));

//     try {
//       // Perform the delete operation
//       conn.tooling.del(objectName, records)
//         .then((res2: any) => {
//           // Ensure res2 is treated as an array
//           const resultsArray = Array.isArray(res2) ? res2 : [res2];

//           // Process the results
//           const errorDetails = [];
//           for (let index = 0; index < records.length; index++) {
//             const element = resultsArray[index];
//             const successInfo = element.success ? 'Success' : 'Failure';
//             const errorsInfo = element.errors && element.errors.length > 0 ? `Errors: ${element.errors.join(', ')}` : 'No Errors';

//             console.log(`Element ${index + 1}: ${successInfo}, ${errorsInfo}`);

//             if (!element.success) {
//               errorDetails.push({
//                 id: element.id,
//                 errors: element.errors
//               });
//             }
//           }

//           // Create custom return object
//           const resultObject = {
//             results: resultsArray,
//             totalSize: records.length,
//             successRecordsNb: resultsArray.filter((result: any) => result.success).length,
//             errorRecordsNb: resultsArray.filter((result: any) => !result.success).length,
//             errorDetails: errorDetails
//           };

//           // Resolve the promise with the custom object
//           resolve(resultObject);
//         })
//         .catch((error) => {
//           // Log and handle the error without rejecting the promise
//           console.error('Error deleting records:', error);

//           // Create a custom return object indicating the error
//           const resultObject = {
//             results: [],
//             totalSize: records.length,
//             successRecordsNb: 0,
//             errorRecordsNb: records.length,
//             errorDetails: records.map(record => ({ id: record, errors: [error.message] }))
//           };

//           // Resolve the promise with the custom object
//           resolve(resultObject);
//         });
//     } catch (error) {
//       // Handle synchronous errors
//       console.error('Synchronous error:', error);

//       // Create a custom return object indicating the error
//       const resultObject = {
//         results: [],
//         totalSize: records.length,
//         successRecordsNb: 0,
//         errorRecordsNb: records.length,
//         errorDetails: records.map(record => ({ id: record, errors: [error.message] }))
//       };

//       // Resolve the promise with the custom object
//       resolve(resultObject);
//     }
//   });
// }
// export async function bulkDeleteTooling(objectName: string, records: Array<any>, conn: Connection): Promise<any> {
//   return new Promise((resolve, reject) => {
//     // Log the records being deleted
//     uxLog(this, c.red('WE ARE DELETING THE RECORDS: ' + records));

//     try {
//       // Perform the delete operation
//       conn.tooling.del(objectName, records)
//         .then((res2: any) => {
//           // Ensure res2 is treated as an array
//           const resultsArray = Array.isArray(res2) ? res2 : [res2];

//           // Process the results
//           const errorDetails = [];
//           for (let index = 0; index < records.length; index++) {
//             const element = resultsArray[index];
//             const successInfo = element.success ? 'Success' : 'Failure';
//             const errorsInfo = element.errors && element.errors.length > 0 ? `Errors: ${element.errors.join(', ')}` : 'No Errors';

//             console.log(`Element ${index + 1}: ${successInfo}, ${errorsInfo}`);

//             if (!element.success) {
//               errorDetails.push({
//                 id: element.id,
//                 errors: element.errors
//               });
//             }
//           }

//           // Create custom return object
//           const resultObject = {
//             results: resultsArray,
//             totalSize: records.length,
//             successRecordsNb: resultsArray.filter((result: any) => result.success).length,
//             errorRecordsNb: resultsArray.filter((result: any) => !result.success).length,
//             errorDetails: errorDetails
//           };

//           // Log the result object with full details
//           console.log('Result Object:', JSON.stringify(resultObject, null, 2));

//           // Resolve the promise with the custom object
//           resolve(resultObject);
//         })
//         .catch((error) => {
//           // Log and handle the error without rejecting the promise
//           console.error('Error deleting records:', error);

//           // Create a custom return object indicating the error
//           const resultObject = {
//             results: [],
//             totalSize: records.length,
//             successRecordsNb: 0,
//             errorRecordsNb: records.length,
//             errorDetails: records.map(record => ({ id: record, errors: [error.message] }))
//           };

//           // Log the error details with full details
//           console.log('Result Object with Error:', JSON.stringify(resultObject, null, 2));

//           // Resolve the promise with the custom object
//           resolve(resultObject);
//         });
//     } catch (error) {
//       // Handle synchronous errors
//       console.error('Synchronous error:', error);

//       // Create a custom return object indicating the error
//       const resultObject = {
//         results: [],
//         totalSize: records.length,
//         successRecordsNb: 0,
//         errorRecordsNb: records.length,
//         errorDetails: records.map(record => ({ id: record, errors: [error.message] }))
//       };

//       // Log the error details with full details
//       console.log('Result Object with Synchronous Error:', JSON.stringify(resultObject, null, 2));

//       // Resolve the promise with the custom object
//       resolve(resultObject);
//     }
//   });
// }

// export async function bulkDeleteTooling(objectName: string, records: Array<any>, conn: Connection): Promise<any> {
//   return new Promise((resolve, reject) => {
//     // Log the records being deleted
//     uxLog(this, c.red('WE ARE DELETING THE RECORDS: ' + records));

//     try {
//       // Perform the delete operation
//       const options = {
//         allOrNone: true
//       };
//       conn.tooling.del(objectName, records, options)
//         .then((res2: any) => {
//           console.log('The Result Is Below!');
          
//           console.log(res2);
          
//           // Ensure res2 is treated as an array
//           const resultsArray = Array.isArray(res2) ? res2 : [res2];

//           // Process the results
//           const errorDetails = [];
//           for (let index = 0; index < records.length; index++) {
//             const element = resultsArray[index];
//             const successInfo = element.success ? 'Success' : 'Failure';
//             const errorsInfo = element.errors && element.errors.length > 0 ? `Errors: ${element.errors.join(', ')}` : 'No Errors';

//             console.log(`Element ${index + 1}: ${successInfo}, ${errorsInfo}`);

//             if (!element.success) {
//               errorDetails.push({
//                 id: element.id,
//                 errors: element.errors
//               });
//             }
//           }

//           // Create custom return object
//           const resultObject = {
//             results: resultsArray,
//             totalSize: records.length,
//             successRecordsNb: resultsArray.filter((result: any) => result.success).length,
//             errorRecordsNb: resultsArray.filter((result: any) => !result.success).length,
//             errorDetails: errorDetails
//           };

//           // Log the result object with full details
//           console.log('Result Object:', JSON.stringify(resultObject, null, 2));

//           // Resolve the promise with the custom object
//           resolve(resultObject);
//         })
//         .catch((error) => {
//           // Log and handle the error without rejecting the promise
//           console.error('Error deleting records:', error);

//           // Create a custom return object indicating the error
//           const resultObject = {
//             results: records.map(record => ({
//               id: record,
//               success: false,
//               errors: [error.message]
//             })),
//             totalSize: records.length,
//             successRecordsNb: 0,
//             errorRecordsNb: records.length,
//             errorDetails: records.map(record => ({ id: record, errors: [error.message] }))
//           };

//           // Log the error details with full details
//           console.log('Result Object with Error:', JSON.stringify(resultObject, null, 2));

//           // Resolve the promise with the custom object
//           resolve(resultObject);
//         });
//     } catch (error) {
//       // Handle synchronous errors
//       console.error('Synchronous error:', error);

//       // Create a custom return object indicating the error
//       const resultObject = {
//         results: records.map(record => ({
//           id: record,
//           success: false,
//           errors: [error.message]
//         })),
//         totalSize: records.length,
//         successRecordsNb: 0,
//         errorRecordsNb: records.length,
//         errorDetails: records.map(record => ({ id: record, errors: [error.message] }))
//       };

//       // Log the error details with full details
//       console.log('Result Object with Synchronous Error:', JSON.stringify(resultObject, null, 2));

//       // Resolve the promise with the custom object
//       resolve(resultObject);
//     }
//   });
// }


// export async function bulkDeleteTooling(objectName: string, records: Array<any>, conn: Connection): Promise<any> {
//   return new Promise((resolve, reject) => {
//     // Log the records being deleted
//     uxLog(this, c.red('WE ARE DELETING THE RECORDS: ' + records));

//     // Define the RestApiOptions with allOrNone set to false
//     const options = {
//       allOrNone: true
//     };

//     // Define the callback function
//     const callback = (err: Error, result: RecordResult | RecordResult[]) => {
//       if (err) {
//         // Log and handle the error without rejecting the promise
//         console.error('Error deleting records:', err);

//         // Create a custom return object indicating the error
//         const resultObject = {
//           results: records.map(record => ({
//             id: record,
//             success: false,
//             errors: [err.message]
//           })),
//           totalSize: records.length,
//           successRecordsNb: 0,
//           errorRecordsNb: records.length,
//           errorDetails: records.map(record => ({ id: record, errors: [err.message] }))
//         };

//         // Log the error details with full details
//         console.log('Result Object with Error:', JSON.stringify(resultObject, null, 2));

//         // Resolve the promise with the custom object
//         resolve(resultObject);
//       } else {
//         // Ensure result is treated as an array
//         const resultsArray = Array.isArray(result) ? result : [result];

//         // Process the results
//         const errorDetails = [];
//         for (let index = 0; index < records.length; index++) {
//           const element = resultsArray[index];
//           const successInfo = element.success ? 'Success' : 'Failure';
//           const errorsInfo = element.errors && element.errors.length > 0 ? `Errors: ${element.errors.join(', ')}` : 'No Errors';

//           console.log(`Element ${index + 1}: ${successInfo}, ${errorsInfo}`);

//           if (!element.success) {
//             errorDetails.push({
//               id: element.id,
//               errors: element.errors
//             });
//           }
//         }

//         // Create custom return object
//         const resultObject = {
//           results: resultsArray,
//           totalSize: records.length,
//           successRecordsNb: resultsArray.filter((result: any) => result.success).length,
//           errorRecordsNb: resultsArray.filter((result: any) => !result.success).length,
//           errorDetails: errorDetails
//         };

//         // Log the result object with full details
//         console.log('Result Object:', JSON.stringify(resultObject, null, 2));

//         // Resolve the promise with the custom object
//         resolve(resultObject);
//       }
//     };

//     try {
//       // Perform the delete operation with the specified options and callback
//       conn.tooling.del(objectName, records, options, callback);
//     } catch (error) {
//       // Handle synchronous errors
//       console.error('Synchronous error:', error);

//       // Create a custom return object indicating the error
//       const resultObject = {
//         results: records.map(record => ({
//           id: record,
//           success: false,
//           errors: [error.message]
//         })),
//         totalSize: records.length,
//         successRecordsNb: 0,
//         errorRecordsNb: records.length,
//         errorDetails: records.map(record => ({ id: record, errors: [error.message] }))
//       };

//       // Log the error details with full details
//       console.log('Result Object with Synchronous Error:', JSON.stringify(resultObject, null, 2));

//       // Resolve the promise with the custom object
//       resolve(resultObject);
//     }
//   });
// }

