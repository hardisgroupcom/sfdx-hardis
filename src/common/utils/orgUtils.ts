import { MetadataUtils } from '../metadata-utils/index.js';
import { prompts } from './prompts.js';
import c from 'chalk';
import fs from './fsUtils.js';
import * as path from 'path';
import { createTempDir, execCommand, execSfdxJson, isAgentMode, isCI, uxLog } from './index.js';
import { getOrgAccessToken } from './credentialUtils.js';
import { WebSocketClient } from '../websocketClient.js';
import { getConfig, getEnvVar, setConfig } from '../../config/index.js';
import { isValidEmail } from './stringUtils.js';
import sortArray from './sortArray.js';
import { AuthInfo, Connection, SfdcUrl, SfError } from '@salesforce/core';
import { soqlQuery, soqlQueryTooling } from './apiUtils.js';
import { open } from './openUtils.js';
import { isSfdxProject } from './projectUtils.js';
import { deployMetadatas, smartDeploy, forceSourcePush } from './deployUtils.js';
import { PACKAGE_ROOT_DIR } from '../../settings.js';
import { clearCache } from '../cache/index.js';
import { SfCommand } from '@salesforce/sf-plugins-core';
import { t } from './i18n.js';
import { decideOrgAlias, getAliasOfUsername, nameConnectedOrg, promptOrgAlias, runAuthHook } from './authUtils.js';

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
    message: t('pleaseSelectProfile'),
    allowSelectAll: true,
    allowSelectAllErrorMessage: t('youCanNotSelectAllProfiles'),
    allowSelectMine: true,
    allowSelectMineErrorMessage: t('youCanNotSelectTheProfileYourUserIsAssignedTo'),
    returnApiName: false
  }
) {
  const profiles = await listProfiles(conn);
  let selectedProfiles: any[] = [];
  // Profiles returned by active connection
  if (profiles.length > 0) {
    const choices = profiles.map((profile: any) => {
      return {
        title: profile.Name,
        value: options.returnField === 'record' ? profile : options.returnField === 'Id' ? profile.Id : profile.Name,
      };
    });
    const initial = getInitialProfileSelection(choices, options.initialSelection, options.multiselect === true);
    const profilesSelection = await prompts({
      type: options.multiselect ? 'multiselect' : 'select',
      message: options.message || t('pleaseSelectProfile'),
      description: t('descChooseProfiles'),
      name: 'value',
      choices: choices,
      initial: initial,
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
    selectedProfiles = profilesSelection.value || [];
  } else {
    // Manual input of comma separated profiles
    const profilesSelection = await prompts({
      type: 'text',
      message: options.message || t('pleaseInputProfileName'),
      description: t('descEnterProfileName'),
      placeholder: t('exSystemAdministrator'),
      name: 'value',
      initial: options?.initialSelection[0] || null,
    });
    selectedProfiles = options.multiselect ? profilesSelection.value.split(',') : profilesSelection.value;
  }
  if (options.returnApiName) {
    uxLog("action", this, c.cyan(t('resolvingProfileApiNames')));
    const apiNames: string[] = [];
    for (const profileName of selectedProfiles) {
      // Map standard profile names to their API names
      const standardProfileMapping: Record<string, string> = {
        'System Administrator': 'Admin',
        'Standard User': 'Standard',
        'Solution Manager': 'SolutionManager',
        'Marketing User': 'MarketingUser',
        'Contract Manager': 'ContractManager',
        'Read Only': 'ReadOnly'
      };
      if (Object.keys(standardProfileMapping).includes(profileName.trim())) {
        apiNames.push(standardProfileMapping[profileName.trim()]);
      } else {
        uxLog("log", this, t('profileNotFoundInPredefinedStandardProfiles'));
        const results = await soqlQueryTooling(`SELECT Id, Name, FullName FROM Profile WHERE Name='${profileName.trim()}'`, conn);
        if (results.records.length > 0) { // Fullname limits the results to 1 row only.
          apiNames.push(results.records[0].FullName);
        } else {
          uxLog("warning", this, `Profile '${profileName.trim()}' not found`);
        }
      }
    }
    return apiNames;
  }

  return selectedProfiles;
}

// The choices of promptProfiles to pre-select, from profile names. Profile labels follow the
// language of the org user, and their case differs between languages (Administrateur système,
// not Administrateur Système): names are matched case-insensitively
export function getInitialProfileSelection(
  choices: Array<{ title: string; value: any }>,
  initialSelection: string[] = [],
  multiselect = false
): any {
  const initialNames = (initialSelection || []).map((name) => name.toLowerCase());
  const values = choices.filter((choice) => initialNames.includes(String(choice.title).toLowerCase())).map((choice) => choice.value);
  if (values.length === 0) {
    return undefined;
  }
  return multiselect ? values : values[0];
}

export async function promptOrg(
  commandThis: SfCommand<any>,
  options: any = { devHub: false, setDefault: true, scratch: false, devSandbox: false, promptMessage: null, quickOrgList: false, defaultOrgUsername: null, useCache: true }
) {
  // List all local orgs and request to user
  // Access flags via commandThis, fallback to options if not present
  const defaultOrgUsername = options.defaultOrgUsername || ''
  uxLog("action", commandThis, c.cyan(t('listingAuthenticatedOrgs')));
  const orgListResult = await MetadataUtils.listLocalOrgs(options.devSandbox === true ? 'sandbox' : 'any', { quickOrgList: options.quickOrgList, useCache: options.useCache });
  let orgList = [
    {
      username: `🌍 ${t('loginToAnotherOrg')}`,
      otherOrg: true,
      descriptionForUi: t('connectInWebBrowserToSandbox'),
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
      username: `😱 ${t('iAlreadyAuthenticatedMyOrgButDontSeeIt')}`,
      clearCache: true,
      descriptionForUi: t('itMightBeASfdxHardisCacheIssue'),
    },
    { username: `❌ ${t('cancelOption')}`, cancel: true, descriptionForUi: t('getOutOfHere') + ' 😊' },
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
    message: c.cyanBright(options.promptMessage || t('pleaseSelectAnOrg')),
    description: t('descChooseOrg'),
    default: defaultOrg || '',
    choices: orgList.map((org: any) => {
      let title = org.instanceUrl || org.username || org.alias || "ERROR";
      if (org.alias && title !== org.alias) {
        title += ` (${org.alias})`;
      }
      const description = t('connectedWithOrgUser', { user: org.username || org.alias || t('unknownUser') }) +
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
    uxLog("action", commandThis, c.cyan(t('cancelled')));
    process.exit(0);
  }

  // Connect to new org
  if (org.otherOrg === true) {
    await runAuthHook(commandThis, {
      checkAuth: true,
      Command: commandThis,
      devHub: options.devHub === true,
      setDefault: options.setDefault !== false,
      alias: options.alias,
    });
    const justConnectedOrg = globalThis.justConnectedOrg;
    if (!justConnectedOrg?.username) {
      throw new SfError(t('authenticationDidNotConnectAnyOrg'));
    }
    return justConnectedOrg;
  }

  // Reset cache and try again
  if (org.clearCache === true) {
    await clearCache();
    return await promptOrg(commandThis, options);
  }

  // Token is expired: login again to refresh it
  if (org?.connectedStatus === 'RefreshTokenAuthError' || org?.connectedStatus?.includes('expired')) {
    uxLog("action", this, c.yellow('⚠️ ' + t('authenticationHasExpiredPleaseLogIn')));
    org = await reconnectExpiredOrg(org, { nameOrg: options.nameOrg === true });
  }

  uxLog("action", commandThis, c.cyan(t('selectedOrg', { org: c.green(org.username), org1: c.green(org.instanceUrl) })));

  // Offer to name an org that has no alias yet
  if (options.nameOrg === true && !org.alias) {
    org.alias = await nameConnectedOrg(org.username, org.instanceUrl);
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
  // Return org and not orgResponse.org, as org can have been refreshed by a new authentication
  return org;
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
    message: c.cyanBright(options.promptMessage || t('pleaseSelectOrgs')),
    description: t('descChooseMultipleOrgs'),
    choices: orgListSorted.map((org: any) => {
      const title = org.instanceUrl || org.username || org.alias || "ERROR";
      const description = t('connectedWithOrgUser', { user: org.username || org.alias || t('unknownUser') }) +
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

export async function deleteRottenAuthFile(username: string) {
  const homeSfdxDir = path.join(process.env.HOME || process.env.USERPROFILE || "~", '.sfdx');
  const authFile = path.join(homeSfdxDir, `${username}.json`);
  if (fs.existsSync(authFile)) {
    try {
      await fs.unlink(authFile);
      uxLog("log", this, c.cyan(t('deletedPotentiallyRottenAuthFile', { authFile: c.green(authFile) })));
    } catch (e: any) {
      uxLog("warning", this, c.red(t('errorWhileDeletingPotentiallyRottenAuthFile', { authFile: c.green(authFile), message: e.message })));
    }
  }
}

export async function makeSureOrgIsConnected(targetOrg: string | any) {
  // Get connected Status and instance URL
  let connectedStatus;
  let instanceUrl;
  let scratchOrgStatus;
  let orgResult: any;
  if (typeof targetOrg !== 'string') {
    instanceUrl = targetOrg.instanceUrl;
    connectedStatus = targetOrg.connectedStatus;
    scratchOrgStatus = targetOrg.status;
    orgResult = targetOrg;
    targetOrg = targetOrg.username;
  }
  else {
    // Always log an action before running sf org display, so the VS Code UI does not look stuck after a prompt
    uxLog("action", this, c.cyan(t('checkingOrgConnectionStatus', { org: c.green(targetOrg) })));
    const displayOrgCommand = `sf org display --target-org ${targetOrg}`;
    const displayResult = await execSfdxJson(displayOrgCommand, this, {
      fail: false,
      output: false,
    });
    connectedStatus = displayResult?.result?.connectedStatus || "error";
    instanceUrl = displayResult?.result?.instanceUrl || "error";
    scratchOrgStatus = displayResult?.result?.status;
    orgResult = displayResult.result
  }
  // Org is connected ("Unknown" is the status reported for scratch orgs)
  if (connectedStatus === "Connected" || connectedStatus === "Unknown") {
    return orgResult;
  }
  // Authentication is necessary
  if (connectedStatus?.includes("expired") || connectedStatus === "RefreshTokenAuthError") {
    uxLog("action", this, c.yellow(t('yourAuthTokenHasExpiredYouNeed')));
    // Read the alias before the auth file is deleted
    const alias = orgResult?.alias || (await getAliasOfUsername(targetOrg));
    await deleteRottenAuthFile(targetOrg);
    // Authenticate again
    return await reconnectExpiredOrg({ username: targetOrg, instanceUrl, alias });
  }
  // A scratch org reports no connectedStatus at all: sf org display gives its
  // lifecycle in "status" instead. Read after the checks above, never before,
  // so that a scratch org still inside its 30 days but whose token was revoked
  // is sent to re-authenticate rather than reported as working.
  if (scratchOrgStatus === "Active") {
    return orgResult;
  }
  // We shouldn't be here 😊
  uxLog("warning", this, c.yellow(t('whatAreWeDoingHerePleaseCreate') + instanceUrl + ":" + connectedStatus));
}

export async function promptOrgUsernameDefault(
  commandThis: any,
  defaultOrg: string,
  options: any = { devHub: false, setDefault: true, message: "", quickOrgList: true }
) {
  const defaultOrgRes = await prompts({
    type: 'confirm',
    message: options.message || t('doYouWantToUseOrg', { org: defaultOrg }),
    description: t('confirmsWhetherToUseCurrentDefaultOrg'),
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
    message: c.cyanBright(promptMessage || t('pleaseInputYourEmailAddress')),
    description: t('descEnterEmail'),
    placeholder: t('exJohnDoeAtCompany'),
    validate: (value: string) => isValidEmail(value),
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
        c.cyan(t('updatedPackageWithVersionId', { packageName: c.green(installedPackage.SubscriberPackageName), versionId: c.green(installedPackage.SubscriberPackageVersionId) }))
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
        uxLog("action", this, c.cyan(t('skippedAsItIsSalesforceStandardPackage', { installedPackage: installedPackage.SubscriberPackageName })))
        continue;
      }

      promptPackagesToInstall.push(installedPackage);
    }
  }

  const promptPackagesRes = await prompts({
    type: "multiselect",
    name: 'value',
    message: c.cyanBright(t('pleaseSelectPackagesToAddToYour')),
    description: t('descChoosePackages'),
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
      message: c.cyanBright(t('selectInstallConfigurationFor', { packageName: c.bold(installedPackage.SubscriberPackageName) })),
      description: t('descConfigurePackageInstall'),
      choices: [
        {
          title: t('packageDeployAutomaticallyOnIntegration', { packageName: c.bold(installedPackage.SubscriberPackageName) }),
          value: 'deploy',
        },
        {
          title: t('packageInstallAutomaticallyOnScratch', { packageName: c.bold(installedPackage.SubscriberPackageName) }),
          value: 'scratch',
        },
        {
          title: t('packageBothInstallAndDeploy', { packageName: c.bold(installedPackage.SubscriberPackageName) }),
          value: 'scratch-deploy',
        },
        {
          title: t('packageDoNotConfigureInstall', { packageName: c.bold(installedPackage.SubscriberPackageName) }),
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
    uxLog("action", this, c.cyan(t('updatedPackageConfigurationInSfdxHardisYml')));
    const configFile = await setConfig('project', { installedPackages: projectPackages });
    WebSocketClient.sendReportFileMessage(`${configFile!}#installedPackages`, t('packageConfigInSfdxHardisYml'), "report");
  }
}

// A Dev Hub authenticated through an External Client App fails scratch signup with C-1016 unless the CLI's built-in app
// is used. Nothing is added when the user chose an app, or set SFDX_CLIENT_SECRET, which the CLI would send with it.
export function getScratchSignupEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  if (env.SF_SCRATCH_SIGNUP_CONNECTED_APP || env.SFDX_CLIENT_SECRET) {
    return {};
  }
  return {
    SF_SCRATCH_SIGNUP_CONNECTED_APP: 'PlatformCLI',
    SF_SCRATCH_SIGNUP_CALLBACK_URL: env.SF_SCRATCH_SIGNUP_CALLBACK_URL || 'http://localhost:1717/OauthRedirect',
  };
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
    uxLog("action", this, c.cyan(t('deployingProjectSourcesToOrg', { orgAlias: c.green(orgAlias) })));
    // A configured manifest wins, manifest/ and config/ are fallbacks. Keep the existsSync ternary
    // parenthesized, otherwise it swallows the whole || chain and the configured path is discarded.
    const packageXmlFile =
      process.env.PACKAGE_XML_TO_DEPLOY ||
      configInfo.packageXmlToDeploy ||
      (fs.existsSync('./manifest/package.xml') ? './manifest/package.xml' : './config/package.xml');
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
      c.cyan(t('pushingProjectSourcesToOrg', { orgAlias: c.green(orgAlias) }))
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
          c.yellow(t('issueWhileAssigningSharingRecalc'))
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

// Assign permission sets to user. Returns the failures ("name: message"), an existing assignment is not one.
export async function initPermissionSetAssignments(permSets: Array<any>, orgUsername: string): Promise<string[]> {
  uxLog("action", this, c.cyan(t('assigningPermissionSets')));
  const failures: string[] = [];
  for (const permSet of permSets) {
    const permSetName = permSet?.name || permSet;
    uxLog("action", this, c.cyan(t('assigningToOrgUser', { permSet: c.bold(permSetName), orgUsername })));
    const assignCommand = `sf org assign permset --name "${permSetName}" --target-org ${orgUsername}`;
    const assignResult = await execSfdxJson(assignCommand, this, {
      fail: false,
      output: false,
    });
    const failureMessage: string = assignResult?.result?.failures?.[0]?.message || '';
    const errorMessage = failureMessage
      ? failureMessage.includes('Duplicate')
        ? ''
        : failureMessage
      : assignResult?.status !== 0
        ? assignResult?.errorMessage || assignResult?.message || 'unknown error'
        : '';
    if (errorMessage) {
      uxLog("error", this, c.red(t('errorAssigningPermSetToUser', { permSet: c.bold(permSetName), message: errorMessage })));
      failures.push(`${permSetName}: ${errorMessage}`);
    }
  }
  return failures;
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
      const techOrgDisplayCommand = 'sf org display --target-org TECHNICAL_ORG --json';
      const orgInfoResult = await execSfdxJson(techOrgDisplayCommand, this, {
        fail: false,
        output: false,
        debug: false,
      });
      if (orgInfoResult.result && orgInfoResult.result.connectedStatus === 'Connected') {
        const accessToken = await getOrgAccessToken('TECHNICAL_ORG');
        if (!accessToken) {
          globalThis.jsForceConnTechnical = null;
        } else {
          const authInfo = await AuthInfo.create({
            username: orgInfoResult.result.username,
            isDefaultUsername: false,
          });
          const connTechnical = await Connection.create({
            authInfo: authInfo,
            connectionOptions: {
              instanceUrl: orgInfoResult.result.instanceUrl,
              accessToken: accessToken
            }
          });
          const identity = await connTechnical.identity();
          uxLog("log", this, c.grey(t('connectedToTechnicalOrg', { identity: c.green(identity.username) })));
          globalThis.jsForceConnTechnical = connTechnical;
        }
      }
    } catch (e) {
      uxLog("warning", this, c.yellow(t('unableToConnectToTechnicalOrgNthat', { val: e })));
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


// Query methods
export async function listOrgSObjects(connection: Connection) {
  const sObjectsQuery = `SELECT Id, Label, DeveloperName, QualifiedApiName, DurableId, IsTriggerable, IsCustomizable, IsApexTriggerable 
      FROM EntityDefinition WHERE IsTriggerable = true AND IsCustomizable = true and IsCustomSetting = false ORDER BY DeveloperName`;
  const results = await soqlQuery(sObjectsQuery, connection);
  uxLog("log", this, c.grey(t('foundSobjects', { results: results.records.length })));
  return results;
}

export async function listOrgSObjectsFiltered(connection: Connection): Promise<{ [key: string]: string }> {
  const sObjectResults = await listOrgSObjects(connection);
  const sObjectsDict: { [key: string]: string } = {};
  for (const record of sObjectResults.records) {
    if (!record.DeveloperName.endsWith("__Share") && !record.DeveloperName.endsWith("__ChangeEvent")) {
      sObjectsDict[record.DeveloperName] = `${record.Label} (${record.QualifiedApiName})`;
    }
  }
  return sObjectsDict;
}

export async function listOrgSObjectsFilteredWithQualifiedNames(connection: Connection): Promise<any[]> {
  const sObjectResults = await listOrgSObjects(connection);
  return sObjectResults.records.filter((record) =>
    !record.QualifiedApiName.endsWith("__Share") && !record.QualifiedApiName.endsWith("__ChangeEvent")
  );
}

/**
 * Open an org in the user's browser, the way `sf org open` does, except where no browser can be
 * opened: in CI, and in container mode (Agentforce Vibes, a dev container, Codespaces), where the
 * Salesforce CLI only prints the login link and returns. A command that hid that output left the
 * user with nothing, so there the link is logged and sent to the VS Code panel as a button. The link
 * holds a one-time code: it must be clicked right away, and it is kept out of the log file.
 *
 * The link is always asked with --url-only and the browser launched from here, never by
 * `sf org open` itself: run as a child process, that command exits right after it spawned its
 * browser launcher, and on Windows the launcher dies with it (every child of a Node process is
 * killed when the process exits, unless detached) before it had time to open anything. The
 * launcher used here is waited for.
 * @param commandThis The running command
 * @param options username: the org to open (the default org when omitted), fail: throw when
 * `sf org open` fails (default true)
 */
export async function openOrgInBrowser(
  commandThis: any,
  options: { username?: string; debug?: boolean; fail?: boolean } = {}
): Promise<void> {
  const target = options.username ? ` --target-org ${options.username}` : '';
  const openRes = await execSfdxJson(`sf org open --url-only${target}`, commandThis, {
    fail: options.fail !== false,
    output: false,
    debug: options.debug === true,
  });
  const url: string | null = openRes?.result?.url || null;
  if (!url) {
    return;
  }
  if (isCI || isContainerMode()) {
    // <copy> shows the link with a copy button in the VS Code UI. The line stays out of the log file.
    const displayedUrl = WebSocketClient.isAliveWithLwcUI() ? `<copy>${url}</copy>` : url;
    uxLog("action", commandThis, c.cyan(t('openOrgWithLink', { url: c.green(displayedUrl) })), { sensitive: true });
    WebSocketClient.sendReportFileMessage(url, t('openOrgButton'), 'actionUrl');
    return;
  }
  await waitForLightningDomain(url, commandThis);
  // The launcher hands the link to the browser and exits within a second. Not waiting longer than
  // a few seconds: a launcher that stays alive (some Linux desktops) must not block the command.
  await Promise.race([open(url, { wait: true }), new Promise((resolve) => setTimeout(resolve, 5000))]);
}

// Container mode: `sf org open` prints the link instead of opening a browser. The Salesforce CLI
// reads SF_CONTAINER_MODE (SFDX_CONTAINER_MODE before) and accepts `true` or `1`, nothing else.
export function isContainerMode(): boolean {
  const value = (getEnvVar('SF_CONTAINER_MODE') || getEnvVar('SFDX_CONTAINER_MODE') || '').toLowerCase();
  return value === 'true' || value === '1';
}

// Logs in again to an org whose token expired, keeping its alias, or naming it in the same call
async function reconnectExpiredOrg(
  org: { username?: string; instanceUrl: string; alias?: string | null },
  options: { nameOrg?: boolean } = {}
) {
  const aliasDecision = decideOrgAlias({
    existingAlias: org.alias || (await getAliasOfUsername(org.username)),
    instanceUrl: org.instanceUrl,
    interactive: options.nameOrg === true && !isCI && !isAgentMode(),
  });
  const alias = aliasDecision.ask === 'before' ? await promptOrgAlias(org.instanceUrl) : aliasDecision.alias;
  if (aliasDecision.ask === 'before') {
    // The VS Code UI hides everything after a prompt until the next action log
    uxLog("action", this, c.cyan(t('authenticatingUsingWebLogin')));
  }
  const loginCommand = 'sf org login web' + ` --instance-url ${org.instanceUrl}` + (alias ? ` --alias ${alias}` : '');
  const loginResult = await execSfdxJson(loginCommand, this, { fail: true, output: false });
  if (!loginResult?.result?.username) {
    throw new SfError(t('authenticationDidNotConnectAnyOrg'));
  }
  return { ...loginResult.result, alias: alias || loginResult.result.alias || null };
}

// `sf org open` waits for the My Domain of a new org to resolve before opening it (up to
// SF_DOMAIN_RETRY seconds, 240 by default): so does this, and the org is opened anyway on timeout
async function waitForLightningDomain(url: string, commandThis: any): Promise<void> {
  try {
    await new SfdcUrl(url).checkLightningDomain();
  } catch (error: any) {
    uxLog("warning", commandThis, c.yellow(t('openOrgDomainNotResolved', { message: error?.message || String(error) })));
  }
}
