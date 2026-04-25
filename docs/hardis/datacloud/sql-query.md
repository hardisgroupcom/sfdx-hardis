<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:datacloud:sql-query

## Description


## Command Behavior

**Executes a SQL query against Salesforce Data Cloud and exports the results.**

This command lets you run ad-hoc or predefined SQL queries on Data Cloud objects, view the results in the CLI, and export them for further analysis.

Key functionalities:

- **Query input:** Accepts inline SQL via `-q`, a predefined saved query name, or an interactive prompt when no query is provided.
- **Test shortcut:** `-q test` runs a sample query on `ssot__Account__dlm` (sorted by created date, limited to 5000 rows).
- **Export:** Generates CSV and XLSX reports for the returned rows with auto-generated filenames (override with `--outputfile`).
- **Logging:** Prints a JSON summary (excluding full records) and supports debug output via `--debug`.
- **Org targeting:** Works with the provided or default org connection; respects websocket and skipauth flags.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Query resolution:**
  - If `-q` is provided, it is used directly (with a special `test` branch loading a canned query).
  - If absent, prompts the user to select from predefined queries on disk (via `listAvailableDataCloudQueries` / `loadDataCloudQueryFromFile`), or enter a custom query. Custom queries can be optionally saved locally (`saveDataCloudQueryToFile`).
- **Execution:** Calls `dataCloudSqlQuery` with the resolved SQL against the target org connection.
- **Output handling:** Logs the full result JSON to the terminal; emits a sanitized summary to `uxLog` (records removed for readability).
- **File generation:** Uses `generateReportPath` to build the output path and `generateCsvFile` to produce CSV/XLSX exports with a `DataCloud Sql Query Results` title.
- **CLI UX:** Employs `prompts` for interactive selection/input and `uxLog` for consistent colored logging with chalk.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:datacloud:sql-query --query "SELECT ssot__Name__c FROM ssot__Account__dlm LIMIT 10" --agent
```

In agent mode:
- The `--query` flag is **required** (no interactive prompt for query selection).
- The save-query prompt is skipped.


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|outputfile<br/>-f|option|Force the path and name of output report file. Must end with .csv||||
|query<br/>-q|option|Data Cloud query string||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-org<br/>-o|option|undefined||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:datacloud:sql-query
```

```shell
$ sf hardis:datacloud:sql-query -q "SELECT ssot__Name__c, ssot__CreatedDate__c FROM ssot__Account__dlm LIMIT 10"
```

```shell
$ sf hardis:datacloud:sql-query -q test
```

```shell
$ sf hardis:datacloud:sql-query --query "SELECT ssot__Name__c FROM ssot__Account__dlm LIMIT 10" --agent
```


