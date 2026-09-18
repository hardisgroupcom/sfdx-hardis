<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:function:create

## Description


## Command Behavior

**Declares a custom function: a script that becomes a deployment action type of your project.**

A custom function packages a **node**, **python** or **bash** script behind a typed parameter contract. Once declared, its id is a valid deployment action `type`, next to the built-in ones (`command`, `apex`, `data`...), and `hardis:project:action:create` offers it in the type list.

Functions are stored in the **project** configuration (`config/.sfdx-hardis.yml`), under `customFunctions`. They are deliberately not branch or Pull Request scoped: a function id is an action type, so the catalog must be identical everywhere.

### What the script receives

Every value arrives as an environment variable:

- One `SFDX_HARDIS_IN_<NAME>` per declared input (uppercased).
- The pipeline context: `SFDX_HARDIS_TARGET_BRANCH`, `SFDX_HARDIS_PR_ID`, `SFDX_HARDIS_ORG_USERNAME`, `SFDX_HARDIS_CHECK_ONLY` and the rest of the git, Pull Request, org and deployment groups.

### What the script returns

When the function declares outputs, the **last non-empty line of stdout must be a JSON object** holding them. Everything printed before it is ordinary logging, kept as the action output.

Outputs are consumable by any later action of the run with `${{ actions.<actionId>.outputs.<name> }}`, and are displayed in the job log, the Pull Request comment and the deployment notification.

### Secrets

An input of type `secret` never stores a value in the configuration file. The action stores the **name of a CI/CD variable**, sfdx-hardis resolves it from the environment when the action runs, passes the value to the script, and masks it everywhere it reports. A variable that is not defined fails the action.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:function:create --agent --id notifySlack --label "Notify Slack channel" --runtime node --script scripts/functions/notify-slack.js --inputs "channel:string:required;severity:select|info,warning,critical=info;webhookToken:secret:required" --outputs "messageId;permalink"
```

Required in agent mode: `--id`, `--label`, `--runtime`, `--script`.

Defaults applied: no input, no output, no phase restriction, and the standard execution timeout. Every interactive prompt is skipped.

The `--inputs` syntax is `name[:type][:required][|option1,option2][=default]`, entries separated by `;`. Types: `string`, `number`, `boolean`, `select`, `multiline`, `secret`.
The `--outputs` syntax is `name[:type]`, entries separated by `;`.

<details markdown="1">
<summary>Technical explanations</summary>

- Reads and writes `config/.sfdx-hardis.yml` with `js-yaml`, preserving every other key.
- Rejects an id colliding with a built-in action type, a duplicate id, and a missing script file.
- The interpreter is resolved when the action runs, not here: `node` is the interpreter running sfdx-hardis, `python` tries `python3` then `python`, `bash` is taken from PATH.
- Sends a refresh message so the VS Code extension reloads the DevOps Pipeline panel.
</details>


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|allowed-contexts|option|Comma-separated execution contexts the function may be used with (default: all of them)||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|description|option|Description of what the function does||||
|flags-dir|option|undefined||||
|id|option|Function id, used as the deployment action type (ex: notifySlack)||||
|inputs|option|Input contract: "name[:type][:required][|opt1,opt2][=default]" entries separated by ";"||||
|json|boolean|Format output as json.||||
|label|option|Human-readable label for the function||||
|outputs|option|Output contract: "name[:type]" entries separated by ";"||||
|runtime|option|Script runtime: node, python or bash|||node<br/>python<br/>bash|
|script|option|Path to the script file, relative to the repository root||||
|timeout|option|Maximum duration of a run, in seconds (default: 600)||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||
|when|option|Restrict the function to one deployment phase (default: both)|||pre-deploy<br/>post-deploy|

## Examples

```shell
$ sf hardis:project:function:create
```

```shell
$ sf hardis:project:function:create --agent --id notifySlack --label "Notify Slack channel" --runtime node --script scripts/functions/notify-slack.js
```

```shell
$ sf hardis:project:function:create --agent --id findAccount --label "Find an account" --runtime python --script scripts/functions/find-account.py --inputs "name:string:required" --outputs "accountId"
```

```shell
$ sf hardis:project:function:create --agent --id warmCache --label "Warm the cache" --runtime bash --script scripts/functions/warm-cache.sh --when post-deploy --timeout 1200
```


