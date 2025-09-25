/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import { glob } from 'glob';
import sortArray from 'sort-array';
import { catchMatches, generateReports, uxLog } from '../../../../common/utils/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

import { CONSTANTS } from '../../../../config/index.js';
import { GLOB_IGNORE_PATTERNS } from '../../../../common/utils/projectUtils.js';

export default class CallInCallOut extends SfCommand<any> {
  public static title = 'Audit Metadatas API Version';

  public static description = `This command detects metadatas whose apiVersion is lower than parameter --minimumapiversion

  It can also fix the apiVersions with the latest one, if parameter --fix is sent

  Example to handle [ApexClass / Trigger & ApexPage mandatory version upgrade](https://help.salesforce.com/s/articleView?id=sf.admin_locales_update_api.htm&type=5) : sf hardis:project:audit:apiversion --metadatatype ApexClass,ApexTrigger,ApexPage --minimumapiversion 45.0 --fix
  `

  public static examples = [
    '$ sf hardis:project:audit:apiversion',
    '$ sf hardis:project:audit:apiversion --metadatatype ApexClass,ApexTrigger,ApexPage --minimumapiversion 45',
    '$ sf hardis:project:audit:apiversion --metadatatype ApexClass,ApexTrigger,ApexPage --minimumapiversion 45 --fix'
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
      description: 'Fix ApiVersion on specified Metadata Types.',
    }),
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected matchResults: any[] = [];

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CallInCallOut);
    const minimumApiVersion = flags.minimumapiversion || false;
    const failIfError = flags.failiferror || false;
    const fix = flags.fix || false;
    const metadataType = flags.metadatatype || '';

    const fixAllowedExtensions = {
      "ApexClass": "cls",
      "ApexTrigger": "trigger",
      "ApexPage": "page",
    };
    const fixAllowedMetadataTypes = Object.keys(fixAllowedExtensions);

    const fixTargetedMetadataTypes = metadataType.trim() === '' ? [] : (metadataType || '').replace(/\s+/g, '').split(',');
    const fixInvalidMetadataTypes = fixTargetedMetadataTypes.filter(value => !fixAllowedMetadataTypes.includes(value));
    if (fixTargetedMetadataTypes.length > 0 && fixInvalidMetadataTypes.length > 0 && fix) {
      uxLog(
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
      pattern = `**/*.{${fixTargetedMetadataTypesExtensions.join(',')}}-meta.xml`;
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
    uxLog(this, `Browsing ${xmlFiles.length} files`);
    // Loop in files
    for (const file of xmlFiles) {
      const fileText = await fs.readFile(file, 'utf8');
      // Update ApiVersion on file
      let fixed = false;
      if (fix && fixTargetedMetadataTypes.length > 0 && fixTargetedMetadataTypesPattern.test(file)) {
        const updatedContent = fileText.replace(/<apiVersion>(.*?)<\/apiVersion>/, `<apiVersion>${CONSTANTS.API_VERSION}</apiVersion>`);
        await fs.promises.writeFile(file, updatedContent, 'utf-8');
        fixed = true;
        uxLog(this, `Updated apiVersion in file: ${file}`);
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
    }

    // Format result
    const result: any[] = this.matchResults.map((item: any) => {
      return {
        type: item.type,
        fileName: item.fileName,
        nameSpace: item.fileName.includes('__') ? item.fileName.split('__')[0] : 'Custom',
        apiVersion: parseFloat(item.detail['apiVersion']),
        valid: parseFloat(item.detail['apiVersion']) > (minimumApiVersion || 100) ? 'yes' : 'no',
        fixed: item.fixed ? 'yes' : 'no',
      };
    });
    // Sort array
    const resultSorted = sortArray(result, {
      by: ['type', 'subType', 'fileName'],
      order: ['asc', 'asc', 'asc'],
    });

    // Display as table
    const resultsLight = JSON.parse(JSON.stringify(resultSorted));
    console.table(
      resultsLight.map((item: any) => {
        delete item.detail;
        return item;
      })
    );

    const numberOfInvalid = result.filter((res: any) => res.valid === 'no').length;
    const numberOfValid = result.length - numberOfInvalid;

    if (numberOfInvalid > 0) {
      uxLog(
        this,
        c.yellow(
          `[sfdx-hardis] WARNING: Your sources contain ${c.bold(
            numberOfInvalid
          )} metadata files with API Version lesser than ${c.bold(minimumApiVersion)}`
        )
      );
      if (failIfError) {
        throw new SfError(
          c.red(`[sfdx-hardis][ERROR] ${c.bold(numberOfInvalid)} metadata files with wrong API version detected`)
        );
      }
    } else {
      uxLog(
        this,
        c.green(
          `[sfdx-hardis] SUCCESS: Your sources contain ${c.bold(
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
