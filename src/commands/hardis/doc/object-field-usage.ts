import { Flags, SfCommand, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { AnyJson } from '@salesforce/ts-types';
import { Connection } from '@salesforce/core';
import c from 'chalk';
import sortArray from 'sort-array';
import { generateReports, uxLog, uxLogTable } from '../../../common/utils/index.js';
import { soqlQuery, soqlQueryTooling } from '../../../common/utils/apiUtils.js';

type FieldUsageRow = {
  sObjectName: string;
  fieldApiName: string;
  fieldLabel: string;
  totalRecords: number;
  populatedRecords: number;
  populatedPercentageNumeric: number;
  populatedPercentage: string;
};

export default class HardisDocObjectFieldUsage extends SfCommand<any> {
  public static description = `
## Command Behavior

**Analyzes how populated fields are for a specific Salesforce object.**

This command focuses on a single sObject and measures how many records populate each non-required field. It is useful for understanding data completeness before refactoring, cleaning up unused fields, or preparing migration plans.

- **Target Org:** Use \`--target-org\` to pick the org connection context.
- **Single sObject:** Provide the API name of the object to analyze via \`--sObject\`.
- **Per-field Counts:** Performs one overall record count and one per-field count with \`SELECT COUNT() FROM <sObject> WHERE <field> != null\`, skipping required or non-filterable fields.
- **Single-field Distribution:** Combine \`--sObject\` with \`--field\` to group by that field and list distinct values with their record counts and usage percentages.
- **Reporting:** Generates CSV/XLSX reports and prints a summary table with per-field population rates.
`;

  public static examples = [
    '$ sf hardis:doc:object-field-usage --sObject Account',
    '$ sf hardis:doc:object-field-usage --target-org myOrgAlias --sObject CustomObject__c',
    '$ sf hardis:doc:object-field-usage --sObject Account --field SalesRegionAcct__c',
  ];

  public static flags: any = {
    'target-org': requiredOrgFlagWithDeprecations,
    sObject: Flags.string({
      char: 's',
      description: 'API name of the sObject to analyze (e.g. Account, CustomObject__c)',
      required: true,
    }),
    field: Flags.string({
      char: 'f',
      description: 'API name of a single field to analyze (requires --sObject)',
      required: false,
    }),
  };

  protected identifierRegex = /^[A-Za-z][A-Za-z0-9_]*$/;

  protected validateIdentifier(identifier: string, label: string) {
    if (!this.identifierRegex.test(identifier)) {
      throw new Error(`Invalid ${label} name: ${identifier}`);
    }
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
    batchSize = 5
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    if (!fields.length) {
      return counts;
    }
    const apiVersion = connection.getApiVersion();
    const basePath = useTooling ? `/services/data/v${apiVersion}/tooling` : `/services/data/v${apiVersion}`;
    const compositeEndpoint = `${basePath}/composite`;
// temporary test
    // for (let i = 0; i < 20; i += batchSize) {
    for (let i = 0; i < fields.length; i += batchSize) {
      const batch = fields.slice(i, i + batchSize);
      const referenceMap: Record<string, string> = {};

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
            uxLog("warning", this, c.yellow(`Composite query failed for ${fieldName}: ${errorMessage}`));
          }
        });
      } catch (error: any) {
        uxLog("warning", this, c.yellow(`Composite request batch starting at index ${i} failed: ${error.message}`));
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
    const query = `SELECT ${fieldName}, COUNT(Id) FROM ${sObjectName} GROUP BY ${fieldName} ORDER BY COUNT(Id) DESC`;
    return useTooling ? soqlQueryTooling(query, connection) : soqlQuery(query, connection);
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
      uxLog("warning", this, c.yellow(`Standard API describe failed for ${sObjectName}. Retrying with Tooling API...`));
      const describeResult = await connection.tooling.describe(sObjectName);
      return { describeResult, useTooling: true };
    }
  }

  protected async processSingleFieldAnalysis(
    connection: Connection,
    sObjectName: string,
    fieldDescribe: any,
    useTooling: boolean
  ): Promise<AnyJson> {
    const fieldName = fieldDescribe.name;
    uxLog("action", this, c.cyan(`Computing distribution for ${sObjectName}.${fieldName}...`));
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

    uxLog("action", this, c.cyan(`Found ${rows.length} distinct values for ${fieldName}.`));
    uxLog("action", this, c.cyan(`Total ${sObjectName} records: ${totalRecords}.`));
    uxLogTable(this, rows, columns.map((col) => col.key));

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

  protected filterDescribeFields(fields: any[]): any[] {
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
      if(!field.custom) {
        return false;
      }
      if (field.calculated || field.deprecatedAndHidden) {
        return false;
      }
      if (!field.nillable || !field.filterable) {
        return false;
      }
      if (field.compoundFieldName && field.compoundFieldName !== field.name) {
        return false;
      }
      return true;
    });
  }

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(HardisDocObjectFieldUsage);
    const connection = flags['target-org'].getConnection();
    const sObjectName = (flags.sObject as string).trim();
    this.validateIdentifier(sObjectName, 'sObject');
    const fieldFilter = flags.field ? (flags.field as string).trim() : undefined;
    if (fieldFilter) {
      this.validateIdentifier(fieldFilter, 'field');
    }

    uxLog("action", this, c.cyan(`Describing ${sObjectName}...`));
    const { describeResult, useTooling } = await this.describeTarget(connection, sObjectName);
    uxLog("action", this, c.cyan(`Using ${useTooling ? 'Tooling' : 'standard'} API for ${sObjectName}.`));

    if (fieldFilter) {
      const targetField = (describeResult?.fields || []).find((field: any) => field.name === fieldFilter);
      if (!targetField) {
        throw new Error(`Field ${fieldFilter} not found on ${sObjectName}.`);
      }
      if (targetField.groupable === false) {
        throw new Error(`Field ${fieldFilter} on ${sObjectName} is not groupable; cannot compute distribution.`);
      }
      return this.processSingleFieldAnalysis(connection, sObjectName, targetField, useTooling);
    }
    const eligibleFields = this.filterDescribeFields(describeResult?.fields || []);
    if (eligibleFields.length === 0) {
      const outputString = `No eligible fields found on ${sObjectName}.`;
      uxLog("warning", this, c.yellow(outputString));
      return { outputString, sObjectName };
    }

    uxLog("action", this, c.cyan(`Counting total ${sObjectName} records...`));
    const totalRecords = await this.countRecords(connection, sObjectName, useTooling);

    const fieldCounts = await this.countFieldsWithComposite(connection, sObjectName, eligibleFields, useTooling);

    const rows: FieldUsageRow[] = [];
    for (const field of eligibleFields) {
      const populatedRecords = fieldCounts[field.name];
      if (typeof populatedRecords !== 'number') {
        uxLog("warning", this, c.yellow(`Skipping field ${field.name} because composite response had no count.`));
        continue;
      }
      const percentage = totalRecords === 0 ? 0 : (populatedRecords / totalRecords) * 100;
      rows.push({
        sObjectName,
        fieldApiName: field.name,
        fieldLabel: field.label || field.name,
        totalRecords,
        populatedRecords,
        populatedPercentageNumeric: percentage,
        populatedPercentage: `${percentage.toFixed(2)}%`,
      });
    }

    const columns = [
      { key: 'fieldApiName', header: 'Field API Name' },
      { key: 'fieldLabel', header: 'Field Label' },
      { key: 'populatedRecords', header: 'Populated Records' },
      { key: 'populatedPercentage', header: 'Populated %' },
    ];

    const resultSorted = sortArray(rows, {
      by: ['populatedPercentageNumeric'],
      order: ['desc'],
    });

    uxLog("action", this, c.cyan(`Computed population metrics for ${resultSorted.length} fields on ${sObjectName}.`));
    uxLog("action", this, c.cyan(`Total records for ${sObjectName}:  ${totalRecords}.`));
    uxLogTable(this, resultSorted, columns.map((col) => col.key));

    const reportFiles = await generateReports(resultSorted, columns, this, {
      logFileName: `object-field-usage-${sObjectName}`,
      logLabel: `Object field usage for ${sObjectName}`,
    });

    const outputString = `Processed object field usage for ${sObjectName} with ${totalRecords} total records.`;
    return {
      outputString,
      result: resultSorted,
      reportFiles,
      totalRecords,
    };
  }
}
