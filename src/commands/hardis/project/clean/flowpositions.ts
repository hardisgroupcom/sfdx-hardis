/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { glob } from 'glob';
import * as path from 'path';
import fs from '../../../../common/utils/fsUtils.js';
import { uxLog } from '../../../../common/utils/index.js';
import { MetadataUtils } from '../../../../common/metadata-utils/index.js';
import { GLOB_IGNORE_PATTERNS } from '../../../../common/utils/projectUtils.js';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

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

By default, all Flows of the **--folder** are scanned. Use **--flows** or **--files** to restrict the cleaning to a subset:

\`\`\`sh
sf hardis:project:clean:flowpositions --flows Opportunity_Won,Account_Before_Save
sf hardis:project:clean:flowpositions --files force-app/main/default/flows/Opportunity_Won.flow-meta.xml
\`\`\`

**hardis:work:save** uses **--flows** with the Flow members of the package.xml built by sfdx-git-delta, so repositories with hundreds of Flows are not scanned entirely.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:clean:flowpositions --agent
\`\`\`

In agent mode, all interactive prompts are skipped and default values are used.

`;

  public static examples = ['$ sf hardis:project:clean:flowpositions',
    '$ sf hardis:project:clean:flowpositions --flows Opportunity_Won,Account_Before_Save',
    '$ sf hardis:project:clean:flowpositions --agent',];

  public static flags: any = {
    folder: Flags.string({
      char: 'f',
      default: 'force-app',
      description: 'Root folder',
    }),
    flows: Flags.string({
      description: 'Comma-separated list of Flow API names to clean, instead of all Flows',
    }),
    files: Flags.string({
      description: 'Comma-separated list of Flow metadata files to clean, instead of all Flows',
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
  public static requiresProject = true;

  protected folder: string;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CleanFlowPositions);
    this.folder = flags.folder || './force-app';
    this.debugMode = flags.debug || false;

    // Delete standard files when necessary
    uxLog("action", this, c.cyan(t('settingFlowsAutoLayoutAndRemovePositions')));
    /* jscpd:ignore-end */
    const matchingFlows = await this.listFlowsToClean(flags.flows, flags.files);
    let counter = 0;
    for (const flowMetadataFile of matchingFlows) {
      const flowXml = await fs.readFile(flowMetadataFile, 'utf8');
      if (flowXml.includes('<stringValue>AUTO_LAYOUT_CANVAS</stringValue>')) {
        let updatedFlowXml = flowXml.replace(/<locationX>([0-9]*)<\/locationX>/gm, '<locationX>0</locationX>');
        updatedFlowXml = updatedFlowXml.replace(/<locationY>([0-9]*)<\/locationY>/gm, '<locationY>0</locationY>');
        if (updatedFlowXml !== flowXml) {
          await fs.writeFile(flowMetadataFile, updatedFlowXml);
          counter++;
          uxLog("log", this, c.grey(t('removedPositionsFromFlow', { flowMetadataFile })));
        }
      }
    }

    // Summary
    const msg = `Updated ${c.green(c.bold(counter))} flows to remove positions`;
    uxLog("action", this, c.cyan(msg));
    // Return an object to be displayed with --json
    return { outputString: msg };
  }

  // Returns the Flow metadata files to process: the ones matching --flows / --files when one of them is
  // set (usually the Flows of the current User Story), or all the Flows of the root folder otherwise
  private async listFlowsToClean(flowNames: string | undefined, flowFiles: string | undefined): Promise<string[]> {
    if (flowNames === undefined && flowFiles === undefined) {
      const rootFolder = path.resolve(this.folder);
      const findManagedPattern = rootFolder + `/**/*.flow-meta.xml`;
      return await glob(findManagedPattern, { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS });
    }
    const selectedFlows: string[] = [];
    // Flow metadata files sent by the caller
    for (const flowFile of splitCommaSeparated(flowFiles)) {
      if (await fs.pathExists(flowFile)) {
        selectedFlows.push(flowFile);
      } else {
        uxLog("warning", this, c.yellow(t('flowFileNotFoundSkipped', { flowFile })));
      }
    }
    // Flow API names sent by the caller: locate their source files in a single pass on the package directories
    const flowFilesByName = await MetadataUtils.findMetaFilesFromTypeAndNames('Flow', splitCommaSeparated(flowNames));
    for (const [flowName, flowFile] of flowFilesByName) {
      if (flowFile) {
        selectedFlows.push(flowFile);
      } else {
        uxLog("warning", this, c.yellow(t('flowSourceFileNotFoundSkipped', { flowName })));
      }
    }
    const uniqueFlows = [...new Set(selectedFlows)];
    uxLog("log", this, c.grey(t('cleaningPositionsOfSelectedFlowsOnly', { number: uniqueFlows.length })));
    return uniqueFlows;
  }
}

// Splits a comma-separated flag value into a list of trimmed, non-empty entries
function splitCommaSeparated(flagValue: string | undefined): string[] {
  return (flagValue || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}
