// Install the "Org Monitoring by sfdx-hardis" Grafana dashboards v2 (and the paused alert
// pack) on any Grafana instance (Cloud, OSS, Enterprise) through the Grafana HTTP API.
// Dashboard definitions are fetched at runtime from the sfdx-hardis GitHub repository, so the
// npm package does not need to embed them and users always get the dashboards matching --ref.
import { createHttpClient, httpGet, HttpClient } from '../utils/httpUtils.js';
import yaml from 'js-yaml';

export const GRAFANA_V2_FOLDER_UID = 'sfdx-hardis-v2';
export const GRAFANA_V2_FOLDER_TITLE = 'Org Monitoring by sfdx-hardis';
export const GRAFANA_V2_REPO = 'hardisgroupcom/sfdx-hardis';
export const GRAFANA_V2_DASHBOARDS_PATH = 'docs/grafana/dashboards-v2';
export const GRAFANA_V2_ALERTS_PATH = 'docs/grafana/alerts-v2/sfdx-hardis-alerts.yaml';
export const GRAFANA_V2_FLEET_UID = 'sfdx-hardis-v2-fleet';

// Used when the GitHub contents API is unreachable (rate limit, proxy): must list every
// dashboard JSON of docs/grafana/dashboards-v2
export const GRAFANA_V2_FALLBACK_DASHBOARD_FILES = [
  'dtl-indicator.json',
  'fleet.json',
  'org-adoption.json',
  'org-debt.json',
  'org-devops.json',
  'org-home.json',
  'org-limits.json',
  'org-reliability.json',
  'org-security.json',
  'org-usage.json',
  'search-licenses.json',
  'search-org.json',
  'search-packages.json',
];

// Grafana Cloud ships internal Prometheus/Loki datasources that never contain sfdx-hardis
// data: same exclusion list as the ds_prom / ds_loki dashboard variables (generator.mjs)
const GRAFANA_INTERNAL_DS_REGEX = /(alert-state-history|usage-insights|ml-metrics)/;

export interface GrafanaDatasource {
  uid: string;
  name: string;
  type: string;
  isDefault?: boolean;
}

export interface DashboardFileRef {
  name: string;
  downloadUrl: string;
}

export interface AlertRuleGroupPayload {
  name: string;
  interval: number;
  rules: any[];
}

export const GRAFANA_HTTP_TIMEOUT_MS = 30000;

export function normalizeGrafanaUrl(url: string): string {
  // Validate BEFORE any rewriting: stripping slashes or prepending https:// first would
  // hide typos like "htp://x" (parsed as host "htp") or turn "http://" into "http:"
  const trimmed = url.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    throw new Error(`Invalid Grafana URL: ${url}`);
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
  try {
    const parsed = new URL(withScheme);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
      throw new Error('invalid');
    }
  } catch {
    throw new Error(`Invalid Grafana URL: ${url}`);
  }
  return withScheme.replace(/\/+$/, '');
}

export function createGrafanaClient(grafanaUrl: string, token: string): HttpClient {
  return createHttpClient({
    baseURL: normalizeGrafanaUrl(grafanaUrl),
    timeout: GRAFANA_HTTP_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

// Returns the datasource to use for a given type, plus the plausible candidates when the
// choice is ambiguous (caller decides: prompt in interactive mode, first candidate otherwise)
export function pickDatasource(
  datasources: GrafanaDatasource[],
  type: 'prometheus' | 'loki'
): { selected: GrafanaDatasource | null; candidates: GrafanaDatasource[] } {
  const candidates = datasources.filter(
    (ds) =>
      ds.type === type && !GRAFANA_INTERNAL_DS_REGEX.test(ds.name || '') && !GRAFANA_INTERNAL_DS_REGEX.test(ds.uid || '')
  );
  if (candidates.length === 1) {
    return { selected: candidates[0], candidates };
  }
  const defaultDs = candidates.find((ds) => ds.isDefault === true);
  if (defaultDs) {
    return { selected: defaultDs, candidates };
  }
  return { selected: null, candidates };
}

// "6h" -> 21600. Supports s/m/h/d suffixes and plain numbers (already seconds)
export function parseDurationSeconds(duration: string | number): number {
  if (typeof duration === 'number') {
    return duration;
  }
  const match = /^(\d+)([smhd]?)$/.exec(duration.trim());
  if (!match) {
    throw new Error(`Unable to parse duration: ${duration}`);
  }
  const value = parseInt(match[1], 10);
  const multipliers: Record<string, number> = { '': 1, s: 1, m: 60, h: 3600, d: 86400 };
  return value * multipliers[match[2]];
}

// Parses the alert pack YAML (file-provisioning format), substitutes the datasource
// placeholders and maps each group to the payload of the alert provisioning HTTP API
// (PUT /api/v1/provisioning/folder/:folderUid/rule-groups/:group)
export function buildAlertRuleGroups(
  alertsYaml: string,
  promUid: string,
  lokiUid: string,
  folderUid: string
): AlertRuleGroupPayload[] {
  const substituted = alertsYaml
    .split('${DS_PROMETHEUS}')
    .join(promUid)
    .split('${DS_LOKI}')
    .join(lokiUid);
  const parsed: any = yaml.load(substituted);
  const groups = parsed?.groups || [];
  if (groups.length === 0 || groups.every((group: any) => !(group.rules?.length > 0))) {
    throw new Error('No alert rule group found in the alert pack YAML');
  }
  return groups.map((group: any) => ({
    name: group.name,
    interval: parseDurationSeconds(group.interval || '6h'),
    rules: (group.rules || []).map((rule: any) => ({
      ...rule,
      folderUID: folderUid,
      ruleGroup: group.name,
    })),
  }));
}

export async function listDashboardFiles(ref: string): Promise<{ files: DashboardFileRef[]; fromFallback: boolean }> {
  try {
    const listUrl = `https://api.github.com/repos/${GRAFANA_V2_REPO}/contents/${GRAFANA_V2_DASHBOARDS_PATH}?ref=${encodeURIComponent(ref)}`;
    const response = await httpGet(listUrl, {
      timeout: GRAFANA_HTTP_TIMEOUT_MS,
      headers: { Accept: 'application/vnd.github+json' },
    });
    const files = (response.data || [])
      .filter((entry: any) => entry?.name?.endsWith('.json') && entry?.download_url)
      .map((entry: any) => ({ name: entry.name, downloadUrl: entry.download_url }));
    if (files.length > 0) {
      return { files, fromFallback: false };
    }
  } catch {
    // GitHub API unreachable or rate-limited: fall back to the static list below
  }
  return {
    files: GRAFANA_V2_FALLBACK_DASHBOARD_FILES.map((name) => ({
      name,
      downloadUrl: `https://raw.githubusercontent.com/${GRAFANA_V2_REPO}/${ref}/${GRAFANA_V2_DASHBOARDS_PATH}/${name}`,
    })),
    fromFallback: true,
  };
}

export async function fetchGitHubRawFile(ref: string, filePath: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${GRAFANA_V2_REPO}/${ref}/${filePath}`;
  return fetchRawUrl(url);
}

export async function fetchRawUrl(url: string): Promise<string> {
  const response = await httpGet(url, {
    timeout: GRAFANA_HTTP_TIMEOUT_MS,
    responseType: 'text',
  });
  return response.data;
}

export async function getGrafanaDatasources(client: HttpClient): Promise<GrafanaDatasource[]> {
  const response = await client.get('/api/datasources');
  return response.data || [];
}

// Idempotent: returns the folder if it already exists (409/412 = uid or title conflict;
// Grafana versions before 9 answer 400 with an "already exists" message for the same case).
// Any other 400 is NOT swallowed: it means the create request itself is invalid.
export async function ensureGrafanaFolder(client: HttpClient, uid: string, title: string): Promise<any> {
  try {
    const response = await client.post('/api/folders', { uid, title });
    return response.data;
  } catch (e: any) {
    const status = e?.response?.status;
    const alreadyExists400 = status === 400 && /already exists|same uid/i.test(e?.response?.data?.message || '');
    if ([409, 412].includes(status) || alreadyExists400) {
      const existing = await client.get(`/api/folders/${uid}`);
      return existing.data;
    }
    throw e;
  }
}

// Idempotent thanks to overwrite: true + stable dashboard uids: re-running upgrades in place
export async function importGrafanaDashboard(client: HttpClient, dashboard: any, folderUid: string): Promise<any> {
  const payload = { ...dashboard };
  delete payload.id;
  const response = await client.post('/api/dashboards/db', {
    dashboard: payload,
    folderUid,
    overwrite: true,
    message: 'Imported by sfdx-hardis',
  });
  return response.data;
}

export async function getGrafanaDashboard(client: HttpClient, uid: string): Promise<any> {
  const response = await client.get(`/api/dashboards/uid/${uid}`);
  return response.data;
}

// X-Disable-Provenance lets users edit and unpause the rules from the Grafana UI afterwards
export async function importGrafanaAlertRuleGroup(
  client: HttpClient,
  folderUid: string,
  group: AlertRuleGroupPayload
): Promise<any> {
  const response = await client.put(
    `/api/v1/provisioning/folder/${folderUid}/rule-groups/${encodeURIComponent(group.name)}`,
    { title: group.name, folderUid: folderUid, interval: group.interval, rules: group.rules },
    { headers: { 'X-Disable-Provenance': 'true' } }
  );
  return response.data;
}

export function grafanaApiErrorMessage(e: any): string {
  const status = e?.response?.status;
  const detail = e?.response?.data?.message || e?.response?.data?.error || e?.message || String(e);
  return status ? `HTTP ${status}: ${detail}` : detail;
}

export function isGrafanaAuthError(e: any): boolean {
  return [401, 403].includes(e?.response?.status);
}
