---
title: How to monitor your Salesforce Org
description: Monitor your Salesforce orgs with daily metadata backup and more, with open source only
---
<!-- markdownlint-disable MD013 -->

- [Monitor your Salesforce org with sfdx-hardis](#monitor-your-salesforce-org-with-sfdx-hardis)
- [How does it work ?](#how-does-it-work--)
- [All Monitoring Commands](#all-monitoring-commands)

## Monitor your Salesforce org with sfdx-hardis

> This feature worked yesterday in production, but today it crashes, what happened ?

_Instead of reading, watch the [presentation at Dreamforce 24](https://reg.salesforce.com/flow/plus/df24/sessioncatalog/page/catalog/session/1718915808069001Q7HH) conference in San Francisco !_

<div style="text-align:center"><iframe width="560" height="315" src="https://www.youtube.com/embed/NxiLiYeo11A" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>

_or if you like reading, here are the slides !_

<div style="text-align:center"><iframe src="https://www.slideshare.net/slideshow/embed_code/key/jxxBlqw7iup8Gh?hostedIn=slideshare&page=upload" width="476" height="400" frameborder="0" marginwidth="0" marginheight="0" scrolling="no"></iframe></div>

Salesforce provide **Audit Trail** to trace configuration updates in **production** or **sandbox** orgs.

You can **know who updated what**, but not with details (before / after).

Sfdx-hardis monitoring provides a **simple way to know the exact state of your orgs metadatas everyday**, or even several times a day, and provides an **exact and detailed comparison with the previous metadata configuration** (using git commits comparison)

Extra indicators are also available out of the box, like:

- Run **apex tests** (and soon flow tests)
- Analyze the **quality and the security of your metadatas** with [MegaLinter](https://megalinter.io/latest/)
- Checking org limits
- Be warned of release updates
- Check if you have [**deprecated api versions called**](https://nicolas.vuillamy.fr/handle-salesforce-api-versions-deprecation-like-a-pro-335065f52238)
- **Custom command lines** that you can [define in `.sfdx-hardis.yml`](https://sfdx-hardis.cloudity.com/hardis/org/monitor/all/)

You don't need to work in CI/CD to use Monitoring, it is **compliant with any API enabled org** :)

Installation and usage are **admin-friendly**, and **notifications** can be sent via **Slack** or **Microsoft Teams**.

_Example of visualization in Grafana_

![](assets/images/grafana-screenshot.png)

![](assets/images/grafana-screenshot-2.png)

_Example notifications with Slack_

![](assets/images/screenshot-slack-monitoring.jpg)

_Example of a monitoring git repository_

![](assets/images/screenshot-monitoring-git.jpg)

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

In order to avoid to overflow channels of notifications, some commands are run everyday whereas less critical ones are run weekly (on saturday).

You can force the daily run of all commands by defining env var `MONITORING_IGNORE_FREQUENCY=true`.

| Check                                                                                                              | Frequency |
|--------------------------------------------------------------------------------------------------------------------|-----------|
| [Metadata Backup](salesforce-monitoring-metadata-backup.md)                                                        | Daily     |
| [Detect suspect setup actions in major org](salesforce-monitoring-suspect-audit-trail.md)                          | Daily     |
| [Apex tests](salesforce-monitoring-apex-tests.md)                                                                  | Daily     |
| [Quality Checks with MegaLinter](salesforce-monitoring-quality-checks.md)                                          | Daily     |
| [Detect limits issues](salesforce-monitoring-org-limits.md)                                                        | Daily     |
| [Detect calls to deprecated API versions](salesforce-monitoring-deprecated-api-calls.md)                           | Daily     |
| [Detect inactive users](salesforce-monitoring-inactive-users.md)                                                   | Weekly    |
| [Detect unused licenses](salesforce-monitoring-unused-licenses.md)                                                 | Weekly    |
| [Detect custom elements with no access rights defined in permission sets](salesforce-monitoring-missing-access.md) | Weekly    |
| [Detect custom labels and custom permissions that are not in use](salesforce-monitoring-unused-metadata.md)        | Weekly    |
| [Detect inactive metadata](salesforce-monitoring-inactive-metadata.md)                                             | Weekly    |
| [Detect missing attributes](salesforce-monitoring-missing-metadata-attributes.md)                                  | Weekly    |


