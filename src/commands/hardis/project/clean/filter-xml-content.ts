import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import * as util from 'util';
import * as xml2js from 'xml2js';
import { AnyJson } from '@salesforce/ts-types';
import { uxLog } from '../../../../common/utils/index.js';
import { writeXmlFile } from '../../../../common/utils/xmlUtils.js';

// The code of this method is awful... it's migrated from sfdx-essentials, written when async / await were not existing ^^
export class FilterXmlContent extends SfCommand<any> {
  public static readonly description = `Filter content of metadatas (XML) in order to be able to deploy only part of them on an org (See [Example configuration](https://github.com/nvuillam/sfdx-essentials/blob/master/examples/filter-xml-content-config.json))

When you perform deployments from one org to another, the features activated in the target org may not fit the content of the sfdx/metadata files extracted from the source org.

You may need to filter some elements in the XML files, for example in the Profiles

This script requires a filter-config.json file`;
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
      char: 'o',
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
      this,
      c.cyan(
        `Initialize XML content filtering of ${this.inputFolder}, using ${c.bold(this.configFile)} , into ${this.outputFolder
        }`
      )
    );
    // Read json config file
    const filterConfig = fs.readJsonSync(this.configFile);
    if (flags.debug) {
      uxLog(this, c.grey('Filtering config file content:\n' + JSON.stringify(filterConfig, null, 2)));
    }

    // Create output folder/empty it if existing
    if (fs.existsSync(this.outputFolder) && this.outputFolder !== this.inputFolder) {
      uxLog(this, c.grey('Empty output folder ' + this.outputFolder));
      fs.emptyDirSync(this.outputFolder);
    } else if (!fs.existsSync(this.outputFolder)) {
      uxLog(this, c.grey('Create output folder ' + this.outputFolder));
      fs.mkdirSync(this.outputFolder);
    }

    // Copy input folder to output folder
    if (this.outputFolder !== this.inputFolder) {
      uxLog(this, 'Copy in output folder ' + this.outputFolder);
      fs.copySync(this.inputFolder, this.outputFolder);
    }

    // Browse filters
    filterConfig.filters.forEach((filter) => {
      uxLog(this, c.grey(filter.name + ' (' + filter.description + ')...'));
      // Browse filter folders
      filter.folders.forEach((filterFolder) => {
        // Browse folder files
        if (!fs.existsSync(this.outputFolder + '/' + filterFolder)) {
          return;
        }
        const folderFiles = fs.readdirSync(this.outputFolder + '/' + filterFolder);
        folderFiles.forEach((file) => {
          // Build file name
          const fpath = file.replace(/\\/g, '/');
          const browsedFileExtension = fpath.substring(fpath.lastIndexOf('.') + 1);
          filter.file_extensions.forEach((filterFileExt) => {
            if (browsedFileExtension === filterFileExt) {
              // Found a matching file, process it
              const fullFilePath = this.outputFolder + '/' + filterFolder + '/' + fpath;
              uxLog(this, c.grey('- ' + fullFilePath));
              this.filterXmlFromFile(filter, fullFilePath);
            }
          });
        });
      });
    });
    this.smmryResult.filterResults = this.smmryUpdatedFiles;

    // Display results as JSON
    uxLog(this, c.grey('Filtering results:' + JSON.stringify(this.smmryResult)));
    return {};
  }

  // Filter XML content of the file
  public filterXmlFromFile(filter, file) {
    const parser = new xml2js.Parser();
    const data = fs.readFileSync(file);
    parser.parseString(data, (err2, fileXmlContent) => {
      uxLog(this, 'Parsed XML \n' + util.inspect(fileXmlContent, false, null));
      Object.keys(fileXmlContent).forEach((eltKey) => {
        fileXmlContent[eltKey] = this.filterElement(fileXmlContent[eltKey], filter, file);
      });
      if (this.smmryUpdatedFiles[file] != null && this.smmryUpdatedFiles[file].updated === true) {
        writeXmlFile(file, fileXmlContent);
        uxLog(this, 'Updated ' + file);
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
            uxLog(this, '\nFound type: ' + eltKey);
            uxLog(this, elementValue[eltKey]);
            // Filter type values
            const typeValues = elementValue[eltKey];
            const newTypeValues: any[] = [];
            typeValues.forEach((typeItem) => {
              // If identifier tag not found, do not filter and avoid crash
              if (
                typeItem[excludeDef.identifier_tag] &&
                (excludeDef.values.includes(typeItem[excludeDef.identifier_tag]) ||
                  excludeDef.values.includes(typeItem[excludeDef.identifier_tag][0]))
              ) {
                uxLog(this, '----- filtered ' + typeItem[excludeDef.identifier_tag]);
                if (self.smmryUpdatedFiles[file] == null) {
                  self.smmryUpdatedFiles[file] = { updated: true, excluded: {} };
                }
                if (self.smmryUpdatedFiles[file].excluded[excludeDef.type_tag] == null) {
                  self.smmryUpdatedFiles[file].excluded[excludeDef.type_tag] = [];
                }
                self.smmryUpdatedFiles[file].excluded[excludeDef.type_tag].push(typeItem[excludeDef.identifier_tag][0]);
              } else {
                uxLog(this, '--- kept ' + typeItem[excludeDef.identifier_tag]);
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
}
