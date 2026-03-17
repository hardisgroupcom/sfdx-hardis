<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:scratch:pool:localauth

## Description


## Command Behavior

**Authenticates a local user to the configured scratch org pool storage service, enabling them to fetch and manage scratch orgs from the pool.**

This command is essential for developers who want to utilize a shared scratch org pool for their local development. It establishes the necessary authentication with the backend storage service (e.g., Salesforce Custom Object, Redis) that manages the pool's state, allowing the user to retrieve available scratch orgs for their work.

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


## Parameters

| Name                  |  Type   | Description                                                   | Default | Required | Options |
|:----------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d          | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir             | option  | undefined                                                     |         |          |         |
| json                  | boolean | Format output as json.                                        |         |          |         |
| skipauth              | boolean | Skip authentication check when a default username is required |         |          |         |
| target-dev-hub<br/>-v | option  | undefined                                                     |         |          |         |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:scratch:pool:localauth
```


