/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { MetadataUtils } from '../../../../common/metadata-utils/index.js';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { managePackageConfig, promptOrg } from '../../../../common/utils/orgUtils.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { t } from '../../../../common/utils/i18n.js';

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

### Agent Mode

Use \`--agent\` to disable all prompts. Typical usage:

\`\`\`sh
sf hardis:org:retrieve:packageconfig --agent --packages "MyPackage,OtherPackage" --target-org myOrg
sf hardis:org:retrieve:packageconfig --agent --update-all-config --target-org myOrg
\`\`\`

In agent mode:

- Without \`--packages\` or \`--update-all-config\`, the command only lists packages (no config update).
- Use \`--packages\` to update config only for the specified packages (comma-separated names or subscriber package IDs).
- Use \`--update-all-config\` to update config with all retrieved packages.
`;

  public static examples = [
    '$ sf hardis:org:retrieve:packageconfig',
    'sf hardis:org:retrieve:packageconfig -u myOrg',
    '$ sf hardis:org:retrieve:packageconfig --agent --packages "MyPackage,OtherPkg"',
    '$ sf hardis:org:retrieve:packageconfig --agent --update-all-config',
  ];

  public static flags: any = {
    packages: Flags.string({
      description: 'Comma-separated list of package names or subscriber package IDs to update in the project config. Used in agent mode.',
    }),
    'update-all-config': Flags.boolean({
      default: false,
      description: 'Update config with all retrieved packages. Required in agent mode if --packages is not provided.',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
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
    'target-org': requiredOrgFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(RetrievePackageConfig);
    const agentMode = flags.agent === true;
    let targetUsername = flags['target-org'].getUsername() || null;

    // Prompt for organization if not sent
    if (targetUsername == null) {
      const org = await promptOrg(this, { setDefault: false, defaultOrgUsername: flags['target-org']?.getUsername() });
      targetUsername = org.username;
    }

    // Retrieve list of installed packages
    uxLog("action", this, c.cyan(t('retrievingInstalledPackagesFromOrg') + targetUsername + '...'));
    const installedPackages = await MetadataUtils.listInstalledPackages(targetUsername || '', this);

    const packageNames = installedPackages
      .map((pkg: any) => `- ${pkg.SubscriberPackageName} (${pkg.SubscriberPackageVersionNumber})`)
      .sort((a: string, b: string) => a.localeCompare(b))
      .join('\n');

    if (installedPackages.length === 0) {
      uxLog("warning", this, c.yellow(t('noInstalledPackagesFoundInOrg', { targetUsername })));
      throw new SfError('No installed packages found in the target org. Maybe an auth issue ?');
    }
    uxLog("action", this, c.cyan(t('successfullyRetrievedInstalledPackagesFromOrg', { installedPackages: installedPackages.length, targetUsername, packageNames })));

    // Store list in config
    if (isCI || agentMode) {
      const packagesFlag = flags.packages as string | undefined;
      const updateAllConfig = flags['update-all-config'] === true;
      if (packagesFlag) {
        // Filter to only the specified packages
        const filterValues = packagesFlag.split(',').map((v: string) => v.trim().toLowerCase());
        const filteredPackages = installedPackages.filter((pkg: any) =>
          filterValues.includes((pkg.SubscriberPackageName || '').toLowerCase()) ||
          filterValues.includes((pkg.SubscriberPackageId || '').toLowerCase())
        );
        if (filteredPackages.length > 0) {
          await managePackageConfig(filteredPackages, filteredPackages, true);
        } else {
          uxLog("warning", this, c.yellow(`No installed packages matched the --packages filter: ${packagesFlag}`));
        }
      } else if (updateAllConfig) {
        await managePackageConfig(installedPackages, installedPackages, true);
      } else {
        uxLog("log", this, c.grey('Agent/CI mode: skipping config update (use --packages or --update-all-config to update).'));
      }
    } else {
      const updateConfigRes = await prompts({
        type: 'confirm',
        name: 'value',
        message: c.cyanBright(t('doYouWantToUpdateYourProject')),
        description: t('updateLocalProjectFilesWithInstalledPackages'),
      });
      if (updateConfigRes.value === true) {
        await managePackageConfig(installedPackages, installedPackages, true);
      }
    }

    WebSocketClient.sendRefreshPipelineMessage();
    const message = t('successfullyRetrievedInstalledPackagesConfig');
    uxLog("success", this, c.green(message));
    return { orgId: flags['target-org'].getOrgId(), outputString: message };
  }
}
