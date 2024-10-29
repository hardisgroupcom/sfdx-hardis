/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { WebSocketClient } from '../../../common/websocketClient.js';
import { generatePackageXmlMarkdown } from '../../../common/utils/docUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class PackageXml2Markdown extends SfCommand<any> {
  public static title = 'PackageXml to Markdown';

  public static description = `Generates a markdown documentation from a package.xml file`;

  public static examples = ['$ sf hardis:doc:packagexml2markdown'];

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
    await generatePackageXmlMarkdown(this.inputFile, this.outputFile);

    // Open file in a new VsCode tab if available
    WebSocketClient.requestOpenFile(this.outputFile);

    // Return an object to be displayed with --json
    return { outputFile: this.outputFile };
  }

}
