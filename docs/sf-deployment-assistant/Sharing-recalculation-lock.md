---
title: Sharing recalculation lock (Deployment assistant)
description: How to solve Salesforce deployment error because it interferes with another operation already in progress
---
<!-- markdownlint-disable MD013 -->
# Sharing recalculation lock

## Detection

- String: `because it interferes with another operation already in progress`
- String: `Le calcul de partage demandé ne peut être traité maintenant car il interfère avec une autre opération en cours`

## Resolution

```shell
If you changed a field from MasterDetail to Lookup, you must do it manually in the target org before being able to deploy
```
