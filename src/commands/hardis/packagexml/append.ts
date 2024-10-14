import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { AnyJson } from "@salesforce/ts-types";
import { appendPackageXmlFilesContent } from "../../../common/utils/xmlUtils.js";

export class PackageXmlAppend extends SfCommand<any> {
  public static readonly description = `Append one or multiple package.xml files into a single one`;
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
