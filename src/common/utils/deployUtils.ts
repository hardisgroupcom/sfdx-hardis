import { Connection, SfError } from '@salesforce/core';
import c from 'chalk';
import fs from 'fs-extra';
import { glob } from 'glob';
import * as path from 'path';
import sortArray from 'sort-array';
import {
  createTempDir,
  elapseEnd,
  elapseStart,
  execCommand,
  execSfdxJson,
  findJsonInString,
  getCurrentGitBranch,
  git,
  gitHasLocalUpdates,
  isCI,
  killBoringExitHandlers,
  replaceJsonInString,
  uxLog,
} from './index.js';
import { CONSTANTS, getConfig, getReportDirectory, setConfig } from '../../config/index.js';
import { GitProvider } from '../gitProvider/index.js';
import { deployCodeCoverageToMarkdown } from '../gitProvider/utilsMarkdown.js';
import { MetadataUtils } from '../metadata-utils/index.js';
import { importData } from './dataUtils.js';
import { analyzeDeployErrorLogs } from './deployTips.js';
import { callSfdxGitDelta } from './gitUtils.js';
import { createBlankSfdxProject, isSfdxProject } from './projectUtils.js';
import { prompts } from './prompts.js';
import { arrangeFilesBefore, restoreArrangedFiles } from './workaroundUtils.js';
import { countPackageXmlItems, isPackageXmlEmpty, parseXmlFile, removePackageXmlFilesContent, writeXmlFile } from './xmlUtils.js';
import { ResetMode } from 'simple-git';
import { isProductionOrg } from './orgUtils.js';
import { soqlQuery } from './apiUtils.js';
import { checkSfdxHardisTraceAvailable } from './orgConfigUtils.js';

// Push sources to org
// For some cases, push must be performed in 2 times: the first with all passing sources, and the second with updated sources requiring the first push
export async function forceSourcePush(scratchOrgAlias: string, commandThis: any, debug = false, options: any = {}) {
  elapseStart('project:deploy:start');
  const config = await getConfig('user');
  const currentBranch = await getCurrentGitBranch();
  let arrangedFiles: any[] = [];
  if (!(config[`tmp_${currentBranch}_pushed`] === true)) {
    arrangedFiles = await arrangeFilesBefore(commandThis, options);
  }
  try {
    const pushCommand = `sf project deploy start --ignore-warnings --ignore-conflicts -o ${scratchOrgAlias} --wait 60 --json`;
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
      await setConfig('user', configToSet);
    }
    elapseEnd('project:deploy:start');
  } catch (e) {
    await restoreArrangedFiles(arrangedFiles, commandThis);
    // Manage beta/legacy boza
    const stdOut = (e as any).stdout + (e as any).stderr;
    if (stdOut.includes(`getaddrinfo EAI_AGAIN`)) {
      uxLog(this, c.red(c.bold('The error has been caused by your unstable internet connection. Please Try again !')));
    }
    // Analyze errors
    const { errLog } = await analyzeDeployErrorLogs(stdOut, true, {});
    uxLog(commandThis, c.red('Sadly there has been push error(s)'));
    uxLog(this, c.red('\n' + errLog));
    elapseEnd('project:deploy:start');
    killBoringExitHandlers();
    throw new SfError('Deployment failure. Check messages above');
  }
}

export async function forceSourcePull(scratchOrgAlias: string, debug = false) {
  let pullCommandResult: any;
  try {
    const pullCommand = `sf project retrieve start --ignore-conflicts -o ${scratchOrgAlias} --wait 60 --json`;
    pullCommandResult = await execCommand(pullCommand, this, {
      fail: true,
      output: true,
      debug: debug,
    });
  } catch (e) {
    // Manage beta/legacy boza
    const stdOut = (e as any).stdout + (e as any).stderr;
    // Analyze errors
    const { errLog } = await analyzeDeployErrorLogs(stdOut, true, {});
    uxLog(this, c.red('Sadly there has been pull error(s)'));
    uxLog(this, c.red('\n' + errLog));
    // List unknown elements from output
    const forceIgnoreElements = [...stdOut.matchAll(/Entity of type '(.*)' named '(.*)' cannot be found/gm)];
    if (forceIgnoreElements.length > 0 && !isCI) {
      // Propose user to ignore elements
      const forceIgnoreRes = await prompts({
        type: 'multiselect',
        message:
          'If you want to try again with updated .forceignore file, please select elements you want to add, else escape',
        name: 'value',
        choices: forceIgnoreElements.map((forceIgnoreElt) => {
          return {
            title: `${forceIgnoreElt[1]}: ${forceIgnoreElt[2]}`,
            value: forceIgnoreElt[2],
          };
        }),
      });
      if (forceIgnoreRes.value.length > 0 && forceIgnoreRes.value[0] !== 'exitNow') {
        const forceIgnoreFile = './.forceignore';
        const forceIgnore = await fs.readFile(forceIgnoreFile, 'utf-8');
        const forceIgnoreLines = forceIgnore.replace('\r\n', '\n').split('\n');
        forceIgnoreLines.push(...forceIgnoreRes.value);
        await fs.writeFile(forceIgnoreFile, forceIgnoreLines.join('\n') + '\n');
        uxLog(this, 'Updated .forceignore file');
        return await forceSourcePull(scratchOrgAlias, debug);
      }
    }
    killBoringExitHandlers();
    throw new SfError('Pull failure. Check messages above');
  }

  // Check if some items has to be forced-retrieved because SF CLI does not detect updates
  const config = await getConfig('project');
  if (config.autoRetrieveWhenPull) {
    uxLog(this, c.cyan('Retrieving additional sources that are usually forgotten by sf project:retrieve:start ...'));
    const metadataConstraint = config.autoRetrieveWhenPull.join(', ');
    const retrieveCommand = `sf project retrieve start -m "${metadataConstraint}" -o ${scratchOrgAlias} --wait 60`;
    await execCommand(retrieveCommand, this, {
      fail: true,
      output: true,
      debug: debug,
    });
  }

  // If there are SharingRules, retrieve all of them to avoid the previous one are deleted (SF Cli strange/buggy behavior)
  if (pullCommandResult?.stdout?.includes("SharingRules")) {
    uxLog(this, c.yellow('Detected Sharing Rules in the pull: retrieving the whole of them to avoid silly overrides !'));
    const sharingRulesNamesMatches = [...pullCommandResult.stdout.matchAll(/([^ \\/]+)\.sharingRules-meta\.xml/gm)];
    for (const match of sharingRulesNamesMatches) {
      uxLog(this, c.grey(`Retrieve the whole ${match[1]} SharingRules...`));
      const retrieveCommand = `sf project retrieve start -m "SharingRules:${match[1]}" -o ${scratchOrgAlias} --wait 60`;
      await execCommand(retrieveCommand, this, {
        fail: true,
        output: true,
        debug: debug,
      });
    }
  }
}

export async function smartDeploy(
  packageXmlFile: string,
  check = false,
  testlevel = 'RunLocalTests',
  debugMode = false,
  commandThis: any = this,
  options: any = {}
): Promise<any> {
  elapseStart('all deployments');
  let quickDeploy = false;
  const splitDeployments = await buildDeploymentPackageXmls(packageXmlFile, check, debugMode, options);
  const messages: any[] = [];
  let deployXmlCount = splitDeployments.length;

  if (deployXmlCount === 0) {
    uxLog(this, 'No deployment to perform');
    return { messages, quickDeploy, deployXmlCount };
  }
  // Replace quick actions with dummy content in case we have dependencies between Flows & QuickActions
  await replaceQuickActionsWithDummy();
  // Run deployment pre-commands
  await executePrePostCommands('commandsPreDeploy', { success: true, checkOnly: check, conn: options.conn });
  // Process items of deployment plan
  uxLog(this, c.cyan('Processing split deployments build from deployment plan...'));
  uxLog(this, c.whiteBright(JSON.stringify(splitDeployments, null, 2)));
  for (const deployment of splitDeployments) {
    elapseStart(`deploy ${deployment.label}`);
    // Skip this deployment items if there is nothing to deploy in package.xml
    if (
      deployment.packageXmlFile &&
      (await isPackageXmlEmpty(deployment.packageXmlFile, { ignoreStandaloneParentItems: true }))
    ) {
      uxLog(
        commandThis,
        c.cyan(
          `Skipped ${c.bold(
            deployment.label
          )} deployment because package.xml is empty or contains only standalone parent items.\n${c.grey(
            c.italic('This may be related to filtering using package-no-overwrite.xml or packageDeployOnChange.xml')
          )}`
        )
      );
      deployXmlCount--;
      elapseEnd(`deploy ${deployment.label}`);
      continue;
    }
    let message = '';
    // Wait before deployment item process if necessary
    if (deployment.waitBefore) {
      uxLog(commandThis, `Waiting ${deployment.waitBefore} seconds before deployment according to deployment plan`);
      await new Promise((resolve) => setTimeout(resolve, deployment.waitBefore * 1000));
    }
    // Deployment of type package.xml file
    if (deployment.packageXmlFile) {
      const nbDeployedItems = await countPackageXmlItems(deployment.packageXmlFile);
      uxLog(
        commandThis,
        c.cyan(
          `${check ? 'Simulating deployment of' : 'Deploying'} ${c.bold(deployment.label)} package: ${deployment.packageXmlFile
          } (${nbDeployedItems} items)...`
        )
      );
      // Try QuickDeploy
      if (check === false && (process.env?.SFDX_HARDIS_QUICK_DEPLOY || '') !== 'false') {
        const deploymentCheckId = await GitProvider.getDeploymentCheckId();
        if (deploymentCheckId) {
          const quickDeployCommand =
            `sf project deploy quick` +
            ` --job-id ${deploymentCheckId} ` +
            (options.targetUsername ? ` -o ${options.targetUsername}` : '') +
            ` --wait ${process.env.SFDX_DEPLOY_WAIT_MINUTES || '120'}` +
            (debugMode ? ' --verbose' : '') +
            (process.env.SFDX_DEPLOY_DEV_DEBUG ? ' --dev-debug' : '');
          const quickDeployRes = await execSfdxJson(quickDeployCommand, commandThis, {
            output: true,
            debug: debugMode,
            fail: false,
          });
          if (quickDeployRes.status === 0) {
            uxLog(commandThis, c.green(`Successfully processed QuickDeploy for deploymentId ${deploymentCheckId}`));
            uxLog(
              commandThis,
              c.yellow(
                'If you do not want to use QuickDeploy feature, define env variable SFDX_HARDIS_QUICK_DEPLOY=false'
              )
            );
            quickDeploy = true;
            continue;
          } else {
            uxLog(
              commandThis,
              c.yellow(
                `Unable to perform QuickDeploy for deploymentId ${deploymentCheckId}.\n${quickDeployRes.errorMessage}.`
              )
            );
            uxLog(commandThis, c.green("Switching back to effective deployment not using QuickDeploy: that's ok :)"));
            const isProdOrg = await isProductionOrg(options.targetUsername || "", options);
            if (!isProdOrg) {
              testlevel = 'NoTestRun';
              uxLog(
                commandThis,
                c.green(
                  'Note: run with NoTestRun to improve perfs as we had previously succeeded to simulate the deployment'
                )
              );
            }
          }
        }
      }
      // No QuickDeploy Available, or QuickDeploy failing : try full deploy
      const branchConfig = await getConfig('branch');
      const reportDir = await getReportDirectory();
      const deployCommand =
        `sf project deploy` +
        // (check && testlevel !== 'NoTestRun' ? ' validate' : ' start') + // Not until validate command is correct and accepts ignore-warnings
        ' start' +
        // (check && testlevel === 'NoTestRun' ? ' --dry-run' : '') + // validate with NoTestRun does not work, so use --dry-run
        (check ? ' --dry-run' : '') +
        ` --manifest "${deployment.packageXmlFile}"` +
        ' --ignore-warnings' + // So it does not fail in for objectTranslations stuff for example
        ' --ignore-conflicts' + // With CICD we are supposed to ignore them
        ` --results-dir ${reportDir}` +
        ` --test-level ${testlevel}` +
        (options.testClasses && testlevel !== 'NoTestRun' ? ` --tests ${options.testClasses}` : '') +
        (options.preDestructiveChanges ? ` --pre-destructive-changes ${options.preDestructiveChanges}` : '') +
        (options.postDestructiveChanges ? ` --post-destructive-changes ${options.postDestructiveChanges}` : '') +
        (options.targetUsername ? ` -o ${options.targetUsername}` : '') +
        (testlevel === 'NoTestRun' || branchConfig?.skipCodeCoverage === true ? '' : ' --coverage-formatters json-summary') +
        ((testlevel === 'NoTestRun' || branchConfig?.skipCodeCoverage === true) && process.env?.COVERAGE_FORMATTER_JSON === "true" ? '' : ' --coverage-formatters json') +
        (debugMode ? ' --verbose' : '') +
        ` --wait ${process.env.SFDX_DEPLOY_WAIT_MINUTES || '120'}` +
        (process.env.SFDX_DEPLOY_DEV_DEBUG ? ' --dev-debug' : '') +
        ` --json`;
      let deployRes;
      try {
        deployRes = await execCommand(deployCommand, commandThis, {
          output: false,
          debug: debugMode,
          fail: true,
          retry: deployment.retry || null,
        });
        if (deployRes.status === 0) {
          uxLog(commandThis, c.grey(shortenLogLines(JSON.stringify(deployRes))));
        }
      } catch (e: any) {
        await generateApexCoverageOutputFile();
        deployRes = await handleDeployError(e, check, branchConfig, commandThis, options, deployment);
      }
      if (typeof deployRes === 'object') {
        deployRes.stdout = JSON.stringify(deployRes);
      }
      await generateApexCoverageOutputFile();

      // Set deployment id
      await getDeploymentId(deployRes.stdout + deployRes.stderr || '');

      // Check org coverage if found in logs
      const orgCoveragePercent = await extractOrgCoverageFromLog(deployRes.stdout + deployRes.stderr || '');
      if (orgCoveragePercent) {
        try {
          await checkDeploymentOrgCoverage(Number(orgCoveragePercent), { check: check, testlevel: testlevel });
        } catch (errCoverage) {
          if (check) {
            await GitProvider.managePostPullRequestComment();
          }
          killBoringExitHandlers();
          throw errCoverage;
        }
      } else {
        // Handle notif message when there is no apex
        const existingPrData = globalThis.pullRequestData || {};
        const prDataCodeCoverage: any = {
          messageKey: existingPrData.messageKey ?? 'deployment',
          title: existingPrData.title ?? check ? '✅ Deployment check success' : '✅ Deployment success',
          codeCoverageMarkdownBody:
            testlevel === 'NoTestRun'
              ? '⚠️ Apex Tests has not been run thanks to useSmartDeploymentTests' :
              branchConfig?.skipCodeCoverage === true
                ? '✅⚠️ Code coverage has been skipped for this level'
                : '✅ No code coverage: It seems there is not Apex in this project',
          deployStatus: 'valid',
        };
        globalThis.pullRequestData = Object.assign(globalThis.pullRequestData || {}, prDataCodeCoverage);
      }
      // Post pull request comment if available
      if (check) {
        await GitProvider.managePostPullRequestComment();
      }

      let extraInfo = options?.delta === true ? 'DELTA Deployment' : 'FULL Deployment';
      if (quickDeploy === true) {
        extraInfo += ' (using Quick Deploy)';
      }

      // Display deployment status
      if (deployRes.status === 0) {
        message =
          `[sfdx-hardis] Successfully ${check ? 'checked deployment of' : 'deployed'} ${c.bold(
            deployment.label
          )} to target Salesforce org - ` + extraInfo;
        uxLog(commandThis, c.green(message));
        if (deployRes?.testCoverageNotBlockingActivated === true) {
          uxLog(
            commandThis,
            c.yellow(
              'There is a code coverage issue, but the check is passing by design because you configured testCoverageNotBlocking: true in your branch .sfdx-hardis.yml'
            )
          );
        }
      } else {
        message = `[sfdx-hardis] Unable to deploy ${c.bold(deployment.label)} to target Salesforce org - ` + extraInfo;
        uxLog(commandThis, c.red(c.bold(deployRes.errorMessage)));
        await displayDeploymentLink(deployRes.errorMessage, options);
      }
      // Restore quickActions after deployment of main package
      if (deployment.packageXmlFile.includes('mainPackage.xml')) {
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
  // Run deployment post commands
  await executePrePostCommands('commandsPostDeploy', { success: true, checkOnly: check, conn: options.conn });
  elapseEnd('all deployments');
  return { messages, quickDeploy, deployXmlCount };
}

async function handleDeployError(
  e: any,
  check: boolean,
  branchConfig: any,
  commandThis: any,
  options: any,
  deployment: any
) {
  const output: string = (e as any).stdout + (e as any).stderr;
  // Handle coverage error if ignored
  if (
    check === true &&
    branchConfig?.testCoverageNotBlocking === true &&
    (output.includes('=== Test Success') || output.includes('Test Success [')) &&
    !output.includes('Test Failures') &&
    (output.includes('=== Apex Code Coverage') || output.includes("Failing: 0"))
  ) {
    uxLog(commandThis, c.yellow(c.bold('Deployment status: Deploy check success & Ignored test coverage error')));
    return { status: 0, stdout: (e as any).stdout, stderr: (e as any).stderr, testCoverageNotBlockingActivated: true };
  }
  // Handle Effective error
  const { errLog } = await analyzeDeployErrorLogs(output, true, { check: check });
  uxLog(commandThis, c.red(c.bold('Sadly there has been Deployment error(s)')));
  if (process.env?.SFDX_HARDIS_DEPLOY_ERR_COLORS === 'false') {
    uxLog(this, '\n' + errLog);
  } else {
    uxLog(this, c.red('\n' + errLog));
  }
  await displayDeploymentLink(output, options);
  elapseEnd(`deploy ${deployment.label}`);
  if (check) {
    await GitProvider.managePostPullRequestComment();
  }
  await executePrePostCommands('commandsPostDeploy', { success: false, checkOnly: check, conn: options.conn });
  killBoringExitHandlers();
  throw new SfError('Deployment failure. Check messages above');
}

export function shortenLogLines(rawLog: string) {
  let rawLogCleaned = rawLog
    .replace(/(SOURCE PROGRESS \|.*\n)/gm, '')
    .replace(/(MDAPI PROGRESS \|.*\n)/gm, '')
    .replace(/(DEPLOY PROGRESS \|.*\n)/gm, '')
    .replace(/(Status: In Progress \|.*\n)/gm, '');
  // Truncate JSON if huge log
  if (rawLogCleaned.split("\n").length > 1000 && !(process.env?.NO_TRUNCATE_LOGS === "true")) {
    const msg = "Result truncated by sfdx-hardis. Define NO_TRUNCATE_LOGS=true tu have full JSON logs";
    const jsonLog = findJsonInString(rawLogCleaned);
    if (jsonLog) {
      if (jsonLog?.result?.details?.componentSuccesses) {
        jsonLog.result.details.componentSuccesses = jsonLog.result.details.componentSuccesses.filter(item => item.changed === true);
        jsonLog.truncatedBySfdxHardis = msg;
      }
      if (jsonLog?.result?.details?.runTestResult) {
        delete jsonLog.result.details.runTestResult;
        jsonLog.truncatedBySfdxHardis = msg;
      }
      if (jsonLog?.result?.files) {
        jsonLog.result.files = jsonLog.result.files.filter(item => item.state === 'Changed');
        jsonLog.truncatedBySfdxHardis = msg;
      }
      rawLogCleaned = replaceJsonInString(rawLogCleaned, jsonLog);
    }
  }
  return rawLogCleaned;
}

async function getDeploymentId(rawLog: string) {
  // JSON Mode
  const jsonLog = findJsonInString(rawLog);
  if (jsonLog) {
    const deploymentId = jsonLog?.result?.id || null;
    if (deploymentId) {
      globalThis.pullRequestDeploymentId = deploymentId;
      return deploymentId;
    }
  }
  // Text mode
  const regex = /Deploy ID: (.*)/gm;
  if (rawLog && rawLog.match(regex)) {
    const deploymentId = (regex.exec(rawLog) || [])[1];
    globalThis.pullRequestDeploymentId = deploymentId;
    return deploymentId;
  }
  uxLog(this, c.yellow(`Unable to find deploymentId in logs \n${c.grey(rawLog)}`));
  return null;
}

// Display deployment link in target org
async function displayDeploymentLink(rawLog: string, options: any) {
  if (process?.env?.SFDX_HARDIS_DISPLAY_DEPLOYMENT_LINK === 'true') {
    let deploymentUrl = 'lightning/setup/DeployStatus/home';
    const deploymentId = await getDeploymentId(rawLog);
    if (deploymentId) {
      const detailedDeploymentUrl =
        '/changemgmt/monitorDeploymentsDetails.apexp?' +
        encodeURIComponent(`retURL=/changemgmt/monitorDeployment.apexp&asyncId=${deploymentId}`);
      deploymentUrl = 'lightning/setup/DeployStatus/page?address=' + encodeURIComponent(detailedDeploymentUrl);
    }
    const openRes = await execSfdxJson(
      `sf org open -p ${deploymentUrl} --url-only` +
      (options.targetUsername ? ` --target-org ${options.targetUsername}` : ''),
      this,
      {
        fail: true,
        output: false,
      }
    );
    uxLog(
      this,
      c.yellowBright(`Open deployment status page in org with url: ${c.bold(c.greenBright(openRes?.result?.url))}`)
    );
  }
}

// In some case we can not deploy the whole package.xml, so let's split it before :)
async function buildDeploymentPackageXmls(
  packageXmlFile: string,
  check: boolean,
  debugMode: boolean,
  options: any = {}
): Promise<any[]> {
  // Check for empty package.xml
  if (await isPackageXmlEmpty(packageXmlFile)) {
    uxLog(this, 'Empty package.xml: nothing to deploy');
    return [];
  }
  const deployOncePackageXml = await buildDeployOncePackageXml(debugMode, options);
  const deployOnChangePackageXml = await buildDeployOnChangePackageXml(debugMode, options);
  // Copy main package.xml so it can be dynamically updated before deployment
  const tmpDeployDir = await createTempDir();
  const mainPackageXmlCopyFileName = path.join(tmpDeployDir, 'calculated-package.xml');
  await fs.copy(packageXmlFile, mainPackageXmlCopyFileName);
  const mainPackageXmlItem = {
    label: 'calculated-package-xml',
    packageXmlFile: mainPackageXmlCopyFileName,
    order: 0,
  };
  const config = await getConfig('user');
  // Build list of package.xml according to plan
  if (config.deploymentPlan && !check) {
    const deploymentItems = [mainPackageXmlItem];

    // Work on deploymentPlan packages before deploying them
    const skipSplitPackages = (process.env.SFDX_HARDIS_DEPLOY_IGNORE_SPLIT_PACKAGES || 'true') !== 'false';
    if (skipSplitPackages === true) {
      uxLog(
        this,
        c.yellow(
          'Do not split package.xml, as SFDX_HARDIS_DEPLOY_IGNORE_SPLIT_PACKAGES=false has not been found in ENV vars'
        )
      );
    } else {
      for (const deploymentItem of config.deploymentPlan.packages) {
        if (deploymentItem.packageXmlFile) {
          // Copy deployment in temp packageXml file so it can be updated using package-no-overwrite and packageDeployOnChange
          deploymentItem.packageXmlFile = path.resolve(deploymentItem.packageXmlFile);
          const splitPackageXmlCopyFileName = path.join(tmpDeployDir, path.basename(deploymentItem.packageXmlFile));
          await fs.copy(deploymentItem.packageXmlFile, splitPackageXmlCopyFileName);
          deploymentItem.packageXmlFile = splitPackageXmlCopyFileName;
          // Remove split of packageXml content from main package.xml
          await removePackageXmlContent(mainPackageXmlCopyFileName, deploymentItem.packageXmlFile, false, {
            debugMode: debugMode,
            keepEmptyTypes: true,
          });
          await applyPackageXmlFiltering(
            deploymentItem.packageXmlFile,
            deployOncePackageXml,
            deployOnChangePackageXml,
            debugMode
          );
        }
        deploymentItems.push(deploymentItem);
      }
    }
    await applyPackageXmlFiltering(
      mainPackageXmlCopyFileName,
      deployOncePackageXml,
      deployOnChangePackageXml,
      debugMode
    );

    // Sort in requested order
    const deploymentItemsSorted = sortArray(deploymentItems, {
      by: ['order', 'label'],
      order: ['asc', 'asc'],
    });
    return deploymentItemsSorted;
  }
  // Return initial package.xml file minus deployOnce and deployOnChange items
  else {
    await applyPackageXmlFiltering(
      mainPackageXmlCopyFileName,
      deployOncePackageXml,
      deployOnChangePackageXml,
      debugMode
    );
    return [
      {
        label: 'calculated-package-xml',
        packageXmlFile: mainPackageXmlCopyFileName,
      },
    ];
  }
}

// Apply packageXml filtering using deployOncePackageXml and deployOnChangePackageXml
async function applyPackageXmlFiltering(packageXml, deployOncePackageXml, deployOnChangePackageXml, debugMode) {
  // Main packageXml: Remove package-no-overwrite.xml items that are already present in target org
  if (deployOncePackageXml) {
    await removePackageXmlContent(packageXml, deployOncePackageXml, false, {
      debugMode: debugMode,
      keepEmptyTypes: true,
    });
  }
  //Main packageXml: Remove packageDeployOnChange.xml items that are not different in target org
  if (deployOnChangePackageXml) {
    await removePackageXmlContent(packageXml, deployOnChangePackageXml, false, {
      debugMode: debugMode,
      keepEmptyTypes: true,
    });
  }
}

// package-no-overwrite.xml items are deployed only if they are not in the target org
async function buildDeployOncePackageXml(debugMode = false, options: any = {}) {
  if (process.env.SKIP_PACKAGE_DEPLOY_ONCE === 'true') {
    uxLog(
      this,
      c.yellow("Skipped package-no-overwrite.xml management because of env variable SKIP_PACKAGE_DEPLOY_ONCE='true'")
    );
    return null;
  }
  // Get default package-no-overwrite
  let packageNoOverwrite = path.resolve('./manifest/package-no-overwrite.xml');
  if (!fs.existsSync(packageNoOverwrite)) {
    packageNoOverwrite = path.resolve('./manifest/packageDeployOnce.xml');
  }
  const config = await getConfig("branch");
  if (process.env?.PACKAGE_NO_OVERWRITE_PATH || config?.packageNoOverwritePath) {
    packageNoOverwrite = process.env.PACKAGE_NO_OVERWRITE_PATH || config?.packageNoOverwritePath;
    if (!fs.existsSync(packageNoOverwrite)) {
      throw new SfError(`packageNoOverwritePath property or PACKAGE_NO_OVERWRITE_PATH leads not existing file ${packageNoOverwrite}`);
    }
    uxLog(this, c.grey(`Using custom package-no-overwrite file defined at ${packageNoOverwrite}`));
  }
  if (fs.existsSync(packageNoOverwrite)) {
    uxLog(this, c.cyan('Handling package-no-overwrite.xml...'));
    // If package-no-overwrite.xml is not empty, build target org package.xml and remove its content from packageOnce.xml
    if (!(await isPackageXmlEmpty(packageNoOverwrite))) {
      const tmpDir = await createTempDir();
      // Build target org package.xml
      uxLog(
        this,
        c.cyan(
          `Generating full package.xml from target org to identify its items matching with package-no-overwrite.xml ...`
        )
      );
      const targetOrgPackageXml = path.join(tmpDir, 'packageTargetOrg.xml');
      await buildOrgManifest(options.targetUsername, targetOrgPackageXml, options.conn);

      let calculatedPackageNoOverwrite = path.join(tmpDir, 'package-no-overwrite.xml');
      await fs.copy(packageNoOverwrite, calculatedPackageNoOverwrite);
      // Keep in deployOnce.xml only what is necessary to deploy
      await removePackageXmlContent(calculatedPackageNoOverwrite, targetOrgPackageXml, true, {
        debugMode: debugMode,
        keepEmptyTypes: false,
      });
      await fs.copy(calculatedPackageNoOverwrite, path.join(tmpDir, 'calculated-package-no-overwrite.xml'));
      calculatedPackageNoOverwrite = path.join(tmpDir, 'calculated-package-no-overwrite.xml');
      uxLog(
        this,
        c.grey(
          `calculated-package-no-overwrite.xml with only items that already exist in target org: ${calculatedPackageNoOverwrite}`
        )
      );
      // Check if there is still something in calculated-package-no-overwrite.xml
      if (!(await isPackageXmlEmpty(calculatedPackageNoOverwrite))) {
        return calculatedPackageNoOverwrite;
      }
    }
  }
  return null;
}

// packageDeployOnChange.xml items are deployed only if they have changed in target org
export async function buildDeployOnChangePackageXml(debugMode: boolean, options: any = {}) {
  if (process.env.SKIP_PACKAGE_DEPLOY_ON_CHANGE === 'true') {
    uxLog(
      this,
      c.yellow(
        "Skipped packageDeployOnChange.xml management because of env variable SKIP_PACKAGE_DEPLOY_ON_CHANGE='true'"
      )
    );
    return null;
  }
  // Check if packageDeployOnChange.xml is defined
  const packageDeployOnChangePath = './manifest/packageDeployOnChange.xml';
  if (!fs.existsSync(packageDeployOnChangePath)) {
    return null;
  }

  // Retrieve sfdx sources in local git repo
  await execCommand(
    `sf project retrieve start --manifest ${packageDeployOnChangePath}` +
    (options.targetUsername ? ` --target-org ${options.targetUsername}` : ''),
    this,
    {
      fail: true,
      output: true,
      debug: debugMode,
    }
  );

  // Do not call delta if no updated file has been retrieved
  const hasGitLocalUpdates = await gitHasLocalUpdates();
  if (hasGitLocalUpdates === false) {
    uxLog(this, c.grey('No diff retrieved from packageDeployOnChange.xml'));
    return null;
  }

  // "Temporarily" commit updates so sfdx-git-delta can build diff package.xml
  await git().addConfig('user.email', 'bot@hardis.com', false, 'global');
  await git().addConfig('user.name', 'Hardis', false, 'global');
  await git().add('--all');
  await git().commit('"temp"', ['--no-verify']);

  // Generate package.xml git delta
  const tmpDir = await createTempDir();
  const gitDeltaCommandRes = await callSfdxGitDelta('HEAD~1', 'HEAD', tmpDir, { debug: debugMode });

  // Now that the diff is computed, we can dump the temporary commit
  await git().reset(ResetMode.HARD, ['HEAD~1']);

  // Check git delta is ok
  const diffPackageXml = path.join(tmpDir, 'package', 'package.xml');
  if (gitDeltaCommandRes?.status !== 0 || !fs.existsSync(diffPackageXml)) {
    throw new SfError('Error while running sfdx-git-delta:\n' + JSON.stringify(gitDeltaCommandRes));
  }

  // Remove from original packageDeployOnChange the items that has not been updated
  const packageXmlDeployOnChangeToUse = path.join(tmpDir, 'packageDeployOnChange.xml');
  await fs.copy(packageDeployOnChangePath, packageXmlDeployOnChangeToUse);
  await removePackageXmlContent(packageXmlDeployOnChangeToUse, diffPackageXml, false, {
    debugMode: debugMode,
    keepEmptyTypes: false,
  });
  uxLog(
    this,
    c.grey(
      `packageDeployOnChange.xml filtered to keep only metadatas that have changed: ${packageXmlDeployOnChangeToUse}`
    )
  );
  // Return result
  return packageXmlDeployOnChangeToUse;
}

// Remove content of a package.xml file from another package.xml file
export async function removePackageXmlContent(
  packageXmlFile: string,
  packageXmlFileToRemove: string,
  removedOnly = false,
  options = { debugMode: false, keepEmptyTypes: false }
) {
  if (removedOnly === false) {
    uxLog(
      this,
      c.cyan(
        `Removing ${c.green(path.basename(packageXmlFileToRemove))} items from ${c.green(
          path.basename(packageXmlFile)
        )}...`
      )
    );
  } else {
    uxLog(
      this,
      c.cyan(
        `Keeping ${c.green(path.basename(packageXmlFileToRemove))} items matching with ${c.green(
          path.basename(packageXmlFile)
        )} (and remove the rest)...`
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
export async function deployDestructiveChanges(
  packageDeletedXmlFile: string,
  options: any = { debug: false, check: false },
  commandThis: any
) {
  // Create empty deployment file because of SF CLI limitation
  // cf https://gist.github.com/benahm/b590ecf575ff3c42265425233a2d727e
  uxLog(commandThis, c.cyan(`Deploying destructive changes from file ${path.resolve(packageDeletedXmlFile)}`));
  const tmpDir = await createTempDir();
  const emptyPackageXmlFile = path.join(tmpDir, 'package.xml');
  await fs.writeFile(
    emptyPackageXmlFile,
    `<?xml version="1.0" encoding="UTF-8"?>
    <Package xmlns="http://soap.sforce.com/2006/04/metadata">
        <version>${CONSTANTS.API_VERSION}</version>
    </Package>`,
    'utf8'
  );
  await fs.copy(packageDeletedXmlFile, path.join(tmpDir, 'destructiveChanges.xml'));
  const deployDelete =
    `sf project deploy ${options.check ? 'validate' : 'start'} --metadata-dir ${tmpDir}` +
    ` --wait ${process.env.SFDX_DEPLOY_WAIT_MINUTES || '120'}` +
    ` --test-level ${options.testLevel || 'NoTestRun'}` +
    ' --ignore-warnings' + // So it does not fail in case metadata is already deleted
    (options.targetUsername ? ` --target-org ${options.targetUsername}` : '') +
    (options.debug ? ' --verbose' : '') +
    ' --json';
  // Deploy destructive changes
  let deployDeleteRes: any = {};
  try {
    deployDeleteRes = await execCommand(deployDelete, commandThis, {
      output: true,
      debug: options.debug,
      fail: true,
    });
  } catch (e) {
    const { errLog } = await analyzeDeployErrorLogs((e as any).stdout + (e as any).stderr, true, {});
    uxLog(this, c.red('Sadly there has been destruction error(s)'));
    uxLog(this, c.red('\n' + errLog));
    uxLog(
      this,
      c.yellow(
        c.bold(
          'That could be a false positive, as in real deployment, the package.xml deployment will be committed before the use of destructiveChanges.xml'
        )
      )
    );
    killBoringExitHandlers();
    throw new SfError('Error while deploying destructive changes');
  }
  await fs.remove(tmpDir);
  let deleteMsg = '';
  if (deployDeleteRes.status === 0) {
    deleteMsg = `[sfdx-hardis] Successfully ${options.check ? 'checked deployment of' : 'deployed'
      } destructive changes to Salesforce org`;
    uxLog(commandThis, c.green(deleteMsg));
  } else {
    deleteMsg = '[sfdx-hardis] Unable to deploy destructive changes to Salesforce org';
    uxLog(commandThis, c.red(deployDeleteRes.errorMessage));
  }
}

export async function deployMetadatas(
  options: any = {
    deployDir: '.',
    testlevel: 'RunLocalTests',
    check: false,
    debug: false,
    targetUsername: null,
    tryOnce: false,
  }
) {
  // Perform deployment
  const deployCommand =
    `sf project deploy ${options.check ? 'validate' : 'start'}` +
    ` --metadata-dir ${options.deployDir || '.'}` +
    ` --wait ${process.env.SFDX_DEPLOY_WAIT_MINUTES || '120'}` +
    ` --test-level ${options.testlevel || 'RunLocalTests'}` +
    ` --api-version ${options.apiVersion || CONSTANTS.API_VERSION}` +
    (options.targetUsername ? ` --target-org ${options.targetUsername}` : '') +
    (options.debug ? ' --verbose' : '') +
    ' --json';
  let deployRes;
  try {
    deployRes = await execCommand(deployCommand, this, {
      output: true,
      debug: options.debug,
      fail: true,
    });
  } catch (e) {
    // workaround if --soapdeploy is not available
    if (JSON.stringify(e).includes('--soapdeploy') && !options.tryOnce === true) {
      uxLog(this, c.yellow("This may be a error with a workaround... let's try it :)"));
      try {
        deployRes = await execCommand(deployCommand.replace(' --soapdeploy', ''), this, {
          output: true,
          debug: options.debug,
          fail: true,
        });
      } catch (e2) {
        if (JSON.stringify(e2).includes('NoTestRun')) {
          // Another workaround: try running tests
          uxLog(this, c.yellow("This may be again an error with a workaround... let's make a last attempt :)"));
          deployRes = await execCommand(
            deployCommand.replace(' --soapdeploy', '').replace('NoTestRun', 'RunLocalTests'),
            this,
            {
              output: true,
              debug: options.debug,
              fail: true,
            }
          );
        } else {
          killBoringExitHandlers();
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
  if (process.env.CI_DEPLOY_QUICK_ACTIONS_DUMMY === 'true') {
    uxLog(this, c.cyan('Replacing QuickActions content with Dummy content that will always pass...'));
    quickActionsBackUpFolder = await createTempDir();
    const patternQuickActions = process.cwd() + '/force-app/' + `**/quickActions/*__c.*.quickAction-meta.xml`;
    const matchQuickActions = await glob(patternQuickActions, { cwd: process.cwd() });
    for (const quickActionFile of matchQuickActions) {
      const tmpBackupFile = path.join(
        quickActionsBackUpFolder,
        path.resolve(quickActionFile).replace(path.resolve(process.cwd()), '')
      );
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
      uxLog(this, c.grey('Backuped and replaced ' + quickActionFile));
    }
  }
}

// Restore original QuickActions
async function restoreQuickActions() {
  if (process.env.CI_DEPLOY_QUICK_ACTIONS_DUMMY === 'true') {
    const patternQuickActionsBackup =
      quickActionsBackUpFolder + '/force-app/' + `**/quickActions/*.quickAction-meta.xml`;
    const matchQuickActions = await glob(patternQuickActionsBackup, {
      cwd: process.cwd(),
    });
    for (const quickActionFile of matchQuickActions) {
      const prevFileName = path
        .resolve(quickActionFile)
        .replace(path.resolve(quickActionsBackUpFolder), path.resolve(process.cwd()));
      await fs.copy(quickActionFile, prevFileName);
      uxLog(this, c.grey('Restored ' + quickActionFile));
    }
  }
}

// Build target org package.xml manifest
export async function buildOrgManifest(
  targetOrgUsernameAlias,
  packageXmlOutputFile: string | null = null,
  conn: any | null = null
) {
  // Manage file name
  if (packageXmlOutputFile === null) {
    const tmpDir = await createTempDir();
    uxLog(this, c.cyan(`Generating full package.xml from target org ${targetOrgUsernameAlias}...`));
    packageXmlOutputFile = path.join(tmpDir, 'packageTargetOrg.xml');
  }
  const manifestName = path.basename(packageXmlOutputFile);
  const manifestDir = path.dirname(packageXmlOutputFile);
  // Get default org if not sent as argument (should not happen but better safe than sorry)
  if (targetOrgUsernameAlias == null || targetOrgUsernameAlias == '') {
    const currentOrg = await MetadataUtils.getCurrentOrg();
    if (currentOrg == null) {
      throw new SfError('You should call buildOrgManifest while having a default org set !');
    }
    targetOrgUsernameAlias = currentOrg.username;
  }
  if (isSfdxProject()) {
    // Use sfdx manifest build in current project
    await execCommand(
      `sf project generate manifest` +
      ` --name ${manifestName}` +
      ` --output-dir ${path.resolve(manifestDir)}` +
      ` --include-packages managed,unlocked` +
      ` --from-org ${targetOrgUsernameAlias}`,
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
      `sf project generate manifest` +
      ` --name ${manifestName}` +
      ` --output-dir ${path.resolve(manifestDir)}` +
      ` --include-packages managed,unlocked` +
      ` --from-org ${targetOrgUsernameAlias}`,
      this,
      {
        fail: true,
        cwd: path.join(tmpDirSfdxProject, 'sfdx-hardis-blank-project'),
        debug: process.env.DEBUG,
        output: true,
      }
    );
  }
  const packageXmlFull = packageXmlOutputFile;
  if (!fs.existsSync(packageXmlFull)) {
    throw new SfError(
      c.red(
        '[sfdx-hardis] Unable to generate package.xml. This is probably an auth issue or a Salesforce technical issue, please try again later'
      )
    );
  }
  // Add Elements that are not returned by SF CLI command
  if (conn) {
    uxLog(this, c.grey('Looking for package.xml elements that are not returned by manifest create command...'));
    const mdTypes = [{ type: 'ListView' }, { type: 'CustomLabel' }];
    const mdList = await conn.metadata.list(mdTypes, CONSTANTS.API_VERSION);
    const parsedPackageXml = await parseXmlFile(packageXmlFull);
    for (const element of mdList) {
      const matchTypes = parsedPackageXml.Package.types.filter((type) => type.name[0] === element.type);
      if (matchTypes.length === 1) {
        // Add member in existing types
        const members = matchTypes[0].members || [];
        members.push(element.fullName);
        matchTypes[0].members = members.sort();
        parsedPackageXml.Package.types = parsedPackageXml.Package.types.map((type) =>
          type.name[0] === matchTypes[0].name ? matchTypes[0] : type
        );
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
    const waveRecipeTypeList = parsedPackageXml.Package.types.filter((type) => type.name[0] === 'WaveRecipe');
    if (waveRecipeTypeList.length === 1) {
      const waveRecipeType = waveRecipeTypeList[0];
      const waveRecipeTypeMembers = waveRecipeType.members || [];
      const waveDataFlowTypeList = parsedPackageXml.Package.types.filter((type) => type.name[0] === 'WaveDataflow');
      let waveDataFlowType: any = { name: ['WaveDataflow'], members: [] };
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
        parsedPackageXml.Package.types = parsedPackageXml.Package.types.map((type) =>
          type.name[0] === 'WaveDataflow' ? waveDataFlowType : type
        );
      }
      // Add type
      else {
        parsedPackageXml.Package.types.push(waveDataFlowType);
      }
    }

    // Delete stuff we don't want
    parsedPackageXml.Package.types = parsedPackageXml.Package.types.filter(
      (type) => !['CustomLabels'].includes(type.name[0])
    );
    await writeXmlFile(packageXmlFull, parsedPackageXml);
  }

  const nbRetrievedItems = await countPackageXmlItems(packageXmlFull);
  uxLog(this, c.cyan(`Full org package.xml contains ${c.bold(nbRetrievedItems)} items`))
  return packageXmlFull;
}

export async function executePrePostCommands(property: 'commandsPreDeploy' | 'commandsPostDeploy', options: { success: boolean, checkOnly: boolean, conn: Connection }) {
  const branchConfig = await getConfig('branch');
  const commands = branchConfig[property] || [];
  if (commands.length === 0) {
    uxLog(this, c.grey(`No ${property} found to run`));
    return;
  }
  uxLog(this, c.cyan(`Processing ${property} found in .sfdx-hardis.yml configuration...`));
  for (const cmd of commands) {
    // If if skipIfError is true and deployment failed
    if (options.success === false && cmd.skipIfError === true) {
      uxLog(this, c.yellow(`Skipping skipIfError=true command [${cmd.id}]: ${cmd.label}`));
      continue;
    }
    // Skip if we are in another context than the requested one
    const cmdContext = cmd.context || "all";
    if (cmdContext === "check-deployment-only" && options.checkOnly === false) {
      uxLog(this, c.grey(`Skipping check-deployment-only command as we are in process deployment mode [${cmd.id}]: ${cmd.label}`));
      continue;
    }
    if (cmdContext === "process-deployment-only" && options.checkOnly === true) {
      uxLog(this, c.grey(`Skipping process-deployment-only command as we are in check deployment mode [${cmd.id}]: ${cmd.label}`));
      continue;
    }
    const runOnlyOnceByOrg = cmd.runOnlyOnceByOrg || false;
    if (runOnlyOnceByOrg) {
      await checkSfdxHardisTraceAvailable(options.conn);
      const commandTraceQuery = `SELECT Id,CreatedDate FROM SfdxHardisTrace__c WHERE Type__c='${property}' AND Key__c='${cmd.id}' LIMIT 1`;
      const commandTraceRes = await soqlQuery(commandTraceQuery, options.conn);
      if (commandTraceRes?.records?.length > 0) {
        uxLog(this, c.grey(`Skipping command [${cmd.id}]: ${cmd.label} because it has been defined with runOnlyOnceByOrg and has already been run on ${commandTraceRes.records[0].CreatedDate}`));
        continue;
      }
    }
    // Run command
    uxLog(this, c.cyan(`Running [${cmd.id}]: ${cmd.label}`));
    const commandRes = await execCommand(cmd.command, this, { fail: false, output: true });
    if (commandRes.status === 0 && runOnlyOnceByOrg) {
      const hardisTraceRecord = {
        Name: property + "--" + cmd.id,
        Type__c: property,
        Key__c: cmd.id
      }
      const insertRes = await options.conn.insert("SfdxHardisTrace__c", [hardisTraceRecord]);
      if (insertRes[0].success) {
        uxLog(this, c.green(`Stored SfdxHardisTrace__c entry ${insertRes[0].id} with command [${cmd.id}] so it is not run again in the future (runOnlyOnceByOrg: true)`));
      }
      else {
        uxLog(this, c.red(`Error storing SfdxHardisTrace__c entry :` + JSON.stringify(insertRes, null, 2)));
      }
    }
  }
}

export async function extractOrgCoverageFromLog(stdout) {
  let orgCoverage: number | null = null;

  // Get from output text
  const fromTest = /Org Wide Coverage *(.*)/.exec(stdout);
  if (fromTest && fromTest[1]) {
    orgCoverage = parseFloat(fromTest[1].replace('%', ''));
  }
  /* jscpd:ignore-start */
  try {
    if (orgCoverage && orgCoverage > 0.0) {
      return orgCoverage.toFixed(2);
    }
  } catch (e) {
    uxLog(this, c.yellow(`Warning: unable to convert ${orgCoverage} into string`));
    uxLog(this, c.gray((e as Error).message));
  }
  /* jscpd:ignore-end */
  // Get from output file whose name has been found in text output
  const writtenToPath = /written to (.*coverage)/.exec(stdout);
  if (writtenToPath && writtenToPath[1]) {
    const jsonFile = path
      .resolve(process.cwd() + path.sep + writtenToPath[1].replace(/\\/g, '/') + path.sep + 'coverage-summary.json')
      .replace(/\\/g, '/');
    const result = getCoverageFromJsonFile(jsonFile);
    if (result) {
      return result;
    }
  }
  // Get from output file whose name has been found in text output
  const defaultCoverageOutputJsonFile = path.join(process.cwd(), "coverage", "coverage", "coverage-summary.json");
  const resultFromDefaultFile = getCoverageFromJsonFile(defaultCoverageOutputJsonFile);
  if (resultFromDefaultFile) {
    return resultFromDefaultFile;
  }

  // Get from JSON Mode (might be best to use output file)
  const jsonLog = findJsonInString(stdout);
  if (jsonLog && jsonLog?.result?.details?.runTestResult?.codeCoverage?.length > 0) {
    let numLocationsNb = 0;
    let coveredLocationsNb = 0;
    for (const coverageRes of jsonLog.result.details.runTestResult.codeCoverage) {
      numLocationsNb = numLocationsNb + coverageRes.numLocations;
      if (coverageRes?.numLocationsNotCovered > 0) {
        coveredLocationsNb = coveredLocationsNb + (coverageRes.numLocations - coverageRes.numLocationsNotCovered);
      }
    }
    orgCoverage = (coveredLocationsNb / numLocationsNb) * 100;
    uxLog(this, c.yellow("Code coverage has been calculated manually, if the number seems strange to you, you better use option \"--coverage-formatters json-summary\""));
    return orgCoverage.toFixed(2);
  }
  uxLog(
    this,
    c.italic(
      c.grey(
        'Unable to get org coverage from results. Maybe try to add --coverage-formatters json-summary to your call to sf project deploy start ?'
      )
    )
  );
  return null;
}

function getCoverageFromJsonFile(jsonFile) {
  if (fs.existsSync(jsonFile)) {
    const coverageInfo = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
    const orgCoverage = coverageInfo?.total?.lines?.pct ?? null;
    try {
      if (orgCoverage && Number(orgCoverage.toFixed(2)) > 0.0) {
        return orgCoverage.toFixed(2);
      }
    } catch (e) {
      uxLog(this, c.yellow(`Warning: unable to convert ${orgCoverage} into string`));
      uxLog(this, c.gray((e as Error).message));
    }
  }
  return null;
}

// Check if min org coverage is reached
export async function checkDeploymentOrgCoverage(orgCoverage: number, options: any) {
  // RunSpecifiedTests will not return org wide coverage, using dynamic text
  const codeCoverageText =
    !options.testlevel || options.testlevel !== 'RunSpecifiedTests' ? 'code coverage (org wide)' : 'code coverage';

  const config = await getConfig('branch');

  // Parse and validate minimum coverage setting, defaults to 75%
  const minCoverageConf =
    process.env.APEX_TESTS_MIN_COVERAGE_ORG_WIDE ||
    process.env.APEX_TESTS_MIN_COVERAGE ||
    config.apexTestsMinCoverageOrgWide ||
    config.apexTestsMinCoverage ||
    '75.00';
  const minCoverage = parseFloat(minCoverageConf);
  if (isNaN(minCoverage)) {
    killBoringExitHandlers();
    throw new SfError(`[sfdx-hardis] Invalid minimum coverage configuration: ${minCoverageConf}`);
  }

  if (minCoverage < 75.0) {
    killBoringExitHandlers();
    throw new SfError(`[sfdx-hardis] Good try, hacker, but minimum ${codeCoverageText} can't be less than 75% :)`);
  }

  if (orgCoverage < minCoverage) {
    if (config?.testCoverageNotBlocking === true) {
      await updatePullRequestResultCoverage('invalid_ignored', orgCoverage, minCoverage, options);
    } else {
      await updatePullRequestResultCoverage('invalid', orgCoverage, minCoverage, options);
      killBoringExitHandlers();
      throw new SfError(
        `[sfdx-hardis][apextest] Test run ${codeCoverageText} ${orgCoverage}% should be greater than ${minCoverage}%`
      );
    }
  } else {
    await updatePullRequestResultCoverage('valid', orgCoverage, minCoverage, options);
    uxLog(
      this,
      c.cyan(
        `[apextest] Test run ${codeCoverageText} ${c.bold(c.green(orgCoverage))}% is greater than ${c.bold(
          minCoverage
        )}%`
      )
    );
  }
}

async function checkDeploymentErrors(e, options, commandThis = null) {
  const { errLog } = await analyzeDeployErrorLogs((e as any).stdout + (e as any).stderr, true, options);
  uxLog(commandThis, c.red(c.bold('Sadly there has been Metadata deployment error(s)...')));
  uxLog(this, c.red('\n' + errLog));
  await displayDeploymentLink((e as any).stdout + (e as any).stderr, options);
  // Post pull requests comments if necessary
  if (options.check) {
    await GitProvider.managePostPullRequestComment();
  }
  killBoringExitHandlers();
  throw new SfError('Metadata deployment failure. Check messages above');
}

// This data will be caught later to build a pull request message
async function updatePullRequestResultCoverage(
  coverageStatus: string,
  orgCoverage: number,
  orgCoverageTarget: number,
  options: any
) {
  const existingPrData = globalThis.pullRequestData || {};
  const prDataCodeCoverage: any = {
    messageKey: existingPrData.messageKey ?? 'deployment',
    title: existingPrData.title ?? options.check ? '✅ Deployment check success' : '✅ Deployment success',
    codeCoverageMarkdownBody: 'Code coverage is valid',
    deployStatus: existingPrData ?? coverageStatus,
  };
  // Code coverage failure
  if (coverageStatus === 'invalid') {
    prDataCodeCoverage.title =
      existingPrData.deployStatus === 'valid' ? '❌ Deployment failed: Code coverage error' : prDataCodeCoverage.title;
    prDataCodeCoverage.codeCoverageMarkdownBody = deployCodeCoverageToMarkdown(orgCoverage, orgCoverageTarget);
    prDataCodeCoverage.status = 'invalid';
  }
  // Code coverage failure but ignored thanks to config testCoverageNotBlocking
  else if (coverageStatus === 'invalid_ignored') {
    prDataCodeCoverage.title =
      existingPrData.deployStatus === 'valid'
        ? '✅⚠️ Deployment success with ignored Code coverage error'
        : prDataCodeCoverage.title;
    prDataCodeCoverage.codeCoverageMarkdownBody = deployCodeCoverageToMarkdown(orgCoverage, orgCoverageTarget);
  } else {
    prDataCodeCoverage.codeCoverageMarkdownBody = deployCodeCoverageToMarkdown(orgCoverage, orgCoverageTarget);
  }
  globalThis.pullRequestData = Object.assign(globalThis.pullRequestData || {}, prDataCodeCoverage);
}

export async function generateApexCoverageOutputFile(): Promise<void> {
  try {
    const reportDir = await getReportDirectory();
    const coverageFileName = path.join(reportDir, "apex-coverage-results.json");
    let coverageObject: any = null;
    // Output from sf project deploy start or similar: get locally generated file
    if (fs.existsSync(path.join(reportDir, "coverage", "coverage.json"))) {
      coverageObject = JSON.parse(fs.readFileSync(path.join(reportDir, "coverage", "coverage.json"), 'utf8'));
    }
    // Output from apex run tests: get locally generated file
    else if (fs.existsSync(path.join(reportDir, "test-result-codecoverage.json"))) {
      coverageObject = JSON.parse(fs.readFileSync(path.join(reportDir, "test-result-codecoverage.json"), 'utf8'));
    }
    if (coverageObject !== null) {
      await fs.writeFile(coverageFileName, JSON.stringify(coverageObject, null, 2), 'utf8');
      uxLog(this, c.cyan(`Written Apex coverage results in file ${coverageFileName}`));
    }
  } catch (e: any) {
    uxLog(this, c.red(`Error while generating Apex coverage output file: ${e.message}`));
  }
}