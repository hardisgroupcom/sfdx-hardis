/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { getConfig } from "../../../../../config";
import * as c from "chalk";
// import * as path from "path";
import { ensureGitRepository, gitHasLocalUpdates, execCommand, git, uxLog, isCI } from "../../../../../common/utils";
import { CleanOptions } from "simple-git";
import CleanReferences from "../../../project/clean/references";
import SaveTask from "../../../work/save";
import CleanXml from "../../../project/clean/xml";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class Retrofit extends SfdxCommand {
  public static DEFAULT_SOURCES_TO_RETROFIT = [
    "CompactLayout",
    "CustomApplication",
    "CustomField",
    "CustomLabel",
    "CustomLabels",
    "CustomMetadata",
    "CustomObject",
    "CustomObjectTranslation",
    "CustomTab",
    "DuplicateRule",
    "EmailTemplate",
    "FlexiPage",
    "GlobalValueSet",
    "Layout",
    "ListView",
    "MatchingRules",
    "PermissionSet",
    "RecordType",
    "StandardValueSet",
    "Translations",
    "ValidationRule",
  ];

  public static title = "Retrofit changes from an org";

  public static description = `Retrieve changes from org link to a ref branch not present in sources

  This command need to be triggered from a branch that is connected to a SF org. It will then retrieve all changes not present in that branch sources, commit them and create a merge request against the default branch. If a merge request already exists, it will simply add a new commit.

  Define the following properties in **.sfdx-hardis.yml**

  - **productionBranch** : Name of the git branch that is corresponding to production org
  - **retrofitBranch** : Name of the git branch that will be used as merge request target

  List of metadata to retrieve can be set in three way, in order of priority :

  - \`CI_SOURCES_TO_RETROFIT\`: env variable (can be defined in CI context)
  - \`sourcesToRetrofit\` property in \`.sfdx-hardis.yml\`
  - Default list:\n\n    - ${Retrofit.DEFAULT_SOURCES_TO_RETROFIT.join("\n    - ")}

  You can also ignore some files even if they have been updated in production. To do that, define property **retrofitIgnoredFiles** in .sfdx-hardis.yml

  Example of full retrofit configuration:

  \`\`\`yaml
  productionBranch: master
  retrofitBranch: preprod
  retrofitIgnoredFiles:
  - force-app/main/default/applications/MyApp.app-meta.xml
  - force-app/main/default/applications/MyOtherApp.app-meta.xml
  - force-app/main/default/flexipages/MyFlexipageContainingDashboards.flexipage-meta.xml
  \`\`\`
  `;

  public static examples = [
    "$ sfdx hardis:org:retrieve:sources:retrofit",
    "sfdx hardis:org:retrieve:sources:retrofit --productionbranch master --commit --commitmode updated",
    "sfdx hardis:org:retrieve:sources:retrofit --productionbranch master  --retrofitbranch preprod --commit --commitmode updated --push --pushmode mergerequest",
  ];

  protected static flagsConfig = {
    commit: flags.boolean({
      default: false,
      description: "If true, a commit will be performed after the retrofit",
    }),
    commitmode: flags.enum({
      default: "updated",
      options: ["updated", "all"],
      description: "Defines if we commit all retrieved updates, or all updates including creations",
    }),
    push: flags.boolean({
      default: false,
      description: "If true, a push will be performed after the retrofit",
    }),
    pushmode: flags.enum({
      default: "default",
      options: ["default", "mergerequest"],
      description: "Defines if we send merge request options to git push arguments",
    }),
    productionbranch: flags.string({
      description:
        "Name of the git branch corresponding to the org we want to perform the retrofit on.\nCan be defined in productionBranch property in .sfdx-hardis.yml",
    }),
    retrofittargetbranch: flags.string({
      description: "Name of branch the merge request will have as target\nCan be defined in retrofitBranch property in .sfdx-hardis.yml",
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

  protected configInfo: any = {};
  protected debugMode = false;

  protected commit = false;
  protected commitMode = "updated";
  protected push = false;
  protected pushMode = "default";
  protected productionBranch: string;
  protected retrofitTargetBranch: string;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.commit = this.flags.commit || false;
    this.commitMode = this.flags.commitmode || false;
    this.push = this.flags.push || false;
    this.pushMode = this.flags.pushmode || "default";
    this.productionBranch = this.flags.productionbranch || null;
    this.retrofitTargetBranch = this.flags.retrofittargetbranch || null;
    this.debugMode = this.flags.debug || false;
    this.configInfo = await getConfig("branch");
    // check git repo before processing
    await ensureGitRepository();
    // set commit & merge request author
    await this.setDefaultGitConfig();
    // checkout to retrofit branch, retrieve changes & push them if any
    await this.processRetrofit();

    return { outputString: "Merge request created/updated" };
  }

  async processRetrofit() {
    const config = await getConfig("branch");
    this.productionBranch = this.productionBranch || config.productionBranch || process.env.CI_COMMIT_REF_NAME || "master";
    const retrofitWorkBranch = `retrofit/${this.productionBranch}`;
    this.retrofitTargetBranch = this.retrofitTargetBranch || config.retrofitBranch || "retrofitTargetBranch MUST BE SET";

    await git().fetch(["--prune"]);
    const branches = await git().branch();
    if (branches.all.find((branch) => branch.includes(retrofitWorkBranch))) {
      // If manual command (not CI), force user to remove previous retrofit branches
      if (!isCI) {
        throw new SfdxError(`You must delete local and remote branch ${c.yellow(retrofitWorkBranch)} before running this command`);
      }
      uxLog(this, c.cyan(`Checkout to existing branch ${retrofitWorkBranch}`));
      await git().checkout(retrofitWorkBranch, ["--force"]);
    } else {
      uxLog(this, c.cyan(`Create a new branch ${retrofitWorkBranch} from ${this.productionBranch}`));
      await git().checkoutBranch(retrofitWorkBranch, `origin/${this.productionBranch}`);
    }

    const currentHash = await git().revparse(["HEAD"]);
    uxLog(this, c.grey(`HEAD currently at ${currentHash}`));

    // Retrieve sources from target org
    const hasChangedSources = await this.retrieveSources();
    if (hasChangedSources) {
      // Commit and push if requested
      if (this.commit) {
        await this.commitChanges();
        // Update package.xml files and clean if necessary
        await SaveTask.run(["--targetbranch", this.retrofitTargetBranch, "--auto"]);
        if (this.push) {
          await this.pushChanges(retrofitWorkBranch);
        }
      }
    } else {
      uxLog(this, c.yellow("No changes to commit"));
      // Delete locally created branch if we are within CI process
      if (isCI) {
        uxLog(this, c.yellow("Deleting local retrofit branch..."));
        await git().branch([`-D ${retrofitWorkBranch}`]);
      }
    }
  }

  // Commit all changes or only updated files
  async commitChanges() {
    if (this.commitMode === "updated") {
      uxLog(this, c.cyan("Stage and commit only updated files... "));
      await git().add(["--update"]);
      await this.doCommit();
      uxLog(this, c.cyan("Removing created files... "));
      await git().reset(["--hard"]);
      await git().clean([CleanOptions.FORCE, CleanOptions.RECURSIVE]);
    } else {
      uxLog(this, c.cyan("Stage and commit all files... "));
      await git().add(["--all"]);
      await this.doCommit();
    }
  }

  async doCommit() {
    await git().commit(`[sfdx-hardis] Changes retrofited from ${this.org.getUsername()}`);
  }

  // Push changes and add merge request options if requested
  async pushChanges(retrofitWorkBranch: string) {
    const origin = `https://root:${process.env.CI_TOKEN}@${process.env.CI_SERVER_HOST}/${process.env.CI_PROJECT_PATH}.git`;
    const pushOptions = [];
    if (this.pushMode === "mergerequest") {
      const mrOptions = [
        "-o merge_request.create",
        `-o merge_request.target ${this.retrofitTargetBranch}`,
        `-o merge_request.title='[sfdx-hardis][RETROFIT] Created by pipeline #${process.env.CI_PIPELINE_ID}'`,
        "-o merge_request.merge_when_pipeline_succeeds",
        "-o merge_request.remove_source_branch",
      ];
      pushOptions.push(...mrOptions);
    }

    const pushResult = await execCommand(`git push ${origin} ${retrofitWorkBranch} ${pushOptions.join(" ")}`, this, {
      fail: true,
      debug: this.debugMode,
      output: true,
    });
    uxLog(this, c.yellow(JSON.stringify(pushResult)));
  }

  async setDefaultGitConfig() {
    // Just do that in CI, because this config should already exist in local
    if (isCI) {
      // either use values from variables from CI or use predefined variables from gitlab
      const USERNAME = process.env.CI_USER_NAME || process.env.GITLAB_USER_NAME;
      const EMAIL = process.env.CI_USER_EMAIL || process.env.GITLAB_USER_EMAIL;
      await git().addConfig("user.name", USERNAME, false, "local");
      await git().addConfig("user.email", EMAIL, false, "local");
    }
  }

  async retrieveSources() {
    uxLog(this, c.cyan(`Retrieving sources from ${c.green(this.org.getUsername())} ...`));
    const RETROFIT_MDT: Array<string> =
      process.env.CI_SOURCES_TO_RETROFIT || this.configInfo.sourcesToRetrofit || Retrofit.DEFAULT_SOURCES_TO_RETROFIT;
    const retrieveCommand = `sfdx force:source:retrieve -m "${RETROFIT_MDT.join(",")}" -u ${this.org.getUsername()}`;
    await execCommand(retrieveCommand, this, { fail: true, debug: this.debugMode, output: true });

    // Discard ignored changes
    await this.discardIgnoredChanges();
    // Clean sources
    await CleanReferences.run(["--type", "all"]);
    await CleanXml.run([]);

    // display current changes to commit
    return gitHasLocalUpdates();
  }

  // Discard ignored changes from retrofitIgnoredFiles
  async discardIgnoredChanges() {
    const config = await getConfig("branch");
    const ignoredFiles = config.retrofitIgnoredFiles || [];
    if (ignoredFiles.length > 0) {
      uxLog(this, c.cyan(`Discarding ignored changes from .sfdx-hardis.yml ${c.bold("retrofitIgnoredFiles")} property...`));
      for (const ignoredFile of ignoredFiles) {
        // Reset file state
        await git().checkout(["--", ignoredFile]);
      }
    }
  }
}
