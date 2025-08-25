<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:purge:flow

## Description


**Purges old or unwanted Flow versions from a Salesforce org, with an option to delete related Flow Interviews.**

This command helps maintain a clean and performant Salesforce org by removing obsolete Flow versions. Over time, multiple versions of Flows can accumulate, consuming storage and potentially impacting performance. This tool provides a controlled way to clean up these versions.

Key functionalities:

- **Targeted Flow Selection:** Allows you to filter Flow versions to delete by name (`--name`) and status (`--status`, e.g., `Obsolete`, `Draft`, `Inactive`).
- **Flow Interview Deletion:** If a Flow version cannot be deleted due to active Flow Interviews, the `--delete-flow-interviews` flag (or interactive prompt) allows you to delete these interviews first, then retry the Flow version deletion.
- **Confirmation Prompt:** In interactive mode, it prompts for confirmation before proceeding with the deletion of Flow versions and Flow Interviews.
- **Partial Success Handling:** The `--allowpurgefailure` flag (default `true`) allows the command to continue even if some deletions fail, reporting the errors.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SOQL Queries (Tooling API):** It queries the `Flow` object (using the Tooling API) to list Flow versions based on the provided filters (name, status, manageable state).
- **Bulk Deletion (Tooling API):** It uses `bulkDeleteTooling` to perform mass deletions of Flow versions. If deletion fails due to active interviews, it extracts the interview IDs.
- **Flow Interview Management:** If `delete-flow-interviews` is enabled, it queries `FlowInterview` objects, performs bulk deletion of the identified interviews using `bulkDelete`, and then retries the Flow version deletion.
- **Interactive Prompts:** Uses the `prompts` library to interact with the user for selecting Flows, statuses, and confirming deletion actions.
- **Error Reporting:** Logs detailed error messages for failed deletions, including the specific reasons.
- **Command-Line Execution:** Uses `execSfdxJson` to execute Salesforce CLI commands for querying Flow data.
</details>


## Parameters

| Name                          |  Type   | Description                                                                                                              |           Default            | Required | Options |
|:------------------------------|:-------:|:-------------------------------------------------------------------------------------------------------------------------|:----------------------------:|:--------:|:-------:|
| allowpurgefailure<br/>-f      | boolean | Allows purges to fail without exiting with 1. Use --no-allowpurgefailure to disable                                      |                              |          |         |
| debug<br/>-d                  | boolean | Activate debug mode (more logs)                                                                                          |                              |          |         |
| delete-flow-interviews<br/>-w | boolean | If the presence of Flow interviews prevent to delete flows versions, delete them before retrying to delete flow versions |                              |          |         |
| flags-dir                     | option  | undefined                                                                                                                |                              |          |         |
| instanceurl<br/>-r            | option  | URL of org instance                                                                                                      | https://login.salesforce.com |          |         |
| json                          | boolean | Format output as json.                                                                                                   |                              |          |         |
| name<br/>-n                   | option  | Filter according to Name criteria                                                                                        |                              |          |         |
| prompt<br/>-z                 | boolean | Prompt for confirmation (true by default, use --no-prompt to skip)                                                       |                              |          |         |
| skipauth                      | boolean | Skip authentication check when a default username is required                                                            |                              |          |         |
| status<br/>-s                 | option  | Filter according to Status criteria                                                                                      |                              |          |         |
| target-org<br/>-o             | option  | undefined                                                                                                                |                              |          |         |
| websocket                     | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                |                              |          |         |

## Examples

```shell
$ sf hardis:org:purge:flow
```

```shell
$ sf hardis:org:purge:flow --target-org nicolas.vuillamy@gmail.com --no-prompt --delete-flow-interviews
```

```shell
$ sf hardis:org:purge:flow --target-org nicolas.vuillamy@gmail.com --status "Obsolete,Draft,InvalidDraft" --name TestFlow
```


