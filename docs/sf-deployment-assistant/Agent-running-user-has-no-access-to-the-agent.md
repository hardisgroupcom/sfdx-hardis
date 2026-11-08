---
title: "Agent running user has no access to the agent (Deployment assistant)"
description: "How to solve Salesforce deployment error \"Error (.*) User doesn't have access to agent\""
---
<!-- markdownlint-disable MD013 -->
# Agent running user has no access to the agent

## Detection

- RegExp: `Error (.*) User doesn't have access to agent`

## Resolution

```shell
The running user of agent {1} (botUser in its AiAgentDefinition) exists in the target org, but cannot run agents
- Assign it the permission sets AgentforceServiceAgentBase, AgentforceServiceAgentUser and EinsteinGPTPromptTemplateUser, with the profile Einstein Agent User
- Or let sfdx-hardis create a user with sf org create agent-user: keep the built-in replacement rule builtin-agent-running-user on, and remove the replacement rule of your own that writes botUser. See https://sfdx-hardis.cloudity.com/salesforce-ci-cd-agentforce-agents/#the-running-user-of-a-service-agent
```
