import * as c from "chalk";
import * as path from "path";
import { uxLog } from "./index.js";
import { getConfig } from "../../config/index.js";
import { parseXmlFile, writeXmlFile } from "./xmlUtils.js";

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
  const isAdmin = path.basename(profileFile) === "Admin.profile-meta.xml";
  let updatedDefaults = false;
  const partiallyRemoved = [];
  const nodesHavingDefaultOrFalse = ["applicationVisibilities", "recordTypeVisibilities", "userPermissions"];
  for (const node of nodesHavingDefaultOrFalse) {
    if (profileXml.Profile[node]) {
      const prevLen = profileXml.Profile[node].length;
      profileXml.Profile[node] = profileXml.Profile[node].filter((nodeVal) => {
        if (
          (isAdmin && node === "userPermissions") || // Admin profile keeps all permissions)
          (nodeVal?.default && nodeVal?.default[0] === "true") || // keep only default recordTypeVisibilities
          (nodeVal?.personAccountDefault && nodeVal?.personAccountDefault[0] === "true") || // keep only default PersonAccount recordTypeVisibilities
          (nodeVal?.visible && nodeVal?.visible[0] === "false") || // keep only false applicationVisibilities
          (nodeVal?.enabled && nodeVal?.enabled[0] === "false") // keep only false userPermissions
        ) {
          return true;
        }
        partiallyRemoved.push(node);
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
      partiallyRemoved.push("userPermissions");
      updatedUserPerms = true;
    }
  }

  // Update profile file
  const partiallyRemovedUnique = [...new Set(partiallyRemoved)];
  let updated = false;
  if (removed.length > 1 || updatedDefaults === true || updatedUserPerms === true) {
    updated = true;
    await writeXmlFile(profileFile, profileXml);
    let log = `Updated profile ${c.bold(path.basename(profileFile))} by completely removing sections ${c.bold(removed.join(", "))}`;
    if (partiallyRemovedUnique.length > 0) {
      log += ` and partially removing sections ${c.bold(partiallyRemovedUnique.join(", "))}`;
    }
    uxLog(this, c.yellow(log));
  }

  return { removed: removed, updatedDefaults: updatedDefaults, updated: updated };
}
