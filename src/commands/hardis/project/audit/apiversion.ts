/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import { glob } from 'glob';
import sortArray from 'sort-array';
import { catchMatches, generateReports, uxLog, uxLogTable } from '../../../../common/utils/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

import { GLOB_IGNORE_PATTERNS } from '../../../../common/utils/projectUtils.js';

export default class CallInCallOut extends SfCommand<any> {
  public static title = 'Audit Metadatas API Version';

  public static description = `This command identifies metadata with an apiVersion lower than the value specified in the --minimumapiversion parameter.

  It can also update the apiVersion to a specific value:
  - When --fix parameter is provided (updates to minimumapiversion)
  - When --newapiversion is specified (updates to that version)

  Example to handle [ApexClass / Trigger & ApexPage mandatory version upgrade](https://help.salesforce.com/s/articleView?id=sf.admin_locales_update_api.htm&type=5) :
   
   \`sf hardis:project:audit:apiversion --metadatatype ApexClass,ApexTrigger,ApexPage --minimumapiversion 45 --newapiversion 50\`
  `

  public static examples = [
    '$ sf hardis:project:audit:apiversion',
    '$ sf hardis:project:audit:apiversion --metadatatype ApexClass,ApexTrigger,ApexPage --minimumapiversion 45',
    '$ sf hardis:project:audit:apiversion --metadatatype ApexClass,ApexTrigger,ApexPage --minimumapiversion 45 --fix',
    '$ sf hardis:project:audit:apiversion --metadatatype ApexClass,ApexTrigger,ApexPage --minimumapiversion 45 --newapiversion 50'
  ];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    minimumapiversion: Flags.integer({
      char: 'm',
      default: 20,
      description: messages.getMessage('minimumApiVersion'),
    }),
    failiferror: Flags.boolean({
      char: 'f',
      default: false,
      description: messages.getMessage('failIfError'),
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    metadatatype: Flags.string({
      description: 'Metadata Types to fix. Comma separated. Supported Metadata types: ApexClass, ApexTrigger, ApexPage'
    }),
    fix: Flags.boolean({
      // can't use "f", already use for failiferror
      default: false,
      description: 'Automatically update API versions in files that are below the minimum version threshold to match the minimum version',
    }),
    newapiversion: Flags.integer({
      char: 'n',
      description: 'Define an API version value to apply when updating files',
    }),
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected matchResults: any[] = [];

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CallInCallOut);
    const minimumApiVersion = flags.minimumapiversion || false;
    const failIfError = flags.failiferror || false;
    const newApiVersion = flags.newapiversion;
    // Apply fixes if either fix flag is present or a new API version is specified
    const shouldFix = flags.fix || (newApiVersion !== undefined);
    const fixApiVersion = newApiVersion || minimumApiVersion;
    const metadataType = flags.metadatatype || '';

    const fixAllowedExtensions = {
      "ApexClass": "cls",
      "ApexTrigger": "trigger",
      "ApexPage": "page",
    };
    const fixAllowedMetadataTypes = Object.keys(fixAllowedExtensions);

    const fixTargetedMetadataTypes = metadataType.trim() === '' ? [] : (metadataType || '').replace(/\s+/g, '').split(',');
    const fixInvalidMetadataTypes = fixTargetedMetadataTypes.filter(value => !fixAllowedMetadataTypes.includes(value));
    if (fixTargetedMetadataTypes.length > 0 && fixInvalidMetadataTypes.length > 0 && shouldFix) {
      uxLog(
        "warning",
        this,
        c.yellow(
          `[sfdx-hardis] WARNING: --fix Invalid Metadata Type(s) found:  ${c.bold(
            fixInvalidMetadataTypes.join(', ')
          )}. Only ${c.bold(
            fixAllowedMetadataTypes.join(', ')
          )} Metadata Types are allowed for the fix.`
        )
      );
      if (failIfError) {
        throw new SfError(
          c.red(
            `[sfdx-hardis] WARNING: --fix Invalid Metadata Type(s) found:  ${c.bold(
              fixInvalidMetadataTypes.join(', ')
            )}. Only ${c.bold(
              fixAllowedMetadataTypes.join(', ')
            )} Metadata Types are allowed for the fix.`
          )
        );
      }
    }

    // Metadata Type Extensions to fix
    const fixTargetedMetadataTypesExtensions = fixTargetedMetadataTypes.map(type => fixAllowedExtensions[type])
    const fixTargetedMetadataTypesPattern = new RegExp(`\\.(${fixTargetedMetadataTypesExtensions.join('|')})-meta\\.xml$`);

    let pattern = '**/*.xml';
    if (fixTargetedMetadataTypes.length > 0) {
      // Check if there's only one extension type
      if (fixTargetedMetadataTypesExtensions.length === 1) {
        pattern = `**/*.${fixTargetedMetadataTypesExtensions[0]}-meta.xml`;
      } else {
        pattern = `**/*.{${fixTargetedMetadataTypesExtensions.join(',')}}-meta.xml`;
      }
    }

    const catchers = [
      {
        type: 'apiVersion',
        subType: '',
        regex: /<apiVersion>(.*?)<\/apiVersion>/gims,
        detail: [{ name: 'apiVersion', regex: /<apiVersion>(.*?)<\/apiVersion>/gims }],
        fixed: false,
      },
    ];
    const xmlFiles = await glob(pattern, { ignore: GLOB_IGNORE_PATTERNS });
    this.matchResults = [];
    uxLog("other", this, `Browsing ${xmlFiles.length} files`);
    // Loop in files
    for (const file of xmlFiles) {
      try {
        const fileText = await fs.readFile(file, 'utf8');
        // Update ApiVersion on file
        let fixed = false;
        if (shouldFix && fixTargetedMetadataTypes.length > 0 && fixTargetedMetadataTypesPattern.test(file)) {
          const apiVersionMatch = fileText.match(/<apiVersion>(.*?)<\/apiVersion>/);
          if (apiVersionMatch && apiVersionMatch[1]) {
            const currentApiVersion = parseFloat(apiVersionMatch[1]);
            if (currentApiVersion < minimumApiVersion) {
              const updatedContent = fileText.replace(/<apiVersion>(.*?)<\/apiVersion>/, `<apiVersion>${fixApiVersion}.0</apiVersion>`);
              await fs.promises.writeFile(file, updatedContent, 'utf-8');
              fixed = true;
              uxLog("other", this, `Updated apiVersion in file: ${file} from ${currentApiVersion}.0 to ${fixApiVersion}.0`);
            }
          }
        }
        // Loop on criteria to find matches in this file
        for (const catcher of catchers) {
          const catcherMatchResults = await catchMatches(catcher, file, fileText, this);
          // Add the "fixed" flag
          const enrichedResults = catcherMatchResults.map(result => ({
            ...result,
            fixed,
          }));
          this.matchResults.push(...enrichedResults);
        }
      } catch (error) {
        if (error instanceof Error) {
          uxLog("warning", this, c.yellow(`Error processing file ${file}: ${error.message}`));
        } else {
          uxLog("warning", this, c.yellow(`Error processing file ${file}: ${String(error)}`));
        }
      }
    }
    // Format result
    const result: any[] = this.matchResults.map((item: any) => {
      return {
        type: item.type,
        fileName: item.fileName,
        nameSpace: item.fileName.includes('__') ? item.fileName.split('__')[0] : 'Custom',
        apiVersion: parseFloat(item.detail['apiVersion']),
        valid: parseFloat(item.detail['apiVersion']) >= (minimumApiVersion || 100) ? 'yes' : 'no',
        fixed: item.fixed ? 'yes' : 'no',
      };
    });
    // Sort array
    const resultSorted = sortArray(result, {
      by: ['type', 'subType', 'fileName'],
      order: ['asc', 'asc', 'asc'],
    });

    // Display as table
    uxLog("action", this, c.cyan(`Found ${c.bold(resultSorted.length)} metadata files with API Version.`));
    const resultsLight = JSON.parse(JSON.stringify(resultSorted));
    uxLogTable(this,
      resultsLight.map((item: any) => {
        delete item.detail;
        return item;
      })
    );


    const numberOfInvalid = result.filter((res: any) => res.valid === 'no').length;
    const numberOfValid = result.length - numberOfInvalid;
    if (numberOfInvalid > 0) {
      uxLog(
        "warning",
        this,
        c.yellow(
          `WARNING: Your sources contain ${c.bold(
            numberOfInvalid
          )} metadata files with API Version lesser than ${c.bold(minimumApiVersion)}`
        )
      );
      if (failIfError) {
        throw new SfError(
          c.red(`${c.bold(numberOfInvalid)} metadata files with wrong API version detected`)
        );
      }
    } else {
      uxLog(
        "success",
        this,
        c.green(
          `SUCCESS: Your sources contain ${c.bold(
            numberOfValid
          )} metadata files with API Version superior to ${c.bold(minimumApiVersion)}`
        )
      );
    }

    // Generate output files
    const columns = [
      { key: 'type', header: 'IN/OUT' },
      { key: 'fileName', header: 'Apex' },
      { key: 'nameSpace', header: 'Namespace' },
      { key: 'apiVersion', header: 'API Version' },
      { key: 'valid', header: `Valid ( > ${minimumApiVersion} )` },
      { key: 'fixed', header: 'Fixed' },
    ];
    const reportFiles = await generateReports(resultSorted, columns, this, {
      logFileName: 'api-versions',
      logLabel: 'Extract and Fix Metadata Api Versions',
    });

    // Return an object to be displayed with --json
    return {
      outputString: 'Processed apiVersion audit',
      result: resultSorted,
      reportFiles,
    };
  }
  /* jscpd:ignore-end */
}
