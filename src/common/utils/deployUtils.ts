import { SfdxError } from "@salesforce/core";
import * as c from 'chalk';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as sortArray from 'sort-array';
import * as xml2js from 'xml2js';
import { execCommand, uxLog } from ".";
import { analyzeDeployErrorLogs } from "./deployTips";

export async function forceSourceDeploy(packageXmlFile:string,check=false,testlevel='RunLocalTests',debugMode=false):Promise<any> {
    const splitDeploymentPackageXmls = await buildDeploymentPackageXmls(packageXmlFile,check,debugMode);
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
        (debugMode ? ' --verbose' : '');
        let deployRes ;
      try {
        deployRes = await execCommand(deployCommand, this, { output: true, debug: debugMode, fail: true })
      } catch (e) {
        const {tips} = analyzeDeployErrorLogs(e.stdout + e.stderr);
        uxLog(this,c.red("Sadly there has been Deployment error(s)"));
        uxLog(this,c.yellow(tips.map((tip:any) => c.bold(tip.label)+'\n'+tip.tip).join("\n")));
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
    return {messages};
}

// In some case we can not deploy the whole package.xml, so let's split it before :)
async function buildDeploymentPackageXmls(packageXmlFile: string,check: boolean,debugMode: boolean): Promise<any[]> {
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
        const deploymentPlanFileXmlString = await fs.readFile(deploymentPlanFile,"utf8");
        const deploymentPlan = await xml2js.parseStringPromise(deploymentPlanFileXmlString.toString().replace("\ufeff", ""));
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
        await execCommand(removePackageXmlCommand, this, { fail: true, debug: debugMode });
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