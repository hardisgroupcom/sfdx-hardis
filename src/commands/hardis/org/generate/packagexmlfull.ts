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
import { WebSocketClient } from '../../../../common/websocketClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class GeneratePackageXmlFull extends SfCommand<any> {
  public static title = 'Generate Full Org package.xml';

  public static description = `
## Command Behavior

**Generates a comprehensive \`package.xml\` file for a Salesforce org, including all metadata components, even managed ones.**

This command is essential for various Salesforce development and administration tasks, especially when you need a complete snapshot of an org's metadata. It goes beyond typical source tracking by including managed package components, which is crucial for understanding the full metadata footprint of an org.

Key functionalities:

- **Full Org Metadata Retrieval:** Connects to a specified Salesforce org (or prompts for one if not provided) and retrieves a complete list of all metadata types and their members.
- **Managed Package Inclusion:** Unlike standard source retrieval, this command explicitly includes metadata from managed packages, providing a truly comprehensive \`package.xml\`.
- **Customizable Output:** Allows you to specify the output file path for the generated \`package.xml\`.
- **Interactive Org Selection:** If no target org is specified, it interactively prompts the user to choose an org. (or use --no-prompt to skip this step)

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Salesforce Metadata API Interaction:** It leverages the Salesforce Metadata API to list all available metadata types and then retrieve all components for each type.
- **\`buildOrgManifest\` Utility:** The core logic for querying the org's metadata and constructing the \`package.xml\` is encapsulated within the \`buildOrgManifest\` utility function.
- **XML Generation:** It dynamically builds the XML structure of the \`package.xml\` file, including the \`types\` and \`members\` elements for all retrieved metadata.
- **File System Operations:** It writes the generated \`package.xml\` file to the specified output path.
- **Interactive Prompts:** Uses \`promptOrgUsernameDefault\` to guide the user in selecting the target Salesforce org.
</details>
`;

  public static examples = [
    '$ sf hardis:org:generate:packagexmlfull',
    '$ sf hardis:org:generate:packagexmlfull --outputfile /tmp/packagexmlfull.xml',
    '$ sf hardis:org:generate:packagexmlfull --target-org nico@example.com',
  ];

  public static flags: any = {
    outputfile: Flags.string({
      description: 'Output package.xml file',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    "no-prompt": Flags.boolean({
      char: 'n',
      description: "Do not prompt for org username, use the default one",
      default: false,
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
    const noPrompt = flags['no-prompt'] ?? false;

    // Select org that will be used to export records
    let conn: Connection | null = null;
    let orgUsername = flags['target-org'].getUsername();
    if (orgUsername && (isCI || noPrompt)) {
      conn = flags['target-org'].getConnection();
    }
    else {
      const prevOrgUsername = orgUsername;
      orgUsername = await promptOrgUsernameDefault(this, orgUsername || '', { devHub: false, setDefault: false });
      if (prevOrgUsername === orgUsername) {
        conn = flags['target-org'].getConnection();
      }
    }
    uxLog("action", this, c.cyan(`Generating full package xml for ${orgUsername}`));

    // Calculate default output file if not provided as input
    if (this.outputFile == null) {
      const reportDir = await getReportDirectory();
      this.outputFile = path.join(reportDir, 'org-package-xml-full.xml');
    }

    await buildOrgManifest(orgUsername, this.outputFile, conn);

    uxLog("action", this, c.cyan(`Generated full package.xml for ${orgUsername}`));
    uxLog("log", this, c.grey(`Output file: ${c.green(this.outputFile)}`));

    if (WebSocketClient.isAliveWithLwcUI()) {
      WebSocketClient.sendReportFileMessage(this.outputFile, 'Full Org package.xml', "report");
    } else {
      WebSocketClient.requestOpenFile(this.outputFile);
    }

    // Return an object to be displayed with --json
    return { outputString: `Generated full package.xml for ${orgUsername}`, outputFile: this.outputFile };
  }
}
