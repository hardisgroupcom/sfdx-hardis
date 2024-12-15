---
title: "Tableau CRM / Wave digest error (Deployment assistant)"
description: "How to solve Salesforce deployment error "Fix the sfdcDigest node errors and then upload the file again""
---
<!-- markdownlint-disable MD013 -->
# Tableau CRM / Wave digest error

## Detection

- String: `Fix the sfdcDigest node errors and then upload the file again`

## Resolution

```shell
Go to the target org, open profile "Analytics Cloud Integration User" and add READ rights to the missing object fields 
```
