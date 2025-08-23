<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:purge:apexlog

## Description


**Purges Apex debug logs from a Salesforce org.**

This command provides a quick and efficient way to clear out accumulated Apex debug logs from your Salesforce environment. This is particularly useful for:

- **Storage Management:** Freeing up valuable data storage space in your Salesforce org.
- **Performance Optimization:** Reducing the overhead associated with large volumes of debug logs.
- **Troubleshooting:** Ensuring that new debug logs are generated cleanly without interference from old, irrelevant logs.

Key functionalities:

- **Log Identification:** Queries the `ApexLog` object to identify all existing debug logs.
- **Confirmation Prompt:** Before deletion, it prompts for user confirmation, displaying the number of Apex logs that will be deleted.
- **Bulk Deletion:** Uses the Salesforce Bulk API to efficiently delete a large number of Apex logs.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SOQL Query:** It executes a SOQL query (`SELECT Id FROM ApexLog LIMIT 50000`) to retrieve the IDs of Apex logs to be deleted. The limit is set to 50,000 to handle large volumes of logs.
- **CSV Export:** The retrieved log IDs are temporarily exported to a CSV file (`ApexLogsToDelete_*.csv`) in the `./tmp` directory.
- **User Confirmation:** It uses the `prompts` library to ask for user confirmation before proceeding with the deletion, displaying the count of logs to be purged.
- **Bulk API Deletion:** It then uses the Salesforce CLI's `sf data delete bulk` command, pointing to the generated CSV file, to perform the mass deletion of Apex logs.
- **File System Operations:** It uses `fs-extra` to create the temporary directory and manage the CSV file.
- **Error Handling:** Includes error handling for the query and deletion operations.
</details>


## Parameters

| Name              |  Type   | Description                                                        | Default | Required | Options |
|:------------------|:-------:|:-------------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                    |         |          |         |
| flags-dir         | option  | undefined                                                          |         |          |         |
| json              | boolean | Format output as json.                                             |         |          |         |
| prompt<br/>-z     | boolean | Prompt for confirmation (true by default, use --no-prompt to skip) |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required      |         |          |         |
| target-org<br/>-o | option  | undefined                                                          |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration          |         |          |         |

## Examples

```shell
$ sf hardis:org:purge:apexlog
```

```shell
$ sf hardis:org:purge:apexlog --target-org nicolas.vuillamy@gmail.com
```


