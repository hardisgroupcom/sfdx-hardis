/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { isCI, uxLog } from "../../../common/utils";
import * as c from "chalk";
import * as fs from "fs-extra";
import { MegaLinterRunner } from "mega-linter-runner/lib";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class ProjectCreate extends SfdxCommand {
  public static title = "Lint";

  public static description = "Apply syntactic analysis (linters) on the repository sources, using Mega-Linter";

  public static examples = ["$ sfdx hardis:project:lint", "$ sfdx hardis:project:lint --fix"];

  protected static flagsConfig = {
    fix: flags.boolean({
      char: "f",
      default: false,
      description: "Apply linters fixes",
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
  protected static requiresUsername = false;
  protected static supportsUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  protected fix = false;
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.fix = this.flags.fix || false;
    this.debugMode = this.flags.debugMode || false;

    // Check if Mega-Linter is configured
    if (!fs.existsSync(".mega-linter.yml")) {
      if (isCI) {
        throw new SfdxError(
          c.red(
            "[sfdx-hardis] You must run sfdx hardis:project:lint locally to install Mega-Linter configuration before being able to run it from CI"
          )
        );
      } else {
        // Configure Mega-Linter (yeoman generator)
        uxLog(this, c.cyan("Mega-Linter needs to be configured. Please select Salesforce flavor in the following wizard"));
        uxLog(this, c.cyan(`If you have an issue, run the following command at the root folder of your repository: ${c.bold("npx mega-linter-runner --install")}`));
        const megaLinter = new MegaLinterRunner();
        const installRes = await megaLinter.run({ install: true });
        console.assert(installRes.status === 0, "Mega-Linter configuration incomplete");
      }
    }

    // Run MegaLinter
    const megaLinter = new MegaLinterRunner();
    const megaLinterOptions = { flavor: "salesforce", fix: this.fix };
    const res = await megaLinter.run(megaLinterOptions);
    process.exitCode = res.status;

    if (res.status === 0) {
      uxLog(this, c.green(`Mega-Linter has been successful`));
    } else {
      uxLog(this, c.red(`Mega-Linter found error(s)`));
    }

    // Return an object to be displayed with --json
    return { outputString: "Linted project sources", linterStatusCode: res.status };
  }
}
