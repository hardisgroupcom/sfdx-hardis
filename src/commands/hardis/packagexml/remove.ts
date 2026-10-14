import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { AnyJson } from "@salesforce/ts-types";
import { buildInlineRemoveTypes, removePackageXmlFilesContent } from "../../../common/utils/xmlUtils.js";

export class PackageXmlRemove extends SfCommand<any> {
  public static readonly description = `
## Command Behavior

**Removes metadata components from a \`package.xml\` file using either another \`package.xml\` as a filter or inline metadata type/member specifications.**

This command is useful for refining your \`package.xml\` manifests by excluding components that are being deleted or are otherwise irrelevant for a specific deployment or retrieval.

There are two ways to specify which items to remove:

1. **Filter \`package.xml\` (--removepackagexml):** Provide a second \`package.xml\` file (e.g., a \`destructiveChanges.xml\`) whose components are removed from the source. Defaults to \`destructiveChanges.xml\`.
2. **Inline flags (--metadatatypes / --metadatanames):** Specify metadata types and/or member names directly on the command line without needing a filter file.
   - \`--metadatatypes\`: Comma-separated list of metadata type names whose *entire* content is removed (e.g. \`ApexClass,CustomObject\`).
   - \`--metadatanames\`: Comma-separated list of \`TypeName:MemberName\` pairs for granular removal (e.g. \`ApexClass:MyClass,CustomObject:Account__c\`). Both flags can be combined.

Additional options:

- **Source \`package.xml\`:** The main \`package.xml\` file from which components will be removed (specified by \`--packagexml\`). Defaults to \`package.xml\`.
- **Output File:** The path to the new \`package.xml\` file that will contain the filtered content (specified by \`--outputfile\`).
- **Removed Only Output:** The \`--removedonly\` flag generates a \`package.xml\` that contains *only* the items that were removed from the source \`package.xml\`.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Parsing:** It reads and parses the XML content of the source \`package.xml\` and optionally the filter \`package.xml\`.
- **Inline Types Building:** When \`--metadatatypes\` or \`--metadatanames\` flags are used, the filter structure is built in memory via \`buildInlineRemoveTypes\` without reading a file.
- **Content Comparison and Filtering:** It compares the metadata types and members defined in both sources. Components found in the filter are excluded from the output.
- **XML Building:** After filtering, it rebuilds the XML structure for the new \`package.xml\` file.
- **File Writing:** The newly constructed XML content is then written to the specified output file.
- **\`removePackageXmlFilesContent\` Utility:** The core logic for this operation is encapsulated within the \`removePackageXmlFilesContent\` utility function, which handles the parsing, filtering, and writing of the \`package.xml\` files.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:packagexml:remove --agent
\`\`\`

In agent mode, all interactive prompts are skipped and default values are used.

`;
  public static readonly examples = [
    "$ sf hardis packagexml:remove -p package.xml -r destructiveChanges.xml -o my-reduced-package.xml",
    "$ sf hardis packagexml:remove -p package.xml --metadatatypes ApexClass,CustomObject -o my-reduced-package.xml",
    "$ sf hardis packagexml:remove -p package.xml --metadatanames ApexClass:MyClass,CustomObject:Account__c -o my-reduced-package.xml",
    "$ sf hardis packagexml:remove -p package.xml --metadatatypes CustomObject --metadatanames ApexClass:MyClass -o my-reduced-package.xml",
  ];
  public static readonly requiresProject = false;
  public static readonly flags: any = {
    packagexml: Flags.string({
      char: 'p',
      description: 'package.xml file to reduce'
    }),
    removepackagexml: Flags.string({
      char: 'r',
      description: 'package.xml file to use to filter input package.xml (alternative to --metadatatypes / --metadatanames)'
    }),
    metadatatypes: Flags.string({
      char: 't',
      description: 'Comma-separated list of metadata type names to fully remove from the package.xml (e.g. ApexClass,CustomObject). All members of each type are removed.'
    }),
    metadatanames: Flags.string({
      char: 'n',
      description: 'Comma-separated list of TypeName:MemberName pairs to remove from the package.xml (e.g. ApexClass:MyClass,CustomObject:Account__c)'
    }),
    removedonly: Flags.boolean({
      char: 'z',
      description: 'Use this flag to generate a package.xml with only removed items',
      default: false
    }),
    outputfile: Flags.string({
      char: 'f',
      description: 'package.xml output file',
      required: true
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    debug: Flags.boolean({
      default: false,
      description: "debug",
    }),
    websocket: Flags.string({
      description: "websocket",
    }),
  };

  protected packageXmlFile: string;
  protected removePackageXmlFile: string;
  protected removedOnly = false;
  protected outputFile: string;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(PackageXmlRemove);
    this.packageXmlFile = flags.packagexml || 'package.xml';
    this.removedOnly = flags.removedonly || false;
    this.outputFile = flags.outputfile;

    // Build inline remove types from --metadatatypes and/or --metadatanames flags
    const metadataTypes: string[] = flags.metadatatypes
      ? flags.metadatatypes.split(',').map((s: string) => s.trim()).filter(Boolean)
      : [];
    const metadataNames: string[] = flags.metadatanames
      ? flags.metadatanames.split(',').map((s: string) => s.trim()).filter(Boolean)
      : [];
    const inlineRemoveTypes = metadataTypes.length > 0 || metadataNames.length > 0
      ? buildInlineRemoveTypes(metadataTypes, metadataNames)
      : null;

    // When using inline flags, no filter file is needed; otherwise fall back to --removepackagexml or the default
    this.removePackageXmlFile = inlineRemoveTypes ? '' : (flags.removepackagexml || 'destructiveChanges.xml');

    await removePackageXmlFilesContent(
      this.packageXmlFile,
      this.removePackageXmlFile,
      { logFlag: flags.debug, outputXmlFile: this.outputFile, removedOnly: this.removedOnly, inlineRemoveTypes }
    );

    return { outputPackageXmlFile: this.outputFile };
  }
}
