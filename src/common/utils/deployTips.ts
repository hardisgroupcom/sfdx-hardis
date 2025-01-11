// Analyze deployment errors to provide tips to user :)
import c from "chalk";
import format from "string-template";

import { getAllTips } from "./deployTipsList.js";
import { deployErrorsToMarkdown, testFailuresToMarkdown } from "../gitProvider/utilsMarkdown.js";
import { findJsonInString, stripAnsi, uxLog } from "./index.js";
import { AiProvider, AiResponse } from "../aiProvider/index.js";
import { analyzeDeployErrorLogsJson } from "./deployTipJson.js";

let logRes: string | null = null;
let errorsAndTips: any[] = [];
let alreadyProcessedErrors: any[] = [];
const firstYellowChar = c.yellow("*")[0];

// Checks for deploy tips in a log string
// returns formatted and completed error log
export async function analyzeDeployErrorLogs(log: string, includeInLog = true, options: any): Promise<any> {
  // New way using json: should be always be used
  const jsonResult = findJsonInString(log);
  if (jsonResult) {
    const resultsFromJson = await analyzeDeployErrorLogsJson(jsonResult, log, includeInLog, options);
    if (resultsFromJson && (resultsFromJson?.errorsAndTips.length > 0 || resultsFromJson?.failedTests?.length > 0)) {
      return resultsFromJson;
    }
  }
  errorsAndTips = []; // reset
  alreadyProcessedErrors = []; // reset
  logRes = returnErrorLines(log).join("\n"); // reset
  const tips: any = [];
  for (const tipDefinition of getAllTips()) {
    if (await matchesTip(tipDefinition, includeInLog)) {
      tips.push(tipDefinition);
    }
  }
  // Add default error messages for errors without tips
  const logResLines: any[] = [];
  const updatedLogLines = returnErrorLines(logRes);
  let index = 0;
  for (const logLine of updatedLogLines) {
    logResLines.push(logLine.trim());
    if (logLine.includes("Deploy failed.")) {
      index++;
      continue;
    }
    if (isErrorLine(logLine) &&
      (updatedLogLines[index + 1] && isErrorLine(updatedLogLines[index + 1]) || !updatedLogLines[index + 1])
    ) {
      const aiTip = await findAiTip(logLine.trim());
      // Complete with AI if possible
      if (aiTip && aiTip.success) {
        logResLines.push(c.yellow(`[AI] ${aiTip.model} suggested the following tip ${c.bold(c.bgRed("(can be good or stupid, this is AI !)"))}:`));
        logResLines.push(c.magenta(c.italic(aiTip.promptResponse)));
        logResLines.push(c.yellow(""));
        errorsAndTips.push({
          error: { message: stripAnsi(logLine.trim()) },
          tipFromAi: {
            promptResponse: aiTip.promptResponse,
          },
        });
      } else {
        const promptText = AiProvider.buildPrompt("PROMPT_SOLVE_DEPLOYMENT_ERROR", logLine.trim());
        // No tip found, give the user an AI prompt
        logResLines.push(c.yellow("No sfdx-hardis tip to solve this error. You can try the following prompt:"));
        logResLines.push(c.yellow(promptText));
        logResLines.push(c.yellow(""));
        errorsAndTips.push({
          error: { message: stripAnsi(logLine.trim()) },
          tipFromAi: {
            promptText: promptText,
          },
        });
      }
    }
    index++;
  }

  // Extract failed test classes
  const logRaw = stripAnsi(log);
  const failedTests: any[] = [];
  // sf project deploy output
  extractFailedTestsInfoForSfCommand(logRaw, failedTests);
  if (failedTests.length === 0) {
    // Legacy sfdx force:source:deploy output
    extractFailedTestsInfoForSfdxCommand(logRaw, failedTests);
  }
  // Fallback in case we have not been able to identify errors
  if (errorsAndTips.length === 0 && failedTests.length === 0) {
    errorsAndTips.push(({
      error: { message: "There has been an issue parsing errors, probably because of a SF CLI output format update. Please check console logs." },
      tip: {
        label: "SfdxHardisParseError",
        message: "If you are in CI/CD, please check at the bottom of deployment check job logs. The issue will be fixed ASAP.",
      },
    }))
  }

  await updatePullRequestResult(errorsAndTips, failedTests, options);
  return { tips, errorsAndTips, failedTests, errLog: logResLines.join("\n") };
}

function isErrorLine(str: string) {
  const strTrim = str.trim();
  if (strTrim.startsWith("Error") || strTrim.startsWith("| Error")) {
    return true;
  }
  return false;
}

function extractFailedTestsInfoForSfdxCommand(logRaw: string, failedTests: any[]) {
  const regexFailedTests = /Test Failures([\S\s]*?)Test Success/gm;
  if (logRaw.match(regexFailedTests)) {
    const failedTestsLines = (regexFailedTests
      .exec(logRaw) || [])[1]
      .split("\n")
      .map((s) => s.trim());
    let failedTest: any = null;
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
          error: (errSplit.shift() || "").trim(),
        };
        if (errSplit.length > 0) {
          failedTest.stack = "Class." + errSplit.join("\nClass.");
        }
        failedTests.push(failedTest);
      }
    }
  }
}

function extractFailedTestsInfoForSfCommand(logRaw: string, failedTests: any[]) {
  const regexFailedTests = /Test Failures([\S\s]*?)Test Success/gm;
  if (logRaw.match(regexFailedTests)) {
    const failedTestsString = (regexFailedTests.exec(logRaw) || [])[1].split(/\r?\n/).join("\n") + "\n•";
    // Parse strings to extract main error line then stack
    // eslint-disable-next-line no-regex-spaces, no-useless-escape
    const regex = /^• (.*)\n  message: (.*)\n  stacktrace: ([\s\S]*?)(?=\n•|\z)/gm;
    const matches = [...failedTestsString.matchAll(regex)];
    for (const match of matches || []) {
      const failedTest: any = {
        class: match[1].split(".")[0],
        method: match[1].split(".")[1],
        error: match[2].trim(),
      };
      if (match[3]) {
        failedTest.stack = match[3];
      }
      failedTests.push(failedTest);
    }
  }
}

// Checks if the error string or regex is found in the log
// Adds the fix tip under the line if includeInLog is true
async function matchesTip(tipDefinition: any, includeInLog = true): Promise<boolean | any> {
  const newLogLines: any[] = [];
  // string matching
  if (
    tipDefinition.expressionString &&
    tipDefinition.expressionString.filter((expressionString: any) => {
      return (logRes || "").includes(expressionString);
    }).length > 0
  ) {
    if (includeInLog) {
      const logLines = returnErrorLines(logRes);
      for (const line of logLines) {
        newLogLines.push(line);
        let found = false;
        for (const expressionString of tipDefinition.expressionString) {
          if (line.includes(expressionString)) {
            found = true;
            newLogLines.push(c.yellow(c.italic("Tip for " + tipDefinition.label + ":")));
            newLogLines.push(...tipDefinition.tip.split(/\r?\n/).map((str: string) => c.yellow(str)));
            newLogLines.push(c.yellow(" "));
            // Update output list
            errorsAndTips.push({
              error: { message: stripAnsi(line) },
              tip: {
                label: tipDefinition.label,
                message: tipDefinition.tip,
                docUrl: tipDefinition.docUrl
              },
            });
          }
        }
        if (found) {
          const aiTip = await findAiTip(line.trim());
          // Complete with AI if possible
          if (aiTip && aiTip.success) {
            newLogLines.push(
              c.yellow(`[AI] ${aiTip.model} suggested the following tip ${c.bold(c.bgRed("(can be good or stupid, this is AI !)"))}:`),
            );
            newLogLines.push(c.magenta(c.italic(aiTip.promptResponse)));
            newLogLines.push(c.yellow(""));
            const lastErrorAndTip = errorsAndTips[errorsAndTips.length - 1];
            lastErrorAndTip.tipFromAi = {
              promptResponse: aiTip.promptResponse,
            };
            errorsAndTips[errorsAndTips.length - 1] = lastErrorAndTip;
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
      const newLogLines: any[] = [];
      const logLines = returnErrorLines(logRes);
      for (const line of logLines) {
        newLogLines.push(line);
        let found = false;
        for (const expressionRegex of tipDefinition.expressionRegex) {
          expressionRegex.lastIndex = 0; // reset regex last index to be able to reuse it
          const matches = [...line.matchAll(expressionRegex)];
          for (const m of matches) {
            found = true;
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
                docUrl: tipDefinition.docUrl,
                message: stripAnsi(format(tipDefinition.tip, replacementsMarkdown).replace(/\*\*.\*\*/gm, ".")),
              },
            });
          }
          if (found) {
            const aiTip = await findAiTip(line.trim());
            // Complete with AI if possible
            if (aiTip && aiTip.success) {
              newLogLines.push(
                c.yellow(`[AI] ${aiTip.model} suggested the following tip ${c.bold(c.bgRed("(can be good or stupid, this is AI !)"))}:`),
              );
              newLogLines.push(c.magenta(c.italic(aiTip.promptResponse)));
              newLogLines.push(c.yellow(""));
              const lastErrorAndTip = errorsAndTips[errorsAndTips.length - 1];
              lastErrorAndTip.tipFromAi = {
                promptResponse: aiTip.promptResponse,
              };
              errorsAndTips[errorsAndTips.length - 1] = lastErrorAndTip;
            }
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
  return strIn.split(/\r?\n/).filter((str) => isErrorLine(str) || str.startsWith(firstYellowChar));
}

// This data will be caught later to build a pull request message
export async function updatePullRequestResult(errorsAndTips: Array<any>, failedTests: Array<any>, options: any) {
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
    prData.title = options.check ? "❌ Deployment check ok, but failing test classes" : "❌ Deployment check ok, but failing test classes";
    prData.deployErrorsMarkdownBody = testFailuresToMarkdown(failedTests);
    prData.status = "invalid";
  }
  globalThis.pullRequestData = Object.assign(globalThis.pullRequestData || {}, prData);
}

async function findAiTip(errorLine: any): Promise<AiResponse | null> {
  if (alreadyProcessedErrors.includes(errorLine)) {
    return null;
  }
  alreadyProcessedErrors.push(errorLine);
  if (AiProvider.isAiAvailable()) {
    const prompt = AiProvider.buildPrompt("PROMPT_SOLVE_DEPLOYMENT_ERROR", errorLine);
    try {
      const aiResponse = await AiProvider.promptAi(prompt);
      return aiResponse;
    } catch (e) {
      uxLog(this, c.yellow("[AI] Error while calling OpenAI: " + (e as Error).message));
    }
  }
  return null;
}

