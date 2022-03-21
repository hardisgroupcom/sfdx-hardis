import { SfdxCommand } from "@salesforce/command";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import { execCommand, uxLog } from ".";
import { analyzeDeployErrorLogs } from "./deployTips";

export async function wrapDeployCommand(commandBase: string, argv: string[], commandThis: SfdxCommand, debug = false): Promise<AnyJson> {
  const endArgs = [...argv].splice(3);
  // Remove sfdx-hardis arguments
  if (endArgs.indexOf("--debug") > -1) {
    endArgs.splice(endArgs.indexOf("debug"), 1);
  }
  if (endArgs.indexOf("-d") > -1) {
    endArgs.splice(endArgs.indexOf("-d"), 1);
  }
  if (endArgs.indexOf("--websocket") > -1) {
    endArgs.splice(endArgs.indexOf("websocket"), 2);
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
    const { errLog } = analyzeDeployErrorLogs(e.stdout + e.stderr);
    uxLog(commandThis, c.red(c.bold("Sadly there has been Deployment error(s)")));
    uxLog(commandThis, c.red("\n" + errLog));
    deployRes = errLog;
  }
  return { outputstring: deployRes };
}
