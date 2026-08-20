---
title: Configure Salesforce CPQ management on a Salesforce CI/CD Project
description: Learn how to deploy Salesforce CPQ configuration with sfdx-hardis and SFDMU data workspaces
---
<!-- markdownlint-disable MD013 -->

## Salesforce CPQ deployments

Salesforce CPQ configuration (products, price rules, quote templates...) is stored as records, not as metadata. sfdx-hardis deploys it as data: the configuration is exported from the source org and imported into the target org with [SFDMU](https://help.sfdmu.com/) data workspaces, which can run automatically as [deployment actions](salesforce-ci-cd-work-on-task-deployment-actions.md#import-data-sfdmu).

When you build the SFDMU workspaces for CPQ:

- Complete the queries with your custom fields, so they are exported and imported too.
- Replace the `Name` external ID by custom external ID fields, so records are matched reliably between orgs.
