<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:configure:grafana-dashboards

## Description


## Command Behavior

**Installs the [Org Monitoring by sfdx-hardis Grafana dashboards v2](https://sfdx-hardis.cloudity.com/salesforce-monitoring-grafana-v2/) on any Grafana instance (Grafana Cloud, OSS or Enterprise) through the Grafana HTTP API.**

Key functionalities:

- **Folder creation:** creates the `Org Monitoring by sfdx-hardis` folder (uid `sfdx-hardis-v2`) if missing.
- **Dashboard import:** downloads the dashboard definitions from the sfdx-hardis GitHub repository (`--ref` selects the branch or tag, default `main`) and imports them with `overwrite: true`. Re-running the command upgrades the dashboards in place: uids are stable, bookmarks and links keep working. The dashboards resolve their Prometheus and Loki datasources by themselves (hidden variables), so no datasource configuration is needed for this part.
- **Optional alert pack:** with `--with-alerts`, imports the 6 alert rules (org limit above 90%, storage exhaustion forecast, error spike, backup failure, silent org, health score degradation). All rules are imported **paused**, so they trigger no evaluation and no cost until you enable them from **Alerting -> Alert rules** and configure your contact points. Alert rules need explicit datasource uids: the command auto-detects the Prometheus/Mimir and Loki datasources receiving sfdx-hardis data (Grafana Cloud internal datasources are filtered out), and `--prom-uid` / `--loki-uid` pin the choice when several candidates exist.
- **Verification:** each imported dashboard is read back through the API, and the command prints the direct URL to the Fleet Overview.

Authentication uses a Grafana service account token provided via `--grafana-token` or the `GRAFANA_API_TOKEN` environment variable (prefer the environment variable: flag values can end up in shell history and local log files). The instance URL comes from `--grafana-url` or `GRAFANA_API_URL`. An Editor role is enough for the dashboards; `--with-alerts` additionally needs datasource read and alert provisioning permissions.

This command requires no Salesforce org: it only talks to Grafana and GitHub. Configure the [API integration](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-api/) first so the dashboards have data to display.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
GRAFANA_API_URL=https://mycompany.grafana.net GRAFANA_API_TOKEN=$MY_TOKEN sf hardis:org:configure:grafana-dashboards --agent --with-alerts
```

In agent mode:

- The Grafana URL and token (flags or the `GRAFANA_API_URL` / `GRAFANA_API_TOKEN` environment variables) are required: the interactive prompts asking for them are skipped.
- With `--with-alerts`, when several Prometheus or Loki datasources are eligible, the datasource selection prompt is skipped: the Grafana default datasource is used, or the first candidate, with a warning. Use `--prom-uid` / `--loki-uid` to pin the choice.
- `--ref` defaults to `main` and `--with-alerts` defaults to false, like in interactive mode.

<details markdown="1">
<summary>Technical explanations</summary>

- Dashboard JSONs live in `docs/grafana/dashboards-v2` of the sfdx-hardis repository and are fetched at runtime: the file list comes from the GitHub contents API (with a hardcoded fallback list when unreachable), the files from `raw.githubusercontent.com`.
- Dashboards are imported via `POST /api/dashboards/db` with `overwrite: true` into the folder created via `POST /api/folders` (uid `sfdx-hardis-v2`).
- Datasource detection (only with `--with-alerts`) uses `GET /api/datasources` with the same exclusion list as the hidden `ds_prom`/`ds_loki` dashboard variables (`alert-state-history`, `usage-insights`, `ml-metrics` in the datasource name; the dashboards apply it to the name, the command also applies it to the uid).
- The alert pack YAML (`docs/grafana/alerts-v2/sfdx-hardis-alerts.yaml`) is fetched from the same ref, its `${DS_PROMETHEUS}`/`${DS_LOKI}` placeholders are replaced by the detected datasource uids, and each rule group is pushed via `PUT /api/v1/provisioning/folder/sfdx-hardis-v2/rule-groups/<group>` with the `X-Disable-Provenance` header, so the rules stay editable (and unpausable) from the Grafana UI.
- Helpers live in `src/common/grafana/grafanaDashboardsInstaller.ts`.
</details>


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|grafana-token|option|Grafana service account token with Editor role (defaults to GRAFANA_API_TOKEN environment variable)||||
|grafana-url|option|Grafana instance URL (defaults to GRAFANA_API_URL environment variable)||||
|json|boolean|Format output as json.||||
|loki-uid|option|Uid of the Loki datasource used by the alert pack (--with-alerts only, auto-detected when not set)||||
|prom-uid|option|Uid of the Prometheus/Mimir datasource used by the alert pack (--with-alerts only, auto-detected when not set)||||
|ref|option|Git branch or tag of the sfdx-hardis repository to fetch the dashboards from|main|||
|skipauth|boolean|Skip authentication check when a default username is required||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||
|with-alerts|boolean|Also import the sfdx-hardis alert rules pack (all rules imported paused)||||

## Examples

```shell
$ sf hardis:org:configure:grafana-dashboards
```

```shell
$ GRAFANA_API_URL=https://mycompany.grafana.net GRAFANA_API_TOKEN=$MY_TOKEN sf hardis:org:configure:grafana-dashboards
```

```shell
$ sf hardis:org:configure:grafana-dashboards --with-alerts
```

```shell
$ sf hardis:org:configure:grafana-dashboards --with-alerts --prom-uid my-prom-uid --loki-uid my-loki-uid
```

```shell
$ GRAFANA_API_URL=https://mycompany.grafana.net GRAFANA_API_TOKEN=$MY_TOKEN sf hardis:org:configure:grafana-dashboards --agent --with-alerts
```


