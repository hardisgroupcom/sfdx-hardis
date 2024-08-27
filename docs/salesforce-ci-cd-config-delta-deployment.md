---
title: Configure delta deployments on a Salesforce CI/CD Project
description: Learn how to configure Delta Deployments using sfdx-git-delta on a sfdx-hardis CI/CD Project
---
<!-- markdownlint-disable MD013 -->

- [Delta deployments](#delta-deployments)
  - [Full mode](#full-mode)
  - [Delta mode](#delta-mode)
- [Configuration](#configuration)
  - [Base](#base)
  - [Advanced](#advanced)

___

## Delta deployments

### Full mode

By default, all deployments job (check deploy & process deploy) deploy the **full content of the `package.xml` minus what is matching `package-no-overwrite.xml`** (formerly `packageDeployOnce.xml`)

![](assets/images/ci-cd-schema-delta-off.jpg)

This is the safest way to deploy at each level

- major to major
- minor to major

___

### Delta mode

In order to improve performances on project with large metadata base, you can **activate delta deployments** for Pull Request/Merge Requests **from a minor branch** (examples: `feature/xxx`, `debug/xxx`) **to a major branch** (ex: `integration`, `uat`, `preprod`, `production`: sfdx-hardis will **deploy only updated metadatas** in the Pull Request / Merge Request.

![](assets/images/ci-cd-schema-delta.jpg)

![](assets/images/screenshot-delta-deployment.jpg)

**Merge Requests / Pull Request between major branches** (ex: uat to preprod) **remains in full deployment mode**, to avoid issues with configuration which would have been done directly in the orgs (whereas it shouldn't be, except for Reports, Dashboards and a few metadata types)

Examples:

- **features/config/my-work to integration** will be **DELTA** DEPLOYMENT
- **integration to uat** will be **FULL** DEPLOYMENT
- **hotfixes/fix-stuff to preprod** will be **DELTA** DEPLOYMENT
- **preprod to production** will be **FULL** DEPLOYMENT

> 💡 If you want to **force the use of full deployment for a PR/MR** on a delta project, add "**nodelta**" in your latest commit title or text.

___

## Configuration

### Base

To activate delta deployments,you can:

- define `useDeltaDeployment: true` in **config/.sfdx-hardis.yml**
- define env variable `USE_DELTA_DEPLOYMENT=true`

In case of temporary deactivation of delta deployments, you can set variable `DISABLE_DELTA_DEPLOYMENT=true`, it has priority on other configurations.

> 💡If your sfdx-hardis installation is from before 4.10.0, you might need to update your CI/CD workflows
>
> Check updated versions in [sfdx-hardis sources](https://github.com/hardisgroupcom/sfdx-hardis/tree/main/defaults/ci)

It is recommended to use opinionated default sfdx-hardis delta deployment configuration, but if you want to tweak the config you can use the following variables:

### Advanced

- USE_DELTA_DEPLOYMENT_AFTER_MERGE
  - By default, after a merge sfdx-hardis will try to use [QuickDeploy](salesforce-ci-cd-setup-integrations-home.md#git-providers). If not available, it will perform a full deployment. If you want to use a delta deployment anyway, define `USE_DELTA_DEPLOYMENT_AFTER_MERGE=true`

- ALWAYS_ENABLE_DELTA_DEPLOYMENT
  - By default, delta deployment is allowed only from minor to major branches. You can force it for PR/MRs between major branches by defining variable `ALWAYS_ENABLE_DELTA_DEPLOYMENT=true`