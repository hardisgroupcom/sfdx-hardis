import * as fs from "fs-extra";
import * as path from "path";
import { isCI } from "../../common/utils";

export const hook = async (options: any) => {
  // Skip hooks from other commands than hardis commands
  const commandId = options?.id || "unknown";
  if (!commandId.startsWith("hardis")) {
    return;
  }
  if (!isCI) {
    // Initialize log file name
    const reportsDir = "./hardis-report";
    await fs.ensureDir(reportsDir);
    const commandsLogFolder = path.join(reportsDir, "commands");
    await fs.ensureDir(commandsLogFolder);
    const logFileName = (new Date().toJSON().slice(0, 19) + "-" + commandId + ".log").replace(/:/g, "-");
    const hardisLogFile = path.resolve(path.join(commandsLogFolder, logFileName));
    globalThis.hardisLogFileStream = fs.createWriteStream(hardisLogFile, { flags: "a" });
    globalThis.hardisLogFileStream.write(process.argv.join(" "));
  }
};
