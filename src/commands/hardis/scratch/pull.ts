/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { forceSourcePull } from '../../../common/utils/deployUtils.js';
import { uxLog } from '../../../common/utils/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class SourcePull extends SfCommand<any> {
  public static title = 'Scratch PULL';

  public static description = `This commands pulls the updates you performed in your scratch or sandbox org, into your local files

Then, you probably want to stage and commit the files containing the updates you want to keep, as explained in this video.

<iframe width="560" height="315" src="https://www.youtube.com/embed/Ik6whtflmfY" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

- Calls \`sf project retrieve start\` under the hood
- If there are errors, proposes to automatically add erroneous item in \`.forceignore\`, then pull again
- If you don't see your updated items in the results, you can manually retrieve [using SF Extension **Org Browser** or **Salesforce CLI**](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-publish-task/#retrieve-metadatas)
- If you want to always retrieve sources like CustomApplication that are not always detected as updates by project:retrieve:start , you can define property **autoRetrieveWhenPull** in .sfdx-hardis.yml

Example:
\`\`\`yaml
autoRetrieveWhenPull:
  - CustomApplication:MyCustomApplication
  - CustomApplication:MyOtherCustomApplication
  - CustomApplication:MyThirdCustomApp
\`\`\`
`;

  public static examples = ['$ sf hardis:scratch:pull'];

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
    'target-org': requiredOrgFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(SourcePull);
    const debugMode = flags.debug || false;
    const targetUsername = flags['target-org'].getUsername() || '';
    await forceSourcePull(targetUsername, debugMode);

    uxLog(this, `If you don't see your updated items in the results, check the following documentation: https://sfdx-hardis.cloudity.com/salesforce-ci-cd-publish-task/#retrieve-metadatas`);

    // Return an object to be displayed with --json
    return { outputString: 'Pulled scratch org / source-tracked sandbox updates' };
  }
}
