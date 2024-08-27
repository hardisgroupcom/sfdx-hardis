/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import c from "chalk";
import { MetadataUtils } from "../../../../common/metadata-utils/index.js";
import { execSfdxJson, isCI, uxLog } from "../../../../common/utils/index.js";
import { prompts } from "../../../../common/utils/prompts.js";
import { getConfig, setConfig } from "../../../../config/index.js";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class PackageVersionCreate extends SfCommand<any> {
  public static title = "Create a new version of a package";

  public static description = messages.getMessage("packageVersionCreate");

  public static examples = ["$ sf hardis:package:version:create"];

  // public static args = [{name: 'file'}];

  public static flags = {
    debug: Flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    package: Flags.string({
      char: "p",
      default: null,
      description: "Package identifier that you want to use to generate a new package version",
    }),
    installkey: Flags.string({
      char: "k",
      default: null,
      description: "Package installation key",
    }),
    deleteafter: Flags.boolean({
      default: false,
      description: "Delete package version after creating it",
    }),
    install: Flags.boolean({
      char: "i",
      default: false,
      description: "Install package version on default org after generation",
    }),
    websocket: Flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: Flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static requiresDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected package: string;
  protected deleteAfter = false;
  protected install = false;
  protected installKey = null;
  protected promote = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.package = flags.package || null;
    this.install = flags.install || false;
    this.installKey = flags.installkey || null;
    this.deleteAfter = flags.deleteafter || false;
    this.promote = flags.promote || false;
    const debugMode = flags.debug || false;
    const config = await getConfig("project");
    // List project packages
    const packageDirectories = this.project.getUniquePackageDirectories();
    // Ask user to select package and input install key if not sent as command arguments
    if (this.package == null) {
      if (isCI) {
        throw new SfError("You need to send argument 'package'");
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
      (pckgDirectory) => pckgDirectory.name === this.package || pckgDirectory.package === this.package,
    )[0];
    if (config.defaultPackageInstallationKey !== this.installKey && this.installKey != null) {
      await setConfig("project", {
        defaultPackageInstallationKey: this.installKey,
      });
    }
    // Create package version
    uxLog(this, c.cyan(`Generating new package version for ${c.green(pckgDirectory.package)}...`));
    const createCommand =
      "sf package version create" +
      ` --package "${pckgDirectory.package}"` +
      (this.installKey ? ` --installation-key "${this.installKey}"` : " --installation-key-bypass") +
      " --code-coverage" +
      " --wait 60";
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
      const deleteVersionCommand = "sf package version delete --no-prompt --package " + latestVersion;
      const deleteVersionResult = await execSfdxJson(deleteVersionCommand, this, {
        fail: true,
        output: true,
        debug: debugMode,
      });
      if (!(deleteVersionResult.result.success === true)) {
        throw new SfError(`Unable to delete package version ${latestVersion}`);
      }
    }
    // Install package on org just after is has been generated
    else if (this.install) {
      const packagesToInstall: any[] = [];
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
