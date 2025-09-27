// Analyze deployment errors to provide tips to user :)
import c from "chalk";
import format from "string-template";
import { getAllTips } from "./deployTipsList.js";
import { stripAnsi, uxLog } from "./index.js";
import { AiProvider, AiResponse } from "../aiProvider/index.js";
import fs from "fs-extra";
import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { updatePullRequestResult } from "./deployTips.js";
import { shortenLogLines } from "./deployUtils.js";


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
          message: "Please fix code coverage so your deployment can pass",
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
        message: "Please fix unknown errors (",
      },
    }))
    detailedErrorLines.push(...["", "⛔ " + c.red(c.bold("Unknown issue: " + resultJson.result.errorMessage)), ""]);
  }

  // Fallback : declare an error if we have not been able to identify errors
  if (errorsAndTips.length === 0 && failedTests.length === 0) {
    errorsAndTips.push(({
      error: { message: "There has been an issue parsing errors, please notify sfdx-hardis maintainers" },
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
      detailedErrorLines.push(...[c.yellow("No tip found for error. Try asking ChatGPT, Google or a Release Manager :)")])
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
  // Return results
  const newLog = includeInLog ? shortenLogLines(log) + "\n\n" + detailedErrorLines.join("\n") : shortenLogLines(log);
  return { tips, errorsAndTips, failedTests, errLog: newLog };
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
  if (AiProvider.isAiAvailable()) {
    if (alreadyProcessedErrors.length > parseInt(process.env.MAX_DEPLOYMENT_TIPS_AI_CALLS || "20")) {
      uxLog("warning", this, c.yellow(`[AI] Maximum number of AI calls for deployment tips reached. Increase with env var MAX_DEPLOYMENT_TIPS_AI_CALLS`));
      return null;
    }
    // Build base variables
    let promptKey: PromptTemplate = "PROMPT_SOLVE_DEPLOYMENT_ERROR";
    let promptVars: any = { "ERROR": JSON.stringify(error, null, 2) };

    // If enabled, try to include metadata file referenced in the component failure
    try {
      if (process.env.LLM_ADVISOR_WITH_METADATAS === "true") {
        // Check common fields that may contain a file path
        const possiblePaths: string[] = [];
        if (error?.filePath) possiblePaths.push(error.filePath);
        if (error?.fullName) possiblePaths.push(error.fullName);
        if (error?.problem) possiblePaths.push(error.problem);

        // If the error provides an explicit filePath, prefer it and skip regex detection
        let foundPath: string | null = null;
        if (error?.filePath) {
          foundPath = error.filePath;
        } else {
          // Regex to detect metadata-like file paths (accept any extension, e.g. .cls, .js, .html, .xml, .page, etc.)
          // We keep it permissive to match most Salesforce metadata file references in error messages.
          const mdRegex = /([\w\-./\\]+?\.[a-zA-Z0-9_.-]{1,20})/gi;
          for (const candidate of possiblePaths) {
            if (!candidate) continue;
            const match = mdRegex.exec(candidate.toString());
            if (match && match[1]) {
              foundPath = match[1];
              break;
            }
          }
        }

        if (foundPath) {
          // Try common resolution strategies.
          // If filePath was provided explicitly, just try that path and a couple of straightforward variants.
          let tryPathsBase: string[] = [];
          if (error?.filePath) {
            tryPathsBase = [foundPath, `./${foundPath}`, `${process.cwd()}/${foundPath}`];
          } else {
            tryPathsBase = [foundPath, `./${foundPath}`, `.${foundPath}`, `${process.cwd()}/${foundPath}`];
          }
          // Also try common Salesforce metadata companion file names, e.g. MyClass.cls -> MyClass.cls-meta.xml
          const tryPathsMetaVariants: string[] = [];
          for (const p of tryPathsBase) {
            tryPathsMetaVariants.push(p);
            tryPathsMetaVariants.push(`${p}-meta.xml`);
            // also try with .meta.xml if someone references without the -
            tryPathsMetaVariants.push(`${p}.meta.xml`);
          }
          // Deduplicate candidates while keeping order
          const tryPaths = Array.from(new Set(tryPathsMetaVariants));
          let absPath: string | null = null;
          for (const p of tryPaths) {
            if (fs.existsSync(p)) {
              absPath = p;
              break;
            }
          }
          if (absPath) {
            try {
              const content = await fs.readFile(absPath, "utf8");
              promptKey = "PROMPT_SOLVE_DEPLOYMENT_ERROR_WITH_MD" as PromptTemplate;
              promptVars = { "ERROR": JSON.stringify(error, null, 2), "METADATA_PATH": foundPath, "METADATA_CONTENT": content };
              uxLog("log", this, c.yellow(`[AI] Including metadata file content from ${absPath} in prompt`));
            } catch (e) {
              uxLog("warning", this, c.yellow(`[AI] Unable to read metadata file ${foundPath}: ${(e as Error).message}`));
            }
          }
        }
      }
    } catch (e) {
      uxLog("warning", this, c.yellow(`[AI] Error while preparing metadata for AI prompt: ${(e as Error).message}`));
    }

    const prompt = AiProvider.buildPrompt(promptKey as PromptTemplate, promptVars);
    try {
      const aiResponse = await AiProvider.promptAi(prompt, promptKey as PromptTemplate);
      return aiResponse;
    } catch (e) {
      uxLog("warning", this, c.yellow("[AI] Error while calling AI Provider: " + (e as Error).message));
    }
  }
  return null;
}
