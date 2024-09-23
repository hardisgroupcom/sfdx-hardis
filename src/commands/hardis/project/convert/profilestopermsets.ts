/* jscpd:ignore-start */

import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { execCommand, uxLog } from '../../../../common/utils/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ConvertProfilesToPermSets extends SfCommand<any> {
  public static title = 'Convert Profiles into Permission Sets';

  public static description = 'Creates permission sets from existing profiles, with id PS_PROFILENAME';

  public static examples = ['$ sf hardis:project:convert:profilestopermsets'];

  public static flags: any = {
    except: Flags.string({
      char: 'e',
      default: [],
      description: 'List of filters',
      multiple: true,
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
  public static requiresProject = true;

  /* jscpd:ignore-end */
  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ['shane-sfdx-plugins'];

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ConvertProfilesToPermSets);
    const except = flags.except || [];

    uxLog(this, c.cyan('This command will convert profiles into permission sets'));

    const sourceRootFolder = path.join(process.cwd() + '/force-app/main/default');
    const profilesFolder = path.join(sourceRootFolder, 'profiles');
    const objectsFolderContent = await fs.readdir(profilesFolder);
    for (const profileFile of objectsFolderContent) {
      if (profileFile.includes('.profile-meta.xml')) {
        const profileName = path.basename(profileFile).replace('.profile-meta.xml', '');
        if (except.filter((str) => profileName.toLowerCase().includes(str)).length > 0) {
          continue;
        }
        const psName = 'PS_' + profileName.split(' ').join('_');
        uxLog(this, c.cyan(`Generating Permission set ${c.green(psName)} from profile ${c.green(profileName)}`));
        const convertCommand = 'sf shane:profile:convert' + ` -p "${profileName}"` + ` -n "${psName}"` + ' -e';
        await execCommand(convertCommand, this, { fail: true, output: true });
      }
    }

    return {};
  }
}
