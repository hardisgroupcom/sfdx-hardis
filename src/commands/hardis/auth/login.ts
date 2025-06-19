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
Logins to a Salesforce org from CI/CD workflows.

Will use the variables and files defined by configuration commands:

- CI/CD repos: [Configure Org CI Authentication](${CONSTANTS.DOC_URL_ROOT}/hardis/project/configure/auth/)
- Monitoring repos: [Configure Org Monitoring](${CONSTANTS.DOC_URL_ROOT}/hardis/org/configure/monitoring/)

If you have a technical org (for example to call Agentforce from another org, you can define variable SFDX_AUTH_URL_TECHNICAL_ORG and it will authenticate it with alias TECHNICAL_ORG)

You can get SFDX_AUTH_URL_TECHNICAL_ORG value by running the command: \`sf org display --verbose --json\` and copy the value of the field \`sfdxAuthUrl\` in the output.
`;

  public static examples = [
    '$ sf hardis:auth:login',
    'CI=true sf hardis:auth:login'
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
