<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:auth:login

## Description


## Command Behavior

**Authenticates to a Salesforce org, primarily designed for CI/CD workflows.**

This command facilitates secure and automated logins to Salesforce organizations within continuous integration and continuous delivery pipelines. It leverages pre-configured authentication details, ensuring that CI/CD processes can interact with Salesforce without manual intervention.

Key aspects:

- **Configuration-Driven:** It relies on authentication variables and files set up by dedicated configuration commands:
  - For CI/CD repositories: [Configure Org CI Authentication](https://sfdx-hardis.cloudity.com/hardis/project/configure/auth/)
  - For Monitoring repositories: [Configure Org Monitoring](https://sfdx-hardis.cloudity.com/hardis/org/configure/monitoring/)
- **Technical Org Support:** Supports authentication to a 'technical org' (e.g., for calling Agentforce from another org) by utilizing the `SFDX_AUTH_URL_TECHNICAL_ORG` environment variable. If this variable is set, the command authenticates to this org with the alias `TECHNICAL_ORG`.

To obtain the `SFDX_AUTH_URL_TECHNICAL_ORG` value, you can run `sf org display --verbose --json` and copy the `sfdxAuthUrl` field from the output.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical flow involves:

- **Flag Parsing:** It parses command-line flags such as `instanceurl`, `devhub`, `scratchorg`, and `debug` to determine the authentication context.
- **Authentication Hook:** It triggers an internal authentication hook (`this.config.runHook('auth', ...`)) which is responsible for executing the actual authentication logic based on the provided flags (e.g., whether it's a Dev Hub or a scratch org).
- **Environment Variable Check:** It checks for the presence of `SFDX_AUTH_URL_TECHNICAL_ORG` or `TECHNICAL_ORG_ALIAS` environment variables.
- **`authOrg` Utility:** If a technical org is configured, it calls the `authOrg` utility function to perform the authentication for that specific org, ensuring it's connected and available for subsequent operations.
- **Salesforce CLI Integration:** It integrates with the Salesforce CLI's authentication mechanisms to establish and manage org connections.
</details>


## Parameters

| Name               |  Type   | Description                                                   | Default | Required | Options |
|:-------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d       | boolean | Activate debug mode (more logs)                               |         |          |         |
| devhub<br/>-h      | boolean | Also connect associated DevHub                                |         |          |         |
| flags-dir          | option  | undefined                                                     |         |          |         |
| instanceurl<br/>-r | option  | URL of org instance                                           |         |          |         |
| json               | boolean | Format output as json.                                        |         |          |         |
| scratchorg<br/>-s  | boolean | Scratch org                                                   |         |          |         |
| skipauth           | boolean | Skip authentication check when a default username is required |         |          |         |
| websocket          | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:auth:login
```

```shell
CI=true sf hardis:auth:login
```


