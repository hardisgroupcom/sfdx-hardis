<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:retrieve:agent

## Description


## Command Behavior

**Retrieves one version of an Agentforce agent from an org, with the components it needs, and adds them to the package.xml of the project.**

From API 68.0, an agent is made of the `AiAgentDefinition` and `AiAgentDefinitionVersion` metadata types, and the Salesforce CLI retrieves an agent version with its dependencies: its Flow, Apex and prompt template actions.

Key functionalities:

- **Agent and version selection:** Lists the agents of the org and their versions with their status, and proposes the latest version.
- **Retrieval with dependencies:** Retrieves the selected version and what it uses in the local project.
- **package.xml update:** Adds every retrieved component to `manifest/package.xml`, always with the whole `AiAgentDefinition`: the first deployment of an agent to an org needs it.
- **Migration from the format before API 68.0:** When `manifest/package.xml` still holds the agent as `GenAiPlannerBundle`, `Bot` or `BotVersion`, these entries are removed, and the command lists the old folders to delete.
- **Running user warning:** A service agent runs as a user of its org (`botUser`). The command warns when the retrieved agent has one: add a replacement rule that writes the user of each org.
- **Missing dependencies report:** Lists the custom objects, custom fields and Data 360 objects that the agent names and that the project does not hold. The CLI does not retrieve them: retrieve them yourself when the target org does not have them.

Then commit the files as usual (for example with [hardis:work:save](https://sfdx-hardis.cloudity.com/hardis/work/save/)). With the cleaning `autoAddAgentsDeploymentActions` in `autoCleanTypes`, hardis:work:save adds the activation of the new version to the deployment actions of the Pull Request.

The org and the `sourceApiVersion` of `sfdx-project.json` must be on API 68.0 or above: below, Salesforce returns no agent file. To keep the previous types (`Bot`, `BotVersion`, `AiAuthoringBundle`) while an org of your pipeline is still on API 67.0, see [Agentforce agents in CI/CD](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-agentforce-agents/).

<details markdown="1">
<summary>Technical explanations</summary>

- **Listing:** `metadata.list` on `AiAgentDefinitionVersion` returns the versions as `AgentName#Number`. Their status comes from a SOQL query on `BotVersion`, and is left empty when the org does not answer it.
- **Retrieval:** runs `sf project retrieve start --metadata "AiAgentDefinitionVersion:AgentName#Number" --root-type-with-dependencies AiAgentDefinitionVersion --ignore-conflicts --json`.
- **package.xml:** the retrieved components are read from the `files` of the JSON result and merged into the package.xml. A type already listed with `*` is left as is.
- **Missing dependencies:** the retrieved agent files are scanned for names ending with `__c`, `__dlm`, `__dll` or `__x`, then compared with the `objects` folders of the project. The result is what may be missing: a name found in an instruction text is listed too.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:org:retrieve:agent --agent --name My_Service_Agent --version latest
```

In agent mode:

- `--name` is required.
- `--version` defaults to `latest`, the highest version of the agent in the org.
- No prompt is shown.


## Parameters

| Name              |  Type   | Description                                                                                                  |       Default        | Required | Options |
|:------------------|:-------:|:-------------------------------------------------------------------------------------------------------------|:--------------------:|:--------:|:-------:|
| agent             | boolean | Run in non-interactive mode for agents and automation                                                        |                      |          |         |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                                              |                      |          |         |
| flags-dir         | option  | Import flag values from a directory.                                                                         |                      |          |         |
| json              | boolean | Format output as json.                                                                                       |                      |          |         |
| name<br/>-n       | option  | API name of the agent to retrieve                                                                            |                      |          |         |
| package-xml       | option  | package.xml file to add the retrieved components to                                                          | manifest/package.xml |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                                                |                      |          |         |
| target-org<br/>-o | option  | Username or alias of the target org. Not required if the `target-org` configuration variable is already set. |                      |   true   |         |
| version           | option  | Version number of the agent to retrieve, or latest (default: latest)                                         |                      |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                    |                      |          |         |

## Examples

```shell
$ sf hardis:org:retrieve:agent
```

```shell
$ sf hardis:org:retrieve:agent --name My_Service_Agent --version 3
```

```shell
$ sf hardis:org:retrieve:agent --agent --name My_Service_Agent
```


