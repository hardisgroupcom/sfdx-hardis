import { Flags, SfCommand, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { AnyJson } from '@salesforce/ts-types';
import { Connection } from '@salesforce/core';
import c from 'chalk';
import sortArray from 'sort-array';
import { generateReports, uxLog, uxLogTable } from '../../../common/utils/index.js';
import { soqlQuery } from '../../../common/utils/apiUtils.js';

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
- **Reporting:** Generates CSV/XLSX reports and prints a summary table with per-field population rates.
`;

  public static examples = [
    '$ sf hardis:doc:object-field-usage --sObject Account',
    '$ sf hardis:doc:object-field-usage --target-org myOrgAlias --sObject CustomObject__c',
  ];

  public static flags: any = {
    'target-org': requiredOrgFlagWithDeprecations,
    sObject: Flags.string({
      char: 's',
      description: 'API name of the sObject to analyze (e.g. Account, CustomObject__c)',
      required: true,
    }),
  };

  protected identifierRegex = /^[A-Za-z][A-Za-z0-9_]*$/;

  protected validateIdentifier(identifier: string, label: string) {
    if (!this.identifierRegex.test(identifier)) {
      throw new Error(`Invalid ${label} name: ${identifier}`);
    }
  }

  protected extractCount(result: any): number {
    return Number(result.totalSize ?? 0);
  }

  protected async countRecords(connection: Connection, sObjectName: string, fieldName?: string): Promise<number> {
    const whereClause = fieldName ? ` WHERE ${fieldName} != null` : '';
    const query = `SELECT COUNT() FROM ${sObjectName}${whereClause}`;
    const result = await soqlQuery(query, connection);
    return this.extractCount(result);
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

    uxLog("action", this, c.cyan(`Describing ${sObjectName}...`));
    const describeResult = await connection.describe(sObjectName);
    const eligibleFields = this.filterDescribeFields(describeResult?.fields || []);
    if (eligibleFields.length === 0) {
      const outputString = `No eligible fields found on ${sObjectName}.`;
      uxLog("warning", this, c.yellow(outputString));
      return { outputString, sObjectName };
    }

    uxLog("action", this, c.cyan(`Counting total ${sObjectName} records...`));
    const totalRecords = await this.countRecords(connection, sObjectName);

    const rows: FieldUsageRow[] = [];
    for (const field of eligibleFields) {
      try {
        const populatedRecords = await this.countRecords(connection, sObjectName, field.name);
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
      } catch (error: any) {
        uxLog("warning", this, c.yellow(`Skipping field ${field.name} due to error: ${error.message}`));
      }
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
