/* jscpd:ignore-start */

import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import * as fs from 'fs-extra';
import { MetadataUtils } from '../../../../../common/metadata-utils';
import { execCommand, uxLog } from '../../../../../common/utils';
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
    check: flags.boolean({
      char: 'c',
      default: false,
      description: messages.getMessage('checkOnly')
    }),
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

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  protected configInfo: any = {};

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.configInfo = await getConfig('branch');
    const check = this.flags.check || false;
    const testlevel = this.flags.testlevel || 'RunLocalTests';
    const debugMode = this.flags.debug || false;

    // Install packages
    const packages = this.configInfo.installedPackages || [];
    if (packages.length > 0 && !check) {
      // Install package only if we are in real deployment mode
      await MetadataUtils.installPackagesOnOrg(packages, null, this);
    }

    // Deploy destructive changes
    const packageDeletedXmlFile =
      process.env.PACKAGE_XML_TO_DELETE ||
        this.configInfo.packageXmlToDelete ||
        (fs.existsSync('./manifest/destructiveChanges.xml')) ? './manifest/destructiveChanges.xml' :
        './config/destructiveChanges.xml';
    if (fs.existsSync(packageDeletedXmlFile)) {
      await MetadataUtils.deployDestructiveChanges(packageDeletedXmlFile, { debug: debugMode, check }, this);
    } else {
      uxLog(this, 'No destructivePackage.Xml found so no destructive deployment has been performed');
    }

    // Deploy sources
    const packageXmlFile =
      process.env.PACKAGE_XML_TO_DEPLOY ||
        this.configInfo.packageXmlToDeploy ||
        (fs.existsSync('./manifest/package.xml')) ? './manifest/package.xml' :
        './config/package.xml';
    const deployCommand = `sfdx force:source:deploy -x ${packageXmlFile}` +
      ' --wait 60' +
      ` --testlevel ${testlevel}` +
      (check ? ' --checkonly' : '') +
      (debugMode ? ' --verbose' : '');
    const deployRes = await execCommand(deployCommand, this, { output: true, debug: debugMode, fail: true });
    let message = '';
    if (deployRes.status === 0) {
      message = `[sfdx-hardis] Successfully ${check ? 'checked deployment of' : 'deployed'} sfdx project sources to Salesforce org`;
      uxLog(this, c.green(message));
    } else {
      message = '[sfdx-hardis] Unable to deploy sfdx project sources to Salesforce org';
      uxLog(this, c.red(deployRes.errorMessage));
    }
    return { orgId: this.org.getOrgId(), outputString: message };
  }
}
