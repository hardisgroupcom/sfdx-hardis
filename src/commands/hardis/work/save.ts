/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import {
  createTempDir,
  execCommand,
  execSfdxJson,
  getCurrentGitBranch,
  git,
  gitHasLocalUpdates,
  interactiveGitAdd,
  uxLog,
} from "../../../common/utils";
import { exportData } from "../../../common/utils/dataUtils";
import { forceSourcePull } from "../../../common/utils/deployUtils";
import { prompts } from "../../../common/utils/prompts";
import { parseXmlFile, writeXmlFile } from "../../../common/utils/xmlUtils";
import { WebSocketClient } from "../../../common/websocketClient";
import { getConfig, setConfig } from "../../../config";
import CleanReferences from "../project/clean/references";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class SaveTask extends SfdxCommand {
  public static title = "Save work task";

  public static description = messages.getMessage("completeWorkTask");

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
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: flags.string({
      description: messages.getMessage("websocket"),
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ["sfdx-essentials", "sfdx-git-delta"];

  protected debugMode = false;
  protected noPull = false;
  protected noGit = false;
  protected noClean = false;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.noPull = this.flags.nopull || false;
    this.noGit = this.flags.nogit || false;
    this.noClean = this.flags.noclean || false;
    this.debugMode = this.flags.debug || false;
    let config = await getConfig("project");
    const localBranch = await getCurrentGitBranch();

    uxLog(
      this,
      c.cyan(
        `This script will prepare the merge request from your local branch ${c.green(localBranch)} to remote ${c.green(config.developmentBranch)}`
      )
    );

    if (this.noGit) {
      uxLog(this, c.cyan(`[Expert mode] Skipped git reset`));
    } else {
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

    // Manage force:source:pull from scratch org
    if (this.noPull) {
      // Skip pull
      uxLog(this, c.cyan(`[Expert mode] Skipped force:source:pull from scratch org`));
    } else {
      // Request user
      const pullRes = await prompts({
        type: "select",
        name: "value",
        message: c.cyanBright("Do you want to pull the latest updates performed on the scratch org ?"),
        choices: [
          { title: "Yes, I want to pull latest updates from the scratch org", value: true},
          { title: "No, I want to save directly from local files on my computer", value: false}
        ]
      });
      if (pullRes.value === true) {
        // Process force:source:pull
        uxLog(this, c.cyan(`Pulling sources from scratch org ${this.org.getUsername()}...`));
        await forceSourcePull(this.org.getUsername(), this.debugMode);
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

    const gitUrl = await git().listRemote(["--get-url"]);
    const currentGitBranch = await getCurrentGitBranch();

    // Request user to select what he/she wants to commit
    const groups = [
      {
        label: "Tech config (recommended)",
        regex: /(\.gitignore|\.forceignore|\.mega-linter.yml|\.vscode|config\/|gitlab|scripts\/|package\.json|sfdx-project\.json)/i,
        defaultSelect: true,
      },
      {
        label: "Objects",
        regex: /objects\//i,
        defaultSelect: true,
      },
      {
        label: "Picklists",
        regex: /(standardValueSets|globalValueSets)\//i,
        defaultSelect: true,
      },
      {
        label: "Tabs",
        regex: /tabs\//i,
        defaultSelect: true,
      },
      {
        label: "Classes/Triggers",
        regex: /(classes|triggers)\//i,
        defaultSelect: true,
      },
      {
        label: "Aura/LWC Components",
        regex: /(aura|lwc)\//i,
        defaultSelect: true,
      },
      {
        label: "Emails",
        regex: /email\//i,
        defaultSelect: true,
      },
      {
        label: "Flows, Workflows, Path Assistants",
        regex: /(flows|workflows|pathAssistants)\//i,
        defaultSelect: true,
      },
      {
        label: "Layouts",
        regex: /layouts\//i,
        defaultSelect: false,
      },
      {
        label: "Object Translations",
        regex: /objectTranslations\//i,
        defaultSelect: false,
      },
      {
        label: "Permissionsets",
        regex: /permissionsets\//i,
        defaultSelect: false,
      },
      {
        label: "Profiles (not recommended, use Permission Sets instead)",
        regex: /profiles\//i,
        defaultSelect: false,
      },
      {
        label: "Other",
        regex: /(.*?)/i,
        defaultSelect: false,
      },
    ];
    if (this.noGit) {
      uxLog(this, c.cyan(`[Expert mode] Skipped interactive git add: must be done manually`));
    } else {
      await interactiveGitAdd({ groups: groups });
    }

    // Commit updates
    const gitStatus = await git().status();
    if (gitStatus.files.length > 0 && !this.noGit) {
      // Request commit info
      const commitResponse = await prompts([
        {
          type: "text",
          name: "commitText",
          message: c.cyanBright(
            'Please define a title describing what you did in the work task (50 chars max). Exemples "Update sharing rules configuration", "Create new webservice getAccount"...'
          ),
        },
      ]);
      uxLog(this, c.cyan(`Committing files in local git branch ${c.green(currentGitBranch)}...`));
      await git().commit(commitResponse.commitText || "Updated by sfdx-hardis");
    }

    // Retrieving info about current branch latest commit and master branch latest commit
    const logResult = await git().log([`${config.developmentBranch}..${currentGitBranch}`]);
    const toCommit = logResult.latest;
    const mergeBaseCommand = `git merge-base ${config.developmentBranch} ${currentGitBranch}`;
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
      c.cyan(
        `Calculating package.xml diff from [${c.green(config.developmentBranch)}] to [${c.green(currentGitBranch)} - ${c.green(toCommitMessage)}]`
      )
    );
    const tmpDir = await createTempDir();
    const packageXmlCommand = `sfdx sgd:source:delta --from ${masterBranchLatestCommit} --to ${
      toCommit ? toCommit.hash : masterBranchLatestCommit
    } --output ${tmpDir}`;
    const packageXmlResult = await execSfdxJson(packageXmlCommand, this, {
      output: false,
      fail: false,
      debug: this.debugMode,
    });
    if (packageXmlResult.status === 0) {
      // Upgrade local destructivePackage.xml
      const localDestructiveChangesXml = path.join("manifest", "destructiveChanges.xml");
      if (!fs.existsSync(localDestructiveChangesXml)) {
        // Create default destructiveChanges.xml if not defined
        const blankDestructiveChanges = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <version>51.0</version>
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
      uxLog(
        this,
        c.red(`Unable to build git diff. Please call a developer to ${c.yellow(c.bold("update package.xml and destructivePackage.xml manually"))}`)
      );
    }

    // Commit updates
    const gitStatusWithConfig = await git().status();
    if (gitStatusWithConfig.staged.length > 0 && !this.noGit) {
      uxLog(this, `Committing files in local git branch ${c.green(currentGitBranch)}...`);
      await git({ output: true }).commit("[sfdx-hardis] Update package content");
    }

    // Apply cleaning defined on project
    if (!this.noClean) {
      const gitStatusFilesBeforeClean = (await git().status()).files.map((file) => file.path);
      console.log(JSON.stringify(gitStatusFilesBeforeClean, null, 2));
      uxLog(this, c.cyan("Cleaning sfdx project from obsolete references..."));
      // await execCommand("sfdx hardis:project:clean:references --type all", this, { output: true, fail: true, debug: this.debugMode });
      await CleanReferences.run(["--type", "all"]);
      const gitStatusAfterClean = await git().status();
      console.log(JSON.stringify(gitStatusAfterClean, null, 2));
      const cleanedFiles = gitStatusAfterClean.files.filter((file) => !gitStatusFilesBeforeClean.includes(file.path)).map((file) => file.path);
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

    // Build deployment plan splits
    let splitConfig = this.getSeparateDeploymentsConfig();
    const packageXml = await parseXmlFile(localPackageXml);
    for (const type of packageXml.Package.types || []) {
      const typeName = type.name[0];
      splitConfig = splitConfig.map((split) => {
        if (split.types.includes(typeName)) {
          split.content[typeName] = type.members;
        }
        return split;
      });
    }
    // Generate deployment plan items
    config = await getConfig("project");
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
          for (const mainTypeMember of split.content[split.mainType]) {
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

    // Push new commit(s)
    if ((gitStatus.staged.length > 0 || gitStatusWithConfig.staged.length > 0 || gitStatusAfterDeployPlan.staged.length > 0) && !this.noGit) {
      const pushResponse = await prompts({
        type: "confirm",
        name: "push",
        default: true,
        message: c.cyanBright(`Do you want to save your updates on git server ? (git push in remote git branch ${c.green(currentGitBranch)})`),
      });
      if (pushResponse.push === true) {
        uxLog(this, c.cyan(`Pushing new commit(s) in remote git branch ${c.green(`origin/${currentGitBranch}`)}...`));
        const configUSer = await getConfig("user");
        let pushResult: any;
        if (configUSer.canForcePush === true) {
          // Force push if hardis:work:resetselection has been called before
          pushResult = await git({ output: true }).push(["-u", "origin", currentGitBranch, "--force"]);
          await setConfig("user", { canForcePush: false });
        } else {
          pushResult = await git({ output: true }).push(["-u", "origin", currentGitBranch]);
        }
        // Update merge request info
        if (pushResult && pushResult.remoteMessages) {
          let mergeRequestsStored = configUSer.mergeRequests || [];
          if (mergeRequestsStored.filter((mergeRequest) => mergeRequest?.branch === currentGitBranch).length === 1) {
            mergeRequestsStored = mergeRequestsStored.map((mergeRequestStored) => {
              if (mergeRequestStored?.branch === currentGitBranch) {
                return this.updateMergeRequestInfo(mergeRequestStored, pushResult);
              }
            });
          } else {
            mergeRequestsStored.push(this.updateMergeRequestInfo({ branch: currentGitBranch }, pushResult));
          }
          // Update user config file & send Websocket event
          await setConfig("user", { mergeRequests: mergeRequestsStored.filter((mr: any) => mr !== null) });
          WebSocketClient.sendMessage({ event: "refreshStatus" });
        }
      }
    }

    // Merge request
    uxLog(this, c.cyan(`If your work is ${c.bold("completed")}, you can create a ${c.bold("merge request")}:`));
    uxLog(this, c.cyan(`- click on the link in the upper text, below ${c.italic("To create a merge request for " + currentGitBranch + ", visit")}`));
    uxLog(this, c.cyan(`- or manually create the merge request on repository UI: ${c.green(gitUrl)}`));
    // const remote = await git().listRemote();
    // const remoteMergeRequest = `${remote.replace('.git','-/merge_requests/new')}`;
    // await open(remoteMergeRequest, {wait: true});

    // Return an object to be displayed with --json
    return { outputString: "Saved the task" };
  }

  private updateMergeRequestInfo(mergeRequestStored, mergeRequestInfo) {
    if (this.debugMode) {
      console.log(c.grey(JSON.stringify(mergeRequestInfo, null, 2)));
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

  private getSeparateDeploymentsConfig() {
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
