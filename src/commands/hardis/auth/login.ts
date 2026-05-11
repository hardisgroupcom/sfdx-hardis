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

#### How the authentication hook works

sfdx-hardis registers a \`prerun\` hook (and a matching \`auth\` hook) that runs before every \`hardis:*\` command. The hook:

1. Skips itself for a short list of commands (\`hardis:doc:plugin:generate\`, raw \`source:push/pull/deploy\`, \`hardis:mdapi:deploy\`, \`hardis:project:deploy:simulate\`, etc.) and during tests.
2. Reads \`skipAuthCheck\` from the user-layer \`.sfdx-hardis.yml\`; if \`true\`, no authentication is performed.
3. Authenticates to the **Dev Hub** if the command declares \`target-dev-hub\` as required, or if it explicitly opts in via \`devHub: true\`.
4. Authenticates to the **target org** if the command declares \`target-org\` as required (unless \`--skipauth\` is passed), or if \`checkAuth: true\` is set.

The org alias is resolved with the following priority:

1. Explicit \`options.alias\` (programmatic override).
2. \`ORG_ALIAS\` environment variable.
3. In CI: \`scratchOrgAlias\` from config, then \`sfdxAuthUrl\` for scratch orgs, otherwise the **formatted current Git branch name** (this is why each major-branch name must match the suffix used in the CI variables, e.g. \`SFDX_CLIENT_ID_INTEGRATION\` for the \`integration\` branch).
4. Locally: \`orgAlias\` for \`hardis:auth:login\`, otherwise \`scratchOrgAlias\`.

Then \`authOrg(alias, options)\` attempts authentication in this order:

1. **SFDX auth URL** if \`SFDX_AUTH_URL_<ALIAS>\` (or \`SFDX_AUTH_URL_DEV_HUB\` for the Dev Hub) is set and contains \`force://...\`.
2. **JWT bearer flow** if \`SFDX_CLIENT_ID_<ALIAS>\` plus a private key are resolvable.
3. **Web login**, only outside of CI and outside of agent mode.

When resolving the JWT private key, the hook looks at \`SFDX_CLIENT_CERT_<ALIAS>\` (or \`SFDX_CLIENT_CERT\`) and auto-detects the format:

- If the value **starts with \`-----BEGIN ... PRIVATE KEY-----\`**, it is treated as a **raw PEM** and used as-is. No \`SFDX_CLIENT_KEY_<ALIAS>\` passphrase is needed. This is the advanced CA-signed flow.
- Otherwise, the value is treated as the **sfdx-hardis encrypted format** (\`<iv-hex>:<encrypted-hex>\`) and decrypted with the AES passphrase from \`SFDX_CLIENT_KEY_<ALIAS>\`. This is the recommended default produced by the wizard.

If \`SFDX_CLIENT_CERT_<ALIAS>\` is not set, the hook tries the following encrypted-key file locations in order (and still requires \`SFDX_CLIENT_KEY_<ALIAS>\` to decrypt):

\`\`\`text
./config/branches/.jwt/<alias>.key
./config/.jwt/<alias>.key
./ssh/<alias>.key
./.ssh/<alias>.key
./ssh/server.key
\`\`\`

When both are present, \`SFDX_CLIENT_CERT_<ALIAS>\` wins over any file on disk.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:auth:login --agent
\`\`\`

In agent mode, all interactive prompts are skipped and default values are used.

`;

  public static examples = [
    '$ sf hardis:auth:login',
    '$ sf hardis:auth:login --agent',
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
