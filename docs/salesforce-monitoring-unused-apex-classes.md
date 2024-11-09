---
title: Detect unused Apex Classes (Salesforce monitoring)
description: Schedule weekly checks of which Batch, Schedulable and Queueable classes are never called and could be deleted to improve Apex Test Classes performances
---
<!-- markdownlint-disable MD013 -->

## Detect unused Apex Classes

List all async Apex classes (Batch,Queueable,Schedulable) that has not been called for more than 365 days.
  
The result class list probably can be removed from the project, and that will improve your test classes performances :)

The command uses queries on AsyncApexJob and CronTrigger technical tables to build the result.

Sfdx-hardis command: [sf hardis:org:diagnose:unused-apex-classes](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unused-apex-classes/)

Key: **UNUSED_APEX_CLASSES***

### Grafana example

TODO

### Slack example

TODO