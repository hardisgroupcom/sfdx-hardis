---
title: "Activate a version of an Agentforce agent - Salesforce deployment action"
description: "Activate the latest version of an Agentforce agent in the target org after a Salesforce deployment."
---
<!-- markdownlint-disable MD013 -->

## Activate a version of an Agentforce agent

One of the types of [deployment actions](salesforce-devops-work-on-user-story-deployment-actions.md), YAML `type: agent-activate`. That page explains what all types share: when actions run, how to choose their target orgs, how they are tracked and how to recover a failed one.

This action activates the latest version of an [Agentforce agent](salesforce-ci-cd-agentforce-agents.md) in the target org. Each org numbers its own versions, so the action takes no version number. An agent delivered with an [agent-publish](salesforce-devops-work-on-user-story-deployment-actions-agent-publish.md) action is already active.

<details markdown="1"><summary>Technical: agent-activate action (YAML)</summary>

The action finds the highest version of the agent in the target org, then runs `sf agent activate`, and reads the status again to check it. A version already active is left as it is.

The action runs after the deployment only, and only in the `process-deployment-only` context: a deployment check deploys nothing. It runs at every deployment by default (`runOnlyOnceByOrg: false`).

The target org must be on API 68.0 or above.

| Custom parameter       | Required? | Description            | Example            |
|------------------------|:---------:|------------------------|--------------------|
| `parameters.agentName` | Yes       | API name of the agent. | `My_Service_Agent` |

```yaml
commandsPostDeploy:
  - id: 7d1f3c2a-5e4b-4c8a-9f61-2b3e4d5a6c7e
    label: Activate the service agent
    type: agent-activate
    parameters:
      agentName: My_Service_Agent
    context: process-deployment-only
    runOnlyOnceByOrg: false
```

</details>
