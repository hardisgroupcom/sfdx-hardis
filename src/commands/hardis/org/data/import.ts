/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { findDataWorkspaceByName, importData, selectDataWorkspace } from '../../../../common/utils/dataUtils.js';
import { promptOrgUsernameDefault } from '../../../../common/utils/orgUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DataImport extends SfCommand<any> {
  public static title = 'Import data';

  public static description = `
## Command Behavior

**Imports and loads data into a Salesforce org using SFDX Data Loader (sfdmu) projects.**

This command enables teams to consistently upload structured data to Salesforce orgs, supporting data seeding, configuration migrations, and test data provisioning. It provides a safe and controlled mechanism for data imports with built-in safeguards for production environments.

Key functionalities:

- **Data Workspace Selection:** Allows selection of SFDX Data Loader projects either by project name, file path, or through an interactive prompt.
- **Target Org Selection:** Supports specifying the target org via command flags or interactive prompts, with default org detection.
- **Production Safeguards:** Implements safety mechanisms to prevent accidental data modifications in production orgs:
  - Requires explicit configuration via \`sfdmuCanModify\` in .sfdx-hardis.yml config file
  - Or via \`SFDMU_CAN_MODIFY\` environment variable
- **Interactive Mode:** Provides user-friendly prompts for workspace and org selection when not in CI mode.
- **CI/CD Integration:** Supports non-interactive execution with \`--no-prompt\` flag for automated pipelines.
- **SFDMU Integration:** Leverages the powerful SFDX Data Loader (sfdmu) plugin for reliable data import operations.

See article:

[![How to detect bad words in Salesforce records using SFDX Data Loader and sfdx-hardis](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-badwords.jpg)](https://nicolas.vuillamy.fr/how-to-detect-bad-words-in-salesforce-records-using-sfdx-data-loader-and-sfdx-hardis-171db40a9bac)

<iframe width="560" height="315" src="https://www.youtube.com/embed/p4E2DUGZ3bs" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SFDX Data Loader Integration:** Requires the \`sfdmu\` Salesforce CLI plugin to be installed, which is verified before command execution.
- **Workspace Discovery:** Uses \`findDataWorkspaceByName()\` to locate data projects by name, or \`selectDataWorkspace()\` for interactive selection from available SFDX Data Loader workspaces.
- **Org Authentication:** Leverages the \`target-org\` flag with \`requiredOrgFlagWithDeprecations\` to obtain and validate org authentication.
- **Interactive Prompting:** When not in CI mode and \`--no-prompt\` is not set, uses \`promptOrgUsernameDefault()\` to allow users to confirm or change the target org.
- **Data Import Execution:** Delegates the actual import operation to \`importData()\` utility function, passing the workspace path, command context, and target username.
- **Safety Configuration:** Checks for production org protection configuration in project settings or environment variables before allowing modification of production instances.
- **Path Resolution:** Supports both explicit path specification via \`--path\` flag and project name lookup via \`--project-name\` flag.
- **Result Reporting:** Returns structured output with success message and import details for programmatic consumption.

The command is designed to work seamlessly in both interactive development scenarios and automated CI/CD pipelines, ensuring data consistency across different Salesforce environments.
</details>
`;

  public static examples = [
    '$ sf hardis:org:data:import',
    '$ sf hardis:org:data:import --project-name MyDataProject --target-org my-org@example.com',
    '$ sf hardis:org:data:import --path ./scripts/data/MyDataProject --no-prompt --target-org my-org@example.com',
    '$ SFDMU_CAN_MODIFY=prod-instance.my.salesforce.com sf hardis:org:data:import --project-name MyDataProject --target-org prod@example.com',
  ];

  public static flags: any = {
    "project-name": Flags.string({
      char: 'n',
      description: 'Name of the sfdmu project to use (if not defined, you will be prompted to select one)',
    }),
    path: Flags.string({
      char: 'p',
      description: 'Path to the sfdmu workspace folder',
    }),
    "no-prompt": Flags.boolean({
      char: 'r',
      description: 'Do not prompt for Org, use default org',
      default: false,
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

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ['sfdmu'];

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DataImport);
    let sfdmuPath = flags.path || null;
    const projectName = flags["project-name"] || null;
    const noPrompts = flags["no-prompt"] || false;

    uxLog("action", this, c.cyan('This command will launch data IMPORT (upload to org) using SFDX Data Loader (sfdmu)'));

    // Select org that where records will be imported
    let orgUsername = flags['target-org'].getUsername();
    if (!isCI && noPrompts === false) {
      orgUsername = await promptOrgUsernameDefault(this, orgUsername || '', { devHub: false, setDefault: false });
    }

    // Find by project name if provided
    if (projectName != null && sfdmuPath == null) {
      sfdmuPath = await findDataWorkspaceByName(projectName);
    }

    // Identify sfdmu workspace if not defined
    if (sfdmuPath == null) {
      sfdmuPath = await selectDataWorkspace({
        selectDataLabel: `Please select a data workspace to IMPORT in ${c.green(orgUsername)}`,
      });
    }



    // Export data from org
    await importData(sfdmuPath || '', this, {
      targetUsername: orgUsername,
    });

    // Output message
    const message = `Successfully import data from sfdmu project ${c.green(sfdmuPath)} into org ${c.green(
      orgUsername
    )}`;
    uxLog("action", this, c.cyan(message));
    return { outputString: message };
  }
}
