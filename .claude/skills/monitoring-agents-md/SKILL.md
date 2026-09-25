---
name: monitoring-agents-md
description: The AGENTS.md file that sf hardis:org:monitor:backup writes at the root of every monitoring repository, so a coding agent can answer questions about the org, its CI/CD deployments and its Grafana history. Load it whenever a change touches something that file describes - the backup output (files, folders, manifests, filters, commit messages), the monitoring pipeline templates, monitoring commands or notification types, logs/metrics sent to Grafana, config keys of a monitoring branch (deploymentRepository, grafanaUrl...), the CI/CD pipeline behavior it explains (deploy:smart, mergeTargets, delta, deployment actions, promotion branches), or git provider APIs and token variable names.
user-invocable: false
---

# The monitoring AGENTS.md

`sf hardis:org:monitor:backup` writes an `AGENTS.md` (and a `CLAUDE.md` that imports it) at the root of each monitoring repository. Coding agents opened in that repository answer from it. It describes the product, so **a change to the product that it describes makes it wrong until it is updated**, and nothing fails when it is wrong: the agent just gives a confident, stale answer.

## Where it lives

| What | Where |
|------|-------|
| The text | `defaults/templates/monitoring/AGENTS.md` |
| Rendering, merge with user notes, CLAUDE.md | `src/common/monitoring/monitoringAgentsMd.ts` |
| Address check, other-branch lookup, `deploymentRepository` prompt | `src/common/monitoring/monitoringDeploymentRepository.ts` |
| Git provider of an address | `GitProvider.getProviderTypeFromRemoteUrl` (`src/common/gitProvider/index.ts`) |
| Where the backup writes it | `writeAgentsMd()` in `src/commands/hardis/org/monitor/backup.ts`, after the BACKUP notification |
| Tests | `test/common/monitoring/monitoringAgentsMd.test.ts` |
| Pages that describe it to humans | `docs/salesforce-monitoring-metadata-backup.md` (Ask questions with a coding agent), `docs/salesforce-monitoring-home.md` (Ask your coding agent), `docs/salesforce-agentic-automation.md` (Ask Questions About Your Org History and Deployments) |
| Training | Lab 3.8 of `../sfdx-hardis-training` (EN and FR) mentions the file |

Placeholders filled from the branch configuration at each backup: `{{monitoringCommandsTable}}`, `{{deploymentRepositoryStatus}}`, `{{grafanaStatus}}`. Everything else is static text.

## What impacts it, and which section to update

| A change to... | Section of the template |
|----------------|-------------------------|
| Files or folders the backup writes, the manifests, `package-skip-items.xml`, `MONITORING_BACKUP_*` variables, full mode, Data Cloud retrieve, installed packages, doc generation output | **Files and folders**, **What is not in the backup**, **Where each kind of change comes from** |
| The backup commit message or schedule (`defaults/monitoring/*` pipelines), the jobs that run after it | **How it works**, **Collect the changes** (step 2 and 3 read the message format and the schedule) |
| The monitoring pipeline templates (job names, artifacts, provider files) | **How it works**, **Files and folders**, the last paragraph of **Git server access** |
| Monitoring commands, notification types, frequencies, `monitoringCommands`, `monitoringDisable`, `MONITORING_DISABLE` | Rendered automatically by `buildMonitoringCommandsTable`: check the table still renders, and update **Labels** (Grafana) if a `type` changes |
| Metric keys, the Loki payload (`_title`, `_logElements`, `_metrics`, `_jobUrl`...), labels (`orgIdentifier`, `type`, `severity`, `gitIdentifier`), metric naming (`<Key>_metric`, `_percent`...), `NOTIF_API_*` variables | **Monitoring results in Grafana** (Labels, Query) |
| `hardis:org:configure:grafana-dashboards`, `GRAFANA_API_URL`, `GRAFANA_API_TOKEN`, the dashboards folder or uids, datasource detection | **Monitoring results in Grafana** (Connect, Find the datasources, Query) |
| Config keys of a monitoring branch (`deploymentRepository`, `deploymentBranch`, `grafanaUrl`, `grafana*DatasourceUid`...) | **Files and folders** (`.sfdx-hardis.yml` row) and the matching status builder in `monitoringAgentsMd.ts` |
| `hardis:org:configure:monitoring` questions or flags | The status builders (they tell the agent how the user sets a value) |
| CI/CD pipeline behavior: `deploy:smart` scope (`manifest/package.xml`, no-overwrite, delta, smart tests), `mergeTargets`, branch config files, deployment actions (types, `context`, `runOnlyOnceByOrg`, `scripts/actions/`), promotion branches, Pull Request comments, CI workflow file names | **How the CI/CD pipeline works** |
| Git provider CLIs, API paths, token variable names (`CI_SFDX_HARDIS_*_TOKEN`...), merge commit formats | **Git server access**, **History** |
| Anonymization of user data in notifications | **Labels** (the pseudonymization sentence) |

When in doubt, grep the template for the name you are changing: `grep -n "<name>" defaults/templates/monitoring/AGENTS.md`.

## Rules for the text

- **Describe what the product does, from the source.** Read the command, not its name. Two facts were wrong in the first version and corrected by the maintainer: `deploy:smart` deploys `manifest/package.xml` minus the no-overwrite items already in the org (not the package directories), and the backup never deletes files (existence comes from `manifest/package-all-org-items.xml`).
- **The agent only reads.** Never add an instruction that pushes, comments, runs a pipeline, or changes Grafana. The one write allowed is a single line of `.sfdx-hardis.yml`, after asking the user, and never a secret.
- **Secrets stay out of `.sfdx-hardis.yml`**: tokens come from the environment, a `.env` file (git ignores it in monitoring repositories), or a CLI the user is logged in with.
- **Prefer discovery to lists that rot**: tell the agent how to list metric names, label values or datasources rather than hardcoding them.
- Keep the two markers and the `markdownlint-disable MD013` / `enable` pair around the block. No em-dashes, and the "Never write like an AI" rules of `CLAUDE.md`.
- Placeholders are filled with replacer functions (`.replace('{{x}}', () => value)`): keep it that way, config values may hold `$`.
- A new configurable value gets a status builder (like `buildGrafanaStatus`) that says what is set, or tells the agent to ask the user and which line to write.

## Verify

```sh
npx mocha test/common/monitoring/monitoringAgentsMd.test.ts
```

Then render it with and without the optional settings and lint the result: it must pass markdownlint with no finding.

```js
// render.mts, run with: node --import tsx render.mts
import fs from 'fs';
import { buildMonitoringAgentsMdBlock } from './src/common/monitoring/monitoringAgentsMd.ts';
fs.writeFileSync('AGENTS-unset.md', await buildMonitoringAgentsMdBlock({}));
fs.writeFileSync('AGENTS-set.md', await buildMonitoringAgentsMdBlock({ deploymentRepository: 'https://github.com/acme/crm', grafanaUrl: 'https://acme.grafana.net' }));
```

```sh
npx markdownlint-cli2 AGENTS-unset.md AGENTS-set.md
```

Last, check the three documentation pages listed above still match, and run the `training-impact` skill if a question the course shows changes.
