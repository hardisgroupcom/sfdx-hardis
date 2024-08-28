/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import * as columnify from 'columnify';
import sortArray from 'sort-array';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { bulkQuery, bulkUpdate, soqlQuery } from '../../../../common/utils/apiUtils.js';
import { promptProfiles } from '../../../../common/utils/orgUtils.js';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgUserActiveInvalid extends SfCommand<any> {
  public static title = 'Reactivate sandbox invalid users';

  public static description = `Update sandbox users so their email is valid

  Example: replaces \`toto@company.com.dev.invalid\` with \`toto@company.com.dev.invalid\`

See article below

[![Reactivate all the sandbox users with .invalid emails in 3 clicks](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-invalid-email.jpg)](https://nicolas.vuillamy.fr/reactivate-all-the-sandbox-users-with-invalid-emails-in-3-clicks-2265af4e3a3d)
`;

  public static examples = [
    `$ sf hardis:org:user:activateinvalid`,
    `$ sf hardis:org:user:activateinvalid --targetusername myuser@myorg.com`,
    `$ sf hardis:org:user:activateinvalid --profiles 'System Administrator,MyCustomProfile' --targetusername myuser@myorg.com`,
  ];

  // public static args = [{name: 'file'}];

  public static flags = {
    profiles: Flags.string({
      char: 'p',
      description:
        'Comma-separated list of profiles names that you want to reactive users assigned to and with a .invalid email',
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

  protected profiles: any[] = [];
  protected maxUsersDisplay = 100;
  protected debugMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgUserActiveInvalid);
    this.profiles = flags.profiles ? flags.profiles.split(',') : [];
    const hasProfileConstraint = this.profiles !== null;
    this.debugMode = flags.debug || false;

    const conn = flags['target-org'].getConnection();

    // Query users that we want to freeze
    uxLog(this, c.cyan(`Querying User records with email ending with .invalid...`));
    let userQuery = `SELECT Id,Name,Username,Email,ProfileId FROM User WHERE Email LIKE '%.invalid' and IsActive=true`;
    if (hasProfileConstraint) {
      const profilesQuery = `SELECT Id FROM Profile WHERE Name IN ('${this.profiles.join("','")}')`;
      const profilesQueryRes = await soqlQuery(profilesQuery, conn);
      const profileIds = profilesQueryRes.records.map((profile) => profile.Id);
      userQuery += ` and ProfileId IN ('${profileIds.join("','")}')`;
    }
    const userQueryRes = await bulkQuery(userQuery, conn);
    const usersToActivate = userQueryRes.records;

    // Check empty result
    if (usersToActivate.length === 0) {
      const outputString = `No matching user records found with email ending with .invalid`;
      uxLog(this, c.yellow(outputString));
      return { outputString };
    }

    let usersToActivateFinal = [...usersToActivate];
    // Request confirmation or selection from user
    if (!isCI && !hasProfileConstraint) {
      const confirmSelect = await prompts({
        type: 'select',
        name: 'value',
        initial: true,
        message: c.cyanBright(
          `Do you want to replace invalid mails by valid mails for all ${c.bold(
            usersToActivate.length
          )} found users in org ${c.green(flags['target-org'].getUsername())} ?`
        ),
        choices: [
          { title: `Yes, all ${c.bold(usersToActivate.length)} users`, value: 'all' },
          { title: 'No, i want to manually select by profile(s)', value: 'selectProfiles' },
          { title: 'No, i want to manually select user(s)', value: 'select' },
        ],
      });
      // Let users select profiles to reactivate users
      if (confirmSelect.value === 'selectProfiles') {
        const selectedProfileIds = await promptProfiles(flags['target-org'].getConnection(), {
          multiselect: true,
          returnField: 'Id',
          message: 'Please select profiles that you want to reactivate users with .invalid emails',
        });
        usersToActivateFinal = usersToActivateFinal.filter((user) => selectedProfileIds.includes(user.ProfileId));
      }
      // Let users select users to reactivate
      else if (confirmSelect.value === 'select') {
        const usersSorted = sortArray(usersToActivate, {
          by: ['Name', 'Email'],
          order: ['asc'],
        });
        const selectUsers = await prompts({
          type: 'multiselect',
          name: 'value',
          message: 'Please select users that you want to remove the .invalid from emails',
          choices: usersSorted.map((user: any) => {
            return { title: `${user.Name} - ${user.Email}`, value: user };
          }),
        });
        usersToActivateFinal = selectUsers.value;
      } else if (confirmSelect.value !== 'all') {
        const outputString = 'Script cancelled by user';
        uxLog(this, c.yellow(outputString));
        return { outputString };
      }
    }

    // Process invalid users reactivation
    const userToActivateUpdated = usersToActivateFinal.map((user) => {
      const emailReplaced = user.Email.replace('.invalid', '');
      return { Id: user.Id, Email: emailReplaced };
    });
    const bulkUpdateRes = await bulkUpdate('User', 'update', userToActivateUpdated, conn);

    uxLog(
      this,
      '\n' +
        c.white(
          columnify(this.debugMode ? userToActivateUpdated : userToActivateUpdated.slice(0, this.maxUsersDisplay))
        )
    );

    const activateSuccessNb = bulkUpdateRes.successRecordsNb;
    const activateErrorNb = bulkUpdateRes.errorRecordsNb;
    if (activateErrorNb > 0) {
      uxLog(
        this,
        c.yellow(`Warning: ${c.red(c.bold(activateErrorNb))} users has not been reactivated (bulk API errors)`)
      );
    }

    // Build results summary
    uxLog(
      this,
      c.green(`${c.bold(activateSuccessNb)} users has been be reactivated by removing the .invalid of their email`)
    );

    // Return an object to be displayed with --json
    return {
      orgId: flags['target-org'].getOrgId(),
      activateSuccessNb: activateSuccessNb,
      activateErrorNb: activateErrorNb,
      outputString: `${activateSuccessNb} sandbox users has been be reactivated by removing the .invalid of their email`,
    };
  }
}
