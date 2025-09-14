/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import { glob } from 'glob';
import sortArray from 'sort-array';
import { catchMatches, generateReports, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { GLOB_IGNORE_PATTERNS } from '../../../../common/utils/projectUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class CallInCallOut extends SfCommand<any> {
  public static title = 'Audit CallIns and CallOuts';

  public static description = `
## Command Behavior

**Audits Apex classes for inbound (Call-In) and outbound (Call-Out) API calls, providing insights into integration points.**

This command helps developers and architects understand the integration landscape of their Salesforce project by identifying where Apex code interacts with external systems or exposes functionality for external consumption. It's useful for security reviews, refactoring efforts, and documenting system integrations.

Key functionalities:

- **Inbound Call Detection:** Identifies Apex methods exposed as web services (\`webservice static\`) or REST resources (\`@RestResource\`).
- **Outbound Call Detection:** Detects HTTP callouts (\`new HttpRequest\`).
- **Detailed Information:** Extracts relevant details for each detected call, such as endpoint URLs for outbound calls or resource names for inbound calls.
- **Test Class Exclusion:** Automatically skips test classes (\`@isTest\`) to focus on production code.
- **CSV Report Generation:** Generates a CSV report summarizing all detected call-ins and call-outs, including their type, subtype (protocol), file name, namespace, and extracted details.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Discovery:** Uses \`glob\` to find all Apex class (\`.cls\`) and trigger (\`.trigger\`) files within the project.
- **Content Analysis:** Reads the content of each Apex file and uses regular expressions to identify patterns indicative of inbound or outbound calls.
- **Pattern Matching:** Defines a set of \`catchers\`, each with a \`type\` (INBOUND/OUTBOUND), \`subType\` (SOAP/REST/HTTP), and \`regex\` to match specific API call patterns. It also includes \`detail\` regexes to extract additional information.
- **\`catchMatches\` Utility:** This utility function is used to apply the defined \`catchers\` to each Apex file and extract all matching occurrences.
- **Data Structuring:** Organizes the extracted information into a structured format, including the file name, namespace, and detailed matches.
- **Reporting:** Uses \`generateReports\` to create a CSV report and display a table in the console, summarizing the audit findings.
- **Filtering:** Filters out files that start with 'hidden' or contain \`@isTest\` to focus on relevant code.
</details>
`;

  public static examples = ['$ sf hardis:project:audit:callouts'];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    // flag with a value (-n, --name=VALUE)
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
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  /* jscpd:ignore-end */

  protected matchResults: any[] = [];

  public async run(): Promise<AnyJson> {
    const pattern = '**/*.{cls,trigger}';
    const catchers = [
      {
        type: 'INBOUND',
        subType: 'SOAP',
        regex: /webservice static/gim,
        detail: [{ name: 'webServiceName', regex: /webservice static (.*?){/gims }],
      },
      {
        type: 'INBOUND',
        subType: 'REST',
        regex: /@RestResource/gim,
        detail: [{ name: 'restResource', regex: /@RestResource\((.*?)\)/gims }],
      },
      {
        type: 'OUTBOUND',
        subType: 'HTTP',
        regex: /new HttpRequest/gim,
        detail: [
          { name: 'endPoint', regex: /setEndpoint\((.*?);/gims },
          { name: 'action', regex: /<soapenv:Body><[A-Za-z0-9_-]*:(.*?)>/gims },
        ],
      },
    ];
    const apexFiles = await glob(pattern, { ignore: GLOB_IGNORE_PATTERNS });
    this.matchResults = [];
    uxLog("other", this, `Browsing ${apexFiles.length} files`);
    // Loop in files
    for (const file of apexFiles) {
      const fileText = await fs.readFile(file, 'utf8');
      if (fileText.startsWith('hidden') || fileText.includes('@isTest')) {
        continue;
      }
      // Loop on criteria to find matches in this file
      for (const catcher of catchers) {
        const catcherMatchResults = await catchMatches(catcher, file, fileText, this);
        this.matchResults.push(...catcherMatchResults);
      }
    }

    // Format result
    const result: any[] = this.matchResults.map((item: any) => {
      return {
        type: item.type,
        subType: item.subType,
        fileName: item.fileName,
        nameSpace: item.fileName.includes('__') ? item.fileName.split('__')[0] : 'Custom',
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
            .join(' || ') || '',
      };
    });

    // Sort array
    const resultSorted = sortArray(result, {
      by: ['type', 'subType', 'fileName', 'matches'],
      order: ['asc', 'asc', 'asc', 'desc'],
    });

    // Display as table
    const resultsLight = JSON.parse(JSON.stringify(resultSorted));
    uxLog("action", this, c.cyan(`Found ${c.bold(resultsLight.length)} call-ins and call-outs.`));
    uxLogTable(this,
      resultsLight.map((item: any) => {
        delete item.detail;
        return item;
      })
    );

    // Generate output files
    const columns = [
      { key: 'type', header: 'IN/OUT' },
      { key: 'subType', header: 'Protocol' },
      { key: 'fileName', header: 'Apex' },
      { key: 'nameSpace', header: 'Namespace' },
      { key: 'matches', header: 'Number' },
      { key: 'detail', header: 'Detail' },
    ];
    const reportFiles = await generateReports(resultSorted, columns, this, {
      logFileName: 'callins-callouts-audit',
      logLabel: 'CallIns and CallOuts Audit',
    });

    // Return an object to be displayed with --json
    return {
      outputString: 'Processed callIns and callOuts audit',
      result: resultSorted,
      reportFiles,
    };
  }
}
