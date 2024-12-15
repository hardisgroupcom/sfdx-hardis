---
title: "Record Type not found (Deployment assistant)"
description: "How to solve Salesforce deployment error \"Error (.*) In field: recordType - no RecordType named (.*) found\""
---
<!-- markdownlint-disable MD013 -->
# Record Type not found

## Detection

- RegExp: `Error (.*) In field: recordType - no RecordType named (.*) found`

## Resolution

```shell
An unknown record type {2} is referenced in {1}
- If record type {2} is not supposed to exist, perform a search in all files of {1}, then remove matching XML elements referring to this record type
- If record type {2} is supposed to exist, you may have to create it manually in the target org to make the deployment pass

```
