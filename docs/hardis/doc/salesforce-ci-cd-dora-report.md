---
title: DORA Metrics Report for Salesforce
description: Generate industry-standard DORA metrics for your Salesforce CI/CD pipeline with sfdx-hardis
---
<!-- markdownlint-disable MD013 -->

## DORA Metrics for Salesforce CI/CD

[DORA (DevOps Research and Assessment)](https://dora.dev/guides/dora-metrics/) is the industry standard for measuring software delivery performance. sfdx-hardis computes DORA metrics directly from your Salesforce deployment history and Git activity - no external tooling or data export required.

Command: **[sf hardis:doc:dora-report](https://sfdx-hardis.cloudity.com/hardis/doc/dora-report/)**

---

### What it measures

#### Core DORA Metrics (5)

| Metric | Description | Source |
|--------|-------------|--------|
| **Deployment Frequency** | How often successful deployments reach the target org | Tooling API (DeployRequest) |
| **Lead Time for Changes** | Time from PR creation to deployment in production | Git Provider + Tooling API |
| **Change Failure Rate** | Percentage of deployments that fail | Tooling API (DeployRequest) |
| **Mean Time to Recovery (MTTR)** | Time to restore service after a failed deployment | Tooling API + Ticket Provider |
| **Deployment Rework Rate** | Ratio of hotfix/unplanned deployments | Git Provider (branch naming) |

#### Supplementary Salesforce Metrics (5)

| Metric | Description |
|--------|-------------|
| **Deployment Duration** | Metadata transfer time (p50, p90, avg) |
| **PR Cycle Time** | Time from PR creation to merge |
| **Change Volume** | PRs and deployments per week |
| **Deployment Activity** | Per-contributor deployment counts and success rates |
| **Validation Success Rate** | CheckOnly deployment pass rate |

Each metric is classified against DORA benchmarks as **Elite**, **High**, **Medium**, or **Low**.

---

### Data sources

The command collects data from three sources - each is optional, the report degrades gracefully when a source is unavailable:

- **Tooling API** (`DeployRequest`): deployment and validation history for the past N days
- **Git Provider** (GitHub, GitLab, Azure DevOps, Bitbucket): merged pull requests with dates, authors, and branch names. Falls back to `git log --merges` when no provider API is configured.
- **Ticket Provider** (Jira, Azure Boards): incident/bug ticket data for MTTR enrichment

---

### Output

- **Markdown report** with Mermaid bar/line/pie charts (deployment frequency trend, lead time trend, outcome distribution)
- **CSV export** of raw deployment data
- **Notification** to Slack, Microsoft Teams, or any configured channel

The Markdown report is also copied to `docs/dora/` in your project so it can be published alongside your project documentation.

---

### Usage

```sh
# Basic report (last 90 days, auto-detects org and git provider)
sf hardis:doc:dora-report

# Target a specific org and period
sf hardis:doc:dora-report --target-org myorg@example.com --period 30

# Generate PDF in addition to Markdown
sf hardis:doc:dora-report --pdf

# Non-interactive mode for agents and automation
sf hardis:doc:dora-report --agent --target-org myorg@example.com
```

---

### DORA Benchmarks Reference

| Metric | Elite | High | Medium | Low |
|--------|-------|------|--------|-----|
| Deployment Frequency | Multiple deploys/day | Once/week to once/day | Once/month to once/week | Less than once/month |
| Lead Time for Changes | < 1 hour | 1 day to 1 week | 1 week to 1 month | > 1 month |
| Change Failure Rate | 0-5% | 5-10% | 10-15% | > 15% |
| MTTR | < 1 hour | < 1 day | < 1 week | > 1 week |

---

### Related

- [sf hardis:doc:dora-report command reference](https://sfdx-hardis.cloudity.com/hardis/doc/dora-report/)
- [Deployment Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-deployments/)
- [Observability integrations (Grafana, Slack, Teams)](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integrations-home/)
