import { strict as assert } from 'assert';
import {
  buildAlertRuleGroups,
  GRAFANA_V2_FOLDER_UID,
  normalizeGrafanaUrl,
  parseDurationSeconds,
  pickDatasource,
} from '../../../src/common/grafana/grafanaDashboardsInstaller.js';

describe('grafanaDashboardsInstaller', () => {
  describe('normalizeGrafanaUrl', () => {
    it('strips trailing slashes', () => {
      assert.equal(normalizeGrafanaUrl('https://my.grafana.net/'), 'https://my.grafana.net');
      assert.equal(normalizeGrafanaUrl('https://my.grafana.net//'), 'https://my.grafana.net');
    });

    it('adds https scheme when missing', () => {
      assert.equal(normalizeGrafanaUrl('my.grafana.net'), 'https://my.grafana.net');
    });

    it('keeps an explicit http scheme', () => {
      assert.equal(normalizeGrafanaUrl('http://localhost:3000/'), 'http://localhost:3000');
    });

    it('rejects non-http schemes and unparseable input', () => {
      assert.throws(() => normalizeGrafanaUrl('htp://grafana.corp'));
      assert.throws(() => normalizeGrafanaUrl('ftp://foo.com'));
      assert.throws(() => normalizeGrafanaUrl('http://'));
      assert.throws(() => normalizeGrafanaUrl('https://a b.com'));
    });
  });

  describe('pickDatasource', () => {
    const prom = { uid: 'prom-1', name: 'Mimir', type: 'prometheus' };
    const loki = { uid: 'loki-1', name: 'Loki', type: 'loki' };

    it('selects the single matching datasource', () => {
      const { selected } = pickDatasource([prom, loki], 'prometheus');
      assert.equal(selected?.uid, 'prom-1');
    });

    it('excludes Grafana Cloud internal datasources', () => {
      const internal = [
        { uid: 'a', name: 'grafanacloud-myorg-alert-state-history', type: 'loki' },
        { uid: 'b', name: 'grafanacloud-myorg-usage-insights', type: 'loki' },
        { uid: 'c', name: 'grafanacloud-myorg-ml-metrics', type: 'prometheus' },
      ];
      const { selected: selLoki } = pickDatasource([...internal, loki], 'loki');
      assert.equal(selLoki?.uid, 'loki-1');
      const { selected: selProm } = pickDatasource([...internal, prom], 'prometheus');
      assert.equal(selProm?.uid, 'prom-1');
    });

    it('prefers the default datasource when several match', () => {
      const prom2 = { uid: 'prom-2', name: 'Other prom', type: 'prometheus', isDefault: true };
      const { selected } = pickDatasource([prom, prom2], 'prometheus');
      assert.equal(selected?.uid, 'prom-2');
    });

    it('returns candidates without selection when ambiguous', () => {
      const prom2 = { uid: 'prom-2', name: 'Other prom', type: 'prometheus' };
      const { selected, candidates } = pickDatasource([prom, prom2], 'prometheus');
      assert.equal(selected, null);
      assert.equal(candidates.length, 2);
    });

    it('returns no candidates when the type is absent', () => {
      const { selected, candidates } = pickDatasource([prom], 'loki');
      assert.equal(selected, null);
      assert.equal(candidates.length, 0);
    });
  });

  describe('parseDurationSeconds', () => {
    it('parses h/m/s/d suffixes and plain numbers', () => {
      assert.equal(parseDurationSeconds('6h'), 21600);
      assert.equal(parseDurationSeconds('30s'), 30);
      assert.equal(parseDurationSeconds('10m'), 600);
      assert.equal(parseDurationSeconds('1d'), 86400);
      assert.equal(parseDurationSeconds('45'), 45);
      assert.equal(parseDurationSeconds(120), 120);
    });

    it('throws on unparseable values', () => {
      assert.throws(() => parseDurationSeconds('6 hours'));
    });
  });

  describe('buildAlertRuleGroups', () => {
    const alertsYaml = `
apiVersion: 1
groups:
  - orgId: 1
    name: sfdx-hardis-org-monitoring
    folder: Org Monitoring by sfdx-hardis
    interval: 6h
    rules:
      - uid: rule-1
        title: Test rule
        condition: C
        isPaused: true
        for: 0s
        noDataState: OK
        execErrState: OK
        data:
          - refId: A
            datasourceUid: \${DS_PROMETHEUS}
            model:
              expr: 'up'
          - refId: B
            datasourceUid: \${DS_LOKI}
            model:
              expr: '{a="b"}'
`;

    it('substitutes datasource placeholders and maps to the provisioning API shape', () => {
      const groups = buildAlertRuleGroups(alertsYaml, 'my-prom', 'my-loki', GRAFANA_V2_FOLDER_UID);
      assert.equal(groups.length, 1);
      assert.equal(groups[0].name, 'sfdx-hardis-org-monitoring');
      assert.equal(groups[0].interval, 21600);
      const rule = groups[0].rules[0];
      assert.equal(rule.folderUID, GRAFANA_V2_FOLDER_UID);
      assert.equal(rule.ruleGroup, 'sfdx-hardis-org-monitoring');
      assert.equal(rule.isPaused, true);
      assert.equal(rule.data[0].datasourceUid, 'my-prom');
      assert.equal(rule.data[1].datasourceUid, 'my-loki');
    });

    it('parses the real alert pack file with every rule paused', async () => {
      const fs = await import('fs-extra');
      const yamlText = await fs.default.readFile('docs/grafana/alerts-v2/sfdx-hardis-alerts.yaml', 'utf8');
      const groups = buildAlertRuleGroups(yamlText, 'prom-uid', 'loki-uid', GRAFANA_V2_FOLDER_UID);
      assert.ok(groups.length >= 1);
      const allRules = groups.flatMap((g) => g.rules);
      assert.ok(allRules.length >= 6);
      for (const rule of allRules) {
        assert.equal(rule.isPaused, true, `rule ${rule.uid} must ship paused`);
        assert.ok(!JSON.stringify(rule).includes('${DS_'), `rule ${rule.uid} still contains a placeholder`);
      }
    });
  });
});
