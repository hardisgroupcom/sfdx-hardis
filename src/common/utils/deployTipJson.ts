// Analyze deployment errors to provide tips to user :)
import c from "chalk";
import format from "string-template";
import { getAllTips } from "./deployTipsList.js";
import { stripAnsi, uxLog } from "./index.js";
import { AiProvider, AiResponse } from "../aiProvider/index.js";
import { updatePullRequestResult } from "./deployTips.js";


export async function analyzeDeployErrorLogsJson(resultJson: any, log: string, includeInLog = true, options: any): Promise<any> {
  const allTips = getAllTips();
  const tips: any = [];

  // Filter to keep only errors (we don't care about warnings) and build legacy message to match deploymentTips
  const errors = (resultJson?.result?.details?.componentFailures || [])
    .filter(error => error.success === false && error.problemType === "Error")
    .map(error => {
      error.messageInitial = `Error ${error.fullName} ${error.problem}`;
      error.messageInitialDisplay = `${error.componentType} ${error.fullName}: ${error.problem}`;
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

  // Create output log
  const detailedErrorLines: string[] = [];
  for (const error of errors) {
    detailedErrorLines.push(...["", c.red(c.bold(error.messageInitialDisplay))]);
    if (error.tips.length > 0) {
      for (const errorTip of error.tips) {
        detailedErrorLines.push(...[
          c.italic(c.bold(errorTip.tip.label)),
          c.yellow(errorTip.tip.messageConsole),
          c.yellow(`Documentation: ${errorTip.tip.docUrl}`)
        ])
      }
    }
    else {
      detailedErrorLines.push(...["No tip found for error. Try asking ChatGPT or Google :)"])
    }
  }
  detailedErrorLines.push("");

  const failedTests: any[] = [];


  // Build output list of errors & tips
  const errorsAndTips: any[] = [];
  for (const error of errors) {
    for (const errorTip of error.tips)
      errorsAndTips.push(errorTip);
  }
  // Update data that will be used for Pull Request comment
  await updatePullRequestResult(errorsAndTips, failedTests, options);
  // Return results
  const newLog = includeInLog ? log + "\n\n" + detailedErrorLines.join("\n") : log;
  return { tips, errorsAndTips, failedTests, errLog: newLog };
}

async function matchesTip(tipDefinition: any, error: any) {
  error.tips = [];
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

async function findAiTip(error: any, alreadyProcessedErrors: string[]): Promise<AiResponse | null> {
  if (alreadyProcessedErrors.includes(error.message)) {
    return null;
  }
  alreadyProcessedErrors.push(error.message);
  if (AiProvider.isAiAvailable()) {
    const prompt = buildPrompt(error);
    try {
      const aiResponse = await AiProvider.promptAi(prompt);
      return aiResponse;
    } catch (e) {
      uxLog(this, c.yellow("[AI] Error while calling AI Provider: " + (e as Error).message));
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
    "- Please skip the part of the response about how to retrie or deploy the changes with Salesforce CLI.\n" +
    `The error is: \n${JSON.stringify(error, null, 2)}`;
  return prompt;
}