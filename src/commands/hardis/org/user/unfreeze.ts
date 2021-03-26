/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages/*, SfdxError*/ } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import * as columnify from 'columnify';
import { execSfdxJson, uxLog } from '../../../../common/utils';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgUnfreezeUser extends SfdxCommand {
  public static title = 'Unfreeze user in organization';

  public static description = messages.getMessage('orgUnfreezeUser');

  public static examples = [
    `$ sfdx hardis:org:user:unfreeze --targetusername dimitri.mongey@gmail.com
  Found 1 records
  Are you sure you want to unfreeze these users (y/n)?: y
  Successfully unfreeze users.
  updated the following list of records:
  ID                 MASTERLABEL PROFIL ISFROZEN
  30109000000kX7uAAE TestFlow    2         true
  `,
    `$ sfdx hardis:org:user:unfreeze --targetusername dimirtri.monge@gmail.com --except ""
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
    prompt: flags.boolean({
      char: 'z',
      default: true,
      allowNo: true,
      description: messages.getMessage('prompt')
    }),
    name: flags.string({
      char: 'n',
      description: messages.getMessage('nameFilter')
    }),
    except: flags.string({
      char: 's',
      default: 'system administrator',
      description: messages.getMessage('exceptFilter')
    }),
    instanceurl: flags.string({
      char: 'r',
      default: 'https://login.saleforce.com',
      description: messages.getMessage('instanceUrl')
    }),
    debug: flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode')
    })
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  // protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const prompt = this.flags.prompt === false ? false : true;
    const exceptFilter = this.flags.except
      ? this.flags.except.split(',')
      : ['System Administrator'];
    const nameFilter = this.flags.name || null;

    const debugMode = this.flags.debug || false;

    // Build query with name filter if sent
    let queryUser = `select id from user where profile.name NOT IN ('${exceptFilter.join(
      "','"
    )})' and isactive=true)`;
    if (nameFilter) {
      queryUser += ` AND Name LIKE '${nameFilter}%'`;
    }
    queryUser += ' ORDER BY Name';

    let query = 'select id, isfrozen, UserId from UserLogin where userid in ('+queryUser+') AND isfrozen=true'
    const username = this.org.getUsername();

    // const flowQueryResult = await conn.query<Flow>(query,{ });
    const unfreezeQueryCommand = 'sfdx force:data:soql:query ' + ` -q "${query}"` +
    ` --targetusername ${username}` + ' --usetoolingapi';
    const unfreezeQueryRes = await execSfdxJson(unfreezeQueryCommand, this, {
      output: false,
      debug: debugMode,
      fail: true
    });

    const recordsRaw = unfreezeQueryRes?.result?.records || unfreezeQueryRes.records || []
    // Check empty result
    if (true/*recordsRaw.length === 0*/) {
      const outputString = `[sfdx-hardis] No matching user records found with query ${query}`;
      uxLog(this,c.yellow(outputString));
      return { deleted: [], outputString };
    }

    // Simplify results format & display them
    const records = recordsRaw.map((record: any) => {
      return {
        Id: record.Id,
        isFrozen: record.isfrozen
      };
    });
    uxLog(this,
      `[sfdx-hardis] Found ${c.bold(records.length)} records:\n${c.yellow(columnify(records))}`
    );

    // Perform update
   // const udapted = [];
    //const updateErrors = [];
    if (
      !prompt ||
      (await this.ux.confirm(
        c.bold(
          `[sfdx-hardis] Are you sure you want to update this list of records in ${c.green(
            this.org.getUsername()
          )} (y/n)?`
        )
      ))
    ) {
     /* for (const record of records) {
        const deleteCommand =
          'sfdx force:data:record:delete' +
          ' --sobjecttype Flow' +
          ` --sobjectid ${record.Id}` +
          ` --targetusername ${username}` +
          ' --usetoolingapi';
        const deleteRes = await execSfdxJson(deleteCommand, this, {
          fail: false,
          output: false,
          debug: debugMode
        });
        if (!(deleteRes.status === 0)) {
          this.ux.error(
            c.red(
              `[sfdx-hardis] Unable to perform deletion request: ${JSON.stringify(
                deleteRes
              )}`
            )
          );
          deleteErrors.push(deleteRes);
        }
        deleted.push(record);
      }*/
    }
/*
    if (deleteErrors.length > 0) {
      const errMsg = `[sfdx-hardis] There are been errors while deleting ${
        deleteErrors.length
      } records: \n${JSON.stringify(deleteErrors)}`;
      if (allowPurgeFailure) {
        uxLog(this, c.yellow(errMsg));
      } else {
        throw new SfdxError(
          c.yellow(
            `There are been errors while deleting ${
              deleteErrors.length
            } records: \n${JSON.stringify(deleteErrors)}`
          )
        );
      }
    }

    const summary =
      deleted.length > 0
        ? `[sfdx-hardis] Deleted the following list of records:\n${columnify(
            deleted
          )}`
        : '[sfdx-hardis] No record to delete';
    uxLog(this,c.green(summary));
    // Return an object to be displayed with --json
    return { orgId: this.org.getOrgId(), outputString: summary };*/
  }

}
