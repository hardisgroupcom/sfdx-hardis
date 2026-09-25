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

Only the block between the `sfdx-hardis-monitoring-agents-start` and `sfdx-hardis-monitoring-agents-end` markers belongs to sfdx-hardis. Write your own notes after the end marker: the next backups keep them.

### Grafana example

![](assets/images/screenshot-monitoring-backup-grafana.jpg)

### Slack example

![](assets/images/screenshot-monitoring-backup2.jpg)