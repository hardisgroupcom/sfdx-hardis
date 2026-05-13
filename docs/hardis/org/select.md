<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:select

## Description


## Command Behavior

> **This command requires human interaction and must be called manually, preferably from the [VS Code SFDX Hardis UI](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis). It is not suitable for automation or AI agent usage.**

**Allows you to select a Salesforce org and set it as your default, optionally filtering by Dev Hub or scratch orgs.**

This command simplifies switching between different Salesforce environments. It presents an interactive list of your authenticated orgs, enabling you to quickly set a new default org for subsequent Salesforce CLI commands.

Key functionalities:

- **Interactive Org Selection:** Displays a list of your authenticated Salesforce orgs, allowing you to choose one.
- **Default Org Setting:** Sets the selected org as the default for your Salesforce CLI environment.
- **Dev Hub Filtering:** The `--devhub` flag filters the list to show only Dev Hub orgs.
- **Scratch Org Filtering:** The `--scratch` flag filters the list to show only scratch orgs related to your default Dev Hub.
- **Connection Verification:** Ensures that the selected org is connected and prompts for re-authentication if necessary.
- **Forced Reconnection:** The `--reconnect` flag skips the connection check and goes straight to re-authentication.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Interactive Org Prompt:** Uses the `promptOrg` utility to display a list of available Salesforce orgs and allows the user to select one. It passes the `devHub` and `scratch` flags to `promptOrg` to filter the displayed list.
- **Default Org Configuration:** The `promptOrg` utility (internally) handles setting the selected org as the default using Salesforce CLI's configuration mechanisms.
- **Connection Check:** It calls `makeSureOrgIsConnected` to verify the connection status of the selected org and guides the user to re-authenticate if the org is not connected.
- **Forced Reconnection:** When `--reconnect` is used, the command skips the connection check and directly triggers `sf org login web` with `--set-default`, combining re-authentication and default-setting into a single CLI call.
- **Salesforce CLI Integration:** It leverages Salesforce CLI's underlying commands for org listing and authentication.
</details>


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|devhub<br/>-h|boolean|Also connect associated DevHub||||
|flags-dir|option|undefined||||
|instance-url|option|Instance URL to use for login when reconnecting (e.g. https://myorg.salesforce.com). Required with --reconnect.||||
|json|boolean|Format output as json.||||
|reconnect<br/>-r|boolean|Force re-authentication (skip connection check and go straight to login)||||
|scratch<br/>-s|boolean|Select scratch org related to default DevHub||||
|set-default|boolean|Set the selected org as default target-org (or target-dev-hub if --devhub is used). Use --no-set-default to skip. If omitted, you will be prompted.||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|username<br/>-t|option|Username of the org you want to authenticate (overrides the interactive prompt)||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:org:select
```

```shell
$ sf hardis:org:select --devhub
```

```shell
$ sf hardis:org:select --username myuser@example.com --set-default
```

```shell
$ sf hardis:org:select --username myuser@example.com --no-set-default
```

```shell
$ sf hardis:org:select --reconnect --instance-url https://myorg.salesforce.com --set-default
```

```shell
$ sf hardis:org:select --agent --set-default
```


