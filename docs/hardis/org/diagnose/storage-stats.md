<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:storage-stats

## Description

**Extracts and analyzes Data Storage usage for a Salesforce org, providing detailed per-object breakdowns with flexible grouping options.**

This command provides a comprehensive overview of your Salesforce data storage consumption. It's particularly useful for:

- **Storage Management:** Understanding which SObjects consume the most storage and how usage has evolved over time.
- **Cost Optimization:** Identifying storage-heavy objects that could be candidates for data archival or cleanup strategies.
- **Capacity Planning:** Tracking storage trends to predict when additional capacity will be needed.
- **Compliance & Governance:** Monitoring data growth patterns to ensure alignment with data retention policies.

Key functionalities:

- **Storage Limits Analysis:** Retrieves and displays org data storage limits, including total capacity, used storage, remaining storage, and percentage used. Detects and alerts on over-usage scenarios.
- **SObject Discovery & Filtering:** Automatically discovers all SObjects in the org and filters them to focus on production/custom objects (excludes metadata types, platform-only objects, and cached empty objects).
- **Interactive Selection:** Prompts the user to select which SObjects to analyze and choose breakdown fields (date fields, RecordType, custom fields, or relationship fields).
- **Flexible Breakdown Field:** Supports grouping by any field including:
  - Date/DateTime fields (`CreatedDate`, `LastModifiedDate`, custom date fields)
  - RecordType (`RecordType.Name`)
  - Custom fields (`Status__c`, picklists, text fields)
  - Nested relationship fields (`SBQQ__Quote__r.RecordType.Name`)
- **Date Granularity Options:** For date/datetime fields, choose between:
  - Year-based grouping (`CALENDAR_YEAR`)
  - Month-based grouping (`CALENDAR_MONTH`)
  - Day-based grouping (exact date)
- **WHERE Clause Filtering:** Apply SOQL WHERE conditions to filter records before calculating storage (e.g., only active records, records from the last year).
- **Storage Estimation:** Estimates storage usage for each object using an average record size heuristic (2 KB per record) and calculates the percentage of org quota consumed.
- **Dual CSV Reports:** Generates two CSV files: a detailed breakdown by selected field and a totals-per-object summary, both suitable for spreadsheet analysis and reporting.
- **Empty Objects Cache:** Maintains a per-user cache of objects detected with zero records to optimize subsequent runs by skipping empty tables.
- **Progress Tracking:** Sends WebSocket progress messages for integration with external UIs and monitoring dashboards.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Limits Retrieval:** Calls `conn.limits()` to retrieve the `DataStorageMB` object containing `Max` and `Remaining` values. Handles negative `Remaining` values (over-usage scenarios) by calculating `overUsageMB` and adjusting display values.
- **SObject Discovery:** Uses `conn.metadata.list([{ type: 'CustomObject' }])` to get custom objects and `conn.describeGlobal()` to get all SObjects. Filters by object capabilities (`layoutable`, `queryable`, `retrieveable`, `createable`, `updateable`, `deletable`) and excludes metadata types (`__mdt` suffix) and cached empty objects.
- **User Interaction:** Uses `prompts` for interactive multi-select of SObjects, breakdown field selection, granularity choice (for date fields), and optional WHERE conditions. All objects are pre-selected by default for user convenience.
- **Field Validation:** Recursively validates breakdown fields including nested relationships (e.g., `SBQQ__Quote__r.RecordType.Name`) by traversing the relationship chain and checking field existence on each related object. Automatically handles special cases like `RecordType` -> `RecordTypeId` and `__r` -> `__c` conversions.
- **Dynamic Query Generation:** Builds SOQL queries based on field type and granularity:
  - For date fields with year granularity: `SELECT CALENDAR_YEAR(<Field>) breakdown, COUNT(Id) total FROM <SObject> [WHERE ...] GROUP BY CALENDAR_YEAR(<Field>) ORDER BY CALENDAR_YEAR(<Field>)`
  - For date fields with month granularity: `SELECT CALENDAR_YEAR(<Field>) year, CALENDAR_MONTH(<Field>) month, COUNT(Id) total FROM <SObject> [WHERE ...] GROUP BY CALENDAR_YEAR(<Field>), CALENDAR_MONTH(<Field>) ORDER BY CALENDAR_YEAR(<Field>), CALENDAR_MONTH(<Field>)`
  - For non-date fields: `SELECT <Field> breakdown, COUNT(Id) total FROM <SObject> [WHERE ...] GROUP BY <Field> ORDER BY <Field>`
- **WHERE Clause Support:** Accepts user-provided WHERE conditions via flag (`--where`) or interactive prompt. Injects the condition into all SOQL queries for consistent filtering across all objects.
- **Storage Calculation:** Applies a conservative average record size of 2 KB (2048 bytes) to estimate storage consumption. Calculates both MB usage and percentage of org quota for each object and breakdown value.
- **Report Generation:** Uses `generateCsvFile` and `generateReportPath` helpers to create two CSV files in the reports directory:
  - Detailed breakdown: includes all statistics per breakdown value per object (e.g., by year, by month, by RecordType)
  - Totals summary: includes only aggregate totals per object
  - File naming includes breakdown field, granularity (for date fields), and `-filtered` suffix when WHERE clause is applied
- **Caching Mechanism:** Writes a JSON cache file per authenticated username (sanitized) in the reports directory (`<username>_empty_tables_cache.json`) containing an array of empty object names. The cache is updated after each run with newly detected empty objects.
- **Progress & UX:** Uses `WebSocketClient` to emit start/step/end progress messages for external monitoring. Outputs summary tables with `uxLogTable` and status messages with `uxLog`.
- **Return Value:** Returns a JSON object containing `tableStorageInfos` (all rows), `tableStorageInfosTotals` (summary rows), `storageLimits` (org limits object), and `outputFiles` (paths to generated CSV/XLSX reports).
</details>

![](https://sfdx-hardis.cloudity.com/assets/images/storage-usage-year-breakdown.png)

![](https://sfdx-hardis.cloudity.com/assets/images/storage-usage-total.png)


## Parameters

| Name                   |  Type   | Description                                                                                                                                 | Default | Required | Options |
|:-----------------------|:-------:|:--------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| breakdown-field<br/>-b | option  | Field to use for storage stats breakdown. Example: "CreatedDate", "LastModifiedDate", "RecordType.Name", or custom fields like "Status__c"  |         |          |         |
| debug<br/>-d           | boolean | Activate debug mode (more logs)                                                                                                             |         |          |         |
| flags-dir              | option  | undefined                                                                                                                                   |         |          |         |
| json                   | boolean | Format output as json.                                                                                                                      |         |          |         |
| outputfile<br/>-f      | option  | Force the path and name of output report file. Must end with .csv                                                                           |         |          |         |
| skipauth               | boolean | Skip authentication check when a default username is required                                                                               |         |          |         |
| target-org<br/>-o      | option  | undefined                                                                                                                                   |         |          |         |
| websocket              | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                   |         |          |         |
| where<br/>-w           | option  | WHERE clause to filter records in the query (without the WHERE keyword). Example: "CreatedDate = LAST_N_DAYS:365" or "Status__c = 'Active'" |         |          |         |

## Examples

```shell
$ sf hardis:org:diagnose:storage-stats
```

```shell
$ sf hardis:org:diagnose:storage-stats --breakdown-field "CreatedDate"
```

```shell
$ sf hardis:org:diagnose:storage-stats -b "RecordType.Name"
```

```shell
$ sf hardis:org:diagnose:storage-stats --where "CreatedDate = LAST_N_DAYS:365"
```

```shell
$ sf hardis:org:diagnose:storage-stats -w "Status__c = 'Active'"
```

```shell
$ sf hardis:org:diagnose:storage-stats -b "LastModifiedDate" -w "IsDeleted = false"
```


