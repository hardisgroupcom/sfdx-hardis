import { strict as assert } from 'assert';
import fs from 'fs-extra';
import path from 'path';

// Portability lint for the "Org Monitoring by sfdx-hardis" (v2) Grafana dashboards.
// These dashboards must import into ANY Grafana instance (OSS, Enterprise, Cloud):
// - no hardcoded datasource UID (only the ds_prom / ds_loki dashboard variables)
// - no reference to a specific Grafana Cloud stack
// - every Prometheus expression wrapped in an *_over_time window (metrics are pushed
//   once per day: a bare selector would show "no data" with the default 5m lookback)

const DASHBOARDS_DIR = path.join(process.cwd(), 'docs', 'grafana', 'dashboards-v2');
const ALLOWED_DATASOURCE_UIDS = ['${ds_prom}', '${ds_loki}', '-- Grafana --', 'grafana', '-- Mixed --'];

function collectDatasources(node: any, found: any[]): void {
  if (node == null || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectDatasources(item, found);
    }
    return;
  }
  if (node.datasource && typeof node.datasource === 'object' && node.datasource.uid) {
    found.push(node.datasource);
  }
  for (const key of Object.keys(node)) {
    collectDatasources(node[key], found);
  }
}

function collectPromExprs(node: any, found: string[]): void {
  if (node == null || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectPromExprs(item, found);
    }
    return;
  }
  if (typeof node.expr === 'string' && node.datasource?.uid === '${ds_prom}') {
    found.push(node.expr);
  }
  for (const key of Object.keys(node)) {
    collectPromExprs(node[key], found);
  }
}

describe('Grafana dashboards v2 (portability lint)', () => {
  const files = fs
    .readdirSync(DASHBOARDS_DIR)
    .filter((file: string) => file.endsWith('.json'));

  it('contains the expected dashboard set', () => {
    assert.ok(files.length >= 12, `Expected at least 12 dashboards, found ${files.length}`);
  });

  it('matches the installer fallback file list (hardis:org:configure:grafana-dashboards)', async () => {
    const { GRAFANA_V2_FALLBACK_DASHBOARD_FILES } = await import('../src/common/grafana/grafanaDashboardsInstaller.js');
    assert.deepEqual(
      [...GRAFANA_V2_FALLBACK_DASHBOARD_FILES].sort(),
      [...files].sort(),
      'Update GRAFANA_V2_FALLBACK_DASHBOARD_FILES in src/common/grafana/grafanaDashboardsInstaller.ts when adding/removing a dashboard'
    );
  });

  for (const file of files) {
    describe(file, () => {
      const raw = fs.readFileSync(path.join(DASHBOARDS_DIR, file), 'utf8');
      const dash = JSON.parse(raw);

      it('has a v2 uid and tags', () => {
        assert.match(dash.uid, /^sfdx-hardis-v2-/);
        assert.ok(dash.tags.includes('sfdx-hardis-v2'));
      });

      it('contains no reference to a specific Grafana stack', () => {
        const lower = raw.toLowerCase();
        assert.ok(!lower.includes('grafanacloud-'), 'found hardcoded grafanacloud- datasource uid');
        assert.ok(!lower.includes('cloudity'), 'found reference to the cloudity stack');
      });

      it('declares the ds_prom and ds_loki datasource variables', () => {
        const variables = dash.templating?.list || [];
        const dsVarNames = variables.filter((v: any) => v.type === 'datasource').map((v: any) => v.name);
        assert.ok(dsVarNames.includes('ds_prom'), 'missing ds_prom datasource variable');
        assert.ok(dsVarNames.includes('ds_loki'), 'missing ds_loki datasource variable');
      });

      it('only references datasources through variables or built-ins', () => {
        const datasources: any[] = [];
        collectDatasources(dash, datasources);
        for (const ds of datasources) {
          assert.ok(
            ALLOWED_DATASOURCE_UIDS.includes(ds.uid),
            `unexpected datasource uid "${ds.uid}" (must be a \${ds_*} variable or a Grafana built-in)`
          );
        }
      });

      it('wraps every Prometheus expression in an *_over_time window', () => {
        const exprs: string[] = [];
        collectPromExprs(dash, exprs);
        for (const expr of exprs) {
          assert.ok(
            /_over_time\s*\(|label_values\s*\(/.test(expr),
            `Prometheus expr without *_over_time lookback (would show no data with daily samples): ${expr}`
          );
        }
      });

      it('has unique panel ids', () => {
        const ids = (dash.panels || []).map((p: any) => p.id);
        assert.equal(new Set(ids).size, ids.length, 'duplicate panel ids');
      });

      it('every stat/gauge/bargauge value links to a detail view', () => {
        // Numbers must be clickable: each one leads to its detail (indicator detail
        // dashboard, another dashboard, or a full-screen panel view).
        const exemptTitles = ['Stats generation date', 'Latest value'];
        for (const panel of dash.panels || []) {
          if (!['stat', 'gauge', 'bargauge'].includes(panel.type)) {
            continue;
          }
          if (exemptTitles.includes(panel.title) || dash.uid === 'sfdx-hardis-v2-dtl-indicator') {
            continue;
          }
          const links = panel.fieldConfig?.defaults?.links || [];
          assert.ok(links.length > 0, `panel "${panel.title}" has no detail link`);
        }
      });
    });
  }
});
