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
    "$ NODE_OPTIONS=--max_old_space_size=9096 sfdx hardis:misc:toml2csv --skiptransfo --tomlfile './input/V1.txt' --outputdir './output' --filtersections 'COMPTES,SOUS'",
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
    filtersections: flags.array({
      char: "l",
      description: "List of sections to process (if not set, all sections will be processed)",
      default: [],
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
  protected filterSections = [];
  protected doFilterSections = false;

  protected spinner: any;
  protected inputFileSeparator: string;
  protected outputFileSeparator: string;
  protected tomlSectionsFileWriters: any = {};
  protected tomlSectionsErrorsFileWriters: any = {};
  protected loadedTranscos: any = {};

  protected csvFiles: string[] = [];

  protected sectionLineIds: any = {};
  protected sectionLines: any = {};

  protected stats = {
    sectionLinesNb: 0,
    dataLinesNb: 0,
    emptyLinesNb: 0,
    totalLinesNb: 0,
    dataSuccessLinesNb: 0,
    dataErrorLinesNb: 0,
    dataFilteredLinesNb: 0,
    dataDuplicatesNb: 0,
    sections: {},
  };

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    // Collect input parameters
    const tomlFile = this.flags.tomlfile;
    const tomlFileEncoding = this.flags.tomlfileencoding || "utf8";
    this.transfoConfigFile = this.flags.transfoconfig || path.join(process.cwd(), "transfoConfig.json");
    this.rootConfigDirectory = path.dirname(this.transfoConfigFile);
    this.outputDir = this.flags.outputdir || path.join(process.cwd(), path.parse(tomlFile).name);
    const debugMode = this.flags.debug || false;
    this.skipTransfo = this.flags.skiptransfo || false;
    this.filterSections = this.flags.filtersections || [];
    this.doFilterSections = this.filterSections.length > 0;

    // Check TOML file is existing
    if (!fs.existsSync(tomlFile)) {
      this.triggerError(`TOML file ${tomlFile} not found`);
    }

    // Read configuration file
    if (!fs.existsSync(this.transfoConfigFile)) {
      this.triggerError(`Mapping/Transco config ${this.transfoConfigFile} not found`);
    }
    const transfoConfigInit = JSON.parse(fs.readFileSync(this.transfoConfigFile));
    this.transfoConfig = this.completeTransfoConfig(transfoConfigInit);

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
        if (this.doFilterSections && !this.filterSections.includes(currentSection)) {
          continue;
        }
        this.spinner.text =
          `Processing section ${currentSection} (data lines: ${this.stats.dataLinesNb},` +
          ` errors: ${this.stats.dataErrorLinesNb}, filtered: ${this.stats.dataFilteredLinesNb})`;
        // Init section variables
        this.stats.sections[currentSection] = this.stats.sections[currentSection] || {
          dataLinesNb: 0,
          dataSuccessLinesNb: 0,
          dataErrorLinesNb: 0,
          dataFilteredLinesNb: 0,
          dataFilterErrorsNb: 0,
          dataDuplicatesNb: this.transfoConfig?.entities[currentSection]?.removeDuplicates ? 0 : null,
        };
        this.sectionLineIds[currentSection] = [];
        this.sectionLines[currentSection] = this.sectionLines[currentSection] || [];
        // Init section files writeStreams
        if (this.tomlSectionsFileWriters[currentSection] == null) {
          this.tomlSectionsFileWriters[currentSection] = await this.createSectionWriteStream(currentSection, false);
          if (!this.skipTransfo) {
            this.tomlSectionsErrorsFileWriters[currentSection] = await this.createSectionWriteStream(currentSection, true);
          }
        }
      }
      // CSV line
      else if (currentSection) {
        if (this.doFilterSections && !this.filterSections.includes(currentSection)) {
          continue;
        }
        this.stats.dataLinesNb++;
        this.stats.sections[currentSection].dataLinesNb++;
        const lineSplit = line.split(this.inputFileSeparator);
        // Check if line has to be filtered
        let filtered = false;
        if (this.transfoConfig?.entities[currentSection]?.filters) {
          for (const filter of this.transfoConfig?.entities[currentSection]?.filters) {
            if (!this.checkFilter(filter, lineSplit, currentSection)) {
              filtered = true;
              break;
            }
          }
        }
        if (filtered) {
          this.stats.dataFilteredLinesNb++;
          this.stats.sections[currentSection].dataFilteredLinesNb++;
        }
        if (this.skipTransfo) {
          // Without transformation
          if (!filtered) {
            const lineSf = lineSplit
              .map((val) => (this.inputFileSeparator !== this.outputFileSeparator ? this.formatCsvCell(val) : val)) // Add quotes if value contains a separator
              .join(this.outputFileSeparator);
            if (this.checkNotDuplicate(currentSection, lineSf)) {
              await this.writeLine(lineSf, this.tomlSectionsFileWriters[currentSection]);
              this.addLineInCache(currentSection, lineSplit, lineSf);
              this.stats.sections[currentSection].dataSuccessLinesNb++;
              this.stats.dataSuccessLinesNb++;
            }
          }
        } else {
          // With transformation
          try {
            await this.convertLineToSfThenWrite(currentSection, lineSplit);
          } catch (e) {
            // Manage error
            this.stats.dataErrorLinesNb++;
            this.stats.sections[currentSection].dataErrorLinesNb++;
            const lineError =
              line
                .split(this.inputFileSeparator)
                .map((val) => (this.inputFileSeparator !== this.outputFileSeparator ? this.formatCsvCell(val) : val)) // Add quotes if value contains a separator
                .join(this.outputFileSeparator) +
              this.outputFileSeparator +
              `"${e.message.replace(/"/g, "'")}"`;
            if (this.checkNotDuplicate(currentSection, lineError)) {
              await this.writeLine(lineError, this.tomlSectionsErrorsFileWriters[currentSection]);
              this.addLineInCache(currentSection, lineSplit, lineError);
            }
            uxLog(this, c.red(e.message));
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

    // Stop spinner
    this.spinner.succeed(`File processing complete of ${this.stats.dataLinesNb} data lines (${this.stats.dataErrorLinesNb} in error)`);

    // Manage file copy to data workspace folders
    for (const sectionKey of Object.keys(this.transfoConfig.entities)) {
      const sectionData = this.transfoConfig.entities[sectionKey];
      if (sectionData?.outputFile?.copyFilePath && this.tomlSectionsFileWriters[sectionKey]) {
        if (fs.existsSync(sectionData.outputFile.copyFilePath)){
          await fs.unlink(sectionData.outputFile.copyFilePath);
        }
        if (fs.existsSync(this.tomlSectionsFileWriters[sectionKey].path)){
          await fs.copy(this.tomlSectionsFileWriters[sectionKey].path,sectionData.outputFile.copyFilePath);
          uxLog(this,c.grey(`- copied ${this.tomlSectionsFileWriters[sectionKey].path} to ${sectionData.outputFile.copyFilePath}`))
        }
      }
    }

    // Display summary results
    uxLog(this, c.grey("Stats: \n" + JSON.stringify(this.stats, null, 2)));
    for (const section of Object.keys(this.stats.sections)) {
      const sectionStats = this.stats.sections[section];
      if (sectionStats.dataLinesNb > 0) {
        uxLog(this, c.grey(`[${section}] kept ${sectionStats.dataSuccessLinesNb} entries on ${sectionStats.dataLinesNb}`));
      }
    }
    uxLog(this, c.grey(`[TOTAL] kept ${this.stats.dataSuccessLinesNb} entries on ${this.stats.dataLinesNb}`));
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
      uxLog(this, c.cyan(`- Initialized default output CSV file ${c.green(c.bold(outputFile))}`));
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
  async convertLineToSfThenWrite(section: string, lineSplit: string[]) {
    const linesSfArray = [];

    // convert into input format
    const inputCols: any = {};
    if (this.transfoConfig.entities[section]?.inputFile?.cols) {
      // Case when cols are defined line [ {"Name": 0, "FirstName: 1" ...}]
      for (let i = 0; i < this.transfoConfig.entities[section]?.inputFile?.cols.length; i++) {
        const inputColKey = this.transfoConfig.entities[section].inputFile.cols[i];
        inputCols[inputColKey] = lineSplit[i] || "";
      }
    } else {
      // Case when cols are not defined: just use positions
      for (let i = 0; i < lineSplit.length; i++) {
        const humanInputColPos = i + 1;
        inputCols[humanInputColPos] = lineSplit[i] || "";
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
          linesSfArray.push(colVal); // Add quotes if value contains output file separator
        } else {
          this.triggerError(c.red(`You must have a correspondance in input cols for output col ${colDefinition}`), false);
        }
      }
      // Col definition is a hardcoded value
      else if (colDefinition.hardcodedValue) {
        linesSfArray.push(colDefinition.hardcodedValue);
      }
      // Col definition is a concatenated value
      else if (colDefinition.concat) {
        const concatenatedValue = colDefinition.concat
          .map((concatColName) => {
            const colNamePosition = this.transfoConfig?.entities[section]?.outputFile?.colOutputPositions?.indexOf(concatColName);
            if (colNamePosition === null || colNamePosition < 0) {
              this.triggerError(
                `Concat error: Unable to find output field "${concatColName}" in ${JSON.stringify(
                  this.transfoConfig.entities[section].outputFile.colOutputPositions
                )}`,
                false
              );
            }
            const colNameValue = linesSfArray[colNamePosition];
            return colNameValue;
          })
          .join(" ");
        linesSfArray.push(concatenatedValue);
      }
    }

    // Join line as CSV, as expected by SF Bulk API
    const lineSf = linesSfArray.map((val) => this.formatCsvCell(val)).join(this.outputFileSeparator);
    // Write line with fileWriter
    await this.writeLine(lineSf, this.tomlSectionsFileWriters[section]);
    this.stats.sections[section].dataSuccessLinesNb++;
    this.stats.dataSuccessLinesNb++;
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
      // Check if enum has already been loaded in memory
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

  checkFilter(filter, lineSplit, currentSection) {
    let checkRes: boolean | null = false;
    try {
      checkRes =
        filter.type === "date"
          ? this.checkFilterDate(filter, lineSplit)
          : filter.type === "parentId"
          ? this.checkFilterParentId(filter, lineSplit)
          : filter.type === "colValue"
          ? this.checkFilterColValue(filter, lineSplit)
          : null;
      if (checkRes === null) {
        throw Error("Unknown filter type " + JSON.stringify(filter));
      }
    } catch (e) {
      this.stats.sections[currentSection].dataFilterErrorsNb++;
      return filter.keepIfFilterCrash === true;
    }
    return checkRes;
  }

  checkFilterDate(filter, lineSplit) {
    const dateStart = moment(filter.date, filter.dateFormat, true);
    const colValue = moment(lineSplit[filter.colNumber - 1], filter.colDateFormat, true);
    const res =
      filter.typeDtl === "higherThan"
        ? colValue.isAfter(dateStart, "day")
        : filter.typeDtl === "lowerThan"
        ? colValue.isBefore(dateStart, "day")
        : colValue.isSame(dateStart, "day");
    return res;
  }

  checkFilterParentId(filter, lineSplit) {
    const colValue = lineSplit[filter.idColNumber - 1];
    const res = (this.sectionLineIds[filter.parentSection] || []).includes(colValue);
    return res;
  }

  checkFilterColValue(filter, lineSplit) {
    const colValue = lineSplit[filter.idColNumber - 1];
    const res = colValue === filter.value;
    return res;
  }

  addLineInCache(currentSection, lineSplit, lineWrite) {
    if (this.transfoConfig?.entities[currentSection]?.idColNumber) {
      const lineId = lineSplit[this.transfoConfig.entities[currentSection].idColNumber - 1];
      this.sectionLineIds[currentSection].push(lineId);
    }
    if (this.transfoConfig?.entities[currentSection]?.removeDuplicates) {
      this.sectionLines[currentSection].push(lineWrite);
    }
  }

  checkNotDuplicate(currentSection, lineWrite) {
    if (this.transfoConfig?.entities[currentSection]?.removeDuplicates) {
      const isDuplicate = this.sectionLines[currentSection].includes(lineWrite);
      if (isDuplicate) {
        this.stats.dataDuplicatesNb++;
        this.stats.sections[currentSection].dataDuplicatesNb++;
        return false;
      }
      return true;
    }
    return true;
  }

  completeTransfoConfig(transfoConfig: any) {
    for (const section of Object.keys(transfoConfig?.entities || [])) {
      if (transfoConfig.entities[section]?.outputFile?.cols) {
        const colOutputPositions = transfoConfig.entities[section].outputFile.cols.map((colConfig) => colConfig.name);
        transfoConfig.entities[section].outputFile.colOutputPositions = colOutputPositions;
      }
    }
    return transfoConfig;
  }

  triggerError(errorMsg: string, fatal = true) {
    if (fatal && this.spinner) {
      this.spinner.fail(errorMsg);
    }
    throw new SfdxError(errorMsg);
  }

  formatCsvCell(cellVal: string) {
    if (cellVal.includes('"')) {
      cellVal = cellVal.replace(/"/g, `""`);
    }
    if (cellVal.includes(this.outputFileSeparator)) {
      cellVal = `"${cellVal}"`;
    }
    return cellVal;
  }
}
