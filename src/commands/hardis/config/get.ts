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

  public static description = 'Returns sfdx-hardis project config for a given level';

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
    uxLog(this, JSON.stringify(this.configInfo));
    return {
      config: this.configInfo,
    };
  }
}
