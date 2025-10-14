/* jscpd:ignore-start */
import { Flags, requiredOrgFlagWithDeprecations, SfCommand } from '@salesforce/sf-plugins-core';
import c from 'chalk';
import { AnyJson } from '@salesforce/ts-types';
import { wrapSfdxCoreCommand } from '../../../common/utils/wrapUtils.js';
import { uxLog } from '../../../common/utils/index.js';

const xorFlags = ['zipfile', 'validateddeployrequestid', 'deploydir'];
export class Deploy extends SfCommand<any> {
  public static readonly description = `
## Command Behavior

**A wrapper command for Salesforce CLI's \`sf project deploy start\` (formerly \`sfdx force:mdapi:deploy\`), designed to assist with deployment error resolution.**

This command facilitates the deployment of metadata API source (either from a zip file, a deployment directory, or a validated deploy request ID) to a Salesforce org. Its primary enhancement over the standard Salesforce CLI command is its ability to provide tips and guidance for solving common deployment errors.

Key features:

- **Flexible Input:** Supports deploying from a \`.zip\` file (\`--zipfile\`), a local directory (\`--deploydir\`), or by referencing a previously validated deployment (\`--validateddeployrequestid\`).
- **Test Level Control:** Allows specifying the test level for deployments (\`NoTestRun\`, \`RunSpecifiedTests\`, \`RunLocalTestsInOrg\`, \`RunAllTestsInOrg\`).
- **Error Handling Assistance:** Displays helpful tips and links to documentation to guide you through resolving deployment failures.

**Important Note:** The underlying Salesforce CLI command \`sfdx force:mdapi:deploy\` is being deprecated by Salesforce in November 2024. It is recommended to migrate to \`sf project deploy start\` for future compatibility. See [Salesforce CLI Migration Guide](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_mig_deploy_retrieve.htm) for more information.

For visual assistance with solving deployment errors, refer to this article:

[![Assisted solving of Salesforce deployments errors](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deployment-errors.jpg)](https://nicolas.vuillamy.fr/assisted-solving-of-salesforce-deployments-errors-47f3666a9ed0)

<details markdown="1">
<summary>Technical explanations</summary>

This command acts as an intelligent wrapper around the Salesforce CLI's metadata deployment functionality:

- **Command Wrapping:** It uses the \`wrapSfdxCoreCommand\` utility to execute the \`sfdx force:mdapi:deploy\` (or its equivalent \`sf project deploy start\`) command, passing through all relevant flags and arguments.
- **Error Analysis (Implicit):** While the direct code snippet doesn't show explicit error analysis, the description implies that the \`wrapSfdxCoreCommand\` or a subsequent process intercepts deployment failures and provides contextual help.
- **User Guidance:** It logs messages to the console, including deprecation warnings and pointers to external documentation for troubleshooting.
- **Argument Passthrough:** It directly passes the command-line arguments (\`this.argv\`) to the underlying Salesforce CLI command, ensuring all standard deployment options are supported.
</details>
`;
  public static readonly examples = [];
  public static readonly flags: any = {
    checkonly: Flags.boolean({
      char: 'c',
      description: 'checkOnly',
    }),
    deploydir: Flags.directory({
      char: 'd',
      description: 'deployDir',
      exactlyOne: xorFlags,
    }),
    wait: Flags.integer({
      char: 'w',
      description: 'wait',
      default: 120,
      min: -1,
    }),
    testlevel: Flags.string({
      char: 'l',
      description: 'testLevel',
      options: ['NoTestRun', 'RunSpecifiedTests', 'RunLocalTests', 'RunAllTestsInOrg'],
      default: 'NoTestRun',
    }),
    runtests: Flags.string({
      char: 'r',
      description: 'runTests',
      default: [],
      multiple: true,
    }),
    ignoreerrors: Flags.boolean({
      description: 'ignoreErrors',
    }),
    ignorewarnings: Flags.boolean({
      char: 'g',
      description: 'ignoreWarnings',
    }),
    validateddeployrequestid: Flags.string({
      char: 'q',
      description: 'validatedDeployRequestId',
      exactlyOne: xorFlags,
      exclusive: ['testlevel', 'runtests', 'ignoreerrors', 'ignorewarnings', 'checkonly'],
    }),
    verbose: Flags.boolean({
      description: 'verbose',
    }),
    zipfile: Flags.file({
      char: 'f',
      description: 'zipFile',
      exactlyOne: xorFlags,
    }),
    singlepackage: Flags.boolean({
      char: 's',
      description: 'singlePackage',
    }),
    soapdeploy: Flags.boolean({
      description: 'soapDeploy',
    }),
    purgeondelete: Flags.boolean({
      description: 'purgeOnDelete',
    }),
    concise: Flags.boolean({
      description: 'concise',
    }),
    debug: Flags.boolean({
      default: false,
      description: 'debug',
    }),
    websocket: Flags.string({
      description: 'websocket',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };
  /* jscpd:ignore-end */
  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(Deploy);
    uxLog("error", this, c.red('This command will be removed by Salesforce in November 2024.'));
    uxLog("error", this, c.red('Please migrate to the command `sf hardis project deploy start`.'));
    uxLog(
      "error",
      this,
      c.red(
        'See https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_mig_deploy_retrieve.htm'
      )
    );
    return await wrapSfdxCoreCommand('sfdx force:mdapi:deploy', this.argv, this, flags.debug);
  }
}
