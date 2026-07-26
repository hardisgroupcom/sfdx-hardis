/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { t } from '../../../../common/utils/i18n.js';
import { CONSTANTS, getEnvVar } from '../../../../config/index.js';
import {
  buildAlertRuleGroups,
  createGrafanaClient,
  ensureGrafanaFolder,
  fetchGitHubRawFile,
  getGrafanaDashboard,
  getGrafanaDatasources,
  grafanaApiErrorMessage,
  GRAFANA_V2_ALERTS_PATH,
  GRAFANA_V2_FLEET_UID,
  GRAFANA_V2_FOLDER_TITLE,
  GRAFANA_V2_FOLDER_UID,
  GrafanaDatasource,
  importGrafanaAlertRuleGroup,
  importGrafanaDashboard,
  listDashboardFiles,
  normalizeGrafanaUrl,
  pickDatasource,
} from '../../../../common/grafana/grafanaDashboardsInstaller.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');
/* jscpd:ignore-end */

export default class ConfigureGrafanaDashboards extends SfCommand<any> {
  public static title = 'Install Grafana dashboards';

  public static description = `
## Command Behavior

**Installs the [Org Monitoring by sfdx-hardis Grafana dashboards v2](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-grafana-v2/) on any Grafana instance (Grafana Cloud, OSS or Enterprise) through the Grafana HTTP API.**

Key functionalities:

- **Datasource auto-detection:** finds the Prometheus/Mimir and Loki datasources receiving sfdx-hardis monitoring data (Grafana Cloud internal datasources are filtered out). Override with \`--prom-uid\` / \`--loki-uid\` when the instance hosts several candidates.
- **Folder creation:** creates the \`Org Monitoring by sfdx-hardis\` folder (uid \`sfdx-hardis-v2\`) if missing.
- **Dashboard import:** downloads the dashboard definitions from the sfdx-hardis GitHub repository (\`--ref\` selects the branch or tag, default \`main\`) and imports them with \`overwrite: true\`. Re-running the command upgrades the dashboards in place: uids are stable, bookmarks and links keep working.
- **Optional alert pack:** with \`--with-alerts\`, imports the 6 alert rules (org limit above 90%, storage exhaustion forecast, error spike, backup failure, silent org, health score degradation). All rules are imported **paused**, so they trigger no evaluation and no cost until you enable them from **Alerting -> Alert rules** and configure your contact points.
- **Verification:** each imported dashboard is read back through the API, and the command prints the direct URL to the Fleet Overview.

Authentication uses a Grafana service account token with Editor role (plus alert provisioning permissions when using \`--with-alerts\`), provided via \`--grafana-token\` or the \`GRAFANA_API_TOKEN\` environment variable. The instance URL comes from \`--grafana-url\` or \`GRAFANA_API_URL\`.

This command requires no Salesforce org: it only talks to Grafana and GitHub. Configure the [API integration](${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-integration-api/) first so the dashboards have data to display.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:configure:grafana-dashboards --agent --grafana-url https://mycompany.grafana.net --grafana-token glsa_xxx --with-alerts
\`\`\`

In agent mode:

- \`--grafana-url\` and \`--grafana-token\` (or the \`GRAFANA_API_URL\` / \`GRAFANA_API_TOKEN\` environment variables) are required: the interactive prompts asking for them are skipped.
- When several Prometheus or Loki datasources are eligible, the datasource selection prompt is skipped: the Grafana default datasource is used, or the first candidate, with a warning. Use \`--prom-uid\` / \`--loki-uid\` to pin the choice.
- \`--ref\` defaults to \`main\` and \`--with-alerts\` defaults to false, like in interactive mode.

<details markdown="1">
<summary>Technical explanations</summary>

- Dashboard JSONs live in \`docs/grafana/dashboards-v2\` of the sfdx-hardis repository and are fetched at runtime: the file list comes from the GitHub contents API (with a hardcoded fallback list when unreachable), the files from \`raw.githubusercontent.com\`.
- Dashboards are imported via \`POST /api/dashboards/db\` with \`overwrite: true\` into the folder created via \`POST /api/folders\` (uid \`sfdx-hardis-v2\`).
- Datasource detection uses \`GET /api/datasources\` with the same exclusion list as the hidden \`ds_prom\`/\`ds_loki\` dashboard variables (\`alert-state-history\`, \`usage-insights\`, \`ml-metrics\`).
- The alert pack YAML (\`docs/grafana/alerts-v2/sfdx-hardis-alerts.yaml\`) is fetched from the same ref, its \`\${DS_PROMETHEUS}\`/\`\${DS_LOKI}\` placeholders are replaced by the detected datasource uids, and each rule group is pushed via \`PUT /api/v1/provisioning/folder/sfdx-hardis-v2/rule-groups/<group>\` with the \`X-Disable-Provenance\` header, so the rules stay editable (and unpausable) from the Grafana UI.
- Helpers live in \`src/common/grafana/grafanaDashboardsInstaller.ts\`.
</details>
`;

  public static examples = [
    '$ sf hardis:org:configure:grafana-dashboards',
    '$ sf hardis:org:configure:grafana-dashboards --grafana-url https://mycompany.grafana.net --grafana-token glsa_xxx',
    '$ sf hardis:org:configure:grafana-dashboards --with-alerts',
    '$ sf hardis:org:configure:grafana-dashboards --prom-uid my-prom-uid --loki-uid my-loki-uid',
    '$ sf hardis:org:configure:grafana-dashboards --agent --grafana-url https://mycompany.grafana.net --grafana-token glsa_xxx --with-alerts',
  ];

  public static flags: any = {
    'grafana-url': Flags.string({
      description: 'Grafana instance URL (defaults to GRAFANA_API_URL environment variable)',
    }),
    'grafana-token': Flags.string({
      description: 'Grafana service account token with Editor role (defaults to GRAFANA_API_TOKEN environment variable)',
    }),
    'prom-uid': Flags.string({
      description: 'Uid of the Prometheus/Mimir datasource receiving sfdx-hardis metrics (auto-detected when not set)',
    }),
    'loki-uid': Flags.string({
      description: 'Uid of the Loki datasource receiving sfdx-hardis logs (auto-detected when not set)',
    }),
    'with-alerts': Flags.boolean({
      default: false,
      description: 'Also import the sfdx-hardis alert rules pack (all rules imported paused)',
    }),
    ref: Flags.string({
      default: 'main',
      description: 'Git branch or tag of the sfdx-hardis repository to fetch the dashboards from',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    /* jscpd:ignore-start */
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    /* jscpd:ignore-end */
  };

  public static requiresProject = false;

  private agentMode = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ConfigureGrafanaDashboards);
    this.agentMode = flags.agent === true;
    const ref = flags.ref || 'main';

    const grafanaUrl = normalizeGrafanaUrl(await this.resolveInput(
      flags['grafana-url'],
      'GRAFANA_API_URL',
      t('promptGrafanaUrl'),
      t('promptGrafanaUrlDescription'),
      t('errorGrafanaUrlMissing')
    ));
    const grafanaToken = await this.resolveInput(
      flags['grafana-token'],
      'GRAFANA_API_TOKEN',
      t('promptGrafanaToken'),
      t('promptGrafanaTokenDescription'),
      t('errorGrafanaTokenMissing')
    );
    const client = createGrafanaClient(grafanaUrl, grafanaToken);

    uxLog("action", this, c.cyan(t('grafanaInstallStart', { url: grafanaUrl })));

    // Datasource detection
    let datasources: GrafanaDatasource[] = [];
    try {
      datasources = await getGrafanaDatasources(client);
    } catch (e: any) {
      throw new SfError(t('errorGrafanaApi', { operation: 'GET /api/datasources', message: grafanaApiErrorMessage(e) }));
    }
    const promUid = await this.resolveDatasourceUid(datasources, 'prometheus', flags['prom-uid']);
    const lokiUid = await this.resolveDatasourceUid(datasources, 'loki', flags['loki-uid']);

    // Folder
    let folder: any;
    try {
      folder = await ensureGrafanaFolder(client, GRAFANA_V2_FOLDER_UID, GRAFANA_V2_FOLDER_TITLE);
    } catch (e: any) {
      throw new SfError(t('errorGrafanaApi', { operation: 'POST /api/folders', message: grafanaApiErrorMessage(e) }));
    }
    uxLog("log", this, c.grey(t('grafanaFolderReady', { title: folder?.title || GRAFANA_V2_FOLDER_TITLE, uid: GRAFANA_V2_FOLDER_UID })));

    // Dashboards
    uxLog("action", this, c.cyan(t('grafanaFetchingDashboards', { ref: ref })));
    const { files, fromFallback } = await listDashboardFiles(ref);
    if (fromFallback) {
      uxLog("warning", this, c.yellow(t('grafanaDashboardsListFallback')));
    }
    const importedDashboards: Array<{ title: string; uid: string; url: string }> = [];
    for (const file of files) {
      let dashboard: any;
      try {
        const rawJson = await fetchGitHubRawFile(ref, `docs/grafana/dashboards-v2/${file.name}`);
        dashboard = JSON.parse(rawJson);
      } catch (e: any) {
        throw new SfError(t('errorGrafanaDashboardDownload', { file: file.name, message: e?.message || String(e) }));
      }
      try {
        await importGrafanaDashboard(client, dashboard, GRAFANA_V2_FOLDER_UID);
        const readBack = await getGrafanaDashboard(client, dashboard.uid);
        const dashboardUrl = `${grafanaUrl}${readBack?.meta?.url || `/d/${dashboard.uid}`}`;
        importedDashboards.push({ title: dashboard.title, uid: dashboard.uid, url: dashboardUrl });
        uxLog("log", this, c.grey(t('grafanaDashboardImported', { title: dashboard.title })));
      } catch (e: any) {
        throw new SfError(t('errorGrafanaApi', { operation: `import ${file.name}`, message: grafanaApiErrorMessage(e) }));
      }
    }

    // Alert pack (optional)
    let importedAlertRules = 0;
    if (flags['with-alerts'] === true) {
      uxLog("action", this, c.cyan(t('grafanaImportingAlerts')));
      try {
        const alertsYaml = await fetchGitHubRawFile(ref, GRAFANA_V2_ALERTS_PATH);
        const groups = buildAlertRuleGroups(alertsYaml, promUid, lokiUid, GRAFANA_V2_FOLDER_UID);
        for (const group of groups) {
          await importGrafanaAlertRuleGroup(client, GRAFANA_V2_FOLDER_UID, group);
          importedAlertRules += group.rules.length;
        }
        uxLog("log", this, c.grey(t('grafanaAlertsImported', { count: importedAlertRules })));
      } catch (e: any) {
        throw new SfError(t('errorGrafanaApi', { operation: 'import alert rules', message: grafanaApiErrorMessage(e) }));
      }
    }

    // Summary
    uxLogTable(this, importedDashboards.map((d) => ({ dashboard: d.title, url: d.url })));
    const fleetUrl = importedDashboards.find((d) => d.uid === GRAFANA_V2_FLEET_UID)?.url || `${grafanaUrl}/d/${GRAFANA_V2_FLEET_UID}`;
    uxLog("success", this, c.green(t('grafanaInstallSuccess', { count: importedDashboards.length, url: fleetUrl })));
    if (importedAlertRules > 0) {
      uxLog("log", this, c.grey(t('grafanaAlertsNextSteps')));
    }

    return {
      success: true,
      grafanaUrl: grafanaUrl,
      folderUid: GRAFANA_V2_FOLDER_UID,
      promDatasourceUid: promUid,
      lokiDatasourceUid: lokiUid,
      dashboards: importedDashboards,
      alertRulesImported: importedAlertRules,
      fleetOverviewUrl: fleetUrl,
    };
  }

  // flag > env var > interactive prompt (skipped in CI / agent mode) > error
  private async resolveInput(
    flagValue: string | undefined,
    envVarName: string,
    promptMessage: string,
    promptDescription: string,
    errorMessage: string
  ): Promise<string> {
    if (flagValue) {
      return flagValue;
    }
    const envValue = getEnvVar(envVarName);
    if (envValue) {
      return envValue;
    }
    if (!isCI && !this.agentMode) {
      const response = await prompts({
        type: 'text',
        name: 'value',
        message: promptMessage,
        description: promptDescription,
      });
      if (response.value) {
        return response.value;
      }
    }
    throw new SfError(errorMessage);
  }

  private async resolveDatasourceUid(
    datasources: GrafanaDatasource[],
    type: 'prometheus' | 'loki',
    overrideUid: string | undefined
  ): Promise<string> {
    if (overrideUid) {
      if (!datasources.some((ds) => ds.uid === overrideUid)) {
        uxLog("warning", this, c.yellow(t('grafanaDatasourceOverrideNotFound', { uid: overrideUid, type: type })));
      }
      return overrideUid;
    }
    const { selected, candidates } = pickDatasource(datasources, type);
    if (selected) {
      uxLog("log", this, c.grey(t('grafanaDatasourceSelected', { type: type, name: selected.name, uid: selected.uid })));
      return selected.uid;
    }
    if (candidates.length === 0) {
      throw new SfError(t('errorGrafanaDatasourceNotFound', { type: type }));
    }
    if (!isCI && !this.agentMode) {
      const response = await prompts({
        type: 'select',
        name: 'value',
        message: t('promptGrafanaDatasource', { type: type }),
        description: t('promptGrafanaDatasourceDescription', { type: type }),
        choices: candidates.map((ds) => ({ title: `${ds.name} (${ds.uid})`, value: ds.uid })),
      });
      return response.value;
    }
    const fallback = candidates[0];
    const flagName = type === 'prometheus' ? '--prom-uid' : '--loki-uid';
    uxLog("warning", this, c.yellow(t('grafanaDatasourceAmbiguous', { type: type, name: fallback.name, uid: fallback.uid, flag: flagName })));
    return fallback.uid;
  }
}
