---
title: Configure Salesforce Org Monitoring with Azure
description: Learn how to configure a monitoring repository for a Salesforce Org, using sfdx-hardis and Azure
---
<!-- markdownlint-disable MD013 -->

- [Pre-requisites](#pre-requisites)
   - [Create access token](#create-access-token)
   - [Create CI/CD variable](#create-cicd-variable)
- [Run sfdx-hardis configuration command](#run-sfdx-hardis-configuration-command)
- [Define sfdx-hardis environment variables](#define-sfdx-hardis-environment-variables)
- [Schedule the monitoring job](#schedule-the-monitoring-job)

## Pre-requisites

### Configure a ByPass in Azure Settings

- Go to Project Settings –> Repositories –> select your repository and then click on the Security tab.

- Select your **Build Service** and set **Bypass policies when pushing** and **Contribute** to **Allowed**

![](assets/images/screenshot-azure-bypass-policies.png)

## Run sfdx-hardis configuration command

- Run command **Configuration -> Configure Org Monitoring** in VsCode SFDX Hardis, then follow instructions.

- **When prompted to setup CI/CD variables, copy-paste their names and values in a notepad the continue the instructions**

## Define sfdx-hardis environment variables

- Go to **Project -> Settings > CI/CD -> Variables** _(you must have Gitlab authorizations to access this menu)_
- For each variable sfdx-hardis command **Configure org monitoring** tells you to define, create with name and value given in sfdx-hardis command logs

## Schedule the monitoring job

- Go to **Project -> Build -> Pipeline schedules**
- Click on **New schedule**
- Input custom interval pattern as [CRON expression](https://crontab.cronhub.io/){target=blank}, for example:
  - `0 1 * * *` will run the monitoring job **every day at 1 AM**
  - `0 22 * * *` will run the monitoring job **everyday at 10 PM**
- Select the CRON TimeZone (for example `[UTC+2] Paris`)
- Select the target branch corresponding to the org you want to monitor
- Validate by clicking on **Create Pipeline Schedule**

