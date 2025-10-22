/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { authOrg } from '../../../common/utils/authUtils.js';
import { CONSTANTS, getEnvVar } from '../../../config/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class Login extends SfCommand<any> {
  public static title = 'Login';

  public static description = `
## Command Behavior

**Authenticates to a Salesforce org, primarily designed for CI/CD workflows.**

This command facilitates secure and automated logins to Salesforce organizations within continuous integration and continuous delivery pipelines. It leverages pre-configured authentication details, ensuring that CI/CD processes can interact with Salesforce without manual intervention.

Key aspects:

- **Configuration-Driven:** It relies on authentication variables and files set up by dedicated configuration commands:
  - For CI/CD repositories: [Configure Org CI Authentication](${CONSTANTS.DOC_URL_ROOT}/hardis/project/configure/auth/)
  - For Monitoring repositories: [Configure Org Monitoring](${CONSTANTS.DOC_URL_ROOT}/hardis/org/configure/monitoring/)
- **Technical Org Support:** Supports authentication to a 'technical org' (e.g., for calling Agentforce from another org) by utilizing the \`SFDX_AUTH_URL_TECHNICAL_ORG\` environment variable. If this variable is set, the command authenticates to this org with the alias \`TECHNICAL_ORG\`.

To obtain the \`SFDX_AUTH_URL_TECHNICAL_ORG\` value, you can run \`sf org display --verbose --json\` and copy the \`sfdxAuthUrl\` field from the output.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical flow involves:

- **Flag Parsing:** It parses command-line flags such as \`instanceurl\`, \`devhub\`, \`scratchorg\`, and \`debug\` to determine the authentication context.
- **Authentication Hook:** It triggers an internal authentication hook (\`this.config.runHook('auth', ...\`)) which is responsible for executing the actual authentication logic based on the provided flags (e.g., whether it's a Dev Hub or a scratch org).
- **Environment Variable Check:** It checks for the presence of \`SFDX_AUTH_URL_TECHNICAL_ORG\` or \`TECHNICAL_ORG_ALIAS\` environment variables.
- **\`authOrg\` Utility:** If a technical org is configured, it calls the \`authOrg\` utility function to perform the authentication for that specific org, ensuring it's connected and available for subsequent operations.
- **Salesforce CLI Integration:** It integrates with the Salesforce CLI's authentication mechanisms to establish and manage org connections.
</details>
`;

  public static examples = [
    '$ sf hardis:auth:login',
    'CI=true CI_COMMIT_REF_NAME=monitoring_myclient sf hardis:auth:login'
  ];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    instanceurl: Flags.string({
      char: 'r',
      description: messages.getMessage('instanceUrl'),
    }),
    devhub: Flags.boolean({
      char: 'h',
      default: false,
      description: messages.getMessage('withDevHub'),
    }),
    scratchorg: Flags.boolean({
      char: 's',
      default: false,
      description: messages.getMessage('scratch'),
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
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    console.log('Entering Login command to authenticate to Salesforce org');
    const { flags } = await this.parse(Login);
    const devHub = flags.devhub || false;
    const scratch = flags.scratchorg || false;
    await this.config.runHook('auth', {
      checkAuth: !devHub,
      Command: this,
      devHub,
      scratch,
    });

    // Login to secondary org
    if (getEnvVar('TECHNICAL_ORG_ALIAS') || getEnvVar('SFDX_AUTH_URL_TECHNICAL_ORG')) {
      await authOrg('TECHNICAL_ORG', {
        checkAuth: true,
        Command: this,
        devHub: false,
        scratch: false,
        argv: this.argv
      });
    }

    // Return an object to be displayed with --json
    return { outputString: 'Logged to Salesforce org' };
  }
}
