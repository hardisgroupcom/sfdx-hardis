/* jscpd:ignore-start */
import { SfCommand, Flags, requiredHubFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { MetadataUtils } from '../../../../common/metadata-utils/index.js';
import { execSfdxJson, isCI, uxLog } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { getConfig, setConfig } from '../../../../config/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class PackageVersionCreate extends SfCommand<any> {
  public static title = 'Create a new version of a package';

  public static description = `
## Command Behavior

**Creates a new version of a Salesforce package (2GP or Unlocked) in your Dev Hub.**

This command is a crucial step in the package development lifecycle, allowing you to iterate on your Salesforce functionalities and prepare them for deployment or distribution. It automates the process of creating a new, immutable package version.

Key functionalities:

- **Package Selection:** Prompts you to select an existing package from your \`sfdx-project.json\` file if not specified via the \`--package\` flag.
- **Installation Key:** Allows you to set an installation key (password) for the package version, protecting it from unauthorized installations. This can be provided via the \`--installkey\` flag or interactively.
- **Code Coverage:** Automatically includes code coverage checks during package version creation.
- **Post-Creation Actions:**
  - **Delete After Creation (\`--deleteafter\`):** Deletes the newly created package version immediately after its creation. This is useful for testing the package creation process without accumulating unnecessary versions.
  - **Install After Creation (\`--install\`):** Installs the newly created package version on your default Salesforce org. This is convenient for immediate testing or validation.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Package Directory Identification:** It identifies the package directory from your \`sfdx-project.json\` based on the selected package name.
- **Interactive Prompts:** Uses the \`prompts\` library to guide the user through package selection and installation key input if not provided as command-line arguments.
- **Configuration Persistence:** Stores the \`defaultPackageInstallationKey\` in your project's configuration (\`.sfdx-hardis.yml\`) for future use.
- **Salesforce CLI Integration:** It constructs and executes the \`sf package version create\` command, passing the package ID, installation key, and other flags.
- **\`execSfdxJson\`:** This utility is used to execute the Salesforce CLI command and capture its JSON output, which includes the \`SubscriberPackageVersionId\` of the newly created version.
- **Post-Creation Command Execution:** If \`--deleteafter\` or \`--install\` flags are set, it executes \`sf package version delete\` or delegates to \`MetadataUtils.installPackagesOnOrg\` respectively.
- **Error Handling:** Includes checks for missing package arguments and handles errors during package version creation or post-creation actions.
</details>
`;

  public static examples = ['$ sf hardis:package:version:create'];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    package: Flags.string({
      char: 'p',
      default: '',
      description: 'Package identifier that you want to use to generate a new package version',
    }),
    installkey: Flags.string({
      char: 'k',
      default: '',
      description: 'Package installation key',
    }),
    deleteafter: Flags.boolean({
      default: false,
      description: 'Delete package version after creating it',
    }),
    install: Flags.boolean({
      char: 'i',
      default: false,
      description: 'Install package version on default org after generation',
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    'target-dev-hub': requiredHubFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected package: string | null;
  protected deleteAfter = false;
  protected install = false;
  protected installKey: string | null = null;
  protected promote = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(PackageVersionCreate);
    this.package = flags.package || null;
    this.install = flags.install || false;
    this.installKey = flags.installkey || null;
    this.deleteAfter = flags.deleteafter || false;
    //this.promote = flags.promote || false;
    const debugMode = flags.debug || false;
    const config = await getConfig('project');
    // List project packages
    const packageDirectories: any[] = this.project?.getUniquePackageDirectories() || [];
    // Ask user to select package and input install key if not sent as command arguments
    if (this.package == null) {
      if (isCI) {
        throw new SfError("You need to send argument 'package'");
      }
      const packageResponse = await prompts([
        {
          type: 'select',
          name: 'packageSelected',
          message: c.cyanBright(
            `Please select a package (this is not a drill, it will create an official new version !)`
          ),
          description: 'Choose which package to create a new version for - this action creates a permanent version',
          placeholder: 'Select a package',
          choices: packageDirectories.map((packageDirectory) => {
            return {
              title: packageDirectory?.package || packageDirectory?.path || packageDirectory?.fullPath || packageDirectory?.name,
              value: packageDirectory.name,
            };
          }),
        },
        {
          type: 'text',
          name: 'packageInstallationKey',
          message: c.cyanBright(
            'Do you want to password protect your package ? (blank means no)'
          ),
          description: 'Optionally set a password to protect the package installation',
          placeholder: 'Ex: mySecretPassword123',
          initial: config.defaultPackageInstallationKey || '',
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
      await setConfig('project', {
        defaultPackageInstallationKey: this.installKey,
      });
    }
    // Create package version
    uxLog("action", this, c.cyan(`Generating new package version for ${c.green(pckgDirectory.package)}...`));
    const createCommand =
      'sf package version create' +
      ` --package "${pckgDirectory.package}"` +
      (this.installKey ? ` --installation-key "${this.installKey}"` : ' --installation-key-bypass') +
      ' --code-coverage' +
      ' --wait 60';
    const createResult = await execSfdxJson(createCommand, this, {
      fail: true,
      output: true,
      debug: debugMode,
    });
    const latestVersion = createResult.result.SubscriberPackageVersionId;

    // If delete after is true, delete package version we just created
    if (this.deleteAfter) {
      // Delete package version
      uxLog(
        "action",
        this,
        c.cyan(`Delete new package version ${c.green(latestVersion)} of package ${c.green(pckgDirectory.package)}...`)
      );
      const deleteVersionCommand = 'sf package version delete --no-prompt --package ' + latestVersion;
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
      await MetadataUtils.installPackagesOnOrg(packagesToInstall, null, this, 'install');
    }

    // Return an object to be displayed with --json
    return {
      outputString: 'Generated new package version',
      packageVersionId: latestVersion,
    };
  }
}
