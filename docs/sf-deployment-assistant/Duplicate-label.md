---
title: "Duplicate label (Deployment assistant)"
description: "How to solve Salesforce deployment error \"Error (.*) Duplicate label: (.*)\""
---
<!-- markdownlint-disable MD013 -->
# Duplicate label

## Detection

- RegExp: `Error (.*) Duplicate label: (.*)`

## Resolution

```shell
You probably renamed the API name of the picklist value with label {2} in {1}: the target org still has the value with its old API name, and the same label.
- A deployment action can rename the value in the target org before the deployment: replace OLD_API_NAME with its API name in the target org (Setup, the values of {1})
- Or rename it manually in the target org, then deploy again
```

## Deployment action

A deployment action can solve this error. Create it on the Pull Request of the current branch:

```shell
sf hardis:project:action:create --agent --scope pr --pr-id current --when pre-deploy --type browser --label "Rename picklist value {2} of {1}" --browser-setting picklists --browser-config '{"picklistValues":[{"metadataType":"METADATA_TYPE","metadataFullName":"{1}","value":"OLD_API_NAME","newApiName":"NEW_API_NAME"}]}'
```

Before running it, replace OLD_API_NAME, NEW_API_NAME, METADATA_TYPE in the command with the real value.

A deployment check only simulates a browser action. If this check still fails on this error once the action is created, apply the setting once in the target org with the Run in another org button of the VS Code Deployment Actions tab, or with sf hardis:project:action:run --select-org, then run the check again.

Documentation: https://amtrack.github.io/sfdx-browserforce-plugin/settings/picklists/
