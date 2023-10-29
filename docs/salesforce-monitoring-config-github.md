---
title: Configure Salesforce Org Monitoring with Github
description: Learn how to configure a monitoring repository for a Salesforce Org, using sfdx-hardis and Github Actions
---
<!-- markdownlint-disable MD013 -->

- [Pre-requisites](#pre-requisites)
- [Run sfdx-hardis configuration command](#run-sfdx-hardis-configuration-command)
- [Define sfdx-hardis environment variables](#define-sfdx-hardis-environment-variables)
- [Schedule the monitoring job](#schedule-the-monitoring-job)

## Pre-requisites

None

## Run sfdx-hardis configuration command

- Run command **Configuration -> Configure Org Monitoring** in VsCode SFDX Hardis, then follow instructions.

## Define sfdx-hardis environment variables

- Go to **Repository -> Settings > Secret and variables -> Actions** _(you must have Github authorizations to access this menu)_
- For each variable sfdx-hardis command **Configure org monitoring** tells you to define, click on **New repository secret**,  with name and value given in sfdx-hardis command logs

![](assets/images/screenshot-github-variables.png)

![](assets/images/screenshot-github-variables-add.png)

## Update org-monitoring.yml

- Open **.github/workflows/org-monitoring.yml** in VsCode and update all places where `MANUAL` is found
  - environment variables

Examples:

```yaml
      env:
        # MANUAL: Update variables below !
        SFDX_CLIENT_ID_MONITORING_MY_CLIENT__INTEG_SANDBOX: ${{ secrets.SFDX_CLIENT_ID_MONITORING_MY_CLIENT__INTEG_SANDBOX}}
        SFDX_CLIENT_KEY_MONITORING_MY_CLIENT__INTEG_SANDBOX: ${{ secrets.SFDX_CLIENT_KEY_MONITORING_MY_CLIENT__INTEG_SANDBOX}}
        SFDX_DEPLOY_WAIT_MINUTES: 120 # Override if necessary
```

- Commit and push

## Schedule the monitoring job

Schedule is already included within **org-monitoring.yml**.

Default is everyday at midnight, but you can update the [CRON expression](https://crontab.cronhub.io/).

```yaml
on:
  push:
  # Automatically run every day at midnight
  schedule:
    - cron: "0 0 * * *" # Cron format -> https://crontab.cronhub.io/
```