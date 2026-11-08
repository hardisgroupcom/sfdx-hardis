---
title: "Create the running user of an Agentforce agent - Salesforce deployment action"
description: "Create the user an Agentforce service agent runs as, before a Salesforce deployment, in an org that does not have it."
---
<!-- markdownlint-disable MD013 -->

## Create the running user of an Agentforce agent

One of the types of [deployment actions](salesforce-devops-work-on-user-story-deployment-actions.md), YAML `type: agent-running-user`. That page explains what all types share: when actions run, how to choose their target orgs, how they are tracked and how to recover a failed one.

A service [Agentforce agent](salesforce-ci-cd-agentforce-agents.md#the-running-user-of-a-service-agent) runs as a user of its org, and a user is not deployed. This action creates it before the deployment, in an org that has none, so the agent can be published and activated. The built-in replacement rule `builtin-agent-running-user` then writes this user in the deployed and published bundle.

The cleaning `autoAddAgentsDeploymentActions` of [hardis:work:save](hardis/work/save.md) writes this action for each changed agent that runs as a user.

<details markdown="1"><summary>Technical: agent-running-user action (YAML)</summary>

The action reads the usernames of the agent in the project (`botUser`, `default_agent_user`). When the target org has them, or has the user created for the agent before (`<agent>.<unique id>@<org id>.ext`, profile **Einstein Agent User**), nothing is created. Otherwise it runs `sf org create agent-user`.

The action runs before the deployment only. Use the `all` context, so the deployment check validates the agent with the user of the target org. It runs at every deployment by default (`runOnlyOnceByOrg: false`): an existing user is found again.

| Custom parameter       | Required? | Description            | Example            |
|------------------------|:---------:|------------------------|--------------------|
| `parameters.agentName` |    Yes    | API name of the agent. | `My_Service_Agent` |

```yaml
commandsPreDeploy:
  - id: 3b6c2f1e-8d4a-4e7b-a5c9-1f2d3e4a5b6c
    label: Create the running user of agent My_Service_Agent when the org has none
    type: agent-running-user
    parameters:
      agentName: My_Service_Agent
    context: all
    runOnlyOnceByOrg: false
```

</details>
