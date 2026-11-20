---
title: "Missing feature ContactToMultipleAccounts (Deployment assistant)"
description: "How to solve Salesforce deployment error \"no CustomObject named AccountContactRelation found\""
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

## Deployment action

A deployment action can solve this error. Create it on the Pull Request of the current branch:

```shell
sf hardis:project:action:create --agent --scope pr --pr-id current --when pre-deploy --type browser --label "Enable Contacts to Multiple Accounts" --browser-setting relateContactToMultipleAccounts --browser-config '{"enabled":true}'
```

A deployment check only simulates a browser action. If this check still fails on this error once the action is created, apply the setting once in the target org with the Run in another org button of the VS Code Deployment Actions tab, or with sf hardis:project:action:run --select-org, then run the check again.

Documentation: https://amtrack.github.io/sfdx-browserforce-plugin/settings/relateContactToMultipleAccounts/
