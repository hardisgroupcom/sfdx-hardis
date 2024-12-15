---
title: "Allow deployment with pending Apex Jobs (Deployment assistant)"
description: "How to solve Salesforce deployment error "You can bypass this error by allowing deployments with Apex jobs in the Deployment Settings page in Setup.""
---
<!-- markdownlint-disable MD013 -->
# Allow deployment with pending Apex Jobs

## Detection

- String: `You can bypass this error by allowing deployments with Apex jobs in the Deployment Settings page in Setup.`

## Resolution

```shell
Go to target org, in Setup -> Deployment Settings -> Activate option "Allow deployments of components when corresponding Apex jobs are pending or in progress."

```
