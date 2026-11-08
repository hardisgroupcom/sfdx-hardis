---
title: "Publish an Agentforce agent - Salesforce deployment action"
description: "Publish the authoring bundle of an Agentforce agent in each org after a Salesforce deployment, and activate the version it creates."
---
<!-- markdownlint-disable MD013 -->

## Publish an Agentforce agent

One of the types of [deployment actions](salesforce-devops-work-on-user-story-deployment-actions.md), YAML `type: agent-publish`. That page explains what all types share: when actions run, how to choose their target orgs, how they are tracked and how to recover a failed one.

The project holds the authoring bundle of each [Agentforce agent](salesforce-ci-cd-agentforce-agents.md), its Agent Script, and no version. This action publishes the bundle in the target org right after the deployment, which creates a new version numbered by that org, then activates it, so users talk to the agent you just delivered.

The cleaning `autoAddAgentsDeploymentActions` of [hardis:work:save](hardis/work/save.md) writes this action for each agent whose bundle changed in a User Story: see [Agentforce agents in CI/CD](salesforce-ci-cd-agentforce-agents.md#automate-it-at-each-user-story). Add it yourself when the cleaning is not on.

<details markdown="1"><summary>Technical: agent-publish action (YAML)</summary>

The action runs `sf agent publish authoring-bundle --skip-retrieve` on `aiAuthoringBundles/<agentName>/` with the replacement rules of the target org applied, finds the version the publication created, runs `sf agent activate` on it, and reads the status again to check it.

The action runs after the deployment only, and only in the `process-deployment-only` context: a deployment check deploys nothing. It runs once by org by default (`runOnlyOnceByOrg: true`): each publication creates a new version, even when the Agent Script did not change.

The target org must be on API 68.0 or above.

| Custom parameter       | Required? | Description            | Example            |
|------------------------|:---------:|------------------------|--------------------|
| `parameters.agentName` | Yes       | API name of the agent. | `My_Service_Agent` |

```yaml
commandsPostDeploy:
  - id: 2c9e4f1b-8a3d-4e6f-b5c7-1d2e3f4a5b6c
    label: Publish the service agent
    type: agent-publish
    parameters:
      agentName: My_Service_Agent
    context: process-deployment-only
    runOnlyOnceByOrg: true
```

</details>
