import { MetadataUtils } from '../metadata-utils/index.js';
import { prompts } from './prompts.js';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { createTempDir, elapseEnd, elapseStart, execCommand, execSfdxJson, getExecutionContext, isCI, uxLog } from './index.js';
import { WebSocketClient } from '../websocketClient.js';
import { getConfig, setConfig } from '../../config/index.js';
import * as EmailValidator from 'email-validator';
import sortArray from 'sort-array';
import { AuthInfo, Connection, SfError } from '@salesforce/core';
import { importData } from './dataUtils.js';
import { soqlQuery } from './apiUtils.js';
import { isSfdxProject } from './projectUtils.js';
import { deployMetadatas, smartDeploy, forceSourcePush } from './deployUtils.js';
import { PACKAGE_ROOT_DIR } from '../../settings.js';
import { clearCache } from '../cache/index.js';
import { SfCommand } from '@salesforce/sf-plugins-core';
import { authenticateUsingDeviceLogin } from './authUtils.js';

export async function listProfiles(conn: any) {
  if (conn in [null, undefined]) {
    return [];
  }
  const profileRes = await soqlQuery('SELECT Id,Name FROM Profile ORDER BY Name', conn);
  return profileRes.records;
}

// Get record type id, with cache management
const recordTypeIdCache: any = {};
export async function getRecordTypeId(recordTypeInfo: { sObjectType: string; developerName: string }, conn: any) {
  const cacheKey = JSON.stringify(recordTypeInfo);
  if (recordTypeIdCache[cacheKey]) {
    return recordTypeIdCache[cacheKey];
  }
  const recordTypeQueryRes = await soqlQuery(
    `SELECT Id FROM RecordType WHERE SobjectType='${recordTypeInfo.sObjectType}' AND` +
    ` DeveloperName='${recordTypeInfo.developerName}'` +
    ` LIMIT 1`,
    conn
  );
  if (recordTypeQueryRes.records[0].Id) {
    recordTypeIdCache[cacheKey] = recordTypeQueryRes.records[0].Id;
    return recordTypeQueryRes.records[0].Id;
  }
  return null;
}

// Prompt profile(s) for selection
/*
Example calls from command class:
const profiles = await promptProfiles(flags['target-org'].getConnection(),{multiselect: true, initialSelection: ["System Administrator","Administrateur Système"]});
const profile = await promptProfiles(flags['target-org'].getConnection(),{multiselect: false, initialSelection: ["System Administrator","Administrateur Système"]});
*/
export async function promptProfiles(
  conn: Connection,
  options: any = {
    multiselect: false,
    initialSelection: [],
    returnField: 'Name',
    message: 'Please select profile(s)',
    allowSelectAll: true,
    allowSelectAllErrorMessage: 'You can not select all profiles',
    allowSelectMine: true,
    allowSelectMineErrorMessage: 'You can not select the profile your user is assigned to',
  }
) {
  const profiles = await listProfiles(conn);
  // Profiles returned by active connection
  if (profiles.length > 0) {
    const profilesSelection = await prompts({
      type: options.multiselect ? 'multiselect' : 'select',
      message: options.message || 'Please select profile(s)',
      description: 'Select one or more Salesforce profiles for the operation',
      name: 'value',
      choices: profiles.map((profile: any) => {
        return {
          title: profile.Name,
          value: options.returnField === 'record' ? profile : options.returnField === 'Id' ? profile.Id : profile.Name,
        };
      }),
    });
    // Verify that all profiles are not selected if allowSelectAll === false
    if (options.allowSelectAll === false && profilesSelection.value.length === profiles.length) {
      throw new SfError(options.allowSelectAllErrorMessage);
    }
    // Verify that current user profile is not selected
    if (options.allowSelectMine === false) {
      if (!['record', 'Id'].includes(options.returnField)) {
        throw new SfError("You can not use option allowSelectMine:false if you don't use record or Id as return value");
      }
      const userRes = await soqlQuery(
        `SELECT ProfileId FROM User WHERE Id='${(await conn.identity()).user_id}' LIMIT 1`,
        conn
      );
      const profileId = userRes.records[0]['ProfileId'];
      if (
        profilesSelection.value.filter(
          (profileSelected) => profileSelected === profileId || profileSelected?.Id === profileId
        ).length > 0
      ) {
        throw new SfError(options.allowSelectMineErrorMessage);
      }
    }
    return profilesSelection.value || null;
  } else {
    // Manual input of comma separated profiles
    const profilesSelection = await prompts({
      type: 'text',
      message: options.message || 'Please input profile name',
      description: 'Enter the Salesforce profile name manually',
      placeholder: 'Ex: System Administrator',
      name: 'value',
      initial: options?.initialSelection[0] || null,
    });
    return options.multiselect ? profilesSelection.value.split(',') : profilesSelection.value;
  }
}

export async function promptOrg(
  commandThis: SfCommand<any>,
  options: any = { devHub: false, setDefault: true, scratch: false, devSandbox: false, promptMessage: null, quickOrgList: false, defaultOrgUsername: null, useCache: true }
) {
  // List all local orgs and request to user
  // Access flags via commandThis, fallback to options if not present
  const defaultOrgUsername = options.defaultOrgUsername || ''
  const orgListResult = await MetadataUtils.listLocalOrgs(options.devSandbox === true ? 'sandbox' : 'any', { quickOrgList: options.quickOrgList, useCache: options.useCache });
  let orgList = [
    {
      username: '🌍 Login to another org',
      otherOrg: true,
      descriptionForUi: 'Connect in Web Browser to a Sandbox, a Production Org, a Dev Org or a Scratch Org',
    },
    ...sortArray(orgListResult?.scratchOrgs || [], {
      by: ['instanceUrl', 'devHubUsername', 'username', 'alias'],
      order: ['asc', 'asc', 'asc'],
    }),
    ...sortArray(orgListResult?.nonScratchOrgs || [], {
      by: ['instanceUrl', 'username', 'alias',],
      order: ['asc', 'asc', 'asc'],
    }),
    {
      username: "😱 I already authenticated my org but I don't see it !",
      clearCache: true,
      descriptionForUi: 'It might be a sfdx-hardis cache issue, reset it and try again !',
    },
    { username: '❌ Cancel', cancel: true, descriptionForUi: 'Get out of here 😊' },
  ];

  // Filter if we want to list only the scratch attached to current devhub
  if (options.scratch === true) {
    const configGetRes = await execSfdxJson('sf config get target-dev-hub', this, {
      output: false,
      fail: true,
    });
    const hubOrgUsername = configGetRes?.result[0]?.value || '';
    orgList = orgList.filter((org: any) => org.status === 'Active' && org.devHubUsername === hubOrgUsername);
  }

  const defaultOrg = orgList.find((org: any) => org.username === defaultOrgUsername) || null;

  // Prompt user
  /* jscpd:ignore-start */
  const orgResponse = await prompts({
    type: 'select',
    name: 'org',
    message: c.cyanBright(options.promptMessage || 'Please select an org'),
    description: 'Choose a Salesforce org from the list of authenticated orgs',
    default: defaultOrg || '',
    choices: orgList.map((org: any) => {
      let title = org.instanceUrl || org.username || org.alias || "ERROR";
      if (org.alias && title !== org.alias) {
        title += ` (${org.alias})`;
      }
      const description = `Connected with ${org.username || org.alias || 'unknown user'} ` +
        (org.devHubUsername ? ` (Hub: ${org.devHubUsername})` : '');
      return {
        title: title.replace("https://", ""),
        description: org.descriptionForUi ? org.descriptionForUi : description || '-',
        value: org,
      };
    }),
  });
  /* jscpd:ignore-end */

  let org = orgResponse.org;

  // Cancel
  if (org.cancel === true) {
    uxLog("error", commandThis, c.red('Cancelled.'));
    process.exit(0);
  }

  // Connect to new org
  if (org.otherOrg === true) {
    await commandThis.config.runHook('auth', {
      checkAuth: true,
      Command: commandThis,
      devHub: options.devHub === true,
      setDefault: options.setDefault !== false,
    });
    return options.setDefault !== false ? await MetadataUtils.getCurrentOrg() : {};
  }

  // Reset cache and try again
  if (org.clearCache === true) {
    await clearCache();
    return await promptOrg(commandThis, options);
  }

  // Token is expired: login again to refresh it
  if (org?.connectedStatus === 'RefreshTokenAuthError' || org?.connectedStatus?.includes('expired')) {
    uxLog("action", this, c.yellow(`⚠️ Your authentication has expired. Please log in again using the web browser.`));
    if (getExecutionContext() === "web") {
      org = await authenticateUsingDeviceLogin(org.instanceUrl, org.username, null, {}, false, null);
    }
    else {
      const loginCommand = 'sf org login web' + ` --instance-url ${org.instanceUrl}`;
      const loginResult = await execSfdxJson(loginCommand, this, { fail: true, output: false });
      org = loginResult.result;
    }
  }

  if (options.setDefault === true) {
    // Set default username
    const setDefaultOrgCommand =
      `sf config set ` +
      `${options.devHub ? 'target-dev-hub' : 'target-org'}=${org.username}` +
      (!isSfdxProject() ? ' --global' : '');
    await execSfdxJson(setDefaultOrgCommand, commandThis, {
      fail: true,
      output: false,
    });

    // If devHub , set alias of project devHub from config file
    const config = await getConfig('project');
    if (options.devHub && config.devHubAlias) {
      const setAliasCommand = `sf alias set ${config.devHubAlias}=${org.username}`;
      await execSfdxJson(setAliasCommand, commandThis, {
        fail: true,
        output: false,
      });
    }

    WebSocketClient.sendRefreshStatusMessage();
    // Update local user .sfdx-hardis.yml file with response if scratch has been selected
    if (org.username.includes('scratch')) {
      await setConfig('user', {
        scratchOrgAlias: org.alias || null,
        scratchOrgUsername: org.username || org.alias,
      });
    } else {
      const configUser = await getConfig('user');
      if (configUser.scratchOrgAlias || configUser.scratchOrgUsername) {
        await setConfig('user', {
          scratchOrgAlias: null,
          scratchOrgUsername: null,
        });
      }
    }
  }
  // uxLog(commandThis, c.gray(JSON.stringify(org, null, 2)));
  uxLog("log", commandThis, c.grey(`Selected Org ${c.green(org.username)} - ${c.green(org.instanceUrl)}`));
  return orgResponse.org;
}

export async function promptOrgList(options: { promptMessage?: string } = {}) {
  const orgListResult = await MetadataUtils.listLocalOrgs('any');
  const orgListSorted = sortArray(orgListResult?.nonScratchOrgs || [], {
    by: ['instanceUrl', 'username', 'alias',],
    order: ['asc', 'asc', 'asc'],
  });
  // Prompt user
  const orgResponse = await prompts({
    type: 'multiselect',
    name: 'orgs',
    message: c.cyanBright(options.promptMessage || 'Please select orgs'),
    description: 'Choose multiple Salesforce orgs from the list of authenticated orgs',
    choices: orgListSorted.map((org: any) => {
      const title = org.instanceUrl || org.username || org.alias || "ERROR";
      const description = `Connected with ${org.username || org.alias || 'unknown user'} ` +
        (org.devHubUsername ? ` (Hub: ${org.devHubUsername})` : '');
      return {
        title: title,
        description: org.descriptionForUi ? org.descriptionForUi : description || '-',
        value: org,
      };
    }),
  });
  return orgResponse.orgs;
}

export async function makeSureOrgIsConnected(targetOrg: string | any) {
  // Get connected Status and instance URL
  let connectedStatus;
  let instanceUrl;
  let orgResult: any;
  if (typeof targetOrg !== 'string') {
    instanceUrl = targetOrg.instanceUrl;
    connectedStatus = targetOrg.connectedStatus;
    targetOrg = targetOrg.username;
    orgResult = targetOrg;
  }
  else {
    const displayOrgCommand = `sf org display --target-org ${targetOrg}`;
    const displayResult = await execSfdxJson(displayOrgCommand, this, {
      fail: false,
      output: false,
    });
    connectedStatus = displayResult?.result?.connectedStatus || "error";
    instanceUrl = displayResult?.result?.instanceUrl || "error";
    orgResult = displayResult.result
  }
  // Org is connected
  if (connectedStatus === "Connected") {
    return orgResult;
  }
  // Authentication is necessary
  if (connectedStatus?.includes("expired")) {
    uxLog("action", this, c.yellow("Your auth token has expired. You need to authenticate again.\n(Be patient after logging in; it can take a while 😑)"));
    // Delete rotten authentication json file in case there has been a sandbox refresh
    const homeSfdxDir = path.join(process.env.HOME || process.env.USERPROFILE || "~", '.sfdx');
    const authFile = path.join(homeSfdxDir, `${targetOrg}.json`);
    if (fs.existsSync(authFile)) {
      try {
        await fs.unlink(authFile);
        uxLog("log", this, c.cyan(`Deleted potentially rotten auth file ${c.green(authFile)}`));
      } catch (e: any) {
        uxLog("warning", this, c.red(`Error while deleting potentially rotten auth file ${c.green(authFile)}: ${e.message}\nYou might need to delete it manually.`));
      }
    }
    if (getExecutionContext() === "web") {
      orgResult = await authenticateUsingDeviceLogin(instanceUrl, targetOrg, null, {}, false, null);
      return orgResult;
    }
    // Authenticate again
    const loginCommand = 'sf org login web' + ` --instance-url ${instanceUrl}`;
    const loginRes = await execSfdxJson(loginCommand, this, { fail: true, output: false });
    return loginRes.result;
  }
  // We shouldn't be here 😊
  uxLog("warning", this, c.yellow("What are we doing here? Please create an issue with the following text: " + instanceUrl + ":" + connectedStatus));
}

export async function promptOrgUsernameDefault(
  commandThis: any,
  defaultOrg: string,
  options: any = { devHub: false, setDefault: true, message: "", quickOrgList: true }
) {
  const defaultOrgRes = await prompts({
    type: 'confirm',
    message: options.message || `Do you want to use org ${defaultOrg} ?`,
    description: 'Confirms whether to use the currently configured default org or select a different one',
  });
  if (defaultOrgRes.value === true) {
    return defaultOrg;
  } else {
    const selectedOrg = await promptOrg(commandThis, options);
    return selectedOrg.username;
  }
}

export async function promptUserEmail(promptMessage: string | null = null) {
  const userConfig = await getConfig('user');
  const promptResponse = await prompts({
    type: 'text',
    name: 'value',
    initial: userConfig.userEmail || '',
    message: c.cyanBright(promptMessage || 'Please input your email address'),
    description: 'Your email address will be stored locally and used for CI/CD operations',
    placeholder: 'Ex: john.doe@company.com',
    validate: (value: string) => EmailValidator.validate(value),
  });
  const userEmail = promptResponse.value;
  // Store email in user .sfdx-hardis.USERNAME.yml file for later reuse
  if (userConfig.userEmail !== userEmail) {
    await setConfig('user', {
      userEmail: userEmail,
    });
  }
  return userEmail;
}

// Authenticate with SfdxUrlStore
export async function authenticateWithSfdxUrlStore(org: any) {
  // Authenticate to scratch org to delete
  const authFile = path.join(await createTempDir(), 'sfdxScratchAuth.txt');
  const authFileContent = org.scratchOrgSfdxAuthUrl || (org.authFileJson ? JSON.stringify(org.authFileJson) : null);
  await fs.writeFile(authFile, authFileContent, 'utf8');
  const authCommand = `sf org login sfdx-url --sfdx-url-file ${authFile}`;
  await execCommand(authCommand, this, { fail: true, output: false });
}

// Add package installation to project .sfdx-hardis.yml
export async function managePackageConfig(installedPackages, packagesToInstallCompleted, filterStandard = false) {
  const config = await getConfig('project');
  let projectPackages = config.installedPackages || [];
  let updated = false;
  const promptPackagesToInstall: any[] = [];
  for (const installedPackage of installedPackages) {
    // Filter standard packages
    const matchInstalled = packagesToInstallCompleted.filter(
      (pckg) => pckg.SubscriberPackageId === installedPackage.SubscriberPackageId
    );
    const matchLocal = projectPackages.filter(
      (projectPackage) => installedPackage.SubscriberPackageId === projectPackage.SubscriberPackageId
    );
    // Upgrade version of already installed package
    if (matchInstalled.length > 0 && matchLocal.length > 0) {
      projectPackages = projectPackages.map((projectPackage) => {
        if (installedPackage.SubscriberPackageId === projectPackage.SubscriberPackageId) {
          const projectPackageId = projectPackage.Id || null;
          projectPackage = Object.assign(projectPackage, installedPackage);
          if (projectPackageId) {
            projectPackage.Id = projectPackageId;
          }
        }
        return projectPackage;
      });
      uxLog(
        "action",
        this,
        c.cyan(
          `Updated package ${c.green(installedPackage.SubscriberPackageName)} with version id ${c.green(
            installedPackage.SubscriberPackageVersionId
          )}`
        )
      );
      updated = true;
    } else if (matchInstalled.length > 0 && matchLocal.length === 0) {
      // Check if not filtered package
      if (
        filterStandard &&
        [
          "License Management App",
          "Sales Cloud",
          "Sales Insights",
          "Salesforce Chatter Dashboards 1.0",
          "Salesforce Chatter Dashboards",
          "Salesforce Connected Apps",
          "Salesforce Mobile Apps",
          "Salesforce.com CRM Dashboards",
          "SalesforceA Connected Apps",
          "Trail Tracker"
        ].includes(installedPackage.SubscriberPackageName)
      ) {
        uxLog("action", this, c.cyan(`Skipped ${installedPackage.SubscriberPackageName} as it is a Salesforce standard package`))
        continue;
      }

      promptPackagesToInstall.push(installedPackage);
    }
  }

  const promptPackagesRes = await prompts({
    type: "multiselect",
    name: 'value',
    message: c.cyanBright('Please select packages to add to your project configuration'),
    description: 'Select packages to add to your project configuration for automatic installation during scratch org creation and/or deployments',
    choices: promptPackagesToInstall.map((pckg) => {
      return {
        title: `${pckg.SubscriberPackageName} (${pckg.SubscriberPackageVersionNumber})`,
        value: pckg,
      };
    }),
  });
  const selectedPackages: any[] = promptPackagesRes.value || [];

  for (const installedPackage of selectedPackages) {
    // Request user about automatic installation during scratch orgs and deployments
    const installResponse = await prompts({
      type: 'select',
      name: 'value',
      message: c.cyanBright(
        `Please select the install configuration for ${c.bold(installedPackage.SubscriberPackageName)}`
      ),
      description: 'Configure how this package should be automatically installed during CI/CD operations',
      choices: [
        {
          title: `Deploy automatically ${c.bold(
            installedPackage.SubscriberPackageName
          )} on integration/production orgs only`,
          value: 'deploy',
        },
        {
          title: `Install automatically ${c.bold(installedPackage.SubscriberPackageName)} on scratch orgs only`,
          value: 'scratch',
        },
        {
          title: `Both: Install & deploy automatically ${c.bold(installedPackage.SubscriberPackageName)}`,
          value: 'scratch-deploy',
        },
        {
          title: `Do not configure ${c.bold(installedPackage.SubscriberPackageName)} installation / deployment`,
          value: 'none',
        },
      ],
    });
    installedPackage.installOnScratchOrgs = installResponse.value.includes('scratch');
    installedPackage.installDuringDeployments = installResponse.value.includes('deploy');
    if (installResponse.value !== 'none' && installResponse.value != null) {
      projectPackages.push(installedPackage);
      updated = true;
    }
  }

  if (updated) {
    uxLog("action", this, c.cyan('Updated package configuration in .sfdx-hardis.yml config file'));
    const configFile = await setConfig('project', { installedPackages: projectPackages });
    WebSocketClient.sendReportFileMessage(`${configFile!}#installedPackages`, "Package config in .sfdx-hardis.yml", "report");
  }
}

export async function installPackages(installedPackages: any[], orgAlias: string) {
  const packages = installedPackages || [];
  elapseStart('Install all packages');
  await MetadataUtils.installPackagesOnOrg(packages, orgAlias, this, 'scratch');
  elapseEnd('Install all packages');
}

export async function initOrgMetadatas(
  configInfo: any,
  orgUsername: string,
  orgAlias: string,
  projectScratchDef: any,
  debugMode: boolean,
  options: any = {}
) {
  // Push or deploy according to config (default: push)
  if ((isCI && process.env.CI_SCRATCH_MODE === 'deploy') || process.env.DEBUG_DEPLOY === 'true') {
    // if CI, use sf project deploy start to make sure package.xml is consistent
    uxLog("action", this, c.cyan(`Deploying project sources to org ${c.green(orgAlias)}...`));
    const packageXmlFile =
      process.env.PACKAGE_XML_TO_DEPLOY || configInfo.packageXmlToDeploy || fs.existsSync('./manifest/package.xml')
        ? './manifest/package.xml'
        : './config/package.xml';
    await smartDeploy(packageXmlFile, false, 'NoTestRun', debugMode, this, {
      targetUsername: orgUsername,
      conn: null,
      testClasses: ""
    });
  } else {
    // Use push for local scratch orgs
    uxLog(
      "action",
      this,
      c.cyan(
        `Pushing project sources to org ${c.green(
          orgAlias
        )}... (You can see progress in Setup -> Deployment Status)`
      )
    );
    // Suspend sharing calc if necessary
    const deferSharingCalc = (projectScratchDef.features || []).includes('DeferSharingCalc');
    if (deferSharingCalc) {
      // Deploy to permission set allowing to update SharingCalc
      await deployMetadatas({
        deployDir: path.join(path.join(PACKAGE_ROOT_DIR, 'defaults/utils/deferSharingCalc', '.')),
        testlevel: 'NoTestRun',
      });
      // Assign to permission set allowing to update SharingCalc
      try {
        const assignCommand = `sf org assign permset --name SfdxHardisDeferSharingRecalc --target-org ${orgUsername}`;
        await execSfdxJson(assignCommand, this, {
          fail: false, // Do not fail in case permission set already exists
          output: false,
          debug: debugMode,
        });
        await execCommand('sf texei:sharingcalc:suspend', this, {
          fail: false,
          output: true,
          debug: debugMode,
        });
      } catch (e) {
        uxLog(
          "warning",
          this,
          c.yellow(
            "Issue while assigning SfdxHardisDeferSharingRecalc PS and suspending Sharing Calc, but it's probably ok anyway"
          )
        );
        uxLog("log", this, c.grey((e as Error).message));
      }
    }
    await forceSourcePush(orgAlias, this, debugMode, options);
    // Resume sharing calc if necessary
    if (deferSharingCalc) {
      await execCommand('sf texei:sharingcalc:resume', this, {
        fail: false,
        output: true,
        debug: debugMode,
      });
    }
  }
}

// Assign permission sets to user
export async function initPermissionSetAssignments(permSets: Array<any>, orgUsername: string) {
  uxLog("action", this, c.cyan('Assigning Permission Sets...'));
  for (const permSet of permSets) {
    uxLog("action", this, c.cyan(`Assigning ${c.bold(permSet.name || permSet)} to org user ${orgUsername}`));
    const assignCommand = `sf org assign permset --name ${permSet.name || permSet} --target-org ${orgUsername}`;
    const assignResult = await execSfdxJson(assignCommand, this, {
      fail: false,
      output: false,
    });
    if (
      assignResult?.result?.failures?.length > 0 &&
      !assignResult?.result?.failures[0].message.includes('Duplicate')
    ) {
      uxLog(
        "error",
        this,
        c.red(`Error assigning to ${c.bold(permSet.name || permSet)}\n${assignResult?.result?.failures[0].message}`)
      );
    }
  }
}

// Run initialization apex scripts
export async function initApexScripts(orgInitApexScripts: Array<any>, orgAlias: string) {
  uxLog("action", this, c.cyan('Running apex initialization scripts...'));
  // Build list of apex scripts and check their existence
  const initApexScripts = orgInitApexScripts.map((scriptName: string) => {
    if (!fs.existsSync(scriptName)) {
      throw new SfError(c.red(`[sfdx-hardis][ERROR] Unable to find script ${scriptName}`));
    }
    return scriptName;
  });
  // Process apex scripts
  for (const apexScript of initApexScripts) {
    const apexScriptCommand = `sf apex run --file "${apexScript}" --target-org ${orgAlias}`;
    await execCommand(apexScriptCommand, this, {
      fail: true,
      output: true,
    });
  }
}

// Loads data in the org
export async function initOrgData(initDataFolder: string, orgUsername: string) {
  // Init folder (accounts, etc...)
  if (fs.existsSync(initDataFolder)) {
    uxLog("action", this, c.cyan('Loading sandbox org initialization data...'));
    await importData(initDataFolder, this, {
      targetUsername: orgUsername,
    });
  } else {
    uxLog(
      "action",
      this,
      c.cyan(
        `No initialization data: Define a sfdmu workspace in ${initDataFolder} if you need data in your new sandbox orgs`
      )
    );
  }
  // Import data packages
  const config = await getConfig('user');
  const dataPackages = config.dataPackages || [];
  for (const dataPackage of dataPackages) {
    if (dataPackage.importInSandboxOrgs === true) {
      await importData(dataPackage.dataPath, this, {
        targetUsername: orgUsername,
      });
    } else {
      uxLog(
        "log",
        this,
        c.grey(
          `Skipped import of ${dataPackage.dataPath} as importInSandboxOrgs is not defined to true in .sfdx-hardis.yml`
        )
      );
    }
  }
}

export async function getOrgAliasUsername(alias: string) {
  const aliasListRes = await execSfdxJson('sf alias list', this, {
    output: false,
    fail: false,
  });
  const matchingItems = aliasListRes?.result?.filter((aliasItem) => aliasItem.alias === alias);
  if (matchingItems.length > 0) {
    return matchingItems[0].value;
  }
  return null;
}

// Returns true if the org is a sandbox and not a scratch org
export async function isProductionOrg(targetUsername: string, options: any) {
  // Use jsforce connection is applicable
  if (options?.conn?.username && options.conn.username === targetUsername) {
    const orgRes = await soqlQuery('SELECT IsSandbox FROM Organization LIMIT 1', options.conn);
    return orgRes.records[0].IsSandbox === false;
  }
  // Use SF Cli command
  const orgQuery = `sf data query --query "SELECT IsSandbox FROM Organization LIMIT 1"` +
    (targetUsername ? ` --target-org ${targetUsername}` : "");
  const orgQueryRes = await execSfdxJson(orgQuery, this, {
    output: false,
    debug: options.debugMode || false,
    fail: true,
  });
  const orgRes = orgQueryRes?.result?.records || orgQueryRes.records || [];
  return orgRes[0].IsSandbox === false;
}

// Returns true if the org is a sandbox and not a scratch org
export async function isSandbox(options: any) {
  if (options.conn) {
    const orgRes = await soqlQuery('SELECT IsSandbox,TrialExpirationDate FROM Organization LIMIT 1', options.conn);
    return orgRes.records[0].IsSandbox === true && orgRes.records[0].TrialExpirationDate == null;
  } else {
    return options?.scratch === false;
  }
}

// Returns true if the org is a scratch org and not a sandbox
export async function isScratchOrg(options: any) {
  if (options.conn) {
    const orgRes = await soqlQuery('SELECT IsSandbox,TrialExpirationDate FROM Organization LIMIT 1', options.conn);
    return orgRes.records[0].IsSandbox === true && orgRes.records[0].TrialExpirationDate !== null;
  } else {
    return options?.scratch === true;
  }
}

// Set global variables with connections
let tryTechnical = true;
export async function setConnectionVariables(conn, handleTechnical = false) {
  if (conn) {
    globalThis.jsForceConn = conn;
  }
  if (handleTechnical && tryTechnical && !(process.env?.SKIP_TECHNICAL_ORG === "true")) {
    try {
      const techOrgDisplayCommand = 'sf org display --target-org TECHNICAL_ORG --json --verbose';
      const orgInfoResult = await execSfdxJson(techOrgDisplayCommand, this, {
        fail: false,
        output: false,
        debug: false,
      });
      if (orgInfoResult.result && orgInfoResult.result.connectedStatus === 'Connected') {
        const authInfo = await AuthInfo.create({
          username: orgInfoResult.result.username,
          isDefaultUsername: false,
        });
        const connTechnical = await Connection.create({
          authInfo: authInfo,
          connectionOptions: {
            instanceUrl: orgInfoResult.result.instanceUrl,
            accessToken: orgInfoResult.result.accessToken
          }
        });
        const identity = await connTechnical.identity();
        uxLog("log", this, c.grey(`Connected to technical org ${c.green(identity.username)}`));
        globalThis.jsForceConnTechnical = connTechnical;
      }
    } catch (e) {
      uxLog("warning", this, c.yellow(`Unable to connect to technical org: ${e}\nThat's ok, we'll use default org 😊`));
      globalThis.jsForceConnTechnical = null;
    }
  }
  tryTechnical = false;
}

const FIND_USER_BY_USERNAME_LIKE_CACHE: any = {};
export async function findUserByUsernameLike(usernameLike: string, conn: Connection): Promise<Record<string, any> | null> {
  if (FIND_USER_BY_USERNAME_LIKE_CACHE[usernameLike]) {
    return FIND_USER_BY_USERNAME_LIKE_CACHE[usernameLike];
  }
  const users = await conn.query(`SELECT Id, Username FROM User WHERE Username LIKE '${usernameLike}%' AND IsActive=true LIMIT 1`);
  if (users.records.length > 0) {
    FIND_USER_BY_USERNAME_LIKE_CACHE[usernameLike] = users.records[0];
    return users.records[0];
  }
  return null;
}
