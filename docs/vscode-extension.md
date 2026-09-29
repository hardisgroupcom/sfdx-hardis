---
title: VS Code Extension for sfdx-hardis
description: "The graphical companion to the sfdx-hardis CLI: workbenches, pipeline view, monitoring config and AI assistance directly in Visual Studio Code."
---
<!-- markdownlint-disable MD013 -->

Every command documented on this site can also be triggered from the **[VS Code SFDX Hardis](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)** extension, a graphical companion built on top of the CLI.

If you prefer clicks to flags, install the extension and skip the terminal: see [Installation](installation.md#install-with-visual-studio-code-recommended).

![Welcome panel](assets/images/welcome.gif)

---

## User guides

Each workbench of the extension has its own guide: what it is for, how to open it, a step by step walk through its screens with numbered markers, and what you can customize. The **?** button in the header of each panel opens its guide.

| Workbench | What you do with it |
|---|---|
| [Welcome panel](vscode-extension-welcome.md) | Check your tools, open any workbench, run the commands of your team |
| [DevOps Pipeline view](vscode-extension-devops-pipeline.md) | See branches, orgs and deployments, start and publish a User Story, add deployment actions |
| [Org Monitoring Workbench](vscode-extension-org-monitoring.md) | Run a monitoring check, edit the monitoring configuration, see what the backup keeps |
| [Command execution panel](vscode-extension-command-runner.md) | Answer the questions of a command, follow its progress, open its reports |
| [Orgs Manager](vscode-extension-orgs-manager.md) | Connect orgs, pick the default one, reconnect, run org operations, clean up |
| [Metadata Retriever](vscode-extension-metadata-retriever.md) | Find what changed in your org and retrieve it into your project |
| [Metadata Dependencies](vscode-extension-metadata-dependencies.md) | Find what uses a component, or what it uses, before you change it |
| [Data Workbench](vscode-extension-data-workbench.md) | Build SFDMU data workspaces and move records between orgs |
| [Files Workbench](vscode-extension-files-workbench.md) | Move files and attachments between orgs |
| [Customize the extension](vscode-extension-customize.md) | Settings, per-org colors, language, your own menus, extra plugins, Apex tools |

---

## Workbenches that wrap existing features

These workbenches are visual front-ends for features already documented elsewhere on this site. Follow the link for the underlying concepts, options and YAML keys.

| Workbench / Panel | What it drives | Underlying docs |
|---|---|---|
| User Story workflow | New User Story -> retrieve -> save and publish, without a terminal | [Create](salesforce-devops-create-new-user-story.md) / [Work](salesforce-devops-work-on-user-story.md) / [Publish](salesforce-devops-publish-user-story.md) |
| Documentation Workbench | Generate and publish AI-enriched project docs | [Generate Documentation](salesforce-project-documentation.md) |
| Monitoring Config Workbench | Edit triggers, frequency, channels per check | [Monitoring config](salesforce-monitoring-config-home.md) |
| Pipeline Settings | Configure deployment actions, auth, branches | [`.sfdx-hardis.yml`](sfdx-hardis-config-file.md) |
| Installed Packages Manager | Install/update packages and pin them in CI/CD | [Install packages](salesforce-devops-work-on-user-story-install-packages.md) |
| Backpromote | Bring what was merged in a parent branch into your development org | [Backpromote](salesforce-devops-backpromote.md) |
| Flow Visual Git Diff | Side-by-side diagram of two Flow versions | [Flow Visual Git Diff](salesforce-deployment-agent-flow-visual-git-diff.md) |
| AI Assistant | Explain deployment errors, suggest fixes | [AI setup](salesforce-ai-setup.md) / [Prompts](salesforce-ai-prompts.md) |

---

## Source

The extension is Open-Source (AGPL-3.0): [github.com/hardisgroupcom/vscode-sfdx-hardis](https://github.com/hardisgroupcom/vscode-sfdx-hardis).

<!-- training-links:start -->

## Learn by doing

The free [Salesforce DevOps with sfdx-hardis](https://hardisgroupcom.github.io/sfdx-hardis-training) course does this, click by click, on an org of your own:

- [Lab 1.1 - Install VS Code, Git and sfdx-hardis](https://hardisgroupcom.github.io/sfdx-hardis-training/en/level-1-contributor-basics/1-1-install-vs-code-and-sfdx-hardis/)

<!-- training-links:end -->
