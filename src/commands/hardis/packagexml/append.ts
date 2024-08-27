import { flags, FlagsConfig, SfCommand } from "@salesforce/command";
import { AnyJson } from "@salesforce/ts-types";
import { appendPackageXmlFilesContent } from "../../../common/utils/xmlUtils.js";

export class PackageXmlAppend extends SfCommand<any> {
  public static readonly description = `Append one or multiple package.xml files into a single one`;
  public static readonly examples = ["$ sf hardis packagexml append -p package1.xml,package2.xml -o package3.xml"];
  public static readonly requiresProject = false;
  public static readonly requiresUsername = false;
  public static readonly flagsConfig: FlagsConfig = {
    packagexmls: Flags.string({
      char: "p",
      description: "package.xml files path (separated by commas)",
    }),
    outputfile: Flags.string({
      char: "o",
      description: "package.xml output file",
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
    this.packageXmlFiles = flags.packagexmls.split(",");
    this.outputFile = flags.outputfile;
    await appendPackageXmlFilesContent(this.packageXmlFiles, this.outputFile);
    return { outputPackageXmlFile: this.outputFile };
  }
}
