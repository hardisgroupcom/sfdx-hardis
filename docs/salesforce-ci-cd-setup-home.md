---
title: Setup a Salesforce CI/CD Project
description: Learn how setup a CI/CD pipeline on a new or existing Salesforce project
---
<!-- markdownlint-disable MD013 -->

- [Pre-requisites](#pre-requisites)
- [Setup steps](#setup-steps)

___

## Pre-requisites

- Training with Git and Salesforce DX
  - _If you don't have experience with them, here are links to learning resources_
    - [Git Tuto](https://learngitbranching.js.org/)
    - [SFDX Trailmix](https://trailhead.salesforce.com/fr/users/manueljohnson/trailmixes/sfdx)
- [Install necessary applications on your computer](salesforce-ci-cd-use-install.md)
- Access to a Git server (Gitlab, GitHub, Azure...) with CI/CD server minutes
- Access to a Salesforce production org

## Setup steps

- [Create git repository and configure branches](salesforce-ci-cd-setup-git.md)
- [Activate DevHub or Sandbox Tracking](salesforce-ci-cd-setup-activate-org.md)
- [Initialize sfdx project](salesforce-ci-cd-setup-init-project.md)
- [Configure authentication](salesforce-ci-cd-setup-auth.md)
- [Retrieve sources from an existing org](salesforce-ci-cd-setup-existing-org.md) _(optional)_
- [Configure Salesforce DX project](salesforce-ci-cd-config-home.md)
- [Integrations](salesforce-ci-cd-setup-integrations-home.md) _(optional)_
  - [Configure Microsoft Teams notifications](salesforce-ci-cd-setup-integration-ms-teams.md) _(optional)_
  - [Configure Gitlab to receive deployment results on on Merge Requests](salesforce-ci-cd-setup-integration-gitlab.md) _(optional)_
  - [Configure Azure Pipelines to receive deployment results on on Pull Requests](salesforce-ci-cd-setup-integration-azure.md) _(optional)_