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

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    // Collect input parameters
    const tomlFile = this.flags.tomlfile;
    const tomlFileEncoding = this.flags.tomlfileencoding || "utf8";
    const transfoConfigFile = this.flags.transfoconfig || path.join(path.dirname(tomlFile), "transfoConfig.json");
    const outputDir = this.flags.outputdir || path.join(path.dirname(tomlFile), path.parse(tomlFile).name);
    const debugMode = this.flags.debug || false;

    // Check TOML file is existing
    if (!fs.existsSync(tomlFile)) {
      throw new SfdxError(`TOML file ${tomlFile} not found`);
    }

    // Read configuration file
    if (!fs.existsSync(transfoConfigFile)) {
      throw new SfdxError(`Mapping/Transco config ${transfoConfigFile} not found`);
    }
    this.transfoConfig = JSON.parse(fs.readFileSync(transfoConfigFile));

    // Create output directory if not existing yet
    await fs.ensureDir(outputDir);
    // Empty output dir
    await fs.emptyDir(outputDir);

    uxLog(this, c.cyan(`Generating CSV files from ${tomlFile} (encoding ${tomlFileEncoding}) into folder ${outputDir}`));

    // Start spinner
    const spinner = ora({ text: `Processing...`, spinner: "moon" }).start();

    // Read TOML file and process lines section by section
    const fileStream = fs.createReadStream(tomlFile, { encoding: "utf8" });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });
    const tomlSections = {};
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
        if (tomlSections[currentSection] == null) {
          tomlSections[currentSection] = [];
        }
      }
      // CSV line
      else if (currentSection) {
        const lineSf = this.convertLineToSf(currentSection, line);
        if (lineSf) {
          tomlSections[currentSection].push(lineSf);
        }
      }
    }

    spinner.succeed(`File processing complete`);
    uxLog(this, c.cyan(`Generating output CSV files...`));

    // Generate output files
    const csvFiles = [];
    for (const section of Object.keys(tomlSections)) {
      if (this.transfoConfig?.entities[section]?.outputFile?.cols) {
        // Create SF Object output file name
        const outputFile = path.join(outputDir, `${this.transfoConfig.entities[section].outputFile.salesforceObjectApiName}___${section}.csv`);
        // Create CSV Header
        const headerLine = this.transfoConfig?.entities[section]?.outputFile?.cols
          .map((colDescription: any) => colDescription.name)
          .join(this.transfoConfig?.ouputFile?.separator || ",");
        // Create text and write file
        const sectionFileLines = headerLine + "\n" + tomlSections[section].join("\n") + "\n";
        await fs.writeFile(outputFile, sectionFileLines, "utf8");
        csvFiles.push(outputFile);
        uxLog(this, c.cyan(`- Generated output CSV file ${c.green(c.bold(outputFile))}`));
      } else {
        uxLog(this, c.yellow(`No output file for ${section} as entity is not described in ${transfoConfigFile}`));
      }
    }

    const message = `TOML file ${tomlFile} has been split into ${csvFiles.length} CSV files in directory ${outputDir}`;
    uxLog(
      this,
      c.cyan(`TOML file ${c.green(tomlFile)} has been split into ${c.green(csvFiles.length)} CSV files in directory ${c.green(outputDir)}`)
    );
    return { outputString: message, csvfiles: csvFiles };
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
              colVal = this.manageTransformation(colDefinition.transfo,colVal)
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
  manageTransformation(transfo:any, colVal:any) {
    if (transfo.type === "date") {
      return moment(colVal, transfo.from,true).format(transfo.to);
    }
    uxLog(this,c.yellow(`Unable to format ${colVal} from ${transfo.from} to ${transfo.to}`));
  }
}
