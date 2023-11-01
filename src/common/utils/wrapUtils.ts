import { SfdxCommand } from "@salesforce/command";
import * as c from "chalk";
import { execCommand, uxLog } from ".";
import { analyzeDeployErrorLogs } from "./deployTips";

export async function wrapSfdxCoreCommand(commandBase: string, argv: string[], commandThis: SfdxCommand, debug = false): Promise<any> {
  const endArgs = [...argv].map((arg) => {
    // Add quotes to avoid problems if arguments contain spaces
    if (!arg.startsWith("-") && !arg.startsWith(`"`) && !arg.startsWith(`'`)) {
      arg = `"${arg}"`;
    }
    return arg;
  });
  // Remove sfdx-hardis arguments
  const debugPos = endArgs.indexOf("--debug");
  if (debugPos > -1) {
    endArgs.splice(debugPos, 1);
  }
  const dPos = endArgs.indexOf("-d");
  if (dPos > -1) {
    endArgs.splice(dPos, 1);
  }
  const websocketPos = endArgs.indexOf("--websocket");
  if (websocketPos > -1) {
    endArgs.splice(websocketPos, 2);
  }
  const skipAuthPos = endArgs.indexOf("--skipauth");
  if (skipAuthPos > -1) {
    endArgs.splice(skipAuthPos, 1);
  }
  const checkCoveragePos = endArgs.indexOf("--checkcoverage");
  if (checkCoveragePos > -1) {
    endArgs.splice(checkCoveragePos, 1);
  }
  // Build wrapped sfdx command
  const commandsArgs = endArgs.join(" ");
  const command = commandBase + " " + commandsArgs;
  let deployRes;
  // Call wrapped sfdx command
  try {
    deployRes = await execCommand(command, commandThis, {
      output: true,
      debug: debug,
      fail: true,
    });
  } catch (e) {
    // Add deployment tips in error logs
    const { errLog } = await analyzeDeployErrorLogs(e.stdout + e.stderr, true, { check: endArgs.includes("--checkonly") });
    uxLog(commandThis, c.red(c.bold("Sadly there has been error(s)")));
    if (process.env?.SFDX_HARDIS_DEPLOY_ERR_COLORS === "false") {
      uxLog(this, "\n" + errLog);
    } else {
      uxLog(this, c.red("\n" + errLog));
    }
    deployRes = errLog;
    if (e.code) {
      process.exitCode = e.code;
    } else {
      process.exitCode = 1;
    }
  }
  return { outputstring: deployRes };
}
