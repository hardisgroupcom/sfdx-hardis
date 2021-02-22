/* jscpd:ignore-start */

import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { MetadataUtils } from '../../../../../common/metadata-utils';
import { checkSfdxPlugin, execCommand, uxLog } from '../../../../../common/utils';
import { CONSTANTS, getConfig } from '../../../../../config';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DxSources extends SfdxCommand {
  public static title = 'Deploy metadata sources to org';

  public static description = messages.getMessage('deployMetadatas');

  public static examples = ['$ sfdx hardis:project:deploy:sources:metadata'];

  protected static flagsConfig = {
    check: flags.boolean({
      char: 'c',
      default: false,
      description: messages.getMessage('checkOnly')
    }),
    packagexml: flags.string({
      char: 'p',
      description: 'Path to package.xml file to deploy'
    }),
    filter: flags.boolean({
      char: 'f',
      default: false,
      description: 'Filter metadatas before deploying'
    }),
    destructivepackagexml: flags.string({
      char: 'k',
      description: 'Path to destructiveChanges.xml file to deploy'
    }),
    testlevel: flags.enum({
      char: 'l',
      default: 'RunLocalTests',
      options: [
        'NoTestRun',
        'RunSpecifiedTests',
        'RunLocalTests',
        'RunAllTestsInOrg'
      ],
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
  protected static requiresProject = false;

  protected configInfo: any = {};

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const check = this.flags.check || false;
    const packageXml = this.flags.packagexml || null;
    const filter = this.flags.filter || false ;
    const destructivePackageXml = this.flags.destructivepackagexml || null;
    const testlevel = this.flags.testlevel || 'RunLocalTests';
    const debugMode = this.flags.debug || false;
    this.configInfo = await getConfig('branch');

    const essentialsRes = await checkSfdxPlugin('sfdx-essentials');
    this.ux.log(essentialsRes.message);

    // Install packages
    const packages = this.configInfo.installedPackages || [];
    if (packages.length > 0) {
        await MetadataUtils.installPackagesOnOrg(packages, null, this);
    }

    let destructiveProcessed = false;
    let deployProcessed = false;

    // Deploy destructive changes
    const packageDeletedXmlFile =
      destructivePackageXml ||
      process.env.PACKAGE_XML_TO_DELETE ||
      this.configInfo.packageXmlToDelete ||
      fs.existsSync('./manifest/destructiveChanges.xml')
        ? './manifest/destructiveChanges.xml'
        : fs.existsSync('./destructiveChanges.xml')
        ? './destructiveChanges.xml'
        : './config/destructiveChanges.xml';
    if (fs.existsSync(packageDeletedXmlFile)) {
      // Create empty deployment file because of sfdx limitation
      // cf https://gist.github.com/benahm/b590ecf575ff3c42265425233a2d727e
      this.ux.log(
        `[sfdx-hardis] Deploying destructive changes from file ${path.resolve(
          packageDeletedXmlFile
        )}`
      );
      const tmpDir = path.join(
        os.tmpdir(),
        'sfdx-hardis-' + parseFloat(Math.random().toString())
      );
      await fs.ensureDir(tmpDir);
      const emptyPackageXmlFile = path.join(tmpDir, 'package.xml');
      await fs.writeFile(
        emptyPackageXmlFile,
        `<?xml version="1.0" encoding="UTF-8"?>
        <Package xmlns="http://soap.sforce.com/2006/04/metadata">
          <version>${CONSTANTS.API_VERSION}</version>
        </Package>`,
        'utf8'
      );
      await fs.copy(
        packageDeletedXmlFile,
        path.join(tmpDir, 'destructiveChanges.xml')
      );
      const deployDelete =
        `sfdx force:mdapi:deploy -d ${tmpDir}` +
        ' --wait 60' +
        ' --testlevel NoTestRun' +
        ' --ignorewarnings' + // So it does not fail in case metadata is already deleted
        (check ? ' --checkonly' : '') +
        (debugMode ? ' --verbose' : '');
      const deployDeleteRes = await execCommand(deployDelete, this, {
        output: true,
        debugMode,
        fail: true
      });
      await fs.remove(tmpDir);
      let deleteMsg = '';
      if (deployDeleteRes.status === 0) {
        destructiveProcessed = true;
        deleteMsg =
          '[sfdx-hardis] Successfully deployed destructive changes to Salesforce org';
        this.ux.log(c.green(deleteMsg));
      } else {
        deleteMsg =
          '[sfdx-hardis] Unable to deploy destructive changes to Salesforce org';
        this.ux.log(c.red(deployDeleteRes.errorMessage));
      }
    } else {
      uxLog(
        this,
        'No destructivePackageXml found so no destructive deployment has been performed'
      );
    }

    // Deploy sources
    const packageXmlFile =
      packageXml ||
      process.env.PACKAGE_XML_TO_DEPLOY ||
      this.configInfo.packageXmlToDeploy ||
      fs.existsSync('./manifest/package.xml')
        ? './manifest/package.xml'
        : fs.existsSync('./package.xml')
        ? './package.xml'
        : './config/package.xml';
    if (fs.existsSync(packageXmlFile)) {
        let deployDir = '.';
        // Filter if necessary
        if (filter) {
            const tmpDir = path.join(os.tmpdir(), 'sfdx-hardis-deploy-') + Math.random().toString(36).slice(-5);
            const filterCommand = 'sfdx essentials:metadata:filter-from-packagexml' +
            ` -i ${deployDir}` +
            ` -p ${packageXmlFile}` +
            ` -o ${tmpDir}`;
            deployDir = tmpDir ;
            await execCommand(filterCommand, this, {
                output: true,
                debugMode,
                fail: true
              });
        }
        // Perform deployment
        const deployCommand =
        'sfdx force:mdapi:deploy' +
        ` --deploydir ${deployDir}` +
        ' --wait 60' +
        ` --testlevel ${testlevel}` +
        (check ? ' --checkonly' : '') +
        (debugMode ? ' --verbose' : '');
        const deployRes = await execCommand(deployCommand, this, {
        output: true,
        debugMode,
        fail: true
      });
        let message = '';
        if (deployRes.status === 0) {
        deployProcessed = true;
        message =
          '[sfdx-hardis] Successfully deployed sfdx project sources to Salesforce org';
        this.ux.log(c.green(message));
      } else {
        message =
          '[sfdx-hardis] Unable to deploy sfdx project sources to Salesforce org';
        this.ux.log(c.red(deployRes.errorMessage));
      }
    } else {
      uxLog(this, 'No package.xml found so no deployment has been performed');
    }

    return {
      orgId: this.org.getOrgId(),
      deployProcessed,
      destructiveProcessed,
      outputString: ''
    };
  }
}
