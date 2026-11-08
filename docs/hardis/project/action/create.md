<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:action:create

## Description


## Command Behavior

**Creates a new deployment action in the project configuration.**

Deployment actions are pre- or post-deployment steps that run automatically during CI/CD pipelines. This command lets you define new actions of various types (shell command, data import, Apex script, community publish, manual instructions, batch scheduling, immediate batch run, package.xml items removal, User Access Policies activation, or a Setup setting applied in a browser) and store them at project, branch, or pull request scope.

New actions are appended to the end of the action list. Use `hardis:project:action:reorder` to change position.

The action ID is auto-generated using UUID.

### Target branches

An action runs on every target branch by default. To restrict it, set one of the two mutually exclusive lists:

- `includeTargetBranches`: the action only runs when the deployment targets one of these branches
- `excludeTargetBranches`: the action runs everywhere except on these branches

Branch names are matched exactly, ignoring case. The virtual name `dev-sandboxes` matches any target that is not a major branch declared in `config/branches`: a developer sandbox reached by `hardis:work:backpromote`, or a local deployment from a feature branch.

```yaml
commandsPostDeploy:
  - id: 6e9749de-d7e7-4e44-8742-f8cae3e2142e
    label: Publish the customer community
    type: publish-community
    parameters:
      communityName: Customer
    excludeTargetBranches:
      - dev-sandboxes
```

When an action does not apply to the branch being deployed, it is reported as skipped in the Pull Request comment, with the reason.

### Run a batch

A `run-batch` action runs a `Database.Batchable` Apex class once, before or after the metadata deployment. A pre-deploy batch needs its class to be in the target org already.

- `runMode: wait` (default) follows the job until it ends. The action fails when the job fails, is aborted, has batches in error, or is not over after `waitTimeoutMinutes` (60 by default).
- `successEvenIfBatchErrors: true` keeps the action successful when the job completes with batches in error.
- `runMode: no-wait` launches the batch and goes on with the deployment.
- No batch is launched when a job of the class is still running, or completed less than 3 hours ago with a result the action accepts: that job stands for this run.

A run-batch action only runs in the `process-deployment-only` context, never during a deployment check.

### Activate User Access Policies

A deployment always leaves the User Access Policies it contains in Design status, even an active one. A `user-access-policy` action, run after the deployment, sets them back to Active.

- `policies`: developer names of the policies.
- `activate: true` (default) activates them with the Salesforce API. A policy already active is left as is.
- `applyToAll: true` also runs **Apply To All** for each policy, at each run, and waits up to 2 minutes for Salesforce to record an access change. A policy that matches no user records none: that is a warning, not a failure.

Both are done by [Browserforce](https://github.com/amtrack/sfdx-browserforce-plugin) (`userAccessPolicies` setting) in a headless browser: Salesforce has no API for Apply To All. The plugin is installed when missing.

A user-access-policy action is `post-deploy` only, and only runs in the `process-deployment-only` context. It runs at every deployment by default (`runOnlyOnceByOrg: false`), because each new deployment of a policy turns it off again.

### Publish an Agentforce agent

An `agent-publish` action, run after the deployment, publishes the authoring bundle of an agent (`aiAuthoringBundles/<Agent>/`) in the target org with `sf agent publish authoring-bundle`, then activates the version this created. The org numbers the version. The replacement rules of the target org are applied to the bundle while it is published.

- `agentName`: API name of the agent.

An agent-publish action is `post-deploy` only, and only runs in the `process-deployment-only` context. It runs once by org by default (`runOnlyOnceByOrg: true`): each publication creates a new version, even when the bundle did not change.

### Activate a version of an Agentforce agent

An `agent-activate` action, run after the deployment, activates a version of an agent with `sf agent activate`, for example to go back to a previous version.

- `agentName`: API name of the agent.
- `agentVersion`: the version number, or `latest` (default) for the highest version of the agent in the target org.

A version already active is left as is. An agent-activate action is `post-deploy` only, and only runs in the `process-deployment-only` context. It runs at every deployment by default (`runOnlyOnceByOrg: false`), so a new version brought by a later deployment gets activated too.

### Create the running user of an Agentforce agent

An `agent-running-user` action, run before the deployment, creates the running user of a service agent with `sf org create agent-user` when the target org has none. The built-in replacement rule `builtin-agent-running-user` then writes that user in the deployed files.

- `agentName`: API name of the agent.

A user already there (the one of git, or one created before for the agent) is kept. No user is created when a rule of the project writes the running user, or when the replacement rules are skipped for the target. An agent-running-user action is `pre-deploy` only, and its context defaults to `all`, so the deployment check validates the agent with its real user. A deployment check never creates the user in production: the deployment does. It runs at every deployment by default (`runOnlyOnceByOrg: false`).
### Apply a Setup setting in a browser

Some Setup settings cannot be deployed with the Metadata API. A `browser` action applies one setting of [Browserforce](https://github.com/amtrack/sfdx-browserforce-plugin) (sfdx-browserforce-plugin, installed when missing) by driving the Setup pages in a headless browser.

- `setting`: the key of the Browserforce setting (`densitySettings`, `companyInformation`...)
- `config`: its value. Browserforce only changes what differs from the org.
- A value can be read from a CI/CD variable, written as a placeholder (its syntax is in the [deployment actions documentation](https://sfdx-hardis.cloudity.com/salesforce-devops-work-on-user-story-deployment-actions/#apply-a-setup-setting-in-a-browser)): `VARIABLE_<BRANCH>` first (for example `VARIABLE_UAT` when deploying to `uat`), then `VARIABLE`. Use it for secrets and for values that differ per org. The values are masked in every output.
- During a deployment check (default context `all`), nothing is changed: Browserforce reads the org and the Pull Request comment shows what would change.

```yaml
commandsPostDeploy:
  - id: 2f0c4d1e-7a3b-4c5d-9e8f-0a1b2c3d4e5f
    label: Compact density for all users
    type: browser
    context: all
    parameters:
      setting: densitySettings
      config:
        density: Compact
```

A manual action declared `pre-deploy` is always stored with the `all` context: it has to be done before the merge, so the deployment check lists it too.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:action:create --agent --scope branch --when pre-deploy --type command --label "Disable triggers" --command "sf data update record --sobject User --where \"Name='Admin'\" --values \"TriggerEnabled__c=false\""
```

Required in agent mode:

- `--scope`, `--when`, `--type`, `--label`
- Type-specific flags: list them, with what each type expects, with `sf hardis:project:action:types --json`. `--command` for command, `--apex-script` for apex, `--sfdmu-project` for data, `--community-name` for publish-community, `--instructions` for manual, `--class-name` and `--cron-expression` for schedule-batch, `--class-name` for run-batch (`--run-mode` defaults to `wait`), `--packagexml-items` for remove-packagexml-items, `--policies` for user-access-policy (`--activate` defaults to `true`, `--apply-to-all` to `false`), `--browser-setting` and `--browser-config` for browser (JSON, or the path of a .json file; its format: `sf hardis:project:action:types --type browser --browser-setting <key> --json`), `--agent-name` for agent-publish, agent-activate (`--agent-version` defaults to `latest`) and agent-running-user

When the definition is invalid, the `--json` error carries what helps fixing it in `data` (for a browser action: the fields of the setting and an example). The `--json` result of a saved action may carry `typeDetails`: for a browser action, the CI/CD variables to declare for each major branch.

In agent mode, `--context` defaults to `process-deployment-only`, or to the default of the type (`all` for remove-packagexml-items, browser and agent-running-user). `--run-only-once-by-org` defaults to `true` (use `--no-run-only-once-by-org` to disable); other optional boolean flags default to `false`.

Use `--include-target-branches` or `--exclude-target-branches` (comma-separated, mutually exclusive) to restrict the action to some target branches. Without either flag, the action runs on all of them.

<details markdown="1">
<summary>Technical explanations</summary>

- Reads and writes YAML config files using `js-yaml` and Node.js `fs`.
- Validates that referenced files (Apex scripts) and workspaces (SFDMU projects) exist before saving.
- Generates action ID with `crypto.randomUUID()`.
- Supports three config scopes: project (`config/.sfdx-hardis.yml`), branch (`config/branches/.sfdx-hardis.<branch>.yml`), PR (`scripts/actions/.sfdx-hardis.<prId>.yml`).
</details>


## Parameters

| Name                         |  Type   | Description                                                                                                                                                                                                                                                 | Default | Required |                          Options                          |
|:-----------------------------|:-------:|:------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:---------------------------------------------------------:|
| activate                     | boolean | For user-access-policy type: activate the policies after the deployment (default: true)                                                                                                                                                                     |         |          |                                                           |
| agent                        | boolean | Run in non-interactive mode for agents and automation                                                                                                                                                                                                       |         |          |                                                           |
| agent-name                   | option  | API name of the Agentforce agent (for agent-publish, agent-activate and agent-running-user types)                                                                                                                                                           |         |          |                                                           |
| agent-version                | option  | For agent-activate type: version number to activate, or latest for the highest version in the target org (default: latest)                                                                                                                                  |         |          |                                                           |
| allow-failure                | boolean | Allow action to fail without blocking deployment                                                                                                                                                                                                            |         |          |                                                           |
| apex-script                  | option  | Path to Apex script file (for apex type)                                                                                                                                                                                                                    |         |          |                                                           |
| apply-to-all                 | boolean | For user-access-policy type: also run Apply To All for each policy, with Browserforce (default: false)                                                                                                                                                      |         |          |                                                           |
| batch-size                   | option  | Batch size for run-batch type (optional, 1 to 2000, defaults to 200)                                                                                                                                                                                        |         |          |                                                           |
| branch                       | option  | Target branch name (for branch scope, defaults to current branch)                                                                                                                                                                                           |         |          |                                                           |
| browser-config               | option  | For browser type: value of the setting, as JSON or the path of a .json file. A secret or a value that differs per org can be read from a CI/CD variable: see the deployment actions documentation for the placeholder                                       |         |          |                                                           |
| browser-setting              | option  | For browser type: key of the Browserforce setting to apply. List them with sf hardis:project:action:types --type browser                                                                                                                                    |         |          |                                                           |
| class-name                   | option  | Apex batch class name (for schedule-batch and run-batch types). Write a global class of a managed package with its namespace: ns.ClassName                                                                                                                  |         |          |                                                           |
| command                      | option  | Shell command to execute (for command type)                                                                                                                                                                                                                 |         |          |                                                           |
| community-name               | option  | Community name (for publish-community type)                                                                                                                                                                                                                 |         |          |                                                           |
| context                      | option  | Execution context (default: process-deployment-only)                                                                                                                                                                                                        |         |          | all<br/>check-deployment-only<br/>process-deployment-only |
| cron-expression              | option  | Cron expression (for schedule-batch type)                                                                                                                                                                                                                   |         |          |                                                           |
| custom-username              | option  | Run action with a specific Salesforce username                                                                                                                                                                                                              |         |          |                                                           |
| debug<br/>-d                 | boolean | Activate debug mode (more logs)                                                                                                                                                                                                                             |         |          |                                                           |
| exclude-target-branches      | option  | Comma-separated list of target branches the action is skipped on (ex: "main"). Use dev-sandboxes for developer sandboxes. Cannot be combined with --include-target-branches                                                                                 |         |          |                                                           |
| flags-dir                    | option  | Import flag values from a directory.                                                                                                                                                                                                                        |         |          |                                                           |
| function-input               | option  | Value of a custom function input, as name=value. Repeat the flag once per input                                                                                                                                                                             |         |          |                                                           |
| include-target-branches      | option  | Comma-separated list of target branches the action runs on (ex: "uat,preprod"). Use dev-sandboxes for developer sandboxes. Cannot be combined with --exclude-target-branches                                                                                |         |          |                                                           |
| instructions                 | option  | Manual instructions text (for manual type)                                                                                                                                                                                                                  |         |          |                                                           |
| job-name                     | option  | Job name for schedule-batch (optional, defaults to <className>_Schedule)                                                                                                                                                                                    |         |          |                                                           |
| json                         | boolean | Format output as json.                                                                                                                                                                                                                                      |         |          |                                                           |
| label                        | option  | Human-readable label for the action                                                                                                                                                                                                                         |         |          |                                                           |
| packagexml-items             | option  | Semicolon-separated list of package.xml items to remove before deployment, each in format TypeName:Member1,Member2 (for remove-packagexml-items type). Example: "ApexClass:MyClass1,MyClass3;Layout:MyLayout1,MyLayout2"                                    |         |          |                                                           |
| policies                     | option  | Comma-separated developer names of User Access Policies (for user-access-policy type)                                                                                                                                                                       |         |          |                                                           |
| pr-id                        | option  | Pull request ID (for pr scope, defaults to draft)                                                                                                                                                                                                           |         |          |                                                           |
| run-mode                     | option  | For run-batch type: wait for the batch to succeed, or launch it without waiting for its result (default: wait)                                                                                                                                              |         |          |                     wait<br/>no-wait                      |
| run-only-once-by-org         | boolean | Execute action only once per target org (default: true)                                                                                                                                                                                                     |         |          |                                                           |
| scope                        | option  | Configuration scope: project, branch, or pr                                                                                                                                                                                                                 |         |          |                 project<br/>branch<br/>pr                 |
| sfdmu-project                | option  | SFDMU workspace name (for data type)                                                                                                                                                                                                                        |         |          |                                                           |
| success-even-if-batch-errors | boolean | For run-batch type in wait mode: keep the action successful when the batch completes with errors                                                                                                                                                            |         |          |                                                           |
| type                         | option  | Type of action: a built-in type (command, data, apex, publish-community, manual, schedule-batch, run-batch, remove-packagexml-items, user-access-policy, browser, agent-publish, agent-activate, agent-running-user) or the id of a project custom function |         |          |                                                           |
| wait-timeout                 | option  | Minutes to wait for the batch of a run-batch action in wait mode (optional, defaults to 60)                                                                                                                                                                 |         |          |                                                           |
| websocket                    | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                                                                                                                   |         |          |                                                           |
| when                         | option  | When to run the action: pre-deploy or post-deploy                                                                                                                                                                                                           |         |          |                pre-deploy<br/>post-deploy                 |

## Examples

```shell
$ sf hardis:project:action:create
```

```shell
$ sf hardis:project:action:create --agent --scope branch --when pre-deploy --type command --label "Disable triggers" --command "sf apex run --file scripts/disable-triggers.apex"
```

```shell
$ sf hardis:project:action:create --agent --scope pr --pr-id 123 --when post-deploy --type data --label "Import test data" --sfdmu-project TestData
```

```shell
$ sf hardis:project:action:create --agent --scope pr --pr-id 123 --when pre-deploy --type remove-packagexml-items --label "Skip legacy classes" --packagexml-items "ApexClass:MyClass1,MyClass3;Layout:MyLayout1,MyLayout2"
```

```shell
$ sf hardis:project:action:create --agent --scope pr --pr-id 123 --when post-deploy --type run-batch --label "Recalculate crew capacity" --class-name CrewCapacityBatch --run-mode wait --wait-timeout 30
```

```shell
$ sf hardis:project:action:create --agent --scope project --when post-deploy --type user-access-policy --label "Activate sales access policies" --policies "Sales_Rep_Access,Sales_Manager_Access" --apply-to-all
```

```shell
$ sf hardis:project:action:create --agent --scope pr --pr-id 123 --when post-deploy --type agent-publish --label "Publish the service agent" --agent-name My_Service_Agent
```

```shell
$ sf hardis:project:action:create --agent --scope project --when post-deploy --type agent-activate --label "Activate the service agent" --agent-name My_Service_Agent --agent-version latest
```

```shell
$ sf hardis:project:action:create --agent --scope pr --pr-id 123 --when pre-deploy --context all --type agent-running-user --label "Create the running user of the service agent" --agent-name My_Service_Agent
```

```shell
$ sf hardis:project:action:create --agent --scope project --when post-deploy --type browser --label "Compact density" --browser-setting densitySettings --browser-config '{"density":"Compact"}'
```

```shell
$ sf hardis:project:action:create --agent --scope project --when post-deploy --type apex --label "Reset demo data" --apex-script scripts/apex/reset-demo.apex --exclude-target-branches "main,preprod"
```


