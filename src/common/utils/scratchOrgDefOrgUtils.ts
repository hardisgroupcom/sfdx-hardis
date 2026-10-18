import { ConfigAggregator, Connection, Org, OrgConfigProperties, SfError } from '@salesforce/core';
import c from 'chalk';
import { execSfdxJson, uxLog } from './index.js';
import { t } from './i18n.js';

export interface PicklistOption {
  value: string;
  label: string;
}

export interface ScratchOrgDefRelease {
  version: string;
  label: string;
}

export interface ScratchOrgDefOrgValues {
  orgUsername: string;
  languages: PicklistOption[];
  countries: PicklistOption[];
  releases: {
    current: ScratchOrgDefRelease | null;
    previous: ScratchOrgDefRelease | null;
    preview: ScratchOrgDefRelease | null;
  };
}

export interface ImportedOrgShape {
  shapeId: string;
  features: string[];
  settings: Record<string, any> | null;
}

const SEASONS = ['Spring', 'Summer', 'Winter'];
const SHAPE_POLL_INTERVAL_MS = 10000;
const SHAPE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * The org whose values fill the scratch org definition form: the given one, else the default
 * Dev Hub (it creates the scratch orgs, so its release and locales are the ones that apply),
 * else the default org.
 */
export async function resolveScratchOrgDefSourceOrg(sourceOrg?: string): Promise<Org> {
  let aliasOrUsername = sourceOrg;
  if (!aliasOrUsername) {
    const aggregator = await ConfigAggregator.create();
    await aggregator.reload();
    aliasOrUsername =
      (aggregator.getPropertyValue(OrgConfigProperties.TARGET_DEV_HUB) as string) ||
      (aggregator.getPropertyValue(OrgConfigProperties.TARGET_ORG) as string) ||
      undefined;
  }
  if (!aliasOrUsername) {
    throw new SfError(t('scratchOrgDefNoSourceOrg'));
  }
  return await Org.create({ aliasOrUsername });
}

/** Languages, countries and releases a scratch org created from this org can use. */
export async function getScratchOrgDefOrgValues(org: Org): Promise<ScratchOrgDefOrgValues> {
  const conn = org.getConnection();
  const [userDescribe, versions] = await Promise.all([conn.describe('User'), listApiVersions(conn)]);
  return {
    orgUsername: org.getUsername() || '',
    languages: picklistOptions(userDescribe, 'LanguageLocaleKey'),
    // CountryCode only exists when State and Country/Territory Picklists are on
    countries: picklistOptions(userDescribe, 'CountryCode'),
    releases: buildReleases(versions),
  };
}

/**
 * Reads settings with the Metadata API, in the shape of the settings of a scratch org definition:
 * accountSettings is the metadata AccountSettings named Account.
 */
export async function importSettingsFromOrg(org: Org, settingsNames: string[]): Promise<{ settings: Record<string, any>; errors: string[] }> {
  const conn = org.getConnection();
  const settings: Record<string, any> = {};
  const errors: string[] = [];
  for (const settingsName of settingsNames) {
    const metadataType = toSettingsMetadataType(settingsName);
    if (!metadataType) {
      errors.push(t('scratchOrgDefInvalidSettingsName', { name: settingsName }));
      continue;
    }
    try {
      const record: any = await conn.metadata.read(metadataType as any, metadataType.replace(/Settings$/, ''));
      if (!record || Object.keys(record).filter((key) => key !== 'fullName').length === 0) {
        errors.push(t('scratchOrgDefSettingsNotFound', { name: settingsName }));
        continue;
      }
      settings[settingsName] = cleanMetadataValue(record, true);
    } catch (e) {
      errors.push(`${settingsName}: ${(e as Error).message}`);
    }
  }
  return { settings, errors };
}

/**
 * Creates an org shape of the source org and returns its features (and settings when Salesforce
 * gives them). Needs Org Shape enabled in the source org and in the Dev Hub.
 */
export async function importFeaturesFromOrgShape(org: Org): Promise<ImportedOrgShape> {
  const conn = org.getConnection();
  const username = org.getUsername() || '';
  await assertOrgShapeAvailable(conn);
  uxLog('action', this, c.cyan(t('scratchOrgDefCreatingOrgShape', { org: c.green(username) })));
  const createRes = await execSfdxJson(`sf org create shape --target-org ${username}`, this, { fail: false, output: false });
  if (createRes?.status !== 0) {
    throw new SfError(t('scratchOrgDefOrgShapeFailed', { message: createRes?.message || JSON.stringify(createRes) }));
  }
  const shapeId = createRes?.result?.shapeId || '';
  const shape = await waitForOrgShape(conn, shapeId);
  return {
    shapeId: shape.Id,
    features: parseShapeFeatures(shape.Features),
    settings: parseShapeSettings(shape.Settings),
  };
}

/** Label of the release after the one given: Winter '26 is followed by Spring '26, Summer '26, Winter '27. */
export function nextReleaseLabel(label: string): string | null {
  const match = /^(Spring|Summer|Winter)\s*'?(\d{2})$/i.exec(label.trim());
  if (!match) {
    return null;
  }
  const seasonIndex = SEASONS.findIndex((season) => season.toLowerCase() === match[1].toLowerCase());
  const year = parseInt(match[2], 10);
  const nextSeason = SEASONS[(seasonIndex + 1) % SEASONS.length];
  const nextYear = nextSeason === 'Winter' ? year + 1 : year;
  return `${nextSeason} '${String(nextYear % 100).padStart(2, '0')}`;
}

/** accountSettings becomes AccountSettings, a name that does not end with Settings is refused. */
export function toSettingsMetadataType(settingsName: string): string | null {
  const name = String(settingsName || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9]*Settings$/.test(name)) {
    return null;
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Metadata API read gives strings: back to the booleans and numbers a definition uses. */
export function cleanMetadataValue(value: any, isRoot = false): any {
  if (Array.isArray(value)) {
    return value.map((item) => cleanMetadataValue(item));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, any> = {};
    for (const [key, child] of Object.entries(value)) {
      if ((isRoot && key === 'fullName') || key === '$') {
        continue;
      }
      result[key] = cleanMetadataValue(child);
    }
    return result;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) && value.length < 16) {
    return Number(value);
  }
  return value;
}

/** Features of a ShapeRepresentation, separated by semicolons, commas or new lines. */
export function parseShapeFeatures(features: string | null | undefined): string[] {
  if (!features) {
    return [];
  }
  const trimmed = String(features).trim();
  if (trimmed.startsWith('[')) {
    try {
      return (JSON.parse(trimmed) as any[]).map((feature) => String(feature).trim()).filter(Boolean);
    } catch {
      // Not JSON: split below
    }
  }
  return [...new Set(trimmed.split(/[;,\r\n]+/).map((feature) => feature.trim()).filter(Boolean))];
}

async function listApiVersions(conn: Connection): Promise<ScratchOrgDefRelease[]> {
  try {
    const versions: any = await conn.request({ method: 'GET', url: `${conn.instanceUrl}/services/data/` });
    // A version can be listed twice ("Latest Release" and "Winter '27"): keep the release name
    const byVersion = new Map<string, ScratchOrgDefRelease>();
    for (const version of Array.isArray(versions) ? versions : []) {
      const entry = { version: String(version.version), label: String(version.label || '') };
      const known = byVersion.get(entry.version);
      if (!known || (!isReleaseName(known.label) && isReleaseName(entry.label))) {
        byVersion.set(entry.version, entry);
      }
    }
    return [...byVersion.values()].sort((a, b) => parseFloat(a.version) - parseFloat(b.version));
  } catch (e) {
    uxLog('other', this, c.grey(`Unable to list the API versions: ${(e as Error).message}`));
    return [];
  }
}

function isReleaseName(label: string): boolean {
  return /^(Spring|Summer|Winter)\s*'?\d{2}$/i.test(label.trim());
}

function buildReleases(versions: ScratchOrgDefRelease[]): ScratchOrgDefOrgValues['releases'] {
  if (versions.length === 0) {
    return { current: null, previous: null, preview: null };
  }
  const current = versions[versions.length - 1];
  const previous = versions.length > 1 ? versions[versions.length - 2] : null;
  const previewLabel = nextReleaseLabel(current.label);
  const preview = { version: (parseFloat(current.version) + 1).toFixed(1), label: previewLabel || '' };
  return { current, previous, preview };
}

function picklistOptions(describe: any, fieldName: string): PicklistOption[] {
  const field = (describe?.fields || []).find((one: any) => one.name === fieldName);
  return (field?.picklistValues || [])
    .filter((value: any) => value.active !== false)
    .map((value: any) => ({ value: String(value.value), label: String(value.label || value.value) }))
    .sort((a: PicklistOption, b: PicklistOption) => a.label.localeCompare(b.label));
}

async function assertOrgShapeAvailable(conn: Connection): Promise<void> {
  try {
    await conn.describe('ShapeRepresentation');
  } catch {
    throw new SfError(t('scratchOrgDefOrgShapeNotEnabled', { org: conn.getUsername() || '' }));
  }
}

async function waitForOrgShape(conn: Connection, shapeId: string): Promise<any> {
  const start = Date.now();
  const where = shapeId ? `WHERE Id = '${shapeId.replace(/[^A-Za-z0-9]/g, '')}'` : '';
  while (Date.now() - start < SHAPE_TIMEOUT_MS) {
    const res = await conn.query(`SELECT Id, Status, Features, Settings, CreatedDate FROM ShapeRepresentation ${where} ORDER BY CreatedDate DESC LIMIT 1`);
    const shape: any = res.records[0];
    if (shape?.Status === 'Active') {
      return shape;
    }
    if (shape?.Status === 'Error') {
      throw new SfError(t('scratchOrgDefOrgShapeFailed', { message: shape.Status }));
    }
    uxLog('other', this, c.grey(t('scratchOrgDefWaitingOrgShape', { status: shape?.Status || '?' })));
    await new Promise((resolve) => setTimeout(resolve, SHAPE_POLL_INTERVAL_MS));
  }
  throw new SfError(t('scratchOrgDefOrgShapeTimeout'));
}

function parseShapeSettings(settings: string | null | undefined): Record<string, any> | null {
  if (!settings) {
    return null;
  }
  try {
    const parsed = JSON.parse(settings);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
