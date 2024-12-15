---
title: "Custom field not found (Deployment assistant)"
description: "How to solve Salesforce deployment error Error PS_Admin In field: field - no CustomField named User.expcloud__Portal_Username__c found"
---
<!-- markdownlint-disable MD013 -->
# Custom field not found

## Detection

- RegExp: `Error (.*) In field: (.*) - no CustomField named (.*)\.(.*) found`

## Examples

- `Error PS_Admin In field: field - no CustomField named User.expcloud__Portal_Username__c found`

## Resolution

```shell
A reference to a custom field {3}.{4} is not found in {1}:
- If you renamed {3}.{4}, do a search/replace in {1} with previous field name and {4}
- If you deleted {3}.{4}, or if you don't want to deploy it, do a search on {4} in all sources, and remove all XML elements referring to {3}.{4} (except in destructiveChanges.xml)
- If {3}.{4} should exist, make sure it is in force-app/main/default/objects/{3}/fields and that {3}.{4} is in manifest/package.xml in CustomField section
- If {3}.{4} is standard, the error is because {3}.{4} is not available in the org you are trying to deploy to. You can:
  - Remove the reference to {4} in the XML of {1} ( maybe sf hardis:project:clean:references can clean automatically for you ! )
  - Activate the required features/license in the target org

```
