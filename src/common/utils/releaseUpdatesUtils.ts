import { Connection } from '@salesforce/core';
import { soqlQueryTooling } from './apiUtils.js';

// Release updates to check: not applied yet, due in the future or overdue for less than 60 days, the earliest first
export async function queryReleaseUpdatesToCheck(conn: Connection): Promise<any[]> {
  const releaseUpdatesQuery =
    `SELECT StepStage,Status,Category,Title,DueDate,Description,Release,ReleaseLabel,ReleaseDate,ApiVersion,DurableId,HasNewSteps,IsReleased,SupportsRevoke,DeveloperName ` +
    `FROM ReleaseUpdate ` +
    `WHERE StepStage IN ('Upcoming','OverDue') AND Status IN ('Pending','Invocable','Revocable','Nascent','Invoked','Info') AND DueDate >= LAST_N_DAYS:60 ` +
    `ORDER BY DueDate ASC`;
  const queryRes = await soqlQueryTooling(releaseUpdatesQuery, conn);
  return (queryRes.records || []).map((record: any) => {
    delete record.attributes;
    return record;
  });
}

// Setup page listing the release updates of the org: each release update opens its own Salesforce article from there
export function getReleaseUpdatesSetupUrl(instanceUrl: string): string {
  return `${(instanceUrl || '').replace(/\/$/, '')}/lightning/setup/ReleaseUpdates/home`;
}
