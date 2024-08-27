import { flags, FlagsConfig, SfdxCommand } from "@salesforce/command";
import { AnyJson } from "@salesforce/ts-types";
import { removePackageXmlFilesContent } from "../../../common/utils/xmlUtils";

export class PackageXmlRemove extends SfdxCommand {
  public static readonly description = `Removes the content of a package.xml file matching another package.xml file`;
  public static readonly examples = ["$ sf hardis packagexml:remove -p package.xml -r destructiveChanges.xml -o my-reduced-package.xml"];
  public static readonly requiresProject = false;
  public static readonly requiresUsername = false;
  public static readonly flagsConfig: FlagsConfig = {
    packagexml: flags.string({
      char: 'p',
      description: 'package.xml file to reduce'
    }),
    removepackagexml: flags.string({
      char: 'r',
      description: 'package.xml file to use to filter input package.xml'
    }),
    removedonly: flags.boolean({
      char: 'z',
      description: 'Use this flag to generate a package.xml with only removed items',
      default: false
    }),
    outputfile: flags.string({
      char: 'o',
      description: 'package.xml output file'
    }),
    debug: flags.boolean({
      default: false,
      description: "debug",
    }),
    websocket: flags.string({
      description: "websocket",
    }),
  };

  protected packageXmlFile: string;
  protected removePackageXmlFile: string;
  protected removedOnly = false;
  protected outputFile: string;

  public async run(): Promise<AnyJson> {
    this.packageXmlFile = this.flags.packagexml || 'package.xml';
    this.removePackageXmlFile = this.flags.removepackagexml || 'destructiveChanges.xml';
    this.removedOnly = this.flags.removedonly || false;
    this.outputFile = this.flags.outputfile;

    await removePackageXmlFilesContent(
      this.packageXmlFile,
      this.removePackageXmlFile,
      { logFlag: this.flags.debug, outputXmlFile: this.outputFile, removedOnly: this.removedOnly }
    );

    return { outputPackageXmlFile: this.outputFile };
  }
}
