<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:user:freeze

## Description


## Command Behavior

**Freezes Salesforce user logins, temporarily revoking access for selected users.**

This command allows administrators to freeze Salesforce user logins. It provides a controlled way to temporarily revoke user access without deactivating the user record itself. This is useful for managing user access during leaves, security incidents, or when a user's access needs to be temporarily suspended.

Key functionalities:

- **User Selection:** You can select users to freeze based on their assigned profiles.
  - `--includeprofiles`: Freeze users belonging to a comma-separated list of specified profiles.
  - `--excludeprofiles`: Freeze users belonging to all profiles *except* those specified in a comma-separated list.
  - If no profile flags are provided, an interactive menu will allow you to select profiles.
- **Interactive Confirmation:** In non-CI environments, it prompts for confirmation before freezing the selected users.
- **Bulk Freezing:** Efficiently freezes multiple user logins using Salesforce's Bulk API.
- **Reporting:** Generates CSV and XLSX reports of the users that are about to be frozen.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SOQL Queries (Bulk API):** It executes SOQL queries against the `User` and `Profile` objects to identify active users based on the provided profile filters. It then queries the `UserLogin` object to find active login sessions for these users.
- **Interactive Prompts:** Uses the `prompts` library to guide the user through profile selection and to confirm the freezing operation.
- **Bulk Update:** It constructs an array of `UserLogin` records with their `Id` and `IsFrozen` set to `true`, then uses `bulkUpdate` to perform the mass update operation on the Salesforce org.
- **Reporting:** It uses `generateReports` to create CSV and XLSX files containing details of the users to be frozen.
- **Logging:** Provides clear messages about the number of users found and the success of the freezing process.
</details>


## Parameters

| Name                   |  Type   | Description                                                       | Default | Required | Options |
|:-----------------------|:-------:|:------------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d           | boolean | Activate debug mode (more logs)                                   |         |          |         |
| excludeprofiles<br/>-e | option  | List of profiles that you want to NOT freeze, separated by commas |         |          |         |
| flags-dir              | option  | undefined                                                         |         |          |         |
| includeprofiles<br/>-p | option  | List of profiles that you want to freeze, separated by commas     |         |          |         |
| json                   | boolean | Format output as json.                                            |         |          |         |
| maxuserdisplay<br/>-m  | option  | Maximum users to display in logs                                  |   100   |          |         |
| name<br/>-n            | option  | Filter according to Name criteria                                 |         |          |         |
| skipauth               | boolean | Skip authentication check when a default username is required     |         |          |         |
| target-org<br/>-o      | option  | undefined                                                         |         |          |         |
| websocket              | option  | Websocket host:port for VsCode SFDX Hardis UI integration         |         |          |         |

## Examples

```shell
$ sf hardis:org:user:freeze
```

```shell
$ sf hardis:org:user:freeze --target-org my-user@myorg.com
```

```shell
$ sf hardis:org:user:freeze --includeprofiles 'Standard'
```

```shell
$ sf hardis:org:user:freeze --excludeprofiles 'System Administrator,Some Other Profile'
```


