/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Connection, Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import { uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { soqlQuery } from '../../../../common/utils/apiUtils.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import sortArray from 'sort-array';
import { prompts } from '../../../../common/utils/prompts.js';
import { CONSTANTS, getReportDirectory } from '../../../../config/index.js';
import path from 'path';
import { WebSocketClient } from '../../../../common/websocketClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class StorageStats extends SfCommand<any> {
  public static title = 'Extract Data Storage stats';

  public static description = `**Extracts and analyzes Data Storage usage for a Salesforce org, providing detailed per-object breakdowns with flexible grouping options.**

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
  - Date/DateTime fields (\`CreatedDate\`, \`LastModifiedDate\`, custom date fields)
  - RecordType (\`RecordType.Name\`)
  - Custom fields (\`Status__c\`, picklists, text fields)
  - Nested relationship fields (\`SBQQ__Quote__r.RecordType.Name\`)
- **Date Granularity Options:** For date/datetime fields, choose between:
  - Year-based grouping (\`CALENDAR_YEAR\`)
  - Month-based grouping (\`CALENDAR_MONTH\`)
  - Day-based grouping (exact date)
- **WHERE Clause Filtering:** Apply SOQL WHERE conditions to filter records before calculating storage (e.g., only active records, records from the last year).
- **Storage Estimation:** Estimates storage usage for each object using an average record size heuristic (2 KB per record) and calculates the percentage of org quota consumed.
- **Dual CSV Reports:** Generates two CSV files: a detailed breakdown by selected field and a totals-per-object summary, both suitable for spreadsheet analysis and reporting.
- **Empty Objects Cache:** Maintains a per-user cache of objects detected with zero records to optimize subsequent runs by skipping empty tables.
- **Progress Tracking:** Sends WebSocket progress messages for integration with external UIs and monitoring dashboards.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Limits Retrieval:** Calls \`conn.limits()\` to retrieve the \`DataStorageMB\` object containing \`Max\` and \`Remaining\` values. Handles negative \`Remaining\` values (over-usage scenarios) by calculating \`overUsageMB\` and adjusting display values.
- **SObject Discovery:** Uses \`conn.metadata.list([{ type: 'CustomObject' }])\` to get custom objects and \`conn.describeGlobal()\` to get all SObjects. Filters by object capabilities (\`layoutable\`, \`queryable\`, \`retrieveable\`, \`createable\`, \`updateable\`, \`deletable\`) and excludes metadata types (\`__mdt\` suffix) and cached empty objects.
- **User Interaction:** Uses \`prompts\` for interactive multi-select of SObjects, breakdown field selection, granularity choice (for date fields), and optional WHERE conditions. All objects are pre-selected by default for user convenience.
- **Field Validation:** Recursively validates breakdown fields including nested relationships (e.g., \`SBQQ__Quote__r.RecordType.Name\`) by traversing the relationship chain and checking field existence on each related object. Automatically handles special cases like \`RecordType\` -> \`RecordTypeId\` and \`__r\` -> \`__c\` conversions.
- **Dynamic Query Generation:** Builds SOQL queries based on field type and granularity:
  - For date fields with year granularity: \`SELECT CALENDAR_YEAR(<Field>) breakdown, COUNT(Id) total FROM <SObject> [WHERE ...] GROUP BY CALENDAR_YEAR(<Field>) ORDER BY CALENDAR_YEAR(<Field>)\`
  - For date fields with month granularity: \`SELECT CALENDAR_YEAR(<Field>) year, CALENDAR_MONTH(<Field>) month, COUNT(Id) total FROM <SObject> [WHERE ...] GROUP BY CALENDAR_YEAR(<Field>), CALENDAR_MONTH(<Field>) ORDER BY CALENDAR_YEAR(<Field>), CALENDAR_MONTH(<Field>)\`
  - For non-date fields: \`SELECT <Field> breakdown, COUNT(Id) total FROM <SObject> [WHERE ...] GROUP BY <Field> ORDER BY <Field>\`
- **WHERE Clause Support:** Accepts user-provided WHERE conditions via flag (\`--where\`) or interactive prompt. Injects the condition into all SOQL queries for consistent filtering across all objects.
- **Storage Calculation:** Applies a conservative average record size of 2 KB (2048 bytes) to estimate storage consumption. Calculates both MB usage and percentage of org quota for each object and breakdown value.
- **Report Generation:** Uses \`generateCsvFile\` and \`generateReportPath\` helpers to create two CSV files in the reports directory:
  - Detailed breakdown: includes all statistics per breakdown value per object (e.g., by year, by month, by RecordType)
  - Totals summary: includes only aggregate totals per object
  - File naming includes breakdown field, granularity (for date fields), and \`-filtered\` suffix when WHERE clause is applied
- **Caching Mechanism:** Writes a JSON cache file per authenticated username (sanitized) in the reports directory (\`<username>_empty_tables_cache.json\`) containing an array of empty object names. The cache is updated after each run with newly detected empty objects.
- **Progress & UX:** Uses \`WebSocketClient\` to emit start/step/end progress messages for external monitoring. Outputs summary tables with \`uxLogTable\` and status messages with \`uxLog\`.
- **Return Value:** Returns a JSON object containing \`tableStorageInfos\` (all rows), \`tableStorageInfosTotals\` (summary rows), \`storageLimits\` (org limits object), and \`outputFiles\` (paths to generated CSV/XLSX reports).
</details>

![](${CONSTANTS.DOC_URL_ROOT}/assets/images/storage-usage-year-breakdown.png)

![](${CONSTANTS.DOC_URL_ROOT}/assets/images/storage-usage-total.png)
`;

  public static examples = [
    '$ sf hardis:org:diagnose:storage-stats',
    '$ sf hardis:org:diagnose:storage-stats --breakdown-field "CreatedDate"',
    '$ sf hardis:org:diagnose:storage-stats -b "RecordType.Name"',
    '$ sf hardis:org:diagnose:storage-stats --where "CreatedDate = LAST_N_DAYS:365"',
    '$ sf hardis:org:diagnose:storage-stats -w "Status__c = \'Active\'"',
    '$ sf hardis:org:diagnose:storage-stats -b "LastModifiedDate" -w "IsDeleted = false"',
  ];

  public static flags: any = {
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path and name of output report file. Must end with .csv',
    }),
    'breakdown-field': Flags.string({
      char: 'b',
      description: 'Field to use for storage stats breakdown. Example: "CreatedDate", "LastModifiedDate", "RecordType.Name", or custom fields like "Status__c"',
    }),
    where: Flags.string({
      char: 'w',
      description: 'WHERE clause to filter records in the query (without the WHERE keyword). Example: "CreatedDate = LAST_N_DAYS:365" or "Status__c = \'Active\'"',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  public static requiresProject = true;

  protected debugMode = false;
  protected cacheFilePath: string = '';
  protected tableStorageInfos: any[] = [];
  protected outputFile;
  protected outputFilesRes: any = {};
  protected dateGranularity: 'year' | 'month' | 'day' = 'year';
  protected whereCondition: string = '';


  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(StorageStats);
    this.debugMode = flags.debug || false;
    this.outputFile = flags.outputfile || null;
    this.whereCondition = flags.where || '';
    const conn: Connection = flags['target-org'].getConnection();

    // Querying storage limit
    uxLog("action", this, `Retrieving storage limits from the org...`);
    const storageLimits = await conn.limits();
    const dataStorageLimit = storageLimits.DataStorageMB;
    const max = Number(dataStorageLimit.Max) || 0;
    const remainingRaw = Number(dataStorageLimit.Remaining) || 0;

    // Normalize values and detect over-usage
    const overUsageMB = remainingRaw < 0 ? Math.abs(remainingRaw) : 0;
    const remainingMB = remainingRaw < 0 ? 0 : remainingRaw;
    const usedMB = max - remainingRaw; // if Remaining is negative this will be > max
    const percentUsed = max > 0 ? (usedMB / max) * 100 : 0;

    uxLog("log", this, `Data Storage Limit: ${c.cyan(max)} MB`);
    uxLog(
      "log",
      this,
      `Data Storage Used: ${c.cyan(usedMB)} MB${overUsageMB > 0 ? c.red(` (Over by ${overUsageMB} MB)`) : ''}`
    );
    uxLog(
      "log",
      this,
      `Data Storage Remaining: ${c.cyan(remainingMB)} MB${overUsageMB > 0 ? c.red(` (Exceeded by ${overUsageMB} MB)`) : ''}`
    );
    uxLog("log", this, `Data Storage Usage Percent: ${c.cyan(percentUsed.toFixed(2))} %`);

    if (overUsageMB > 0) {
      uxLog(
        "action",
        this,
        `Your org has exceeded the data storage limit by ${c.cyan(overUsageMB)} MB (${c.red(
          `${(percentUsed - 100).toFixed(2)}%`
        )} over the ${c.cyan(max)} MB limit).`
      );
    } else {
      uxLog(
        "action",
        this,
        `You have used ${c.cyan(percentUsed.toFixed(2))}% of your ${c.cyan(max)} MB data storage limit.`
      );
    }

    // List SObjects in org and filter them to exclude Salesforce platform technical ones , to keep only "Production" objects like Account, Contact, Custom Objects, etc.
    uxLog("action", this, `Listing SObjects from the org...`);
    const customObjects = await conn.metadata.list([{ type: 'CustomObject' }]);
    const sObjects = await conn.describeGlobal();
    uxLog("log", this, `${sObjects.sobjects.length} SObjects retrieved.`);
    const emptyObjects = await this.getEmptyObjectsCache(conn);
    const sObjectsFiltered = sObjects.sobjects.filter((obj: any) => {
      return customObjects.find((customObj: any) => customObj.fullName === obj.name) &&
        !emptyObjects.includes(obj.name) &&
        !obj.name.endsWith('__mdt') &&
        obj.layoutable === true &&
        obj.queryable === true &&
        obj.retrieveable === true &&
        obj.deletable === true &&
        obj.updateable === true &&
        obj.createable === true;
    });
    sortArray(sObjectsFiltered, { by: "name" });
    uxLog("log", this, `${sObjectsFiltered.length} SObjects after filtering`);
    if (emptyObjects.length > 0) {
      uxLog("log", this, `${emptyObjects.length} SObjects excluded based on empty objects cache. To remove it, delete file ${c.cyan(this.cacheFilePath)} in the reports directory.`);
    }

    // Prompt user to select objects to analyze
    const promptObjectsRes = await prompts({
      type: 'multiselect',
      message: 'Select the SObjects to analyze for storage usage:',
      description: "Exclude objects you don't want to analyze.",
      choices: sObjectsFiltered.map((obj: any) => ({ title: obj.name, value: obj.name })),
      initial: sObjectsFiltered.map((obj: any) => obj), // all selected by default
    });
    const selectedObjects = promptObjectsRes.value.map((objName: string) => {
      return sObjectsFiltered.find((obj: any) => obj.name === objName);
    });
    uxLog("log", this, `${selectedObjects.length} SObjects selected for analysis.`);

    // Get breakdown field from flag or prompt user
    let breakdownField = flags['breakdown-field'];

    if (!breakdownField) {
      // Prompt user for stats on CreatedDate or LastModifiedDate
      const promptDateFieldRes = await prompts({
        type: 'select',
        message: 'Select the date field to use for storage stats breakdown',
        description: "Choose between CreatedDate or LastModifiedDate.",
        choices: [
          { title: 'Created Date', value: 'CreatedDate' },
          { title: 'Last Modified Date', value: 'LastModifiedDate' },
          { title: 'Record Type (if applicable)', value: 'RecordType.Name' },
          { title: "Custom (will exclude objects who doesn't have the field)", value: 'custom' }
        ],
      });
      breakdownField = promptDateFieldRes.value;
      if (breakdownField === 'custom') {
        const promptFieldRes = await prompts({
          type: 'text',
          message: 'Enter the API name of the custom date field to use for storage stats breakdown',
          description: "Objects without this field will be excluded from the analysis.",
          placeholder: 'My_Date_Field__c, RecordType.Name, SBQQ_Quote__r.Status__c or SBQQ__Quote__r.RecordType.Name',
        });
        breakdownField = promptFieldRes.value;
      }
    }

    uxLog("log", this, `Using ${c.cyan(breakdownField)} for storage stats breakdown.`);

    // Check if the selected field is a date field to prompt for granularity
    // We need to check at least one object to determine the field type
    let isDateFieldForGranularity = false;
    if (breakdownField === 'CreatedDate' || breakdownField === 'LastModifiedDate') {
      isDateFieldForGranularity = true;
    } else if (selectedObjects.length > 0) {
      // Check the first selected object to determine field type
      const firstObjCheck = await this.checkFieldExistenceAndType(selectedObjects[0], breakdownField, conn);
      isDateFieldForGranularity = firstObjCheck.isDateField;
    }

    // Prompt for date granularity if the field is a date/datetime
    if (isDateFieldForGranularity) {
      const promptGranularityRes = await prompts({
        type: 'select',
        message: 'Select the breakdown granularity for the date field',
        description: "Choose how you want to group the storage statistics.",
        choices: [
          { title: 'By Year (CALENDAR_YEAR)', value: 'year' },
          { title: 'By Month (CALENDAR_MONTH)', value: 'month' },
          { title: 'By Day (exact date)', value: 'day' }
        ],
      });
      this.dateGranularity = promptGranularityRes.value;
      uxLog("log", this, `Using ${c.cyan(this.dateGranularity)} granularity for date breakdown.`);
    }

    // Prompt for WHERE condition if not provided via flag
    if (!this.whereCondition) {
      const promptWhereCondRes = await prompts({
        type: 'text',
        message: 'Enter an optional WHERE condition to filter records (SOQL syntax)',
        description: 'You can provide an optional WHERE clause to filter records for the storage stats calculation. Leave empty for no filter.',
        placeholder: "Ex: CreatedDate = LAST_N_DAYS:365 or Status__c = 'Active'"
      });
      this.whereCondition = promptWhereCondRes.value || '';
    }

    if (this.whereCondition) {
      uxLog("log", this, `Applying WHERE condition: ${c.cyan(this.whereCondition)}`);
    }

    // Query objects to know the count of records, storage used and their year of created date
    WebSocketClient.sendProgressStartMessage(`Calculating storage stats for ${selectedObjects.length} objects...`, selectedObjects.length);
    const objectStorageStats: any[] = [];
    let step = 0;
    for (const obj of selectedObjects) {
      const res = await this.calculateObjectStorageStats(obj, breakdownField, conn);
      objectStorageStats.push(res);
      step++;
      WebSocketClient.sendProgressStepMessage(step);
    }
    WebSocketClient.sendProgressEndMessage();


    uxLog("action", this, `Compiling storage stats...`);
    // Sort by total records descending
    sortArray(objectStorageStats, { by: 'totalRecords', order: 'desc' });
    // Create one line by breakdown per object
    this.tableStorageInfos = objectStorageStats.flatMap(objStats => {
      // Skip objects that don't have the field
      if (objStats.skipped) {
        return [];
      }
      const allLines: any[] = [];
      // calculate object storage usage based on record count and average record size
      const averageSalesforceRecordSizeBytes = 2 * 1024; // 2 KB average size per record
      const tableStorageInfo: any = {
        ApiName: objStats.name,
        Label: objStats.label,
      };
      const globalLine = {
        ...tableStorageInfo,
        Breakdown: 'Total',
        RecordCount: objStats.totalRecords,
        EstimatedStoragePercentage: ((objStats.totalRecords * averageSalesforceRecordSizeBytes) / (dataStorageLimit.Max * 1024 * 1024) * 100).toFixed(2) + "%",
        EstimatedStorageMB: ((objStats.totalRecords * averageSalesforceRecordSizeBytes) / (1024 * 1024)).toFixed(2),
      };
      allLines.push(globalLine);
      for (const breakdownStat of objStats.breakdownStats) {
        const breakdownValue = breakdownStat.breakdown;
        const recordCount = breakdownStat.total;
        const storageUsedBreakdownBytes = (recordCount * averageSalesforceRecordSizeBytes) / (1024 * 1024);
        const line = {
          ...tableStorageInfo,
          Breakdown: breakdownValue,
          RecordCount: recordCount,
          EstimatedStoragePercentage: (storageUsedBreakdownBytes / (dataStorageLimit.Max) * 100).toFixed(2) + "%",
          EstimatedStorageMB: storageUsedBreakdownBytes.toFixed(2),
        };
        allLines.push(line);
      }
      return allLines;
    });

    // Update empty objects cache (exclude objects that were skipped or had errors)
    const newlyEmptyObjects = objectStorageStats
      .filter(obj => obj.totalRecords === 0 && !obj.skipped && !obj.error)
      .map(obj => obj.name);
    const updatedEmptyObjects = Array.from(new Set([...emptyObjects, ...newlyEmptyObjects]));
    await this.setEmptyObjectsCache(updatedEmptyObjects);
    uxLog("log", this, `Empty objects cache updated with ${newlyEmptyObjects.length} newly detected empty objects.`);

    // Remove objects with zero records from the report
    this.tableStorageInfos = this.tableStorageInfos.filter(info => info.RecordCount > 0);

    // Generate output CSV file with breakdown
    const granularitySuffix = isDateFieldForGranularity ? `-${this.dateGranularity}` : '';
    const whereSuffix = this.whereCondition ? '-filtered' : '';
    const fileBaseName = `storage-stats-by-${breakdownField.replace(/\./g, '_')}${granularitySuffix}${whereSuffix}`;
    this.outputFile = await generateReportPath(fileBaseName, this.outputFile);
    const whereInfo = this.whereCondition ? ` (WHERE ${this.whereCondition})` : '';
    const fileTitleBreakdown = isDateFieldForGranularity
      ? `Storage stats breakdown by ${breakdownField} (${this.dateGranularity})${whereInfo}`
      : `Storage stats breakdown by ${breakdownField}${whereInfo}`;
    this.outputFilesRes = await generateCsvFile(this.tableStorageInfos, this.outputFile, { fileTitle: fileTitleBreakdown });

    // Generate output CSV file with only total per object
    const outputFileTotals = this.outputFile.replace('.csv', '-totals.csv');
    const tableStorageInfosTotals = this.tableStorageInfos.filter(info => info.Breakdown === 'Total');
    const outputFilesResTotals = await generateCsvFile(tableStorageInfosTotals, outputFileTotals, { fileTitle: "Storage stats totals per object" });
    this.outputFilesRes.totalPerObject = outputFilesResTotals;

    // Display results
    uxLog("action", this, `Storage stats usage`);
    uxLogTable(this, tableStorageInfosTotals);

    return {
      tableStorageInfos: this.tableStorageInfos,
      tableStorageInfosTotals: tableStorageInfosTotals,
      storageLimits: storageLimits,
      outputFiles: this.outputFilesRes,
    }
  }

  private async getEmptyObjectsCache(conn) {
    const reportDir = await getReportDirectory();
    this.cacheFilePath = path.join(reportDir, conn.getUsername()!.replace(/[^a-zA-Z0-9]/g, '_') + '_empty_tables_cache.json');
    let emptyObjects: string[] = [];
    if (fs.existsSync(this.cacheFilePath)) {
      const cacheContent = await fs.readJSON(this.cacheFilePath, 'utf-8');
      emptyObjects = cacheContent.emptyObjects || [];
    }
    return emptyObjects;
  }

  private async setEmptyObjectsCache(emptyObjects: string[]) {
    const cacheContent = {
      emptyObjects,
    };
    await fs.writeJSON(this.cacheFilePath, cacheContent, { spaces: 2 });
  }

  private async checkFieldExistenceAndType(obj: any, breakdownField: string, conn): Promise<{ isValid: boolean; isDateField: boolean; errorResult?: any }> {
    // Standard date fields are always valid and are date fields
    if (breakdownField === 'CreatedDate' || breakdownField === 'LastModifiedDate') {
      return { isValid: true, isDateField: true };
    }

    const fieldPath = breakdownField.split('.');

    try {
      const describe = await conn.sobject(obj.name).describe();
      const fieldName = fieldPath[0];

      // Determine the field to check in describe
      let fieldToCheck = fieldName;

      // Special case: RecordType.Name -> check RecordTypeId
      if (fieldName === 'RecordType') {
        fieldToCheck = 'RecordTypeId';
      }
      // Special case: Custom relationships ending with __r -> convert to __c (e.g., SBQQ_Quote__r -> SBQQ_Quote__c)
      else if (fieldName.endsWith('__r')) {
        fieldToCheck = fieldName.replace(/__r$/, '__c');
      }

      const field = describe.fields.find((f: any) => f.name === fieldToCheck);
      if (!field) {
        uxLog("warning", this, c.yellow(`Skipping object ${c.cyan(obj.name)}: field ${c.cyan(breakdownField)} not found`));
        return {
          isValid: false,
          isDateField: false,
          errorResult: {
            name: obj.name,
            label: obj.label,
            totalRecords: 0,
            breakdownStats: [],
            skipped: true,
            skipReason: `Field ${breakdownField} not found on object`
          }
        };
      }

      // Navigate through relationship fields recursively
      if (fieldPath.length > 1 && field.referenceTo && field.referenceTo.length > 0) {
        return await this.checkRelatedFieldPath(obj, field, fieldPath.slice(1), conn, [field.referenceTo[0]]);
      } else {
        // Direct field on the object, check its type
        const isDateField = field.type === 'date' || field.type === 'datetime';
        return { isValid: true, isDateField };
      }
    } catch (error: any) {
      uxLog("error", this, `Error describing object ${c.cyan(obj.name)}: ${error.message}`);
      return {
        isValid: false,
        isDateField: false,
        errorResult: {
          name: obj.name,
          label: obj.label + ' (Describe Error): ' + error.message,
          totalRecords: 0,
          breakdownStats: [],
          error: true,
        }
      };
    }
  }

  private async checkRelatedFieldPath(
    originalObj: any,
    currentField: any,
    remainingPath: string[],
    conn: any,
    relationshipChain: string[]
  ): Promise<{ isValid: boolean; isDateField: boolean; errorResult?: any }> {
    const relatedObjectName = currentField.referenceTo[0]; // Take first reference (polymorphic not fully supported)
    const nextFieldName = remainingPath[0];

    try {
      const relatedDescribe = await conn.sobject(relatedObjectName).describe();

      // Determine the field to check in describe
      let fieldToCheck = nextFieldName;

      // Special case: RecordType.Name -> check RecordTypeId
      if (nextFieldName === 'RecordType') {
        fieldToCheck = 'RecordTypeId';
      }
      // Special case: Custom relationships ending with __r -> convert to __c
      else if (nextFieldName.endsWith('__r')) {
        fieldToCheck = nextFieldName.replace(/__r$/, '__c');
      }

      const relatedField = relatedDescribe.fields.find((f: any) => f.name === fieldToCheck);

      if (!relatedField) {
        const relationshipPath = relationshipChain.join(' -> ');
        uxLog("warning", this, c.yellow(`Skipping object ${c.cyan(originalObj.name)}: field ${c.cyan(nextFieldName)} not found on ${c.cyan(relatedObjectName)} (path: ${relationshipPath})`));
        return {
          isValid: false,
          isDateField: false,
          errorResult: {
            name: originalObj.name,
            label: originalObj.label,
            totalRecords: 0,
            breakdownStats: [],
            skipped: true,
            skipReason: `Field ${nextFieldName} not found on related object ${relatedObjectName} (relationship path: ${relationshipPath})`
          }
        };
      }

      // If there are more levels to traverse
      if (remainingPath.length > 1 && relatedField.referenceTo && relatedField.referenceTo.length > 0) {
        return await this.checkRelatedFieldPath(
          originalObj,
          relatedField,
          remainingPath.slice(1),
          conn,
          [...relationshipChain, relatedField.referenceTo[0]]
        );
      } else {
        // This is the final field, check its type
        const isDateField = relatedField.type === 'date' || relatedField.type === 'datetime';
        return { isValid: true, isDateField };
      }
    } catch (error: any) {
      const relationshipPath = relationshipChain.join(' -> ');
      uxLog("error", this, `Error describing related object ${c.cyan(relatedObjectName)}: ${error.message} (path: ${relationshipPath})`);
      return {
        isValid: false,
        isDateField: false,
        errorResult: {
          name: originalObj.name,
          label: originalObj.label + ` (Describe Error on ${relatedObjectName}): ` + error.message,
          totalRecords: 0,
          breakdownStats: [],
          error: true,
        }
      };
    }
  }

  private async calculateObjectStorageStats(obj: any, breakdownField: string, conn) {
    uxLog("log", this, `Querying storage stats for object: ${c.cyan(obj.name)}...`);

    // Check if field exists on object and determine its type
    const fieldCheck = await this.checkFieldExistenceAndType(obj, breakdownField, conn);
    if (!fieldCheck.isValid) {
      return fieldCheck.errorResult;
    }

    // Build query based on field type
    let query: string;
    let groupByClause: string;
    let orderByClause: string;

    // Use appropriate date function for date/datetime fields based on granularity
    if (fieldCheck.isDateField) {
      switch (this.dateGranularity) {
        case 'year':
          groupByClause = `CALENDAR_YEAR(${breakdownField})`;
          orderByClause = `CALENDAR_YEAR(${breakdownField})`;
          break;
        case 'month':
          groupByClause = `CALENDAR_YEAR(${breakdownField}), CALENDAR_MONTH(${breakdownField})`;
          orderByClause = `CALENDAR_YEAR(${breakdownField}), CALENDAR_MONTH(${breakdownField})`;
          break;
        case 'day':
          groupByClause = breakdownField;
          orderByClause = `${breakdownField}`;
          break;
        default:
          groupByClause = `CALENDAR_YEAR(${breakdownField})`;
          orderByClause = `CALENDAR_YEAR(${breakdownField})`;
      }

      // Build appropriate SELECT clause based on granularity
      let selectClause: string;
      if (this.dateGranularity === 'month') {
        selectClause = `CALENDAR_YEAR(${breakdownField}) year, CALENDAR_MONTH(${breakdownField}) month, COUNT(Id) total`;
      } else if (this.dateGranularity === 'day') {
        selectClause = `${breakdownField} breakdown, COUNT(Id) total`;
      } else {
        selectClause = `CALENDAR_YEAR(${breakdownField}) breakdown, COUNT(Id) total`;
      }

      // Build WHERE clause if provided
      const whereClause = this.whereCondition ? `WHERE ${this.whereCondition}` : '';

      query = `SELECT ${selectClause}
FROM ${obj.name}${whereClause ? ` ${whereClause}` : ''} 
GROUP BY ${groupByClause}
ORDER BY ${orderByClause}`;
    } else {
      // For non-date fields (RecordType.Name, picklists, text fields), use direct grouping
      groupByClause = breakdownField;

      // Build WHERE clause if provided
      const whereClause = this.whereCondition ? `WHERE ${this.whereCondition}` : '';

      query = `SELECT ${breakdownField} breakdown, COUNT(Id) total
FROM ${obj.name}${whereClause ? ` ${whereClause}` : ''} 
GROUP BY ${breakdownField}
ORDER BY ${breakdownField}`;
    }

    try {
      const queryRes = await soqlQuery(query, conn);
      const breakdownStats = queryRes.records.map((record: any) => {
        // Handle month granularity (year and month fields)
        if (record.year !== undefined && record.month !== undefined) {
          // Format as YYYY-MM for better readability
          const monthStr = String(record.month).padStart(2, '0');
          return {
            breakdown: `${record.year}-${monthStr}`,
            total: record.total,
          };
        }
        // Handle other cases (year, day, or non-date fields)
        return {
          breakdown: record.breakdown || 'N/A',
          total: record.total,
        };
      });
      const totalRecords = breakdownStats.reduce((acc: number, curr: any) => acc + curr.total, 0);
      return {
        name: obj.name,
        label: obj.label,
        totalRecords,
        breakdownStats,
      };
    } catch (error: any) {
      uxLog("error", this, `Error querying object ${c.cyan(obj.name)}: ${error.message}`);
      return {
        name: obj.name,
        label: obj.label + ' (Query Error): ' + error.message,
        totalRecords: 0,
        breakdownStats: [],
        error: true,
      };
    }
  }
}