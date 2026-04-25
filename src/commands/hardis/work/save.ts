/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import open from 'open';
import * as path from 'path';
import {
  createTempDir,
  execCommand,
  getCurrentGitBranch,
  getGitRepoUrl,
  git,
  gitHasLocalUpdates,
  gitPush,
  normalizeFileStatusPath,
  uxLog,
  uxLogTable,
} from '../../../common/utils/index.js';
import { exportData } from '../../../common/utils/dataUtils.js';
import { forceSourcePull } from '../../../common/utils/deployUtils.js';
import { callSfdxGitDelta, getGitDeltaScope, selectTargetBranch } from '../../../common/utils/gitUtils.js';
import { prompts } from '../../../common/utils/prompts.js';
import {
  appendPackageXmlFilesContent,
  parseXmlFile,
  removePackageXmlFilesContent,
  writeXmlFile,
} from '../../../common/utils/xmlUtils.js';
import { WebSocketClient } from '../../../common/websocketClient.js';
import { CONSTANTS, getApiVersion, getConfig, setConfig } from '../../../config/index.js';
import CleanReferences from '../project/clean/references.js';
import CleanXml from '../project/clean/xml.js';
import { GitProvider } from '../../../common/gitProvider/index.js';
import { t } from '../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class SaveTask extends SfCommand<any> {
  public static title = 'Save User Story';

  public static description = `
## Command Behavior

**Guides the user through the process of saving their work, preparing it for a Merge Request (also named Pull Request), and pushing changes to the remote Git repository.**

This command automates several critical steps involved in finalizing a development User Story and integrating it into the main codebase. It ensures that your local changes are properly synchronized, cleaned, and committed before being pushed.

Key functionalities include:

- **Git Status Management:** Ensures a clean Git working directory by handling ongoing merges and unstaging files.
- **Org Synchronization (Optional):** In interactive mode, prompts the user to pull the latest metadata updates from their scratch org or source-tracked sandbox, ensuring local files reflect the org's state.
- **Package.xml Updates:** Automatically generates \`package.xml\` and \`destructiveChanges.xml\` files based on the Git delta between your current branch and the target branch, reflecting added, modified, and deleted metadata.
- **Automated Source Cleaning:** Applies predefined cleaning operations to your local Salesforce sources, such as removing unwanted references, minimizing profiles, or cleaning XML files based on configurations in your \`.sfdx-hardis.yml\`.
  - \`autoCleanTypes\`: A list of automated source cleanings, configurable via [hardis:project:clean:references](https://sfdx-hardis.cloudity.com/hardis/project/clean/references/).
  - \`autoRemoveUserPermissions\`: A list of user permissions to automatically remove from profile metadata.
- **Deployment Plan Generation:** Builds an automated deployment plan based on the updated \`package.xml\` and configured deployment splits.
- **Commit and Push:** Guides the user to commit the changes and push them to the remote Git repository, optionally handling force pushes if a branch reset occurred.
- **Merge Request Guidance:** Provides information and links to facilitate the creation of a merge request after the changes are pushed.
- **Agent Mode (\`--agent\`):** Enables a fully non-interactive execution path for AI agents and automation. In this mode, prompts are disabled and decisions are derived from flags and configuration.

### Agent Mode Invocation

Use \`--agent\` to disable prompts. Typical usage:

\`sf hardis:work:save --agent\`

In \`--agent\` mode:

- target branch is resolved from \`--targetbranch\` when provided
- otherwise target branch is inferred from \`localStorageBranchTargets\` in user config for the current local branch
- metadata pull is always skipped (commits are assumed to be already prepared)
- data export is always skipped
- push is always attempted at the end of the command (unless \`--nogit\` is set)

If target branch cannot be resolved, the command fails fast with a validation error listing available options.

Example \`.sfdx-hardis.yml\` configuration:

\`\`\`yaml
autoCleanTypes:
  - checkPermissions
  - destructivechanges
  - datadotcom
  - minimizeProfiles
  - listViewsMine
autoRemoveUserPermissions:
  - EnableCommunityAppLauncher
  - FieldServiceAccess
  - OmnichannelInventorySync
  - SendExternalEmailAvailable
  - UseOmnichannelInventoryAPIs
  - ViewDataLeakageEvents
  - ViewMLModels
  - ViewPlatformEvents
  - WorkCalibrationUser
\`\`\`

Advanced instructions are available in the [Publish a User Story documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-publish-task/).

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves a series of orchestrated steps:

- **Git Integration:** Extensively uses the \`git\` utility for status checks, adding files, committing, and pushing. It also leverages \`sfdx-git-delta\` for generating metadata differences between Git revisions.
- **Interactive Prompts:** Employs the \`prompts\` library in interactive mode for decisions like pulling sources or pushing commits. In \`--agent\` mode, prompts are skipped.
- **Configuration Management:** Reads and updates project and user configurations using \`getConfig\` and \`setConfig\` to store preferences and deployment plans.
- **Metadata Synchronization:** Calls \`forceSourcePull\` in interactive mode when requested, and \`callSfdxGitDelta\` to generate \`package.xml\` and \`destructiveChanges.xml\` based on Git changes.
- **XML Manipulation:** Utilizes \`appendPackageXmlFilesContent\`, \`removePackageXmlFilesContent\`, \`parseXmlFile\`, and \`writeXmlFile\` for modifying \`package.xml\` and \`destructiveChanges.xml\` files.
- **Automated Cleaning:** Integrates with \`CleanReferences.run\` and \`CleanXml.run\` commands to perform automated cleaning operations on the Salesforce source files.
- **Deployment Plan Building:** Dynamically constructs a deployment plan by analyzing the \`package.xml\` content and applying configured deployment splits.
- **WebSocket Communication:** Uses \`WebSocketClient.sendRefreshStatusMessage\` to notify connected VS Code clients about status updates.
- **External Tool Integration:** Requires the \`sfdx-git-delta\` plugin to be installed for its core functionality.
</details>
`;

  public static examples = [
    '$ sf hardis:work:task:save',
    '$ sf hardis:work:task:save --nopull --nogit --noclean',
    '$ sf hardis:work:save --agent --targetbranch integration',
  ];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    nopull: Flags.boolean({
      char: 'n',
      default: false,
      description: 'No scratch pull before save',
    }),
    nogit: Flags.boolean({
      char: 'g',
      default: false,
      description: 'No automated git operations',
    }),
    noclean: Flags.boolean({
      char: 'c',
      default: false,
      description: 'No cleaning of local sources',
    }),
    auto: Flags.boolean({
      default: false,
      description: 'No user prompts (when called from CI for example)',
    }),
    targetbranch: Flags.string({
      description: 'Name of the Merge Request target branch. Will be guessed or prompted if not provided.',
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
  }; // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ['sfdx-git-delta'];

  protected debugMode = false;
  protected noPull = false;
  protected noGit = false;
  protected noClean = false;
  protected auto = false;
  protected agentMode = false;
  protected agentInputs: {
    targetBranch: string;
  } | null = null;
  protected gitUrl: string;
  protected currentBranch: string;
  protected targetBranch: string | null;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(SaveTask);
    this.agentMode = flags.agent === true;
    const localBranch = (await getCurrentGitBranch()) || '';
    this.agentInputs = this.agentMode ? await this.validateAgentInputs(flags, localBranch) : null;

    this.noPull = this.agentMode ? true : flags.nopull || false;
    this.noGit = flags.nogit || false;
    this.noClean = flags.noclean || false;
    this.auto = flags.auto || false;
    this.targetBranch = flags.targetbranch || null;
    this.debugMode = flags.debug || false;

    // Define current and target branches
    this.gitUrl = await getGitRepoUrl() || '';
    this.currentBranch = (await getCurrentGitBranch()) || '';
    if (this.targetBranch == null) {
      const userConfig = await getConfig('user');
      if (userConfig?.localStorageBranchTargets && userConfig?.localStorageBranchTargets[localBranch]) {
        this.targetBranch = userConfig?.localStorageBranchTargets[localBranch];
      }
    }
    if (this.targetBranch == null) {
      if (this.agentMode) {
        this.targetBranch = this.agentInputs!.targetBranch;
      } else {
        this.targetBranch = await selectTargetBranch({
          message: t('pleaseSelectTheTargetBranchOfYour2', { GitProvider: GitProvider.getMergeRequestName(this.gitUrl) }),
        });
      }
    }
    // User log info
    uxLog(
      "action",
      this,
      c.cyan(
        t('preparingMergeRequestFromBranchToBranch', { mergeRequestName: GitProvider.getMergeRequestName(this.gitUrl), sourceBranch: c.green(localBranch), targetBranch: c.green(this.targetBranch) })
      )
    );
    // Make sure git is clean before starting operations
    await this.cleanGitStatus();
    // Make sure commit is ready before starting operations
    const orgPullStateRes = await this.ensureCommitIsReady(flags);
    if (orgPullStateRes && orgPullStateRes.outputString) {
      return orgPullStateRes;
    }
    // Update package.xml files using sfdx-git-delta
    const gitStatusWithConfig = await this.upgradePackageXmlFilesWithDelta();
    // Apply cleaning on sources
    await this.applyCleaningOnSources();
    // Build automated deployment plan
    const gitStatusAfterDeployPlan = await this.buildDeploymentPlan();

    // Push new commit(s)
    await this.manageCommitPush(gitStatusWithConfig, gitStatusAfterDeployPlan);


    let mergeRequestUrl = GitProvider.getMergeRequestCreateUrl(this.gitUrl, this.targetBranch || '', this.currentBranch);
    mergeRequestUrl = mergeRequestUrl || this.gitUrl.replace('.git', '');

    // Merge request
    uxLog("action", this, c.cyan(t('ifYourWorkIsCreateOtherwisePush', { completed: c.bold(t('completed')), GitProvider: c.bold(GitProvider.getMergeRequestName(this.gitUrl)), currentBranch: c.green(this.currentBranch) })));
    let summaryMsg = c.grey("");
    if (WebSocketClient.isAliveWithLwcUI()) {
      WebSocketClient.sendReportFileMessage(mergeRequestUrl, t('createMergeRequestLabel', { mergeRequestName: GitProvider.getMergeRequestName(this.gitUrl) }), 'actionUrl');
    }
    else {
      summaryMsg += c.grey(`- New ${GitProvider.getMergeRequestName(this.gitUrl)} URL: ${c.green(mergeRequestUrl)}\n`);
    }
    const mergeRequestDoc = `${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-publish-task/#create-merge-request`;
    summaryMsg += c.grey('- ' + t('repositoryLabel') + ': ' + c.green(this.gitUrl.replace('.git', '')) + '\n');
    summaryMsg += c.grey('- ' + t('sourceBranchLabel') + ': ' + c.green(this.currentBranch) + '\n');
    summaryMsg += c.grey('- ' + t('targetBranchLabel') + ': ' + c.green(this.targetBranch));
    uxLog("log", this, summaryMsg);
    if (!this.agentMode) {
      uxLog("log", this, `${c.yellow(t('whenYourHasBeenMerged', { GitProvider: GitProvider.getMergeRequestName(this.gitUrl) }))}
- ${c.yellow(t('doNotReuseTheSameBranch'))}
- ${t('useNewUserStoryMenuEvenIfSameOrg')} 😊`);
      // Manual actions file
      const config = await getConfig('project');
      if (config.manualActionsFileUrl && config.manualActionsFileUrl !== '') {
        uxLog("warning", this, c.yellow(t('ifYouHavePreDeploymentOrPost', { config: c.green(config.manualActionsFileUrl) })));
        if (WebSocketClient.isAliveWithLwcUI()) {
          WebSocketClient.sendReportFileMessage(config.manualActionsFileUrl, t('updateManualActionsFile'), 'actionUrl');
        }
      }
      else {
        uxLog("warning", this, c.yellow(t('defineManualActionsFileAskReleaseMgr')));
      }
      if (!WebSocketClient.isAliveWithLwcUI()) {
        uxLog("log", this, c.grey(`${GitProvider.getMergeRequestName(this.gitUrl)} documentation is available here -> ${c.bold(mergeRequestDoc)}`));
      }
      WebSocketClient.sendReportFileMessage(mergeRequestDoc, t('viewMergeRequestDocumentation', { mergeRequestName: GitProvider.getMergeRequestName(this.gitUrl) }), 'docUrl');
    }
    // Return an object to be displayed with --json
    return { outputString: 'Saved the User Story' };
  }

  // Clean git status
  private async cleanGitStatus() {
    // Skip git stuff if requested
    if (this.noGit) {
      uxLog("action", this, c.cyan(t('expertModeSkippedGitReset')));
      return;
    }
    let gitStatusInit = await git().status();
    // Cancel merge if ongoing merge
    if (gitStatusInit.conflicted.length > 0) {
      await git({ output: true }).merge(['--abort']);
      gitStatusInit = await git().status();
    }
    // Unstage files
    if (gitStatusInit.staged.length > 0) {
      await execCommand('git reset', this, { output: true, fail: true });
    }
  }

  private async ensureCommitIsReady(flags) {
    if (this.agentMode) {
      uxLog("action", this, c.cyan(t('skippedSfProjectRetrieveStart')));
      return;
    }

    // Manage project deploy start from scratch org
    if (this.noPull || this.auto) {
      // Skip pull
      uxLog("action", this, c.cyan(t('skippedSfProjectRetrieveStart')));
      return;
    }
    // Request user if commit is ready
    const commitReadyRes = await prompts({
      type: 'select',
      name: 'value',
      message: c.cyanBright(t('haveYouAlreadyCommittedTheUpdatedMetadata')),
      description: t('selectYourCurrentStateRegardingGitCommits'),
      placeholder: t('selectCommitStatus'),
      choices: [
        {
          title: t('commitsAreReady'),
          value: 'commitReady',
          description: t('commitsAreReadyDescription'),
        },
        {
          title: t('pleasePullLatestUpdatesFromOrgForCommit'),
          value: 'pleasePull',
          description: t('pullLatestUpdatesFromOrgToStageAndCommit'),
        },
        {
          title: t('whatIsACommitHelp'),
          value: 'help',
          description: t('dontPanicClickLinkInConsole'),
        },
      ],
    });
    if (commitReadyRes.value === 'pleasePull') {
      // Process sf project retrieve start
      uxLog("action", this, c.cyan(t('pullingSourcesFromScratchOrg', { flags: flags['target-org'].getUsername() })));
      await forceSourcePull(flags['target-org'].getUsername(), this.debugMode);
      uxLog(
        "action",
        this,
        c.cyan(t('sourcesHaveBeenPulledNowStageAndCommit', { username: flags['target-org'].getUsername() }))
      );
      WebSocketClient.sendReportFileMessage("workbench.view.scm", t('commitYourRetrievedFiles'), "actionCommand");
      WebSocketClient.sendReportFileMessage(`${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-publish-task/#commit-your-updates`, t('retrieveAndCommitDocumentation'), 'docUrl');
      return { outputString: 'Pull performed' };
    } else if (commitReadyRes.value === 'help') {
      // Show pull commit stage help
      const commitHelpUrl = `${CONSTANTS.DOC_URL_ROOT}/hardis/scratch/pull/`;
      uxLog("action", this, c.cyan(t('openingHelpAt', { commitHelpUrl })));
      await open(commitHelpUrl, { wait: true });
      return { outputString: 'Help displayed at ' };
    }

    await this.manageDataExport(flags);
  }

  private async manageDataExport(flags) {
    if (this.agentMode) {
      return;
    }

    // Extract data from org
    const dataSources = [
      {
        label: 'Email templates',
        dataPath: './scripts/data/EmailTemplate',
      },
    ];
    for (const dataSource of dataSources) {
      if (!fs.existsSync(dataSource.dataPath)) {
        continue;
      }
      const exportDataRes = await prompts({
        type: 'confirm',
        name: 'value',
        message: c.cyan(t('didYouUpdateAndWantToExport', { dataSource: c.green(dataSource.label) })),
        description: t('confirmExportDataUpdatedForDataSource'),
      });
      if (exportDataRes.value === true) {
        await exportData(dataSource.dataPath, this, {
          sourceUsername: flags['target-org'].getUsername(),
        });
      }
    }
  }

  private async upgradePackageXmlFilesWithDelta() {
    uxLog("action", this, c.cyan(t('updatingManifestPackageXmlAndManifestDestructivechanges')));
    // Retrieving info about current branch latest commit and master branch latest commit
    const gitDeltaScope = await getGitDeltaScope(this.currentBranch, this.targetBranch || '');

    // Build package.xml delta between most recent commit and developpement
    const localPackageXml = path.join('manifest', 'package.xml');
    const toCommitMessage = gitDeltaScope.toCommit ? gitDeltaScope.toCommit.message : '';
    uxLog(
      "log",
      this,
      c.grey(
        t('calculatingPackageXmlDiff', { targetBranch: c.green(this.targetBranch), currentBranch: c.green(this.currentBranch), commitMessage: c.green(toCommitMessage) })
      )
    );
    const tmpDir = await createTempDir();
    const packageXmlResult = await callSfdxGitDelta(
      gitDeltaScope.fromCommit,
      gitDeltaScope.toCommit ? gitDeltaScope.toCommit.hash : gitDeltaScope.fromCommit,
      tmpDir
    );
    if (packageXmlResult.status === 0) {
      // Upgrade local destructivePackage.xml
      const localDestructiveChangesXml = path.join('manifest', 'destructiveChanges.xml');
      if (!fs.existsSync(localDestructiveChangesXml)) {
        // Create default destructiveChanges.xml if not defined
        const blankDestructiveChanges = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <version>${getApiVersion()}</version>
</Package>
`;
        await fs.writeFile(localDestructiveChangesXml, blankDestructiveChanges);
      }
      const diffDestructivePackageXml = path.join(tmpDir, 'destructiveChanges', 'destructiveChanges.xml');
      const destructivePackageXmlDiffStr = await fs.readFile(diffDestructivePackageXml, 'utf8');
      uxLog(
        "log",
        this,
        c.grey(c.bold(t('deltaDestructiveChangesXmlDiffToBeMerged', { file: c.green(localDestructiveChangesXml) }) + '\n')) +
        c.red(destructivePackageXmlDiffStr)
      );
      await appendPackageXmlFilesContent(
        [localDestructiveChangesXml, diffDestructivePackageXml],
        localDestructiveChangesXml
      );
      if ((await gitHasLocalUpdates()) && !this.noGit) {
        await git().add(localDestructiveChangesXml);
      }

      // Upgrade local package.xml
      const diffPackageXml = path.join(tmpDir, 'package', 'package.xml');
      const packageXmlDiffStr = await fs.readFile(diffPackageXml, 'utf8');
      uxLog(
        "log",
        this,
        c.grey(c.bold(t('deltaPackageXmlDiffToBeMerged', { file: c.green(localPackageXml) }) + '\n')) +
        c.green(packageXmlDiffStr)
      );
      await appendPackageXmlFilesContent([localPackageXml, diffPackageXml], localPackageXml);
      await removePackageXmlFilesContent(localPackageXml, localDestructiveChangesXml, {
        outputXmlFile: localPackageXml,
      });
      if ((await gitHasLocalUpdates()) && !this.noGit) {
        await git().add(localPackageXml);
      }
    } else {
      uxLog("log", this, `[error] ${c.grey(JSON.stringify(packageXmlResult))}`);
      uxLog(
        "error",
        this,
        c.red(t('unableToBuildGitDiff', { pleaseUpdateManually: c.yellow(c.bold(t('pleaseUpdatePackageXmlAndDestructiveManually'))) }))
      );
    }

    // Commit updates
    let gitStatusWithConfig = await git().status();
    if (gitStatusWithConfig.staged.length > 0 && !this.noGit) {
      const commitMessage = '[sfdx-hardis] Update package content';
      uxLog("action", this, c.cyan(t('addingNewCommitPackageXmlUpdates', { commitMessage })));

      // Build files list for table
      const filesTable = gitStatusWithConfig.staged.map((file) => {
        const status = gitStatusWithConfig.files.find(f => f.path === file);
        const statusLabel = status?.working_dir === 'D' ? 'deleted' : status?.index === 'A' ? 'created' : 'modified';
        return {
          Status: statusLabel,
          File: file
        };
      });
      uxLogTable(this, filesTable, ['Status', 'File']);

      try {
        await git({ output: true }).commit(commitMessage);
      } catch (e) {
        uxLog(
          "warning",
          this,
          c.yellow(t('thereIsIssueCommittingFilesButIgnore', { message: c.grey((e as Error).message) }))
        );
        gitStatusWithConfig = await git().status();
      }
    }
    return gitStatusWithConfig;
  }

  // Apply automated cleaning to avoid to have to do it manually
  private async applyCleaningOnSources() {
    const config = await getConfig('branch');
    if (!this.noClean) {
      const gitStatusFilesBeforeClean = (await git().status()).files.map((file) => file.path);
      uxLog("other", this, JSON.stringify(gitStatusFilesBeforeClean, null, 2));
      // References cleaning
      await CleanReferences.run(['--type', 'all']);
      if (globalThis?.displayProfilesWarning === true) {
        uxLog(
          "warning",
          this,
          c.yellow(c.bold(t('pleaseMakeSureTheAttributesRemovedFrom') + ' 😊'))
        );
      }

      // Xml cleaning
      if (config.cleanXmlPatterns && config.cleanXmlPatterns.length > 0) {
        uxLog("action", this, c.cyan(t('cleaningProjectUsingPatternsDefinedInCleanxmlpatterns')));
        await CleanXml.run([]);
      }

      // Manage git after cleaning
      const gitStatusAfterClean = await git().status();
      uxLog("other", this, JSON.stringify(gitStatusAfterClean, null, 2));
      const cleanedFiles = gitStatusAfterClean.files
        .filter((file) => !gitStatusFilesBeforeClean.includes(file.path))
        .map((file) => normalizeFileStatusPath(file.path, config));
      if (cleanedFiles.length > 0) {
        if (!this.noGit) {
          try {
            await git().add(cleanedFiles);

            const commitMessage = '[sfdx-hardis] Clean sfdx project';
            uxLog("action", this, c.cyan(t('addingNewCommitCleanedFiles', { commitMessage })));

            // Build files list for table
            const filesTable = cleanedFiles.map((file) => ({
              Status: 'modified',
              File: file
            }));
            uxLogTable(this, filesTable, ['Status', 'File']);

            await git({ output: true }).commit(commitMessage);
          } catch (e) {
            uxLog(
              "warning",
              this,
              c.yellow(t('thereIsIssueAddingCleanedFilesButIgnore', { message: c.grey((e as Error).message) }))
            );
          }
        }
      }
    }
  }

  private async buildDeploymentPlan() {
    const configProject = await getConfig('project');
    if (!(configProject?.enableDeprecatedDeploymentPlan === true)) {
      uxLog("log", this, c.cyan(t('deploymentPlanGenerationIsDisabledInProject')));
      return await git().status();
    }
    // Build deployment plan splits
    let splitConfig = await this.getSeparateDeploymentsConfig();
    const localPackageXml = path.join('manifest', 'package.xml');
    const packageXml = await parseXmlFile(localPackageXml);
    for (const type of packageXml.Package.types || []) {
      const typeName = type.name[0];
      splitConfig = splitConfig.map((split) => {
        if (split.types.includes(typeName) && type.members[0] !== '*') {
          split.content[typeName] = type.members;
        }
        return split;
      });
    }
    // Generate deployment plan items
    const config = await getConfig('project');
    const deploymentPlan = config?.deploymentPlan || {};
    let packages = deploymentPlan?.packages || [];
    const blankPackageXml = packageXml;
    blankPackageXml.Package.types = [];
    for (const split of splitConfig) {
      if (Object.keys(split.content).length > 0) {
        // data case
        if (split.data) {
          const label = `Import ${split.types.join('-')} records`;
          packages = this.addToPlan(packages, {
            label: label,
            dataPath: split.data,
            order: split.dataPos,
            waitAfter: split.waitAfter,
          });
        }
        // single split file case
        if (split.file) {
          const splitPackageXml = blankPackageXml;
          blankPackageXml.Package.types = [];
          for (const type of Object.keys(split.content)) {
            splitPackageXml.Package.types.push({
              name: [type],
              members: split.content[type],
            });
          }
          await writeXmlFile(split.file, splitPackageXml);
          const label = `Deploy ${split.types.join('-')}`;
          packages = this.addToPlan(packages, {
            label: label,
            packageXmlFile: split.file,
            order: split.filePos,
            waitAfter: split.waitAfter,
          });
        }
        // Multiple split file case
        if (split.files) {
          let pos = split.filePos;
          for (const mainTypeMember of split.content[split.mainType] || []) {
            const splitFile = split.files.replace(`{{name}}`, mainTypeMember);
            const splitPackageXml = blankPackageXml;
            blankPackageXml.Package.types = [];
            for (const type of Object.keys(split.content)) {
              if (type !== split.mainType) {
                const filteredMembers = split.content[type].filter((member) => member.includes(`${mainTypeMember}.`));
                splitPackageXml.Package.types.push({
                  name: [type],
                  members: filteredMembers,
                });
              }
            }
            splitPackageXml.Package.types.push({
              name: [split.mainType],
              members: [mainTypeMember],
            });
            await writeXmlFile(splitFile, splitPackageXml);
            const label = `Deploy ${split.mainType} - ${mainTypeMember}`;
            packages = this.addToPlan(packages, {
              label: label,
              packageXmlFile: splitFile,
              order: pos,
              waitAfter: split.waitAfter,
            });
            pos++;
          }
        }
      }
    }
    // Update deployment plan in config
    deploymentPlan.packages = packages.sort((a, b) => (a.order > b.order ? 1 : -1));
    await setConfig('project', { deploymentPlan: deploymentPlan });
    if (!this.noGit) {
      await git({ output: true }).add(['./config']);
      await git({ output: true }).add(['./manifest']);
    }
    let gitStatusAfterDeployPlan = await git().status();
    if (gitStatusAfterDeployPlan.staged.length > 0 && !this.noGit) {
      const commitMessage = '[sfdx-hardis] Update deployment plan';
      uxLog("action", this, c.cyan(t('addingNewCommitDeploymentPlan', { commitMessage })));

      // Build files list for table
      const filesTable = gitStatusAfterDeployPlan.staged.map((file) => {
        const status = gitStatusAfterDeployPlan.files.find(f => f.path === file);
        const statusLabel = status?.working_dir === 'D' ? 'deleted' : status?.index === 'A' ? 'created' : 'modified';
        return {
          Status: statusLabel,
          File: file
        };
      });
      uxLogTable(this, filesTable, ['Status', 'File']);

      try {
        await git({ output: true }).commit(commitMessage);
      } catch (e) {
        uxLog(
          "warning",
          this,
          c.yellow(t('thereIsIssueCommittingFilesButIgnore', { message: c.grey((e as Error).message) }))
        );
        gitStatusAfterDeployPlan = await git().status();
      }
    }
    return gitStatusAfterDeployPlan;
  }

  // Manage push from user
  private async manageCommitPush(gitStatusWithConfig, gitStatusAfterDeployPlan) {
    const hasUpdatesToPush =
      gitStatusWithConfig.staged.length > 0 ||
      gitStatusAfterDeployPlan.staged.length > 0 ||
      gitStatusAfterDeployPlan?.ahead > 0 ||
      gitStatusAfterDeployPlan.tracking == null;

    if (!hasUpdatesToPush || this.noGit) {
      return;
    }

    let shouldPush = false;
    if (this.agentMode) {
      shouldPush = true;
    } else if (!this.auto) {
      const pushResponse = await prompts({
        type: 'confirm',
        name: 'push',
        default: true,
        message: c.cyanBright(t('doYouWantToPushCommitsToGitBranch', { branch: c.green(this.currentBranch) })),
        description: t('pushBranchToRemoteDescription'),
      });
      shouldPush = pushResponse.push === true;
    }

    if (!shouldPush) {
      return;
    }

    uxLog("action", this, c.cyan(t('pushingCommitsToRemoteBranch', { branch: c.green(`origin/${this.currentBranch}`) })));
    const configUSer = await getConfig('user');
    let pushResult: any;
    if (configUSer.canForcePush === true) {
      // Force push if hardis:work:resetselection has been called before
      pushResult = await gitPush({ output: true }, ['-u', 'origin', this.currentBranch, '--force']);
      await setConfig('user', { canForcePush: false });
    } else {
      pushResult = await gitPush({ output: true }, ['-u', 'origin', this.currentBranch]);
    }
    // Update merge request info
    if (pushResult && pushResult.remoteMessages) {
      let mergeRequestsStored = configUSer.mergeRequests || [];
      if (mergeRequestsStored.filter((mergeRequest) => mergeRequest?.branch === this.currentBranch).length === 1) {
        mergeRequestsStored = mergeRequestsStored.map((mergeRequestStored) => {
          if (mergeRequestStored?.branch === this.currentBranch) {
            return this.updateMergeRequestInfo(mergeRequestStored, pushResult);
          }
          return mergeRequestStored;
        });
      } else {
        mergeRequestsStored.push(this.updateMergeRequestInfo({ branch: this.currentBranch }, pushResult));
      }
      // Update user config file & send Websocket event
      await setConfig('user', { mergeRequests: mergeRequestsStored.filter((mr: any) => mr != null) });
      WebSocketClient.sendRefreshStatusMessage();
    }
  }

  private buildAgentUsageHelp(): string {
    return [
      'Agent mode usage:',
      '  --agent',
      '  --targetbranch <branch> (optional if mapped in user localStorageBranchTargets)',
      '  metadata pull is always skipped in --agent mode (commits assumed ready)',
      '  git push is always performed at end of command in --agent mode',
      '  data export is always skipped in --agent mode',
      'In --agent mode, all prompts are disabled.',
    ].join('\n');
  }

  private toOptionList(items: string[]): string {
    return items.length > 0 ? items.join(', ') : '(none)';
  }

  private throwAgentValidationError(missing: string[], availableOptions: string[]): never {
    const missingBlock = missing.length > 0 ? missing.map((m) => `- ${m}`).join('\n') : '- (none)';
    const optionsBlock = availableOptions.length > 0 ? availableOptions.map((o) => `- ${o}`).join('\n') : '- (none)';
    throw new SfError(
      `Invalid --agent invocation.\n\nMissing or invalid inputs:\n${missingBlock}\n\nAvailable options:\n${optionsBlock}\n\n${this.buildAgentUsageHelp()}`
    );
  }

  private async validateAgentInputs(
    flags: any,
    localBranch: string
  ): Promise<{ targetBranch: string }> {
    const missing: string[] = [];
    const available: string[] = [];

    const projectConfig = await getConfig('project');
    const userConfig = await getConfig('user');
    const inferredTargetBranch = userConfig?.localStorageBranchTargets?.[localBranch] || null;
    const availableTargetBranches = [
      ...(Array.isArray(projectConfig.availableTargetBranches) ? projectConfig.availableTargetBranches : []),
      ...(projectConfig.developmentBranch ? [projectConfig.developmentBranch] : []),
    ].filter((value: string, index: number, self: string[]) => value && self.indexOf(value) === index);

    available.push(`targetbranch: ${this.toOptionList(availableTargetBranches)}`);
    available.push(`targetbranch inferred from localStorageBranchTargets: ${inferredTargetBranch || '(none)'}`);
    available.push('metadata pull: always skipped in --agent mode');
    available.push('push: always enabled in --agent mode');
    available.push('data export: always disabled in --agent mode');
    available.push(`source branch: ${localBranch || '(detached HEAD)'}`);

    const targetBranch = flags.targetbranch || inferredTargetBranch;
    if (!targetBranch) {
      missing.push('targetbranch is required with --agent when no localStorageBranchTargets mapping exists for current branch');
    } else if (availableTargetBranches.length > 0 && !availableTargetBranches.includes(targetBranch)) {
      missing.push(
        `targetbranch="${targetBranch}" is not in availableTargetBranches. Available: ${this.toOptionList(availableTargetBranches)}`
      );
    }

    if (missing.length > 0) {
      this.throwAgentValidationError(missing, available);
    }

    return {
      targetBranch,
    };
  }

  private updateMergeRequestInfo(mergeRequestStored, mergeRequestInfo) {
    if (this.debugMode) {
      uxLog("log", this, c.grey(JSON.stringify(mergeRequestInfo, null, 2)));
    }
    if (mergeRequestInfo?.remoteMessages?.id) {
      mergeRequestStored.id = mergeRequestInfo.remoteMessages.id;
    } else {
      delete mergeRequestStored.id;
    }
    if (mergeRequestInfo?.remoteMessages?.pullRequestUrl) {
      mergeRequestStored.urlCreate = mergeRequestInfo.remoteMessages.pullRequestUrl;
    } else {
      delete mergeRequestStored.urlCreate;
    }
    if (
      mergeRequestInfo?.remoteMessages?.all[0] &&
      mergeRequestInfo?.remoteMessages?.all[0].includes('View merge request')
    ) {
      mergeRequestStored.url = mergeRequestInfo?.remoteMessages?.all[1];
    } else {
      delete mergeRequestStored.url;
    }
    return mergeRequestStored;
  }

  private async getSeparateDeploymentsConfig() {
    const config = await getConfig('project');
    if (config.separateDeploymentsConfig || config.separateDeploymentsConfig === false) {
      return config.separateDeploymentConfig || [];
    }
    const separateDeploymentConfig = [
      /*  NV: Commented because seems to be now useless
     {
        types: ["EmailTemplate"],
        file: "manifest/splits/packageXmlEmails.xml",
        filePos: -20,
        data: "scripts/data/EmailTemplate",
        dataPos: -21,
        content: {},
      },
      {
        types: ["Flow", "Workflow"],
        file: "manifest/splits/packageXmlFlowWorkflow.xml",
        filePos: 6,
        content: {},
      }, */
      {
        types: ['SharingRules', 'SharingOwnerRule'],
        files: 'manifest/splits/packageXmlSharingRules{{name}}.xml',
        filePos: 30,
        mainType: 'SharingRules',
        waitAfter: 30,
        content: {},
      },
    ];
    return separateDeploymentConfig;
  }

  // Add item to .sfdx-hardis.yml deploymentPlan property
  private addToPlan(packages, item) {
    let updated = false;
    if (item.waitAfter === null) {
      delete item.waitAfter;
    }
    packages = packages.map((pckg) => {
      if (pckg.label === item.label) {
        pckg = item;
        updated = true;
      }
      return pckg;
    });
    if (updated === false) {
      packages.push(item);
    }
    return packages;
  }
}
