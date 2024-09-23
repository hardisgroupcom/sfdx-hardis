/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import columnify from 'columnify';
import { generateReports, isCI, uxLog } from '../../../../common/utils/index.js';
import { promptProfiles } from '../../../../common/utils/orgUtils.js';
//import { executeApex } from "../../../../common/utils/deployUtils.js";
import { prompts } from '../../../../common/utils/prompts.js';
import { soqlQuery, bulkQuery, bulkUpdate } from '../../../../common/utils/apiUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgUnfreezeUser extends SfCommand<any> {
  public static title = 'Unfreeze user logins';

  public static description = messages.getMessage('orgUnfreezeUser');

  public static examples = [
    `$ sf hardis:org:user:unfreeze`,
    `$ sf hardis:org:user:unfreeze --target-org myuser@myorg.com`,
    `$ sf hardis:org:user:unfreeze --includeprofiles 'Standard'`,
    `$ sf hardis:org:user:unfreeze --excludeprofiles 'System Administrator,Some Other Profile'`,
  ];

  // public static args = [{name: 'file'}];

  public static flags: any = {
    // flag with a value (-n, --name=VALUE)
    name: Flags.string({
      char: 'n',
      description: messages.getMessage('nameFilter'),
    }),
    includeprofiles: Flags.string({
      char: 'p',
      description: 'List of profiles that you want to unfreeze, separated by commas',
    }),
    excludeprofiles: Flags.string({
      char: 'e',
      description: 'List of profiles that you want to NOT unfreeze, separated by commas',
    }),
    maxuserdisplay: Flags.integer({
      char: 'm',
      default: 100,
      description: 'Maximum users to display in logs',
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

  protected maxUsersDisplay = 100;
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgUnfreezeUser);
    const includeProfileNames = flags.includeprofiles ? flags.includeprofiles.split(',') : [];
    const excludeProfileNames = flags.excludeprofiles ? flags.excludeprofiles.split(',') : [];
    this.maxUsersDisplay = flags.maxuserdisplay || 100;
    this.debugMode = flags.debug || false;

    const conn = flags['target-org'].getConnection();

    // Select profiles that we want users to be unfrozen
    let profileIds: any[] = [];
    let profileNames: any[] = [];
    if (includeProfileNames.length === 0 && excludeProfileNames.length === 0) {
      // Manual user selection
      const profilesRes = await promptProfiles(conn, {
        multiselect: true,
        message: 'Please select profiles that you do you want to unfreeze users that are assigned to them ?',
        returnField: 'record',
      });
      profileIds = profilesRes.map((profile) => profile.Id);
      profileNames = profilesRes.map((profile) => {
        return [profile.Id, profile.Name];
      });
    } else if (includeProfileNames.length > 0) {
      // Use includeprofiles argument
      const profilesConstraintIn = includeProfileNames.map((profileName) => `'${profileName}'`).join(',');
      const profilesQuery = `SELECT Id,Name FROM Profile WHERE Name IN (${profilesConstraintIn})`;
      const profilesQueryRes = await soqlQuery(profilesQuery, conn);
      if (this.debugMode) {
        uxLog(this, c.grey(`Query result:\n${JSON.stringify(profilesQueryRes, null, 2)}`));
      }
      profileIds = profilesQueryRes.records.map((profile) => profile.Id);
      profileNames = profilesQueryRes.records.map((profile) => {
        return [profile.Id, profile.Name];
      });
    } else if (excludeProfileNames.length > 0) {
      // Use excludeprofiles argument
      const profilesConstraintIn = excludeProfileNames.map((profileName) => `'${profileName}'`).join(',');
      const profilesQuery = `SELECT Id,Name FROM Profile WHERE Name NOT IN (${profilesConstraintIn})`;
      const profilesQueryRes = await soqlQuery(profilesQuery, conn);
      if (this.debugMode) {
        uxLog(this, c.grey(`Query result:\n${JSON.stringify(profilesQueryRes, null, 2)}`));
      }
      profileIds = profilesQueryRes.records.map((profile) => profile.Id);
      profileNames = profilesQueryRes.records.map((profile) => {
        return [profile.Id, profile.Name];
      });
    }

    // List profiles that must be unfrozen
    const profileIdsStr = profileIds.map((profileId) => `'${profileId}'`).join(',');

    // Query users that we want to unfreeze
    uxLog(this, c.cyan(`Querying User records matching ${c.bold(profileIds.length)} profiles...`));
    const userQuery = `SELECT Id,Name,Username,ProfileId FROM User WHERE ProfileId IN (${profileIdsStr}) and IsActive=true`;
    const userQueryRes = await bulkQuery(userQuery, conn);
    const usersToUnfreeze = userQueryRes.records;
    const userIdsStr = usersToUnfreeze.map((user) => `'${user.Id}'`).join(',');

    // Check empty result
    if (usersToUnfreeze.length === 0) {
      const outputString = `No matching user records found with defined profile constraints`;
      uxLog(this, c.yellow(outputString));
      return { outputString };
    }

    // Query related UserLogin records
    uxLog(this, c.cyan(`Querying UserLogin records matching ${c.bold(usersToUnfreeze.length)} users...`));
    const userLoginQuery = `SELECT Id,UserId,IsFrozen FROM UserLogin WHERE UserId IN (${userIdsStr}) and IsFrozen=true`;
    const userLoginQueryRes = await bulkQuery(userLoginQuery, conn);
    const userLoginsToUnfreeze = userLoginQueryRes.records;

    // Display list of users to unfreeze
    const usersToUnfreezeDisplay = userLoginsToUnfreeze.map((userLogin: any) => {
      const matchingUser = usersToUnfreeze.filter((user) => user.Id === userLogin.UserId)[0];
      return {
        Username: matchingUser.Username,
        Name: matchingUser.Name,
        Profile: profileNames.filter((profile) => profile[0] === matchingUser.ProfileId)[1],
      };
    });
    uxLog(
      this,
      '\n' +
      c.white(
        columnify(this.debugMode ? usersToUnfreezeDisplay : usersToUnfreezeDisplay.slice(0, this.maxUsersDisplay))
      )
    );
    if (!this.debugMode === false && usersToUnfreezeDisplay.length > this.maxUsersDisplay) {
      uxLog(this, c.yellow(c.italic(`(list truncated to the first ${this.maxUsersDisplay} users)`)));
    }
    uxLog(this, c.cyan(`${c.bold(userLoginsToUnfreeze.length)} users can be unfrozen.`));
    // Generate csv + xls of users about to be unfrozen
    await generateReports(usersToUnfreezeDisplay, ['Username', 'Name', 'Profile'], this, {
      logFileName: 'users-to-unfreeze',
      logLabel: 'Extract of users to unfreeze',
    });

    // Request configuration from user
    if (!isCI) {
      const confirmunfreeze = await prompts({
        type: 'confirm',
        name: 'value',
        initial: true,
        message: c.cyanBright(
          `Are you sure you want to unfreeze these ${c.bold(userLoginsToUnfreeze.length)} users in org ${c.green(
            flags['target-org'].getUsername()
          )} (y/n)?`
        ),
      });
      if (confirmunfreeze.value !== true) {
        const outputString = 'Script cancelled by user';
        uxLog(this, c.yellow(outputString));
        return { outputString };
      }
    }

    // Process UserLogin freezing
    const userLoginsFrozen = userLoginsToUnfreeze.map((userLogin) => {
      return { Id: userLogin.Id, IsFrozen: false };
    });
    const bulkUpdateRes = await bulkUpdate('UserLogin', 'update', userLoginsFrozen, conn);

    const unfreezeSuccessNb = bulkUpdateRes.successfulResults.length;
    const unfreezeErrorsNb = bulkUpdateRes.failedResults.length;
    if (unfreezeErrorsNb > 0) {
      uxLog(
        this,
        c.yellow(`Warning: ${c.red(c.bold(unfreezeErrorsNb))} users has not been unfrozen (bulk API errors)`)
      );
    }

    // Build results summary
    uxLog(this, c.green(`${c.bold(unfreezeSuccessNb)} users has been be unfrozen.`));

    // Return an object to be displayed with --json
    return {
      orgId: flags['target-org'].getOrgId(),
      unfreezeSuccess: unfreezeSuccessNb,
      unfreezeErrors: unfreezeErrorsNb,
      outputString: `${unfreezeSuccessNb} users has been be unfrozen`,
    };
  }
}
