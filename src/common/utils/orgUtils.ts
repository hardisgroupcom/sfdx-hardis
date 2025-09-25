import { MetadataUtils } from '../metadata-utils/index.js';
import { prompts } from './prompts.js';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { createTempDir, elapseEnd, elapseStart, execCommand, execSfdxJson, isCI, uxLog } from './index.js';
import { WebSocketClient } from '../websocketClient.js';
import { getConfig, setConfig } from '../../config/index.js';
import * as EmailValidator from 'email-validator';
import sortArray from 'sort-array';
import { Connection, SfError } from '@salesforce/core';
import { importData } from './dataUtils.js';
import { soqlQuery } from './apiUtils.js';
import { isSfdxProject } from './projectUtils.js';
import { deployMetadatas, smartDeploy, forceSourcePush } from './deployUtils.js';
import { PACKAGE_ROOT_DIR } from '../../settings.js';
import { clearCache } from '../cache/index.js';
import { SfCommand } from '@salesforce/sf-plugins-core';

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
      name: 'value',
      initial: options?.initialSelection[0] || null,
    });
    return options.multiselect ? profilesSelection.value.split(',') : profilesSelection.value;
  }
}

export async function promptOrg(
  commandThis: SfCommand<any>,
  options: any = { devHub: false, setDefault: true, scratch: false, devSandbox: false, promptMessage: null, quickOrgList: false }
) {
  // List all local orgs and request to user
  const orgListResult = await MetadataUtils.listLocalOrgs(options.devSandbox === true ? 'sandbox' : 'any', { quickOrgList: options.quickOrgList });
  let orgList = [
    ...sortArray(orgListResult?.scratchOrgs || [], {
      by: ['devHubUsername', 'username', 'alias', 'instanceUrl'],
      order: ['asc', 'asc', 'asc'],
    }),
    ...sortArray(orgListResult?.nonScratchOrgs || [], {
      by: ['username', 'alias', 'instanceUrl'],
      order: ['asc', 'asc', 'asc'],
    }),
    {
      username: '🌍 Connect to another org',
      otherOrg: true,
      descriptionForUi: 'Connect in Web Browser to a Sandbox, a Production Org, a Dev Org or a Scratch Org',
    },
    {
      username: "😱 I already authenticated my org but I don't see it !",
      clearCache: true,
      descriptionForUi: 'It might be a sfdx-hardis cache issue, reset it and try again !',
    },
    { username: '❌ Cancel', cancel: true, descriptionForUi: 'Get out of here :)' },
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

  // Prompt user
  const orgResponse = await prompts({
    type: 'select',
    name: 'org',
    message: c.cyanBright(options.promptMessage || 'Please select an org'),
    choices: orgList.map((org: any) => {
      const title = org.username || org.alias || org.instanceUrl;
      const description =
        (title !== org.instanceUrl ? org.instanceUrl : '') +
        (org.devHubUsername ? ` (Hub: ${org.devHubUsername})` : '-');
      return {
        title: c.cyan(title),
        description: org.descriptionForUi ? org.descriptionForUi : description || '-',
        value: org,
      };
    }),
  });

  let org = orgResponse.org;

  // Cancel
  if (org.cancel === true) {
    uxLog(commandThis, c.cyan('Cancelled'));
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
    uxLog(this, c.yellow(`⚠️ Your authentication is expired. Please login again in the web browser`));
    const loginCommand = 'sf org login web' + ` --instance-url ${org.instanceUrl}`;
    const loginResult = await execSfdxJson(loginCommand, this, { fail: true, output: false });
    org = loginResult.result;
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

    WebSocketClient.sendMessage({ event: 'refreshStatus' });
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
  uxLog(commandThis, c.cyan(`Org ${c.green(org.username)} - ${c.green(org.instanceUrl)}`));
  return orgResponse.org;
}

export async function makeSureOrgIsConnected(targetOrg: string | any) {
  // Get connected Status and instance URL
  let connectedStatus;
  let instanceUrl;
  if (typeof targetOrg !== 'string') {
    instanceUrl = targetOrg.instanceUrl;
    connectedStatus = targetOrg.connectedStatus;
    targetOrg = targetOrg.username;
  }
  else {
    const displayOrgCommand = `sf org display --target-org ${targetOrg}`;
    const displayResult = await execSfdxJson(displayOrgCommand, this, {
      fail: false,
      output: false,
    });
    connectedStatus = displayResult?.result?.connectedStatus || "error";
    instanceUrl = displayResult?.result?.instanceUrl || "error";
  }
  // Org is connected
  if (connectedStatus === "Connected") {
    return;
  }
  // Authentication is necessary
  if (connectedStatus?.includes("expired")) {
    uxLog(this, c.yellow("Your auth token is expired, you need to authenticate again"));
    const loginCommand = 'sf org login web' + ` --instance-url ${instanceUrl}`;
    await execSfdxJson(loginCommand, this, { fail: true, output: false });
    return;
  }
  // We shouldn't be here :)
  uxLog(this, c.yellow("What are we doing here ? Please declare an issue with the following text: " + instanceUrl + ":" + connectedStatus));
}

export async function promptOrgUsernameDefault(
  commandThis: any,
  defaultOrg: string,
  options: any = { devHub: false, setDefault: true, message: "", quickOrgList: true }
) {
  const defaultOrgRes = await prompts({
    type: 'confirm',
    message: options.message || `Do you want to use org ${defaultOrg} ?`,
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
    message: c.cyanBright(promptMessage || 'Please input your email address (it will be stored locally for later use)'),
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
export async function managePackageConfig(installedPackages, packagesToInstallCompleted) {
  const config = await getConfig('project');
  let projectPackages = config.installedPackages || [];
  let updated = false;
  for (const installedPackage of installedPackages) {
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
        this,
        c.cyan(
          `Updated package ${c.green(installedPackage.SubscriberPackageName)} with version id ${c.green(
            installedPackage.SubscriberPackageVersionId
          )}`
        )
      );
      updated = true;
    } else if (matchInstalled.length > 0 && matchLocal.length === 0) {
      // Request user about automatic installation during scratch orgs and deployments
      const installResponse = await prompts({
        type: 'select',
        name: 'value',
        message: c.cyanBright(
          `Please select the install configuration for ${c.bold(installedPackage.SubscriberPackageName)}`
        ),
        choices: [
          {
            title: `Install automatically ${c.bold(installedPackage.SubscriberPackageName)} on scratch orgs only`,
            value: 'scratch',
          },
          {
            title: `Deploy automatically ${c.bold(
              installedPackage.SubscriberPackageName
            )} on integration/production orgs only`,
            value: 'deploy',
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
  }
  if (updated) {
    uxLog(this, 'Updated package configuration in sfdx-hardis config');
    await setConfig('project', { installedPackages: projectPackages });
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
    uxLog(this, c.cyan(`Deploying project sources to org ${c.green(orgAlias)}...`));
    const packageXmlFile =
      process.env.PACKAGE_XML_TO_DEPLOY || configInfo.packageXmlToDeploy || fs.existsSync('./manifest/package.xml')
        ? './manifest/package.xml'
        : './config/package.xml';
    await smartDeploy(packageXmlFile, false, 'NoTestRun', debugMode, this, {
      targetUsername: orgUsername,
    });
  } else {
    // Use push for local scratch orgs
    uxLog(
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
          this,
          c.yellow(
            "Issue while assigning SfdxHardisDeferSharingRecalc PS and suspending Sharing Calc, but it's probably ok anyway"
          )
        );
        uxLog(this, c.grey((e as Error).message));
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
  uxLog(this, c.cyan('Assigning Permission Sets...'));
  for (const permSet of permSets) {
    uxLog(this, c.cyan(`Assigning ${c.bold(permSet.name || permSet)} to sandbox org user`));
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
        this,
        c.red(`Error assigning to ${c.bold(permSet.name || permSet)}\n${assignResult?.result?.failures[0].message}`)
      );
    }
  }
}

// Run initialization apex scripts
export async function initApexScripts(orgInitApexScripts: Array<any>, orgAlias: string) {
  uxLog(this, c.cyan('Running apex initialization scripts...'));
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
    uxLog(this, c.cyan('Loading sandbox org initialization data...'));
    await importData(initDataFolder, this, {
      targetUsername: orgUsername,
    });
  } else {
    uxLog(
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
