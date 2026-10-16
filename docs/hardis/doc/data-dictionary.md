<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:data-dictionary

## Description


## Command Behavior

**Generates an Excel (.xlsx) data dictionary for one or more Salesforce objects, read live from the target org, including Data Cloud (Data 360) Data Model Objects and Data Lake Objects.**

This command describes the selected objects and exports their definitions into a single multi-sheet workbook, useful for documentation, audits, and onboarding.

The `Index` sheet lists every documented object with its field, validation rule and record type counts, and links to each object sheet.

![Data dictionary index sheet](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-data-dictionary-index.png)

Each object sheet details its fields (type, required, unique, reference target, picklist values, and more).

![Data dictionary object fields sheet](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-data-dictionary-fields.png)

- **Target Org:** Use `--target-org` to pick the org connection context.
- **Object selection:** Provide one or more API names via `--objects` (comma-separated, e.g. `Account,Contact,MyObject__c`). If omitted in interactive mode, a prompt lists available objects.
- **Data Cloud objects:** Data Model Objects (`__dlm`) and Data Lake Objects (`__dll`) can be listed in `--objects` like any other object. Use `--datacloud` to document every Data Model Object and Data Lake Object the org lists. In interactive mode, the prompt also lists them when Data Cloud is enabled.
- **Customized objects only:** Use `--customizedonly` to exclude objects that have no local customizations. This drops standard objects without custom fields and managed package objects without local custom fields, while keeping local custom objects and any object that has at least one local custom field. In interactive mode, a prompt offers the same filter.
- **Workbook structure:** One `Index` sheet listing the objects, one fields sheet per object, plus consolidated `Validation Rules` and `Record Types` sheets. When Data Cloud objects are documented, the `Index` sheet also shows their object type, category and relationship count, and a `Data Cloud Relationships` sheet lists the relationships of the Data Model Objects (from and to object and field, cardinality, status, origin), including relationships to CRM objects.
- **Navigation:** The `Index` sheet links to each object, Validation Rules and Record Types sheet, and every other sheet has a "Back to Index" link below its data.
- **Fields detail:** API name, label, type, required, unique, external id, length/precision, reference target, picklist values, default value, formula, help text, description, and custom flag. Fields are sorted alphabetically by API name.
- **Data Cloud fields detail:** API name, label, type, data type, primary key, key qualifier, and custom flag.
- **Output:** The XLSX is generated alongside the intermediate CSV files in the report directory. Use `--outputfile` to force the consolidated report path.

<details markdown="1">
<summary>Technical explanations</summary>

- **Fields:** Retrieved with `connection.describe(objectName)`, then sorted alphabetically by API name. Field types are mapped to their Salesforce names (e.g. `reference` becomes `Lookup` or `MasterDetail`, `int`/`double` become `Number`), and formula / roll-up summary fields are tagged. Required is derived from `nillable === false`; picklist values are the active values, capped at 50 with an overflow note.
- **Validation Rules:** Retrieved via the Metadata API (`metadata.list` then `metadata.read` in batches of 10) to include the error condition formula, which is not exposed by describe.
- **Record Types:** Retrieved with a single SOQL query on `RecordType` filtered by `SobjectType`.
- **Data Cloud objects:** Data Model Objects and Data Lake Objects are not in `EntityDefinition`, and their describe shows relationships as generated reference fields and primary keys as optional. They are read from `ssot/metadata` instead, one call per object type, which returns the field types, primary keys and key qualifiers. This listing only contains the objects the org uses: a standard Data Model Object that nothing is mapped to is reported as not found.
- **Data Cloud relationships:** Retrieved for each documented Data Model Object with `ssot/data-model-objects/<name>/relationships`, which returns both directions with their status and includes relationships to CRM objects. That response also contains the standard relationships the org never activated (origin `Standard`, status `INACTIVE`): they are left out. A relationship listed by two documented objects appears once.
- **Reporting:** Each sheet is first written as a CSV, then consolidated into one XLSX via `createXlsxFromCsvFiles`, with explicit worksheet names.
- **Resilience:** Objects that cannot be described, Data Cloud objects the org does not list, and validation rule / record type / Data Cloud relationship retrieval failures are logged as warnings and skipped without aborting the run. On an org without Data Cloud, `--datacloud` only logs a warning.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:doc:data-dictionary --agent --objects Account,Contact
```

In agent mode:
- The `--objects` flag or the `--datacloud` flag is **required** (no interactive prompt for object selection).
- No other prompt is displayed; the workbook is generated directly.
- Pass `--customizedonly` to restrict the workbook to objects that have local customizations (the prompt is skipped).


## Parameters

| Name              |  Type   | Description                                                                                                                                                                                                                         | Default | Required | Options |
|:------------------|:-------:|:------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent             | boolean | Run in non-interactive mode for agents and automation                                                                                                                                                                               |         |          |         |
| customizedonly    | boolean | Exclude objects that have no local customizations (standard objects without custom fields and managed package objects without local custom fields). Local custom objects and objects with at least one local custom field are kept. |         |          |         |
| datacloud         | boolean | Also document every Data Cloud (Data 360) Data Model Object (__dlm) and Data Lake Object (__dll) listed by the org, with a Data Cloud Relationships sheet                                                                           |         |          |         |
| flags-dir         | option  | Import flag values from a directory.                                                                                                                                                                                                |         |          |         |
| json              | boolean | Format output as json.                                                                                                                                                                                                              |         |          |         |
| objects<br/>-o    | option  | Comma-separated API names of the objects to document (e.g. Account,Contact,CustomObject__c). If omitted, an interactive prompt lists available objects.                                                                             |         |          |         |
| outputfile<br/>-f | option  | Force the path and name of the consolidated output report file (the XLSX is generated alongside)                                                                                                                                    |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                                                                                                                                                                       |         |          |         |
| target-org<br/>-o | option  | Username or alias of the target org. Not required if the `target-org` configuration variable is already set.                                                                                                                        |         |   true   |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                                                                                           |         |          |         |

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

```shell
$ sf hardis:doc:data-dictionary --objects Account,ssot__Individual__dlm,Crm_Contact__dll
```

```shell
$ sf hardis:doc:data-dictionary --agent --datacloud
```


