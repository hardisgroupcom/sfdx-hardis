---
title: "Not available for deploy for this organization (Deployment assistant)"
description: "How to solve Salesforce deployment error \"Error (.*) Not available for deploy for this organization\""
---
<!-- markdownlint-disable MD013 -->
# Not available for deploy for this organization

## Detection

- RegExp: `Error (.*) Not available for deploy for this organization`

## Resolution

```shell
The user you use for deployments probably lacks of the rights (Profiles, Permission sets...) to manage {1}.
- Assign the deployment user to the good Permission Sets, or modify its profile rights, then try again
```
