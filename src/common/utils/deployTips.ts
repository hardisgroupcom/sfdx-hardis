// Analyze deployment errors to provide tips to user :)
import * as c from "chalk";
import * as format from "string-template";
import stripAnsi = require("strip-ansi");
import { GitProvider } from "../gitProvider";
import { PullRequestMessageRequest } from "../gitProvider/gitProvider";
import { GitProviderInterface } from "../gitProvider/gitProviderInterface";
import { getAllTips } from "./deployTipsList";

let logRes = null;
let errorsAndTips = []
const firstYellowChar = c.yellow("*")[0];

// Checks for deploy tips in a log string
// returns formatted and completed error log
export function analyzeDeployErrorLogs(log: string, includeInLog = true): any {
  errorsAndTips = [] // reset
  logRes = returnErrorLines(log).join("\n"); // reset
  const tips: any = [];
  for (const tipDefinition of getAllTips()) {
    if (matchesTip(tipDefinition, includeInLog)) {
      tips.push(tipDefinition);
    }
  }
  // Add default error messages for errors without tips
  const logResLines = [];
  const updatedLogLines = returnErrorLines(logRes);
  updatedLogLines.forEach((logLine, index) => {
    logResLines.push(logLine);
    if (
      (logLine.startsWith("Error") || logLine.startsWith(" Error")) &&
      !(updatedLogLines[index + 1] && !updatedLogLines[index + 1].startsWith("Error"))
    ) {
      logResLines.push(c.yellow("No sfdx-hardis tip to solve this error. Try google ?"));
      logResLines.push(c.yellow(""));
      errorsAndTips.push({
        error: {
          message: stripAnsi(logLine)
        }
      });
    }
  });
  const gitProvider = GitProvider.getInstance();
  if (gitProvider) {
    postResultAsPullRequestComment(errorsAndTips, gitProvider);
  }
  return { tips, errorsAndTips, errLog: logResLines.join("\n") };
}

// Checks if the error string or regex is found in the log
// Adds the fix tip under the line if includeInLog is true
function matchesTip(tipDefinition: any, includeInLog = true): boolean | any {
  const newLogLines = [];
  // string matching
  if (
    tipDefinition.expressionString &&
    tipDefinition.expressionString.filter((expressionString: any) => {
      return logRes.includes(expressionString);
    }).length > 0
  ) {
    if (includeInLog) {
      const logLines = returnErrorLines(logRes);
      for (const line of logLines) {
        newLogLines.push(line);
        for (const expressionString of tipDefinition.expressionString) {
          if (line.includes(expressionString)) {
            newLogLines.push(c.yellow(c.italic("Tip for " + tipDefinition.label + ":")));
            newLogLines.push(...tipDefinition.tip.split(/\r?\n/).map((str: string) => c.yellow(str)));
            newLogLines.push(c.yellow(" "));
            // Update output list
            errorsAndTips.push({
              error: { message: stripAnsi(line) },
              tip: {
                label: tipDefinition.label,
                message: tipDefinition.tip
              }
            });
          }
        }
      }
      logRes = newLogLines.join("\n");
    }
    return true;
  }
  // regex matching
  /* jscpd:ignore-start */
  if (
    tipDefinition.expressionRegex &&
    tipDefinition.expressionRegex.filter((expressionRegex: any) => {
      return expressionRegex.test(logRes);
    }).length > 0
  ) {
    if (includeInLog) {
      const newLogLines = [];
      const logLines = returnErrorLines(logRes);
      for (const line of logLines) {
        newLogLines.push(line);
        for (const expressionRegex of tipDefinition.expressionRegex) {
          expressionRegex.lastIndex = 0; // reset regex last index to be able to reuse it
          const matches = [...line.matchAll(expressionRegex)];
          for (const m of matches) {
            const replacements = m.map((str: string) => c.bold(str.trim()));
            newLogLines.push(c.yellow(c.italic(format(tipDefinition.label, replacements))));
            const tip = tipDefinition.tip;
            newLogLines.push(...tip.split(/\r?\n/).map((str: string) => c.yellow(format(str, replacements))));
            newLogLines.push(c.yellow(" "));
            // Update output list
            errorsAndTips.push({
              error: { message: stripAnsi(line) },
              tip: {
                label: tipDefinition.label,
                message: stripAnsi(format(tipDefinition.tip, replacements))
              }
            });
          }
        }
      }
      logRes = newLogLines.join("\n");
    }
    return true;
  }
  return false;
  /* jscpd:ignore-end */
}

function returnErrorLines(strIn) {
  return strIn.split(/\r?\n/).filter((str) => str.startsWith("Error") || str.startsWith(" Error") || str.startsWith(firstYellowChar));
}


async function postResultAsPullRequestComment(errorsAndTips: Array<any>, gitProvider: GitProviderInterface) {
  let title = null;
  let markdownBody = null;
  let status = null;
  if (errorsAndTips.length === 0) {
    title = "Deployment success";
    markdownBody = "No error has been found during the deployment";
    status = "valid"
  }
  else {
    title = "Deployment error";
    markdownBody = JSON.stringify(errorsAndTips, null, 2);
    status = "invalid"
  }
  const prMessageRequest: PullRequestMessageRequest = {
    title: title,
    message: markdownBody,
    status: status
  }
  await gitProvider.postPullRequestMessage(prMessageRequest);
}