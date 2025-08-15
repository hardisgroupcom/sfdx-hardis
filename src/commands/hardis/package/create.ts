/* jscpd:ignore-start */
import { SfCommand, Flags, requiredHubFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { execSfdxJson, uxLog } from '../../../common/utils/index.js';
import { prompts } from '../../../common/utils/prompts.js';

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
`;

  public static examples = ['$ sf hardis:package:create'];

  // public static args = [{name: 'file'}];

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
    'target-dev-hub': requiredHubFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(PackageCreate);
    const debugMode = flags.debug || false;

    // Request questions to user
    const packageResponse = await prompts([
      {
        type: 'text',
        name: 'packageName',
        message: c.cyanBright(`Please input the name of the package (ex: MyPackage)`),
        description: 'Enter a clear name for your new Salesforce package',
        placeholder: 'Ex: MyPackage',
      },
      {
        type: 'text',
        name: 'packagePath',
        message: c.cyanBright(`Please input the path of the package (ex: sfdx-source/apex-mocks)`),
        description: 'Specify the directory path where the package source code is located',
        placeholder: 'Ex: sfdx-source/apex-mocks',
      },
      {
        type: 'select',
        name: 'packageType',
        message: c.cyanBright(`Please select the type of the package`),
        description: 'Choose whether this is an unlocked package or managed package',
        placeholder: 'Select package type',
        choices: [
          {
            title: 'Managed',
            value: 'Managed',
            description:
              'Managed packages code is hidden in orgs where it is installed. Suited for AppExchanges packages',
          },
          {
            title: 'Unlocked',
            value: 'Unlocked',
            description:
              'Unlocked packages code is readable and modifiable in orgs where it is installed. Use it for client project or shared tooling',
          },
        ],
      },
    ]);

    // Create package
    const packageCreateCommand =
      'sf package create' +
      ` --name "${packageResponse.packageName}"` +
      ` --package-type ${packageResponse.packageType}` +
      ` --path "${packageResponse.packagePath}"`;
    const packageCreateResult = await execSfdxJson(packageCreateCommand, this, {
      output: true,
      fail: true,
      debug: debugMode,
    });
    uxLog(
      "action",
      this,
      c.cyan(
        `Created package Id: ${c.green(packageCreateResult.result.Id)} associated to DevHub ${c.green(
          flags['target-dev-hub'].getUsername()
        )}`
      )
    );

    // Return an object to be displayed with --json
    return {
      outputString: `Create new package ${packageCreateResult.result.Id}`,
      packageId: packageCreateResult.result.Id,
    };
  }
}
