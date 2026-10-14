/* jscpd:ignore-start */
import c from 'chalk';
import { SfCommand, Flags, requiredHubFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { AuthInfo, Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { getConfig, setConfig } from '../../../../config/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { instantiateProvider, listKeyValueProviders } from '../../../../common/utils/poolUtils.js';
import { PoolStorageInterface } from '../../../../common/utils/keyValueUtils.js';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ScratchPoolCreate extends SfCommand<any> {
  public static title = 'Create and configure scratch org pool';

  public static description = `
## Command Behavior

**Configures a scratch org pool for the project: where the pool is stored, and how many scratch orgs it holds.**

A pool keeps scratch orgs ready, so a CI job or a developer gets one in seconds instead of waiting for its creation.

Key functionalities:

- **Storage choice:** \`gitProvider\` stores the pool in a "Scratch Orgs Pool Dashboard" of your git provider: an issue on GitHub and GitLab, a work item on Azure DevOps, a dedicated Pull Request on Bitbucket. \`salesforce\` stores it in a custom object of the Dev Hub.
- **Encryption (\`gitProvider\` storage):** the credentials of the scratch orgs are encrypted. The command generates the key and displays it once: store it in a masked CI variable named \`SFDX_HARDIS_POOL_ENCRYPTION_KEY\`.
- **Pool size:** saves \`poolConfig.maxScratchOrgsNumber\` in \`.sfdx-hardis.yml\`.
- **Existing configuration:** the command stops when a pool is already configured. Remove \`poolConfig\` from \`.sfdx-hardis.yml\` to configure it again.

Once the pool is configured, schedule a CI job that fills it:

- Set the CI variables \`USE_SCRATCH_ORGS\` and \`SCRATCH_ORG_POOL\` to \`true\`
- The job runs:

\`\`\`shell
sf hardis:auth:login --devhub
sf hardis:scratch:pool:refresh
\`\`\`

<details markdown="1">
<summary>Technical explanations</summary>

- **Storage providers:** \`listKeyValueProviders\` lists the available storages, \`instantiateProvider\` builds the selected one, and its \`userSetup\` method prepares it (dashboard creation, or deployment of the custom object on the Dev Hub).
- **Configuration:** \`poolConfig\` is written in the project configuration with \`setConfig\`.
- **Git provider storage:** the git provider is detected from the tokens of the environment (\`GITHUB_TOKEN\`, \`CI_SFDX_HARDIS_GITLAB_TOKEN\`, \`CI_SFDX_HARDIS_AZURE_TOKEN\`, \`CI_SFDX_HARDIS_BITBUCKET_TOKEN\`), read from the \`.env\` file or sent by the VS Code extension.
- **Encryption:** AES-256-GCM, with a key derived from \`SFDX_HARDIS_POOL_ENCRYPTION_KEY\`. A key already present in the environment is reused.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:scratch:pool:create --agent --storage-service gitProvider --max-scratch-orgs 5
\`\`\`

In agent mode:

- No prompt is displayed.
- \`--storage-service\` defaults to \`gitProvider\`.
- \`--max-scratch-orgs\` defaults to 5.
`;

  public static examples = [
    '$ sf hardis:scratch:pool:create',
    '$ sf hardis:scratch:pool:create --agent',
    '$ sf hardis:scratch:pool:create --agent --storage-service gitProvider --max-scratch-orgs 5',
  ];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    'storage-service': Flags.string({
      options: ['gitProvider', 'salesforce', 'localtest'],
      description: 'Where the pool is stored (asked when not set)',
    }),
    'max-scratch-orgs': Flags.integer({
      min: 1,
      description: 'Maximum number of scratch orgs in the pool (asked when not set)',
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
    'target-dev-hub': requiredHubFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    // Get pool configuration
    const { flags } = await this.parse(ScratchPoolCreate);
    const agentMode = flags.agent === true;
    const config = await getConfig('project');
    const poolConfig = config.poolConfig || {};

    // Tell user if he/she's about to overwrite existing configuration
    if (config.poolConfig && Object.keys(poolConfig).length > 0) {
      uxLog(
        "warning",
        this,
        c.yellow(
          `There is already an existing scratch org pool configuration: ${JSON.stringify(config.poolConfig)}.
If you really want to replace it, please remove poolConfig property from .sfdx-hardis.yml and run again this command`
        )
      );
      return { outputString: 'Scratch org pool configuration already existing' };
    }

    let storageService: string | undefined = flags['storage-service'];
    let maxScratchOrgsNumber: number | undefined = flags['max-scratch-orgs'];
    if (!isCI && !agentMode) {
      const allProviders = await listKeyValueProviders();
      if (!storageService) {
        const storageResponse = await prompts({
          type: 'select',
          name: 'storageService',
          message: c.cyanBright(t('whatStorageServiceDoYouWantTo')),
          description: t('chooseStorageBackendForScratchOrgPools'),
          placeholder: t('selectAStorageService'),
          initial: 0,
          choices: allProviders.map((provider: PoolStorageInterface) => {
            return { title: provider.name, description: provider.description, value: provider.name };
          }),
        });
        storageService = storageResponse.storageService;
      }
      if (!maxScratchOrgsNumber) {
        const maxResponse = await prompts({
          type: 'number',
          name: 'maxScratchOrgsNumber',
          message: c.cyanBright(t('whatIsTheMaximumNumberOfScratch')),
          description: t('setMaximumScratchOrgsInPool'),
          placeholder: t('exFiveNumber'),
          initial: poolConfig.maxScratchOrgsNumber || 5,
        });
        maxScratchOrgsNumber = maxResponse.maxScratchOrgsNumber;
      }
    }
    storageService = storageService || 'gitProvider';
    maxScratchOrgsNumber = maxScratchOrgsNumber || 5;
    uxLog("action", this, c.cyan(t('poolConfiguringStorage', { storageService: c.green(storageService), max: maxScratchOrgsNumber })));

    // Prepare the storage first: a setup that fails must not leave a pool configuration behind
    const provider = await instantiateProvider(storageService);
    await provider.userSetup({
      devHubConn: flags['target-dev-hub'].getConnection(),
      devHubUsername: flags['target-dev-hub'].getUsername(),
      maxScratchOrgsNumber,
    });

    // Store updated config
    poolConfig.maxScratchOrgsNumber = maxScratchOrgsNumber;
    poolConfig.storageService = storageService;
    await setConfig('project', { poolConfig: poolConfig });

    const authInfo = await AuthInfo.create({ username: flags['target-dev-hub'].getUsername() });
    const sfdxAuthUrl = authInfo.getSfdxAuthUrl();
    if (sfdxAuthUrl) {
      uxLog(
        "action",
        this,
        c.cyan(t('youNeedToDefineCiMaskedVariableDevHub', { sfdxAuthUrl: c.green(sfdxAuthUrl) }))
      );
    } else {
      uxLog(
        "warning",
        this,
        c.yellow(t('youllProbablyNeedToDefineCiMaskedVar'))
      );
    }

    // Return an object to be displayed with --json
    return { outputString: 'Configured scratch orgs pool', storageService, maxScratchOrgsNumber };
  }
}
