<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:fieldusage

## Description


## Command Behavior

**Retrieves and displays the usage of custom fields within a Salesforce org, based on metadata dependencies.**

This command helps identify where custom fields are referenced across various metadata components in your Salesforce environment. It's particularly useful for impact analysis before making changes to fields, or for understanding the complexity and interconnectedness of your Salesforce customizations.

- **Targeted sObjects:** You can specify a comma-separated list of sObjects (e.g., `Account,Contact`) to narrow down the analysis to relevant objects. If no sObjects are specified, it will analyze all customizable sObjects.
- **Usage Details:** For each custom field, the command lists the metadata components (e.g., Apex Classes, Visualforce Pages, Flows, Reports) that reference it, along with their types and names.

!['Find custom fields usage'](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/doc-fieldusage.png)

<details markdown="1">
<summary>Technical explanations</summary>

The command operates by querying Salesforce's Tooling API and Metadata Component Dependency API:

- **sObject Retrieval:** It first queries `EntityDefinition` to get a list of customizable sObjects, optionally filtered by the user's input.
- **Custom Field Identification:** For each identified sObject, it queries `CustomField` to retrieve all custom fields associated with it.
- **Dependency Lookup:** The core of the command involves querying `MetadataComponentDependency` using the IDs of the custom fields. This API provides information about which other metadata components depend on the specified fields.
- **Data Aggregation & Reporting:** The retrieved data is then processed and formatted into a tabular output, showing the sObject name, field name, field type, dependency type, and dependency name. The results are also generated into various report formats (e.g., CSV, JSON) for further analysis.
- **SOQL Queries:** It uses `soqlQuery` and `soqlQueryTooling` utilities to execute SOQL queries against the Salesforce org.
</details>


## Parameters

| Name              |  Type   | Description                                | Default | Required | Options |
|:------------------|:-------:|:-------------------------------------------|:-------:|:--------:|:-------:|
| flags-dir         | option  | undefined                                  |         |          |         |
| json              | boolean | Format output as json.                     |         |          |         |
| sObjects<br/>-s   | option  | Comma-separated list of sObjects to filter |         |          |         |
| target-org<br/>-o | option  | undefined                                  |         |          |         |

## Examples

```shell
$ sf hardis:doc:fieldusage
```

```shell
$ sf hardis:doc:fieldusage --sObjects Account,Contact,Opportunity
```

```shell
$ sf hardis:doc:fieldusage --target-org myOrgAlias --sObjects CustomObject__c
```


