---
title: Salesforce CI/CD Contributor Guide
description: How to work on a Salesforce CI/CD project as an admin, a business analyst or a developer, from the first installation to the merged Pull Request
---
<!-- markdownlint-disable MD013 -->

## Contributor Guide

This guide is for everyone who makes changes in Salesforce on a CI/CD project: admins, business analysts, consultants and developers. You do not need to know Git or the Salesforce CLI. The VS Code SFDX Hardis extension asks you the questions and runs the commands for you.

![Project Contribution Workflow cards](assets/images/pipeline-contribution-cards.png)

---

### How it works

On a CI/CD project, nobody configures the integration, UAT or production orgs directly. Instead:

- Each **User Story** (a ticket, a feature, a fix) gets its own **Git branch** and its own **dev sandbox** or **scratch org**.
- You work in that org with Salesforce Setup or VS Code, as usual.
- When you are done, you publish your changes with a **Pull Request** (called Merge Request on GitLab). The CI server checks that they can be deployed and runs the Apex tests.
- The release manager merges the Pull Request, and the CI server deploys your changes to the next org (usually `integration`), then later to `uat`, `preprod` and production.

A few words you will meet everywhere in this guide:

| Term                         | Meaning                                                                                                                                   |
|------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------|
| **Major branch / major org** | A Git branch whose content is deployed by the CI server to a Salesforce org: `integration`, `uat`, `preprod`, `main` (production)...       |
| **User Story branch**        | Your own branch, created from a major branch, where your changes live until they are merged.                                              |
| **Dev sandbox / scratch org** | The org where you implement your User Story. Your release manager tells you which one to use.                                             |
| **Pull Request**             | The request to merge your branch into a major branch. It triggers the validation jobs and is reviewed by the release manager.             |
| **Release manager**          | The person who organizes the releases, reviews the Pull Requests and configures the project. Ask them when in doubt.                      |

---

### Get ready

To do once per computer, then once per project.

- [Install the tools](salesforce-ci-cd-use-install.md): VS Code, the SFDX Hardis extension and its dependencies (once per computer).
- [Create a Git access token](salesforce-ci-cd-git-tokens.md): the password-like key that lets VS Code talk to your Git platform.
- [Clone the repository](salesforce-ci-cd-clone-repository.md): get the project sources on your computer (once per project).

---

### Work on a User Story

1. [**Start a User Story**](salesforce-ci-cd-create-new-task.md): create your branch and select your org with the **New User Story** card.
2. [**Work in your org**](salesforce-ci-cd-work-on-task.md): configure and develop, following a few guidelines that keep deployments simple.
3. [**Publish your User Story**](salesforce-ci-cd-publish-task.md): retrieve your changes with the Metadata Retriever, commit them, then **Save / Publish**.
4. [**Create the Pull Request**](salesforce-ci-cd-publish-task.md#create-merge-request): on [GitHub](salesforce-ci-cd-pull-request-github.md), [GitLab](salesforce-ci-cd-merge-request-gitlab.md), [Azure DevOps](salesforce-ci-cd-pull-request-azure.md) or [Bitbucket](salesforce-ci-cd-pull-request-bitbucket.md).
5. [**Check the Pull Request results**](salesforce-ci-cd-handle-merge-request-results.md): read the comments posted by the CI server, and fix [deployment errors](salesforce-ci-cd-solve-deployment-errors.md) or [quality issues](salesforce-ci-cd-solve-megalinter-errors.md) if any.

Once the validation jobs are green, your release manager [reviews and merges the Pull Request](salesforce-ci-cd-validate-merge-request.md). On some projects, experienced contributors merge their own Pull Requests.

---

### Going further

- [Deployment actions](salesforce-ci-cd-work-on-task-deployment-actions.md): declare on your Pull Request the steps that must run before or after the deployment (data loads, Apex scripts, manual steps...).
- [Install packages](salesforce-ci-cd-work-on-task-install-packages.md): register the packages installed in your org so the CI server installs them in the other orgs.
- [Work with AI coding agents](salesforce-ci-cd-agent-skills.md): drive the same commands from Claude Code, GitHub Copilot or another coding agent.
- [Backpromote to your dev sandbox (Beta)](hardis/work/backpromote.md): bring the changes merged by your colleagues into your own sandbox.

---

### Video walkthrough

This recording shows the complete workflow. It was recorded with the previous interface of the extension: the screens have changed, the steps have not.

<div style="text-align:center"><iframe width="560" height="315" src="https://www.youtube.com/embed/zEYqTd2txU4" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>
