import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { soqlQuery, bulkUpdate } from '../../../../common/utils/apiUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class HardisOrgCommunityUpdate extends SfCommand<any> {
  public static readonly summary = messages.getMessage('orgCommunityUpdate');
  public static readonly description = messages.getMessage('orgCommunityUpdateDesc');

  public static examples = [
    `$ sf hardis:org:community:update --name 'MyNetworkName' --active true`,
    `$ sf hardis:org:community:update --name 'MyNetworkName,MySecondNetworkName' --active false`
  ];

  public static readonly flags = {
    name: Flags.string({
      description: 'List of Networks Names that you want to update, separated by comma',
      char: 'n',
      required: true,
    }),
    active: Flags.string({
      description: 'Activate or deactivate community, available values are: true, false',
      char:'a',
      default: true,
      required: true,
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(HardisOrgCommunityUpdate);
    const networkNames = flags.name ? flags.name.split(',') : [];
    //Network status depending on the active flag
    const status = flags.active ? 'Live' : 'DownForMaintenance';
    this.debugMode = flags.debug || false;

    const conn = flags['target-org'].getConnection();

    // Select networks that we want to update
    let networkIds: any[] = [];
    if (networkNames.length === 0) {
      uxLog(this, c.red(`Error: No network name(s) provided.`));
    } else if (networkNames.length > 0) {
      // Use includenetworks argument
      const networksConstraintIn = networkNames.map((networkName) => `'${networkName}'`).join(',');
      const networksQuery = `SELECT Id, Name, Status FROM Network WHERE Name IN (${networksConstraintIn})`;
      const networksQueryRes = await soqlQuery(networksQuery, conn);
      if (this.debugMode) {
        uxLog(this, c.grey(`Query result:\n${JSON.stringify(networksQueryRes, null, 2)}`));
      }
      // Check empty result
      if (networksQueryRes.length === 0) {
        const outputString = `No matching network records found with given names`;
        uxLog(this, c.yellow(outputString));
        return { outputString };
      }
      networkIds = networksQueryRes.records.map((network) => network.Id);
      // Request configuration from user
      if (!isCI) {
        const confirmUpdate = await prompts({
          type: 'confirm',
          name: 'value',
          initial: true,
          message: c.cyanBright(
            `Are you sure you want to update these ${c.bold(networkIds.length)} networks to ${status} in org ${c.green(
              flags['target-org'].getUsername()
            )} (y/n)?`
          ),
        });
        if (confirmUpdate.value !== true) {
          const outputString = 'Script cancelled by user';
          uxLog(this, c.yellow(outputString));
          return { outputString };
        }
      }

      // Process Network update
      const networkUpdates = networksQueryRes.records.map((network) => {
        return { Id: network.Id, Status: status };
      });
      const bulkUpdateRes = await bulkUpdate('Network', 'update', networkUpdates, conn);

      const updateSuccessNb = bulkUpdateRes.successfulResults.length;
      const updateErrorsNb = bulkUpdateRes.failedResults.length;
      if (updateErrorsNb > 0) {
        // Iterate over the failed results and log the error details
        bulkUpdateRes.failedResults.forEach((failedResult, index) => {
          uxLog(this, c.red(`Error ${index + 1}: Network ID ${failedResult.sf__Id} failed to update. Reason: ${failedResult.sf__Error}`));
        });
      }

      // Build results summary
      uxLog(this, c.green(`${c.bold(updateSuccessNb)} network(s) were updated.`));

      // Return an object to be displayed with --json
      return {
        orgId: flags['target-org'].getOrgId(),
        communityUpdatesSuccess: updateSuccessNb,
        communityUpdatesErrors: updateErrorsNb,
        outputString: `${updateSuccessNb} network(s) were updated`,
      };
    }
  }
}
