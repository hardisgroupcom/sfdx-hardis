/* jscpd:ignore-start */
import c from 'chalk';
import { SfCommand, Flags, optionalHubFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { getConfig } from '../../../../config/index.js';
import { uxLog } from '../../../../common/utils/index.js';
import { uxLogTableWithReport } from '../../../../common/utils/filesUtils.js';
import { PoolSummary } from '../../../../common/utils/poolDashboardUtils.js';
import { POOL_ENCRYPTION_KEY_ENV_VAR } from '../../../../common/utils/poolCryptoUtils.js';
import { getPoolSummary } from '../../../../common/utils/poolUtils.js';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ScratchPoolView extends SfCommand<any> {
  public static title = 'View scratch org pool info';

  public static description = `
## Command Behavior

**Displays information about the configured scratch org pool, including its current state and available scratch orgs.**

This command provides visibility into your scratch org pool, allowing you to monitor its health, check the number of available orgs, and verify its configuration. It's a useful tool for administrators and developers managing shared scratch org environments.

Key functionalities:

- **Pool Configuration Display:** Shows the \`poolConfig\` defined in your ".sfdx-hardis.yml" file, including the chosen storage service and the maximum number of scratch orgs.
- **Pool Content:** Lists the scratch orgs available in the pool (alias, username, expiration date), the last scratch orgs taken from it, the last failed creations and the scratch org limits of the Dev Hub.
- **Available Scratch Org Count:** Provides a summary of how many scratch orgs are currently available in the pool.
- **No credential in the output:** The result never contains the credentials of a scratch org. With the \`gitProvider\` storage, the counts are available even without the encryption key.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Configuration Loading:** It retrieves the \`poolConfig\` from the project's ".sfdx-hardis.yml" file using \`getConfig\`.
- **Pool Summary Retrieval:** It uses \`getPoolSummary\` to read the configured storage service (dashboard of the git provider, or Salesforce Custom Object on the Dev Hub) and build a summary of the pool.
- **JSON Output:** With \`--json\`, the \`pool\` property holds the summary read by the VS Code extension panel. \`errorKind\` is \`noGitProvider\` when the storage cannot be reached.
- **Data Display:** It logs the pool configuration and the available scratch orgs to the console in a human-readable format.
- **Error Handling:** It checks if a scratch org pool is configured for the project and provides a warning message if it's not (\`errorKind\` is then \`noPool\`). The Dev Hub is optional: when one is connected, its scratch org limits are read live.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:scratch:pool:view --agent
\`\`\`

In agent mode, all interactive prompts are skipped and default values are used.

`;

  public static examples = ['$ sf hardis:scratch:pool:view',
    '$ sf hardis:scratch:pool:view --agent',];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
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
    'target-dev-hub': optionalHubFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ScratchPoolView);
    // Get pool configuration
    const config = await getConfig('project');
    const poolConfig = config.poolConfig || {};
    uxLog("log", this, t('poolConfig') + c.grey(JSON.stringify(poolConfig, null, 2)));

    // Missing scratch orgs pool configuration
    if (!poolConfig.storageService) {
      uxLog(
        "warning",
        this,
        c.yellow(t('noScratchOrgsPoolConfiguredLocalAuth'))
      );
      return { status: 1, outputString: 'Scratch org pool configuration to create', errorKind: 'noPool' };
    }

    // Read the pool. A storage that cannot be reached is an answer, not a question to the user
    let pool: PoolSummary | null = null;
    try {
      pool = await getPoolSummary({
        devHubConn: flags['target-dev-hub']?.getConnection(),
        devHubUsername: flags['target-dev-hub']?.getUsername(),
        noPrompt: true,
      });
    } catch (e) {
      uxLog("warning", this, c.yellow((e as Error).message));
      return {
        status: 1,
        outputString: 'Scratch org pool storage can not be reached',
        errorKind: poolConfig.storageService === 'gitProvider' ? 'noGitProvider' : 'storageError',
        errorMessage: (e as Error).message,
        storageService: poolConfig.storageService,
      };
    }
    if (pool === null) {
      return { status: 1, outputString: 'Scratch org pool storage can not be reached', errorKind: 'storageError', storageService: poolConfig.storageService };
    }

    // Display logs
    if (pool.orgs.length > 0) {
      await uxLogTableWithReport(
        this,
        pool.orgs.map((org) => ({ alias: org.alias, username: org.username, expirationDate: org.expirationDate, daysLeft: org.daysLeft })),
        ['alias', 'username', 'expirationDate', 'daysLeft'],
        { fileNamePrefix: 'scratch-org-pool', fileTitle: 'Scratch org pool' },
      );
    }
    if (pool.dashboardUrl) {
      uxLog("log", this, c.grey(t('poolDashboardUrl', { url: pool.dashboardUrl })));
    }
    if (pool.keyStatus === 'missing') {
      uxLog("warning", this, c.yellow(t('poolEncryptionKeyMissing', { variable: POOL_ENCRYPTION_KEY_ENV_VAR })));
    } else if (pool.keyStatus === 'mismatch') {
      uxLog("warning", this, c.yellow(t('poolEncryptionKeyMismatch', { variable: POOL_ENCRYPTION_KEY_ENV_VAR })));
    }
    uxLog("action", this, c.cyan(t('thereAreAvailableScratchOrgs', { availableNumber: c.bold(pool.available) })));

    // Return an object to be displayed with --json. It never holds the credentials of a scratch org.
    return {
      status: 0,
      outputString: 'Viewed scratch org pool',
      pool: pool as any,
      storageService: pool.storageService,
      dashboardUrl: pool.dashboardUrl,
      availableScratchOrgs: pool.available,
      maxScratchOrgs: poolConfig.maxScratchOrgsNumber,
    };
  }
}
