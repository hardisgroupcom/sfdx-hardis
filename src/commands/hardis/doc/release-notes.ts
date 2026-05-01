/* jscpd:ignore-start */
import { SfCommand, Flags, optionalOrgFlagWithDeprecations } from "@salesforce/sf-plugins-core";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import c from "chalk";
import fs from "fs-extra";
import * as path from "path";
import { t } from "../../../common/utils/i18n.js";
import { uxLog, uxLogTable } from "../../../common/utils/index.js";
import { generatePdfFileFromMarkdown } from "../../../common/utils/markdownUtils.js";
import { WebSocketClient } from "../../../common/websocketClient.js";
import { CONSTANTS, getReportDirectory } from "../../../config/index.js";
import {
  resolveReleaseScope,
  collectPullRequests,
  collectTickets,
  collectMetadataChanges,
  collectDeploymentActions,
  collectContributors,
  generateReleaseSummary,
  buildReleaseNotesMarkdown,
  buildReleaseNotesXlsx,
  sendReleaseNotification,
  getReleaseDate,
  prettifyMetadataType,
  ReleaseNotesData,
} from "../../../common/utils/releaseNotesUtils.js";

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages("sfdx-hardis", "org");

/* jscpd:ignore-end */

export default class ReleaseNotes extends SfCommand<any> {
  public static title = "Release Notes";

  public static description = `Generate release notes for a Salesforce project release.

## Command Behavior

Collects data from multiple sources and generates a comprehensive release notes document:

- **Git Provider** (GitHub, GitLab, Azure DevOps, Bitbucket): merged pull requests, contributors
- **Ticket Provider** (JIRA, Azure Boards): ticket details, status, assignees
- **sfdx-git-delta**: metadata changes (created, updated, deleted)
- **Deployment Actions**: manual tasks and automated actions from PR comments
- **AI Provider** (optional): generates a structured summary of the release

Supports two modes:

- **prepare**: preview what will be included in the upcoming release (finds open PR or computes hypothetical delta)
- **post**: document a completed release (uses merged PRs and tags)

Output includes a **Markdown report** (optionally converted to PDF), a **multi-tab XLSX** with detailed data, and an optional **notification** (Slack, Teams, etc.) for production releases in post mode.

The command can determine the release scope from git tags (semver), branch names, commit ranges, or date ranges.

This command is part of [sfdx-hardis Documentation](${CONSTANTS.DOC_URL_ROOT}/salesforce-project-documentation/).

<details markdown="1">
<summary>Technical explanations</summary>

The command resolves the release scope using one of several strategies:

1. **Tag-based**: uses \`git rev-list\` to find commit SHAs for semver tags, auto-detects the previous tag via \`git tag --sort=-v:refname\`
2. **Branch-based**: uses \`GitProvider.listPullRequestsInBranchSinceLastMerge()\` or \`GitProvider.findOpenPullRequest()\` (prepare mode) with the major orgs configuration
3. **Date-based**: filters PRs by \`minDate\` / max date
4. **Commit-based**: uses explicit commit SHAs

Metadata changes are computed via \`sfdx-git-delta\` (\`sf sgd:source:delta\`), which generates \`package.xml\` (additions) and \`destructiveChanges.xml\` (deletions).

Deployment actions are loaded from PR comments (via the \`<!-- sfdx-hardis deployment-actions-state -->\` marker) or from \`scripts/actions/.sfdx-hardis.{PR_ID}.yml\` files.

Inter-major-branch PRs (e.g., integration to preprod) are excluded since they represent promotions, not user stories.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:doc:release-notes --agent --mode post --target-branch main
\`\`\`

In agent mode:

- All interactive prompts are skipped.
- \`--mode\` defaults to \`post\` when not provided.
- \`--target-branch\` defaults to the current git branch.
`;

  public static examples = [
    "$ sf hardis:doc:release-notes",
    "$ sf hardis:doc:release-notes --mode post --release-tag v1.2.0",
    "$ sf hardis:doc:release-notes --mode prepare --target-branch main",
    "$ sf hardis:doc:release-notes --mode post --target-branch main",
    "$ sf hardis:doc:release-notes --mode post --target-branch main --no-pdf",
    "$ sf hardis:doc:release-notes --mode post --from-date 2026-01-01 --to-date 2026-03-31",
    "$ sf hardis:doc:release-notes --agent --mode post --target-branch main",
  ];

  public static flags: any = {
    mode: Flags.string({
      char: "m",
      options: ["prepare", "post"],
      description: messages.getMessage("releaseNotesMode"),
    }),
    "release-tag": Flags.string({
      description: messages.getMessage("releaseNotesReleaseTag"),
    }),
    "previous-tag": Flags.string({
      description: messages.getMessage("releaseNotesPreviousTag"),
    }),
    "target-branch": Flags.string({
      char: "t",
      description: messages.getMessage("releaseNotesTargetBranch"),
    }),
    "merge-commit": Flags.string({
      description: messages.getMessage("releaseNotesMergeCommit"),
    }),
    "source-commit": Flags.string({
      description: messages.getMessage("releaseNotesSourceCommit"),
    }),
    "from-date": Flags.string({
      description: messages.getMessage("releaseNotesFromDate"),
    }),
    "to-date": Flags.string({
      description: messages.getMessage("releaseNotesToDate"),
    }),
    outputfile: Flags.string({
      char: "f",
      description: messages.getMessage("outputFile"),
    }),
    pdf: Flags.boolean({
      default: true,
      allowNo: true,
      description: "Generate the documentation in PDF format (enabled by default, use --no-pdf to skip)",
    }),
    /* jscpd:ignore-start */
    debug: Flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: Flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: Flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
    agent: Flags.boolean({
      default: false,
      description: "Run in non-interactive mode for agents and automation",
    }),
    "target-org": optionalOrgFlagWithDeprecations,
    /* jscpd:ignore-end */
  };

  public static requiresProject = false;

  protected static triggerNotification = true;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(ReleaseNotes);
    const agentMode = flags.agent === true;
    const outputFile = flags.outputfile || null;
    const withPdf = flags.pdf === true;

    // Validate mutual exclusivity: tags vs dates
    const hasTagFlags = !!(flags["release-tag"] || flags["previous-tag"]);
    const hasDateFlags = !!(flags["from-date"] || flags["to-date"]);
    if (hasTagFlags && hasDateFlags) {
      uxLog("error", this, c.red(t("releaseNotesInvalidFlagCombination")));
      return { success: false } as AnyJson;
    }

    uxLog("action", this, c.cyan(t("releaseNotesGenerating")));

    // 1. Resolve scope
    const scope = await resolveReleaseScope(flags, this, agentMode);
    uxLog("action", this, c.cyan(t("releaseNotesScopeResolved", { mode: scope.mode, branch: scope.targetBranch })));

    // 2. Collect pull requests
    uxLog("action", this, c.cyan(t("releaseNotesCollectingPrs")));
    const pullRequests = await collectPullRequests(scope, this);
    uxLog("action", this, c.cyan(t("releaseNotesPrsCollected", { count: String(pullRequests.length) })));
    // Note: PR table with ticket cross-references is displayed after ticket collection

    // 3. Collect tickets
    uxLog("action", this, c.cyan(t("releaseNotesCollectingTickets")));
    const ticketResult = await collectTickets(pullRequests, this);
    const tickets = ticketResult.tickets;
    const { ticketToPrs, prToTickets } = ticketResult;
    if (tickets.length > 0) {
      uxLogTable(this, tickets.map((tk) => ({
        ID: tk.id,
        Title: tk.subject || "",
        Status: tk.statusLabel || tk.status || "",
        Assignee: tk.assigneeLabel || tk.assignee || "",
        PRs: (ticketToPrs.get(tk.id) || []).map((id) => `#${id}`).join(", "),
      })), ["ID", "Title", "Status", "Assignee", "PRs"]);
    }

    // Display PR table with ticket cross-references
    if (pullRequests.length > 0) {
      uxLogTable(this, pullRequests.map((pr) => ({
        "#": `#${pr.idStr}`,
        Title: pr.title,
        Author: pr.authorName || "",
        Merged: pr.mergedDate ? pr.mergedDate.split("T")[0] : "",
        Tickets: (prToTickets.get(pr.idStr) || []).join(", "),
      })), ["#", "Title", "Author", "Merged", "Tickets"]);
    }

    // Prepare output directory: hardis-report/release-notes/{branch}-{date}/
    const reportDate = await getReleaseDate(scope);
    const version = scope.releaseTag || scope.targetBranch;
    const releaseNotesDir = outputFile
      ? path.dirname(outputFile)
      : path.join(await getReportDirectory(), "release-notes", `${version}-${reportDate}`);
    await fs.ensureDir(releaseNotesDir);

    // 4. Collect metadata changes (copies package.xml / destructiveChanges.xml into output dir)
    uxLog("action", this, c.cyan(t("releaseNotesCollectingMetadata")));
    const metadataChanges = await collectMetadataChanges(scope, this, releaseNotesDir);
    if (metadataChanges.addedCount > 0 || metadataChanges.deletedCount > 0) {
      const metadataRows: any[] = [];
      for (const [mdType, members] of Object.entries(metadataChanges.added)) {
        metadataRows.push({ Type: prettifyMetadataType(mdType), Count: members.length, Change: "Added/Modified" });
      }
      for (const [mdType, members] of Object.entries(metadataChanges.deleted)) {
        metadataRows.push({ Type: prettifyMetadataType(mdType), Count: members.length, Change: "Deleted" });
      }
      uxLogTable(this, metadataRows, ["Type", "Count", "Change"]);
    }

    // 5. Collect deployment actions
    uxLog("action", this, c.cyan(t("releaseNotesCollectingActions")));
    const deploymentActions = await collectDeploymentActions(pullRequests, this);
    if (deploymentActions.length > 0) {
      uxLogTable(this, deploymentActions.map((a) => ({
        Action: a.actionLabel,
        When: a.when,
        Status: a.status,
        PR: (a.prNumber ?? 0) > 0 ? `#${a.prNumber}` : "",
      })), ["Action", "When", "Status", "PR"]);
    }

    // 6. Collect contributors
    const contributors = collectContributors(pullRequests);
    if (contributors.length > 0) {
      uxLogTable(this, contributors.map((c) => ({
        Contributor: c.name,
        PRs: c.prCount,
      })), ["Contributor", "PRs"]);
    }

    // Build data structure
    const data: ReleaseNotesData = {
      scope,
      pullRequests,
      tickets,
      metadataChanges,
      deploymentActions,
      contributors,
      ticketToPrs,
      prToTickets,
    };

    // 7. AI summary (optional)
    data.aiSummary = await generateReleaseSummary(data, this);

    // 8. Build markdown report
    uxLog("action", this, c.cyan(t("releaseNotesGeneratingMarkdown")));
    const markdown = await buildReleaseNotesMarkdown(data, reportDate);

    // Write markdown file into the release notes subfolder
    const mdFileName = `release-notes-${version}-${reportDate}.md`;
    const mdOutputFile = outputFile || path.join(releaseNotesDir, mdFileName);
    await fs.writeFile(mdOutputFile, markdown, "utf8");
    uxLog("success", this, c.green(t("releaseNotesComplete", { outputFile: mdOutputFile })));
    WebSocketClient.sendReportFileMessage(mdOutputFile, t("releaseNotesReportTitle"), "report");

    // 9. Generate PDF (optional)
    let pdfFile: string | undefined;
    if (withPdf) {
      uxLog("action", this, c.cyan(t("releaseNotesGeneratingPdf")));
      // Expand <details> sections for PDF
      const pdfMarkdown = markdown.replace(/<details[^>]*>/g, "").replace(/<\/details>/g, "").replace(/<summary>(.*?)<\/summary>/g, "### $1");
      const pdfSourceFile = mdOutputFile.replace(/\.md$/i, `.pdf-source-${Date.now()}.md`);
      await fs.writeFile(pdfSourceFile, pdfMarkdown, "utf8");
      const pdfResult = await generatePdfFileFromMarkdown(pdfSourceFile);
      if (pdfResult) {
        const defaultPdfFile = mdOutputFile.replace(/\.md$/i, ".pdf");
        try {
          await fs.copy(pdfResult, defaultPdfFile, { overwrite: true });
          if (pdfResult !== defaultPdfFile) {
            await fs.remove(pdfResult);
          }
          pdfFile = defaultPdfFile;
        } catch {
          pdfFile = typeof pdfResult === "string" ? pdfResult : undefined;
        }
        if (pdfFile) {
          WebSocketClient.sendReportFileMessage(pdfFile, `${t("releaseNotesReportTitle")} (PDF)`, "report");
        }
      }
      await fs.remove(pdfSourceFile).catch(() => {});
    }

    // 10. Generate XLSX
    uxLog("action", this, c.cyan(t("releaseNotesGeneratingXlsx")));
    const xlsxFile = await buildReleaseNotesXlsx(data, mdOutputFile, this);

    // 11. Send notification (post mode + production only)
    await sendReleaseNotification(data, pdfFile, xlsxFile, this);

    return {
      scope: {
        mode: scope.mode,
        targetBranch: scope.targetBranch,
        releaseTag: scope.releaseTag,
        previousTag: scope.previousTag,
      },
      counts: {
        pullRequests: pullRequests.length,
        tickets: tickets.length,
        contributors: contributors.length,
        metadataAdded: metadataChanges.addedCount,
        metadataDeleted: metadataChanges.deletedCount,
        deploymentActions: deploymentActions.length,
      },
      outputFile: mdOutputFile,
      pdfFile: pdfFile || null,
      xlsxFile: xlsxFile || null,
    } as AnyJson;
  }
}
