/* jscpd:ignore-start */
import { SfCommand, Flags, optionalOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { WebSocketClient } from '../../../common/websocketClient.js';
import { DocBuilderPackageXML } from '../../../common/docBuilder/docBuilderPackageXml.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class PackageXml2Markdown extends SfCommand<any> {
  public static title = 'PackageXml to Markdown';

  public static description = `
## Command Behavior

**Generates a Markdown documentation file from a Salesforce \`package.xml\` file.**

This command provides a convenient way to visualize and document the metadata components defined within a \`package.xml\` file. It's particularly useful for:

- **Understanding Project Scope:** Quickly grasp what metadata types and components are included in a specific deployment or retrieval.
- **Documentation:** Create human-readable documentation of your project's metadata structure.
- **Collaboration:** Share a clear overview of metadata changes with team members or stakeholders.

Key features:

- **Flexible Input:** You can specify the path to a \`package.xml\` file using the \`--inputfile\` flag. If not provided, the command will automatically look for \`package.xml\` files in the \`manifest\` folder.
- **Customizable Output:** You can force the path and name of the output Markdown file using the \`--outputfile\` flag.
- **VS Code Integration:** Automatically opens the generated Markdown file in a new VS Code tab for immediate review.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **XML Parsing:** It reads the content of the specified \`package.xml\` file and parses its XML structure to extract the metadata types and their members.
- **Markdown Generation:** It utilizes the \`DocBuilderPackageXML.generatePackageXmlMarkdown\` utility to transform the parsed \`package.xml\` data into a structured Markdown format. This utility handles the formatting and organization of the metadata information.
- **File System Operations:** It uses \`fs-extra\` (implicitly through \`DocBuilderPackageXML\`) to read the input \`package.xml\` and write the generated Markdown file.
- **WebSocket Communication:** It interacts with a WebSocket client (\`WebSocketClient.requestOpenFile\`) to open the generated Markdown file in a VS Code tab, enhancing user experience.
- **Salesforce Org Context:** It can optionally use the \`target-org\` flag to provide context, such as the instance URL, which might be used for generating links or additional information within the Markdown.
</details>
`;

  public static examples = [
    '$ sf hardis:doc:packagexml2markdown',
    '$ sf hardis:doc:packagexml2markdown --inputfile manifest/package-all.xml'
  ];

  public static flags: any = {
    inputfile: Flags.string({
      char: 'x',
      description: 'Path to package.xml file. If not specified, the command will look in manifest folder',
    }),
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path and name of output report file. Must end with .md',
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
    "target-org": optionalOrgFlagWithDeprecations
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  protected inputFile;
  protected outputFile;
  protected debugMode = false;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(PackageXml2Markdown);
    this.inputFile = flags.inputfile || null;
    this.outputFile = flags.outputfile || null;
    this.debugMode = flags.debug || false;

    // Generate markdown for package.xml
    const instanceUrl = flags?.['target-org']?.getConnection()?.instanceUrl;
    this.outputFile = await DocBuilderPackageXML.generatePackageXmlMarkdown(this.inputFile, this.outputFile, null, instanceUrl);

    // Open file in a new VS Code tab if available
    WebSocketClient.requestOpenFile(this.outputFile);

    // Return an object to be displayed with --json
    return { outputFile: this.outputFile };
  }

}
