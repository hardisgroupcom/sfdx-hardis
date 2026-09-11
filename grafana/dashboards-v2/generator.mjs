#!/usr/bin/env node
// Generator for the "Org Monitoring by sfdx-hardis" (v2) Grafana dashboards.
//
// Usage: node generator.mjs   (writes the *.json dashboards next to this file)
//
// Design rules enforced here (see docs/salesforce-monitoring-grafana-v2.md):
// - No hardcoded datasource UID: every panel references the ds_prom / ds_loki
//   dashboard variables (type: datasource), so the same JSON imports on any
//   Grafana instance (OSS, Enterprise, Cloud).
// - sfdx-hardis pushes metrics once per day, so every PromQL selector is wrapped
//   in last_over_time(...[2d]) (or an *_over_time aggregation): a bare selector
//   would return no data with the default 5 minutes lookback.
// - Only core panel types (stat, gauge, timeseries, table, bargauge, text, row).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const OUT_DIR = path.dirname(fileURLToPath(import.meta.url));

const DS_PROM = { type: 'prometheus', uid: '${ds_prom}' };
const DS_LOKI = { type: 'loki', uid: '${ds_loki}' };
const SRC = 'source="sfdx-hardis"';
const TAG = 'sfdx-hardis-v2';

let panelId = 0;
const nextId = () => ++panelId;

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * Latest daily sample of a metric for the selected org.
 * Aggregated by orgIdentifier: an org can expose several series for the same metric
 * (e.g. two gitIdentifier values after a monitoring repo/branch rename), which would
 * otherwise render stat panels with multiple confusing values.
 */
const promLast = (metric, extraSel = 'orgIdentifier="$org"', range = '2d') =>
  `max by (orgIdentifier) (last_over_time(${metric}{${SRC}${extraSel ? ', ' + extraSel : ''}}[${range}]))`;

/** Same aggregation for any *_over_time function (avg, max, sum) */
const promOverTime = (fn, metric, range, extraSel = 'orgIdentifier="$org"') =>
  `max by (orgIdentifier) (${fn}(${metric}{${SRC}${extraSel ? ', ' + extraSel : ''}}[${range}]))`;

const promTarget = (expr, opts = {}) => ({
  datasource: DS_PROM,
  expr,
  refId: opts.refId || 'A',
  ...(opts.instant ? { instant: true, range: false, format: opts.format || 'table' } : {}),
  ...(opts.legendFormat ? { legendFormat: opts.legendFormat } : {}),
});

const lokiTarget = (expr, opts = {}) => ({
  datasource: DS_LOKI,
  expr,
  queryType: opts.instant ? 'instant' : 'range',
  direction: 'backward',
  refId: opts.refId || 'A',
  ...(opts.maxLines != null ? { maxLines: opts.maxLines } : {}),
  ...(opts.legendFormat ? { legendFormat: opts.legendFormat } : {}),
});

// ---------------------------------------------------------------------------
// Transformation helpers
// ---------------------------------------------------------------------------

/** Extract fields from the Loki JSON log line */
const extractJson = (jsonPaths, opts = {}) => ({
  id: 'extractFields',
  options: {
    format: 'json',
    jsonPaths: jsonPaths.map((p) => (typeof p === 'string' ? { path: p } : p)),
    keepTime: opts.keepTime ?? false,
    replace: opts.replace ?? true,
    source: opts.source || 'Line',
  },
});

/** v1-proven chain rendering a JSON array field of the latest Loki entry as table rows */
const jsonArrayToRows = (arrayField) => [
  extractJson([arrayField]),
  { id: 'extractFields', options: { format: 'auto', replace: true, source: arrayField } },
  { id: 'reduce', options: { includeTimeField: false, labelsToFields: false, mode: 'seriesToRows', reducers: ['allValues'] } },
  { id: 'extractFields', options: { format: 'auto', replace: true, source: 'All values' } },
  { id: 'extractFields', options: { replace: true, source: '0' } },
];

// Always hide internal columns that some backends add (e.g. Grafana Cloud __proxy_source__):
// there is always a single source, displaying it is pure noise
const organize = (options) => ({
  id: 'organize',
  options: { ...options, excludeByName: { __proxy_source__: true, ...(options.excludeByName || {}) } },
});

// ---------------------------------------------------------------------------
// Panel factories
// ---------------------------------------------------------------------------

const thresholdSteps = (steps) => ({
  mode: 'absolute',
  steps: steps.map(([value, color]) => (value == null ? { color } : { color, value })),
});

// Green when high (scores) / red when high (counts, percents)
const THRESHOLDS_SCORE = thresholdSteps([[null, 'red'], [50, 'orange'], [70, 'yellow'], [85, 'green']]);
const THRESHOLDS_COUNT = thresholdSteps([[null, 'green'], [1, 'orange'], [10, 'red']]);
const THRESHOLDS_PERCENT_USED = thresholdSteps([[null, 'green'], [50, 'yellow'], [75, 'orange'], [90, 'red']]);
const THRESHOLDS_NONE = thresholdSteps([[null, 'blue']]);

function basePanel(type, title, opts = {}) {
  return {
    id: nextId(),
    type,
    title,
    datasource: opts.datasource || DS_PROM,
    gridPos: opts.gridPos || { h: 5, w: 4, x: 0, y: 0 },
    targets: opts.targets || [],
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.transformations ? { transformations: opts.transformations } : {}),
    fieldConfig: {
      defaults: {
        color: opts.colorMode || { mode: 'thresholds' },
        mappings: opts.mappings || [],
        thresholds: opts.thresholds || THRESHOLDS_NONE,
        ...(opts.unit ? { unit: opts.unit } : {}),
        ...(opts.min != null ? { min: opts.min } : {}),
        ...(opts.max != null ? { max: opts.max } : {}),
        ...(opts.decimals != null ? { decimals: opts.decimals } : {}),
        ...(opts.noValue ? { noValue: opts.noValue } : {}),
        ...(opts.links ? { links: opts.links } : {}),
        ...(opts.custom ? { custom: opts.custom } : {}),
      },
      overrides: opts.overrides || [],
    },
    ...(opts.extra || {}),
  };
}

const statPanel = (title, opts = {}) =>
  basePanel('stat', title, {
    ...opts,
    extra: {
      options: {
        colorMode: 'value',
        graphMode: opts.sparkline ? 'area' : 'none',
        justifyMode: 'auto',
        orientation: 'auto',
        reduceOptions: { calcs: [opts.calc || 'lastNotNull'], fields: opts.fields || '', values: false },
        textMode: 'auto',
      },
      ...(opts.extra || {}),
    },
  });

const gaugePanel = (title, opts = {}) =>
  basePanel('gauge', title, {
    unit: 'percent',
    min: 0,
    max: 100,
    thresholds: THRESHOLDS_PERCENT_USED,
    ...opts,
    extra: {
      options: {
        minVizHeight: 75,
        minVizWidth: 75,
        orientation: 'auto',
        reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
        showThresholdLabels: false,
        showThresholdMarkers: true,
      },
    },
  });

const timeseriesPanel = (title, opts = {}) =>
  basePanel('timeseries', title, {
    colorMode: { mode: 'palette-classic' },
    ...opts,
    custom: {
      axisCenteredZero: false,
      axisColorMode: 'text',
      axisLabel: '',
      axisPlacement: 'auto',
      drawStyle: opts.bars ? 'bars' : 'line',
      fillOpacity: opts.fillOpacity ?? 12,
      gradientMode: 'opacity',
      lineInterpolation: 'smooth',
      lineWidth: 2,
      pointSize: 5,
      showPoints: 'auto',
      spanNulls: true,
      stacking: { group: 'A', mode: opts.stacked ? 'normal' : 'none' },
      thresholdsStyle: { mode: opts.showThresholdLine ? 'line' : 'off' },
      ...(opts.custom || {}),
    },
    extra: {
      options: {
        legend: { calcs: [], displayMode: 'list', placement: 'bottom', showLegend: true },
        tooltip: { mode: 'multi', sort: 'desc' },
      },
    },
  });

const tablePanel = (title, opts = {}) =>
  basePanel('table', title, {
    ...opts,
    custom: {
      align: 'auto',
      cellOptions: { type: 'auto' },
      filterable: opts.filterable ?? true,
      inspect: true,
      ...(opts.custom || {}),
    },
    extra: {
      options: {
        cellHeight: 'sm',
        footer: { countRows: false, fields: '', reducer: ['sum'], show: false },
        showHeader: true,
        ...(opts.sortBy ? { sortBy: opts.sortBy } : {}),
      },
    },
  });

const bargaugePanel = (title, opts = {}) =>
  basePanel('bargauge', title, {
    unit: 'none',
    min: 0,
    max: 100,
    thresholds: THRESHOLDS_SCORE,
    ...opts,
    extra: {
      options: {
        displayMode: 'gradient',
        maxVizHeight: 300,
        minVizHeight: 16,
        minVizWidth: 8,
        namePlacement: 'auto',
        orientation: 'horizontal',
        reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
        showUnfilled: true,
        sizing: 'auto',
        valueMode: 'color',
      },
    },
  });

const textPanel = (markdown, opts = {}) =>
  basePanel('text', opts.title || '', {
    datasource: { type: 'datasource', uid: 'grafana' },
    ...opts,
    extra: { options: { code: { language: 'plaintext' }, content: markdown, mode: 'markdown' } },
  });

const rowPanel = (title, y) => ({
  id: nextId(),
  type: 'row',
  title,
  collapsed: false,
  gridPos: { h: 1, w: 24, x: 0, y },
  panels: [],
});

/** Loki stat showing when the latest entry of a type was generated */
const statsDatePanel = (type, gridPos) =>
  statPanel('Stats generation date', {
    datasource: DS_LOKI,
    gridPos,
    fields: '/^_dateTime$/',
    targets: [lokiTarget(`{${SRC}, type="${type}", orgIdentifier="$org"} |= \`\``, { maxLines: 1 })],
    transformations: [
      extractJson(['_dateTime', '_jobUrl']),
      { id: 'convertFieldType', options: { conversions: [{ destinationType: 'time', targetField: '_dateTime' }], fields: {} } },
    ],
    extra: { options: { colorMode: 'none', graphMode: 'none', justifyMode: 'auto', orientation: 'auto', reduceOptions: { calcs: ['lastNotNull'], fields: '/^_dateTime$/', values: false }, textMode: 'auto' } },
  });

// ---------------------------------------------------------------------------
// Layout: rows of panels; y computed automatically
// ---------------------------------------------------------------------------

function layout(sections) {
  const panels = [];
  let y = 0;
  for (const section of sections) {
    if (section.row) {
      panels.push(rowPanel(section.row, y));
      y += 1;
    }
    let x = 0;
    let rowMaxH = 0;
    for (const p of section.panels || []) {
      const w = p.gridPos?.w ?? 4;
      const h = p.gridPos?.h ?? 5;
      if (x + w > 24) {
        x = 0;
        y += rowMaxH;
        rowMaxH = 0;
      }
      p.gridPos = { h, w, x, y };
      x += w;
      rowMaxH = Math.max(rowMaxH, h);
      panels.push(p);
    }
    y += rowMaxH;
  }
  return panels;
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

// Datasource variables are HIDDEN (hide: 2): there is always a single Prometheus and a
// single Loki datasource receiving sfdx-hardis data, so no picker is shown. The variable
// still exists for portability (no hardcoded datasource UID in any panel) and is
// propagated by every navigation link. The regex filters out Grafana Cloud internal
// datasources (alert state history, usage insights, ...) so the automatic pick lands on
// the real logs/metrics datasource. Override if ever needed via dashboard settings or
// the var-ds_prom / var-ds_loki URL parameters.
const dsVar = (name, dsType, label, description) => ({
  name,
  label,
  description,
  type: 'datasource',
  query: dsType,
  current: {},
  hide: 2,
  includeAll: false,
  multi: false,
  options: [],
  refresh: 1,
  regex: '/^(?!.*(alert-state-history|usage-insights|ml-metrics)).*/',
  skipUrlSync: false,
});

const orgVar = (opts = {}) => {
  // On the fleet dashboard the org list is chained to the Environment filter
  const selector = opts.envChained ? `{${SRC}, $env}` : `{${SRC}}`;
  return {
    name: 'org',
    label: 'Salesforce Org',
    type: 'query',
    datasource: DS_PROM,
    definition: `label_values(${selector}, orgIdentifier)`,
    query: { qryType: 1, query: `label_values(${selector}, orgIdentifier)`, refId: 'PrometheusVariableQueryEditor-VariableQuery' },
    current: {},
    hide: 0,
    includeAll: opts.includeAll ?? false,
    ...(opts.includeAll ? { allValue: '.+' } : {}),
    multi: opts.multi ?? false,
    options: [],
    refresh: 2,
    regex: '',
    skipUrlSync: false,
    sort: 1,
  };
};

// Environment filter: values are full label matchers injected into query selectors
// (RE2 has no negative lookbehind, so "not a sandbox" needs the !~ matcher operator).
// Sandboxes are recognizable in orgIdentifier: it is derived from the instance URL,
// so they end with "sandbox".
const envVar = () => {
  const options = [
    { text: 'All', value: `orgIdentifier=~".+"` },
    { text: 'Production only', value: `orgIdentifier!~".*sandbox.*"` },
    { text: 'Sandboxes only', value: `orgIdentifier=~".*sandbox.*"` },
  ];
  return {
    name: 'env',
    label: 'Environment',
    description: 'Filter orgs by environment type (sandboxes are recognized by their org identifier)',
    type: 'custom',
    query: options.map((o) => `${o.text} : ${o.value}`).join(', '),
    current: { selected: true, text: options[0].text, value: options[0].value },
    options: options.map((o, idx) => ({ selected: idx === 0, text: o.text, value: o.value })),
    hide: 0,
    includeAll: false,
    multi: false,
    skipUrlSync: false,
  };
};

const textboxVar = (name, label, description, defaultValue) => ({
  name,
  label,
  description,
  type: 'textbox',
  current: { text: defaultValue, value: defaultValue },
  options: [{ selected: true, text: defaultValue, value: defaultValue }],
  query: defaultValue,
  hide: 0,
  skipUrlSync: false,
});

// ---------------------------------------------------------------------------
// Dashboard skeleton
// ---------------------------------------------------------------------------

// Note: panel ids are globally monotonic across generated dashboards (they only need
// to be unique within one dashboard, so a shared counter is fine and avoids collisions
// between section panels and row panels).
function dashboard({ uid, title, description, tags = [], variables = [], sections, time = 'now-30d', refresh = '' }) {
  return {
    annotations: {
      list: [
        {
          builtIn: 1,
          datasource: { type: 'grafana', uid: '-- Grafana --' },
          enable: true,
          hide: true,
          iconColor: 'rgba(0, 211, 255, 1)',
          name: 'Annotations & Alerts',
          type: 'dashboard',
        },
      ],
    },
    description,
    editable: true,
    fiscalYearStartMonth: 0,
    graphTooltip: 1,
    links: [
      {
        asDropdown: true,
        icon: 'external link',
        includeVars: true,
        keepTime: false,
        tags: [TAG],
        targetBlank: false,
        title: 'Org Monitoring by sfdx-hardis',
        type: 'dashboards',
      },
    ],
    panels: layout(sections),
    preload: false,
    refresh,
    schemaVersion: 42,
    tags: [TAG, 'sfdx-hardis', ...tags],
    templating: {
      list: [
        dsVar('ds_prom', 'prometheus', 'Prometheus datasource', 'The Prometheus/Mimir datasource receiving sfdx-hardis metrics (NOTIF_API_METRICS_URL)'),
        dsVar('ds_loki', 'loki', 'Loki datasource', 'The Loki datasource receiving sfdx-hardis logs (NOTIF_API_URL)'),
        ...variables,
      ],
    },
    time: { from: time, to: 'now' },
    timepicker: {},
    timezone: '',
    title,
    uid,
    version: 1,
    weekStart: '',
  };
}

// Data links always carry the datasource variables (\${ds_*:queryparam}) AND the current
// time range (\${__url_time_range}) so the landing page shows the same data as the number
// that was clicked (a stat viewed over 180d must not open a 30d detail view).
const DS_QUERYPARAMS = '${ds_prom:queryparam}&${ds_loki:queryparam}&${__url_time_range}';

/** Link from a table row to a dashboard of that row's org */
const orgRowLink = (slug, title, field = 'orgIdentifier') => [
  { title, url: `/d/sfdx-hardis-v2-${slug}/?var-org=\${__data.fields["${field}"]}&${DS_QUERYPARAMS}` },
];

/** Link from a table row to the Org Home dashboard of that row's org */
const orgHomeLink = (field = 'orgIdentifier') => orgRowLink('org-home', 'Open org dashboard', field);

/** Link from a value to a detail dashboard, keeping the current org and datasources */
const detailLink = (slug, title = 'Open details', extraParams = '') => [
  { title, url: `/d/sfdx-hardis-v2-${slug}/?var-org=$org&${DS_QUERYPARAMS}${extraParams}` },
];

/** Link to the generic Indicator Detail dashboard for a notification type */
const indicatorLink = (type) => detailLink('dtl-indicator', 'Open indicator detail', `&var-type=${type}`);

/** Link from a stat to a full-screen view of another panel of the same dashboard */
const viewPanelLink = (dashSlug, panel, title = 'Show details') => [
  { title, url: `/d/sfdx-hardis-v2-${dashSlug}/?viewPanel=${panel.id}&\${__all_variables}&\${__url_time_range}` },
];

const RECENT_CLI_NOTE = 'Requires a recent sfdx-hardis version on the monitoring pipeline (empty until then).';

// ===========================================================================
// 1. Fleet Overview
// ===========================================================================

const silentOrgsExpr = `(sum by (orgIdentifier) (count_over_time({${SRC}, $env, orgIdentifier=~"$org"}[7d])) > 0) unless (sum by (orgIdentifier) (count_over_time({${SRC}, $env, orgIdentifier=~"$org"}[36h])) > 0)`;

const silentOrgsTable = tablePanel('Silent orgs (no notification for 36h)', {
  datasource: DS_LOKI,
  gridPos: { w: 12, h: 9 },
  description: 'Orgs seen in the last 7 days but silent for 36 hours: their monitoring job probably failed. Click a row to open the org dashboard.',
  targets: [lokiTarget(silentOrgsExpr, { instant: true })],
  transformations: [
    organize({ excludeByName: { Time: true, Value: true }, renameByName: { orgIdentifier: 'Org' } }),
  ],
  links: orgHomeLink('Org'),
  noValue: 'No silent org',
});

const backupFailuresTable = tablePanel('Orgs with backup failures (7d)', {
  datasource: DS_LOKI,
  gridPos: { w: 8, h: 9 },
  description: 'Orgs whose metadata backup reported an error in the last 7 days. Click a row to open the org dashboard.',
  targets: [lokiTarget(`sum by (orgIdentifier) (count_over_time({${SRC}, type="BACKUP", severity=~"error|critical", $env, orgIdentifier=~"$org"}[7d]))`, { instant: true })],
  transformations: [
    organize({ excludeByName: { Time: true }, renameByName: { orgIdentifier: 'Org', Value: 'Failures (7d)' } }),
  ],
  links: orgHomeLink('Org'),
  noValue: 'No backup failure',
  sortBy: [{ displayName: 'Failures (7d)', desc: true }],
});

const fleetDashboard = dashboard({
  uid: 'sfdx-hardis-v2-fleet',
  title: '00 - Fleet Overview',
  description: 'All monitored Salesforce orgs at a glance: health score, errors, limits, backups, freshness.',
  time: 'now-7d',
  variables: [
    envVar(),
    orgVar({ multi: true, includeAll: true, envChained: true }),
    textboxVar('license', 'License filter', 'Find orgs holding a license (also see Search dashboards)', ''),
    textboxVar('package', 'Package filter', 'Find orgs holding an installed package', ''),
  ],
  sections: [
    {
      row: 'Fleet at a glance',
      panels: [
        statPanel('Monitored orgs', {
          targets: [promTarget(`count(max by (orgIdentifier) (last_over_time(DailyApiRequests_percent{${SRC}, $env, orgIdentifier=~"$org"}[8d])))`)],
          thresholds: THRESHOLDS_NONE,
        }),
        statPanel('Fleet avg health score', {
          targets: [promTarget(`avg(last_over_time(HealthScore_metric{${SRC}, $env, orgIdentifier=~"$org"}[8d]))`)],
          thresholds: THRESHOLDS_SCORE,
          decimals: 0,
          description: 'Average of weekly org health scores. ' + RECENT_CLI_NOTE,
        }),
        statPanel('Apex + Flow errors (7d)', {
          targets: [
            promTarget(
              `(sum(sum_over_time(ApexErrors_metric{${SRC}, $env, orgIdentifier=~"$org"}[7d])) or vector(0)) + (sum(sum_over_time(FlowErrors_metric{${SRC}, $env, orgIdentifier=~"$org"}[7d])) or vector(0))`
            ),
          ],
          thresholds: THRESHOLDS_COUNT,
        }),
        statPanel('Orgs with backup failures (7d)', {
          datasource: DS_LOKI,
          targets: [lokiTarget(`count(sum by (orgIdentifier) (count_over_time({${SRC}, type="BACKUP", severity=~"error|critical", $env, orgIdentifier=~"$org"}[7d])))`, { instant: true })],
          thresholds: THRESHOLDS_COUNT,
          noValue: '0',
          description: 'Click to see the list of orgs with backup failures.',
          links: viewPanelLink('fleet', backupFailuresTable, 'Show failing orgs'),
        }),
        statPanel('Orgs reporting (36h)', {
          datasource: DS_LOKI,
          targets: [lokiTarget(`count(sum by (orgIdentifier) (count_over_time({${SRC}, $env, orgIdentifier=~"$org"}[36h])))`, { instant: true })],
          thresholds: THRESHOLDS_NONE,
          description: 'Orgs that sent at least one notification in the last 36 hours. Compare with "Monitored orgs" to spot silent orgs.',
        }),
        statPanel('Silent orgs (36h)', {
          datasource: DS_LOKI,
          targets: [lokiTarget(`count(${silentOrgsExpr})`, { instant: true })],
          thresholds: THRESHOLDS_COUNT,
          noValue: '0',
          description: 'Orgs seen in the last 7 days but silent for 36h: their monitoring job probably failed. Click to see the list.',
          links: [
            { title: 'Show silent orgs', url: `/d/sfdx-hardis-v2-fleet/?viewPanel=${silentOrgsTable.id}&\${__all_variables}&\${__url_time_range}` },
          ],
        }),
      ],
    },
    {
      row: 'Monitored orgs',
      panels: [
        tablePanel('Monitored orgs (click a row to open the org dashboard)', {
          gridPos: { w: 24, h: 14 },
          description:
            'One row per monitored org. Click any cell to open the Org Home dashboard. Health columns fill up once the monitoring pipeline runs a recent sfdx-hardis version.',
          targets: [
            promTarget(`max by (orgIdentifier) (last_over_time(HealthScore_metric{${SRC}, $env, orgIdentifier=~"$org"}[8d]))`, { instant: true, refId: 'A' }),
            promTarget(`max by (orgIdentifier) (last_over_time({__name__=~".+_percent", ${SRC}, $env, orgIdentifier=~"$org"}[2d]))`, { instant: true, refId: 'B' }),
            promTarget(`max by (orgIdentifier) (sum_over_time(ApexErrors_metric{${SRC}, $env, orgIdentifier=~"$org"}[7d]))`, { instant: true, refId: 'C' }),
            promTarget(`max by (orgIdentifier) (sum_over_time(FlowErrors_metric{${SRC}, $env, orgIdentifier=~"$org"}[7d]))`, { instant: true, refId: 'D' }),
            promTarget(`max by (orgIdentifier) (avg_over_time(ApexErrors_metric{${SRC}, $env, orgIdentifier=~"$org"}[7d]))`, { instant: true, refId: 'E' }),
            promTarget(`max by (orgIdentifier) (avg_over_time(FlowErrors_metric{${SRC}, $env, orgIdentifier=~"$org"}[7d]))`, { instant: true, refId: 'F' }),
          ],
          transformations: [
            { id: 'merge', options: {} },
            organize({
              excludeByName: { Time: true },
              renameByName: {
                orgIdentifier: 'Org',
                'Value #A': 'Health',
                'Value #B': 'Worst limit %',
                'Value #C': 'Apex errors (7d)',
                'Value #D': 'Flow errors (7d)',
                'Value #E': 'Apex avg/day (7d)',
                'Value #F': 'Flow avg/day (7d)',
              },
            }),
          ],
          links: orgHomeLink('Org'),
          decimals: 1,
          overrides: [
            {
              matcher: { id: 'byName', options: 'Health' },
              properties: [
                { id: 'custom.cellOptions', value: { type: 'color-background' } },
                { id: 'thresholds', value: THRESHOLDS_SCORE },
                { id: 'decimals', value: 0 },
              ],
            },
            {
              matcher: { id: 'byName', options: 'Worst limit %' },
              properties: [
                { id: 'unit', value: 'percent' },
                { id: 'custom.cellOptions', value: { type: 'color-background' } },
                { id: 'thresholds', value: THRESHOLDS_PERCENT_USED },
                { id: 'decimals', value: 0 },
              ],
            },
            {
              matcher: { id: 'byRegexp', options: '.*(errors|avg/day).*' },
              properties: [
                { id: 'custom.cellOptions', value: { type: 'color-text' } },
                { id: 'thresholds', value: THRESHOLDS_COUNT },
                { id: 'decimals', value: 0 },
              ],
            },
          ],
          sortBy: [{ displayName: 'Worst limit %', desc: true }],
        }),
      ],
    },
    {
      row: 'Health sub-scores by org (weekly)',
      panels: [
        tablePanel('Health sub-scores', {
          gridPos: { w: 24, h: 10 },
          description: 'Weekly composite health score (0-100) and sub-scores. ' + RECENT_CLI_NOTE,
          targets: [
            promTarget(`max by (orgIdentifier) (last_over_time(HealthScore_metric{${SRC}, $env, orgIdentifier=~"$org"}[8d]))`, { instant: true, refId: 'A' }),
            promTarget(`max by (orgIdentifier) (last_over_time(HealthScoreReliability_metric{${SRC}, $env, orgIdentifier=~"$org"}[8d]))`, { instant: true, refId: 'B' }),
            promTarget(`max by (orgIdentifier) (last_over_time(HealthScoreLimits_metric{${SRC}, $env, orgIdentifier=~"$org"}[8d]))`, { instant: true, refId: 'C' }),
            promTarget(`max by (orgIdentifier) (last_over_time(HealthScoreSecurity_metric{${SRC}, $env, orgIdentifier=~"$org"}[8d]))`, { instant: true, refId: 'D' }),
            promTarget(`max by (orgIdentifier) (last_over_time(HealthScoreTests_metric{${SRC}, $env, orgIdentifier=~"$org"}[8d]))`, { instant: true, refId: 'E' }),
            promTarget(`max by (orgIdentifier) (last_over_time(HealthScoreDebt_metric{${SRC}, $env, orgIdentifier=~"$org"}[8d]))`, { instant: true, refId: 'F' }),
          ],
          transformations: [
            { id: 'merge', options: {} },
            organize({
              excludeByName: { Time: true },
              renameByName: {
                orgIdentifier: 'Org',
                'Value #A': 'Health',
                'Value #B': 'Reliability',
                'Value #C': 'Limits',
                'Value #D': 'Security',
                'Value #E': 'Tests',
                'Value #F': 'Debt',
              },
            }),
          ],
          links: orgHomeLink('Org'),
          thresholds: THRESHOLDS_SCORE,
          custom: { cellOptions: { type: 'color-background', applyToRow: false } },
          overrides: [
            { matcher: { id: 'byName', options: 'Org' }, properties: [{ id: 'custom.cellOptions', value: { type: 'auto' } }] },
          ],
          sortBy: [{ displayName: 'Health', desc: false }],
        }),
      ],
    },
    {
      row: 'Errors across the fleet',
      panels: [
        timeseriesPanel('Errors per day (all orgs)', {
          gridPos: { w: 12, h: 9 },
          targets: [
            promTarget(`sum(last_over_time(ApexErrors_metric{${SRC}, $env, orgIdentifier=~"$org"}[1d]))`, { legendFormat: 'Apex errors' }),
            promTarget(`sum(last_over_time(FlowErrors_metric{${SRC}, $env, orgIdentifier=~"$org"}[1d]))`, { legendFormat: 'Flow errors', refId: 'B' }),
          ],
        }),
        statPanel('Avg Apex errors/day per org (7d)', {
          gridPos: { w: 6, h: 9 },
          targets: [promTarget(`avg(avg_over_time(ApexErrors_metric{${SRC}, $env, orgIdentifier=~"$org"}[7d]))`)],
          decimals: 1,
          thresholds: THRESHOLDS_COUNT,
          description: 'Fleet-wide average of daily Apex errors per org over the last 7 days.',
        }),
        statPanel('Avg Flow errors/day per org (7d)', {
          gridPos: { w: 6, h: 9 },
          targets: [promTarget(`avg(avg_over_time(FlowErrors_metric{${SRC}, $env, orgIdentifier=~"$org"}[7d]))`)],
          decimals: 1,
          thresholds: THRESHOLDS_COUNT,
          description: 'Fleet-wide average of daily Flow errors per org over the last 7 days.',
        }),
      ],
    },
    {
      row: 'Recent alerts and search',
      panels: [
        tablePanel('Recent error/critical notifications', {
          datasource: DS_LOKI,
          gridPos: { w: 12, h: 10 },
          description: 'Latest notifications received with error or critical severity. Click a row to open the org dashboard.',
          targets: [lokiTarget(`{${SRC}, severity=~"error|critical", $env, orgIdentifier=~"$org"} |= \`\``, { maxLines: 200 })],
          transformations: [
            extractJson(['orgIdentifier', 'type', 'severity'], { source: 'labels', replace: false, keepTime: true }),
            extractJson(['_title'], { source: 'Line', replace: false }),
            organize({
              // Whitelist: everything else (labels JSON, traceID, detected_level, Line...) is noise
              includeByName: { Time: true, orgIdentifier: true, type: true, severity: true, _title: true },
              indexByName: { Time: 0, orgIdentifier: 1, type: 2, severity: 3, _title: 4 },
              renameByName: { orgIdentifier: 'Org', type: 'Type', severity: 'Severity', _title: 'Notification' },
            }),
          ],
          links: orgHomeLink('Org'),
          overrides: [
            {
              matcher: { id: 'byName', options: 'Severity' },
              properties: [
                { id: 'custom.cellOptions', value: { type: 'color-text' } },
                {
                  id: 'mappings',
                  value: [
                    {
                      type: 'value',
                      options: {
                        critical: { color: 'dark-red', index: 0 },
                        error: { color: 'red', index: 1 },
                        warning: { color: 'orange', index: 2 },
                      },
                    },
                  ],
                },
              ],
            },
            { matcher: { id: 'byName', options: 'Time' }, properties: [{ id: 'custom.width', value: 170 }] },
          ],
          sortBy: [{ displayName: 'Time', desc: true }],
        }),
        tablePanel('Orgs holding license "$license"', {
          datasource: DS_LOKI,
          gridPos: { w: 6, h: 10 },
          description: 'Same criteria as the Search: Licenses dashboard, filtered by the license variable.',
          targets: [lokiTarget(`{${SRC}, type="LICENSES", $env, orgIdentifier=~"$org"} |~ \`(?i)$license\``, { maxLines: 500 })],
          transformations: [
            extractJson(['orgIdentifier'], { source: 'labels', replace: true }),
            { id: 'groupBy', options: { fields: { orgIdentifier: { aggregations: [], operation: 'groupby' } } } },
            organize({ renameByName: { orgIdentifier: 'Org' } }),
          ],
          links: orgHomeLink('Org'),
        }),
        tablePanel('Orgs holding package "$package"', {
          datasource: DS_LOKI,
          gridPos: { w: 6, h: 10 },
          description: 'Same criteria as the Search: Packages dashboard, filtered by the package variable.',
          targets: [lokiTarget(`{${SRC}, type="BACKUP", $env, orgIdentifier=~"$org"} |~ \`(?i)$package\``, { maxLines: 500 })],
          transformations: [
            extractJson(['orgIdentifier'], { source: 'labels', replace: true }),
            { id: 'groupBy', options: { fields: { orgIdentifier: { aggregations: [], operation: 'groupby' } } } },
            organize({ renameByName: { orgIdentifier: 'Org' } }),
          ],
          links: orgHomeLink('Org'),
        }),
      ],
    },
    {
      row: 'Freshness and backups',
      panels: [
        silentOrgsTable,
        tablePanel('Orgs reporting in the last 36h', {
          datasource: DS_LOKI,
          gridPos: { w: 8, h: 9 },
          targets: [lokiTarget(`sum by (orgIdentifier) (count_over_time({${SRC}, $env, orgIdentifier=~"$org"}[36h]))`, { instant: true })],
          transformations: [
            organize({ excludeByName: { Time: true }, renameByName: { orgIdentifier: 'Org', Value: 'Notifications (36h)' } }),
          ],
          links: orgHomeLink('Org'),
          sortBy: [{ displayName: 'Notifications (36h)', desc: true }],
        }),
        backupFailuresTable,
      ],
    },
  ],
});

// Wire the "at a glance" stats to their detail panels (click a number -> see the list)
function linkStatToPanel(dash, statTitle, targetTitleStart, linkTitle = 'Show details') {
  const target = dash.panels.find((p) => p.type !== 'row' && p.type !== 'stat' && (p.title || '').startsWith(targetTitleStart));
  const stat = dash.panels.find((p) => p.type === 'stat' && (p.title || '') === statTitle);
  if (!stat || !target) {
    throw new Error(`linkStatToPanel: could not resolve "${statTitle}" -> "${targetTitleStart}" on ${dash.uid}`);
  }
  stat.fieldConfig.defaults.links = [{ title: linkTitle, url: `/d/${dash.uid}/?viewPanel=${target.id}&\${__all_variables}&\${__url_time_range}` }];
}
linkStatToPanel(fleetDashboard, 'Monitored orgs', 'Monitored orgs (click', 'Show all orgs');
linkStatToPanel(fleetDashboard, 'Fleet avg health score', 'Health sub-scores', 'Show scores by org');
linkStatToPanel(fleetDashboard, 'Apex + Flow errors (7d)', 'Monitored orgs (click', 'Show errors by org');
linkStatToPanel(fleetDashboard, 'Orgs reporting (36h)', 'Orgs reporting in the last 36h', 'Show reporting orgs');
linkStatToPanel(fleetDashboard, 'Avg Apex errors/day per org (7d)', 'Monitored orgs (click', 'Show averages by org');
linkStatToPanel(fleetDashboard, 'Avg Flow errors/day per org (7d)', 'Monitored orgs (click', 'Show averages by org');

// ===========================================================================
// 2. Org Home
// ===========================================================================

const deltaStat = (title, metric, opts = {}) =>
  statPanel(title, {
    sparkline: true,
    targets: [promTarget(promLast(metric))],
    thresholds: opts.thresholds || THRESHOLDS_COUNT,
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.unit ? { unit: opts.unit } : {}),
    ...(opts.gridPos ? { gridPos: opts.gridPos } : {}),
    ...(opts.links ? { links: opts.links } : {}),
  });

/** Stat showing a daily average of a metric over a period (metrics are daily samples) */
const avgStat = (title, metric, range, opts = {}) =>
  statPanel(title, {
    targets: [promTarget(promOverTime('avg_over_time', metric, range))],
    decimals: 1,
    thresholds: opts.thresholds || THRESHOLDS_COUNT,
    ...(opts.gridPos ? { gridPos: opts.gridPos } : {}),
    ...(opts.links ? { links: opts.links } : {}),
    ...(opts.description ? { description: opts.description } : {}),
  });

const orgHomeDashboard = dashboard({
  uid: 'sfdx-hardis-v2-org-home',
  title: '01 - Org Home',
  description: 'Single-org overview with health score, limits, activity, users, tests and security trends.',
  time: 'now-30d',
  variables: [orgVar()],
  sections: [
    {
      row: 'Health score (weekly)',
      panels: [
        statPanel('Org health score', {
          sparkline: true,
          gridPos: { w: 6, h: 7 },
          targets: [promTarget(promLast('HealthScore_metric', 'orgIdentifier="$org"', '8d'))],
          thresholds: THRESHOLDS_SCORE,
          description: 'Composite 0-100 score computed weekly from reliability, limits, security, tests and technical debt. ' + RECENT_CLI_NOTE,
          links: indicatorLink('MONITORING_SUMMARY'),
        }),
        bargaugePanel('Sub-scores', {
          gridPos: { w: 12, h: 7 },
          links: indicatorLink('MONITORING_SUMMARY'),
          targets: [
            promTarget(promLast('HealthScoreReliability_metric', 'orgIdentifier="$org"', '8d'), { legendFormat: 'Reliability' }),
            promTarget(promLast('HealthScoreLimits_metric', 'orgIdentifier="$org"', '8d'), { legendFormat: 'Limits', refId: 'B' }),
            promTarget(promLast('HealthScoreSecurity_metric', 'orgIdentifier="$org"', '8d'), { legendFormat: 'Security', refId: 'C' }),
            promTarget(promLast('HealthScoreTests_metric', 'orgIdentifier="$org"', '8d'), { legendFormat: 'Tests', refId: 'D' }),
            promTarget(promLast('HealthScoreDebt_metric', 'orgIdentifier="$org"', '8d'), { legendFormat: 'Debt', refId: 'E' }),
          ],
          description: RECENT_CLI_NOTE,
        }),
        statsDatePanel('ORG_LIMITS', { w: 6, h: 7 }),
      ],
    },
    {
      row: 'Org limits (click a gauge for details and forecasts)',
      panels: [
        gaugePanel('Data Storage', { targets: [promTarget(promLast('DataStorageMB_percent'))], links: detailLink('org-limits') }),
        gaugePanel('File Storage', { targets: [promTarget(promLast('FileStorageMB_percent'))], links: detailLink('org-limits') }),
        gaugePanel('Daily API Requests', { targets: [promTarget(promLast('DailyApiRequests_percent'))], links: detailLink('org-limits') }),
        gaugePanel('Daily Bulk API Batches', { targets: [promTarget(promLast('DailyBulkApiBatches_percent'))], links: detailLink('org-limits') }),
        gaugePanel('Daily Platform Events', { targets: [promTarget(promLast('DailyDeliveredPlatformEvents_percent'))], links: detailLink('org-limits') }),
        gaugePanel('Daily Async Apex', { targets: [promTarget(promLast('DailyAsyncApexExecutions_percent'))], links: detailLink('org-limits') }),
      ],
    },
    {
      row: 'Org activity (click a number for details)',
      panels: [
        deltaStat('Apex errors', 'ApexErrors_metric', { links: detailLink('org-reliability'), description: 'Apex errors found by the latest monitoring run. Click for details.' }),
        deltaStat('Flow errors', 'FlowErrors_metric', { links: detailLink('org-reliability'), description: 'Flow errors found by the latest monitoring run. Click for details.' }),
        avgStat('Apex avg/day (30d)', 'ApexErrors_metric', '30d', { links: detailLink('org-reliability') }),
        avgStat('Flow avg/day (30d)', 'FlowErrors_metric', '30d', { links: detailLink('org-reliability') }),
        deltaStat('Updated metadatas', 'UpdatedMetadatas_metric', { thresholds: THRESHOLDS_NONE, links: indicatorLink('BACKUP') }),
        deltaStat('Suspect actions', 'SuspectMetadataUpdates_metric', { links: detailLink('org-security'), description: 'Suspect setup actions from the audit trail. Click for details.' }),
        deltaStat('Legacy API calls', 'LegacyApiCalls_metric', { links: detailLink('org-security') }),
        deltaStat('Release updates', 'ReleaseUpdates_metric', { links: indicatorLink('RELEASE_UPDATES') }),
      ],
    },
    {
      row: 'Users and adoption (click a number for details)',
      panels: [
        deltaStat('Weekly CRM users', 'ACTIVE_USERS_CRM_WEEKLY_metric', { thresholds: THRESHOLDS_NONE, links: detailLink('org-adoption') }),
        deltaStat('Monthly portal users', 'ACTIVE_USERS_EXPERIENCE_MONTHLY_metric', { thresholds: THRESHOLDS_NONE, links: detailLink('org-adoption') }),
        deltaStat('Inactive CRM users (6m)', 'UNUSED_USERS_CRM_6_MONTHS_metric', { links: detailLink('org-adoption') }),
        deltaStat('Inactive portal users (6m)', 'UNUSED_USERS_EXPERIENCE_6_MONTHS_metric', { links: detailLink('org-adoption') }),
        deltaStat('Unused licenses', 'UnusedPermissionSetLicenses_metric', { links: detailLink('org-adoption') }),
      ],
    },
    {
      row: 'Tests and security (click a number for details)',
      panels: [
        statPanel('Apex code coverage', {
          sparkline: true,
          unit: 'percent',
          targets: [promTarget(promLast('ApexTestsCodeCoverage_metric'))],
          thresholds: thresholdSteps([[null, 'red'], [75, 'yellow'], [85, 'green']]),
          links: detailLink('org-debt'),
        }),
        deltaStat('Failing test classes', 'ApexTestsFailingClasses_metric', { links: indicatorLink('APEX_TESTS') }),
        statPanel('Security Health Check', {
          sparkline: true,
          targets: [promTarget(promLast('Score_metric'))],
          thresholds: THRESHOLDS_SCORE,
          links: detailLink('org-security'),
        }),
        deltaStat('Unsecured Connected Apps', 'UnsecuredConnectedApps_metric', { links: detailLink('org-security') }),
        deltaStat('MFA bypass users', 'MfaBypassUsers_metric', { links: detailLink('org-security') }),
      ],
    },
  ],
});

// ===========================================================================
// 3. Reliability (Apex & Flow errors)
// ===========================================================================

const reliabilityDashboard = dashboard({
  uid: 'sfdx-hardis-v2-org-reliability',
  title: '02 - Reliability (Apex & Flow errors)',
  description: 'Apex and Flow error trends, top failing automations and impacted users for one org.',
  time: 'now-30d',
  variables: [orgVar()],
  sections: [
    {
      row: 'Error trends',
      panels: [
        timeseriesPanel('Errors per day with 7d average', {
          gridPos: { w: 16, h: 9 },
          targets: [
            promTarget(promLast('ApexErrors_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'Apex errors' }),
            promTarget(promLast('FlowErrors_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'Flow errors', refId: 'B' }),
            promTarget(promOverTime('avg_over_time', 'ApexErrors_metric', '7d'), { legendFormat: 'Apex 7d avg', refId: 'C' }),
            promTarget(promOverTime('avg_over_time', 'FlowErrors_metric', '7d'), { legendFormat: 'Flow 7d avg', refId: 'D' }),
          ],
          links: [...indicatorLink('APEX_ERROR').map((l) => ({ ...l, title: 'Apex error details' })), ...indicatorLink('FLOW_ERROR').map((l) => ({ ...l, title: 'Flow error details' }))],
        }),
        statPanel('Errors this week vs last week', {
          gridPos: { w: 8, h: 9 },
          targets: [
            promTarget(
              `((sum(sum_over_time(ApexErrors_metric{${SRC}, orgIdentifier="$org"}[7d])) or vector(0)) + (sum(sum_over_time(FlowErrors_metric{${SRC}, orgIdentifier="$org"}[7d])) or vector(0))) - ((sum(sum_over_time(ApexErrors_metric{${SRC}, orgIdentifier="$org"}[7d] offset 7d)) or vector(0)) + (sum(sum_over_time(FlowErrors_metric{${SRC}, orgIdentifier="$org"}[7d] offset 7d)) or vector(0)))`
            ),
          ],
          thresholds: thresholdSteps([[null, 'green'], [1, 'orange'], [20, 'red']]),
          description: 'Positive = more errors than the previous 7 days.',
          links: [...indicatorLink('APEX_ERROR').map((l) => ({ ...l, title: 'Apex error details' })), ...indicatorLink('FLOW_ERROR').map((l) => ({ ...l, title: 'Flow error details' }))],
        }),
      ],
    },
    {
      row: 'Averages (click a number for details)',
      panels: [
        avgStat('Apex avg/day (7d)', 'ApexErrors_metric', '7d', { links: indicatorLink('APEX_ERROR') }),
        avgStat('Apex avg/day (30d)', 'ApexErrors_metric', '30d', { links: indicatorLink('APEX_ERROR') }),
        statPanel('Apex max/day (30d)', {
          targets: [promTarget(promOverTime('max_over_time', 'ApexErrors_metric', '30d'))],
          thresholds: THRESHOLDS_COUNT,
          links: indicatorLink('APEX_ERROR'),
        }),
        avgStat('Flow avg/day (7d)', 'FlowErrors_metric', '7d', { links: indicatorLink('FLOW_ERROR') }),
        avgStat('Flow avg/day (30d)', 'FlowErrors_metric', '30d', { links: indicatorLink('FLOW_ERROR') }),
        statPanel('Flow max/day (30d)', {
          targets: [promTarget(promOverTime('max_over_time', 'FlowErrors_metric', '30d'))],
          thresholds: THRESHOLDS_COUNT,
          links: indicatorLink('FLOW_ERROR'),
        }),
      ],
    },
    {
      row: 'Impact (click a number for details)',
      panels: [
        statPanel('Users impacted by Apex errors', {
          targets: [promTarget(promLast('ApexErrorsImpactedUsers_metric'))],
          thresholds: THRESHOLDS_COUNT,
          description: 'Distinct users hit by Apex errors in the last collection window. ' + RECENT_CLI_NOTE,
          links: indicatorLink('APEX_ERROR'),
        }),
        statPanel('Users impacted by Flow errors', {
          targets: [promTarget(promLast('FlowErrorsImpactedUsers_metric'))],
          thresholds: THRESHOLDS_COUNT,
          description: RECENT_CLI_NOTE,
          links: indicatorLink('FLOW_ERROR'),
        }),
        statPanel('Top failing Flow (errors)', {
          targets: [promTarget(promLast('TopFailingFlowCount_metric'))],
          thresholds: THRESHOLDS_COUNT,
          links: indicatorLink('FLOW_ERROR'),
        }),
        statPanel('Top failing Apex (errors)', {
          targets: [promTarget(promLast('TopFailingApexCount_metric'))],
          thresholds: THRESHOLDS_COUNT,
          description: RECENT_CLI_NOTE,
          links: indicatorLink('APEX_ERROR'),
        }),
      ],
    },
    {
      row: 'Top failing automations (latest run)',
      panels: [
        tablePanel('Top failing Flows', {
          datasource: DS_LOKI,
          gridPos: { w: 8, h: 9 },
          description: RECENT_CLI_NOTE,
          targets: [lokiTarget(`{${SRC}, type="FLOW_ERROR", orgIdentifier="$org"} |= \`\``, { maxLines: 1 })],
          transformations: jsonArrayToRows('topFailingFlows'),
        }),
        tablePanel('Top failing Flow steps', {
          datasource: DS_LOKI,
          gridPos: { w: 8, h: 9 },
          description: RECENT_CLI_NOTE,
          targets: [lokiTarget(`{${SRC}, type="FLOW_ERROR", orgIdentifier="$org"} |= \`\``, { maxLines: 1 })],
          transformations: jsonArrayToRows('topFailingSteps'),
        }),
        tablePanel('Top failing Apex', {
          datasource: DS_LOKI,
          gridPos: { w: 8, h: 9 },
          description: RECENT_CLI_NOTE,
          targets: [lokiTarget(`{${SRC}, type="APEX_ERROR", orgIdentifier="$org"} |= \`\``, { maxLines: 1 })],
          transformations: jsonArrayToRows('topFailingApex'),
        }),
      ],
    },
    {
      row: 'Latest error details',
      panels: [
        tablePanel('Latest Apex errors', {
          datasource: DS_LOKI,
          gridPos: { w: 12, h: 10 },
          targets: [lokiTarget(`{${SRC}, type="APEX_ERROR", orgIdentifier="$org"} |= \`\``, { maxLines: 1 })],
          transformations: jsonArrayToRows('_logElements'),
        }),
        tablePanel('Latest Flow errors', {
          datasource: DS_LOKI,
          gridPos: { w: 12, h: 10 },
          targets: [lokiTarget(`{${SRC}, type="FLOW_ERROR", orgIdentifier="$org"} |= \`\``, { maxLines: 1 })],
          transformations: jsonArrayToRows('_logElements'),
        }),
      ],
    },
  ],
});

// ===========================================================================
// 4. Limits & Capacity
// ===========================================================================

const KEY_LIMITS = [
  ['DataStorageMB', 'Data Storage'],
  ['FileStorageMB', 'File Storage'],
  ['DailyApiRequests', 'Daily API Requests'],
  ['DailyBulkApiBatches', 'Daily Bulk API Batches'],
  ['DailyAsyncApexExecutions', 'Daily Async Apex'],
  ['DailyDeliveredPlatformEvents', 'Daily Platform Events'],
];

// min by (orgIdentifier): if an org exposes several series (gitIdentifier rename),
// keep the soonest exhaustion forecast
const daysToLimitExpr = (metric) =>
  `min by (orgIdentifier) (clamp_max((100 - last_over_time(${metric}_percent{${SRC}, orgIdentifier="$org"}[2d])) / clamp_min(deriv(${metric}_percent{${SRC}, orgIdentifier="$org"}[30d]) * 86400, 0.000001), 99999))`;

const limitsDashboard = dashboard({
  uid: 'sfdx-hardis-v2-org-limits',
  title: '03 - Limits & Capacity',
  description: 'Current org limit usage, 90-day trends and linear forecasts of limit exhaustion.',
  time: 'now-90d',
  variables: [orgVar()],
  sections: [
    {
      row: 'Current usage',
      panels: [
        tablePanel('All limits', {
          gridPos: { w: 12, h: 12 },
          targets: [
            promTarget(
              // label_replace exposes the limit name without the _percent suffix as a
              // "limit" label: it must be clean in cell VALUES (renameByRegex only
              // renames column headers), because the row link appends _percent back
              // type="ORG_LIMITS" keeps this table scoped to org limits: other indicators
              // (e.g. USAGE_ENTITLEMENTS) also publish *_percent metrics.
              `label_replace(max by (__name__) (last_over_time({__name__=~".+_percent", ${SRC}, type="ORG_LIMITS", orgIdentifier="$org"}[2d])), "limit", "$1", "__name__", "(.+)_percent")`,
              { instant: true, format: 'table' }
            ),
          ],
          transformations: [
            organize({
              excludeByName: { Time: true, __name__: true },
              renameByName: { limit: 'Limit', Value: 'Used %' },
            }),
          ],
          unit: 'percent',
          thresholds: THRESHOLDS_PERCENT_USED,
          // Row-level link: open the detail of the clicked limit, not all limits
          links: [
            {
              title: 'Open limit evolution',
              url: `/d/sfdx-hardis-v2-dtl-indicator/?var-org=$org&var-type=ORG_LIMITS&var-metric=\${__data.fields.Limit}_percent&${DS_QUERYPARAMS}`,
            },
          ],
          custom: { cellOptions: { type: 'auto' } },
          overrides: [
            {
              matcher: { id: 'byName', options: 'Used %' },
              properties: [
                { id: 'custom.cellOptions', value: { type: 'gauge', mode: 'gradient', valueDisplayMode: 'text' } },
                { id: 'max', value: 100 },
                { id: 'min', value: 0 },
              ],
            },
          ],
          sortBy: [{ displayName: 'Used %', desc: true }],
        }),
        tablePanel('Days until limit is reached (30d linear trend)', {
          gridPos: { w: 12, h: 12 },
          description: 'Linear regression over the last 30 days. "No growth" means the limit is not trending toward exhaustion.',
          targets: KEY_LIMITS.map(([metric, label], idx) =>
            promTarget(daysToLimitExpr(metric), {
              instant: true,
              format: 'time_series',
              legendFormat: label,
              refId: String.fromCharCode(65 + idx),
            })
          ),
          transformations: [
            { id: 'reduce', options: { reducers: ['last'] } },
            organize({ renameByName: { Field: 'Limit', Last: 'Days until full' } }),
          ],
          unit: 'd',
          decimals: 0,
          thresholds: thresholdSteps([[null, 'red'], [30, 'orange'], [90, 'yellow'], [365, 'green']]),
          links: indicatorLink('ORG_LIMITS'),
          overrides: [
            {
              matcher: { id: 'byName', options: 'Days until full' },
              properties: [{ id: 'custom.cellOptions', value: { type: 'color-background' } }],
            },
          ],
          mappings: [
            { type: 'range', options: { from: -1e15, to: 0, result: { text: 'Limit exceeded', color: 'red', index: 0 } } },
            { type: 'range', options: { from: 3650, to: 1e15, result: { text: 'No growth', color: 'green', index: 1 } } },
          ],
          sortBy: [{ displayName: 'Days until full', desc: false }],
        }),
      ],
    },
    {
      row: 'Trends',
      panels: [
        timeseriesPanel('All limits (% used)', {
          gridPos: { w: 24, h: 10 },
          unit: 'percent',
          targets: [
            // type="ORG_LIMITS": other indicators also publish *_percent metrics
            promTarget(`max by (__name__) (last_over_time({__name__=~".+_percent", ${SRC}, type="ORG_LIMITS", orgIdentifier="$org"}[1d]))`, { legendFormat: '{{__name__}}' }),
          ],
          transformations: [{ id: 'renameByRegex', options: { regex: '(.*)_percent', renamePattern: '$1' } }],
          thresholds: thresholdSteps([[null, 'green'], [90, 'red']]),
          showThresholdLine: true,
          links: indicatorLink('ORG_LIMITS'),
        }),
      ],
    },
    {
      row: 'Storage focus',
      panels: [
        gaugePanel('Data Storage', { gridPos: { w: 4, h: 8 }, targets: [promTarget(promLast('DataStorageMB_percent'))], links: indicatorLink('ORG_LIMITS') }),
        timeseriesPanel('Data Storage evolution', {
          gridPos: { w: 8, h: 8 },
          unit: 'percent',
          targets: [promTarget(promLast('DataStorageMB_percent', 'orgIdentifier="$org"', '1d'), { legendFormat: 'Data storage %' })],
          links: indicatorLink('ORG_LIMITS'),
        }),
        gaugePanel('File Storage', { gridPos: { w: 4, h: 8 }, targets: [promTarget(promLast('FileStorageMB_percent'))], links: indicatorLink('ORG_LIMITS') }),
        timeseriesPanel('File Storage evolution', {
          gridPos: { w: 8, h: 8 },
          unit: 'percent',
          targets: [promTarget(promLast('FileStorageMB_percent', 'orgIdentifier="$org"', '1d'), { legendFormat: 'File storage %' })],
          links: indicatorLink('ORG_LIMITS'),
        }),
      ],
    },
  ],
});

// ===========================================================================
// 5. DevOps & DORA
// ===========================================================================

const devopsDashboard = dashboard({
  uid: 'sfdx-hardis-v2-org-devops',
  title: '04 - DevOps & DORA',
  description: 'Deployment activity, success rates and DORA metrics for one org.',
  time: 'now-90d',
  variables: [orgVar()],
  sections: [
    {
      row: 'Deployments (click a number for details)',
      panels: [
        statPanel('Deployments (period)', { targets: [promTarget(promLast('deploymentsTotal_metric', 'orgIdentifier="$org"', '35d'))], thresholds: THRESHOLDS_NONE, links: indicatorLink('DEPLOYMENTS') }),
        statPanel('Deployment success rate', {
          unit: 'percent',
          targets: [promTarget(promLast('deploymentSuccessRate_metric', 'orgIdentifier="$org"', '35d'))],
          thresholds: thresholdSteps([[null, 'red'], [70, 'orange'], [90, 'green']]),
          links: indicatorLink('DEPLOYMENTS'),
        }),
        statPanel('Avg deployment duration', {
          unit: 'm',
          targets: [promTarget(promLast('avgDeploymentMinutes_metric', 'orgIdentifier="$org"', '35d'))],
          thresholds: THRESHOLDS_NONE,
          links: indicatorLink('DEPLOYMENTS'),
        }),
        statPanel('Validation success rate', {
          unit: 'percent',
          targets: [promTarget(promLast('validationSuccessRate_metric', 'orgIdentifier="$org"', '35d'))],
          thresholds: thresholdSteps([[null, 'red'], [70, 'orange'], [90, 'green']]),
          links: indicatorLink('DEPLOYMENTS'),
        }),
      ],
    },
    {
      row: 'Deployment activity',
      panels: [
        timeseriesPanel('Deployments per week', {
          datasource: DS_LOKI,
          gridPos: { w: 12, h: 9 },
          targets: [lokiTarget(`sum(count_over_time({${SRC}, type="DEPLOYMENT", orgIdentifier="$org"}[7d]))`, { legendFormat: 'Deployments (7d rolling)' })],
          links: indicatorLink('DEPLOYMENT'),
        }),
        timeseriesPanel('Deployment duration', {
          gridPos: { w: 12, h: 9 },
          unit: 's',
          targets: [promTarget(promLast('DeploymentDurationSeconds_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'Duration (s)' })],
          links: indicatorLink('DEPLOYMENT'),
        }),
      ],
    },
    {
      row: 'Deployment impact (how much of the package really moved)',
      panels: [
        statPanel('Changed items', {
          gridPos: { w: 6, h: 7 },
          description:
            'Components the latest deployment created, updated or deleted in the org. A FULL deployment sends the whole package.xml, so the number of deployed items is the size of the project, not the size of the release. ' +
            RECENT_CLI_NOTE,
          targets: [promTarget(promLast('DeploymentComponentsChanged_metric', 'orgIdentifier="$org"', '7d'))],
          thresholds: THRESHOLDS_NONE,
          noValue: 'Requires a recent sfdx-hardis version',
          links: indicatorLink('DEPLOYMENT'),
        }),
        statPanel('Unchanged items', {
          gridPos: { w: 6, h: 7 },
          description:
            'Components the latest deployment sent to the org that were already identical to what was deployed. ' +
            RECENT_CLI_NOTE,
          targets: [promTarget(promLast('DeploymentComponentsUnchanged_metric', 'orgIdentifier="$org"', '7d'))],
          thresholds: THRESHOLDS_NONE,
          noValue: 'Requires a recent sfdx-hardis version',
          links: indicatorLink('DEPLOYMENT'),
        }),
        timeseriesPanel('Deployment impact over time', {
          gridPos: { w: 12, h: 7 },
          bars: true,
          stacked: true,
          description: 'Created, updated, deleted and unchanged components per deployment. ' + RECENT_CLI_NOTE,
          targets: [
            promTarget(promLast('DeploymentComponentsCreated_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'Created', refId: 'A' }),
            promTarget(promLast('DeploymentComponentsUpdated_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'Updated', refId: 'B' }),
            promTarget(promLast('DeploymentComponentsDeleted_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'Deleted', refId: 'C' }),
            promTarget(promLast('DeploymentComponentsUnchanged_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'Unchanged', refId: 'D' }),
          ],
          links: indicatorLink('DEPLOYMENT'),
        }),
      ],
    },
    {
      row: 'DORA metrics (requires scheduling hardis:doc:dora-report)',
      panels: [
        statPanel('Deployment frequency (per day)', {
          targets: [promTarget(promLast('DoraDeploymentFrequency_metric', 'orgIdentifier="$org"', '35d'))],
          thresholds: THRESHOLDS_NONE,
          noValue: 'Schedule dora-report',
          links: indicatorLink('DORA_REPORT'),
        }),
        statPanel('Lead time (median days)', {
          targets: [promTarget(promLast('DoraLeadTimeDays_metric', 'orgIdentifier="$org"', '35d'))],
          thresholds: thresholdSteps([[null, 'green'], [7, 'yellow'], [30, 'red']]),
          noValue: 'Schedule dora-report',
          links: indicatorLink('DORA_REPORT'),
        }),
        statPanel('Change failure rate', {
          unit: 'percent',
          targets: [promTarget(promLast('DoraChangeFailureRatePercent_metric', 'orgIdentifier="$org"', '35d'))],
          thresholds: thresholdSteps([[null, 'green'], [15, 'yellow'], [30, 'red']]),
          noValue: 'Schedule dora-report',
          links: indicatorLink('DORA_REPORT'),
        }),
        statPanel('MTTR (median hours)', {
          targets: [promTarget(promLast('DoraMttrHours_metric', 'orgIdentifier="$org"', '35d'))],
          thresholds: thresholdSteps([[null, 'green'], [24, 'yellow'], [168, 'red']]),
          noValue: 'Schedule dora-report',
          links: indicatorLink('DORA_REPORT'),
        }),
        statPanel('Rework rate', {
          unit: 'percent',
          targets: [promTarget(promLast('DoraReworkRatePercent_metric', 'orgIdentifier="$org"', '35d'))],
          thresholds: thresholdSteps([[null, 'green'], [10, 'yellow'], [25, 'red']]),
          noValue: 'Schedule dora-report',
          links: indicatorLink('DORA_REPORT'),
        }),
      ],
    },
    {
      row: 'Latest deployment details',
      panels: [
        tablePanel('Recent deployments', {
          datasource: DS_LOKI,
          gridPos: { w: 24, h: 10 },
          targets: [lokiTarget(`{${SRC}, type="DEPLOYMENT", orgIdentifier="$org"} |= \`\``, { maxLines: 30 })],
          transformations: [
            extractJson(['_title', '_dateTime', '_jobUrl'], { keepTime: false, replace: true }),
            { id: 'convertFieldType', options: { conversions: [{ destinationType: 'time', targetField: '_dateTime' }], fields: {} } },
            organize({ renameByName: { _title: 'Deployment', _dateTime: 'Date', _jobUrl: 'Job' } }),
          ],
        }),
      ],
    },
  ],
});

// ===========================================================================
// 6. Security Posture
// ===========================================================================

const securityDashboard = dashboard({
  uid: 'sfdx-hardis-v2-org-security',
  title: '05 - Security Posture',
  description: 'Security Health Check, audit trail, connected apps, MFA and legacy API trends for one org.',
  time: 'now-90d',
  variables: [orgVar()],
  sections: [
    {
      row: 'Security scores (click a number for details)',
      panels: [
        statPanel('Security Health Check score', {
          sparkline: true,
          gridPos: { w: 6, h: 7 },
          targets: [promTarget(promLast('Score_metric'))],
          thresholds: THRESHOLDS_SCORE,
          links: indicatorLink('ORG_HEALTH_CHECK'),
        }),
        timeseriesPanel('Health Check score evolution', {
          gridPos: { w: 12, h: 7 },
          targets: [
            promTarget(promLast('Score_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'Score' }),
            promTarget(promLast('HighRisk_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'High risks', refId: 'B' }),
            promTarget(promLast('MediumRisk_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'Medium risks', refId: 'C' }),
          ],
          links: indicatorLink('ORG_HEALTH_CHECK'),
        }),
        statsDatePanel('ORG_HEALTH_CHECK', { w: 6, h: 7 }),
      ],
    },
    {
      row: 'Findings (click a number for details)',
      panels: [
        deltaStat('Suspect setup actions', 'SuspectMetadataUpdates_metric', { gridPos: { w: 6, h: 5 }, links: indicatorLink('AUDIT_TRAIL') }),
        deltaStat('Unsecured Connected Apps', 'UnsecuredConnectedApps_metric', { gridPos: { w: 6, h: 5 }, links: indicatorLink('UNSECURED_CONNECTED_APPS') }),
        deltaStat('High-risk items', 'HighRisk_metric', { gridPos: { w: 6, h: 5 }, links: indicatorLink('ORG_HEALTH_CHECK') }),
        deltaStat('Legacy API calls', 'LegacyApiCalls_metric', { gridPos: { w: 6, h: 5 }, links: indicatorLink('LEGACY_API') }),
      ],
    },
    {
      row: 'MFA readiness (click a number for details)',
      panels: [
        deltaStat('Not passkey-ready', 'PrivilegedUsersNotPhishingResistant_metric', {
          gridPos: { w: 8, h: 5 },
          description: `Privileged users (Modify All Data, View All Data, Customize Application, Author Apex) whose latest MFA verification was not phishing-resistant. Salesforce blocks them at login once the phishing-resistant MFA enforcement wave reaches the org. ${RECENT_CLI_NOTE}`,
          links: indicatorLink('MFA_CONFIG'),
        }),
        deltaStat('MFA bypass users', 'MfaBypassUsers_metric', { gridPos: { w: 8, h: 5 }, links: indicatorLink('MFA_CONFIG') }),
        deltaStat('Non-MFA logins', 'NonMfaLogins_metric', { gridPos: { w: 8, h: 5 }, links: indicatorLink('MFA_CONFIG') }),
      ],
    },
    {
      row: 'Trends',
      panels: [
        timeseriesPanel('Suspect setup actions per day', {
          gridPos: { w: 12, h: 8 },
          targets: [promTarget(promLast('SuspectMetadataUpdates_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'Suspect actions' })],
          links: indicatorLink('AUDIT_TRAIL'),
        }),
        timeseriesPanel('Legacy API calls', {
          gridPos: { w: 12, h: 8 },
          targets: [promTarget(promLast('LegacyApiCalls_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'Legacy API calls' })],
          links: indicatorLink('LEGACY_API'),
        }),
      ],
    },
    {
      row: 'Latest audit trail entries',
      panels: [
        tablePanel('Suspect audit trail entries (latest run)', {
          datasource: DS_LOKI,
          gridPos: { w: 24, h: 10 },
          targets: [lokiTarget(`{${SRC}, type="AUDIT_TRAIL", orgIdentifier="$org"} |= \`\``, { maxLines: 1 })],
          transformations: jsonArrayToRows('_logElements'),
        }),
      ],
    },
  ],
});

// ===========================================================================
// 7. Technical Debt
// ===========================================================================

const debtDashboard = dashboard({
  uid: 'sfdx-hardis-v2-org-debt',
  title: '06 - Technical Debt',
  description: 'Technical debt burn-down: unused metadata, inactive automations, code coverage evolution.',
  time: 'now-180d',
  variables: [orgVar()],
  sections: [
    {
      row: 'Current debt (click a number for details)',
      panels: [
        deltaStat('Unused metadata', 'MetadatasNotUsed_metric', { links: indicatorLink('UNUSED_METADATAS') }),
        deltaStat('Unused Apex classes', 'unusedApexClasses_metric', { links: indicatorLink('UNUSED_APEX_CLASSES') }),
        deltaStat('Inactive Flows & VRs', 'InactiveMetadatas_metric', { links: indicatorLink('METADATA_STATUS') }),
        deltaStat('Items without description', 'MetadatasWithoutDescription_metric', { links: indicatorLink('MISSING_ATTRIBUTES') }),
        deltaStat('Items without access', 'ElementsWithNoProfileOrPermissionSetAccess_metric', { links: indicatorLink('LINT_ACCESS') }),
        deltaStat('Deprecated Apex', 'deprecatedApexTotal_metric', { links: indicatorLink('APEX_API_VERSION') }),
      ],
    },
    {
      row: 'Burn-down',
      panels: [
        timeseriesPanel('Technical debt evolution', {
          gridPos: { w: 24, h: 10 },
          targets: [
            promTarget(promLast('MetadatasNotUsed_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'Unused metadata' }),
            promTarget(promLast('unusedApexClasses_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'Unused Apex classes', refId: 'B' }),
            promTarget(promLast('InactiveMetadatas_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'Inactive Flows & VRs', refId: 'C' }),
            promTarget(promLast('MetadatasWithoutDescription_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'Without description', refId: 'D' }),
            promTarget(promLast('ElementsWithNoProfileOrPermissionSetAccess_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'Without access', refId: 'E' }),
          ],
          links: [
            ...indicatorLink('UNUSED_METADATAS').map((l) => ({ ...l, title: 'Unused metadata details' })),
            ...indicatorLink('UNUSED_APEX_CLASSES').map((l) => ({ ...l, title: 'Unused Apex details' })),
            ...indicatorLink('METADATA_STATUS').map((l) => ({ ...l, title: 'Inactive Flows & VRs details' })),
          ],
        }),
      ],
    },
    {
      row: 'Apex code coverage',
      panels: [
        statPanel('Current coverage', {
          gridPos: { w: 6, h: 8 },
          unit: 'percent',
          sparkline: true,
          targets: [promTarget(promLast('ApexTestsCodeCoverage_metric'))],
          thresholds: thresholdSteps([[null, 'red'], [75, 'yellow'], [85, 'green']]),
          links: indicatorLink('APEX_TESTS'),
        }),
        timeseriesPanel('Coverage evolution (75% threshold)', {
          gridPos: { w: 18, h: 8 },
          unit: 'percent',
          targets: [promTarget(promLast('ApexTestsCodeCoverage_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'Coverage' })],
          thresholds: thresholdSteps([[null, 'red'], [75, 'green']]),
          showThresholdLine: true,
          links: indicatorLink('APEX_TESTS'),
        }),
      ],
    },
    {
      row: 'Permission sets (click a number for details)',
      panels: [
        deltaStat('Underused permission sets', 'UnderusedPermissionSets_metric', { links: indicatorLink('UNDERUSED_PERMSETS') }),
        deltaStat('Zero-user permission sets', 'ZeroUserPermissionSets_metric', { links: indicatorLink('UNDERUSED_PERMSETS') }),
        deltaStat('Zero-user permission set groups', 'ZeroUserPermissionSetGroups_metric', { links: indicatorLink('UNDERUSED_PERMSETS') }),
        deltaStat('Unused PS licenses', 'UnusedPermissionSetLicenses_metric', { links: indicatorLink('UNUSED_LICENSES') }),
      ],
    },
  ],
});

// ===========================================================================
// 8. Adoption & Licenses
// ===========================================================================

const adoptionDashboard = dashboard({
  uid: 'sfdx-hardis-v2-org-adoption',
  title: '07 - Adoption & Licenses',
  description: 'User activity (aggregates only, no personal data) and license utilization for one org.',
  time: 'now-90d',
  variables: [orgVar()],
  sections: [
    {
      row: 'User activity (click a number for details)',
      panels: [
        statPanel('Weekly active CRM users', { sparkline: true, targets: [promTarget(promLast('ACTIVE_USERS_CRM_WEEKLY_metric'))], thresholds: THRESHOLDS_NONE, links: indicatorLink('ACTIVE_USERS_CRM_WEEKLY') }),
        statPanel('Monthly active portal users', { sparkline: true, targets: [promTarget(promLast('ACTIVE_USERS_EXPERIENCE_MONTHLY_metric'))], thresholds: THRESHOLDS_NONE, links: indicatorLink('ACTIVE_USERS_EXPERIENCE_MONTHLY') }),
        deltaStat('Inactive CRM users (6m)', 'UNUSED_USERS_CRM_6_MONTHS_metric', { links: indicatorLink('UNUSED_USERS_CRM_6_MONTHS') }),
        deltaStat('Inactive portal users (6m)', 'UNUSED_USERS_EXPERIENCE_6_MONTHS_metric', { links: indicatorLink('UNUSED_USERS_EXPERIENCE_6_MONTHS') }),
      ],
    },
    {
      row: 'Activity trends',
      panels: [
        timeseriesPanel('Active users evolution', {
          gridPos: { w: 12, h: 9 },
          targets: [
            promTarget(promLast('ACTIVE_USERS_CRM_WEEKLY_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'Weekly CRM users' }),
            promTarget(promLast('ACTIVE_USERS_EXPERIENCE_MONTHLY_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'Monthly portal users', refId: 'B' }),
          ],
          links: indicatorLink('ACTIVE_USERS_CRM_WEEKLY'),
        }),
        timeseriesPanel('Inactive users evolution', {
          gridPos: { w: 12, h: 9 },
          targets: [
            promTarget(promLast('UNUSED_USERS_CRM_6_MONTHS_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'Inactive CRM users' }),
            promTarget(promLast('UNUSED_USERS_EXPERIENCE_6_MONTHS_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'Inactive portal users', refId: 'B' }),
          ],
          links: indicatorLink('UNUSED_USERS_CRM_6_MONTHS'),
        }),
      ],
    },
    {
      row: 'Licenses (latest run)',
      panels: [
        tablePanel('License usage', {
          datasource: DS_LOKI,
          gridPos: { w: 16, h: 10 },
          targets: [lokiTarget(`{${SRC}, type="LICENSES", orgIdentifier="$org"} |= \`\``, { maxLines: 1 })],
          transformations: jsonArrayToRows('_logElements'),
        }),
        statsDatePanel('LICENSES', { w: 8, h: 5 }),
      ],
    },
  ],
});

// ===========================================================================
// 9. Indicator Detail (generic drill-down)
// ===========================================================================

const dtlIndicatorDashboard = dashboard({
  uid: 'sfdx-hardis-v2-dtl-indicator',
  title: '80 - Indicator Detail',
  description: 'Generic drill-down for any sfdx-hardis indicator: pick the org, the notification type and the exact metric to see its value, its evolution and the detailed rows.',
  time: 'now-30d',
  variables: [
    orgVar(),
    {
      name: 'type',
      label: 'Indicator',
      type: 'query',
      datasource: DS_LOKI,
      // Scoped to the selected org so only indicators with data are offered
      query: { label: 'type', refId: 'LokiVariableQueryEditor-VariableQuery', stream: `{${SRC}, orgIdentifier="$org"}`, type: 1 },
      current: {},
      hide: 0,
      includeAll: false,
      multi: false,
      options: [],
      refresh: 2,
      regex: '',
      skipUrlSync: false,
      sort: 1,
    },
    {
      // The exact Prometheus series to display. Links from other dashboards pass it
      // (var-metric=...) so the landing page shows the same number that was clicked.
      name: 'metric',
      label: 'Metric',
      type: 'query',
      datasource: DS_PROM,
      definition: `label_values({${SRC}, type="$type", orgIdentifier="$org"}, __name__)`,
      query: { qryType: 1, query: `label_values({${SRC}, type="$type", orgIdentifier="$org"}, __name__)`, refId: 'PrometheusVariableQueryEditor-VariableQuery' },
      current: {},
      hide: 0,
      includeAll: false,
      multi: false,
      options: [],
      refresh: 2,
      regex: '/^(?!.*_max$).*/',
      skipUrlSync: false,
      sort: 1,
    },
  ],
  sections: [
    {
      row: '$metric ($type) on $org',
      panels: [
        statPanel('Latest value', {
          sparkline: true,
          gridPos: { w: 5, h: 7 },
          targets: [promTarget(`max by (orgIdentifier) (last_over_time(\${metric}{${SRC}, orgIdentifier="$org"}[8d]))`)],
          thresholds: THRESHOLDS_NONE,
        }),
        timeseriesPanel('Evolution', {
          gridPos: { w: 14, h: 7 },
          targets: [promTarget(`max by (orgIdentifier) (last_over_time(\${metric}{${SRC}, orgIdentifier="$org"}[1d]))`, { legendFormat: '$metric' })],
        }),
        statsDatePanel('$type', { w: 5, h: 7 }),
      ],
    },
    {
      panels: [
        tablePanel('Detailed elements (latest run)', {
          datasource: DS_LOKI,
          gridPos: { w: 24, h: 14 },
          description:
            'Rows of the latest run found within the selected time range. Detail rows come from logs (Loki), which usually keep ~30 days: if the graph shows history but this table is empty, the last run is older than the logs retention. Check the org monitoring job.',
          targets: [lokiTarget(`{${SRC}, type="$type", orgIdentifier="$org"} |= \`\``, { maxLines: 1 })],
          transformations: jsonArrayToRows('_logElements'),
        }),
      ],
    },
  ],
});

// ===========================================================================
// 10-12. Search dashboards
// ===========================================================================

const searchOrgDashboard = dashboard({
  uid: 'sfdx-hardis-v2-search-org',
  title: '90 - Search: Org',
  description: 'Find a monitored org by any identifier fragment (org id, instance, domain).',
  time: 'now-30d',
  variables: [envVar(), textboxVar('orgId', 'Org identifier', 'Any fragment of the org id / instance / domain', '')],
  sections: [
    {
      panels: [
        tablePanel('Matching orgs', {
          datasource: DS_LOKI,
          gridPos: { w: 24, h: 14 },
          targets: [
            lokiTarget(
              `{${SRC}, type="ORG_INFO", $env} |~ \`(?i)$orgId\` ` +
              '| json orgName="_logElements[0].Name", orgSfId="_logElements[0].Id", country="_logElements[0].Country"',
              { maxLines: 1000 }
            ),
          ],
          transformations: [
            extractJson(['orgIdentifier', 'orgName', 'orgSfId', 'country'], { source: 'labels', replace: true }),
            {
              id: 'groupBy',
              options: {
                fields: {
                  orgIdentifier: { aggregations: [], operation: 'groupby' },
                  orgName: { aggregations: [], operation: 'groupby' },
                  orgSfId: { aggregations: [], operation: 'groupby' },
                  country: { aggregations: [], operation: 'groupby' },
                },
              },
            },
            organize({
              renameByName: { orgIdentifier: 'Org', orgName: 'Organization name', orgSfId: 'Org Id', country: 'Country' },
              indexByName: { orgIdentifier: 0, orgName: 1, orgSfId: 2, country: 3 },
            }),
          ],
          links: orgHomeLink('Org'),
        }),
      ],
    },
  ],
});

// The line_format stages turn each matching Loki line into the list of matched item
// names: regexReplaceAll replaces every `"<Key>":"<match>"` occurrence with `<match> ¦ `,
// then the second stage drops the JSON tail after the last match. The leading line filter
// guarantees at least one match so no unprocessed JSON line ever reaches the table.
const searchLicensesDashboard = dashboard({
  uid: 'sfdx-hardis-v2-search-licenses',
  title: '91 - Search: Licenses',
  description: 'Find which monitored orgs hold a given license.',
  time: 'now-30d',
  variables: [envVar(), textboxVar('license', 'License', 'License name fragment (e.g. Sales Cloud)', '')],
  sections: [
    {
      panels: [
        tablePanel('Orgs holding license "$license"', {
          datasource: DS_LOKI,
          gridPos: { w: 24, h: 14 },
          description: 'Click a row to open the Adoption & Licenses dashboard of the org.',
          targets: [
            lokiTarget(
              `{${SRC}, type="LICENSES", $env} ` +
              '|~ `"MasterLabel":"[^"]*(?i:$license)` ' +
              '| line_format `{{ regexReplaceAll "(?s).*?\\"MasterLabel\\":\\"([^\\"]*(?i:$license)[^\\"]*)\\"" __line__ "$1 ¦ " }}` ' +
              '| line_format `{{ regexReplaceAll "(?s) ¦ [^¦]*$" __line__ "" }}`',
              { maxLines: 1000 }
            ),
          ],
          transformations: [
            extractJson(['orgIdentifier'], { source: 'labels', replace: false }),
            {
              id: 'groupBy',
              options: {
                fields: {
                  orgIdentifier: { aggregations: [], operation: 'groupby' },
                  Line: { aggregations: [], operation: 'groupby' },
                },
              },
            },
            organize({
              renameByName: { orgIdentifier: 'Org', Line: 'Matching licenses' },
              indexByName: { orgIdentifier: 0, Line: 1 },
            }),
          ],
          links: orgRowLink('org-adoption', 'Open Adoption & Licenses', 'Org'),
        }),
      ],
    },
  ],
});

const searchPackagesDashboard = dashboard({
  uid: 'sfdx-hardis-v2-search-packages',
  title: '92 - Search: Packages',
  description: 'Find which monitored orgs have a given installed package.',
  time: 'now-30d',
  variables: [envVar(), textboxVar('package', 'Package', 'Installed package name fragment', '')],
  sections: [
    {
      panels: [
        tablePanel('Orgs with package "$package"', {
          datasource: DS_LOKI,
          gridPos: { w: 24, h: 14 },
          description: 'Click a row to open the org dashboard.',
          targets: [
            lokiTarget(
              `{${SRC}, type="BACKUP", $env} ` +
              '|~ `"SubscriberPackageName":"[^"]*(?i:$package)` ' +
              '| line_format `{{ regexReplaceAll "(?s).*?\\"SubscriberPackageName\\":\\"([^\\"]*(?i:$package)[^\\"]*)\\",\\"SubscriberPackageNamespace\\":\\"[^\\"]*\\",\\"SubscriberPackageVersionId\\":\\"[^\\"]*\\",\\"SubscriberPackageVersionName\\":\\"[^\\"]*\\",\\"SubscriberPackageVersionNumber\\":\\"([^\\"]*)\\"" __line__ "$1 (v$2) ¦ " }}` ' +
              '| line_format `{{ regexReplaceAll "(?s) ¦ [^¦]*$" __line__ "" }}`',
              { maxLines: 1000 }
            ),
          ],
          transformations: [
            extractJson(['orgIdentifier'], { source: 'labels', replace: false }),
            {
              id: 'groupBy',
              options: {
                fields: {
                  orgIdentifier: { aggregations: [], operation: 'groupby' },
                  Line: { aggregations: [], operation: 'groupby' },
                },
              },
            },
            organize({
              renameByName: { orgIdentifier: 'Org', Line: 'Matching packages (version)' },
              indexByName: { orgIdentifier: 0, Line: 1 },
            }),
          ],
          links: orgHomeLink('Org'),
        }),
      ],
    },
  ],
});

// ===========================================================================
// 8. Usage & Cost
// ===========================================================================

// Consumption-billed products: contractual meters (USAGE_ENTITLEMENTS), the utilization alerts
// Salesforce raises itself (CONSUMPTION_ALERTS) and Agentforce / Data 360 credits (AI_USAGE).
// Distinct from "03 - Limits & Capacity", which tracks daily/hourly throttling rather than billing.
const USAGE_NOTE =
  'Usage-based entitlements are what Salesforce bills on, unlike org limits which throttle. ' +
  RECENT_CLI_NOTE;

// Salesforce exposes no prices through any API, so costs are computed from rates declared in
// .sfdx-hardis.yml. They are estimates, not invoices, and are empty until rates are configured.
const COST_NOTE =
  'Estimate computed from the rates configured in usageCost, not a figure published by Salesforce. ' +
  RECENT_CLI_NOTE;

const usageDashboard = dashboard({
  uid: 'sfdx-hardis-v2-org-usage',
  title: '08 - Usage & Cost',
  description:
    'Agentforce and Data 360 credit consumption first, then the contractual usage-based entitlements: consumption against allowance, projected end-of-period overage and utilization alerts.',
  time: 'now-90d',
  variables: [orgVar()],
  sections: [
    {
      row: 'Agentforce & Data 360 credits',
      panels: [
        statPanel('AI credits', {
          gridPos: { w: 6, h: 7 },
          sparkline: true,
          description: 'Generative AI credits consumed over the reported window. Requires Data 360. ' + RECENT_CLI_NOTE,
          targets: [promTarget(promLast('AiUsageCreditsTotal_metric'))],
          thresholds: THRESHOLDS_NONE,
          noValue: 'Requires Data 360',
          links: indicatorLink('AI_USAGE'),
        }),
        statPanel('Metered credits', {
          gridPos: { w: 6, h: 7 },
          sparkline: true,
          description: 'Share of AI credits that is billed. Requires Data 360. ' + RECENT_CLI_NOTE,
          targets: [promTarget(promLast('AiUsageCreditsMetered_metric'))],
          thresholds: THRESHOLDS_NONE,
          noValue: 'Requires Data 360',
          links: indicatorLink('AI_USAGE'),
        }),
        statPanel('AI actions', {
          gridPos: { w: 6, h: 7 },
          sparkline: true,
          description: 'Number of billed agent actions over the reported window. Requires Data 360. ' + RECENT_CLI_NOTE,
          targets: [promTarget(promLast('AiUsageActions_metric'))],
          thresholds: THRESHOLDS_NONE,
          noValue: 'Requires Data 360',
          links: indicatorLink('AI_USAGE'),
        }),
        statPanel('Data 360 credits', {
          gridPos: { w: 6, h: 7 },
          sparkline: true,
          description: 'Data 360 credits consumed over the reported window. Requires Data 360. ' + RECENT_CLI_NOTE,
          targets: [promTarget(promLast('DataCloudCreditsTotal_metric'))],
          thresholds: THRESHOLDS_NONE,
          noValue: 'Requires Data 360',
          links: indicatorLink('AI_USAGE'),
        }),
        timeseriesPanel('Credit consumption evolution', {
          gridPos: { w: 24, h: 9 },
          fillOpacity: 22,
          description: 'Agentforce and Data 360 credit consumption over time. Requires Data 360. ' + RECENT_CLI_NOTE,
          targets: [
            promTarget(promLast('AiUsageCreditsTotal_metric', 'orgIdentifier="$org"', '1d'), { legendFormat: 'AI credits' }),
            promTarget(promLast('DataCloudCreditsTotal_metric', 'orgIdentifier="$org"', '1d'), {
              legendFormat: 'Data 360 credits',
              refId: 'B',
            }),
          ],
          links: indicatorLink('AI_USAGE'),
        }),
      ],
    },
    {
      // Digital Wallet consumption cards (Data 360 Segmentation & Activation, Platform
      // Services, ...). Salesforce publishes only the threshold crossings, never the card
      // balance, so these are step values: "has passed 75%", not "is at 78%".
      row: 'Consumption cards (Data 360 & platform)',
      panels: [
        statPanel('Cards in alert', {
          gridPos: { w: 6, h: 5 },
          description:
            'Distinct consumption cards for which Salesforce raised a utilization alert. ' + RECENT_CLI_NOTE,
          targets: [promTarget(promLast('ConsumptionAlertsScopes_metric'))],
          thresholds: THRESHOLDS_COUNT,
          noValue: 'Run consumption-alerts',
          links: indicatorLink('CONSUMPTION_ALERTS'),
        }),
        gaugePanel('Highest alert', {
          gridPos: { w: 6, h: 5 },
          description:
            'Highest consumption threshold Salesforce has flagged across every card. ' + RECENT_CLI_NOTE,
          targets: [promTarget(promLast('ConsumptionAlertsMaxThreshold_metric'))],
          noValue: 'Run consumption-alerts',
          links: indicatorLink('CONSUMPTION_ALERTS'),
        }),
        tablePanel('Consumption card thresholds', {
          gridPos: { w: 12, h: 8 },
          description:
            'Highest consumption threshold Salesforce has flagged on each Digital Wallet card. ' +
            'Salesforce exposes threshold crossings only, so a card reading 75% has passed 75%, not necessarily reached 78%. ' +
            RECENT_CLI_NOTE,
          targets: [
            promTarget(
              `label_replace(max by (__name__) (last_over_time({__name__=~"ConsumptionAlertPct_.+", ${SRC}, type="CONSUMPTION_ALERTS", orgIdentifier="$org"}[2d])), "card", "$1", "__name__", "ConsumptionAlertPct_(.+)_metric")`,
              { instant: true, format: 'table' }
            ),
          ],
          transformations: [
            organize({
              excludeByName: { Time: true, __name__: true },
              renameByName: { card: 'Consumption card', Value: 'Threshold reached %' },
            }),
          ],
          unit: 'percent',
          decimals: 0,
          thresholds: thresholdSteps([[null, 'green'], [50, 'yellow'], [75, 'orange'], [90, 'red']]),
          links: indicatorLink('CONSUMPTION_ALERTS'),
          overrides: [
            {
              matcher: { id: 'byName', options: 'Threshold reached %' },
              properties: [{ id: 'custom.cellOptions', value: { type: 'color-background' } }],
            },
          ],
          sortBy: [{ displayName: 'Threshold reached %', desc: true }],
        }),
        timeseriesPanel('Consumption card evolution', {
          gridPos: { w: 12, h: 8 },
          unit: 'percent',
          description: 'How each consumption card has climbed through its thresholds over time. ' + RECENT_CLI_NOTE,
          targets: [
            promTarget(
              `max by (__name__) (last_over_time({__name__=~"ConsumptionAlertPct_.+", ${SRC}, type="CONSUMPTION_ALERTS", orgIdentifier="$org"}[1d]))`,
              { legendFormat: '{{__name__}}' }
            ),
          ],
          transformations: [
            { id: 'renameByRegex', options: { regex: 'ConsumptionAlertPct_(.*)_metric', renamePattern: '$1' } },
          ],
          links: indicatorLink('CONSUMPTION_ALERTS'),
        }),
      ],
    },
    {
      row: 'Usage-based entitlements',
      panels: [
        // Leads with money already being spent, not with a forecast: on a real org several
        // entitlements sit past 100% at any time and that is the number to act on.
        statPanel('Over allowance', {
          gridPos: { w: 6, h: 5 },
          description:
            'Entitlements whose paid allowance is already fully consumed, so overage is accruing now. ' +
            USAGE_NOTE,
          targets: [promTarget(promLast('UsageEntitlementsOverAllowance_metric'))],
          thresholds: THRESHOLDS_COUNT,
          noValue: 'Run usage-entitlements',
          links: indicatorLink('USAGE_ENTITLEMENTS'),
        }),
        gaugePanel('Worst consumption', {
          gridPos: { w: 6, h: 5 },
          description: 'Highest share of any single allowance consumed this period. ' + USAGE_NOTE,
          targets: [promTarget(promLast('UsageEntitlementsWorstPercent_metric'))],
          max: 200,
          noValue: 'Run usage-entitlements',
          links: indicatorLink('USAGE_ENTITLEMENTS'),
        }),
        statPanel('Entitlements at risk', {
          gridPos: { w: 6, h: 5 },
          description:
            'Entitlements over allowance or on track to exceed it before the period ends. ' + USAGE_NOTE,
          targets: [promTarget(promLast('UsageEntitlementsAtRisk_metric'))],
          thresholds: THRESHOLDS_COUNT,
          noValue: 'Run usage-entitlements',
          links: indicatorLink('USAGE_ENTITLEMENTS'),
        }),
        avgStat('At risk avg (30d)', 'UsageEntitlementsAtRisk_metric', '30d', {
          gridPos: { w: 6, h: 5 },
          description: 'Average number of entitlements at risk over 30 days. ' + RECENT_CLI_NOTE,
          links: indicatorLink('USAGE_ENTITLEMENTS'),
        }),
        // Salesforce leaves every crossed threshold active, so the raw alert count double
        // counts one card. Scopes is the honest number.
      ],
    },
    {
      row: 'Consumption vs allowance',
      panels: [
        tablePanel('Entitlement consumption', {
          gridPos: { w: 12, h: 12 },
          description: 'Share of each purchased allowance already consumed in the current period. ' + USAGE_NOTE,
          targets: [
            promTarget(
              `label_replace(max by (__name__) (last_over_time({__name__=~"UsageEnt_.+_percent", ${SRC}, type="USAGE_ENTITLEMENTS", orgIdentifier="$org"}[2d])), "resource", "$1", "__name__", "UsageEnt_(.+)_percent")`,
              { instant: true, format: 'table' }
            ),
          ],
          transformations: [
            organize({
              excludeByName: { Time: true, __name__: true },
              renameByName: { resource: 'Resource', Value: 'Consumed %' },
            }),
          ],
          unit: 'percent',
          thresholds: THRESHOLDS_PERCENT_USED,
          links: [
            {
              title: 'Open entitlement evolution',
              url: `/d/sfdx-hardis-v2-dtl-indicator/?var-org=$org&var-type=USAGE_ENTITLEMENTS&var-metric=UsageEnt_\${__data.fields.Resource}_percent&${DS_QUERYPARAMS}`,
            },
          ],
          custom: { cellOptions: { type: 'auto' } },
          overrides: [
            {
              matcher: { id: 'byName', options: 'Consumed %' },
              properties: [
                { id: 'custom.cellOptions', value: { type: 'gauge', mode: 'gradient', valueDisplayMode: 'text' } },
                { id: 'max', value: 100 },
                { id: 'min', value: 0 },
              ],
            },
          ],
          sortBy: [{ displayName: 'Consumed %', desc: true }],
        }),
        tablePanel('Projected consumption at period end', {
          gridPos: { w: 12, h: 12 },
          description:
            'Consumption projected to the end of the billing period, from the share consumed versus the share of the period elapsed. Above 100% means the allowance is on track to be exceeded. ' +
            USAGE_NOTE,
          targets: [
            promTarget(
              `label_replace(max by (__name__) (last_over_time({__name__=~"UsageEntProjected_.+_metric", ${SRC}, type="USAGE_ENTITLEMENTS", orgIdentifier="$org"}[2d])), "resource", "$1", "__name__", "UsageEntProjected_(.+)_metric")`,
              { instant: true, format: 'table' }
            ),
          ],
          transformations: [
            organize({
              excludeByName: { Time: true, __name__: true },
              renameByName: { resource: 'Resource', Value: 'Projected %' },
            }),
          ],
          unit: 'percent',
          decimals: 0,
          thresholds: thresholdSteps([[null, 'green'], [100, 'yellow'], [120, 'orange'], [150, 'red']]),
          links: indicatorLink('USAGE_ENTITLEMENTS'),
          overrides: [
            {
              matcher: { id: 'byName', options: 'Projected %' },
              properties: [{ id: 'custom.cellOptions', value: { type: 'color-background' } }],
            },
          ],
          sortBy: [{ displayName: 'Projected %', desc: true }],
        }),
      ],
    },
    {
      row: 'Trends',
      panels: [
        timeseriesPanel('Entitlement consumption (% used)', {
          gridPos: { w: 24, h: 10 },
          unit: 'percent',
          description: 'Consumption of every metered entitlement over time. ' + USAGE_NOTE,
          targets: [
            promTarget(
              `max by (__name__) (last_over_time({__name__=~"UsageEnt_.+_percent", ${SRC}, type="USAGE_ENTITLEMENTS", orgIdentifier="$org"}[1d]))`,
              { legendFormat: '{{__name__}}' }
            ),
          ],
          transformations: [
            { id: 'renameByRegex', options: { regex: 'UsageEnt_(.*)_percent', renamePattern: '$1' } },
          ],
          thresholds: thresholdSteps([[null, 'green'], [90, 'red']]),
          showThresholdLine: true,
          links: indicatorLink('USAGE_ENTITLEMENTS'),
        }),
      ],
    },
    {
      // Cost is an estimate built from rates the user configures: Salesforce publishes no
      // prices through any API. Panels stay empty until usageCost is set up, and the unit is
      // deliberately generic because the currency is per-org configuration.
      row: 'Estimated cost',
      panels: [
        statPanel('Overage cost', {
          gridPos: { w: 5, h: 5 },
          description:
            'Estimated cost of consumption beyond purchased allowances, in the currency configured for the org. ' +
            COST_NOTE,
          targets: [promTarget(promLast('UsageEntitlementsCost_metric'))],
          decimals: 2,
          thresholds: THRESHOLDS_NONE,
          noValue: 'Set usageCost rates',
          links: indicatorLink('USAGE_ENTITLEMENTS'),
        }),
        statPanel('AI credit cost', {
          gridPos: { w: 5, h: 5 },
          description:
            'Estimated cost of billed Agentforce and Data 360 credits, in the currency configured for the org. ' +
            COST_NOTE,
          targets: [promTarget(promLast('AiUsageCost_metric'))],
          decimals: 2,
          thresholds: THRESHOLDS_NONE,
          noValue: 'Set usageCost rates',
          links: indicatorLink('AI_USAGE'),
        }),
        avgStat('Overage avg (30d)', 'UsageEntitlementsCost_metric', '30d', {
          gridPos: { w: 5, h: 5 },
          description: 'Average estimated overage cost over 30 days. ' + COST_NOTE,
          thresholds: THRESHOLDS_NONE,
          links: indicatorLink('USAGE_ENTITLEMENTS'),
        }),
        timeseriesPanel('Estimated cost evolution', {
          gridPos: { w: 9, h: 5 },
          decimals: 2,
          description: 'Estimated overage and AI credit cost over time. ' + COST_NOTE,
          targets: [
            promTarget(promLast('UsageEntitlementsCost_metric', 'orgIdentifier="$org"', '1d'), {
              legendFormat: 'Entitlement overage',
            }),
            promTarget(promLast('AiUsageCost_metric', 'orgIdentifier="$org"', '1d'), {
              legendFormat: 'AI credits',
              refId: 'B',
            }),
          ],
          links: indicatorLink('USAGE_ENTITLEMENTS'),
        }),
      ],
    },
    {
      row: 'Details',
      panels: [
        tablePanel('Entitlements detail (latest run)', {
          gridPos: { w: 24, h: 12 },
          description:
            'Every usage-based entitlement of the latest run, including resources Salesforce reports no consumption for. ' +
            USAGE_NOTE,
          datasource: DS_LOKI,
          targets: [
            lokiTarget(`{${SRC}, type="USAGE_ENTITLEMENTS", orgIdentifier="$org"} |= \`\``, { maxLines: 1 }),
          ],
          transformations: [
            ...jsonArrayToRows('_logElements'),
            organize({
              includeByName: {
                label: true,
                settingKey: true,
                amountUsed: true,
                amountAllowed: true,
                percentUsed: true,
                percentPeriodElapsed: true,
                projectedPercent: true,
                daysRemaining: true,
                frequency: true,
                status: true,
                severity: true,
                estimatedCost: true,
              },
              renameByName: {
                label: 'Entitlement',
                settingKey: 'Resource',
                amountUsed: 'Used',
                amountAllowed: 'Allowance',
                percentUsed: 'Consumed %',
                percentPeriodElapsed: 'Period elapsed %',
                projectedPercent: 'Projected %',
                daysRemaining: 'Days left',
                frequency: 'Frequency',
                status: 'Status',
                severity: 'Severity',
                estimatedCost: 'Est. cost',
              },
            }),
          ],
        }),
        tablePanel('Active utilization alerts (latest run)', {
          gridPos: { w: 24, h: 8 },
          description: 'Consumption and license utilization alerts Salesforce raised on the org. ' + RECENT_CLI_NOTE,
          datasource: DS_LOKI,
          targets: [
            lokiTarget(`{${SRC}, type="CONSUMPTION_ALERTS", orgIdentifier="$org"} |= \`\``, { maxLines: 1 }),
          ],
          transformations: [
            ...jsonArrayToRows('_logElements'),
            organize({
              includeByName: {
                alertType: true,
                alertScope: true,
                alertSubScope1: true,
                triggerValue: true,
                triggerType: true,
                alertTimestamp: true,
              },
              renameByName: {
                alertType: 'Alert type',
                alertScope: 'Scope',
                alertSubScope1: 'Sub scope',
                triggerValue: 'Trigger value',
                triggerType: 'Trigger type',
                alertTimestamp: 'Raised at',
              },
            }),
          ],
        }),
      ],
    },
    {
      // Last: run metadata, not an indicator. It belongs after the content, not between
      // the summary row and the detail tables.
      row: 'Freshness',
      panels: [statsDatePanel('USAGE_ENTITLEMENTS', { w: 6, h: 5 })],
    },
  ],
});

// ===========================================================================
// Post-pass: make Indicator Detail links metric-aware
// ===========================================================================
// When a stat/gauge shows a single Prometheus series and links to the Indicator
// Detail dashboard, pass the exact metric name (var-metric=...) so the landing
// page shows the same number that was clicked, not the type's default metric.
function addMetricToIndicatorLinks(dash) {
  for (const panel of dash.panels || []) {
    if (!['stat', 'gauge', 'timeseries'].includes(panel.type)) {
      continue;
    }
    const promTargets = (panel.targets || []).filter((t) => t.datasource?.uid === '${ds_prom}');
    if (promTargets.length !== 1) {
      continue;
    }
    const metricMatch = promTargets[0].expr.match(/([A-Za-z][A-Za-z0-9_]*(?:_metric|_percent))\s*\{/);
    if (!metricMatch) {
      continue;
    }
    // Only when the panel has a single Indicator Detail link: with several links
    // (e.g. Apex + Flow), one metric name cannot be right for all of them
    const dtlLinks = (panel.fieldConfig?.defaults?.links || []).filter(
      (link) => link.url.includes('sfdx-hardis-v2-dtl-indicator') && !link.url.includes('var-metric=')
    );
    if (dtlLinks.length === 1) {
      dtlLinks[0].url += `&var-metric=${metricMatch[1]}`;
    }
  }
}

// ===========================================================================
// Write files
// ===========================================================================

const dashboards = [
  fleetDashboard,
  orgHomeDashboard,
  reliabilityDashboard,
  limitsDashboard,
  devopsDashboard,
  securityDashboard,
  debtDashboard,
  adoptionDashboard,
  usageDashboard,
  dtlIndicatorDashboard,
  searchOrgDashboard,
  searchLicensesDashboard,
  searchPackagesDashboard,
];

for (const dash of dashboards) {
  addMetricToIndicatorLinks(dash);
}

/*
 * Panel ids are frozen in panel-ids.json rather than taken from the construction-order counter.
 *
 * The counter is global and dashboards are built in sequence, so inserting a single panel into an
 * early dashboard renumbered every panel of every dashboard built after it. Panel ids are part of
 * the public surface of an installed dashboard: `?viewPanel=<id>` links, `/d-solo/...?panelId=<id>`
 * iframe embeds and user-authored alert annotations all reference them, and a renumber silently
 * points them at a different panel instead of failing loudly.
 *
 * The lock maps `<dashboard uid> -> <panel type>::<panel title> -> id`. That key does not depend on
 * where a panel sits, so panels can be inserted, moved or removed without disturbing any other id.
 * A panel absent from the lock takes the next id above the highest ever issued, and the lock is
 * rewritten so the new id is frozen too. Ids of deleted panels stay reserved and are never reused.
 *
 * The lock lives outside OUT_DIR on purpose: every *.json in the dashboards folder is treated as a
 * dashboard by both the lint suite and the installer's file list.
 */
const LOCK_FILE = path.join(OUT_DIR, '..', 'panel-ids-v2.json');
const idLock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
const panelKey = (p) => `${p.type}::${p.title || ''}`;

let highWater = 0;
for (const entries of Object.values(idLock)) {
  for (const id of Object.values(entries)) highWater = Math.max(highWater, id);
}

/* Provisional construction-order ids are globally unique, so one map remaps every reference */
const remap = new Map();
let allocated = 0;
for (const dash of dashboards) {
  const entries = (idLock[dash.uid] = idLock[dash.uid] || {});
  const used = new Set();
  for (const panel of dash.panels) {
    const key = panelKey(panel);
    if (entries[key] == null) {
      entries[key] = ++highWater;
      allocated++;
      console.log(`  new panel id ${entries[key]} for ${dash.uid} ${key}`);
    }
    const id = entries[key];
    if (used.has(id)) throw new Error(`Duplicate panel id ${id} in ${dash.uid} (${key})`);
    used.add(id);
    remap.set(panel.id, id);
    panel.id = id;
  }
}

for (const dash of dashboards) {
  /* Panel links embed the provisional id in a URL string built during construction */
  const rewritten = JSON.parse(
    JSON.stringify(dash).replace(/(viewPanel=|editPanel=|panelId=)(\d+)/g, (whole, param, oldId) => {
      const mapped = remap.get(Number(oldId));
      return mapped == null ? whole : `${param}${mapped}`;
    })
  );
  const fileName = `${dash.uid.replace('sfdx-hardis-v2-', '')}.json`;
  fs.writeFileSync(path.join(OUT_DIR, fileName), JSON.stringify(rewritten, null, 2) + '\n');
  console.log(`Generated ${fileName} (${rewritten.panels.length} panels)`);
}

const sortedLock = {};
for (const dash of dashboards) sortedLock[dash.uid] = idLock[dash.uid];
fs.writeFileSync(LOCK_FILE, JSON.stringify(sortedLock, null, 2) + '\n');

console.log(`\n${dashboards.length} dashboards written to ${OUT_DIR}`);
console.log(`Panel ids: ${allocated} newly allocated, high water mark ${highWater}`);
