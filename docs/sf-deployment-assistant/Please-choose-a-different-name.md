---
title: "Please choose a different name (Deployment assistant)"
description: "How to solve Salesforce deployment error \"Error (.*) This (.*) already exists or has been previously used(.*)Please choose a different name.\""
---
<!-- markdownlint-disable MD013 -->
# Please choose a different name

## Detection

- RegExp: `Error (.*) This (.*) already exists or has been previously used(.*)Please choose a different name.`

## Resolution

```shell
- Rename {1} in the target org, then try again the deployment. if it succeeds, delete the renamed item.
- or Delete {1} in the target org, then try again the deployment

```
