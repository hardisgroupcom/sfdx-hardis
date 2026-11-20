---
title: "Send email is disabled (Deployment assistant)"
description: "How to solve Salesforce deployment error \"Send Email is disabled or activities are not allowed\""
---
<!-- markdownlint-disable MD013 -->
# Send email is disabled

## Detection

- String: `Send Email is disabled or activities are not allowed`
- String: `Unknown user permission: SendExternalEmailAvailable`

## Resolution

```shell
Go to Email -> Deliverability -> Select value "All emails"
```

## Deployment action

A deployment action can solve this error. Create it on the Pull Request of the current branch:

```shell
sf hardis:project:action:create --agent --scope pr --pr-id current --when pre-deploy --type browser --label "Allow all emails in Deliverability" --browser-setting emailDeliverability --browser-config '{"accessLevel":"All email"}'
```

A deployment check only simulates a browser action. If this check still fails on this error once the action is created, apply the setting once in the target org with the Run in another org button of the VS Code Deployment Actions tab, or with sf hardis:project:action:run --select-org, then run the check again.

Documentation: https://amtrack.github.io/sfdx-browserforce-plugin/settings/emailDeliverability/
