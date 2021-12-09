/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as fs from "fs-extra";
import moment = require("moment");
import ora = require("ora");
import * as path from "path";
import * as readline from "readline";
import { uxLog } from "../../../common/utils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class Toml2Csv extends SfdxCommand {
  public static title = "TOML to CSV";

  public static description = "Split TOML file into distinct CSV files";

  public static examples = ["$ sfdx hardis:misc:toml2csv --tomlfile 'D:/clients/APICIL/00000200_APICIL-CONNECT_T_2021_09_16_4801889.txt' "];

  protected static flagsConfig = {
    tomlfile: flags.string({
      char: "f",
      description: "Input TOML file path",
      required: true,
    }),
    transfoconfig: flags.string({
      char: "t",
      description: "Path to JSON config file for mapping and transformation",
    }),
    skiptransfo: flags.boolean({
      char: "s",
      default: false,
      description: "Do not apply transformation to input data",
    }),
    outputdir: flags.string({
      char: "o",
      description: "Output directory",
    }),
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: flags.string({
      description: messages.getMessage("websocket"),
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  // protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  protected transfoConfig: any = {};
  protected transfoConfigFile: string;
  protected outputDir: string;
  protected skipTransfo = false;

  protected csvFiles: string[] = [];

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    // Collect input parameters
    const tomlFile = this.flags.tomlfile;
    const tomlFileEncoding = this.flags.tomlfileencoding || "utf8";
    this.transfoConfigFile = this.flags.transfoconfig || path.join(path.dirname(tomlFile), "transfoConfig.json");
    this.outputDir = this.flags.outputdir || path.join(path.dirname(tomlFile), path.parse(tomlFile).name);
    const debugMode = this.flags.debug || false;
    this.skipTransfo = this.flags.skiptransfo || false;

    // Check TOML file is existing
    if (!fs.existsSync(tomlFile)) {
      throw new SfdxError(`TOML file ${tomlFile} not found`);
    }

    // Read configuration file
    if (!fs.existsSync(this.transfoConfigFile)) {
      throw new SfdxError(`Mapping/Transco config ${this.transfoConfigFile} not found`);
    }
    this.transfoConfig = JSON.parse(fs.readFileSync(this.transfoConfigFile));

    // Create output directory if not existing yet
    await fs.ensureDir(this.outputDir);
    // Empty output dir
    await fs.emptyDir(this.outputDir);

    uxLog(this, c.cyan(`Generating CSV files from ${tomlFile} (encoding ${tomlFileEncoding}) into folder ${this.outputDir}`));

    // Start spinner
    const spinner = ora({ text: `Processing...`, spinner: "moon" }).start();

    // Read TOML file and process lines section by section
    const fileStream = fs.createReadStream(tomlFile, { encoding: "utf8" });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });
    const tomlSectionsFileWriters = {};
    let currentSection = null;
    for await (const line of rl) {
      if (debugMode) {
        uxLog(this, c.grey(line));
      }
      // Empty line
      if (line.length === 0) {
        continue;
      }
      // Section line
      if (line.startsWith("[")) {
        currentSection = /\[(.*)\]/gm.exec(line)[1]; // ex: get COMPTES from [COMPTES]
        spinner.text = `Processing section ${currentSection}`;
        if (tomlSectionsFileWriters[currentSection] == null) {
          tomlSectionsFileWriters[currentSection] = await this.createSectionWriteStream(currentSection);
        }
      }
      // CSV line
      else if (currentSection) {
        const lineSf = this.skipTransfo
          ? line.split(this.transfoConfig.inputFile.separator || ",").join(this.transfoConfig?.ouputFile?.separator || ",")
          : this.convertLineToSf(currentSection, line);
        if (lineSf && tomlSectionsFileWriters[currentSection]) {
          // Use writeStream. If not able to write, wait for buffer to be available again
          // cf https://stackoverflow.com/a/50456833/7113625
          const ableToWrite = tomlSectionsFileWriters[currentSection].write(`${lineSf}\n`);
          if (!ableToWrite) {
            await new Promise((resolve) => {
              tomlSectionsFileWriters[currentSection].once("drain", resolve);
            });
          }
        }
      }
    }

    spinner.succeed(`File processing complete`);

    const message = `TOML file ${tomlFile} has been split into ${this.csvFiles.length} CSV files in directory ${this.outputDir}`;
    uxLog(
      this,
      c.cyan(`TOML file ${c.green(tomlFile)} has been split into ${c.green(this.csvFiles.length)} CSV files in directory ${c.green(this.outputDir)}`)
    );
    return { outputString: message, csvfiles: this.csvFiles };
  }

  // Create output write stream for section
  async createSectionWriteStream(section: string) {
    // Case when transformation is skipped
    if (this.skipTransfo) {
      const outputFile = path.join(this.outputDir, `${section}.csv`);
      // Init writeStream
      const fileWriteStream = fs.createWriteStream(path.resolve(outputFile), { encoding: "utf8" });
      uxLog(this, c.cyan(`- Initialized output CSV file ${c.green(c.bold(outputFile))}`));
      this.csvFiles.push(outputFile);
      return fileWriteStream;
    }
    // Create writeStream managing transformation
    else if (this.transfoConfig?.entities[section]?.outputFile?.cols) {
      // Create SF Object output file name
      const outputFile = path.join(this.outputDir, `${this.transfoConfig.entities[section].outputFile.salesforceObjectApiName}___${section}.csv`);
      // Init writeStream
      const fileWriteStream = fs.createWriteStream(path.resolve(outputFile), { encoding: "utf8" });
      // Create CSV Header
      const headerLine = this.transfoConfig?.entities[section]?.outputFile?.cols
        .map((colDescription: any) => colDescription.name)
        .join(this.transfoConfig?.ouputFile?.separator || ",");
      // Initialize with header
      fileWriteStream.write(headerLine + "\n");
      uxLog(this, c.cyan(`- Initialized output CSV file ${c.green(c.bold(outputFile))}`));
      this.csvFiles.push(outputFile);
      return fileWriteStream;
    } else {
      uxLog(this, c.yellow(`No output file for ${section} as entity is not described in ${this.transfoConfigFile}`));
    }
  }

  // Convert input CSV line into SF Bulk API expected CSV line
  convertLineToSf(section: string, line: string): string {
    const lineCols = line.split(this.transfoConfig.inputFile.separator);
    if (this.transfoConfig.entities[section]) {
      const linesSfArray = [];

      // convert into input format
      const inputCols: any = {};
      if (this.transfoConfig.entities[section]?.inputFile?.cols) {
        // Case when cols are defined line [ {"Name": 0, "FirstName: 1" ...}]
        for (let i = 0; i < this.transfoConfig.entities[section]?.inputFile?.cols.length; i++) {
          const inputColKey = this.transfoConfig.entities[section].inputFile.cols[i];
          inputCols[inputColKey] = lineCols[i] || "";
        }
      } else {
        // Case when cols are not defined: just use positions
        for (let i = 0; i < lineCols.length; i++) {
          inputCols[i] = lineCols[i] || "";
        }
      }
      // convert into output format
      for (const colDefinition of this.transfoConfig.entities[section].outputFile.cols) {
        // Col definition is the position or the name of a column in input file
        if (colDefinition.inputColKey || colDefinition.inputColKey === 0) {
          if (inputCols[colDefinition.inputColKey] || inputCols[colDefinition.inputColKey] === "" || inputCols[colDefinition.inputColKey] === 0) {
            let colVal = inputCols[colDefinition.inputColKey] || "";
            // Transform if necessary
            if (colVal && colDefinition.transfo) {
              colVal = this.manageTransformation(colDefinition.transfo, colVal);
            }
            linesSfArray.push(colVal);
          } else {
            throw new SfdxError(c.red(`You must have a correspondance in input cols for output col ${colDefinition}`));
          }
        }
        // Col definition is a hardcoded value
        else if (colDefinition.hardcodedValue) {
          linesSfArray.push(colDefinition.hardcodedValue);
        }
      }

      // Join line as CSV, as expected by SF Bulk API
      return linesSfArray.join(this.transfoConfig?.ouputFile?.separator || ",");
    }
    return null;
  }

  // Apply transformations defined in transfoconfig file
  manageTransformation(transfo: any, colVal: any) {
    if (transfo.type === "date") {
      return moment(colVal, transfo.from, true).format(transfo.to);
    }
    uxLog(this, c.yellow(`Unable to format ${colVal} from ${transfo.from} to ${transfo.to}`));
  }
}
