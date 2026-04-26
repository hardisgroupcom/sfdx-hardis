<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:user:unfreeze

## Description


## Command Behavior

**Unfreezes Salesforce user logins, restoring access for selected users.**

This command allows administrators to unfreeze Salesforce user logins, reactivating their access to the Salesforce org. This is the counterpart to the `freeze` command and is used to restore access after a temporary suspension.

Key functionalities:

- **User Selection:** You can select users to unfreeze using one of the following methods:
  - `--usernames`: Unfreeze a specific comma-separated list of Salesforce usernames (takes priority over profile flags).
  - `--includeprofiles`: Unfreeze users belonging to a comma-separated list of specified profiles.
  - `--excludeprofiles`: Unfreeze users belonging to all profiles *except* those specified in a comma-separated list.
  - If no flags are provided, an interactive menu will allow you to select profiles.
- **Interactive Confirmation:** In non-CI environments, it prompts for confirmation before unfreezing the selected users.
- **Bulk Unfreezing:** Efficiently unfreezes multiple user logins using Salesforce's Bulk API.
- **Reporting:** Generates CSV and XLSX reports of the users that are about to be unfrozen.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:org:user:unfreeze --agent --usernames 'user1@myorg.com,user2@myorg.com' --target-org my-user@myorg.com
sf hardis:org:user:unfreeze --agent --includeprofiles 'Standard' --target-org my-user@myorg.com
```

In agent mode:

- All interactive prompts and confirmations are skipped.
- The unfreeze operation proceeds automatically for the matched users.
- You must provide `--usernames`, `--includeprofiles`, or `--excludeprofiles` (interactive selection is not available).

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SOQL Queries (Bulk API):** When `--usernames` is provided, users are queried directly by username. Otherwise, it queries the `User` and `Profile` objects to identify active users based on the provided profile filters. It then queries the `UserLogin` object to find frozen login sessions for these users.
- **Interactive Prompts:** Uses the `prompts` library to guide the user through profile selection and to confirm the unfreezing operation.
- **Bulk Update:** It constructs an array of `UserLogin` records with their `Id` and `IsFrozen` set to `false`, then uses `bulkUpdate` to perform the mass update operation on the Salesforce org.
- **Reporting:** It uses `generateReports` to create CSV and XLSX files containing details of the users to be unfrozen.
- **Logging:** Provides clear messages about the number of users found and the success of the unfreezing process.
</details>


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|excludeprofiles<br/>-e|option|List of profiles that you want to NOT unfreeze, separated by commas||||
|flags-dir|option|undefined||||
|includeprofiles<br/>-p|option|List of profiles that you want to unfreeze, separated by commas||||
|json|boolean|Format output as json.||||
|maxuserdisplay<br/>-m|option|Maximum users to display in logs|100|||
|name<br/>-n|option|Filter according to Name criteria||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-org<br/>-o|option|undefined||||
|usernames<br/>-u|option|Comma-separated list of Salesforce usernames to unfreeze (takes priority over profile flags)||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:org:user:unfreeze
```

```shell
$ sf hardis:org:user:unfreeze --target-org my-user@myorg.com
```

```shell
$ sf hardis:org:user:unfreeze --usernames 'user1@myorg.com,user2@myorg.com'
```

```shell
$ sf hardis:org:user:unfreeze --includeprofiles 'Standard'
```

```shell
$ sf hardis:org:user:unfreeze --excludeprofiles 'System Administrator,Some Other Profile'
```

```shell
$ sf hardis:org:user:unfreeze --agent --usernames 'user1@myorg.com,user2@myorg.com'
```

```shell
$ sf hardis:org:user:unfreeze --agent --includeprofiles 'Standard'
```


