/* jscpd:ignore-start */

import { flags, SfdxCommand } from '@salesforce/command';
import { Messages, SfdxError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as sortArray from 'sort-array';
import { MetadataUtils } from '../../../../../common/metadata-utils';
import { execCommand, uxLog } from '../../../../../common/utils';
import { analyzeDeployErrorLogs } from '../../../../../common/utils/deployTips';
import { getConfig } from '../../../../../config';
import * as xml2js from 'xml2js';

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
  protected debugMode = false ;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    this.configInfo = await getConfig('branch');
    const check = this.flags.check || false;
    const testlevel = this.flags.testlevel || 'RunLocalTests';
    this.debugMode = this.flags.debug || false;

    // Install packages
    const packages = this.configInfo.installedPackages || [];
    if (packages.length > 0 && !check) {
      // Install package only if we are in real deployment mode
      await MetadataUtils.installPackagesOnOrg(packages, null, this, "deploy");
    }

    // Deploy destructive changes
    const packageDeletedXmlFile =
      process.env.PACKAGE_XML_TO_DELETE ||
        this.configInfo.packageXmlToDelete ||
        (fs.existsSync('./manifest/destructiveChanges.xml')) ? './manifest/destructiveChanges.xml' :
        './config/destructiveChanges.xml';
    if (fs.existsSync(packageDeletedXmlFile)) {
      await MetadataUtils.deployDestructiveChanges(packageDeletedXmlFile, { debug: this.debugMode, check }, this);
    } else {
      uxLog(this, 'No destructivePackage.Xml found so no destructive deployment has been performed');
    }

    // Deploy sources
    const packageXmlFile =
      process.env.PACKAGE_XML_TO_DEPLOY ||
        this.configInfo.packageXmlToDeploy ||
        (fs.existsSync('./manifest/package.xml')) ? './manifest/package.xml' :
        './config/package.xml';
    const splitDeploymentPackageXmls = await this.buildDeploymentPackageXmls(packageXmlFile,check);
    const messages = [];
    for (const packageXml of splitDeploymentPackageXmls) {
      const packageXmlFile = packageXml.packageXmlFile ;
      uxLog(this,c.cyan(`Deploying ${c.bold(packageXml.label)} package: ${packageXmlFile} ...`));
      if (packageXmlFile.waitBefore) {
        await new Promise(resolve => setTimeout(resolve, packageXmlFile.waitBefore * 1000));
      }
      const deployCommand = `sfdx force:source:deploy -x ${packageXmlFile}` +
        ' --wait 60' +
        ' --ignorewarnings' + // So it does not fail in for objectTranslations stuff
        ` --testlevel ${testlevel}` +
        (check ? ' --checkonly' : '') +
        (this.debugMode ? ' --verbose' : '');
        let deployRes ;
      try {
        deployRes = await execCommand(deployCommand, this, { output: true, debug: this.debugMode, fail: true })
      } catch (e) {
        const {tips} = analyzeDeployErrorLogs(e.error.stdout + e.error.stderr);
        uxLog(this,c.red("Sadly there has been Deployment error(s)"));
        uxLog(this,c.yellow(tips.map((tip:any) => tip.tip).join("\n")));
        uxLog(this,c.yellow(`You may${tips.length > 0?' also':''} copy-paste errors on google to find how to solve the deployment issues :)`));
        throw new SfdxError('Deployment failure. Check messages above');
      }
      let message = '';
      if (deployRes.status === 0) {
        message = `[sfdx-hardis] Successfully ${check ? 'checked deployment of' : 'deployed'} sfdx project sources to Salesforce org`;
        uxLog(this, c.green(message));
      } else {
        message = '[sfdx-hardis] Unable to deploy sfdx project sources to Salesforce org';
        uxLog(this, c.red(deployRes.errorMessage));
      }
      if (packageXmlFile.waitAfter) {
        await new Promise(resolve => setTimeout(resolve, packageXmlFile.waitAfter * 1000));
      }
      messages.push(message);
    }
    return { orgId: this.org.getOrgId(), outputString: messages.join("\n") };
  }

  // In some case we can not deploy the whole package.xml, so let's split it before :)
  private async buildDeploymentPackageXmls(packageXmlFile: string,check: boolean): Promise<any[]> {
    const packageXmlString = await fs.readFile(packageXmlFile);
    const packageXml = await xml2js.parseStringPromise(packageXmlString);
    // Check for empty package.xml
    if (!(packageXml && packageXml.Package && packageXml.Package.types && packageXml.Package.types.length > 0)) {
      uxLog(this,'Empty package.xml: nothing to deploy')
      return [];
    }
    const deploymentPlanFile = path.join(path.dirname(packageXmlFile),'deploymentPlan.json');
    // Build list of package.xml according to plan
    if (fs.existsSync(deploymentPlanFile) && !check) {
      // Read deployment plan
      const deploymentPlanFileXmlString = await fs.readFile(deploymentPlanFile);
      const deploymentPlan = await xml2js.parseStringPromise(deploymentPlanFileXmlString);
      // Copy main package.xml
      const tmpDeployDir = path.join(os.tmpdir(),'sfdx-hardis-deploy');
      await fs.ensureDir(tmpDeployDir);
      const mainPackageXmlCopyFileName = path.join(tmpDeployDir,'mainPackageXml');
      await fs.copy(packageXmlFile,mainPackageXmlCopyFileName);
      const mainPackageXmlItem = {
        label: 'main',
        packageXmlFile: mainPackageXmlCopyFileName,
        order: 0
      }
      const packageXmlItems = [mainPackageXmlItem];
      // Remove other package.xml items from main package.xml
      for (const separatePackageXml of deploymentPlan.packages) {
        uxLog(this,c.cyan(`Removing ${separatePackageXml.packageXmlFile} content from main package.xml`));
        const removePackageXmlCommand = 'sfdx essentials:packagexml:remove' +
        ` --packagexml ${mainPackageXmlCopyFileName}` +
        ` --removepackagexml ${separatePackageXml.packageXmlFile}` +
        ` --outputfile ${mainPackageXmlCopyFileName}`;
        await execCommand(removePackageXmlCommand, this, { fail: true, debug: this.debugMode });
        packageXmlItems.push(separatePackageXml);
      }

      // Sort in requested order
      const packageXmlItemsSorted = sortArray(packageXmlItems, {
        by: ['order','label'],
        order: ['asc','asc']
      });
      return packageXmlItemsSorted ;
    }
    // No transformation: return initial package.xml file
    return [
      {
        label: 'main',
        packageXmlFile: packageXmlFile
      }
    ]
  }

}

    /* MAYBE USE LATER
    const emptyManifest = {
      Package: {
        types: []
      }
    };
    const manifests = {'main':  Object.assign({}, emptyManifest) };
    // Separate special cases from main package.xml
    for (const type of packageXml.Package.types) {
      const typeName = type.name[0];
      // SharingOwnerRule managed by SharingRule
      manifests.main.Package.types.push(type);
    }

    const packageXmlItems = [];
    return []; 



  manifest.Package.types = manifest.Package.types.filter(
    (type: any) =>
      !(options.removeMetadatas || []).includes(type.name[0]) &&
      (type?.members?.length || 0) > 0
  );
  */