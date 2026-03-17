import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { AnyJson } from "@salesforce/ts-types";
import { removePackageXmlFilesContent } from "../../../common/utils/xmlUtils.js";

export class PackageXmlRemove extends SfCommand<any> {
  public static readonly description = `
## Command Behavior

**Removes metadata components from a \`package.xml\` file that are also present in another \`package.xml\` file (e.g., a \`destructiveChanges.xml\`).**

This command is useful for refining your \`package.xml\` manifests by excluding components that are being deleted or are otherwise irrelevant for a specific deployment or retrieval. For example, you can use it to create a \`package.xml\` that only contains additions and modifications, by removing items listed in a \`destructiveChanges.xml\`.

Key functionalities:

- **Source \`package.xml\`:** The main \`package.xml\` file from which components will be removed (specified by \`--packagexml\`). Defaults to \`package.xml\`.
- **Filter \`package.xml\`:** The \`package.xml\` file containing the components to be removed from the source (specified by \`--removepackagexml\`). Defaults to \`destructiveChanges.xml\`.
- **Output File:** The path to the new \`package.xml\` file that will contain the filtered content (specified by \`--outputfile\`).
- **Removed Only Output:** The \`--removedonly\` flag allows you to generate a \`package.xml\` that contains *only* the items that were removed from the source \`package.xml\`.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Parsing:** It reads and parses the XML content of both the source \`package.xml\` and the filter \`package.xml\`.
- **Content Comparison and Filtering:** It compares the metadata types and members defined in both files. Components found in the filter \`package.xml\` are excluded from the output.
- **XML Building:** After filtering, it rebuilds the XML structure for the new \`package.xml\` file.
- **File Writing:** The newly constructed XML content is then written to the specified output file.
- **\`removePackageXmlFilesContent\` Utility:** The core logic for this operation is encapsulated within the \`removePackageXmlFilesContent\` utility function, which handles the parsing, filtering, and writing of the \`package.xml\` files.
</details>
`;
  public static readonly examples = ["$ sf hardis packagexml:remove -p package.xml -r destructiveChanges.xml -o my-reduced-package.xml"];
  public static readonly requiresProject = false;
  public static readonly flags: any = {
    packagexml: Flags.string({
      char: 'p',
      description: 'package.xml file to reduce'
    }),
    removepackagexml: Flags.string({
      char: 'r',
      description: 'package.xml file to use to filter input package.xml'
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
    this.removePackageXmlFile = flags.removepackagexml || 'destructiveChanges.xml';
    this.removedOnly = flags.removedonly || false;
    this.outputFile = flags.outputfile;

    await removePackageXmlFilesContent(
      this.packageXmlFile,
      this.removePackageXmlFile,
      { logFlag: flags.debug, outputXmlFile: this.outputFile, removedOnly: this.removedOnly }
    );

    return { outputPackageXmlFile: this.outputFile };
  }
}
