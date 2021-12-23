import * as c from "chalk";
import * as path from "path";
import { uxLog } from ".";
import { parseXmlFile, writeXmlFile } from "./xmlUtils";

// Push sources to org
// For some cases, push must be performed in 2 times: the first with all passing sources, and the second with updated sources requiring the first push
export async function minimizeProfile(profileFile: string) {
  const profileXml = await parseXmlFile(profileFile);
  // Remove nodes that are present on Permission Sets
  const nodesToRemove = [
    "userPermissions",
    "classAccesses",
    "externalDataSourceAccesses",
    "fieldPermissions",
    "objectPermissions",
    "pageAccesses",
    "tabVisibilities",
    "customMetadataTypeAccesses",
  ];
  const removed = [];
  for (const node of nodesToRemove) {
    if (profileXml.Profile[node]) {
      delete profileXml.Profile[node];
      removed.push(node);
    }
  }
  // Keep only default values
  let updatedDefaults = false;
  const nodesHavingDefault = ["applicationVisibilities", "recordTypeVisibilities"];
  for (const node of nodesHavingDefault) {
    if (profileXml.Profile[node]) {
      const prevLen = profileXml.Profile[node].length;
      profileXml.Profile[node] = profileXml.Profile[node].filter((nodeVal) => nodeVal.default === true);
      if (profileXml.Profile[node].length !== prevLen) {
        updatedDefaults = true;
      }
    }
  }
  // Update profile file
  let updated = false;
  if (removed.length > 1 || updatedDefaults === true) {
    updated = true;
    await writeXmlFile(profileFile, profileXml);
    uxLog(
      this,
      c.grey(
        `Updated profile ${c.bold(path.basename(profileXml))} by removing sections ${c.bold(removed.join(","))}${
          updatedDefaults === true ? " and removing not default values" : ""
        }`
      )
    );
  }

  return { removed: removed, updatedDefaults: updatedDefaults, updated: updated };
}
