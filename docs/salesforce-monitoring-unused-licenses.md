---
title: Unused Licenses (Salesforce monitoring)
description: Schedule daily checks unused licenses with sfdx-hardis Monitoring
---
<!-- markdownlint-disable MD013 -->

## Detect unused licenses

When you assign a Permission Set to a user, and that this Permission Set is related to a Permission Set License, a Permission Set License Assignment is automatically created for the user.

But when you unassign this Permission Set from the user, **the Permission Set License Assignment is not deleted**.

This leads that you can be **charged for Permission Set Licenses that are not used** !

This command detects such useless Permission Set Licenses Assignments and suggests to delete them.

Many thanks to [Vincent Finet](https://www.linkedin.com/in/vincentfinet/) for the inspiration during his great speaker session at [French Touch Dreamin '23](https://frenchtouchdreamin.com/), and his kind agreement for reusing such inspiration in this command :)


Sfdx-hardis command: [sf hardis:org:diagnose:unusedlicenses](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unusedlicenses/)

Key: **UNUSED_LICENSES**

### Grafana example

![](assets/images/screenshot-monitoring-unused-licenses-grafana.jpg)

### Slack example

![](assets/images/screenshot-monitoring-unused-licenses.jpg)