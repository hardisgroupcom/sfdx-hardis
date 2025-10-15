/* jscpd:ignore-start */
import { SfCommand, Flags, requiredHubFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { AuthInfo, Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { assert } from 'console';
import fs from 'fs-extra';
import moment from 'moment';
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
import {
  initApexScripts,
  initOrgData,
  initOrgMetadatas,
  initPermissionSetAssignments,
  installPackages,
  promptUserEmail,
} from '../../../common/utils/orgUtils.js';
import { addScratchOrgToPool, fetchScratchOrg } from '../../../common/utils/poolUtils.js';
import { prompts } from '../../../common/utils/prompts.js';
import { WebSocketClient } from '../../../common/websocketClient.js';
import { getConfig, setConfig } from '../../../config/index.js';

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
- **Package Installation:** Automatically installs all configured packages defined in \`installedPackages\` configuration property.
- **Metadata Deployment:** Pushes source code and deploys metadata using optimized deployment strategies for scratch org environments.
- **Permission Set Assignment:** Assigns specified permission sets defined in \`initPermissionSets\` configuration to the scratch org user.
- **Apex Script Execution:** Runs custom Apex initialization scripts defined in \`scratchOrgInitApexScripts\` for org-specific setup.
- **Data Loading:** Loads initial data using SFDMU data packages from \`dataPackages\` configuration for realistic development environments.
- **User Configuration:** Automatically configures the scratch org admin user with proper names, email, country settings, and marketing user permissions.
- **Password Generation:** Creates and stores secure passwords for easy scratch org access during development.
- **CI/CD Integration:** Provides specialized handling for continuous integration environments including automated cleanup and pool management.
- **Error Handling:** Comprehensive error recovery including scratch org cleanup on failure and detailed troubleshooting messages.

The command configuration can be customized using:

- \`config/.sfdx-hardis.yml\` file with properties like \`installedPackages\`, \`initPermissionSets\`, \`scratchOrgInitApexScripts\`, and \`dataPackages\`.
- Environment variable **SCRATCH_ORG_SHAPE** with shape org id, if you want to use org shapes

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Configuration Management:** Loads hierarchical configuration from \`.sfdx-hardis.yml\`, branch-specific, and user-specific configuration files using \`getConfig('user')\`.
- **Alias Generation Logic:** Creates intelligent scratch org aliases using username, git branch, timestamp patterns with CI and pool prefixes for different environments.
- **Scratch Org Definition Building:** Dynamically constructs \`project-scratch-def.json\` with user email, custom usernames, org shapes, and feature flags like StateAndCountryPicklist and MarketingUser.
- **Pool Integration:** Implements scratch org pool fetching using \`fetchScratchOrg\` for rapid org provisioning in development and CI environments.
- **Salesforce CLI Integration:** Executes \`sf org create scratch\` commands with proper parameter handling including wait times, duration, and dev hub targeting.
- **Package Installation Pipeline:** Uses \`installPackages\` utility to install managed and unmanaged packages with dependency resolution and error handling.
- **Metadata Deployment:** Leverages \`initOrgMetadatas\` for optimized source pushing and metadata deployment specific to scratch org environments.
- **Permission Set Assignment:** Implements \`initPermissionSetAssignments\` for automated permission set assignment to scratch org users.
- **Apex Script Execution:** Runs custom Apex initialization scripts using \`initApexScripts\` for org-specific configuration and setup.
- **Data Loading Integration:** Uses SFDMU integration through \`initOrgData\` for comprehensive data loading from configured data packages.
- **User Management:** Performs SOQL queries and DML operations to configure scratch org users with proper names, emails, country codes, and permission flags.
- **Authentication Management:** Handles SFDX auth URL generation and storage for CI/CD environments and scratch org pool management.
- **Error Recovery:** Implements comprehensive error handling with scratch org cleanup, pool management, and detailed error messaging for troubleshooting.
- **WebSocket Integration:** Provides real-time status updates and file reporting through WebSocket connections for VS Code extension integration.
</details>
`;

  public static examples = ['$ sf hardis:scratch:create'];

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
    elapseStart(`Create and initialize scratch org`);
    await this.initConfig();
    await this.createScratchOrg(flags);
    try {
      await this.updateScratchOrgUser();
      await installPackages(this.configInfo.installedPackages || [], this.scratchOrgAlias);
      if (this.pool === false) {
        await initOrgMetadatas(
          this.configInfo,
          this.scratchOrgUsername,
          this.scratchOrgAlias,
          this.projectScratchDef,
          this.debugMode,
          {
            scratch: true,
          }
        );
        await initPermissionSetAssignments(this.configInfo.initPermissionSets || [], this.scratchOrgUsername);
        await initApexScripts(this.configInfo.scratchOrgInitApexScripts || [], this.scratchOrgUsername);
        await initOrgData(path.join('.', 'scripts', 'data', 'ScratchInit'), this.scratchOrgUsername);
      }
    } catch (e) {
      elapseEnd(`Create and initialize scratch org`);
      uxLog("log", this, c.grey('Error: ' + (e as Error).message + '\n' + (e as Error).stack));
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
        uxLog("error", this, c.red('Deleted scratch org as we are in CI and its creation has failed'));
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
      moment().format('YYYYMMDD_hhmm');
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
    if (!isCI && this.scratchOrgAlias !== newScratchName && this.pool === false) {
      const checkRes = await prompts({
        type: 'confirm',
        name: 'value',
        message: c.cyanBright(
          `You are about to reuse scratch org ${c.green(
            this.scratchOrgAlias
          )}. Are you sure that's what you want to do ?\n${c.grey(
            '(if not, run again hardis:work:new or use hardis:scratch:create --forcenew)'
          )}`
        ),
        default: false,
        description: 'Confirm that you want to reuse this existing scratch org instead of creating a new one',
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
      if (this.pool === true) {
        throw new SfError(c.red('You need to define userEmail property in .sfdx-hardis.yml'));
      }
      this.userEmail = await promptUserEmail();
    }
  }

  // Create a new scratch org or reuse existing one
  public async createScratchOrg(flags) {
    // Build project-scratch-def-branch-user.json
    uxLog("action", this, c.cyan('Building custom project-scratch-def.json...'));
    this.projectScratchDef = JSON.parse(fs.readFileSync('./config/project-scratch-def.json', 'utf-8'));
    this.projectScratchDef.orgName = this.scratchOrgAlias;
    this.projectScratchDef.adminEmail = this.userEmail;
    // Keep only first 15 and last 15 chars if scratch org alias is too long
    const aliasForUsername = this.scratchOrgAlias.length > 30 ? this.scratchOrgAlias.slice(0, 15) + this.scratchOrgAlias.slice(-15) : this.scratchOrgAlias;
    this.projectScratchDef.username = `${this.userEmail.split('@')[0].slice(0, 20)}@hardis-scratch-${aliasForUsername}.com`;
    if (process.env.SCRATCH_ORG_SHAPE || this.configInfo.scratchOrgShape) {
      this.projectScratchDef.sourceOrg = process.env.SCRATCH_ORG_SHAPE || this.configInfo.scratchOrgShape;
    }
    uxLog("log", this, c.grey("Project scratch def: \n" + JSON.stringify(this.projectScratchDef, null, 2)));
    const projectScratchDefLocal = `./config/user/project-scratch-def-${this.scratchOrgAlias}.json`;
    await fs.ensureDir(path.dirname(projectScratchDefLocal));
    await fs.writeFile(projectScratchDefLocal, JSON.stringify(this.projectScratchDef, null, 2));
    WebSocketClient.sendReportFileMessage(projectScratchDefLocal, "Scratch Org definition", "report");

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
      uxLog("action", this, c.cyan(`Reusing org ${c.green(this.scratchOrgAlias)} with user ${c.green(this.scratchOrgUsername)}`));
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
          await execSfdxJson('sf org open', this, {
            fail: true,
            output: false,
            debug: this.debugMode,
          });
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
      uxLog("log", this, c.grey('Deleted ' + tmpShapeFolder));
    }

    // Create new scratch org
    uxLog("action", this, c.cyan('Creating new scratch org...'));
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
      const displayOrgCommand = `sf org display -o ${this.scratchOrgAlias} --verbose`;
      const displayResult = await execSfdxJson(displayOrgCommand, this, {
        fail: true,
        output: false,
        debug: this.debugMode,
      });
      if (displayResult.result.sfdxAuthUrl) {
        await setConfig('user', {
          scratchOrgSfdxAuthUrl: displayResult.result.sfdxAuthUrl,
        });
        this.scratchOrgSfdxAuthUrl = displayResult.result.sfdxAuthUrl;
      } else {
        // Try to get sfdxAuthUrl with workaround
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
              `Unable to fetch sfdxAuthUrl for ${displayResult.result.username}. Only Scratch Orgs created from DevHub using authenticated using sf org login sfdx-url or sf org login web will have access token and enabled for autoLogin\nYou may need to define SFDX_AUTH_URL_DEV_HUB or SFDX_AUTH_URL_devHubAlias in your CI job running sf hardis:scratch:pool:refresh`
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
      // Display org URL
      const openRes = await execSfdxJson('sf org open --url-only', this, {
        fail: true,
        output: false,
        debug: this.debugMode,
      });
      uxLog("action", this, c.cyan(`Open scratch org with url: ${c.green(openRes?.result?.url)}`));
    } else {
      // Open scratch org for user if not in CI
      await execSfdxJson('sf org open', this, {
        fail: true,
        output: false,
        debug: this.debugMode,
      });
    }
    uxLog(
      "action",
      this,
      c.cyan(`Created scratch org ${c.green(this.scratchOrgAlias)} with user ${c.green(this.scratchOrgUsername)}`)
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
    uxLog("action", this, c.cyan('Update / fix scratch org user ' + this.scratchOrgUsername));
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
