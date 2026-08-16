import path from 'path';
import { Flags, SfCommand, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { AnyJson } from '@salesforce/ts-types';
import { Connection, Messages } from '@salesforce/core';
import c from 'chalk';
import sortArray from 'sort-array';
import { generateReports, isCI, uxLog, uxLogTable } from '../../../common/utils/index.js';
import { soqlQuery, soqlQueryTooling } from '../../../common/utils/apiUtils.js';
import { prompts } from '../../../common/utils/prompts.js';
import { createXlsxFromCsvFiles, generateCsvFile, generateReportPath } from '../../../common/utils/filesUtils.js';
import { WebSocketClient } from '../../../common/websocketClient.js';
import { listOrgSObjects } from '../../../common/utils/orgUtils.js';
import { isManagedApiName } from '../../../common/utils/projectUtils.js';
import { t } from '../../../common/utils/i18n.js';

type FieldUsageRow = {
  sObjectName: string;
  fieldApiName: string;
  fieldLabel: string;
  fieldCreatedDate: string;
  totalRecords: number;
  populatedRecords: number;
  populatedPercentageNumeric: number;
  populatedPercentage: string;
  sum: number | string;
};

type SkippedFieldInfo = {
  sObjectName: string;
  fieldName: string;
  reason: string;
};

type ObjectContext = {
  sObjectName: string;
  describeResult: any;
  useTooling: boolean;
  eligibleFields: any[];
  sumFields: string[];
};

type FieldDistributionResult = {
  outputString: string;
  result: any[];
  reportFiles: any[];
  totalRecords: number;
};

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class HardisDocObjectFieldUsage extends SfCommand<any> {
  public static description = `
## Command Behavior

**Analyzes how populated fields are for a specific Salesforce object.**

This command focuses on one or more sObjects and measures how many records populate each non-required field. It is useful for understanding data completeness before refactoring, cleaning up unused fields, or preparing migration plans.

- **Target Org:** Use \`--target-org\` to pick the org connection context.
- **Multiple sObjects:** Provide one or more API names via \`--objects\` (comma-separated) to analyze several objects in one run.
- **Restrict to specific fields:** Use the \`Object:Field1,Field2\` syntax in \`--objects\` (groups separated by spaces) to analyze only the listed fields instead of every custom field. Example: \`--objects "Contact:Name,Email Account:Name,MyField__c"\`. Explicitly named fields are analyzed even when they are standard, as long as they exist and are filterable.
- **Sum of values:** Append \`(WITH_SUM)\` to a field name to add a \`sum\` column with the total of its populated values. Example: \`--objects "Opportunity:Amount(WITH_SUM),Name,ExpectedRevenue(WITH_SUM)"\`. Only numeric fields (currency, double, int, percent) are summed; the column is added to the report only when at least one field requests it.
- **Per-field Counts:** Performs one overall record count and one per-field count with \`SELECT COUNT() FROM <sObject> WHERE <field> != null\`, skipping required or non-filterable fields.
- **Non-filterable Fields:** Long Text Area and Rich Text fields cannot be counted with \`WHERE != null\`, so they are skipped by default. Add \`--include-non-filterable\` to compute their population rate anyway: the command pages through the records and counts how many have a non-empty value (slower on objects with many records, since the values cannot be tested server-side).
- **Field Distributions:** Combine \`--objects <singleObject>\` with \`--fields FieldA,FieldB\` to group by those fields and list distinct values with their record counts and usage percentages.
- **Reporting:** Generates CSV/XLSX reports and prints a summary table with per-field population rates.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:doc:object-field-usage --objects Account,Contact --agent
\`\`\`

In agent mode:
- The \`--objects\` flag is **required** (no interactive prompt for object selection).
- The \`Object:Field1,Field2\` syntax can be used to restrict the analysis to specific fields, with an optional \`(WITH_SUM)\` modifier per numeric field.
- The API usage confirmation prompt is skipped (proceeds automatically).
`;

  public static examples = [
    '$ sf hardis:doc:object-field-usage',
    '$ sf hardis:doc:object-field-usage --objects Account,Contact',
    '$ sf hardis:doc:object-field-usage --target-org myOrgAlias --objects CustomObject__c',
    '$ sf hardis:doc:object-field-usage --objects "Contact:Name,Email Account:Name,MyField__c,MyOtherField__c"',
    '$ sf hardis:doc:object-field-usage --objects "Opportunity:Amount(WITH_SUM),Name,ExpectedRevenue(WITH_SUM)"',
    '$ sf hardis:doc:object-field-usage --objects "Opportunity:Description,Name" --include-non-filterable',
    '$ sf hardis:doc:object-field-usage --objects Account --fields SalesRegionAcct__c,Region__c',
    '$ sf hardis:doc:object-field-usage --objects Account,Contact --agent',
  ];

  public static flags: any = {
    'target-org': requiredOrgFlagWithDeprecations,
    objects: Flags.string({
      char: 'o',
      description: 'Comma-separated API names of the sObjects to analyze (e.g. Account,CustomObject__c). To restrict the analysis to specific fields, use the Object:Field1,Field2 syntax with groups separated by spaces (e.g. "Contact:Name,Email Account:MyField__c"). Append (WITH_SUM) to a numeric field to add a column with the sum of its values (e.g. "Opportunity:Amount(WITH_SUM)"). If omitted, an interactive prompt will list available objects.',
      required: false,
    }),
    fields: Flags.string({
      char: 'f',
      description: 'Comma-separated API names of fields to analyze (requires exactly one --objects value)',
      required: false,
    }),
    'include-non-filterable': Flags.boolean({
      default: false,
      description: 'Also compute the population rate of non-filterable fields (e.g. Long Text Area, Rich Text). Their values cannot be counted server-side, so the command pages through the records and counts non-empty values, which can be slow on objects with many records.',
    }),
    websocket: Flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: Flags.boolean({
      description:
        "Skip authentication check when a default username is required",
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
  };

  protected identifierRegex = /^[A-Za-z][A-Za-z0-9_]*$/;
  protected compositeBatchSize = 5;
  protected toolingCustomFieldBatchSize = 80;
  protected objectsPromptSentinel = '__PROMPT_OBJECTS__';

  protected formatDateOnly(value: any): string {
    if (!value) {
      return 'N/A';
    }
    try {
      return new Date(value).toISOString().split('T')[0];
    } catch {
      return 'N/A';
    }
  }

  protected async fetchFieldCreatedDates(
    connection: Connection,
    sObjectName: string,
    fieldApiNames: string[]
  ): Promise<Record<string, string>> {
    const createdDateByField: Record<string, string> = {};
    if (!fieldApiNames.length) {
      return createdDateByField;
    }

    // We only analyze custom fields in this command, and Tooling CustomField exposes CreatedDate.
    // FieldDefinition does NOT expose CreatedDate in Tooling API.
    try {
      const objectDeveloperName = sObjectName.endsWith('__c') ? sObjectName.replace(/__c$/, '') : sObjectName;
      const customObjectRes = await soqlQueryTooling(
        `SELECT Id FROM CustomObject WHERE DeveloperName = '${objectDeveloperName.replace(/'/g, "\\'")}' LIMIT 1`,
        connection
      );
      const tableEnumOrId = customObjectRes?.records?.[0]?.Id || sObjectName;

      const requestedApiNames = fieldApiNames.filter((name) => typeof name === 'string' && name.length > 0);
      const developerNames = Array.from(
        new Set(
          requestedApiNames
            .filter((name) => name.endsWith('__c'))
            .map((name) => {
              if (isManagedApiName(name)) {
                // ns__Field__c -> DeveloperName = Field
                const parts = name.split('__');
                return parts[1] || name.replace(/__c$/, '');
              }
              return name.replace(/__c$/, '');
            })
        )
      );

      for (let i = 0; i < developerNames.length; i += this.toolingCustomFieldBatchSize) {
        const chunk = developerNames.slice(i, i + this.toolingCustomFieldBatchSize);
        const inClause = chunk.map((name) => `'${name.replace(/'/g, "\\'")}'`).join(',');
        const query =
          `SELECT DeveloperName, NamespacePrefix, CreatedDate ` +
          `FROM CustomField ` +
          `WHERE TableEnumOrId = '${String(tableEnumOrId).replace(/'/g, "\\'")}' ` +
          `AND DeveloperName IN (${inClause})`;

        const res = await soqlQueryTooling(query, connection);
        for (const record of res?.records || []) {
          const devName = record?.DeveloperName;
          if (!devName) {
            continue;
          }
          const ns = record?.NamespacePrefix;
          const apiName = `${ns ? ns + '__' : ''}${devName}__c`;
          createdDateByField[apiName] = this.formatDateOnly(record?.CreatedDate);
        }
      }
    } catch (error: any) {
      uxLog(
        'warning',
        this,
        c.yellow(
          `Unable to query Tooling CustomField for created dates on ${sObjectName}. ` +
          `Created Date column will be set to N/A. Error: ${error?.message || error}`
        )
      );
    }

    return createdDateByField;
  }

  protected validateIdentifier(identifier: string, label: string) {
    if (!this.identifierRegex.test(identifier)) {
      throw new Error(`Invalid ${label} name: ${identifier}`);
    }
  }

  // Parses the --objects flag value into a list of objects with their optional field restrictions.
  // Two accepted forms:
  //  - Comma-separated objects (legacy): "Account,Contact" -> all eligible fields per object.
  //  - Per-object field selection: "Contact:Name,Email Account:MyField__c" (groups separated by spaces).
  // A field can carry a (WITH_SUM) suffix (e.g. "Amount(WITH_SUM)") to request an extra column
  // with the sum of its populated values.
  protected parseObjectsInput(raw: string): Array<{ name: string; fields: Array<{ name: string; withSum: boolean }> }> {
    const input = (raw || '').trim();
    if (!input) {
      return [];
    }
    // Without a colon, keep the historical comma-separated objects behavior (all fields).
    if (!input.includes(':')) {
      return input
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .map((name) => ({ name, fields: [] }));
    }
    // With a colon, groups are separated by spaces and each group is Object or Object:Field1,Field2
    return input
      .split(/\s+/)
      .map((group) => group.trim())
      .filter((group) => group.length > 0)
      .map((group) => {
        const colonIndex = group.indexOf(':');
        if (colonIndex === -1) {
          return { name: group, fields: [] };
        }
        const name = group.slice(0, colonIndex).trim();
        const fields = group
          .slice(colonIndex + 1)
          .split(',')
          .map((field) => field.trim())
          .filter((field) => field.length > 0)
          .map((field) => {
            const sumMatch = field.match(/^(.*?)\s*\(WITH_SUM\)\s*$/i);
            if (sumMatch) {
              return { name: sumMatch[1].trim(), withSum: true };
            }
            return { name: field, withSum: false };
          });
        return { name, fields };
      })
      .filter((entry) => entry.name.length > 0);
  }

  // Resolves explicitly requested field names against the object describe.
  // Honors standard fields too; skips unknown fields with a warning.
  // Non-filterable fields are skipped unless includeNonFilterable is set (then counted in memory).
  protected selectRequestedFields(describeFields: any[], requestedNames: string[], sObjectName: string, includeNonFilterable = false): any[] {
    const fieldsByLowerName = new Map<string, any>();
    for (const field of describeFields || []) {
      if (field?.name && typeof field.name === 'string') {
        fieldsByLowerName.set(field.name.toLowerCase(), field);
      }
    }
    const selected: any[] = [];
    for (const requestedName of requestedNames) {
      const field = fieldsByLowerName.get(requestedName.toLowerCase());
      if (!field) {
        uxLog("warning", this, c.yellow(t('requestedFieldNotFound', { fieldName: requestedName, sObjectName })));
        continue;
      }
      // Compound parents (Address / Geolocation) can't be counted; analyze their components instead
      if (this.isCompoundParentField(field)) {
        uxLog("warning", this, c.yellow(t('requestedFieldIsCompound', { fieldName: field.name, sObjectName })));
        continue;
      }
      if (field.filterable === false && !includeNonFilterable) {
        uxLog("warning", this, c.yellow(t('requestedFieldNotFilterable', { fieldName: field.name, sObjectName })));
        continue;
      }
      selected.push(field);
    }
    return selected;
  }

  // Counts populated values for non-filterable fields (Long Text Area, Rich Text...).
  // These cannot be counted with COUNT() WHERE != null, and SOQL cannot test their emptiness
  // server-side, so we page through the records with the REST query API (JSON) and only keep a
  // running count of non-empty values. Records are discarded after each page, so the field
  // contents are never accumulated in memory; we only care whether each value is empty or not.
  protected async countNonFilterableFields(
    connection: Connection,
    sObjectName: string,
    fields: any[],
    skippedFields: SkippedFieldInfo[]
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    if (!fields.length) {
      return counts;
    }
    const fieldNames = fields.map((field) => field.name);
    for (const fieldName of fieldNames) {
      counts[fieldName] = 0;
    }
    uxLog("log", this, c.grey(t('countingNonFilterableFields', { count: fieldNames.length, sObjectName })));

    const tally = (records: any[]) => {
      for (const record of records) {
        for (const field of fields) {
          const value = record[field.name];
          if (value !== null && typeof value !== 'undefined' && String(value).trim() !== '') {
            counts[field.name]++;
          }
        }
      }
    };

    try {
      const query = `SELECT ${fieldNames.join(', ')} FROM ${sObjectName}`;
      let result: any = await connection.query(query);
      tally(result.records || []);
      let fetched = result.records?.length || 0;
      let nextProgress = 100000;
      while (result.done === false && result.nextRecordsUrl) {
        result = await connection.queryMore(result.nextRecordsUrl);
        tally(result.records || []);
        fetched += result.records?.length || 0;
        if (fetched >= nextProgress) {
          uxLog("log", this, c.grey(t('nonFilterableCountProgress', { count: fetched, sObjectName })));
          nextProgress += 100000;
        }
      }
    } catch (error: any) {
      const warning = t('nonFilterableCountFailed', { sObjectName, message: error?.message || error });
      uxLog("warning", this, c.yellow(warning));
      fields.forEach((field) => skippedFields.push({ sObjectName, fieldName: field.name, reason: warning }));
      return {};
    }
    return counts;
  }

  protected extractCount(result: any): number {
    if (!result) {
      return 0;
    }
    if (typeof result.totalSize === 'number') {
      return Number(result.totalSize);
    }
    const records = result.records || [];
    if (records.length > 0) {
      const firstRecord = records[0];
      if (firstRecord && typeof firstRecord.expr0 !== 'undefined') {
        return Number(firstRecord.expr0);
      }
      const firstKey = Object.keys(firstRecord || {})[0];
      if (firstKey && typeof firstRecord[firstKey] !== 'undefined') {
        return Number(firstRecord[firstKey]);
      }
    }
    return 0;
  }

  protected async countRecords(
    connection: Connection,
    sObjectName: string,
    useTooling: boolean,
    fieldName?: string
  ): Promise<number> {
    const whereClause = fieldName ? ` WHERE ${fieldName} != null` : '';
    const query = `SELECT COUNT() FROM ${sObjectName}${whereClause}`;
    const result = useTooling ? await soqlQueryTooling(query, connection) : await soqlQuery(query, connection);
    return this.extractCount(result);
  }

  protected async countFieldsWithComposite(
    connection: Connection,
    sObjectName: string,
    fields: any[],
    useTooling: boolean,
    skippedFields: SkippedFieldInfo[],
    batchSize = this.compositeBatchSize
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    if (!fields.length) {
      return counts;
    }
    const apiVersion = connection.getApiVersion();
    const basePath = useTooling ? `/services/data/v${apiVersion}/tooling` : `/services/data/v${apiVersion}`;
    const compositeEndpoint = `${basePath}/composite`;

    const totalBatches = Math.ceil(fields.length / batchSize) || 1;
    for (let i = 0; i < fields.length; i += batchSize) {
      const batch = fields.slice(i, i + batchSize);
      const referenceMap: Record<string, string> = {};
      uxLog(
        "log",
        this,
        c.grey(
          t('processingObjectBatch', { sObjectName, batchNumber: Math.floor(i / batchSize) + 1, totalBatches, from: i + 1, to: i + batch.length, total: fields.length })
        )
      );

      const compositeRequest = batch.map((field, idx) => {
        const referenceId = `ref${i + idx}`;
        referenceMap[referenceId] = field.name;
        const batchQuery = `SELECT COUNT() FROM ${sObjectName} WHERE ${field.name} != null`;
        const encodedQuery = encodeURIComponent(batchQuery);
        return {
          method: 'GET',
          url: `${basePath}/query/?q=${encodedQuery}`,
          referenceId,
        };
      });

      const payload = { compositeRequest };
      try {
        const response: any = await connection.request({
          method: 'POST',
          url: compositeEndpoint,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const compositeResponse = response?.compositeResponse || [];
        compositeResponse.forEach((item: any) => {
          const fieldName = referenceMap[item.referenceId];
          if (!fieldName) {
            return;
          }
          if (item.httpStatusCode >= 200 && item.httpStatusCode < 300) {
            counts[fieldName] = this.extractCount(item.body);
          } else {
            const errorMessage =
              item.body?.message ||
              item.body?.[0]?.message ||
              (item.errors && item.errors[0]?.message) ||
              'Unknown error';
            const warning = t('compositeQueryFailed', { fieldName, errorMessage });
            uxLog("warning", this, c.yellow(warning));
            skippedFields.push({ sObjectName, fieldName, reason: warning });
          }
        });
      } catch (error: any) {
        const warning = t('compositeRequestBatchFailed', { i, message: error.message });
        uxLog("warning", this, c.yellow(warning));
        batch.forEach((field) => skippedFields.push({ sObjectName, fieldName: field.name, reason: warning }));
      }
    }

    return counts;
  }

  protected async queryFieldDistribution(
    connection: Connection,
    sObjectName: string,
    fieldName: string,
    useTooling: boolean
  ): Promise<any> {
    const query = `SELECT ${fieldName}, COUNT(Id) FROM ${sObjectName} GROUP BY ${fieldName} ORDER BY COUNT(Id) DESC LIMIT 1000`;
    return useTooling ? soqlQueryTooling(query, connection) : soqlQuery(query, connection);
  }

  // Computes SUM() for the requested numeric fields in a single aggregate query.
  // Returns a map fieldName -> sum (null when the org returned no value).
  protected async computeFieldSums(
    connection: Connection,
    sObjectName: string,
    sumFields: string[],
    useTooling: boolean
  ): Promise<Record<string, number | null>> {
    const sums: Record<string, number | null> = {};
    if (!sumFields.length) {
      return sums;
    }
    const aliasToField: Record<string, string> = {};
    const selectParts = sumFields.map((fieldName, idx) => {
      const alias = `sum${idx}`;
      aliasToField[alias] = fieldName;
      return `SUM(${fieldName}) ${alias}`;
    });
    const query = `SELECT ${selectParts.join(', ')} FROM ${sObjectName}`;
    try {
      const result = useTooling ? await soqlQueryTooling(query, connection) : await soqlQuery(query, connection);
      const record = (result?.records || [])[0] || {};
      for (const [alias, fieldName] of Object.entries(aliasToField)) {
        const value = record[alias];
        sums[fieldName] = value === null || typeof value === 'undefined' ? null : Number(value);
      }
    } catch (error: any) {
      uxLog("warning", this, c.yellow(t('unableToComputeFieldSums', { sObjectName, message: error?.message || error })));
    }
    return sums;
  }

  protected isInvalidTypeError(error: any): boolean {
    const message = (error?.message || '').toLowerCase();
    const name = (error?.name || error?.code || '').toLowerCase();
    return (
      name === 'invalid_type' ||
      message.includes('sobject type') ||
      message.includes('unknown type') ||
      message.includes('is not supported') ||
      message.includes('invalid type')
    );
  }

  protected async describeTarget(
    connection: Connection,
    sObjectName: string
  ): Promise<{ describeResult: any, useTooling: boolean }> {
    try {
      const describeResult = await connection.describe(sObjectName);
      return { describeResult, useTooling: false };
    } catch (error) {
      if (!this.isInvalidTypeError(error)) {
        throw error;
      }
      uxLog("warning", this, c.yellow(t('standardApiDescribeFailedForRetryingWith', { sObjectName })));
      const describeResult = await connection.tooling.describe(sObjectName);
      return { describeResult, useTooling: true };
    }
  }

  protected async processSingleFieldAnalysis(
    connection: Connection,
    sObjectName: string,
    fieldDescribe: any,
    useTooling: boolean
  ): Promise<FieldDistributionResult> {
    const fieldName = fieldDescribe.name;
    uxLog("action", this, c.cyan(t('computingDistributionFor', { sObjectName, fieldName })));
    const totalRecords = await this.countRecords(connection, sObjectName, useTooling);
    const distributionResult = await this.queryFieldDistribution(connection, sObjectName, fieldName, useTooling);

    const rows = (distributionResult.records || []).map((record: any) => {
      const rawValue = typeof record[fieldName] === 'undefined' ? null : record[fieldName];
      const recordCount = Number(record.valueCount ?? record.expr0 ?? 0);
      const percentage = totalRecords === 0 ? 0 : (recordCount / totalRecords) * 100;
      return {
        sObjectName,
        fieldApiName: fieldName,
        fieldLabel: fieldDescribe.label || fieldName,
        fieldValue: rawValue === null ? '(null)' : rawValue,
        recordCount,
        percentageNumeric: percentage,
        percentage: `${percentage.toFixed(2)}%`,
      };
    });

    const columns = [
      { key: 'fieldValue', header: 'Field Value' },
      { key: 'recordCount', header: 'Record Count' },
      { key: 'percentage', header: 'Percentage' },
    ];

    uxLog("log", this, c.cyan(t('foundDistinctValuesFor', { rows: rows.length, fieldName })));
    uxLog("log", this, c.cyan(t('totalRecords', { sObjectName, totalRecords })));
    // uxLogTable(this, rows, columns.map((col) => col.key));

    const reportFiles = await generateReports(rows, columns, this, {
      logFileName: `object-field-distribution-${sObjectName}-${fieldName}`,
      logLabel: `Field distribution for ${sObjectName}.${fieldName}`,
    });

    return {
      outputString: `Processed value distribution for ${sObjectName}.${fieldName}.`,
      result: rows,
      reportFiles,
      totalRecords,
    };
  }

  protected async processObjectFieldUsage(
    connection: Connection,
    sObjectName: string,
    eligibleFields: any[],
    useTooling: boolean,
    sumFields: string[] = []
  ): Promise<{ rows: FieldUsageRow[]; totalRecords: number; skippedFields: SkippedFieldInfo[] }> {
    if (eligibleFields.length === 0) {
      uxLog("warning", this, c.yellow(t('noEligibleFieldsFoundOnSkipping', { sObjectName })));
      return { rows: [], totalRecords: 0, skippedFields: [] };
    }

    uxLog("log", this, c.cyan(t('countingTotalRecords', { sObjectName })));
    const totalRecords = await this.countRecords(connection, sObjectName, useTooling);

    const skippedFields: SkippedFieldInfo[] = [];

    const fieldCreatedDates = await this.fetchFieldCreatedDates(
      connection,
      sObjectName,
      eligibleFields.map((f) => f.name).filter((name) => typeof name === 'string' && name.length > 0)
    );

    // Non-filterable fields (Long Text Area, Rich Text...) can't use COUNT() WHERE != null,
    // so split them out and count them in memory via the Bulk API.
    const filterableFields = eligibleFields.filter((field) => field.filterable !== false);
    const nonFilterableFields = eligibleFields.filter((field) => field.filterable === false);

    const fieldCounts = await this.countFieldsWithComposite(
      connection,
      sObjectName,
      filterableFields,
      useTooling,
      skippedFields
    );

    if (nonFilterableFields.length > 0) {
      const nonFilterableCounts = await this.countNonFilterableFields(
        connection,
        sObjectName,
        nonFilterableFields,
        skippedFields
      );
      Object.assign(fieldCounts, nonFilterableCounts);
    }

    const sumFieldsSet = new Set(sumFields);
    const fieldSums = await this.computeFieldSums(connection, sObjectName, sumFields, useTooling);

    const rows: FieldUsageRow[] = [];
    for (const field of eligibleFields) {
      const populatedRecords = fieldCounts[field.name];
      if (typeof populatedRecords !== 'number') {
        const warning = t('skippingFieldNoCount', { fieldName: field.name, sObjectName });
        uxLog("warning", this, c.yellow(warning));
        skippedFields.push({ sObjectName, fieldName: field.name, reason: warning });
        continue;
      }
      const percentage = totalRecords === 0 ? 0 : (populatedRecords / totalRecords) * 100;
      let sum: number | string = '';
      if (sumFieldsSet.has(field.name)) {
        const computedSum = fieldSums[field.name];
        sum = computedSum === null || typeof computedSum === 'undefined' ? 'N/A' : computedSum;
      }
      rows.push({
        sObjectName,
        fieldApiName: field.name,
        fieldLabel: field.label || field.name,
        fieldCreatedDate: fieldCreatedDates[field.name] || 'N/A',
        totalRecords,
        populatedRecords,
        populatedPercentageNumeric: percentage,
        populatedPercentage: `${percentage.toFixed(2)}%`,
        sum,
      });
    }

    // const columns = [
    //   { key: 'fieldApiName', header: 'Field API Name' },
    //   { key: 'fieldLabel', header: 'Field Label' },
    //   { key: 'populatedRecords', header: 'Populated Records' },
    //   { key: 'populatedPercentage', header: 'Populated %' },
    // ];

    const resultSorted = sortArray(rows, {
      by: ['populatedPercentageNumeric'],
      order: ['desc'],
    });

    uxLog("log", this, c.grey(t('computedPopulationMetricsForFieldsOn', { resultSorted: resultSorted.length, sObjectName })));
    uxLog("log", this, c.grey(t('totalRecordsFor', { sObjectName, totalRecords })));
    //uxLogTable(this, resultSorted, columns.map((col) => col.key));

    return { rows: resultSorted, totalRecords, skippedFields };
  }

  protected async generateFieldUsageCsvReport(
    rows: FieldUsageRow[],
    reportName: string,
    fileTitle: string,
    includeSum = false
  ): Promise<string> {
    const csvPath = await generateReportPath(reportName, '', { withDate: true });
    const csvData = rows.map((row) => {
      const csvRow: Record<string, any> = {
        sObjectName: row.sObjectName,
        fieldApiName: row.fieldApiName,
        fieldLabel: row.fieldLabel,
        fieldCreatedDate: row.fieldCreatedDate,
        totalRecords: row.totalRecords,
        populatedRecords: row.populatedRecords,
        populatedPercentage: row.populatedPercentage,
      };
      if (includeSum) {
        csvRow.sum = row.sum;
      }
      return csvRow;
    });
    await generateCsvFile(csvData, csvPath, {
      fileTitle,
      noExcel: true,
      skipNotifyToWebSocket: true,
    });
    return csvPath;
  }

  // True for the parent of a compound field (Address or Geolocation). Such fields can't be
  // counted with WHERE != null, and when selected their value is an object, so the emptiness
  // check is meaningless. Their individual components (e.g. BillingStreet) can still be analyzed.
  protected isCompoundParentField(field: any): boolean {
    const type = (field?.type || '').toLowerCase();
    return type === 'address' || type === 'location';
  }

  protected filterDescribeFields(fields: any[], includeNonFilterable = false): any[] {
    if (!Array.isArray(fields)) {
      return [];
    }
    return fields.filter((field) => {
      if (!field?.name || typeof field.name !== 'string') {
        return false;
      }
      if (!this.identifierRegex.test(field.name)) {
        return false;
      }
      if (!field.custom) {
        return false;
      }
      if (field.calculated || field.deprecatedAndHidden) {
        return false;
      }
      if (!field.nillable) {
        return false;
      }
      // Compound parents (Address / Geolocation) can't be counted and their value is an object
      if (this.isCompoundParentField(field)) {
        return false;
      }
      // Non-filterable fields (Long Text Area, Rich Text...) can't be counted with WHERE != null.
      // They are kept only when --include-non-filterable is set, then counted in memory.
      if (!field.filterable && !includeNonFilterable) {
        return false;
      }
      if (field.compoundFieldName && field.compoundFieldName !== field.name) {
        return false;
      }
      return true;
    });
  }

  protected estimateApiCalls(
    contexts: Array<{ sObjectName: string; eligibleFields: any[]; sumFields?: string[] }>,
    fieldFilters: string[] = []
  ): number {
    if (contexts.length === 0) {
      return 0;
    }
    if (fieldFilters.length > 0) {
      return contexts.length > 0 ? fieldFilters.length * 2 : 0; // total count + grouped count per field
    }
    return contexts.reduce((sum, context) => {
      const eligibleCount = context.eligibleFields.length || 0;
      if (eligibleCount === 0) {
        return sum;
      }
      const filterableCount = context.eligibleFields.filter((field) => field.filterable !== false).length;
      const nonFilterableCount = eligibleCount - filterableCount;
      const compositeCalls = Math.ceil(filterableCount / this.compositeBatchSize);
      const createdDateCalls = Math.ceil(eligibleCount / this.toolingCustomFieldBatchSize) || 1;
      const sumCalls = (context.sumFields?.length || 0) > 0 ? 1 : 0; // single aggregate query per object
      const nonFilterableCalls = nonFilterableCount > 0 ? 1 : 0; // record paging per object (more on large objects)
      return sum + 1 + createdDateCalls + compositeCalls + sumCalls + nonFilterableCalls; // total count + CustomField chunks + composite batches + sum + non-filterable paging
    }, 0);
  }

  protected async confirmApiUsage(plannedCalls: number, objectNames: string[], agentMode = false): Promise<boolean> {
    if (plannedCalls === 0 || isCI || agentMode) {
      return true;
    }
    const confirm = await prompts({
      type: 'confirm',
      name: 'value',
      initial: true,
      message: c.cyanBright(
        `About to execute approximately ${plannedCalls} API call(s) for ${objectNames.length} object(s). Continue?`
      ),
      description: t('confirmApiUsage'),
    });
    return confirm.value === true;
  }

  protected injectObjectsPromptSentinel() {
    const argv = this.argv || [];
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--objects' || argv[i] === '-o') {
        const next = argv[i + 1];
        if (!next || next.startsWith('-')) {
          argv.splice(i + 1, 0, this.objectsPromptSentinel);
        }
      }
    }
  }

  public async run(): Promise<AnyJson> {
    this.injectObjectsPromptSentinel();
    const { flags } = await this.parse(HardisDocObjectFieldUsage);
    const agentMode = flags.agent === true;
    const includeNonFilterable = flags['include-non-filterable'] === true;
    const connection = flags['target-org'].getConnection();
    let uniqueObjects: string[] = [];
    const requestedFieldsByObject: Record<string, string[]> = {};
    // Field names (lowercased) explicitly requested with the (WITH_SUM) modifier, per object
    const sumFieldsByObject: Record<string, Set<string>> = {};
    const hasPromptSentinel = flags.objects === this.objectsPromptSentinel;
    if (flags.objects && !hasPromptSentinel) {
      const parsedObjects = this.parseObjectsInput(flags.objects as string);
      for (const entry of parsedObjects) {
        this.validateIdentifier(entry.name, 'sObject');
        entry.fields.forEach((field) => this.validateIdentifier(field.name, 'field'));
        if (!requestedFieldsByObject[entry.name]) {
          requestedFieldsByObject[entry.name] = [];
          sumFieldsByObject[entry.name] = new Set();
        }
        for (const field of entry.fields) {
          requestedFieldsByObject[entry.name].push(field.name);
          if (field.withSum) {
            sumFieldsByObject[entry.name].add(field.name.toLowerCase());
          }
        }
      }
      uniqueObjects = Object.keys(requestedFieldsByObject);
      for (const name of uniqueObjects) {
        requestedFieldsByObject[name] = Array.from(new Set(requestedFieldsByObject[name]));
      }
    }

    const objectContexts: ObjectContext[] = [];
    if (uniqueObjects.length === 0 || hasPromptSentinel) {
      if (!isCI && !agentMode) {
        const availableSObjects = await listOrgSObjects(connection);
        const sObjectApiNames = (availableSObjects?.records || [])
          .map((record: any) => record?.QualifiedApiName)
          .filter((apiName: any) => typeof apiName === 'string' && apiName.length > 0)
          .filter((apiName: string) => !apiName.endsWith('__Share') && !apiName.endsWith('__ChangeEvent'));
        sortArray(sObjectApiNames);

        const promptObjectsRes = await prompts({
          type: 'multiselect',
          name: 'value',
          message: t('selectTheSobjectsToAnalyze'),
          description: t('excludeObjectsYouDontWantToAnalyze'),
          choices: sObjectApiNames.map((apiName: string) => ({ title: apiName, value: apiName })),
          initial: sObjectApiNames,
        });
        const selectedObjects = promptObjectsRes.value || [];
        if (!selectedObjects.length) {
          const outputString = 'No objects selected; aborting.';
          uxLog("warning", this, c.yellow(t('noObjectsSelectedAborting')));
          return { outputString, cancelled: true };
        }
        uniqueObjects = selectedObjects;
        uxLog("log", this, t('sObjectsSelectedForAnalysis', { count: uniqueObjects.length }));
      } else {
        const outputString = t('objectsFlagRequiredInAgentMode');
        uxLog("error", this, c.red(outputString));
        return { outputString, cancelled: true };
      }
    }

    const fieldsInput = flags.fields
      ? Array.from(
        new Set(
          (flags.fields as string)
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
        )
      )
      : [];
    const hasPerObjectFields = Object.values(requestedFieldsByObject).some((fields) => fields.length > 0);
    if (fieldsInput.length > 0) {
      if (hasPerObjectFields) {
        throw new Error('--fields cannot be combined with the Object:Field1,Field2 syntax in --objects. Use one or the other.');
      }
      fieldsInput.forEach((fieldName) => this.validateIdentifier(fieldName, 'field'));
      if (uniqueObjects.length !== 1) {
        throw new Error('--fields can only be used when a single object is specified or selected.');
      }
    }

    WebSocketClient.sendProgressStartMessage(t('describingObjects', { count: uniqueObjects.length }));
    let counter = 0;
    for (const sObjectName of uniqueObjects) {
      uxLog("log", this, c.grey(t('describing', { sObjectName })));
      const context = await this.describeTarget(connection, sObjectName);
      uxLog("log", this, c.grey(t('usingApiFor', { context: context.useTooling ? 'Tooling' : 'standard', sObjectName })));
      const requestedFields = requestedFieldsByObject[sObjectName] || [];
      let eligibleFieldsFiltered: any[];
      if (requestedFields.length > 0) {
        // Only analyze the explicitly requested fields (standard fields honored, namespace filter bypassed)
        eligibleFieldsFiltered = this.selectRequestedFields(context.describeResult?.fields || [], requestedFields, sObjectName, includeNonFilterable);
      } else {
        const eligibleFields = this.filterDescribeFields(context.describeResult?.fields || [], includeNonFilterable);
        // Filter eligible fields to remove those with namespaces
        eligibleFieldsFiltered = eligibleFields.filter((field) => {
          if (isManagedApiName(field.name) && !fieldsInput.includes(field.name)) {
            return false;
          }
          return true;
        });
      }
      // Resolve which eligible fields should also get a SUM column (numeric fields only)
      const requestedSumFields = sumFieldsByObject[sObjectName] || new Set<string>();
      const numericFieldTypes = new Set(['currency', 'double', 'int', 'percent']);
      const sumFields: string[] = [];
      for (const field of eligibleFieldsFiltered) {
        if (!requestedSumFields.has(field.name.toLowerCase())) {
          continue;
        }
        if (numericFieldTypes.has((field.type || '').toLowerCase())) {
          sumFields.push(field.name);
        } else {
          uxLog("warning", this, c.yellow(t('sumRequestedOnNonNumericField', { fieldName: field.name, sObjectName })));
        }
      }
      if (eligibleFieldsFiltered.length > 0) {
        objectContexts.push({ sObjectName, ...context, eligibleFields: eligibleFieldsFiltered, sumFields });
      }
      WebSocketClient.sendProgressStepMessage(counter + 1, uniqueObjects.length);
      counter++;
    }
    WebSocketClient.sendProgressEndMessage(uniqueObjects.length);

    const plannedApiCalls = this.estimateApiCalls(objectContexts, fieldsInput);
    const proceed = await this.confirmApiUsage(plannedApiCalls, uniqueObjects, agentMode);
    if (!proceed) {
      const outputString = 'Operation cancelled by user.';
      uxLog("warning", this, c.yellow(outputString));
      return { outputString, cancelled: true };
    }

    if (fieldsInput.length > 0) {
      const context = objectContexts[0];
      const aggregatedResults: any[] = [];
      const aggregatedReportFiles: any[] = [];
      let totalRecords: number | null = null;

      for (const fieldName of fieldsInput) {
        const targetField = (context.describeResult?.fields || []).find((field: any) => field.name === fieldName);
        if (!targetField) {
          throw new Error(`Field ${fieldName} not found on ${context.sObjectName}.`);
        }
        if (targetField.groupable === false) {
          throw new Error(`Field ${fieldName} on ${context.sObjectName} is not groupable; cannot compute distribution.`);
        }
        const singleResult = await this.processSingleFieldAnalysis(
          connection,
          context.sObjectName,
          targetField,
          context.useTooling
        );
        aggregatedResults.push(...(singleResult.result || []));
        aggregatedReportFiles.push(...(singleResult.reportFiles || []));
        totalRecords = singleResult.totalRecords ?? totalRecords;
      }

      uxLog("action", this, c.cyan(t('summary')));
      const fieldSummaryRows = fieldsInput.map((fieldApiName) => {
        const distinctValues = aggregatedResults.filter((r: any) => r?.fieldApiName === fieldApiName).length;
        return {
          sObjectName: context.sObjectName,
          fieldApiName,
          distinctValues,
          totalRecords: totalRecords ?? 'N/A',
        };
      });
      if (fieldSummaryRows.length > 0) {
        uxLogTable(this, fieldSummaryRows, ['sObjectName', 'fieldApiName', 'distinctValues', 'totalRecords']);
      }
      if (aggregatedReportFiles.length > 0) {
        uxLog("log", this, c.grey(t('reportFiles')));
        for (const rf of aggregatedReportFiles) {
          uxLog("log", this, c.grey(`- ${rf?.type || 'file'}: ${rf?.file || ''}`));
        }
      }

      return {
        outputString: `Processed value distribution for ${context.sObjectName} fields: ${fieldsInput.join(', ')}.`,
        result: aggregatedResults,
        reportFiles: aggregatedReportFiles,
        totalRecords,
      };
    }

    const aggregatedRows: FieldUsageRow[] = [];
    const perObjectRows: Record<string, FieldUsageRow[]> = {};
    const aggregatedSkipped: SkippedFieldInfo[] = [];
    const totalRecordsMap: Record<string, number> = {};

    WebSocketClient.sendProgressStartMessage(t('processingFieldUsage', { count: objectContexts.length }));
    counter = 0;
    for (const context of objectContexts) {
      const { rows, totalRecords, skippedFields } = await this.processObjectFieldUsage(
        connection,
        context.sObjectName,
        context.eligibleFields,
        context.useTooling,
        context.sumFields
      );
      aggregatedRows.push(...rows);
      perObjectRows[context.sObjectName] = rows;
      aggregatedSkipped.push(...skippedFields);
      totalRecordsMap[context.sObjectName] = totalRecords;
      WebSocketClient.sendProgressStepMessage(counter + 1, objectContexts.length);
      counter++;
    }
    WebSocketClient.sendProgressEndMessage(objectContexts.length);

    // Only add the Sum column when at least one (WITH_SUM) field was requested
    const includeSumColumn = objectContexts.some((context) => (context.sumFields?.length || 0) > 0);

    uxLog("action", this, c.cyan(t('generatingReports')));
    const reportFiles: any[] = [];
    const csvFilesForXlsx: string[] = [];
    for (const context of objectContexts) {
      const rows = perObjectRows[context.sObjectName] || [];
      if (!rows.length) {
        continue;
      }
      const csvPath = await this.generateFieldUsageCsvReport(
        rows,
        `object-field-usage-${context.sObjectName}`,
        `Field usage - ${context.sObjectName}`,
        includeSumColumn
      );
      csvFilesForXlsx.push(csvPath);
      reportFiles.push({ type: 'csv', file: csvPath });
    }

    if (aggregatedRows.length > 0) {
      const summaryCsv = await this.generateFieldUsageCsvReport(
        aggregatedRows,
        'object-field-usage-summary',
        'Object field usage summary',
        includeSumColumn
      );
      csvFilesForXlsx.unshift(summaryCsv);
      reportFiles.push({ type: 'csv', file: summaryCsv });
    }

    if (aggregatedSkipped.length > 0) {
      uxLog(
        "warning",
        this,
        c.yellow(t('fieldsSkippedAcrossObjects', { count: aggregatedSkipped.length }))
      );
      const skippedCsv = await generateReportPath('object-field-usage-skipped-fields', '', { withDate: true });
      await generateCsvFile(aggregatedSkipped, skippedCsv, {
        fileTitle: 'Object field usage - skipped fields',
        noExcel: true,
      });
      csvFilesForXlsx.push(skippedCsv);
      reportFiles.push({ type: 'csv', file: skippedCsv });
    }

    if (csvFilesForXlsx.length > 0) {
      const consolidatedBase = await generateReportPath('object-field-usage', '', { withDate: true });
      uxLog("action", this, c.cyan(t('generatingConsolidatedXlsxReport')));
      await createXlsxFromCsvFiles(csvFilesForXlsx, consolidatedBase, { fileTitle: 'Object field usage (all)' });
      const consolidatedXlsx = path.join(
        path.dirname(consolidatedBase),
        'xls',
        path.basename(consolidatedBase).replace('.csv', '.xlsx')
      );
      reportFiles.push({ type: 'xlsx', file: consolidatedXlsx });
    }

    uxLog("action", this, c.cyan(t('summary')));

    const perObjectSummary = objectContexts.map((context) => {
      const rows = perObjectRows[context.sObjectName] || [];
      const skippedCount = aggregatedSkipped.filter((s) => s.sObjectName === context.sObjectName).length;
      const neverUsedFields = rows.filter((r) => (r?.populatedPercentageNumeric ?? 0) === 0).length;
      const mostPopulated = rows.length > 0 ? rows[0] : null;
      const leastPopulated = rows.length > 0 ? rows[rows.length - 1] : null;
      return {
        sObjectName: context.sObjectName,
        totalRecords: totalRecordsMap[context.sObjectName] ?? 0,
        fieldsAnalyzed: rows.length,
        neverUsedFields,
        skippedFields: skippedCount,
        mostPopulated: mostPopulated ? `${mostPopulated.fieldApiName} (${mostPopulated.populatedPercentage})` : 'N/A',
        leastPopulated: leastPopulated ? `${leastPopulated.fieldApiName} (${leastPopulated.populatedPercentage})` : 'N/A',
      };
    });

    perObjectSummary.sort((a, b) => {
      if (b.neverUsedFields !== a.neverUsedFields) {
        return b.neverUsedFields - a.neverUsedFields;
      }
      if (b.fieldsAnalyzed !== a.fieldsAnalyzed) {
        return b.fieldsAnalyzed - a.fieldsAnalyzed;
      }
      return String(a.sObjectName).localeCompare(String(b.sObjectName));
    });

    const totalFieldsAnalyzed = aggregatedRows.length;
    uxLog(
      "log",
      this,
      c.grey(
        t('analyzedObjectsAndFields', { objects: objectContexts.length, fields: totalFieldsAnalyzed, skipped: aggregatedSkipped.length })
      )
    );
    if (perObjectSummary.length > 0) {
      uxLogTable(this, perObjectSummary, [
        'sObjectName',
        'totalRecords',
        'fieldsAnalyzed',
        'neverUsedFields',
        'skippedFields',
        'mostPopulated',
        'leastPopulated',
      ]);
    }

    const outputString = `Processed object field usage for ${objectContexts.length} object(s).`;
    return {
      outputString,
      result: aggregatedRows,
      reportFiles,
      totalRecords: totalRecordsMap,
      skippedFields: aggregatedSkipped,
    };
  }
}
