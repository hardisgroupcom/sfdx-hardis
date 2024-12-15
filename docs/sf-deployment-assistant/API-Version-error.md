---
title: "API Version error (Deployment assistant)"
description: "How to solve Salesforce deployment error /Error (.*) The (.*) apiVersion can't be "([0-9]+)""
---
<!-- markdownlint-disable MD013 -->
# API Version error

## Detection

- RegExp: `Error (.*) The (.*) apiVersion can't be "([0-9]+)"`

## Resolution

```shell
{1} metadata has probably been created/updated in a sandbox already upgraded to next platform version (ex: Sandbox in Summer'23 and Production in Spring'23)
- First, try to update the api version in the XML of {1} metadata file (decrement the number in <apiVersion>{3}.0</apiVersion>)
- If it still doesn't work because the metadata structure has changed between version, you may try a sf project:retrieve:start of the metadata by forcing --api-version at the end of the command.
      
```
