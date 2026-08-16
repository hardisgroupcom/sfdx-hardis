<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:object-field-usage

## Description


## Command Behavior

**Analyzes how populated fields are for a specific Salesforce object.**

This command focuses on one or more sObjects and measures how many records populate each non-required field. It is useful for understanding data completeness before refactoring, cleaning up unused fields, or preparing migration plans.

- **Target Org:** Use `--target-org` to pick the org connection context.
- **Multiple sObjects:** Provide one or more API names via `--objects` (comma-separated) to analyze several objects in one run.
- **Restrict to specific fields:** Use the `Object:Field1,Field2` syntax in `--objects` (groups separated by spaces) to analyze only the listed fields instead of every custom field. Example: `--objects "Contact:Name,Email Account:Name,MyField__c"`. Explicitly named fields are analyzed even when they are standard, as long as they exist and are filterable.
- **Sum of values:** Append `(WITH_SUM)` to a field name to add a `sum` column with the total of its populated values. Example: `--objects "Opportunity:Amount(WITH_SUM),Name,ExpectedRevenue(WITH_SUM)"`. Only numeric fields (currency, double, int, percent) are summed; the column is added to the report only when at least one field requests it.
- **Per-field Counts:** Performs one overall record count and one per-field count with `SELECT COUNT() FROM <sObject> WHERE <field> != null`, skipping required or non-filterable fields.
- **Non-filterable Fields:** Long Text Area and Rich Text fields cannot be counted with `WHERE != null`, so they are skipped by default. Add `--include-non-filterable` to compute their population rate anyway: the command pages through the records and counts how many have a non-empty value (slower on objects with many records, since the values cannot be tested server-side).
- **Field Distributions:** Combine `--objects <singleObject>` with `--fields FieldA,FieldB` to group by those fields and list distinct values with their record counts and usage percentages.
- **Reporting:** Generates CSV/XLSX reports and prints a summary table with per-field population rates.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:doc:object-field-usage --objects Account,Contact --agent
```

In agent mode:
- The `--objects` flag is **required** (no interactive prompt for object selection).
- The `Object:Field1,Field2` syntax can be used to restrict the analysis to specific fields, with an optional `(WITH_SUM)` modifier per numeric field.
- The API usage confirmation prompt is skipped (proceeds automatically).


## Parameters

| Name                   |  Type   | Description                                                                                                                                                                                                                                                                                                                                                                                                                                 | Default | Required | Options |
|:-----------------------|:-------:|:--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent                  | boolean | Run in non-interactive mode for agents and automation                                                                                                                                                                                                                                                                                                                                                                                       |         |          |         |
| fields<br/>-f          | option  | Comma-separated API names of fields to analyze (requires exactly one --objects value)                                                                                                                                                                                                                                                                                                                                                       |         |          |         |
| flags-dir              | option  | undefined                                                                                                                                                                                                                                                                                                                                                                                                                                   |         |          |         |
| include-non-filterable | boolean | Also compute the population rate of non-filterable fields (e.g. Long Text Area, Rich Text). Their values cannot be counted server-side, so the command pages through the records and counts non-empty values, which can be slow on objects with many records.                                                                                                                                                                               |         |          |         |
| json                   | boolean | Format output as json.                                                                                                                                                                                                                                                                                                                                                                                                                      |         |          |         |
| objects<br/>-o         | option  | Comma-separated API names of the sObjects to analyze (e.g. Account,CustomObject__c). To restrict the analysis to specific fields, use the Object:Field1,Field2 syntax with groups separated by spaces (e.g. "Contact:Name,Email Account:MyField__c"). Append (WITH_SUM) to a numeric field to add a column with the sum of its values (e.g. "Opportunity:Amount(WITH_SUM)"). If omitted, an interactive prompt will list available objects. |         |          |         |
| skipauth               | boolean | Skip authentication check when a default username is required                                                                                                                                                                                                                                                                                                                                                                               |         |          |         |
| target-org<br/>-o      | option  | undefined                                                                                                                                                                                                                                                                                                                                                                                                                                   |         |          |         |
| websocket              | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                                                                                                                                                                                                                                                                                                   |         |          |         |

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
$ sf hardis:doc:object-field-usage --objects "Contact:Name,Email Account:Name,MyField__c,MyOtherField__c"
```

```shell
$ sf hardis:doc:object-field-usage --objects "Opportunity:Amount(WITH_SUM),Name,ExpectedRevenue(WITH_SUM)"
```

```shell
$ sf hardis:doc:object-field-usage --objects "Opportunity:Description,Name" --include-non-filterable
```

```shell
$ sf hardis:doc:object-field-usage --objects Account --fields SalesRegionAcct__c,Region__c
```

```shell
$ sf hardis:doc:object-field-usage --objects Account,Contact --agent
```


