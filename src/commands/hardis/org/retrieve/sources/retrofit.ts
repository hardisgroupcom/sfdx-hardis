/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { getConfig } from "../../../../../config";
import * as c from "chalk";
// import * as path from "path";
import { ensureGitRepository, gitHasLocalUpdates, execCommand, git, uxLog } from "../../../../../common/utils";

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
    "ValidationRule",
  ];

  public static title = "Retrofit changes from an org";

  public static description = `Retrieve changes from org link to a ref branch not present in sources

  This command need to be triggered from a branch that is connected to a SF org. It will then retrieve
  all changes not present in that branch sources, commit them and create a merge request against the default
  branch. If a merge request already exists, it will simply add a new commit.

  List of metadata to retrieve can be set in three way, in order of priority :
  - "CI_SOURCES_TO_RETROFIT": variable set for CI context
  - "sourcesToRetrofit": variable set in .sfdx-hardis.yml
  - Or default list: ${Retrofit.DEFAULT_SOURCES_TO_RETROFIT.join(", ")}
  `;

  public static examples = ["$ sfdx hardis:org:retrieve:sources:retrofit"];

  protected static flagsConfig = {
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

  protected configInfo: any = {};
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
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
    const REF_BRANCH = process.env.CI_COMMIT_REF_NAME || "master";
    const RETROFIT_BRANCH = `retrofit/${REF_BRANCH}`;

    await git().fetch(["--prune"]);
    const branches = await git().branch();
    if (branches.all.find((branch) => branch.includes(RETROFIT_BRANCH))) {
      uxLog(this, c.cyan(`Checkout to existing branch ${RETROFIT_BRANCH}`));
      await git().checkout(RETROFIT_BRANCH, ["--force"]);
    } else {
      uxLog(this, c.cyan(`Create a new branch ${RETROFIT_BRANCH} from ${REF_BRANCH}`));
      await git().checkoutBranch(RETROFIT_BRANCH, `origin/${REF_BRANCH}`);
    }

    const currentHash = await git().revparse(["HEAD"]);
    uxLog(this, c.cyan(`HEAD currently at ${currentHash}`));

    const hasChangedSources = await this.retrieveSources();
    if (hasChangedSources) {
      await this.pushChanges(RETROFIT_BRANCH);
    } else {
      uxLog(this, c.yellow("No changes to commit, deleting local retrofit branch..."));
      await git().branch([`-D ${RETROFIT_BRANCH}`]);
    }
  }

  async pushChanges(targetBranch: string) {
    await git().add(["--all"]);
    await git().commit("changes added automatically by retrofit job");

    const origin = `https://root:${process.env.CI_TOKEN}@${process.env.CI_SERVER_HOST}/${process.env.CI_PROJECT_PATH}.git`;
    const options = [
      "-o merge_request.create",
      `-o merge_request.title='[RETROFIT] Created by pipeline #${process.env.CI_PIPELINE_ID}'`,
      "-o merge_request.merge_when_pipeline_succeeds",
      "-o merge_request.remove_source_branch",
    ];

    const pushResult = await execCommand(`git push ${origin} ${targetBranch} ${options.join(" ")}`, this, {
      fail: true,
      debug: this.debugMode,
      output: true,
    });
    uxLog(this, c.yellow(JSON.stringify(pushResult)));
  }

  async setDefaultGitConfig() {
    // either use values from variables from CI or use predefined variables from gitlab
    const USERNAME = process.env.CI_USER_NAME || process.env.GITLAB_USER_NAME;
    const EMAIL = process.env.CI_USER_EMAIL || process.env.GITLAB_USER_EMAIL;

    await git().addConfig("user.name", USERNAME, false, "local");
    await git().addConfig("user.email", EMAIL, false, "local");
  }

  async retrieveSources() {
    const RETROFIT_MDT: Array<string> =
      process.env.CI_SOURCES_TO_RETROFIT || this.configInfo.sourcesToRetrofit || Retrofit.DEFAULT_SOURCES_TO_RETROFIT;
    const retrieveCommand = `sfdx force:source:retrieve -m "${RETROFIT_MDT.join(",")}"`;
    await execCommand(retrieveCommand, this, { fail: true, debug: this.debugMode, output: true });

    // display current changes to commit
    return gitHasLocalUpdates();
  }
}
