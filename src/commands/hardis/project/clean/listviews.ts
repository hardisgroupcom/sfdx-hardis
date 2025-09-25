/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { glob } from 'glob';
import * as path from 'path';
import { uxLog } from '../../../../common/utils/index.js';
import { parseXmlFile, writeXmlFile } from '../../../../common/utils/xmlUtils.js';
import { getConfig, setConfig } from '../../../../config/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class CleanListViews extends SfCommand<any> {
  public static title = 'Replace Mine by Everything in ListViews';

  public static description = 'Replace Mine by Everything in ListView, and log the replacements in sfdx-hardis.yml';

  public static examples = ['$ sf hardis:project:clean:listviews'];

  public static flags: any = {
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
    const { flags } = await this.parse(CleanListViews);
    this.folder = flags.folder || './force-app';
    this.debugMode = flags.debug || false;

    // Delete standard files when necessary
    uxLog(this, c.cyan(`Replacing 'Mine' by 'Everything' in ListViews for deployments to pass`));
    /* jscpd:ignore-end */
    const rootFolder = path.resolve(this.folder);
    const findManagedPattern = rootFolder + `/**/*.listView-meta.xml`;
    const matchingListViews = await glob(findManagedPattern, { cwd: process.cwd() });
    let counter = 0;
    const config = await getConfig('project');
    let listViewsMine = config.listViewsToSetToMine || [];
    for (const listViewfile of matchingListViews) {
      const listViewXml = await parseXmlFile(listViewfile);
      if (listViewXml.ListView?.filterScope[0] === 'Mine') {
        listViewXml.ListView.filterScope[0] = 'Everything';
        uxLog(this, c.grey(`replaced Mine by Everything in ListView ${listViewXml}`));
        await writeXmlFile(listViewfile, listViewXml);
        listViewsMine.push(path.relative(process.cwd(), listViewfile).replace(/\\/g, '/'));
        counter++;
      }
    }
    listViewsMine = [...new Set(listViewsMine)]; // Make unique
    await setConfig('project', { listViewsToSetToMine: listViewsMine });

    // Summary
    const msg = `Replaced ${c.green(c.bold(counter))} Mine by Everything in ListViews`;
    uxLog(this, c.cyan(msg));
    // Return an object to be displayed with --json
    return { outputString: msg };
  }
}
