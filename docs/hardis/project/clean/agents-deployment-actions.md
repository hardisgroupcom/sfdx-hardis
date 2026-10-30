<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:clean:agents-deployment-actions

## Description


## Command Behavior

**Writes in the sources what the deployment of Agentforce agents needs, before the Pull Request jobs run.**

A deployed agent version is inactive, and Salesforce refuses a deployment that holds the active version of an agent. [hardis:project:deploy:smart](https://sfdx-hardis.cloudity.com/hardis/project/deploy/smart/) never changes the package.xml or adds actions during the job: this cleaning records both in the project, so they show in the Pull Request.

- **Activation:** for each agent with an `AiAgentDefinitionVersion` changed in the User Story, an `agent-activate` post-deployment action of the Pull Request activates its latest version (`agentVersion: latest`). The label names the version of the project when the User Story was saved. When several Pull Requests are deployed together, their actions for the same agent are the same action and run once, so the order of the Pull Requests does not matter. An action that already activates this agent is updated.
- **Versions already in the target org:** `AiAgentDefinitionVersion` is added to `manifest/package-no-overwrite.xml` and to every file of `packageNoOverwritePath` in the project and branch configs, so only the new versions are deployed. Like for any item of package-no-overwrite.xml, a deployment that holds an agent version then lists the content of the target org, which can take a few minutes on a large org.
- **Automatic cleaning:** Add `autoAddAgentsDeploymentActions` to `autoCleanTypes` in `.sfdx-hardis.yml` to run it each time a User Story is saved with [hardis:work:save](https://sfdx-hardis.cloudity.com/hardis/work/save/).

See [Agentforce agents in CI/CD](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-agentforce-agents/).

<details markdown="1">
<summary>Technical explanations</summary>

- **Changed agents:** with `--delta-from <commit>` (passed by hardis:work:save), the agents are the ones with a file under `aiAgentDefinitionVersions/<Agent>#<n>/` in `git diff --name-only <commit>` or not tracked yet. Without it, every agent of the project.
- **Version:** `latest`, the highest version of the target org after the deployment. The label shows the highest `<n>` of the `aiAgentDefinitionVersions` folders of the agent at save time, in English, as it is committed.
- **Actions file:** the Pull Request of the current branch is found with the git provider (`scripts/actions/.sfdx-hardis.<id>.yml`), else the actions go to `scripts/actions/.sfdx-hardis.draft.yml`, to link with [hardis:project:action:link-pull-request](https://sfdx-hardis.cloudity.com/hardis/project/action/link-pull-request/).
- **Action:** type `agent-activate`, context `process-deployment-only`, `runOnlyOnceByOrg: false` (an active version is left as it is).
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:clean:agents-deployment-actions --agent
```

The command has no prompt: `--agent` only exists for consistency with the other cleanings.


## Parameters

| Name         |  Type   | Description                                                                                                                   | Default | Required | Options |
|:-------------|:-------:|:------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent        | boolean | Run in non-interactive mode for agents and automation                                                                         |         |          |         |
| debug<br/>-d | boolean | Activate debug mode (more logs)                                                                                               |         |          |         |
| delta-from   | option  | Git commit or ref the User Story starts from: only the agents changed since are handled (default: every agent of the project) |         |          |         |
| flags-dir    | option  | Import flag values from a directory.                                                                                          |         |          |         |
| json         | boolean | Format output as json.                                                                                                        |         |          |         |
| skipauth     | boolean | Skip authentication check when a default username is required                                                                 |         |          |         |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                     |         |          |         |

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


