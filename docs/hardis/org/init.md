<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:init

## Description

Runs the initialization steps of the project on an existing scratch org or sandbox.

## Command Behavior (Beta)

> **This command is currently in Beta.** Please report any issues or feedback on the [sfdx-hardis GitHub repository](https://github.com/hardisgroupcom/sfdx-hardis/issues).

**Brings an org to the state a new scratch org or sandbox gets when it is created: packages, project sources, permission sets, Apex scripts, data and custom commands, in the order the project defines.**

- **Same steps as creation:** the steps are the ones [hardis:scratch:create](https://sfdx-hardis.cloudity.com/hardis/scratch/create/) and [hardis:org:create](https://sfdx-hardis.cloudity.com/hardis/org/create/) run, read from `orgInitSteps` in `config/.sfdx-hardis.yml`. Without that key, the list is built from the older keys (`installedPackages`, `initPermissionSets`, `scratchOrgInitApexScripts`, `sandboxOrgInitApexScripts`, `dataPackages`, `scripts/data/ScratchInit`, `scripts/data/SandboxInit`).
- **Org type:** the command reads whether the org is a scratch org or a sandbox, and only runs the steps that apply to it. It refuses production orgs.
- **Step selection:** the user picks the steps to run (all are selected), or passes their ids with `--steps`.
- **Failures:** a failed step stops the run unless it allows failure. A summary table lists the outcome of every step.

Configure the steps from the Org Initialization panel of the VS Code extension, or in `orgInitSteps` (see [sfdx-hardis configuration](https://sfdx-hardis.cloudity.com/schema/sfdx-hardis-json-schema-parameters.html)). [hardis:config:org-init](https://sfdx-hardis.cloudity.com/hardis/config/org-init/) lists them with their ids.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:org:init --agent --target-org my-scratch@example.com
sf hardis:org:init --agent --target-org my-sandbox@example.com --steps assign-permsets,load-accounts
```

In agent mode:

- The step selection prompt is skipped: every step that applies to the org runs, or only the ones of `--steps`.

<details markdown="1">
<summary>Technical explanations</summary>

- The org type comes from `IsSandbox` and `TrialExpirationDate` of the `Organization` record.
- Steps run through `runOrgInitSteps()` (`src/common/utils/orgInitUtils.ts`), with the deployment actions providers plus three org initialization types: `install-packages`, `deploy-sources` (scratch orgs only) and `assign-permission-sets`.
- While the steps run, `SF_TARGET_ORG`, `SFDX_HARDIS_ORG_USERNAME` and `SFDX_HARDIS_ORG_TYPE` point to the org, so a `command` step that runs an sf command targets it without `--target-org`.
</details>


## Parameters

| Name              |  Type   | Description                                                                                                  | Default | Required | Options |
|:------------------|:-------:|:-------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent             | boolean | Run in non-interactive mode for agents and automation                                                        |         |          |         |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                                              |         |          |         |
| flags-dir         | option  | Import flag values from a directory.                                                                         |         |          |         |
| json              | boolean | Format output as json.                                                                                       |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                                                |         |          |         |
| steps             | option  | Comma-separated ids of the steps to run. Default: every step that applies to the org                         |         |          |         |
| target-org<br/>-o | option  | Username or alias of the target org. Not required if the `target-org` configuration variable is already set. |         |   true   |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                    |         |          |         |

## Examples

```shell
$ sf hardis:org:init
```

```shell
$ sf hardis:org:init --target-org my-scratch@example.com --steps legacy-permission-sets,legacy-data-scratchinit
```

```shell
$ sf hardis:org:init --agent
```


