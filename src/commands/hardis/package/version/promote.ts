/* jscpd:ignore-start */
import { SfCommand, Flags, requiredHubFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { execSfdxJson, uxLog } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class PackageVersionPromote extends SfCommand<any> {
  public static title = 'Promote new versions of package(s)';

  public static description = `
## Command Behavior

**Promotes a Salesforce package version from beta to released status in your Dev Hub.**

This command is a critical step in the package development lifecycle, marking a package version as stable and ready for production use. Once promoted, a package version can be installed in production organizations.

Key functionalities:

- **Package Version Selection:** Allows you to select a specific package version to promote. If the \`--auto\` flag is used, it automatically identifies package versions that are not yet released and promotes them.
- **Automated Promotion:** When \`--auto\` is enabled, it queries for all unreleased package versions and promotes them without further user interaction.
- **Dev Hub Integration:** Interacts with your connected Dev Hub to change the status of the package version.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Package Alias Retrieval:** It retrieves package aliases from your \`sfdx-project.json\` to identify available packages.
- **Automated Promotion Logic:** If \`--auto\` is used, it executes \`sf package version list --released\` to get a list of already released packages and then filters the available package aliases to find those that are not yet released.
- **Interactive Prompts:** If not in auto mode, it uses the \`prompts\` library to allow the user to select a package version to promote.
- **Salesforce CLI Integration:** It constructs and executes the \`sf package version promote\` command, passing the package version ID.
- **\`execSfdxJson\`:** This utility is used to execute the Salesforce CLI command and capture its JSON output.
- **Error Handling:** It handles cases where a package version might already be promoted or if other errors occur during the promotion process.
</details>
`;

  public static examples = ['$ sf hardis:package:version:promote', '$ sf hardis:package:version:promote --auto'];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    auto: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Auto-detect which versions of which packages need to be promoted',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
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

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(PackageVersionPromote);
    const debugMode = flags.debug || false;
    const auto = flags.auto || false;
    // List project packages
    const sfdxProjectJson: any = this.project?.getSfProjectJson(false) || {};
    const packageAliases = sfdxProjectJson.get('packageAliases') || [];
    const availablePackageAliases = {};
    for (const packageAlias of Object.keys(packageAliases)
      .sort()
      .filter((pckgAlias) => pckgAlias.includes('@'))) {
      const packageName = packageAlias.split('@')[0];
      availablePackageAliases[packageName] = packageAlias;
    }
    // Select packages to promote
    const packagesToPromote: any[] = [];
    if (auto) {
      // Promote only packages not promoted yet
      const packageListRes = await execSfdxJson('sf package version list --released', this, {
        output: true,
        fail: true,
      });
      const filteredPackagesToPromote = Object.values(availablePackageAliases).filter((packageAlias) => {
        return (
          packageListRes.result.filter((releasedPackage) => {
            return releasedPackage.Alias === packageAlias && !(releasedPackage.IsReleased === true);
          }).length === 0
        );
      });
      packagesToPromote.push(...filteredPackagesToPromote);
    } else {
      // Prompt user if not auto
      const packageResponse = await prompts([
        {
          type: 'select',
          name: 'packageSelected',
          message: c.cyanBright(
            `Please select a package (this is not a drill, it will create an official new version !)`
          ),
          description: 'Choose which package to promote - this will create a new official version that cannot be undone',
          placeholder: 'Select a package',
          choices: Object.values(availablePackageAliases).map((packageAlias) => {
            return { title: packageAlias, value: packageAlias };
          }),
        },
      ]);
      // Manage user response
      packagesToPromote.push(packageResponse.packageSelected);
    }

    const promotedPackageVersions: any[] = [];
    const errorPromotedVersions: any[] = [];

    // Promote packages
    for (const packageToPromote of packagesToPromote) {
      uxLog("action", this, c.cyan(`Promoting version of package ${c.green(packageToPromote)}`));
      const promoteCommand = 'sf package version promote' + ` --package "${packageToPromote}"` + ' --no-prompt';
      const promoteResult = await execSfdxJson(promoteCommand, this, {
        fail: false,
        output: false,
        debug: debugMode,
      });
      if (promoteResult.status === 0) {
        uxLog(
          "action",
          this,
          c.cyan(
            `Promoted package version ${c.green(packageToPromote)} with id ${c.green(
              promoteResult.result.id
            )}. It is now installable on production orgs`
          )
        );
        promotedPackageVersions.push({ package: packageToPromote, result: promoteResult });
      } else {
        uxLog(
          "warning",
          this,
          c.yellow(
            `Error promoting package version ${c.red(packageToPromote)} (probably already promoted so it can be ok)`
          )
        );
        errorPromotedVersions.push({ package: packageToPromote, result: promoteResult });
      }
    }
    process.exitCode = errorPromotedVersions.length === 0 ? 0 : 1;
    // Return an object to be displayed with --json
    return {
      outputString: 'Promoted packages',
      promotedPackageVersions: promotedPackageVersions,
      errorPromotedVersions: errorPromotedVersions,
    };
  }
}
