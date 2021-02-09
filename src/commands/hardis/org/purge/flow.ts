/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages, SfdxError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as columnify from 'columnify';
import * as sfdx from 'sfdx-node';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgPurgeFlow extends SfdxCommand {

  public static title = 'Purge Flow versions';

  public static description = messages.getMessage('orgPurgeFlow');

  public static examples = [
  `$ sfdx hardis:org:purge:flow --targetusername nicolas.vuillamy@gmail.com
  Found 1 records:
  ID                 MASTERLABEL VERSIONNUMBER DESCRIPTION  STATUS
  30109000000kX7uAAE TestFlow    2             test flowwww Obsolete
  Are you sure you want to delete this list of records (y/n)?: y
  Successfully deleted record: 30109000000kX7uAAE.
  Deleted the following list of records:
  ID                 MASTERLABEL VERSIONNUMBER DESCRIPTION  STATUS
  30109000000kX7uAAE TestFlow    2             test flowwww Obsolete
  `,
  `$ sfdx hardis:org:purge:flow --targetusername nicolas.vuillamy@gmail.com --status "Obsolete,Draft,InvalidDraft --name TestFlow"
  Found 4 records:
  ID                 MASTERLABEL VERSIONNUMBER DESCRIPTION  STATUS
  30109000000kX7uAAE TestFlow    2             test flowwww Obsolete
  30109000000kX8EAAU TestFlow    6             test flowwww InvalidDraft
  30109000000kX8AAAU TestFlow    5             test flowwww InvalidDraft
  30109000000kX89AAE TestFlow    4             test flowwww Draft
  Are you sure you want to delete this list of records (y/n)?: n
  No record deleted
  `
  ];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    prompt: flags.boolean({char: 'z', default: true, allowNo: true,  description: messages.getMessage('prompt')}),
    name: flags.string({char: 'n', description: messages.getMessage('nameFilter')}),
    status: flags.string({char: 's', default: 'Obsolete', description: messages.getMessage('statusFilter')}),
    sandbox: flags.boolean({ default: false, description: messages.getMessage('sandboxLogin')}),
    instanceurl: flags.string({char: 'r', default: 'https://login.saleforce.com',  description: messages.getMessage('instanceUrl')}),
    debug: flags.boolean({char: 'd', default: false, description: messages.getMessage('debugMode')})
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  // protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const prompt = (this.flags.prompt === false) ? false : true;
    const statusFilter = (this.flags.status) ? this.flags.status.split(',') : ['Obsolete'];
    const nameFilter = this.flags.name || null;
    const debug = this.flags.debug || false ;

    // Check we don't delete active Flows
    if (statusFilter.includes('Active')) {
      throw new SfdxError('You can not delete active records');
    }

    // Build query with name filter if sent
    let query = `SELECT Id,MasterLabel,VersionNumber,Status,Description FROM Flow WHERE Status IN ('${statusFilter.join("','")}')`;
    if (statusFilter) {

    }
    if (nameFilter) {
      query += ` AND MasterLabel LIKE '${nameFilter}%'`;
    }
    query += ' ORDER BY MasterLabel,VersionNumber';

    const username = this.org.getUsername();

    // const flowQueryResult = await conn.query<Flow>(query,{ });
    const flowQueryResult = await sfdx.data.soqlQuery({
      query,
      targetusername: username,
      usetoolingapi: true,
      _quiet: !debug,
      _rejectOnError: true
    });

    // Check empty result
    if (!flowQueryResult.records || flowQueryResult.records.length <= 0) {
      const outputString = `[sfdx-hardis] No matching Flow records found with query ${query}`;
      this.ux.log(outputString);
      return { deleted: [] , outputString};
    }

    // Simplify results format & display them
    const records = flowQueryResult.records.map(record => {
      return { Id: record.Id, MasterLabel: record.MasterLabel, VersionNumber: record.VersionNumber,
         Description: record.Description, Status: record.Status };
    });
    this.ux.log(`[sfdx-hardis] Found ${records.length} records:\n${columnify(records)}`);

    // Perform deletion
    const deleted = [];
    const deleteErrors = [];
    if (
      !prompt ||
      await this.ux.confirm(`[sfdx-hardis] Are you sure you want to delete this list of records in ${this.org.getUsername()} (y/n)?`)
      ) {
        for (const record of records) {
          const deleteResult = await sfdx.data.recordDelete({
            sobjecttype: 'Flow',
            sobjectid: record.Id,
            targetusername: username,
            usetoolingapi: true,
            _quiet: debug
          });
          if ((deleteResult && deleteResult.success !== true) || deleteResult == null) {
            this.ux.error(`[sfdx-hardis] Unable to perform deletion request: ${JSON.stringify(deleteResult || {})}`);
            deleteErrors.push(deleteResult);
          }
          deleted.push(record);
        }
    }

    if (deleteErrors.length > 0) {
      throw new SfdxError(`There are been errors while deleting ${deleteErrors.length} records: \n${JSON.stringify(deleteErrors)}`);
    }

    const summary = (deleted.length > 0) ? `[sfdx-hardis] Deleted the following list of records:\n${columnify(deleted)}` : '[sfdx-hardis] No record deleted';
    this.ux.log(summary);
    // Return an object to be displayed with --json
    return { orgId: this.org.getOrgId(), outputString: summary };
  }
}
