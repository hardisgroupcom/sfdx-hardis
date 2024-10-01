---
title: Couldn't retrieve or load information on the field (Deployment assistant)
description: How to solve Salesforce deployment error /Error (.*) Something went wrong. We couldn't retrieve or load the information on the field: (.*)\./gm
---
<!-- markdownlint-disable MD013 -->
# Couldn't retrieve or load information on the field

## Detection

- RegExp: `Error (.*) Something went wrong. We couldn't retrieve or load the information on the field: (.*)\.`

## Resolution

```shell
There is a reference to {2} in {1}, and {2} is not found. You can either:
- Commit {2} in your deployment sources and make sure it is named in package.xml
- Remove the reference to {2} in {1}

```
