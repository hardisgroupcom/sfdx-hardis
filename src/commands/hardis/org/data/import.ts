/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { importData, selectDataWorkspace } from '../../../../common/utils/dataUtils.js';
import { promptOrgUsernameDefault } from '../../../../common/utils/orgUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('plugin-template-sf-external', 'org');

export default class DataImport extends SfCommand<any> {
  public static title = 'Import data';

  public static description = `Import/Load data in an org using a [SFDX Data Loader](https://help.sfdmu.com/) Project

See article:

[![How to detect bad words in Salesforce records using SFDX Data Loader and sfdx-hardis](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-badwords.jpg)](https://nicolas.vuillamy.fr/how-to-detect-bad-words-in-salesforce-records-using-sfdx-data-loader-and-sfdx-hardis-171db40a9bac)
`;

  public static examples = ['$ sf hardis:org:data:import'];

  public static flags = {
    path: Flags.string({
      char: 'p',
      description: 'Path to the sfdmu workspace folder',
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
  public static requiresProject = false;

  // List required plugins, their presence will be tested before running the command
  protected static requiresSfdxPlugins = ['sfdmu'];

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DataImport);
    let sfdmuPath = flags.path || null;

    // Identify sfdmu workspace if not defined
    if (sfdmuPath == null) {
      sfdmuPath = await selectDataWorkspace({ selectDataLabel: 'Please select a data workspace to IMPORT' });
    }

    // Select org that where records will be imported
    let orgUsername = flags['target-org'].getUsername();
    if (!isCI) {
      orgUsername = await promptOrgUsernameDefault(this, orgUsername || '', { devHub: false, setDefault: false });
    }

    // Export data from org
    await importData(sfdmuPath || '', this, {
      targetUsername: orgUsername,
    });

    // Output message
    const message = `Successfully import data from sfdmu project ${c.green(sfdmuPath)} into org ${c.green(
      orgUsername
    )}`;
    uxLog(this, c.cyan(message));
    return { outputString: message };
  }
}
