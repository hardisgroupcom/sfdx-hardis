/* jscpd:ignore-start */
import { SfCommand, Flags, optionalOrgFlagWithDeprecations } from "@salesforce/sf-plugins-core";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import c from "chalk";
import fs from "fs-extra";
import * as path from "path";
import sortArray from "sort-array";
import { t } from "../../../common/utils/i18n.js";
import { getCurrentGitBranch, git, uxLog } from "../../../common/utils/index.js";
import { soqlQueryTooling } from "../../../common/utils/apiUtils.js";
import { CommonPullRequestInfo, GitProvider } from "../../../common/gitProvider/index.js";
import { TicketProvider, Ticket } from "../../../common/ticketProvider/index.js";
import { NotifProvider, NotifSeverity } from "../../../common/notifProvider/index.js";
import { generateCsvFile, generateReportPath } from "../../../common/utils/filesUtils.js";
import { generateMarkdownFileWithMermaid } from "../../../common/utils/mermaidUtils.js";
import { DeployRecord, parseDatetime, minutesBetween } from "../../../common/utils/deployUtils.js";
import { daysBetween } from "../../../common/utils/dateUtils.js";
import {
  DoraInsights,
  DoraMetricResult,
  FailedDeployDetail,
  buildWeekLabels,
  classificationLabel,
  classifyChangeFailureRate,
  classifyDeploymentFrequency,
  classifyLeadTime,
  classifyMttr,
  classifyReworkRate,
  groupByWeek,
} from "../../../common/utils/doraUtils.js";
import { median, percentile, round1 } from "../../../common/utils/statsUtils.js";
import { CONSTANTS } from "../../../config/index.js";
import { prepareOrgNotificationContext } from "../../../common/utils/orgNotificationContext.js";
import { WebSocketClient } from "../../../common/websocketClient.js";

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages("sfdx-hardis", "org");

/* jscpd:ignore-end */

// ===========================================================================
// Command
// ===========================================================================

export default class DoraReport extends SfCommand<any> {
  public static title = "DORA Metrics Report";

  public static description = `Generates a DORA (DevOps Research and Assessment) metrics report for a Salesforce project.

## Command Behavior

Collects data from three sources and computes industry-standard DORA metrics:

- **Tooling API** (DeployRequest): deployment/validation history, duration, success rate
- **Git Provider** (GitHub, GitLab, Azure DevOps, Bitbucket): merged pull requests, lead time, cycle time
- **Ticket Provider** (JIRA, Azure Boards): incident/bug resolution for MTTR enrichment

**Core DORA Metrics (5):**

1. **Deployment Frequency** - how often successful deployments reach the target org
2. **Lead Time for Changes** - time from PR creation to deployment
3. **Change Failure Rate** - percentage of failed deployments
4. **Mean Time to Recovery (MTTR)** - time to restore after a failure
5. **Deployment Rework Rate** - ratio of hotfix/unplanned deployments

**Supplementary Salesforce Metrics (5):**

6. Deployment Duration (metadata transfer time)
7. PR Cycle Time
8. Change Volume
9. Deployment Activity (per team member)
10. Validation Success Rate

Each metric is classified against DORA benchmarks as **Elite**, **High**, **Medium**, or **Low**.

Output includes a **Markdown report** with Mermaid diagrams, a **CSV export** of raw data, and an optional **notification** (Slack, Teams, etc.).

This command is part of [sfdx-hardis Documentation](${CONSTANTS.DOC_URL_ROOT}/salesforce-project-documentation/).

<details markdown="1">
<summary>Technical explanations</summary>

The command queries \`DeployRequest\` records via the Salesforce Tooling API to build deployment metrics.
It uses \`GitProvider.listPullRequests()\` to fetch merged PRs with date filtering, falling back to local \`git log --merges\` when no provider API is available.
Ticket references are extracted from PR titles/descriptions via \`TicketProvider\`, enriched with server data when configured, and used to compute MTTR from bug/incident resolution times.

Mermaid \`xychart-beta\` diagrams visualize deployment frequency trends and lead time, while \`pie\` charts show deployment outcome distribution.

Each data source is optional: the report gracefully degrades when the org, git provider, or ticket provider is unavailable.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:doc:dora-report --agent --target-org myorg@example.com
\`\`\`

In agent mode:

- All interactive prompts are skipped.
- \`--period\` defaults to 90 days when not provided.
`;

  public static examples = [
    "$ sf hardis:doc:dora-report",
    "$ sf hardis:doc:dora-report --target-org myorg@example.com",
    "$ sf hardis:doc:dora-report --period 30",
    "$ sf hardis:doc:dora-report --pdf",
    "$ sf hardis:doc:dora-report --agent --target-org myorg@example.com",
  ];

  public static flags: any = {
    period: Flags.integer({
      char: "p",
      default: 90,
      description: messages.getMessage("doraReportPeriod"),
    }),
    outputfile: Flags.string({
      char: "f",
      description: messages.getMessage("doraReportOutputFile"),
    }),
    pdf: Flags.boolean({
      description: "Also generate the documentation in PDF format",
    }),
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
  };

  public static requiresProject = false;

  protected static triggerNotification = true;

  // -----------------------------------------------------------------------
  // run()
  // -----------------------------------------------------------------------

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DoraReport);
    const periodDays = flags.period ?? 90;
    const debugMode = flags.debug || false;
    const outputFile = flags.outputfile || null;
    const withPdf = flags.pdf === true;

    uxLog("action", this, c.cyan(t("doraReportGenerating", { period: periodDays })));

    // - 1. Collect data from sources -----------------------------------------

    const targetOrg = flags["target-org"] ?? null;
    const conn = targetOrg?.getConnection() ?? null;
    const orgIdentifier = targetOrg?.getUsername?.() || conn?.instanceUrl || "N/A";
    const orgInstanceUrl = conn?.instanceUrl || null;
    const minDate = new Date(Date.now() - periodDays * 86400000);

    // 1a. Deployment data from Tooling API
    let allRecords: DeployRecord[] = [];
    if (conn) {
      uxLog("action", this, c.cyan(t("doraReportFetchingDeployments")));
      allRecords = await this.fetchDeploymentData(conn, periodDays, debugMode);
    } else {
      uxLog("warning", this, c.yellow(t("doraReportNoDeploymentData")));
    }

    const deployments = allRecords.filter((r) => r.Type === "Deployment");
    const validations = allRecords.filter((r) => r.Type === "Validation");

    // 1b. Pull request data from Git Provider (filtered by current branch)
    const currentBranch = await getCurrentGitBranch() || "";
    let pullRequests: CommonPullRequestInfo[] = [];
    uxLog("action", this, c.cyan(t("doraReportFetchingPullRequests")));
    pullRequests = await this.fetchPullRequestData(minDate, currentBranch, debugMode);

    // 1c. Ticket data from PR text
    let tickets: Ticket[] = [];
    if (pullRequests.length > 0) {
      uxLog("action", this, c.cyan(t("doraReportFetchingTickets")));
      tickets = await this.fetchTicketData(pullRequests);
    }

    // - 2. Compute DORA Metrics -----------------------------------------------

    uxLog("action", this, c.cyan(t("doraReportComputingMetrics")));

    const succeededDeploys = deployments.filter((r) => r.Status === "Succeeded");
    const failedDeploys = deployments.filter((r) => r.Status === "Failed");
    const canceledDeploys = deployments.filter((r) => r.Status === "Canceled");

    // 2a. Deployment Frequency
    const deploymentsPerDay = periodDays > 0 ? succeededDeploys.length / periodDays : 0;
    const deploymentsPerWeek = round1(deploymentsPerDay * 7);
    const dfClassification = classifyDeploymentFrequency(deploymentsPerDay);
    const dfMetric: DoraMetricResult = {
      name: t("doraReportDeploymentFrequency"),
      value: t("doraReportPerWeek", { value: deploymentsPerWeek }),
      rawValue: deploymentsPerDay,
      classification: dfClassification,
    };

    // 2b. Lead Time for Changes
    const leadTimeDays = this.computeLeadTimes(pullRequests, deployments);
    const ltMedian = round1(median(leadTimeDays));
    const ltP90 = round1(percentile(leadTimeDays, 90));
    const ltAvg = leadTimeDays.length > 0 ? round1(leadTimeDays.reduce((a, b) => a + b, 0) / leadTimeDays.length) : 0;
    const ltClassification = leadTimeDays.length > 0 ? classifyLeadTime(ltMedian) : { level: "low" as const, emoji: "⚪" };
    const ltMetric: DoraMetricResult = {
      name: t("doraReportLeadTime"),
      value: leadTimeDays.length > 0 ? t("doraReportDays", { value: ltMedian }) + ` (p50)` : t("doraReportNoDataAvailable"),
      rawValue: ltMedian,
      classification: ltClassification,
    };

    // 2c. Change Failure Rate
    const cfr = deployments.length > 0 ? round1((failedDeploys.length / deployments.length) * 100) : 0;
    const cfrClassification = deployments.length > 0 ? classifyChangeFailureRate(cfr) : { level: "low" as const, emoji: "⚪" };
    const cfrMetric: DoraMetricResult = {
      name: t("doraReportChangeFailureRate"),
      value: deployments.length > 0 ? t("doraReportPercent", { value: cfr }) : t("doraReportNoDataAvailable"),
      rawValue: cfr,
      classification: cfrClassification,
    };

    // 2d. Mean Time to Recovery
    const mttrHours = this.computeMttr(deployments, tickets);
    const mttrMedian = round1(median(mttrHours));
    const mttrClassification = mttrHours.length > 0 ? classifyMttr(mttrMedian) : { level: "low" as const, emoji: "⚪" };
    const mttrMetric: DoraMetricResult = {
      name: t("doraReportMttr"),
      value: mttrHours.length > 0 ? t("doraReportHours", { value: mttrMedian }) : t("doraReportNoDataAvailable"),
      rawValue: mttrMedian,
      classification: mttrClassification,
    };

    // 2e. Deployment Rework Rate
    const reworkPct = this.computeReworkRate(deployments, pullRequests);
    const reworkClassification = deployments.length > 0 ? classifyReworkRate(reworkPct) : { level: "low" as const, emoji: "⚪" };
    const reworkMetric: DoraMetricResult = {
      name: t("doraReportReworkRate"),
      value: deployments.length > 0 ? t("doraReportPercent", { value: reworkPct }) : t("doraReportNoDataAvailable"),
      rawValue: reworkPct,
      classification: reworkClassification,
    };

    // - 3. Supplementary Metrics -----------------------------------------------

    // Deployment Duration
    const durationValues = succeededDeploys.filter((r) => r.DurationMinutes > 0).map((r) => r.DurationMinutes);
    const durationMedian = round1(median(durationValues));
    const durationAvg = durationValues.length > 0 ? round1(durationValues.reduce((a, b) => a + b, 0) / durationValues.length) : 0;
    const durationP90 = round1(percentile(durationValues, 90));

    // PR Cycle Time (include 0-day PRs - same-day merges are valid data)
    const prCycleDays = pullRequests
      .map((pr) => daysBetween(parseDatetime(pr.createdDate), parseDatetime(pr.mergedDate)))
      .filter((d) => d >= 0);
    const prCycleMedian = round1(median(prCycleDays));
    const prCycleAvg = prCycleDays.length > 0 ? round1(prCycleDays.reduce((a, b) => a + b, 0) / prCycleDays.length) : 0;
    const prCycleP90 = round1(percentile(prCycleDays, 90));

    // Change Volume
    const prPerWeek = periodDays > 0 ? round1((pullRequests.length / periodDays) * 7) : 0;
    const deployPerWeek = deploymentsPerWeek;

    // Deployment Activity
    const activityMap = new Map<string, { total: number; succeeded: number }>();
    for (const d of deployments) {
      const entry = activityMap.get(d.DeployedBy) || { total: 0, succeeded: 0 };
      entry.total++;
      if (d.Status === "Succeeded") entry.succeeded++;
      activityMap.set(d.DeployedBy, entry);
    }
    const activityRows = [...activityMap.entries()]
      .map(([name, data]) => ({
        deployer: name,
        deployments: data.total,
        successRate: data.total > 0 ? round1((data.succeeded / data.total) * 100) : 0,
      }))
      .sort((a, b) => b.deployments - a.deployments);

    // Validation Success Rate
    const succeededValidations = validations.filter((r) => r.Status === "Succeeded");
    const validationSuccessRate = validations.length > 0 ? round1((succeededValidations.length / validations.length) * 100) : 0;

    // Build week labels (needed by several metrics below)
    const weekLabels = buildWeekLabels(periodDays);
    const deployByWeek = groupByWeek(succeededDeploys);

    // Deployment Pending/Queue Time
    const pendingValues = deployments.filter((r) => r.PendingMinutes > 0).map((r) => r.PendingMinutes);
    const pendingMedian = round1(median(pendingValues));
    const pendingAvg = pendingValues.length > 0 ? round1(pendingValues.reduce((a, b) => a + b, 0) / pendingValues.length) : 0;
    const pendingP90 = round1(percentile(pendingValues, 90));

    // Deployment Success Rate trend (weekly)
    const allDeployByWeek = groupByWeek(deployments);
    const failedByWeek = groupByWeek(failedDeploys);
    const successRateByWeek = weekLabels.map((w: string) => {
      const total = allDeployByWeek.get(w) || 0;
      const failed = failedByWeek.get(w) || 0;
      return total > 0 ? round1(((total - failed) / total) * 100) : -1; // -1 means no data
    });

    // Per-contributor PR stats
    const prByAuthor = new Map<string, { count: number; totalCycleDays: number }>();
    for (const pr of pullRequests) {
      const author = pr.authorName || "Unknown";
      const entry = prByAuthor.get(author) || { count: 0, totalCycleDays: 0 };
      entry.count++;
      const cycle = daysBetween(parseDatetime(pr.createdDate), parseDatetime(pr.mergedDate));
      if (cycle >= 0) entry.totalCycleDays += cycle;
      prByAuthor.set(author, entry);
    }
    const contributorRows = [...prByAuthor.entries()]
      .map(([author, data]) => ({
        author,
        prCount: data.count,
        avgCycleTime: data.count > 0 ? round1(data.totalCycleDays / data.count) : 0,
      }))
      .sort((a, b) => b.prCount - a.prCount);

    // - Collect insights for actionable details --------------------------------

    const insights: DoraInsights = { failedDeploys: [], hotfixPrs: [], slowPrs: [] };

    // Failed deployments with recovery pairing
    const sortedForInsights = [...deployments].sort(
      (a, b) => new Date(a.CompletedDate).getTime() - new Date(b.CompletedDate).getTime(),
    );
    for (let i = 0; i < sortedForInsights.length; i++) {
      if (sortedForInsights[i].Status === "Failed") {
        const detail: FailedDeployDetail = {
          id: sortedForInsights[i].Id,
          date: (sortedForInsights[i].CompletedDate || sortedForInsights[i].CreatedDate).split("T")[0],
          deployedBy: sortedForInsights[i].DeployedBy,
        };
        for (let j = i + 1; j < sortedForInsights.length; j++) {
          if (sortedForInsights[j].Status === "Succeeded") {
            const failedDate = parseDatetime(sortedForInsights[i].CompletedDate);
            const recoveredDate = parseDatetime(sortedForInsights[j].CompletedDate);
            detail.recoveryId = sortedForInsights[j].Id;
            detail.recoveryDate = (sortedForInsights[j].CompletedDate || "").split("T")[0];
            detail.recoveryHours = round1(minutesBetween(failedDate, recoveredDate) / 60);
            break;
          }
        }
        insights.failedDeploys.push(detail);
      }
    }

    // Hotfix PRs
    const hotfixBranchPattern = /^(hotfix|fix|bugfix)[/-]/i;
    for (const pr of pullRequests) {
      if (hotfixBranchPattern.test(pr.sourceBranch)) {
        insights.hotfixPrs.push({
          id: pr.idStr || String(pr.idNumber),
          title: pr.title,
          author: pr.authorName,
          sourceBranch: pr.sourceBranch,
          mergedDate: (pr.mergedDate || "").split("T")[0],
        });
      }
    }

    // Slow PRs (cycle time > 7 days - outliers that drag lead time up)
    for (const pr of pullRequests) {
      const cycle = daysBetween(parseDatetime(pr.createdDate), parseDatetime(pr.mergedDate));
      if (cycle > 7) {
        insights.slowPrs.push({
          id: pr.idStr || String(pr.idNumber),
          title: pr.title,
          author: pr.authorName,
          cycleDays: round1(cycle),
        });
      }
    }
    // Sort slow PRs by cycle time descending
    insights.slowPrs.sort((a, b) => b.cycleDays - a.cycleDays);

    // - 4. Generate Markdown Report -------------------------------------------

    uxLog("action", this, c.cyan(t("doraReportGeneratingMarkdown")));

    const coreMetrics = [dfMetric, ltMetric, cfrMetric, mttrMetric, reworkMetric];

    const md = this.buildMarkdownReport({
      periodDays,
      orgIdentifier,
      orgInstanceUrl,
      currentBranch,
      coreMetrics,
      weekLabels,
      deployByWeek,
      succeededDeploys,
      failedDeploys,
      canceledDeploys,
      deployments,
      validations,
      pullRequests,
      leadTimeDays,
      ltMedian,
      ltP90,
      ltAvg,
      cfr,
      mttrHours,
      mttrMedian,
      reworkPct,
      durationMedian,
      durationAvg,
      durationP90,
      prCycleDays,
      prCycleMedian,
      prCycleAvg,
      prCycleP90,
      prPerWeek,
      deployPerWeek,
      activityRows,
      validationSuccessRate,
      succeededValidations,
      tickets,
      pendingMedian,
      pendingAvg,
      pendingP90,
      successRateByWeek,
      contributorRows,
      insights,
    });

    // Write markdown file
    const reportDate = new Date().toISOString().split("T")[0];
    const defaultMarkdownName = `dora-report-${reportDate}`;
    const isDefaultOutput = outputFile == null || outputFile === "";
    const mdOutputFile = await generateReportPath(defaultMarkdownName, outputFile || "", {
      fileExtension: "md",
      withBranchName: false,
    });
    await fs.writeFile(mdOutputFile, md, "utf8");
    uxLog("success", this, c.green(t("doraReportComplete", { outputFile: mdOutputFile })));

    // Generate PDF from markdown when requested.
    let pdfOutputFile: string | null = null;
    if (withPdf) {
      const pdfMarkdown = this.expandDetailsSectionsForPdf(md);
      const pdfSourceFile = mdOutputFile.replace(/\.md$/i, `.pdf-source-${Date.now()}.md`);
      await fs.writeFile(pdfSourceFile, pdfMarkdown, "utf8");
      const pdfGenerationOk = await generateMarkdownFileWithMermaid(pdfSourceFile, pdfSourceFile, null, true);
      if (!pdfGenerationOk) {
        await fs.remove(pdfSourceFile);
        throw new Error("Error generating PDF report from markdown");
      }
      const generatedPdfSourceFile = pdfSourceFile.replace(/\.md$/i, ".pdf");
      const defaultPdfOutputFile = mdOutputFile.replace(/\.md$/i, ".pdf");
      try {
        await fs.copy(generatedPdfSourceFile, defaultPdfOutputFile, { overwrite: true });
        await fs.remove(generatedPdfSourceFile);
        pdfOutputFile = defaultPdfOutputFile;
      } catch {
        // Keep uniquely generated file if default output is locked by another process.
        pdfOutputFile = generatedPdfSourceFile;
      }
      await fs.remove(pdfSourceFile);
      WebSocketClient.sendReportFileMessage(
        pdfOutputFile,
        `${t("doraReportTitle")} (PDF)`,
        "report",
      );
    }

    // Copy default markdown output to docs/dora
    let docsDoraOutputFile: string | null = null;
    if (isDefaultOutput) {
      const docsDoraDir = path.join(process.cwd(), "docs", "dora");
      await fs.ensureDir(docsDoraDir);
      docsDoraOutputFile = path.join(docsDoraDir, path.basename(mdOutputFile));
      await fs.copy(mdOutputFile, docsDoraOutputFile, { overwrite: true });
      uxLog("log", this, c.grey(`[DORA] ${t("copied")} ${docsDoraOutputFile}`));
    }

    // Notify once: if default output is cloned to docs/dora, notify only with cloned file.
    WebSocketClient.sendReportFileMessage(
      docsDoraOutputFile || mdOutputFile,
      t("doraReportTitle"),
      "report",
    );


    // - 5. Generate CSV -------------------------------------------------------

    uxLog("action", this, c.cyan(t("doraReportGeneratingCsv")));
    const csvData = allRecords.map((r) => ({ ...r }));
    const csvPath = await generateReportPath("dora-report-data", "", { fileExtension: "csv" });
    const csvResult = await generateCsvFile(csvData, csvPath, {
      fileTitle: "DORA Report - Deployment Data",
    });

    // - 6. Notification -------------------------------------------------------

    uxLog("action", this, c.cyan(t("doraReportSendingNotification")));
    await this.sendNotification(flags, periodDays, coreMetrics, csvResult);

    return {
      metrics: {
        deploymentFrequency: { perDay: round1(deploymentsPerDay), perWeek: deploymentsPerWeek, classification: dfClassification.level },
        leadTime: { medianDays: ltMedian, p90Days: ltP90, avgDays: ltAvg, classification: ltClassification.level },
        changeFailureRate: { percent: cfr, classification: cfrClassification.level },
        mttr: { medianHours: mttrMedian, classification: mttrClassification.level },
        reworkRate: { percent: reworkPct, classification: reworkClassification.level },
      },
      supplementary: {
        deploymentDuration: { medianMin: durationMedian, avgMin: durationAvg, p90Min: durationP90 },
        prCycleTime: { medianDays: prCycleMedian, avgDays: prCycleAvg, p90Days: prCycleP90 },
        changeVolume: { prsPerWeek: prPerWeek, deploymentsPerWeek: deployPerWeek },
        validationSuccessRate,
      },
      counts: {
        deployments: deployments.length,
        validations: validations.length,
        pullRequests: pullRequests.length,
        tickets: tickets.length,
      },
      outputFile: mdOutputFile,
      docsOutputFile: docsDoraOutputFile,
      pdfFile: pdfOutputFile,
      csvFile: csvPath,
    } as AnyJson;
  }

  // -----------------------------------------------------------------------
  // Data collection
  // -----------------------------------------------------------------------

  private async fetchDeploymentData(conn: any, periodDays: number, debugMode: boolean): Promise<DeployRecord[]> {
    const dateFilter = ` AND CreatedDate = LAST_N_DAYS:${periodDays}`;
    const query = `SELECT Status, StartDate, CreatedBy.Name, CreatedDate, CompletedDate, CheckOnly, Id FROM DeployRequest WHERE Status != 'InProgress'${dateFilter} ORDER BY CompletedDate DESC NULLS LAST`;

    if (debugMode) {
      uxLog("log", this, c.grey(`[DORA] SOQL: ${query}`));
    }

    let res: any;
    try {
      res = await soqlQueryTooling(query, conn);
    } catch (e: any) {
      uxLog("warning", this, c.yellow(t("failedToQueryDeployRequest", { message: e?.message || e })));
      return [];
    }

    const records = res?.records || [];
    const result: DeployRecord[] = [];

    for (const rec of records) {
      const createdDate = parseDatetime(rec.CreatedDate);
      const startDate = parseDatetime(rec.StartDate);
      const completedDate = parseDatetime(rec.CompletedDate);
      const pendingMinutes = minutesBetween(createdDate, startDate);
      const durationMinutes = minutesBetween(startDate, completedDate);
      const deployedBy = rec.CreatedBy?.Name ?? rec.CreatedById ?? "Unknown";

      result.push({
        Type: rec.CheckOnly === true ? "Validation" : "Deployment",
        Status: rec.Status || "Unknown",
        DeployedBy: deployedBy,
        CreatedDate: rec.CreatedDate || "",
        StartDate: rec.StartDate || "",
        CompletedDate: rec.CompletedDate || "",
        PendingMinutes: Math.round(pendingMinutes * 10) / 10,
        DurationMinutes: Math.round(durationMinutes * 10) / 10,
        Id: rec.Id || "",
      });
    }

    return sortArray(result, { by: ["CompletedDate", "CreatedDate"], order: ["desc", "desc"] }) as DeployRecord[];
  }

  private async fetchPullRequestData(minDate: Date, currentBranch: string, debugMode: boolean): Promise<CommonPullRequestInfo[]> {
    try {
      const gitProvider = await GitProvider.getInstance();
      if (gitProvider) {
        // Filter PRs targeting the current branch when possible
        const filters: any = { status: "merged", minDate };
        if (currentBranch) {
          filters.targetBranch = currentBranch;
        }
        const rawPrs = await gitProvider.listPullRequests(filters);
        if (rawPrs && Array.isArray(rawPrs) && rawPrs.length > 0) {
          uxLog("log", this, c.grey(`[DORA] ${t("doraReportPrCountFromProvider", { count: rawPrs.length })}`));
          return rawPrs;
        }
      }
    } catch (e: any) {
      uxLog("warning", this, c.yellow(`[DORA] ${t("doraReportGitProviderError", { message: e?.message || e })}`));
    }

    // Fallback: local git log
    return this.fetchPullRequestsFromGitLog(minDate, debugMode);
  }

  private async fetchPullRequestsFromGitLog(minDate: Date, debugMode: boolean): Promise<CommonPullRequestInfo[]> {
    try {
      uxLog("log", this, c.grey(t("doraReportGitLogFallback")));
      const logResult = await git().log(["--merges", `--after=${minDate.toISOString()}`]);
      const prs: CommonPullRequestInfo[] = [];

      for (const commit of logResult.all) {
        // Try to parse PR number from merge commit message
        // GitHub: "Merge pull request #123 from org/branch"
        // GitLab: "Merge branch 'feature' into 'main'"
        const ghMatch = commit.message.match(/Merge pull request #(\d+) from (.+)/);
        const glMatch = commit.message.match(/Merge branch '([^']+)' into '([^']+)'/);

        const basePr = {
          description: "",
          customBehaviors: {} as CommonPullRequestInfo["customBehaviors"],
          providerInfo: null,
        };

        if (ghMatch) {
          prs.push({
            ...basePr,
            idNumber: parseInt(ghMatch[1], 10),
            idStr: ghMatch[1],
            title: commit.message,
            authorName: commit.author_name || "",
            sourceBranch: ghMatch[2],
            targetBranch: "",
            createdDate: commit.date,
            mergedDate: commit.date,
            webUrl: "",
          });
        } else if (glMatch) {
          prs.push({
            ...basePr,
            idNumber: 0,
            idStr: commit.hash.substring(0, 8),
            title: commit.message,
            authorName: commit.author_name || "",
            sourceBranch: glMatch[1],
            targetBranch: glMatch[2],
            createdDate: commit.date,
            mergedDate: commit.date,
            webUrl: "",
          });
        } else if (commit.message.toLowerCase().includes("merge")) {
          prs.push({
            ...basePr,
            idNumber: 0,
            idStr: commit.hash.substring(0, 8),
            title: commit.message,
            authorName: commit.author_name || "",
            sourceBranch: "",
            targetBranch: "",
            createdDate: commit.date,
            mergedDate: commit.date,
            webUrl: "",
          });
        }
      }
      if (debugMode) {
        uxLog("log", this, c.grey(`[DORA] Found ${prs.length} merge commits from git log`));
      }
      return prs;
    } catch (_e: any) {
      uxLog("warning", this, c.yellow(`[DORA] ${t("doraReportNoGitProvider")}`));
      return [];
    }
  }

  private async fetchTicketData(pullRequests: CommonPullRequestInfo[]): Promise<Ticket[]> {
    try {
      const allText = pullRequests.map((pr) => `${pr.title} ${pr.sourceBranch}`).join("\n");
      const tickets = await TicketProvider.getProvidersTicketsFromString(allText, {});
      if (tickets.length > 0) {
        await TicketProvider.collectTicketsInfo(tickets);
      }
      return tickets;
    } catch (_e: any) {
      uxLog("log", this, c.grey(`[DORA] ${t("doraReportNoTicketProvider")}`));
      return [];
    }
  }

  // -----------------------------------------------------------------------
  // Metric computations
  // -----------------------------------------------------------------------

  private computeLeadTimes(pullRequests: CommonPullRequestInfo[], deployments: DeployRecord[]): number[] {
    if (pullRequests.length === 0) return [];

    // If we have deployments, try to correlate PRs to deployments.
    // Cap the matching window: a deployment must happen within 14 days of PR merge
    // to be considered related. Otherwise fall back to PR cycle time (create-to-merge).
    const MAX_DEPLOY_GAP_MS = 14 * 86400000; // 14 days

    const succeededDeploys = deployments
      .filter((d) => d.Status === "Succeeded")
      .sort((a, b) => new Date(a.CompletedDate).getTime() - new Date(b.CompletedDate).getTime());

    const leadTimes: number[] = [];

    for (const pr of pullRequests) {
      const prMergedDate = parseDatetime(pr.mergedDate);
      const prCreatedDate = parseDatetime(pr.createdDate);
      if (!prMergedDate || !prCreatedDate) continue;

      // Try to find a deployment within the matching window after PR merge
      let matched = false;
      if (succeededDeploys.length > 0) {
        const matchingDeploy = succeededDeploys.find((d) => {
          const deployDate = parseDatetime(d.CompletedDate);
          if (!deployDate) return false;
          const gap = deployDate.getTime() - prMergedDate.getTime();
          return gap >= 0 && gap <= MAX_DEPLOY_GAP_MS;
        });

        if (matchingDeploy) {
          const deployDate = parseDatetime(matchingDeploy.CompletedDate)!;
          const lt = daysBetween(prCreatedDate, deployDate);
          if (lt >= 0) leadTimes.push(lt);
          matched = true;
        }
      }

      // Fallback: use PR cycle time (creation to merge) as lead time approximation
      if (!matched) {
        const lt = daysBetween(prCreatedDate, prMergedDate);
        if (lt >= 0) leadTimes.push(lt);
      }
    }

    return leadTimes;
  }

  private computeMttr(deployments: DeployRecord[], tickets: Ticket[]): number[] {
    // Try ticket-based MTTR first (bug/incident resolution)
    // Not enough structured data from tickets to compute resolution time
    // consistently across providers, so use deployment-based MTTR

    // Deployment-based MTTR: time from failed deployment to next succeeded
    const sorted = [...deployments].sort(
      (a, b) => new Date(a.CompletedDate).getTime() - new Date(b.CompletedDate).getTime(),
    );

    const recoveryTimes: number[] = [];
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].Status === "Failed") {
        const failedDate = parseDatetime(sorted[i].CompletedDate);
        // Find next succeeded deployment
        for (let j = i + 1; j < sorted.length; j++) {
          if (sorted[j].Status === "Succeeded") {
            const recoveredDate = parseDatetime(sorted[j].CompletedDate);
            const hours = minutesBetween(failedDate, recoveredDate) / 60;
            if (hours > 0) recoveryTimes.push(hours);
            break;
          }
        }
      }
    }

    // If tickets with status info are available, note them but don't override
    if (tickets.length > 0) {
      const bugTickets = tickets.filter((t) => t.foundOnServer && t.status);
      if (bugTickets.length > 0) {
        uxLog("log", this, c.grey(`[DORA] Found ${bugTickets.length} enriched ticket(s) for MTTR context`));
      }
    }

    return recoveryTimes;
  }

  private computeReworkRate(deployments: DeployRecord[], pullRequests: CommonPullRequestInfo[]): number {
    if (deployments.length === 0) return 0;

    // Count PRs from hotfix/fix branches
    const hotfixBranchPattern = /^(hotfix|fix|bugfix)[/-]/i;
    const hotfixPrCount = pullRequests.filter((pr) => hotfixBranchPattern.test(pr.sourceBranch)).length;

    // Count deployments that immediately follow a failed deployment (within 24h)
    const sorted = [...deployments].sort(
      (a, b) => new Date(a.CompletedDate).getTime() - new Date(b.CompletedDate).getTime(),
    );
    let quickFixCount = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].Status === "Succeeded" && sorted[i - 1].Status === "Failed") {
        const gap = minutesBetween(
          parseDatetime(sorted[i - 1].CompletedDate),
          parseDatetime(sorted[i].CompletedDate),
        );
        if (gap > 0 && gap <= 1440) {
          // within 24h
          quickFixCount++;
        }
      }
    }

    const reworkCount = Math.max(hotfixPrCount, quickFixCount);
    return round1((reworkCount / deployments.length) * 100);
  }

  // -----------------------------------------------------------------------
  // Markdown report builder
  // -----------------------------------------------------------------------

  private buildMarkdownReport(data: any): string {
    const {
      periodDays,
      orgIdentifier,
      orgInstanceUrl,
      currentBranch,
      coreMetrics,
      weekLabels,
      deployByWeek,
      succeededDeploys,
      failedDeploys,
      canceledDeploys,
      deployments,
      validations,
      pullRequests,
      leadTimeDays,
      ltMedian,
      ltP90,
      ltAvg,
      cfr,
      mttrHours,
      mttrMedian,
      reworkPct,
      durationMedian,
      durationAvg,
      durationP90,
      prCycleDays,
      prCycleMedian,
      prCycleAvg,
      prCycleP90,
      prPerWeek,
      deployPerWeek,
      activityRows,
      validationSuccessRate,
      succeededValidations,
      tickets,
      pendingMedian,
      pendingAvg,
      pendingP90,
      successRateByWeek,
      contributorRows,
      insights,
    } = data;

    const lines: string[] = [];
    const now = new Date().toISOString().split("T")[0];
    const orgAlias = orgIdentifier || "N/A";

    lines.push(`# ${t("doraReportTitle")}`);
    lines.push("");
    const branchLabel = currentBranch ? ` | **Branch**: ${currentBranch}` : "";
    lines.push(`**${t("doraReportPeriodLabel")}**: Last ${periodDays} days | **${t("doraReportOrg")}**: ${orgAlias}${branchLabel} | **${t("doraReportGenerated")}**: ${now}`);
    lines.push("");
    lines.push("---");
    lines.push("");

    // Intro
    lines.push(`> ${t("doraReportIntro")} [DORA](https://dora.dev/guides/dora-metrics/)`);
    lines.push("");

    // Executive Summary
    lines.push(`## ${t("doraReportExecutiveSummary")}`);
    lines.push("");
    lines.push(`| ${t("doraReportMetric")} | ${t("doraReportValue")} | ${t("doraReportClassification")} |`);
    lines.push("|--------|-------|----------------|");
    for (const m of coreMetrics as DoraMetricResult[]) {
      lines.push(`| ${m.name} | ${m.value} | ${m.classification.emoji} ${classificationLabel(m.classification)} |`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");

    // Deployment Frequency
    lines.push(`## ${t("doraReportDeploymentFrequency")}`);
    lines.push("");
    lines.push(`_${t("doraReportExplainDf")}_`);
    lines.push("");
    const weekValues = weekLabels.map((w: string) => deployByWeek.get(w) || 0);
    const maxDeploys = Math.max(...weekValues, 1);
    const compactWeekLabels = this.buildCompactWeekAxisLabels(weekLabels);
    if (weekLabels.length > 0 && succeededDeploys.length > 0) {
      lines.push("```mermaid");
      lines.push("xychart-beta");
      lines.push(`  title "${t("doraReportDeploymentsPerWeek")}"`);
      lines.push(`  x-axis [${compactWeekLabels.join(", ")}]`);
      lines.push(`  y-axis "${t("doraReportDeployments")}" 0 --> ${maxDeploys + 2}`);
      lines.push(`  bar [${weekValues.join(", ")}]`);
      lines.push("```");
      lines.push("");
    }
    const valByWeek = groupByWeek(validations);
    const allDeployByWeekForTable = groupByWeek(deployments);
    // Only show weeks that have at least one deployment or validation
    const activeWeeks = weekLabels.filter((w: string) =>
      (allDeployByWeekForTable.get(w) || 0) > 0 || (valByWeek.get(w) || 0) > 0,
    );
    if (activeWeeks.length > 0) {
      lines.push(`| ${t("doraReportPeriodLabel")} | ${t("doraReportDeployments")} | ${t("doraReportValidations")} |`);
      lines.push("|--------|-------------|-------------|");
      for (const w of activeWeeks) {
        const depCount = deployByWeek.get(w) || 0;
        const valCount = valByWeek.get(w) || 0;
        lines.push(`| ${w} | ${depCount} | ${valCount} |`);
      }
    }
    lines.push("");
    lines.push("---");
    lines.push("");

    // Lead Time
    lines.push(`## ${t("doraReportLeadTime")}`);
    lines.push("");
    lines.push(`_${t("doraReportExplainLt")}_`);
    lines.push("");
    if (leadTimeDays.length > 0) {
      lines.push(`| ${t("doraReportMedian")} | ${t("doraReportP90")} | ${t("doraReportAverage")} |`);
      lines.push("|--------|------|---------|");
      lines.push(`| ${ltMedian} ${t("doraReportDaysUnit")} | ${ltP90} ${t("doraReportDaysUnit")} | ${ltAvg} ${t("doraReportDaysUnit")} |`);
      lines.push("");

      // Lead time trend by week
      const prByWeek = new Map<string, number[]>();
      for (const pr of pullRequests as CommonPullRequestInfo[]) {
        const d = parseDatetime(pr.mergedDate);
        if (!d) continue;
        const year = d.getFullYear();
        const jan1 = new Date(year, 0, 1);
        const dayOfYear = Math.floor((d.getTime() - jan1.getTime()) / 86400000) + 1;
        const weekNum = Math.ceil(dayOfYear / 7);
        const key = `${year}-W${String(weekNum).padStart(2, "0")}`;
        const lt = daysBetween(parseDatetime(pr.createdDate), d);
        if (lt > 0) {
          const arr = prByWeek.get(key) || [];
          arr.push(lt);
          prByWeek.set(key, arr);
        }
      }
      const ltWeekValues = weekLabels.map((w: string) => {
        const vals = prByWeek.get(w);
        return vals && vals.length > 0 ? round1(median(vals)) : 0;
      });
      const maxLt = Math.max(...ltWeekValues, 1);
      const ltShortLabels = this.buildCompactWeekAxisLabels(weekLabels);
      lines.push("```mermaid");
      lines.push("xychart-beta");
      lines.push(`  title "${t("doraReportLeadTimeTrend")}"`);
      lines.push(`  x-axis [${ltShortLabels.join(", ")}]`);
      lines.push(`  y-axis "${t("doraReportDaysUnit")}" 0 --> ${Math.ceil(maxLt) + 1}`);
      lines.push(`  line [${ltWeekValues.join(", ")}]`);
      lines.push("```");

      // Slow PRs details when lead time is concerning
      const insightsTyped = insights as DoraInsights;
      if (insightsTyped.slowPrs.length > 0) {
        lines.push("");
        lines.push(`<details><summary>${t("doraReportSlowPrDetails", { count: insightsTyped.slowPrs.length })}</summary>`);
        lines.push("");
        lines.push(`| ${t("doraReportPrId")} | ${t("doraReportAuthor")} | ${t("doraReportPrCycleTime")} |`);
        lines.push("|----|--------|----------------|");
        const prUrlById = this.buildPullRequestUrlMap(pullRequests as CommonPullRequestInfo[]);
        for (const sp of insightsTyped.slowPrs.slice(0, 10)) {
          const prLabel = `#${sp.id}`;
          const prLink = this.formatMarkdownLink(prLabel, prUrlById.get(sp.id));
          lines.push(`| ${prLink} | ${sp.author} | ${sp.cycleDays} ${t("doraReportDaysUnit")} |`);
        }
        lines.push("");
        if (ltP90 > 7) {
          lines.push(`**${t("doraReportAdvice")}:**`);
          lines.push("");
          lines.push(t("doraReportAdviceLeadTime"));
          lines.push("");
        }
        lines.push("</details>");
      }
    } else {
      lines.push(t("doraReportNoDataAvailable"));
    }
    lines.push("");
    lines.push("---");
    lines.push("");

    // Change Failure Rate
    lines.push(`## ${t("doraReportChangeFailureRate")}`);
    lines.push("");
    lines.push(`_${t("doraReportExplainCfr")}_`);
    lines.push("");
    if (deployments.length > 0) {
      lines.push("```mermaid");
      lines.push(`pie title "${t("doraReportDeploymentOutcomes")}"`);
      if (succeededDeploys.length > 0) lines.push(`  "${t("doraReportSucceeded")}" : ${succeededDeploys.length}`);
      if (failedDeploys.length > 0) lines.push(`  "${t("doraReportFailed")}" : ${failedDeploys.length}`);
      if (canceledDeploys.length > 0) lines.push(`  "${t("doraReportCanceled")}" : ${canceledDeploys.length}`);
      lines.push("```");
      lines.push("");
      lines.push(`**${t("doraReportChangeFailureRate")}**: ${cfr}%`);
      lines.push("");

      // Details on failures when CFR is concerning
      const insightsTyped = insights as DoraInsights;
      if (insightsTyped.failedDeploys.length > 0) {
        lines.push(`<details><summary>${t("doraReportFailedDeployDetails", { count: insightsTyped.failedDeploys.length })}</summary>`);
        lines.push("");
        lines.push(`| ${t("doraReportDate")} | ${t("doraReportDeployedBy")} | ID | ${t("doraReportRecoveredIn")} |`);
        lines.push("|------|-------------|----|--------------------|");
        for (const fd of insightsTyped.failedDeploys) {
          const recoveryText = fd.recoveryHours != null
            ? `${fd.recoveryHours} ${t("doraReportHoursUnit")}`
            : t("doraReportNoRecovery");
          const deployLink = this.formatMarkdownLink(fd.id, this.buildDeploymentUrl(orgInstanceUrl, fd.id));
          lines.push(`| ${fd.date} | ${fd.deployedBy} | ${deployLink} | ${recoveryText} |`);
        }
        lines.push("");
        if (cfr > 10) {
          lines.push(`**${t("doraReportAdvice")}:**`);
          lines.push("");
          lines.push(t("doraReportAdviceCfr"));
        }
        lines.push("");
        lines.push("</details>");
        lines.push("");
      }

      // Success Rate Trend (weekly)
      const rateValues = (successRateByWeek as number[]).map((v: number) => (v >= 0 ? v : 0));
      const hasRateData = rateValues.some((v: number) => v > 0);
      if (hasRateData) {
        const rateLabels = this.buildCompactWeekAxisLabels(weekLabels);
        lines.push("```mermaid");
        lines.push("xychart-beta");
        lines.push(`  title "${t("doraReportSuccessRateTrend")}"`);
        lines.push(`  x-axis [${rateLabels.join(", ")}]`);
        lines.push(`  y-axis "%" 0 --> 100`);
        lines.push(`  line [${rateValues.join(", ")}]`);
        lines.push("```");
      }
    } else {
      lines.push(t("doraReportNoDataAvailable"));
    }
    lines.push("");
    lines.push("---");
    lines.push("");

    // MTTR
    lines.push(`## ${t("doraReportMttr")}`);
    lines.push("");
    lines.push(`_${t("doraReportExplainMttr")}_`);
    lines.push("");
    if (mttrHours.length > 0) {
      const mttrAvg = round1(mttrHours.reduce((a: number, b: number) => a + b, 0) / mttrHours.length);
      lines.push(`| ${t("doraReportMedian")} | ${t("doraReportAverage")} | ${t("doraReportRecoveryEvents")} |`);
      lines.push("|--------|---------|------------------|");
      lines.push(`| ${mttrMedian} ${t("doraReportHoursUnit")} | ${mttrAvg} ${t("doraReportHoursUnit")} | ${mttrHours.length} |`);
      lines.push("");

      // Recovery timeline details
      const insightsTyped = insights as DoraInsights;
      const recoveredDeploys = insightsTyped.failedDeploys.filter((fd) => fd.recoveryHours != null);
      if (recoveredDeploys.length > 0) {
        lines.push(`<details><summary>${t("doraReportRecoveryTimeline", { count: recoveredDeploys.length })}</summary>`);
        lines.push("");
        lines.push(`| ${t("doraReportFailed")} | ${t("doraReportDeployedBy")} | ${t("doraReportRecoveredIn")} |`);
        lines.push("|--------|-------------|-------------------|");
        for (const fd of recoveredDeploys) {
          lines.push(`| ${fd.date} | ${fd.deployedBy} | ${fd.recoveryHours} ${t("doraReportHoursUnit")} |`);
        }
        lines.push("");
        if (mttrMedian > 24) {
          lines.push(`**${t("doraReportAdvice")}:**`);
          lines.push("");
          lines.push(t("doraReportAdviceMttr"));
          lines.push("");
        }
        lines.push("</details>");
        lines.push("");
      }
    } else {
      lines.push(t("doraReportNoDataAvailable"));
    }
    lines.push("");
    lines.push("---");
    lines.push("");

    // Rework Rate
    lines.push(`## ${t("doraReportReworkRate")}`);
    lines.push("");
    lines.push(`_${t("doraReportExplainRework")}_`);
    lines.push("");
    if (deployments.length > 0) {
      lines.push(`**${t("doraReportReworkRate")}**: ${reworkPct}%`);
      lines.push("");

      const insightsTyped = insights as DoraInsights;
      if (insightsTyped.hotfixPrs.length > 0) {
        lines.push(`<details><summary>${t("doraReportHotfixPrDetails", { count: insightsTyped.hotfixPrs.length })}</summary>`);
        lines.push("");
        lines.push(`| ${t("doraReportPrId")} | ${t("doraReportAuthor")} | Branch | ${t("doraReportMerged")} |`);
        lines.push("|----|--------|--------|---------|");
        const prUrlById = this.buildPullRequestUrlMap(pullRequests as CommonPullRequestInfo[]);
        for (const hf of insightsTyped.hotfixPrs.slice(0, 20)) {
          const prLabel = `#${hf.id}`;
          const prLink = this.formatMarkdownLink(prLabel, prUrlById.get(hf.id));
          lines.push(`| ${prLink} | ${hf.author} | ${hf.sourceBranch} | ${hf.mergedDate} |`);
        }
        lines.push("");
        if (reworkPct > 10) {
          lines.push(`**${t("doraReportAdvice")}:**`);
          lines.push("");
          lines.push(t("doraReportAdviceRework"));
          lines.push("");
        }
        lines.push("</details>");
        lines.push("");
      }
    } else {
      lines.push(t("doraReportNoDataAvailable"));
    }
    lines.push("");
    lines.push("---");
    lines.push("");

    // Supplementary Metrics
    lines.push(`## ${t("doraReportSupplementaryMetrics")}`);
    lines.push("");

    // Deployment Duration
    lines.push(`### ${t("doraReportDeploymentDuration")}`);
    lines.push("");
    if (durationMedian > 0) {
      lines.push(`| ${t("doraReportMedian")} | ${t("doraReportP90")} | ${t("doraReportAverage")} |`);
      lines.push("|--------|------|---------|");
      lines.push(`| ${durationMedian} ${t("doraReportMinutesUnit")} | ${durationP90} ${t("doraReportMinutesUnit")} | ${durationAvg} ${t("doraReportMinutesUnit")} |`);
    } else {
      lines.push(t("doraReportNoDataAvailable"));
    }
    lines.push("");

    // PR Cycle Time
    lines.push(`### ${t("doraReportPrCycleTime")}`);
    lines.push("");
    if (prCycleDays.length > 0) {
      lines.push(`| ${t("doraReportMedian")} | ${t("doraReportP90")} | ${t("doraReportAverage")} |`);
      lines.push("|--------|------|---------|");
      lines.push(`| ${prCycleMedian} ${t("doraReportDaysUnit")} | ${prCycleP90} ${t("doraReportDaysUnit")} | ${prCycleAvg} ${t("doraReportDaysUnit")} |`);
    } else {
      lines.push(t("doraReportNoDataAvailable"));
    }
    lines.push("");

    // Change Volume
    lines.push(`### ${t("doraReportChangeVolume")}`);
    lines.push("");
    lines.push(`| ${t("doraReportPullRequests")} | ${t("doraReportDeployments")} |`);
    lines.push("|----------------|-------------|");
    lines.push(`| ${prPerWeek} ${t("doraReportPerWeekUnit")} | ${deployPerWeek} ${t("doraReportPerWeekUnit")} |`);
    lines.push("");

    // Deployment Activity
    lines.push(`### ${t("doraReportDeploymentActivity")}`);
    lines.push("");
    if (activityRows.length > 0) {
      lines.push(`| ${t("doraReportDeployer")} | ${t("doraReportDeployments")} | ${t("doraReportSuccessRate")} |`);
      lines.push("|----------|-------------|--------------|");
      for (const row of activityRows) {
        lines.push(`| ${row.deployer} | ${row.deployments} | ${row.successRate}% |`);
      }
    } else {
      lines.push(t("doraReportNoDataAvailable"));
    }
    lines.push("");

    // Deployment Pending/Queue Time
    lines.push(`### ${t("doraReportPendingTime")}`);
    lines.push("");
    if (pendingMedian > 0 || pendingAvg > 0) {
      lines.push(`| ${t("doraReportMedian")} | ${t("doraReportP90")} | ${t("doraReportAverage")} |`);
      lines.push("|--------|------|---------|");
      lines.push(`| ${pendingMedian} ${t("doraReportMinutesUnit")} | ${pendingP90} ${t("doraReportMinutesUnit")} | ${pendingAvg} ${t("doraReportMinutesUnit")} |`);
    } else {
      lines.push(t("doraReportNoDataAvailable"));
    }
    lines.push("");

    // Contributor Stats
    lines.push(`### ${t("doraReportContributorStats")}`);
    lines.push("");
    if ((contributorRows as any[]).length > 0) {
      lines.push(`| ${t("doraReportAuthor")} | ${t("doraReportPullRequests")} | ${t("doraReportAvgCycleTime")} |`);
      lines.push("|--------|----------------|-----------------|");
      for (const row of contributorRows as any[]) {
        lines.push(`| ${row.author} | ${row.prCount} | ${row.avgCycleTime} ${t("doraReportDaysUnit")} |`);
      }
    } else {
      lines.push(t("doraReportNoDataAvailable"));
    }
    lines.push("");

    // Validation Metrics
    lines.push(`### ${t("doraReportValidationMetrics")}`);
    lines.push("");
    if (validations.length > 0) {
      lines.push(`**${t("doraReportSuccessRate")}**: ${validationSuccessRate}% (${succeededValidations.length}/${validations.length})`);
    } else {
      lines.push(t("doraReportNoDataAvailable"));
    }
    lines.push("");
    lines.push("---");
    lines.push("");

    // DORA Benchmarks Reference
    lines.push(`## ${t("doraReportBenchmarks")}`);
    lines.push("");
    lines.push(`| ${t("doraReportMetric")} | ${t("doraReportElite")} | ${t("doraReportHigh")} | ${t("doraReportMedium")} | ${t("doraReportLow")} |`);
    lines.push("|--------|-------|------|--------|-----|");
    lines.push(`| ${t("doraReportDeploymentFrequency")} | ${t("doraReportBenchDfElite")} | ${t("doraReportBenchDfHigh")} | ${t("doraReportBenchDfMedium")} | ${t("doraReportBenchDfLow")} |`);
    lines.push(`| ${t("doraReportLeadTime")} | ${t("doraReportBenchLtElite")} | ${t("doraReportBenchLtHigh")} | ${t("doraReportBenchLtMedium")} | ${t("doraReportBenchLtLow")} |`);
    lines.push(`| ${t("doraReportChangeFailureRate")} | ${t("doraReportBenchCfrElite")} | ${t("doraReportBenchCfrHigh")} | ${t("doraReportBenchCfrMedium")} | ${t("doraReportBenchCfrLow")} |`);
    lines.push(`| ${t("doraReportMttr")} | ${t("doraReportBenchMttrElite")} | ${t("doraReportBenchMttrHigh")} | ${t("doraReportBenchMttrMedium")} | ${t("doraReportBenchMttrLow")} |`);
    lines.push("");
    lines.push("---");
    lines.push("");

    // Detailed Data
    lines.push(`## ${t("doraReportDetailedData")}`);
    lines.push("");

    // Effective deployments table
    lines.push(`### ${t("doraReportDeployments")}`);
    lines.push("");
    if (deployments.length > 0) {
      lines.push(`| ${t("doraReportDate")} | ${t("doraReportStatus")} | ${t("doraReportType")} | ${t("doraReportDeployedBy")} | ID | ${t("doraReportDurationMin")} |`);
      lines.push("|------|--------|------|-------------|----|----------------|");
      for (const d of (deployments as DeployRecord[]).slice(0, 50)) {
        const date = (d.CompletedDate || d.CreatedDate).split("T")[0];
        const deployLink = this.formatMarkdownLink(d.Id, this.buildDeploymentUrl(orgInstanceUrl, d.Id));
        lines.push(`| ${date} | ${d.Status} | ${d.Type} | ${d.DeployedBy} | ${deployLink} | ${d.DurationMinutes} |`);
      }
      if (deployments.length > 50) {
        lines.push(`| ... | ${t("doraReportTruncated", { total: deployments.length })} | | | | |`);
      }
    } else {
      lines.push(t("doraReportNoDataAvailable"));
    }
    lines.push("");

    // Validations table (separated from effective deployments)
    lines.push(`### ${t("doraReportValidations")}`);
    lines.push("");
    if (validations.length > 0) {
      lines.push(`| ${t("doraReportDate")} | ${t("doraReportStatus")} | ${t("doraReportType")} | ${t("doraReportDeployedBy")} | ID | ${t("doraReportDurationMin")} |`);
      lines.push("|------|--------|------|-------------|----|----------------|");
      for (const v of (validations as DeployRecord[]).slice(0, 50)) {
        const date = (v.CompletedDate || v.CreatedDate).split("T")[0];
        const validationLink = this.formatMarkdownLink(v.Id, this.buildDeploymentUrl(orgInstanceUrl, v.Id));
        lines.push(`| ${date} | ${v.Status} | ${v.Type} | ${v.DeployedBy} | ${validationLink} | ${v.DurationMinutes} |`);
      }
      if (validations.length > 50) {
        lines.push(`| ... | ${t("doraReportTruncated", { total: validations.length })} | | | | |`);
      }
    } else {
      lines.push(t("doraReportNoDataAvailable"));
    }
    lines.push("");

    // Pull Requests table
    lines.push(`### ${t("doraReportPullRequests")}`);
    lines.push("");
    if (pullRequests.length > 0) {
      // Sort PRs by merge date descending for the table
      const sortedPrs = [...(pullRequests as CommonPullRequestInfo[])].sort((a, b) => {
        const da = parseDatetime(a.mergedDate)?.getTime() || 0;
        const db = parseDatetime(b.mergedDate)?.getTime() || 0;
        return db - da;
      });
      lines.push(`| ${t("doraReportPrId")} | ${t("doraReportValue")} | Tickets | ${t("doraReportAuthor")} | ${t("doraReportCreated")} | ${t("doraReportMerged")} | ${t("doraReportPrCycleTime")} |`);
      lines.push("|----|-------|---------|--------|---------|--------|-----------|");
      const allTickets = tickets as Ticket[];
      for (const pr of sortedPrs.slice(0, 50)) {
        const created = (pr.createdDate || "").split("T")[0];
        const merged = (pr.mergedDate || "").split("T")[0];
        const lt = round1(daysBetween(parseDatetime(pr.createdDate), parseDatetime(pr.mergedDate)));
        const prLabel = pr.idStr || String(pr.idNumber);
        const prLink = this.formatMarkdownLink(`#${prLabel}`, pr.webUrl);
        const prTitle = this.formatMarkdownLink(this.sanitizeTableCell(pr.title || ""), pr.webUrl);
        const relatedTickets = this.buildPullRequestTicketCell(pr, allTickets);
        lines.push(`| ${prLink} | ${prTitle} | ${relatedTickets} | ${pr.authorName} | ${created} | ${merged} | ${lt} ${t("doraReportDaysUnit")} |`);
      }
      if (pullRequests.length > 50) {
        lines.push(`| ... | ${t("doraReportTruncated", { total: pullRequests.length })} | | | | | |`);
      }
    } else {
      lines.push(t("doraReportNoDataAvailable"));
    }
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(`_Generated by [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT}) DORA Report_`);
    lines.push("");

    return lines.join("\n");
  }

  private buildCompactWeekAxisLabels(weekLabels: string[], maxVisibleLabels: number = 10): string[] {
    const axisLabelStep = Math.max(1, Math.ceil(weekLabels.length / maxVisibleLabels));
    return weekLabels.map((w: string, idx: number) => {
      const shortWeek = w.replace(/^\d{4}-/, "");
      if (idx % axisLabelStep === 0 || idx === weekLabels.length - 1) {
        return `"${shortWeek}"`;
      }
      return '"_"';
    });
  }

  private buildPullRequestUrlMap(pullRequests: CommonPullRequestInfo[]): Map<string, string> {
    const prUrlById = new Map<string, string>();
    for (const pr of pullRequests) {
      const prId = pr.idStr || String(pr.idNumber);
      if (pr.webUrl) {
        prUrlById.set(prId, pr.webUrl);
      }
    }
    return prUrlById;
  }

  private buildDeploymentUrl(orgInstanceUrl: string | null, deploymentId: string): string | null {
    if (!orgInstanceUrl || !deploymentId) {
      return null;
    }
    return `${orgInstanceUrl}/changemgmt/monitorDeploymentsDetails.apexp?asyncId=${encodeURIComponent(deploymentId)}`;
  }

  private formatMarkdownLink(label: string, url?: string | null): string {
    return url ? `[${label}](${url})` : label;
  }

  private sanitizeTableCell(value: string): string {
    return value
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, " ")
      .trim();
  }

  private buildPullRequestTicketCell(pr: CommonPullRequestInfo, tickets: Ticket[]): string {
    const prText = `${pr.title || ""}\n${pr.description || ""}\n${pr.sourceBranch || ""}`;
    const relatedTickets = tickets.filter((ticket) => {
      const escapedTicketId = ticket.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const ticketPattern = new RegExp(`\\b${escapedTicketId}\\b`, "i");
      return ticketPattern.test(prText);
    });

    if (relatedTickets.length === 0) {
      return "-";
    }

    const unique = new Map<string, Ticket>();
    for (const ticket of relatedTickets) {
      if (!unique.has(ticket.id)) {
        unique.set(ticket.id, ticket);
      }
    }

    return [...unique.values()]
      .map((ticket) => this.formatMarkdownLink(ticket.id, ticket.url || null))
      .join("<br/>");
  }

  private expandDetailsSectionsForPdf(markdown: string): string {
    return markdown
      .replace(/<details><summary>([\s\S]*?)<\/summary>/g, (_match, summary) => {
        const cleanSummary = String(summary).trim();
        return `\n#### ${cleanSummary}\n`;
      })
      .replace(/<\/details>/g, "");
  }

  // -----------------------------------------------------------------------
  // Notification
  // -----------------------------------------------------------------------

  private async sendNotification(flags: any, periodDays: number, coreMetrics: DoraMetricResult[], csvResult: any): Promise<void> {
    try {
      const conn = flags["target-org"]?.getConnection() ?? null;
      const { orgMarkdown, notifButtons } = conn
        ? await prepareOrgNotificationContext(conn)
        : { orgMarkdown: "N/A", notifButtons: [] };

      const [df, lt, cfRate, mttr] = coreMetrics;
      const notifText = t("doraReportNotifSummary", {
        period: periodDays,
        org: orgMarkdown,
        dfValue: df.value,
        dfLevel: classificationLabel(df.classification),
        ltValue: lt.value,
        ltLevel: classificationLabel(lt.classification),
        cfrValue: cfRate.value,
        cfrLevel: classificationLabel(cfRate.classification),
        mttrValue: mttr.value,
        mttrLevel: classificationLabel(mttr.classification),
      });

      // Determine severity based on worst classification
      const levels = coreMetrics.map((m) => m.classification.level);
      let notifSeverity: NotifSeverity = "success";
      if (levels.includes("low")) notifSeverity = "warning";
      else if (levels.includes("medium")) notifSeverity = "info";

      await NotifProvider.postNotifications({
        type: "DORA_REPORT",
        text: notifText,
        buttons: notifButtons,
        severity: notifSeverity,
        attachedFiles: csvResult?.xlsxFile ? [csvResult.xlsxFile] : [],
        logElements: coreMetrics,
        data: {
          periodDays,
          metrics: Object.fromEntries(coreMetrics.map((m) => [m.name, { value: m.value, level: m.classification.level }])),
        },
        metrics: Object.fromEntries(coreMetrics.map((m) => [m.name, m.rawValue])),
      });
    } catch (e: any) {
      uxLog("warning", this, c.yellow(`[DORA] Notification error: ${e?.message || e}`));
    }
  }
}
