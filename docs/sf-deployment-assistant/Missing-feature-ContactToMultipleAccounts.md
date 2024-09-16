---
title: : Missing feature ContactToMultipleAccounts (Deployment assistant)
description: How to solve Salesforce deployment error no CustomObject named AccountContactRelation found
---
<!-- markdownlint-disable MD013 -->
# Missing feature ContactToMultipleAccounts

## Detection

- String: `no CustomObject named AccountContactRelation found`
- String: `Invalid field:ACCOUNT.NAME in related list:RelatedContactAccountRelationList`

## Resolution

```shell
Contacts to multiple accounts be activated in the target org.
- Help: https://help.salesforce.com/articleView?id=sf.shared_contacts_set_up.htm&type=5
- Scratch org setting:
"features": ["ContactsToMultipleAccounts"]
```
