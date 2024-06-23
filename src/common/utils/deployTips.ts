// Analyze deployment errors to provide tips to user :)
import * as c from "chalk";
import * as format from "string-template";
import stripAnsi = require("strip-ansi");
import { getAllTips } from "./deployTipsList";
import { deployErrorsToMarkdown, testFailuresToMarkdown } from "../gitProvider/utilsMarkdown";
import { uxLog } from ".";
import { AiProvider, AiResponse } from "../aiProvider";

let logRes = null;
let errorsAndTips = [];
let alreadyProcessedErrors = [];
const firstYellowChar = c.yellow("*")[0];

// Checks for deploy tips in a log string
// returns formatted and completed error log
export async function analyzeDeployErrorLogs(log: string, includeInLog = true, options: any): Promise<any> {
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
  const logResLines = [];
  const updatedLogLines = returnErrorLines(logRes);
  let index = 0;
  for (const logLine of updatedLogLines) {
    logResLines.push(logLine.trim());
    if (logLine.includes("Error (1): Deploy failed.")) {
      index++;
      continue;
    }
    if (logLine.trim().startsWith("Error") && !(updatedLogLines[index + 1] && !updatedLogLines[index + 1].trim().startsWith("Error"))) {
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
        const promptText = buildPrompt(logLine.trim());
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
  return { tips, errorsAndTips, failedTests, errLog: logResLines.join("\n") };
}

// Checks if the error string or regex is found in the log
// Adds the fix tip under the line if includeInLog is true
async function matchesTip(tipDefinition: any, includeInLog = true): Promise<boolean | any> {
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
      const newLogLines = [];
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
    const prompt = buildPrompt(errorLine);
    try {
      const aiResponse = await AiProvider.promptAi(prompt);
      return aiResponse;
    } catch (e) {
      uxLog(this, c.yellow("[AI] Error while calling OpenAI: " + e.message));
    }
  }
  return null;
}

function buildPrompt(errorLine: string) {
  const prompt =
    `How to solve Salesforce deployment error "${errorLine}" ? \n` +
    "- Please answer using sfdx source format, not metadata format. \n" +
    "- Please provide XML example if applicable. \n" +
    "- Please skip the part of the response about retrieving or deploying the changes with Salesforce CLI.";
  return prompt;
}
