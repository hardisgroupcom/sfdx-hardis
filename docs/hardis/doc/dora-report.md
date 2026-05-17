<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:dora-report

## Description

Generates a DORA (DevOps Research and Assessment) metrics report for a Salesforce project.

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

This command is part of [sfdx-hardis Documentation](https://sfdx-hardis.cloudity.com/salesforce-project-documentation/).

<details markdown="1">
<summary>Technical explanations</summary>

The command queries `DeployRequest` records via the Salesforce Tooling API to build deployment metrics.
It uses `GitProvider.listPullRequests()` to fetch merged PRs with date filtering, falling back to local `git log --merges` when no provider API is available.
Ticket references are extracted from PR titles/descriptions via `TicketProvider`, enriched with server data when configured, and used to compute MTTR from bug/incident resolution times.

Mermaid `xychart-beta` diagrams visualize deployment frequency trends and lead time, while `pie` charts show deployment outcome distribution.

Each data source is optional: the report gracefully degrades when the org, git provider, or ticket provider is unavailable.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:doc:dora-report --agent --target-org myorg@example.com
```

In agent mode:

- All interactive prompts are skipped.
- `--period` defaults to 90 days when not provided.


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|outputfile<br/>-f|option|Force the path and name of output report file. Must end with .md||||
|pdf|boolean|Also generate the documentation in PDF format||||
|period<br/>-p|option|Number of days to analyze (default: 90)|90|||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-org<br/>-o|option|undefined|nicolas.vuillamy@cloudity.com.integci|||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:doc:dora-report
```

```shell
$ sf hardis:doc:dora-report --target-org myorg@example.com
```

```shell
$ sf hardis:doc:dora-report --period 30
```

```shell
$ sf hardis:doc:dora-report --pdf
```

```shell
$ sf hardis:doc:dora-report --agent --target-org myorg@example.com
```


