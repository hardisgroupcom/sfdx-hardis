import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import { execSfdxJson } from '../../../../common/utils';
import { getConfig } from '../../../../config';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgTestApex extends SfdxCommand {
  public static title = 'Run apex tests';

  public static description = messages.getMessage('apexTests');

  public static examples = ['$ sfdx hardis:org:test:apex'];

  protected static flagsConfig = {
    testlevel: flags.enum({
      char: 'l',
      default: 'RunLocalTests',
      options: ['NoTestRun', 'RunSpecifiedTests', 'RunLocalTests', 'RunAllTestsInOrg'],
      description: messages.getMessage('testLevel')
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
  // protected static requiresProject = true;

  protected configInfo: any = {};

  public async run(): Promise<AnyJson> {
    const check = this.flags.check || false;
    const testlevel = this.flags.testlevel || 'RunLocalTests';
    const debug = this.flags.debug || false;

    this.configInfo = await getConfig('branch');
    const testCommand = 'sfdx force:apex:test:run' +
      ' --codecoverage' +
      ' --resultformat human' +
      ' --outputdir ./hardis-report' +
      ' --wait 60' +
      ` --testlevel ${testlevel}` +
      (check ? ' --checkonly' : '') +
      (debug ? ' --verbose' : '');
    const testRes = await execSfdxJson(testCommand, this, { output: true, debug, fail: true });
    let message = '';
    if (testRes.status === 0) {
      message = '[sfdx-hardis] Successfully tested orgs';
      this.ux.log(c.green(message));
    } else {
      message = '[sfdx-hardis] Test org failure';
      this.ux.log(c.red(testRes.message));
    }
    return { orgId: this.org.getOrgId(), outputString: message };
  }
}
