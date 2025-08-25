/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { MetadataUtils } from '../../../../common/metadata-utils/index.js';
import { uxLog } from '../../../../common/utils/index.js';
import { managePackageConfig, promptOrg } from '../../../../common/utils/orgUtils.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class RetrievePackageConfig extends SfCommand<any> {
  public static title = 'Retrieve package configuration from an org';

  public static description = `
**Retrieves the installed package configuration from a Salesforce org and optionally updates the local project configuration.**

This command is useful for maintaining an accurate record of installed packages within your Salesforce project, which is crucial for managing dependencies and ensuring consistent deployments across environments.

Key functionalities:

- **Package Listing:** Connects to a specified Salesforce org (or prompts for one if not provided) and retrieves a list of all installed packages.
- **Configuration Update:** Offers the option to update your local project's configuration with the retrieved list of installed packages. This can be beneficial for automating package installations during environment setup or CI/CD processes.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Org Connection:** It establishes a connection to the target Salesforce org using the provided or prompted username.
- **Metadata Retrieval:** It utilizes \`MetadataUtils.listInstalledPackages\` to query the Salesforce org and obtain details about the installed packages.
- **Interactive Prompt:** It uses the \`prompts\` library to ask the user whether they want to update their local project configuration with the retrieved package list.
- **Configuration Management:** If the user confirms, it calls \`managePackageConfig\` to update the project's configuration file (likely \`.sfdx-hardis.yml\`) with the new package information.
- **User Feedback:** Provides clear messages to the user about the success of the package retrieval and configuration update.
</details>
`;

  public static examples = ['$ sf hardis:org:retrieve:packageconfig', 'sf hardis:org:retrieve:packageconfig -u myOrg'];

  public static flags: any = {
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
    'target-org': requiredOrgFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(RetrievePackageConfig);
    let targetUsername = flags['target-org'].getUsername() || null;

    // Prompt for organization if not sent
    if (targetUsername == null) {
      const org = await promptOrg(this, { setDefault: false, defaultOrgUsername: flags['target-org']?.getUsername() });
      targetUsername = org.username;
    }

    // Retrieve list of installed packages
    uxLog("action", this, c.cyan('Retrieving installed packages from org ' + targetUsername + '...'));
    const installedPackages = await MetadataUtils.listInstalledPackages(targetUsername || '', this);

    const packageNames = installedPackages
      .map((pkg: any) => `- ${pkg.SubscriberPackageName} (${pkg.SubscriberPackageVersionNumber})`)
      .sort((a: string, b: string) => a.localeCompare(b))
      .join('\n');

    if (installedPackages.length === 0) {
      uxLog("warning", this, c.yellow(`No installed packages found in org ${targetUsername}.`));
      throw new SfError('No installed packages found in the target org. Maybe an auth issue ?');
    }
    uxLog("action", this, c.cyan(`Successfully retrieved ${installedPackages.length} installed packages from org ${targetUsername}.\n${packageNames}`));

    // Store list in config
    const updateConfigRes = await prompts({
      type: 'confirm',
      name: 'value',
      message: c.cyanBright('Do you want to update your project configuration with this list of packages ?'),
      description: 'Update your local project files with the list of installed packages for deployment automation',
    });
    if (updateConfigRes.value === true) {
      await managePackageConfig(installedPackages, installedPackages, true);
    }

    WebSocketClient.sendRefreshPipelineMessage();
    const message = `Successfully retrieved installed packages configuration`;
    uxLog("success", this, c.green(message));
    return { orgId: flags['target-org'].getOrgId(), outputString: message };
  }
}
