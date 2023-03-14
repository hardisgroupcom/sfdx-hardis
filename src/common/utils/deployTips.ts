// Analyze deployment errors to provide tips to user :)
import * as c from "chalk";
import * as format from "string-template";
import stripAnsi = require("strip-ansi");
import { getAllTips } from "./deployTipsList";
import { deployErrorsToMarkdown, testFailuresToMarkdown } from "../gitProvider/utilsMarkdown";

let logRes = null;
let errorsAndTips = [];
const firstYellowChar = c.yellow("*")[0];

// Checks for deploy tips in a log string
// returns formatted and completed error log
export async function analyzeDeployErrorLogs(log: string, includeInLog = true, options: any): Promise<any> {
  errorsAndTips = []; // reset
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
    logResLines.push(logLine.trim());
    if (logLine.trim().startsWith("Error") && !(updatedLogLines[index + 1] && !updatedLogLines[index + 1].trim().startsWith("Error"))) {
      logResLines.push(c.yellow("No sfdx-hardis tip to solve this error. Try google ?"));
      logResLines.push(c.yellow(""));
      errorsAndTips.push({
        error: { message: stripAnsi(logLine.trim()) },
      });
    }
  });

  // Extract failed test classes
  const failedTests = [];
  const logRaw = stripAnsi(log);
  const regexFailedTests = /Test Failures([\S\s]*?)Test Success/gm;
  if (logRaw.match(regexFailedTests)) {
    const failedTestsLines = regexFailedTests
      .exec(logRaw)[1]
      .split("\n")
      .map((s) => s.trim());
    let failedTest = null;
    // Parse strings to extract main error line then stack
    for (const line of failedTestsLines) {
      const regex = /^(\w+[\d_]*)\s+(\w+[\d_]*)\s*(.*)$/;
      const match = line.match(regex);
      if (match) {
        if (match[1] === "Name") {
          // header column
          continue;
        }
        const errSplit = match[3].split("Class.");
        failedTest = {
          class: match[1],
          method: match[2],
          error: errSplit.shift().trim(),
        };
        if (errSplit.length > 0) {
          failedTest.stack = "Class." + errSplit.join("\nClass.");
        }
        failedTests.push(failedTest);
      }
    }
  }

  updatePullRequestResult(errorsAndTips, failedTests, options);
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
                message: tipDefinition.tip,
              },
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
            const replacements = m.map((str: string) => c.bold(str.trim().replace(/'/gm, "")));
            const replacementsMarkdown = m.map((str: string) => `**${str.trim().replace(/'/gm, "")}**`);
            newLogLines.push(c.yellow(c.italic(format(tipDefinition.label, replacements))));
            const tip = tipDefinition.tip;
            newLogLines.push(...tip.split(/\r?\n/).map((str: string) => c.yellow(format(str, replacements))));
            newLogLines.push(c.yellow(" "));
            // Update output list
            errorsAndTips.push({
              error: { message: stripAnsi(format(line, replacementsMarkdown)).replace(/\*\*.\*\*/gm, ".") },
              tip: {
                label: tipDefinition.label,
                message: stripAnsi(format(tipDefinition.tip, replacementsMarkdown).replace(/\*\*.\*\*/gm, ".")),
              },
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

// This data will be caught later to build a pull request message
async function updatePullRequestResult(errorsAndTips: Array<any>, failedTests: Array<any>, options: any) {
  const prData: any = {
    messageKey: "deployment",
    title: options.check ? "✅ Deployment check success" : "✅ Deployment success",
    deployErrorsMarkdownBody: "No error has been found during the deployment",
    deployStatus: "valid",
  };
  if (errorsAndTips.length > 0) {
    prData.title = options.check ? "❌ Deployment check failure" : "❌ Deployment failure";
    prData.deployErrorsMarkdownBody = deployErrorsToMarkdown(errorsAndTips);
    prData.status = "invalid";
  } else if (failedTests.length > 0) {
    prData.title = options.check ? "❌ Deployment check ok but failing test classes" : "❌ Deployment check ok but failing test classes";
    prData.deployErrorsMarkdownBody = testFailuresToMarkdown(failedTests);
    prData.status = "invalid";
  }
  globalThis.pullRequestData = Object.assign(globalThis.pullRequestData || {}, prData);
}
