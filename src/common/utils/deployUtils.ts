import { SfdxError } from "@salesforce/core";
import * as c from 'chalk';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as sortArray from 'sort-array';
import * as xml2js from 'xml2js';
import { execCommand, uxLog } from ".";
import { analyzeDeployErrorLogs } from "./deployTips";

export async function forceSourceDeploy(packageXmlFile:string,check=false,testlevel='RunLocalTests',debugMode=false, commandThis: any,options = {}):Promise<any> {
    const splitDeployments = await buildDeploymentPackageXmls(packageXmlFile,check,debugMode);
    const messages = [];
    for (const deployment of splitDeployments) {
      let message = '';
      // Wait before deployment item process if necessary
      if (deployment.waitBefore) {
        uxLog(this,`Waiting ${deployment.waitBefore * 1000} seconds before deployment according to deploymentPlan.json`);
        await new Promise(resolve => setTimeout(resolve, deployment.waitBefore * 1000));
      }
      // Deployment of type package.xml file
      if (deployment.packageXmlFile) {
        uxLog(this,c.cyan(`Deploying ${c.bold(deployment.label)} package: ${deployment.packageXmlFile} ...`));
        const deployCommand = `sfdx force:source:deploy -x ${deployment.packageXmlFile}` +
          ' --wait 60' +
          ' --ignorewarnings' + // So it does not fail in for objectTranslations stuff
          ` --testlevel ${testlevel}` +
          (check ? ' --checkonly' : '') +
          (debugMode ? ' --verbose' : '');
          let deployRes ;
        try {
          deployRes = await execCommand(deployCommand, this, { output: true, debug: debugMode, fail: true });
        } catch (e) {
          const {tips} = analyzeDeployErrorLogs(e.stdout + e.stderr);
          uxLog(this,c.red("Sadly there has been Deployment error(s)"));
          uxLog(this,c.yellow(tips.map((tip:any) => c.bold(tip.label)+'\n'+tip.tip).join("\n")));
          uxLog(this,c.yellow(`You may${tips.length > 0?' also':''} copy-paste errors on google to find how to solve the deployment issues :)`));
          throw new SfdxError('Deployment failure. Check messages above');
        }
        if (deployRes.status === 0) {
          message = `[sfdx-hardis] Successfully ${check ? 'checked deployment of' : 'deployed'} sfdx project sources to Salesforce org`;
          uxLog(this, c.green(message));
        } else {
          message = '[sfdx-hardis] Unable to deploy sfdx project sources to Salesforce org';
          uxLog(this, c.red(deployRes.errorMessage));
        }
      }
      // Deployment of type data import
      if (deployment.dataPath) {
        const dataPath = path.resolve(deployment.dataPath);
        await importData(dataPath,commandThis,options);
      }
      // Wait after deployment item process if necessary
      if (deployment.waitAfter) {
        uxLog(this,`Waiting ${deployment.waitAfter * 1000} seconds after deployment according to deploymentPlan.json`);
        await new Promise(resolve => setTimeout(resolve, deployment.waitAfter * 1000));
      }
      messages.push(message);
    }
    return {messages};
}

// In some case we can not deploy the whole package.xml, so let's split it before :)
async function buildDeploymentPackageXmls(packageXmlFile: string,check: boolean,debugMode: boolean): Promise<any[]> {
    const packageXmlString = await fs.readFile(packageXmlFile,'utf8');
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
        const deploymentPlanFileJsonString = await fs.readFile(deploymentPlanFile,"utf8");
        const deploymentPlan = JSON.parse(deploymentPlanFileJsonString);
        // Copy main package.xml
        const tmpDeployDir = path.join(os.tmpdir(),'sfdx-hardis-deploy');
        await fs.ensureDir(tmpDeployDir);
        const mainPackageXmlCopyFileName = path.join(tmpDeployDir,'mainPackage.xml');
        await fs.copy(packageXmlFile,mainPackageXmlCopyFileName);
        const mainPackageXmlItem = {
          label: 'main',
          packageXmlFile: mainPackageXmlCopyFileName,
          order: 0
        }
        const deploymentItems = [mainPackageXmlItem];
        // Remove other package.xml items from main package.xml
        for (const deploymentItem of deploymentPlan.packages) {
          if (deploymentItem.packageXmlFile) {
            deploymentItem.packageXmlFile = path.resolve(path.join(path.dirname(deploymentPlanFile), deploymentItem.packageXmlFile));
            uxLog(this,c.cyan(`Removing ${deploymentItem.packageXmlFile} content from main package.xml`));
            const removePackageXmlCommand = 'sfdx essentials:packagexml:remove' +
            ` --packagexml ${mainPackageXmlCopyFileName}` +
            ` --removepackagexml ${deploymentItem.packageXmlFile}` +
            ` --outputfile ${mainPackageXmlCopyFileName}`;
            await execCommand(removePackageXmlCommand, this, { fail: true, debug: debugMode });
          }
          deploymentItems.push(deploymentItem);
        }

        // Sort in requested order
        const deploymentItemsSorted = sortArray(deploymentItems, {
          by: ['order','label'],
          order: ['asc','asc']
        });
        return deploymentItemsSorted ;
    }
    // No transformation: return initial package.xml file
    return [
        {
          label: 'main',
          packageXmlFile: packageXmlFile
        }
    ]
}

// Import data from sfdmu folder
export async function importData(sfdmuPath: string, commandThis: any, options: any = {}) {
  uxLog(commandThis,c.cyan(`Importing data from ${c.green(sfdmuPath)} ...`));
  const targetUsername = options.targetUsername || commandThis.org.getConnection().username;
  const dataImportCommand = `sfdx sfdmu:run --sourceusername csvfile --targetusername ${targetUsername} -p ${sfdmuPath}`;
  await execCommand(dataImportCommand, commandThis,{fail:true,output:true});
}