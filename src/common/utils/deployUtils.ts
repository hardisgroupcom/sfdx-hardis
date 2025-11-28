import { SfError } from '@salesforce/core';
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
  sortCrossPlatform,
  uxLog,
  uxLogTable,
} from './index.js';
import { getApiVersion, getConfig, getEnvVar, getReportDirectory, setConfig } from '../../config/index.js';
import { GitProvider } from '../gitProvider/index.js';
import { deployCodeCoverageToMarkdown } from '../gitProvider/utilsMarkdown.js';
import { MetadataUtils } from '../metadata-utils/index.js';
import { importData } from './dataUtils.js';
import { analyzeDeployErrorLogs } from './deployTips.js';
import { callSfdxGitDelta, getPullRequestData, setPullRequestData } from './gitUtils.js';
import { createBlankSfdxProject, GLOB_IGNORE_PATTERNS, isSfdxProject } from './projectUtils.js';
import { prompts } from './prompts.js';
import { arrangeFilesBefore, restoreArrangedFiles } from './workaroundUtils.js';
import { countPackageXmlItems, isPackageXmlEmpty, parseXmlFile, removePackageXmlFilesContent, writeXmlFile } from './xmlUtils.js';
import { ResetMode } from 'simple-git';
import { isProductionOrg } from './orgUtils.js';
import { PullRequestData } from '../gitProvider/index.js';
import { WebSocketClient } from '../websocketClient.js';
import { executePrePostCommands } from './prePostCommandUtils.js';

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
      uxLog("error", this, c.red(c.bold('The error appears to be caused by an unstable internet connection. Please try again.')));
    }
    // Analyze errors
    const { errLog } = await analyzeDeployErrorLogs(stdOut, true, {});
    uxLog("error", commandThis, c.red('Unfortunately, push errors occurred.'));
    uxLog("error", this, c.red('\n' + errLog));
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
    // Parse json in stdout and if json.result.status and json.result.files, create a list of files with "type" + "file name", then order it, then display it in logs
    if ((pullCommandResult?.result?.status === 'Succeeded' || pullCommandResult?.status === 0) && pullCommandResult?.result?.files) {
      // Build an array of objects for table display
      const files = pullCommandResult.result.files
        .filter((file: any) => file?.state !== "Failed")
        .map((file: any) => ({
          Type: file.type,
          Name: file.fullName,
          State: file.state,
          Path: file.filePath || ''
        }));
      // Sort files by Type then Name
      sortArray(files, { by: ['Type', 'Name'], order: ['asc', 'asc'] });
      uxLog("action", this, c.green('Successfully pulled sources from scratch org / source-tracked sandbox'));
      // Display as a table
      if (files.length > 0) {
        // Use the uxLogTable utility for consistent table output
        uxLogTable(this, files, ['Type', 'Name', 'State']);
      } else {
        uxLog("log", this, c.grey('No files pulled.'));
      }
    } else {
      uxLog("error", this, c.red(`Pull command did not return expected results\n${JSON.stringify(pullCommandResult, null, 2)}`));
    }
  } catch (e) {
    // Manage beta/legacy boza
    const stdOut = (e as any).stdout + (e as any).stderr;
    // Analyze errors
    const { errLog } = await analyzeDeployErrorLogs(stdOut, true, {});
    uxLog("error", this, c.red('Sadly there has been pull error(s)'));
    uxLog("error", this, c.red('\n' + errLog));
    // List unknown elements from output
    const forceIgnoreElements = [...stdOut.matchAll(/Entity of type '(.*)' named '(.*)' cannot be found/gm)];
    if (forceIgnoreElements.length > 0 && !isCI) {
      // Propose user to ignore elements
      const forceIgnoreRes = await prompts({
        type: 'multiselect',
        message:
          'If you want to try again with updated .forceignore file, please select elements you want to add, else escape',
        description: 'Select metadata elements to add to .forceignore to resolve deployment conflicts',
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
        uxLog("log", this, 'Updated .forceignore file');
        return await forceSourcePull(scratchOrgAlias, debug);
      }
    }
    killBoringExitHandlers();
    throw new SfError('Pull failure. Check messages above');
  }

  // Check if some items has to be forced-retrieved because SF CLI does not detect updates
  const config = await getConfig('project');
  if (config.autoRetrieveWhenPull) {
    uxLog("action", this, c.cyan('Retrieving additional sources that are usually forgotten by sf project:retrieve:start ...'));
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
    uxLog("action", this, c.cyan('Detected Sharing Rules in the pull: retrieving the whole of them to avoid silly overrides !'));
    const sharingRulesNamesMatches = [...pullCommandResult.stdout.matchAll(/([^ \\/]+)\.sharingRules-meta\.xml/gm)];
    for (const match of sharingRulesNamesMatches) {
      uxLog("log", this, c.grey(`Retrieve the whole ${match[1]} SharingRules...`));
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
  options: {
    targetUsername: string;
    conn: any; // Connection from Salesforce
    testClasses: string;
    postDestructiveChanges?: string;
    preDestructiveChanges?: string;
    delta?: boolean;
    destructiveChangesAfterDeployment?: boolean;
    extraCommands?: any[]
  }
): Promise<any> {
  elapseStart('all deployments');
  let quickDeploy = false;

  // Check package.xml emptiness
  const packageXmlIsEmpty = !fs.existsSync(packageXmlFile) || await isPackageXmlEmpty(packageXmlFile);

  // Check if destructive changes files exist and have content
  const hasDestructiveChanges = (
    (!!options.preDestructiveChanges && fs.existsSync(options.preDestructiveChanges) &&
      !(await isPackageXmlEmpty(options.preDestructiveChanges))) ||
    (!!options.postDestructiveChanges && fs.existsSync(options.postDestructiveChanges) &&
      !(await isPackageXmlEmpty(options.postDestructiveChanges)))
  );

  // Check if files exist but are empty
  const hasEmptyDestructiveChanges = (
    (!!options.preDestructiveChanges && fs.existsSync(options.preDestructiveChanges) &&
      await isPackageXmlEmpty(options.preDestructiveChanges)) ||
    (!!options.postDestructiveChanges && fs.existsSync(options.postDestructiveChanges) &&
      await isPackageXmlEmpty(options.postDestructiveChanges))
  );

  // Special case: both package.xml and destructive changes files exist but are empty
  if (packageXmlIsEmpty && hasEmptyDestructiveChanges && !hasDestructiveChanges) {
    await executePrePostCommands('commandsPreDeploy', { success: true, checkOnly: check, conn: options.conn, extraCommands: options.extraCommands });
    uxLog("action", this, c.cyan('Both package.xml and destructive changes files exist but are empty. Nothing to deploy.'));
    await executePrePostCommands('commandsPostDeploy', { success: true, checkOnly: check, conn: options.conn, extraCommands: options.extraCommands });
    await GitProvider.managePostPullRequestComment(check);
    return { messages: [], quickDeploy, deployXmlCount: 0 };
  }

  // If we have empty package.xml and no destructive changes, there's nothing to do
  if (packageXmlIsEmpty && !hasDestructiveChanges) {
    await executePrePostCommands('commandsPreDeploy', { success: true, checkOnly: check, conn: options.conn, extraCommands: options.extraCommands });
    uxLog("action", this, 'No deployment or destructive changes to perform');
    await executePrePostCommands('commandsPostDeploy', { success: true, checkOnly: check, conn: options.conn, extraCommands: options.extraCommands });
    await GitProvider.managePostPullRequestComment(check);
    return { messages: [], quickDeploy, deployXmlCount: 0 };
  }

  // If we have empty package.xml but destructive changes, log it
  if (packageXmlIsEmpty && hasDestructiveChanges) {
    uxLog("action", this, c.cyan('Package.xml is empty, but destructive changes are present. Will proceed with deployment of destructive changes.'));
  }

  const splitDeployments = await buildDeploymentPackageXmls(packageXmlFile, check, debugMode, options);
  const messages: any[] = [];
  let deployXmlCount = splitDeployments.length;

  // If no deployments are planned but we have destructive changes, add a deployment with the existing package.xml
  if (deployXmlCount === 0 && hasDestructiveChanges) {
    uxLog("action", this, c.cyan('Creating deployment for destructive changes...'));
    splitDeployments.push({
      label: 'package-for-destructive-changes',
      packageXmlFile: packageXmlFile,
      order: options.destructiveChangesAfterDeployment ? 999 : 0,
    });
    deployXmlCount = 1;
  } else if (deployXmlCount === 0) {
    await executePrePostCommands('commandsPreDeploy', { success: true, checkOnly: check, conn: options.conn, extraCommands: options.extraCommands });
    uxLog("other", this, 'No deployment to perform');
    await executePrePostCommands('commandsPostDeploy', { success: true, checkOnly: check, conn: options.conn, extraCommands: options.extraCommands });
    await GitProvider.managePostPullRequestComment(check);
    return { messages, quickDeploy, deployXmlCount };
  }
  // Replace quick actions with dummy content in case we have dependencies between Flows & QuickActions
  await replaceQuickActionsWithDummy();
  // Run deployment pre-commands
  await executePrePostCommands('commandsPreDeploy', { success: true, checkOnly: check, conn: options.conn, extraCommands: options.extraCommands });
  // Process items of deployment plan
  uxLog("action", this, c.cyan('Processing split deployments build from deployment plan...'));
  uxLog("other", this, c.whiteBright(JSON.stringify(splitDeployments, null, 2)));
  for (const deployment of splitDeployments) {
    elapseStart(`deploy ${deployment.label}`);

    // Skip this deployment if package.xml is empty AND it's not a special destructive changes deployment
    // AND there are no destructive changes
    const isDestructiveChangesDeployment = deployment.label === 'package-for-destructive-changes';
    const packageXmlEmpty = await isPackageXmlEmpty(deployment.packageXmlFile, { ignoreStandaloneParentItems: true });

    if (packageXmlEmpty && !isDestructiveChangesDeployment && !hasDestructiveChanges) {
      uxLog(
        "log",
        commandThis,
        c.grey(
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
      uxLog("log", commandThis, `Waiting ${deployment.waitBefore} seconds before deployment according to deployment plan`);
      await new Promise((resolve) => setTimeout(resolve, deployment.waitBefore * 1000));
    }
    // Deployment of type package.xml file
    if (deployment.packageXmlFile) {
      const nbDeployedItems = await countPackageXmlItems(deployment.packageXmlFile);

      if (nbDeployedItems === 0 && !hasDestructiveChanges) {
        uxLog(
          "warning",
          commandThis,
          c.yellow(
            `Skipping deployment of ${c.bold(deployment.label)} because package.xml is empty and there are no destructive changes.`
          )
        );
        elapseEnd(`deploy ${deployment.label}`);
        continue;
      }

      uxLog(
        "action",
        commandThis,
        c.cyan(
          `${check ? 'Simulating deployment of' : 'Deploying'} ${c.bold(deployment.label)} package: ${deployment.packageXmlFile
          } (${nbDeployedItems} items)${hasDestructiveChanges ? ' with destructive changes' : ''}...`
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
            ` --wait ${getEnvVar("SFDX_DEPLOY_WAIT_MINUTES") || '120'}` +
            (debugMode ? ' --verbose' : '') +
            (process.env.SFDX_DEPLOY_DEV_DEBUG ? ' --dev-debug' : '');
          const quickDeployRes = await execSfdxJson(quickDeployCommand, commandThis, {
            output: true,
            debug: debugMode,
            fail: false,
          });
          if (quickDeployRes.status === 0) {
            uxLog("success", commandThis, c.green(`Successfully processed QuickDeploy for deploymentId ${deploymentCheckId}`));
            uxLog(
              "warning",
              commandThis,
              c.yellow(
                'If you do not want to use QuickDeploy feature, define env variable SFDX_HARDIS_QUICK_DEPLOY=false'
              )
            );
            quickDeploy = true;
            continue;
          } else {
            uxLog(
              "warning",
              commandThis,
              c.yellow(
                `Unable to perform QuickDeploy for deploymentId ${deploymentCheckId}.\n${quickDeployRes.errorMessage}.`
              )
            );
            uxLog("success", commandThis, c.green("Switching back to effective deployment not using QuickDeploy: that's ok 😊"));
            const isProdOrg = await isProductionOrg(options.targetUsername || "", options);
            if (!isProdOrg) {
              testlevel = 'NoTestRun';
              uxLog(
                "success",
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
        (options.postDestructiveChanges && !(options.destructiveChangesAfterDeployment === true) ? ` --post-destructive-changes ${options.postDestructiveChanges}` : '') +
        (options.targetUsername ? ` -o ${options.targetUsername}` : '') +
        (testlevel === 'NoTestRun' || branchConfig?.skipCodeCoverage === true ? '' : ' --coverage-formatters json-summary') +
        ((testlevel === 'NoTestRun' || branchConfig?.skipCodeCoverage === true) && process.env?.COVERAGE_FORMATTER_JSON === "true" ? '' : ' --coverage-formatters json') +
        (debugMode ? ' --verbose' : '') +
        ` --wait ${getEnvVar("SFDX_DEPLOY_WAIT_MINUTES") || '120'}` +
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
          uxLog("log", commandThis, c.grey(shortenLogLines(JSON.stringify(deployRes))));
        }
      } catch (e: any) {
        await generateApexCoverageOutputFile();

        // Special handling for "nothing to deploy" error with destructive changes
        if ((e.stdout + e.stderr).includes("No local changes to deploy") && hasDestructiveChanges) {

          uxLog("warning", commandThis, c.yellow(c.bold(
            'Received "Nothing to Deploy" error, but destructive changes are present. ' +
            'This can happen when only destructive changes are being deployed.'
          )));

          // Create a minimal response to avoid terminal freeze
          deployRes = {
            status: 0,  // Treat as success
            stdout: JSON.stringify({
              status: 0,
              result: {
                success: true,
                id: "destructiveChangesOnly",
                details: {
                  componentSuccesses: [],
                  runTestResult: null
                }
              }
            }),
            stderr: ""
          };
        } else {
          deployRes = await handleDeployError(e, check, branchConfig, commandThis, options, deployment);
        }
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
          await GitProvider.managePostPullRequestComment(check);
          killBoringExitHandlers();
          throw errCoverage;
        }
      } else {
        // Handle notif message when there is no apex
        const existingPrData = getPullRequestData();
        const prDataCodeCoverage: PullRequestData = {
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
        setPullRequestData(prDataCodeCoverage);
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
        uxLog("success", commandThis, c.green(message));
        if (deployRes?.testCoverageNotBlockingActivated === true) {
          uxLog(
            "warning",
            commandThis,
            c.yellow(
              'There is a code coverage issue, but the check is passing by design because you configured testCoverageNotBlocking: true in your branch .sfdx-hardis.yml'
            )
          );
        }
      } else {
        message = `[sfdx-hardis] Unable to deploy ${c.bold(deployment.label)} to target Salesforce org - ` + extraInfo;
        uxLog("error", commandThis, c.red(c.bold(deployRes.errorMessage)));
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
      uxLog("log", commandThis, `Waiting ${deployment.waitAfter} seconds after deployment according to deployment plan`);
      await new Promise((resolve) => setTimeout(resolve, deployment.waitAfter * 1000));
    }
    messages.push(message);
  }
  // Run deployment post commands
  await executePrePostCommands('commandsPostDeploy', { success: true, checkOnly: check, conn: options.conn, extraCommands: options.extraCommands });
  // Post pull request comment if available
  await GitProvider.managePostPullRequestComment(check);
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
    uxLog("warning", commandThis, c.yellow(c.bold('Deployment status: Deploy check success & Ignored test coverage error')));
    return { status: 0, stdout: (e as any).stdout, stderr: (e as any).stderr, testCoverageNotBlockingActivated: true };
  }
  // Handle Effective error
  const { errLog } = await analyzeDeployErrorLogs(output, true, { check: check });
  uxLog("error", commandThis, c.red(c.bold('Sadly there has been Deployment error(s)')));
  if (process.env?.SFDX_HARDIS_DEPLOY_ERR_COLORS === 'false') {
    uxLog("other", this, '\n' + errLog);
  } else {
    uxLog("error", this, c.red('\n' + errLog));
  }
  await displayDeploymentLink(output, options);
  elapseEnd(`deploy ${deployment.label}`);
  await executePrePostCommands('commandsPostDeploy', { success: false, checkOnly: check, conn: options.conn });
  await GitProvider.managePostPullRequestComment(check);
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
  uxLog("warning", this, c.yellow(`Unable to find deploymentId in logs \n${c.grey(rawLog)}`));
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
      "warning",
      this,
      c.yellowBright(`Open deployment status page in org with url: ${c.bold(c.greenBright(openRes?.result?.url))}`)
    );
  }
}

// In some case we can not deploy the whole package.xml, so let's split it before 😊
async function buildDeploymentPackageXmls(
  packageXmlFile: string,
  check: boolean,
  debugMode: boolean,
  options: any = {}
): Promise<any[]> {
  // Check for empty package.xml
  if (await isPackageXmlEmpty(packageXmlFile)) {
    uxLog("other", this, 'Empty package.xml: nothing to deploy');
    return [];
  }
  const deployOncePackageXml = await buildDeployOncePackageXml(debugMode, options);
  const deployOnChangePackageXml = await buildDeployOnChangePackageXml(debugMode, options);
  // Copy main package.xml so it can be dynamically updated before deployment
  const tmpDir = await createTempDir();
  const mainPackageXmlCopyFileName = path.join(tmpDir, 'calculated-package.xml');
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
        "warning",
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
          const splitPackageXmlCopyFileName = path.join(tmpDir, path.basename(deploymentItem.packageXmlFile));
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
      "warning",
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
    uxLog("log", this, c.grey(`Using custom package-no-overwrite file defined at ${packageNoOverwrite}`));
  }
  if (fs.existsSync(packageNoOverwrite)) {
    uxLog("action", this, c.cyan('Handling package-no-overwrite.xml (Metadata that are not overwritten if existing in target org)...'));
    // If package-no-overwrite.xml is not empty, build target org package.xml and remove its content from packageOnce.xml
    if (!(await isPackageXmlEmpty(packageNoOverwrite))) {
      const tmpDir = await createTempDir();
      // Build target org package.xml
      uxLog(
        "action",
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
        "log",
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
      "warning",
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
    uxLog("log", this, c.grey('No diff retrieved from packageDeployOnChange.xml'));
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
    "log",
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
      "action",
      this,
      c.cyan(
        `Removing ${c.green(path.basename(packageXmlFileToRemove))} items from ${c.green(
          path.basename(packageXmlFile)
        )}...`
      )
    );
  } else {
    uxLog(
      "action",
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
  uxLog("action", commandThis, c.cyan(`Deploying destructive changes from file ${path.resolve(packageDeletedXmlFile)}`));
  const tmpDir = await createTempDir();
  const emptyPackageXmlFile = path.join(tmpDir, 'package.xml');
  await fs.writeFile(
    emptyPackageXmlFile,
    `<?xml version="1.0" encoding="UTF-8"?>
    <Package xmlns="http://soap.sforce.com/2006/04/metadata">
        <version>${getApiVersion()}</version>
    </Package>`,
    'utf8'
  );
  await fs.copy(packageDeletedXmlFile, path.join(tmpDir, 'destructiveChanges.xml'));
  const deployDelete =
    `sf project deploy ${options.check ? 'validate' : 'start'} --metadata-dir ${tmpDir}` +
    ` --wait ${getEnvVar("SFDX_DEPLOY_WAIT_MINUTES") || '120'}` +
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
    uxLog("error", this, c.red('Sadly there has been destruction error(s)'));
    uxLog("error", this, c.red('\n' + errLog));
    uxLog(
      "warning",
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
    uxLog("success", commandThis, c.green(deleteMsg));
  } else {
    deleteMsg = '[sfdx-hardis] Unable to deploy destructive changes to Salesforce org';
    uxLog("error", commandThis, c.red(deployDeleteRes.errorMessage));
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
    runTests: null,
  }
) {
  // Perform deployment
  let deployCommand =
    `sf project deploy ${options.check ? 'validate' : 'start'}` +
    ` --metadata-dir ${options.deployDir || '.'}` +
    ` --wait ${getEnvVar("SFDX_DEPLOY_WAIT_MINUTES") || '120'}` +
    ` --test-level ${options.testlevel || 'RunLocalTests'}` +
    ` --api-version ${options.apiVersion || getApiVersion()}` +
    (options.targetUsername ? ` --target-org ${options.targetUsername}` : '') +
    (options.debug ? ' --verbose' : '') +
    ' --json';
  if (options.runTests && options.testlevel == 'RunSpecifiedTests') {
    deployCommand += ` --tests ${options.runTests.join(',')}`;
  }
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
      uxLog("warning", this, c.yellow("This may be a error with a workaround... let's try it 😊"));
      try {
        deployRes = await execCommand(deployCommand.replace(' --soapdeploy', ''), this, {
          output: true,
          debug: options.debug,
          fail: true,
        });
      } catch (e2) {
        if (JSON.stringify(e2).includes('NoTestRun')) {
          // Another workaround: try running tests
          uxLog("warning", this, c.yellow("This may be again an error with a workaround... let's make a last attempt 😊"));
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
    uxLog("action", this, c.cyan('Replacing QuickActions content with Dummy content that will always pass...'));
    quickActionsBackUpFolder = await createTempDir();
    const patternQuickActions = process.cwd() + '/force-app/' + `**/quickActions/*__c.*.quickAction-meta.xml`;
    const matchQuickActions = await glob(patternQuickActions, { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS });
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
      uxLog("log", this, c.grey('Backuped and replaced ' + quickActionFile));
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
      ignore: GLOB_IGNORE_PATTERNS
    });
    for (const quickActionFile of matchQuickActions) {
      const prevFileName = path
        .resolve(quickActionFile)
        .replace(path.resolve(quickActionsBackUpFolder), path.resolve(process.cwd()));
      await fs.copy(quickActionFile, prevFileName);
      uxLog("log", this, c.grey('Restored ' + quickActionFile));
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
    uxLog("action", this, c.cyan(`Generating full package.xml from target org ${targetOrgUsernameAlias}...`));
    packageXmlOutputFile = path.join(tmpDir, 'packageTargetOrg.xml');
  }
  // Use forced file name, for development purposed only
  if (process.env.FULL_ORG_MANIFEST_PATH) {
    fs.copyFileSync(process.env.FULL_ORG_MANIFEST_PATH, packageXmlOutputFile);
    uxLog("warning", this, c.grey(`Using forced package.xml output path from FULL_ORG_MANIFEST_PATH env var: ${packageXmlOutputFile}. This should be used only in development mode.`));
    return process.env.FULL_ORG_MANIFEST_PATH;
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
    uxLog("log", this, c.grey('Looking for package.xml elements that are not returned by manifest create command...'));
    const mdTypes = [{ type: 'ListView' }, { type: 'CustomLabel' }];
    const mdList = await conn.metadata.list(mdTypes, getApiVersion());
    const parsedPackageXml = await parseXmlFile(packageXmlFull);
    for (const element of mdList) {
      const matchTypes = parsedPackageXml.Package.types.filter((type) => type.name[0] === element.type);
      if (matchTypes.length === 1) {
        // Add member in existing types
        const members = matchTypes[0].members || [];
        members.push(element.fullName);
        matchTypes[0].members = members;
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
    // Sort members only for the types that were potentially modified
    for (const mdType of mdTypes) { // mdTypes is [{ type: 'ListView' }, { type: 'CustomLabel' }]
      const typeName = mdType.type;
      const matchedType = parsedPackageXml.Package.types.find(t => t.name[0] === typeName);
      if (matchedType && matchedType.members && Array.isArray(matchedType.members)) {
        matchedType.members = sortCrossPlatform(matchedType.members);
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
          uxLog("log", this, c.grey(`- Added WaveDataflow ${recipeId} to match WaveRecipe ${recipeId}`));
        }
      }
      sortCrossPlatform(waveDataFlowType.members);
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
    const filteredTypes = [
      'CustomLabels',
      'WorkflowFlowAutomation' // Added as a workaround for https://github.com/forcedotcom/cli/issues/3324
    ];
    const typesToRemove = parsedPackageXml.Package.types.filter(type => filteredTypes.includes(type.name[0]));

    if (typesToRemove.length > 0) {
      uxLog("log", this, c.grey(`Force filtering out metadata types from org-generated package.xml: ${typesToRemove.map(type => type.name[0]).join(', ')}`));
      parsedPackageXml.Package.types = parsedPackageXml.Package.types.filter(
        (type) => !filteredTypes.includes(type.name[0])
      );
    }
    await writeXmlFile(packageXmlFull, parsedPackageXml);
  }

  const nbRetrievedItems = await countPackageXmlItems(packageXmlFull);
  uxLog("action", this, c.cyan(`Full org package.xml contains ${c.bold(nbRetrievedItems)} items`))
  return packageXmlFull;
}

/**
 * Creates an empty package.xml file in a temporary directory and returns its path
 * Useful for deployment scenarios requiring an empty package.xml (like destructive changes)
 * @returns {Promise<string>} Path to the created empty package.xml file
 */
export async function createEmptyPackageXml(): Promise<string> {
  // Create temporary directory for the empty package.xml
  const tmpDir = await createTempDir();
  const emptyPackageXmlPath = path.join(tmpDir, 'empty-package.xml');

  // Write empty package.xml with API version from constants
  await fs.writeFile(
    emptyPackageXmlPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <version>${getApiVersion()}</version>
</Package>`,
    'utf8'
  );

  uxLog("log", this, c.grey(`Created empty package.xml at ${emptyPackageXmlPath}`));
  return emptyPackageXmlPath;
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
    uxLog("warning", this, c.yellow(`Warning: unable to convert ${orgCoverage} into string`));
    uxLog("error", this, c.grey((e as Error).message));
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

  const reportDir = await getReportDirectory();
  const coverageFilesToTest = [
    path.join(reportDir, "coverage", "coverage-summary.json"),
    path.join(reportDir, "coverage", "coverage", "coverage-summary.json"),
    path.join(process.cwd(), "coverage", "coverage", "coverage-summary.json")
  ]

  // Get from output file (1)
  for (const coverageFile of coverageFilesToTest) {
    const resultFromDefaultFile = getCoverageFromJsonFile(coverageFile);
    if (resultFromDefaultFile) {
      return resultFromDefaultFile;
    }
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
    uxLog("warning", this, c.yellow("Code coverage has been calculated manually, if the number seems strange to you, you better use option \"--coverage-formatters json-summary\""));
    return orgCoverage.toFixed(2);
  }
  uxLog(
    "warning",
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
      uxLog("warning", this, c.yellow(`Warning: unable to convert ${orgCoverage} into string`));
      uxLog("error", this, c.grey((e as Error).message));
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
    throw new SfError(`[sfdx-hardis] Good try, hacker, but minimum ${codeCoverageText} can't be less than 75% 😊`);
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
      "action",
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
  uxLog("error", commandThis, c.red(c.bold('Sadly there has been Metadata deployment error(s)...')));
  uxLog("error", this, c.red('\n' + errLog));
  await displayDeploymentLink((e as any).stdout + (e as any).stderr, options);
  // Post pull requests comments if necessary
  await GitProvider.managePostPullRequestComment(options.check);
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
  const existingPrData = getPullRequestData();
  const prDataCodeCoverage: Partial<PullRequestData> = {
    messageKey: existingPrData.messageKey ?? 'deployment',
    title: existingPrData.title ?? options.check ? '✅ Deployment check success' : '✅ Deployment success',
    codeCoverageMarkdownBody: 'Code coverage is valid',
    deployStatus: (coverageStatus === 'valid' || coverageStatus === 'invalid' || coverageStatus === 'unknown')
      ? coverageStatus
      : existingPrData.deployStatus ?? 'unknown',
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
  setPullRequestData(prDataCodeCoverage);
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
      uxLog("log", this, c.grey(`Written Apex coverage results in file ${coverageFileName}`));
      if (WebSocketClient.isAliveWithLwcUI()) {
        WebSocketClient.sendReportFileMessage(coverageFileName, "Coverage Results JSON", "report")
      }
    }
  } catch (e: any) {
    uxLog("error", this, c.red(`Error while generating Apex coverage output file: ${e.message}`));
  }
}

