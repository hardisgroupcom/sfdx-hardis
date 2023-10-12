---
title: How to monitor your Salesforce Org
description: Learn how to configure a monitoring repository for a Salesforce Org, using sfdx-hardis, then how to read reports
---
<!-- markdownlint-disable MD013 -->

## Configuration

All you need to configure sfdx-hardis Org Monitoring is a **GitHub** , **Gitlab**, **Azure** or **BitBucket** repository.

- Create an empty repository, then clone it locally

- Follow instructions, that can be specific according to your git provider

  - [GitHub](salesforce-monitoring-config-github.md)
    - [Pre-requisites](salesforce-monitoring-config-github.md#pre-requisites)
    - [Schedule monitoring job](salesforce-monitoring-config-github.md#schedule-the-monitoring-job)

  - [Gitlab](salesforce-monitoring-config-gitlab.md)
    - [Pre-requisites](salesforce-monitoring-config-gitlab.md#pre-requisites)
    - [Schedule monitoring job](salesforce-monitoring-config-gitlab.md#schedule-the-monitoring-job)

  - [Azure](salesforce-monitoring-config-azure.md)
    - [Pre-requisites](salesforce-monitoring-config-azure.md#pre-requisites)
    - [Schedule monitoring job](salesforce-monitoring-config-azure.md#schedule-the-monitoring-job)

  - [Bitbucket](salesforce-monitoring-config-bitbucket.md)
    - [Pre-requisites](salesforce-monitoring-config-bitbucket.md#pre-requisites)
    - [Schedule monitoring job](salesforce-monitoring-config-bitbucket.md#schedule-the-monitoring-job)

> You might want to customize which metadatas are backuped.
> In that case, you must manually update file `manifest/package-skip-items.xml` in each git branch corresponding to an org, then commit and push.


