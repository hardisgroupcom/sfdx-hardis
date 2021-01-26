import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class Org extends SfdxCommand {

  public static description = messages.getMessage('orgPurgeFlow');

  public static examples = [
  `$ sfdx org:purge:flow --targetusername myOrg@example.com --targetdevhubusername devhub@org.com
  Hello world! This is org: MyOrg and I will be around until Tue Mar 20 2018!
  My hub org id is: 00Dxx000000001234
  `,
  `$ sfdx hello:org --name myname --targetusername myOrg@example.com
  Hello myname! This is org: MyOrg and I will be around until Tue Mar 20 2018!
  `
  ];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    noprompt: flags.boolean({char: 'z', description: messages.getMessage('noPrompt')})
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  // protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  public async run(): Promise<AnyJson> {
    const prompt = (this.flags.noprompt === true)?false:true;

    // this.org is guaranteed because requiresUsername=true, as opposed to supportsUsername
    const conn = this.org.getConnection();
    const query = "SELECT Id,Status FROM Flow WHERE Status = 'Obsolete'";

    // The type we are querying for
    interface Flow {
      Id: string;
      Status: string;
    }

    // Query the org
    const flowQueryResult = await conn.query<Flow>(query);

    // No records has been found
    if (!flowQueryResult.records || flowQueryResult.records.length <= 0) {
        const outputString = `No matching Flow records found with query "${query}"` ;
        this.ux.log(outputString);
        return { deleted: [] , outputString}
    }

    // Prompt
    if (prompt === false || await this.ux.confirm("Are you sure you want to permanently delete the following records ?")) {
        for (const flow of flowQueryResult.records) {

        }
    }

    // Return an object to be displayed with --json
    return { orgId: this.org.getOrgId(), outputString };
  }
}
