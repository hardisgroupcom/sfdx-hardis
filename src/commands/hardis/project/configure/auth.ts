/* jscpd:ignore-start */
import {
  SfCommand,
  Flags,
  optionalOrgFlagWithDeprecations,
  optionalHubFlagWithDeprecations,
} from '@salesforce/sf-plugins-core';
import { fs, Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import * as yaml from 'js-yaml';
import { buildOrgSlugFromInstanceUrl, execSfdxJson, generateSSLCertificate, git, isCI, promptInstanceUrl, uxLog } from '../../../../common/utils/index.js';
import { getOrgAliasUsername, promptOrg } from '../../../../common/utils/orgUtils.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { checkConfig, getConfig, setConfig, setInConfigFile } from '../../../../config/index.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ConfigureAuth extends SfCommand<any> {
  public static title = 'Configure authentication';

  public static description: string = `
## Command Behavior

> **This command requires human interaction and must be called manually, preferably from the [VS Code SFDX Hardis UI](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis). It is not suitable for automation or AI agent usage.**

**Configures authentication between a Git branch and a target Salesforce org for CI/CD deployments.**

This command facilitates the setup of automated CI/CD pipelines, enabling seamless deployments from specific Git branches to designated Salesforce orgs. It supports both standard Salesforce orgs and Dev Hub configurations, catering to various enterprise deployment workflows.

It creates an **External Client App** that uses the JWT Bearer flow with SSL certificates for secure CI/CD authentication.

Key functionalities include:

- **Org Selection/Login:** Guides the user to select an existing Salesforce org or log in to a new one.
- **Config Naming:** Names the auth config after an existing Git branch (default), or derives a name from the org domain with \`--name-type org-domain\` (or pass an explicit name with \`--name\`). Org-domain configs are not tied to a Git branch, so the merge targets step is skipped.
- **Git Branch Association:** Allows associating a specific Git branch with the chosen Salesforce org.
- **Merge Target Definition:** Enables defining target Git branches into which the configured branch can merge, ensuring controlled deployment flows.
- **Salesforce Username Configuration:** Prompts for the Salesforce username to be used by the CI server for deployments.
- **SSL Certificate Generation:** Automatically generates an SSL certificate for secure authentication.
- **External Client App Creation:** Creates an External Client App (Connected Apps can no longer be created in Salesforce orgs). Pass \`--app-name\` to name the app instead of being prompted.
- **Certificate Storage:** By default the encrypted certificate is committed to the repository. Pass \`--external-storage\` to keep only the encrypted certificate out of the repository and store it in a password manager instead, then provide it at authentication time (see \`hardis:auth:login --encrypted-cert-file\`). The other secrets (client id, decryption key) are still stored as CI/CD variables.

<details markdown="1">
<summary>Technical explanations</summary>

The command's implementation involves several key technical aspects:

- **SF CLI Integration:** Utilizes 
@salesforce/sf-plugins-core
 for command structure and flag parsing.

- **Interactive Prompts:** Employs the 
prompts
 library for interactive user input, guiding the configuration process.

- **Git Integration:** Interacts with Git to retrieve branch information using 
\`git().branch(["--list", "-r"])\`
.

- **Configuration Management:** Leverages internal utilities (\`checkConfig\`, \`getConfig\`, \`setConfig\`, \`setInConfigFile\`) to read from and write to project-specific configuration files (e.g., \`.sfdx-hardis.<branchName>.yml\`).
- **Salesforce CLI Execution:** Executes Salesforce CLI commands programmatically via \`execSfdxJson\` for org interactions.
- **SSL Certificate Generation:** Calls \`generateSSLCertificate\` to create necessary SSL certificates for JWT-based authentication.
- **WebSocket Communication:** Uses \`WebSocketClient\` for potential communication with external tools or processes, such as restarting the command in VS Code.
- **Dependency Check:** Ensures the presence of \`openssl\` on the system, which is required for SSL certificate generation.
`;

  public static examples = [
    '$ sf hardis:project:configure:auth',
    '$ sf hardis:project:configure:auth --name-type org-domain --app-name sfdxhardismyorg',
    '$ sf hardis:project:configure:auth --name-type org-domain --app-name sfdxhardismyorg --external-storage',
  ];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    devhub: Flags.boolean({
      char: 'b',
      default: false,
      description: 'Configure project DevHub',
    }),
    name: Flags.string({
      description: 'Name of the org-based auth config to create in config/branches (skips Git branch selection and merge targets). Auto-derived from the org domain when --name-type=org-domain.',
    }),
    'name-type': Flags.string({
      options: ['git-branch', 'org-domain'],
      default: 'git-branch',
      description: 'How to name the auth config: git-branch (select an existing Git branch) or org-domain (derive the name from the org domain)',
    }),
    'app-name': Flags.string({
      description: 'Name of the External Client App to create',
    }),
    'external-storage': Flags.boolean({
      default: false,
      description: 'Do not store the encrypted certificate in a file in the repository. Instead, the user is asked to keep it in a password manager and provide it at authentication time. The other secrets (client id, decryption key) are still stored as CI/CD variables.',
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
    'target-org': optionalOrgFlagWithDeprecations,
    'target-dev-hub': optionalHubFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  protected static requiresDependencies = ['openssl'];
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ConfigureAuth);
    const devHub = flags.devhub || false;

    // This command requires human interaction and can not run in CI or agent mode
    if (isCI) {
      throw new SfError(t('configureAuthInteractiveOnly'));
    }

    uxLog("action", this, c.cyan(t('thisCommandWillConfigureTheAuthenticationBetween', { devHub: devHub ? t('devHubLabel') : t('aSalesforceOrgLabel') })));

    // Ask user to login to org
    const prevUserName = devHub ? flags['target-dev-hub']?.getUsername() : flags['target-org']?.getUsername();
    await promptOrg(this, {
      setDefault: true,
      devHub: devHub,
      promptMessage: devHub ? t('pleaseSelectOrLoginIntoDevHub') : t('pleaseSelectOrLoginIntoOrg'),
      defaultOrgUsername: devHub ? flags['target-dev-hub']?.getUsername() : flags['target-org']?.getUsername(),
    });
    await checkConfig(this);

    // Check if the user has changed. If yes, ask to run the command again
    uxLog("action", this, c.cyan(t('checkingIfTheOrgUsernameHasChanged', { prevUserName: c.bold(prevUserName) })));
    const configGetRes = await execSfdxJson('sf config get ' + (devHub ? 'target-dev-hub' : 'target-org'), this, {
      output: false,
      fail: false,
    });
    let newUsername = configGetRes?.result[0]?.value || '';
    newUsername = (await getOrgAliasUsername(newUsername)) || newUsername;

    if (prevUserName !== newUsername) {
      // Restart command so the org is selected as default org (will help to select profiles)
      const infoMsg = t('defaultOrgChangedRestartVsCode');
      uxLog("warning", this, c.yellow(infoMsg));
      const currentCommand = 'sf ' + this.id + ' ' + this.argv.join(' ');
      WebSocketClient.sendRunSfdxHardisCommandMessage(currentCommand);
      return { outputString: infoMsg };
    }

    const config = await getConfig('project');
    // Get branch name to configure if not Dev Hub
    let branchName = '';
    let isOrgBasedName = false;
    let instanceUrl = 'https://login.salesforce.com';
    const orgInstanceUrl = flags['target-org']?.getConnection()?.instanceUrl || '';
    const branches = await git().branch(["--list", "-r"]);
    const branchesFiltered = branches.all
      .map((branch: string) => branch.replace('origin/', ''))
      .filter((branch: string) => branch !== branchName && !branch.includes("/"));

    if (!devHub) {
      if (flags.name) {
        // Explicit org-based config name provided
        branchName = flags.name.replace(/\s/g, '-');
        isOrgBasedName = true;
      } else if (flags['name-type'] === 'org-domain') {
        // Derive the config name from the org domain
        branchName = buildOrgSlugFromInstanceUrl(orgInstanceUrl);
        isOrgBasedName = true;
        uxLog("action", this, c.cyan(t('authConfigNameGeneratedFromOrg', { name: c.bold(branchName) })));
      } else {
        // Default: name the config after an existing Git branch
        const branchResponse = await prompts({
          type: 'select',
          name: 'value',
          message: c.cyanBright(t('whatIsNameOfGitBranchToConfigureCiCd')),
          choices: branchesFiltered.map((branch: string) => {
            return {
              title: branch,
              value: branch,
            };
          }),
          description: t('enterGitBranchNameForOrgConfig'),
          placeholder: t('selectTheGitBranchName'),
        });
        branchName = branchResponse.value.replace(/\s/g, '-');
        /* if (["main", "master"].includes(branchName)) {
          throw new SfError("You can not use main or master as deployment branch name. Maybe you want to use production ?");
        } */
      }
    }

    instanceUrl = await promptInstanceUrl(
      devHub ? ["login"] : ['login', "test"],
      devHub ? t('devHubOrgLabel') : t('branchRelatedOrg', { branchName }), {
      instanceUrl: devHub
        ? flags['target-dev-hub']?.getConnection()?.instanceUrl || ""
        : flags['target-org']?.getConnection()?.instanceUrl || "",
    });

    // Request merge targets (skipped for org-based configs)
    if (!devHub && !isOrgBasedName) {
      let initialMergeTargets: string[] = [];
      const branchConfigFile = `./config/branches/.sfdx-hardis.${branchName}.yml`;
      if (fs.existsSync(branchConfigFile)) {
        const branchConfig: any = yaml.load(fs.readFileSync(branchConfigFile, 'utf8'));
        if (branchConfig && branchConfig.mergeTargets) {
          initialMergeTargets = branchConfig.mergeTargets;
        }
      }
      const mergeTargetsResponse = await prompts({
        type: 'multiselect',
        name: 'value',
        message: c.cyanBright(t('whatAreTargetGitBranchesToMergeIn', { branchName })),
        choices: branchesFiltered.map((branch: string) => {
          return {
            title: branch,
            value: branch,
          };
        }),
        initial: initialMergeTargets,
        description: t('selectGitBranchesThisBranchCanMergeIn'),
        placeholder: t('selectTheTargetGitBranches'),
      });
      const mergeTargets = mergeTargetsResponse.value.map((branch: string) => branch.replace(/\s/g, '-'));
      // Update config file
      await setInConfigFile(
        [],
        {
          mergeTargets: mergeTargets,
        },
        branchConfigFile
      );
    }

    // Request username
    const usernameResponse = await prompts({
      type: 'text',
      name: 'value',
      initial: (devHub ? flags['target-dev-hub']?.getUsername() || "" : flags['target-org'].getUsername() || "") || '',
      message: c.cyanBright(
        devHub ? t('whatIsSalesforceUsernameDevHub') : t('whatIsSalesforceUsernameForDeployments')
      ),
      description: t('enterSalesforceUsernameForConfig'),
      placeholder: t('exAdminSfdxAtMyclient'),
    });
    if (devHub) {
      if (!config.devHubAlias || config.devHubAlias === '') {
        const devHubAliasResponse = await prompts({
          type: 'text',
          name: 'value',
          message: c.cyanBright(t('whatIsTheAliasYouWantTo')),
          description: t('enterAliasForDevHub'),
          initial: config.projectName ? 'DevHub_' + config.projectName : 'DevHub',
          placeholder: t('exMyCompanyDevHub'),
        });
        config.devHubAlias = devHubAliasResponse.value;
        await setConfig('project', {
          devHubAlias: config.devHubAlias,
        });
      }
      const configFile = await setConfig('project', {
        devHubInstanceUrl: instanceUrl,
        devHubUsername: usernameResponse.value,
      });
      WebSocketClient.sendReportFileMessage(configFile!, t('updatedProjectConfigFile'), 'report');
    } else {
      // Update config file
      const branchConfigFile = `./config/branches/.sfdx-hardis.${branchName}.yml`;
      await setInConfigFile(
        [],
        {
          targetUsername: usernameResponse.value,
          instanceUrl,
        },
        branchConfigFile
      );
      WebSocketClient.sendReportFileMessage(branchConfigFile, t('updatedBranchConfigFile', { branchName }), 'report');
    }

    WebSocketClient.sendRefreshPipelineMessage();

    // Generate SSL certificate (requires openssl to be installed on computer)
    const certFolder = devHub ? './config/.jwt' : './config/branches/.jwt';
    const certName = devHub ? config.devHubAlias : branchName;
    const orgConn = devHub ? flags['target-dev-hub']?.getConnection() : flags['target-org']?.getConnection();
    const sslGenOptions = {
      targetUsername: devHub ? flags['target-dev-hub']?.getUsername() : flags['target-org']?.getUsername(),
      appName: flags['app-name'],
      externalStorage: flags['external-storage'] === true,
    };
    const sslResult = await generateSSLCertificate(certName, certFolder, this, orgConn, sslGenOptions);

    uxLog("action", this, c.green(t('branchSuccessfullyConfiguredForAuthentication', { devHub: devHub ? '(DevHub)' : branchName })));
    uxLog("warning", this, c.yellow(t('makeSureYouHaveSetTheEnvironment')));
    if (sslResult?.mode !== 'caSigned') {
      uxLog("warning", this, c.yellow(t('dontForgetToCommitConfigAndCertKey')));
    }

    // Return an object to be displayed with --json
    return { outputString: 'Configured branch for authentication' };
  }
}
