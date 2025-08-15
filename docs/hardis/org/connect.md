<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:connect

## Description


## Command Behavior

**Connects to a Salesforce org without setting it as the default username, and optionally opens the org in a web browser.**

This command provides a quick way to establish a connection to a Salesforce organization for one-off tasks or when you don't want to change your default org. It's useful for accessing different environments without disrupting your primary development setup.

Key functionalities:

- **Org Selection:** Prompts the user to select an existing Salesforce org or connect to a new one.
- **Non-Default Connection:** Ensures that the selected org is connected but does not set it as the default username for subsequent Salesforce CLI commands.
- **Browser Launch (Optional):** Offers to open the connected org directly in your default web browser, providing immediate access to the Salesforce UI.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Interactive Org Prompt:** Uses the `promptOrg` utility to display a list of available Salesforce orgs and allows the user to select one or initiate a new authentication flow.
- **Salesforce CLI Integration:** Internally, it leverages Salesforce CLI commands to establish the connection to the chosen org. It does not use `sf config set target-org` to avoid changing the default org.
- **Browser Launch:** If the user opts to open the org in a browser, it executes the `sf org open` command, passing the selected org's username as the target.
- **Environment Awareness:** Checks the `isCI` flag to determine whether to offer the browser launch option, as it's typically not applicable in continuous integration environments.
</details>


## Parameters

| Name         |  Type   | Description                                                   | Default | Required | Options |
|:-------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir    | option  | undefined                                                     |         |          |         |
| json         | boolean | Format output as json.                                        |         |          |         |
| skipauth     | boolean | Skip authentication check when a default username is required |         |          |         |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:org:connect
```


