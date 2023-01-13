/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import open = require("open");
import * as path from "path";
import {
  createTempDir,
  execCommand,
  execSfdxJson,
  getCurrentGitBranch,
  getGitRepoRoot,
  git,
  gitHasLocalUpdates,
  normalizeFileStatusPath,
  uxLog,
} from "../../../common/utils";
import { exportData } from "../../../common/utils/dataUtils";
import { forceSourcePull } from "../../../common/utils/deployUtils";
import { selectTargetBranch } from "../../../common/utils/gitUtils";
import { prompts } from "../../../common/utils/prompts";
import { parseXmlFile, writeXmlFile } from "../../../common/utils/xmlUtils";
import { WebSocketClient } from "../../../common/websocketClient";
import { CONSTANTS, getConfig, setConfig } from "../../../config";
import CleanReferences from "../project/clean/references";
import CleanXml from "../project/clean/xml";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class SaveTask extends SfdxCommand {
  public static title = "Save work task";

  public static description = `When a work task is completed, guide user to create a merge request

- Generate package-xml diff using sfdx-git-delta
- Automatically update \`manifest/package.xml\` and \`manifest/destructiveChanges.xml\` according to the committed updates
- Automatically Clean XML files using \`.sfdx-hardis.yml\` properties
  - \`autocleantypes\`: List of auto-performed sources cleanings, available on command [hardis:project:clean:references](https://hardisgroupcom.github.io/sfdx-hardis/hardis/project/clean/references/)
  - \`autoRemoveUserPermissions\`: List of userPermission to automatically remove from profile metadatas

Example:

\`\`\`yaml
autoCleanTypes:
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

- Push commit to server
  `;

  public static examples = ["$ sfdx hardis:work:task:save", "$ sfdx hardis:work:task:save --nopull --nogit --noclean"];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    nopull: flags.boolean({
      char: "n",
      default: false,
      description: "No scratch pull before save",
    }),
    nogit: flags.boolean({
      char: "g",
      default: false,
      description: "No automated git operations",
    }),
    noclean: flags.boolean({
      char: "c",
      default: false,
      description: "No cleaning of local sources",
    }),
    auto: flags.boolean({
      default: false,
      description: "No user prompts (when called from CI for example)",
    }),
    targetbranch: flags.string({
      description: "Name of the Merge Request target branch. Will be guessed or prompted if not provided.",
    }),
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static requiresDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ["sfdx-essentials", "sfdx-git-delta"];

  protected debugMode = false;
  protected noPull = false;
  protected noGit = false;
  protected noClean = false;
  protected auto = false;
  protected gitUrl: string;
  protected currentBranch: string;
  protected targetBranch: string;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.noPull = this.flags.nopull || false;
    this.noGit = this.flags.nogit || false;
    this.noClean = this.flags.noclean || false;
    this.auto = this.flags.auto || false;
    this.targetBranch = this.flags.targetbranch || null;
    this.debugMode = this.flags.debug || false;
    const localBranch = await getCurrentGitBranch();

    // Define current and target branches
    this.gitUrl = await git().listRemote(["--get-url"]);
    this.currentBranch = await getCurrentGitBranch();
    if (this.targetBranch == null) {
      this.targetBranch = await selectTargetBranch({ message: "Please select the target branch of your Merge Request" });
    }
    // User log info
    uxLog(
      this,
      c.cyan(`This script will prepare the merge request from your local branch ${c.green(localBranch)} to remote ${c.green(this.targetBranch)}`)
    );
    // Make sure git is clean before starting operations
    await this.cleanGitStatus();
    // Make sure commit is ready before starting operations
    const orgPullStateRes = await this.ensureCommitIsReady();
    if (orgPullStateRes && orgPullStateRes.outputString) {
      return orgPullStateRes;
    }
    // Update package.xml files using sfdx git delta
    const gitStatusWithConfig = await this.upgradePackageXmlFilesWithDelta();
    // Apply cleaning on sources
    await this.applyCleaningOnSources();
    // Build automated deployment plan
    const gitStatusAfterDeployPlan = await this.buildDeploymentPlan();

    // Push new commit(s)
    await this.manageCommitPush(gitStatusWithConfig, gitStatusAfterDeployPlan);

    // Merge request
    uxLog(this, c.cyan(`If your work is ${c.bold("completed")}, you can create a ${c.bold("merge request")}:`));
    uxLog(
      this,
      c.cyan(`- click on the link in the upper text, below ${c.italic("To create a merge request for " + this.currentBranch + ", visit")}`)
    );
    uxLog(this, c.cyan(`- or manually create the merge request on repository UI: ${c.green(this.gitUrl)}`));
    // const remote = await git().listRemote();
    // const remoteMergeRequest = `${remote.replace('.git','-/merge_requests/new')}`;
    // await open(remoteMergeRequest, {wait: true});

    // Return an object to be displayed with --json
    return { outputString: "Saved the task" };
  }

  // Clean git status
  private async cleanGitStatus() {
    // Skip git stuff if requested
    if (this.noGit) {
      uxLog(this, c.cyan(`[Expert mode] Skipped git reset`));
      return;
    }
    let gitStatusInit = await git().status();
    // Cancel merge if ongoing merge
    if (gitStatusInit.conflicted.length > 0) {
      await git({ output: true }).merge(["--abort"]);
      gitStatusInit = await git().status();
    }
    // Unstage files
    if (gitStatusInit.staged.length > 0) {
      await execCommand("git reset", this, { output: true, fail: true });
    }
  }

  private async ensureCommitIsReady() {
    // Manage force:source:pull from scratch org
    if (this.noPull || this.auto) {
      // Skip pull
      uxLog(this, c.cyan(`Skipped force:source:pull from scratch org`));
      return;
    }
    // Request user if commit is ready
    const commitReadyRes = await prompts({
      type: "select",
      name: "value",
      message: c.cyanBright("Is your commit ready ?"),
      choices: [
        {
          title: "Yes, my commit is ready !",
          value: "commitReady",
          description:
            "You have already pulled updates from your org (or locally updated the files if you're a nerd) then staged your files and created a commit",
        },
        {
          title: "No, please pull my latest updates from my org",
          value: "pleasePull",
          description: "Pull latest updates from org so then you can stage files and create your commit",
        },
        {
          title: "What is a commit ? What does mean pull ? Help !",
          value: "help",
          description: "Don't panic, just click on the link that will appear in the console (CTRL + Click) and then you will know :)",
        },
      ],
    });
    if (commitReadyRes.value === "pleasePull") {
      // Process force:source:pull
      uxLog(this, c.cyan(`Pulling sources from scratch org ${this.org.getUsername()}...`));
      await forceSourcePull(this.org.getUsername(), this.debugMode);
      uxLog(this, c.cyan(`Sources has been pulled from ${this.org.getUsername()}, now you can stage and commit your updates !`));
      return { outputString: "Pull performed" };
    } else if (commitReadyRes.value === "help") {
      // Show pull commit stage help
      const commitHelpUrl = "https://hardisgroupcom.github.io/sfdx-hardis/hardis/scratch/pull/";
      uxLog(this, c.cyan(`Opening help at ${commitHelpUrl} ...`));
      await open(commitHelpUrl, { wait: true });
      return { outputString: "Help displayed at " };
    }

    // Extract data from org
    const dataSources = [
      {
        label: "Email templates",
        dataPath: "./scripts/data/EmailTemplate",
      },
    ];
    for (const dataSource of dataSources) {
      if (fs.existsSync(dataSource.dataPath)) {
        const exportDataRes = await prompts({
          type: "confirm",
          name: "value",
          message: c.cyan(`Did you update ${c.green(dataSource.label)} and want to export related data ?`),
        });
        if (exportDataRes.value === true) {
          await exportData(dataSource.dataPath, this, {
            sourceUsername: this.org.getUsername(),
          });
        }
      }
    }
  }

  private async upgradePackageXmlFilesWithDelta() {
    // Retrieving info about current branch latest commit and master branch latest commit
    const logResult = await git().log([`${this.targetBranch}..${this.currentBranch}`]);
    const toCommit = logResult.latest;
    const mergeBaseCommand = `git merge-base ${this.targetBranch} ${this.currentBranch}`;
    const mergeBaseCommandResult = await execCommand(mergeBaseCommand, this, {
      fail: true,
      debug: this.debugMode,
    });
    const masterBranchLatestCommit = mergeBaseCommandResult.stdout.replace("\n", "").replace("\r", "");

    // Build package.xml delta between most recent commit and developpement
    const localPackageXml = path.join("manifest", "package.xml");
    const toCommitMessage = toCommit ? toCommit.message : "";
    uxLog(
      this,
      c.cyan(`Calculating package.xml diff from [${c.green(this.targetBranch)}] to [${c.green(this.currentBranch)} - ${c.green(toCommitMessage)}]`)
    );
    const tmpDir = await createTempDir();
    const packageXmlCommand = `sfdx sgd:source:delta --from ${masterBranchLatestCommit} --to ${
      toCommit ? toCommit.hash : masterBranchLatestCommit
    } --output ${tmpDir}`;
    const packageXmlResult = await execSfdxJson(packageXmlCommand, this, {
      output: true,
      fail: false,
      debug: this.debugMode,
      cwd: await getGitRepoRoot(),
    });
    if (packageXmlResult.status === 0) {
      // Upgrade local destructivePackage.xml
      const localDestructiveChangesXml = path.join("manifest", "destructiveChanges.xml");
      if (!fs.existsSync(localDestructiveChangesXml)) {
        // Create default destructiveChanges.xml if not defined
        const blankDestructiveChanges = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <version>${CONSTANTS.API_VERSION}</version>
</Package>
`;
        await fs.writeFile(localDestructiveChangesXml, blankDestructiveChanges);
      }
      const diffDestructivePackageXml = path.join(tmpDir, "destructiveChanges", "destructiveChanges.xml");
      const destructivePackageXmlDiffStr = await fs.readFile(diffDestructivePackageXml, "utf8");
      uxLog(
        this,
        c.bold(c.cyan(`destructiveChanges.xml diff to be merged within ${c.green(localDestructiveChangesXml)}:\n`)) +
          c.red(destructivePackageXmlDiffStr)
      );
      const appendDestructivePackageXmlCommand =
        "sfdx essentials:packagexml:append" +
        ` --packagexmls ${localDestructiveChangesXml},${diffDestructivePackageXml}` +
        ` --outputfile ${localDestructiveChangesXml}`;
      await execCommand(appendDestructivePackageXmlCommand, this, {
        fail: true,
        debug: this.debugMode,
      });
      if ((await gitHasLocalUpdates()) && !this.noGit) {
        await git().add(localDestructiveChangesXml);
      }

      // Upgrade local package.xml
      const diffPackageXml = path.join(tmpDir, "package", "package.xml");
      const packageXmlDiffStr = await fs.readFile(diffPackageXml, "utf8");
      uxLog(this, c.bold(c.cyan(`package.xml diff to be merged within ${c.green(localPackageXml)}:\n`)) + c.green(packageXmlDiffStr));
      const appendPackageXmlCommand =
        "sfdx essentials:packagexml:append" + ` --packagexmls ${localPackageXml},${diffPackageXml}` + ` --outputfile ${localPackageXml}`;
      await execCommand(appendPackageXmlCommand, this, {
        fail: true,
        debug: this.debugMode,
      });
      const removePackageXmlCommand =
        "sfdx essentials:packagexml:remove" +
        ` --packagexml ${localPackageXml}` +
        ` --removepackagexml ${localDestructiveChangesXml}` +
        ` --outputfile ${localPackageXml}`;
      await execCommand(removePackageXmlCommand, this, {
        fail: true,
        debug: this.debugMode,
      });
      if ((await gitHasLocalUpdates()) && !this.noGit) {
        await git().add(localPackageXml);
      }
    } else {
      uxLog(this, `[error] ${c.grey(JSON.stringify(packageXmlResult))}`);
      uxLog(this, c.red(`Unable to build git diff.${c.yellow(c.bold("Please update package.xml and destructiveChanges.xml manually"))}`));
    }

    // Commit updates
    const gitStatusWithConfig = await git().status();
    if (gitStatusWithConfig.staged.length > 0 && !this.noGit) {
      uxLog(this, `Committing files in local git branch ${c.green(this.currentBranch)}...`);
      await git({ output: true }).commit("[sfdx-hardis] Update package content");
    }
    return gitStatusWithConfig;
  }

  // Apply automated cleaning to avoid to have to do it manually
  private async applyCleaningOnSources() {
    const config = await getConfig("branch");
    if (!this.noClean) {
      const gitStatusFilesBeforeClean = (await git().status()).files.map((file) => file.path);
      uxLog(this, JSON.stringify(gitStatusFilesBeforeClean, null, 2));
      // References cleaning
      uxLog(this, c.cyan("Cleaning sfdx project from obsolete references..."));
      // User defined cleaning
      await CleanReferences.run(["--type", "all"]);
      uxLog(this, c.cyan("Cleaning sfdx project using patterns and xpaths defined in cleanXmlPatterns..."));
      await CleanXml.run([]);
      // Manage git after cleaning
      const gitStatusAfterClean = await git().status();
      uxLog(this, JSON.stringify(gitStatusAfterClean, null, 2));
      const cleanedFiles = gitStatusAfterClean.files
        .filter((file) => !gitStatusFilesBeforeClean.includes(file.path))
        .map((file) => normalizeFileStatusPath(file.path, config));
      if (cleanedFiles.length > 0) {
        uxLog(this, c.cyan(`Cleaned the following list of files:\n${cleanedFiles.join("\n")}`));
        if (!this.noGit) {
          try {
            await git().add(cleanedFiles);
            await git({ output: true }).commit("[sfdx-hardis] Clean sfdx project");
          } catch (e) {
            uxLog(this, c.yellow(`There may be an issue while adding cleaned files but it can be ok to ignore it\n${c.grey(e.message)}`));
          }
        }
      }
    }
  }

  private async buildDeploymentPlan() {
    // Build deployment plan splits
    let splitConfig = await this.getSeparateDeploymentsConfig();
    const localPackageXml = path.join("manifest", "package.xml");
    const packageXml = await parseXmlFile(localPackageXml);
    for (const type of packageXml.Package.types || []) {
      const typeName = type.name[0];
      splitConfig = splitConfig.map((split) => {
        if (split.types.includes(typeName) && type.members[0] !== "*") {
          split.content[typeName] = type.members;
        }
        return split;
      });
    }
    // Generate deployment plan items
    const config = await getConfig("project");
    const deploymentPlan = config?.deploymentPlan || {};
    let packages = deploymentPlan?.packages || [];
    const blankPackageXml = packageXml;
    blankPackageXml.Package.types = [];
    for (const split of splitConfig) {
      if (Object.keys(split.content).length > 0) {
        // data case
        if (split.data) {
          const label = `Import ${split.types.join("-")} records`;
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
          const label = `Deploy ${split.types.join("-")}`;
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
    await setConfig("project", { deploymentPlan: deploymentPlan });
    if (!this.noGit) {
      await git({ output: true }).add(["./config"]);
      await git({ output: true }).add(["./manifest"]);
    }
    const gitStatusAfterDeployPlan = await git().status();
    if (gitStatusAfterDeployPlan.staged.length > 0 && !this.noGit) {
      await git({ output: true }).commit("[sfdx-hardis] Update deployment plan");
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
        type: "confirm",
        name: "push",
        default: true,
        message: c.cyanBright(`Do you want to push your commit(s) on git server ? (git push in remote git branch ${c.green(this.currentBranch)})`),
      });
      if (pushResponse.push === true) {
        uxLog(this, c.cyan(`Pushing new commit(s) in remote git branch ${c.green(`origin/${this.currentBranch}`)}...`));
        const configUSer = await getConfig("user");
        let pushResult: any;
        if (configUSer.canForcePush === true) {
          // Force push if hardis:work:resetselection has been called before
          pushResult = await git({ output: true }).push(["-u", "origin", this.currentBranch, "--force"]);
          await setConfig("user", { canForcePush: false });
        } else {
          pushResult = await git({ output: true }).push(["-u", "origin", this.currentBranch]);
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
          await setConfig("user", { mergeRequests: mergeRequestsStored.filter((mr: any) => mr !== null) });
          WebSocketClient.sendMessage({ event: "refreshStatus" });
        }
      }
    }
  }

  private updateMergeRequestInfo(mergeRequestStored, mergeRequestInfo) {
    if (this.debugMode) {
      uxLog(this, c.grey(JSON.stringify(mergeRequestInfo, null, 2)));
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
    if (mergeRequestInfo?.remoteMessages?.all[0] && mergeRequestInfo?.remoteMessages?.all[0].includes("View merge request")) {
      mergeRequestStored.url = mergeRequestInfo?.remoteMessages?.all[1];
    } else {
      delete mergeRequestStored.url;
    }
    return mergeRequestStored;
  }

  private async getSeparateDeploymentsConfig() {
    const config = await getConfig("project");
    if (config.separateDeploymentsConfig || config.separateDeploymentsConfig === false) {
      return config.separateDeploymentConfig || [];
    }
    const separateDeploymentConfig = [
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
      },
      {
        types: ["SharingRules", "SharingOwnerRule"],
        files: "manifest/splits/packageXmlSharingRules{{name}}.xml",
        filePos: 30,
        mainType: "SharingRules",
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
