import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { soqlQuery } from '../../../../common/utils/apiUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class HardisOrgCommunityUpdate extends SfCommand<any> {
  public static readonly summary = messages.getMessage('orgCommunityUpdate');
  public static readonly description = messages.getMessage('orgCommunityUpdateDesc');

  public static examples = [
    `$ sf hardis:org:community:update --name 'MyNetworkName' --status DownForMaintenance`,
    `$ sf hardis:org:community:update --name 'MyNetworkName,MySecondNetworkName' --status Live`
  ];

  public static readonly flags = {
    name: Flags.string({
      description: 'List of Networks Names that you want to update, separated by comma',
      char: 'n',
      required: true,
    }),
    status: Flags.string({
      description: 'New status for the community, available values are: Live, DownForMaintenance',
      char: 's',
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
    const status = flags.status ? flags.status : '';
    const debugMode = flags.debug || false;

    const conn = flags['target-org'].getConnection();

    if (networkNames.length === 0) {
      throw new SfError(`Error: No network name(s) provided.`);
    }

    const networksConstraintIn = networkNames.map((networkName) => `'${networkName}'`).join(',');
    const networksQuery = `SELECT Id, Name, Status FROM Network WHERE Name IN (${networksConstraintIn})`;
    const networksQueryRes = await soqlQuery(networksQuery, conn);
    if (debugMode) {
      uxLog(this, c.grey(`Query result:\n${JSON.stringify(networksQueryRes, null, 2)}`));
    }
    // Check empty result
    if (networksQueryRes.length === 0) {
      const outputString = `No matching network records found with given names`;
      uxLog(this, c.yellow(outputString));
      return { outputString };
    }
    const idToNameMap = new Map(networksQueryRes.records.map(network => [network.Id, network.Name]));

    // Request configuration from user
    if (!isCI) {
      const confirmUpdate = await prompts({
        type: 'confirm',
        name: 'value',
        initial: true,
        message: c.cyanBright(
          `Are you sure you want to update these ${c.bold(idToNameMap.size)} networks's status to '${status}' in org ${c.green(
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
    const updateResults = await conn.sobject("Network").update(networkUpdates, { allOrNone: false });
    let updateSuccessNb = 0;
    let updateErrorsNb = 0;

    for (const ret of updateResults) {
      if (ret.success) {
        updateSuccessNb++;
        uxLog(this, c.green(`'${c.bold(idToNameMap.get(ret.id))}' Network was updated.`));
      } else {
        updateErrorsNb++;
        uxLog(this, c.red(`Error ${updateErrorsNb}: Network '${idToNameMap.get(ret.id)}' failed to update: [${ret.errors[0].message}]`));
      }
    }
    // Return an object to be displayed with --json
    return {
      orgId: flags['target-org'].getOrgId(),
      communityUpdatesSuccess: updateSuccessNb,
      communityUpdatesErrors: updateErrorsNb,
      outputString: `${updateSuccessNb} network(s) were updated`,
    };

  }
}
