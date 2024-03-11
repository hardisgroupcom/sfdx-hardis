/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import { uxLog } from "../../../../common/utils";
import { PACKAGE_ROOT_DIR } from "../../../../settings";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class ConfigureQuality extends SfdxCommand {
  public static title = "Configure SFDX Project local files";

  public static description = "Configure sfdx project for Quality Checks";

  public static examples = ["$ sfdx hardis:project:configure:quality"];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
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
  protected static supportsUsername = true;
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = true;
  protected static requiresDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {

    // Default files (without overwrite)
    await fs.copy(path.join(PACKAGE_ROOT_DIR, "defaults/ci", "."), process.cwd(), { overwrite: false });
    uxLog(this, c.gray("Copied config files"));

    // Package.sjon
    const packageJsonFile = path.join(process.cwd(), "package.json");
    if (!fs.existsSync(packageJsonFile)) {
      throw new SfdxError("You need to be at the root of a SFDX project with a package.json file");
    }
    const packageJson = JSON.parse(fs.readFileSync(packageJsonFile, { encoding: "utf8" }).toString());

    const scripts = {
      "prettier": "prettier --write \"**/*.{cls,cmp,component,css,html,js,page,trigger}\"",
      "prettier:verify": "prettier --check \"**/*.{cls,cmp,component,css,html,js,page,trigger}\"",
      "postinstall": "rm -rf .git/hooks"
    }
    packageJson.scripts = Object.assign(packageJson.scripts || {}, scripts);
    packageJson["lint-staged"] = {};

    await fs.writeFile(packageJsonFile, JSON.stringify(packageJson, null, 2));
    uxLog(this, c.gray("Updated package.json file to have CloudiScore configuration"));

    // Prettier
    const prettierRcJsonFile = path.join(process.cwd(), ".prettierrc");
    const prettierRcJson = JSON.parse(fs.readFileSync(prettierRcJsonFile, { encoding: "utf8" }).toString());
    prettierRcJson.printWidth = 120;
    await fs.writeFile(prettierRcJsonFile, JSON.stringify(prettierRcJson, null, 2));
    uxLog(this, c.gray("Updated .prettierrc file to have CloudiScore configuration"));

    uxLog(this, c.green("What's next ?"));
    uxLog(this, c.green(`- Run command ${c.bold("npm install")} to install local dependencies`));
    uxLog(this, c.yellow(`- Discard updated GitHub/GitLab/Azure/Bitbucket CI/CD items that you are not using`));
    uxLog(this, c.yellow(`- Add exceptions in ${c.bold(".prettierignore")} and ${c.bold(".eslintignore")} to ignore generated or imported Apex/LWC files`));
    uxLog(this, c.yellow(`- Create a first commit, so you can discard later in case you forgot prettier / eslint exceptions`));
    uxLog(this, c.green(`- Run ${c.bold("npm run prettier")} to apply formatting on files`));

    // Return an object to be displayed with --json
    return { outputString: "Configured project for CloudiScore" };
  }
}
