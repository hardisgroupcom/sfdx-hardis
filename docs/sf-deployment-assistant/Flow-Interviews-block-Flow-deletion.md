---
title: "Flow Interviews block Flow deletion (Deployment assistant)"
description: "How to solve Salesforce deployment error \"Flow Interview - \""
---
<!-- markdownlint-disable MD013 -->
# Flow Interviews block Flow deletion

## Detection

- String: `Flow Interview - `

## Resolution

```shell
A Flow version can not be deleted because Flow Interviews are still running on it.
- To let sfdx-hardis delete these Flow Interviews before deleting the Flow, set FLOW_DELETE_INTERVIEWS=true (or add FLOW_DELETE_INTERVIEWS on its own line in your Pull Request description, or set flowDeleteInterviews: true in .sfdx-hardis.yml)
- Caution: deleting Flow Interviews is irreversible and destroys in-flight process state
```
