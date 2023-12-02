---
title: How to monitor your Salesforce Org
description: Monitor your Salesforce orgs with daily metadata backup and more, with open source only
---
<!-- markdownlint-disable MD013 -->

- [Monitor your Salesforce org with sfdx-hardis](#monitor-your-salesforce-org-with-sfdx-hardis)
- [How does it work ?](#how-does-it-work--)
- [All Monitoring Commands](#other-monitoring-commands)
  - [Metadata Backup](#metadata-backup)
  - [Apex tests](#apex-tests)
  - [Quality Checks with MegaLinter](#quality-checks-with-megalinter)
  - [Detect suspect setup actions in major org](#detect-suspect-setup-actions-in-major-org)
  - [Detect calls to deprecated API versions](#detect-calls-to-deprecated-api-versions)
  - [Detect custom elements with no access rights defined in permission sets](#detect-custom-elements-with-no-access-rights-defined-in-permission-sets)
  - [Detect custom labels and custom permissions that are not in use](#detect-custom-labels-and-custom-permissions-that-are-not-in-use)
  - [Detect inactive metadata](#detect-inactive-metadata)
  - [Detect missing attributes](#detect-missing-attributes)

## Monitor your Salesforce org with sfdx-hardis

> This feature worked yesterday in production, but today it crashes, what happened ?

Salesforce provide **Audit Trail** to trace configuration updates in **production** or **sandbox** orgs.

You can **know who updated what**, but not with details (before / after).

Sfdx-hardis monitoring provides a **simple way to know the exact state of your orgs metadatas everyday**, or even several times a day, and provides an **exact and detailed comparison with the previous metadata configuration** (using git commits comparison)

Installation and usage are **admin-friendly**, and **notifications** can be sent via **Slack** or **Microsoft Teams**.

_Example of a monitoring git repository_

![](assets/images/screenshot-monitoring-git.jpg)

_Example notifications with Slack_

![](assets/images/screenshot-slack-monitoring.jpg)

Extra features are also available, like:

- Run **apex tests** (and soon flow tests)
- Analyze the **quality and the security of your metadatas** with [MegaLinter](https://megalinter.io/latest/)
- Check if you have [**deprecated api versions called**](https://nicolas.vuillamy.fr/handle-salesforce-api-versions-deprecation-like-a-pro-335065f52238)
- **Custom command lines** that you can [define in `.sfdx-hardis.yml`](https://sfdx-hardis.cloudity.com/hardis/org/monitor/all/)

You don't need to work in CI/CD to use Monitoring, it is **compliant with any API enabled org** :)

## How does it work ?

Every night (or even more frequently, according to your schedule), a CI job will be triggered.

It will **extract all the metadatas of your org**, then push a **new commit in the monitoring repository** in case there are updates since the latest metadata backup.

![](assets/images/monitoring-architecture.jpg)

_Example workflow with GitHub actions_

![](assets/images/screenshot-monitoring-jobs.jpg)

_Example diff visualization with GitLens_

![](assets/images/screenshot-monitoring-backup.jpg)

The **list of updated metadatas** will be sent via notification to a **Slack and/or Microsoft Teams channel**.

After the metadata backup, other jobs will be triggered (Apex tests, Code Quality, Legacy API checks + your own commands), and their results will be stored in job artifacts and sent via notifications.

Are you ready ? [Configure the monitoring on your orgs](salesforce-monitoring-config-home.md) !

## All Monitoring Commands

The following checks are active out of the box.

### Metadata Backup

Adds a new commit in the git branch with the newest updates since latest monitoring run.

Sfdx-hardis command: [sfdx hardis:org:monitor:backup](https://sfdx-hardis.cloudity.com/hardis/org/monitor/backup/)

![](assets/images/screenshot-monitoring-backup2.jpg)

### Apex tests

Runs all local test classes of the org and calculate coverage.

Sfdx-hardis command: [sfdx hardis:org:test:apex](https://sfdx-hardis.cloudity.com/hardis/org/test/apex/)

![](assets/images/screenshot-monitoring-apextests.jpg)

___

### Quality Checks with MegaLinter

Will check if best practices are applied for:

- Apex with PMD
- LWC & Aura with eslint
- Flows with Lightning Flow Scanner
- Security with checkov, gitleaks, secretlint, trivy...

Full list in [MegaLinter Documentation](https://megalinter.io/latest/flavors/salesforce/)

![](assets/images/screenshot-monitoring-megalinter.jpg)

___

### Detect suspect setup actions in major org

Will extract from audit trail all actions that are considered as suspect, excepted the ones related to the deployment user and a given list of users, like the release manager.

Sfdx-hardis command: [sfdx hardis:org:diagnose:audittrail](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/audittrail/)

Key: **AUDIT_TRAIL**

![](assets/images/screenshot-monitoring-audittrail.jpg)

___

### Detect calls to deprecated API versions

Will check if [legacy API versions are called by external tools](https://nicolas.vuillamy.fr/handle-salesforce-api-versions-deprecation-like-a-pro-335065f52238).

Sfdx-hardis command: [sfdx hardis:org:diagnose:legacyapi](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/legacyapi/)

Key: **LEGACY_API**

![](assets/images/screenshot-monitoring-legacyapi.jpg)

___

### Detect custom elements with no access rights defined in permission sets

If there are elements that nobody has access to, maybe they should be removed !

Sfdx-hardis command: [sfdx hardis:lint:access](https://sfdx-hardis.cloudity.com/hardis/lint/access/)

Key: **LINT_ACCESS**

![](assets/images/screenshot-monitoring-lintaccess.jpg)

___

### Detect custom labels and custom permissions that are not in use

If there are elements that are not used by anything, maybe they should be removed !

Sfdx-hardis command: [sfdx hardis:lint:unusedmetadatas](https://sfdx-hardis.cloudity.com/hardis/lint/unusedmetadatas/)

Key: **UNUSED_METADATAS**

![](assets/images/screenshot-monitoring-unused-metadatas.jpg)

___

### Detect inactive metadata

Are you sure this inactive flow should be inactive ?

Sfdx-hardis command: [sfdx hardis:lint:metadatastatus](https://sfdx-hardis.cloudity.com/hardis/lint/metadatastatus/)

Key: **METADATA_STATUS**

![](assets/images/screenshot-monitoring-inactive-metadata.jpg)

___

### Detect missing attributes

Follow best practices by documenting your data model !

Sfdx-hardis command: [sfdx hardis:lint:missingattributes](https://sfdx-hardis.cloudity.com/hardis/lint/missingattributes/)

Key: **MISSING_ATTRIBUTES**

![](assets/images/screenshot-monitoring-missing-attributes.jpg)

### Detect unused licenses

When you assign a Permission Set to a user, and that this Permission Set is related to a Permission Set License, a Permission Set License Assignment is automatically created for the user.

But when you unassign this Permission Set from the user, **the Permission Set License Assignment is not deleted**.

This leads that you can be **charged for Permission Set Licenses that are not used** !

This command detects such useless Permission Set Licenses Assignments and suggests to delete them.

Many thanks to [Vincent Finet](https://www.linkedin.com/in/vincentfinet/) for the inspiration during his great speaker session at [French Touch Dreamin '23](https://frenchtouchdreamin.com/), and his kind agreement for reusing such inspiration in this command :)


Sfdx-hardis command: [sfdx hardis:org:diagnose:unusedlicenses](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unusedlicenses/)

Key: **UNUSED_LICENSES**

![](assets/images/screenshot-monitoring-missing-attributes.jpg)

