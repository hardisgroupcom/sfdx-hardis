import { PoolDevHubLimits } from './poolDashboardUtils.js';

// Adds a line to the description of the ActiveScratchOrg record of a pooled scratch org
export async function updateActiveScratchOrgRecord(devHubConn: any, scratchOrg: any, keyValues: any): Promise<void> {
  const orgId = getScratchOrgId(scratchOrg);
  if (!devHubConn || !orgId) {
    return;
  }
  const activeScratchOrg: any = await devHubConn.sobject('ActiveScratchOrg').findOne({ ScratchOrg: orgId.slice(0, 15) }, { Id: true, Description: true });
  if (!activeScratchOrg) {
    return;
  }
  const update = { ...keyValues, Id: activeScratchOrg.Id };
  if (update.Description) {
    update.Description = (activeScratchOrg.Description ? activeScratchOrg.Description + '\n' : '') + update.Description;
  }
  await devHubConn.sobject('ActiveScratchOrg').update(update);
}

// Deletes a scratch org from its Dev Hub, without its credentials: deleting the ActiveScratchOrg
// record is what `sf org delete scratch` does. False when the org was not found.
export async function deleteScratchOrgFromDevHub(devHubConn: any, orgId: string | undefined): Promise<boolean> {
  if (!devHubConn || !orgId) {
    return false;
  }
  const activeScratchOrg: any = await devHubConn.sobject('ActiveScratchOrg').findOne({ ScratchOrg: orgId.slice(0, 15) }, { Id: true });
  if (!activeScratchOrg) {
    return false;
  }
  await devHubConn.sobject('ActiveScratchOrg').destroy(activeScratchOrg.Id);
  return true;
}

// Scratch org limits of a Dev Hub. Null when they cannot be read.
export async function getDevHubScratchLimits(devHubConn: any): Promise<PoolDevHubLimits | null> {
  if (!devHubConn) {
    return null;
  }
  try {
    const limits: any = await devHubConn.limits();
    const toLimit = (limit: any) => ({ used: Number(limit?.Max || 0) - Number(limit?.Remaining || 0), max: Number(limit?.Max || 0) });
    if (!limits?.ActiveScratchOrgs || !limits?.DailyScratchOrgs) {
      return null;
    }
    return { activeScratchOrgs: toLimit(limits.ActiveScratchOrgs), dailyScratchOrgs: toLimit(limits.DailyScratchOrgs) };
  } catch {
    return null;
  }
}

export function getScratchOrgId(scratchOrg: any): string {
  return scratchOrg?.scratchOrgInfo?.orgId || scratchOrg?.authFileJson?.result?.orgId || scratchOrg?.Id || '';
}
