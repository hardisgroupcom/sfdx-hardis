import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { AnyJson } from "@salesforce/ts-types";
import { removePackageXmlFilesContent } from "../../../common/utils/xmlUtils.js";

export class PackageXmlRemove extends SfCommand<any> {
  public static readonly description = `Removes the content of a package.xml file matching another package.xml file`;
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
