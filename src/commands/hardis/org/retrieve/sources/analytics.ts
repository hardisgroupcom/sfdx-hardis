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

  public static description = `
## Command Behavior

**Retrieves all CRM Analytics (formerly Tableau CRM or Einstein Analytics) sources from a Salesforce org, including workarounds for known SFDX bugs.**

This command is designed to extract the complete configuration of your CRM Analytics assets, such as dashboards, dataflows, lenses, and recipes. It's essential for version controlling your Analytics development, migrating assets between environments, or backing up your Analytics configurations.

Key functionalities:

- **Comprehensive Retrieval:** Fetches all supported CRM Analytics metadata types.
- **SFDX Bug Workarounds:** Incorporates internal logic to handle common issues or limitations encountered when retrieving CRM Analytics metadata using standard Salesforce CLI commands.
- **Target Org Selection:** Allows you to specify the Salesforce org from which to retrieve the Analytics sources. If not provided, it will prompt for selection.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Full Org Manifest Generation:** It first generates a complete \`package.xml\` for the target org using \`buildOrgManifest\`. This ensures that all available metadata, including CRM Analytics components, are identified.
- **Analytics Metadata Filtering:** It then filters this comprehensive \`package.xml\` to include only the CRM Analytics-related metadata types (e.g., \`WaveApplication\`, \`WaveDashboard\`, \`WaveDataflow\`, \`WaveLens\`, \`WaveRecipe\`, \`WaveXmd\`).
- **Filtered \`package.xml\` Creation:** A new \`package.xml\` file containing only the filtered CRM Analytics metadata is created temporarily.
- **Salesforce CLI Retrieval:** It executes the \`sf project retrieve start\` command, using the newly created Analytics-specific \`package.xml\` to retrieve the sources to your local project.
- **Temporary File Management:** It uses \`createTempDir\` to manage temporary files and directories created during the process.
- **Interactive Org Selection:** Uses \`promptOrgUsernameDefault\` to guide the user in selecting the target Salesforce org if not provided via flags.
</details>
`;

  public static examples = ['$ sf hardis:org:retrieve:sources:analytics'];

  public static flags: any = {
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
    uxLog("action", this, c.cyan(`Retrieved full package XML from org ${orgUsername}: ${packageXmlAllFile}`));

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
      "action",
      this,
      c.cyan(`Filtered and completed analytics metadatas in analytics package XML: ${packageXmlAnalyticsFile}`)
    );

    // Retrieve locally Analytics sources
    const retrieveCommand = `sf project retrieve start -x "${packageXmlAnalyticsFile}" -o ${orgUsername}`;
    await execCommand(retrieveCommand, this, { fail: true, debug: this.debugMode, output: true });
    uxLog("action", this, c.cyan(`Retrieved all analytics source items using package XML: ${packageXmlAnalyticsFile}`));

    return { outputString: `Retrieved analytics sources from org ${orgUsername}` };
  }
}
