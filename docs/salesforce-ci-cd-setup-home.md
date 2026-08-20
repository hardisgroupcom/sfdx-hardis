---
title: Setup a Salesforce CI/CD Project
description: How to set up a sfdx-hardis CI/CD pipeline on a new or existing Salesforce project, step by step
---
<!-- markdownlint-disable MD013 -->

## Setup Guide

This guide takes you from an empty Git repository to a working CI/CD pipeline, with a first Pull Request validated and deployed. Count one to three days for a first setup, depending on your Git platform and the state of your production org.

![CI/CD branch and org schema](assets/images/ci-cd-schema-main.jpg){ align=center }

---

### Prerequisites

- Basic knowledge of Git and Salesforce DX. If you are new to them, these resources are a good start: [Learn Git Branching](https://learngitbranching.js.org/) and the [Salesforce DX Trailmix](https://trailhead.salesforce.com/users/manueljohnson/trailmixes/sfdx).
- [The tools installed on your computer](salesforce-ci-cd-use-install.md): VS Code, the SFDX Hardis extension and its dependencies.
- An account on a Git platform (GitHub, GitLab, Azure DevOps, Bitbucket or Gitea) with CI runner minutes, or a Jenkins server.
- Administrator access to the Salesforce production org.

---

### Setup steps

1. [**Create the Git repository**](salesforce-ci-cd-setup-git.md): create the repository and the major branches (`main`, `preprod`, `uat`, `integration`...), protect them and define the merge rules.
2. [**Prepare the Salesforce orgs**](salesforce-ci-cd-setup-activate-org.md): activate Dev Hub and source tracking, create one sandbox per major branch.
3. [**Initialize the SFDX project**](salesforce-ci-cd-setup-init-project.md): generate the project structure and the CI/CD workflow files with `sf hardis:project:create`.
4. [**Configure CI authentication**](salesforce-ci-cd-setup-auth.md): let the CI server connect to each major org with an External Client App and a JWT certificate.
5. [**Retrieve an existing org**](salesforce-ci-cd-setup-existing-org.md) _(optional)_: bring the metadata of an existing production org into the repository, then clean it.
6. [**Create the first Pull Request**](salesforce-ci-cd-setup-merge-request.md): merge the setup branch and get the validation jobs green.

Then:

- [**Configure the integrations**](salesforce-ci-cd-setup-integrations-home.md): Pull Request comments, Slack or Teams notifications, Jira or Azure Boards, AI.
- [**Configure the project**](salesforce-ci-cd-config-home.md): overwrite management, delta deployments, automated cleaning and the other `.sfdx-hardis.yml` settings.
- [**Publish job artifacts**](salesforce-ci-cd-setup-publish-artifacts.md): keep the detailed deployment reports after the jobs end (already done in recent pipeline templates).
- [**Go through the setup checklist**](salesforce-ci-cd-setup-checklist.md): a complete list of what must be in place before the team starts.

---

### Need help?

[Cloudity](https://cloudity.com/), the company behind sfdx-hardis, offers an [assisted setup and a full setup service](salesforce-ci-cd-home.md#get-help-from-cloudity). Community support is available through [GitHub issues](https://github.com/hardisgroupcom/sfdx-hardis/issues).
