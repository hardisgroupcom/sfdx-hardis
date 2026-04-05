<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:object-field-usage

## Description


## Command Behavior

**Analyzes how populated fields are for a specific Salesforce object.**

This command focuses on one or more sObjects and measures how many records populate each non-required field. It is useful for understanding data completeness before refactoring, cleaning up unused fields, or preparing migration plans.

- **Target Org:** Use `--target-org` to pick the org connection context.
- **Multiple sObjects:** Provide one or more API names via `--objects` (comma-separated) to analyze several objects in one run.
- **Per-field Counts:** Performs one overall record count and one per-field count with `SELECT COUNT() FROM <sObject> WHERE <field> != null`, skipping required or non-filterable fields.
- **Field Distributions:** Combine `--objects <singleObject>` with `--fields FieldA,FieldB` to group by those fields and list distinct values with their record counts and usage percentages.
- **Reporting:** Generates CSV/XLSX reports and prints a summary table with per-field population rates.


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|fields<br/>-f|option|Comma-separated API names of fields to analyze (requires exactly one --objects value)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|objects<br/>-o|option|Comma-separated API names of the sObjects to analyze (e.g. Account,CustomObject__c). If omitted, an interactive prompt will list available objects.||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-org<br/>-o|option|undefined||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:doc:object-field-usage
```

```shell
$ sf hardis:doc:object-field-usage --objects Account,Contact
```

```shell
$ sf hardis:doc:object-field-usage --target-org myOrgAlias --objects CustomObject__c
```

```shell
$ sf hardis:doc:object-field-usage --objects Account --fields SalesRegionAcct__c,Region__c
```


