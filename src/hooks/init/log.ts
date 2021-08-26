import * as fs from "fs-extra";
import * as path from "path";

export const hook = async (options: any) => {
  // Skip hooks from other commands than hardis commands
  const commandId = options?.id || "unknown";
  if (!commandId.startsWith("hardis")) {
    return;
  }
  // Initialize log file name
  const reportsDir = "./hardis-report";
  await fs.ensureDir(reportsDir);
  const commandsLogFolder = path.join(reportsDir, "commands");
  await fs.ensureDir(commandsLogFolder);
  const logFileName = new Date().toUTCString() + "-" + commandId;
  const hardisLogFile = path.join(commandsLogFolder, logFileName);
  globalThis.hardisLogFileStream = fs.createWriteStream(hardisLogFile, { flags: "a" });
};
