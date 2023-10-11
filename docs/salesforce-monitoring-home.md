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
  - [Gitlab](salesforce-monitoring-config-gitlab.md)
  - [Azure](salesforce-monitoring-config-azure.md)
  - [Bitbucket](salesforce-monitoring-config-bitbucket.md)

You might want to customize which metadatas are backuped.
In that case, you must manually update file `manifest/package-skip-items.xml` in each git branch corresponding to an org, then commit and push.


