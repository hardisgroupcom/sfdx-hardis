/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
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
- **Org Synchronization (Optional):** Prompts the user to pull the latest metadata updates from their scratch org or source-tracked sandbox, ensuring local files reflect the org's state.
- **Package.xml Updates:** Automatically generates \`package.xml\` and \`destructiveChanges.xml\` files based on the Git delta between your current branch and the target branch, reflecting added, modified, and deleted metadata.
- **Automated Source Cleaning:** Applies predefined cleaning operations to your local Salesforce sources, such as removing unwanted references, minimizing profiles, or cleaning XML files based on configurations in your \`.sfdx-hardis.yml\`.
  - \`autoCleanTypes\`: A list of automated source cleanings, configurable via [hardis:project:clean:references]($\{CONSTANTS.DOC_URL_ROOT}/hardis/project/clean/references/).
  - \`autoRemoveUserPermissions\`: A list of user permissions to automatically remove from profile metadata.
- **Deployment Plan Generation:** Builds an automated deployment plan based on the updated \`package.xml\` and configured deployment splits.
- **Commit and Push:** Guides the user to commit the changes and push them to the remote Git repository, optionally handling force pushes if a branch reset occurred.
- **Merge Request Guidance:** Provides information and links to facilitate the creation of a merge request after the changes are pushed.

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

Advanced instructions are available in the [Publish a User Story documentation]($\{CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-publish-task/).

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves a series of orchestrated steps:

- **Git Integration:** Extensively uses the \`git\` utility for status checks, adding files, committing, and pushing. It also leverages \`sfdx-git-delta\` for generating metadata differences between Git revisions.
- **Interactive Prompts:** Employs the \`prompts\` library to interact with the user for decisions like pulling sources or pushing commits.
- **Configuration Management:** Reads and updates project and user configurations using \`getConfig\` and \`setConfig\` to store preferences and deployment plans.
- **Metadata Synchronization:** Calls \`forceSourcePull\` to retrieve metadata from the org and \`callSfdxGitDelta\` to generate \`package.xml\` and \`destructiveChanges.xml\` based on Git changes.
- **XML Manipulation:** Utilizes \`appendPackageXmlFilesContent\`, \`removePackageXmlFilesContent\`, \`parseXmlFile\`, and \`writeXmlFile\` for modifying \`package.xml\` and \`destructiveChanges.xml\` files.
- **Automated Cleaning:** Integrates with \`CleanReferences.run\` and \`CleanXml.run\` commands to perform automated cleaning operations on the Salesforce source files.
- **Deployment Plan Building:** Dynamically constructs a deployment plan by analyzing the \`package.xml\` content and applying configured deployment splits.
- **WebSocket Communication:** Uses \`WebSocketClient.sendRefreshStatusMessage\` to notify connected VS Code clients about status updates.
- **External Tool Integration:** Requires the \`sfdx-git-delta\` plugin to be installed for its core functionality.
</details>
`;

  public static examples = ['$ sf hardis:work:task:save', '$ sf hardis:work:task:save --nopull --nogit --noclean'];

  // public static args = [{name: 'file'}];

  public static flags: any = {
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
  protected gitUrl: string;
  protected currentBranch: string;
  protected targetBranch: string | null;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(SaveTask);
    this.noPull = flags.nopull || false;
    this.noGit = flags.nogit || false;
    this.noClean = flags.noclean || false;
    this.auto = flags.auto || false;
    this.targetBranch = flags.targetbranch || null;
    this.debugMode = flags.debug || false;
    const localBranch = (await getCurrentGitBranch()) || '';

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
      this.targetBranch = await selectTargetBranch({
        message: `Please select the target branch of your future ${GitProvider.getMergeRequestName(this.gitUrl)}`,
      });
    }
    // User log info
    uxLog(
      "action",
      this,
      c.cyan(
        `Preparing ${GitProvider.getMergeRequestName(this.gitUrl)} from branch ${c.green(localBranch)} to ${c.green(
          this.targetBranch
        )}`
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
    uxLog("action", this, c.cyan(`If your work is ${c.bold('completed')}, create a ${c.bold(GitProvider.getMergeRequestName(this.gitUrl))}, otherwise push new commits to the ${c.green(this.currentBranch)} branch.`));
    let summaryMsg = c.grey("");
    if (WebSocketClient.isAliveWithLwcUI()) {
      WebSocketClient.sendReportFileMessage(mergeRequestUrl, `Create ${GitProvider.getMergeRequestName(this.gitUrl)}`, 'actionUrl');
    }
    else {
      summaryMsg += c.grey(`- New ${GitProvider.getMergeRequestName(this.gitUrl)} URL: ${c.green(mergeRequestUrl)}\n`);
    }
    const mergeRequestDoc = `${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-publish-task/#create-merge-request`;
    summaryMsg += c.grey(`- Repository: ${c.green(this.gitUrl.replace('.git', ''))}\n`);
    summaryMsg += c.grey(`- Source branch: ${c.green(this.currentBranch)}\n`);
    summaryMsg += c.grey(`- Target branch: ${c.green(this.targetBranch)}`);
    uxLog("log", this, summaryMsg);
    uxLog("log", this, `${c.yellow(`When your ${GitProvider.getMergeRequestName(this.gitUrl)} has been merged:`)}
- ${c.yellow('DO NOT REUSE THE SAME BRANCH')}
- Use New User Story menu (sf hardis:work:new), even if you work in the same sandbox or scratch org 😊`);
    // Manual actions file
    const config = await getConfig('project');
    if (config.manualActionsFileUrl && config.manualActionsFileUrl !== '') {
      uxLog("warning", this, c.yellow(`If you have pre-deployment or post-deployment manual actions, record them in ${c.green(config.manualActionsFileUrl)}`));
      if (WebSocketClient.isAliveWithLwcUI()) {
        WebSocketClient.sendReportFileMessage(config.manualActionsFileUrl, `Update Manual Actions file`, 'actionUrl');
      }
    }
    else {
      uxLog("warning", this, c.yellow(`Define a manual actions file. Ask your release manager to create one and set its URL in .sfdx-hardis.yml under manualActionsFileUrl.`));
    }
    if (!WebSocketClient.isAliveWithLwcUI()) {
      uxLog("log", this, c.grey(`${GitProvider.getMergeRequestName(this.gitUrl)} documentation is available here -> ${c.bold(mergeRequestDoc)}`));
    }
    WebSocketClient.sendReportFileMessage(mergeRequestDoc, `View ${GitProvider.getMergeRequestName(this.gitUrl)} documentation`, 'docUrl');
    // Return an object to be displayed with --json
    return { outputString: 'Saved the User Story' };
  }

  // Clean git status
  private async cleanGitStatus() {
    // Skip git stuff if requested
    if (this.noGit) {
      uxLog("action", this, c.cyan(`[Expert mode] Skipped git reset`));
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
    // Manage project deploy start from scratch org
    if (this.noPull || this.auto) {
      // Skip pull
      uxLog("action", this, c.cyan(`Skipped sf project:retrieve:start from scratch org`));
      return;
    }
    // Request user if commit is ready
    const commitReadyRes = await prompts({
      type: 'select',
      name: 'value',
      message: c.cyanBright('Have you already committed the updated metadata you want to deploy?'),
      description: 'Select your current state regarding git commits and metadata updates',
      placeholder: 'Select commit status',
      choices: [
        {
          title: '😎 Yes, my commit(s) are ready! I staged my files and created one or multiple commits.',
          value: 'commitReady',
          description:
            "You have already pulled updates from your org (or locally updated the files if you're a nerd), staged your files, and created a commit",
        },
        {
          title: '😐 No, please pull my latest updates from my org so I can commit my metadata',
          value: 'pleasePull',
          description: 'Pull latest updates from org so you can stage files and create your commit',
        },
        {
          title: '😱 What is a commit? What does pull mean? Help!',
          value: 'help',
          description:
            "Don't panic, just click on the link that will appear in the console (CTRL + Click) and you'll learn!",
        },
      ],
    });
    if (commitReadyRes.value === 'pleasePull') {
      // Process sf project retrieve start
      uxLog("action", this, c.cyan(`Pulling sources from scratch org ${flags['target-org'].getUsername()}...`));
      await forceSourcePull(flags['target-org'].getUsername(), this.debugMode);
      uxLog(
        "action",
        this,
        c.cyan(
          `Sources have been pulled from ${flags[
            'target-org'
          ].getUsername()}, now you can stage and commit your updates!`
        )
      );
      WebSocketClient.sendReportFileMessage("workbench.view.scm", "Commit your retrieved files", "actionCommand");
      WebSocketClient.sendReportFileMessage(`${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-publish-task/#commit-your-updates`, "Retrieve and Commit documentation", 'docUrl');
      return { outputString: 'Pull performed' };
    } else if (commitReadyRes.value === 'help') {
      // Show pull commit stage help
      const commitHelpUrl = `${CONSTANTS.DOC_URL_ROOT}/hardis/scratch/pull/`;
      uxLog("action", this, c.cyan(`Opening help at ${commitHelpUrl} ...`));
      await open(commitHelpUrl, { wait: true });
      return { outputString: 'Help displayed at ' };
    }

    // Extract data from org
    const dataSources = [
      {
        label: 'Email templates',
        dataPath: './scripts/data/EmailTemplate',
      },
    ];
    for (const dataSource of dataSources) {
      if (fs.existsSync(dataSource.dataPath)) {
        const exportDataRes = await prompts({
          type: 'confirm',
          name: 'value',
          message: c.cyan(`Did you update ${c.green(dataSource.label)} and want to export related data ?`),
          description: 'Confirm if you want to export data that may have been updated for this data source',
        });
        if (exportDataRes.value === true) {
          await exportData(dataSource.dataPath, this, {
            sourceUsername: flags['target-org'].getUsername(),
          });
        }
      }
    }
  }

  private async upgradePackageXmlFilesWithDelta() {
    uxLog("action", this, c.cyan('Updating manifest/package.xml and manifest/destructiveChanges.xml using sfdx-git-delta...'));
    // Retrieving info about current branch latest commit and master branch latest commit
    const gitDeltaScope = await getGitDeltaScope(this.currentBranch, this.targetBranch || '');

    // Build package.xml delta between most recent commit and developpement
    const localPackageXml = path.join('manifest', 'package.xml');
    const toCommitMessage = gitDeltaScope.toCommit ? gitDeltaScope.toCommit.message : '';
    uxLog(
      "log",
      this,
      c.grey(
        `Calculating package.xml diff from [${c.green(this.targetBranch)}] to [${c.green(
          this.currentBranch
        )} - ${c.green(toCommitMessage)}]`
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
        c.grey(c.bold(`Delta destructiveChanges.xml diff to be merged within ${c.green(localDestructiveChangesXml)}:\n`)) +
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
        c.grey(c.bold(`Delta package.xml diff to be merged within ${c.green(localPackageXml)}:\n`)) +
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
        c.red(
          `Unable to build git diff.${c.yellow(
            c.bold('Please update package.xml and destructiveChanges.xml manually')
          )}`
        )
      );
    }

    // Commit updates
    let gitStatusWithConfig = await git().status();
    if (gitStatusWithConfig.staged.length > 0 && !this.noGit) {
      const commitMessage = '[sfdx-hardis] Update package content';
      uxLog("action", this, c.cyan(`🌿Adding new commit: ${commitMessage}\n- Contains package.xml and destructiveChanges.xml updates based on your metadata changes.`));

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
          c.yellow(
            `There may be an issue while committing files, but it can be safely ignored\n${c.grey(
              (e as Error).message
            )}`
          )
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
          c.yellow(c.bold('Please make sure the attributes removed from Profiles are defined on Permission Sets 😊'))
        );
      }

      // Xml cleaning
      if (config.cleanXmlPatterns && config.cleanXmlPatterns.length > 0) {
        uxLog("action", this, c.cyan('Cleaning project using patterns defined in cleanXmlPatterns...'));
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
            uxLog("action", this, c.cyan(`🌿Adding new commit: ${commitMessage}\n- Contains files that have been automatically cleaned per your configuration.`));

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
              c.yellow(
                `There may be an issue while adding cleaned files but it can be ok to ignore it\n${c.grey(
                  (e as Error).message
                )}`
              )
            );
          }
        }
      }
    }
  }

  private async buildDeploymentPlan() {
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
      uxLog("action", this, c.cyan(`🌿Adding new commit: ${commitMessage}\n- Contains deployment plan updates (legacy feature).`));

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
          c.yellow(
            `There may be an issue while committing files, but it can be safely ignored\n${c.grey(
              (e as Error).message
            )}`
          )
        );
        gitStatusAfterDeployPlan = await git().status();
      }
    }
    return gitStatusAfterDeployPlan;
  }

  // Manage push from user
  private async manageCommitPush(gitStatusWithConfig, gitStatusAfterDeployPlan) {
    if (
      (gitStatusWithConfig.staged.length > 0 ||
        gitStatusAfterDeployPlan.staged.length > 0 ||
        gitStatusAfterDeployPlan?.ahead > 0 ||
        gitStatusAfterDeployPlan.tracking == null) &&
      !this.noGit &&
      !this.auto
    ) {
      const pushResponse = await prompts({
        type: 'confirm',
        name: 'push',
        default: true,
        message: c.cyanBright(
          `Do you want to push your commit(s) on git server ? (git push in remote git branch ${c.green(
            this.currentBranch
          )})`
        ),
        description: 'Choose whether to push your commits to the remote git repository',
      });
      if (pushResponse.push === true) {
        uxLog("action", this, c.cyan(`Pushing commit(s) to remote branch ${c.green(`origin/${this.currentBranch}`)}...`));
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
            });
          } else {
            mergeRequestsStored.push(this.updateMergeRequestInfo({ branch: this.currentBranch }, pushResult));
          }
          // Update user config file & send Websocket event
          await setConfig('user', { mergeRequests: mergeRequestsStored.filter((mr: any) => mr !== null) });
          WebSocketClient.sendRefreshStatusMessage();
        }
      }
    }
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
