---
name: grafana-dashboards
description: Rules and workflow for the "Org Monitoring by sfdx-hardis" Grafana dashboards v2 (docs/grafana/dashboards-v2). Use when creating or modifying v2 dashboards or alert rules, AND whenever a monitoring indicator (notification type, metric, logElements shape) is created, updated, or deleted - every indicator evolution must handle its impact on the dashboards.
user-invocable: false
---

# Grafana Dashboards v2 (Org Monitoring by sfdx-hardis)

Everything needed to build, modify and validate the v2 Grafana dashboards without rediscovering the constraints. The generic Grafana skills (`dashboarding`, `promql`, `loki`, `alerting-irm` in `.claude/skills/`) cover Grafana itself; THIS skill covers the sfdx-hardis-specific rules.

## Source of truth

- Dashboards: `docs/grafana/dashboards-v2/*.json` - **GENERATED FILES, never edit them directly.**
- Generator: `docs/grafana/dashboards-v2/generator.mjs`. Edit it, then run `node generator.mjs` from that folder to rewrite all JSONs.
- Alert pack: `docs/grafana/alerts-v2/sfdx-hardis-alerts.yaml` (hand-written YAML, all rules `isPaused: true`).
- Lint suite: `test/grafana-dashboards-v2.test.ts` - enforces most rules below; run with `npx mocha "test/grafana-dashboards-v2.test.ts"`.
- Docs page: `docs/salesforce-monitoring-grafana-v2.md`.
- v1 dashboards (`docs/grafana/dashboards/`) are frozen: never modify them.

## Data model reminder

sfdx-hardis pushes to two backends (see `src/common/notifProvider/apiProvider.ts`):

- **Loki** (logs): stream labels `source="sfdx-hardis"`, `type` (notification type key), `orgIdentifier`, `gitIdentifier`, `severity`. The log line is a JSON body: `metric`, `_metrics`, `_metricsKeys`, `_logElements` (detail rows), `_title`, `_logBodyText`, `_dateTime`, `_jobUrl`.
- **Prometheus/Mimir** (metrics): each `metrics` key of a notification becomes `<Key>_metric` (plus `_max` / `_percent` variants for object-form values), labeled with `source`, `type`, `orgIdentifier`, `gitIdentifier`.

PII: in CI, user fields in `_logElements` are pseudonymized (`user_xxxxxxxxxx`) by `apiAnonymizer.ts`. Dashboards must never rely on readable usernames.

## DOs

- **DO wrap every Prometheus selector in a lookback window**: `last_over_time(M{...}[2d])`, `avg_over_time(M{...}[7d])`, etc. Metrics arrive ONCE PER DAY; a bare selector returns "no data" (5-minute default lookback). Enforced by lint.
- **DO aggregate per org**: `max by (orgIdentifier) (...)` on every stat/gauge query (`min by` for time-to-exhaustion forecasts). Orgs can expose several series for one metric (two `gitIdentifier` values after a monitoring repo/branch rename); without aggregation, stat panels show two confusing values. For per-limit series use `max by (__name__)`.
- **DO use the datasource variables** `${ds_prom}` / `${ds_loki}` for every panel and target (helpers `DS_PROM`/`DS_LOKI` in the generator). They are hidden (`hide: 2`) - there is always exactly one Prometheus and one Loki receiving sfdx-hardis data.
- **DO put a detail link on every number**: each stat/gauge/bargauge must be clickable via `fieldConfig.defaults.links`. Helpers: `indicatorLink('<TYPE>')` (generic Indicator Detail dashboard filtered on the notification type), `detailLink('<dash-slug>')` (another org dashboard), `viewPanelLink(...)` / `linkStatToPanel(...)` (full-screen view of a table on the same dashboard, used on fleet for silent orgs / backup failures). Enforced by lint (exempt: "Stats generation date", "Latest value", the dtl-indicator dashboard).
- **DO propagate variables AND the time range in links**: append `${ds_prom:queryparam}&${ds_loki:queryparam}&${__url_time_range}` (already in the helpers) or `${__all_variables}&${__url_time_range}` for same-dashboard viewPanel links. The time range is not optional: a stat viewed over 180d shows the last non-null value in that window, so its detail link must open the same window or a stale value lands on an empty page.
- **DO show averages and trends**: new numeric indicators should get avg/day (7d/30d) context where relevant (`avgStat` helper), not just the latest value.
- **DO respect the fleet Environment filter**: every fleet-dashboard query must include the `$env` matcher (`{source="sfdx-hardis", $env, orgIdentifier=~"$org"}`). It injects `orgIdentifier!~".*sandbox.*"` for "Production only" (RE2 has no lookbehind, hence matcher-as-variable-value).
- **DO use whitelist `organize` transformations on Loki tables** (`includeByName`) so backend noise columns (`labels`, `traceID`, `detected_level`) can never appear. `__proxy_source__` is excluded centrally by the `organize()` helper.
- **DO reuse the v1-proven `jsonArrayToRows('<field>')` chain** to render a JSON array field of the latest Loki entry as table rows (`_logElements`, `topFailingFlows`, ...).
- **DO keep tables vertical**: one row per item, 2-4 columns. Wide "one column per item" layouts cause horizontal scrollbars (the days-until-limit table uses `reduce` seriesToRows + `legendFormat` per query for this).
- **DO keep stat titles short** (fits a 4-unit-wide box, ~15 chars): "Apex avg/day (30d)", not "Apex errors average per day (30 days)". Longer context goes in the panel `description`.
- **DO handle no-data**: `noValue` text on stats (e.g. "Schedule dora-report"), range mappings for degenerate values ("Limit exceeded" for negative forecast days, "No growth" above 3650), and a `description` mentioning "Requires a recent sfdx-hardis version" for panels fed by newly added metrics (`RECENT_CLI_NOTE`).
- **DO validate live before delivering**: `.env` contains `GRAFANA_TOKEN` (service account for cloudity.grafana.net). Test queries through the datasource proxy (`/api/datasources/proxy/uid/grafanacloud-prom/api/v1/query`, `.../grafanacloud-logs/loki/api/v1/query`), then import into folder uid `sfdx-hardis-v2` via `POST /api/dashboards/db` with `overwrite: true`.
- **DO run the lint suite** after regenerating - it checks JSON validity, v2 uids/tags, ds variables, no hardcoded stack references, `*_over_time` wrappers, unique panel ids, and detail links on every number.

## DON'Ts

- **DON'T edit the generated JSONs** - always the generator.
- **DON'T hardcode datasource UIDs** or any stack-specific string (`grafanacloud-`, `cloudity`) anywhere in dashboards - they must import on any Grafana instance (OSS/Enterprise/Cloud). Enforced by lint.
- **DON'T use Grafana Cloud-only features**: no ML forecasting (use PromQL `predict_linear`/`deriv`), no Cloud-only datasources or panel plugins. Core panels only: stat, gauge, timeseries, table, bargauge, text, row.
- **DON'T display usernames or user lists** on dashboards - counts, aggregates and pseudonymized IDs only.
- **DON'T create per-user or per-flow Prometheus label cardinality** - per-item detail belongs in Loki `_logElements`, not in metric labels.
- **DON'T do binary operations across `{__name__=~...}` multi-metric selectors** - vector matching collides (same label sets after name is ignored). Use one query per metric, or `label_replace` tricks, or per-metric explicit queries (see days-until-limit).
- **DON'T touch the v1 dashboards or their Grafana folder** (`cdklj9xhp8074d`).
- **DON'T activate alert rules by default** - the alert pack ships `isPaused: true` (Grafana Cloud free-tier cost), with `${DS_PROMETHEUS}`/`${DS_LOKI}` placeholders documented for replacement at import.
- **DON'T mint new dashboard UIDs for existing dashboards** - uids are `sfdx-hardis-v2-<slug>` and stable; changing one breaks bookmarks and cross-dashboard links.
- **DON'T write to the Salesforce test org**, and when running commands that push test data, set `SFDX_HARDIS_MONITORING_KEY=claude-test` so real org series stay clean.

## When a monitoring indicator changes (create / update / delete)

Any change to a notification type, its `metrics` keys, or its `logElements` shape (in `src/commands/**` or `src/common/notifProvider/**`) MUST evaluate dashboard impact:

1. **New indicator / new metric key**: decide where it surfaces - existing dashboard row, new panel, fleet column, or only the generic Indicator Detail dashboard (which picks up any `type` automatically). Add panels via the generator, with lookback wrapper, per-org aggregation, detail link, and `RECENT_CLI_NOTE` description (older CLIs won't send it yet).
2. **Renamed/removed metric key**: grep the generator for the old `<Key>_metric` name and update every query, and check `docs/grafana/alerts-v2/` for alert rules using it. Old series keep their data in Prometheus under the old name; mention the rename in the dashboard panel description if history matters.
3. **Changed `logElements` fields**: check Loki table panels extracting those fields (`jsonArrayToRows`, `extractJson` paths) and the anonymizer's sensitive-key list (`src/common/notifProvider/apiAnonymizer.ts`) if user-identifying fields are involved.
4. **New notification type**: it appears automatically in the Indicator Detail dashboard `$type` variable (Loki label values) - explicit panels are only needed if the indicator deserves dedicated visibility.
5. Regenerate (`node generator.mjs`), run the lint suite, re-import to the `sfdx-hardis-v2` folder, and update `docs/salesforce-monitoring-grafana-v2.md` if the dashboard list or prerequisites changed.

## Alert pack rules

- One YAML file, provisioning format, `apiVersion: 1`, group `sfdx-hardis-org-monitoring`, evaluation interval 6h.
- Every rule: `isPaused: true`, `noDataState: OK`, `execErrState: OK` (daily data = "no data" is normal), shape A (query) -> B (reduce last) -> C (threshold).
- Health-score rules use an 8-day lookback (`[8d]`) because the score is weekly.
- Freshness/silent-org logic uses LogQL `unless` between a 7d and a 36h `count_over_time` (per-org absence cannot be expressed with `absent_over_time` alone).
