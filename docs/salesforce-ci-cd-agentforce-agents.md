---
title: Agentforce agents in CI/CD
description: Retrieve an Agentforce agent with its dependencies, deploy it with sfdx-hardis and activate it in the target org
---
<!-- markdownlint-disable MD013 -->

# Agentforce agents in CI/CD

From API 68.0 (Winter '27), an Agentforce agent is made of two metadata types:

- `AiAgentDefinition`: the agent itself.
- `AiAgentDefinitionVersion`: one version of the agent, written `AgentName#Number` in a package.xml (`My_Service_Agent#3`).

They replace `GenAiPlannerBundle`, and the Salesforce CLI can retrieve an agent version with the Flow, Apex and prompt template actions it uses.

sfdx-hardis covers the three steps of an agent delivery: retrieve it, deploy it, activate it.

## 1. Retrieve the agent

In your developer sandbox, run [hardis:org:retrieve:agent](hardis/org/retrieve/agent.md):

```shell
sf hardis:org:retrieve:agent
```

The command:

- lists the agents of the org and their versions, and proposes the latest one
- retrieves the version with its dependencies in your project
- adds every retrieved component to `manifest/package.xml`, with the whole `AiAgentDefinition`
- lists the custom objects, custom fields and Data 360 objects that the agent names and that your project does not hold

The Salesforce CLI does not retrieve these objects and fields with the agent. When the target orgs do not have them, retrieve them too and add them to `manifest/package.xml`.

Then [publish your User Story](salesforce-devops-publish-user-story.md) as usual.

## 2. Deploy the agent

[hardis:project:deploy:smart](hardis/project/deploy/smart.md) deploys the agent like any other metadata, with two checks:

- **The target org must be on API 68.0 or above.** Otherwise the deployment stops before anything is sent.
- **The first deployment of an agent needs its whole `AiAgentDefinition`.** With [delta deployments](salesforce-devops-config-delta-deployment.md), a Pull Request that only changes a version holds only the `AiAgentDefinitionVersion`. When the target org does not have the agent yet, sfdx-hardis adds its `AiAgentDefinition` to the deployment.

Agent metadata types do not trigger Apex tests with [Smart Deployment Tests](hardis/project/deploy/smart.md#smart-deployments-tests).

## 3. Activate the agent

A deployed version is not active. Add an `agent-activate` [deployment action](salesforce-devops-work-on-user-story-deployment-actions.md#activate-an-agentforce-agent) to activate it after the deployment:

```yaml
commandsPostDeploy:
  - id: 7d1f3c2a-5e4b-4c8a-9f61-2b3e4d5a6c7e
    label: Activate the service agent
    type: agent-activate
    parameters:
      agentName: My_Service_Agent
      agentVersion: latest
    context: process-deployment-only
    runOnlyOnceByOrg: false
```

## Keep the previous agent types with API 67.0

Both the source org and the target org must be on API 68.0 to use the new types. During a release window, while your sandboxes are on Winter '27 and production is still on Summer '26, keep the previous types: `Bot`, `BotVersion`, `GenAiPlannerBundle` and `AiAuthoringBundle`.

To do so, pin the API version of the project to 67.0:

- `sfdx-project.json`: `"sourceApiVersion": "67.0"`
- `manifest/package.xml` (and the other manifests you deploy): `<version>67.0</version>`
- do not set the `SFDX_API_VERSION` variable to a higher version in your CI/CD

sfdx-hardis deploys `manifest/package.xml` without forcing an API version, so the pinned version is used.

Once every org of the pipeline is on API 68.0, retrieve your agents again with `hardis:org:retrieve:agent`, remove the previous types from `manifest/package.xml`, and set the API version to 68.0. Move all agents in the same Pull Request: an org cannot receive the same agent in both formats.

!!! warning
    The [monitoring backup](salesforce-monitoring-metadata-backup.md) raises the API version of its own repository to the version of the org. A pin to 67.0 does not hold in a monitoring repository.
