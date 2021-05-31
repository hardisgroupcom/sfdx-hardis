import { SfdxError } from "@salesforce/core";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as glob from "glob-promise";
import * as path from "path";
import * as sortArray from "sort-array";
import * as xml2js from "xml2js";
import { createTempDir, execCommand, isCI, uxLog } from ".";
import { CONSTANTS, getConfig } from "../../config";
import { importData } from "./dataUtils";
import { analyzeDeployErrorLogs } from "./deployTips";
import { prompts } from "./prompts";
import { execSfdxJson } from './index';

export async function forceSourcePush(scratchOrgAlias: string, commandThis: any, debug = false) {
  try {
    const pushCommand = `sfdx force:source:push -g -w 60 --forceoverwrite -u ${scratchOrgAlias}`;
    await execCommand(pushCommand, commandThis, {
      fail: true,
      output: true,
      debug: debug,
    });
  } catch (e) {
    const { tips } = analyzeDeployErrorLogs(e.stdout + e.stderr);
    uxLog(commandThis, c.red("Sadly there has been push error(s)"));
    uxLog(commandThis, c.yellow(tips.map((tip: any) => c.bold(tip.label) + "\n" + tip.tip).join("\n\n")));
    uxLog(
      commandThis,
      c.yellow(c.bold(`You may${tips.length > 0 ? " also" : ""} copy-paste errors on google to find how to solve the push issues :)`))
    );
    throw new SfdxError("Deployment failure. Check messages above");
  }
}

export async function forceSourcePull(scratchOrgAlias: string, debug = false) {
  try {
    const pullCommand = `sfdx force:source:pull -w 60 --forceoverwrite -u ${scratchOrgAlias}`;
    await execCommand(pullCommand, this, {
      fail: true,
      output: true,
      debug: debug,
    });
  } catch (e) {
    const { tips } = analyzeDeployErrorLogs(e.stdout + e.stderr);
    uxLog(this, c.red("Sadly there has been pull error(s)"));
    uxLog(this, c.yellow(tips.map((tip: any) => c.bold(tip.label) + "\n" + tip.tip).join("\n\n")));
    // List unknown elements from output
    const forceIgnoreElements = [...(e.stdout + e.stderr).matchAll(/Entity of type '(.*)' named '(.*)' cannot be found/gm)];
    if (forceIgnoreElements.length > 0 && !isCI) {
      // Propose user to ignore elements
      const forceIgnoreRes = await prompts({
        type: "multiselect",
        message: "If you want to try again with updated .forceignore file, please select elements you want to add",
        name: "value",
        choices: forceIgnoreElements.map((forceIgnoreElt) => {
          return {
            title: `${forceIgnoreElt[1]}: ${forceIgnoreElt[2]}`,
            value: forceIgnoreElt[2],
          };
        }),
      });
      if (forceIgnoreRes.value.length > 0) {
        const forceIgnoreFile = "./.forceignore";
        const forceIgnore = await fs.readFile(forceIgnoreFile, "utf-8");
        const forceIgnoreLines = forceIgnore.replace("\r\n", "\n").split("\n");
        forceIgnoreLines.push(...forceIgnoreRes.value);
        await fs.writeFile(forceIgnoreFile, forceIgnoreLines.join("\n") + "\n");
        uxLog(this, "Updated .forceignore file");
        return await forceSourcePull(scratchOrgAlias, debug);
      }
    }
    uxLog(this, c.yellow(c.bold(`You may${tips.length > 0 ? " also" : ""} copy-paste errors on google to find how to solve the pull issues :)`)));
    throw new SfdxError("Pull failure. Check messages above");
  }
}

export async function forceSourceDeploy(
  packageXmlFile: string,
  check = false,
  testlevel = "RunLocalTests",
  debugMode = false,
  commandThis: any = this,
  options = {}
): Promise<any> {
  const splitDeployments = await buildDeploymentPackageXmls(packageXmlFile, check, debugMode);
  const messages = [];
  // Replace quick actions with dummy content in case we have dependencies between Flows & QuickActions
  await replaceQuickActionsWithDummy();
  // Process items of deployment plan
  for (const deployment of splitDeployments) {
    let message = "";
    // Wait before deployment item process if necessary
    if (deployment.waitBefore) {
      uxLog(commandThis, `Waiting ${deployment.waitBefore} seconds before deployment according to deployment plan`);
      await new Promise((resolve) => setTimeout(resolve, deployment.waitBefore * 1000));
    }
    // Deployment of type package.xml file
    if (deployment.packageXmlFile) {
      uxLog(
        commandThis,
        c.cyan(`${check ? "Simulating deployment of" : "Deploying"} ${c.bold(deployment.label)} package: ${deployment.packageXmlFile} ...`)
      );
      const deployCommand =
        `sfdx force:source:deploy -x ${deployment.packageXmlFile}` +
        " --wait 60" +
        " --ignorewarnings" + // So it does not fail in for objectTranslations stuff
        ` --testlevel ${testlevel}` +
        (check ? " --checkonly" : "") +
        (debugMode ? " --verbose" : "");
      let deployRes;
      try {
        deployRes = await execCommand(deployCommand, commandThis, {
          output: true,
          debug: debugMode,
          fail: true,
          retry: deployment.retry || null,
        });
      } catch (e) {
        const { tips } = analyzeDeployErrorLogs(e.stdout + e.stderr);
        uxLog(commandThis, c.red("Sadly there has been Deployment error(s)"));
        uxLog(commandThis, c.yellow(tips.map((tip: any) => c.bold(tip.label) + "\n" + tip.tip).join("\n\n")));
        uxLog(
          commandThis,
          c.yellow(c.bold(`You may${tips.length > 0 ? " also" : ""} copy-paste errors on google to find how to solve the deployment issues :)`))
        );
        throw new SfdxError("Deployment failure. Check messages above");
      }
      // Display deployment status
      if (deployRes.status === 0) {
        message = `[sfdx-hardis] Successfully ${check ? "checked deployment of" : "deployed"} ${c.bold(deployment.label)} to target Salesforce org`;
        uxLog(commandThis, c.green(message));
      } else {
        message = `[sfdx-hardis] Unable to deploy ${c.bold(deployment.label)} to target Salesforce org`;
        uxLog(commandThis, c.red(deployRes.errorMessage));
      }
      // Restore quickActions after deployment of main package
      if (deployment.packageXmlFile.includes("mainPackage.xml")) {
        await restoreQuickActions();
      }
    }
    // Deployment of type data import
    if (deployment.dataPath) {
      const dataPath = path.resolve(deployment.dataPath);
      await importData(dataPath, commandThis, options);
    }
    // Wait after deployment item process if necessary
    if (deployment.waitAfter) {
      uxLog(commandThis, `Waiting ${deployment.waitAfter} seconds after deployment according to deployment plan`);
      await new Promise((resolve) => setTimeout(resolve, deployment.waitAfter * 1000));
    }
    messages.push(message);
  }
  return { messages };
}

// In some case we can not deploy the whole package.xml, so let's split it before :)
async function buildDeploymentPackageXmls(packageXmlFile: string, check: boolean, debugMode: boolean): Promise<any[]> {
  const packageXmlString = await fs.readFile(packageXmlFile, "utf8");
  const packageXml = await xml2js.parseStringPromise(packageXmlString);
  // Check for empty package.xml
  if (!(packageXml && packageXml.Package && packageXml.Package.types && packageXml.Package.types.length > 0)) {
    uxLog(this, "Empty package.xml: nothing to deploy");
    return [];
  }
  const deployOncePackageXml = await buildDeployOncePackageXml(debugMode);
  const config = await getConfig("user");
  // Build list of package.xml according to plan
  if (config.deploymentPlan && !check) {
    // Copy main package.xml
    const tmpDeployDir = await createTempDir();
    const mainPackageXmlCopyFileName = path.join(tmpDeployDir, "mainPackage.xml");
    await fs.copy(packageXmlFile, mainPackageXmlCopyFileName);
    const mainPackageXmlItem = {
      label: "main",
      packageXmlFile: mainPackageXmlCopyFileName,
      order: 0,
    };
    const deploymentItems = [mainPackageXmlItem];
    // Remove other package.xml items from main package.xml
    for (const deploymentItem of config.deploymentPlan.packages) {
      if (deploymentItem.packageXmlFile) {
        deploymentItem.packageXmlFile = path.resolve(deploymentItem.packageXmlFile);
        const splitPackageXmlCopyFileName = path.join(tmpDeployDir, path.basename(deploymentItem.packageXmlFile));
        await fs.copy(deploymentItem.packageXmlFile, splitPackageXmlCopyFileName);
        deploymentItem.packageXmlFile = splitPackageXmlCopyFileName;
        await removePackageXmlContent(mainPackageXmlCopyFileName, deploymentItem.packageXmlFile, false, debugMode);
        if (deployOncePackageXml) {
          await removePackageXmlContent(deploymentItem.packageXmlFile, deployOncePackageXml, false, debugMode);
        }
      }
      deploymentItems.push(deploymentItem);
    }

    // Remove packageXmlDeployOnce.xml items that are already present in target org
    if (deployOncePackageXml) {
      await removePackageXmlContent(mainPackageXmlCopyFileName, deployOncePackageXml, false, debugMode);
    }

    // Sort in requested order
    const deploymentItemsSorted = sortArray(deploymentItems, {
      by: ["order", "label"],
      order: ["asc", "asc"],
    });
    return deploymentItemsSorted;
  }
  // No transformation: return initial package.xml file
  return [
    {
      label: "main",
      packageXmlFile: packageXmlFile,
    },
  ];
}

// packageDeployOnce.xml items are deployed only if they are not in the target org
async function buildDeployOncePackageXml(debugMode = false) {
  const packageXmlDeployOnce = path.resolve("./manifest/packageDeployOnce.xml");
  if (fs.existsSync(packageXmlDeployOnce)) {
    uxLog(this, "Building packageDeployOnce.xml...");
    const packageXmlDeployOnceString = await fs.readFile(packageXmlDeployOnce, "utf8");
    const packageXmlDeployOnceContent = await xml2js.parseStringPromise(packageXmlDeployOnceString);
    // If packageDeployOnce.xml is not empty, build target org package.xml and remove its content from packageOnce.xml
    if (
      packageXmlDeployOnceContent &&
      packageXmlDeployOnceContent.Package &&
      packageXmlDeployOnceContent.Package.types &&
      packageXmlDeployOnceContent.Package.types.length > 0
    ) {
      const tmpDir = await createTempDir();
      // Build target org package.xml
      uxLog(this, c.cyan(`Generating full package.xml from target org to remove its content matching packageDeployOnce.xml ...`));
      const targetOrgPackageXml = path.join(tmpDir, "packageTargetOrg.xml");
      await execCommand(`sfdx sfpowerkit:org:manifest:build -o ${targetOrgPackageXml}`, this, { fail: true, debug: debugMode, output: false });
      const packageXmlDeployOnceToUse = path.join(tmpDir, "packageDeployOnce.xml");
      await fs.copy(packageXmlDeployOnce, packageXmlDeployOnceToUse);
      // Keep in deployOnce.xml only what is necessary to deploy
      await removePackageXmlContent(packageXmlDeployOnceToUse, targetOrgPackageXml, true, debugMode);
      // Check if there is still something in updated packageDeployOnce.xml
      const packageXmlDeployOnceStringNew = await fs.readFile(packageXmlDeployOnceToUse, "utf8");
      const packageXmlDeployOnceContentNew = await xml2js.parseStringPromise(packageXmlDeployOnceStringNew);
      if (
        packageXmlDeployOnceContentNew &&
        packageXmlDeployOnceContentNew.Package &&
        packageXmlDeployOnceContentNew.Package.types &&
        packageXmlDeployOnceContentNew.Package.types.length > 0
      ) {
        return packageXmlDeployOnceToUse;
      }
    }
  }
  return null;
}

// Remove content of a package.xml file from another package.xml file
async function removePackageXmlContent(packageXmlFile: string, packageXmlFileToRemove: string, removedOnly = false, debugMode = false) {
  uxLog(this, c.cyan(`Removing ${c.green(path.basename(packageXmlFileToRemove))} content from ${c.green(path.basename(packageXmlFile))}`));
  let removePackageXmlCommand =
    "sfdx essentials:packagexml:remove" +
    ` --packagexml ${packageXmlFile}` +
    ` --removepackagexml ${packageXmlFileToRemove}` +
    ` --outputfile ${packageXmlFile}` +
    ` --noinsight `;
  if (removedOnly === true) {
    removePackageXmlCommand += " --removedonly";
  }
  await execCommand(removePackageXmlCommand, this, {
    fail: true,
    debug: debugMode,
  });
}

// Deploy destructive changes
export async function deployDestructiveChanges(packageDeletedXmlFile: string, options: any = { debug: false, check: false }, commandThis: any) {
  // Create empty deployment file because of sfdx limitation
  // cf https://gist.github.com/benahm/b590ecf575ff3c42265425233a2d727e
  uxLog(commandThis, c.cyan(`Deploying destructive changes from file ${path.resolve(packageDeletedXmlFile)}`));
  const tmpDir = await createTempDir();
  const emptyPackageXmlFile = path.join(tmpDir, "package.xml");
  await fs.writeFile(
    emptyPackageXmlFile,
    `<?xml version="1.0" encoding="UTF-8"?>
      <Package xmlns="http://soap.sforce.com/2006/04/metadata">
        <version>${CONSTANTS.API_VERSION}</version>
      </Package>`,
    "utf8"
  );
  await fs.copy(packageDeletedXmlFile, path.join(tmpDir, "destructiveChanges.xml"));
  const deployDelete =
    `sfdx force:mdapi:deploy -d ${tmpDir}` +
    " --wait 60" +
    " --testlevel NoTestRun" +
    " --ignorewarnings" + // So it does not fail in case metadata is already deleted
    (options.check ? " --checkonly" : "") +
    (options.debug ? " --verbose" : "");
  // Deploy destructive changes
  let deployDeleteRes = null;
  try {
    deployDeleteRes = await execCommand(deployDelete, commandThis, {
      output: true,
      debug: options.debug,
      fail: true,
    });
  } catch (e) {
    const { tips } = analyzeDeployErrorLogs(e.stdout + e.stderr);
    uxLog(this, c.red("Sadly there has been destruction error(s)"));
    uxLog(this, c.yellow(tips.map((tip: any) => c.bold(tip.label) + "\n" + tip.tip).join("\n\n")));
    throw new SfdxError("Error while deploying destructive changes");
  }
  await fs.remove(tmpDir);
  let deleteMsg = "";
  if (deployDeleteRes.status === 0) {
    deleteMsg = `[sfdx-hardis] Successfully ${options.check ? "checked deployment of" : "deployed"} destructive changes to Salesforce org`;
    uxLog(commandThis, c.green(deleteMsg));
  } else {
    deleteMsg = "[sfdx-hardis] Unable to deploy destructive changes to Salesforce org";
    uxLog(commandThis, c.red(deployDeleteRes.errorMessage));
  }
}

export async function deployMetadatas(
  options: any = {
    deployDir: ".",
    testlevel: "RunLocalTests",
    check: false,
    debug: false,
    soap: false,
  }
) {
  // Perform deployment
  const deployCommand =
    "sfdx force:mdapi:deploy" +
    ` --deploydir ${options.deployDir || "."}` +
    " --wait 60" +
    ` --testlevel ${options.testlevel || "RunLocalTests"}` +
    ` --apiversion ${options.apiVersion || CONSTANTS.API_VERSION}` +
    (options.soap ? " --soapdeploy" : "") +
    (options.check ? " --checkonly" : "") +
    (options.debug ? " --verbose" : "");
  let deployRes;
  try {
    deployRes = await execCommand(deployCommand, this, {
      output: true,
      debug: options.debug,
      fail: true,
    });
  } catch (e) {
    // workaround if --soapdeploy is not available
    if (JSON.stringify(e).includes("--soapdeploy")) {
      uxLog(this, c.yellow("This may be a error with a workaround... let's try it :)"));
      try {
        deployRes = await execCommand(deployCommand.replace(" --soapdeploy", ""), this, {
          output: true,
          debug: options.debug,
          fail: true,
        });
      } catch (e2) {
        if (JSON.stringify(e2).includes("NoTestRun")) {
          // Another workaround: try running tests
          uxLog(this, c.yellow("This may be again an error with a workaround... let's make a last attempt :)"));
          deployRes = await execCommand(deployCommand.replace(" --soapdeploy", "").replace("NoTestRun", "RunLocalTests"), this, {
            output: true,
            debug: options.debug,
            fail: true,
          });
        } else {
          throw e2;
        }
      }
    } else {
      throw e;
    }
  }
  return deployRes;
}

let quickActionsBackUpFolder: string;

// Replace QuickAction content with Dummy content that will always pass
async function replaceQuickActionsWithDummy() {
  if (process.env.CI_DEPLOY_QUICK_ACTIONS_DUMMY === "true") {
    uxLog(this, c.cyan("Replacing QuickActions content with Dummy content that will always pass..."));
    quickActionsBackUpFolder = await createTempDir();
    const patternQuickActions = process.cwd() + "/force-app/" + `**/quickActions/*__c.*.quickAction-meta.xml`;
    const matchQuickActions = await glob(patternQuickActions, { cwd: process.cwd() });
    for (const quickActionFile of matchQuickActions) {
      const tmpBackupFile = path.join(quickActionsBackUpFolder, path.resolve(quickActionFile).replace(path.resolve(process.cwd()), ""));
      await fs.ensureDir(path.dirname(tmpBackupFile));
      await fs.copy(quickActionFile, tmpBackupFile);
      await fs.writeFile(
        quickActionFile,
        `<?xml version="1.0" encoding="UTF-8"?>
<QuickAction xmlns="http://soap.sforce.com/2006/04/metadata">
    <height>500</height>
    <label>Deployment in progress - ${Math.random()}</label>
    <lightningComponent>NoQuickAction</lightningComponent>
    <optionsCreateFeedItem>false</optionsCreateFeedItem>
    <type>LightningComponent</type>
    <width>100</width>
</QuickAction>`
      );
      uxLog(this, c.grey("Backuped and replaced " + quickActionFile));
    }
  }
}

// Restore original QuickActions
async function restoreQuickActions() {
  if (process.env.CI_DEPLOY_QUICK_ACTIONS_DUMMY === "true") {
    const patternQuickActionsBackup = quickActionsBackUpFolder + "/force-app/" + `**/quickActions/*.quickAction-meta.xml`;
    const matchQuickActions = await glob(patternQuickActionsBackup, {
      cwd: process.cwd(),
    });
    for (const quickActionFile of matchQuickActions) {
      const prevFileName = path.resolve(quickActionFile).replace(path.resolve(quickActionsBackUpFolder), path.resolve(process.cwd()));
      await fs.copy(quickActionFile, prevFileName);
      uxLog(this, c.grey("Restored " + quickActionFile));
    }
  }
}

export async function executeApex(apexclassContent: string,apexClassPath: string,targetusername: string,debugMode: Boolean){
  fs.readFileSync(path.join(__dirname,'../../Apex/'+apexClassPath),'utf8');
  const targetFile = path.join(__dirname,'../../Apex/'+apexClassPath);
  await fs.writeFile(targetFile,apexclassContent);

  const apexScriptCommand = `sfdx force:apex:execute -f "${targetFile}" --targetusername ${targetusername}`;
  const freezeQueryRes = await execSfdxJson(apexScriptCommand, this, { fail: true, output: true, debug: debugMode });
  return freezeQueryRes;

}

// 
