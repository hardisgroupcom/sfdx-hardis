<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:configure:auth

## Description


## Command Behavior

> **This command requires human interaction and must be called manually, preferably from the [VS Code SFDX Hardis UI](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis). It is not suitable for automation or AI agent usage.**

**Configures authentication between a Git branch and a target Salesforce org for CI/CD deployments.**

This command facilitates the setup of automated CI/CD pipelines, enabling seamless deployments from specific Git branches to designated Salesforce orgs. It supports both standard Salesforce orgs and Dev Hub configurations, catering to various enterprise deployment workflows.

It creates an **External Client App** that uses the JWT Bearer flow with SSL certificates for secure CI/CD authentication.

Key functionalities include:

- **Org Selection/Login:** Guides the user to select an existing Salesforce org or log in to a new one.
- **Config Naming:** Names the auth config after an existing Git branch (default), or derives a name from the org domain with `--name-type org-domain` (or pass an explicit name with `--name`). Org-domain configs are not tied to a Git branch, so the merge targets step is skipped.
- **Git Branch Association:** Allows associating a specific Git branch with the chosen Salesforce org.
- **Merge Target Definition:** Enables defining target Git branches into which the configured branch can merge, ensuring controlled deployment flows.
- **Salesforce Username Configuration:** Prompts for the Salesforce username to be used by the CI server for deployments.
- **SSL Certificate Generation:** Automatically generates an SSL certificate for secure authentication.
- **External Client App Creation:** Creates an External Client App (Connected Apps can no longer be created in Salesforce orgs). Pass `--app-name` to name the app instead of being prompted. The app description is set from its usage: CI/CD and monitoring include a link to the matching documentation, while `--usage other` uses `--app-description` (or prompts for it). If the app already exists in the org, the deployment fails and you are offered a Setup link to delete it, then retry or give up.
- **Certificate Storage:** By default the encrypted certificate is committed to the repository. Pass `--external-storage` to keep only the encrypted certificate out of the repository and store it in a password manager instead, then provide it at authentication time (see `hardis:auth:login --encrypted-cert-file`). The other secrets (client id, decryption key) are still stored as CI/CD variables.

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

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|app-description|option|Description of the External Client App (only used when --usage other)||||
|app-name|option|Name of the External Client App to create||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|devhub<br/>-b|boolean|Configure project DevHub||||
|external-storage|boolean|Do not store the encrypted certificate in a file in the repository. Instead, the user is asked to keep it in a password manager and provide it at authentication time. The other secrets (client id, decryption key) are still stored as CI/CD variables.||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|name|option|Name of the org-based auth config to create in config/branches (skips Git branch selection and merge targets). Auto-derived from the org domain when --name-type=org-domain.||||
|name-type|option|How to name the auth config: git-branch (select an existing Git branch) or org-domain (derive the name from the org domain)|git-branch||git-branch<br/>org-domain|
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-dev-hub<br/>-v|option|undefined||||
|target-org<br/>-o|option|undefined||||
|usage|option|Usage of the External Client App, used to set its description. With "other", the description is taken from --app-description or prompted|cicd||cicd<br/>monitoring<br/>other|
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:project:configure:auth
```

```shell
$ sf hardis:project:configure:auth --name-type org-domain --app-name sfdxhardismyorg
```

```shell
$ sf hardis:project:configure:auth --name-type org-domain --app-name sfdxhardismyorg --external-storage
```

```shell
$ sf hardis:project:configure:auth --usage other --app-description "External Client App for my integration"
```


