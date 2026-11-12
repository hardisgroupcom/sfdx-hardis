import { SfCommand } from "@salesforce/sf-plugins-core";
import c from "chalk";
import { execCommand, uxLog } from "./index.js";
import { analyzeDeployErrorLogs } from "./deployTips.js";
import { generateApexCoverageOutputFile } from "./deployUtils.js";
import { t } from './i18n.js';

export async function wrapSfdxCoreCommand(commandBase: string, argv: string[], commandThis: SfCommand<any>, debug = false): Promise<any> {
  const endArgs = buildWrappedCommandArgs(argv);
  // Build wrapped sfdx command
  const commandsArgs = endArgs.join(" ");
  const command = commandBase + " " + commandsArgs;
  let deployRes;
  // Call wrapped sfdx command
  uxLog("action", commandThis, c.cyan(t('executing', { command })));
  try {
    deployRes = await execCommand(command, commandThis, {
      output: true,
      debug: debug,
      fail: true,
    });
    process.exitCode = 0;
    await generateApexCoverageOutputFile();
  } catch (e) {
    await generateApexCoverageOutputFile();
    // Add deployment tips in error logs
    const { errLog } = await analyzeDeployErrorLogs((e as any).stdout + (e as any).stderr, true, { check: endArgs.includes("--checkonly"), label: 'metadata-deployment' });
    uxLog("error", commandThis, c.red(c.bold(t('unfortunatelyThereWereErrors'))));
    if (process.env?.SFDX_HARDIS_DEPLOY_ERR_COLORS === "false") {
      uxLog("other", this, "\n" + errLog);
    } else {
      uxLog("error", this, c.red("\n" + errLog));
    }
    deployRes = errLog;
    if ((e as any).code) {
      process.exitCode = (e as any).code;
    } else {
      process.exitCode = 1;
    }
  }
  if (typeof deployRes === 'object') {
    deployRes.stdout = JSON.stringify(deployRes);
  }
  return { outputstring: deployRes };
}

// Arguments of the wrapped sf command: quoted values, without the flags only sfdx-hardis knows
export function buildWrappedCommandArgs(argv: string[]): string[] {
  const endArgs = [...argv].map((arg) => {
    // Add quotes to avoid problems if arguments contain spaces
    if (!arg.startsWith("-") && !arg.startsWith(`"`) && !arg.startsWith(`'`)) {
      arg = `"${arg}"`;
    }
    return arg;
  });
  // Remove sfdx-hardis arguments: the flag alone, or the flag and its value
  const hardisFlags: Array<[string, number]> = [
    ["--debug", 1],
    ["--websocket", 2],
    ["--skipauth", 1],
    ["--checkcoverage", 1],
    ["--agent", 1],
  ];
  for (const [flag, length] of hardisFlags) {
    const flagPos = endArgs.indexOf(flag);
    if (flagPos > -1) {
      endArgs.splice(flagPos, length);
    }
  }
  return endArgs;
}
