/* jscpd:ignore-start */
import { SfCommand, Flags, optionalOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from '../../../../common/utils/fsUtils.js';
import * as path from 'path';
import { open } from '../../../../common/utils/openUtils.js';
import {
  buildOrgSlugFromInstanceUrl,
  ensureGitBranch,
  ensureGitRepository,
  execCommand,
  generateSSLCertificate,
  getCurrentGitBranch,
  getGitRepoName,
  git,
  gitAddCommitPush,
  uxLog,
} from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { CONSTANTS, setInConfigFile } from '../../../../config/index.js';
import { PACKAGE_ROOT_DIR } from '../../../../settings.js';
import { promptOrg } from '../../../../common/utils/orgUtils.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { t } from '../../../../common/utils/i18n.js';
import { buildConventionalCommitMessage } from '../../../../common/utils/gitUtils.js';
import { addOrgToGithubMonitoringWorkflow, GITHUB_MONITORING_WORKFLOW_PATH } from '../../../../common/utils/monitoringWorkflowUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgConfigureMonitoring extends SfCommand<any> {
  public static title = 'Configure org monitoring';

  public static description = `
## Command Behavior

> **This command requires human interaction and must be called manually, preferably from the [VS Code SFDX Hardis UI](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis). It is not suitable for automation or AI agent usage.**

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
- **Scheduling:** On GitHub, writes the monitoring workflow on the default branch with this org in its matrix and its two secrets in its jobs, since GitHub only schedules, and only offers Run workflow for, the workflows of that branch. On other Git servers, gives the instructions to schedule the job.
- **Empty repository:** A repository created empty on the Git server gets a first empty commit on \`main\`, so that the monitoring branch has something to start from.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves a series of Git operations, file system manipulations, and Salesforce CLI interactions:

- **Git Operations:** Utilizes \`ensureGitRepository\`, \`getGitRepoName\`, \`execCommand\` (for \`git add\`, \`git stash\`), \`ensureGitBranch\`, and \`gitAddCommitPush\` to manage the Git repository, branches, and commits.
- **Interactive Prompts:** Employs the \`prompts\` library to interact with the user for confirmations and selections.
- **File System Management:** Uses Node.js \`fs\` for copying default monitoring files (\`defaults/monitoring\`) and managing the SFDX project structure.
- **Salesforce CLI Integration:** Calls \`sf project generate\` to create a new SFDX project and uses \`promptOrg\` for Salesforce org authentication and selection.
- **Configuration Management:** Updates the \`.sfdx-hardis.yml\` file using \`setInConfigFile\` to store org-specific monitoring configurations.
- **SSL Certificate Generation:** Leverages \`generateSSLCertificate\` to create the necessary SSL certificates for JWT-based authentication to the Salesforce org.
- **External Tool Integration:** Requires \`openssl\` to be installed on the system for SSL certificate generation.
- **WebSocket Communication:** Uses \`WebSocketClient.sendRunSfdxHardisCommandMessage\` to restart the command in VS Code if the default org changes, and \`WebSocketClient.sendRefreshStatusMessage\` to update the status.
</details>

<!-- training-links:start -->

## Learn by doing

The free [Salesforce DevOps with sfdx-hardis](https://hardisgroupcom.github.io/sfdx-hardis-training) course runs this command, click by click, on an org of your own:

- [Lab 3.8 - Monitor your production org](https://hardisgroupcom.github.io/sfdx-hardis-training/en/level-3-release-manager/3-8-monitor-your-production-org/)

<!-- training-links:end -->
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
    'target-org': optionalOrgFlagWithDeprecations,
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
          { title: t('yesApproveSeparateMonitoringRepo'), value: 'yes' },
          { title: t('noLetMeCreateAnotherRepo'), value: 'no' },
        ],
        message: c.cyanBright(
          t('confirmMixMonitoringDeploymentSources')
        ),
        description: t('separateMonitoringDeploymentDescription'),
        placeholder: t('selectAnOption'),
      });
      if (confirmMix.value === 'no') {
        throw new SfError('Your git repository name must contain the expression "monitoring"');
      }
    }
    const preRequisitesUrl = `${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-config-home/#instructions`;
    uxLog("action", this, c.cyan(t('monitoringPreRequisitesLabel')));
    uxLog("warning", this, c.yellow(t('monitoringPreRequisitesDocumentation') + c.bold(preRequisitesUrl)));
    WebSocketClient.sendReportFileMessage(preRequisitesUrl, t('monitoringPreRequisitesLabel'), "docUrl");
    // Confirm pre-requisites
    const confirmPreRequisites = await prompts({
      type: 'select',
      name: 'value',
      choices: [
        { title: t('promptChoiceYes'), value: 'yes' },
        { title: t('promptChoiceNoBringToDocumentation'), value: 'no' },
      ],
      message: c.cyanBright(t('didYouConfigureTheSfdxHardisMonitoring')),
      description: t('confirmCiCdVariablesAndPermissionsForMonitoring'),
      placeholder: t('selectAnOption'),
    });
    if (confirmPreRequisites.value === 'no') {
      const msg =
        'Please follow the instructions to configure the sfdx-hardis monitoring pre-requisites on your Git server\n' +
        preRequisitesUrl;
      uxLog("action", this, c.cyan(msg));
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
          t('defaultOrgSelectedForMonitoring', { instanceUrl: flags['target-org'].getConnection()?.instanceUrl })
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
        const infoMsg = t('defaultOrgChangedRestartCommand');
        uxLog("action", this, c.cyan(infoMsg));
        const currentCommand = 'sf ' + this.id + ' ' + this.argv.join(' ') + ' --orginstanceurl ' + org.instanceUrl;
        WebSocketClient.sendRunSfdxHardisCommandMessage(currentCommand);
        return { outputString: infoMsg };
      }
    }

    // Build monitoring branch name
    const branchName =
      'monitoring_' + buildOrgSlugFromInstanceUrl(flags['target-org']?.getConnection().instanceUrl);

    uxLog("action", this, c.cyan(t('handlingMonitoringGitBranch', { branchName: c.bold(branchName) })));

    // A repository created empty on the git server has no commit yet: there is nothing to stash, and
    // no main to cut the monitoring branch from. Give it its first commit on main.
    const hasCommit = (await git().raw(['rev-list', '-n', '1', '--all'])).trim() !== '';
    if (!hasCommit) {
      uxLog("action", this, c.cyan(t('monitoringRepositoryEmptyInitialCommit')));
      await git().raw(['checkout', '-B', 'main']);
      await git().raw(['commit', '--allow-empty', '-m', 'Initial commit']);
      try {
        await git().push(['-u', 'origin', 'main']);
      } catch (e) {
        uxLog("warning", this, c.yellow(t('monitoringInitialCommitNotPushed', { message: (e as Error).message })));
      }
    } else {
      // Checkout branch, or create it if not existing (stash before if necessary)
      try {
        await execCommand('git add --all', this, { output: true, fail: false });
        await execCommand('git stash', this, { output: true, fail: false });
      } catch (e) {
        uxLog("warning", this, c.yellow(t('monitoringStashFailed', { message: (e as Error).message })));
      }
    }
    await ensureGitBranch(branchName, { parent: 'main', logAsAction: true });

    // Create sfdx project if not existing yet
    if (!fs.existsSync('sfdx-project.json')) {
      const createCommand = 'sf project generate' + ` --name "sfdx-hardis-monitoring"`;
      uxLog("action", this, c.cyan(t('creatingSfdxProject2')));
      await execCommand(createCommand, this, {
        output: true,
        fail: true,
      });
      uxLog("action", this, c.cyan(t('movingSfdxProjectToRoot')));
      await fs.copy('sfdx-hardis-monitoring', process.cwd(), { overwrite: true });
      await fs.remove('sfdx-hardis-monitoring');

      // Copying monitoring folder structure
      uxLog("other", this, t('copyingDefaultMonitoringFiles'));
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

    // Check if current branch is existing on remote origin, and if not suggest to push (with confirmation)
    const remoteBranches = await git().listRemote(['--heads', 'origin']);
    const branchExistsOnRemote = remoteBranches.includes(`refs/heads/${branchName}`);
    if (!branchExistsOnRemote) {
      const confirmPushToRemote = await prompts({
        type: 'confirm',
        initial: true,
        message: c.cyanBright(
          t('branchNotExistsOnServerPushPrompt', { branch: branchName })
        ),
        description: t('pushBranchToRemoteDescription'),
      });
      if (confirmPushToRemote.value === true) {
        uxLog("action", this, c.cyan(t('pushingBranchToGitRemoteServer', { branchName: c.bold(branchName) })));
        await gitAddCommitPush({
          commitMessage: buildConventionalCommitMessage({ subject: 'update monitoring configuration' }),
        });
      }
    }

    // Generate SSL certificate (requires openssl to be installed on computer)
    await generateSSLCertificate(branchName, './.ssh', this, flags['target-org'].getConnection(), { usageType: 'monitoring' });

    // Confirm & push on server
    const confirmPush = await prompts({
      type: 'confirm',
      name: 'value',
      initial: true,
      message: c.cyanBright(
        t('saveConfigurationOnServerPrompt')
      ),
      description: t('saveConfigAutocommitDescription'),
    });

    if (confirmPush.value === true) {
      uxLog("action", this, c.cyan(t('savingMonitoringConfigurationOnServer')));
      await gitAddCommitPush({
        commitMessage: buildConventionalCommitMessage({ subject: 'update monitoring configuration' }),
      });
      uxLog("success", this, c.green(t('yourConfigurationForOrgMonitoringIsNow')));
    } else {
      uxLog("action", this, c.cyan(t('pleaseManuallyGitAddCommitAndPush')));
    }
    // On GitHub, the scheduled run needs the workflow on the default branch: put it there.
    // The workflow file is no signal: the monitoring templates of every git provider are
    // copied into every monitoring repository, so the remote says which server this is
    const scheduledFromMain = confirmPush.value === true && fs.existsSync(GITHUB_MONITORING_WORKFLOW_PATH) && (await this.isGithubRemote())
      ? await this.scheduleGithubMonitoringFromMain(branchName)
      : false;
    if (!scheduledFromMain) {
      const branch = await getCurrentGitBranch();
      uxLog(
        "warning",
        this,
        c.yellow(
          t('scheduleMonitoringNightly', { branchName: branch })
        )
      );
      const scheduleMonitoringUrl = `${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-config-home/#instructions`;
      const msg = t('followScheduleInstructions') + ' ' + c.bold(scheduleMonitoringUrl);
      uxLog("warning", this, c.yellow(msg));
      WebSocketClient.sendReportFileMessage(scheduleMonitoringUrl, t('scheduleMonitoringLabel'), "actionUrl");
    }
    uxLog(
      "warning",
      this,
      c.yellow(
        t('configureNotificationsAndGrafana')
      )
    );
    const slackIntegrationUrl = `${CONSTANTS.DOC_URL_ROOT}/salesforce-devops-setup-integration-slack/`;
    WebSocketClient.sendReportFileMessage(slackIntegrationUrl, t('slackIntegrationLabel'), "docUrl");
    const teamsIntegrationUrl = `${CONSTANTS.DOC_URL_ROOT}/salesforce-devops-setup-integration-ms-teams/`;
    WebSocketClient.sendReportFileMessage(teamsIntegrationUrl, t('teamsIntegrationLabel'), "docUrl");
    const grafanaIntegrationUrl = `${CONSTANTS.DOC_URL_ROOT}/salesforce-devops-setup-integration-api/`;
    WebSocketClient.sendReportFileMessage(grafanaIntegrationUrl, t('grafanaIntegrationLabel'), "docUrl");
    uxLog("log", this, t('slackIntegrationDoc') + ' ' + slackIntegrationUrl);
    uxLog("log", this, t('teamsIntegrationDoc') + ' ' + teamsIntegrationUrl);
    uxLog("log", this, t('grafanaIntegrationDoc') + ' ' + grafanaIntegrationUrl);
    // Return an object to be displayed with --json
    return { outputString: 'Configured branch for authentication' };
  }

  // GitHub schedules, and offers "Run workflow" for, the workflows of the default branch only. Write
  // the monitoring workflow there with this org in it, keeping the orgs it already monitors.
  private async isGithubRemote(): Promise<boolean> {
    try {
      const remote = (await git().remote(['get-url', 'origin'])) || '';
      return /github/i.test(remote);
    } catch {
      return false;
    }
  }

  private async scheduleGithubMonitoringFromMain(branchName: string): Promise<boolean> {
    try {
      await git().checkout('main');
      try {
        await git().pull('origin', 'main');
        // Read after the pull, never before: an org a colleague added since the
        // last fetch would be missing from the copy this clone had, and writing
        // that copy back would drop it from every matrix and stop its backup.
        let workflow = '';
        try {
          workflow = await fs.readFile(GITHUB_MONITORING_WORKFLOW_PATH, 'utf8');
        } catch {
          workflow = await git().show([`origin/main:${GITHUB_MONITORING_WORKFLOW_PATH}`]);
        }
        const updated = addOrgToGithubMonitoringWorkflow(workflow, branchName);
        await fs.ensureDir(path.dirname(GITHUB_MONITORING_WORKFLOW_PATH));
        await fs.writeFile(GITHUB_MONITORING_WORKFLOW_PATH, updated, 'utf8');
        const status = await git().status();
        if (status.files.some((file) => file.path === GITHUB_MONITORING_WORKFLOW_PATH)) {
          await git().add([GITHUB_MONITORING_WORKFLOW_PATH]);
          await git().commit(buildConventionalCommitMessage({ subject: `run the monitoring of ${branchName}` }), [GITHUB_MONITORING_WORKFLOW_PATH]);
          await git().push('origin', 'main');
        }
      } finally {
        await git().checkout(branchName);
      }
      uxLog("success", this, c.green(t('monitoringWorkflowScheduledFromMain', { branchName })));
      return true;
    } catch (e) {
      uxLog("warning", this, c.yellow(t('monitoringWorkflowNotScheduled', { message: (e as Error).message })));
      return false;
    }
  }
}
