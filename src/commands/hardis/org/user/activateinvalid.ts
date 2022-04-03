/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as columnify from "columnify";
import { isCI, uxLog } from "../../../../common/utils";
import { prompts } from "../../../../common/utils/prompts";
import { bulkQuery, bulkUpdate } from "../../../../common/utils/apiUtils";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class OrgUserActiveInvalid extends SfdxCommand {
  public static title = "Reactivate sandbox invalid users";

  public static description = `Update sandbox users so their email is valid

  Example: replaces toto@company.com.dev.invalid with toto@company.com.dev.invalid
`;

  public static examples = [`$ sfdx hardis:org:user:activateinvalid`, `$ sfdx hardis:org:user:activateinvalid --targetusername myuser@myorg.com`];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
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
    this.debugMode = this.flags.debug || false;

    const conn = this.org.getConnection();

    // Query users that we want to freeze
    uxLog(this, c.cyan(`Querying User records with email ending with .invalid...`));
    const userQuery = `SELECT Id,Name,Username,Email FROM User WHERE Email LIKE '%.invalid' and IsActive=true`;
    const userQueryRes = await bulkQuery(userQuery, conn);
    const usersToActivate = userQueryRes.records;

    // Check empty result
    if (usersToActivate.length === 0) {
      const outputString = `No matching user records found with email ending with .invalid`;
      uxLog(this, c.yellow(outputString));
      return { outputString };
    }

    // Request configuration from user
    if (!isCI) {
      const confirmfreeze = await prompts({
        type: "confirm",
        name: "value",
        initial: true,
        message: c.cyanBright(
          `Are you sure you want to replace invalid mails by valid mails for these ${c.bold(usersToActivate.length)} users in org ${c.green(
            this.org.getUsername()
          )} (y/n)?`
        ),
      });
      if (confirmfreeze.value !== true) {
        const outputString = "Script cancelled by user";
        uxLog(this, c.yellow(outputString));
        return { outputString };
      }
    }

    // Process invalid users reactivation
    const userToActivateUpdated = usersToActivate.map((user) => {
      const emailReplaced = user.Email.replace(".invalid", "");
      return { Id: user.Id, Email: emailReplaced };
    });
    const bulkUpdateRes = await bulkUpdate("User", "update", userToActivateUpdated, conn);

    uxLog(this, "\n" + c.white(columnify(this.debugMode ? userToActivateUpdated : userToActivateUpdated.slice(0, this.maxUsersDisplay))));

    const activateSuccessNb = bulkUpdateRes.successRecordsNb;
    const activateErrorNb = bulkUpdateRes.errorRecordsNb;
    if (activateErrorNb > 0) {
      uxLog(this, c.yellow(`Warning: ${c.red(c.bold(activateErrorNb))} users has not been reactivated (bulk API errors)`));
    }

    // Build results summary
    uxLog(this, c.green(`${c.bold(activateSuccessNb)} users has been be reactivated.`));

    // Return an object to be displayed with --json
    return {
      orgId: this.org.getOrgId(),
      activateSuccessNb: activateSuccessNb,
      activateErrorNb: activateErrorNb,
      outputString: `${activateSuccessNb} sandbox users has been be reactivated`,
    };
  }
}
