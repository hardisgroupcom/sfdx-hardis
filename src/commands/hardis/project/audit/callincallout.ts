/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as csvStringify from 'csv-stringify/lib/sync';
import * as fs from 'fs-extra';
import * as glob from 'glob-promise';
import * as path from 'path';
import * as sortArray from 'sort-array';
import {
  countRegexMatches,
  extractRegexGroups
} from '../../../../common/utils';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class CallInCallOut extends SfdxCommand {
  public static title = 'Login';

  public static description = messages.getMessage('auditCallInCallOut');

  public static examples = ['$ sfdx hardis:project:audit:callouts'];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    debug: flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode')
    })
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  // protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  /* jscpd:ignore-end */

  protected matchResults: any[] = [];

  public async run(): Promise<AnyJson> {
    this.debug = this.flags.debug || false;

    const pattern = '**/*.{cls,trigger}';
    const catchers = [
      {
        type: 'INBOUND',
        subType: 'SOAP',
        regex: /webservice static/gim,
        detail: [
          { name: 'webServiceName', regex: /webservice static (.*?){/gims }
        ]
      },
      {
        type: 'INBOUND',
        subType: 'REST',
        regex: /@RestResource/gim,
        detail: [{ name: 'restResource', regex: /@RestResource\((.*?)\)/gims }]
      },
      {
        type: 'OUTBOUND',
        subType: 'HTTP',
        regex: /new HttpRequest/gim,
        detail: [
          { name: 'endPoint', regex: /setEndpoint\((.*?);/gims },
          { name: "action", regex: /<soapenv:Body><[A-Za-z0-9_-]*:(.*?)>/gims}
        ]
      }
    ];
    const apexFiles = await glob(pattern);
    this.matchResults = [];
    this.ux.log(`Browsing ${apexFiles.length} files`);
    // Loop in files
    for (const file of apexFiles) {
      const fileText = await fs.readFile(file, 'utf8');
      if (fileText.startsWith('hidden') || fileText.includes('@isTest')) {
        continue;
      }
      // Loop on criteria to find matches in this file
      for (const catcher of catchers) {
        await this.catchMatches(catcher, file, fileText);
      }
    }

    // Reformat & sort for results
    const result: any[] = this.matchResults.map((item: any) => {
      return {
        type: item.type,
        subType: item.subType,
        fileName: item.fileName,
        nameSpace: item.fileName.includes('__')
          ? item.fileName.split('__')[0]
          : 'Custom',
        matches: item.matches,
        detail:
          Object.keys(item.detail)
            .map(
              (key: string) =>
                key +
                ': ' +
                item.detail[key]
                  .map(
                    (extractedText: string) =>
                      extractedText
                        .replace(/(\r\n|\n|\r)/gm, '') // Remove new lines from result
                        .replace(/\s+/g, ' ') // Replace multiple whitespaces by single whitespaces
                  )
                  .join(' | ')
            )
            .join(' || ') || ''
      };
    });

    // Sort array
    const resultSorted = sortArray(result, {
      by: ['type', 'subType', 'fileName', 'matches'],
      order: ['asc', 'asc', 'asc', 'desc']
    });

    // Display as table
    const resultsLight = JSON.parse(JSON.stringify(resultSorted));
    console.table(
      resultsLight.map((item: any) => {
        delete item.detail;
        return item;
      })
    );

    // Export into csv & excel file
    const reportFile = path.resolve(
      './hardis-report/sfdx-hardis-callin-callout.csv'
    );
    const reportFileExcel = path.resolve(
      './hardis-report/sfdx-hardis-callin-callout.xls'
    );
    await fs.ensureDir(path.dirname(reportFile));
    const columns = [
      { key: 'type', header: 'IN/OUT' },
      { key: 'subType', header: 'Protocol' },
      { key: 'fileName', header: 'Apex' },
      { key: 'nameSpace', header: 'Namespace' },
      { key: 'matches', header: 'Number'},
      { key: 'detail', header: 'Detail' }
    ];
    const csv = csvStringify(resultSorted, { delimiter: ';', header:true, columns });
    await fs.writeFile(reportFile, csv);
    const excel = csvStringify(resultSorted, { delimiter: '\t', header:true, columns });
    await fs.writeFile(reportFileExcel, excel);
    this.ux.log('[sfdx-hardis] Generated report files:');
    this.ux.log(`[sfdx-hardis] - CSV: ${reportFile}`);
    this.ux.log(`[sfdx-hardis] - XLS: ${reportFileExcel}`);

    // Return an object to be displayed with --json
    return {
      outputString: 'Processed callIns and callOuts audit',
      result: resultSorted,
      reportFile
    };
  }

  // Catch matches in files according to criteria
  public async catchMatches(catcher: any, file: string, fileText: string) {
    if (catcher.regex) {
      // Check if there are matches
      const matches = await countRegexMatches(catcher.regex, fileText);
      if (matches > 0) {
        // If match, extract match details
        const fileName = path.basename(file);
        const detail: any = {};
        for (const detailCrit of catcher.detail) {
          const detailCritVal = await extractRegexGroups(
            detailCrit.regex,
            fileText
          );
          if (detailCritVal.length > 0) {
            detail[detailCrit.name] = detailCritVal;
          }
        }
        const catcherLabel = catcher.regex
          ? `regex ${catcher.regex.toString()}`
          : 'ERROR';
        this.matchResults.push({
          fileName,
          fileText,
          matches,
          type: catcher.type,
          subType: catcher.subType,
          detail,
          catcherLabel
        });
        if (this.debug) {
          this.ux.log(
            `[sfdx-hardis] [${fileName}]: Match [${matches}] occurences of [${catcher.type}/${catcher.name}] with catcher [${catcherLabel}]`
          );
        }
      }
    }
  }
}
