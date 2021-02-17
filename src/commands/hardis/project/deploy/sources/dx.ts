/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import { execJson } from '../../../../../common/utils';
import { getConfig } from '../../../../../config';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DxSources extends SfdxCommand {
  public static title = 'Deploy sfdx sources to org';

  public static description = messages.getMessage('deployDx');

  public static examples = ['$ sfdx hardis:project:deploy:sources:dx'];

  protected static flagsConfig = {
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
  protected static requiresProject = true;

  protected configInfo: any = {};

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const debug = this.flags.debug || false;

    this.configInfo = await getConfig('branch');
    const packageXmlFile =
      process.env.PACKAGE_XML_TO_DEPLOY ||
      this.configInfo.packageXmlToDeploy ||
      './config/package.xml';
    const deployCommand = `sfdx force:source:deploy -x ${packageXmlFile} ${debug ? '--verbose' : ''
      }`;
    const deployRes = await execJson(deployCommand, this);
    let message = '';
    if (deployRes.status === 0) {
      message = '[sfdx-hardis] Successfully deployed sfdx project sources to Salesforce org';
      this.ux.log(c.green(message));
    }
    else {
      message = '[sfdx-hardis] Unable to deploy sfdx project sources to Salesforce org';
      this.ux.log(c.red(deployRes.errorMessage));
    }
    return { orgId: this.org.getOrgId(), outputString: message };
  }
}
