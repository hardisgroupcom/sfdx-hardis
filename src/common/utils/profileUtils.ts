import * as c from "chalk";
import * as path from "path";
import { uxLog } from ".";
import { getConfig } from "../../config";
import { parseXmlFile, writeXmlFile } from "./xmlUtils";

// Push sources to org
// For some cases, push must be performed in 2 times: the first with all passing sources, and the second with updated sources requiring the first push
export async function minimizeProfile(profileFile: string) {
  const profileXml = await parseXmlFile(profileFile);
  // Remove nodes that are present on Permission Sets
  const nodesToRemoveDefault = [
    "classAccesses",
    "customMetadataTypeAccesses",
    "externalDataSourceAccesses",
    "fieldPermissions",
    "objectPermissions",
    "pageAccesses",
  ];
  // Remove more attributes if not admin profile
  const isAdmin = path.basename(profileFile) === "Admin.profile-meta.xml";
  if (!isAdmin) {
    nodesToRemoveDefault.push(...["userPermissions"]);
  }
  // Allow to override the list of node to remove at repo level
  const config = await getConfig("branch");
  const nodesToRemove = config.minimizeProfilesNodesToRemove || nodesToRemoveDefault;
  // Remove nodes
  const removed = [];
  for (const node of nodesToRemove) {
    if (profileXml.Profile[node]) {
      delete profileXml.Profile[node];
      removed.push(node);
    }
  }
  // Keep only default values or false values
  let updatedDefaults = false;
  const nodesHavingDefault = ["applicationVisibilities", "recordTypeVisibilities"];
  for (const node of nodesHavingDefault) {
    if (profileXml.Profile[node]) {
      const prevLen = profileXml.Profile[node].length;
      profileXml.Profile[node] = profileXml.Profile[node].filter((nodeVal) => {
        if (
          (nodeVal?.default && nodeVal?.default[0] === "true") ||
          (nodeVal?.personAccountDefault && nodeVal?.personAccountDefault[0] === "true") ||
          (nodeVal?.visible && nodeVal?.visible[0] === "false")
        ) {
          return true;
        }
        return false;
      });
      if (profileXml.Profile[node].length !== prevLen) {
        updatedDefaults = true;
      }
    }
  }

  // Additional user permissions to remove (defined in .sfdx-hardis autoRemoveUserPermissions property)
  let updatedUserPerms = false;
  if (profileXml.Profile["userPermissions"]) {
    const prevLen1 = profileXml.Profile["userPermissions"].length;
    profileXml.Profile["userPermissions"] = profileXml.Profile["userPermissions"].filter((userPermission) => {
      return !(config.autoRemoveUserPermissions || []).includes(userPermission.name[0]);
    });
    if (profileXml.Profile["userPermissions"].length !== prevLen1) {
      updatedUserPerms = true;
    }
  }

  // Update profile file
  let updated = false;
  if (removed.length > 1 || updatedDefaults === true || updatedUserPerms === true) {
    updated = true;
    await writeXmlFile(profileFile, profileXml);
    uxLog(
      this,
      c.grey(
        `Updated profile ${c.bold(path.basename(profileFile))} by removing sections ${c.bold(removed.join(","))}${
          updatedDefaults === true ? " and removing not default values" : ""
        }`,
      ),
    );
  }

  return { removed: removed, updatedDefaults: updatedDefaults, updated: updated };
}
