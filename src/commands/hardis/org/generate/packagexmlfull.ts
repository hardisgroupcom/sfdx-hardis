/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Connection, Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import * as path from 'path';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { getReportDirectory } from '../../../../config/index.js';
import { buildOrgManifest } from '../../../../common/utils/deployUtils.js';
import { promptOrgUsernameDefault } from '../../../../common/utils/orgUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class GeneratePackageXmlFull extends SfCommand<any> {
  public static title = 'Generate Full Org package.xml';

  public static description = 'Generates full org package.xml, including managed items';

  public static examples = [
    '$ sf hardis:org:generate:packagexmlfull',
    '$ sf hardis:org:generate:packagexmlfull --outputfile /tmp/packagexmlfull.xml',
    '$ sf hardis:org:generate:packagexmlfull --target-org nico@example.com',
  ];

  public static flags = {
    outputfile: Flags.string({
      description: 'Output package.xml file',
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

  public static requiresProject = false;

  protected debugMode = false;
  protected outputFile;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(GeneratePackageXmlFull);
    this.outputFile = flags.outputfile || null;
    this.debugMode = flags.debug || false;

    // Select org that will be used to export records
    let conn: Connection | null = null;
    let orgUsername = flags['target-org'].getUsername();
    if (!isCI) {
      const prevOrgUsername = orgUsername;
      orgUsername = await promptOrgUsernameDefault(this, orgUsername || '', { devHub: false, setDefault: false });
      if (prevOrgUsername === orgUsername) {
        conn = flags['target-org'].getConnection();
      }
    }
    uxLog(this, c.cyan(`Generating full package xml for ${orgUsername}`));

    // Calculate default output file if not provided as input
    if (this.outputFile == null) {
      const reportDir = await getReportDirectory();
      this.outputFile = path.join(reportDir, 'org-package-xml-full.xml');
    }

    await buildOrgManifest(orgUsername, this.outputFile, conn);

    uxLog(this, c.cyan(`Generated full package.xml for ${orgUsername} at location ${c.green(this.outputFile)}`));

    // Return an object to be displayed with --json
    return { outputString: `Generated full package.xml for ${orgUsername}`, outputFile: this.outputFile };
  }
}
