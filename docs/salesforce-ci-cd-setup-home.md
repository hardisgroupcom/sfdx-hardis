---
title: Setup a Salesforce CI/CD Project
description: Learn how setup a CI/CD pipeline on a new or existing Salesforce project
---
<!-- markdownlint-disable MD013 -->

- [Initialize sfdx project](#initialize-sfdx-project)
- [Configure sfdx project](#configure-sfdx-project)
- [Configure authentication for CI jobs](#configure-authentication-for-ci-jobs)
- [MsTeams notifications](#msteams-notifications) _(optional)_

___

## Initialize sfdx project

- Run `sfdx hardis:project:create` and follow instructions

- If this not a new project, see [initialize sfdx project from a Salesforce org](salesforce-ci-cd-setup-existing-org.md)

__

## Configure SFDX project

Once initialized, you must [configure the CI/CD project](salesforce-ci-cd-config-home.md)

___

## Configure authentication for CI jobs

To automate [deployments from major branches to their related org](salesforce-ci-cd-deploy-major-branches/), you need to configure the secure authentication from CI server to a SF connected app.

Note: _You need [openssl](https://www.openssl.org/) installed on your computer (available in `Git bash`)_

- Run the following command and follow instructions

```shell
sfdx hardis:project:configure:auth
```

- Alternative for DevHub

```shell
sfdx hardis:project:configure:auth --devhub
```

> ![Under the hood](assets/images/engine.png) **_Under the hood_**
>
> This command will create/update:
>
> - .sfdx-hardis.yml configuration file (repo)
> - Self signed certificate (encrypted in repo)
> - Connected App (uploaded to org via metadata api)
> - CI environment variables (manually set in CI/CD server UIs)

___

## MsTeams notifications

In case suspiscious results are found (failures, critical updates to come...), sfdx-hardis can send notifications to Microsoft Teams channels.

You can define hooks using env variables:

- MS_TEAMS_WEBHOOK_URL _(Used by default if no level hooks are defined)_
- MS_TEAMS_WEBHOOK_URL_CRITICAL
- MS_TEAMS_WEBHOOK_URL_SEVERE
- MS_TEAMS_WEBHOOK_URL_WARNING
- MS_TEAMS_WEBHOOK_URL_INFO

Ex: `MS_TEAMS_WEBHOOK_URL_CRITICAL=https://mycompany.webhook.office.com/webhookb2/f49c28c6-d10b-412c-b961-fge456bd@c1a7fa9b-90b3-49ab-b5e2-345HG88c/IncomingWebhook/b43c20SDSGFG56712d848bc1cebb17/53ee2e22-a867-4e74-868a-F3fs3935`

