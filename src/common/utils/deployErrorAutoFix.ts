import c from "chalk";
import { getCurrentGitBranch, git, uxLog } from "./index.js";
import { CodingAgentProvider } from "../aiProvider/codingAgentProvider.js";
import { buildPromptFromTemplate } from "../aiProvider/promptTemplates.js";
import { GitProvider } from "../gitProvider/index.js";
import { t } from "./i18n.js";

export interface AutoFixResult {
  success: boolean;
  pullRequestUrl?: string;
  fixBranch?: string;
  fixedFiles?: string[];
  errorsDescription?: string;
  fixesDescription?: string;
}

/**
 * Orchestrates the auto-fix flow for deployment errors:
 * 1. Creates a fix branch from the current branch
 * 2. Runs a coding agent to analyze and fix errors
 * 3. Commits the fixes
 * 4. Pushes the fix branch
 * 5. Creates a PR/MR targeting the current branch
 */
export async function autoFixDeployErrors(
  errorsAndTips: any[],
  failedTests: any[],
  options: { targetUsername?: string; check?: boolean } = {},
): Promise<AutoFixResult> {
  // Check if auto-fix is enabled
  if (!(await CodingAgentProvider.isAutoFixEnabled())) {
    uxLog("log", this, c.grey(t("codingAgentAutoFixNotEnabled")));
    return { success: false };
  }

  // Check if a coding agent is available
  const agentConfig = await CodingAgentProvider.getConfiguredAgent();
  if (!agentConfig) {
    uxLog("warning", this, c.yellow(t("noCodingAgentAvailable")));
    return { success: false };
  }

  const currentBranch = await getCurrentGitBranch();
  if (!currentBranch) {
    uxLog("warning", this, c.yellow(t("codingAgentUnableToDetectBranch")));
    return { success: false };
  }

  // Fix branch name is deterministic (no timestamp) so re-runs replace the previous fix branch
  const fixBranch = `auto-fix/${currentBranch}`;

  uxLog("action", this, c.cyan(t("codingAgentCreatingFixBranch", { branch: fixBranch })));

  try {
    uxLog("warning", this, c.yellow(t("codingAgentBetaWarning")));

    // Delete local fix branch if it already exists, then create fresh from current HEAD
    try { await git().deleteLocalBranch(fixBranch, true); } catch { /* branch didn't exist locally */ }
    // Create and checkout the fix branch
    await git().checkoutLocalBranch(fixBranch);

    // Run the coding agent to fix errors
    const prompt = await buildDeployFixPrompt(errorsAndTips, failedTests, options.targetUsername || null);
    const runResult = await CodingAgentProvider.runPrompt(prompt);

    if (!runResult) {
      uxLog("warning", this, c.yellow(t("codingAgentNoFixesApplied")));
      await git().checkout(currentBranch);
      await git().deleteLocalBranch(fixBranch, true);
      return { success: false };
    }

    const fixedFiles = await getChangedFiles();
    const fixesDescription = parseFixesSummary(runResult.stdout);

    if (fixedFiles.length === 0) {
      uxLog("warning", this, c.yellow(t("codingAgentNoFixesApplied")));
      // Go back to original branch
      await git().checkout(currentBranch);
      // Delete the fix branch
      await git().deleteLocalBranch(fixBranch, true);
      return { success: false };
    }

    const agentResult = {
      agent: runResult.agent,
      fixedFiles,
      errorsDescription: buildErrorsDescription(errorsAndTips, failedTests),
      fixesDescription: fixesDescription || t("codingAgentAppliedFixes", { count: String(fixedFiles.length) }),
    };

    uxLog("action", this, c.cyan(t("codingAgentFixesApplied", { count: String(agentResult.fixedFiles.length) })));

    // Stage and commit the fixes (exclude docs/ folder — documentation should not be auto-committed)
    await git().raw(["add", "--all", "--", ".", ":!docs"]);
    await git().addConfig("user.email", "sfdx-hardis-bot@cloudity.com", false, "global");
    await git().addConfig("user.name", "sfdx-hardis Bot", false, "global");
    const commitMessage = `fix: auto-fix deployment errors using ${agentResult.agent}\n\n${agentResult.fixesDescription.substring(0, 500)}`;
    await git().commit(commitMessage, ["--no-verify"]);

    // Push the fix branch
    uxLog("action", this, c.cyan(t("codingAgentPushingFixBranch", { branch: fixBranch })));
    try {
      await git().push("origin", fixBranch, ["--set-upstream", "--force"]);
    } catch (e) {
      uxLog("error", this, c.red(`[sfdx-hardis] Push failed for branch ${fixBranch}: ${(e as Error).message}`));
      await GitProvider.logAutoFixRemediation("push");
      throw e;
    }

    // Build PR description with errors and fixes
    const prDescription = buildPullRequestDescription(
      errorsAndTips,
      failedTests,
      agentResult,
    );

    // Create PR/MR targeting the current branch
    uxLog("action", this, c.cyan(t("codingAgentCreatingPullRequest", { target: currentBranch })));
    const prUrl = await GitProvider.createPullRequest({
      title: `fix: auto-fix deployment errors on ${currentBranch}`,
      body: prDescription,
      sourceBranch: fixBranch,
      targetBranch: currentBranch,
    });

    if (prUrl) {
      uxLog("action", this, c.green(t("codingAgentPullRequestCreated", { url: prUrl })));
    } else {
      uxLog("warning", this, c.yellow(t("codingAgentPullRequestCreationFailed")));
      await GitProvider.logAutoFixRemediation("pr-create");
    }

    // Go back to original branch
    await git().checkout(currentBranch);

    return {
      success: true,
      pullRequestUrl: prUrl || undefined,
      fixBranch,
      fixedFiles: agentResult.fixedFiles,
      errorsDescription: agentResult.errorsDescription,
      fixesDescription: agentResult.fixesDescription,
    };
  } catch (e) {
    uxLog("error", this, c.red(t("codingAgentAutoFixError", { message: (e as Error).message })));
    // Try to go back to original branch
    try {
      await git().checkout(currentBranch);
    } catch {
      // Ignore checkout error
    }
    return { success: false };
  }
}

/**
 * Build the PR/MR description with all errors and fixes detailed.
 */
function buildPullRequestDescription(
  errorsAndTips: any[],
  failedTests: any[],
  agentResult: { agent: string; fixedFiles: string[]; errorsDescription: string; fixesDescription: string },
): string {
  const lines: string[] = [];

  lines.push(`## Auto-Fix Deployment Errors (Beta)`);
  lines.push("");
  lines.push(`> **⚠️ Warning:** This PR was generated by an AI coding agent. AI can make mistakes — **all changes must be carefully reviewed by an expert before merging.**`);
  lines.push("");
  lines.push(`This pull request was automatically created by **sfdx-hardis** using the **${agentResult.agent}** coding agent to fix deployment errors.`);
  lines.push("");

  lines.push("## Fixes Overview");
  lines.push("");

  if (agentResult.fixesDescription?.trim()) {
    // Keep agent output untouched: prompt controls the exact markdown structure.
    lines.push(agentResult.fixesDescription.trim());
    lines.push("");
  } else {
    lines.push("No fix summary was provided by the coding agent.");
    lines.push("");
  }

  lines.push("---");
  lines.push("_Powered by [sfdx-hardis](https://sfdx-hardis.cloudity.com) auto-fix feature_");

  return lines.join("\n");
}

/**
 * Build the prompt for the coding agent using the template system.
 */
async function buildDeployFixPrompt(
  errorsAndTips: any[],
  failedTests: any[],
  targetUsername: string | null,
): Promise<string> {
  const errorsText = formatErrorsForPrompt(errorsAndTips);
  const failedTestsText = formatFailedTestsForPrompt(failedTests);

  return await buildPromptFromTemplate("PROMPT_CODING_AGENT_FIX_DEPLOYMENT_ERRORS", {
    ERRORS: errorsText || "No deployment errors.",
    FAILED_TESTS: failedTestsText || "No failed tests.",
    TARGET_ORG: targetUsername || "N/A",
  });
}

function formatErrorsForPrompt(errorsAndTips: any[]): string {
  if (errorsAndTips.length === 0) return "";
  const lines: string[] = [];
  for (const item of errorsAndTips) {
    lines.push(`### Error: ${item.error?.message || "Unknown error"}`);
    if (item.tip?.message) {
      lines.push(`Tip: ${item.tip.message}`);
    }
    if (item.tipFromAi?.promptResponse) {
      lines.push(`AI Suggestion: ${item.tipFromAi.promptResponse}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function formatFailedTestsForPrompt(failedTests: any[]): string {
  if (failedTests.length === 0) return "";
  const lines: string[] = [];
  for (const test of failedTests) {
    lines.push(`### Test: ${test.class}.${test.method}`);
    lines.push(`Error: ${test.error}`);
    if (test.stack) {
      lines.push(`Stack: ${test.stack}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function getChangedFiles(): Promise<string[]> {
  try {
    const status = await git().status();
    return [
      ...status.modified,
      ...status.created,
      ...status.renamed.map((r) => r.to),
    ];
  } catch {
    return [];
  }
}

function parseFixesSummary(output: string): string {
  const summaryMatch = output.match(/---[\s\w]*SUMMARY[\s\w]*---([\s\S]*)/i);
  if (summaryMatch) {
    return summaryMatch[1].trim();
  }
  if (output.length > 0) {
    return output.slice(-5000).trim();
  }
  return "";
}

function buildErrorsDescription(errorsAndTips: any[], failedTests: any[]): string {
  const lines: string[] = [];

  if (errorsAndTips.length > 0) {
    lines.push("## Deployment Errors");
    lines.push("");
    for (const item of errorsAndTips) {
      lines.push(`- **Error**: ${item.error?.message || "Unknown error"}`);
      if (item.tip?.message) {
        lines.push(`  - **Tip**: ${item.tip.message}`);
      }
    }
    lines.push("");
  }

  if (failedTests.length > 0) {
    lines.push("## Failed Tests");
    lines.push("");
    for (const test of failedTests) {
      lines.push(`- **${test.class}.${test.method}**: ${test.error}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

