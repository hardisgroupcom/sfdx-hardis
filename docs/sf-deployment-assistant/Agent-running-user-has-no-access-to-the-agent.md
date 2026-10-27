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
- Assign the permission set group AgentforceServiceAgentUserPsg (Agentforce Service Agent User) to this user in the target org
- The user must have the profile Einstein Agent User
- Each org needs its own user: write it with a replacement rule (botUser, default_agent_user), for example from a CI/CD variable. See https://sfdx-hardis.cloudity.com/salesforce-ci-cd-agentforce-agents/#the-running-user-of-a-service-agent
```
