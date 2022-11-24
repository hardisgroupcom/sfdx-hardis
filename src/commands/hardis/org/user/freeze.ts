/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as columnify from "columnify";
import { generateReports, isCI, uxLog } from "../../../../common/utils";
import { promptProfiles } from "../../../../common/utils/orgUtils";
//import { executeApex } from "../../../../common/utils/deployUtils";
import { prompts } from "../../../../common/utils/prompts";
import { soqlQuery, bulkQuery, bulkUpdate } from "../../../../common/utils/apiUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class OrgFreezeUser extends SfdxCommand {
  public static title = "Freeze user logins";

  public static description = messages.getMessage("orgfreezeUser");

  public static examples = [
    `$ sfdx hardis:org:user:freeze`,
    `$ sfdx hardis:org:user:freeze --targetusername myuser@myorg.com`,
    `$ sfdx hardis:org:user:freeze --includeprofiles 'Standard'`,
    `$ sfdx hardis:org:user:freeze --excludeprofiles 'System Administrator,Some Other Profile'`,
  ];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    name: flags.string({
      char: "n",
      description: messages.getMessage("nameFilter"),
    }),
    includeprofiles: flags.string({
      char: "p",
      description: "List of profiles that you want to freeze, separated by commas",
    }),
    excludeprofiles: flags.string({
      char: "e",
      description: "List of profiles that you want to NOT freeze, separated by commas",
    }),
    maxuserdisplay: flags.number({
      char: "m",
      default: 100,
      description: "Maximum users to display in logs",
    }),
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  // protected static requiresDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  protected maxUsersDisplay = 100;
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const includeProfileNames = this.flags.includeprofiles ? this.flags.includeprofiles.split(",") : [];
    const excludeProfileNames = this.flags.excludeprofiles ? this.flags.excludeprofiles.split(",") : [];
    this.maxUsersDisplay = this.flags.maxuserdisplay || 100;
    this.debugMode = this.flags.debug || false;

    const conn = this.org.getConnection();

    // Select profiles that we want users to be frozen
    let profileIds = [];
    let profileNames = [];
    if (includeProfileNames.length === 0 && excludeProfileNames.length === 0) {
      // Manual user selection
      const profilesRes = await promptProfiles(conn, {
        multiselect: true,
        message: "Please select profiles that you do you want to freeze users that are assigned to them ?",
        returnField: "record",
        allowSelectMine: false,
        allowSelectMineErrorMessage: "If you freeze your own profile, you'll be unable to unfreeze it later :)",
        allowSelectAll: false,
        allowSelectAllErrorMessage: "You can not select all profiles, keep at least one (usually System Administrator) so you can unfreeze later !",
      });
      profileIds = profilesRes.map((profile) => profile.Id);
      profileNames = profilesRes.map((profile) => {
        return [profile.Id, profile.Name];
      });
    } else if (includeProfileNames.length > 0) {
      // Use includeprofiles argument
      const profilesConstraintIn = includeProfileNames.map((profileName) => `'${profileName}'`).join(",");
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
      const profilesConstraintIn = excludeProfileNames.map((profileName) => `'${profileName}'`).join(",");
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

    // List profiles that must be frozen
    const profileIdsStr = profileIds.map((profileId) => `'${profileId}'`).join(",");

    // Query users that we want to freeze
    uxLog(this, c.cyan(`Querying User records matching ${c.bold(profileIds.length)} profiles...`));
    const userQuery = `SELECT Id,Name,Username,ProfileId FROM User WHERE ProfileId IN (${profileIdsStr}) and IsActive=true`;
    const userQueryRes = await bulkQuery(userQuery, conn);
    const usersToFreeze = userQueryRes.records;
    const userIdsStr = usersToFreeze.map((user) => `'${user.Id}'`).join(",");

    // Check empty result
    if (usersToFreeze.length === 0) {
      const outputString = `No matching user records found with defined profile constraints`;
      uxLog(this, c.yellow(outputString));
      return { outputString };
    }

    // Query related UserLogin records
    uxLog(this, c.cyan(`Querying UserLogin records matching ${c.bold(usersToFreeze.length)} users...`));
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
    uxLog(this, "\n" + c.white(columnify(this.debugMode ? usersToFreezeDisplay : usersToFreezeDisplay.slice(0, this.maxUsersDisplay))));
    if (!this.debugMode === false && usersToFreezeDisplay.length > this.maxUsersDisplay) {
      uxLog(this, c.yellow(c.italic(`(list truncated to the first ${this.maxUsersDisplay} users)`)));
    }
    uxLog(this, c.cyan(`${c.bold(userLoginsToFreeze.length)} users can be frozen.`));
    // Generate csv + xls of users about to be frozen
    await generateReports(usersToFreezeDisplay, ["Username", "Name", "Profile"], this, {
      logFileName: "users-to-freeze",
      logLabel: "Extract of users to freeze",
    });

    // Request configuration from user
    if (!isCI) {
      const confirmfreeze = await prompts({
        type: "confirm",
        name: "value",
        initial: true,
        message: c.cyanBright(
          `Are you sure you want to freeze these ${c.bold(userLoginsToFreeze.length)} users in org ${c.green(this.org.getUsername())} (y/n)?`
        ),
      });
      if (confirmfreeze.value !== true) {
        const outputString = "Script cancelled by user";
        uxLog(this, c.yellow(outputString));
        return { outputString };
      }
    }

    // Process UserLogin freezing
    const userLoginsFrozen = userLoginsToFreeze.map((userLogin) => {
      return { Id: userLogin.Id, IsFrozen: true };
    });
    const bulkUpdateRes = await bulkUpdate("UserLogin", "update", userLoginsFrozen, conn);

    const freezeSuccessNb = bulkUpdateRes.successRecordsNb;
    const freezeErrorsNb = bulkUpdateRes.errorRecordsNb;
    if (freezeErrorsNb > 0) {
      uxLog(this, c.yellow(`Warning: ${c.red(c.bold(freezeErrorsNb))} users has not been frozen (bulk API errors)`));
    }

    // Build results summary
    uxLog(this, c.green(`${c.bold(freezeSuccessNb)} users has been be frozen.`));

    // Return an object to be displayed with --json
    return {
      orgId: this.org.getOrgId(),
      freezeSuccess: freezeSuccessNb,
      freezeErrors: freezeErrorsNb,
      outputString: `${freezeSuccessNb} users has been be frozen`,
    };
  }
}
