---
title: "History tracking not enabled on object (Deployment assistant)"
description: "How to solve Salesforce deployment error \"/The entity: (.*) does not have history tracking enabled\""
---
<!-- markdownlint-disable MD013 -->
# History tracking not enabled on object

## Detection

- RegExp: `The entity: (.*) does not have history tracking enabled`

## Resolution

```shell
A field tracks its history, but history tracking is not enabled on object {1} in the target org
- Enable it in the sources: add <enableHistory>true</enableHistory> to the object {1} metadata and deploy it with the field
- For a Person Account field, the Metadata API can not enable it: use Setup -> Object Manager -> {1} -> Fields & Relationships -> Set History Tracking, or a deployment action
```

## Deployment action

A deployment action can solve this error. Create it on the Pull Request of the current branch:

```shell
sf hardis:project:action:create --agent --scope pr --pr-id current --when pre-deploy --type browser --label "Enable history tracking on {1}" --browser-setting historyTracking --browser-config '[{"objectApiName":"{1}","enableHistoryTracking":true}]'
```

A deployment check only simulates a browser action. If this check still fails on this error once the action is created, apply the setting once in the target org with the Run in another org button of the VS Code Deployment Actions tab, or with sf hardis:project:action:run --select-org, then run the check again.

Documentation: https://amtrack.github.io/sfdx-browserforce-plugin/settings/historyTracking/
