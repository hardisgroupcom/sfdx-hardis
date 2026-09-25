<!-- sfdx-hardis-monitoring-agents-start -->
<!-- This block is rewritten by sfdx-hardis at each monitoring backup. Write your own notes after the end marker, they are kept. -->

# Salesforce org monitoring repository (sfdx-hardis)

This repository is an [sfdx-hardis Org Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/) repository. It holds a nightly backup of the metadata of one or more Salesforce orgs, made by a scheduled CI/CD pipeline. Nobody develops in it and nothing is ever deployed from it.

Read this file before answering questions about the org, and answer from the files of the repository and from its git history.

## How it works

- **One git branch per monitored org.** Branch names usually look like `monitoring_<client>` for production and `monitoring_<client>__<sandbox>` for sandboxes. The branch you are on is the org you are looking at. Run `git branch -a` to list the other monitored orgs.
- **The org and user of the branch** are in `.sfdx-hardis.yml` (`instanceUrl`, `targetUsername`). Authentication secrets are CI variables, never files of the repository.
- **Every night, the backup job** runs `sf hardis:org:monitor:backup`: it lists all the metadata of the org, retrieves it in source format, then commits the result on the branch with a message like `chore(monitoring): org state on 2026-01-31 00:12 for monitoring_myclient`. A day without changes in the org makes no commit.
- **Then other jobs run** on the same branch, and they do not commit anything:
  - `sf hardis:org:test:apex` runs the Apex tests of the org.
  - `sf hardis:org:monitor:all` runs the monitoring checks listed below.
  - MegaLinter scans the retrieved sources for quality and security issues.
- **Their results are not stored in the repository.** They are sent as notifications (Slack, Microsoft Teams, email), to an API or a Grafana dashboard when configured, and kept as CI job artifacts (`hardis-report/`, `megalinter-reports/`) for a limited time.

## Answering questions with git

The git history of a branch is the change history of the org, one commit per day with changes.

- What changed recently: `git log --stat -n 10`
- When a component changed: `git log --follow -p -- force-app/main/default/flows/My_Flow.flow-meta.xml`
- What changed between two dates: `git log --since=2026-01-01 --until=2026-01-31 --name-status`
- Compare two orgs: `git diff origin/monitoring_myclient origin/monitoring_myclient__uat_sandbox -- force-app/main/default/objects/Account`

A commit shows the state of the org at the time of the backup, not who made the change or when during the day. The author of the commit is the CI user or bot. To know which user changed something in Setup, the org's Setup Audit Trail is the source (the `AUDIT_TRAIL` check reports suspect entries).

## Files and folders

| Path | Content |
| ---- | ------- |
| `force-app/main/default/` | The metadata of the org, in Salesforce DX source format: one folder per metadata type (`objects/`, `classes/`, `triggers/`, `flows/`, `lwc/`, `aura/`, `permissionsets/`, `profiles/`, `layouts/`...). This is the backup. |
| `installedPackages/` | One JSON file per package installed in the org: name, namespace, version name and number. |
| `manifest/package-all-org-items.xml` | Every metadata item that exists in the org, including the ones that are not backed up. Use it to check if a component exists in the org. |
| `manifest/package-backup-items.xml` | The items actually retrieved: the full list, minus the filters below. |
| `manifest/package-skip-items.xml` | Filters maintained by hand: the types or members never retrieved. Sensitive types (`AuthProvider`, `Certificate`, `ConnectedApp`) are there by default. |
| `manifest/package-skip-items-dynamic-do-not-update-manually.xml` | Filters built from the `MONITORING_BACKUP_SKIP_METADATA_TYPES` variable, when it is set. |
| `manifest/package-backup-datacloud-items.xml` | Data Cloud items (`__dlm`, `__dll` objects and Data Cloud metadata types), retrieved in a separate call. |
| `manifest/chunks/` | Only in full mode (`--full`): the list of items split in several retrieves. |
| `docs/` | Project documentation generated from the metadata after each backup, unless disabled: objects, Apex, Flows with their visual history (`docs/flows/*-history.md`), Lightning pages, profiles, permission sets, packages, and an object model diagram. |
| `mkdocs.yml` | Menu and settings of the documentation site built from `docs/`. |
| `.sfdx-hardis.yml` | sfdx-hardis configuration of the branch: monitored org, notification settings, custom `monitoringCommands` and `monitoringDisable`. |
| `sfdx-project.json` | Salesforce DX project definition, including the API version used for the retrieve. |
| `.gitlab-ci.yml`, `.github/workflows/`, `azure-pipelines.yml`, `bitbucket-pipelines.yml`, `Jenkinsfile` | The monitoring pipeline for each CI/CD platform. Only one of them is used. On GitHub, the workflow lives on the default branch and runs all monitoring branches. |
| `.mega-linter.yml`, `.jscpd.json` | MegaLinter and copy-paste detection settings. |
| `THIS_IS_MONITORING`, `DO_NOT_DEPLOY_FROM_THIS_REPO` | Empty marker files: this repository is for monitoring only. |

## What is not in the backup

- **Data**: no records, only metadata.
- **Managed packages content**: items with the namespace of an installed package are skipped. Their name and version are in `installedPackages/`.
- **Standard objects without custom fields**, and standard members named `standard__*`.
- **Sensitive metadata**: certificates, auth providers, connected apps (see `manifest/package-skip-items.xml` and `.gitignore`).
- **Anything added to `manifest/package-skip-items.xml`** by the team, often to avoid a retrieve that fails or takes too long.

If a component is in `manifest/package-all-org-items.xml` but not in `force-app/`, one of these filters skipped it.

## Monitoring checks configured on this branch

`sf hardis:org:monitor:all` runs these checks, each at its own frequency. This list merges the defaults of sfdx-hardis with the `monitoringCommands` and `monitoringDisable` settings of `.sfdx-hardis.yml`.

{{monitoringCommandsTable}}

## Rules for coding agents

- Never deploy anything from this repository to an org.
- Do not edit the files under `force-app/`, `manifest/package-all-org-items.xml`, `manifest/package-backup-items.xml`, `installedPackages/` or `docs/`: the next backup overwrites them.
- Changes worth making here are configuration: `manifest/package-skip-items.xml`, `.sfdx-hardis.yml`, the pipeline file. They apply to the branch they are committed on, so to one org.
- To answer "what does this org do", read the sources in `force-app/main/default/` first, then the generated `docs/` when present.

## Documentation

- [Monitoring overview](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/)
- [Metadata backup](https://sfdx-hardis.cloudity.com/salesforce-monitoring-metadata-backup/)
- [Monitoring configuration](https://sfdx-hardis.cloudity.com/salesforce-monitoring-config-home/)
- [Grafana dashboards](https://sfdx-hardis.cloudity.com/salesforce-monitoring-grafana-v2/)

<!-- sfdx-hardis-monitoring-agents-end -->
