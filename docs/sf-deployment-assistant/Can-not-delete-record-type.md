---
title: "Can not delete record type (Deployment assistant)"
description: "How to solve Salesforce deployment error \"Error (.*) Cannot delete record type through API\""
---
<!-- markdownlint-disable MD013 -->
# Can not delete record type

## Detection

- RegExp: `Error (.*) Cannot delete record type through API`

## Resolution

```shell
You need to manually delete record type {1} in target org
- Edit record type {1}, uncheck "Active"
- Delete record type {1}
```

## Deployment action

A deployment action can solve this error. Create it on the Pull Request of the current branch:

```shell
sf hardis:project:action:create --agent --scope pr --pr-id current --when pre-deploy --type browser --label "Delete record type {1}" --browser-setting recordTypes --browser-config '{"deletions":[{"fullName":"{1}"}]}'
```

A deployment check only simulates a browser action. If this check still fails on this error once the action is created, apply the setting once in the target org with the Run in another org button of the VS Code Deployment Actions tab, or with sf hardis:project:action:run --select-org, then run the check again.

Documentation: https://amtrack.github.io/sfdx-browserforce-plugin/settings/recordTypes/
