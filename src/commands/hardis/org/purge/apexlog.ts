/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { execCommand, uxLog } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class PurgeApexLogs extends SfCommand<any> {
  public static title = 'Purge Apex Logs';

  public static description = `
**Purges Apex debug logs from a Salesforce org.**

This command provides a quick and efficient way to clear out accumulated Apex debug logs from your Salesforce environment. This is particularly useful for:

- **Storage Management:** Freeing up valuable data storage space in your Salesforce org.
- **Performance Optimization:** Reducing the overhead associated with large volumes of debug logs.
- **Troubleshooting:** Ensuring that new debug logs are generated cleanly without interference from old, irrelevant logs.

Key functionalities:

- **Log Identification:** Queries the \`ApexLog\` object to identify all existing debug logs.
- **Confirmation Prompt:** Before deletion, it prompts for user confirmation, displaying the number of Apex logs that will be deleted.
- **Bulk Deletion:** Uses the Salesforce Bulk API to efficiently delete a large number of Apex logs.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SOQL Query:** It executes a SOQL query (\`SELECT Id FROM ApexLog LIMIT 50000\`) to retrieve the IDs of Apex logs to be deleted. The limit is set to 50,000 to handle large volumes of logs.
- **CSV Export:** The retrieved log IDs are temporarily exported to a CSV file (\`ApexLogsToDelete_*.csv\`) in the \`./tmp\` directory.
- **User Confirmation:** It uses the \`prompts\` library to ask for user confirmation before proceeding with the deletion, displaying the count of logs to be purged.
- **Bulk API Deletion:** It then uses the Salesforce CLI's \`sf data delete bulk\` command, pointing to the generated CSV file, to perform the mass deletion of Apex logs.
- **File System Operations:** It uses \`fs-extra\` to create the temporary directory and manage the CSV file.
- **Error Handling:** Includes error handling for the query and deletion operations.
</details>
`;

  public static examples = [
    `$ sf hardis:org:purge:apexlog`,
    `$ sf hardis:org:purge:apexlog --target-org nicolas.vuillamy@gmail.com`,
  ];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    // flag with a value (-n, --name=VALUE)
    prompt: Flags.boolean({
      char: 'z',
      default: true,
      allowNo: true,
      description: messages.getMessage('prompt'),
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
    'target-org': requiredOrgFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(PurgeApexLogs);
    const prompt = flags.prompt === false ? false : true;
    const debugMode = flags.debug || false;

    // Build apex logs query
    const tempDir = './tmp';
    await fs.ensureDir(tempDir);
    const apexLogsToDeleteCsv = path.join(tempDir, 'ApexLogsToDelete_' + Math.random() + '.csv');
    const queryCommand = `sf data query --query "SELECT Id FROM ApexLog LIMIT 50000" -t -r "csv" > "${apexLogsToDeleteCsv}"`;
    await execCommand(queryCommand, this, {
      output: true,
      debug: debugMode,
      fail: true,
    });

    const extractFile = (await fs.readFile(apexLogsToDeleteCsv, 'utf8')).toString();
    const apexLogsNumber = extractFile.split('\n').filter((line) => line.length > 0).length;

    if (apexLogsNumber === 0) {
      uxLog("action", this, c.cyan(`There are no Apex Logs to delete in org ${c.green(flags['target-org'].getUsername())}`));
      return {};
    }

    // Prompt confirmation
    if (prompt) {
      const confirmRes = await prompts({
        type: 'confirm',
        name: 'value',
        message: `Do you want to delete ${c.bold(apexLogsNumber)} Apex Logs of org ${c.green(
          flags['target-org'].getUsername()
        )} ?`,
        description: 'Permanently delete all Apex debug logs from the Salesforce org to free up storage space',
      });
      if (confirmRes.value === false) {
        return {};
      }
    }

    // Perform delete
    const deleteCommand = `sf data delete bulk --sobject ApexLog --file ${apexLogsToDeleteCsv}`;
    await execCommand(deleteCommand, this, {
      output: true,
      debug: debugMode,
      fail: true,
    });

    uxLog(
      "success",
      this,
      c.green(
        `Successfully deleted ${c.bold(apexLogsNumber)} Apex Logs in org ${c.bold(flags['target-org'].getUsername())}`
      )
    );

    // Return an object to be displayed with --json
    return { orgId: flags['target-org'].getOrgId() };
  }
}
