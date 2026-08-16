// Lint suite for the Grafana alert pack (docs/grafana/alerts-v2/sfdx-hardis-alerts.yaml).
// Enforces the rules from .claude/skills/grafana-dashboards/SKILL.md: paused by default,
// OK on no-data/exec-error, A(query) -> B(reduce) -> C(threshold) shape, datasource
// placeholders only, no stack-specific string, daily-sample-safe lookback windows.
import { strict as assert } from 'assert';
import fs from 'fs-extra';
import * as path from 'path';
import yaml from 'js-yaml';

const ALERTS_FILE = path.join(process.cwd(), 'docs', 'grafana', 'alerts-v2', 'sfdx-hardis-alerts.yaml');
const DS_PLACEHOLDERS = ['${DS_PROMETHEUS}', '${DS_LOKI}'];

describe('Grafana alerts v2 (portability lint)', () => {
  const parsed: any = yaml.load(fs.readFileSync(ALERTS_FILE, 'utf8'));

  it('has the provisioning file structure', () => {
    assert.equal(parsed.apiVersion, 1);
    assert.ok(Array.isArray(parsed.groups) && parsed.groups.length >= 1, 'at least one rule group');
  });

  const rules: any[] = (parsed.groups || []).flatMap((g: any) => g.rules || []);

  it('contains the expected rule set', () => {
    assert.ok(rules.length >= 6, `Expected at least 6 rules, found ${rules.length}`);
  });

  for (const group of parsed.groups || []) {
    it(`group ${group.name} has a parseable evaluation interval`, () => {
      assert.match(String(group.interval), /^\d+[smhd]?$/);
      assert.equal(group.folder, 'Org Monitoring by sfdx-hardis');
    });
  }

  for (const rule of rules) {
    describe(rule.uid, () => {
      it('has a v2 uid and sfdx-hardis source label', () => {
        assert.match(rule.uid, /^sfdx-hardis-v2-/);
        assert.equal(rule.labels?.source, 'sfdx-hardis');
      });

      it('ships paused and resilient to missing daily data', () => {
        assert.equal(rule.isPaused, true, 'rule must ship paused (Grafana Cloud free-tier cost)');
        assert.equal(rule.noDataState, 'OK');
        assert.equal(rule.execErrState, 'OK');
      });

      it('follows the A (query) -> B (reduce) -> C (threshold) shape', () => {
        assert.equal(rule.condition, 'C');
        const refIds = (rule.data || []).map((d: any) => d.refId);
        assert.deepEqual(refIds, ['A', 'B', 'C']);
        assert.equal(rule.data[1].model.type, 'reduce');
        assert.equal(rule.data[2].model.type, 'threshold');
      });

      it('uses only datasource placeholders, no hardcoded uid or stack reference', () => {
        const queryNode = rule.data[0];
        assert.ok(DS_PLACEHOLDERS.includes(queryNode.datasourceUid), `unexpected datasource uid ${queryNode.datasourceUid}`);
        for (const node of rule.data.slice(1)) {
          assert.equal(node.datasourceUid, '__expr__');
        }
        const serialized = JSON.stringify(rule);
        assert.ok(!serialized.includes('grafanacloud-'), 'hardcoded Grafana Cloud datasource uid');
        assert.ok(!/cloudity/i.test(serialized), 'stack-specific reference');
      });

      it('has an actionable per-org summary annotation', () => {
        assert.ok(rule.annotations?.summary?.includes('{{ $labels.orgIdentifier }}'), 'summary must name the org');
      });

      it('wraps Prometheus selectors in an *_over_time window of at least 2 days', () => {
        const queryNode = rule.data[0];
        const expr: string = queryNode.model.expr;
        if (queryNode.datasourceUid === '${DS_PROMETHEUS}') {
          assert.ok(expr.includes('_over_time('), 'daily metrics need an *_over_time lookback');
          // [1d] leaves no margin when the daily monitoring cron drifts
          assert.ok(!expr.includes('[1d]'), 'lookback window must be at least [2d]');
        }
      });
    });
  }

  it('health score rules use the weekly-aware 8d lookback', () => {
    const healthRule = rules.find((r) => r.uid === 'sfdx-hardis-v2-health-score');
    assert.ok(healthRule.data[0].model.expr.includes('[8d]'));
  });
});
