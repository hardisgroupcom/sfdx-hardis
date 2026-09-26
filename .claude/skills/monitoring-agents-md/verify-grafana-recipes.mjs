// Runs every query of the Grafana section of the monitoring AGENTS.md template against a live
// Grafana instance, with GET requests only (read-only).
// Usage, from the repository root:
//   node .claude/skills/monitoring-agents-md/verify-grafana-recipes.mjs <orgIdentifier>
// Instance: GRAFANA_API_URL, required, in the environment or in the .env of the repository (no default:
// the token is only sent where you say). Token: GRAFANA_API_TOKEN, or GRAFANA_TOKEN, same places
// (Viewer role, with the Query permission on both datasources).
import fs from 'fs';

const envFile = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
const fromEnvFile = (name) => (envFile.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1] || '').replace(/["\r]/g, '').trim();
const token = process.env.GRAFANA_API_TOKEN || fromEnvFile('GRAFANA_API_TOKEN') || fromEnvFile('GRAFANA_TOKEN');
const baseUrl = (process.env.GRAFANA_API_URL || fromEnvFile('GRAFANA_API_URL')).replace(/\/$/, '');
const lokiUid = process.env.GRAFANA_LOKI_UID || 'grafanacloud-logs';
const promUid = process.env.GRAFANA_PROM_UID || 'grafanacloud-prom';
const org = process.argv[2];
if (!token || !org || !baseUrl) {
  console.error('Usage: node verify-grafana-recipes.mjs <orgIdentifier>, with GRAFANA_API_URL and GRAFANA_API_TOKEN (or GRAFANA_TOKEN) in the environment or in .env');
  process.exit(2);
}

async function get(path, params) {
  const url = new URL(baseUrl + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.append(key, value);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text), size: text.length };
  } catch {
    return { status: res.status, body: text, size: text.length };
  }
}

const template = fs.readFileSync('defaults/templates/monitoring/AGENTS.md', 'utf8');
const section = template.slice(template.indexOf('## Monitoring results in Grafana'), template.indexOf('## Files and folders'));
// Inline code spans holding a query: they select source="sfdx-hardis" and are not a curl parameter
const queries = [...new Set([...section.matchAll(/`([^`\n]*source="sfdx-hardis"[^`\n]*)`/g)].map((m) => m[1]))].filter(
  (q) => /^[({a-z]/.test(q) && !q.startsWith('match[]') && !q.startsWith('query=')
);
const loki = `/api/datasources/proxy/uid/${lokiUid}/loki/api/v1`;
const prom = `/api/datasources/proxy/uid/${promUid}/api/v1`;
const now = Math.floor(Date.now() / 1000);
const iso = (seconds) => new Date(seconds * 1000).toISOString().replace(/\.\d+Z$/, 'Z');

let failures = 0;
for (const raw of queries) {
  const query = raw.replaceAll('"acme"', `"${org}"`);
  const isLoki = query.startsWith('{') || /_over_time\(\{source="sfdx-hardis"[^}]*\}(\s*\|[^[]*)?\s*\[/.test(query) && /count_over_time/.test(query);
  const isLogQuery = query.startsWith('{');
  // A daily history: last_over_time(...[1d]) or count_over_time(...[1d]) is read with query_range and step=1d
  const isDaily = /\[1d\]\)\)$/.test(query) && !query.includes('sum_over_time');
  let res;
  if (isLogQuery) {
    res = await get(`${loki}/query_range`, { query, start: iso(now - 29 * 86400), limit: '1' });
  } else if (isLoki) {
    res = isDaily
      ? await get(`${loki}/query_range`, { query, start: iso(now - 29 * 86400), end: iso(now), step: '1d' })
      : await get(`${loki}/query`, { query });
  } else {
    res = isDaily
      ? await get(`${prom}/query_range`, { query, start: iso(now - 90 * 86400), end: iso(now), step: '1d' })
      : await get(`${prom}/query`, { query });
  }
  const result = res.body?.data?.result;
  const ok = res.status === 200 && Array.isArray(result);
  if (!ok) failures++;
  const status = ok ? (result.length > 0 ? 'OK   ' : 'EMPTY') : 'FAIL ';
  console.log(`${status} ${isLoki ? 'loki' : 'prom'}${isDaily ? ' daily' : ''} ${result?.length ?? '-'} series, ${res.size} bytes | ${query.slice(0, 120)}`);
  if (!ok) console.log(`      ${JSON.stringify(res.body).slice(0, 300)}`);
}
console.log(`\n${queries.length} queries, ${failures} failed. EMPTY is expected when the org does not send that type.`);
process.exit(failures > 0 ? 1 : 0);
