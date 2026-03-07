import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import * as util from 'util';
import * as xml2js from 'xml2js';
import { AnyJson } from '@salesforce/ts-types';
import { uxLog } from '../../../../common/utils/index.js';
import { writeXmlFile } from '../../../../common/utils/xmlUtils.js';
import { t } from '../../../../common/utils/i18n.js';

// The code of this method is awful... it's migrated from sfdx-essentials, written when async / await were not existing ^^
export class FilterXmlContent extends SfCommand<any> {
  public static readonly description = `
## Command Behavior

**Filters the content of Salesforce metadata XML files to remove specific elements, enabling more granular deployments.**

This command addresses a common challenge in Salesforce development: deploying only a subset of metadata from XML files when the target org might not support all elements or when certain elements are not desired. It allows you to define rules in a JSON configuration file to remove unwanted XML nodes.

Key functionalities:

- **Configurable Filtering:** Uses a JSON configuration file (e.g., \`filter-config.json\`) to define which XML elements to remove. Each filter can target folders (\`folders\`) or specific files (\`files\`), and defines XML tags and values to exclude.
- **Wildcard Support:** Supports wildcard patterns in \`exclude_list[].values\` using \`*\` (any sequence) and \`?\` (single character), allowing flexible matching (for example \`SBQQ__*\`).
- **Targeted File Processing:** Processes matching XML files from a specified input folder (defaults to current directory) and writes the filtered content to an output folder.
- **Example Use Cases:** Useful for scenarios like:
  - Removing references to features not enabled in the target org.
  - Stripping out specific profile permissions or field-level security settings.
  - Filtering targeted files only (for example one permissionset) while keeping other files untouched.
  - Cleaning up metadata that is not relevant to a particular deployment.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Configuration Loading:** Reads the \`filter-config.json\` file, which contains an array of \`filters\`. Each filter defines a \`name\`, \`description\`, either \`folders\` or \`files\` (where to apply the filter), \`file_extensions\`, and an \`exclude_list\`.
- **File System Operations:** Copies the input folder to an output folder (if different) to avoid modifying original files directly. It then iterates through either explicitly listed files or files found in configured folders, and applies extension checks before filtering.
- **XML Parsing and Manipulation:** For each matching XML file:
  - It uses \`xml2js.Parser\` to parse the XML content into a JavaScript object.
  - It recursively traverses the JavaScript object, applying the \`filterElement\` function.
  - The \`filterElement\` function checks for \`type_tag\` and \`identifier_tag\` defined in the \`exclude_list\`. If a match is found and the identifier matches one of the \`excludeDef.values\` entries (exact or wildcard), the element is removed from the XML structure.
  - After filtering, it uses \`writeXmlFile\` to write the modified JavaScript object back to the XML file.
- **Logging:** Provides detailed logs about the filtering process, including which files are being processed and which elements are being filtered.
- **Summary Reporting:** Tracks and reports on the files that have been updated due to filtering.
</details>
`;
  public static readonly examples = [
    'sf hardis:project:clean:filter-xml-content -i "./mdapi_output"',
    'sf hardis:project:clean:filter-xml-content -i "retrieveUnpackaged"',
  ];
  public static readonly requiresProject = true;
  public static readonly flags: any = {
    configfile: Flags.string({
      char: 'c',
      description: 'Config JSON file path',
    }),
    inputfolder: Flags.string({
      char: 'i',
      description: 'Input folder (default: "." )',
    }),
    outputfolder: Flags.string({
      char: 'f',
      description: 'Output folder (default: parentFolder + _xml_content_filtered)',
    }),
    debug: Flags.boolean({
      default: false,
      description: 'debug',
    }),
    websocket: Flags.string({
      description: 'websocket',
    }),
  };

  // Input params properties
  public configFile: string;
  public inputFolder: string;
  public outputFolder: string;

  // Internal properties
  public smmryUpdatedFiles = {};
  public smmryResult = { filterResults: {} };

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(FilterXmlContent);
    this.configFile = flags.configfile || './filter-config.json';
    this.inputFolder = flags.inputfolder || '.';
    this.outputFolder =
      flags.outputfolder ||
      './' + path.dirname(this.inputFolder) + '/' + path.basename(this.inputFolder) + '_xml_content_filtered';
    uxLog(
      "log",
      this,
      c.grey(
        `Initialize XML content filtering of ${this.inputFolder}, using ${c.bold(this.configFile)} , into ${this.outputFolder
        }`
      )
    );
    // Read json config file
    const filterConfig = fs.readJsonSync(this.configFile);
    if (flags.debug) {
      uxLog("log", this, c.grey(t('filteringConfigFileContent') + JSON.stringify(filterConfig, null, 2)));
    }

    // Create output folder/empty it if existing
    if (fs.existsSync(this.outputFolder) && this.outputFolder !== this.inputFolder) {
      uxLog("log", this, c.grey(t('emptyOutputFolder') + this.outputFolder));
      fs.emptyDirSync(this.outputFolder);
    } else if (!fs.existsSync(this.outputFolder)) {
      uxLog("log", this, c.grey(t('createOutputFolder') + this.outputFolder));
      fs.mkdirSync(this.outputFolder);
    }

    // Copy input folder to output folder
    if (this.outputFolder !== this.inputFolder) {
      uxLog("other", this, 'Copy in output folder ' + this.outputFolder);
      fs.copySync(this.inputFolder, this.outputFolder);
    }

    const fileFilters = new Map<string, any[]>();

    // Browse filters
    filterConfig.filters.forEach((filter) => {
      uxLog("log", this, c.grey(filter.name + ' (' + filter.description + ')...'));

      const hasFiles = Array.isArray(filter.files) && filter.files.length > 0;
      const hasFolders = Array.isArray(filter.folders) && filter.folders.length > 0;

      // Browse filter files (optional)
      if (hasFiles) {
        filter.files.forEach((singleFile) => {
          if (path.isAbsolute(singleFile)) {
            this.filterFilePath(filter, singleFile, fileFilters);
            return;
          }
          const normalized = singleFile.replace(/\\/g, '/');
          const fullFilePath = path.resolve(this.outputFolder, normalized);
          this.filterFilePath(filter, fullFilePath, fileFilters);
        });
        return;
      }

      // Browse filter folders
      if (hasFolders) {
        filter.folders.forEach((filterFolder) => {
          // Browse folder files
          if (!fs.existsSync(this.outputFolder + '/' + filterFolder)) {
            return;
          }
          const folderFiles = fs.readdirSync(this.outputFolder + '/' + filterFolder);
          folderFiles.forEach((file) => {
            // Build file name
            const fpath = file.replace(/\\/g, '/');
            const fullFilePath = this.outputFolder + '/' + filterFolder + '/' + fpath;
            this.filterFilePath(filter, fullFilePath, fileFilters);
          });
        });
      }
    });

    fileFilters.forEach((filters, fullFilePath) => {
      uxLog("log", this, c.grey('- ' + fullFilePath));
      this.filterXmlFromFile(filters, fullFilePath);
    });

    this.smmryResult.filterResults = this.smmryUpdatedFiles;

    // Display results as JSON
    uxLog("log", this, c.grey(t('filteringResults') + JSON.stringify(this.smmryResult)));
    return {};
  }

  public filterFilePath(filter, fullFilePath: string, fileFilters: Map<string, any[]>) {
    const canonicalFilePath = path.resolve(fullFilePath);
    if (!fs.existsSync(canonicalFilePath)) {
      return;
    }
    const fpath = canonicalFilePath.replace(/\\/g, '/');
    const browsedFileExtension = fpath.substring(fpath.lastIndexOf('.') + 1);
    filter.file_extensions.forEach((filterFileExt) => {
      if (browsedFileExtension === filterFileExt) {
        if (!fileFilters.has(canonicalFilePath)) {
          fileFilters.set(canonicalFilePath, []);
        }
        const fileFilterDefinitions = fileFilters.get(canonicalFilePath);
        if (fileFilterDefinitions != null && !fileFilterDefinitions.includes(filter)) {
          fileFilterDefinitions.push(filter);
        }
      }
    });
  }

  // Filter XML content of the file
  public filterXmlFromFile(filters, file) {
    const parser = new xml2js.Parser();
    const data = fs.readFileSync(file);
    parser.parseString(data, (err2, fileXmlContent) => {
      uxLog("other", this, 'Parsed XML \n' + util.inspect(fileXmlContent, false, null));
      filters.forEach((filter) => {
        Object.keys(fileXmlContent).forEach((eltKey) => {
          fileXmlContent[eltKey] = this.filterElement(fileXmlContent[eltKey], filter, file);
        });
      });
      if (this.smmryUpdatedFiles[file] != null && this.smmryUpdatedFiles[file].updated === true) {
        writeXmlFile(file, fileXmlContent);
        uxLog("log", this, t('updated') + file);
      }
    });
  }

  public filterElement(elementValue, filter, file) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    // Object case
    if (typeof elementValue === 'object') {
      Object.keys(elementValue).forEach((eltKey) => {
        let found = false;
        // Browse filter exclude_list for elementValue
        filter.exclude_list.forEach((excludeDef) => {
          if (excludeDef.type_tag === eltKey) {
            // Found matching type tag
            found = true;
            uxLog("other", this, '\nFound type: ' + eltKey);
            uxLog("other", this, JSON.stringify(elementValue[eltKey], null, 2));
            // Filter type values
            const typeValues = elementValue[eltKey];
            const newTypeValues: any[] = [];
            typeValues.forEach((typeItem) => {
              const identifierValue = typeItem[excludeDef.identifier_tag];
              const identifierText = Array.isArray(identifierValue) ? identifierValue[0] : identifierValue;
              // If identifier tag not found, do not filter and avoid crash
              if (
                identifierText != null &&
                this.matchesAnyPattern(String(identifierText), excludeDef.values || [])
              ) {
                uxLog("other", this, '----- filtered ' + identifierText);
                if (self.smmryUpdatedFiles[file] == null) {
                  self.smmryUpdatedFiles[file] = { updated: true, excluded: {} };
                }
                if (self.smmryUpdatedFiles[file].excluded[excludeDef.type_tag] == null) {
                  self.smmryUpdatedFiles[file].excluded[excludeDef.type_tag] = [];
                }
                self.smmryUpdatedFiles[file].excluded[excludeDef.type_tag].push(identifierText);
              } else {
                uxLog("other", this, '--- kept ' + identifierText);
                newTypeValues.push(typeItem);
              }
            });
            elementValue[eltKey] = newTypeValues;
          }
        });
        if (!found) {
          elementValue[eltKey] = self.filterElement(elementValue[eltKey], filter, file);
        }
      });
    } else if (Array.isArray(elementValue)) {
      const newElementValue: any[] = [];
      elementValue.forEach((element) => {
        element = self.filterElement(element, filter, file);
        newElementValue.push(element);
      });
      elementValue = newElementValue;
    }
    return elementValue;
  }

  public matchesAnyPattern(value: string, patterns: string[]): boolean {
    return patterns.some((pattern) => {
      return this.matchesPattern(value, pattern)
    });
  }

  public matchesPattern(value: string, pattern: string): boolean {
    if (pattern == null) {
      return false;
    }
    if (!pattern.includes('*') && !pattern.includes('?')) {
      return value === pattern;
    }
    const escaped = pattern.replace(/\*/g, '.*').replace(/\?/g, '.');
    const regex = new RegExp(`^${escaped}$`);
    return regex.test(value);
  }
}
