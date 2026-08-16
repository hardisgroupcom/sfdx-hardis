/* jscpd:ignore-start */
import { SfCommand, Flags, requiredHubFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { execSfdxJson, isCI, uxLog } from '../../../common/utils/index.js';
import { prompts } from '../../../common/utils/prompts.js';
import { t } from '../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class PackageCreate extends SfCommand<any> {
  public static title = 'Create a new package';

  public static description = `
## Command Behavior

**Creates a new Salesforce package (either Managed or Unlocked) in your Dev Hub.**

This command streamlines the process of setting up a new Salesforce package, which is a fundamental step for modularizing your Salesforce metadata and enabling continuous integration and delivery practices. It guides you through defining the package's essential properties.

Key functionalities:

- **Interactive Package Definition:** Prompts you for the package name, the path to its source code, and the package type (Managed or Unlocked).
- **Package Type Selection:**
  - **Managed Packages:** Ideal for AppExchange solutions, where code is hidden in subscriber orgs.
  - **Unlocked Packages:** Suitable for client projects or shared tooling, where code is readable and modifiable in subscriber orgs.
- **Package Creation:** Executes the Salesforce CLI command to create the package in your connected Dev Hub.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Interactive Prompts:** Uses the \`prompts\` library to gather necessary information from the user, such as \`packageName\`, \`packagePath\`, and \`packageType\`.
- **Salesforce CLI Integration:** It constructs and executes the \`sf package create\` command, passing the user-provided details as arguments.
- **\`execSfdxJson\`:** This utility is used to execute the Salesforce CLI command and capture its JSON output, which includes the newly created package's ID.
- **User Feedback:** Provides clear messages to the user about the successful creation of the package, including its ID and the associated Dev Hub.
</details>

### Agent Mode

Use \`--agent\` to disable all interactive prompts. Required flags in agent mode:

- \`--name\`: Package name (required).
- \`--path\`: Package source code path (required).
- \`--type\`: Package type, either \`Managed\` or \`Unlocked\` (default: \`Unlocked\`).

All interactive prompts for package name, path, and type are skipped.
`;

  public static examples = [
    '$ sf hardis:package:create',
    '$ sf hardis:package:create --agent --name "My Package" --path "force-app" --type Unlocked',
  ];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    name: Flags.string({
      char: 'n',
      description: 'Package name (required in agent mode)',
    }),
    path: Flags.string({
      description: 'Package source code path (required in agent mode)',
    }),
    type: Flags.string({
      options: ['Managed', 'Unlocked'],
      description: 'Package type: Managed or Unlocked (default: Unlocked in agent mode)',
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
    const { flags } = await this.parse(PackageCreate);
    const agentMode = flags.agent === true;
    const debugMode = flags.debug || false;

    let packageName: string;
    let packagePath: string;
    let packageType: string;

    if (!isCI && !agentMode) {
      // Request questions to user
      const packageResponse = await prompts([
        {
          type: 'text',
          name: 'packageName',
          message: c.cyanBright(t('pleaseInputPackageName')),
          description: t('enterClearNameForNewPackage'),
          placeholder: t('exMyPackage'),
        },
        {
          type: 'text',
          name: 'packagePath',
          message: c.cyanBright(t('pleaseInputPackagePath')),
          description: t('specifyPackageSourceCodePath'),
          placeholder: t('exSfdxSourceApexMocks'),
        },
        {
          type: 'select',
          name: 'packageType',
          message: c.cyanBright(t('pleaseSelectPackageName')),
          description: t('chooseUnlockedOrManagedPackage'),
          placeholder: t('selectPackageTypePlaceholder'),
          choices: [
            {
              title: t('managedPackageTitle'),
              value: 'Managed',
              description: t('managedPackageDescription'),
            },
            {
              title: t('unlockedPackageTitle'),
              value: 'Unlocked',
              description: t('unlockedPackageDescription'),
            },
          ],
        },
      ]);
      packageName = packageResponse.packageName;
      packagePath = packageResponse.packagePath;
      packageType = packageResponse.packageType;
    } else {
      // Agent mode or CI: use flags
      packageName = flags.name || '';
      packagePath = flags.path || '';
      packageType = flags.type || 'Unlocked';
      if (!packageName || !packagePath) {
        throw new SfError("In agent/CI mode, --name and --path flags are required to create a package.");
      }
    }

    // Create package
    const packageCreateCommand =
      'sf package create' +
      ` --name "${packageName}"` +
      ` --package-type ${packageType}` +
      ` --path "${packagePath}"`;
    const packageCreateResult = await execSfdxJson(packageCreateCommand, this, {
      output: true,
      fail: true,
      debug: debugMode,
    });
    uxLog("action", this, c.cyan(t('createdPackageIdAssociatedToDevHub', { packageId: packageCreateResult.result.Id, devHub: flags['target-dev-hub'].getUsername() })));

    // Return an object to be displayed with --json
    return {
      outputString: `Create new package ${packageCreateResult.result.Id}`,
      packageId: packageCreateResult.result.Id,
    };
  }
}
