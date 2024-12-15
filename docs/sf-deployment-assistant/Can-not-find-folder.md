---
title: "Can not find folder (Deployment assistant)"
description: "How to solve Salesforce deployment error \"Error (.*) Cannot find folder:(.*)\""
---
<!-- markdownlint-disable MD013 -->
# Can not find folder

## Detection

- RegExp: `Error (.*) Cannot find folder:(.*)`

## Resolution

```shell
Folder {2} is missing.
- If folder {2} is existing in sources, add it in related package.xml
- If folder {2} is not existing in DX sources, please use sf hardis:project:clean:retrievefolders to retrieve it
- If both previous solutions did not work, go create manually folder {2} in target org

```
