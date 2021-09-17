import { MetadataUtils } from "../metadata-utils";
import { prompts } from "./prompts";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import { execSfdxJson, uxLog } from ".";
import { WebSocketClient } from "../websocketClient";
import { getConfig, setConfig } from "../../config";
import * as sortArray from "sort-array";

export async function listProfiles(conn: any) {
  if (conn in [null, undefined]) {
    return [];
  }
  const profileRes = await conn.queryAll("SELECT Id,Name FROM Profile ORDER BY Name");
  return profileRes.records;
}

// Prompt profile(s) for selection
/*
Example calls from command class:
const profiles = await promptProfiles(this.org.getConnection(),{multiselect: true, initialSelection: ["System Administrator","Administrateur Système"]});
const profile = await promptProfiles(this.org.getConnection(),{multiselect: false, initialSelection: ["System Administrator","Administrateur Système"]});
*/
export async function promptProfiles(conn: any, options: any = { multiselect: false, initialSelection: [], message: "Please select profile(s)" }) {
  const profiles = await listProfiles(conn);
  // Profiles returned by active connection
  if (profiles.length > 0) {
    const profilesSelection = await prompts({
      type: options.multiselect ? "multiselect" : "select",
      message: options.message || "Please select profile(s)",
      name: "value",
      choices: profiles.map((profile: any) => {
        return { title: profile.Name, value: profile.Name };
      }),
    });
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

export async function promptOrg(commandThis: any, options: any = { devHub: false, setDefault: true, scratch: false }) {
  // List all local orgs and request to user
  const orgListResult = await MetadataUtils.listLocalOrgs("any");
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
    return { outputString: "Launched org connection" };
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
    WebSocketClient.sendMessage({ event: "refreshStatus" });
    // Update local user .sfdx-hardis.yml file with response if scratch has been selected
    if (org.username.includes("scratch")) {
      await setConfig("user", {
        scratchOrgAlias: org.username,
        scratchOrgUsername: org.alias || org.username,
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
