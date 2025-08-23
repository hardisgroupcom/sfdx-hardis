<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:community:update

## Description


## Command Behavior

**Updates the status of one or more Salesforce Experience Cloud (Community) networks.**

This command provides a way to programmatically change the status of your Salesforce Communities, allowing you to manage their availability. This is particularly useful for:

- **Maintenance:** Taking communities offline for planned maintenance (`DownForMaintenance`).
- **Activation/Deactivation:** Bringing communities online or offline (`Live`, `DownForMaintenance`).
- **Automation:** Integrating community status changes into CI/CD pipelines or scheduled jobs.

Key functionalities:

- **Network Selection:** You can specify one or more community network names (separated by commas) using the `--name` flag.
- **Status Update:** You can set the new status for the selected communities using the `--status` flag. Supported values are `Live` and `DownForMaintenance`.
- **Confirmation Prompt:** In non-CI environments, it provides a confirmation prompt before executing the update, ensuring intentional changes.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Salesforce SOQL Query:** It first queries the Salesforce `Network` object using SOQL to retrieve the `Id`, `Name`, and `Status` of the specified communities. This ensures that only existing communities are targeted.
- **SObject Update:** It then constructs an array of `Network` sObjects with their `Id` and the new `Status` and performs a DML update operation using `conn.sobject("Network").update()`. The `allOrNone: false` option is used to allow partial success in case some updates fail.
- **Error Handling and Reporting:** It iterates through the update results, logging success or failure for each community. It also provides a summary of successful and erroneous updates.
- **User Interaction:** Uses `prompts` to confirm the update action with the user when not running in a CI environment.
- **Salesforce Connection:** Establishes a connection to the target Salesforce org using the `target-org` flag.
</details>


## Parameters

| Name              |  Type   | Description                                                                  | Default | Required | Options |
|:------------------|:-------:|:-----------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                              |         |          |         |
| flags-dir         | option  | undefined                                                                    |         |          |         |
| json              | boolean | Format output as json.                                                       |         |          |         |
| name<br/>-n       | option  | List of Networks Names that you want to update, separated by comma           |         |          |         |
| status<br/>-s     | option  | New status for the community, available values are: Live, DownForMaintenance |         |          |         |
| target-org<br/>-o | option  | undefined                                                                    |         |          |         |

## Examples

```shell
$ sf hardis:org:community:update --name 'MyNetworkName' --status DownForMaintenance
```

```shell
$ sf hardis:org:community:update --name 'MyNetworkName,MySecondNetworkName' --status Live
```


