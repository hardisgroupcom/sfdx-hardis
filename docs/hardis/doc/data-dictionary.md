<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:data-dictionary

## Description


## Command Behavior

**Generates an Excel (.xlsx) data dictionary for one or more Salesforce objects, read live from the target org.**

This command describes the selected objects and exports their definitions into a single multi-sheet workbook, useful for documentation, audits, and onboarding.

- **Target Org:** Use `--target-org` to pick the org connection context.
- **Object selection:** Provide one or more API names via `--objects` (comma-separated, e.g. `Account,Contact,MyObject__c`). If omitted in interactive mode, a prompt lists available objects.
- **Customized objects only:** Use `--customizedonly` to exclude objects that have no local customizations. This drops standard objects without custom fields and managed package objects without local custom fields, while keeping local custom objects and any object that has at least one local custom field. In interactive mode, a prompt offers the same filter.
- **Workbook structure:** One `Index` sheet listing the objects, one fields sheet per object, plus consolidated `Validation Rules` and `Record Types` sheets.
- **Navigation:** The `Index` sheet links to each object, Validation Rules and Record Types sheet, and every other sheet has a "Back to Index" link below its data.
- **Fields detail:** API name, label, type, required, unique, external id, length/precision, reference target, picklist values, default value, formula, help text, description, and custom flag. Fields are sorted alphabetically by API name.
- **Output:** The XLSX is generated alongside the intermediate CSV files in the report directory. Use `--outputfile` to force the consolidated report path.

<details markdown="1">
<summary>Technical explanations</summary>

- **Fields:** Retrieved with `connection.describe(objectName)`, then sorted alphabetically by API name. Field types are mapped to their Salesforce names (e.g. `reference` becomes `Lookup` or `MasterDetail`, `int`/`double` become `Number`), and formula / roll-up summary fields are tagged. Required is derived from `nillable === false`; picklist values are the active values, capped at 50 with an overflow note.
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
- Pass `--customizedonly` to restrict the workbook to objects that have local customizations (the prompt is skipped).


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|customizedonly|boolean|Exclude objects that have no local customizations (standard objects without custom fields and managed package objects without local custom fields). Local custom objects and objects with at least one local custom field are kept.||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|objects<br/>-o|option|Comma-separated API names of the objects to document (e.g. Account,Contact,CustomObject__c). If omitted, an interactive prompt lists available objects.||||
|outputfile<br/>-f|option|Force the path and name of the consolidated output report file (the XLSX is generated alongside)||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-org<br/>-o|option|undefined||||
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
$ sf hardis:doc:data-dictionary --customizedonly
```

```shell
$ sf hardis:doc:data-dictionary --agent --objects Account,Contact --customizedonly
```


