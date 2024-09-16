---
title: : Can not delete custom field (Deployment assistant)
description: How to solve Salesforce deployment error /This (.*) is referenced elsewhere in salesforce.com/gm
---
<!-- markdownlint-disable MD013 -->
# Can not delete custom field

## Detection

- RegExp: `This (.*) is referenced elsewhere in salesforce.com`
- RegExp: `Le champ personnalisé (.*) est utilisé dans (.*)`

## Resolution

```shell
Custom field {1} can not be deleted because it is used elsewhere. Remove its references ans try again
THIS MAY BE A FALSE POSITIVE if you are just testing the deployment, as destructiveChanges are deployed separately from updated items deployment check
```
