import { flags, FlagsConfig, SfdxCommand } from "@salesforce/command";
import { AnyJson } from "@salesforce/ts-types";
import { appendPackageXmlFilesContent } from "../../../common/utils/xmlUtils";

// Wrapper for sfdx force:source:deploy
export class PackageXmlAppend extends SfdxCommand {
  public static readonly description = `Append one or multiple package.xml files into a single one`;
  public static readonly examples = ["$ sf hardis packagexml append -p package1.xml,package2.xml -o package3.xml"];
  public static readonly requiresProject = false;
  public static readonly requiresUsername = false;
  public static readonly flagsConfig: FlagsConfig = {
    packagexmls: flags.string({
      char: "p",
      description: "package.xml files path (separated by commas)",
    }),
    outputfile: flags.string({
      char: "o",
      description: "package.xml output file",
    }),
    debug: flags.boolean({
      default: false,
      description: "debug",
    }),
    websocket: flags.string({
      description: "websocket",
    }),
  };

  protected packageXmlFiles: string[];
  protected outputFile: string;

  public async run(): Promise<AnyJson> {
    this.packageXmlFiles = this.flags.packagexmls.split(",");
    this.outputFile = this.flags.outputfile;
    await appendPackageXmlFilesContent(this.packageXmlFiles, this.outputFile);
    return { outputPackageXmlFile: this.outputFile };
  }
}
