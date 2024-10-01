---
title: Missing Sales Team (Deployment assistant)
description: How to solve Salesforce deployment error related list:RelatedAccountSalesTeam
---
<!-- markdownlint-disable MD013 -->
# Missing Sales Team

## Detection

- String: `related list:RelatedAccountSalesTeam`

## Resolution

```shell
Account Teams must be activated in the target org.
- Org: Setup -> Account Teams -> Enable
- Scratch org setting:
"accountSettings": {
  "enableAccountTeams": true
}
}
```
