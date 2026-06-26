<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:data-dictionary

## Description


## Command Behavior

**Generates an Excel (.xlsx) data dictionary for one or more Salesforce objects, read live from the target org.**

This command describes the selected objects and exports their definitions into a single multi-sheet workbook, useful for documentation, audits, and onboarding.

- **Target Org:** Use `--target-org` to pick the org connection context.
- **Object selection:** Provide one or more API names via `--objects` (comma-separated, e.g. `Account,Contact,MyObject__c`). If omitted in interactive mode, a prompt lists available objects.
- **Workbook structure:** One `Index` sheet listing the objects, one fields sheet per object, plus consolidated `Validation Rules` and `Record Types` sheets.
- **Fields detail:** API name, label, type, required, unique, external id, length/precision, reference target, picklist values, default value, formula, help text, description, and custom flag.
- **Output:** The XLSX is generated alongside the intermediate CSV files in the report directory. Use `--outputfile` to force the consolidated report path.

<details markdown="1">
<summary>Technical explanations</summary>

- **Fields:** Retrieved with `connection.describe(objectName)`. Required is derived from `nillable === false`; picklist values are the active values, capped at 50 with an overflow note.
- **Validation Rules:** Retrieved via the Metadata API (`metadata.list` then `metadata.read` in batches of 10) to include the error condition formula, which is not exposed by describe.
- **Record Types:** Retrieved with a single SOQL query on `RecordType` filtered by `SobjectType`.
- **Reporting:** Each sheet is first written as a CSV, then consolidated into one XLSX via `createXlsxFromCsvFiles`, with explicit worksheet names.
- **Resilience:** Objects that cannot be described, and validation rule / record type retrieval failures, are logged as warnings and skipped without aborting the run.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:doc:data-dictionary --agent --objects Account,Contact
```

In agent mode:
- The `--objects` flag is **required** (no interactive prompt for object selection).
- No other prompt is displayed; the workbook is generated directly.


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|objects<br/>-o|option|Comma-separated API names of the objects to document (e.g. Account,Contact,CustomObject__c). If omitted, an interactive prompt lists available objects.||||
|outputfile<br/>-f|option|Force the path and name of the consolidated output report file (the XLSX is generated alongside)||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-org<br/>-o|option|undefined|quentin.tiercelin.ext@vusion.com.devcbi|||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:doc:data-dictionary
```

```shell
$ sf hardis:doc:data-dictionary --objects Account,Contact
```

```shell
$ sf hardis:doc:data-dictionary --target-org myOrgAlias --objects CustomObject__c
```

```shell
$ sf hardis:doc:data-dictionary --agent --objects Account,Contact
```


