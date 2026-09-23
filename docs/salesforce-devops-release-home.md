---
title: Salesforce CI/CD Release Manager Guide
description: The responsibilities and tools of a release manager on a Salesforce CI/CD project with sfdx-hardis, from Pull Request review to production deployments
---
<!-- markdownlint-disable MD013 -->

## Release Manager Guide

DevOps practices work best when one or two team members take the role of **release manager**. They own the pipeline, the branches and the orgs, and they help the other contributors. On small projects, a tech lead or a senior admin plays this role part time.

![DevOps Pipeline](assets/images/devops-pipeline.png)

---

### Responsibilities

- **Support the team**: train and help the contributors with the [Contributor Guide](salesforce-devops-use-home.md), and answer their questions about branches and orgs.
- **Provide orgs**: create and refresh the [source-tracked dev sandboxes](salesforce-devops-create-new-user-story.md#source-tracked-sandbox) that contributors work in (one per contributor, or shared by several of them), and the sandboxes of the major branches.
- [**Review and merge Pull Requests**](salesforce-devops-validate-merge-request.md): check the validation jobs, solve conflicts, merge into the major branches.
- [**Deploy to major orgs**](salesforce-devops-deploy-major-branches.md): promote the changes from `integration` to `uat`, `preprod` and production with Pull Requests between major branches.
- [**Handle hotfixes**](salesforce-devops-hotfixes.md): ship an urgent fix to production through the RUN stream.
- [**Retrofit**](salesforce-devops-retrofit.md): bring what reached production back into the BUILD branches, so the next version does not undo it.
- [**Assemble a promotion branch** (Beta)](salesforce-devops-promotion-branches.md): when only some of the User Stories of `uat` are approved, ship them alone without losing their deployment actions.
- [**Generate Release Notes**](hardis/doc/salesforce-devops-release-notes.md): document the tickets, Pull Requests, metadata changes, deployment actions and contributors of a release.
- [**Follow DORA Metrics**](hardis/doc/salesforce-devops-dora-report.md): measure deployment frequency, lead time, change failure rate and time to restore.
- [**Configure the project**](salesforce-devops-config-home.md): package.xml, overwrite management, delta deployments, automated cleaning and the other `.sfdx-hardis.yml` settings.

---

### Your tools in VS Code

The **DevOps Pipeline** panel of the VS Code SFDX Hardis extension shows the branches, the orgs, the open Pull Requests with their validation jobs and the running deployments. Click a major branch to list the Pull Requests merged since the last promotion, their tickets and their deployment actions, and to generate the release notes.

![Pull Requests merged in a major branch](assets/images/screenshot-branch-pull-requests.jpg)

The **Pipeline Settings** panel edits the `.sfdx-hardis.yml` configuration with forms: deployment options, pre and post deployment commands, User Story options, ticketing, AI and Dev Hub settings.

![Global Pipeline Settings panel](assets/images/pipeline-config.png)

---

### Under the hood

To understand what the CI jobs do during a validation or a deployment, read [Smart Deploy internals](salesforce-devops-smart-deployment.md): delta computation, test selection, package installation, overwrite filtering, Quick Deploy, deployment actions and notifications.

---

### Special cases

- [Managed packages (ISV)](salesforce-devops-packaging.md): create and promote package versions with sfdx-hardis.
- [Conga Composer](salesforce-devops-conga.md): deploy Conga configuration.
- [Salesforce CPQ](salesforce-devops-cpq.md): deploy CPQ configuration as data.

<!-- training-links:start -->

## Learn by doing

The free [Salesforce DevOps with sfdx-hardis](https://hardisgroupcom.github.io/sfdx-hardis-training) course does this, click by click, on an org of your own:

- [Lab 3.11 - Capstone: run a weekly release cycle](https://hardisgroupcom.github.io/sfdx-hardis-training/en/level-3-release-manager/3-11-capstone-run-a-weekly-release-cycle/)

<!-- training-links:end -->
