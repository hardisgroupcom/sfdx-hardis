<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:convert:profilestopermsets

## Description


## Command Behavior

**Converts existing Salesforce Profiles into Permission Sets, facilitating a more granular and recommended security model.**

This command helps in migrating permissions from Profiles to Permission Sets, which is a best practice for managing user access in Salesforce. It creates a new Permission Set for each specified Profile, adopting a naming convention of `PS_PROFILENAME`.

Key functionalities:

- **Profile to Permission Set Conversion:** Automatically extracts permissions from a Profile and creates a corresponding Permission Set.
- **Naming Convention:** New Permission Sets are named with a `PS_` prefix followed by the Profile name (e.g., `PS_Standard_User`).
- **Exclusion Filter:** Allows you to exclude specific Profiles from the conversion process using the `--except` flag.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **External Plugin Integration:** It relies on the `shane-sfdx-plugins` (specifically the `sf shane:profile:convert` command) to perform the actual conversion.
- **File System Scan:** It reads the contents of the `force-app/main/default/profiles` directory to identify all available Profile metadata files.
- **Command Execution:** For each identified Profile (that is not excluded), it constructs and executes the `sf shane:profile:convert` command with the appropriate Profile name and desired Permission Set name.
- **Error Handling:** Includes basic error handling for the external command execution.
</details>


## Parameters

| Name          |  Type   | Description                                                   | Default | Required | Options |
|:--------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d  | boolean | Activate debug mode (more logs)                               |         |          |         |
| except<br/>-e | option  | List of filters                                               |         |          |         |
| flags-dir     | option  | undefined                                                     |         |          |         |
| json          | boolean | Format output as json.                                        |         |          |         |
| skipauth      | boolean | Skip authentication check when a default username is required |         |          |         |
| websocket     | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:project:convert:profilestopermsets
```


