/* jscpd:ignore-start */

import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { uxLog } from '../../../common/utils/index.js';
import { getConfig } from '../../../config/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ConfigGet extends SfCommand<any> {
  public static title = 'Deploy metadata sources to org';

  public static description = `
## Command Behavior

**Retrieves and displays the sfdx-hardis configuration for a specified level.**

This command allows you to inspect the configuration that is currently in effect for your project, which is useful for debugging and understanding how sfdx-hardis will behave.

- **Configuration levels:** It can retrieve configuration from three different levels:
  - **Project:** The configuration defined in the project's \`.sfdx-hardis.yml\` file.
  - **Branch:** The configuration defined in a branch-specific configuration file (e.g., \`.sfdx-hardis.production.yml\`).
  - **User:** The global user-level configuration.

## Technical explanations

The command's logic is straightforward:

- **\`getConfig\` function:** It calls the \`getConfig\` utility function, passing the desired configuration level as an argument.
- **Configuration loading:** The \`getConfig\` function is responsible for finding the appropriate configuration file, reading its contents, and parsing it as YAML or JSON.
- **Output:** The retrieved configuration is then displayed to the user as a JSON string.
`;

  public static examples = ['$ sf hardis:project:deploy:sources:metadata'];

  public static flags: any = {
    level: Flags.string({
      char: 'l',
      default: 'project',
      description: 'project,branch or user',
      options: ['project', 'branch', 'user'],
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
  }; // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  protected configInfo: any = {};

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ConfigGet);
    const level = flags.level || 'project';
    this.configInfo = await getConfig(level);
    uxLog("other", this, JSON.stringify(this.configInfo));
    return {
      config: this.configInfo,
    };
  }
}
