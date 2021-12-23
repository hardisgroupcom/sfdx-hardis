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
import { countLinesInFile } from "../../../common/utils/filesUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class Toml2Csv extends SfdxCommand {
  public static title = "TOML to CSV";

  public static description = "Split TOML file into distinct CSV files";

  public static examples = [
    "$ sfdx hardis:misc:toml2csv --tomlfile 'D:/clients/toto/V1_full.txt' ",
    "$ sfdx hardis:misc:toml2csv --skiptransfo --tomlfile 'D:/clients/toto/V1_full.txt' ",
    "$ sfdx hardis:misc:toml2csv --skiptransfo --tomlfile 'D:/clients/toto/V1_full.txt' --outputdir 'C:/tmp/rrrr'",
  ];

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
  protected rootConfigDirectory: string;
  protected outputDir: string;
  protected skipTransfo = false;

  protected spinner: any;
  protected inputFileSeparator: string;
  protected outputFileSeparator: string;
  protected tomlSectionsFileWriters: any = {};
  protected tomlSectionsErrorsFileWriters: any = {};
  protected loadedTranscos: any = {};

  protected csvFiles: string[] = [];

  protected stats = {
    sectionLinesNb: 0,
    dataLinesNb: 0,
    emptyLinesNb: 0,
    totalLinesNb: 0,
    dataSuccessLinesNb: 0,
    dataErrorLinesNb: 0,
  };

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    // Collect input parameters
    const tomlFile = this.flags.tomlfile;
    const tomlFileEncoding = this.flags.tomlfileencoding || "utf8";
    this.transfoConfigFile = this.flags.transfoconfig || path.join(path.dirname(tomlFile), "transfoConfig.json");
    this.rootConfigDirectory = path.dirname(this.transfoConfigFile);
    this.outputDir = this.flags.outputdir || path.join(path.dirname(tomlFile), path.parse(tomlFile).name);
    const debugMode = this.flags.debug || false;
    this.skipTransfo = this.flags.skiptransfo || false;

    // Check TOML file is existing
    if (!fs.existsSync(tomlFile)) {
      this.triggerError(`TOML file ${tomlFile} not found`);
    }

    // Read configuration file
    if (!fs.existsSync(this.transfoConfigFile)) {
      this.triggerError(`Mapping/Transco config ${this.transfoConfigFile} not found`);
    }
    this.transfoConfig = JSON.parse(fs.readFileSync(this.transfoConfigFile));

    // Set separators
    this.inputFileSeparator = this.transfoConfig?.inputFile?.separator || ",";
    this.outputFileSeparator = this.transfoConfig?.outputFile?.separator || ",";

    // Create output directory if not existing yet
    await fs.ensureDir(this.outputDir);
    // Empty output dir
    await fs.emptyDir(this.outputDir);
    await fs.ensureDir(path.join(this.outputDir, "errors"));

    uxLog(this, c.cyan(`Generating CSV files from ${c.green(tomlFile)} (encoding ${tomlFileEncoding}) into folder ${c.green(this.outputDir)}`));

    // Start spinner
    this.spinner = ora({ text: `Processing...`, spinner: "moon" }).start();

    // Read TOML file and process lines section by section
    const fileStream = fs.createReadStream(tomlFile, { encoding: "utf8" });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });
    let currentSection = null;
    for await (const line of rl) {
      this.stats.totalLinesNb++;
      if (debugMode) {
        uxLog(this, c.grey(line));
      }
      // Empty line
      if (line.length === 0) {
        this.stats.emptyLinesNb++;
        continue;
      }
      // Section line
      if (line.startsWith("[")) {
        this.stats.sectionLinesNb++;
        currentSection = /\[(.*)\]/gm.exec(line)[1]; // ex: get COMPTES from [COMPTES]
        this.spinner.text = `Processing section ${currentSection} (data lines: ${this.stats.dataLinesNb}, errors: ${this.stats.dataErrorLinesNb})`;
        if (this.tomlSectionsFileWriters[currentSection] == null) {
          this.tomlSectionsFileWriters[currentSection] = await this.createSectionWriteStream(currentSection, false);
          if (!this.skipTransfo) {
            this.tomlSectionsErrorsFileWriters[currentSection] = await this.createSectionWriteStream(currentSection, true);
          }
        }
      }
      // CSV line
      else if (currentSection) {
        this.stats.dataLinesNb++;
        if (this.skipTransfo) {
          // No transformation
          const lineSf = line
            .split(this.inputFileSeparator)
            .map((val) => (this.inputFileSeparator !== this.outputFileSeparator && val.includes(this.outputFileSeparator) ? `"${val}"` : val)) // Add quotes if value contains a separator
            .join(this.outputFileSeparator);
          await this.writeLine(lineSf, this.tomlSectionsFileWriters[currentSection]);
          this.stats.dataSuccessLinesNb ;
        } else {
          // With transformation
          try {
            await this.convertLineToSfThenWrite(currentSection, line);
          } catch (e) {
            // Manage error
            this.stats.dataErrorLinesNb++;
            const lineError =
              line
                .split(this.inputFileSeparator)
                .map((val) => (this.inputFileSeparator !== this.outputFileSeparator && val.includes(this.outputFileSeparator) ? `"${val}"` : val)) // Add quotes if value contains a separator
                .join(this.outputFileSeparator) +
              this.outputFileSeparator +
              `"${e.message.replace(/"/g, "'")}"`;
            await this.writeLine(lineError, this.tomlSectionsErrorsFileWriters[currentSection]);
            e.message;
          }
        }
      } else {
        uxLog(this, c.yellow(`Line without declared section before: skipped (${line})`));
      }
    }

    // Cleaning empty error files
    for (const sectionKey of Object.keys(this.tomlSectionsErrorsFileWriters)) {
      const errStream = this.tomlSectionsErrorsFileWriters[sectionKey];
      if (errStream && errStream.path) {
        const file = errStream.path;
        const lineNb = await countLinesInFile(file);
        if (lineNb === 1) {
          await fs.unlink(file);
        }
      }
    }

    this.spinner.succeed(`File processing complete of ${this.stats.dataLinesNb} data lines (${this.stats.dataErrorLinesNb} in error)`);
    uxLog(this, c.grey("Stats: \n" + JSON.stringify(this.stats, null, 2)));
    const message = `TOML file ${tomlFile} has been split into ${this.csvFiles.length} CSV files in directory ${this.outputDir}`;
    uxLog(
      this,
      c.cyan(`TOML file ${c.green(tomlFile)} has been split into ${c.green(this.csvFiles.length)} CSV files in directory ${c.green(this.outputDir)}`)
    );
    return { outputString: message, csvfiles: this.csvFiles, stats: this.stats };
  }

  // Create output write stream for section
  async createSectionWriteStream(section: string, errMode = false) {
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
      const outputFile = path.join(
        this.outputDir,
        `${errMode ? "errors" + path.sep + "err__" : ""}${this.transfoConfig.entities[section].outputFile.salesforceObjectApiName}___${section}.csv`
      );
      // Init writeStream
      const fileWriteStream = fs.createWriteStream(path.resolve(outputFile), { encoding: "utf8" });
      // Create CSV Header
      let headerLine = this.transfoConfig?.entities[section]?.outputFile?.cols
        .map((colDescription: any) => colDescription.name)
        .join(this.outputFileSeparator);
      if (errMode) {
        headerLine += this.outputFileSeparator + "Error";
      }
      // Initialize with header
      fileWriteStream.write(headerLine + "\n");
      uxLog(this, c.cyan(`- Initialized ${errMode ? "errors" : "output"} CSV file ${c.green(c.bold(outputFile))}`));
      this.csvFiles.push(outputFile);
      return fileWriteStream;
    } else if (errMode === false) {
      // Section has not been described in config file !!
      uxLog(this, c.yellow(`Section ${section} as entity is not described with columns in ${this.transfoConfigFile}`));
      const outputFile = path.join(this.outputDir, "errors", `noconfig__${section}.csv`);
      // Init writeStream
      const fileWriteStream = fs.createWriteStream(path.resolve(outputFile), { encoding: "utf8" });
      uxLog(this, c.cyan(`- Initialized output CSV file ${c.green(c.bold(outputFile))}`));
      this.csvFiles.push(outputFile);
      return fileWriteStream;
    }
  }

  async writeLine(lineSf: string, streamWriter: any) {
    if (lineSf && streamWriter) {
      // Use writeStream. If not able to write, wait for buffer to be available again
      // cf https://stackoverflow.com/a/50456833/7113625
      const ableToWrite = streamWriter.write(`${lineSf}\n`);
      if (!ableToWrite) {
        await new Promise((resolve) => {
          streamWriter.once("drain", resolve);
        });
      }
    }
  }

  // Convert input CSV line into SF Bulk API expected CSV line
  async convertLineToSfThenWrite(section: string, line: string) {
    const lineCols = line.split(this.inputFileSeparator);

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
        const humanInputColPos = i + 1;
        inputCols[humanInputColPos] = lineCols[i] || "";
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
            colVal = this.manageTransformation(colDefinition.transfo, colVal, colDefinition);
          }
          linesSfArray.push(colVal.includes(this.outputFileSeparator) ? `"${colVal}"` : colVal); // Add quotes if value contains output file separator
        } else {
          this.triggerError(c.red(`You must have a correspondance in input cols for output col ${colDefinition}`), false);
        }
      }
      // Col definition is a hardcoded value
      else if (colDefinition.hardcodedValue) {
        linesSfArray.push(
          colDefinition.hardcodedValue.includes(this.outputFileSeparator) ? `"${colDefinition.hardcodedValue}"` : colDefinition.hardcodedValue // Add quotes if value contains output file separator
        );
      }
    }

    // Join line as CSV, as expected by SF Bulk API
    const lineSf = linesSfArray.join(this.outputFileSeparator);
    // Write line with fileWriter
    await this.writeLine(lineSf, this.tomlSectionsFileWriters[section]);
    this.stats.dataSuccessLinesNb++ ;
  }

  // Apply transformations defined in transfoconfig file
  manageTransformation(transfo: any, colVal: any, colDefinition: any) {
    // Date transfo
    if (transfo.type === "date") {
      if (colVal === "") {
        return "";
      }
      if (transfo.addZero && colVal.length === 7) {
        colVal = "0" + colVal;
      }
      const formattedDate = moment(colVal, transfo.from, true).format(transfo.to);
      if (formattedDate === "Invalid date") {
        this.triggerError(`Unable to reformat date ${colVal} for column ${JSON.stringify(colDefinition)}`, false);
      }
      return formattedDate;
    }
    // Enum Transco
    else if (transfo.enum) {
      return this.getTranscoValue(transfo, colVal, colDefinition);
    }
    this.triggerError(`Unknown transfo definition for column: ${JSON.stringify(colDefinition)}`, false);
  }

  // Manage transco value
  getTranscoValue(transfo: any, colVal: string, colDefinition: any) {
    const enumValues = this.getTranscoValues(transfo);
    const transcodedValue = enumValues[colVal] || transfo.default || "";
    if (transcodedValue === "" && colVal !== "") {
      this.triggerError(
        `There should be a matching value for ${colVal} in ${JSON.stringify(enumValues)} for column ${JSON.stringify(colDefinition)}`,
        false
      );
    }
    return transcodedValue;
  }

  // Get enum values
  getTranscoValues(transfo) {
    // Enum config file
    if (transfo.enum) {
      // Check if enum has alredy been loaded in memory
      if (this.loadedTranscos[transfo.enum]) {
        return this.loadedTranscos[transfo.enum];
      }
      // Load enum in memory
      const transcoFile = path.join(this.rootConfigDirectory, "enums", `${transfo.enum}.json`);
      if (!fs.existsSync(transcoFile)) {
        this.triggerError(`Missing transco file ${transcoFile} for enum ${transfo.enum}`, false);
      }
      this.loadedTranscos[transfo.enum] = JSON.parse(fs.readFileSync(transcoFile));
      return this.loadedTranscos[transfo.enum];
    }
    this.triggerError(`Missing transco definition in ${JSON.stringify(transfo)}`, false);
  }

  triggerError(errorMsg: string, fatal = true) {
    if (fatal && this.spinner) {
      this.spinner.fail(errorMsg);
    }
    throw new SfdxError(errorMsg);
  }
}
