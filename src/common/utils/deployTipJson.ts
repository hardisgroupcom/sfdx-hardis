// Analyze deployment errors to provide tips to user 😊
import c from "chalk";
import { getAllTips } from "./deployTipsList.js";
import { formatTemplate as format } from "./stringUtils.js";
import { stripAnsi, uxLog } from "./index.js";
import { AiProvider, AiResponse } from "../aiProvider/index.js";
import { updatePullRequestResult } from "./deployTips.js";
import { shortenLogLines } from "./deployUtils.js";
import { buildDeployResultSummaryLines, isFullDeployJsonLogRequested } from "./deployResultSummary.js";
import { t } from './i18n.js';


export async function analyzeDeployErrorLogsJson(resultJson: any, log: string, includeInLog = true, options: any): Promise<any> {
  const allTips = getAllTips();
  const tips: any = [];

  // Filter to keep only errors (we don't care about warnings) and build legacy message to match deploymentTips
  const errors = (resultJson?.result?.details?.componentFailures || [])
    .filter(error => error.success === false && error.problemType === "Error")
    .map(error => {
      error.messageInitial = `Error ${error.fullName} ${error.problem}`;
      error.messageInitialDisplay = `${error.componentType} ${error.fullName}: ${error.problem}`;
      error.tips = [];
      return error;
    });

  // Collect errors & tips
  for (const error of errors) {
    for (const tipDefinition of allTips) {
      await matchesTip(tipDefinition, error);
      if (error.tips.length > 0) {
        tips.push(tipDefinition);
      }
    }
    // Add default tip if not found
    if (error.tips.length === 0) {
      error.message = stripAnsi(error.messageInitial);
      const errorBase = Object.assign({}, error);
      delete errorBase.tips;
      error.tips.push({
        error: errorBase
      });
    }
  }

  // Enrich with AI if applicable
  const alreadyProcessedErrors: string[] = [];
  for (const error of errors) {
    for (const errorTip of error.tips) {
      const aiTip = await findAiTip(errorTip.error, alreadyProcessedErrors);
      if (aiTip) {
        errorTip.tipFromAi = {
          promptResponse: aiTip.promptResponse,
        }
      }
    }
  }

  // Gather failing tests
  const failedTests = extractFailedTestsInfo(resultJson?.result?.details?.runTestResult?.failures || []);

  // Build output list of errors & tips
  const errorsAndTips: any[] = [];
  for (const error of errors) {
    for (const errorTip of error.tips)
      errorsAndTips.push(errorTip);
  }

  const detailedErrorLines: string[] = [];

  // Fallback in case we have not been able to identify errors: Check if there are code coverage warnings
  if (errorsAndTips.length === 0 && failedTests.length === 0 && resultJson?.result?.details?.runTestResult?.codeCoverageWarnings?.length > 0) {
    for (const cvrgWarning of resultJson.result.details.runTestResult.codeCoverageWarnings) {
      const coverageErrorMsg = (cvrgWarning.name ? `${cvrgWarning.name} - ` : "") + cvrgWarning.message;
      errorsAndTips.push(({
        error: { message: coverageErrorMsg },
        tip: {
          label: "CodeCoverageWarning",
          message: t('pleaseFixCodeCoverageSoYourDeployment'),
          docUrl: "https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_code_coverage_intro.htm",
        },
      }))
      detailedErrorLines.push(...["", "⛔ " + c.red(c.bold("Coverage issue: " + coverageErrorMsg)), ""]);
    }
  }

  // Fallback : declare an error if we have not been able to identify errors
  if (errorsAndTips.length === 0 && failedTests.length === 0 && resultJson?.result?.errorMessage) {
    errorsAndTips.push(({
      error: { message: resultJson.result.errorMessage },
      tip: {
        label: resultJson.result.errorStatusCode || "UNKNOWN",
        message: t('pleaseFixUnknownErrors'),
      },
    }))
    detailedErrorLines.push(...["", "⛔ " + c.red(c.bold("Unknown issue: " + resultJson.result.errorMessage)), ""]);
  }

  // Fallback: the command died before Salesforce returned a result (lost connection, CLI error...):
  // the JSON only has a top-level message and cause
  if (errorsAndTips.length === 0 && failedTests.length === 0 && !resultJson?.result && (resultJson?.message || resultJson?.cause)) {
    const topLevelError = buildTopLevelErrorAndTip(resultJson);
    errorsAndTips.push(topLevelError);
    detailedErrorLines.push(...(topLevelError.tip.label === "NetworkError"
      ? ["", "⛔ " + c.red(c.bold(topLevelError.error.message)), c.yellow(topLevelError.tip.message), ""]
      : ["", "⛔ " + c.red(c.bold(t('unknownDeploymentIssue', { message: topLevelError.error.message }))), ""]));
  }

  // Fallback : declare an error if we have not been able to identify errors
  if (errorsAndTips.length === 0 && failedTests.length === 0) {
    errorsAndTips.push(({
      error: { message: t('thereHasBeenAnIssueParsingErrors') },
      tip: {
        label: "SfdxHardisInternalError",
        message: "Declare issue on https://github.com/hardisgroupcom/sfdx-hardis/issues",
      },
    }))
    detailedErrorLines.push(...["", "⛔ " + c.red(c.bold("There has been an issue parsing errors, please notify sfdx-hardis maintainers")), ""]);
  }

  // Create output log for errors
  for (const error of errors) {
    detailedErrorLines.push(...["", "⛔ " + c.red(c.bold(error.messageInitialDisplay)), ""]);
    if (error.tips.length > 0 && error.tips.some(err => err.tip || err.tipFromAi)) {
      for (const errorTip of error.tips) {
        if (errorTip.tip) {
          detailedErrorLines.push(...[
            c.yellow(c.italic("✏️ Error " + c.bold(errorTip.tip.label)) + ":"),
            c.yellow(errorTip.tip.messageConsole),
            c.yellow(`Documentation: ${errorTip.tip.docUrl}`)
          ])
        }
        if (errorTip.tipFromAi) {
          detailedErrorLines.push(...[
            c.yellow(c.italic("🤖 AI response:")),
            c.yellow(errorTip.tipFromAi.promptResponse)
          ])
        }
      }
    }
    else {
      detailedErrorLines.push(...[c.yellow("No tip found for error. Try asking ChatGPT, Google or a Release Manager 😊")])
    }
  }
  detailedErrorLines.push("");

  // Create output log for test failures
  if (failedTests.length > 0) {
    detailedErrorLines.push(...["", c.red(c.bold("Test failures:"))], "");
    for (const failedTest of failedTests) {
      detailedErrorLines.push(...[
        c.red(`💥 ${c.bold(failedTest.class)}.${c.bold(failedTest.method)}: ${failedTest.error}`),
        c.grey(`Stack: ${failedTest.stack || "none"}`),
        ""
      ]);
    }
  }

  // Update data that will be used for Pull Request comment
  await updatePullRequestResult(errorsAndTips, failedTests, options);
  // Build a readable summary instead of the complete deployment JSON, that can be huge in big orgs
  const summaryBlock = buildDeployResultSummaryLines(resultJson, {
    check: options?.check === true,
    label: options?.label,
    reportFile: options?.deployResultReportFile ?? null,
  }).join("\n");
  // The raw output is normally replaced by the summary, but when nothing could be parsed out of it
  // there is no summary to display, and hiding it would leave no trace at all of what went wrong.
  const hasParsableResult = !!resultJson?.result;
  const rawJsonBlock = isFullDeployJsonLogRequested() || !hasParsableResult ? "\n\n" + shortenLogLines(log) : "";
  // Return results
  const newLog = includeInLog
    ? summaryBlock + rawJsonBlock + "\n\n" + detailedErrorLines.join("\n")
    : summaryBlock + rawJsonBlock;
  return { tips, errorsAndTips, failedTests, errLog: newLog };
}

// Text of a network failure: the connection to Salesforce was lost or could not be opened
const NETWORK_FAILURE_REGEX = /fetch failed|ConnectTimeoutError|UND_ERR_CONNECT_TIMEOUT|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i;

export function isNetworkFailureText(text: string): boolean {
  return NETWORK_FAILURE_REGEX.test(text || "");
}

// Error and tip for a command output that only has a top-level message and cause, no result
export function buildTopLevelErrorAndTip(resultJson: any): any {
  const message = String(resultJson?.message || "").trim();
  const cause = typeof resultJson?.cause === "string" ? resultJson.cause : JSON.stringify(resultJson?.cause ?? "");
  if (isNetworkFailureText(`${message}\n${cause}`)) {
    return buildNetworkErrorAndTip(extractShortNetworkCause(message, cause));
  }
  return {
    error: { message: message || cause.split(/\r?\n/)[0] },
    tip: {
      label: resultJson?.name || "UNKNOWN",
      message: t('pleaseFixUnknownErrors'),
    },
  };
}

export function buildNetworkErrorAndTip(shortCause: string): any {
  return {
    error: { message: t('connectionToSalesforceLost', { cause: shortCause }) },
    tip: {
      label: "NetworkError",
      message: t('connectionToSalesforceLostRunAgain'),
    },
  };
}

// One line naming the network failure, never a stack: the innermost "[cause]: XxxError: text" of
// undici, else the top-level message, else the first line of the cause
export function extractShortNetworkCause(message: string, cause: string): string {
  const innerCauses = [...(cause || "").matchAll(/\[cause\]:\s*\w*Error:\s*([^\r\n]+)/g)];
  const inner = innerCauses.length > 0 ? innerCauses[innerCauses.length - 1][1].trim() : "";
  const code = /code:\s*'([A-Z_]+)'/.exec(cause || "")?.[1] || "";
  const firstCauseLine = (cause || "").split(/\r?\n/)[0].replace(/^\w*Error:\s*/, "").trim();
  let short = inner || message || firstCauseLine || "fetch failed";
  if (code && !short.includes(code)) {
    short += ` [${code}]`;
  }
  return short.length > 300 ? short.slice(0, 297) + "..." : short;
}

async function matchesTip(tipDefinition: any, error: any) {
  matchStringBasedTip(tipDefinition, error);
  matchRegExpBasedTip(tipDefinition, error);
}

function matchStringBasedTip(tipDefinition: any, error: any) {
  if (tipDefinition.expressionString &&
    tipDefinition.expressionString.filter((expressionString: any) => error.messageInitial.includes(expressionString)).length > 0) {
    error.message = stripAnsi(error.messageInitial);
    const errorBase = Object.assign({}, error);
    delete errorBase.tips;
    error.tips.push({
      error: errorBase,
      tip: {
        label: tipDefinition.label,
        docUrl: tipDefinition.docUrl,
        message: tipDefinition.tip,
        messageConsole: tipDefinition.tip,
      },
    });
  }
}

function matchRegExpBasedTip(tipDefinition: any, error: any) {
  if (
    tipDefinition.expressionRegex &&
    tipDefinition.expressionRegex.filter((expressionRegex: any) => {
      expressionRegex.lastIndex = 0; // reset regex last index to be able to reuse it
      return expressionRegex.test(error.messageInitial);
    }).length > 0
  ) {
    const regex = tipDefinition.expressionRegex.filter((expressionRegex: any) => {
      expressionRegex.lastIndex = 0; // reset regex last index to be able to reuse it
      return expressionRegex.test(error.messageInitial);
    })[0];
    regex.lastIndex = 0; // reset regex last index to be able to reuse it
    const matches = [...error.messageInitial.matchAll(regex)];
    for (const m of matches) {
      const replacements = m.map((str: string) => c.bold(str.trim().replace(/'/gm, "")));
      const replacementsMarkdown = m.map((str: string) => `**${str.trim().replace(/'/gm, "")}**`);
      error.message = stripAnsi(format(error.messageInitial, replacementsMarkdown)).replace(/\*\*.\*\*/gm, ".")
      const errorBase = Object.assign({}, error);
      delete errorBase.tips;
      error.tips.push({
        error: errorBase,
        tip: {
          label: tipDefinition.label,
          docUrl: tipDefinition.docUrl,
          message: stripAnsi(format(tipDefinition.tip, replacementsMarkdown).replace(/\*\*.\*\*/gm, ".")),
          messageConsole: tipDefinition.tip.split(/\r?\n/).map((str: string) => format(str, replacements)).join("\n")
        },
      });
    }
  }
}

function extractFailedTestsInfo(failedTestsIn: any[]) {
  const failedTests: any[] = [];
  for (const failedTestIn of failedTestsIn || []) {
    const failedTestRes: any = {
      class: (failedTestIn.namespace ? failedTestIn.namespace + "__" : '') + failedTestIn.name,
      method: failedTestIn.methodName,
      error: failedTestIn.message,
    };
    if (failedTestIn?.stackTrace) {
      failedTestRes.stack = failedTestIn.stackTrace;
    }
    failedTests.push(failedTestRes);
  }
  return failedTests;
}


async function findAiTip(error: any, alreadyProcessedErrors: string[]): Promise<AiResponse | null> {
  if (alreadyProcessedErrors.includes(error.message)) {
    return null;
  }
  alreadyProcessedErrors.push(error.message);
  if (await AiProvider.isAiAvailable()) {
    if (alreadyProcessedErrors.length > parseInt(process.env.MAX_DEPLOYMENT_TIPS_AI_CALLS || "20")) {
      uxLog("warning", this, c.yellow(`[AI] Maximum number of AI calls for deployment tips reached. Increase with env var MAX_DEPLOYMENT_TIPS_AI_CALLS`));
      return null;
    }
    const prompt = buildPrompt(error);
    try {
      const aiResponse = await AiProvider.promptAi(prompt, "PROMPT_SOLVE_DEPLOYMENT_ERROR");
      return aiResponse;
    } catch (e) {
      uxLog("warning", this, c.yellow("[AI] Error while calling AI Provider: " + (e as Error).message));
    }
  }
  return null;
}

function buildPrompt(error: any) {
  const prompt =
    `You are a Salesforce release manager using Salesforce CLI commands to perform deployments \n` +
    `How to solve the following Salesforce deployment error ?\n` +
    "- Please answer using sfdx source format, not metadata format. \n" +
    "- Please provide XML example if applicable. \n" +
    "- Please skip the part of the response about how to retrieve or deploy the changes with Salesforce CLI.\n" +
    `The error is: \n${JSON.stringify(error, null, 2)}`;
  return prompt;
}