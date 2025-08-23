<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:configure:auth

## Description


## Command Behavior

**Configures authentication between a Git branch and a target Salesforce org for CI/CD deployments.**

This command facilitates the setup of automated CI/CD pipelines, enabling seamless deployments from specific Git branches to designated Salesforce orgs. It supports both standard Salesforce orgs and Dev Hub configurations, catering to various enterprise deployment workflows.

Key functionalities include:

- **Org Selection/Login:** Guides the user to select an existing Salesforce org or log in to a new one.
- **Git Branch Association:** Allows associating a specific Git branch with the chosen Salesforce org.
- **Merge Target Definition:** Enables defining target Git branches into which the configured branch can merge, ensuring controlled deployment flows.
- **Salesforce Username Configuration:** Prompts for the Salesforce username to be used by the CI server for deployments.
- **SSL Certificate Generation:** Automatically generates an SSL certificate for secure authentication.

<details markdown="1">
<summary>Technical explanations</summary>

The command's implementation involves several key technical aspects:

- **SF CLI Integration:** Utilizes 
@salesforce/sf-plugins-core
 for command structure and flag parsing.
- **Interactive Prompts:** Employs the 
prompts
 library for interactive user input, guiding the configuration process.
- **Git Integration:** Interacts with Git to retrieve branch information using 
`git().branch(["--list", "-r"])`
.
- **Configuration Management:** Leverages internal utilities (`checkConfig`, `getConfig`, `setConfig`, `setInConfigFile`) to read from and write to project-specific configuration files (e.g., `.sfdx-hardis.<branchName>.yml`).
- **Salesforce CLI Execution:** Executes Salesforce CLI commands programmatically via `execSfdxJson` for org interactions.
- **SSL Certificate Generation:** Calls `generateSSLCertificate` to create necessary SSL certificates for JWT-based authentication.
- **WebSocket Communication:** Uses `WebSocketClient` for potential communication with external tools or processes, such as restarting the command in VS Code.
- **Dependency Check:** Ensures the presence of `openssl` on the system, which is required for SSL certificate generation.


## Parameters

| Name                  |  Type   | Description                                                   | Default | Required | Options |
|:----------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d          | boolean | Activate debug mode (more logs)                               |         |          |         |
| devhub<br/>-b         | boolean | Configure project DevHub                                      |         |          |         |
| flags-dir             | option  | undefined                                                     |         |          |         |
| json                  | boolean | Format output as json.                                        |         |          |         |
| skipauth              | boolean | Skip authentication check when a default username is required |         |          |         |
| target-dev-hub<br/>-v | option  | undefined                                                     |         |          |         |
| target-org<br/>-o     | option  | undefined                                                     |         |          |         |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:project:configure:auth
```


