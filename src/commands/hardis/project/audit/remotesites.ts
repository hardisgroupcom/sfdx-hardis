/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import fs from 'fs-extra';
import c from 'chalk';
import { glob } from 'glob';
import * as psl from 'psl';
import sortArray from 'sort-array';
import * as url from 'url';
import { catchMatches, generateReports, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { GLOB_IGNORE_PATTERNS } from '../../../../common/utils/projectUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class RemoteSites extends SfCommand<any> {
  public static title = 'Audit Remote Sites';

  public static description: string = `
## Command Behavior

**Audits Salesforce Remote Site Settings in your project, providing a comprehensive overview of external endpoints accessed by your Salesforce org.**

This command is crucial for security reviews, compliance checks, and understanding the external integrations of your Salesforce environment. It helps identify all configured remote sites, their URLs, activity status, and associated protocols.

Key functionalities:

- **Remote Site Discovery:** Scans your project for RemoteSiteSetting metadata files (.remoteSite-meta.xml or .remoteSite).
- **URL Extraction:** Extracts the URL, active status, and description for each remote site.
- **Protocol and Domain Identification:** Determines the protocol (HTTP/HTTPS) and extracts the domain from each URL, providing a clearer picture of the external systems being accessed.
- **Reporting:** Generates a CSV report summarizing all detected remote sites, including their protocol, domain, name, URL, active status, and description.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Discovery:** Uses \`glob\` to find all RemoteSiteSetting metadata files within the project.
- **Content Analysis:** Reads the content of each XML file and uses regular expressions (/<url>(.*?)<\\/url>/gim, /<isActive>(.*?)<\\/isActive>/gim, /<description>(.*?)<\\/description>/gim) to extract relevant details.
- **\`catchMatches\` Utility:** This utility function is used to apply the defined regular expressions to each file and extract all matching occurrences.
- **URL Parsing:** Uses Node.js's \`url\` module to parse the extracted URLs and \`psl\` (Public Suffix List) to extract the domain name from the hostname.
- **Data Structuring:** Organizes the extracted information into a structured format, including the remote site's name, file name, namespace, URL, active status, description, protocol, and domain.
- **Reporting:** Uses \`generateReports\` to create a CSV report and display a table in the console, summarizing the audit findings.
</details>
`;

  public static examples = ['$ sf hardis:project:audit:remotesites'];

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
    const pattern = '**/*.{remoteSite-meta.xml,remoteSite}';
    const catchers = [
      {
        type: '',
        subType: '',
        regex: /<url>(.*?)<\/url>/gim,
        detail: [
          { name: 'url', regex: /<url>(.*?)<\/url>/gims },
          { name: 'active', regex: /<isActive>(.*?)<\/isActive>/gims },
          {
            name: 'description',
            regex: /<description>(.*?)<\/description>/gimsu,
          },
        ],
      },
    ];
    const remoteSiteSettingsFiles = await glob(pattern, { ignore: GLOB_IGNORE_PATTERNS });
    this.matchResults = [];
    uxLog("other", this, `Browsing ${remoteSiteSettingsFiles.length} files`);
    // Loop in files
    for (const file of remoteSiteSettingsFiles) {
      const fileText = await fs.readFile(file, 'utf8');
      // Loop on criteria to find matches in this file
      for (const catcher of catchers) {
        const catcherMatchResults = await catchMatches(catcher, file, fileText, this);
        this.matchResults.push(...catcherMatchResults);
      }
    }

    // Format result
    const result: any[] = this.matchResults.map((item: any) => {
      return {
        name: item.fileName.replace('.remoteSite-meta.xml', '').replace('.remoteSite', ''),
        fileName: item.fileName,
        nameSpace: item.fileName.includes('__') ? item.fileName.split('__')[0] : 'Custom',
        matches: item.matches,
        url: item.detail?.url ? item.detail.url[0] : '',
        active: item.detail?.active ? 'yes' : 'no',
        description: item.detail?.description ? item.detail.description[0] : '',
        protocol: item.detail.url[0].includes('https') ? 'HTTPS' : 'HTTP',
        domain: (psl.parse(new url.URL(item.detail.url[0]).hostname) as any)?.domain || 'Domain not found',
      };
    });

    // Sort array
    const resultSorted = sortArray(result, {
      by: ['protocol', 'domain', 'name', 'active', 'description'],
      order: ['asc', 'asc', 'asc', 'desc', 'asc'],
    });

    // Display as table
    uxLog("action", this, c.cyan(`Found ${c.bold(resultSorted.length)} remote sites.`));
    const resultsLight = JSON.parse(JSON.stringify(resultSorted));
    uxLogTable(this,
      resultsLight.map((item: any) => {
        delete item.fileName;
        delete item.detail;
        delete item.matches;
        return item;
      })
    );

    // Export into csv & excel file
    const columns = [
      { key: 'protocol', header: 'Protocol' },
      { key: 'domain', header: 'Domain' },
      { key: 'name', header: 'Name' },
      { key: 'url', header: 'URL' },
      { key: 'active', header: 'Active' },
      { key: 'description', header: 'Description' },
    ];
    const reportFiles = await generateReports(resultSorted, columns, this, {
      logFileName: 'remote-sites-audit',
      logLabel: 'Remote Sites Audit',
    });

    // Return an object to be displayed with --json
    return {
      outputString: 'Processed callIns and callOuts audit',
      result: resultSorted,
      reportFiles,
    };
  }
}
