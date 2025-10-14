/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import open from 'open';
import {
  ensureGitBranch,
  ensureGitRepository,
  execCommand,
  generateSSLCertificate,
  getCurrentGitBranch,
  getGitRepoName,
  gitAddCommitPush,
  uxLog,
} from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { CONSTANTS, setInConfigFile } from '../../../../config/index.js';
import { PACKAGE_ROOT_DIR } from '../../../../settings.js';
import { promptOrg } from '../../../../common/utils/orgUtils.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgConfigureMonitoring extends SfCommand<any> {
  public static title = 'Configure org monitoring';

  public static description = `
## Command Behavior

**Configures the monitoring of a Salesforce org within a dedicated Git repository.**

This command streamlines the setup of continuous monitoring for a Salesforce organization, ensuring that changes and health metrics are tracked and reported. It is designed to be run within a Git repository specifically dedicated to monitoring configurations.

Key functionalities include:

- **Git Repository Validation:** Ensures the current Git repository's name contains "monitoring" to enforce best practices for separating monitoring configurations from deployment sources.
- **Prerequisite Check:** Guides the user to confirm that necessary monitoring prerequisites (CI/CD variables, permissions) are configured on their Git server.
- **Org Selection:** Prompts the user to select or connect to the Salesforce org they wish to monitor.
- **Monitoring Branch Creation:** Creates or checks out a dedicated Git branch (e.g., \`monitoring_yourinstanceurl\`) for the monitoring configuration.
- **SFDX Project Setup:** Initializes an SFDX project structure within the repository if it doesn't already exist, and copies default monitoring files.
- **Configuration File Update:** Updates the local \`.sfdx-hardis.yml\` file with the target org's username and instance URL.
- **SSL Certificate Generation:** Generates an SSL certificate for secure authentication to the monitored org.
- **Automated Commit and Push:** Offers to automatically commit and push the generated configuration files to the remote Git repository.
- **Scheduling Guidance:** Provides instructions and links for scheduling the monitoring job on the Git server.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves a series of Git operations, file system manipulations, and Salesforce CLI interactions:

- **Git Operations:** Utilizes \`ensureGitRepository\`, \`getGitRepoName\`, \`execCommand\` (for \`git add\`, \`git stash\`), \`ensureGitBranch\`, and \`gitAddCommitPush\` to manage the Git repository, branches, and commits.
- **Interactive Prompts:** Employs the \`prompts\` library to interact with the user for confirmations and selections.
- **File System Management:** Uses \`fs-extra\` for copying default monitoring files (\`defaults/monitoring\`) and managing the SFDX project structure.
- **Salesforce CLI Integration:** Calls \`sf project generate\` to create a new SFDX project and uses \`promptOrg\` for Salesforce org authentication and selection.
- **Configuration Management:** Updates the \`.sfdx-hardis.yml\` file using \`setInConfigFile\` to store org-specific monitoring configurations.
- **SSL Certificate Generation:** Leverages \`generateSSLCertificate\` to create the necessary SSL certificates for JWT-based authentication to the Salesforce org.
- **External Tool Integration:** Requires \`openssl\` to be installed on the system for SSL certificate generation.
- **WebSocket Communication:** Uses \`WebSocketClient.sendRunSfdxHardisCommandMessage\` to restart the command in VS Code if the default org changes, and \`WebSocketClient.sendRefreshStatusMessage\` to update the status.
</details>
`;

  public static examples = ['$ sf hardis:org:configure:monitoring'];

  public static flags: any = {
    orginstanceurl: Flags.string({
      description: 'Org instance url (technical param, do not use manually)',
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
    'target-org': requiredOrgFlagWithDeprecations,
  };

  // Comment this out if your command does not require an org username
  public static requiresProject = false;
  /* jscpd:ignore-end */

  protected static requiresDependencies = ['openssl'];

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgConfigureMonitoring);
    // Make sure that we are located in a git repository
    await ensureGitRepository();

    // Check git repo name is valid (contains monitoring)
    const repoName = (await getGitRepoName()) || '';
    if (!repoName.includes('monitoring')) {
      const confirmMix = await prompts({
        type: 'select',
        name: 'value',
        choices: [
          { title: "Yes, I'm sure because I know what I'm doing, like Roman 😊", value: 'yes' },
          { title: 'Mmmmm no, let me create another repo with the word "monitoring" in its name !', value: 'no' },
        ],
        message: c.cyanBright(
          "Are you sure you want to mix monitoring and deployment sources ?"
        ),
        description: 'It is recommended to separate monitoring configuration from deployment sources in different repositories',
        placeholder: 'Select an option',
      });
      if (confirmMix.value === 'no') {
        throw new SfError('Your git repository name must contain the expression "monitoring"');
      }
    }
    const preRequisitesUrl = `${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-config-home/#instructions`;
    uxLog("warning", this, c.yellow('Monitoring pre-requisites documentation: ' + c.bold(preRequisitesUrl)));
    const confirmPreRequisites = await prompts({
      type: 'select',
      name: 'value',
      choices: [
        { title: 'Yes', value: 'yes' },
        { title: 'No, help me !', value: 'no' },
      ],
      message: c.cyanBright('Did you configure the sfdx-hardis monitoring pre-requisites on your Git server ?'),
      description: 'Confirm that you have set up the required CI/CD variables and permissions for monitoring',
      placeholder: 'Select an option',
    });
    if (confirmPreRequisites.value === 'no') {
      const msg =
        'Please follow the instructions to configure the sfdx-hardis monitoring pre-requisites on your Git server\n' +
        preRequisitesUrl;
      uxLog("warning", this, c.yellow(msg));
      await open(preRequisitesUrl, { wait: true });
      return { outputString: msg };
    }

    // Get current default org
    const currentOrgId = flags['target-org']?.getOrgId() || '';
    if (flags.orginstanceurl && flags['target-org']?.getConnection()?.instanceUrl === flags.orginstanceurl) {
      uxLog(
        "action",
        this,
        c.cyan(
          `Default org ${flags['target-org'].getConnection()?.instanceUrl
          } is selected, let's configure its monitoring !`
        )
      );
    } else {
      // Select the org that must be monitored
      const org = await promptOrg(this, {
        devHub: false,
        setDefault: true,
        scratch: false,
        promptMessage: 'Please select or connect to the org that you want to monitor',
        defaultOrgUsername: flags['target-org']?.getUsername(),
      });

      // Restart command so the org is selected as default org (will help to select profiles)
      if (currentOrgId !== org.orgId) {
        const infoMsg =
          'Default org changed. Please restart the same command if VS Code does not do that automatically for you 😊';
        uxLog("warning", this, c.yellow(infoMsg));
        const currentCommand = 'sf ' + this.id + ' ' + this.argv.join(' ') + ' --orginstanceurl ' + org.instanceUrl;
        WebSocketClient.sendRunSfdxHardisCommandMessage(currentCommand);
        return { outputString: infoMsg };
      }
    }

    // Build monitoring branch name
    const branchName =
      'monitoring_' +
      flags['target-org']
        ?.getConnection()
        .instanceUrl.replace('https://', '')
        .replace('.my.salesforce.com', '')
        .replace(/\./gm, '_')
        .replace(/--/gm, '__')
        .replace(/-/gm, '_');

    // Checkout branch, or create it if not existing (stash before if necessary)
    await execCommand('git add --all', this, { output: true, fail: false });
    await execCommand('git stash', this, { output: true, fail: false });
    await ensureGitBranch(branchName, { parent: 'main' });

    // Create sfdx project if not existing yet
    if (!fs.existsSync('sfdx-project.json')) {
      const createCommand = 'sf project generate' + ` --name "sfdx-hardis-monitoring"`;
      uxLog("action", this, c.cyan('Creating sfdx-project...'));
      await execCommand(createCommand, this, {
        output: true,
        fail: true,
      });
      uxLog("action", this, c.cyan('Moving sfdx-project to root...'));
      await fs.copy('sfdx-hardis-monitoring', process.cwd(), { overwrite: true });
      await fs.remove('sfdx-hardis-monitoring');

      // Copying monitoring folder structure
      uxLog("other", this, 'Copying default monitoring files...');
      if (fs.existsSync('README.md') && fs.readFileSync('README.md', 'utf8').toString().split('\n').length < 5) {
        // Remove default README if necessary
        await fs.remove('README.md');
      }
      await fs.copy(path.join(PACKAGE_ROOT_DIR, 'defaults/monitoring', '.'), process.cwd(), { overwrite: true });
    }

    // Update config file
    await setInConfigFile(
      [],
      {
        targetUsername: flags['target-org'].getUsername(),
        instanceUrl: flags['target-org'].getConnection().instanceUrl,
      },
      './.sfdx-hardis.yml'
    );

    // Generate SSL certificate (requires openssl to be installed on computer)
    await generateSSLCertificate(branchName, './.ssh', this, flags['target-org'].getConnection(), {});

    // Confirm & push on server
    const confirmPush = await prompts({
      type: 'confirm',
      name: 'value',
      initial: true,
      message: c.cyanBright(
        'Do you want sfdx-hardis to save your configuration on server ?'
      ),
      description: 'Automatically commit and push the monitoring configuration files to your git repository (recommended)',
    });

    if (confirmPush.value === true) {
      await gitAddCommitPush({
        message: '[sfdx-hardis] Update monitoring configuration',
      });
      uxLog("success", this, c.green('Your configuration for org monitoring is now ready 😊'));
    } else {
      uxLog("warning", this, c.yellow('Please manually git add, commit and push to the remote repository 😊'));
    }
    const branch = await getCurrentGitBranch();
    uxLog(
      "success",
      this,
      c.green(
        `Now you must schedule monitoring to run the job automatically every night on branch ${c.bold(branch)}😊`
      )
    );
    const scheduleMonitoringUrl = `${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-config-home/#instructions`;
    const msg =
      'Please follow the instructions to schedule sfdx-hardis monitoring on your Git server: ' +
      c.bold(scheduleMonitoringUrl);
    uxLog("warning", this, c.yellow(msg));
    await open(scheduleMonitoringUrl, { wait: true });
    // Return an object to be displayed with --json
    return { outputString: 'Configured branch for authentication' };
  }
}
