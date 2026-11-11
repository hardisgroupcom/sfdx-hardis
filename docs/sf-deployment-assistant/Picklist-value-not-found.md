---
title: "Picklist value not found (Deployment assistant)"
description: "How to solve Salesforce deployment error \"/Picklist value: (.*) in picklist: (.*) not found\""
---
<!-- markdownlint-disable MD013 -->
# Picklist value not found

## Detection

- RegExp: `Picklist value: (.*) in picklist: (.*) not found`

## Resolution

```shell
Sources have references to value {1} of picklist {2}
- If picklist {2} is standard, add the picklist to sfdx sources by using "sf project retrieve start -m StandardValueSet:{2}", then save again
- Else, perform a search in all code of {1}, then remove XML tags referring to {1} (for example in record types metadatas)
- If value {1} exists but is inactive in the target org, a deployment action can activate it: replace OBJECT_NAME by the object of picklist {2} (or, for a standard value set, use "metadataType":"StandardValueSet" and "metadataFullName":"{2}")

```

## Deployment action

A deployment action can solve this error. Create it on the Pull Request of the current branch:

```shell
sf hardis:project:action:create --agent --scope pr --pr-id current --when pre-deploy --type browser --label "Activate value {1} of picklist {2}" --browser-setting picklists --browser-config '{"picklistValues":[{"metadataType":"CustomField","metadataFullName":"OBJECT_NAME.{2}","value":"{1}","active":true}]}'
```

Before running it, replace OBJECT_NAME in the command with the real value.

A deployment check only simulates a browser action. If this check still fails on this error once the action is created, apply the setting once in the target org with the Run in another org button of the VS Code Deployment Actions tab, or with sf hardis:project:action:run --select-org, then run the check again.

Documentation: https://amtrack.github.io/sfdx-browserforce-plugin/settings/picklists/
