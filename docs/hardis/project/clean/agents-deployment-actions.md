<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:clean:agents-deployment-actions

## Description


## Command Behavior

**Writes in the sources what the deployment of Agentforce agents needs, before the Pull Request jobs run.**

A deployed agent version is inactive, and Salesforce refuses a deployment that holds the active version of an agent. [hardis:project:deploy:smart](https://sfdx-hardis.cloudity.com/hardis/project/deploy/smart/) never changes the package.xml or adds actions during the job: this cleaning records both in the project, so they show in the Pull Request.

- **Activation:** for each agent with an `AiAgentDefinitionVersion` changed in the User Story, an `agent-activate` post-deployment action of the Pull Request activates the version saved with the User Story (`agentVersion: 3`), so the Pull Request says what is activated. An action that already activates this agent is updated. An action set to `latest` by hand stays `latest`.
- **Running user:** for each of these agents that runs as a user (`botUser`, `default_agent_user`), an `agent-running-user` pre-deployment action creates that user with `sf org create agent-user` in an org that has none. It runs in the deployment checks too, so a check validates the agent with the user of the target org. The built-in replacement rule `builtin-agent-running-user` then writes the user in the deployed files, and never creates one.
- **Versions already in the target org:** `AiAgentDefinitionVersion` is added to `manifest/package-no-overwrite.xml` and to every file of `packageNoOverwritePath` in the project and branch configs, so only the new versions are deployed. Like for any item of package-no-overwrite.xml, a deployment that holds an agent version then lists the content of the target org, which can take a few minutes on a large org.
- **Automatic cleaning:** Add `autoAddAgentsDeploymentActions` to `autoCleanTypes` in `.sfdx-hardis.yml` to run it each time a User Story is saved with [hardis:work:save](https://sfdx-hardis.cloudity.com/hardis/work/save/).

See [Agentforce agents in CI/CD](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-agentforce-agents/).

<details markdown="1">
<summary>Technical explanations</summary>

- **Changed agents:** the agents with a file under `aiAgentDefinitionVersions/<Agent>#<n>/` in `git diff --name-only <commit>` or not tracked yet. `<commit>` is `--delta-from` (passed by hardis:work:save), else `HEAD`: run by hand, the cleaning only handles the versions not committed yet.
- **Version:** the highest `<n>` of the `aiAgentDefinitionVersions` folders of the agent at save time. The label is in English, as it is committed.
- **Actions file:** the Pull Request of the current branch is found with the git provider (`scripts/actions/.sfdx-hardis.<id>.yml`), else the actions go to `scripts/actions/.sfdx-hardis.draft.yml`, to link with [hardis:project:action:link-pull-request](https://sfdx-hardis.cloudity.com/hardis/project/action/link-pull-request/).
- **Actions:** `agent-activate`, context `process-deployment-only`, and `agent-running-user`, context `all`, both with `runOnlyOnceByOrg: false`: an active version is left as it is, and an existing user is found again.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:clean:agents-deployment-actions --agent
```

The command has no prompt: `--agent` only exists for consistency with the other cleanings.


## Parameters

| Name         |  Type   | Description                                                                                                                             | Default | Required | Options |
|:-------------|:-------:|:----------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent        | boolean | Run in non-interactive mode for agents and automation                                                                                   |         |          |         |
| debug<br/>-d | boolean | Activate debug mode (more logs)                                                                                                         |         |          |         |
| delta-from   | option  | Git commit or ref the User Story starts from: only the agents changed since are handled (default: HEAD, the versions not committed yet) |         |          |         |
| flags-dir    | option  | Import flag values from a directory.                                                                                                    |         |          |         |
| json         | boolean | Format output as json.                                                                                                                  |         |          |         |
| skipauth     | boolean | Skip authentication check when a default username is required                                                                           |         |          |         |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                               |         |          |         |

## Examples

```shell
$ sf hardis:project:clean:agents-deployment-actions
```

```shell
$ sf hardis:project:clean:agents-deployment-actions --delta-from origin/integration
```

```shell
$ sf hardis:project:clean:agents-deployment-actions --agent
```


