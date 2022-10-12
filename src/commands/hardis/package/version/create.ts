/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { MetadataUtils } from "../../../../common/metadata-utils";
import { execSfdxJson, isCI, uxLog } from "../../../../common/utils";
import { prompts } from "../../../../common/utils/prompts";
import { getConfig, setConfig } from "../../../../config";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class PackageVersionCreate extends SfdxCommand {
  public static title = "Create a new version of a package";

  public static description = messages.getMessage("packageVersionCreate");

  public static examples = ["$ sfdx hardis:package:version:create"];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    package: flags.string({
      char: "p",
      default: null,
      description: "Package identifier that you want to use to generate a new package version",
    }),
    installkey: flags.string({
      char: "k",
      default: null,
      description: "Package installation key",
    }),
    deleteafter: flags.boolean({
      default: false,
      description: "Delete package version after creating it",
    }),
    install: flags.boolean({
      char: "i",
      default: false,
      description: "Install package version on default org after generation",
    }),
    websocket: flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static requiresDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  protected package: string;
  protected deleteAfter = false;
  protected install = false;
  protected installKey = null;
  protected promote = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.package = this.flags.package || null;
    this.install = this.flags.install || false;
    this.installKey = this.flags.installkey || null;
    this.deleteAfter = this.flags.deleteafter || false;
    this.promote = this.flags.promote || false;
    const debugMode = this.flags.debug || false;
    const config = await getConfig("project");
    // List project packages
    const packageDirectories = this.project.getUniquePackageDirectories();
    // Ask user to select package and input install key if not sent as command arguments
    if (this.package == null) {
      if (isCI) {
        throw new SfdxError("You need to send argument 'package'");
      }
      const packageResponse = await prompts([
        {
          type: "select",
          name: "packageSelected",
          message: c.cyanBright(`Please select a package (this is not a drill, it will create an official new version !)`),
          choices: packageDirectories.map((packageDirectory) => {
            return {
              title: packageDirectory.package || packageDirectory.path,
              value: packageDirectory.name,
            };
          }),
        },
        {
          type: "text",
          name: "packageInstallationKey",
          message: c.cyanBright(`Please input an installation password (or let empty)`),
          initial: config.defaultPackageInstallationKey || "",
        },
      ]);
      this.package = packageResponse.packageSelected;
      this.installKey = packageResponse.packageInstallationKey;
    }
    // Identify package directory
    const pckgDirectory = packageDirectories.filter(
      (pckgDirectory) => pckgDirectory.name === this.package || pckgDirectory.package === this.package
    )[0];
    if (config.defaultPackageInstallationKey !== this.installKey && this.installKey != null) {
      await setConfig("project", {
        defaultPackageInstallationKey: this.installKey,
      });
    }
    // Create package version
    uxLog(this, c.cyan(`Generating new package version for ${c.green(pckgDirectory.package)}...`));
    const createCommand =
      "sfdx force:package:version:create" +
      ` --package "${pckgDirectory.package}"` +
      (this.installKey ? ` --installationkey "${this.installKey}"` : " --installationkeybypass") +
      " --codecoverage" +
      " -w 60";
    const createResult = await execSfdxJson(createCommand, this, {
      fail: true,
      output: true,
      debug: debugMode,
    });
    const latestVersion = createResult.result.SubscriberPackageVersionId;

    // If delete after is true, delete package version we just created
    if (this.deleteAfter) {
      // Delete package version
      uxLog(this, c.cyan(`Delete new package version ${c.green(latestVersion)} of package ${c.green(pckgDirectory.package)}...`));
      const deleteVersionCommand = "sfdx force:package:version:delete --noprompt -p " + latestVersion;
      const deleteVersionResult = await execSfdxJson(deleteVersionCommand, this, {
        fail: true,
        output: true,
        debug: debugMode,
      });
      if (!(deleteVersionResult.result.success === true)) {
        throw new SfdxError(`Unable to delete package version ${latestVersion}`);
      }
    }
    // Install package on org just after is has been generated
    else if (this.install) {
      const packagesToInstall = [];
      const pckg: { SubscriberPackageVersionId?: string; installationkey?: string } = {
        SubscriberPackageVersionId: latestVersion,
      };
      if (this.installKey) {
        pckg.installationkey = this.installKey;
      }
      packagesToInstall.push(pckg);
      await MetadataUtils.installPackagesOnOrg(packagesToInstall, null, this, "install");
    }

    // Return an object to be displayed with --json
    return {
      outputString: "Generated new package version",
      packageVersionId: latestVersion,
    };
  }
}
