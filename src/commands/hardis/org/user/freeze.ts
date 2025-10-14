/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { generateReports, isCI, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { promptProfiles } from '../../../../common/utils/orgUtils.js';
//import { executeApex } from "../../../../common/utils/deployUtils.js";
import { prompts } from '../../../../common/utils/prompts.js';
import { soqlQuery, bulkQuery, bulkUpdate } from '../../../../common/utils/apiUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgFreezeUser extends SfCommand<any> {
  public static title = 'Freeze user logins';

  public static description = `
## Command Behavior

**Freezes Salesforce user logins, temporarily revoking access for selected users.**

This command allows administrators to freeze Salesforce user logins. It provides a controlled way to temporarily revoke user access without deactivating the user record itself. This is useful for managing user access during leaves, security incidents, or when a user's access needs to be temporarily suspended.

Key functionalities:

- **User Selection:** You can select users to freeze based on their assigned profiles.
  - \`--includeprofiles\`: Freeze users belonging to a comma-separated list of specified profiles.
  - \`--excludeprofiles\`: Freeze users belonging to all profiles *except* those specified in a comma-separated list.
  - If no profile flags are provided, an interactive menu will allow you to select profiles.
- **Interactive Confirmation:** In non-CI environments, it prompts for confirmation before freezing the selected users.
- **Bulk Freezing:** Efficiently freezes multiple user logins using Salesforce's Bulk API.
- **Reporting:** Generates CSV and XLSX reports of the users that are about to be frozen.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SOQL Queries (Bulk API):** It executes SOQL queries against the \`User\` and \`Profile\` objects to identify active users based on the provided profile filters. It then queries the \`UserLogin\` object to find active login sessions for these users.
- **Interactive Prompts:** Uses the \`prompts\` library to guide the user through profile selection and to confirm the freezing operation.
- **Bulk Update:** It constructs an array of \`UserLogin\` records with their \`Id\` and \`IsFrozen\` set to \`true\`, then uses \`bulkUpdate\` to perform the mass update operation on the Salesforce org.
- **Reporting:** It uses \`generateReports\` to create CSV and XLSX files containing details of the users to be frozen.
- **Logging:** Provides clear messages about the number of users found and the success of the freezing process.
</details>
`;

  public static examples = [
    `$ sf hardis:org:user:freeze`,
    `$ sf hardis:org:user:freeze --target-org my-user@myorg.com`,
    `$ sf hardis:org:user:freeze --includeprofiles 'Standard'`,
    `$ sf hardis:org:user:freeze --excludeprofiles 'System Administrator,Some Other Profile'`,
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
      description: 'List of profiles that you want to freeze, separated by commas',
    }),
    excludeprofiles: Flags.string({
      char: 'e',
      description: 'List of profiles that you want to NOT freeze, separated by commas',
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
    const { flags } = await this.parse(OrgFreezeUser);
    const includeProfileNames = flags.includeprofiles ? flags.includeprofiles.split(',') : [];
    const excludeProfileNames = flags.excludeprofiles ? flags.excludeprofiles.split(',') : [];
    this.maxUsersDisplay = flags.maxuserdisplay || 100;
    this.debugMode = flags.debug || false;

    const conn = flags['target-org'].getConnection();

    // Select profiles that we want users to be frozen
    let profileIds: any[] = [];
    let profileNames: any[] = [];
    if (includeProfileNames.length === 0 && excludeProfileNames.length === 0) {
      // Manual user selection
      const profilesRes = await promptProfiles(conn, {
        multiselect: true,
        message: 'Please select profiles that you do you want to freeze users that are assigned to them ?',
        returnField: 'record',
        allowSelectMine: false,
        allowSelectMineErrorMessage: "If you freeze your own profile, you'll be unable to unfreeze it later 😊",
        allowSelectAll: false,
        allowSelectAllErrorMessage:
          'You can not select all profiles, keep at least one (usually System Administrator) so you can unfreeze later !',
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
        uxLog("log", this, c.grey(`Query result:\n${JSON.stringify(profilesQueryRes, null, 2)}`));
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
        uxLog("log", this, c.grey(`Query result:\n${JSON.stringify(profilesQueryRes, null, 2)}`));
      }
      profileIds = profilesQueryRes.records.map((profile) => profile.Id);
      profileNames = profilesQueryRes.records.map((profile) => {
        return [profile.Id, profile.Name];
      });
    }

    // List profiles that must be frozen
    const profileIdsStr = profileIds.map((profileId) => `'${profileId}'`).join(',');

    // Query users that we want to freeze
    uxLog("action", this, c.cyan(`Querying User records matching ${c.bold(profileIds.length)} profiles...`));
    const userQuery = `SELECT Id,Name,Username,ProfileId FROM User WHERE ProfileId IN (${profileIdsStr}) and IsActive=true`;
    const userQueryRes = await bulkQuery(userQuery, conn);
    const usersToFreeze = userQueryRes.records;
    const userIdsStr = usersToFreeze.map((user) => `'${user.Id}'`).join(',');

    // Check empty result
    if (usersToFreeze.length === 0) {
      const outputString = `No matching user records found with defined profile constraints`;
      uxLog("warning", this, c.yellow(outputString));
      return { outputString };
    }

    // Query related UserLogin records
    uxLog("action", this, c.cyan(`Querying UserLogin records matching ${c.bold(usersToFreeze.length)} users...`));
    const userLoginQuery = `SELECT Id,UserId,IsFrozen FROM UserLogin WHERE UserId IN (${userIdsStr}) and IsFrozen=false`;
    const userLoginQueryRes = await bulkQuery(userLoginQuery, conn);
    const userLoginsToFreeze = userLoginQueryRes.records;

    // Display list of users to freeze
    const usersToFreezeDisplay = userLoginsToFreeze.map((userLogin: any) => {
      const matchingUser = usersToFreeze.filter((user) => user.Id === userLogin.UserId)[0];
      return {
        Username: matchingUser.Username,
        Name: matchingUser.Name,
        Profile: profileNames.filter((profile) => profile[0] === matchingUser.ProfileId)[1],
      };
    });
    uxLog("action", this, c.cyan(`List of ${userLoginsToFreeze.length} users that will be frozen:`));
    uxLogTable(
      this,
      this.debugMode ? usersToFreezeDisplay : usersToFreezeDisplay.slice(0, this.maxUsersDisplay)
    );
    if (!this.debugMode && usersToFreezeDisplay.length > this.maxUsersDisplay) {
      uxLog("warning", this, c.yellow(c.italic(`(list truncated to the first ${this.maxUsersDisplay} users)`)));
    }

    // Generate csv + xls of users about to be frozen
    await generateReports(usersToFreezeDisplay, ['Username', 'Name', 'Profile'], this, {
      logFileName: 'users-to-freeze',
      logLabel: 'Extract of users to freeze',
    });

    // Request configuration from user
    if (!isCI) {
      const confirmfreeze = await prompts({
        type: 'confirm',
        name: 'value',
        initial: true,
        message: c.cyanBright(
          `Are you sure you want to freeze these ${c.bold(userLoginsToFreeze.length)} users in org ${c.green(
            flags['target-org'].getUsername()
          )} ?`
        ),
        description: 'Confirm freezing selected users, which will deactivate their accounts in the Salesforce org',
      });
      if (confirmfreeze.value !== true) {
        const outputString = 'Script cancelled by user.';
        uxLog("warning", this, c.yellow(outputString));
        return { outputString };
      }
    }

    // Process UserLogin freezing
    const userLoginsFrozen = userLoginsToFreeze.map((userLogin) => {
      return { Id: userLogin.Id, IsFrozen: true };
    });
    const bulkUpdateRes = await bulkUpdate('UserLogin', 'update', userLoginsFrozen, conn);

    const freezeSuccessNb = bulkUpdateRes.successfulResults.length;
    const freezeErrorsNb = bulkUpdateRes.failedResults.length;
    if (freezeErrorsNb > 0) {
      uxLog("warning", this, c.yellow(`Warning: ${c.red(c.bold(freezeErrorsNb))} users has not been frozen (bulk API errors)`));
    }

    // Build results summary
    uxLog("success", this, c.green(`${c.bold(freezeSuccessNb)} users has been be frozen.`));

    // Return an object to be displayed with --json
    return {
      orgId: flags['target-org'].getOrgId(),
      freezeSuccess: freezeSuccessNb,
      freezeErrors: freezeErrorsNb,
      outputString: `${freezeSuccessNb} users has been be frozen`,
    };
  }
}
