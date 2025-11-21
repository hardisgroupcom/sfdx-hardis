/* jscpd:ignore-start */
import {
  SfCommand,
  Flags,
  optionalOrgFlagWithDeprecations,
  optionalHubFlagWithDeprecations,
} from '@salesforce/sf-plugins-core';
import { fs, Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import * as yaml from 'js-yaml';
import { execSfdxJson, generateSSLCertificate, git, promptInstanceUrl, uxLog } from '../../../../common/utils/index.js';
import { getOrgAliasUsername, promptOrg } from '../../../../common/utils/orgUtils.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { checkConfig, getConfig, setConfig, setInConfigFile } from '../../../../config/index.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ConfigureAuth extends SfCommand<any> {
  public static title = 'Configure authentication';

  public static description: string = `
## Command Behavior

**Configures authentication between a Git branch and a target Salesforce org for CI/CD deployments.**

This command facilitates the setup of automated CI/CD pipelines, enabling seamless deployments from specific Git branches to designated Salesforce orgs. It supports both standard Salesforce orgs and Dev Hub configurations, catering to various enterprise deployment workflows.

Key functionalities include:

- **Org Selection/Login:** Guides the user to select an existing Salesforce org or log in to a new one.
- **Git Branch Association:** Allows associating a specific Git branch with the chosen Salesforce org.
- **Merge Target Definition:** Enables defining target Git branches into which the configured branch can merge, ensuring controlled deployment flows.
- **Salesforce Username Configuration:** Prompts for the Salesforce username to be used by the CI server for deployments.
- **SSL Certificate Generation:** Automatically generates an SSL certificate for secure authentication.

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

  public static examples = ['$ sf hardis:project:configure:auth'];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    devhub: Flags.boolean({
      char: 'b',
      default: false,
      description: 'Configure project DevHub',
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

    uxLog("action", this, c.cyan(`This command will configure the authentication between a git branch and ${devHub ? "Dev Hub" : "a Salesforce org"}.`));

    // Ask user to login to org
    const prevUserName = devHub ? flags['target-dev-hub']?.getUsername() : flags['target-org']?.getUsername();
    await promptOrg(this, {
      setDefault: true,
      devHub: devHub,
      promptMessage: `Please select or login into ${devHub ? "your Dev Hub org" : "the org you want to configure the SF CLI Authentication"}`,
      defaultOrgUsername: devHub ? flags['target-dev-hub']?.getUsername() : flags['target-org']?.getUsername(),
    });
    await checkConfig(this);

    // Check if the user has changed. If yes, ask to run the command again
    uxLog("action", this, c.cyan(`Checking if the org username has changed from ${c.bold(prevUserName)}...`));
    const configGetRes = await execSfdxJson('sf config get ' + (devHub ? 'target-dev-hub' : 'target-org'), this, {
      output: false,
      fail: false,
    });
    let newUsername = configGetRes?.result[0]?.value || '';
    newUsername = (await getOrgAliasUsername(newUsername)) || newUsername;

    if (prevUserName !== newUsername) {
      // Restart command so the org is selected as default org (will help to select profiles)
      const infoMsg =
        'Default org changed. Please restart the same command if VS Code does not do that automatically for you 😊';
      uxLog("warning", this, c.yellow(infoMsg));
      const currentCommand = 'sf ' + this.id + ' ' + this.argv.join(' ');
      WebSocketClient.sendRunSfdxHardisCommandMessage(currentCommand);
      return { outputString: infoMsg };
    }

    const config = await getConfig('project');
    // Get branch name to configure if not Dev Hub
    let branchName = '';
    let instanceUrl = 'https://login.salesforce.com';
    const branches = await git().branch(["--list", "-r"]);
    if (!devHub) {
      const branchResponse = await prompts({
        type: 'select',
        name: 'value',
        message: c.cyanBright(
          'What is the name of the git branch you want to configure Automated CI/CD deployments from ? (Ex: integration,uat,preprod,main)'
        ),
        choices: branches.all.map((branch: string) => {
          return {
            title: branch.replace('origin/', ''),
            value: branch.replace('origin/', ''),
          };
        }),
        description: 'Enter the git branch name for this org configuration',
        placeholder: 'Select the git branch name',
      });
      branchName = branchResponse.value.replace(/\s/g, '-');
      /* if (["main", "master"].includes(branchName)) {
        throw new SfError("You can not use main or master as deployment branch name. Maybe you want to use production ?");
      } */
    }

    instanceUrl = await promptInstanceUrl(
      devHub ? ["login"] : ['login', "test"],
      devHub ? "Dev Hub  org" : `${branchName} related org`, {
      instanceUrl: devHub
        ? flags['target-dev-hub']?.getConnection()?.instanceUrl || ""
        : flags['target-org']?.getConnection()?.instanceUrl || "",
    });

    // Request merge targets
    if (!devHub) {
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
        message: c.cyanBright(
          `What are the target git branches that ${branchName} will be able to merge in ? (Ex: for integration, the target will be uat)`
        ),
        choices: branches.all.map((branch: string) => {
          return {
            title: branch.replace('origin/', ''),
            value: branch.replace('origin/', ''),
          };
        }),
        initial: initialMergeTargets,
        description: 'Select the git branches that this branch will be able to merge in',
        placeholder: 'Select the target git branches',
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
        `What is the Salesforce username that will be ${devHub ? 'used as Dev Hub' : 'used for deployments by CI server'
        } ? Example: admin.sfdx@myclient.com`
      ),
      description: 'Enter the Salesforce username for this configuration',
      placeholder: 'Ex: admin.sfdx@myclient.com',
    });
    if (devHub) {
      if (!config.devHubAlias || config.devHubAlias === '') {
        const devHubAliasResponse = await prompts({
          type: 'text',
          name: 'value',
          message: c.cyanBright('What is the alias you want to set for your Dev Hub ?'),
          description: 'Enter the alias for your Dev Hub',
          initial: config.projectName ? 'DevHub_' + config.projectName : 'DevHub',
          placeholder: 'Ex: MyCompany_DevHub',
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
      WebSocketClient.sendReportFileMessage(configFile!, 'Updated project config file', 'report');
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
      WebSocketClient.sendReportFileMessage(branchConfigFile, `Updated ${branchName} config file`, 'report');
    }

    WebSocketClient.sendRefreshPipelineMessage();

    // Generate SSL certificate (requires openssl to be installed on computer)
    const certFolder = devHub ? './config/.jwt' : './config/branches/.jwt';
    const certName = devHub ? config.devHubAlias : branchName;
    const orgConn = devHub ? flags['target-dev-hub']?.getConnection() : flags['target-org']?.getConnection();
    const sslGenOptions = {
      targetUsername: devHub ? flags['target-dev-hub']?.getUsername() : flags['target-org']?.getUsername(),
    };
    await generateSSLCertificate(certName, certFolder, this, orgConn, sslGenOptions);

    uxLog("action", this, c.green(`Branch ${devHub ? '(DevHub)' : branchName} successfully configured for authentication!`));
    uxLog("warning", this, c.yellow('Make sure you have set the environment variables in your CI/CD platform'));
    uxLog("warning", this, c.yellow('Don\'t forget to commit the sfdx-hardis config file and the encrypted certificated key in git!'));

    // Return an object to be displayed with --json
    return { outputString: 'Configured branch for authentication' };
  }
}
