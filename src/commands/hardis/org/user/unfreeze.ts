/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages /*, SfdxError*/ } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as columnify from "columnify";
import { isCI, uxLog } from "../../../../common/utils";
import { prompts } from "../../../../common/utils/prompts";
import { soqlQuery } from "../../../../common/utils/queryUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class OrgUnfreezeUser extends SfdxCommand {
  public static title = "Unfreeze users logins";

  public static description = messages.getMessage("orgUnfreezeUser");

  public static examples = [
    `$ sfdx hardis:org:user:unfreeze`,
    `$ sfdx hardis:org:user:unfreeze --targetusername myuser@myorg.com`,
    `$ sfdx hardis:org:user:unfreeze --except 'System Administrator,Some Other Profile'`,
  ];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    name: flags.string({
      char: "n",
      description: messages.getMessage("nameFilter"),
    }),
    except: flags.string({
      char: "e",
      default: "System Administrator,Administrateur système",
      description: messages.getMessage("exceptFilter"),
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
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  // protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  protected maxUsersDisplay = 100;
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const exceptProfilesFilter = this.flags.except ? this.flags.except.split(",") : ["System Administrator", "Administrateur système"];
    const nameFilter = this.flags.name || null;
    this.maxUsersDisplay = this.flags.maxuserdisplay || 100;
    this.debugMode = this.flags.debug || false;

    const conn = this.org.getConnection();

    // List all UserLogin related to Users matching profile constraint
    const profilesConstraintIn = exceptProfilesFilter.map((profileName) => `'${profileName}'`).join(",");
    let queryUserLogin = `select id, isFrozen, UserId from UserLogin where userid in (select id from user where profile.name NOT IN (${profilesConstraintIn}) and isactive=true`;
    if (nameFilter) {
      queryUserLogin += " AND Name LIKE '%" + nameFilter + "%'";
    }
    queryUserLogin += ") AND isfrozen=true";
    const queryUserLoginResult = await soqlQuery(queryUserLogin, conn);
    if (this.debugMode) {
      uxLog(this, c.grey(`Query result:\n${JSON.stringify(queryUserLoginResult, null, 2)}`));
    }
    const userLogins = queryUserLoginResult.records;

    // List all users matching UserLogins
    const userIdsConstraint = userLogins.map((userLogin) => `'${userLogin.UserId}'`).join(",");
    const queryUsers = `SELECT Id,Name,Username,Profile.Name FROM User WHERE Id IN (${userIdsConstraint}) ORDER BY Profile.Name,Username`;
    const queryUsersRes = await soqlQuery(queryUsers, conn);
    if (this.debugMode) {
      uxLog(this, c.grey(`Query result:\n${JSON.stringify(queryUsersRes, null, 2)}`));
    }
    const usersToUnfreeze = queryUsersRes.records;

    // Check empty result
    if (usersToUnfreeze.length === 0) {
      const outputString = `No matching user records found for all profiles except ${exceptProfilesFilter}`;
      uxLog(this, c.yellow(outputString));
      return { outputString };
    }

    // Display list of users to unfreeze
    const usersToUnfreezeDisplay = usersToUnfreeze.map((user: any) => {
      return {
        Username: user.Username,
        Name: user.Name,
        Profile: user.Profile.Name,
      };
    });
    uxLog(this, "\n" + c.white(columnify(this.debugMode ? usersToUnfreezeDisplay : usersToUnfreezeDisplay.slice(0, this.maxUsersDisplay))));
    if (!this.debugMode === false && usersToUnfreezeDisplay.length > this.maxUsersDisplay) {
      uxLog(this, c.yellow(c.italic(`(list truncated to the first ${this.maxUsersDisplay} users)`)));
    }
    uxLog(this, c.cyan(`${c.bold(usersToUnfreezeDisplay.length)} users can be unfrozen.`));

    // Request configuration from user
    if (!isCI) {
      const confirmfreeze = await prompts({
        type: "confirm",
        name: "value",
        initial: true,
        message: c.cyanBright(
          `Are you sure you want to unfreeze these ${c.bold(usersToUnfreeze.length)} users in org ${c.green(this.org.getUsername())} (y/n)?`
        ),
      });
      if (confirmfreeze.value !== true) {
        const outputString = "Script cancelled by user";
        uxLog(this, c.yellow(outputString));
        return { outputString };
      }
    }

    // Process UserLogin freezing
    const updatedUserLogins = userLogins.map((userLogin) => {
      const userLoginClone = Object.assign({}, userLogin);
      userLoginClone.IsFrozen = false;
      delete userLoginClone.UserId;
      return userLoginClone;
    });
    const unfreezeUserLoginResults: any[] = await (conn as any).sobject("UserLogin").update(updatedUserLogins);
    if (this.debugMode) {
      uxLog(this, c.grey(`Query result:\n${JSON.stringify(unfreezeUserLoginResults, null, 2)}`));
    }
    const unfreezeSuccess = unfreezeUserLoginResults.filter((unfreezeResult) => unfreezeResult.success === true);
    const unfreezeErrors = unfreezeUserLoginResults.filter((unfreezeResult) => !(unfreezeResult.success === true));
    if (unfreezeErrors.length > 0) {
      uxLog(this, c.yellow(`Warning: ${c.red(c.bold(unfreezeErrors.length))} users has not been unfrozen`));
    }

    // Build results summary
    const usersUnfrozenDisplay = unfreezeSuccess.map((unfreezeResult) => {
      const unfrozenUserLogin = userLogins.filter((userLogin) => userLogin.Id === unfreezeResult.id)[0];
      const unfrozenUser = usersToUnfreeze.filter((user) => unfrozenUserLogin.UserId === user.Id)[0];
      return {
        Username: unfrozenUser.Username,
        Name: unfrozenUser.Name,
        Profile: unfrozenUser.Profile.Name,
      };
    });
    uxLog(this, "\n" + c.white(columnify(this.debugMode ? usersUnfrozenDisplay : usersUnfrozenDisplay.slice(0, this.maxUsersDisplay))));
    if (!this.debugMode === false && usersUnfrozenDisplay.length > this.maxUsersDisplay) {
      uxLog(this, c.yellow(c.italic(`(list truncated to the first ${this.maxUsersDisplay} users)`)));
    }
    uxLog(this, c.green(`${c.bold(usersUnfrozenDisplay.length)} has been unfrozen.`));

    // Return an object to be displayed with --json
    return {
      orgId: this.org.getOrgId(),
      unfrozenUsersDiplay: usersUnfrozenDisplay,
      unfreezeSuccess: unfreezeSuccess,
      unfreezeErrors: unfreezeErrors,
      outputString: `${usersUnfrozenDisplay.length} users has been be unfrozen`,
    };
  }
}
