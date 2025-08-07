/* jscpd:ignore-start */
import {
  SfCommand,
  Flags,
  optionalOrgFlagWithDeprecations,
  optionalHubFlagWithDeprecations,
} from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { execSfdxJson, generateSSLCertificate, git, promptInstanceUrl, uxLog } from '../../../../common/utils/index.js';
import { getOrgAliasUsername, promptOrg } from '../../../../common/utils/orgUtils.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { checkConfig, getConfig, setConfig, setInConfigFile } from '../../../../config/index.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ConfigureAuth extends SfCommand<any> {
  public static title = 'Configure authentication';

  public static description = `Configure authentication from a git branch to a target Salesforce org.

This authentication enables CI/CD pipelines to deploy changes from specific git branches directly to Salesforce orgs.

Supports both standard orgs and Dev Hub configuration for enterprise deployment workflows.
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

    uxLog(this, c.cyan("This command will configure the authentication between a git branch and a Salesforce org."));

    // Ask user to login to org
    const prevUserName = devHub ? flags['target-dev-hub']?.getUsername() : flags['target-org']?.getUsername();
    await promptOrg(this, {
      setDefault: true,
      devHub: devHub,
      promptMessage: 'Please select or login into the org you want to configure the SF CLI Authentication',
      defaultOrgUsername: flags['target-org']?.getUsername(),
    });
    await checkConfig(this);

    // Check if the user has changed. If yes, ask to run the command again
    uxLog(this, c.cyan(`Checking if the org username has changed from ${c.bold(prevUserName)}...`));
    const configGetRes = await execSfdxJson('sf config get ' + (devHub ? 'target-dev-hub' : 'target-org'), this, {
      output: false,
      fail: false,
    });
    let newUsername = configGetRes?.result[0]?.value || '';
    newUsername = (await getOrgAliasUsername(newUsername)) || newUsername;

    if (prevUserName !== newUsername) {
      // Restart command so the org is selected as default org (will help to select profiles)
      const infoMsg =
        'Default org changed. Please restart the same command if VsCode does not do that automatically for you :)';
      uxLog(this, c.yellow(infoMsg));
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
      instanceUrl = await promptInstanceUrl(['login', 'test'], `${branchName} related org`, {
        instanceUrl: devHub
          ? flags['target-dev-hub']?.getConnection()?.instanceUrl || ""
          : flags['target-org']?.getConnection()?.instanceUrl || "",
      });
    }
    // Request merge targets
    if (!devHub) {
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
        `./config/branches/.sfdx-hardis.${branchName}.yml`
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
      await setConfig('project', {
        devHubUsername: usernameResponse.value,
      });
    } else {
      // Update config file
      await setInConfigFile(
        [],
        {
          targetUsername: usernameResponse.value,
          instanceUrl,
        },
        `./config/branches/.sfdx-hardis.${branchName}.yml`
      );
    }

    // Generate SSL certificate (requires openssl to be installed on computer)
    const certFolder = devHub ? './config/.jwt' : './config/branches/.jwt';
    const certName = devHub ? config.devHubAlias : branchName;
    const orgConn = devHub ? flags['target-dev-hub']?.getConnection() : flags['target-org']?.getConnection();
    const sslGenOptions = {
      targetUsername: devHub ? flags['target-dev-hub']?.getUsername() : flags['target-org']?.getUsername(),
    };
    await generateSSLCertificate(certName, certFolder, this, orgConn, sslGenOptions);
    // Return an object to be displayed with --json
    return { outputString: 'Configured branch for authentication' };
  }
}
