<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:multi-org-query

## Description


**Executes a SOQL query across multiple Salesforce organizations and consolidates the results into a single report.**

This command is highly valuable for administrators and developers who need to gather consistent data from various Salesforce environments (e.g., sandboxes, production orgs) for reporting, auditing, or comparison purposes. It streamlines the process of querying multiple orgs, eliminating the need to log into each one individually.

Key functionalities:

- **Flexible Query Input:** You can provide a custom SOQL query directly using the `--query` flag, or select from a list of predefined query templates (e.g., `active-users`, `all-users`) using the `--query-template` flag.
- **Multiple Org Targeting:** Specify a list of Salesforce org usernames or aliases using the `--target-orgs` flag. If not provided, an interactive menu will allow you to select multiple authenticated orgs.
- **Consolidated Report:** All query results from the different orgs are combined into a single CSV file, making data analysis and comparison straightforward.
- **Authentication Handling:** For CI/CD jobs, ensure that the target orgs are already authenticated using Salesforce CLI. In interactive mode, it will prompt for authentication if an org is not connected.

**Visual Demo:**

[![Use in VsCode SFDX Hardis !](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/multi-org-query-demo.gif)](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Org Authentication and Connection:** It uses `AuthInfo.create` and `Connection.create` to establish connections to each target Salesforce org. It also leverages `makeSureOrgIsConnected` and `promptOrgList` for interactive org selection and authentication checks.
- **SOQL Query Execution (Bulk API):** It executes the specified SOQL query against each connected org using `bulkQuery` for efficient data retrieval, especially for large datasets.
- **Data Aggregation:** It collects the records from each org's query result and adds metadata about the source org (instance URL, alias, username) to each record, enabling easy identification of data origin in the consolidated report.
- **Report Generation:** It uses `generateCsvFile` to create the final CSV report and `generateReportPath` to determine the output file location.
- **Interactive Prompts:** The `prompts` library is used to guide the user through selecting a query template or entering a custom query, and for selecting target orgs if not provided as command-line arguments.
- **Error Handling:** It logs errors for any orgs where the query fails, ensuring that the overall process continues and provides a clear summary of successes and failures.
</details>


## Parameters

| Name                  |  Type   | Description                                                       | Default | Required |          Options           |
|:----------------------|:-------:|:------------------------------------------------------------------|:-------:|:--------:|:--------------------------:|
| debug<br/>-d          | boolean | Activate debug mode (more logs)                                   |         |          |                            |
| flags-dir             | option  | undefined                                                         |         |          |                            |
| json                  | boolean | Format output as json.                                            |         |          |                            |
| outputfile<br/>-f     | option  | Force the path and name of output report file. Must end with .csv |         |          |                            |
| query<br/>-q          | option  | SOQL Query to run on multiple orgs                                |         |          |                            |
| query-template<br/>-t | option  | Use one of predefined SOQL Query templates                        |         |          | active-users<br/>all-users |
| skipauth              | boolean | Skip authentication check when a default username is required     |         |          |                            |
| target-orgs<br/>-x    | option  | List of org usernames or aliases.                                 |         |          |                            |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration         |         |          |                            |

## Examples

```shell
$ sf hardis:org:multi-org-query
```

```shell
$ sf hardis:org:multi-org-query --query "SELECT Id,Username FROM User"
```

```shell
$ sf hardis:org:multi-org-query --query "SELECT Id,Username FROM User" --target-orgs nico@cloudity.com nico@cloudity.com.preprod nico@cloudity.com.uat
```

```shell
$ sf hardis:org:multi-org-query --query-template active-users --target-orgs nico@cloudity.com nico@cloudity.com.preprod nico@cloudity.com.uat
```


