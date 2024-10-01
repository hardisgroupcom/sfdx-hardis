---
title: Picklist value not found (Deployment assistant)
description: How to solve Salesforce deployment error /Picklist value: (.*) in picklist: (.*) not found/gm
---
<!-- markdownlint-disable MD013 -->
# Picklist value not found

## Detection

- RegExp: `Picklist value: (.*) in picklist: (.*) not found`

## Resolution

```shell
Sources have references to value {1} of picklist {2}
- If picklist {2} is standard, add the picklist to sfdx sources by using "sf project retrieve start -m StandardValueSet:{2}", then save again
- Else, perform a search in all code of {1}, then remove XML tags referring to {1} (for example in record types metadatas)

```
