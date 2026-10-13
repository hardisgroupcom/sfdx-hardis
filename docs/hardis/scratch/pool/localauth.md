<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:scratch:pool:localauth

## Description


## Command Behavior

**Authenticates a local user to the configured scratch org pool storage service, enabling them to fetch and manage scratch orgs from the pool.**

This command is for developers who want to take scratch orgs from a shared pool on their workstation. It checks the access to the storage service that holds the pool (dashboard of the git provider, or Salesforce Custom Object on the Dev Hub).

With the `gitProvider` storage there is nothing to log in to: the command checks that a git provider token and the encryption key of the pool (`SFDX_HARDIS_POOL_ENCRYPTION_KEY`) are available, and tells where to set them when they are not: the `.env` file of the project, or the secrets of the VS Code extension.

Key functionalities:

- **Storage Service Authentication:** Initiates the authentication process with the chosen storage service to obtain the required API keys or secrets.
- **Enables Pool Access:** Once authenticated, the local user can then use other sfdx-hardis commands to fetch, use, and return scratch orgs from the pool.
- **Configuration Check:** Verifies if a scratch org pool is already configured for the current project and provides guidance if it's not.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Configuration Loading:** It retrieves the `poolConfig` from the project's .sfdx-hardis.yml file to identify the configured storage service.
- **Provider Instantiation:** It uses the `instantiateProvider` utility function to create an instance of the `KeyValueProviderInterface` corresponding to the configured storage service.
- **User Authentication:** It then calls the `userAuthenticate()` method on the instantiated provider. This method encapsulates the specific logic for authenticating with the chosen storage service (e.g., prompting for API keys, performing OAuth flows).
- **Error Handling:** It checks for the absence of a configured scratch org pool and provides a user-friendly message.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:scratch:pool:localauth --agent
```

In agent mode, all interactive prompts are skipped and default values are used.



## Parameters

| Name                  |  Type   | Description                                                                                                       | Default | Required | Options |
|:----------------------|:-------:|:------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent                 | boolean | Run in non-interactive mode for agents and automation                                                             |         |          |         |
| debug<br/>-d          | boolean | Activate debug mode (more logs)                                                                                   |         |          |         |
| flags-dir             | option  | Import flag values from a directory.                                                                              |         |          |         |
| json                  | boolean | Format output as json.                                                                                            |         |          |         |
| skipauth              | boolean | Skip authentication check when a default username is required                                                     |         |          |         |
| target-dev-hub<br/>-v | option  | Username or alias of the Dev Hub org. Not required if the `target-dev-hub` configuration variable is already set. |         |   true   |         |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                         |         |          |         |

## Examples

```shell
$ sf hardis:scratch:pool:localauth
```

```shell
$ sf hardis:scratch:pool:localauth --agent
```


