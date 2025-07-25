/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Connection, Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import Excel from 'exceljs';
import Papa from 'papaparse';
import { createReadStream } from 'fs';
import { uxLog } from '../../../../common/utils/index.js';
import { getReportDirectory } from '../../../../config/index.js';
import { bulkQueryWithCLI, soqlQuery } from '../../../../common/utils/apiUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class CpqExtract extends SfCommand<any> {
  public static title = 'Extract CPQ Configuration';

  public static description = `Extract Salesforce CPQ configuration and metadata for analysis or backup purposes.

This command analyzes CPQ-related metadata and configuration within your Salesforce project,
providing detailed reports on CPQ objects, custom fields, workflows, and configuration settings.

Use this command to:
- Extract CPQ product rules and price rules
- Analyze CPQ custom objects and fields
- Generate reports on CPQ configuration
- Backup CPQ settings for documentation or migration
`;

  public static examples = [
    '$ sf hardis:project:cpq:extract',
  ];

  public static flags: any = {
    outputdir: Flags.string({
      char: 'o',
      description: 'Output directory for extracted CPQ configuration files',
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
    "target-org": requiredOrgFlagWithDeprecations
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected extractResults: any[] = [];
  protected outputDir: string;
  protected debugMode: boolean;
  protected conn: Connection;
  protected cpqObjects: Array<{ object: string, csvFile: string }> = [];
  protected outputTabs: Array<{ tabName: string, recordCount: number, object: string, hasData: boolean, csvFile?: string }> = [];
  protected skippedObjects: string[] = [];

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CpqExtract);
    this.outputDir = flags.outputdir || path.join(await getReportDirectory(), 'cpq-extract', `${new Date().toISOString().replace(/:/g, '-').split('.')[0]}`);
    this.debugMode = flags.debug || false;
    this.conn = flags["target-org"].getConnection();
    uxLog(this, c.cyan(`Starting CPQ configuration extraction...`));

    // Ensure output directory exists
    await fs.ensureDir(this.outputDir);
    // Extract all CPQ related records
    await this.extractObjects();
    // Merge CSV files into a single excel file, with one tab by Object
    await this.mergeCsvInExcelFile();

    uxLog(this, c.green(`CPQ extraction completed successfully!`));
    uxLog(this, c.cyan(`Output directory: ${this.outputDir}`));
    uxLog(this, c.cyan(`SOQL queries logged to: ${path.join(this.outputDir, 'soqlQueries')}`));

    return { success: true };
  }

  public async extractObjects(): Promise<void> {
    const objectsToExtract = [
      'Product2',
      'PricebookEntry',
      // 'SBQQ__Quote__c',
      // 'SBQQ__QuoteLine__c',
      //  'SBQQ__QuoteLineGroup__c',
      'SBQQ__ProductRule__c',
      'SBQQ__PriceRule__c',
      'SBQQ__SummaryVariable__c',
      'SBQQ__ConfigurationAttribute__c',
      'SBQQ__ProductOption__c',
      'SBQQ__QuoteTemplate__c',
      'SBQQ__TemplateContent__c',
      'SBQQ__SubscriptionTerm__c',
      'SBQQ__Feature__c',
      'SBQQ__FeatureRule__c',
      'SBQQ__Approval__c',
      'SBQQ__DocumentTemplate__c',
      'SBQQ__ConstraintRule__c'
    ];

    // Create soqlQueries directory for logging queries
    const soqlQueriesDir = path.join(this.outputDir, 'soqlQueries');
    await fs.ensureDir(soqlQueriesDir);
    uxLog(this, c.grey(`Created SOQL queries log directory: ${soqlQueriesDir}`));
    // Use tooling API to list fields of each object
    const objectsWithFields: any = [
    ]
    for (const objectName of objectsToExtract) {
      const fieldsQuery = `SELECT QualifiedApiName FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = '${objectName}'`;

      // Log the fields query
      const fieldsQueryLogFileName = `${objectName}_fields_query.soql`;
      const fieldsQueryLogFilePath = path.join(soqlQueriesDir, fieldsQueryLogFileName);
      try {
        await fs.writeFile(fieldsQueryLogFilePath, fieldsQuery, 'utf8');
        uxLog(this, c.grey(`Logged fields query to: ${fieldsQueryLogFileName}`));
      } catch (logError) {
        uxLog(this, c.yellow(`Warning: Could not log fields query for ${objectName}: ${logError instanceof Error ? logError.message : String(logError)}`));
      }

      const fieldsQueryResult = await soqlQuery(fieldsQuery, this.conn);
      const fields = fieldsQueryResult.records.map((field: any) => field.QualifiedApiName);

      if (fields.length === 0) {
        uxLog(this, c.yellow(`No fields found for ${objectName}, skipping extraction`));
        this.skippedObjects.push(objectName);
        continue;
      }

      objectsWithFields.push({
        objectName: objectName,
        fields: fields,
        order: 'Name',
      });
      uxLog(this, c.grey(`Extracted fields for ${objectName}: ${fields.join(', ')}`));
    }
    // Extract records using Bulk API
    for (const object of objectsWithFields) {
      uxLog(this, c.cyan(`Extracting records for ${object.objectName}...`));
      const bulkQueryRecords = `SELECT ${object.fields.join(', ')} FROM ${object.objectName} ORDER BY ${object.order}`;

      // Log the SOQL query to a file in soqlQueries directory
      const queryLogFileName = `${object.objectName}_query.soql`;
      const queryLogFilePath = path.join(soqlQueriesDir, queryLogFileName);
      try {
        await fs.writeFile(queryLogFilePath, bulkQueryRecords, 'utf8');
        uxLog(this, c.grey(`Logged SOQL query to: ${queryLogFileName}`));
      } catch (logError) {
        uxLog(this, c.yellow(`Warning: Could not log query for ${object.objectName}: ${logError instanceof Error ? logError.message : String(logError)}`));
      }

      // Define CSV file path
      const csvFileName = `${object.objectName}.csv`;
      const csvFilePath = path.join(this.outputDir, csvFileName);

      try {
        // Use SF CLI bulk export to directly create CSV file
        const queryRes = await bulkQueryWithCLI(bulkQueryRecords, this.conn, csvFilePath, 60);

        if (queryRes.success) {
          // Count records in the CSV file to provide feedback
          const csvContent = await fs.readFile(csvFilePath, 'utf8');
          const lines = csvContent.split('\n').filter(line => line.trim() !== '');
          const recordCount = Math.max(0, lines.length - 1); // Subtract header row

          uxLog(this, c.grey(`Extracted ${recordCount} records for ${object.objectName}`));

          // Add to cpqObjects property
          this.cpqObjects.push({
            object: object.objectName,
            csvFile: csvFilePath
          });

          // Add to outputTabs property for summary
          const tabName = object.objectName.substring(0, 31);

          this.outputTabs.push({
            tabName: tabName,
            recordCount: recordCount,
            object: object.objectName,
            hasData: recordCount > 0,
            csvFile: csvFilePath
          });

          uxLog(this, c.green(`Saved ${recordCount} records to ${csvFileName}`));
        }
      } catch (error) {
        uxLog(this, c.red(`Error extracting ${object.objectName}: ${error instanceof Error ? error.message : String(error)}`));
        // Continue with next object even if one fails
      }
    }
  }

  public async mergeCsvInExcelFile(): Promise<void> {
    uxLog(this, c.cyan('Creating Excel file with CPQ data using streaming...'));

    // Create a new workbook with streaming support
    const workbook = new Excel.stream.xlsx.WorkbookWriter({
      filename: path.join(this.outputDir, 'CPQ_Extract.xlsx'),
      useStyles: true,
      useSharedStrings: false
    });

    workbook.creator = 'sfdx-hardis CPQ Extract';
    workbook.lastModifiedBy = 'sfdx-hardis';
    workbook.created = new Date();

    // Create summary worksheet first
    await this.createSummaryWorksheetStreaming(workbook);

    // Process each CSV file using outputTabs with streaming
    for (const tabInfo of this.outputTabs) {
      // Skip if no CSV file was created (e.g., extraction failed)
      if (!tabInfo.csvFile) {
        continue;
      }

      try {
        await this.processCSVFileStreaming(workbook, tabInfo);
      } catch (error) {
        uxLog(this, c.red(`Error processing CSV file ${tabInfo.csvFile}: ${error instanceof Error ? error.message : String(error)}`));
      }
    }

    // Commit the workbook to finish writing
    try {
      await workbook.commit();
      uxLog(this, c.green(`Excel file created successfully: CPQ_Extract.xlsx`));
      uxLog(this, c.cyan(`File location: ${path.join(this.outputDir, 'CPQ_Extract.xlsx')}`));
    } catch (error) {
      uxLog(this, c.red(`Error creating Excel file: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  private async processCSVFileStreaming(workbook: any, tabInfo: any): Promise<void> {
    return new Promise((resolve, reject) => {
      uxLog(this, c.grey(`Processing ${tabInfo.tabName} with streaming...`));
      // Add worksheet using streaming
      const worksheet = workbook.addWorksheet(tabInfo.tabName);
      let isFirstRow = true;
      let rowCount = 0;
      let headers: string[] = [];
      // Create read stream for the CSV file
      const csvStream = createReadStream(tabInfo.csvFile, { encoding: 'utf8' });
      let csvBuffer = '';
      csvStream.on('data', (chunk: string | Buffer) => {
        const chunkStr = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        csvBuffer += chunkStr;
        const lines = csvBuffer.split('\n');
        // Keep the last incomplete line in the buffer
        csvBuffer = lines.pop() || '';
        for (const line of lines) {
          if (line.trim() === '') {
            continue;
          }
          try {
            // Parse individual line
            const parseResult = Papa.parse(line, {
              header: false,
              skipEmptyLines: true
            });
            if (parseResult.data.length > 0) {
              const row = parseResult.data[0] as string[];
              if (isFirstRow) {
                // First row contains headers
                headers = row;
                // Add headers to worksheet
                const headerRow = worksheet.addRow(headers);
                headerRow.font = { bold: true };
                headerRow.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFE0E0E0' }
                };
                // Set column widths based on header length (initial estimate)
                headers.forEach((header, index) => {
                  const column = worksheet.getColumn(index + 1);
                  column.width = Math.max(header.length + 2, 15);
                });
                isFirstRow = false;
              } else if (row.length > 0 && row.some((cell: any) => cell !== null && cell !== '')) {
                // Add data row, ensuring we have the right number of columns
                const dataRow = headers.map((_, index) => row[index] || '');
                worksheet.addRow(dataRow);
                rowCount++;
                // Commit rows in batches to manage memory
                if (rowCount % 1000 === 0) {
                  worksheet.commit();
                  uxLog(this, c.grey(`  Processed ${rowCount} rows for ${tabInfo.tabName}...`));
                }
              }
            }
          } catch (error) {
            // Skip problematic lines and continue
            uxLog(this, c.yellow(`Warning: Skipping malformed line in ${tabInfo.tabName}: ${error instanceof Error ? error.message : String(error)}`));
          }
        }
      });

      csvStream.on('end', () => {
        try {
          // Process any remaining data in buffer
          if (csvBuffer.trim()) {
            const parseResult = Papa.parse(csvBuffer, {
              header: false,
              skipEmptyLines: true
            });
            if (parseResult.data.length > 0) {
              const row = parseResult.data[0] as string[];
              if (!isFirstRow && row.length > 0 && row.some((cell: any) => cell !== null && cell !== '')) {
                const dataRow = headers.map((_, index) => row[index] || '');
                worksheet.addRow(dataRow);
                rowCount++;
              }
            }
          }

          // Final commit for any remaining rows
          worksheet.commit();
          if (rowCount === 0) {
            // If no data rows, add a placeholder
            worksheet.addRow(['No data available']);
            worksheet.commit();
          }
          uxLog(this, c.grey(`Added worksheet "${tabInfo.tabName}" with ${rowCount} rows (streaming)`));
          resolve(undefined);
        } catch (error) {
          reject(error);
        }
      });

      csvStream.on('error', (error: any) => {
        reject(error);
      });
    });
  }

  private async createSummaryWorksheetStreaming(workbook: any): Promise<void> {
    const summaryWorksheet = workbook.addWorksheet('Summary');
    // Add title
    const titleRow = summaryWorksheet.addRow(['CPQ Extract Summary']);
    titleRow.font = { bold: true, size: 16 };
    titleRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    summaryWorksheet.addRow(['Generated on:', new Date().toISOString()]);
    summaryWorksheet.addRow([]);
    // Add headers for summary table
    const headerRow = summaryWorksheet.addRow(['Object Name', 'Tab Name', 'Record Count', 'Has Data']);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
    // Add summary data
    let totalRecords = 0;
    let objectsWithData = 0;
    for (const tab of this.outputTabs) {
      summaryWorksheet.addRow([
        tab.object,
        tab.tabName,
        tab.recordCount,
        tab.hasData ? 'Yes' : 'No'
      ]);
      totalRecords += tab.recordCount;
      if (tab.hasData) {
        objectsWithData++;
      }
    }

    // Add totals
    summaryWorksheet.addRow([]);
    const totalObjectsRow = summaryWorksheet.addRow(['Total Objects Extracted:', this.outputTabs.length]);
    totalObjectsRow.font = { bold: true };
    const objectsWithDataRow = summaryWorksheet.addRow(['Objects with Data:', objectsWithData]);
    objectsWithDataRow.font = { bold: true };
    const totalRecordsRow = summaryWorksheet.addRow(['Total Records:', totalRecords]);
    totalRecordsRow.font = { bold: true };

    // Add skipped objects section if any
    if (this.skippedObjects.length > 0) {
      summaryWorksheet.addRow([]);

      const skippedHeaderRow = summaryWorksheet.addRow(['Objects Skipped (No Fields Found):']);
      skippedHeaderRow.font = { bold: true, color: { argb: 'FFFF6600' } };

      for (const skippedObject of this.skippedObjects) {
        summaryWorksheet.addRow([skippedObject, 'No fields accessible', 0, 'No']);
      }

      const skippedCountRow = summaryWorksheet.addRow(['Total Skipped Objects:', this.skippedObjects.length]);
      skippedCountRow.font = { bold: true, color: { argb: 'FFFF6600' } };
    }

    // Set column widths
    summaryWorksheet.getColumn(1).width = 25;
    summaryWorksheet.getColumn(2).width = 20;
    summaryWorksheet.getColumn(3).width = 15;
    summaryWorksheet.getColumn(4).width = 10;

    // Commit the summary worksheet
    summaryWorksheet.commit();

    uxLog(this, c.grey('Created summary worksheet with extraction overview (streaming)'));
  }

}