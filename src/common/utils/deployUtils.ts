import { SfdxError } from "@salesforce/core";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as glob from "glob-promise";
import * as path from "path";
import * as sortArray from "sort-array";
import { createTempDir, elapseEnd, elapseStart, execCommand, execSfdxJson, getCurrentGitBranch, getGitRepoRoot, git, isCI, uxLog } from ".";
import { CONSTANTS, getConfig, setConfig } from "../../config";
import { GitProvider } from "../gitProvider";
import { deployCodeCoverageToMarkdown } from "../gitProvider/utilsMarkdown";
import { MetadataUtils } from "../metadata-utils";
import { importData } from "./dataUtils";
import { analyzeDeployErrorLogs } from "./deployTips";
import { createBlankSfdxProject, isSfdxProject } from "./projectUtils";
import { prompts } from "./prompts";
import { arrangeFilesBefore, restoreArrangedFiles } from "./workaroundUtils";
import { isPackageXmlEmpty, parseXmlFile, removePackageXmlFilesContent, writeXmlFile } from "./xmlUtils";
import { ResetMode } from "simple-git";

// Push sources to org
// For some cases, push must be performed in 2 times: the first with all passing sources, and the second with updated sources requiring the first push
export async function forceSourcePush(scratchOrgAlias: string, commandThis: any, debug = false, options: any = {}) {
  elapseStart("force:source:push");
  const config = await getConfig("user");
  const currentBranch = await getCurrentGitBranch();
  let arrangedFiles = [];
  if (!(config[`tmp_${currentBranch}_pushed`] === true)) {
    arrangedFiles = await arrangeFilesBefore(commandThis, options);
  }
  try {
    const sfdxPushCommand = options.sfdxPushCommand || "force:source:push";
    const pushCommand = `sfdx ${sfdxPushCommand} -g -w 60 --forceoverwrite -u ${scratchOrgAlias}`;
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
    // Manage beta/legacy boza
    const stdOut = e.stdout + e.stderr;
    if (stdOut.includes(`'force:source:legacy:push' with your existing tracking files`)) {
      options.sfdxPushCommand = "force:source:legacy:push";
      uxLog(this, c.yellow("Salesforce internal mess... trying with force:source:legacy:push"));
      const pullRes = await forceSourcePush(scratchOrgAlias, commandThis, debug, options);
      return pullRes;
    } else if (stdOut.includes(`'force:source:beta:push' with your existing tracking files`)) {
      options.sfdxPushCommand = "force:source:beta:push";
      uxLog(this, c.yellow("Salesforce internal mess... trying with force:source:beta:push"));
      const pullRes = await forceSourcePush(scratchOrgAlias, commandThis, debug, options);
      return pullRes;
    } else if (stdOut.includes(`getaddrinfo EAI_AGAIN`)) {
      uxLog(this, c.red(c.bold("The error has been caused by your unstable internet connection. Please Try again !")));
    }
    // Analyze errors
    const { tips, errLog } = await analyzeDeployErrorLogs(stdOut, true, {});
    uxLog(commandThis, c.red("Sadly there has been push error(s)"));
    uxLog(this, c.red("\n" + errLog));
    uxLog(
      commandThis,
      c.yellow(c.bold(`You may${tips.length > 0 ? " also" : ""} copy-paste errors on google to find how to solve the push issues :)`))
    );
    elapseEnd("force:source:push");
    throw new SfdxError("Deployment failure. Check messages above");
  }
}

export async function forceSourcePull(scratchOrgAlias: string, debug = false, options: any = {}) {
  const sfdxPullCommand = options.sfdxPullCommand || "force:source:pull";
  try {
    const pullCommand = `sfdx ${sfdxPullCommand} -w 60 --forceoverwrite -u ${scratchOrgAlias}`;
    await execCommand(pullCommand, this, {
      fail: true,
      output: true,
      debug: debug,
    });
  } catch (e) {
    // Manage beta/legacy boza
    const stdOut = e.stdout + e.stderr;
    if (stdOut.includes(`'force:source:legacy:pull' with your existing tracking files`)) {
      options.sfdxPullCommand = "force:source:legacy:pull";
      uxLog(this, c.yellow("Salesforce internal mess... trying with force:source:legacy:pull"));
      const pullRes = await forceSourcePull(scratchOrgAlias, debug, options);
      return pullRes;
    } else if (stdOut.includes(`'force:source:beta:pull' with your existing tracking files`)) {
      options.sfdxPullCommand = "force:source:beta:pull";
      uxLog(this, c.yellow("Salesforce internal mess... trying with force:source:beta:pull"));
      const pullRes = await forceSourcePull(scratchOrgAlias, debug, options);
      return pullRes;
    }
    // Analyze errors
    const { tips, errLog } = await analyzeDeployErrorLogs(stdOut, true, {});
    uxLog(this, c.red("Sadly there has been pull error(s)"));
    uxLog(this, c.red("\n" + errLog));
    // List unknown elements from output
    const forceIgnoreElements = [...stdOut.matchAll(/Entity of type '(.*)' named '(.*)' cannot be found/gm)];
    if (forceIgnoreElements.length > 0 && !isCI) {
      // Propose user to ignore elements
      const forceIgnoreRes = await prompts({
        type: "multiselect",
        message: "If you want to try again with updated .forceignore file, please select elements you want to add, else escape",
        name: "value",
        choices: forceIgnoreElements.map((forceIgnoreElt) => {
          return {
            title: `${forceIgnoreElt[1]}: ${forceIgnoreElt[2]}`,
            value: forceIgnoreElt[2],
          };
        }),
      });
      if (forceIgnoreRes.value.length > 0 && forceIgnoreRes.value[0] !== "exitNow") {
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

  // Check if some items has to be forced-retrieved because sfdx does not detect updates
  const config = await getConfig("project");
  if (config.autoRetrieveWhenPull) {
    uxLog(this, c.cyan("Retrieving additional sources that are usually forgotten by force:source:pull ..."));
    const metadataConstraint = config.autoRetrieveWhenPull.join(", ");
    const retrieveCommand = `sfdx force:source:retrieve -w 60 -m "${metadataConstraint}" -u ${scratchOrgAlias}`;
    await execCommand(retrieveCommand, this, {
      fail: true,
      output: true,
      debug: debug,
    });
  }
}

export async function forceSourceDeploy(
  packageXmlFile: string,
  check = false,
  testlevel = "RunLocalTests",
  debugMode = false,
  commandThis: any = this,
  options: any = {}
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
        `sfdx force:source:deploy -x "${deployment.packageXmlFile}"` +
        " --wait 60" +
        " --ignorewarnings" + // So it does not fail in for objectTranslations stuff
        ` --testlevel ${testlevel}` +
        (options.preDestructiveChanges ? ` --predestructivechanges ${options.postDestructiveChanges}` : "") +
        (options.postDestructiveChanges ? ` --postdestructivechanges ${options.postDestructiveChanges}` : "") +
        (options.targetUsername ? ` --targetusername ${options.targetUsername}` : "") +
        (check ? " --checkonly" : "") +
        " --verbose" +
        " --coverageformatters json-summary" +
        (process.env.SFDX_DEPLOY_DEV_DEBUG ? " --dev-debug" : "");
      let deployRes;
      try {
        deployRes = await execCommand(deployCommand, commandThis, {
          output: true,
          debug: debugMode,
          fail: true,
          retry: deployment.retry || null,
        });
      } catch (e) {
        const { tips, errLog } = await analyzeDeployErrorLogs(e.stdout + e.stderr, true, { check: check });
        uxLog(commandThis, c.red(c.bold("Sadly there has been Deployment error(s)")));
        uxLog(this, c.red("\n" + errLog));
        uxLog(
          commandThis,
          c.yellow(c.bold(`You may${tips.length > 0 ? " also" : ""} copy-paste errors on google to find how to solve the deployment issues :)`))
        );
        await displayDeploymentLink(e.stdout + e.stderr, options);
        elapseEnd(`deploy ${deployment.label}`);
        await GitProvider.managePostPullRequestComment();
        throw new SfdxError("Deployment failure. Check messages above");
      }

      // Set deployment id
      await getDeploymentId(deployRes.stdout + deployRes.stderr || "");

      // Check org coverage if found in logs
      const orgCoveragePercent = await extractOrgCoverageFromLog(deployRes.stdout + deployRes.stderr || "");
      if (orgCoveragePercent) {
        try {
          await checkDeploymentOrgCoverage(orgCoveragePercent, { check: check });
        } catch (errCoverage) {
          await GitProvider.managePostPullRequestComment();
          throw errCoverage;
        }
      }
      // Post pull request comment if available
      await GitProvider.managePostPullRequestComment();

      // Display deployment status
      if (deployRes.status === 0) {
        message = `[sfdx-hardis] Successfully ${check ? "checked deployment of" : "deployed"} ${c.bold(deployment.label)} to target Salesforce org`;
        uxLog(commandThis, c.green(message));
      } else {
        message = `[sfdx-hardis] Unable to deploy ${c.bold(deployment.label)} to target Salesforce org`;
        uxLog(commandThis, c.red(c.bold(deployRes.errorMessage)));
        await displayDeploymentLink(deployRes.errorMessage, options);
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

export function truncateProgressLogLines(rawLog: string) {
  const rawLogCleaned = rawLog
    .replace(/(SOURCE PROGRESS \|.*\n)/gm, "")
    .replace(/(MDAPI PROGRESS \|.*\n)/gm, "")
    .replace(/(DEPLOY PROGRESS \|.*\n)/gm, "");
  return rawLogCleaned;
}

async function getDeploymentId(rawLog: string) {
  const regex = /Deploy ID: (.*)/gm;
  if (rawLog && rawLog.match(regex)) {
    const deploymentId = regex.exec(rawLog)[1];
    globalThis.pullRequestDeploymentId = deploymentId;
    return deploymentId;
  }
  return null;
}

// Display deployment link in target org
async function displayDeploymentLink(rawLog: string, options: any) {
  let deploymentUrl = "lightning/setup/DeployStatus/home";
  const deploymentId = await getDeploymentId(rawLog);
  if (deploymentId) {
    const detailedDeploymentUrl =
      "/changemgmt/monitorDeploymentsDetails.apexp?" + encodeURIComponent(`retURL=/changemgmt/monitorDeployment.apexp&asyncId=${deploymentId}`);
    deploymentUrl = "lightning/setup/DeployStatus/page?address=" + encodeURIComponent(detailedDeploymentUrl);
  }
  const openRes = await execSfdxJson(
    `sfdx force:org:open -p ${deploymentUrl} --urlonly` + (options.targetUsername ? ` --targetusername ${options.targetUsername}` : ""),
    this,
    {
      fail: true,
      output: false,
    }
  );
  uxLog(this, c.yellowBright(`Open deployment status page in org with url: ${c.bold(c.greenBright(openRes?.result?.url))}`));
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
  // Copy main package.xml so it can be dynamically updated before deployment
  const tmpDeployDir = await createTempDir();
  const mainPackageXmlCopyFileName = path.join(tmpDeployDir, "mainPackage.xml");
  await fs.copy(packageXmlFile, mainPackageXmlCopyFileName);
  const mainPackageXmlItem = {
    label: "main",
    packageXmlFile: mainPackageXmlCopyFileName,
    order: 0,
  };
  const config = await getConfig("user");
  // Build list of package.xml according to plan
  if (config.deploymentPlan && !check) {
    const deploymentItems = [mainPackageXmlItem];

    // Work on deploymentPlan packages before deploying them
    const skipSplitPackages = (process.env.SFDX_HARDIS_DEPLOY_IGNORE_SPLIT_PACKAGES || "true") !== "false";
    if (skipSplitPackages === true) {
      uxLog(this, c.yellow("Do not split package.xml, as SFDX_HARDIS_DEPLOY_IGNORE_SPLIT_PACKAGES=false has not been found in ENV vars"));
    } else {
      for (const deploymentItem of config.deploymentPlan.packages) {
        if (deploymentItem.packageXmlFile) {
          // Copy deployment in temp packageXml file so it can be updated using packageDeployOnce and packageDeployOnChange
          deploymentItem.packageXmlFile = path.resolve(deploymentItem.packageXmlFile);
          const splitPackageXmlCopyFileName = path.join(tmpDeployDir, path.basename(deploymentItem.packageXmlFile));
          await fs.copy(deploymentItem.packageXmlFile, splitPackageXmlCopyFileName);
          deploymentItem.packageXmlFile = splitPackageXmlCopyFileName;
          // Remove split of packageXml content from main package.xml
          await removePackageXmlContent(mainPackageXmlCopyFileName, deploymentItem.packageXmlFile, false, {
            debugMode: debugMode,
            keepEmptyTypes: true,
          });
          await applyPackageXmlFiltering(deploymentItem.packageXmlFile, deployOncePackageXml, deployOnChangePackageXml, debugMode);
        }
        deploymentItems.push(deploymentItem);
      }
    }
    await applyPackageXmlFiltering(mainPackageXmlCopyFileName, deployOncePackageXml, deployOnChangePackageXml, debugMode);

    // Sort in requested order
    const deploymentItemsSorted = sortArray(deploymentItems, {
      by: ["order", "label"],
      order: ["asc", "asc"],
    });
    return deploymentItemsSorted;
  }
  // Return initial package.xml file minus deployOnce and deployOnChange items
  else {
    await applyPackageXmlFiltering(mainPackageXmlCopyFileName, deployOncePackageXml, deployOnChangePackageXml, debugMode);
    return [
      {
        label: "main",
        packageXmlFile: mainPackageXmlCopyFileName,
      },
    ];
  }
}

// Apply packageXml filtering using deployOncePackageXml and deployOnChangePackageXml
async function applyPackageXmlFiltering(packageXml, deployOncePackageXml, deployOnChangePackageXml, debugMode) {
  // Main packageXml: Remove packageDeployOnce.xml items that are already present in target org
  if (deployOncePackageXml) {
    await removePackageXmlContent(packageXml, deployOncePackageXml, false, { debugMode: debugMode, keepEmptyTypes: true });
  }
  //Main packageXml: Remove packageDeployOnChange.xml items that are not different in target org
  if (deployOnChangePackageXml) {
    await removePackageXmlContent(packageXml, deployOnChangePackageXml, false, { debugMode: debugMode, keepEmptyTypes: true });
  }
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
      await buildOrgManifest(options.targetUsername, targetOrgPackageXml, options.conn);

      const packageDeployOnceToUse = path.join(tmpDir, "packageDeployOnce.xml");
      await fs.copy(packageDeployOnce, packageDeployOnceToUse);
      // Keep in deployOnce.xml only what is necessary to deploy
      await removePackageXmlContent(packageDeployOnceToUse, targetOrgPackageXml, true, { debugMode: debugMode, keepEmptyTypes: false });
      uxLog(this, c.grey(`packageDeployOnce.xml with only metadatas that do not exist in target: ${packageDeployOnceToUse}`));
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

  // "Temporarily" commit updates so sfdx git delta can build diff package.xml
  await git().add("--all");
  await git().addConfig("user.email", "dummy@dummy.com", false, "global");
  await git().addConfig("user.name", "Dummy Commit", false, "global");
  await git().commit("chore: `sfdx-hardis` temporary commit", ["--no-verify"]);

  // Generate package.xml git delta
  const tmpDir = await createTempDir();
  const sgdHelp = (await execCommand(" sfdx sgd:source:delta --help", this, { fail: false, output: false, debug: debugMode })).stdout;
  const packageXmlGitDeltaCommand =
    `sfdx sgd:source:delta --from "HEAD~1" --to "HEAD" --output ${tmpDir}` + (sgdHelp.includes("--ignore-whitespace") ? " --ignore-whitespace" : "");
  const gitDeltaCommandRes = await execSfdxJson(packageXmlGitDeltaCommand, this, {
    output: true,
    fail: false,
    debug: debugMode,
    cwd: await getGitRepoRoot(),
  });

  // Now that the diff is computed, we can dump the temporary commit
  await git().reset(ResetMode.HARD, ["HEAD~1"]);

  // Check git delta is ok
  const diffPackageXml = path.join(tmpDir, "package", "package.xml");
  if (gitDeltaCommandRes?.status !== 0 || !fs.existsSync(diffPackageXml)) {
    throw new SfdxError("Error while running sfdx git delta:\n" + JSON.stringify(gitDeltaCommandRes));
  }

  // Remove from original packageDeployOnChange the items that has not been updated
  const packageXmlDeployOnChangeToUse = path.join(tmpDir, "packageDeployOnChange.xml");
  await fs.copy(packageDeployOnChangePath, packageXmlDeployOnChangeToUse);
  await removePackageXmlContent(packageXmlDeployOnChangeToUse, diffPackageXml, false, { debugMode: debugMode, keepEmptyTypes: false });
  uxLog(this, c.grey(`packageDeployOnChange.xml filtered to keep only metadatas that have changed: ${packageXmlDeployOnChangeToUse}`));
  // Return result
  return packageXmlDeployOnChangeToUse;
}

// Remove content of a package.xml file from another package.xml file
async function removePackageXmlContent(
  packageXmlFile: string,
  packageXmlFileToRemove: string,
  removedOnly = false,
  options = { debugMode: false, keepEmptyTypes: false }
) {
  if (removedOnly === false) {
    uxLog(this, c.cyan(`Removing ${c.green(path.basename(packageXmlFileToRemove))} content from ${c.green(path.basename(packageXmlFile))}...`));
  } else {
    uxLog(
      this,
      c.cyan(
        `Keeping ${c.green(path.basename(packageXmlFileToRemove))} content from ${c.green(path.basename(packageXmlFile))} (and remove the rest)...`
      )
    );
  }
  await removePackageXmlFilesContent(packageXmlFile, packageXmlFileToRemove, {
    outputXmlFile: packageXmlFile,
    logFlag: options.debugMode,
    removedOnly: removedOnly,
    keepEmptyTypes: options.keepEmptyTypes || false,
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
    (options.targetUsername ? ` --targetusername ${options.targetUsername}` : "") +
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
    const { errLog } = await analyzeDeployErrorLogs(e.stdout + e.stderr, true, {});
    uxLog(this, c.red("Sadly there has been destruction error(s)"));
    uxLog(this, c.red("\n" + errLog));
    uxLog(
      this,
      c.yellow(
        c.bold(
          "That could be a false positive, as in real deployment, the package.xml deployment will be committed before the use of destructiveChanges.xml"
        )
      )
    );
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
    tryOnce: false,
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
    " --verbose";
  let deployRes;
  try {
    deployRes = await execCommand(deployCommand, this, {
      output: true,
      debug: options.debug,
      fail: true,
    });
  } catch (e) {
    // workaround if --soapdeploy is not available
    if (JSON.stringify(e).includes("--soapdeploy") && !options.tryOnce === true) {
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
      await checkDeploymentErrors(e, options);
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

// Build target org package.xml manifest
export async function buildOrgManifest(targetOrgUsernameAlias, packageXmlOutputFile = null, conn = null) {
  // Manage file name
  if (packageXmlOutputFile === null) {
    const tmpDir = await createTempDir();
    uxLog(this, c.cyan(`Generating full package.xml from target org ${targetOrgUsernameAlias}...`));
    packageXmlOutputFile = path.join(tmpDir, "packageTargetOrg.xml");
  }
  const manifestName = path.basename(packageXmlOutputFile);
  const manifestDir = path.dirname(packageXmlOutputFile);
  // Get default org if not sent as argument (should not happen but better safe than sorry)
  if (targetOrgUsernameAlias == null || targetOrgUsernameAlias == "") {
    const currentOrg = await MetadataUtils.getCurrentOrg();
    if (currentOrg == null) {
      throw new SfdxError("You should call buildOrgManifest while having a default org set !");
    }
    targetOrgUsernameAlias = currentOrg.username;
  }
  if (isSfdxProject()) {
    // Use sfdx manifest build in current project
    await execCommand(
      `sfdx force:source:manifest:create` +
        ` --manifestname ${manifestName}` +
        ` --outputdir ${path.resolve(manifestDir)}` +
        ` --includepackages managed,unlocked` +
        ` --fromorg ${targetOrgUsernameAlias}`,
      this,
      {
        fail: true,
        debug: process.env.DEBUG,
        output: true,
      }
    );
  } else {
    const tmpDirSfdxProject = await createTempDir();
    await createBlankSfdxProject(tmpDirSfdxProject);
    // Use sfdx manifest build in dummy project
    await execCommand(
      `sfdx force:source:manifest:create` +
        ` --manifestname ${manifestName}` +
        ` --outputdir ${path.resolve(manifestDir)}` +
        ` --includepackages managed,unlocked` +
        ` --fromorg ${targetOrgUsernameAlias}`,
      this,
      {
        fail: true,
        cwd: path.join(tmpDirSfdxProject, "sfdx-hardis-blank-project"),
        debug: process.env.DEBUG,
        output: true,
      }
    );
  }
  const packageXmlFull = packageXmlOutputFile;
  if (!fs.existsSync(packageXmlFull)) {
    throw new SfdxError(
      c.red("[sfdx-hardis] Unable to generate package.xml. This is probably an auth issue or a Salesforce technical issue, please try again later")
    );
  }
  // Add Elements that are not returned by sfdx command
  if (conn) {
    const mdTypes = [{ type: "ListView" }, { type: "CustomLabel" }];
    const mdList = await conn.metadata.list(mdTypes, CONSTANTS.API_VERSION);
    const parsedPackageXml = await parseXmlFile(packageXmlFull);
    for (const element of mdList) {
      const matchTypes = parsedPackageXml.Package.types.filter((type) => type.name[0] === element.type);
      if (matchTypes.length === 1) {
        // Add member in existing types
        const members = matchTypes[0].members || [];
        members.push(element.fullName);
        matchTypes[0].members = members.sort();
        parsedPackageXml.Package.types = parsedPackageXml.Package.types.map((type) => (type.name[0] === matchTypes[0].name ? matchTypes[0] : type));
      } else {
        // Create new type
        const newType = {
          name: [element.type],
          members: [element.fullName],
        };
        parsedPackageXml.Package.types.push(newType);
      }
    }

    // Complete with missing WaveDataflow Ids build from WaveRecipe Ids
    const waveRecipeTypeList = parsedPackageXml.Package.types.filter((type) => type.name[0] === "WaveRecipe");
    if (waveRecipeTypeList.length === 1) {
      const waveRecipeType = waveRecipeTypeList[0];
      const waveRecipeTypeMembers = waveRecipeType.members || [];
      const waveDataFlowTypeList = parsedPackageXml.Package.types.filter((type) => type.name[0] === "WaveDataflow");
      let waveDataFlowType = { name: ["WaveDataflow"], members: [] };
      if (waveDataFlowTypeList.length === 1) {
        waveDataFlowType = waveDataFlowTypeList[0];
      }
      for (const recipeId of waveRecipeTypeMembers) {
        if (!waveDataFlowType.members.includes(recipeId)) {
          waveDataFlowType.members.push(recipeId);
          uxLog(this, c.grey(`- Added WaveDataflow ${recipeId} to match WaveRecipe ${recipeId}`));
        }
      }
      waveDataFlowType.members.sort();
      // Update type
      if (waveDataFlowTypeList.length === 1) {
        parsedPackageXml.Package.types = parsedPackageXml.Package.types.map((type) => (type.name[0] === "WaveDataflow" ? waveDataFlowType : type));
      }
      // Add type
      else {
        parsedPackageXml.Package.types.push(waveDataFlowType);
      }
    }

    // Delete stuff we don't want
    parsedPackageXml.Package.types = parsedPackageXml.Package.types.filter((type) => !["CustomLabels"].includes(type.name[0]));
    await writeXmlFile(packageXmlFull, parsedPackageXml);
  }

  return packageXmlFull;
}

export async function extractOrgCoverageFromLog(stdout) {
  let orgCoverage = null;
  // Get from output text
  const fromTest = /Org Wide Coverage *(.*)/.exec(stdout);
  if (fromTest && fromTest[1]) {
    orgCoverage = parseFloat(fromTest[1].replace("%", ""));
  }
  if (orgCoverage && orgCoverage > 0.0) {
    return orgCoverage.toFixed(2);
  }
  // Get from output file
  const writtenToPath = /written to (.*coverage)/.exec(stdout);
  if (writtenToPath && writtenToPath[1]) {
    const jsonFile = path
      .resolve(process.cwd() + path.sep + writtenToPath[1].replace(/\\/g, "/") + path.sep + "coverage-summary.json")
      .replace(/\\/g, "/");
    if (fs.existsSync(jsonFile)) {
      const coverageInfo = JSON.parse(fs.readFileSync(jsonFile, "utf-8"));
      orgCoverage = coverageInfo?.total?.lines?.pct ?? null;
      if (orgCoverage && orgCoverage.toFixed(2) > 0.0) {
        return orgCoverage.toFixed(2);
      }
    }
  }
  uxLog(
    this,
    c.italic(
      c.grey("Unable to get org coverage from results. Maybe try to add --coverageformatters json-summary to your call to force:source:deploy ?")
    )
  );
  return null;
}

// Check if min org coverage is reached
export async function checkDeploymentOrgCoverage(orgCoverage: number, options: any) {
  const config = await getConfig("branch");
  const minCoverageOrgWide = (
    process.env.APEX_TESTS_MIN_COVERAGE_ORG_WIDE ||
    process.env.APEX_TESTS_MIN_COVERAGE ||
    config.apexTestsMinCoverageOrgWide ||
    config.apexTestsMinCoverage ||
    75.0
  ).toFixed(2);
  if (minCoverageOrgWide < 75.0) {
    throw new SfdxError("[sfdx-hardis] Good try, hacker, but minimum org coverage can't be less than 75% :)");
  }
  if (orgCoverage < minCoverageOrgWide) {
    await updatePullRequestResultCoverage("invalid", orgCoverage, minCoverageOrgWide, options);
    throw new SfdxError(`[sfdx-hardis][apextest] Test run coverage (org wide) ${orgCoverage}% should be > to ${minCoverageOrgWide}%`);
  } else {
    await updatePullRequestResultCoverage("valid", orgCoverage, minCoverageOrgWide, options);
    uxLog(this, c.cyan(`[apextest] Test run coverage (org wide) ${c.bold(c.green(orgCoverage))}% is > to ${c.bold(minCoverageOrgWide)}%`));
  }
}

async function checkDeploymentErrors(e, options, commandThis = null) {
  const { tips, errLog } = await analyzeDeployErrorLogs(e.stdout + e.stderr, true, options);
  uxLog(commandThis, c.red(c.bold("Sadly there has been Metadata deployment error(s)...")));
  uxLog(this, c.red("\n" + errLog));
  uxLog(
    commandThis,
    c.yellow(c.bold(`You may${tips.length > 0 ? " also" : ""} copy-paste errors on google to find how to solve the metadata deployment issues :)`))
  );
  await displayDeploymentLink(e.stdout + e.stderr, options);
  // Post pull requests comments if necessary
  await GitProvider.managePostPullRequestComment();
  throw new SfdxError("Metadata deployment failure. Check messages above");
}

// This data will be caught later to build a pull request message
async function updatePullRequestResultCoverage(coverageStatus: string, orgCoverage: number, orgCoverageTarget: number, options: any) {
  const existingPrData = globalThis.pullRequestData || {};
  const prDataCodeCoverage: any = {
    messageKey: existingPrData.messageKey ?? "deployment",
    title: existingPrData.title ?? options.check ? "✅ Deployment check success" : "✅ Deployment success",
    codeCoverageMarkdownBody: "Code coverage is valid",
    deployStatus: existingPrData ?? coverageStatus,
  };
  if (coverageStatus === "invalid") {
    prDataCodeCoverage.title = existingPrData.deployStatus === "valid" ? "❌ Deployment failed: Code coverage error" : prDataCodeCoverage.title;
    prDataCodeCoverage.codeCoverageMarkdownBody = deployCodeCoverageToMarkdown(orgCoverage, orgCoverageTarget);
    prDataCodeCoverage.status = "invalid";
  } else {
    prDataCodeCoverage.codeCoverageMarkdownBody = deployCodeCoverageToMarkdown(orgCoverage, orgCoverageTarget);
  }
  globalThis.pullRequestData = Object.assign(globalThis.pullRequestData || {}, prDataCodeCoverage);
}
