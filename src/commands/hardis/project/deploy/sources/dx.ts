/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { execCommand } from '../../../../../common/utils';
import { CONSTANTS, getConfig } from '../../../../../config';

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

  // Comment this out if your command does not support a hub org username
  // protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  protected configInfo: any = {};

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const check = this.flags.check || false;
    const testlevel = this.flags.testlevel || 'RunLocalTests';
    const debug = this.flags.debug || false;

    // Deploy destructive changes
    const packageDeletedXmlFile =
      process.env.PACKAGE_XML_TO_DELETE ||
      this.configInfo.packageXmlToDelete ||
      (fs.existsSync('./manifest/destructiveChanges.xml')) ? './manifest/destructiveChanges.xml' :
      './config/destructiveChanges.xml';
    if (fs.existsSync(packageDeletedXmlFile)) {
      // Create empty deployment file because of sfdx limitation
      // cf https://gist.github.com/benahm/b590ecf575ff3c42265425233a2d727e
      this.ux.log(`[sfdx-hardis] Deploying destructive changes from file ${path.resolve(packageDeletedXmlFile)}`);
      const tmpDir = path.join(os.tmpdir(), 'sfdx-hardis-' + parseFloat(Math.random().toString()));
      await fs.ensureDir(tmpDir);
      const emptyPackageXmlFile = path.join(tmpDir, 'package.xml');
      await fs.writeFile(emptyPackageXmlFile,
        `<?xml version="1.0" encoding="UTF-8"?>
        <Package xmlns="http://soap.sforce.com/2006/04/metadata">
          <version>${CONSTANTS.API_VERSION}</version>
        </Package>`, 'utf8');
      await fs.copy(packageDeletedXmlFile, path.join(tmpDir, 'destructiveChanges.xml'));
      const deployDelete = `sfdx force:mdapi:deploy -d ${tmpDir}` +
        ' --wait 60' +
        ' --testlevel NoTestRun' +
        ' --ignorewarnings' + // So it does not fail in case metadata is already deleted
        (check ? ' --checkonly' : '') +
        (debug ? ' --verbose' : '');
      const deployDeleteRes = await execCommand(deployDelete, this, {output: true, debug, fail: true});
      await fs.remove(tmpDir);
      let deleteMsg = '';
      if (deployDeleteRes.status === 0) {
        deleteMsg = '[sfdx-hardis] Successfully deployed destructive changes to Salesforce org';
        this.ux.log(c.green(deleteMsg));
      } else {
        deleteMsg = '[sfdx-hardis] Unable to deploy destructive changes to Salesforce org';
        this.ux.log(c.red(deployDeleteRes.errorMessage));
      }
    }

    // Deploy sources
    this.configInfo = await getConfig('branch');
    const packageXmlFile =
      process.env.PACKAGE_XML_TO_DEPLOY ||
      this.configInfo.packageXmlToDeploy ||
      (fs.existsSync('./manifest/package.xml')) ? './manifest/package.xml' :
      './config/package.xml';
    const deployCommand = `sfdx force:source:deploy -x ${packageXmlFile}` +
      ' --wait 60' +
      ` --testlevel ${testlevel}` +
      (check ? ' --checkonly' : '') +
      (debug ? ' --verbose' : '');
    const deployRes = await execCommand(deployCommand, this, {output: true, debug, fail: true});
    let message = '';
    if (deployRes.status === 0) {
      message = '[sfdx-hardis] Successfully deployed sfdx project sources to Salesforce org';
      this.ux.log(c.green(message));
    } else {
      message = '[sfdx-hardis] Unable to deploy sfdx project sources to Salesforce org';
      this.ux.log(c.red(deployRes.errorMessage));
    }
    return { orgId: this.org.getOrgId(), outputString: message };
  }
}
