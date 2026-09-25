---
title: Metadata backup (Salesforce monitoring)
description: Schedule daily metadata backups with sfdx-hardis Monitoring
---
<!-- markdownlint-disable MD013 -->

## Metadata Backup

Adds a new commit to the git branch with the changes made since the latest monitoring run.

Sfdx-hardis command: [sf hardis:org:monitor:backup](https://sfdx-hardis.cloudity.com/hardis/org/monitor/backup/)

### Ask questions with a coding agent

Each backup also writes an `AGENTS.md` file at the root of the monitoring repository (and a `CLAUDE.md` that imports it, when there is none). It tells a coding agent (Claude Code, Codex, Gemini, Copilot...) how the monitoring works, what each file and folder holds, what the backup skips and which monitoring checks run on the branch.

Open the monitoring repository with your coding agent and ask things like:

- "Which Flows changed last week?"
- "When was the Account validation rule `Check_VAT` last modified, and what changed?"
- "Is the field `Invoice__c.Status__c` the same in production and in the UAT sandbox?"

Only the block between the `sfdx-hardis-monitoring-agents-start` and `sfdx-hardis-monitoring-agents-end` markers belongs to sfdx-hardis. Write your own notes after the end marker: the next backups keep them. Keep both markers: when one of them is missing, the backup leaves the file alone and logs a warning.

#### Search the deployment repository and the pipelines too

Set `deploymentRepository` in the `.sfdx-hardis.yml` of the monitoring branch to the address of the sfdx-hardis CI/CD repository that deploys to the org. [Configure Org Monitoring](https://sfdx-hardis.cloudity.com/hardis/org/configure/monitoring/) asks for it, and suggests the value already set on another monitoring branch. It is the mirror of `monitoringRepository` in the CI/CD repository. When it is missing, the coding agent offers to set it the first time a question needs it.

To set it, change it or remove it later, edit `deploymentRepository` in the `.sfdx-hardis.yml` of the monitoring branch, or use **Set deployment repository** in the Org Monitoring panel of VS Code. Commit and push `.sfdx-hardis.yml` afterwards.

`AGENTS.md` then tells the agent to:

- clone the deployment repository next to the monitoring one (or use the clone already there), read-only
- find the branch that deploys to the org, from the `instanceUrl` of its `config/branches/.sfdx-hardis.<branch>.yml`, or from the optional `deploymentBranch` property
- understand how the pipeline is built and what it deploys: `mergeTargets`, delta deployments, overwrite management, deployment actions of the branches and of each Pull Request
- read the pipeline logs and the Pull Requests of both repositories with `gh`, `glab`, `az` or the Bitbucket API

It can then answer questions like "Was this change deployed by the pipeline, or made directly in production?" or "Why did last night's backup fail?".

The agent uses the git provider CLI you are already logged in with, or tokens in a `.env` file at the root of the monitoring repository, with the variable names sfdx-hardis uses (`CI_SFDX_HARDIS_GITHUB_TOKEN`, `CI_SFDX_HARDIS_GITLAB_TOKEN`, `CI_SFDX_HARDIS_AZURE_TOKEN`, `CI_SFDX_HARDIS_BITBUCKET_TOKEN`). It only reads: no push, no comment, no pipeline run.

### Grafana example

![](assets/images/screenshot-monitoring-backup-grafana.jpg)

### Slack example

![](assets/images/screenshot-monitoring-backup2.jpg)