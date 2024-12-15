---
title: "Formula picklist field issue (Deployment assistant)"
description: "How to solve Salesforce deployment error Les champs de liste de sélection sont pris en charge uniquement dans certaines fonctions."
---
<!-- markdownlint-disable MD013 -->
# Formula picklist field issue

## Detection

- String: `Les champs de liste de sélection sont pris en charge uniquement dans certaines fonctions.`

## Resolution

```shell
You probably changed the type of a field that is used in a formula.
Update the formula to use a field compliant with formulas.
More details at https://help.salesforce.com/articleView?id=sf.tips_on_building_formulas.htm&type=5
```
