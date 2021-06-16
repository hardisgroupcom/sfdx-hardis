/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as path from "path";
import { createTempDir, ensureGitRepository, execCommand, git, selectGitBranch, uxLog } from "../../../../common/utils";
import { prompts } from "../../../../common/utils/prompts";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class GenerateGitDelta extends SfdxCommand {
  public static title = "Generate Git Delta";

  public static description = "Generate package.xml git delta between 2 commits";

  public static examples = ["$ sfdx hardis:project:generate:gitdelta"];

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
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.debugMode = this.flags.debugMode || false;
    // Check git repo
    await ensureGitRepository();

    // Select git branch
    const currentGitBranch = await selectGitBranch({remote: true,checkOutPull:true});

    // Retrieving info about current branch latest commit and master branch latest commit
    const logResult = await git().log([`${currentGitBranch}..${currentGitBranch}`]);
    const toCommit = logResult.latest;
    const mergeBaseCommand = `git merge-base ${currentGitBranch} ${currentGitBranch}`;
    const mergeBaseCommandResult = await execCommand(mergeBaseCommand, this, {
      fail: true,
      debug: this.debugMode,
    });
    const masterBranchLatestCommit = mergeBaseCommandResult.stdout.replace("\n", "").replace("\r", "");

    // Prompt user with default values
    const commitsResp = await prompts([
      {
        type: "text",
        name: "commitFrom",
        message: "Please input the commit hash that you want to start from",
        initial: masterBranchLatestCommit
      },
      {
        type: "text",
        name: "commitTo",
        message: "Please input the commit hash that you want to go to",
        initial: toCommit || masterBranchLatestCommit
      },
    ]);

    // Generate package.xml & destructiveChanges.xml using sfdx git delta
    const tmpDir = await createTempDir();
    const packageXmlCommand = `sfdx sgd:source:delta` + ` --from ${commitsResp.commitFrom}` + ` --to ${commitsResp.commitTo} --output ${tmpDir}`;
    await execCommand(packageXmlCommand, this, {
      output: true,
      fail: true,
      debug: this.debugMode,
    });

    const diffPackageXml = path.join(tmpDir, "package", "package.xml");
    const diffDestructiveChangesXml = path.join(tmpDir, "destructiveChanges", "destructiveChanges.xml");

    uxLog(this, c.cyan(`Generated diff package.xml at ${c.green(diffPackageXml)}`));
    uxLog(this, c.cyan(`Generated diff destructiveChanges.xml at ${c.green(diffDestructiveChangesXml)}`));

    // Return an object to be displayed with --json
    return { outputString: "Generated package.xml", diffPackageXml: diffPackageXml, diffDestructiveChangesXml: diffDestructiveChangesXml };
  }
}
