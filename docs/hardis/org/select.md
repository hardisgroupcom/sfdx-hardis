<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:select

## Description


## Command Behavior

**Allows you to select a Salesforce org and set it as your default, optionally filtering by Dev Hub or scratch orgs.**

This command simplifies switching between different Salesforce environments. It presents an interactive list of your authenticated orgs, enabling you to quickly set a new default org for subsequent Salesforce CLI commands.

Key functionalities:

- **Interactive Org Selection:** Displays a list of your authenticated Salesforce orgs, allowing you to choose one.
- **Default Org Setting:** Sets the selected org as the default for your Salesforce CLI environment.
- **Dev Hub Filtering:** The `--devhub` flag filters the list to show only Dev Hub orgs.
- **Scratch Org Filtering:** The `--scratch` flag filters the list to show only scratch orgs related to your default Dev Hub.
- **Connection Verification:** Ensures that the selected org is connected and prompts for re-authentication if necessary.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Interactive Org Prompt:** Uses the `promptOrg` utility to display a list of available Salesforce orgs and allows the user to select one. It passes the `devHub` and `scratch` flags to `promptOrg` to filter the displayed list.
- **Default Org Configuration:** The `promptOrg` utility (internally) handles setting the selected org as the default using Salesforce CLI's configuration mechanisms.
- **Connection Check:** It calls `makeSureOrgIsConnected` to verify the connection status of the selected org and guides the user to re-authenticate if the org is not connected.
- **Salesforce CLI Integration:** It leverages Salesforce CLI's underlying commands for org listing and authentication.
</details>


## Parameters

| Name           |  Type   | Description                                                   | Default | Required | Options |
|:---------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d   | boolean | Activate debug mode (more logs)                               |         |          |         |
| devhub<br/>-h  | boolean | Also connect associated DevHub                                |         |          |         |
| flags-dir      | option  | undefined                                                     |         |          |         |
| json           | boolean | Format output as json.                                        |         |          |         |
| scratch<br/>-s | boolean | Select scratch org related to default DevHub                  |         |          |         |
| skipauth       | boolean | Skip authentication check when a default username is required |         |          |         |
| websocket      | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:org:select
```


