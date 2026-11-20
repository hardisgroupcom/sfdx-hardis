---
title: "Shared Activities can not be deployed (Deployment assistant)"
description: "How to solve Salesforce deployment error \"You can't use the Tooling API or Metadata API to enable or disable Shared Activities\""
---
<!-- markdownlint-disable MD013 -->
# Shared Activities can not be deployed

## Detection

- String: `You can't use the Tooling API or Metadata API to enable or disable Shared Activities`

## Resolution

```shell
The Metadata API can not change Shared Activities (Allow Users to Relate Multiple Contacts to Tasks and Events)
- Remove allowUsersToRelateMultipleContactsToTasksAndEvents from Activities.settings-meta.xml in your sources
- To enable it, go to Setup -> Activity Settings in the target org, or use a deployment action
- Once enabled, it can not be disabled (only Salesforce support can)
```

## Deployment action

A deployment action can solve this error. Create it on the Pull Request of the current branch:

```shell
sf hardis:project:action:create --agent --scope pr --pr-id current --when pre-deploy --type browser --label "Enable Shared Activities" --browser-setting activitySettings --browser-config '{"allowUsersToRelateMultipleContactsToTasksAndEvents":true}'
```

A deployment check only simulates a browser action. If this check still fails on this error once the action is created, apply the setting once in the target org with the Run in another org button of the VS Code Deployment Actions tab, or with sf hardis:project:action:run --select-org, then run the check again.

Documentation: https://amtrack.github.io/sfdx-browserforce-plugin/settings/activitySettings/
