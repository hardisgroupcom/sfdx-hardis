<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:clean:agents-deployment-actions

## Description


## Command Behavior

**Writes in the Pull Request the deployment actions that deliver Agentforce agents, before the Pull Request jobs run.**

The project holds the authoring bundle of each agent (`aiAuthoringBundles/<Agent>/`), not its versions: a version is created in each org when the bundle is published there. [hardis:project:deploy:smart](https://sfdx-hardis.cloudity.com/hardis/project/deploy/smart/) never adds actions during the job: this cleaning records them in the project, so they show in the Pull Request.

- **Publication:** for each agent whose bundle changed in the User Story, an `agent-publish` post-deployment action of the Pull Request publishes the bundle in the target org and activates the version it created. It runs once by org: each publication creates a new version, even when nothing changed.
- **Running user:** for each of these agents that runs as a user (`default_agent_user`), an `agent-running-user` pre-deployment action creates that user with `sf org create agent-user` in an org that has none. The built-in replacement rule `builtin-agent-running-user` then writes the user of the target org in the bundle while it is published, and never creates one.
- **Automatic cleaning:** Add `autoAddAgentsDeploymentActions` to `autoCleanTypes` in `.sfdx-hardis.yml` to run it each time a User Story is saved with [hardis:work:save](https://sfdx-hardis.cloudity.com/hardis/work/save/).

See [Agentforce agents in CI/CD](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-agentforce-agents/).

<details markdown="1">
<summary>Technical explanations</summary>

- **Changed agents:** the agents with a file under `aiAuthoringBundles/<Agent>/` in `git diff --name-only <commit>` or not tracked yet. The bundles of versions (`<Agent>_<n>`) are ignored. `<commit>` is `--delta-from` (passed by hardis:work:save), else `HEAD`: run by hand, the cleaning only handles the changes not committed yet.
- **Actions file:** the Pull Request of the current branch is found with the git provider (`scripts/actions/.sfdx-hardis.<id>.yml`), else the actions go to `scripts/actions/.sfdx-hardis.draft.yml`, to link with [hardis:project:action:link-pull-request](https://sfdx-hardis.cloudity.com/hardis/project/action/link-pull-request/).
- **Actions:** `agent-publish`, context `process-deployment-only`, `runOnlyOnceByOrg: true`, and `agent-running-user`, context `all`, `runOnlyOnceByOrg: false`: an existing user is found again. An action already there for the agent is kept as it is, and a file with nothing to add is not written again. The labels are in English, as they are committed.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:clean:agents-deployment-actions --agent
```

The command has no prompt: `--agent` only exists for consistency with the other cleanings.


## Parameters

| Name         |  Type   | Description                                                                                                                            | Default | Required | Options |
|:-------------|:-------:|:---------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent        | boolean | Run in non-interactive mode for agents and automation                                                                                  |         |          |         |
| debug<br/>-d | boolean | Activate debug mode (more logs)                                                                                                        |         |          |         |
| delta-from   | option  | Git commit or ref the User Story starts from: only the agents changed since are handled (default: HEAD, the changes not committed yet) |         |          |         |
| flags-dir    | option  | Import flag values from a directory.                                                                                                   |         |          |         |
| json         | boolean | Format output as json.                                                                                                                 |         |          |         |
| skipauth     | boolean | Skip authentication check when a default username is required                                                                          |         |          |         |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                              |         |          |         |

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


