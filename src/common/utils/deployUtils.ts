import { SfdxError } from "@salesforce/core";
import * as c from 'chalk';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as sortArray from 'sort-array';
import * as xml2js from 'xml2js';
import { execCommand, isCI, uxLog } from ".";
import { CONSTANTS, getConfig } from "../../config";
import { importData } from "./dataUtils";
import { analyzeDeployErrorLogs } from "./deployTips";
import { prompts } from "./prompts";

export async function forceSourcePush(scratchOrgAlias:string,debug = false) {
  try {
    const pushCommand = `sfdx force:source:push -g -w 60 --forceoverwrite -u ${scratchOrgAlias}`;
    await execCommand(pushCommand, this, { fail: true, output: true, debug: debug });
  } catch (e) {
    const {tips} = analyzeDeployErrorLogs(e.stdout + e.stderr);
    uxLog(this,c.red("Sadly there has been push error(s)"));
    uxLog(this,c.yellow(tips.map((tip:any) => c.bold(tip.label)+'\n'+tip.tip).join("\n\n")));
    uxLog(this,c.yellow(c.bold(`You may${tips.length > 0?' also':''} copy-paste errors on google to find how to solve the push issues :)`)));
    throw new SfdxError('Deployment failure. Check messages above');
  }
}

export async function forceSourcePull(scratchOrgAlias:string,debug = false) { 
  try {
    const pushCommand = `sfdx force:source:pull -w 60 --forceoverwrite -u ${scratchOrgAlias}`;
    await execCommand(pushCommand, this, { fail: true, output: true, debug: debug });
  } catch (e) {
    const {tips} = analyzeDeployErrorLogs(e.stdout + e.stderr);
    uxLog(this,c.red("Sadly there has been pull error(s)"));
    uxLog(this,c.yellow(tips.map((tip:any) => c.bold(tip.label)+'\n'+tip.tip).join("\n\n")));
    // List unknown elements from output
    const forceIgnoreElements = [...(e.stdout + e.stderr).matchAll(/Entity of type '(.*)' named '(.*)' cannot be found/gm)];
    if (forceIgnoreElements.length > 0 && !isCI) {
      // Propose user to ignore elements
      const forceIgnoreRes = await prompts({
        type: "multiselect",
        message: 'If you want to try again with updated .forceignore file, please select elements you want to add',
        name: 'value',
        choices: forceIgnoreElements.map(forceIgnoreElt => {
          return { title: `${forceIgnoreElt[1]}: ${forceIgnoreElt[2]}`, value: forceIgnoreElt[2]};
        })
      });
      if (forceIgnoreRes.value.length > 0) {
        const forceIgnoreFile = './.forceignore';
        const forceIgnore = await fs.readFile(forceIgnoreFile, 'utf-8');
        const forceIgnoreLines = forceIgnore.replace("\r\n","\n").split('\n');
        forceIgnoreLines.push(...forceIgnoreRes.value);
        await fs.writeFile(forceIgnoreFile, forceIgnoreLines.join("\n")+"\n");
        uxLog(this,'Updated .forceignore file');
        return await forceSourcePull(scratchOrgAlias,debug);
      }
    }
    uxLog(this,c.yellow(c.bold(`You may${tips.length > 0?' also':''} copy-paste errors on google to find how to solve the pull issues :)`)));
    throw new SfdxError('Pull failure. Check messages above');
  }
} 

export async function forceSourceDeploy(packageXmlFile:string,check=false,testlevel='RunLocalTests',debugMode=false, commandThis: any = this,options = {}):Promise<any> {
    const splitDeployments = await buildDeploymentPackageXmls(packageXmlFile,check,debugMode);
    const messages = [];
    for (const deployment of splitDeployments) {
      let message = '';
      // Wait before deployment item process if necessary
      if (deployment.waitBefore) {
        uxLog(commandThis,`Waiting ${deployment.waitBefore} seconds before deployment according to deployment plan`);
        await new Promise(resolve => setTimeout(resolve, deployment.waitBefore * 1000));
      }
      // Deployment of type package.xml file
      if (deployment.packageXmlFile) {
        uxLog(commandThis,c.cyan(`Deploying ${c.bold(deployment.label)} package: ${deployment.packageXmlFile} ...`));
        const deployCommand = `sfdx force:source:deploy -x ${deployment.packageXmlFile}` +
          ' --wait 60' +
          ' --ignorewarnings' + // So it does not fail in for objectTranslations stuff
          ` --testlevel ${testlevel}` +
          (check ? ' --checkonly' : '') +
          (debugMode ? ' --verbose' : '');
          let deployRes ;
        try {
          deployRes = await execCommand(deployCommand, commandThis,
             { output: true, debug: debugMode, fail: true,
               retry: deployment.retry || null
              });
        } catch (e) {
          const {tips} = analyzeDeployErrorLogs(e.stdout + e.stderr);
          uxLog(commandThis,c.red("Sadly there has been Deployment error(s)"));
          uxLog(commandThis,c.yellow(tips.map((tip:any) => c.bold(tip.label)+'\n'+tip.tip).join("\n\n")));
          uxLog(commandThis,c.yellow(c.bold(`You may${tips.length > 0?' also':''} copy-paste errors on google to find how to solve the deployment issues :)`)));
          throw new SfdxError('Deployment failure. Check messages above');
        }
        if (deployRes.status === 0) {
          message = `[sfdx-hardis] Successfully ${check ? 'checked deployment of' : 'deployed'} sfdx project sources to Salesforce org`;
          uxLog(commandThis, c.green(message));
        } else {
          message = '[sfdx-hardis] Unable to deploy sfdx project sources to Salesforce org';
          uxLog(commandThis, c.red(deployRes.errorMessage));
        }
      }
      // Deployment of type data import
      if (deployment.dataPath) {
        const dataPath = path.resolve(deployment.dataPath);
        await importData(dataPath,commandThis,options);
      }
      // Wait after deployment item process if necessary
      if (deployment.waitAfter) {
        uxLog(commandThis,`Waiting ${deployment.waitAfter} seconds after deployment according to deployment plan`);
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
    const config = await getConfig("user");
    // Build list of package.xml according to plan
    if (config.deploymentPlan && !check) {
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
        for (const deploymentItem of config.deploymentPlan.packages) {
          if (deploymentItem.packageXmlFile) {
            deploymentItem.packageXmlFile = path.resolve(deploymentItem.packageXmlFile);
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

// Deploy destructive changes
export async function deployDestructiveChanges(packageDeletedXmlFile: string, options: any = { debug: false, check: false }, commandThis: any) {
  // Create empty deployment file because of sfdx limitation
  // cf https://gist.github.com/benahm/b590ecf575ff3c42265425233a2d727e
  uxLog(commandThis, c.cyan(`Deploying destructive changes from file ${path.resolve(packageDeletedXmlFile)}`));
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
    (options.check ? ' --checkonly' : '') +
    (options.debug ? ' --verbose' : '');
  // Deploy destructive changes
  let deployDeleteRes = null ;
  try {
    deployDeleteRes = await execCommand(deployDelete, commandThis, { output: true, debug: options.debug, fail: true });
  } catch (e){
    const {tips} = analyzeDeployErrorLogs(e.stdout + e.stderr);
    uxLog(this,c.red("Sadly there has been pull error(s)"));
    uxLog(this,c.yellow(tips.map((tip:any) => c.bold(tip.label)+'\n'+tip.tip).join("\n\n")));
    throw new SfdxError("Error while deploying destructive changes");
  }
  await fs.remove(tmpDir);
  let deleteMsg = '';
  if (deployDeleteRes.status === 0) {
    deleteMsg = `[sfdx-hardis] Successfully ${options.check ? 'checked deployment of' : 'deployed'} destructive changes to Salesforce org`;
    uxLog(commandThis, c.green(deleteMsg));
  } else {
    deleteMsg = '[sfdx-hardis] Unable to deploy destructive changes to Salesforce org';
    uxLog(commandThis, c.red(deployDeleteRes.errorMessage));
  }
}

export async function deployMetadatas(options: any = {
  deployDir: '.',
  testlevel: 'RunLocalTests',
  check: false,
  debug: false,
  soap: false
}) {
  // Perform deployment
  const deployCommand =
    'sfdx force:mdapi:deploy' +
    ` --deploydir ${options.deployDir || '.'}` +
    ' --wait 60' +
    ` --testlevel ${options.testlevel || 'RunLocalTests'}` +
    ` --apiversion ${options.apiVersion || CONSTANTS.API_VERSION}` +
    (options.soap ? ' --soapdeploy' : '') +
    (options.check ? ' --checkonly' : '') +
    (options.debug ? ' --verbose' : '');
  let deployRes;
  try {
    deployRes = await execCommand(deployCommand, this, { output: true, debug: options.debug, fail: true });
  } catch (e) {
    // workaround if --soapdeploy is not available
    if (JSON.stringify(e).includes('--soapdeploy')) {
      uxLog(this, c.yellow("This may be a error with a workaround... let's try it :)"));
      deployRes = await execCommand(deployCommand.replace(' --soapdeploy', ''), this,
        { output: true, debug: options.debug, fail: true });
    } else {
      throw e;
    }
  }
  return deployRes;
}

