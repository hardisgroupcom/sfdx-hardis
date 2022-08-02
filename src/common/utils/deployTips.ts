// Analyze deployment errors to provide tips to user :)
import * as c from "chalk";
import * as format from "string-template";
import { getAllTips } from "./deployTipsList";

let logRes = null;
const firstYellowChar = c.yellow("*")[0];

// Checks for deploy tips in a log string
// returns formatted and completed error log
export function analyzeDeployErrorLogs(log: string, includeInLog = true): any {
  logRes = returnErrorLines(log).join("\n");
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
    if ((logLine.startsWith("Error") || logLine.startsWith(" Error")) && !(updatedLogLines[index + 1] && !updatedLogLines[index + 1].startsWith("Error"))) {
      logResLines.push(c.yellow("No sfdx-hardis tip to solve this error. Try google ?"));
      logResLines.push(c.yellow(""));
    }
  });
  return { tips, errLog: logResLines.join("\n") };
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
