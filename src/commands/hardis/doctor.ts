/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as os from 'node:os';
import axios from 'axios';
import c from 'chalk';
import open from 'open';
import semver from 'semver';
import { getEnvVar } from '../../config/index.js';
import { isCI, uxLog, uxLogTable } from '../../common/utils/index.js';
import { prompts } from '../../common/utils/prompts.js';
import { WebSocketClient } from '../../common/websocketClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

const NEW_ISSUE_URL = 'https://github.com/hardisgroupcom/sfdx-hardis/issues/new';
// Keep the generated URL comfortably under the ~8k browser limit.
const MAX_ISSUE_URL_LENGTH = 7000;
// npm package name of the Salesforce CLI (used to check the CLI latest version)
const SF_CLI_NPM_NAME = '@salesforce/cli';

interface PluginInfo {
  name: string;
  version: string;
  type: string;
  latest?: string;
  outdated?: boolean;
}

// Minimal structural shape of the oclif Config we rely on.
// Typed structurally to avoid dual-package type conflicts between the oclif
// copy used by @salesforce/sf-plugins-core and the top-level one.
interface OclifConfigLike {
  version: string;
  shell: string;
  pjson?: { version?: string };
  plugins?: Map<string, { name: string; version: string; type: string }>;
}

interface DoctorInfo {
  sfdxHardisVersion: string;
  sfdxHardisLatest?: string;
  sfdxHardisOutdated?: boolean;
  sfCliVersion: string;
  sfCliLatest?: string;
  sfCliOutdated?: boolean;
  nodeVersion: string;
  os: string;
  shell: string;
  lang: string;
  isCI: boolean;
  ciProvider?: string;
  plugins: PluginInfo[];
  vscodeExtensionVersion?: string;
  // Human-readable names of the components that are not on their latest version
  outdatedItems: string[];
}

export default class Doctor extends SfCommand<any> {
  public static title = 'Doctor';

  public static description = `
## Command Behavior

**Collects your local sfdx-hardis install info and helps you open a pre-filled GitHub issue.**

This command gathers everything a maintainer usually asks for when investigating a bug, then prints it as a ready-to-paste report and offers to open the sfdx-hardis "New issue" page with the report already filled in.

Key functionalities:

- **Install info gathering:** sfdx-hardis version, Salesforce CLI version, Node.js version, OS, shell, language and the full list of installed SF CLI plugins with their versions.
- **Latest version check:** Queries npm for the latest published versions and flags any outdated component (shown as \`(latest: x.y.z)\` in the report). If anything is outdated, it warns you to upgrade first, in case the issue is already fixed in a newer version. Disable with \`--skip-version-check\`.
- **VS Code extension detection:** When the command runs inside VS Code with the sfdx-hardis extension linked, the extension version is added to the report.
- **CI detection:** Detects whether it runs in a CI environment and which provider.
- **Pre-filled GitHub issue:** Builds the "New issue" URL of the sfdx-hardis repository with the report pre-filled in the body, and (interactively) opens it in your browser.

The report is always printed in your terminal, so you can copy it manually if the browser page is not enough.

<details markdown="1">
<summary>Technical explanations</summary>

- **oclif Config:** Install info is read from the oclif \`Config\` object (\`config.version\`, \`config.shell\`, \`config.plugins\`), so no shell command is executed to list plugins.
- **Node & OS:** Node version comes from \`process.version\`; OS details come from the Node.js \`os\` module.
- **Latest versions:** Queried from the npm registry (\`registry.npmjs.org\`) in parallel, with a short timeout and full best-effort handling, then compared with \`semver\`. Core plugins are not flagged, as they are pinned to the Salesforce CLI.
- **VS Code extension version:** Requested over the existing WebSocket connection (\`getExtensionVersion\` event). The extension answers with its version; the request times out gracefully after a few seconds and reports "not available" if no compatible extension is linked.
- **Issue URL:** Built as \`https://github.com/hardisgroupcom/sfdx-hardis/issues/new\` with \`title\` and \`body\` query parameters. If the encoded URL would exceed the browser limit, the plugin list is trimmed from the URL body (the full report stays in the terminal).
- **Browser:** Uses the \`open\` package to launch the default browser after user confirmation.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:doctor --agent
\`\`\`

In agent mode (or in CI):
- The install info report and the GitHub issue URL are printed.
- No prompt is displayed and the browser is never opened.
`;

  public static examples = ['$ sf hardis:doctor', '$ sf hardis:doctor --agent'];

  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    open: Flags.boolean({
      char: 'o',
      default: false,
      description: 'Open the GitHub new issue page directly without prompting',
    }),
    'skip-version-check': Flags.boolean({
      default: false,
      description: 'Do not query npm for the latest versions (faster, works offline)',
    }),
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
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(Doctor);
    const agentMode = flags.agent === true;

    uxLog("action", this, c.cyan('Collecting installation info...'));

    // Gather local install info (no shell command needed).
    // Version checking queries npm to flag outdated components (unless skipped).
    const checkVersions = flags['skip-version-check'] !== true;
    const info = await this.gatherInstallInfo(this.config as unknown as OclifConfigLike, checkVersions);

    // Best-effort: get VS Code extension version if linked
    const extensionVersion = await WebSocketClient.getExtensionVersion();
    info.vscodeExtensionVersion = extensionVersion || 'not available (run inside VS Code with the extension linked)';

    // Build and print the markdown report (ready to paste into a GitHub issue)
    const report = this.buildDoctorReport(info);
    uxLog("action", this, c.cyan('sfdx-hardis install info (paste this into your GitHub issue):'));
    uxLog("log", this, c.grey(report));

    // Warn if some components are not on their latest version
    if (info.outdatedItems.length > 0) {
      uxLog(
        "warning",
        this,
        c.yellow(
          `Before posting an issue, we detected that you are not using the latest versions of ${info.outdatedItems.join(', ')}. Maybe upgrade them first, to check whether the problem is not already resolved in a more recent version?`
        )
      );
    }

    // Build the pre-filled GitHub issue URL
    const issueUrl = this.buildIssueUrl(report);
    uxLog("other", this, c.cyan(`GitHub new issue page: ${c.yellow(issueUrl)}`));

    // In CI or agent mode: never prompt, never open a browser
    if (isCI || agentMode) {
      return { outputString: report, installInfo: info, issueUrl } as unknown as AnyJson;
    }

    // Display a readable summary of the gathered info just before prompting.
    // alwaysVisible keeps this section open in the VS Code UI so the tables stay visible.
    uxLog("action", this, c.cyan('Installation summary'), { alwaysVisible: true });
    uxLogTable(this, this.buildEnvironmentRows(info), ['Item', 'Value']);
    uxLogTable(this, this.buildPluginRows(info), ['Plugin', 'Version', 'Type', 'Latest']);

    // Decide whether to open the browser
    let shouldOpen = flags.open === true;
    if (!shouldOpen) {
      const openRes = await prompts({
        type: 'confirm',
        name: 'value',
        message: c.cyan('Open the GitHub new issue page in your browser now?'),
        description: 'The issue body will be pre-filled with your install info. Complete the bug description before submitting.',
        initial: true,
      });
      shouldOpen = openRes.value === true;
    }

    if (shouldOpen) {
      await open(issueUrl);
    }

    return { outputString: report, installInfo: info, issueUrl } as unknown as AnyJson;
  }

  // Gather local install info from the oclif config, Node.js and environment.
  // No shell command is executed: plugin versions come from config.plugins.
  // When checkVersions is true, the latest published versions are fetched from npm.
  private async gatherInstallInfo(config: OclifConfigLike, checkVersions: boolean): Promise<DoctorInfo> {
    const plugins: PluginInfo[] = [];
    for (const plugin of config.plugins?.values?.() ?? []) {
      // Skip oclif framework plugins: they are internal and not useful in an issue report
      if (plugin.name.startsWith('@oclif/')) {
        continue;
      }
      plugins.push({ name: plugin.name, version: plugin.version, type: plugin.type });
    }
    plugins.sort((a, b) => a.name.localeCompare(b.name));

    const sfdxHardisPlugin = plugins.find((plugin) => plugin.name === 'sfdx-hardis');

    const info: DoctorInfo = {
      sfdxHardisVersion: sfdxHardisPlugin?.version ?? config.pjson?.version ?? 'unknown',
      sfCliVersion: config.version,
      nodeVersion: process.version,
      os: `${os.platform()} ${os.release()} (${os.arch()})`,
      shell: config.shell,
      lang: getEnvVar('SFDX_HARDIS_LANG') || 'en',
      isCI: isCI,
      ciProvider: this.detectCiProvider(),
      plugins: plugins,
      outdatedItems: [],
    };

    if (checkVersions === true) {
      await this.enrichWithLatestVersions(info);
    }

    return info;
  }

  // Best-effort detection of the CI provider from well-known environment variables
  private detectCiProvider(): string | undefined {
    if (getEnvVar('GITHUB_ACTIONS')) return 'GitHub Actions';
    if (getEnvVar('GITLAB_CI')) return 'GitLab CI';
    if (getEnvVar('TF_BUILD')) return 'Azure Pipelines';
    if (getEnvVar('BITBUCKET_BUILD_NUMBER')) return 'Bitbucket Pipelines';
    if (getEnvVar('CIRCLECI')) return 'CircleCI';
    if (getEnvVar('JENKINS_URL')) return 'Jenkins';
    if (getEnvVar('CI')) return 'Unknown (generic CI)';
    return undefined;
  }

  // Fetches latest versions from npm (in parallel) and fills the outdated flags.
  private async enrichWithLatestVersions(info: DoctorInfo): Promise<void> {
    // A plugin is worth checking when the user can upgrade it independently.
    // Core plugins are pinned to the Salesforce CLI, so upgrading the CLI covers them.
    const isCheckable = (plugin: PluginInfo) => plugin.type === 'user' || plugin.name === 'sfdx-hardis';
    const checkablePlugins = info.plugins.filter(isCheckable);
    const npmNames = [...new Set([...checkablePlugins.map((plugin) => plugin.name), SF_CLI_NPM_NAME])];

    const latestByName = new Map<string, string | null>();
    await Promise.all(
      npmNames.map(async (name) => {
        latestByName.set(name, await this.getLatestNpmVersion(name));
      })
    );

    // Plugins
    for (const plugin of checkablePlugins) {
      const latest = latestByName.get(plugin.name) ?? null;
      if (latest) {
        plugin.latest = latest;
        plugin.outdated = this.isOutdated(plugin.version, latest);
      }
    }

    // Salesforce CLI
    const sfCliLatest = latestByName.get(SF_CLI_NPM_NAME) ?? undefined;
    info.sfCliLatest = sfCliLatest;
    info.sfCliOutdated = this.isOutdated(info.sfCliVersion, sfCliLatest);

    // sfdx-hardis (mirror the plugin entry so the dedicated table row is consistent)
    const sfdxHardisPlugin = info.plugins.find((plugin) => plugin.name === 'sfdx-hardis');
    info.sfdxHardisLatest = sfdxHardisPlugin?.latest;
    info.sfdxHardisOutdated = sfdxHardisPlugin?.outdated === true;

    // Build the list of outdated component names for the warning message
    const outdated: string[] = [];
    if (info.sfdxHardisOutdated) outdated.push('sfdx-hardis');
    if (info.sfCliOutdated) outdated.push('Salesforce CLI');
    for (const plugin of checkablePlugins) {
      if (plugin.name !== 'sfdx-hardis' && plugin.outdated === true) {
        outdated.push(plugin.name);
      }
    }
    info.outdatedItems = outdated;
  }

  // Best-effort fetch of the latest published version of an npm package.
  // Returns null on any error so version checking never blocks the command.
  private async getLatestNpmVersion(packageName: string): Promise<string | null> {
    try {
      const res = await axios.get(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, {
        timeout: 7000,
        // Abbreviated metadata: smaller payload that still carries dist-tags
        headers: { Accept: 'application/vnd.npm.install-v1+json' },
      });
      return res.data?.['dist-tags']?.latest ?? null;
    } catch {
      return null;
    }
  }

  // Returns true when current is a valid version strictly lower than latest.
  private isOutdated(current: string, latest: string | null | undefined): boolean {
    if (!latest || !semver.valid(current) || !semver.valid(latest)) {
      return false;
    }
    return semver.lt(current, latest);
  }

  // Renders a version cell, appending "(latest: x.y.z)" when the component is outdated.
  private versionCell(current: string, latest: string | undefined, outdated: boolean | undefined): string {
    return outdated && latest ? `${current} (latest: ${latest})` : current;
  }

  private buildPluginsBlock(info: DoctorInfo): string {
    if (info.plugins.length === 0) {
      return '(none detected)';
    }
    const lines: string[] = [];
    lines.push('| Plugin | Version | Type | Latest |');
    lines.push('| --- | --- | --- | --- |');
    for (const plugin of info.plugins) {
      const latest = plugin.outdated && plugin.latest ? plugin.latest : '';
      lines.push(`| ${plugin.name} | ${plugin.version} | ${plugin.type} | ${latest} |`);
    }
    return lines.join('\n');
  }

  // Builds the Environment table rows for console display.
  private buildEnvironmentRows(info: DoctorInfo): any[] {
    return [
      { Item: 'sfdx-hardis version', Value: this.versionCell(info.sfdxHardisVersion, info.sfdxHardisLatest, info.sfdxHardisOutdated) },
      { Item: 'Salesforce CLI version', Value: this.versionCell(info.sfCliVersion, info.sfCliLatest, info.sfCliOutdated) },
      { Item: 'Node.js version', Value: info.nodeVersion },
      { Item: 'OS', Value: info.os },
      { Item: 'Shell', Value: info.shell },
      { Item: 'Language (SFDX_HARDIS_LANG)', Value: info.lang },
      { Item: 'Running in CI', Value: info.isCI ? `yes${info.ciProvider ? ` (${info.ciProvider})` : ''}` : 'no' },
      { Item: 'VS Code extension version', Value: info.vscodeExtensionVersion ?? 'not available' },
    ];
  }

  // Builds the plugins table rows for console display.
  // Core plugins are filtered out (they are pinned to the CLI), except @salesforce/cli itself.
  private buildPluginRows(info: DoctorInfo): any[] {
    return info.plugins
      .filter((plugin) => plugin.type !== 'core' || plugin.name === '@salesforce/cli')
      .map((plugin) => ({
        Plugin: plugin.name,
        Version: plugin.version,
        Type: plugin.type,
        // Outdated: show the latest version. Up to date: green check. Not checked: empty.
        Latest: plugin.outdated && plugin.latest ? plugin.latest : plugin.latest ? '✅' : '',
      }));
  }

  // Builds the English markdown report used both for the console output and the GitHub issue body.
  private buildDoctorReport(info: DoctorInfo): string {
    const lines: string[] = [];
    lines.push('### Bug description');
    lines.push('');
    lines.push('<!-- Describe the issue you are facing here -->');
    lines.push('');
    lines.push('### Steps to reproduce');
    lines.push('');
    lines.push('1. ');
    lines.push('2. ');
    lines.push('3. ');
    lines.push('');
    lines.push('### Environment');
    lines.push('');
    lines.push('| Item | Value |');
    lines.push('| --- | --- |');
    lines.push(`| sfdx-hardis version | ${this.versionCell(info.sfdxHardisVersion, info.sfdxHardisLatest, info.sfdxHardisOutdated)} |`);
    lines.push(`| Salesforce CLI version | ${this.versionCell(info.sfCliVersion, info.sfCliLatest, info.sfCliOutdated)} |`);
    lines.push(`| Node.js version | ${info.nodeVersion} |`);
    lines.push(`| OS | ${info.os} |`);
    lines.push(`| Shell | ${info.shell} |`);
    lines.push(`| Language (SFDX_HARDIS_LANG) | ${info.lang} |`);
    lines.push(`| Running in CI | ${info.isCI ? `yes${info.ciProvider ? ` (${info.ciProvider})` : ''}` : 'no'} |`);
    lines.push(`| VS Code extension version | ${info.vscodeExtensionVersion ?? 'not available'} |`);
    lines.push('');
    lines.push('### Installed SF CLI plugins');
    lines.push('');
    lines.push(this.buildPluginsBlock(info));
    lines.push('');
    return lines.join('\n');
  }

  // Builds the GitHub "new issue" URL with a pre-filled title and body.
  // If the encoded URL exceeds the browser limit, the plugin list is dropped and a note is added,
  // since the full report is always printed in the terminal.
  private buildIssueUrl(report: string): string {
    const title = 'Issue report: ';
    const buildUrl = (body: string) =>
      `${NEW_ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;

    const url = buildUrl(report);
    if (url.length <= MAX_ISSUE_URL_LENGTH) {
      return url;
    }

    // Too long: keep everything up to the plugins section and add a paste note
    const pluginsHeaderIndex = report.indexOf('### Installed SF CLI plugins');
    const trimmedReport =
      (pluginsHeaderIndex > -1 ? report.slice(0, pluginsHeaderIndex) : report) +
      '\n_(report truncated - the full details, including installed plugins, were printed in your terminal, please paste them here)_\n';
    return buildUrl(trimmedReport);
  }
}
