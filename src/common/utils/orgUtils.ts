import { MetadataUtils } from "../metadata-utils";
import { prompts } from "./prompts";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import { execSfdxJson, uxLog } from ".";
import { WebSocketClient } from "../websocketClient";
import { setConfig } from "../../config";
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

export async function promptOrg(commandThis: any, options: any = { devHub: false, setDefault: true }) {
  // List all local orgs and request to user
  const orgListResult = await MetadataUtils.listLocalOrgs("any");
  const orgList = [
    ...sortArray(orgListResult?.scratchOrgs || [], { by: ["username", "alias", "instanceUrl"], order: ["asc", "asc", "asc"] }),
    ...sortArray(orgListResult?.nonScratchOrgs || [], { by: ["username", "alias", "instanceUrl"], order: ["asc", "asc", "asc"] }),
    { username: "Connect to another org", otherOrg: true },
    { username: "Cancel", cancel: true },
  ];

  const orgResponse = await prompts({
    type: "select",
    name: "org",
    message: c.cyanBright("Please select an org"),
    choices: orgList.map((org: any) => {
      const title = org.username || org.alias || org.instanceUrl;
      const description = title !== org.instanceUrl ? org.instanceUrl : "";
      return {
        title: c.cyan(title),
        description: description,
        value: org,
      };
    }),
  });

  let org = orgResponse.org ;

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
  if (org?.connectedStatus === 'RefreshTokenAuthError') {
    uxLog(this,c.yellow(`Your authentication is expired. Please login again in the web browser`));
    const loginCommand = "sfdx auth:web:login" +
    ` --instanceurl ${org.instanceUrl}`;
    const loginResult = await execSfdxJson(loginCommand, this, {fail:true, output:true});
    org = loginResult.result ;
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
