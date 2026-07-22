---
title: Agent tests (Salesforce monitoring)
description: Schedule weekly Agentforce agent test runs with sfdx-hardis monitoring
---
<!-- markdownlint-disable MD013 -->

## Agent tests

Runs all Agentforce agent tests (AiEvaluationDefinition metadata) of the org and reports pass / fail results for each test case.

The command fails if any agent test case does not pass.

Sfdx-hardis command: [sf hardis:org:test:agents](https://sfdx-hardis.cloudity.com/hardis/org/test/agents/)

Key: **AGENT_TESTS**

This monitoring command requires the `@salesforce/plugin-agent` Salesforce CLI plugin (`sf plugins install @salesforce/plugin-agent`).
