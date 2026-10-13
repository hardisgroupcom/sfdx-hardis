<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:scratch:pool:create

## Description


## Command Behavior

**Configures a scratch org pool for the project: where the pool is stored, and how many scratch orgs it holds.**

A pool keeps scratch orgs ready, so a CI job or a developer gets one in seconds instead of waiting for its creation.

Key functionalities:

- **Storage choice:** `gitProvider` stores the pool in a "Scratch Orgs Pool Dashboard" of your git provider: an issue on GitHub and GitLab, a work item on Azure DevOps, a dedicated Pull Request on Bitbucket. `salesforce` stores it in a custom object of the Dev Hub.
- **Encryption (`gitProvider` storage):** the credentials of the scratch orgs are encrypted. The command generates the key and displays it once: store it in a masked CI variable named `SFDX_HARDIS_POOL_ENCRYPTION_KEY`.
- **Pool size:** saves `poolConfig.maxScratchOrgsNumber` in `.sfdx-hardis.yml`.
- **Existing configuration:** the command stops when a pool is already configured. Remove `poolConfig` from `.sfdx-hardis.yml` to configure it again.

Once the pool is configured, schedule a CI job that fills it:

- Set the CI variables `USE_SCRATCH_ORGS` and `SCRATCH_ORG_POOL` to `true`
- The job runs:

```shell
sf hardis:auth:login --devhub
sf hardis:scratch:pool:refresh
```

<details markdown="1">
<summary>Technical explanations</summary>

- **Storage providers:** `listKeyValueProviders` lists the available storages, `instantiateProvider` builds the selected one, and its `userSetup` method prepares it (dashboard creation, or deployment of the custom object on the Dev Hub).
- **Configuration:** `poolConfig` is written in the project configuration with `setConfig`.
- **Git provider storage:** the git provider is detected from the tokens of the environment (`GITHUB_TOKEN`, `CI_SFDX_HARDIS_GITLAB_TOKEN`, `CI_SFDX_HARDIS_AZURE_TOKEN`, `CI_SFDX_HARDIS_BITBUCKET_TOKEN`), read from the `.env` file or sent by the VS Code extension.
- **Encryption:** AES-256-GCM, with a key derived from `SFDX_HARDIS_POOL_ENCRYPTION_KEY`. A key already present in the environment is reused.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:scratch:pool:create --agent --storage-service gitProvider --max-scratch-orgs 5
```

In agent mode:

- No prompt is displayed.
- `--storage-service` defaults to `gitProvider`.
- `--max-scratch-orgs` defaults to 5.


## Parameters

| Name                  |  Type   | Description                                                                                                       | Default | Required |                 Options                  |
|:----------------------|:-------:|:------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:----------------------------------------:|
| agent                 | boolean | Run in non-interactive mode for agents and automation                                                             |         |          |                                          |
| debug<br/>-d          | boolean | Activate debug mode (more logs)                                                                                   |         |          |                                          |
| flags-dir             | option  | Import flag values from a directory.                                                                              |         |          |                                          |
| json                  | boolean | Format output as json.                                                                                            |         |          |                                          |
| max-scratch-orgs      | option  | Maximum number of scratch orgs in the pool (asked when not set)                                                   |         |          |                                          |
| skipauth              | boolean | Skip authentication check when a default username is required                                                     |         |          |                                          |
| storage-service       | option  | Where the pool is stored (asked when not set)                                                                     |         |          | gitProvider<br/>salesforce<br/>localtest |
| target-dev-hub<br/>-v | option  | Username or alias of the Dev Hub org. Not required if the `target-dev-hub` configuration variable is already set. |         |   true   |                                          |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                         |         |          |                                          |

## Examples

```shell
$ sf hardis:scratch:pool:create
```

```shell
$ sf hardis:scratch:pool:create --agent
```

```shell
$ sf hardis:scratch:pool:create --agent --storage-service gitProvider --max-scratch-orgs 5
```


