import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { AnyJson } from "@salesforce/ts-types";
import { appendPackageXmlFilesContent } from "../../../common/utils/xmlUtils.js";

export class PackageXmlAppend extends SfCommand<any> {
  public static readonly description = `
## Command Behavior

**Appends the content of one or more Salesforce \`package.xml\` files into a single target \`package.xml\` file.**

This command is useful for consolidating metadata definitions from various sources into a single manifest. For instance, you might have separate \`package.xml\` files for different features or metadata types, and this command allows you to combine them into one comprehensive file for deployment or retrieval.

Key functionalities:

- **Multiple Input Files:** Takes a comma-separated list of \`package.xml\` file paths as input.
- **Single Output File:** Merges the content of all input files into a specified output \`package.xml\` file.
- **Metadata Consolidation:** Combines the \`<types>\` and \`<members>\` elements from all input files, ensuring that all unique metadata components are included in the resulting file.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Parsing:** It reads and parses the XML content of each input \`package.xml\` file.
- **Content Merging:** It iterates through the parsed XML structures, merging the \`types\` and \`members\` arrays. If a metadata type exists in multiple input files, its members are combined (duplicates are typically handled by the underlying XML utility).
- **XML Building:** After consolidating the metadata, it rebuilds the XML structure for the output \`package.xml\` file.
- **File Writing:** The newly constructed XML content is then written to the specified output file.
- **\`appendPackageXmlFilesContent\` Utility:** The core logic for this operation is encapsulated within the \`appendPackageXmlFilesContent\` utility function, which handles the parsing, merging, and writing of the \`package.xml\` files.
</details>
`;
  public static readonly examples = ["$ sf hardis packagexml append -p package1.xml,package2.xml -o package3.xml"];
  public static readonly flags: any = {
    packagexmls: Flags.string({
      char: "p",
      description: "package.xml files path (separated by commas)",
      required: true
    }),
    outputfile: Flags.string({
      char: "f",
      description: "package.xml output file",
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

  protected packageXmlFiles: string[];
  protected outputFile: string;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(PackageXmlAppend);
    this.packageXmlFiles = (flags.packagexmls || "").split(",");
    this.outputFile = flags.outputfile;
    await appendPackageXmlFilesContent(this.packageXmlFiles, this.outputFile);
    return { outputPackageXmlFile: this.outputFile };
  }
}
