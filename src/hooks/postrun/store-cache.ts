import { copyLocalSfdxInfo } from "../../common/utils/index.js";

export const hook = async (options: any) => {
  // Skip hooks from other commands than hardis commands
  const commandId = options?.Command?.id || "";
  if (!commandId.startsWith("hardis:scratch:create")) {
    return;
  }

  // Copy local SFDX cache for CI
  await copyLocalSfdxInfo();
  return;
};
