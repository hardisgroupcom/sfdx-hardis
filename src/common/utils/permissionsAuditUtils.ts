import c from 'chalk';
import fs from './fsUtils.js';
import * as path from 'path';
import { glob } from 'glob';
import Papa from 'papaparse';
import sortArray from './sortArray.js';
import { Connection } from '@salesforce/core';

import { uxLog } from './index.js';
import { parseXmlFile } from './xmlUtils.js';
import { soqlQuery } from './apiUtils.js';
import { GLOB_IGNORE_PATTERNS } from './projectUtils.js';
import { createXlsxFromCsvFiles, generateReportPath } from './filesUtils.js';
import { getSeverityIcon } from './notifUtils.js';
import { NotifSeverity } from '../notifProvider/index.js';
import { getConfig, getEnvVarList } from '../../config/index.js';
import { t } from './i18n.js';

// A dangerous user permission is a `Permissions*` field on Profile / PermissionSet that grants
// broad administrative, identity or data-access power. `metadataName` is the same permission without
// the `Permissions` prefix, as written in `<userPermissions><name>...</name></userPermissions>` XML.
export interface DangerousUserPermission {
  apiName: string;
  metadataName: string;
  label: string;
  tier: number | 'Custom';
}

// A dangerous object permission (View All / Modify All for a given object). In org it is a field on
// the ObjectPermissions object; in metadata it is an element under `<objectPermissions>`.
export interface DangerousObjectPermission {
  metadataElement: 'viewAllRecords' | 'modifyAllRecords';
  soqlField: 'PermissionsViewAllRecords' | 'PermissionsModifyAllRecords';
  label: string;
  tier: number;
}

export type PermissionsAuditSource = 'org' | 'local' | 'both';

// A single "this container grants this dangerous permission" fact.
export interface PermissionGrant {
  containerId: string;
  containerName: string;
  containerType: 'Profile' | 'PermissionSet';
  permissionLabel: string;
  apiName: string;
  tier: number | 'Custom';
  object: string;
  origin: 'Org' | 'Local';
}

export interface PermissionsAuditData {
  profileGrants: PermissionGrant[];
  permSetGrants: PermissionGrant[];
  permSetGroupGrants: any[];
  assignments: any[];
  containersCount: number;
  usersCount: number;
}

const up = (metadataName: string, label: string, tier: number): DangerousUserPermission => ({
  apiName: 'Permissions' + metadataName,
  metadataName,
  label,
  tier,
});

// Built-in dangerous user permissions, grouped by criticality tier (0 = full org compromise).
export const DANGEROUS_USER_PERMISSIONS: DangerousUserPermission[] = [
  // Tier 0 - full org compromise
  up('ModifyAllData', 'Modify All Data', 0),
  up('AuthorApex', 'Author Apex', 0),
  up('CustomizeApplication', 'Customize Application', 0),
  up('ModifyMetadata', 'Modify Metadata Through Metadata API Functions', 0),
  up('ManageInteraction', 'Manage Flow', 0),
  up('ManageProfilesPermissionsets', 'Manage Profiles and Permission Sets', 0),
  // Tier 1 - identity takeover
  up('ManageUsers', 'Manage Users', 1),
  up('ManageInternalUsers', 'Manage Internal Users', 1),
  up('AssignPermissionSets', 'Assign Permission Sets', 1),
  up('ManageRoles', 'Manage Roles', 1),
  up('ManageSharing', 'Manage Sharing', 1),
  up('ResetPasswords', 'Reset User Passwords and Unlock Users', 1),
  up('ManagePasswordPolicies', 'Manage Password Policies', 1),
  up('ManageLoginAccessPolicies', 'Manage Login Access Policies', 1),
  up('ManageTwoFactor', 'Manage Two-Factor Authentication in User Interface', 1),
  up('ManageAuthProviders', 'Manage Auth. Providers', 1),
  up('ManageCertificates', 'Manage Certificates', 1),
  up('PasswordNeverExpires', 'Password Never Expires', 1),
  up('BypassMFAForUiLogins', 'Waive Multi-Factor Authentication', 1),
  // Tier 2 - sharing model bypass (user permissions; object permissions are handled separately)
  up('ViewAllData', 'View All Data', 2),
  up('ViewAllUsers', 'View All Users', 2),
  up('ViewAllFieldsGlobal', 'View All Fields', 2),
  up('EditReadonlyFields', 'Edit Read Only Fields', 2),
  up('QueryAllFiles', 'Query All Files', 2),
  up('ManageChatterMessages', 'Manage Chatter Messages and Direct Messages', 2),
  up('ManageUnlistedGroups', 'Manage Unlisted Groups', 2),
  up('ManageDynamicDashboards', 'Manage Dynamic Dashboards', 2),
  // Tier 3 - data theft
  up('DataExport', 'Weekly Data Export', 3),
  up('ExportReport', 'Export Reports', 3),
  up('ApiEnabled', 'API Enabled', 3),
  up('BulkApiHardDelete', 'Bulk API Hard Delete', 3),
  up('ManageReportsInPubFolders', 'Manage Reports in Public Folders', 3),
  up('ApexRestServices', 'Apex REST Services', 3),
  // Tier 4 - control weakening
  up('ManageEncryptionKeys', 'Manage Encryption Keys', 4),
  up('ViewEncryptedData', 'View Encrypted Data', 4),
  up('ManageHealthCheck', 'Manage Health Check', 4),
  up('ViewEventLogFiles', 'View Event Log Files', 4),
  up('InstallPackaging', 'Install Packages / Download AppExchange Packages', 4),
  up('ManageCustomPermissions', 'Manage Custom Permissions', 4),
  up('ViewSetup', 'View Setup and Configuration', 4),
  up('ViewRoles', 'View Roles and Role Hierarchy', 4),
];

export const DANGEROUS_OBJECT_PERMISSIONS: DangerousObjectPermission[] = [
  {
    metadataElement: 'viewAllRecords',
    soqlField: 'PermissionsViewAllRecords',
    label: 'View All (object)',
    tier: 2,
  },
  {
    metadataElement: 'modifyAllRecords',
    soqlField: 'PermissionsModifyAllRecords',
    label: 'Modify All (object)',
    tier: 2,
  },
];

export const TIER_DESCRIPTIONS: Record<string, string> = {
  '0': 'Full org compromise',
  '1': 'Identity takeover',
  '2': 'Sharing model bypass',
  '3': 'Data theft',
  '4': 'Control weakening',
  Custom: 'Custom (added via config)',
};

function tierLabel(tier: number | 'Custom'): string {
  return tier === 'Custom' ? 'Custom' : `Tier ${tier}`;
}

function tierSortKey(tier: number | 'Custom'): number {
  return tier === 'Custom' ? 99 : tier;
}

function tierSeverity(tier: number | 'Custom'): NotifSeverity {
  return tier !== 'Custom' && tier <= 1 ? 'error' : 'warning';
}

function normalizeName(name: string): string {
  return (name || '').trim().toLowerCase();
}

// Applies additive config/env overrides: `dangerousPermissionsExtra` adds custom permissions (matched
// by API name or metadata name), `dangerousPermissionsIgnore` removes built-in ones.
export async function getEffectiveDangerousUserPermissions(): Promise<DangerousUserPermission[]> {
  const config = await getConfig('project');
  const extraFromConfig = toStringList(config.dangerousPermissionsExtra);
  const extraFromEnv = getEnvVarList('DANGEROUS_PERMISSIONS_EXTRA') || [];
  const ignoreFromConfig = toStringList(config.dangerousPermissionsIgnore);
  const ignoreFromEnv = getEnvVarList('DANGEROUS_PERMISSIONS_IGNORE') || [];

  const ignoreSet = new Set([...ignoreFromConfig, ...ignoreFromEnv].map(normalizeName).filter(Boolean));
  const isIgnored = (perm: DangerousUserPermission) => ignoreSet.has(normalizeName(perm.apiName)) || ignoreSet.has(normalizeName(perm.metadataName));

  const result = DANGEROUS_USER_PERMISSIONS.filter((perm) => !isIgnored(perm));

  const knownApiNames = new Set(result.map((perm) => perm.apiName));
  for (const raw of [...extraFromConfig, ...extraFromEnv]) {
    const value = raw.trim();
    if (!value) {
      continue;
    }
    const apiName = value.startsWith('Permissions') ? value : 'Permissions' + value;
    if (knownApiNames.has(apiName)) {
      continue;
    }
    knownApiNames.add(apiName);
    result.push({
      apiName,
      metadataName: apiName.replace(/^Permissions/, ''),
      label: apiName,
      tier: 'Custom',
    });
  }

  return result;
}

function toStringList(value: any): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((v) => String(v));
  }
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function makeGrant(
  containerId: string,
  containerName: string,
  containerType: 'Profile' | 'PermissionSet',
  permissionLabel: string,
  apiName: string,
  tier: number | 'Custom',
  object: string,
  origin: 'Org' | 'Local'
): PermissionGrant {
  return {
    containerId,
    containerName,
    containerType,
    permissionLabel,
    apiName,
    tier,
    object,
    origin,
  };
}

/* jscpd:ignore-start */
// Collects dangerous permission grants and user assignments from a connected org via SOQL.
export async function collectFromOrg(
  conn: Connection,
  userPerms: DangerousUserPermission[],
  objectPerms: DangerousObjectPermission[],
  commandThis: any
): Promise<{
  grants: PermissionGrant[];
  permSetGroupGrants: any[];
  assignments: any[];
}> {
  // Describe PermissionSet to keep only the dangerous fields that actually exist in this org
  uxLog('action', commandThis, c.cyan(t('unsecurePermissionsDescribingPermissionSet')));
  const psDescribe = await conn.describeSObject('PermissionSet');
  const availableFields = new Set((psDescribe.fields || []).map((f: any) => f.name));
  const availablePerms = userPerms.filter((p) => availableFields.has(p.apiName));
  const missingPerms = userPerms.filter((p) => !availableFields.has(p.apiName));
  if (missingPerms.length > 0) {
    uxLog(
      'warning',
      commandThis,
      c.yellow(
        t('unsecurePermissionsFieldsNotFound', {
          count: missingPerms.length,
          fields: missingPerms.map((p) => p.apiName).join(', '),
        })
      )
    );
  }

  const grants: PermissionGrant[] = [];
  // containerId -> the dangerous grants it carries (used to resolve group members and assignments)
  const containerGrants = new Map<string, PermissionGrant[]>();
  const containerInfo = new Map<string, { name: string; type: 'Profile' | 'PermissionSet' }>();

  const addContainerGrant = (grant: PermissionGrant) => {
    grants.push(grant);
    const list = containerGrants.get(grant.containerId) || [];
    list.push(grant);
    containerGrants.set(grant.containerId, list);
    containerInfo.set(grant.containerId, {
      name: grant.containerName,
      type: grant.containerType,
    });
  };

  // User permissions on Profiles (IsOwnedByProfile) and Permission Sets
  uxLog('action', commandThis, c.cyan(t('unsecurePermissionsQueryingContainers')));
  const permFields = availablePerms.map((p) => p.apiName).join(', ');
  const psQuery = `SELECT Id, Label, Name, IsOwnedByProfile, Profile.Name${permFields ? ', ' + permFields : ''} FROM PermissionSet`;
  const psRes = availablePerms.length > 0 ? await soqlQuery(psQuery, conn) : { records: [] };
  for (const ps of psRes.records || []) {
    const isProfile = ps.IsOwnedByProfile === true;
    const containerName = isProfile ? ps.Profile?.Name || ps.Name : ps.Label || ps.Name;
    for (const perm of availablePerms) {
      if (ps[perm.apiName] === true) {
        addContainerGrant(makeGrant(ps.Id, containerName, isProfile ? 'Profile' : 'PermissionSet', perm.label, perm.apiName, perm.tier, '', 'Org'));
      }
    }
  }

  // Object permissions (View All / Modify All per object)
  uxLog('action', commandThis, c.cyan(t('unsecurePermissionsQueryingObjectPerms')));
  const opQuery = `SELECT ParentId, Parent.Label, Parent.Name, Parent.IsOwnedByProfile, Parent.Profile.Name, SobjectType, PermissionsViewAllRecords, PermissionsModifyAllRecords FROM ObjectPermissions WHERE PermissionsViewAllRecords = true OR PermissionsModifyAllRecords = true`;
  const opRes = await soqlQuery(opQuery, conn);
  for (const op of opRes.records || []) {
    const isProfile = op.Parent?.IsOwnedByProfile === true;
    const containerName = isProfile ? op.Parent?.Profile?.Name || op.Parent?.Name : op.Parent?.Label || op.Parent?.Name;
    for (const objPerm of objectPerms) {
      if (op[objPerm.soqlField] === true) {
        addContainerGrant(
          makeGrant(
            op.ParentId,
            containerName,
            isProfile ? 'Profile' : 'PermissionSet',
            objPerm.label,
            objPerm.soqlField,
            objPerm.tier,
            op.SobjectType,
            'Org'
          )
        );
      }
    }
  }
  /* jscpd:ignore-end */

  // Permission Set Groups: a group is dangerous if one of its member permission sets is dangerous
  uxLog('action', commandThis, c.cyan(t('unsecurePermissionsQueryingGroups')));
  const psgRes = await soqlQuery(`SELECT Id, MasterLabel, DeveloperName FROM PermissionSetGroup`, conn);
  const psgById = new Map<string, string>((psgRes.records || []).map((g: any) => [g.Id, g.MasterLabel || g.DeveloperName || g.Id]));
  const psgcRes = await soqlQuery(`SELECT PermissionSetGroupId, PermissionSetId FROM PermissionSetGroupComponent`, conn);
  const membersByGroup = new Map<string, string[]>();
  for (const comp of psgcRes.records || []) {
    const members = membersByGroup.get(comp.PermissionSetGroupId) || [];
    members.push(comp.PermissionSetId);
    membersByGroup.set(comp.PermissionSetGroupId, members);
  }
  const permSetGroupGrants: any[] = [];
  for (const [groupId, groupName] of psgById) {
    for (const memberPsId of membersByGroup.get(groupId) || []) {
      const memberInfo = containerInfo.get(memberPsId);
      for (const grant of containerGrants.get(memberPsId) || []) {
        permSetGroupGrants.push({
          Container: groupName,
          Permission: grant.permissionLabel,
          'API Name': grant.apiName,
          Tier: tierLabel(grant.tier),
          Object: grant.object,
          'Source Permission Set': memberInfo?.name || memberPsId,
          Origin: grant.origin,
          Severity: tierSeverity(grant.tier),
          SeverityIcon: getSeverityIcon(tierSeverity(grant.tier)),
          _tierSort: tierSortKey(grant.tier),
        });
      }
    }
  }

  // Assignments: which active users hold dangerous permissions, and through which container
  uxLog('action', commandThis, c.cyan(t('unsecurePermissionsQueryingAssignments')));
  const psaQuery = `SELECT AssigneeId, Assignee.Name, Assignee.Username, Assignee.Profile.Name, Assignee.LastLoginDate, PermissionSetId, PermissionSet.IsOwnedByProfile, PermissionSetGroupId, PermissionSetGroup.MasterLabel FROM PermissionSetAssignment WHERE Assignee.IsActive = true`;
  const psaRes = await soqlQuery(psaQuery, conn);
  const userMap = new Map<
    string,
    {
      name: string;
      username: string;
      profile: string;
      lastLogin: string;
      perms: Map<string, number | 'Custom'>;
      sources: Set<string>;
      maxTier: number;
    }
  >();
  for (const psa of psaRes.records || []) {
    // Determine which dangerous grants this assignment brings, and the source container label
    let relevantGrants: PermissionGrant[] = [];
    let sourceLabel = '';
    if (psa.PermissionSetGroupId) {
      sourceLabel = psa.PermissionSetGroup?.MasterLabel || psgById.get(psa.PermissionSetGroupId) || '';
      for (const memberPsId of membersByGroup.get(psa.PermissionSetGroupId) || []) {
        relevantGrants = relevantGrants.concat(containerGrants.get(memberPsId) || []);
      }
    } else if (containerGrants.has(psa.PermissionSetId)) {
      relevantGrants = containerGrants.get(psa.PermissionSetId) || [];
      sourceLabel = containerInfo.get(psa.PermissionSetId)?.name || '';
    }
    if (relevantGrants.length === 0) {
      continue;
    }
    const userId = psa.AssigneeId;
    if (!userMap.has(userId)) {
      userMap.set(userId, {
        name: psa.Assignee?.Name || userId,
        username: psa.Assignee?.Username || '',
        profile: psa.Assignee?.Profile?.Name || '',
        lastLogin: psa.Assignee?.LastLoginDate ? new Date(psa.Assignee.LastLoginDate).toISOString().split('T')[0] : 'Never',
        perms: new Map(),
        sources: new Set(),
        maxTier: -1,
      });
    }
    const entry = userMap.get(userId)!;
    if (sourceLabel) {
      entry.sources.add(sourceLabel);
    }
    for (const grant of relevantGrants) {
      entry.perms.set(grant.permissionLabel, grant.tier);
      const sort = tierSortKey(grant.tier);
      if (sort !== 99 && sort > entry.maxTier) {
        entry.maxTier = sort;
      }
    }
  }

  const assignments = Array.from(userMap.values()).map((entry) => ({
    User: entry.name,
    Username: entry.username,
    Profile: entry.profile,
    'Last Login': entry.lastLogin,
    'Max Tier': entry.maxTier >= 0 ? `Tier ${entry.maxTier}` : 'Custom',
    'Dangerous Permissions Count': entry.perms.size,
    'Dangerous Permissions': Array.from(entry.perms.keys()).sort().join('\n'),
    Sources: Array.from(entry.sources).sort().join('\n'),
  }));

  return { grants, permSetGroupGrants, assignments };
}

// Collects dangerous permission grants from local metadata files (Profiles, Permission Sets and
// Permission Set Groups). Assignments cannot be resolved offline.
export async function collectFromLocal(
  userPerms: DangerousUserPermission[],
  objectPerms: DangerousObjectPermission[],
  commandThis: any
): Promise<{ grants: PermissionGrant[]; permSetGroupGrants: any[] }> {
  uxLog('action', commandThis, c.cyan(t('unsecurePermissionsScanningLocal')));
  const cwd = process.cwd();
  const userPermByMetadataName = new Map(userPerms.map((p) => [p.metadataName, p]));
  const grants: PermissionGrant[] = [];
  // Local permission set name -> its grants, to resolve group membership
  const grantsByLocalPsName = new Map<string, PermissionGrant[]>();

  const parseContainer = async (
    file: string,
    rootKey: 'Profile' | 'PermissionSet',
    containerType: 'Profile' | 'PermissionSet',
    suffix: string
  ): Promise<PermissionGrant[]> => {
    const containerName = path.basename(file).replace(suffix, '');
    const parsed = await parseXmlFile(file);
    const root = parsed?.[rootKey];
    const fileGrants: PermissionGrant[] = [];
    if (!root) {
      return fileGrants;
    }
    for (const userPermission of root.userPermissions || []) {
      const enabled = userPermission?.enabled?.[0];
      const name = userPermission?.name?.[0];
      if ((enabled === 'true' || enabled === true) && name && userPermByMetadataName.has(name)) {
        const perm = userPermByMetadataName.get(name)!;
        fileGrants.push(makeGrant(containerName, containerName, containerType, perm.label, perm.apiName, perm.tier, '', 'Local'));
      }
    }
    for (const objectPermission of root.objectPermissions || []) {
      const object = objectPermission?.object?.[0];
      for (const objPerm of objectPerms) {
        const value = objectPermission?.[objPerm.metadataElement]?.[0];
        if ((value === 'true' || value === true) && object) {
          fileGrants.push(makeGrant(containerName, containerName, containerType, objPerm.label, objPerm.soqlField, objPerm.tier, object, 'Local'));
        }
      }
    }
    return fileGrants;
  };

  const profileFiles = await glob('**/*.profile-meta.xml', {
    cwd,
    ignore: GLOB_IGNORE_PATTERNS,
    absolute: true,
  });
  for (const file of profileFiles) {
    grants.push(...(await parseContainer(file, 'Profile', 'Profile', '.profile-meta.xml')));
  }
  const permSetFiles = await glob('**/*.permissionset-meta.xml', {
    cwd,
    ignore: GLOB_IGNORE_PATTERNS,
    absolute: true,
  });
  for (const file of permSetFiles) {
    const psGrants = await parseContainer(file, 'PermissionSet', 'PermissionSet', '.permissionset-meta.xml');
    grants.push(...psGrants);
    grantsByLocalPsName.set(path.basename(file).replace('.permissionset-meta.xml', ''), psGrants);
  }

  // Permission Set Groups reference their member permission sets by name
  const permSetGroupGrants: any[] = [];
  const psgFiles = await glob('**/*.permissionsetgroup-meta.xml', {
    cwd,
    ignore: GLOB_IGNORE_PATTERNS,
    absolute: true,
  });
  for (const file of psgFiles) {
    const groupName = path.basename(file).replace('.permissionsetgroup-meta.xml', '');
    const parsed = await parseXmlFile(file);
    const root = parsed?.PermissionSetGroup;
    if (!root) {
      continue;
    }
    for (const memberName of root.permissionSets || []) {
      const name = typeof memberName === 'string' ? memberName : memberName?._ || memberName;
      for (const grant of grantsByLocalPsName.get(name) || []) {
        permSetGroupGrants.push({
          Container: groupName,
          Permission: grant.permissionLabel,
          'API Name': grant.apiName,
          Tier: tierLabel(grant.tier),
          Object: grant.object,
          'Source Permission Set': name,
          Origin: grant.origin,
          Severity: tierSeverity(grant.tier),
          SeverityIcon: getSeverityIcon(tierSeverity(grant.tier)),
          _tierSort: tierSortKey(grant.tier),
        });
      }
    }
  }

  return { grants, permSetGroupGrants };
}

// Turns raw grants into report rows for the Profiles / Permission Sets sheets. `includeOrigin` adds
// the Origin column, used only in `both` mode.
function toGrantRows(grants: PermissionGrant[], includeOrigin: boolean): any[] {
  const seen = new Set<string>();
  const rows: any[] = [];
  for (const grant of grants) {
    const key = `${grant.containerName}|${grant.apiName}|${grant.object}|${grant.origin}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const row: any = {
      Container: grant.containerName,
      Permission: grant.permissionLabel,
      'API Name': grant.apiName,
      Tier: tierLabel(grant.tier),
      Object: grant.object,
    };
    if (includeOrigin) {
      row.Origin = grant.origin;
    }
    row.Severity = tierSeverity(grant.tier);
    row.SeverityIcon = getSeverityIcon(tierSeverity(grant.tier));
    row._tierSort = tierSortKey(grant.tier);
    rows.push(row);
  }
  return rows;
}

function stripSortKey(rows: any[]): any[] {
  return rows.map((row) => {
    const clone = { ...row };
    delete clone._tierSort;
    return clone;
  });
}

async function writeSheetCsv(rows: any[], outputPath: string): Promise<void> {
  await fs.writeFile(outputPath, Papa.unparse(rows), 'utf8');
}

// Adds in-workbook navigation: turns each Index "Sheet" cell into a hyperlink to the matching sheet,
// and drops a "Back to Index" link below every other sheet. Runs after the workbook is built so the
// final (truncated / de-duplicated) sheet names are known.
const HYPERLINK_FONT = { color: { argb: 'FF0563C1' }, underline: true };

function addPermissionsAuditNavigation(
  workbook: any,
  worksheetNameByCsvFile: Record<string, string>,
  nav: { indexPath: string; sheetCsvByLabel: Record<string, string> }
): void {
  const indexName = worksheetNameByCsvFile[nav.indexPath];
  const indexWs = indexName ? workbook.getWorksheet(indexName) : null;

  const linkCell = (cell: any, sheetName: string) => {
    if (!cell || !sheetName) {
      return;
    }
    const text = (cell.text ?? cell.value ?? '').toString();
    cell.value = { text, hyperlink: `#'${sheetName}'!A1` };
    cell.font = { ...(cell.font || {}), ...HYPERLINK_FONT };
  };

  if (indexWs) {
    const headerRow = indexWs.getRow(1);
    let sheetCol = 0;
    headerRow.eachCell((cell: any, colNumber: number) => {
      if ((cell.text ?? cell.value ?? '').toString().trim() === 'Sheet') {
        sheetCol = colNumber;
      }
    });
    if (sheetCol > 0) {
      for (let rowNumber = 2; rowNumber <= indexWs.rowCount; rowNumber++) {
        const cell = indexWs.getRow(rowNumber).getCell(sheetCol);
        const label = (cell.text ?? cell.value ?? '').toString().trim();
        const targetCsv = nav.sheetCsvByLabel[label];
        const targetName = targetCsv ? worksheetNameByCsvFile[targetCsv] : null;
        if (targetName) {
          linkCell(cell, targetName);
        }
      }
    }
  }

  if (indexName) {
    workbook.eachSheet((sheet: any) => {
      if (sheet.name === indexName) {
        return;
      }
      const backCell = sheet.getCell(`A${sheet.rowCount + 2}`);
      backCell.value = {
        text: 'Back to Index',
        hyperlink: `#'${indexName}'!A1`,
      };
      backCell.font = { ...HYPERLINK_FONT };
    });
  }
}

// Builds the multi-sheet Excel report (Index + Tiers Legend + Profiles + Permission Sets +
// Permission Set Groups + Assignments) plus the backing CSV files. Empty sheets are omitted.
export async function buildPermissionsAuditReport(
  commandThis: any,
  data: PermissionsAuditData,
  outputFile: string | null,
  sourceMode: PermissionsAuditSource
): Promise<{ xlsxFile: string; csvFiles: string[] }> {
  const includeOrigin = sourceMode === 'both';
  const csvFiles: string[] = [];
  const worksheetNames: Record<string, string> = {};
  const sheetCsvByLabel: Record<string, string> = {};

  const sortRows = (rows: any[]) =>
    sortArray(rows, {
      by: ['_tierSort', 'Container'],
      order: ['asc', 'asc'],
    }) as any[];

  // Permission Set Group rows always carry an Origin field; drop it unless we are in "both" mode
  const psgRows = includeOrigin
    ? data.permSetGroupGrants
    : data.permSetGroupGrants.map((row) => {
        const clone = { ...row };
        delete clone.Origin;
        return clone;
      });

  const profileRows = sortRows(toGrantRows(data.profileGrants, includeOrigin));
  const permSetRows = sortRows(toGrantRows(data.permSetGrants, includeOrigin));
  const permSetGroupRows = sortRows(psgRows);
  const assignmentRows = sortArray(data.assignments, {
    by: ['Dangerous Permissions Count'],
    order: ['desc'],
  }) as any[];

  // Index navigation table (Sheet cells become hyperlinks)
  const indexRows: any[] = [];
  const addSheet = async (label: string, description: string, prefix: string, rows: any[]) => {
    if (rows.length === 0) {
      return;
    }
    const sheetPath = await generateReportPath(prefix, '', { withDate: true });
    await writeSheetCsv(stripSortKey(rows), sheetPath);
    worksheetNames[sheetPath] = label;
    sheetCsvByLabel[label] = sheetPath;
    csvFiles.push(sheetPath);
    indexRows.push({
      Sheet: label,
      Description: description,
      Rows: String(rows.length),
    });
  };

  // Index sheet must be first in the workbook
  const indexPath = await generateReportPath('unsecure-permissions-index', '', {
    withDate: true,
  });
  worksheetNames[indexPath] = 'Index';
  csvFiles.push(indexPath);

  // Tiers legend sheet
  const legendRows = Object.entries(TIER_DESCRIPTIONS).map(([tier, description]) => ({
    Tier: tier === 'Custom' ? 'Custom' : `Tier ${tier}`,
    Description: description,
  }));
  const legendPath = await generateReportPath('unsecure-permissions-tiers', '', { withDate: true });
  await writeSheetCsv(legendRows, legendPath);
  worksheetNames[legendPath] = 'Tiers Legend';
  sheetCsvByLabel['Tiers Legend'] = legendPath;
  csvFiles.push(legendPath);
  indexRows.push({
    Sheet: 'Tiers Legend',
    Description: 'Criticality tiers (0 = most critical)',
    Rows: String(legendRows.length),
  });

  await addSheet('Profiles', 'Profiles granting dangerous permissions', 'unsecure-permissions-profiles', profileRows);
  await addSheet('Permission Sets', 'Permission Sets granting dangerous permissions', 'unsecure-permissions-permsets', permSetRows);
  await addSheet(
    'Permission Set Groups',
    'Permission Set Groups granting dangerous permissions',
    'unsecure-permissions-permsetgroups',
    permSetGroupRows
  );
  await addSheet('Assignments', 'Active users holding dangerous permissions', 'unsecure-permissions-assignments', assignmentRows);

  // Write the Index CSV now that its rows are complete, then reorder csvFiles so Index is first
  await writeSheetCsv(indexRows, indexPath);
  const orderedCsvFiles = [indexPath, ...csvFiles.filter((f) => f !== indexPath)];

  const consolidatedBase = outputFile || (await generateReportPath('unsecure-permissions', '', { withDate: true }));
  await createXlsxFromCsvFiles(orderedCsvFiles, consolidatedBase, {
    fileTitle: t('unsecurePermissionsFileTitle'),
    worksheetNames,
    postProcessWorkbook: (workbook, context) =>
      addPermissionsAuditNavigation(workbook, context.worksheetNameByCsvFile, {
        indexPath,
        sheetCsvByLabel,
      }),
  });
  const xlsxFile = path.join(path.dirname(consolidatedBase), 'xls', path.basename(consolidatedBase).replace('.csv', '.xlsx'));

  return { xlsxFile, csvFiles: orderedCsvFiles };
}

export { tierLabel, tierSortKey, tierSeverity };
