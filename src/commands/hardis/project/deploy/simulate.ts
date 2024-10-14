/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { promptOrgUsernameDefault } from '../../../../common/utils/orgUtils.js';
import { wrapSfdxCoreCommand } from '../../../../common/utils/wrapUtils.js';


Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DeploySimulate extends SfCommand<any> {
  public static title = 'Simulate the deployment of a metadata in an org prompted to the user\nUsed by VsCode Extension';

  public static description = `Simulate the deployment of a metadata in an org prompted to the user
  
For example, helps to solve the issue in a Permission Set without having to run a CI/CD job.

Used by VsCode Extension`;

  public static examples = [
    '$ sf hardis:project:deploy:simulate --source-dir force-app/defaut/main/permissionset/PS_Admin.permissionset-meta.xml',
  ];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    "source-dir": Flags.string({
      char: "f",
      description: "Source file or directory to simulate the deployment",
      multiple: true,
      required: true
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
  public static requiresProject = true;
  /* jscpd:ignore-end */

  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DeploySimulate);
    const sourceDirOrFile = flags["source-dir"];
    this.debugMode = flags.debug || false;

    // Prompt target org to user
    const orgUsername = await promptOrgUsernameDefault(this,
      flags['target-org'].getUsername(),
      { devHub: false, setDefault: false, message: `Do you want to use org ${flags['target-org'].getConnection().instanceUrl} to simulate deployment of metadata ${sourceDirOrFile} ?`, quickOrgList: true });

    // Build command
    const simulateDeployCommand = "sf project deploy start" +
      ` --source-dir "${sourceDirOrFile}"` +
      ` --target-org ${orgUsername}` +
      ` --ignore-conflicts` +
      ` --dry-run`;

    // Simulate deployment
    const result = await wrapSfdxCoreCommand(simulateDeployCommand, [], this, flags.debug);
    return result;
  }
}
