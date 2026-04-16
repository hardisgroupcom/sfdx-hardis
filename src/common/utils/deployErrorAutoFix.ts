import c from "chalk";
import { getCurrentGitBranch, git, uxLog } from "./index.js";
import { CodingAgentProvider } from "../aiProvider/codingAgentProvider.js";
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
    const agentResult = await CodingAgentProvider.runAgentToFixErrors(
      errorsAndTips,
      failedTests,
      options.targetUsername || null,
    );

    if (!agentResult || !agentResult.success || agentResult.fixedFiles.length === 0) {
      uxLog("warning", this, c.yellow(t("codingAgentNoFixesApplied")));
      // Go back to original branch
      await git().checkout(currentBranch);
      // Delete the fix branch
      await git().deleteLocalBranch(fixBranch, true);
      return { success: false };
    }

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

  // Errors section
  lines.push("## Errors Found");
  lines.push("");
  if (errorsAndTips.length > 0) {
    lines.push("### Deployment Errors");
    lines.push("");
    lines.push("| # | Error | Tip |");
    lines.push("|---|-------|-----|");
    let errorNum = 1;
    for (const item of errorsAndTips) {
      const error = (item.error?.message || "Unknown error").replace(/\|/g, "\\|").replace(/\n/g, " ");
      const tip = (item.tip?.message || item.tipFromAi?.promptResponse || "-").replace(/\|/g, "\\|").replace(/\n/g, " ");
      lines.push(`| ${errorNum} | ${error} | ${tip} |`);
      errorNum++;
    }
    lines.push("");
  }

  if (failedTests.length > 0) {
    lines.push("### Failed Tests");
    lines.push("");
    lines.push("| Class | Method | Error |");
    lines.push("|-------|--------|-------|");
    for (const test of failedTests) {
      const error = (test.error || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
      lines.push(`| ${test.class} | ${test.method} | ${error} |`);
    }
    lines.push("");
  }

  // Fixes section
  lines.push("## Fixes Applied");
  lines.push("");
  if (agentResult.fixesDescription) {
    lines.push(agentResult.fixesDescription);
    lines.push("");
  }

  // Modified files
  lines.push("### Modified Files");
  lines.push("");
  for (const file of agentResult.fixedFiles) {
    lines.push(`- \`${file}\``);
  }
  lines.push("");

  lines.push("---");
  lines.push("_Powered by [sfdx-hardis](https://sfdx-hardis.cloudity.com) auto-fix feature_");

  return lines.join("\n");
}
