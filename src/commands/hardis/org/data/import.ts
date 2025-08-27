/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { findDataWorkspaceByName, importData, selectDataWorkspace } from '../../../../common/utils/dataUtils.js';
import { promptOrgUsernameDefault } from '../../../../common/utils/orgUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DataImport extends SfCommand<any> {
  public static title = 'Import data';

  public static description = `Import/Load data in an org using a [SFDX Data Loader](https://help.sfdmu.com/) Project

If you need to run this command in a production org, you need to either:

- Define **sfdmuCanModify** in your .sfdx-hardis.yml config file. (Example: \`sfdmuCanModify: prod-instance.my.salesforce.com\`)
- Define an environment variable SFDMU_CAN_MODIFY. (Example: \`SFDMU_CAN_MODIFY=prod-instance.my.salesforce.com\`)

See article:

[![How to detect bad words in Salesforce records using SFDX Data Loader and sfdx-hardis](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-badwords.jpg)](https://nicolas.vuillamy.fr/how-to-detect-bad-words-in-salesforce-records-using-sfdx-data-loader-and-sfdx-hardis-171db40a9bac)
`;

  public static examples = [
    '$ sf hardis:org:data:import',
    '$ sf hardis:org:data:import --project-name MyDataProject --target-org my-org@example.com',
    '$ sf hardis:org:data:import --path ./scripts/data/MyDataProject --no-prompt --target-org my-org@example.com',
    '$ SFDMU_CAN_MODIFY=prod-instance.my.salesforce.com sf hardis:org:data:import --project-name MyDataProject --target-org prod@example.com',
  ];

  public static flags: any = {
    "project-name": Flags.string({
      char: 'n',
      description: 'Name of the sfdmu project to use (if not defined, you will be prompted to select one)',
    }),
    path: Flags.string({
      char: 'p',
      description: 'Path to the sfdmu workspace folder',
    }),
    "no-prompt": Flags.boolean({
      char: 'r',
      description: 'Do not prompt for Org, use default org',
      default: false,
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
    const projectName = flags["project-name"] || null;
    const noPrompts = flags["no-prompt"] || false;

    uxLog("action", this, c.cyan('This command will launch data IMPORT (upload to org) using SFDX Data Loader (sfdmu)'));

    // Select org that where records will be imported
    let orgUsername = flags['target-org'].getUsername();
    if (!isCI && noPrompts === false) {
      orgUsername = await promptOrgUsernameDefault(this, orgUsername || '', { devHub: false, setDefault: false });
    }

    // Find by project name if provided
    if (projectName != null && sfdmuPath == null) {
      sfdmuPath = await findDataWorkspaceByName(projectName);
    }

    // Identify sfdmu workspace if not defined
    if (sfdmuPath == null) {
      sfdmuPath = await selectDataWorkspace({
        selectDataLabel: `Please select a data workspace to IMPORT in ${c.green(orgUsername)}`,
      });
    }



    // Export data from org
    await importData(sfdmuPath || '', this, {
      targetUsername: orgUsername,
    });

    // Output message
    const message = `Successfully import data from sfdmu project ${c.green(sfdmuPath)} into org ${c.green(
      orgUsername
    )}`;
    uxLog("action", this, c.cyan(message));
    return { outputString: message };
  }
}
