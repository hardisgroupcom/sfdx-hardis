import { ActionsProvider, ActionResult, PrePostCommand } from './actionsProvider.js';
import { uxLog } from '../utils/index.js';
import { countPackageXmlItems, isPackageXmlEmpty, removePackageXmlFilesContent } from '../utils/xmlUtils.js';
import { t } from '../utils/i18n.js';
import c from 'chalk';
import fs from 'fs-extra';
import path from 'path';

// Accept a single "TypeName:Member1,Member2" string as well as the documented list format
export function normalizePackageXmlItems(items: any): string[] {
  if (typeof items === 'string') {
    return items.trim() ? [items] : [];
  }
  return Array.isArray(items) ? items : [];
}

// Parse packageXmlItems entries ("TypeName:Member1,Member2") into the inline remove-types
// structure expected by removePackageXmlFilesContent
export function parsePackageXmlItems(items: string[]): any[] {
  const typesMap: Record<string, string[]> = {};
  for (const item of items || []) {
    if (typeof item !== 'string') {
      continue;
    }
    const colonIdx = item.indexOf(':');
    if (colonIdx === -1) {
      continue;
    }
    const typeName = item.substring(0, colonIdx).trim();
    const members = item
      .substring(colonIdx + 1)
      .split(',')
      .map((member) => member.trim())
      .filter(Boolean);
    if (!typeName || members.length === 0) {
      continue;
    }
    const allMembers = Array.from(new Set([...(typesMap[typeName] || []), ...members]));
    // A wildcard covers the whole type: keep it alone so removePackageXmlFilesContent handles it as such
    typesMap[typeName] = allMembers.includes('*') ? ['*'] : allMembers;
  }
  return Object.entries(typesMap).map(([typeName, members]) => ({
    name: [typeName],
    members,
  }));
}

// Returns entries that do not match the expected "TypeName:Member1,Member2" format
export function findInvalidPackageXmlItems(items: string[]): string[] {
  return (items || []).filter(
    (item) => typeof item !== 'string' || !/^[^:\s][^:]*:.+$/.test(item.trim())
  );
}

export class RemovePackageXmlItemsAction extends ActionsProvider {
  public getLabel(): string {
    return 'RemovePackageXmlItemsAction';
  }

  // Filtering package.xml only affects the current deployment, so it must run every time
  public supportsRunOnlyOnceByOrg(): boolean {
    return false;
  }

  public async checkParameters(cmd: PrePostCommand): Promise<ActionResult | null> {
    const items = normalizePackageXmlItems(cmd.parameters?.packageXmlItems);
    if (items.length === 0) {
      uxLog('error', this, c.red(`[DeploymentActions] ${t('removePackageXmlItemsNoItems', { id: cmd.id, label: cmd.label })}`));
      return { statusCode: 'failed', skippedReason: 'No packageXmlItems parameter provided' };
    }
    const invalidItems = findInvalidPackageXmlItems(items);
    if (invalidItems.length > 0) {
      uxLog('error', this, c.red(`[DeploymentActions] ${t('removePackageXmlItemsInvalidFormat', { items: invalidItems.join(' | ') })}`));
      return { statusCode: 'failed', skippedReason: `Invalid packageXmlItems entries: ${invalidItems.join(' | ')}` };
    }
    return null;
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;

    const items = normalizePackageXmlItems(cmd.parameters?.packageXmlItems);
    const packageXmlFiles: string[] = globalThis.pendingDeploymentPackageXmlFiles || [];
    if (packageXmlFiles.length === 0) {
      const reason = t('removePackageXmlItemsNoDeploymentContext');
      uxLog('warning', this, c.yellow(`[DeploymentActions] ${reason}`));
      return { statusCode: 'skipped', skippedReason: reason };
    }

    const inlineRemoveTypes = parsePackageXmlItems(items);
    const outputLines: string[] = [`Items to remove from package.xml before deployment:`, ...items.map((item) => `- ${item}`), ''];
    let totalRemoved = 0;
    for (const packageXmlFile of packageXmlFiles) {
      if (!fs.existsSync(packageXmlFile) || (await isPackageXmlEmpty(packageXmlFile))) {
        continue;
      }
      const itemsCountBefore = await countPackageXmlItems(packageXmlFile);
      await removePackageXmlFilesContent(packageXmlFile, '', {
        outputXmlFile: packageXmlFile,
        removedOnly: false,
        keepEmptyTypes: false,
        inlineRemoveTypes,
      });
      const itemsCountAfter = await countPackageXmlItems(packageXmlFile);
      const removed = itemsCountBefore - itemsCountAfter;
      totalRemoved += removed;
      const fileLabel = path.basename(packageXmlFile);
      uxLog('log', this, c.grey(`[DeploymentActions] ${t('removePackageXmlItemsRemovedFromFile', { removed: removed, file: fileLabel, remaining: itemsCountAfter })}`));
      outputLines.push(`${fileLabel}: ${removed} item(s) removed, ${itemsCountAfter} item(s) remain`);
    }
    uxLog('success', this, c.green(`[DeploymentActions] ${t('removePackageXmlItemsSummary', { total: totalRemoved })}`));
    return { statusCode: 'success', output: outputLines.join('\n') };
  }
}
