---
title: "Einstein Conversation Insights not enabled (Deployment assistant)"
description: "How to solve Salesforce deployment error \"/There was an error enabling or disabling a setting: OrgPreferences\\.(CallSummarization|GenECI)\""
---
<!-- markdownlint-disable MD013 -->
# Einstein Conversation Insights not enabled

## Detection

- RegExp: `There was an error enabling or disabling a setting: OrgPreferences\.(CallSummarization|GenECI)`
- RegExp: `Error ConversationalIntelligence (enableECICallScoring)\s*$`

## Resolution

```shell
The ConversationalIntelligence settings of your sources turn on {1}, that needs Einstein Conversation Insights already turned on in the target org: turning it on in the same deployment is not enough
- Turn on Einstein Conversation Insights in the target org (Setup -> Einstein Conversation Insights), or use a deployment action that waits until it is completely on
- Once turned on, it can not be turned off with Browserforce
- If Call Summaries still fails to turn on with the Metadata API, remove enableCallSummarization from ConversationalIntelligence.settings-meta.xml and use the callSummaries setting of Browserforce instead (https://amtrack.github.io/sfdx-browserforce-plugin/settings/callSummaries/)
```

## Deployment action

A deployment action can solve this error. Create it on the Pull Request of the current branch:

```shell
sf hardis:project:action:create --agent --scope pr --pr-id current --when pre-deploy --type browser --label "Turn on Einstein Conversation Insights" --browser-setting einsteinConversationInsights --browser-config '{"enabled":true}'
```

A deployment check only simulates a browser action. If this check still fails on this error once the action is created, apply the setting once in the target org with the Run in another org button of the VS Code Deployment Actions tab, or with sf hardis:project:action:run --select-org, then run the check again.

Documentation: https://amtrack.github.io/sfdx-browserforce-plugin/settings/einsteinConversationInsights/
