---
title: Configure Salesforce Org Monitoring with Gitlab
description: Learn how to configure a monitoring repository for a Salesforce Org, using sfdx-hardis and Gitlab
---
<!-- markdownlint-disable MD013 -->

- [Pre-requisites](#pre-requisites)
   - [Create access token](#create-access-token)
   - [Create CI/CD variable](#create-cicd-variable)
- [Run sfdx-hardis configuration command](#run-sfdx-hardis-configuration-command)
- [Define sfdx-hardis environment variables](#define-sfdx-hardis-environment-variables)
- [Schedule the monitoring job](#schedule-the-monitoring-job)

## Pre-requisites

### Create access token

- Go to **Project -> Settings > Access Token** _(you must have Gitlab authorizations to access this menu)_
- Create an access token with the following info:
  - name: **SFDX HARDIS MONITORING**
  - role: **Developer**
  - scopes: **read_repository, write_repository**
- Copy the value of the generated token in your clipboard ! (CTRL+C)

### Create CI/CD variable

- Go to **Project -> Settings > CI/CD -> Variables** _(you must have Gitlab authorizations to access this menu)_
- Create an access token with the following info:
  - name: **ACCESS_TOKEN**
  - value: Paste the value that has been generated when creating the access token in the previous step
  - Select **Mask variable**
  - Unselect **Protected variable**

## Run sfdx-hardis configuration command

- Run command **Configuration -> Configure Org Monitoring** in VsCode SFDX Hardis, then follow instructions.

## Define sfdx-hardis environment variables

- Go to **Project -> Settings > CI/CD -> Variables** _(you must have Gitlab authorizations to access this menu)_
- For each variable sfdx-hardis command **Configure org monitoring** tells you to define, create with name and value given in sfdx-hardis command logs

## Schedule the monitoring job


