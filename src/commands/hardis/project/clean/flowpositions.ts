/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { glob } from 'glob';
import * as path from 'path';
import fs from 'fs-extra';
import { uxLog } from '../../../../common/utils/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('plugin-template-sf-external', 'org');

export default class CleanFlowPositions extends SfCommand<any> {
  public static title = 'Clean Flow Positions';

  public static description = `Replace all positions in Auto-Layout Flows by 0 to simplify conflicts management

As Flows are defined as Auto-Layout, the edition in Setup UI is not impacted.
  
Before:

\`\`\`xml
<locationX>380</locationX>
<locationY>259</locationY>
\`\`\`

After:

\`\`\`xml
<locationX>0</locationX>
<locationY>0</locationY>
\`\`\`

Can be automated at each **hardis:work:save** if **flowPositions** is added in .sfdx-hardis.yml **autoCleanTypes** property  

Example in config/.sfdx-hardis.yml:

\`\`\`yaml
autoCleanTypes:
  - destructivechanges
  - flowPositions
\`\`\`
`;

  public static examples = ['$ sf hardis:project:clean:flowpositions'];

  public static flags = {
    folder: Flags.string({
      char: 'f',
      default: 'force-app',
      description: 'Root folder',
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
  public static requiresProject = true;

  protected folder: string;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CleanFlowPositions);
    this.folder = flags.folder || './force-app';
    this.debugMode = flags.debug || false;

    // Delete standard files when necessary
    uxLog(this, c.cyan(`Setting flows as Auto Layout and remove positions...`));
    /* jscpd:ignore-end */
    const rootFolder = path.resolve(this.folder);
    const findManagedPattern = rootFolder + `/**/*.flow-meta.xml`;
    const matchingFlows = await glob(findManagedPattern, { cwd: process.cwd() });
    let counter = 0;
    for (const flowMetadataFile of matchingFlows) {
      const flowXml = await fs.readFile(flowMetadataFile, 'utf8');
      if (flowXml.includes('<stringValue>AUTO_LAYOUT_CANVAS</stringValue>')) {
        let updatedFlowXml = flowXml.replace(/<locationX>([0-9]*)<\/locationX>/gm, '<locationX>0</locationX>');
        updatedFlowXml = updatedFlowXml.replace(/<locationY>([0-9]*)<\/locationY>/gm, '<locationY>0</locationY>');
        if (updatedFlowXml !== flowXml) {
          await fs.writeFile(flowMetadataFile, updatedFlowXml);
          counter++;
          uxLog(this, c.grey(`Removed positions from Flow ${flowMetadataFile}`));
        }
      }
    }

    // Summary
    const msg = `Updated ${c.green(c.bold(counter))} flows to remove positions`;
    uxLog(this, c.cyan(msg));
    // Return an object to be displayed with --json
    return { outputString: msg };
  }
}
