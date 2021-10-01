import { SfdxError } from "@salesforce/core";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as glob from "glob-promise";
import * as path from "path";
import * as sortArray from "sort-array";
import { createTempDir, elapseEnd, elapseStart, execCommand, execSfdxJson, getCurrentGitBranch, getGitRepoRoot, git, isCI, uxLog } from ".";
import { CONSTANTS, getConfig, setConfig } from "../../config";
import { importData } from "./dataUtils";
import { analyzeDeployErrorLogs } from "./deployTips";
import { prompts } from "./prompts";
import { arrangeFilesBefore, restoreArrangedFiles } from "./workaroundUtils";
import { isPackageXmlEmpty, removePackageXmlFilesContent } from "./xmlUtils";

// Push sources to org
// For some cases, push must be performed in 2 times: the first with all passing sources, and the second with updated sources requiring the first push
export async function forceSourcePush(scratchOrgAlias: string, commandThis: any, debug = false) {
  elapseStart("force:source:push");
  const config = await getConfig("user");
  const currentBranch = await getCurrentGitBranch();
  let arrangedFiles = [];
  if (!(config[`tmp_${currentBranch}_pushed`] === true)) {
    arrangedFiles = await arrangeFilesBefore(commandThis);
  }
  try {
    const pushCommand = `sfdx force:source:push -g -w 60 --forceoverwrite -u ${scratchOrgAlias}`;
    await execCommand(pushCommand, commandThis, {
      fail: true,
      output: !isCI,
      debug: debug,
    });
    if (arrangedFiles.length > 0) {
      await restoreArrangedFiles(arrangedFiles, commandThis);
      await execCommand(pushCommand, commandThis, {
        fail: true,
        output: !isCI,
        debug: debug,
      });
      const configToSet = {};
      configToSet[`tmp_${currentBranch}_pushed`] = true;
      await setConfig("user", configToSet);
    }
    elapseEnd("force:source:push");
  } catch (e) {
    await restoreArrangedFiles(arrangedFiles, commandThis);
    const { tips } = analyzeDeployErrorLogs(e.stdout + e.stderr);
    uxLog(commandThis, c.red("Sadly there has been push error(s)"));
    uxLog(commandThis, c.yellow(tips.map((tip: any) => c.bold(tip.label) + "\n" + tip.tip).join("\n\n")));
    uxLog(
      commandThis,
      c.yellow(c.bold(`You may${tips.length > 0 ? " also" : ""} copy-paste errors on google to find how to solve the push issues :)`))
    );
    elapseEnd("force:source:push");
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
  elapseStart("all deployments");
  const splitDeployments = await buildDeploymentPackageXmls(packageXmlFile, check, debugMode, options);
  const messages = [];
  // Replace quick actions with dummy content in case we have dependencies between Flows & QuickActions
  await replaceQuickActionsWithDummy();
  // Process items of deployment plan
  uxLog(this, c.cyan("Processing split deployments build from deployment plan..."));
  uxLog(this, c.whiteBright(JSON.stringify(splitDeployments, null, 2)));
  for (const deployment of splitDeployments) {
    elapseStart(`deploy ${deployment.label}`);
    // Skip this deployment items if there is nothing to deploy in package.xml
    if (deployment.packageXmlFile && (await isPackageXmlEmpty(deployment.packageXmlFile, { ignoreStandaloneParentItems: true }))) {
      uxLog(
        commandThis,
        c.cyan(
          `Skipped ${c.bold(deployment.label)} deployment because package.xml is empty or contains only standalone parent items.\n${c.grey(
            c.italic("This may be related to filtering using packageDeployOnce.xml or packageDeployOnChange.xml")
          )}`
        )
      );
      elapseEnd(`deploy ${deployment.label}`);
      continue;
    }
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
        elapseEnd(`deploy ${deployment.label}`);
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
      elapseEnd(`deploy ${deployment.label}`);
    }
    // Deployment of type data import
    else if (deployment.dataPath) {
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
  elapseEnd("all deployments");
  return { messages };
}

// In some case we can not deploy the whole package.xml, so let's split it before :)
async function buildDeploymentPackageXmls(packageXmlFile: string, check: boolean, debugMode: boolean, options: any = {}): Promise<any[]> {
  // Check for empty package.xml
  if (await isPackageXmlEmpty(packageXmlFile)) {
    uxLog(this, "Empty package.xml: nothing to deploy");
    return [];
  }
  const deployOncePackageXml = await buildDeployOncePackageXml(debugMode, options);
  const deployOnChangePackageXml = await buildDeployOnChangePackageXml(debugMode, options);
  const config = await getConfig("user");
  // Build list of package.xml according to plan
  if (config.deploymentPlan && !check) {
    // Copy main package.xml so it can be dynamically updated before deployment
    const tmpDeployDir = await createTempDir();
    const mainPackageXmlCopyFileName = path.join(tmpDeployDir, "mainPackage.xml");
    await fs.copy(packageXmlFile, mainPackageXmlCopyFileName);
    const mainPackageXmlItem = {
      label: "main",
      packageXmlFile: mainPackageXmlCopyFileName,
      order: 0,
    };
    const deploymentItems = [mainPackageXmlItem];

    // Work on deploymentPlan packages before deploying them
    const skipSplitPackages = process.env.SFDX_HARDIS_DEPLOY_IGNORE_SPLIT_PACKAGES === "true";
    if (skipSplitPackages === true) {
      uxLog(this, c.yellow("Do not split package.xml, as SFDX_HARDIS_DEPLOY_IGNORE_SPLIT_PACKAGES = true has been found in ENV vars"));
    } else {
      for (const deploymentItem of config.deploymentPlan.packages) {
        if (deploymentItem.packageXmlFile) {
          // Copy deployment in temp packageXml file so it can be updated using packageDeployOnce and packageDeployOnChange
          deploymentItem.packageXmlFile = path.resolve(deploymentItem.packageXmlFile);
          const splitPackageXmlCopyFileName = path.join(tmpDeployDir, path.basename(deploymentItem.packageXmlFile));
          await fs.copy(deploymentItem.packageXmlFile, splitPackageXmlCopyFileName);
          deploymentItem.packageXmlFile = splitPackageXmlCopyFileName;
          // Remove split of packageXml content from main package.xml
          await removePackageXmlContent(mainPackageXmlCopyFileName, deploymentItem.packageXmlFile, false, debugMode);
          // Remove packageDeployOnce.xml items that are already present in target org
          if (deployOncePackageXml) {
            await removePackageXmlContent(deploymentItem.packageXmlFile, deployOncePackageXml, false, debugMode);
          }
          // Remove packageDeployOnChange.xml items that are not different in target org
          if (deployOnChangePackageXml) {
            await removePackageXmlContent(deploymentItem.packageXmlFile, deployOnChangePackageXml, false, debugMode);
          }
        }
        deploymentItems.push(deploymentItem);
      }
    }

    // Main packageXml: Remove packageDeployOnce.xml items that are already present in target org
    if (deployOncePackageXml) {
      await removePackageXmlContent(mainPackageXmlCopyFileName, deployOncePackageXml, false, debugMode);
    }
    //Main packageXml: Remove packageDeployOnChange.xml items that are not different in target org
    if (deployOnChangePackageXml) {
      await removePackageXmlContent(mainPackageXmlCopyFileName, deployOnChangePackageXml, false, debugMode);
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
async function buildDeployOncePackageXml(debugMode = false, options: any = {}) {
  if (process.env.SKIP_PACKAGE_DEPLOY_ONCE === "true") {
    uxLog(this, c.yellow("Skipped packageDeployOnce.xml management because of env variable SKIP_PACKAGE_DEPLOY_ONCE='true'"));
    return null;
  }
  const packageDeployOnce = path.resolve("./manifest/packageDeployOnce.xml");
  if (fs.existsSync(packageDeployOnce)) {
    uxLog(this, "Building packageDeployOnce.xml...");
    // If packageDeployOnce.xml is not empty, build target org package.xml and remove its content from packageOnce.xml
    if (!(await isPackageXmlEmpty(packageDeployOnce))) {
      const tmpDir = await createTempDir();
      // Build target org package.xml
      uxLog(this, c.cyan(`Generating full package.xml from target org to remove its content matching packageDeployOnce.xml ...`));
      const targetOrgPackageXml = path.join(tmpDir, "packageTargetOrg.xml");
      await execCommand(
        `sfdx sfpowerkit:org:manifest:build -o ${targetOrgPackageXml}` + (options.targetUsername ? ` -u ${options.targetUsername}` : ""),
        this,
        { fail: true, debug: debugMode, output: false }
      );
      const packageDeployOnceToUse = path.join(tmpDir, "packageDeployOnce.xml");
      await fs.copy(packageDeployOnce, packageDeployOnceToUse);
      // Keep in deployOnce.xml only what is necessary to deploy
      await removePackageXmlContent(packageDeployOnceToUse, targetOrgPackageXml, true, debugMode);
      // Check if there is still something in updated packageDeployOnce.xml
      if (!(await isPackageXmlEmpty(packageDeployOnceToUse))) {
        return packageDeployOnceToUse;
      }
    }
  }
  return null;
}

// packageDeployOnChange.xml items are deployed only if they have changed in target org
export async function buildDeployOnChangePackageXml(debugMode: boolean, options: any = {}) {
  if (process.env.SKIP_PACKAGE_DEPLOY_ON_CHANGE === "true") {
    uxLog(this, c.yellow("Skipped packageDeployOnChange.xml management because of env variable SKIP_PACKAGE_DEPLOY_ON_CHANGE='true'"));
    return null;
  }
  // Check if packageDeployOnChange.xml is defined
  const packageDeployOnChangePath = "./manifest/packageDeployOnChange.xml";
  if (!fs.existsSync(packageDeployOnChangePath)) {
    return null;
  }

  // Retrieve sfdx sources in local git repo
  await execCommand(
    `sfdx force:source:retrieve -x ${packageDeployOnChangePath}` + (options.targetUsername ? ` -u ${options.targetUsername}` : ""),
    this,
    {
      fail: true,
      output: true,
      debug: debugMode,
    }
  );

  // Stage updates so sfdx git delta can build diff package.xml
  await git().add("--all");

  // Generate package.xml git delta
  const tmpDir = await createTempDir();
  const sgdHelp = (await execCommand(" sfdx sgd:source:delta --help", this, { fail: false, output: false, debug: debugMode })).stdout;
  const packageXmlGitDeltaCommand =
    `sfdx sgd:source:delta --from "HEAD" --to "*" --output ${tmpDir}` + (sgdHelp.includes("--ignore-whitespace") ? " --ignore-whitespace" : "");
  const gitDeltaCommandRes = await execSfdxJson(packageXmlGitDeltaCommand, this, {
    output: true,
    fail: false,
    debug: debugMode,
    cwd: await getGitRepoRoot(),
  });

  // Now that the diff is computed, we can discard staged items and undo changes
  await git().reset(["--hard"]);

  // Check git delta is ok
  const diffPackageXml = path.join(tmpDir, "package", "package.xml");
  if (gitDeltaCommandRes?.status !== 0 || !fs.existsSync(diffPackageXml)) {
    throw new SfdxError("Error while running sfdx git delta:\n" + JSON.stringify(gitDeltaCommandRes));
  }

  // Remove from original packageDeployOnChange the items that has not been updated
  const packageXmlDeployOnChangeToUse = path.join(tmpDir, "packageDeployOnChange.xml");
  await fs.copy(packageDeployOnChangePath, packageXmlDeployOnChangeToUse);
  await removePackageXmlContent(packageXmlDeployOnChangeToUse, diffPackageXml, false, debugMode);

  // Return result
  return packageXmlDeployOnChangeToUse;
}

// Remove content of a package.xml file from another package.xml file
async function removePackageXmlContent(packageXmlFile: string, packageXmlFileToRemove: string, removedOnly = false, debugMode = false) {
  uxLog(this, c.cyan(`Removing ${c.green(path.basename(packageXmlFileToRemove))} content from ${c.green(path.basename(packageXmlFile))}...`));
  /* let removePackageXmlCommand =
    "sfdx essentials:packagexml:remove" +
    ` --packagexml ${packageXmlFile}` +
    ` --removepackagexml ${packageXmlFileToRemove}` +
    ` --outputfile ${packageXmlFile}` +
    ` --noinsight`;
  if (removedOnly === true) {
    removePackageXmlCommand += " --removedonly";
  }
  await execCommand(removePackageXmlCommand, this, {
    fail: true,
    debug: debugMode,
  }); */
  await removePackageXmlFilesContent(packageXmlFile, packageXmlFileToRemove, {
    outputXmlFile: packageXmlFile,
    logFlag: debugMode,
    removedOnly: removedOnly,
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
    ` --testlevel ${options.testLevel || "NoTestRun"}` +
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
    targetUsername: null,
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
    (options.targetUsername ? ` --targetusername ${options.targetUsername}` : "") +
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
