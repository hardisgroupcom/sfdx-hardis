import { MetadataUtils } from "../metadata-utils";
import { prompts } from "./prompts";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as glob from "glob-promise";
import * as path from "path";
import { createTempDir, execCommand, execSfdxJson, uxLog } from ".";
import { WebSocketClient } from "../websocketClient";
import { getConfig, setConfig } from "../../config";
import * as sortArray from "sort-array";
import { Connection, SfdxError } from "@salesforce/core";
import { importData } from "./dataUtils";
import { soqlQuery } from "./apiUtils";

export async function listProfiles(conn: any) {
  if (conn in [null, undefined]) {
    return [];
  }
  const profileRes = await conn.queryAll("SELECT Id,Name FROM Profile ORDER BY Name");
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
const profiles = await promptProfiles(this.org.getConnection(),{multiselect: true, initialSelection: ["System Administrator","Administrateur Système"]});
const profile = await promptProfiles(this.org.getConnection(),{multiselect: false, initialSelection: ["System Administrator","Administrateur Système"]});
*/
export async function promptProfiles(
  conn: Connection,
  options: any = {
    multiselect: false,
    initialSelection: [],
    returnField: "Name",
    message: "Please select profile(s)",
    allowSelectAll: true,
    allowSelectAllErrorMessage: "You can not select all profiles",
    allowSelectMine: true,
    allowSelectMineErrorMessage: "You can not select the profile your user is assigned to",
  }
) {
  const profiles = await listProfiles(conn);
  // Profiles returned by active connection
  if (profiles.length > 0) {
    const profilesSelection = await prompts({
      type: options.multiselect ? "multiselect" : "select",
      message: options.message || "Please select profile(s)",
      name: "value",
      choices: profiles.map((profile: any) => {
        return {
          title: profile.Name,
          value: options.returnField === "record" ? profile : options.returnField === "Id" ? profile.Id : profile.Name,
        };
      }),
    });
    // Verify that all profiles are not selected if allowSelectAll === false
    if (options.allowSelectAll === false && profilesSelection.value.length === profiles.length) {
      throw new SfdxError(options.allowSelectAllErrorMessage);
    }
    // Verify that current user profile is not selected
    if (options.allowSelectMine === false) {
      if (!["record", "Id"].includes(options.returnField)) {
        throw new SfdxError("You can not use option allowSelectMine:false if you don't use record or Id as return value");
      }
      const userRes = await soqlQuery(`SELECT ProfileId FROM User WHERE Id='${(await conn.identity()).user_id}' LIMIT 1`, conn);
      const profileId = userRes.records[0]["ProfileId"];
      if (profilesSelection.value.filter((profileSelected) => profileSelected === profileId || profileSelected?.Id === profileId).length > 0) {
        throw new SfdxError(options.allowSelectMineErrorMessage);
      }
    }
    return profilesSelection.value || null;
  } else {
    // Manual input of comma separated profiles
    const profilesSelection = await prompts({
      type: "text",
      message: options.message || "Please input profile name",
      name: "value",
      initial: options?.initialSelection[0] || null,
    });
    return options.multiselect ? profilesSelection.value.split(",") : profilesSelection.value;
  }
}

export async function promptOrg(commandThis: any, options: any = { devHub: false, setDefault: true, scratch: false, devSandbox: false }) {
  // List all local orgs and request to user
  const orgListResult = await MetadataUtils.listLocalOrgs(options.devSandbox === true ? "sandbox" : "any");
  let orgList = [
    ...sortArray(orgListResult?.scratchOrgs || [], { by: ["devHubUsername", "username", "alias", "instanceUrl"], order: ["asc", "asc", "asc"] }),
    ...sortArray(orgListResult?.nonScratchOrgs || [], { by: ["username", "alias", "instanceUrl"], order: ["asc", "asc", "asc"] }),
    { username: "Connect to another org", otherOrg: true },
    { username: "Cancel", cancel: true },
  ];

  // Filter if we want to list only the scratch attached to current devhub
  if (options.scratch === true) {
    const configGetRes = await execSfdxJson("sfdx config:get defaultdevhubusername", this, {
      output: false,
      fail: true,
    });
    const hubOrgUsername = configGetRes?.result[0]?.value || "";
    orgList = orgList.filter((org: any) => org.status === "Active" && org.devHubUsername === hubOrgUsername);
  }

  // Prompt user
  const orgResponse = await prompts({
    type: "select",
    name: "org",
    message: c.cyanBright("Please select an org"),
    choices: orgList.map((org: any) => {
      const title = org.username || org.alias || org.instanceUrl;
      const description = (title !== org.instanceUrl ? org.instanceUrl : "") + (org.devHubUsername ? ` (Hub: ${org.devHubUsername})` : "-");
      return {
        title: c.cyan(title),
        description: description || "-",
        value: org,
      };
    }),
  });

  let org = orgResponse.org;

  // Cancel
  if (org.cancel === true) {
    uxLog(commandThis, c.cyan("Cancelled"));
    process.exit(0);
  }

  // Connect to new org
  if (org.otherOrg === true) {
    await commandThis.config.runHook("auth", {
      checkAuth: true,
      Command: commandThis,
      devHub: options.devHub === true,
      setDefault: options.setDefault !== false,
    });
    return options.setDefault !== false ? await MetadataUtils.getCurrentOrg() : {};
  }

  // Token is expired: login again to refresh it
  if (org?.connectedStatus === "RefreshTokenAuthError") {
    uxLog(this, c.yellow(`Your authentication is expired. Please login again in the web browser`));
    const loginCommand = "sfdx auth:web:login" + ` --instanceurl ${org.instanceUrl}`;
    const loginResult = await execSfdxJson(loginCommand, this, { fail: true, output: true });
    org = loginResult.result;
  }

  if (options.setDefault === true) {
    // Set default username
    const setDefaultUsernameCommand =
      `sfdx config:set ` +
      `${options.devHub ? "defaultdevhubusername" : "defaultusername"}=${org.username}` +
      (!fs.existsSync(path.join(process.cwd(), "sfdx-project.json")) ? " --global" : "");
    await execSfdxJson(setDefaultUsernameCommand, commandThis, {
      fail: true,
      output: false,
    });

    // If devHub , set alias of project devHub from config file
    const config = await getConfig("project");
    if (options.devHub && config.devHubAlias) {
      const setAliasCommand = `sfdx alias:set ${config.devHubAlias}=${org.username}`;
      await execSfdxJson(setAliasCommand, commandThis, {
        fail: true,
        output: false,
      });
    } else {
      // If not devHub, set MY_ORG as alias
      const setAliasCommand = `sfdx alias:set MY_ORG=${org.username}`;
      await execSfdxJson(setAliasCommand, commandThis, {
        fail: true,
        output: false,
      });
    }

    WebSocketClient.sendMessage({ event: "refreshStatus" });
    // Update local user .sfdx-hardis.yml file with response if scratch has been selected
    if (org.username.includes("scratch")) {
      await setConfig("user", {
        scratchOrgAlias: org.alias || null,
        scratchOrgUsername: org.username || org.alias,
      });
    } else {
      await setConfig("user", {
        scratchOrgAlias: null,
        scratchOrgUsername: null,
      });
    }
  }
  uxLog(commandThis, c.gray(JSON.stringify(org, null, 2)));
  uxLog(commandThis, c.cyan(`Org ${c.green(org.username)} - ${c.green(org.instanceUrl)}`));
  return orgResponse.org;
}

export async function promptOrgUsernameDefault(commandThis: any, defaultOrg: string, options: any = { devHub: false, setDefault: true }) {
  const defaultOrgRes = await prompts({
    type: "confirm",
    message: `Do you want to use org ${defaultOrg}`,
  });
  if (defaultOrgRes.value === true) {
    return defaultOrg;
  } else {
    const selectedOrg = await promptOrg(commandThis, options);
    return selectedOrg.username;
  }
}

// Authenticate with SfdxUrlStore
export async function authenticateWithSfdxUrlStore(org: any) {
  // Authenticate to scratch org to delete
  const authFile = path.join(await createTempDir(), "sfdxScratchAuth.txt");
  const authFileContent = org.scratchOrgSfdxAuthUrl || (org.authFileJson ? JSON.stringify(org.authFileJson) : null);
  await fs.writeFile(authFile, authFileContent, "utf8");
  const authCommand = `sfdx auth:sfdxurl:store -f ${authFile}`;
  await execCommand(authCommand, this, { fail: true, output: false });
}

// Add package installation to project .sfdx-hardis.yml
export async function managePackageConfig(installedPackages, packagesToInstallCompleted) {
  const config = await getConfig("project");
  let projectPackages = config.installedPackages || [];
  let updated = false;
  for (const installedPackage of installedPackages) {
    const matchInstalled = packagesToInstallCompleted.filter((pckg) => pckg.SubscriberPackageId === installedPackage.SubscriberPackageId);
    const matchLocal = projectPackages.filter((projectPackage) => installedPackage.SubscriberPackageId === projectPackage.SubscriberPackageId);
    // Upgrade version of already installed package
    if (matchInstalled.length > 0 && matchLocal.length > 0) {
      projectPackages = projectPackages.map((projectPackage) => {
        if (installedPackage.SubscriberPackageId === projectPackage.SubscriberPackageId) {
          projectPackage = Object.assign(projectPackage, installedPackage);
        }
        return projectPackage;
      });
      uxLog(
        this,
        c.cyan(
          `Updated package ${c.green(installedPackage.SubscriberPackageName)} with version id ${c.green(installedPackage.SubscriberPackageVersionId)}`
        )
      );
      updated = true;
    } else if (matchInstalled.length > 0 && matchLocal.length === 0) {
      // Request user about automatic installation during scratch orgs and deployments
      const installResponse = await prompts({
        type: "select",
        name: "value",
        message: c.cyanBright(`Please select the install configuration for ${c.bold(installedPackage.SubscriberPackageName)}`),
        choices: [
          {
            title: `Install automatically ${c.bold(installedPackage.SubscriberPackageName)} on scratch orgs only`,
            value: "scratch",
          },
          {
            title: `Deploy automatically ${c.bold(installedPackage.SubscriberPackageName)} on integration/production orgs only`,
            value: "deploy",
          },
          {
            title: `Both: Install & deploy automatically ${c.bold(installedPackage.SubscriberPackageName)}`,
            value: "scratch-deploy",
          },
          {
            title: `Do not configure ${c.bold(installedPackage.SubscriberPackageName)} installation / deployment`,
            value: "none",
          },
        ],
      });
      installedPackage.installOnScratchOrgs = installResponse.value.includes("scratch");
      installedPackage.installDuringDeployments = installResponse.value.includes("deploy");
      if (installResponse.value !== "none" && installResponse.value != null) {
        projectPackages.push(installedPackage);
        updated = true;
      }
    }
  }
  if (updated) {
    uxLog(this, "Updated package configuration in sfdx-hardis config");
    await setConfig("project", { installedPackages: projectPackages });
  }
}

// Assign permission sets to user
export async function initPermissionSetAssignments(permSets: Array<any>, orgUsername: string) {
  uxLog(this, c.cyan("Assigning Permission Sets..."));
  for (const permSet of permSets) {
    uxLog(this, c.cyan(`Assigning ${c.bold(permSet.name || permSet)} to sandbox org user`));
    const assignCommand = `sfdx force:user:permset:assign -n ${permSet.name || permSet} -u ${orgUsername}`;
    const assignResult = await execSfdxJson(assignCommand, this, {
      fail: false,
      output: false,
    });
    if (assignResult?.result?.failures?.length > 0 && !assignResult?.result?.failures[0].message.includes("Duplicate")) {
      uxLog(this, c.red(`Error assigning to ${c.bold(permSet.name || permSet)}\n${assignResult?.result?.failures[0].message}`));
    }
  }
}

// Run initialization apex scripts
export async function initApexScripts(orgInitApexScripts: Array<any>, orgAlias: string) {
  uxLog(this, c.cyan("Running apex initialization scripts..."));
  const allApexScripts = await glob("**/scripts/**/*.apex");
  // Build ordered list of apex scripts
  const initApexScripts = orgInitApexScripts.map((scriptName: string) => {
    const matchingScripts = allApexScripts.filter((apexScript: string) => path.basename(apexScript) === scriptName);
    if (matchingScripts.length === 0) {
      throw new SfdxError(c.red(`[sfdx-hardis][ERROR] Unable to find script ${scriptName}.apex`));
    }
    return matchingScripts[0];
  });
  // Process apex scripts
  for (const apexScript of initApexScripts) {
    const apexScriptCommand = `sfdx force:apex:execute -f "${apexScript}" -u ${orgAlias}`;
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
    uxLog(this, c.cyan("Loading sandbox org initialization data..."));
    await importData(initDataFolder, this, {
      targetUsername: orgUsername,
    });
  } else {
    uxLog(this, c.cyan(`No initialization data: Define a sfdmu workspace in ${initDataFolder} if you need data in your new sandbox orgs`));
  }
  // Import data packages
  const config = await getConfig("user");
  const dataPackages = config.dataPackages || [];
  for (const dataPackage of dataPackages) {
    if (dataPackage.importInSandboxOrgs === true) {
      await importData(dataPackage.dataPath, this, {
        targetUsername: orgUsername,
      });
    } else {
      uxLog(this, c.grey(`Skipped import of ${dataPackage.dataPath} as importInSandboxOrgs is not defined to true in .sfdx-hardis.yml`));
    }
  }
}
