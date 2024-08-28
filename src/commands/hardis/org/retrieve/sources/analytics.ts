/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import * as path from 'path';
// import * as path from "path";
import { uxLog, isCI, createTempDir, execCommand } from '../../../../../common/utils/index.js';

import { promptOrgUsernameDefault } from '../../../../../common/utils/orgUtils.js';
import { buildOrgManifest } from '../../../../../common/utils/deployUtils.js';
import { parsePackageXmlFile, writePackageXmlFile } from '../../../../../common/utils/xmlUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class RetrieveAnalytics extends SfCommand<any> {
  public static title = 'Retrieve CRM Analytics configuration from an org';

  public static description = `Retrieve all CRM Analytics sources from an org, with workarounds for SFDX bugs`;

  public static examples = ['$ sf hardis:org:retrieve:sources:analytics'];

  public static flags = {
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
  }; // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected configInfo: any = {};
  protected debugMode = false;
  /* jscpd:ignore-end */

  protected analyticsMetadataTypes = [
    'WaveApplication',
    'WaveDashboard',
    'WaveDataflow',
    'WaveDataset',
    'WaveLens',
    'WaveRecipe',
    'WaveXmd',
  ];

  // Retrieves locally all items corresponding to CRM Analytics configuration
  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(RetrieveAnalytics);
    // Manage user selection for org if we are not in CI
    let orgUsername = flags['target-org'].getUsername();
    if (!isCI && !flags['target-org']) {
      orgUsername = await promptOrgUsernameDefault(this, orgUsername || '', { devHub: false, setDefault: false });
    }

    // List all metadatas of target org
    const tmpDir = await createTempDir();
    const packageXmlAllFile = path.join(tmpDir, 'packageXmlAll.xml');
    await buildOrgManifest(orgUsername, packageXmlAllFile, flags['target-org'].getConnection());
    uxLog(this, c.cyan(`Retrieved full package XML from org ${orgUsername}: ${packageXmlAllFile}`));

    // Filter to keep only analytics metadatas
    const parsedPackageXmlAll = await parsePackageXmlFile(packageXmlAllFile);
    const packageXmlAnalyticsFile = path.join(tmpDir, 'packageXmlAnalytics.xml');
    const analyticsPackageXml = {};
    for (const type of Object.keys(parsedPackageXmlAll)) {
      if (this.analyticsMetadataTypes.includes(type)) {
        analyticsPackageXml[type] = parsedPackageXmlAll[type];
      }
    }
    await writePackageXmlFile(packageXmlAnalyticsFile, analyticsPackageXml);
    uxLog(
      this,
      c.cyan(`Filtered and completed analytics metadatas in analytics package XML: ${packageXmlAnalyticsFile}`)
    );

    // Retrieve locally Analytics sources
    const retrieveCommand = `sf project retrieve start -x "${packageXmlAnalyticsFile}" -o ${orgUsername}`;
    await execCommand(retrieveCommand, this, { fail: true, debug: this.debugMode, output: true });
    uxLog(this, c.cyan(`Retrieved all analytics source items using package XML: ${packageXmlAnalyticsFile}`));

    return { outputString: `Retrieved analytics sources from org ${orgUsername}` };
  }
}
