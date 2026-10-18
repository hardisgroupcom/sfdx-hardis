/* jscpd:ignore-start */
import { SfCommand, Flags, requiredHubFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { AuthInfo, Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { assert } from 'console';
import fs from '../../../common/utils/fsUtils.js';
import { dateHelper } from '../../../common/utils/dateHelper.js';
import * as os from 'os';
import * as path from 'path';
import { clearCache } from '../../../common/cache/index.js';
import {
  elapseEnd,
  elapseStart,
  execCommand,
  execSfdxJson,
  getCurrentGitBranch,
  isCI,
  uxLog,
} from '../../../common/utils/index.js';
import { getScratchSignupEnv, openOrgInBrowser, promptUserEmail } from '../../../common/utils/orgUtils.js';
import { PROJECT_SCRATCH_DEF_FILE, runOrgInitSteps, validateScratchOrgDef } from '../../../common/utils/orgInitUtils.js';
import { addScratchOrgToPool, fetchScratchOrg } from '../../../common/utils/poolUtils.js';
import { getOrgSfdxAuthUrl } from '../../../common/utils/credentialUtils.js';
import { prompts } from '../../../common/utils/prompts.js';
import { WebSocketClient } from '../../../common/websocketClient.js';
import { getConfig, setConfig } from '../../../config/index.js';
import { t } from '../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ScratchCreate extends SfCommand<any> {
  public static title = 'Create and initialize scratch org';

  public static description = `
## Command Behavior

**Creates and fully initializes a Salesforce scratch org with complete development environment setup.**

This command is a comprehensive scratch org provisioning tool that automates the entire process of creating, configuring, and initializing a Salesforce scratch org for development work. It handles everything from basic org creation to advanced configuration including package installation, metadata deployment, and data initialization.

Key functionalities:

- **Intelligent Org Management:** Automatically generates unique scratch org aliases based on username, git branch, and timestamp, with options to reuse existing orgs or force creation of new ones.
- **Scratch Org Pool Integration:** Supports fetching pre-configured scratch orgs from pools for faster development cycles and CI/CD optimization.
- **Custom Scratch Definition:** Dynamically builds project-scratch-def.json files with user-specific configurations including email, username patterns, and org shape settings (set variable **SCRATCH_ORG_SHAPE** to use org shapes).
- **Scratch Org Definition Check:** Validates \`config/project-scratch-def.json\` against the Salesforce CLI schema before asking the Dev Hub for an org, and lists every issue found.
- **Initialization Steps:** Runs the org initialization steps of the project in their order: packages, project sources, permission sets, Apex scripts, data, custom commands... They are defined in \`orgInitSteps\` (edit them from the Org Initialization panel of the VS Code extension). Without that key, the steps are built from the older keys \`installedPackages\`, \`initPermissionSets\`, \`scratchOrgInitApexScripts\`, \`dataPackages\` and the \`scripts/data/ScratchInit\` folder.
- **Pool Readiness:** When filling a scratch org pool (\`--pool\`), the steps flagged \`runAtPoolFill\` (all of them by default) run right away, so a scratch org taken from the pool is ready to use. Taking an org from the pool runs the remaining steps.
- **User Configuration:** Automatically configures the scratch org admin user with proper names, email, country settings, and marketing user permissions.
- **Password Generation:** Creates and stores secure passwords for easy scratch org access during development.
- **CI/CD Integration:** Provides specialized handling for continuous integration environments including automated cleanup and pool management.
- **Error Handling:** Comprehensive error recovery including scratch org cleanup on failure and detailed troubleshooting messages.

The command configuration can be customized using:

- \`config/.sfdx-hardis.yml\` file with properties like \`orgInitSteps\`, \`installedPackages\`, \`scratchOrgDuration\` and \`poolConfig\`.
- Environment variable **SCRATCH_ORG_SHAPE** with shape org id, if you want to use org shapes
- Environment variables **SF_SCRATCH_SIGNUP_CONNECTED_APP** and **SF_SCRATCH_SIGNUP_CALLBACK_URL**: by default the new org is signed up with the Salesforce CLI built-in app (\`PlatformCLI\`), so a Dev Hub authenticated through an External Client App works (Salesforce CLI 2.147.7 or later). Not applied when you set **SF_SCRATCH_SIGNUP_CONNECTED_APP** or **SFDX_CLIENT_SECRET**.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Configuration Management:** Loads hierarchical configuration from \`.sfdx-hardis.yml\`, branch-specific, and user-specific configuration files using \`getConfig('user')\`.
- **Alias Generation Logic:** Creates intelligent scratch org aliases using username, git branch, timestamp patterns with CI and pool prefixes for different environments.
- **Scratch Org Definition Building:** Dynamically constructs \`project-scratch-def.json\` with user email, custom usernames, org shapes, and feature flags like StateAndCountryPicklist and MarketingUser.
- **Pool Integration:** Implements scratch org pool fetching using \`fetchScratchOrg\` for rapid org provisioning in development and CI environments.
- **Salesforce CLI Integration:** Executes \`sf org create scratch\` commands with proper parameter handling including wait times, duration, and dev hub targeting.
- **Initialization Steps:** \`runOrgInitSteps\` (\`src/common/utils/orgInitUtils.ts\`) runs the steps with the deployment actions providers, plus the \`install-packages\`, \`deploy-sources\` and \`assign-permission-sets\` types. The phase is \`pool-fill\` with \`--pool\`, \`after-pool-fetch\` for an org taken from the pool, \`all\` otherwise.
- **Definition Validation:** \`validateScratchOrgDef\` uses \`ScratchOrgDefSchema\` from \`@salesforce/core\`, then checks each \`settings\` name against the Salesforce CLI JSON schema.
- **User Management:** Performs SOQL queries and DML operations to configure scratch org users with proper names, emails, country codes, and permission flags.
- **Authentication Management:** Handles SFDX auth URL generation and storage for CI/CD environments and scratch org pool management.
- **Error Recovery:** Implements comprehensive error handling with scratch org cleanup, pool management, and detailed error messaging for troubleshooting.
- **WebSocket Integration:** Provides real-time status updates and file reporting through WebSocket connections for VS Code extension integration.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:scratch:create --agent --target-dev-hub mydevhub@example.com
\`\`\`

In agent mode:

- The scratch org reuse confirmation prompt is skipped and a new org is always created.
- All other interactive prompts are skipped.
`;

  public static examples = ['$ sf hardis:scratch:create', '$ sf hardis:scratch:create --agent'];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    forcenew: Flags.boolean({
      char: 'n',
      default: false,
      description: messages.getMessage('forceNewScratch'),
    }),
    pool: Flags.boolean({
      default: false,
      description: 'Creates the scratch org for a scratch org pool',
    }),
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
    'target-dev-hub': requiredHubFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ['sfdmu'];

  protected forceNew = false;

  /* jscpd:ignore-end */

  protected debugMode = false;
  protected agentMode = false;
  protected pool = false;
  protected configInfo: any;
  protected devHubAlias: string;
  protected scratchOrgAlias: string;
  protected scratchOrgDuration: number;
  protected userEmail: string;

  protected gitBranch: string;
  protected projectScratchDef: any;
  protected scratchOrgInfo: any;
  protected scratchOrgUsername: string;
  protected scratchOrgPassword: string;
  protected scratchOrgSfdxAuthUrl: string | null;
  protected authFileJson: any;
  protected projectName: string;
  protected scratchOrgFromPool: any;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ScratchCreate);
    this.pool = flags.pool || false;
    this.debugMode = flags.debug || false;
    this.forceNew = flags.forcenew || false;
    this.agentMode = flags.agent === true;
    elapseStart(`Create and initialize scratch org`);
    await this.initConfig();
    await this.createScratchOrg(flags);
    try {
      await this.updateScratchOrgUser();
      // Pool fill: the steps flagged runAtPoolFill (all by default), so an org taken from the pool
      // is ready. Org taken from the pool: the steps left. New org: every step.
      await runOrgInitSteps({
        orgUsername: this.scratchOrgUsername,
        orgAlias: this.scratchOrgAlias,
        orgType: 'scratch',
        phase: this.pool ? 'pool-fill' : this.scratchOrgFromPool ? 'after-pool-fetch' : 'all',
        projectScratchDef: this.projectScratchDef,
        debugMode: this.debugMode,
        config: this.configInfo,
      });
    } catch (e) {
      elapseEnd(`Create and initialize scratch org`);
      uxLog("log", this, c.grey(t('error2') + (e as Error).message + '\n' + (e as Error).stack));
      if (isCI && this.scratchOrgFromPool) {
        this.scratchOrgFromPool.failures = this.scratchOrgFromPool.failures || [];
        this.scratchOrgFromPool.failures.push(JSON.stringify(e, null, 2));
        uxLog(
          "log",
          this,
          '[pool] ' +
          c.yellow('Put back scratch org in the scratch orgs pool. ') +
          c.grey({ result: this.scratchOrgFromPool })
        );
        await addScratchOrgToPool(this.scratchOrgFromPool, { position: 'first' });
      } else if (isCI && this.scratchOrgUsername) {
        await execCommand(`sf org delete scratch --no-prompt --target-org ${this.scratchOrgUsername}`, this, {
          fail: false,
          output: true,
        });
        uxLog("error", this, c.red(t('deletedScratchOrgAsWeAreIn')));
      }
      throw e;
    }

    // Show password to user
    if (this.scratchOrgPassword) {
      uxLog(
        "action",
        this,
        c.cyan(
          `You can connect to your scratch using username ${c.green(this.scratchOrgUsername)} and password ${c.green(
            this.scratchOrgPassword
          )}`
        )
      );
    }
    elapseEnd(`Create and initialize scratch org`);
    // Return an object to be displayed with --json
    return {
      status: 0,
      scratchOrgAlias: this.scratchOrgAlias,
      scratchOrgInfo: this.scratchOrgInfo,
      scratchOrgUsername: this.scratchOrgUsername,
      scratchOrgPassword: this.scratchOrgPassword,
      scratchOrgSfdxAuthUrl: this.scratchOrgSfdxAuthUrl,
      authFileJson: this.authFileJson,
      outputString: 'Created and initialized scratch org',
    };
  }

  // Initialize configuration from .sfdx-hardis.yml + .gitbranch.sfdx-hardis.yml + .username.sfdx-hardis.yml
  public async initConfig() {
    this.configInfo = await getConfig('user');
    this.gitBranch = (await getCurrentGitBranch({ formatted: true })) || '';
    const newScratchName =
      os.userInfo().username +
      '-' +
      (this.gitBranch.split('/').pop() || '').slice(0, 15) +
      '_' +
      dateHelper().format('YYYYMMDD_hhmm');
    this.scratchOrgAlias =
      process.env.SCRATCH_ORG_ALIAS ||
      (!this.forceNew && this.pool == false ? this.configInfo.scratchOrgAlias : null) ||
      newScratchName;
    if (isCI && !this.scratchOrgAlias.startsWith('CI-')) {
      this.scratchOrgAlias = 'CI-' + this.scratchOrgAlias;
    }
    if (this.pool === true) {
      this.scratchOrgAlias = 'PO-' + Math.random().toString(36).substr(2, 2) + this.scratchOrgAlias;
    }
    // Verify that the user wants to resume scratch org creation
    if (!isCI && !this.agentMode && this.scratchOrgAlias !== newScratchName && this.pool === false) {
      const checkRes = await prompts({
        type: 'confirm',
        name: 'value',
        message: c.cyanBright(
          t('aboutToReuseScratchOrgAreYouSure', { alias: c.green(this.scratchOrgAlias) }) +
          '\n' + c.grey(t('ifNotRunAgainHardisWorkNew'))
        ),
        default: false,
        description: t('confirmReuseExistingScratchOrg'),
      });
      if (checkRes.value === false) {
        process.exit(0);
      }
    }
    this.projectName = process.env.PROJECT_NAME || this.configInfo.projectName;
    this.devHubAlias = process.env.DEVHUB_ALIAS || this.configInfo.devHubAlias;

    this.scratchOrgDuration = process.env?.SCRATCH_ORG_DURATION
      ? process.env.SCRATCH_ORG_DURATION // Priority to global variable if defined
      : isCI && this.pool === false
        ? 1 // If CI and not during pool feed job, default is 1 day because the scratch will not be used after the job
        : this.configInfo?.scratchOrgDuration
          ? this.configInfo.scratchOrgDuration // Override default value in scratchOrgDuration
          : 30; // Default value: 30

    this.userEmail = process.env.USER_EMAIL || process.env.GITLAB_USER_EMAIL || this.configInfo.userEmail;

    // If not found, prompt user email and store it in user config file
    if (this.userEmail == null) {
      if (this.pool === true || this.agentMode) {
        throw new SfError(c.red('You need to define userEmail property in .sfdx-hardis.yml or set USER_EMAIL env var.'));
      }
      this.userEmail = await promptUserEmail();
    }
  }

  // Create a new scratch org or reuse existing one
  public async createScratchOrg(flags) {
    // Build project-scratch-def-branch-user.json
    uxLog("action", this, c.cyan(t('buildingCustomProjectScratchDefJson')));
    this.projectScratchDef = JSON.parse(fs.readFileSync('./config/project-scratch-def.json', 'utf-8'));
    // Salesforce CLI only warns on an invalid definition, then the org creation fails far later
    const scratchDefIssues = validateScratchOrgDef(this.projectScratchDef);
    if (scratchDefIssues.length > 0) {
      throw new SfError(
        t('scratchOrgDefInvalid', {
          file: PROJECT_SCRATCH_DEF_FILE,
          issues: scratchDefIssues.map((issue) => `- ${issue}`).join('\n'),
        })
      );
    }
    this.projectScratchDef.orgName = this.scratchOrgAlias;
    this.projectScratchDef.adminEmail = this.userEmail;
    // Keep only first 15 and last 15 chars if scratch org alias is too long
    const aliasForUsername = this.scratchOrgAlias.length > 30 ? this.scratchOrgAlias.slice(0, 15) + this.scratchOrgAlias.slice(-15) : this.scratchOrgAlias;
    this.projectScratchDef.username = `${this.userEmail.split('@')[0].slice(0, 20)}@hardis-scratch-${aliasForUsername}.com`;
    if (process.env.SCRATCH_ORG_SHAPE || this.configInfo.scratchOrgShape) {
      this.projectScratchDef.sourceOrg = process.env.SCRATCH_ORG_SHAPE || this.configInfo.scratchOrgShape;
    }
    uxLog("log", this, c.grey(t('projectScratchDef') + JSON.stringify(this.projectScratchDef, null, 2)));
    const projectScratchDefLocal = `./config/user/project-scratch-def-${this.scratchOrgAlias}.json`;
    await fs.ensureDir(path.dirname(projectScratchDefLocal));
    await fs.writeFile(projectScratchDefLocal, JSON.stringify(this.projectScratchDef, null, 2));
    WebSocketClient.sendReportFileMessage(projectScratchDefLocal, t('scratchOrgDefinition'), "report");

    // Check current scratch org
    const orgListResult = await execSfdxJson('sf org list', this);
    const hubOrgUsername = flags['target-dev-hub'].getUsername();
    const matchingScratchOrgs =
      orgListResult?.result?.scratchOrgs?.filter((org: any) => {
        return org.alias === this.scratchOrgAlias && org.status === 'Active' && org.devHubUsername === hubOrgUsername;
      }) || [];
    // Reuse existing scratch org
    if (matchingScratchOrgs?.length > 0 && !this.forceNew && this.pool == false) {
      this.scratchOrgInfo = matchingScratchOrgs[0];
      this.scratchOrgUsername = this.scratchOrgInfo.username;
      uxLog("action", this, c.cyan(t('reusingOrgWithUser', { scratchOrgAlias: c.green(this.scratchOrgAlias), scratchOrgUsername: c.green(this.scratchOrgUsername) })));
      return;
    }
    // Try to fetch a scratch org from the pool
    if (this.pool === false && this.configInfo.poolConfig) {
      this.scratchOrgFromPool = await fetchScratchOrg({
        devHubConn: flags['target-dev-hub'].getConnection(),
        devHubUsername: flags['target-dev-hub'].getUsername(),
      });
      if (this.scratchOrgFromPool) {
        this.scratchOrgAlias = this.scratchOrgFromPool.scratchOrgAlias;
        this.scratchOrgInfo = this.scratchOrgFromPool.scratchOrgInfo;
        this.scratchOrgUsername = this.scratchOrgFromPool.scratchOrgUsername;
        this.scratchOrgPassword = this.scratchOrgFromPool.scratchOrgPassword;
        await setConfig('user', { scratchOrgAlias: this.scratchOrgAlias });
        uxLog(
          "log",
          this,
          '[pool] ' +
          c.cyan(
            `Fetched org ${c.green(this.scratchOrgAlias)} from pool with user ${c.green(this.scratchOrgUsername)}`
          )
        );
        if (!isCI) {
          uxLog(
            "action",
            this,
            c.cyan('Now opening org...') +
            ' ' +
            c.yellow('(The org is not ready to work in until this script is completed !)')
          );
          await openOrgInBrowser(this, { debug: this.debugMode });
          // Trigger a status refresh on VS Code WebSocket Client
          WebSocketClient.sendRefreshStatusMessage();
        }
        return;
      }
    }

    // Fix @salesforce/cli bug: remove shape.zip if found
    const tmpShapeFolder = path.join(os.tmpdir(), 'shape');
    if (fs.existsSync(tmpShapeFolder) && this.pool === false) {
      await fs.remove(tmpShapeFolder);
      uxLog("log", this, c.grey(t('deleted') + tmpShapeFolder));
    }

    // Create new scratch org
    uxLog("action", this, c.cyan(t('creatingNewScratchOrg')));
    const waitTime = process.env.SCRATCH_ORG_WAIT || '15';
    const createCommand =
      'sf org create scratch --set-default ' +
      `--definition-file ${projectScratchDefLocal} ` +
      `--alias ${this.scratchOrgAlias} ` +
      `--wait ${waitTime} ` +
      `--target-dev-hub ${this.devHubAlias} ` +
      `--duration-days ${this.scratchOrgDuration}`;
    const createResult = await execSfdxJson(createCommand, this, {
      fail: false,
      output: false,
      debug: this.debugMode,
      env: getScratchSignupEnv(),
    });
    await clearCache('sf org list');
    if (!createResult || createResult.status !== 0 || !createResult.result) {
      uxLog("error", this, this.buildScratchCreateErrorMessage(createResult));
      throw new SfError('Scratch org creation failed');
    }
    assert(createResult.status === 0 && createResult.result, this.buildScratchCreateErrorMessage(createResult));
    this.scratchOrgInfo = createResult.result;
    this.scratchOrgUsername = this.scratchOrgInfo.username;
    await setConfig('user', {
      scratchOrgAlias: this.scratchOrgAlias,
      scratchOrgUsername: this.scratchOrgUsername,
    });
    // Generate password
    const passwordCommand = `sf org generate password --target-org ${this.scratchOrgUsername}`;
    const passwordResult = await execSfdxJson(passwordCommand, this, {
      fail: true,
      output: false,
      debug: this.debugMode,
    });
    this.scratchOrgPassword = passwordResult.result.password;
    await setConfig('user', {
      scratchOrgPassword: this.scratchOrgPassword,
    });
    // Trigger a status refresh on VS Code WebSocket Client
    WebSocketClient.sendRefreshStatusMessage();

    if (isCI || this.pool === true) {
      // Try to store sfdxAuthUrl for scratch org reuse during CI
      const displayOrgCommand = `sf org display -o ${this.scratchOrgAlias}`;
      const displayResult = await execSfdxJson(displayOrgCommand, this, {
        fail: true,
        output: false,
        debug: this.debugMode,
      });
      const authUrlFromCommand = await getOrgSfdxAuthUrl(this.scratchOrgAlias, { fail: false, debug: this.debugMode });
      if (authUrlFromCommand) {
        await setConfig('user', {
          scratchOrgSfdxAuthUrl: authUrlFromCommand,
        });
        this.scratchOrgSfdxAuthUrl = authUrlFromCommand;
        displayResult.result.sfdxAuthUrl = authUrlFromCommand;
      } else {
        // Fallback: read auth file directly via @salesforce/core
        try {
          const authInfo = await AuthInfo.create({ username: displayResult.result.username });
          this.scratchOrgSfdxAuthUrl = authInfo.getSfdxAuthUrl();
          displayResult.result.sfdxAuthUrl = this.scratchOrgSfdxAuthUrl;
          await setConfig('user', {
            scratchOrgSfdxAuthUrl: this.scratchOrgSfdxAuthUrl,
          });
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (error) {
          uxLog(
            "warning",
            this,
            c.yellow(
              t('unableToFetchSfdxAuthUrlForScratch', { username: displayResult.result.username })
            )
          );
          this.scratchOrgSfdxAuthUrl = null;
        }
      }
      if (this.pool) {
        await setConfig('user', {
          authFileJson: displayResult,
        });
        this.authFileJson = displayResult;
      }
    }
    // Open scratch org for user (in CI and container mode, log the link instead)
    await openOrgInBrowser(this, { debug: this.debugMode });
    uxLog(
      "action",
      this,
      c.cyan(t('createdScratchOrgWithUser', { alias: c.green(this.scratchOrgAlias), username: c.green(this.scratchOrgUsername) }))
    );
  }

  public buildScratchCreateErrorMessage(createResult) {
    if (createResult.status === 0 && createResult.result) {
      return c.green('Scratch create OK');
    } else if (
      createResult.status === 1 &&
      createResult.errorMessage.includes('Socket timeout occurred while listening for results')
    ) {
      return c.red(
        `[sfdx-hardis] Error creating scratch org. ${c.bold(
          'This is probably a Salesforce error, try again manually or launch again CI job'
        )}\n${JSON.stringify(createResult, null, 2)}`
      );
    } else if (createResult.status === 1 && createResult.errorMessage.includes('LIMIT_EXCEEDED')) {
      return c.red(
        `[sfdx-hardis] Error creating scratch org. ${c.bold(
          'It seems you have no more scratch orgs available, go delete some in "Active Scratch Orgs" tab in the Dev Hub org'
        )}\n${JSON.stringify(createResult, null, 2)}`
      );
    }
    return c.red(
      `[sfdx-hardis] Error creating scratch org. Maybe try ${c.yellow(
        c.bold('sf hardis:scratch:create --forcenew')
      )} ?\n${JSON.stringify(createResult, null, 2)}`
    );
  }

  // Update scratch org user
  public async updateScratchOrgUser() {
    const config = await getConfig('user');
    // Update scratch org main user
    uxLog("action", this, c.cyan(t('updateFixScratchOrgUser') + this.scratchOrgUsername));
    const userQueryCommand = `sf data get record --sobject User --where "Username=${this.scratchOrgUsername}" --target-org ${this.scratchOrgAlias}`;
    const userQueryRes = await execSfdxJson(userQueryCommand, this, {
      fail: true,
      output: false,
      debug: this.debugMode,
    });
    let updatedUserValues = `LastName='SFDX-HARDIS' FirstName='Scratch Org'`;
    if (config.userEmail !== userQueryRes.result.CountryCode) {
      updatedUserValues += ` Email='${config.userEmail}'`;
    }
    // Fix country value is State & Country picklist activated
    if (
      (this.projectScratchDef.features || []).includes('StateAndCountryPicklist') &&
      userQueryRes.result.CountryCode == null
    ) {
      updatedUserValues += ` CountryCode='${config.defaultCountryCode || 'FR'}' Country='${config.defaultCountry || 'France'
        }'`;
    }
    if (
      (this.projectScratchDef.features || []).includes('MarketingUser') &&
      userQueryRes.result.UserPermissionsMarketingUser === false
    ) {
      // Make sure MarketingUser is checked on scratch org user if it is supposed to be
      updatedUserValues += ' UserPermissionsMarketingUser=true';
    }
    const userUpdateCommand = `sf data update record --sobject User --record-id ${userQueryRes.result.Id} --values "${updatedUserValues}" --target-org ${this.scratchOrgAlias}`;
    await execSfdxJson(userUpdateCommand, this, { fail: false, output: true, debug: this.debugMode });
  }
}
