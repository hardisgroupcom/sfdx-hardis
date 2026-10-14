/* jscpd:ignore-start */
import { SfCommand, Flags, optionalOrgFlagWithDeprecations } from "@salesforce/sf-plugins-core";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import c from "chalk";
import fs from '../../../common/utils/fsUtils.js';
import * as path from "path";
import { t } from "../../../common/utils/i18n.js";
import { uxLog } from "../../../common/utils/index.js";
import { TicketProvider, Ticket } from "../../../common/ticketProvider/index.js";
import { NotifProvider, NotifSeverity } from "../../../common/notifProvider/index.js";
import { generateCsvFile, generateReportPath } from "../../../common/utils/filesUtils.js";
import { generateMarkdownFileWithMermaid } from "../../../common/utils/mermaidUtils.js";
import { DoraBranchResult, DoraReportData, classificationLabel } from "../../../common/utils/doraUtils.js";
import { DoraBranchInput, computeBranchResult, computeContributors } from "../../../common/utils/doraMetricsUtils.js";
import { computeAttentionItems, computePipelineBacklogItem } from "../../../common/utils/doraAttentionUtils.js";
import { computePipelineFlow } from "../../../common/utils/doraPipelineUtils.js";
import { buildDoraPeriod, collectDoraBranchInputs, pipelineTracedFrom, resolveDoraSource } from "../../../common/utils/doraDataUtils.js";
import { DORA_LEVEL_EMOJIS, buildDoraMarkdownReport, buildMetricSummaries, expandDetailsSectionsForPdf } from "../../../common/utils/doraMarkdownUtils.js";
import { CONSTANTS } from "../../../config/index.js";
import { prepareOrgNotificationContext } from "../../../common/utils/orgNotificationContext.js";
import { WebSocketClient } from "../../../common/websocketClient.js";

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages("sfdx-hardis", "org");

/* jscpd:ignore-end */

export default class DoraReport extends SfCommand<any> {
  public static title = "DORA Metrics Report";

  public static description = `Generates a DORA (DevOps Research and Assessment) metrics report for a Salesforce project, for each of its major orgs.

## Command Behavior

Everything is read from the **git provider** (GitHub, GitLab, Azure DevOps, Bitbucket), so no org login is needed and every team member gets the same numbers:

- **Deployment jobs** of each major branch: a deployment is a run of the deployment job after a merge
- **Deployment checks** of the Pull Requests targeting each major branch
- **Pull Requests** merged into each major branch, and the ones still open

The command fails when no authenticated git provider is available, or when its token cannot read CI jobs.

**Core DORA Metrics (5), per major branch:**

1. **Deployment Frequency** - successful deployment jobs per week
2. **Lead Time for Changes** - time from Pull Request creation to the end of the job that deployed its merge
3. **Change Failure Rate** - failed deployment jobs / (succeeded + failed). Canceled jobs are counted apart
4. **Mean Time to Recovery (MTTR)** - time from a failed deployment job to the next successful one on the same branch
5. **Deployment Rework Rate** - share of hotfix Pull Requests, or of deployments redone within a day of a failure

**Supplementary Metrics:**

6. Deployment Duration (time the job ran)
7. Deployment Queue Time (time the job waited for a runner)
8. PR Cycle Time
9. Change Volume
10. Validation Success Rate (deployment checks of the Pull Requests)
11. Contributors (Pull Requests and deployments per person)

Each metric is classified against DORA benchmarks as **Elite**, **High**, **Medium**, or **Low**, with the same scale for every branch.

Each branch also gets a **needs attention** list: a deployment that is still failing, Pull Requests open for more than 7 days, a failure rate that went up, no deployment for 30 days, changes waiting there for more than 30 days.

**Pipeline flow**, when several major branches are computed:

- **Time to production** - from the creation of the Pull Request of a change to its deployment on the production branch, whatever the number of branches it went through
- **Wait at each step** (for example \`uat\` to \`preprod\`) - from the deployment on a branch to the deployment on the next one, with the step where changes wait the longest
- **Waiting changes** - what reached a branch and has not been carried further, the oldest first
- The lead time shown for each branch is then the one of the changes themselves, not the one of the Pull Request that merged a branch into the next

**Which branches:**

- \`--branches\` when given (comma-separated).
- In a CI job: the current branch.
- Run by a user: every major branch (\`config/branches/.sfdx-hardis.*.yml\`).
- In a monitoring repository whose \`.sfdx-hardis.yml\` has \`deploymentRepository\`: the branch \`deploymentBranch\` of that repository. The token is \`SFDX_HARDIS_DEPLOYMENT_REPO_TOKEN\` when set, else the git provider token of the monitoring repository, which must then be able to read the deployment repository.

**Output:** a **Markdown report** with Mermaid diagrams (and a PDF with \`--pdf\`), a **CSV export** of the jobs, and a **notification** (Slack, Teams, Grafana...) when a single branch is computed: \`--target-org\` then only says which org the notification is about.

\`--data-only\` returns the JSON result alone, without report files nor notification. The VS Code **DORA metrics** panel uses it.

\`--compare\` also computes the period of the same length just before, so each metric shows where it comes from.

This command is part of [sfdx-hardis Documentation](${CONSTANTS.DOC_URL_ROOT}/salesforce-project-documentation/).

<details markdown="1">
<summary>Technical explanations</summary>

- Runs are listed with \`GitProvider.listCiRuns()\`: workflow runs on GitHub, jobs on GitLab, builds on Azure DevOps, pipelines and their steps on Bitbucket.
- A run is a deployment or a deployment check according to the name of its job (\`Process Deployment\`, \`deploy_to_org\`, \`Deployment\`, \`Deploy to major org\`, and their check counterparts). When a project renamed its jobs and no run of a branch is named as a deployment, every run triggered by a push to that branch counts.
- Token scopes: \`Actions: Read\` on GitHub, \`read_api\` on GitLab, \`Build: Read\` on Azure DevOps, \`pipeline\` on Bitbucket.
- Finished runs do not change: they are kept in \`~/.sfdx/sfdx-hardis-cache/dora\`, and only the runs newer than the last reading are asked to the provider. \`--refresh\` reads everything again.
- A git provider keeps its job runs for a limited time: with \`--compare\`, when a branch has no run as old as the period asked for, the report says when its data starts.
- Runs of a major branch that no merge triggered (scheduled pipelines, pipelines started through the API, Bitbucket custom pipelines) are not deployments.
- A job run again on the same commit replaces its previous result on some providers, so a failure fixed by a re-run can disappear from the history.
- The pipeline flow is rebuilt from the Pull Requests, without reading the git history. A Pull Request from a major branch into the next carries every change that was in its source branch when it was merged. A promotion Pull Request (\`promotion/<source>/<target>/...\`) carries the Pull Requests its \`promotionPullRequests\` list declares. A merge from a major branch back into an earlier one carries nothing.
- A change cherry-picked by hand, or merged more than 90 days before the period, is not followed. A promotion whose list cannot be read, and a change a promotion declares that was not read, are counted in \`pipeline.untraced\` and said in the report.
- The pipeline flow needs every branch of a step: \`--branches uat,main\` on a project where \`uat\` is merged into \`preprod\` computes none.
- The steps are the \`mergeTargets\` of each major branch. In a monitoring repository, where they cannot be read, the branches of \`--branches\` follow each other in the order given.
- The notification keeps the lead time of the Pull Requests of the branch, so the Grafana history stays comparable.
- The \`--json\` result holds \`pipeline\` (stages, steps, time to production, slowest changes), \`branches\` (metrics, weekly series, failed deployments, slow and hotfix Pull Requests, attention list), \`contributors\`, and the legacy \`metrics\`, \`supplementary\` and \`counts\` of the production branch.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:doc:dora-report --agent
sf hardis:doc:dora-report --agent --data-only --compare --period 180 --json
\`\`\`

In agent mode:

- The command has no interactive prompt: \`--agent\` changes nothing to its behavior.
- \`--period\` defaults to 90 days when not provided.
- The git provider token must be in the environment (\`GITHUB_TOKEN\`, \`CI_SFDX_HARDIS_GITLAB_TOKEN\`, \`CI_SFDX_HARDIS_AZURE_TOKEN\`, \`CI_SFDX_HARDIS_BITBUCKET_TOKEN\`).

<!-- training-links:start -->

## Learn by doing

The free [Salesforce DevOps with sfdx-hardis](https://sfdx-hardis-training.cloudity.com) course runs this command, click by click, on an org of your own, in these labs:

- [Lab 3.6 - Release to production and read your DORA metrics](https://sfdx-hardis-training.cloudity.com/en/level-3-release-manager/3-6-release-to-production-and-read-dora-metrics/)
- [Lab 3.11 - Capstone: run a weekly release cycle](https://sfdx-hardis-training.cloudity.com/en/level-3-release-manager/3-11-capstone-run-a-weekly-release-cycle/)

<!-- training-links:end -->
`;

  public static examples = [
    "$ sf hardis:doc:dora-report",
    "$ sf hardis:doc:dora-report --period 30",
    "$ sf hardis:doc:dora-report --branches integration,uat,main",
    "$ sf hardis:doc:dora-report --pdf",
    "$ sf hardis:doc:dora-report --target-org myorg@example.com",
    "$ sf hardis:doc:dora-report --agent",
    "$ sf hardis:doc:dora-report --agent --data-only --compare --json",
  ];

  public static flags: any = {
    period: Flags.integer({
      char: "p",
      default: 90,
      min: 1,
      max: 365,
      description: messages.getMessage("doraReportPeriod"),
    }),
    branches: Flags.string({
      char: "b",
      description: messages.getMessage("doraReportBranches"),
    }),
    compare: Flags.boolean({
      default: false,
      description: messages.getMessage("doraReportCompare"),
    }),
    "data-only": Flags.boolean({
      default: false,
      description: messages.getMessage("doraReportDataOnly"),
    }),
    refresh: Flags.boolean({
      default: false,
      description: messages.getMessage("doraReportRefresh"),
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

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DoraReport);
    const periodDays = flags.period ?? 90;
    const dataOnly = flags["data-only"] === true;

    uxLog("action", this, c.cyan(t("doraReportGenerating", { period: periodDays })));

    // 1. Collect the jobs and the Pull Requests from the git provider
    const source = await resolveDoraSource(flags.branches || null);
    const period = buildDoraPeriod(periodDays, flags.compare === true);
    const inputs = await collectDoraBranchInputs(source, period, { refresh: flags.refresh === true, commandThis: this });

    // 2. Compute the metrics of each branch
    uxLog("action", this, c.cyan(t("doraReportComputingMetrics")));
    const branches = inputs.map((input) => {
      const result = computeBranchResult(input, period);
      result.attention = computeAttentionItems(input, result, period.to);
      return result;
    });
    // 3. Follow the changes from one major branch to the next
    const flow = computePipelineFlow(inputs, period, { tracedFrom: pipelineTracedFrom(period), otherMajorBranches: source.majorBranches });
    if (!flow && inputs.length > 1) {
      uxLog("log", this, c.grey(`[DORA] ${t("doraReportPipelineNotComputed")}`));
    }
    for (const branch of branches) {
      branch.metrics.changeLeadTime = flow?.changeLeadTimes.get(branch.name) ?? null;
      const stage = flow?.pipeline.stages.find((candidate) => candidate.branch === branch.name);
      const backlog = stage ? computePipelineBacklogItem(stage) : null;
      if (backlog) {
        branch.attention.push(backlog);
      }
    }
    const data: DoraReportData = {
      schemaVersion: 2,
      period: {
        days: periodDays,
        from: period.from.toISOString(),
        to: period.to.toISOString(),
        previousFrom: period.previousFrom ? period.previousFrom.toISOString() : null,
      },
      source: { provider: source.gitProvider.getLabel(), repository: source.repository },
      branches,
      pipeline: flow ? flow.pipeline : null,
      contributors: computeContributors(inputs, period),
    };
    for (const branch of branches) {
      // The same lead time as the report: the one of the changes when they were followed
      const summary = buildMetricSummaries(branch, { changeLeadTime: true }).map((metric) => `${metric.name}: ${metric.value}`).join(" | ");
      uxLog("log", this, c.grey(`[DORA] ${branch.name} - ${summary}`));
    }
    const result: any = { ...data, ...this.buildLegacyResult(branches) };
    if (dataOnly) {
      return result as AnyJson;
    }

    // 4. Markdown report, and its PDF when asked for
    uxLog("action", this, c.cyan(t("doraReportGeneratingMarkdown")));
    const tickets = await this.fetchTicketData(inputs);
    result.counts.tickets = tickets.length;
    const markdown = buildDoraMarkdownReport(data, inputs, tickets);
    const outputFile = flags.outputfile || "";
    const reportDate = new Date().toISOString().split("T")[0];
    const mdOutputFile = await generateReportPath(`dora-report-${reportDate}`, outputFile, { fileExtension: "md", withBranchName: false });
    await fs.writeFile(mdOutputFile, markdown, "utf8");
    uxLog("success", this, c.green(t("doraReportComplete", { outputFile: mdOutputFile })));
    const pdfOutputFile = flags.pdf === true ? await this.generatePdf(markdown, mdOutputFile) : null;

    // The default output is also copied in docs/dora, where the project documentation is built from
    let docsDoraOutputFile: string | null = null;
    if (outputFile === "") {
      const docsDoraDir = path.join(process.cwd(), "docs", "dora");
      await fs.ensureDir(docsDoraDir);
      docsDoraOutputFile = path.join(docsDoraDir, path.basename(mdOutputFile));
      await fs.copy(mdOutputFile, docsDoraOutputFile, { overwrite: true });
      uxLog("log", this, c.grey(`[DORA] ${t("copied")} ${docsDoraOutputFile}`));
    }
    WebSocketClient.sendReportFileMessage(docsDoraOutputFile || mdOutputFile, t("doraReportTitle"), "report");

    // 5. CSV of the jobs behind the numbers
    uxLog("action", this, c.cyan(t("doraReportGeneratingCsv")));
    const csvPath = await generateReportPath("dora-report-data", "", { fileExtension: "csv" });
    const csvResult = await generateCsvFile(this.buildCsvRows(inputs, period.previousFrom || period.from), csvPath, {
      fileTitle: "DORA Report - Deployment Data",
    });

    // 6. Notification: one org at a time, so a run on several branches sends none
    if (branches.length === 1) {
      uxLog("action", this, c.cyan(t("doraReportSendingNotification")));
      await this.sendNotification(flags, periodDays, branches[0], csvResult);
    }

    return {
      ...result,
      outputFile: mdOutputFile,
      docsOutputFile: docsDoraOutputFile,
      pdfFile: pdfOutputFile,
      csvFile: csvPath,
    } as AnyJson;
  }

  // The fields the result had before it described every branch: the ones of production, or of the
  // last branch of the pipeline when none is production
  private buildLegacyResult(branches: DoraBranchResult[]) {
    const branch = branches.find((candidate) => candidate.isProduction) || branches[branches.length - 1];
    const metrics = branch.metrics;
    const supplementary = branch.supplementary;
    return {
      metrics: {
        deploymentFrequency: { perDay: metrics.deploymentFrequency.perDay, perWeek: metrics.deploymentFrequency.perWeek, classification: metrics.deploymentFrequency.level },
        leadTime: { medianDays: metrics.leadTime.medianDays, p90Days: metrics.leadTime.p90Days, avgDays: metrics.leadTime.avgDays, classification: metrics.leadTime.level },
        changeFailureRate: { percent: metrics.changeFailureRate.percent, classification: metrics.changeFailureRate.level },
        mttr: { medianHours: metrics.mttr.medianHours, classification: metrics.mttr.level },
        reworkRate: { percent: metrics.reworkRate.percent, classification: metrics.reworkRate.level },
      },
      supplementary: {
        deploymentDuration: { medianMin: supplementary.deploymentDuration.median, avgMin: supplementary.deploymentDuration.avg, p90Min: supplementary.deploymentDuration.p90 },
        queueTime: { medianMin: supplementary.queueTime.median, avgMin: supplementary.queueTime.avg, p90Min: supplementary.queueTime.p90 },
        prCycleTime: { medianDays: supplementary.prCycleTime.median, avgDays: supplementary.prCycleTime.avg, p90Days: supplementary.prCycleTime.p90 },
        changeVolume: supplementary.changeVolume,
        validationSuccessRate: supplementary.validationSuccessRate,
      },
      counts: {
        deployments: branch.counts.deployments,
        validations: branch.counts.validations,
        pullRequests: branch.counts.pullRequests,
      },
    };
  }

  // Tickets named by the Pull Requests, for the detail tables. A project without ticketing gets none
  private async fetchTicketData(inputs: DoraBranchInput[]): Promise<Ticket[]> {
    try {
      const allText = inputs
        .flatMap((input) => input.mergedPullRequests)
        .map((pullRequest) => `${pullRequest.title} ${pullRequest.sourceBranch}`)
        .join("\n");
      if (allText.trim() === "") {
        return [];
      }
      const tickets = await TicketProvider.getProvidersTicketsFromString(allText, {});
      if (tickets.length > 0) {
        await TicketProvider.collectTicketsInfo(tickets);
      }
      return tickets;
    } catch {
      // No ticketing configured, or it does not answer: the table only loses its Tickets column content
      return [];
    }
  }

  private async generatePdf(markdown: string, mdOutputFile: string): Promise<string> {
    const pdfSourceFile = mdOutputFile.replace(/\.md$/i, `.pdf-source-${Date.now()}.md`);
    await fs.writeFile(pdfSourceFile, expandDetailsSectionsForPdf(markdown), "utf8");
    const pdfGenerationOk = await generateMarkdownFileWithMermaid(pdfSourceFile, pdfSourceFile, null, true);
    if (!pdfGenerationOk) {
      await fs.remove(pdfSourceFile);
      throw new Error("Error generating PDF report from markdown");
    }
    const generatedPdfSourceFile = pdfSourceFile.replace(/\.md$/i, ".pdf");
    let pdfOutputFile = mdOutputFile.replace(/\.md$/i, ".pdf");
    try {
      await fs.copy(generatedPdfSourceFile, pdfOutputFile, { overwrite: true });
      await fs.remove(generatedPdfSourceFile);
    } catch {
      // Keep uniquely generated file if default output is locked by another process.
      pdfOutputFile = generatedPdfSourceFile;
    }
    await fs.remove(pdfSourceFile);
    WebSocketClient.sendReportFileMessage(pdfOutputFile, `${t("doraReportTitle")} (PDF)`, "report");
    return pdfOutputFile;
  }

  private buildCsvRows(inputs: DoraBranchInput[], from: Date): any[] {
    return inputs.flatMap((input) =>
      [...input.deploymentRuns, ...input.validationRuns]
        .filter((run) => Date.parse(run.finishedAt) >= from.getTime())
        .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))
        .map((run) => ({
          Branch: input.name,
          Type: run.kind === "deployment" ? "Deployment" : "Validation",
          Status: run.status,
          Job: run.name,
          TriggeredBy: run.triggeredBy,
          QueuedDate: run.queuedAt,
          StartDate: run.startedAt,
          CompletedDate: run.finishedAt,
          PullRequest: run.pullRequestId || "",
          Url: run.webUrl,
        })),
    );
  }

  private async sendNotification(flags: any, periodDays: number, branch: DoraBranchResult, csvResult: any): Promise<void> {
    try {
      // The org of the notification: it is what Grafana files the metrics under
      const conn = flags["target-org"]?.getConnection() ?? null;
      const { orgMarkdown, notifButtons } = conn ? await prepareOrgNotificationContext(conn) : { orgMarkdown: branch.name, notifButtons: [] };

      const summaries = buildMetricSummaries(branch);
      const [df, lt, cfRate, mttr] = summaries;
      const notifText = t("doraReportNotifSummary", {
        period: periodDays,
        org: orgMarkdown,
        dfValue: df.value,
        dfLevel: classificationLabel(df),
        ltValue: lt.value,
        ltLevel: classificationLabel(lt),
        cfrValue: cfRate.value,
        cfrLevel: classificationLabel(cfRate),
        mttrValue: mttr.value,
        mttrLevel: classificationLabel(mttr),
      });

      // Determine severity based on worst classification
      const levels = summaries.map((metric) => metric.level);
      let notifSeverity: NotifSeverity = "success";
      if (levels.includes("low")) notifSeverity = "warning";
      else if (levels.includes("medium")) notifSeverity = "info";

      await NotifProvider.postNotifications({
        type: "DORA_REPORT",
        text: notifText,
        buttons: notifButtons,
        severity: notifSeverity,
        attachedFiles: csvResult?.xlsxFile ? [csvResult.xlsxFile] : [],
        logElements: summaries.map((metric) => ({ name: metric.name, value: metric.value, rawValue: metric.rawValue, classification: { level: metric.level, emoji: DORA_LEVEL_EMOJIS[metric.level] } })),
        data: {
          periodDays,
          branch: branch.name,
          // Stable keys (not the translated display names) so Loki and Prometheus consumers see
          // consistent identifiers; the translated display name stays in `label`
          metrics: Object.fromEntries(summaries.map((metric) => [metric.key, { label: metric.name, value: metric.value, level: metric.level }])),
        },
        // Metric names must be locale-independent and contain no spaces (InfluxDB line protocol /
        // Prometheus). A metric with no data is not sent: a zero would read as a measure
        metrics: Object.fromEntries(
          summaries.filter((metric) => typeof metric.rawValue === "number" && Number.isFinite(metric.rawValue)).map((metric) => [metric.key, metric.rawValue]),
        ),
      });
    } catch (e: any) {
      uxLog("warning", this, c.yellow(`[DORA] Notification error: ${e?.message || e}`));
    }
  }
}
